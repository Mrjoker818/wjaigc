import { fetchWithV1Retry } from '@/lib/api-helpers';
import type { ApiProvider } from '@/lib/universal-api-types';
import type {
  ComplianceJsonScalar,
  PlatformComplianceCheckV1,
  PlatformComplianceRule,
} from './types';

type VisionProvider = Pick<ApiProvider, 'id' | 'baseUrl' | 'apiKey'>;

export interface ComplianceVisionInput {
  provider: VisionProvider;
  modelId: string;
  imageInput: string;
  rules: readonly PlatformComplianceRule[];
  requestId: string;
  signal: AbortSignal;
}

export interface VisionComplianceResult {
  providerId: string;
  modelId: string;
  requestId: string;
  checks: readonly PlatformComplianceCheckV1[];
}

export type ComplianceVisionFetcher = (
  baseUrl: string,
  path: string,
  options: RequestInit,
) => Promise<Response>;

export interface ComplianceVisionDependencies {
  fetcher: ComplianceVisionFetcher;
}

type ComplianceVisionErrorCode =
  | 'COMPLIANCE_VISION_AUTH_REJECTED'
  | 'COMPLIANCE_VISION_RATE_LIMITED'
  | 'COMPLIANCE_VISION_PROVIDER_UNAVAILABLE'
  | 'COMPLIANCE_VISION_PROVIDER_REJECTED'
  | 'COMPLIANCE_VISION_RESPONSE_INVALID'
  | 'COMPLIANCE_VISION_SUBMISSION_UNKNOWN';

export class ComplianceVisionError extends Error {
  readonly submissionUnknown: boolean;

  constructor(
    readonly code: ComplianceVisionErrorCode,
    readonly providerId: string,
    readonly modelId: string,
    readonly requestId: string,
    readonly retryable: boolean,
    readonly providerStatus?: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ComplianceVisionError';
    this.submissionUnknown = code === 'COMPLIANCE_VISION_SUBMISSION_UNKNOWN';
  }
}

const defaultDependencies: ComplianceVisionDependencies = {
  fetcher: (baseUrl, path, options) => fetchWithV1Retry(
    baseUrl,
    path,
    { ...options, skipV1Retry: true },
    false,
  ),
};

const RESPONSE_KEYS = new Set(['checks']);
const CHECK_KEYS = new Set([
  'ruleId', 'status', 'evidence', 'measuredValue', 'confidence', 'remediation',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requestIdFrom(response: Response, fallback: string): string {
  return response.headers.get('x-request-id')?.trim()
    || response.headers.get('request-id')?.trim()
    || fallback;
}

function failedStatus(rule: PlatformComplianceRule): PlatformComplianceCheckV1['status'] {
  return rule.severity === 'blocking' ? 'blocked' : 'warning';
}

function responseError(
  input: ComplianceVisionInput,
  requestId: string,
  cause?: unknown,
): ComplianceVisionError {
  return new ComplianceVisionError(
    'COMPLIANCE_VISION_RESPONSE_INVALID',
    input.provider.id,
    input.modelId,
    requestId,
    true,
    undefined,
    { cause },
  );
}

function parseScalar(value: unknown): ComplianceJsonScalar | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseVisionChecks(
  content: string,
  input: ComplianceVisionInput,
  requestId: string,
): readonly PlatformComplianceCheckV1[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw responseError(input, requestId, error);
  }
  if (
    !isRecord(parsed)
    || Object.keys(parsed).some(key => !RESPONSE_KEYS.has(key))
    || !Array.isArray(parsed.checks)
    || parsed.checks.length !== input.rules.length
  ) throw responseError(input, requestId);

  const byRuleId = new Map<string, Record<string, unknown>>();
  for (const value of parsed.checks) {
    if (
      !isRecord(value)
      || Object.keys(value).length !== CHECK_KEYS.size
      || Object.keys(value).some(key => !CHECK_KEYS.has(key))
      || typeof value.ruleId !== 'string'
      || byRuleId.has(value.ruleId)
    ) throw responseError(input, requestId);
    byRuleId.set(value.ruleId, value);
  }

  return Object.freeze(input.rules.map(rule => {
    const value = byRuleId.get(rule.id);
    const measuredValue = value && parseScalar(value.measuredValue);
    const expectedFailure = failedStatus(rule);
    if (
      !value
      || !['passed', 'unknown', expectedFailure].includes(String(value.status))
      || !Array.isArray(value.evidence)
      || value.evidence.length === 0
      || value.evidence.some(item => typeof item !== 'string' || !item.trim())
      || measuredValue === undefined
      || !(value.confidence === null
        || typeof value.confidence === 'number'
          && Number.isFinite(value.confidence)
          && value.confidence >= 0
          && value.confidence <= 1)
      || !(value.remediation === null
        || typeof value.remediation === 'string' && Boolean(value.remediation.trim()))
      || (value.status === 'passed' && value.remediation !== null)
      || (value.status !== 'passed' && value.remediation === null)
    ) throw responseError(input, requestId);
    return Object.freeze({
      ruleId: rule.id,
      ruleVersion: rule.version,
      title: rule.title,
      severity: rule.severity,
      evaluator: rule.evaluator,
      status: value.status as PlatformComplianceCheckV1['status'],
      evidence: Object.freeze([...(value.evidence as string[])]),
      measuredValue,
      requiredValue: JSON.stringify(rule.thresholds ?? {}),
      confidence: value.confidence as number | null,
      remediation: value.remediation as string | null,
    });
  }));
}

function visionPrompt(rules: readonly PlatformComplianceRule[]): string {
  return JSON.stringify({
    instruction: 'Return only one JSON object. Evaluate every listed rule exactly once.',
    schema: {
      checks: [{
        ruleId: 'string', status: 'passed|warning|blocked|unknown', evidence: ['string'],
        measuredValue: 'JSON scalar', confidence: 'number 0..1 or null',
        remediation: 'null when passed; non-empty string otherwise',
      }],
    },
    rules: rules.map(rule => ({
      id: rule.id, severity: rule.severity, title: rule.title, thresholds: rule.thresholds ?? {},
    })),
  });
}

function httpError(
  input: ComplianceVisionInput,
  response: Response,
  requestId: string,
): ComplianceVisionError {
  const status = response.status;
  const code = status === 401 || status === 403
    ? 'COMPLIANCE_VISION_AUTH_REJECTED'
    : status === 429
      ? 'COMPLIANCE_VISION_RATE_LIMITED'
      : status >= 500
        ? 'COMPLIANCE_VISION_PROVIDER_UNAVAILABLE'
        : 'COMPLIANCE_VISION_PROVIDER_REJECTED';
  return new ComplianceVisionError(
    code,
    input.provider.id,
    input.modelId,
    requestId,
    status === 429 || status >= 500,
    status,
  );
}

export async function invokeComplianceVision(
  input: ComplianceVisionInput,
  dependencies: ComplianceVisionDependencies = defaultDependencies,
): Promise<VisionComplianceResult> {
  input.signal.throwIfAborted();
  let response: Response;
  try {
    response = await dependencies.fetcher(input.provider.baseUrl, '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.provider.apiKey}`,
        'X-Request-Id': input.requestId,
      },
      body: JSON.stringify({
        model: input.modelId,
        stream: false,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: visionPrompt(input.rules) },
            { type: 'image_url', image_url: { url: input.imageInput } },
          ],
        }],
      }),
      signal: input.signal,
    });
  } catch (error) {
    throw new ComplianceVisionError(
      'COMPLIANCE_VISION_SUBMISSION_UNKNOWN',
      input.provider.id,
      input.modelId,
      input.requestId,
      false,
      undefined,
      { cause: error },
    );
  }

  const requestId = requestIdFrom(response, input.requestId);
  if (!response.ok) throw httpError(input, response, requestId);
  let envelope: unknown;
  try {
    envelope = await response.json() as unknown;
  } catch (error) {
    throw responseError(input, requestId, error);
  }
  const choices = isRecord(envelope) && Array.isArray(envelope.choices) ? envelope.choices : [];
  const first = choices[0];
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  const content = message?.content;
  if (typeof content !== 'string' || !content) throw responseError(input, requestId);
  return Object.freeze({
    providerId: input.provider.id,
    modelId: input.modelId,
    requestId,
    checks: parseVisionChecks(content, input, requestId),
  });
}

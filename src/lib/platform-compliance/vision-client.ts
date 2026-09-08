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
  | 'COMPLIANCE_VISION_CANCELLED'
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
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESPONSE_DEPTH = 10;
const MAX_RESPONSE_ITEMS = 256;
const MAX_REQUEST_ID_LENGTH = 128;
const VISION_TIMEOUT_MS = 60_000;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CHECK_KEYS = new Set([
  'ruleId', 'status', 'evidence', 'measuredValue', 'confidence', 'remediation',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function cancelResponseBody(response: Response, reason?: unknown): Promise<void> {
  if (!response.body || response.bodyUsed) return;
  await response.body.cancel(reason).catch(() => undefined);
}

function cancellationError(input: ComplianceVisionInput, requestId: string): ComplianceVisionError {
  return new ComplianceVisionError(
    'COMPLIANCE_VISION_CANCELLED',
    input.provider.id,
    input.modelId,
    requestId,
    false,
    undefined,
    { cause: input.signal.reason },
  );
}

async function requestIdFrom(response: Response, input: ComplianceVisionInput): Promise<string> {
  const value = response.headers.get('x-request-id')?.trim()
    || response.headers.get('request-id')?.trim();
  if (!value) return input.requestId;
  if (value.length > MAX_REQUEST_ID_LENGTH || !SAFE_REQUEST_ID.test(value)) {
    await cancelResponseBody(response);
    throw responseError(input, input.requestId);
  }
  return value;
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

async function readBoundedResponse(
  response: Response,
  input: ComplianceVisionInput,
  requestId: string,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (
    !/^\d+$/u.test(declaredLength)
    || Number(declaredLength) > MAX_RESPONSE_BYTES
  )) {
    await cancelResponseBody(response);
    throw responseError(input, requestId);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const cancelForCaller = () => {
    void reader.cancel(input.signal.reason).catch(() => undefined);
  };
  input.signal.addEventListener('abort', cancelForCaller, { once: true });
  try {
    while (true) {
      if (input.signal.aborted) throw cancellationError(input, requestId);
      const chunk = await reader.read();
      if (input.signal.aborted) throw cancellationError(input, requestId);
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw responseError(input, requestId);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (input.signal.aborted) {
      await reader.cancel(input.signal.reason).catch(() => undefined);
      throw cancellationError(input, requestId);
    }
    if (error instanceof ComplianceVisionError) throw error;
    throw responseError(input, requestId);
  } finally {
    input.signal.removeEventListener('abort', cancelForCaller);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw responseError(input, requestId);
  }
}

function assertBoundedJsonStructure(value: unknown): void {
  let itemCount = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_RESPONSE_DEPTH) throw new Error('COMPLIANCE_VISION_RESPONSE_DEPTH_LIMIT');
    itemCount += 1;
    if (itemCount > MAX_RESPONSE_ITEMS) throw new Error('COMPLIANCE_VISION_RESPONSE_ITEM_LIMIT');
    if (!candidate || typeof candidate !== 'object') return;
    const children = Array.isArray(candidate)
      ? candidate
      : Object.values(candidate as Record<string, unknown>);
    for (const child of children) visit(child, depth + 1);
  };
  visit(value, 0);
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
    assertBoundedJsonStructure(parsed);
  } catch {
    throw responseError(input, requestId);
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
  if (input.signal.aborted) {
    throw cancellationError(input, input.requestId);
  }
  const requestSignal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(VISION_TIMEOUT_MS),
  ]);
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
      signal: requestSignal,
    });
  } catch (error) {
    if (input.signal.aborted) {
      throw cancellationError(input, input.requestId);
    }
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

  const requestId = await requestIdFrom(response, input);
  if (!response.ok) {
    await cancelResponseBody(response);
    throw httpError(input, response, requestId);
  }
  let envelope: unknown;
  try {
    const responseText = await readBoundedResponse(response, input, requestId);
    if (input.signal.aborted) throw cancellationError(input, requestId);
    envelope = JSON.parse(responseText) as unknown;
    assertBoundedJsonStructure(envelope);
  } catch (error) {
    if (input.signal.aborted) throw cancellationError(input, requestId);
    if (error instanceof ComplianceVisionError) throw error;
    throw responseError(input, requestId);
  }
  const choices = isRecord(envelope) && Array.isArray(envelope.choices) ? envelope.choices : [];
  const first = choices[0];
  const message = isRecord(first) && isRecord(first.message) ? first.message : null;
  const content = message?.content;
  if (typeof content !== 'string' || !content) throw responseError(input, requestId);
  if (input.signal.aborted) throw cancellationError(input, requestId);
  return Object.freeze({
    providerId: input.provider.id,
    modelId: input.modelId,
    requestId,
    checks: parseVisionChecks(content, input, requestId),
  });
}

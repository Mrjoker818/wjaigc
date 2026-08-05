const EDITS_PATH = '/v1/images/edits';
const GENERATIONS_PATH = '/v1/images/generations';
const TASKS_PATH = '/v1/images/tasks';

type PearEndpoint = 'edits' | 'generations';
type PearRemoteStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export class PearProtocolError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'PearProtocolError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export class PearSubmissionIndeterminateError extends PearProtocolError {
  constructor(cause?: unknown) {
    super(
      'PEAR_SUBMISSION_INDETERMINATE',
      'Pear submission outcome is indeterminate; automatic resubmission is disabled',
      { retryable: false },
    );
    this.name = 'PearSubmissionIndeterminateError';
    if (cause !== undefined) this.cause = cause;
  }
}

interface PearRequestContext {
  baseUrl: string;
  apiKey: string;
  applicationTaskId: string;
  requestId: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface PearSubmitInput extends PearRequestContext {
  image: string;
}

export interface PearPollInput extends PearRequestContext {
  remoteTaskId: string;
  previousStatus?: PearRemoteStatus;
}

export type PearSubmitResult =
  | { kind: 'async'; remoteTaskId: string; endpoint: PearEndpoint }
  | { kind: 'sync'; artifactUrl: string; endpoint: PearEndpoint };

export type PearPollResult =
  | { status: 'queued' | 'running'; progress: number }
  | { status: 'completed'; progress: 100; artifactUrl: string }
  | { status: 'failed' | 'cancelled' | 'timeout'; progress: number; error: string };

interface ParsedResponse {
  body: Record<string, unknown>;
  text: string;
}

function buildPearUrl(baseUrl: string, path: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (!/^https?:\/\//i.test(root)) {
    throw new PearProtocolError('PEAR_BASE_URL_INVALID', 'Pear base URL is invalid');
  }
  return `${root}${path}`;
}

function requestHeaders(input: PearRequestContext): Record<string, string> {
  return {
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': input.applicationTaskId,
    'X-Request-Id': input.requestId,
  };
}

async function parseJsonResponse(response: Response): Promise<ParsedResponse> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new PearProtocolError(
      'PEAR_RESPONSE_NOT_JSON',
      'Pear returned a non-JSON response',
      { status: response.status, retryable: response.status >= 500 },
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PearProtocolError(
      'PEAR_RESPONSE_INVALID',
      'Pear returned an invalid response object',
      { status: response.status },
    );
  }
  return { body: body as Record<string, unknown>, text };
}

function nestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  ))?.trim();
}

function extractRemoteTaskId(body: Record<string, unknown>): string | undefined {
  const data = nestedRecord(body, 'data');
  return firstString(body.task_id, body.taskId, body.id, data?.task_id, data?.taskId, data?.id);
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
      !!item && typeof item === 'object' && !Array.isArray(item)
    ))
    : [];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLayerArtifactUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return pathname.endsWith('.psd') || pathname.endsWith('.zip');
  } catch {
    return false;
  }
}

function extractArtifactUrl(body: Record<string, unknown>): string | undefined {
  const dataObject = nestedRecord(body, 'data');
  const output = nestedRecord(body, 'output');
  const result = nestedRecord(body, 'result');
  const explicitUrl = firstString(
    body.psd_url,
    body.psdUrl,
    body.zip_url,
    body.zipUrl,
    body.artifact_url,
    body.artifactUrl,
    dataObject?.psd_url,
    dataObject?.psdUrl,
    dataObject?.zip_url,
    dataObject?.zipUrl,
    dataObject?.artifact_url,
    dataObject?.artifactUrl,
    output?.psd_url,
    output?.psdUrl,
    output?.zip_url,
    output?.zipUrl,
    output?.artifact_url,
    output?.artifactUrl,
    result?.psd_url,
    result?.psdUrl,
    result?.zip_url,
    result?.zipUrl,
    result?.artifact_url,
    result?.artifactUrl,
  );
  if (explicitUrl && isLayerArtifactUrl(explicitUrl)) return explicitUrl;

  const candidates = [
    ...arrayRecords(body.data),
    ...arrayRecords(output?.data),
    ...arrayRecords(result?.data),
  ].map((item) => firstString(
    item.url,
    item.psd_url,
    item.psdUrl,
    item.zip_url,
    item.zipUrl,
    item.artifact_url,
    item.artifactUrl,
  ));

  const outputUrls = Array.isArray(output?.image_urls) ? output.image_urls : [];
  const resultUrls = Array.isArray(result?.image_urls) ? result.image_urls : [];
  for (const candidate of [...candidates, ...outputUrls, ...resultUrls]) {
    if (typeof candidate === 'string' && isLayerArtifactUrl(candidate)) return candidate;
  }
  return undefined;
}

function endpointUnsupported(status: number, body: Record<string, unknown>): boolean {
  if (status === 404 || status === 405) return true;
  if (status !== 400 && status !== 422) return false;
  const error = body.error;
  const message = firstString(
    typeof error === 'string' ? error : undefined,
    nestedRecord(body, 'error')?.message,
    body.message,
  )?.toLowerCase() || '';
  return (
    message.includes('unsupported endpoint')
    || message.includes('endpoint not supported')
    || message.includes('method not allowed')
  );
}

function responseError(
  response: Response,
  parsed: ParsedResponse,
): PearProtocolError {
  const nestedError = nestedRecord(parsed.body, 'error');
  const message = firstString(
    typeof parsed.body.error === 'string' ? parsed.body.error : undefined,
    nestedError?.message,
    parsed.body.message,
  ) || `Pear request failed with HTTP ${response.status}`;
  return new PearProtocolError('PEAR_UPSTREAM_ERROR', message.slice(0, 1_000), {
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
  });
}

async function submitAtEndpoint(
  input: PearSubmitInput,
  endpoint: PearEndpoint,
): Promise<
  | { accepted: true; result: PearSubmitResult }
  | { accepted: false; unsupported: boolean; error: PearProtocolError }
> {
  const path = endpoint === 'edits' ? EDITS_PATH : GENERATIONS_PATH;
  let response: Response;
  try {
    response = await (input.fetchImpl || fetch)(buildPearUrl(input.baseUrl, path), {
      method: 'POST',
      headers: requestHeaders(input),
      body: JSON.stringify({
        model: 'image-layered',
        image: input.image,
        // PearAPI schema requires `prompt` (minLength: 1) even though the
        // image-layered model ignores it. Send a minimal placeholder.
        prompt: '.',
        task_type: 'async',
        response_format: 'url',
      }),
      signal: input.signal,
    });
  } catch (error) {
    throw new PearSubmissionIndeterminateError(error);
  }

  const parsed = await parseJsonResponse(response);
  const remoteTaskId = extractRemoteTaskId(parsed.body);
  if (remoteTaskId) {
    return {
      accepted: true,
      result: { kind: 'async', remoteTaskId, endpoint },
    };
  }
  const artifactUrl = extractArtifactUrl(parsed.body);
  if (response.ok && artifactUrl) {
    return { accepted: true, result: { kind: 'sync', artifactUrl, endpoint } };
  }
  if (!response.ok) {
    return {
      accepted: false,
      unsupported: endpointUnsupported(response.status, parsed.body),
      error: responseError(response, parsed),
    };
  }
  return {
    accepted: false,
    unsupported: false,
    error: new PearProtocolError(
      'PEAR_SUBMISSION_RESULT_INVALID',
      'Pear submission returned neither a task ID nor a layer artifact',
    ),
  };
}

export async function submitPearLayerTask(
  input: PearSubmitInput,
): Promise<PearSubmitResult> {
  const primary = await submitAtEndpoint(input, 'edits');
  if (primary.accepted) return primary.result;
  if (!primary.unsupported) throw primary.error;

  const fallback = await submitAtEndpoint(input, 'generations');
  if (fallback.accepted) return fallback.result;
  throw fallback.error;
}

function normalizeStatus(value: unknown): PearRemoteStatus {
  const status = String(value || '').trim().toLowerCase();
  if (['queued', 'pending', 'created'].includes(status)) return 'queued';
  if (['running', 'processing', 'in_progress'].includes(status)) return 'running';
  if (['completed', 'succeeded', 'success', 'done'].includes(status)) return 'completed';
  if (['failed', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (['timeout', 'timed_out'].includes(status)) return 'timeout';
  throw new PearProtocolError(
    'PEAR_TASK_STATUS_INVALID',
    `Pear returned an unknown task status: ${status || '(empty)'}`,
  );
}

function normalizeProgress(value: unknown, status: PearRemoteStatus): number {
  if (status === 'completed') return 100;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(99, Math.max(0, Math.round(number))) : 0;
}

function assertNoStatusRegression(
  previousStatus: PearRemoteStatus | undefined,
  nextStatus: PearRemoteStatus,
): void {
  if (!previousStatus) return;
  const terminal = new Set<PearRemoteStatus>(['completed', 'failed', 'cancelled', 'timeout']);
  if (terminal.has(previousStatus) && previousStatus !== nextStatus) {
    throw new PearProtocolError(
      'PEAR_TASK_STATUS_REGRESSION',
      `Pear task regressed from ${previousStatus} to ${nextStatus}`,
    );
  }
  if (previousStatus === 'running' && nextStatus === 'queued') {
    throw new PearProtocolError(
      'PEAR_TASK_STATUS_REGRESSION',
      'Pear task regressed from running to queued',
    );
  }
}

export async function pollPearLayerTask(
  input: PearPollInput,
): Promise<PearPollResult> {
  let response: Response;
  try {
    response = await (input.fetchImpl || fetch)(
      `${buildPearUrl(input.baseUrl, TASKS_PATH)}/${encodeURIComponent(input.remoteTaskId)}`,
      {
        method: 'GET',
        headers: requestHeaders(input),
        signal: input.signal,
      },
    );
  } catch (error) {
    throw new PearProtocolError(
      'PEAR_POLL_FAILED',
      error instanceof Error ? error.message : 'Pear polling failed',
      { retryable: true },
    );
  }

  const parsed = await parseJsonResponse(response);
  if (!response.ok) throw responseError(response, parsed);

  const data = nestedRecord(parsed.body, 'data');
  const status = normalizeStatus(parsed.body.status ?? data?.status);
  assertNoStatusRegression(input.previousStatus, status);
  const progress = normalizeProgress(parsed.body.progress ?? data?.progress, status);

  if (status === 'completed') {
    const artifactUrl = extractArtifactUrl(parsed.body);
    if (!artifactUrl) {
      throw new PearProtocolError(
        'PEAR_EMPTY_COMPLETED_RESULT',
        'Pear completed the task without a PSD or ZIP artifact',
      );
    }
    return { status, progress: 100, artifactUrl };
  }
  if (status === 'queued' || status === 'running') return { status, progress };

  const errorRecord = nestedRecord(parsed.body, 'error');
  const error = firstString(
    typeof parsed.body.error === 'string' ? parsed.body.error : undefined,
    errorRecord?.message,
    parsed.body.message,
  ) || `Pear task ended as ${status}`;
  return { status, progress, error: error.slice(0, 1_000) };
}

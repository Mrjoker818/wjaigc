import { fetchWithV1Retry } from '@/lib/api-helpers';
import { isModelAssignedToUser } from '@/lib/model-defaults';
import {
  PsdAnalysisError,
  PSD_ANALYSIS_MAX_RESPONSE_BYTES,
} from '@/lib/psd-analysis/contracts';
import { SimpleChatSseDecoder } from '@/lib/simple-chat-sse';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';

const VISION_MODEL_PATTERN = /gemini|qwen(?:2(?:\.5)?)?-?vl|qvq|gpt-4o|gpt-4\.1|claude-(?:3|4)|glm-4v|internvl|llava|vision|(?:^|[-_])vl(?:[-_]|$)/i;
const DEFAULT_DEADLINE_MS = 45_000;
const MAX_CANDIDATES = 3;

function normalizeProviderBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export interface PsdVisionCandidate {
  key: string;
  kind: 'provider' | 'platform';
  providerId: string;
  providerName: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface BuildPsdVisionCandidatesInput {
  user: User;
  providers: ApiProvider[];
  providerId?: string;
  model?: string;
  platformModel?: string;
}

export interface PsdVisionInvocationResult {
  content: string;
  providerId: string;
  providerName: string;
  model: string;
  fallbackReason?: string;
}

export type PsdVisionRequestBody = {
  model: string;
  messages: Array<{
    role: 'user';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
    >;
  }>;
  max_tokens: 4096;
  temperature: 0.3;
  stream: false;
};

export type FetchPsdVisionCandidate = (
  candidate: PsdVisionCandidate,
  requestBody: PsdVisionRequestBody,
  signal: AbortSignal,
) => Promise<Response>;

export type InvokePsdPlatformCandidate = (
  candidate: PsdVisionCandidate,
  requestBody: PsdVisionRequestBody,
  signal: AbortSignal,
) => Promise<string>;

export interface InvokePsdVisionCandidatesInput {
  candidates: PsdVisionCandidate[];
  exactSelection: boolean;
  dataUrl: string;
  prompt: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchCandidate?: FetchPsdVisionCandidate;
  invokePlatform?: InvokePsdPlatformCandidate;
}

function modelError(code: string, message: string, status: number): never {
  throw new PsdAnalysisError(code, message, status, false);
}

function supportsVisionProvider(provider: ApiProvider): boolean {
  const kind = provider.modelType ?? provider.type;
  return (
    provider.isEnabled
    && Boolean(provider.baseUrl)
    && Boolean(provider.apiKey)
    && (kind === 'vlm' || kind === 'chat')
  );
}

function candidateFromProvider(provider: ApiProvider, model: string): PsdVisionCandidate {
  return {
    key: `${provider.id}::${model}`,
    kind: 'provider',
    providerId: provider.id,
    providerName: provider.displayName || provider.name,
    model,
    baseUrl: normalizeProviderBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
  };
}

function modelAllowedForUser(user: User, providerId: string, model: string): boolean {
  return user.role === 'admin'
    || isModelAssignedToUser(user.chatModels, providerId, model);
}

export function buildPsdVisionCandidates(
  input: BuildPsdVisionCandidatesInput,
): PsdVisionCandidate[] {
  if (Boolean(input.providerId) !== Boolean(input.model)) {
    modelError(
      'PSD_ANALYSIS_MODEL_PAIR_INVALID',
      'providerId 与 model 必须同时提供',
      400,
    );
  }

  if (input.providerId && input.model) {
    const provider = input.providers.find(item => item.id === input.providerId);
    if (!provider || !supportsVisionProvider(provider)) {
      modelError(
        'PSD_ANALYSIS_MODEL_UNAVAILABLE',
        '所选 PSD 分析提供商不可用',
        400,
      );
    }
    if (!(provider.selectedModels ?? []).includes(input.model)) {
      modelError(
        'PSD_ANALYSIS_MODEL_UNAVAILABLE',
        '所选 PSD 分析模型不属于该提供商',
        400,
      );
    }
    if (!modelAllowedForUser(input.user, provider.id, input.model)) {
      modelError(
        'PSD_ANALYSIS_MODEL_FORBIDDEN',
        '当前用户未获授权使用所选 PSD 分析模型',
        403,
      );
    }
    return [candidateFromProvider(provider, input.model)];
  }

  const candidates: PsdVisionCandidate[] = [];
  const platformModel = input.platformModel?.trim();
  if (platformModel) {
    candidates.push({
      key: `platform::${platformModel}`,
      kind: 'platform',
      providerId: 'platform',
      providerName: 'Platform vision gateway',
      model: platformModel,
    });
  }

  for (const provider of input.providers) {
    if (!supportsVisionProvider(provider)) continue;
    const kind = provider.modelType ?? provider.type;
    for (const model of provider.selectedModels ?? []) {
      if (kind !== 'vlm' && !VISION_MODEL_PATTERN.test(model)) continue;
      if (!modelAllowedForUser(input.user, provider.id, model)) continue;
      candidates.push(candidateFromProvider(provider, model));
    }
  }

  const unique = Array.from(
    new Map(candidates.map(candidate => [candidate.key, candidate])).values(),
  ).slice(0, MAX_CANDIDATES);
  if (unique.length === 0) {
    modelError(
      'PSD_ANALYSIS_MODEL_UNAVAILABLE',
      '没有可用且已授权的 PSD 视觉分析模型',
      503,
    );
  }
  return unique;
}

async function defaultFetchCandidate(
  candidate: PsdVisionCandidate,
  requestBody: PsdVisionRequestBody,
  signal: AbortSignal,
): Promise<Response> {
  if (!candidate.baseUrl || !candidate.apiKey) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_MODEL_UNAVAILABLE',
      'PSD 分析模型缺少提供商配置',
      503,
      false,
    );
  }
  return fetchWithV1Retry(candidate.baseUrl, '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${candidate.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > PSD_ANALYSIS_MAX_RESPONSE_BYTES) {
    throw new PsdAnalysisError(
      'PSD_ANALYSIS_OUTPUT_TOO_LARGE',
      'PSD 分析模型响应超过 256 KiB',
      502,
      true,
    );
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PSD_ANALYSIS_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PsdAnalysisError(
          'PSD_ANALYSIS_OUTPUT_TOO_LARGE',
          'PSD 分析模型响应超过 256 KiB',
          502,
          true,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapProviderPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  let current = value;
  if (current.code === 200 && isRecord(current.data)) current = current.data;
  if (isRecord(current.Response)) current = current.Response;
  return current;
}

function contentFromPayload(value: unknown, delta = false): string {
  const payload = unwrapProviderPayload(value);
  const choices = payload?.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) return '';
  const container = choices[0][delta ? 'delta' : 'message'];
  if (!isRecord(container)) return '';
  return typeof container.content === 'string' ? container.content : '';
}

function parseProviderContent(text: string, contentType: string): string {
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    try {
      return contentFromPayload(JSON.parse(text) as unknown);
    } catch (error) {
      throw new PsdAnalysisError(
        'PSD_ANALYSIS_OUTPUT_INVALID',
        'PSD 分析提供商返回了无效 JSON',
        502,
        true,
        { cause: error },
      );
    }
  }

  const decoder = new SimpleChatSseDecoder();
  const encoded = new TextEncoder().encode(text);
  const events = [...decoder.push(encoded), ...decoder.finish()];
  let content = '';
  for (const event of events) {
    const data = event.data.trim();
    if (!data || data === '[DONE]') continue;
    try {
      const value = JSON.parse(data) as unknown;
      content += contentFromPayload(value, true) || contentFromPayload(value);
    } catch (error) {
      throw new PsdAnalysisError(
        'PSD_ANALYSIS_OUTPUT_INVALID',
        'PSD 分析提供商返回了无效 SSE 数据',
        502,
        true,
        { cause: error },
      );
    }
  }
  return content;
}

function upstreamHttpError(status: number, candidate: PsdVisionCandidate): PsdAnalysisError {
  if (status === 401 || status === 403) {
    return new PsdAnalysisError(
      'PSD_ANALYSIS_PROVIDER_AUTH_FAILED',
      `PSD 分析提供商 ${candidate.providerName} 的凭据或权限无效`,
      502,
      false,
    );
  }
  const retryable = status === 404 || status === 405 || status === 408 || status === 429 || status >= 500;
  return new PsdAnalysisError(
    'PSD_ANALYSIS_UPSTREAM_FAILED',
    `PSD 分析提供商 ${candidate.providerName} 返回 HTTP ${status}`,
    502,
    retryable,
  );
}

function createLinkedDeadline(
  source: AbortSignal | undefined,
  deadlineMs: number,
): { signal: AbortSignal; dispose: () => void; deadline: AbortController } {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error('PSD_ANALYSIS_DEADLINE')),
    deadlineMs,
  );
  const linked = new AbortController();
  const copyAbort = (signal: AbortSignal) => {
    if (!linked.signal.aborted) linked.abort(signal.reason);
  };
  const onDeadline = () => copyAbort(deadline.signal);
  const onSource = () => source && copyAbort(source);
  deadline.signal.addEventListener('abort', onDeadline, { once: true });
  source?.addEventListener('abort', onSource, { once: true });
  if (source?.aborted) copyAbort(source);

  return {
    signal: linked.signal,
    deadline,
    dispose: () => {
      clearTimeout(timer);
      deadline.signal.removeEventListener('abort', onDeadline);
      source?.removeEventListener('abort', onSource);
    },
  };
}

export async function invokePsdVisionCandidates(
  input: InvokePsdVisionCandidatesInput,
): Promise<PsdVisionInvocationResult> {
  if (input.candidates.length === 0) {
    modelError('PSD_ANALYSIS_MODEL_UNAVAILABLE', '没有可调用的 PSD 分析模型', 503);
  }

  const deadline = createLinkedDeadline(
    input.signal,
    Math.max(1, input.deadlineMs ?? DEFAULT_DEADLINE_MS),
  );
  const failures: string[] = [];
  const fetchCandidate = input.fetchCandidate ?? defaultFetchCandidate;

  try {
    for (const candidate of input.candidates) {
      const requestBody: PsdVisionRequestBody = {
        model: candidate.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: input.prompt },
            {
              type: 'image_url',
              image_url: { url: input.dataUrl, detail: 'high' },
            },
          ],
        }],
        max_tokens: 4096,
        temperature: 0.3,
        stream: false,
      };

      try {
        let content: string;
        if (candidate.kind === 'platform') {
          if (!input.invokePlatform) {
            throw new PsdAnalysisError(
              'PSD_ANALYSIS_MODEL_UNAVAILABLE',
              '平台视觉模型未配置可取消的调用器',
              503,
              true,
            );
          }
          content = await input.invokePlatform(candidate, requestBody, deadline.signal);
        } else {
          const response = await fetchCandidate(candidate, requestBody, deadline.signal);
          if (!response.ok) throw upstreamHttpError(response.status, candidate);
          const responseText = await readBoundedResponse(response);
          content = parseProviderContent(
            responseText,
            response.headers.get('content-type') || 'application/json',
          );
        }
        if (!content.trim()) {
          throw new PsdAnalysisError(
            'PSD_ANALYSIS_OUTPUT_INVALID',
            'PSD 分析提供商返回了空内容',
            502,
            true,
          );
        }
        return {
          content,
          providerId: candidate.providerId,
          providerName: candidate.providerName,
          model: candidate.model,
          ...(failures.length > 0 ? { fallbackReason: failures.join('; ') } : {}),
        };
      } catch (error) {
        if (deadline.deadline.signal.aborted) {
          throw new PsdAnalysisError(
            'PSD_ANALYSIS_TIMEOUT',
            'PSD 分析超过 45 秒总截止时间',
            504,
            true,
            { cause: error },
          );
        }
        if (input.signal?.aborted) {
          throw new PsdAnalysisError(
            'PSD_ANALYSIS_CANCELLED',
            'PSD 分析请求已取消',
            499,
            false,
            { cause: error },
          );
        }
        const normalized = error instanceof PsdAnalysisError
          ? error
          : new PsdAnalysisError(
              'PSD_ANALYSIS_UPSTREAM_FAILED',
              `PSD 分析提供商 ${candidate.providerName} 网络调用失败`,
              502,
              true,
              { cause: error },
            );
        failures.push(`${candidate.key}:${normalized.code}`);
        if (input.exactSelection || !normalized.retryable) throw normalized;
      }
    }
  } finally {
    deadline.dispose();
  }

  throw new PsdAnalysisError(
    'PSD_ANALYSIS_UPSTREAM_FAILED',
    '所有已授权 PSD 分析模型均未返回有效结果',
    502,
    true,
  );
}

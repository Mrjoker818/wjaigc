import type {
  LayerDecompositionResult,
  LayerEngineMode,
  LayerTaskPhase,
  LayerTaskResponse,
} from '@/lib/layer-decomposition/types';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type WaitLike = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export interface LayerPhasePresentation {
  label: string;
  progress: number;
}

export interface RunLayerDecompositionOptions {
  imageUrl: string;
  engine: LayerEngineMode;
  providerId?: string;
  modelId?: string;
  idempotencyKey?: string;
  resumeTaskId?: string;
  keepalive?: boolean;
  skipDefaultTargetResolution?: boolean;
  signal?: AbortSignal;
  fetcher?: FetchLike;
  wait?: WaitLike;
  onResolvedTarget?: (target: { providerId: string; modelId: string }) =>
    | { providerId: string; modelId: string }
    | void
    | Promise<{ providerId: string; modelId: string } | void>;
  onResolvedSubmissionTarget?: (
    target: { providerId: string; modelId: string } | null,
  ) => void | Promise<void>;
  onTaskId?: (taskId: string) => void | Promise<void>;
  onProgress?: (task: LayerTaskResponse, presentation: LayerPhasePresentation) => void;
}

interface PublicLayerModel {
  id?: string;
  providerId?: string;
  type?: string;
}

const PHASE_PRESENTATION: Record<LayerTaskPhase, LayerPhasePresentation> = {
  'reading-source': { label: '正在读取图片', progress: 8 },
  'submitting-pear': { label: '正在提交 Pear 分层任务', progress: 15 },
  'waiting-for-pear': { label: 'Pear 正在生成 PSD', progress: 35 },
  'downloading-psd': { label: '正在下载并解析 PSD', progress: 58 },
  'extracting-psd': { label: '正在下载并解析 PSD', progress: 65 },
  'refining-layers': { label: '正在清理透明边缘', progress: 78 },
  'checking-quality': { label: '正在检查分层质量', progress: 88 },
  'running-local-fallback': { label: '正在运行本地增强分层', progress: 70 },
  ready: { label: '正在打开图层编辑器', progress: 100 },
};

const ERROR_MESSAGES: Record<string, string> = {
  LAYER_PROVIDER_REQUIRED: '未找到可用的 Pear 图片分层提供商，请联系管理员配置 Image-Layered 模型。',
  LAYER_PROVIDER_UNAVAILABLE: '所选图片分层提供商当前不可用。',
  LAYER_MODEL_FORBIDDEN: '当前账号未获授权使用所选图片分层模型。',
  LAYER_SOURCE_NOT_FOUND: '原图片不可访问，请重新上传后再试。',
  LAYER_SOURCE_URL_INVALID: '原图片地址不受支持，请使用画布中的已上传图片。',
  PEAR_UPSTREAM_REJECTED: 'Pear 拒绝了本次分层请求，请检查模型配置。',
  PEAR_TASK_TIMEOUT: 'Pear 分层任务已超时，积分将按任务终态结算。',
  LAYER_PSD_SIGNATURE_INVALID: 'Pear 返回的文件不是有效 PSD。',
  PSD_DECODE_FAILED: 'Pear 返回的 PSD 无法安全解析。',
  LAYER_QUALITY_FAILED: '分层结果未通过重建质量检查。',
  LAYER_LOCAL_QUALITY_FAILED: '本地增强分层未通过质量检查。',
};

const MANAGED_LAYER_MEDIA_PREFIXES = ['/uploads/', '/api/serve-upload/'] as const;

export function normalizeLayerImageUrlForSubmission(
  imageUrl: string,
  currentOrigin?: string,
): string {
  const value = imageUrl.trim();
  if (!currentOrigin) return value;
  try {
    const parsed = new URL(value);
    if (
      parsed.origin === new URL(currentOrigin).origin
      && MANAGED_LAYER_MEDIA_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix))
    ) {
      return parsed.pathname;
    }
  } catch {
    // Relative and malformed values are validated by the server.
  }
  return value;
}

export class LayerClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: string,
    message?: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(ERROR_MESSAGES[code] || message || '图片分层任务失败',
      options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LayerClientError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export function getLayerPhasePresentation(
  phase?: LayerTaskPhase,
  serverProgress = 0,
): LayerPhasePresentation {
  const configured = phase ? PHASE_PRESENTATION[phase] : undefined;
  if (!configured) {
    return { label: '正在准备图片分层', progress: Math.max(0, Math.min(99, serverProgress)) };
  }
  return {
    label: configured.label,
    progress: phase === 'waiting-for-pear'
      ? Math.max(configured.progress, Math.min(54, serverProgress))
      : Math.max(configured.progress, Math.min(100, serverProgress)),
  };
}

function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export function createLayerIdempotencyKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `layer-${random}`.slice(0, 128);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new LayerClientError('LAYER_RESPONSE_INVALID', '图片分层服务返回了无效响应', {
      status: response.status,
      retryable: response.status >= 500,
      cause: error,
    });
  }
}

function parseTaskResponse(response: Response, body: Record<string, unknown>): LayerTaskResponse {
  if (!response.ok || body.success === false) {
    const nested = body.error && typeof body.error === 'object'
      ? body.error as Record<string, unknown>
      : body;
    throw new LayerClientError(
      String(nested.code || body.code || 'LAYER_REQUEST_FAILED'),
      String(nested.message || body.message || '图片分层请求失败'),
      {
        status: response.status,
        retryable: nested.retryable === true || body.retryable === true,
      },
    );
  }
  if (typeof body.taskId !== 'string' || typeof body.status !== 'string') {
    throw new LayerClientError('LAYER_RESPONSE_INVALID', '图片分层响应缺少任务状态');
  }
  return body as unknown as LayerTaskResponse;
}

function normalizeLayerModel(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}

async function resolveDefaultLayerTarget(
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<{ providerId: string; modelId: string } | null> {
  const response = await fetcher('/api/workflow/models?type=layer', {
    method: 'GET', signal, cache: 'no-store',
  });
  const body = await readJson(response);
  if (!response.ok || body.success === false || !Array.isArray(body.models)) return null;
  const model = (body.models as PublicLayerModel[]).find((item) => (
    typeof item.id === 'string'
    && typeof item.providerId === 'string'
    && normalizeLayerModel(item.id) === 'image-layered'
  ));
  return model?.id && model.providerId
    ? { providerId: model.providerId, modelId: model.id }
    : null;
}

export async function cancelLayerDecomposition(
  taskId: string,
  options: { fetcher?: FetchLike; signal?: AbortSignal; keepalive?: boolean } = {},
): Promise<LayerTaskResponse> {
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(`/api/layered-decompose?taskId=${encodeURIComponent(taskId)}`, {
    method: 'DELETE', signal: options.signal, keepalive: options.keepalive,
  });
  return parseTaskResponse(response, await readJson(response));
}

export async function runLayerDecomposition(
  options: RunLayerDecompositionOptions,
): Promise<LayerDecompositionResult> {
  const fetcher = options.fetcher || fetch;
  const wait = options.wait || defaultWait;
  options.signal?.throwIfAborted();

  let task: LayerTaskResponse;
  const resumeTaskId = options.resumeTaskId?.trim();
  if (resumeTaskId) {
    const response = await fetcher(
      `/api/layered-decompose?taskId=${encodeURIComponent(resumeTaskId)}`,
      { method: 'GET', signal: options.signal, cache: 'no-store' },
    );
    task = parseTaskResponse(response, await readJson(response));
  } else {
    let providerId = options.providerId?.trim();
    let modelId = options.modelId?.trim();
    if (
      options.engine !== 'local'
      && (!providerId || !modelId)
      && !options.skipDefaultTargetResolution
    ) {
      const target = await resolveDefaultLayerTarget(fetcher, options.signal).catch((error) => {
        if (options.engine === 'cloud') throw error;
        return null;
      });
      providerId = target?.providerId;
      modelId = target?.modelId;
    }
    if (options.engine === 'cloud' && (!providerId || !modelId)) {
      throw new LayerClientError('LAYER_PROVIDER_REQUIRED');
    }
    if (providerId && modelId) {
      const authoritativeTarget = await options.onResolvedTarget?.({ providerId, modelId });
      if (authoritativeTarget) {
        providerId = authoritativeTarget.providerId;
        modelId = authoritativeTarget.modelId;
      }
    }
    await options.onResolvedSubmissionTarget?.(
      providerId && modelId ? { providerId, modelId } : null,
    );

    const response = await fetcher('/api/layered-decompose', {
      method: 'POST',
      signal: options.signal,
      keepalive: options.keepalive,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.idempotencyKey || createLayerIdempotencyKey(),
      },
      body: JSON.stringify({
        imageUrl: normalizeLayerImageUrlForSubmission(
          options.imageUrl,
          typeof window !== 'undefined' ? window.location.origin : undefined,
        ),
        engine: options.engine,
        ...(providerId && modelId ? { providerId, modelId } : {}),
      }),
    });
    task = parseTaskResponse(response, await readJson(response));
  }
  await options.onTaskId?.(task.taskId);
  let previousPhase = task.phase;
  let delayMs = 800;
  const startedAt = Date.now();

  while (task.status === 'pending' || task.status === 'processing') {
    options.onProgress?.(task, getLayerPhasePresentation(task.phase, task.progress));
    if (Date.now() - startedAt > 10 * 60_000) {
      throw new LayerClientError('LAYER_CLIENT_TIMEOUT', '等待图片分层任务超过 10 分钟', {
        retryable: true,
      });
    }
    await wait(delayMs, options.signal);
    const statusResponse = await fetcher(
      `/api/layered-decompose?taskId=${encodeURIComponent(task.taskId)}`,
      { method: 'GET', signal: options.signal, cache: 'no-store' },
    );
    task = parseTaskResponse(statusResponse, await readJson(statusResponse));
    delayMs = task.phase !== previousPhase ? 800 : Math.min(2_000, Math.round(delayMs * 1.35));
    previousPhase = task.phase;
  }

  options.onProgress?.(task, getLayerPhasePresentation(task.phase, task.progress));
  if (task.status !== 'completed' || !task.result) {
    throw new LayerClientError(
      task.error?.code || `LAYER_TASK_${task.status.toUpperCase()}`,
      task.error?.message || '图片分层任务未完成',
      { retryable: task.error?.retryable },
    );
  }
  return task.result;
}

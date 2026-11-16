import type {
  ElementBranchStatus,
  ElementDecomposeOutputMode,
  ElementDecomposeRequest,
} from '@/lib/element-decomposition/types';
import type { CloudTaskCreditStatus } from '@/lib/cloud-task-storage';
import type { LayerDecompositionResult, LayerTaskPhase, LayerUpstreamError } from '@/lib/layer-decomposition/types';
import type { LayerDocumentSource } from '@/lib/layer-documents/types';
import {
  getLayerPhasePresentation,
  resolveDefaultLayerTarget,
  type LayerFetchLike,
} from '@/lib/layer-decomposition-client';

type ElementBranch = 'board' | 'layers';

export interface ElementDecomposeBranchResponse {
  branch: ElementBranch;
  taskId: string;
  status: ElementBranchStatus;
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  fallbackReason?: string;
  providerError?: LayerUpstreamError;
}

export interface ElementDecomposeTaskResponse {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  overallStatus: 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'timeout';
  progress: number;
  source: {
    sourceImageId: string;
    sourceVersionId?: string;
    canonicalUrl: string;
    managedUrl: string;
    sha256: string;
    width: number;
    height: number;
    mimeType: string;
  };
  branches: Partial<Record<ElementBranch, ElementDecomposeBranchResponse>>;
}

export interface CompletedElementLayersEditorPayload {
  imageUrl: string;
  initialResult: LayerDecompositionResult;
  source: LayerDocumentSource | null;
  mode: 'studio';
}

export function resolveCompletedElementLayersEditorPayload(
  task: ElementDecomposeTaskResponse,
  projectId: string | null,
): CompletedElementLayersEditorPayload | null {
  const branch = task.branches.layers;
  if (branch?.status !== 'completed') return null;
  const initialResult = branch.result as LayerDecompositionResult | undefined;
  if (!initialResult?.layers?.length) return null;

  const sourceVersionId = task.source.sourceVersionId;
  return {
    imageUrl: task.source.canonicalUrl,
    initialResult,
    source: projectId && sourceVersionId ? {
      projectId,
      sourceImageId: task.source.sourceImageId,
      sourceVersionId,
      imageUrl: task.source.canonicalUrl,
      taskId: task.taskId,
    } : null,
    mode: 'studio',
  };
}

const BRANCH_STATUS_LABELS: Record<ElementBranchStatus, string> = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '已超时',
};

/** 分支当前阶段的中文说明（设计规格 §7）：图层分支沿用分层任务的 phase，拆解板分支按进度区分生成与检查。 */
export function describeElementBranchStage(
  branch: ElementBranch,
  state: Pick<ElementDecomposeBranchResponse, 'status' | 'progress' | 'result'>,
): string {
  if (state.status !== 'queued' && state.status !== 'processing') return BRANCH_STATUS_LABELS[state.status];
  if (state.status === 'queued') return '正在冻结原始图片';
  if (branch === 'board') return state.progress >= 95 ? '正在检查并保存拆解板' : '正在生成拆解板';
  const phase = state.result && typeof state.result.phase === 'string' ? state.result.phase as LayerTaskPhase : undefined;
  return getLayerPhasePresentation(phase, state.progress).label;
}

/** 汇总未完成分支的失败原因，用于结束提示。 */
export function summarizeElementBranchErrors(task: ElementDecomposeTaskResponse): string {
  return (['board', 'layers'] as const)
    .map((branch) => {
      const state = task.branches[branch];
      if (!state || state.status === 'completed' || !state.error) return '';
      return `${branch === 'board' ? '拆解板' : '可编辑图层'}：${state.error}`;
    })
    .filter(Boolean)
    .join('；');
}

const REFUNDED_LOCAL_LAYER_FALLBACK_MESSAGE = 'Pear 云端分层未完成，已退款并使用本地分层';

export function getRefundedLocalLayerFallbackMessage(
  branch?: ElementDecomposeBranchResponse,
): string | null {
  const engine = branch?.result && typeof branch.result.engine === 'string'
    ? branch.result.engine
    : undefined;
  return engine === 'local'
    && branch?.creditStatus === 'refunded'
    && Boolean(branch.fallbackReason)
    ? REFUNDED_LOCAL_LAYER_FALLBACK_MESSAGE
    : null;
}

export interface ElementDecomposeSourceInput {
  projectId: string;
  sourceImageId: string;
  sourceVersionId?: string;
  imageUrl: string;
}

export interface ElementDecomposeRequestOptions {
  outputMode?: ElementDecomposeOutputMode;
  aspectRatio: string;
  background?: 'light-gray' | 'transparent';
  engine?: 'smart' | 'cloud' | 'local';
  boardProviderId?: string;
  boardModelId?: string;
  layerProviderId?: string;
  layerModelId?: string;
}

export class ElementDecompositionClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'ElementDecompositionClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function createElementDecompositionRequest(
  source: ElementDecomposeSourceInput,
  options: ElementDecomposeRequestOptions,
): ElementDecomposeRequest {
  return {
    projectId: source.projectId,
    sourceImageId: source.sourceImageId,
    sourceVersionId: source.sourceVersionId,
    imageUrl: source.imageUrl,
    outputMode: options.outputMode ?? 'both',
    board: {
      aspectRatio: options.aspectRatio,
      background: options.background ?? 'light-gray',
      providerId: options.boardProviderId,
      modelId: options.boardModelId,
    },
    layers: {
      engine: options.engine ?? 'smart',
      providerId: options.layerProviderId,
      modelId: options.layerModelId,
      requireTransparentSubject: (options.background ?? 'light-gray') === 'transparent',
    },
  };
}

interface PublicBoardModel {
  id?: string;
  providerId?: string;
  type?: string;
  maxReferenceImages?: number;
  supportedOperations?: string[];
}

export const ELEMENT_BOARD_MODEL_UNAVAILABLE_MESSAGE = '当前账号没有可用的图片编辑模型，无法生成拆解板。请联系管理员分配图片编辑模型，或改用“可编辑图层”。';

function acceptsSourceImage(model: PublicBoardModel): boolean {
  if (model.type === 'imageEdit') return true;
  if (typeof model.maxReferenceImages === 'number') return model.maxReferenceImages > 0;
  if (Array.isArray(model.supportedOperations)) {
    return model.supportedOperations.some(item => item === 'image-to-image' || item === 'multi-reference');
  }
  return true;
}

/**
 * 拆解板需要能接收原图的图片编辑模型。生成面板里选中的模型只在它对当前账号已授权且支持图生图时沿用，
 * 否则取已授权的第一个图片编辑模型（先 imageEdit，再 image）。
 */
export async function resolveDefaultBoardTarget(
  fetcher: LayerFetchLike,
  signal?: AbortSignal,
  preferred?: { providerId?: string; modelId?: string },
): Promise<{ providerId: string; modelId: string } | null> {
  const candidates: Array<{ providerId: string; modelId: string }> = [];
  for (const type of ['imageEdit', 'image'] as const) {
    const response = await fetcher(`/api/workflow/models?type=${type}`, { method: 'GET', signal, cache: 'no-store' });
    let body: Record<string, unknown> = {};
    try {
      body = await response.json() as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!response.ok || body.success === false || !Array.isArray(body.models)) continue;
    for (const model of body.models as PublicBoardModel[]) {
      if (typeof model.id !== 'string' || typeof model.providerId !== 'string' || !acceptsSourceImage(model)) continue;
      candidates.push({ providerId: model.providerId, modelId: model.id });
    }
  }
  const match = preferred?.modelId
    ? candidates.find(item => item.modelId === preferred.modelId
      && (!preferred.providerId || item.providerId === preferred.providerId))
    : undefined;
  return match || candidates[0] || null;
}

export async function createResolvedElementDecompositionRequest(
  source: ElementDecomposeSourceInput,
  options: ElementDecomposeRequestOptions,
  runtime: { fetcher?: LayerFetchLike; signal?: AbortSignal } = {},
): Promise<ElementDecomposeRequest> {
  let resolvedOptions = options;
  let outputMode = options.outputMode ?? 'both';
  const fetcher = runtime.fetcher || fetch;

  if (outputMode !== 'layers') {
    let boardTarget: { providerId: string; modelId: string } | null = null;
    try {
      boardTarget = await resolveDefaultBoardTarget(fetcher, runtime.signal, {
        providerId: options.boardProviderId,
        modelId: options.boardModelId,
      });
    } catch (error) {
      if (runtime.signal?.aborted) throw error;
    }
    if (boardTarget) {
      resolvedOptions = { ...resolvedOptions, boardProviderId: boardTarget.providerId, boardModelId: boardTarget.modelId };
    } else if (outputMode === 'both') {
      // 没有可用的拆解板模型时只输出可编辑图层，不让整个任务因拆解板 400 而失败。
      outputMode = 'layers';
      resolvedOptions = { ...resolvedOptions, outputMode, boardProviderId: undefined, boardModelId: undefined };
    } else {
      throw new ElementDecompositionClientError('ELEMENT_BOARD_PROVIDER_REQUIRED', ELEMENT_BOARD_MODEL_UNAVAILABLE_MESSAGE, 400, false);
    }
  }

  const needsLayerTarget = outputMode !== 'board'
    && resolvedOptions.engine !== 'local'
    && (!resolvedOptions.layerProviderId || !resolvedOptions.layerModelId);
  if (!needsLayerTarget) return createElementDecompositionRequest(source, resolvedOptions);

  let target: { providerId: string; modelId: string } | null = null;
  try {
    target = await resolveDefaultLayerTarget(fetcher, runtime.signal);
  } catch (error) {
    if (runtime.signal?.aborted || resolvedOptions.engine === 'cloud') throw error;
  }
  return createElementDecompositionRequest(source, target ? {
    ...resolvedOptions,
    layerProviderId: target.providerId,
    layerModelId: target.modelId,
  } : resolvedOptions);
}

async function parseResponse(response: Response): Promise<ElementDecomposeTaskResponse> {
  let body: Record<string, unknown>;
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid response body');
    body = value as Record<string, unknown>;
  } catch {
    throw new ElementDecompositionClientError(
      'ELEMENT_RESPONSE_INVALID',
      '元素拆解服务返回了无效响应',
      response.status,
      response.status >= 500,
    );
  }

  if (!response.ok || body.success === false) {
    throw new ElementDecompositionClientError(
      typeof body.code === 'string' ? body.code : 'ELEMENT_REQUEST_FAILED',
      typeof body.message === 'string' ? body.message : '元素拆解请求失败',
      response.status,
      body.retryable === true,
    );
  }
  if (typeof body.taskId !== 'string' || typeof body.status !== 'string') {
    throw new ElementDecompositionClientError(
      'ELEMENT_RESPONSE_INVALID',
      '元素拆解响应缺少任务状态',
      response.status,
      false,
    );
  }
  return body as unknown as ElementDecomposeTaskResponse;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function submitElementDecomposition(
  request: ElementDecomposeRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ElementDecomposeTaskResponse> {
  const response = await fetch('/api/element-decompose', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(request),
  });
  return parseResponse(response);
}

export async function recoverElementDecomposition(
  projectId: string,
  signal?: AbortSignal,
): Promise<ElementDecomposeTaskResponse | null> {
  const response = await fetch(`/api/element-decompose?projectId=${encodeURIComponent(projectId)}`, {
    method: 'GET',
    signal,
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  return parseResponse(response);
}

export async function pollElementDecomposition(
  taskId: string,
  onUpdate: (task: ElementDecomposeTaskResponse) => void,
  signal?: AbortSignal,
  intervalMs = 800,
): Promise<ElementDecomposeTaskResponse> {
  let consecutiveFailures = 0;
  while (true) {
    signal?.throwIfAborted();
    let task: ElementDecomposeTaskResponse;
    try {
      const response = await fetch(`/api/element-decompose?taskId=${encodeURIComponent(taskId)}`, {
        method: 'GET',
        signal,
        cache: 'no-store',
      });
      task = await parseResponse(response);
      consecutiveFailures = 0;
    } catch (error) {
      if (signal?.aborted) throw error;
      const retryable = error instanceof ElementDecompositionClientError
        ? error.retryable
        : error instanceof TypeError;
      if (!retryable) throw error;
      consecutiveFailures += 1;
      const retryDelay = Math.min(5_000, intervalMs * (2 ** Math.min(consecutiveFailures - 1, 4)));
      await wait(retryDelay, signal);
      continue;
    }
    onUpdate(task);
    if (!['pending', 'processing'].includes(task.overallStatus)) return task;
    await wait(intervalMs, signal);
  }
}

export async function retryElementDecompositionBranch(
  taskId: string,
  branch: ElementBranch,
  signal?: AbortSignal,
): Promise<ElementDecomposeTaskResponse> {
  const response = await fetch('/api/element-decompose', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'retry', taskId, branch }),
  });
  return parseResponse(response);
}

export async function cancelElementDecomposition(
  taskId: string,
  signal?: AbortSignal,
): Promise<ElementDecomposeTaskResponse> {
  const response = await fetch(`/api/element-decompose?taskId=${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    signal,
  });
  return parseResponse(response);
}

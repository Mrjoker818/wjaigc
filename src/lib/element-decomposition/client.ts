import type {
  ElementBranchStatus,
  ElementDecomposeOutputMode,
  ElementDecomposeRequest,
} from '@/lib/element-decomposition/types';
import type { CloudTaskCreditStatus } from '@/lib/cloud-task-storage';
import type { LayerDecompositionResult, LayerUpstreamError } from '@/lib/layer-decomposition/types';
import type { LayerDocumentSource } from '@/lib/layer-documents/types';
import {
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

export async function createResolvedElementDecompositionRequest(
  source: ElementDecomposeSourceInput,
  options: ElementDecomposeRequestOptions,
  runtime: { fetcher?: LayerFetchLike; signal?: AbortSignal } = {},
): Promise<ElementDecomposeRequest> {
  const outputMode = options.outputMode ?? 'both';
  const needsLayerTarget = outputMode !== 'board'
    && options.engine !== 'local'
    && (!options.layerProviderId || !options.layerModelId);
  if (!needsLayerTarget) return createElementDecompositionRequest(source, options);

  let target: { providerId: string; modelId: string } | null = null;
  try {
    target = await resolveDefaultLayerTarget(runtime.fetcher || fetch, runtime.signal);
  } catch (error) {
    if (runtime.signal?.aborted || options.engine === 'cloud') throw error;
  }
  return createElementDecompositionRequest(source, target ? {
    ...options,
    layerProviderId: target.providerId,
    layerModelId: target.modelId,
  } : options);
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
  while (true) {
    signal?.throwIfAborted();
    const response = await fetch(`/api/element-decompose?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      signal,
      cache: 'no-store',
    });
    const task = await parseResponse(response);
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

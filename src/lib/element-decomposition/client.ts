import type {
  ElementBranchStatus,
  ElementDecomposeOutputMode,
  ElementDecomposeRequest,
} from '@/lib/element-decomposition/types';

type ElementBranch = 'board' | 'layers';

export interface ElementDecomposeBranchResponse {
  branch: ElementBranch;
  taskId: string;
  status: ElementBranchStatus;
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
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

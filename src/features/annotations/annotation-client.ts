'use client';

import type { AnnotationRegion, EditIntentBundle } from './annotation-types';

export class AnnotationClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(input: {
    code: string;
    message: string;
    retryable?: boolean;
    requestId?: string;
  }) {
    super(input.message);
    this.name = 'AnnotationClientError';
    this.code = input.code;
    this.retryable = input.retryable === true;
    this.requestId = input.requestId;
  }
}

interface ApiFailure {
  success?: false;
  code?: string;
  message?: string;
  error?: string;
  retryable?: boolean;
  requestId?: string;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function throwApiFailure(response: Response, payload: ApiFailure): never {
  throw new AnnotationClientError({
    code: payload.code || `HTTP_${response.status}`,
    message: payload.message || payload.error || `批注请求失败: HTTP ${response.status}`,
    retryable: payload.retryable,
    requestId: payload.requestId,
  });
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `annotation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface ResolveSemanticAnnotationInput {
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  sourceImageUrl?: string;
  point: { x: number; y: number };
}

export interface ResolveSemanticAnnotationResult {
  target: {
    label: string;
    confidence: number;
    region: AnnotationRegion;
  };
  requiresConfirmation: boolean;
  requestId: string;
}

export async function resolveSemanticAnnotation(
  input: ResolveSemanticAnnotationInput,
): Promise<ResolveSemanticAnnotationResult> {
  const response = await fetch('/api/annotations/resolve-target', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': createRequestId(),
    },
    body: JSON.stringify(input),
  });
  const payload = await readJson(response);
  if (!response.ok || payload.success !== true) {
    throwApiFailure(response, payload as ApiFailure);
  }
  return {
    target: payload.target as ResolveSemanticAnnotationResult['target'],
    requiresConfirmation: payload.requiresConfirmation === true,
    requestId: String(payload.requestId || ''),
  };
}

export interface ExecuteAnnotationBundleInput {
  bundle: EditIntentBundle;
  sourceImageUrl?: string;
}

export interface ExecuteAnnotationBundleResult {
  taskId: string;
  mode: string;
  requestId: string;
}

export async function executeAnnotationBundle(
  input: ExecuteAnnotationBundleInput,
  options?: { signal?: AbortSignal },
): Promise<ExecuteAnnotationBundleResult> {
  const response = await fetch('/api/annotations/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': createRequestId(),
      'x-idempotency-key': input.bundle.idempotencyKey,
    },
    body: JSON.stringify(input),
    signal: options?.signal,
  });
  const payload = await readJson(response);
  if (!response.ok || payload.success !== true || typeof payload.taskId !== 'string') {
    throwApiFailure(response, payload as ApiFailure);
  }
  return {
    taskId: payload.taskId,
    mode: typeof payload.mode === 'string' ? payload.mode : 'polling',
    requestId: String(payload.requestId || ''),
  };
}

export async function cancelAnnotationTask(taskId: string): Promise<void> {
  const response = await fetch('/api/cancel-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  if (!response.ok) {
    const payload = await readJson(response);
    throwApiFailure(response, payload as ApiFailure);
  }
}

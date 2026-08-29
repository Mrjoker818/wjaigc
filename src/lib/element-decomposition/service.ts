import { createHash, randomUUID } from 'node:crypto';

import {
  createCloudTask,
  getCloudTaskForUser,
  getCloudTaskForUserByIdempotencyKey,
  getLatestElementDecomposeParentForProject,
  updateCloudTask,
  type CloudTask,
  type CloudTaskCreditStatus,
} from '@/lib/cloud-task-storage';
import {
  cancelLayerTask,
  getLayerTaskSnapshot,
  getLayerTaskStatus,
  submitLayerDecomposition,
} from '@/lib/layer-decomposition/service';
import {
  cancelElementBoard,
  pollElementBoard,
  submitElementBoard,
} from '@/lib/element-decomposition/board-executor';
import {
  freezeElementSource,
  persistFrozenElementSource,
} from '@/lib/element-decomposition/source-snapshot';
import type {
  ElementBranchStatus,
  ElementDecomposeRequest,
} from '@/lib/element-decomposition/types';
import type { LayerUpstreamError } from '@/lib/layer-decomposition/types';

type ElementBranch = 'board' | 'layers';

export interface ElementBranchState {
  branch: ElementBranch;
  taskId: string;
  idempotencyKey: string;
  status: ElementBranchStatus;
  progress: number;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  fallbackReason?: string;
  providerError?: LayerUpstreamError;
  attempt?: number;
  previousTaskIds?: string[];
  submissionPending?: boolean;
}

export interface ElementParentState {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  overallStatus: 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'timeout';
  progress: number;
  source: { sourceImageId: string; sourceVersionId?: string; canonicalUrl: string; managedUrl: string; sha256: string; width: number; height: number; mimeType: string };
  branches: Partial<Record<ElementBranch, ElementBranchState>>;
}

export class ElementDecompositionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status = 500, retryable = false) {
    super(message);
    this.name = 'ElementDecompositionError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function requestDigest(request: ElementDecomposeRequest): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(request))).digest('hex');
}

export function makeElementBranchKey(parentKey: string, branch: ElementBranch, sourceHash: string, digest: string): string {
  return `${parentKey}:${branch}:${sourceHash}:${digest}`;
}

function terminal(status: string): status is ElementBranchStatus {
  return ['completed', 'failed', 'cancelled', 'timeout'].includes(status);
}

function mapStatus(status: string): ElementBranchStatus {
  if (status === 'pending' || status === 'queued') return 'queued';
  return (['processing', 'completed', 'failed', 'cancelled', 'timeout'].includes(status)
    ? status : 'failed') as ElementBranchStatus;
}

export function deriveElementParentState(branches: Partial<Record<ElementBranch, ElementBranchState>>): Pick<ElementParentState, 'status' | 'overallStatus' | 'progress'> {
  const values = Object.values(branches).filter(Boolean) as ElementBranchState[];
  const progress = values.length ? Math.round(values.reduce((sum, branch) => sum + branch.progress, 0) / values.length) : 0;
  if (values.length === 0) {
    return { status: 'processing', overallStatus: 'processing', progress: 0 };
  }
  if (values.some(branch => branch.status === 'processing' || branch.status === 'queued')) {
    return { status: 'processing', overallStatus: 'processing', progress };
  }
  const completed = values.filter(branch => branch.status === 'completed').length;
  const failed = values.filter(branch => branch.status === 'failed').length;
  const timedOut = values.filter(branch => branch.status === 'timeout').length;
  const cancelled = values.filter(branch => branch.status === 'cancelled').length;
  if (completed > 0 && completed < values.length) return { status: 'completed', overallStatus: 'partial', progress };
  if (completed === values.length && values.length > 0) return { status: 'completed', overallStatus: 'completed', progress: 100 };
  if (cancelled === values.length) return { status: 'cancelled', overallStatus: 'cancelled', progress };
  if (failed > 0) return { status: 'failed', overallStatus: 'failed', progress };
  if (timedOut > 0) return { status: 'timeout', overallStatus: 'timeout', progress };
  return { status: 'cancelled', overallStatus: 'cancelled', progress };
}

function resultOf(task: CloudTask): Record<string, unknown> {
  return task.result && typeof task.result === 'object' ? task.result : {};
}

function layerRequestForElement(
  request: ElementDecomposeRequest,
  imageUrl: string,
) {
  return {
    imageUrl,
    engine: request.layers.engine,
    providerId: request.layers.providerId,
    modelId: request.layers.modelId,
    requireTransparentSubject: (
      request.layers.requireTransparentSubject === true
      || request.board.background === 'transparent'
    ),
  };
}

function parentResponse(task: CloudTask): ElementParentState {
  const result = resultOf(task);
  const rawBranches = result.branches && typeof result.branches === 'object' ? result.branches as Partial<Record<ElementBranch, ElementBranchState>> : {};
  const derived = deriveElementParentState(rawBranches);
  const source = result.source as ElementParentState['source'];
  return { taskId: task.id, ...derived, source, branches: rawBranches };
}

export async function submitElementDecomposition(input: {
  userId: string;
  userRole: string;
  idempotencyKey: string;
  request: ElementDecomposeRequest;
}): Promise<ElementParentState> {
  const digest = requestDigest(input.request);
  const source = await freezeElementSource(input.request);
  const persistedSource = await persistFrozenElementSource(source);
  const parentKey = input.idempotencyKey;
  const parentId = `element_${randomUUID()}`;
  const initial: ElementParentState['source'] = {
    sourceImageId: source.sourceImageId,
    sourceVersionId: source.sourceVersionId,
    canonicalUrl: source.canonicalUrl,
    managedUrl: persistedSource.managedUrl,
    sha256: source.sha256,
    width: source.width,
    height: source.height,
    mimeType: source.mimeType,
  };
  const parentResult = { request: input.request, requestDigest: digest, source: initial, branches: {} };
  const inserted = await createCloudTask({
    id: parentId,
    userId: input.userId,
    projectId: input.request.projectId,
    type: 'element-decompose-parent',
    status: 'processing',
    progress: 0,
    result: parentResult,
    creditStatus: 'not-applicable',
    creditCost: 0,
    idempotencyKey: parentKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!inserted) {
    const existing = await getCloudTaskForUserByIdempotencyKey(input.userId, parentKey);
    if (!existing) throw new ElementDecompositionError('ELEMENT_TASK_CONFLICT', 'Element decomposition request is already being created', 409, true);
    const existingResult = resultOf(existing);
    const existingSource = existingResult.source as ElementParentState['source'] | undefined;
    if (existingResult.requestDigest !== digest || existingSource?.sha256 !== source.sha256) {
      throw new ElementDecompositionError('ELEMENT_IDEMPOTENCY_CONFLICT', 'Idempotency key is already bound to another element request or frozen source', 409);
    }
    return parentResponse(existing);
  }
  const branches: Partial<Record<ElementBranch, ElementBranchState>> = {};
  const requested: ElementBranch[] = input.request.outputMode === 'both' ? ['board', 'layers'] : [input.request.outputMode];
  for (const branch of requested) {
    const key = makeElementBranchKey(parentKey, branch, source.sha256, digest);
    try {
      if (branch === 'layers') {
        const child = await submitLayerDecomposition({
          userId: input.userId,
          userRole: input.userRole,
          idempotencyKey: key,
          request: layerRequestForElement(input.request, persistedSource.managedUrl),
        });
        branches.layers = {
          branch,
          taskId: child.taskId,
          idempotencyKey: key,
          status: mapStatus(child.status),
          progress: child.progress,
          creditStatus: child.creditStatus,
          result: child.result as Record<string, unknown> | undefined,
          fallbackReason: child.fallbackReason,
          providerError: child.providerError,
          attempt: 1,
          previousTaskIds: [],
        };
      } else {
        const child = await submitElementBoard({
          userId: input.userId,
          userRole: input.userRole,
          idempotencyKey: key,
          sourceUrl: persistedSource.managedUrl,
          sourceHash: source.sha256,
          aspectRatio: input.request.board.aspectRatio,
          background: input.request.board.background,
          providerId: input.request.board.providerId,
          modelId: input.request.board.modelId,
        });
        branches.board = { branch, taskId: child.taskId, idempotencyKey: key, status: mapStatus(child.status), progress: child.progress, result: child.result, error: child.error, attempt: 1, previousTaskIds: [] };
      }
    } catch (error) {
      branches[branch] = {
        branch,
        taskId: `${parentId}:${branch}:submission-failed`,
        idempotencyKey: key,
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
        attempt: 1,
        previousTaskIds: [],
      };
    }
  }
  const result = { ...parentResult, branches };
  const derived = deriveElementParentState(branches);
  const committed = await updateCloudTask(parentId, {
    status: derived.status,
    result: { ...result, overallStatus: derived.overallStatus },
    progress: derived.progress,
    expectedStatuses: ['processing'],
    expectedRevision: 0,
  });
  if (!committed) {
    throw new ElementDecompositionError('ELEMENT_TASK_STATE_CONFLICT', 'Element decomposition state changed before child submissions were committed', 409, true);
  }
  return parentResponse({ id: parentId, userId: input.userId, type: 'element-decompose-parent', status: 'processing', progress: 0, creditStatus: 'not-applicable', createdAt: Date.now(), updatedAt: Date.now(), result });
}

export async function findLatestElementDecompositionForProject(input: {
  userId: string;
  projectId: string;
}): Promise<ElementParentState> {
  const task = await getLatestElementDecomposeParentForProject(input.userId, input.projectId);
  if (!task) {
    throw new ElementDecompositionError(
      'ELEMENT_TASK_NOT_FOUND',
      'Element decomposition parent task was not found',
      404,
    );
  }
  return parentResponse(task);
}

export async function getElementDecomposition(input: { taskId: string; userId: string; userRole: string }): Promise<ElementParentState> {
  const task = await getCloudTaskForUser(input.taskId, input.userId);
  if (!task || task.type !== 'element-decompose-parent') throw new ElementDecompositionError('ELEMENT_TASK_NOT_FOUND', 'Element decomposition parent task was not found', 404);
  const result = resultOf(task);
  const branches = { ...(result.branches as Partial<Record<ElementBranch, ElementBranchState>> || {}) };
  let branchesChanged = false;
  for (const branch of Object.keys(branches) as ElementBranch[]) {
    const current = branches[branch];
    if (!current || current.submissionPending) continue;
    const needsLegacyLayerHydration = branch === 'layers'
      && terminal(current.status)
      && current.creditStatus === undefined;
    if (terminal(current.status) && !needsLegacyLayerHydration) continue;
    if (branch === 'layers') {
      let child: Awaited<ReturnType<typeof getLayerTaskStatus>>;
      try {
        child = needsLegacyLayerHydration
          ? await getLayerTaskSnapshot({ taskId: current.taskId, userId: input.userId, userRole: input.userRole })
          : await getLayerTaskStatus({ taskId: current.taskId, userId: input.userId, userRole: input.userRole });
      } catch (error) {
        if (needsLegacyLayerHydration) continue;
        throw error;
      }
      if (needsLegacyLayerHydration && !terminal(mapStatus(child.status))) continue;
      branches[branch] = {
        ...current,
        status: mapStatus(child.status),
        progress: child.progress,
        creditStatus: child.creditStatus,
        result: child.result as Record<string, unknown> | undefined,
        error: child.error?.message,
        fallbackReason: child.fallbackReason,
        providerError: child.providerError,
      };
      branchesChanged = true;
    } else {
      const child = await pollElementBoard({ taskId: current.taskId, userId: input.userId, userRole: input.userRole });
      branches[branch] = { ...current, status: mapStatus(child.status), progress: child.progress, result: child.result, error: child.error };
      branchesChanged = true;
    }
  }
  if (!branchesChanged) return parentResponse(task);
  const derived = deriveElementParentState(branches);
  if (terminal(task.status)) {
    return parentResponse({
      ...task,
      progress: derived.progress,
      result: { ...result, branches, overallStatus: derived.overallStatus },
    });
  }
  const committed = await updateCloudTask(task.id, {
    ...(derived.status === task.status ? {} : { status: derived.status }),
    progress: derived.progress,
    result: { ...result, branches, overallStatus: derived.overallStatus },
    expectedStatuses: [task.status],
    expectedRevision: task.revision || 0,
  });
  if (!committed) {
    const current = await getCloudTaskForUser(task.id, input.userId);
    if (current && (current.revision || 0) !== (task.revision || 0)) return parentResponse(current);
    throw new ElementDecompositionError('ELEMENT_TASK_STATE_CONFLICT', 'Element decomposition state changed before polling results were committed', 409, true);
  }
  const fresh = await getCloudTaskForUser(task.id, input.userId);
  return parentResponse(fresh || { ...task, result: { ...result, branches }, status: derived.status, progress: derived.progress });
}

export async function retryElementBranch(input: { taskId: string; branch: ElementBranch; userId: string; userRole: string }): Promise<ElementParentState> {
  const task = await getCloudTaskForUser(input.taskId, input.userId);
  if (!task || task.type !== 'element-decompose-parent') throw new ElementDecompositionError('ELEMENT_TASK_NOT_FOUND', 'Element decomposition parent task was not found', 404);
  const result = resultOf(task);
  const branch = (result.branches as Partial<Record<ElementBranch, ElementBranchState>>)?.[input.branch];
  if (!branch) throw new ElementDecompositionError('ELEMENT_BRANCH_NOT_FOUND', 'Element decomposition branch was not requested', 404);
  if (branch.status === 'completed') return parentResponse(task);
  if (!terminal(branch.status)) throw new ElementDecompositionError('ELEMENT_BRANCH_ACTIVE', 'Element decomposition branch is still active', 409, true);
  const request = result.request as ElementDecomposeRequest;
  const source = result.source as ElementParentState['source'];
  const attempt = (branch.attempt || 1) + 1;
  const attemptKey = `${branch.idempotencyKey.replace(/:attempt:\d+$/, '')}:attempt:${attempt}`;
  const reserved: ElementBranchState = {
    ...branch,
    idempotencyKey: attemptKey,
    status: 'queued',
    progress: 0,
    result: undefined,
    error: undefined,
    creditStatus: undefined,
    fallbackReason: undefined,
    providerError: undefined,
    attempt,
    previousTaskIds: [...(branch.previousTaskIds || []), branch.taskId],
    submissionPending: true,
  };
  const reservedBranches = {
    ...(result.branches as Partial<Record<ElementBranch, ElementBranchState>>),
    [input.branch]: reserved,
  };
  const claimed = await updateCloudTask(task.id, {
    status: 'processing',
    progress: deriveElementParentState(reservedBranches).progress,
    result: { ...result, branches: reservedBranches, overallStatus: 'processing' },
    expectedStatuses: ['completed', 'failed', 'cancelled', 'timeout'],
    expectedRevision: task.revision || 0,
  });
  if (!claimed) {
    const current = await getCloudTaskForUser(task.id, input.userId);
    if (!current) throw new ElementDecompositionError('ELEMENT_TASK_NOT_FOUND', 'Element decomposition parent task was not found', 404);
    return parentResponse(current);
  }
  let updated: ElementBranchState;
  try {
    if (input.branch === 'layers') {
      const child = await submitLayerDecomposition({
        userId: input.userId,
        userRole: input.userRole,
        idempotencyKey: attemptKey,
        request: layerRequestForElement(request, source.managedUrl),
      });
      updated = {
        ...reserved,
        taskId: child.taskId,
        status: mapStatus(child.status),
        progress: child.progress,
        creditStatus: child.creditStatus,
        result: child.result as Record<string, unknown> | undefined,
        fallbackReason: child.fallbackReason,
        providerError: child.providerError,
        submissionPending: false,
      };
    } else {
      const child = await submitElementBoard({ userId: input.userId, userRole: input.userRole, idempotencyKey: attemptKey, sourceUrl: source.managedUrl, sourceHash: source.sha256, aspectRatio: request.board.aspectRatio, background: request.board.background, providerId: request.board.providerId, modelId: request.board.modelId });
      updated = { ...reserved, taskId: child.taskId, status: mapStatus(child.status), progress: child.progress, result: child.result, error: child.error, submissionPending: false };
    }
  } catch (error) {
    const failed: ElementBranchState = {
      ...reserved,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      submissionPending: false,
    };
    const failedBranches = { ...reservedBranches, [input.branch]: failed };
    const failedParent = deriveElementParentState(failedBranches);
    await updateCloudTask(task.id, {
      status: failedParent.status,
      progress: failedParent.progress,
      result: { ...result, branches: failedBranches, overallStatus: failedParent.overallStatus },
      expectedStatuses: ['processing'],
      expectedRevision: (task.revision || 0) + 1,
    });
    throw error;
  }
  const branches = { ...reservedBranches, [input.branch]: updated };
  const committed = await updateCloudTask(task.id, {
    status: 'processing',
    progress: deriveElementParentState(branches).progress,
    result: { ...result, branches, overallStatus: 'processing' },
    expectedStatuses: ['processing'],
    expectedRevision: (task.revision || 0) + 1,
  });
  if (!committed) {
    if (input.branch === 'layers') {
      await cancelLayerTask({ taskId: updated.taskId, userId: input.userId, userRole: input.userRole });
    } else {
      await cancelElementBoard({ taskId: updated.taskId, userId: input.userId, userRole: input.userRole });
    }
    throw new ElementDecompositionError('ELEMENT_TASK_STATE_CONFLICT', 'Element decomposition state changed before retry was committed', 409, true);
  }
  return getElementDecomposition(input);
}

export async function cancelElementDecomposition(input: { taskId: string; userId: string; userRole: string }): Promise<ElementParentState> {
  const task = await getCloudTaskForUser(input.taskId, input.userId);
  if (!task || task.type !== 'element-decompose-parent') throw new ElementDecompositionError('ELEMENT_TASK_NOT_FOUND', 'Element decomposition parent task was not found', 404);
  const result = resultOf(task);
  const branches = { ...(result.branches as Partial<Record<ElementBranch, ElementBranchState>> || {}) };
  if (branches.layers && !terminal(branches.layers.status)) {
    await cancelLayerTask({ taskId: branches.layers.taskId, userId: input.userId, userRole: input.userRole });
  }
  if (branches.board && !terminal(branches.board.status)) {
    await cancelElementBoard({ taskId: branches.board.taskId, userId: input.userId, userRole: input.userRole });
  }
  for (const branch of Object.values(branches)) if (branch && !terminal(branch.status)) branch.status = 'cancelled';
  const derived = deriveElementParentState(branches);
  const committed = await updateCloudTask(task.id, {
    status: derived.status,
    progress: derived.progress,
    result: { ...result, branches, overallStatus: derived.overallStatus },
    expectedStatuses: ['processing'],
    expectedRevision: task.revision || 0,
  });
  if (!committed) {
    throw new ElementDecompositionError('ELEMENT_TASK_STATE_CONFLICT', 'Element decomposition state changed before cancellation was committed', 409, true);
  }
  const fresh = await getCloudTaskForUser(task.id, input.userId);
  return parentResponse(fresh || task);
}

import { buildGenerationBatch } from '@/lib/generation-batch';
import {
  isTerminalTaskStatus,
  normalizeDurableTaskStatus,
  type DurableTaskStatus,
  type UnifiedTaskError,
} from '@/lib/task-core/task-state';

export interface CanonicalGenerationSlot {
  batchId: string;
  slotId: string;
  slotIndex: number;
  taskId: string;
  status: DurableTaskStatus;
  result?: Record<string, unknown>;
  error?: UnifiedTaskError;
}

export interface DurableGenerationBatch {
  batchId: string;
  requestedCount: 1 | 2 | 3 | 4;
  slots: CanonicalGenerationSlot[];
}

interface CreateDurableGenerationBatchInput {
  batchId: string;
  requestedCount: number;
  createTaskId: (slotIndex: number) => string;
}

interface ProjectCanonicalGenerationSlotInput {
  taskId: string;
  status: string;
  result?: Record<string, unknown>;
  error?: UnifiedTaskError;
}

interface LegacyGenerationTaskEventEnvelope {
  taskId: string;
  task: {
    status: string;
    result?: unknown;
    error?: string;
  };
}

const INTERNAL_RESULT_FIELDS = new Set([
  'submissionPayload',
  'apiKey',
  'apiBaseUrl',
  'advancedParams',
]);

function requireIdentity(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}

function sanitizeSlotResult(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!result) return undefined;

  const safeResult = Object.fromEntries(
    Object.entries(result).filter(([key, value]) => (
      !INTERNAL_RESULT_FIELDS.has(key) && value !== undefined
    )),
  );

  return Object.keys(safeResult).length > 0 ? safeResult : undefined;
}

export function createDurableGenerationBatch(
  input: CreateDurableGenerationBatchInput,
): DurableGenerationBatch {
  if (!Number.isFinite(input.requestedCount)) {
    throw new Error('requestedCount must be a finite number');
  }

  const batchId = requireIdentity(input.batchId, 'batchId');
  const compatibilityBatch = buildGenerationBatch(batchId, input.requestedCount);
  const taskIds = new Set<string>();

  const slots = compatibilityBatch.slots.map((slot): CanonicalGenerationSlot => {
    const taskId = requireIdentity(input.createTaskId(slot.index), 'taskId');
    if (taskIds.has(taskId)) {
      throw new Error(`createTaskId returned a duplicate taskId: ${taskId}`);
    }
    taskIds.add(taskId);

    return {
      batchId,
      slotId: slot.slotId,
      slotIndex: slot.index,
      taskId,
      status: 'created',
    };
  });

  return {
    batchId,
    requestedCount: slots.length as 1 | 2 | 3 | 4,
    slots,
  };
}

export function projectCanonicalGenerationSlot(
  input: ProjectCanonicalGenerationSlotInput,
): CanonicalGenerationSlot | null {
  const submissionPayload = input.result?.submissionPayload;
  if (!submissionPayload || typeof submissionPayload !== 'object') return null;

  const metadata = submissionPayload as Record<string, unknown>;
  if (
    typeof metadata.batchId !== 'string'
    || typeof metadata.slotId !== 'string'
    || typeof metadata.slotIndex !== 'number'
    || !Number.isInteger(metadata.slotIndex)
    || metadata.slotIndex < 0
  ) {
    return null;
  }

  return {
    batchId: requireIdentity(metadata.batchId, 'batchId'),
    slotId: requireIdentity(metadata.slotId, 'slotId'),
    slotIndex: metadata.slotIndex,
    taskId: requireIdentity(input.taskId, 'taskId'),
    status: normalizeDurableTaskStatus(input.status),
    ...(sanitizeSlotResult(input.result)
      ? { result: sanitizeSlotResult(input.result) }
      : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

export function attachCanonicalGenerationSlotToEvent<
  T extends LegacyGenerationTaskEventEnvelope,
>(event: T): T | (T & CanonicalGenerationSlot) {
  const taskResult = event.task.result && typeof event.task.result === 'object'
    ? event.task.result as Record<string, unknown>
    : undefined;
  const canonical = projectCanonicalGenerationSlot({
    taskId: event.taskId,
    status: event.task.status,
    result: taskResult,
    ...(event.task.error
      ? { error: { code: 'TASK_FAILED', message: event.task.error } }
      : {}),
  });

  return canonical ? { ...event, ...canonical } : event;
}

export function reconcileGenerationBatch(
  batch: DurableGenerationBatch,
  event: CanonicalGenerationSlot,
): DurableGenerationBatch {
  if (event.batchId !== batch.batchId) return batch;

  const slotIndex = batch.slots.findIndex((slot) => slot.slotId === event.slotId);
  if (slotIndex < 0) return batch;

  const current = batch.slots[slotIndex];
  if (
    current.slotIndex !== event.slotIndex
    || current.taskId !== event.taskId
    || isTerminalTaskStatus(current.status)
  ) {
    return batch;
  }

  const slots = [...batch.slots];
  slots[slotIndex] = {
    ...current,
    status: event.status,
    ...(event.result ? { result: event.result } : {}),
    ...(event.error ? { error: event.error } : {}),
  };

  return {
    ...batch,
    slots,
  };
}

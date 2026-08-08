import { buildGenerationBatch } from '@/lib/generation-batch';
import {
  isDurableTaskStatus,
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

export interface GenerationSubmitSlot {
  taskId: string;
  slotIndex: number;
  slotId?: string;
  batchId?: string;
  status: DurableTaskStatus;
  result?: Record<string, unknown>;
  error?: UnifiedTaskError;
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
    Object.entries(result).flatMap(([key, value]) => {
      if (INTERNAL_RESULT_FIELDS.has(key) || value === undefined) return [];
      if (Array.isArray(value)) {
        return [[key, value.map((item) => (
          item && typeof item === 'object'
            ? sanitizeSlotResult(item as Record<string, unknown>)
            : item
        ))]];
      }
      if (value && typeof value === 'object') {
        return [[key, sanitizeSlotResult(value as Record<string, unknown>) ?? {}]];
      }
      return [[key, value]];
    }),
  );

  return Object.keys(safeResult).length > 0 ? safeResult : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readSlotIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

export function normalizeGenerationSubmitSlots(
  response: {
    batchId?: unknown;
    slots?: unknown;
    taskId?: unknown;
    taskIds?: unknown;
  },
): GenerationSubmitSlot[] {
  const responseBatchId = readNonEmptyString(response.batchId);
  const normalizedSlots = Array.isArray(response.slots)
    ? response.slots.flatMap((value, index): GenerationSubmitSlot[] => {
      if (!value || typeof value !== 'object') return [];
      const slot = value as Record<string, unknown>;
      const taskId = readNonEmptyString(slot.taskId);
      if (!taskId) return [];

      const status = readNonEmptyString(slot.status);
      const slotBatchId = readNonEmptyString(slot.batchId);
      const result = slot.result && typeof slot.result === 'object'
        ? sanitizeSlotResult(slot.result as Record<string, unknown>)
        : undefined;
      const error = slot.error && typeof slot.error === 'object'
        ? slot.error as UnifiedTaskError
        : undefined;
      const normalizedStatus = !status || status === 'pending'
        ? 'submitting'
        : (isDurableTaskStatus(status) ? status : 'submitting');
      return [{
        taskId,
        slotIndex: readSlotIndex(slot.slotIndex, index),
        ...(readNonEmptyString(slot.slotId) ? { slotId: readNonEmptyString(slot.slotId) } : {}),
        ...(slotBatchId || responseBatchId
          ? { batchId: slotBatchId || responseBatchId }
          : {}),
        status: normalizedStatus,
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
      }];
    })
    : [];

  const legacyTaskIds = Array.isArray(response.taskIds)
    ? response.taskIds.flatMap((taskId) => {
      const normalized = readNonEmptyString(taskId);
      return normalized ? [normalized] : [];
    })
    : [];
  const singleTaskId = readNonEmptyString(response.taskId);
  const fallbackTaskIds = legacyTaskIds.length > 0
    ? legacyTaskIds
    : (singleTaskId ? [singleTaskId] : []);
  const createFallbackSlots = (taskIds: string[]): GenerationSubmitSlot[] => taskIds.map(
    (taskId, slotIndex) => ({
      taskId,
      slotIndex,
      ...(responseBatchId ? { batchId: responseBatchId } : {}),
      status: 'submitting' as const,
    }),
  );

  const expectedCount = Math.max(normalizedSlots.length, fallbackTaskIds.length);
  const seenCanonicalTaskIds = new Set<string>();
  const seenCanonicalSlotIds = new Set<string>();
  const seenCanonicalIndexes = new Set<number>();
  const canonicalSlotsAreValid = normalizedSlots.length > 0 && normalizedSlots.every((slot) => {
    const hasConflictingBatch = Boolean(
      responseBatchId
      && slot.batchId
      && slot.batchId !== responseBatchId,
    );
    const hasDuplicateTaskId = seenCanonicalTaskIds.has(slot.taskId);
    const hasDuplicateSlotId = Boolean(slot.slotId && seenCanonicalSlotIds.has(slot.slotId));
    const hasDuplicateIndex = seenCanonicalIndexes.has(slot.slotIndex);
    const hasOutOfRangeIndex = slot.slotIndex >= expectedCount;

    seenCanonicalTaskIds.add(slot.taskId);
    if (slot.slotId) seenCanonicalSlotIds.add(slot.slotId);
    seenCanonicalIndexes.add(slot.slotIndex);

    return !hasConflictingBatch
      && !hasDuplicateTaskId
      && !hasDuplicateSlotId
      && !hasDuplicateIndex
      && !hasOutOfRangeIndex;
  });

  const canonicalFallbackTaskIds = normalizedSlots.reduce<string[]>((taskIds, slot) => {
    if (!taskIds.includes(slot.taskId)) taskIds.push(slot.taskId);
    return taskIds;
  }, []);
  const slots = canonicalSlotsAreValid
    ? normalizedSlots
    : createFallbackSlots(
      fallbackTaskIds.length > 0 ? fallbackTaskIds : canonicalFallbackTaskIds,
    );

  const seenTaskIds = new Set<string>();
  return slots
    .filter((slot) => {
      if (seenTaskIds.has(slot.taskId)) return false;
      seenTaskIds.add(slot.taskId);
      return true;
    })
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

export function resolveGenerationSlotIndex(
  submittedSlot: Pick<GenerationSubmitSlot, 'taskId' | 'slotId' | 'slotIndex'>,
  _serverPayload: Record<string, unknown>,
): number {
  return submittedSlot.slotIndex;
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

  const safeResult = sanitizeSlotResult(input.result);
  return {
    batchId: requireIdentity(metadata.batchId, 'batchId'),
    slotId: requireIdentity(metadata.slotId, 'slotId'),
    slotIndex: metadata.slotIndex,
    taskId: requireIdentity(input.taskId, 'taskId'),
    status: normalizeDurableTaskStatus(input.status),
    ...(safeResult ? { result: safeResult } : {}),
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

  const taskWithoutResult = { ...event.task };
  delete taskWithoutResult.result;
  const safeTaskResult = sanitizeSlotResult(taskResult);
  const safeEvent = {
    ...event,
    task: {
      ...taskWithoutResult,
      ...(safeTaskResult ? { result: safeTaskResult } : {}),
    },
  } as T;

  return canonical ? { ...safeEvent, ...canonical } : safeEvent;
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

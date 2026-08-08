import { isTerminalGenerationStatus } from '@/lib/generation-batch';
import type { GenerationSubmitSlot } from '@/lib/task-core/generation-batch';

interface ProcessingPlaceholder {
  id?: string;
  isProcessingPlaceholder?: boolean;
  processing?: {
    status?: string;
    progress?: number;
    label?: string;
    taskId?: string;
    batchId?: string;
    slotId?: string;
    slotIndex?: number;
  };
}

export function shouldPersistProcessingPlaceholder(image: ProcessingPlaceholder): boolean {
  if (!image.isProcessingPlaceholder) return false;
  return image.processing?.status !== 'failed' && image.processing?.status !== 'cancelled';
}

/**
 * A submitOnly response arrives after its visual placeholders have been added.
 * Persist the server task IDs immediately so a later project reload can resume
 * polling instead of leaving an anonymous "submitting" frame on the canvas.
 */
export function applyTaskIdsToProcessingPlaceholders<T extends ProcessingPlaceholder>(
  images: readonly T[],
  placeholderIds: readonly string[],
  taskIds: readonly string[],
): T[] {
  const taskByPlaceholderId = new Map(
    placeholderIds.map((placeholderId, index) => [placeholderId, taskIds[index]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );

  return images.map((image) => {
    const taskId = image.id ? taskByPlaceholderId.get(image.id) : undefined;
    if (!image.isProcessingPlaceholder || !taskId || !image.processing) return image;
    if (isTerminalGenerationStatus(image.processing.status)) return image;

    return {
      ...image,
      processing: {
        ...image.processing,
        taskId,
        status: 'processing',
        progress: Math.max(image.processing.progress || 0, 10),
        label: '已提交，等待生成',
      },
    };
  });
}

/**
 * Bind submitOnly child tasks by their durable slot identity. Response order is
 * deliberately ignored because providers can acknowledge or complete slots in
 * any order. placeholderIds is only used to seed metadata onto newly-created
 * legacy placeholders that do not have a slot identity yet.
 */
export function applyGenerationSlotsToProcessingPlaceholders<T extends ProcessingPlaceholder>(
  images: readonly T[],
  slots: readonly GenerationSubmitSlot[],
  placeholderIds: readonly string[] = [],
): T[] {
  const slotsById = new Map(
    slots.flatMap((slot) => slot.slotId ? [[slot.slotId, slot] as const] : []),
  );
  const slotsByIndex = new Map(slots.map((slot) => [slot.slotIndex, slot]));
  const placeholderIndex = new Map(
    placeholderIds.map((placeholderId, index) => [placeholderId, index] as const),
  );

  return images.map((image) => {
    if (!image.isProcessingPlaceholder || !image.processing) return image;
    if (isTerminalGenerationStatus(image.processing.status)) return image;

    const persistedSlot = image.processing.slotId
      ? slotsById.get(image.processing.slotId)
      : undefined;
    const persistedIndex = typeof image.processing.slotIndex === 'number'
      ? image.processing.slotIndex
      : (image.id ? placeholderIndex.get(image.id) : undefined);
    const slot = persistedSlot
      ?? (typeof persistedIndex === 'number' ? slotsByIndex.get(persistedIndex) : undefined);

    if (!slot) return image;

    const isCompleted = slot.status === 'completed';
    const isTerminal = isTerminalGenerationStatus(slot.status);

    return {
      ...image,
      processing: {
        ...image.processing,
        batchId: slot.batchId,
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        taskId: slot.taskId,
        status: slot.status,
        progress: isCompleted
          ? 100
          : (isTerminal ? image.processing.progress || 0 : Math.max(image.processing.progress || 0, 10)),
        label: '已提交，等待生成',
      },
    };
  });
}

import { isTerminalGenerationStatus } from '@/lib/generation-batch';

interface ProcessingPlaceholder {
  id?: string;
  isProcessingPlaceholder?: boolean;
  processing?: {
    status?: string;
    progress?: number;
    label?: string;
    taskId?: string;
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

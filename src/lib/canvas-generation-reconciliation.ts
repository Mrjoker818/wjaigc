interface PositionedCanvasItem {
  id: string;
  x: number;
  y: number;
}

interface ReconcileCompletedGenerationSlotOptions<T extends PositionedCanvasItem> {
  placeholderId: string;
  result: T;
  fallbackPosition?: Pick<PositionedCanvasItem, 'x' | 'y'>;
}

/**
 * Reconciles a completed generation slot without duplicating results that were
 * already rendered by the per-task polling path.
 */
export function reconcileCompletedGenerationSlot<T extends PositionedCanvasItem>(
  images: readonly T[],
  {
    placeholderId,
    result,
    fallbackPosition,
  }: ReconcileCompletedGenerationSlotOptions<T>,
): T[] {
  if (images.some((image) => image.id === result.id)) {
    return [...images];
  }

  const placeholderIndex = images.findIndex((image) => image.id === placeholderId);
  if (placeholderIndex >= 0) {
    return images.map((image, index) => (
      index === placeholderIndex
        ? { ...result, x: image.x, y: image.y }
        : image
    ));
  }

  return [
    ...images,
    {
      ...result,
      x: fallbackPosition?.x ?? result.x,
      y: fallbackPosition?.y ?? result.y,
    },
  ];
}

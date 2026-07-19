export interface ImageDimensions {
  width?: number;
  height?: number;
}

export function getImageDimensionValidationError(
  dimensions: ImageDimensions,
  maximumEdge: number,
): string | null {
  const longestEdge = Math.max(dimensions.width || 0, dimensions.height || 0);
  if (!longestEdge) return 'Image dimensions are missing';
  if (longestEdge > maximumEdge) {
    return `Image dimensions exceed the ${maximumEdge}px maximum edge`;
  }
  return null;
}

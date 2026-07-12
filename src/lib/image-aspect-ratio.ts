const EDIT_SUPPORTED_RATIOS = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2', '1:2', '2:1',
] as const;

/** Select a ratio that the image-edit API can translate to a concrete output size. */
export function closestSupportedImageAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '1:1';

  const target = width / height;
  let bestRatio = '1:1';
  let bestDifference = Infinity;

  for (const ratio of EDIT_SUPPORTED_RATIOS) {
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
    const difference = Math.abs(Math.log(target) - Math.log(ratioWidth / ratioHeight));
    if (difference < bestDifference) {
      bestDifference = difference;
      bestRatio = ratio;
    }
  }

  return bestRatio;
}

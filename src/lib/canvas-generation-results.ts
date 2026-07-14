export interface CanvasGenerationFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Builds one complete image-list update for a generation request. Keeping this
 * atomic prevents a second update based on an old ref from restoring the
 * processing placeholder and discarding completed images.
 */
export function applyCanvasGenerationResults<T extends CanvasGenerationFrame>(
  images: readonly T[],
  frameId: string | null | undefined,
  urls: readonly string[],
  replaceFrame: (frame: T, url: string) => T,
  createAdditional: (frame: T | undefined, url: string, index: number) => T,
): T[] {
  if (urls.length === 0) return [...images];

  const frame = frameId ? images.find(image => image.id === frameId) : undefined;
  const nextImages = frame
    ? images.map(image => image.id === frame.id ? replaceFrame(image, urls[0]) : image)
    : [...images];
  const completedFrame = frame ? nextImages.find(image => image.id === frame.id) : undefined;
  const firstAdditionalIndex = completedFrame ? 1 : 0;

  return [
    ...nextImages,
    ...urls.slice(firstAdditionalIndex).map((url, index) => createAdditional(completedFrame, url, index)),
  ];
}

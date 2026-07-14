export interface CanvasGenerationFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function applyCanvasGenerationResults<T extends CanvasGenerationFrame>(
  images: readonly T[], frameId: string | null | undefined, urls: readonly string[],
  replaceFrame: (frame: T, url: string) => T,
  createAdditional: (frame: T | undefined, url: string, index: number) => T,
): T[] {
  if (urls.length === 0) return [...images];
  const frame = frameId ? images.find(image => image.id === frameId) : undefined;
  const nextImages = frame ? images.map(image => image.id === frame.id ? replaceFrame(image, urls[0]) : image) : [...images];
  const completedFrame = frame ? nextImages.find(image => image.id === frame.id) : undefined;
  return [...nextImages, ...urls.slice(completedFrame ? 1 : 0).map((url, index) => createAdditional(completedFrame, url, index))];
}

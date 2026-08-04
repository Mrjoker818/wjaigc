import type { NormalizedPoint } from './types';

export interface PreviewSize { width: number; height: number; }
export interface PreviewRect extends PreviewSize { left: number; top: number; }

export function getContainedImageRect(container: PreviewSize, image: PreviewSize): PreviewRect {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { left: (container.width - width) / 2, top: (container.height - height) / 2, width, height };
}

export function clientPointToImagePoint(
  client: { x: number; y: number },
  container: PreviewRect,
  image: PreviewSize,
  zoom: number,
  offset: { x: number; y: number },
): NormalizedPoint | null {
  const contained = getContainedImageRect(container, image);
  if (contained.width === 0 || contained.height === 0 || zoom <= 0) return null;
  const localX = (client.x - container.left - offset.x) / zoom;
  const localY = (client.y - container.top - offset.y) / zoom;
  const x = (localX - contained.left) / contained.width;
  const y = (localY - contained.top) / contained.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

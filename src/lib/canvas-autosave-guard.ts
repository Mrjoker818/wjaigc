type CanvasHydrationImage = {
  id: string;
  url: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  zIndex?: number;
};

export interface CanvasHydrationGuard {
  projectId: string;
  signature: string;
}

function hydrationSignature(images: CanvasHydrationImage[]): string {
  return JSON.stringify(images.map(image => ({
    id: image.id,
    url: image.url,
    x: image.x ?? 0,
    y: image.y ?? 0,
    width: image.width ?? 0,
    height: image.height ?? 0,
    rotation: image.rotation ?? 0,
    zIndex: image.zIndex ?? 0,
  })));
}

export function createCanvasHydrationGuard(
  projectId: string,
  images: CanvasHydrationImage[],
): CanvasHydrationGuard {
  return { projectId, signature: hydrationSignature(images) };
}

export function shouldConsumeCanvasHydrationGuard(
  guard: CanvasHydrationGuard | null,
  projectId: string,
  images: CanvasHydrationImage[],
): boolean {
  return guard?.projectId === projectId && guard.signature === hydrationSignature(images);
}

export function consumeCanvasHydrationGuard(
  guard: CanvasHydrationGuard | null,
  projectId: string,
  images: CanvasHydrationImage[],
): { suppress: boolean; nextGuard: CanvasHydrationGuard | null } {
  if (!guard) return { suppress: false, nextGuard: null };
  if (guard.projectId !== projectId) return { suppress: false, nextGuard: guard };
  return {
    suppress: guard.signature === hydrationSignature(images),
    nextGuard: null,
  };
}

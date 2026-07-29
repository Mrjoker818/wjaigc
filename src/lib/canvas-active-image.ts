interface CanvasImageIdentity {
  id: string;
}

export function resolveActiveCanvasImage<T extends CanvasImageIdentity>(
  images: readonly T[],
  selectedImage: T | null,
  editImageId: string | null,
): T | null {
  if (selectedImage) {
    return selectedImage;
  }

  if (!editImageId) {
    return null;
  }

  return images.find(image => image.id === editImageId) ?? null;
}

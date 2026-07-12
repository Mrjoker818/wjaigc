interface ProcessingPlaceholder {
  isProcessingPlaceholder?: boolean;
  processing?: { status?: string };
}

export function shouldPersistProcessingPlaceholder(image: ProcessingPlaceholder): boolean {
  if (!image.isProcessingPlaceholder) return false;
  return image.processing?.status !== 'failed' && image.processing?.status !== 'cancelled';
}

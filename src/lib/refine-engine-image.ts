export interface RefineEngineImageCandidate { url?: string; }

export function resolveRefineEngineInitialImageUrl(
  selectedCanvasImage?: RefineEngineImageCandidate | null,
  selectedImage?: RefineEngineImageCandidate | null,
): string {
  return selectedCanvasImage?.url || selectedImage?.url || '';
}

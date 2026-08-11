import type { CanvasImage } from '@/lib/user-types';

export type CanvasMediaRenderDecision = 'broken-media' | 'image' | 'none';
export type CanvasMediaFailureAction = 'fallback-original' | 'mark-missing' | 'legacy-fallback' | 'ignore';

type CanvasMediaImage = Pick<
  CanvasImage,
  'id' | 'url' | 'mediaAvailability' | 'assetId' | 'assetVersionId'
>;

export function getCanvasMediaRenderDecision(
  image: CanvasMediaImage,
): CanvasMediaRenderDecision {
  if (image.mediaAvailability === 'missing' || image.url.length === 0) {
    return 'broken-media';
  }
  return image.url ? 'image' : 'none';
}

function getCanvasMediaFailureAction(
  image: CanvasMediaImage,
  state: { failedSource: 'thumbnail' | 'original'; legacyRetryAttempted: boolean },
): CanvasMediaFailureAction {
  if (state.failedSource === 'thumbnail') return 'fallback-original';
  if (
    image.assetId
    || image.assetVersionId
    || image.mediaAvailability === 'missing'
    || image.url.startsWith('blob:')
    || image.url.length === 0
  ) {
    return 'mark-missing';
  }
  return state.legacyRetryAttempted ? 'ignore' : 'legacy-fallback';
}

export function handleCanvasMediaElementFailure(input: {
  image: CanvasMediaImage;
  element: { src: string; dataset: Record<string, string | undefined> };
  markMissing: (imageId: string, errorCode: string) => void;
}): CanvasMediaFailureAction {
  const action = getCanvasMediaFailureAction(input.image, {
    failedSource: input.element.dataset.canvasMediaSource === 'thumbnail' ? 'thumbnail' : 'original',
    legacyRetryAttempted: input.element.dataset.retried === '1',
  });
  if (action === 'fallback-original') {
    input.element.dataset.canvasMediaSource = 'original';
    input.element.src = input.image.url;
  } else if (action === 'mark-missing') {
    input.markMissing(input.image.id, 'MEDIA_LOAD_FAILED');
  }
  return action;
}

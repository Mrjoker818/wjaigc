export interface ImageToolbarPositionInput {
  image: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zoom: number;
  offset: { x: number; y: number };
  toolbar: { width: number; height: number };
  viewport: { width: number; height: number };
  occupiedRight?: number;
  margin?: number;
  gap?: number;
}

export interface ImageToolbarPosition {
  left: number;
  top: number;
  transform: 'translate(0, -100%)' | 'translate(-50%, -100%)' | 'translate(-100%, -100%)' | 'translate(0, 0)' | 'translate(-50%, 0)' | 'translate(-100%, 0)';
}

export function getConstrainedImageToolbarPosition({
  image,
  zoom,
  offset,
  toolbar,
  viewport,
  margin = 16,
  gap = 8,
  occupiedRight = 0,
}: ImageToolbarPositionInput): ImageToolbarPosition {
  const safeMargin = Math.max(0, margin);
  const screenX = image.x * zoom + offset.x;
  const screenY = image.y * zoom + offset.y;
  const screenWidth = image.width * zoom;
  const screenHeight = image.height * zoom;
  const preferredLeft = screenX + screenWidth / 2;
  const availableRight = Math.max(safeMargin, viewport.width - Math.max(0, occupiedRight) - safeMargin);
  const effectiveToolbarWidth = Math.min(
    Math.max(0, toolbar.width),
    Math.max(0, availableRight - safeMargin),
  );
  const halfWidth = effectiveToolbarWidth / 2;

  let left = preferredLeft;
  let horizontalTransform: 'translate(0' | 'translate(-50%' | 'translate(-100%';
  if (preferredLeft - halfWidth < safeMargin) {
    left = safeMargin;
    horizontalTransform = 'translate(0';
  } else if (preferredLeft + halfWidth > availableRight) {
    left = availableRight;
    horizontalTransform = 'translate(-100%';
  } else {
    horizontalTransform = 'translate(-50%';
  }

  const aboveTop = screenY - gap;
  const shouldPlaceBelow = aboveTop - toolbar.height < safeMargin;
  const top = shouldPlaceBelow ? screenY + screenHeight + gap : aboveTop;
  const verticalTransform = shouldPlaceBelow ? '0)' : '-100%)';

  return {
    left: Math.round(left),
    top: Math.round(top),
    transform: `${horizontalTransform}, ${verticalTransform}` as ImageToolbarPosition['transform'],
  };
}

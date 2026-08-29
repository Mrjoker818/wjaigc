export interface PsdCanvasSurfaceContext {
  fillStyle: string | CanvasPattern | CanvasGradient;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  fillRect(x: number, y: number, width: number, height: number): void;
}

interface PositionedPsdLayer {
  offsetX?: number;
  offsetY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  boundingBox?: { x?: number; y?: number; width: number; height: number };
}

export interface PsdLayerPointerTarget {
  id: string;
  visible: boolean;
  locked: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

function containsPsdLayerPoint(
  target: PsdLayerPointerTarget,
  x: number,
  y: number,
): boolean {
  const { bounds } = target;
  return x >= bounds.x
    && x <= bounds.x + bounds.width
    && y >= bounds.y
    && y <= bounds.y + bounds.height;
}

export function resolvePsdLayerPointerTarget(
  targets: PsdLayerPointerTarget[],
  selectedLayerId: string | null,
  x: number,
  y: number,
): PsdLayerPointerTarget | null {
  const selected = selectedLayerId
    ? targets.find(target => target.id === selectedLayerId)
    : undefined;
  if (selected?.visible && !selected.locked && containsPsdLayerPoint(selected, x, y)) {
    return selected;
  }

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    if (target.visible && containsPsdLayerPoint(target, x, y)) return target;
  }
  return null;
}

export function resolvePsdLayerBounds(
  layer: PositionedPsdLayer,
  fallbackWidth: number,
  fallbackHeight: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(layer.offsetX ?? 0),
    y: Math.round(layer.offsetY ?? 0),
    width: layer.sourceWidth ?? (fallbackWidth > 0 ? fallbackWidth : (layer.boundingBox?.width ?? 0)),
    height: layer.sourceHeight ?? (fallbackHeight > 0 ? fallbackHeight : (layer.boundingBox?.height ?? 0)),
  };
}

export function drawPsdCanvasSurface(
  context: PsdCanvasSurfaceContext,
  width: number,
  height: number,
  checkerPattern: CanvasPattern | null,
): void {
  context.shadowColor = 'rgba(0,0,0,0.15)';
  context.shadowBlur = 20;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 4;
  context.fillStyle = checkerPattern || '#f5f5f5';
  context.fillRect(0, 0, width, height);
  context.shadowColor = 'transparent';
}

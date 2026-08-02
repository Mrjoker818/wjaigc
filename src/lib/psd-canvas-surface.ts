export interface PsdCanvasSurfaceContext {
  fillStyle: string | CanvasPattern | CanvasGradient;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  fillRect(x: number, y: number, width: number, height: number): void;
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

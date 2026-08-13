export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasPointerSample {
  pointerId: number;
  clientX: number;
  clientY: number;
}

export interface CanvasViewportRect extends CanvasPoint {
  width: number;
  height: number;
}

export interface CanvasViewportSize {
  width: number;
  height: number;
}

export type CanvasViewportInteraction =
  | { kind: 'idle' }
  | {
    kind: 'pan';
    pointerId: number;
    start: CanvasPoint;
    origin: CanvasPoint;
  };

export interface CanvasViewportState {
  committed: CanvasPoint;
  preview: CanvasPoint;
  zoom: number;
  interaction: CanvasViewportInteraction;
}

export interface CanvasPersistedViewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

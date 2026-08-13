import { fitCanvasContent } from '@/lib/canvas-view-state';
import type {
  CanvasPersistedViewport,
  CanvasPoint,
  CanvasPointerSample,
  CanvasViewportRect,
  CanvasViewportSize,
  CanvasViewportState,
} from '@/lib/canvas-kernel/types';

export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_MAX_ZOOM = 5;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampZoom(value: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, finiteOr(value, 1)));
}

export function createCanvasViewportState(
  persisted?: Partial<CanvasPersistedViewport> | null,
): CanvasViewportState {
  const committed = {
    x: finiteOr(persisted?.offsetX ?? 0, 0),
    y: finiteOr(persisted?.offsetY ?? 0, 0),
  };
  return {
    committed,
    preview: { ...committed },
    zoom: clampZoom(persisted?.zoom ?? 1),
    interaction: { kind: 'idle' },
  };
}

export function toPersistedViewport(state: CanvasViewportState): CanvasPersistedViewport {
  return {
    offsetX: state.committed.x,
    offsetY: state.committed.y,
    zoom: state.zoom,
  };
}

export function beginPan(
  state: CanvasViewportState,
  pointer: CanvasPointerSample,
): CanvasViewportState {
  if (state.interaction.kind === 'pan' && state.interaction.pointerId !== pointer.pointerId) {
    return state;
  }
  return {
    ...state,
    preview: { ...state.committed },
    interaction: {
      kind: 'pan',
      pointerId: pointer.pointerId,
      start: { x: pointer.clientX, y: pointer.clientY },
      origin: { ...state.committed },
    },
  };
}

export function previewPan(
  state: CanvasViewportState,
  pointer: CanvasPointerSample,
): CanvasViewportState {
  const interaction = state.interaction;
  if (interaction.kind !== 'pan' || interaction.pointerId !== pointer.pointerId) return state;
  return {
    ...state,
    preview: {
      x: interaction.origin.x + pointer.clientX - interaction.start.x,
      y: interaction.origin.y + pointer.clientY - interaction.start.y,
    },
  };
}

export function commitPan(
  state: CanvasViewportState,
  pointer?: Pick<CanvasPointerSample, 'pointerId'>,
): CanvasViewportState {
  if (state.interaction.kind !== 'pan') return state;
  if (pointer && state.interaction.pointerId !== pointer.pointerId) return state;
  return {
    ...state,
    committed: { ...state.preview },
    preview: { ...state.preview },
    interaction: { kind: 'idle' },
  };
}

export function cancelPan(
  state: CanvasViewportState,
  pointer?: Pick<CanvasPointerSample, 'pointerId'>,
): CanvasViewportState {
  if (state.interaction.kind !== 'pan') return state;
  if (pointer && state.interaction.pointerId !== pointer.pointerId) return state;
  return {
    ...state,
    preview: { ...state.committed },
    interaction: { kind: 'idle' },
  };
}

export function zoomAtPoint(
  state: CanvasViewportState,
  anchor: CanvasPoint,
  nextZoom: number,
): CanvasViewportState {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / state.zoom;
  const committed = {
    x: anchor.x - (anchor.x - state.committed.x) * ratio,
    y: anchor.y - (anchor.y - state.committed.y) * ratio,
  };
  return {
    committed,
    preview: { ...committed },
    zoom,
    interaction: { kind: 'idle' },
  };
}

export function screenToCanvas(state: CanvasViewportState, point: CanvasPoint): CanvasPoint {
  return {
    x: (point.x - state.preview.x) / state.zoom,
    y: (point.y - state.preview.y) / state.zoom,
  };
}

export function canvasToScreen(state: CanvasViewportState, point: CanvasPoint): CanvasPoint {
  return {
    x: point.x * state.zoom + state.preview.x,
    y: point.y * state.zoom + state.preview.y,
  };
}

export function fitContent(
  state: CanvasViewportState,
  rects: CanvasViewportRect[],
  viewport: CanvasViewportSize,
  padding = 48,
): CanvasViewportState {
  const fitted = fitCanvasContent(rects, viewport, padding);
  void state;
  return createCanvasViewportState(fitted);
}

export function setViewportOffset(
  state: CanvasViewportState,
  offset: CanvasPoint,
): CanvasViewportState {
  const committed = {
    x: finiteOr(offset.x, state.committed.x),
    y: finiteOr(offset.y, state.committed.y),
  };
  return {
    ...state,
    committed,
    preview: { ...committed },
    interaction: { kind: 'idle' },
  };
}

export function setViewportZoom(state: CanvasViewportState, zoom: number): CanvasViewportState {
  return {
    ...state,
    zoom: clampZoom(zoom),
    interaction: { kind: 'idle' },
  };
}

export function viewportStatesEqual(left: CanvasViewportState, right: CanvasViewportState): boolean {
  return left.committed.x === right.committed.x
    && left.committed.y === right.committed.y
    && left.preview.x === right.preview.x
    && left.preview.y === right.preview.y
    && left.zoom === right.zoom
    && left.interaction.kind === right.interaction.kind;
}

export function recordCanvasKernelDiff(scope: 'viewport', code: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('wujie:canvas-kernel-diff', {
    detail: { scope, code, timestamp: Date.now() },
  }));
}

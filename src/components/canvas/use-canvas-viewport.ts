'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { CanvasKernelMode } from '@/lib/canvas-kernel/mode';
import {
  beginPan as beginKernelPan,
  cancelPan as cancelKernelPan,
  canvasToScreen as kernelCanvasToScreen,
  commitPan as commitKernelPan,
  createCanvasViewportState,
  fitContent as fitKernelContent,
  previewPan as previewKernelPan,
  recordCanvasKernelDiff,
  screenToCanvas as kernelScreenToCanvas,
  setViewportOffset,
  setViewportZoom,
  viewportStatesEqual,
  zoomAtPoint as zoomKernelAtPoint,
} from '@/lib/canvas-kernel/viewport';
import type {
  CanvasPersistedViewport,
  CanvasPoint,
  CanvasPointerSample,
  CanvasViewportRect,
  CanvasViewportSize,
  CanvasViewportState,
} from '@/lib/canvas-kernel/types';
import {
  getCanvasViewportMarginFactor,
  resolveCanvasCullingBounds,
  resolveCanvasRenderOffset,
  shouldSyncCanvasPanViewport,
} from '@/lib/canvas-pan-virtualization';

interface UseCanvasViewportOptions {
  mode: CanvasKernelMode;
  initialViewState?: Partial<CanvasPersistedViewport> | null;
  transformRef: RefObject<HTMLDivElement | null>;
  onPanViewportSync?: (offset: CanvasPoint) => void;
}

interface UseCanvasViewportResult {
  state: CanvasViewportState;
  viewOffset: CanvasPoint;
  panViewportOffset: CanvasPoint;
  zoom: number;
  setViewOffset: Dispatch<SetStateAction<CanvasPoint>>;
  setZoom: Dispatch<SetStateAction<number>>;
  applyViewState: (view: CanvasPersistedViewport) => void;
  beginPan: (pointer: CanvasPointerSample) => boolean;
  previewPan: (pointer: CanvasPointerSample) => void;
  commitPan: (pointer?: Pick<CanvasPointerSample, 'pointerId'>) => void;
  cancelPan: (pointer?: Pick<CanvasPointerSample, 'pointerId'>) => void;
  zoomAtPoint: (anchor: CanvasPoint, nextZoom: number) => void;
  fitContent: (rects: CanvasViewportRect[], viewport: CanvasViewportSize, padding?: number) => void;
  screenToCanvas: (point: CanvasPoint) => CanvasPoint;
  canvasToScreen: (point: CanvasPoint) => CanvasPoint;
  resolveCullingBounds: (
    viewportWidth: number,
    viewportHeight: number,
    isPanning: boolean,
    isMiddlePanning: boolean,
    occupiedRight?: number,
  ) => ReturnType<typeof resolveCanvasCullingBounds>;
  resolveRenderOffset: (isPanning: boolean, isMiddlePanning: boolean) => CanvasPoint;
  getViewportMarginFactor: (isPanning: boolean, isMiddlePanning: boolean) => number;
}

function legacyBeginPan(state: CanvasViewportState, pointer: CanvasPointerSample): CanvasViewportState {
  if (state.interaction.kind === 'pan' && state.interaction.pointerId !== pointer.pointerId) return state;
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

function legacyPreviewPan(state: CanvasViewportState, pointer: CanvasPointerSample): CanvasViewportState {
  if (state.interaction.kind !== 'pan' || state.interaction.pointerId !== pointer.pointerId) return state;
  return {
    ...state,
    preview: {
      x: state.interaction.origin.x + pointer.clientX - state.interaction.start.x,
      y: state.interaction.origin.y + pointer.clientY - state.interaction.start.y,
    },
  };
}

export function resolveCanvasPanPreview(
  mode: CanvasKernelMode,
  legacy: CanvasViewportState,
  kernel: CanvasViewportState,
  pointer: CanvasPointerSample,
): { legacy: CanvasViewportState; kernel: CanvasViewportState } {
  if (mode === 'legacy') {
    return { legacy: legacyPreviewPan(legacy, pointer), kernel };
  }
  if (mode === 'canvas-v2') {
    return { legacy, kernel: previewKernelPan(kernel, pointer) };
  }
  return {
    legacy: legacyPreviewPan(legacy, pointer),
    kernel: previewKernelPan(kernel, pointer),
  };
}

function legacyCommitPan(
  state: CanvasViewportState,
  pointer?: Pick<CanvasPointerSample, 'pointerId'>,
  cancel = false,
): CanvasViewportState {
  if (state.interaction.kind !== 'pan') return state;
  if (pointer && state.interaction.pointerId !== pointer.pointerId) return state;
  const committed = cancel ? state.committed : state.preview;
  return {
    ...state,
    committed: { ...committed },
    preview: { ...committed },
    interaction: { kind: 'idle' },
  };
}

function stateFromPersisted(view: CanvasPersistedViewport): CanvasViewportState {
  return createCanvasViewportState(view);
}

function setCanvasSurfacePanActive(element: HTMLDivElement | null, active: boolean): void {
  if (!element) return;
  if (active) {
    element.dataset.canvasPanActive = 'true';
    return;
  }
  delete element.dataset.canvasPanActive;
}

export function useCanvasViewport({
  mode,
  initialViewState,
  transformRef,
  onPanViewportSync,
}: UseCanvasViewportOptions): UseCanvasViewportResult {
  const [legacyState, setLegacyState] = useState(() => createCanvasViewportState(initialViewState));
  const [kernelState, setKernelState] = useState(() => createCanvasViewportState(initialViewState));
  const legacyRef = useRef(legacyState);
  const kernelRef = useRef(kernelState);
  const previousModeRef = useRef(mode);
  const [panViewportOffset, setPanViewportOffset] = useState(() => (
    createCanvasViewportState(initialViewState).preview
  ));
  const panRafRef = useRef<number | null>(null);
  const panViewportSyncAtRef = useRef(0);
  const panViewportSyncOffsetRef = useRef({ ...panViewportOffset });

  const activeState = mode === 'canvas-v2' ? kernelState : legacyState;
  const activeRef = useCallback(() => (
    mode === 'canvas-v2' ? kernelRef.current : legacyRef.current
  ), [mode]);

  const compareShadow = useCallback((legacy: CanvasViewportState, kernel: CanvasViewportState, code: string) => {
    if (mode === 'shadow' && !viewportStatesEqual(legacy, kernel)) {
      recordCanvasKernelDiff('viewport', code);
    }
  }, [mode]);

  const publish = useCallback((legacy: CanvasViewportState, kernel: CanvasViewportState, syncPreview = true) => {
    legacyRef.current = legacy;
    kernelRef.current = kernel;
    compareShadow(legacy, kernel, 'state-mismatch');
    if (mode !== 'canvas-v2') setLegacyState(legacy);
    if (mode !== 'legacy') setKernelState(kernel);
    if (syncPreview) {
      const active = mode === 'canvas-v2' ? kernel : legacy;
      setPanViewportOffset(active.preview);
    }
  }, [compareShadow, mode]);

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    const previous = previousModeRef.current === 'canvas-v2' ? kernelRef.current : legacyRef.current;
    legacyRef.current = previous;
    kernelRef.current = previous;
    setLegacyState(previous);
    setKernelState(previous);
    setPanViewportOffset(previous.preview);
    previousModeRef.current = mode;
  }, [mode]);

  useEffect(() => () => {
    if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
    setCanvasSurfacePanActive(transformRef.current, false);
  }, [transformRef]);

  const applyViewState = useCallback((view: CanvasPersistedViewport) => {
    const nextLegacy = stateFromPersisted(view);
    const nextKernel = createCanvasViewportState(view);
    publish(nextLegacy, nextKernel);
  }, [publish]);

  const setViewOffset = useCallback<Dispatch<SetStateAction<CanvasPoint>>>((action) => {
    const active = activeRef();
    const nextOffset = typeof action === 'function' ? action(active.committed) : action;
    publish(
      setViewportOffset(legacyRef.current, nextOffset),
      setViewportOffset(kernelRef.current, nextOffset),
    );
  }, [activeRef, publish]);

  const setZoom = useCallback<Dispatch<SetStateAction<number>>>((action) => {
    const currentZoom = activeRef().zoom;
    const nextZoom = typeof action === 'function' ? action(currentZoom) : action;
    publish(
      setViewportZoom(legacyRef.current, nextZoom),
      setViewportZoom(kernelRef.current, nextZoom),
    );
  }, [activeRef, publish]);

  const beginPan = useCallback((pointer: CanvasPointerSample) => {
    const active = activeRef();
    if (active.interaction.kind === 'pan' && active.interaction.pointerId !== pointer.pointerId) {
      return false;
    }
    const legacy = legacyBeginPan(legacyRef.current, pointer);
    const kernel = beginKernelPan(kernelRef.current, pointer);
    legacyRef.current = legacy;
    kernelRef.current = kernel;
    compareShadow(legacy, kernel, 'pan-begin');
    panViewportSyncAtRef.current = 0;
    panViewportSyncOffsetRef.current = { ...active.committed };
    setCanvasSurfacePanActive(transformRef.current, true);
    return true;
  }, [activeRef, compareShadow, transformRef]);

  const previewPan = useCallback((pointer: CanvasPointerSample) => {
    const { legacy, kernel } = resolveCanvasPanPreview(
      mode,
      legacyRef.current,
      kernelRef.current,
      pointer,
    );
    legacyRef.current = legacy;
    kernelRef.current = kernel;
    compareShadow(legacy, kernel, 'pan-preview');

    if (panRafRef.current !== null) return;
    panRafRef.current = requestAnimationFrame((now) => {
      panRafRef.current = null;
      const active = activeRef();
      const element = transformRef.current;
      if (element) {
        element.style.transform = `translate(${active.preview.x}px, ${active.preview.y}px) scale(${active.zoom})`;
      }
      if (shouldSyncCanvasPanViewport(
        panViewportSyncOffsetRef.current,
        active.preview,
        now - panViewportSyncAtRef.current,
      )) {
        panViewportSyncAtRef.current = now;
        panViewportSyncOffsetRef.current = { ...active.preview };
        onPanViewportSync?.(active.preview);
        setPanViewportOffset(active.preview);
        if (mode !== 'canvas-v2') setLegacyState(legacyRef.current);
        if (mode !== 'legacy') setKernelState(kernelRef.current);
      }
    });
  }, [activeRef, compareShadow, mode, onPanViewportSync, transformRef]);

  const finishPan = useCallback((
    pointer: Pick<CanvasPointerSample, 'pointerId'> | undefined,
    cancel: boolean,
  ) => {
    if (panRafRef.current !== null) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    const legacy = legacyCommitPan(legacyRef.current, pointer, cancel);
    const kernel = cancel
      ? cancelKernelPan(kernelRef.current, pointer)
      : commitKernelPan(kernelRef.current, pointer);
    const active = mode === 'canvas-v2' ? kernel : legacy;
    legacyRef.current = legacy;
    kernelRef.current = kernel;
    compareShadow(legacy, kernel, cancel ? 'pan-cancel' : 'pan-commit');
    const element = transformRef.current;
    if (element) {
      element.style.transform = `translate(${active.preview.x}px, ${active.preview.y}px) scale(${active.zoom})`;
    }
    setCanvasSurfacePanActive(element, active.interaction.kind === 'pan');
    startTransition(() => {
      if (mode !== 'canvas-v2') setLegacyState(legacy);
      if (mode !== 'legacy') setKernelState(kernel);
      setPanViewportOffset(active.preview);
    });
    panViewportSyncOffsetRef.current = { ...active.preview };
  }, [compareShadow, mode, transformRef]);

  const commitPan = useCallback((pointer?: Pick<CanvasPointerSample, 'pointerId'>) => {
    finishPan(pointer, false);
  }, [finishPan]);

  const cancelPan = useCallback((pointer?: Pick<CanvasPointerSample, 'pointerId'>) => {
    finishPan(pointer, true);
  }, [finishPan]);

  const zoomAtPoint = useCallback((anchor: CanvasPoint, nextZoom: number) => {
    const legacyCurrent = legacyRef.current;
    const legacyZoom = Math.min(5, Math.max(0.1, nextZoom));
    const legacyRatio = legacyZoom / legacyCurrent.zoom;
    const legacyOffset = {
      x: anchor.x - (anchor.x - legacyCurrent.committed.x) * legacyRatio,
      y: anchor.y - (anchor.y - legacyCurrent.committed.y) * legacyRatio,
    };
    const legacy = stateFromPersisted({
      offsetX: legacyOffset.x,
      offsetY: legacyOffset.y,
      zoom: legacyZoom,
    });
    publish(legacy, zoomKernelAtPoint(kernelRef.current, anchor, nextZoom));
  }, [publish]);

  const fitContent = useCallback((
    rects: CanvasViewportRect[],
    viewport: CanvasViewportSize,
    padding?: number,
  ) => {
    const legacyView = fitKernelContent(legacyRef.current, rects, viewport, padding);
    const kernelView = fitKernelContent(kernelRef.current, rects, viewport, padding);
    publish(legacyView, kernelView);
  }, [publish]);

  const screenToCanvas = useCallback((point: CanvasPoint) => (
    kernelScreenToCanvas(activeRef(), point)
  ), [activeRef]);

  const canvasToScreen = useCallback((point: CanvasPoint) => (
    kernelCanvasToScreen(activeRef(), point)
  ), [activeRef]);

  const resolveCullingBounds = useCallback((
    viewportWidth: number,
    viewportHeight: number,
    isPanning: boolean,
    isMiddlePanning: boolean,
    occupiedRight = 0,
  ) => resolveCanvasCullingBounds(
    activeRef().committed,
    panViewportOffset,
    activeRef().zoom,
    viewportWidth,
    viewportHeight,
    isPanning,
    isMiddlePanning,
    occupiedRight,
  ), [activeRef, panViewportOffset]);

  const resolveRenderOffset = useCallback((isPanning: boolean, isMiddlePanning: boolean) => (
    resolveCanvasRenderOffset(
      activeRef().committed,
      panViewportOffset,
      isPanning,
      isMiddlePanning,
    )
  ), [activeRef, panViewportOffset]);

  return {
    state: activeState,
    viewOffset: activeState.committed,
    panViewportOffset,
    zoom: activeState.zoom,
    setViewOffset,
    setZoom,
    applyViewState,
    beginPan,
    previewPan,
    commitPan,
    cancelPan,
    zoomAtPoint,
    fitContent,
    screenToCanvas,
    canvasToScreen,
    resolveCullingBounds,
    resolveRenderOffset,
    getViewportMarginFactor: getCanvasViewportMarginFactor,
  };
}

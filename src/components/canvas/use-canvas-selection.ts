'use client';

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  beginBoxSelection,
  cancelSelectionGesture as cancelKernelSelectionGesture,
  clearSelection as clearKernelSelection,
  commitBoxSelection,
  createCanvasSelectionState,
  selectHit,
  updateBoxSelection,
  type CanvasSelectionMode,
  type CanvasSelectionState,
} from '@/lib/canvas-kernel/selection';
import type { CanvasPoint } from '@/lib/canvas-kernel/types';

interface UseCanvasSelectionOptions {
  initialIds?: Iterable<string>;
  initialPrimaryId?: string | null;
  onSelectionCommit?: (state: CanvasSelectionState) => void;
  getViewportElement?: () => HTMLElement | null;
}

interface BeginImageSelectionGestureInput {
  pointerId: number;
  hitId: string;
  point: CanvasPoint;
  mode?: CanvasSelectionMode;
}

interface UseCanvasSelectionResult {
  state: CanvasSelectionState;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  getSelectionState: () => CanvasSelectionState;
  getBoxSelectionPreview: () => { start: CanvasPoint; end: CanvasPoint; active: boolean } | null;
  selectHit: (hitId: string | null, mode?: CanvasSelectionMode) => CanvasSelectionState;
  clearSelection: () => CanvasSelectionState;
  beginBoxSelection: (input: { pointerId: number; point: CanvasPoint; additive: boolean }) => void;
  updateBoxSelection: (input: { pointerId: number; point: CanvasPoint }) => void;
  commitBoxSelection: (hitIdsInZOrder: readonly string[]) => CanvasSelectionState;
  cancelSelectionGesture: (pointerId?: number) => void;
  beginImageSelectionGesture: (input: BeginImageSelectionGestureInput) => CanvasSelectionState;
  finishCanvasPointerGesture: (pointerId: number, cancelled?: boolean) => void;
  setBoxOverlayElement: (element: HTMLDivElement | null) => void;
}

export function resolveBoxSelectionOverlayLayout(
  start: CanvasPoint,
  end: CanvasPoint,
  viewport: { left: number; top: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(start.x, end.x) - viewport.left,
    y: Math.min(start.y, end.y) - viewport.top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function applyBoxSelectionVisualState(
  overlay: HTMLElement | null,
  viewport: HTMLElement | null,
  active: boolean,
): void {
  if (overlay) overlay.style.display = active ? 'block' : 'none';
  if (viewport) viewport.style.cursor = active ? 'crosshair' : '';
}

export function useCanvasSelection({
  initialIds = [],
  initialPrimaryId,
  onSelectionCommit,
  getViewportElement,
}: UseCanvasSelectionOptions = {}): UseCanvasSelectionResult {
  const [state, setState] = useState(() => (
    createCanvasSelectionState(initialIds, initialPrimaryId)
  ));
  const stateRef = useRef(state);
  const boxPreviewRef = useRef<CanvasSelectionState | null>(null);
  const boxOverlayRef = useRef<HTMLDivElement | null>(null);
  const boxRafRef = useRef<number | null>(null);
  const activeImagePointerRef = useRef<{ pointerId: number; point: CanvasPoint } | null>(null);
  const onSelectionCommitRef = useRef(onSelectionCommit);

  useEffect(() => {
    onSelectionCommitRef.current = onSelectionCommit;
  }, [onSelectionCommit]);

  const hideBoxOverlay = useCallback(() => {
    applyBoxSelectionVisualState(
      boxOverlayRef.current,
      getViewportElement?.() ?? null,
      false,
    );
  }, [getViewportElement]);

  const setBoxOverlayElement = useCallback((element: HTMLDivElement | null) => {
    boxOverlayRef.current = element;
  }, []);

  useEffect(() => () => {
    if (boxRafRef.current !== null) cancelAnimationFrame(boxRafRef.current);
    hideBoxOverlay();
  }, [hideBoxOverlay]);

  const publishCommitted = useCallback((next: CanvasSelectionState) => {
    const committed = { ...next, gesture: null } satisfies CanvasSelectionState;
    stateRef.current = committed;
    setState(committed);
    onSelectionCommitRef.current?.(committed);
    return committed;
  }, []);

  const scheduleBoxPreview = useCallback(() => {
    if (boxRafRef.current !== null) return;
    boxRafRef.current = requestAnimationFrame(() => {
      boxRafRef.current = null;
      const previewState = boxPreviewRef.current;
      const gesture = previewState?.gesture;
      const overlay = boxOverlayRef.current;
      const viewportElement = getViewportElement?.() ?? null;
      const viewport = viewportElement?.getBoundingClientRect();
      if (!overlay || !viewport || gesture?.kind !== 'box' || !gesture.active) {
        hideBoxOverlay();
        return;
      }
      const layout = resolveBoxSelectionOverlayLayout(
        gesture.start,
        gesture.current,
        viewport,
      );
      applyBoxSelectionVisualState(overlay, viewportElement, true);
      overlay.style.transform = `translate3d(${layout.x}px, ${layout.y}px, 0)`;
      overlay.style.width = `${layout.width}px`;
      overlay.style.height = `${layout.height}px`;
    });
  }, [getViewportElement, hideBoxOverlay]);

  const setSelectedIds = useCallback<Dispatch<SetStateAction<Set<string>>>>((action) => {
    const current = new Set(stateRef.current.ids);
    const next = typeof action === 'function' ? action(current) : action;
    publishCommitted(createCanvasSelectionState(next));
  }, [publishCommitted]);

  const selectSelectionHit = useCallback((hitId: string | null, mode: CanvasSelectionMode = 'replace') => (
    publishCommitted(selectHit(stateRef.current, hitId, mode))
  ), [publishCommitted]);

  const clearSelection = useCallback(() => (
    publishCommitted(clearKernelSelection(stateRef.current))
  ), [publishCommitted]);

  const beginSelectionBox = useCallback((input: { pointerId: number; point: CanvasPoint; additive: boolean }) => {
    boxPreviewRef.current = beginBoxSelection(stateRef.current, input);
    applyBoxSelectionVisualState(
      boxOverlayRef.current,
      getViewportElement?.() ?? null,
      true,
    );
    scheduleBoxPreview();
  }, [getViewportElement, scheduleBoxPreview]);

  const updateSelectionBox = useCallback((input: { pointerId: number; point: CanvasPoint }) => {
    const preview = boxPreviewRef.current;
    if (!preview) return;
    boxPreviewRef.current = updateBoxSelection(preview, input);
    scheduleBoxPreview();
  }, [scheduleBoxPreview]);

  const commitSelectionBox = useCallback((hitIdsInZOrder: readonly string[]) => {
    const preview = boxPreviewRef.current;
    if (!preview) return stateRef.current;
    if (boxRafRef.current !== null) {
      cancelAnimationFrame(boxRafRef.current);
      boxRafRef.current = null;
    }
    boxPreviewRef.current = null;
    hideBoxOverlay();
    return publishCommitted(commitBoxSelection(preview, hitIdsInZOrder));
  }, [hideBoxOverlay, publishCommitted]);

  const cancelSelectionGesture = useCallback((pointerId?: number) => {
    const preview = boxPreviewRef.current;
    if (preview) {
      const cancelled = cancelKernelSelectionGesture(preview, pointerId);
      if (cancelled === preview) return;
    }
    if (boxRafRef.current !== null) {
      cancelAnimationFrame(boxRafRef.current);
      boxRafRef.current = null;
    }
    boxPreviewRef.current = null;
    hideBoxOverlay();
  }, [hideBoxOverlay]);

  const beginImageSelectionGesture = useCallback((input: BeginImageSelectionGestureInput) => {
    activeImagePointerRef.current = { pointerId: input.pointerId, point: { ...input.point } };
    return selectSelectionHit(input.hitId, input.mode ?? 'replace');
  }, [selectSelectionHit]);

  const finishCanvasPointerGesture = useCallback((pointerId: number, cancelled = false) => {
    if (activeImagePointerRef.current?.pointerId === pointerId) {
      activeImagePointerRef.current = null;
    }
    if (cancelled) cancelSelectionGesture(pointerId);
  }, [cancelSelectionGesture]);

  const selectedIds = useMemo(() => new Set(state.ids), [state.ids]);

  const getBoxSelectionPreview = useCallback(() => {
    const preview = boxPreviewRef.current;
    const gesture = preview?.gesture;
    if (!gesture || gesture.kind !== 'box') return null;
    return {
      start: { ...gesture.start },
      end: { ...gesture.current },
      active: gesture.active,
    };
  }, []);

  return {
    state,
    selectedIds,
    setSelectedIds,
    getSelectionState: () => stateRef.current,
    getBoxSelectionPreview,
    selectHit: selectSelectionHit,
    clearSelection,
    beginBoxSelection: beginSelectionBox,
    updateBoxSelection: updateSelectionBox,
    commitBoxSelection: commitSelectionBox,
    cancelSelectionGesture,
    beginImageSelectionGesture,
    finishCanvasPointerGesture,
    setBoxOverlayElement,
  };
}

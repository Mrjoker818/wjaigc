import type { CanvasPoint } from './types';

export type CanvasSelectionMode = 'replace' | 'toggle' | 'append';

export interface CanvasBoxSelectionGesture {
  kind: 'box';
  pointerId: number;
  start: CanvasPoint;
  current: CanvasPoint;
  additive: boolean;
  active: boolean;
  snapshotIds: string[];
  snapshotPrimaryId: string | null;
}

export type CanvasSelectionGesture = CanvasBoxSelectionGesture | null;

export interface CanvasSelectionState {
  ids: string[];
  primaryId: string | null;
  gesture: CanvasSelectionGesture;
}

export interface CanvasHitCandidate {
  id: string;
  zIndex?: number;
  order: number;
}

export interface CanvasBoxSelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface CanvasSelectableRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_DRAG_THRESHOLD = 5;

function uniqueIds(ids: Iterable<string>): string[] {
  return [...new Set([...ids].filter(Boolean))];
}

function committedState(ids: Iterable<string>, primaryId?: string | null): CanvasSelectionState {
  const nextIds = uniqueIds(ids);
  const nextPrimary = primaryId && nextIds.includes(primaryId)
    ? primaryId
    : nextIds.at(-1) ?? null;
  return { ids: nextIds, primaryId: nextPrimary, gesture: null };
}

export function createCanvasSelectionState(
  ids: Iterable<string> = [],
  primaryId?: string | null,
): CanvasSelectionState {
  return committedState(ids, primaryId);
}

export function clearSelection(state: CanvasSelectionState): CanvasSelectionState {
  void state;
  return createCanvasSelectionState();
}

export function selectHit(
  state: CanvasSelectionState,
  hitId: string | null,
  mode: CanvasSelectionMode,
): CanvasSelectionState {
  if (!hitId) {
    return mode === 'replace' ? clearSelection(state) : committedState(state.ids, state.primaryId);
  }

  if (mode === 'replace') return committedState([hitId], hitId);
  if (mode === 'append') return committedState([...state.ids, hitId], hitId);

  if (state.ids.includes(hitId)) {
    const remaining = state.ids.filter(id => id !== hitId);
    return committedState(remaining, state.primaryId === hitId ? remaining.at(-1) : state.primaryId);
  }
  return committedState([...state.ids, hitId], hitId);
}

export function toggleHit(state: CanvasSelectionState, hitId: string): CanvasSelectionState {
  return selectHit(state, hitId, 'toggle');
}

export function resolveTopmostHit(candidates: readonly CanvasHitCandidate[]): string | null {
  let topmost: CanvasHitCandidate | null = null;
  for (const candidate of candidates) {
    if (
      !topmost
      || (candidate.zIndex ?? 0) > (topmost.zIndex ?? 0)
      || (
        (candidate.zIndex ?? 0) === (topmost.zIndex ?? 0)
        && candidate.order > topmost.order
      )
    ) {
      topmost = candidate;
    }
  }
  return topmost?.id ?? null;
}

export function hasExceededDragThreshold(
  start: CanvasPoint,
  current: CanvasPoint,
  threshold = DEFAULT_DRAG_THRESHOLD,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}

export function beginBoxSelection(
  state: CanvasSelectionState,
  input: { pointerId: number; point: CanvasPoint; additive: boolean },
): CanvasSelectionState {
  return {
    ...state,
    gesture: {
      kind: 'box',
      pointerId: input.pointerId,
      start: { ...input.point },
      current: { ...input.point },
      additive: input.additive,
      active: false,
      snapshotIds: [...state.ids],
      snapshotPrimaryId: state.primaryId,
    },
  };
}

export function updateBoxSelection(
  state: CanvasSelectionState,
  input: { pointerId: number; point: CanvasPoint; threshold?: number },
): CanvasSelectionState {
  const gesture = state.gesture;
  if (!gesture || gesture.kind !== 'box' || gesture.pointerId !== input.pointerId) return state;
  const current = { ...input.point };
  return {
    ...state,
    gesture: {
      ...gesture,
      current,
      active: hasExceededDragThreshold(gesture.start, current, input.threshold),
    },
  };
}

export function getBoxSelectionBounds(state: CanvasSelectionState): CanvasBoxSelectionBounds | null {
  const gesture = state.gesture;
  if (!gesture || gesture.kind !== 'box') return null;
  const left = Math.min(gesture.start.x, gesture.current.x);
  const top = Math.min(gesture.start.y, gesture.current.y);
  const right = Math.max(gesture.start.x, gesture.current.x);
  const bottom = Math.max(gesture.start.y, gesture.current.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function commitBoxSelection(
  state: CanvasSelectionState,
  hitIdsInZOrder: readonly string[],
): CanvasSelectionState {
  const gesture = state.gesture;
  if (!gesture || gesture.kind !== 'box') return committedState(state.ids, state.primaryId);
  const hitIds = gesture.active ? uniqueIds(hitIdsInZOrder) : [];
  const ids = gesture.additive ? [...gesture.snapshotIds, ...hitIds] : hitIds;
  return committedState(ids, hitIds.at(-1) ?? (gesture.additive ? gesture.snapshotPrimaryId : null));
}

export function resolveBoxSelectionHitIds(input: {
  images: readonly CanvasSelectableRect[];
  bounds: Pick<CanvasBoxSelectionBounds, 'left' | 'top' | 'right' | 'bottom'>;
  indexedHitIds: readonly string[];
  excludedIds?: ReadonlySet<string>;
}): string[] {
  const indexedHits = new Set(input.indexedHitIds);
  const intersectsBounds = (image: CanvasSelectableRect) => (
    image.x <= input.bounds.right
    && image.x + image.width >= input.bounds.left
    && image.y <= input.bounds.bottom
    && image.y + image.height >= input.bounds.top
  );

  // The index is the fast path. Reconcile once at commit time because a React
  // render interrupted during hydration can leave its incremental snapshot one
  // commit behind the image array used by the pointer gesture.
  for (const image of input.images) {
    if (intersectsBounds(image)) indexedHits.add(image.id);
  }

  return input.images
    .filter(image => (
      indexedHits.has(image.id)
      && !input.excludedIds?.has(image.id)
      && intersectsBounds(image)
    ))
    .map(image => image.id);
}

export function cancelSelectionGesture(
  state: CanvasSelectionState,
  pointerId?: number,
): CanvasSelectionState {
  const gesture = state.gesture;
  if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) return state;
  return committedState(gesture.snapshotIds, gesture.snapshotPrimaryId);
}

export function resolveCanvasGesturePriority(input: {
  overlay: boolean;
  editMode: boolean;
  annotationMode: boolean;
}): 'blocked' | 'edit' | 'annotation' | 'selection' {
  if (input.overlay) return 'blocked';
  if (input.editMode) return 'edit';
  if (input.annotationMode) return 'annotation';
  return 'selection';
}

export function resolveBlankCanvasGesture(
  pointerType: string,
): 'box-select' | 'long-press-pan' {
  return pointerType === 'touch' ? 'long-press-pan' : 'box-select';
}

export type CanvasImagePointerIntent =
  | 'select'
  | 'toggle-selection'
  | 'reference-group'
  | 'fusion-group';

export function resolveImagePointerIntent(input: {
  altKey: boolean;
  toggleKey: boolean;
  fusionMode: boolean;
}): CanvasImagePointerIntent {
  if (input.altKey) return 'reference-group';
  if (input.toggleKey && input.fusionMode) return 'fusion-group';
  if (input.toggleKey) return 'toggle-selection';
  return 'select';
}

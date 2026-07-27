'use client';

import { useCallback, useRef, useState } from 'react';

import {
  clampNormalizedRegion,
  normalizeScreenPath,
  normalizeScreenPoint,
  normalizedRegionFromScreenPoints,
  shouldCommitGesture,
  type ScreenPoint,
  type ScreenRect,
} from './annotation-geometry';
import type {
  AnnotationRegion,
  AnnotationType,
  CanvasAnnotationV2,
} from './annotation-types';
export { buildAnnotationSourceVersionId } from './annotation-source-version';

export interface AnnotationSource {
  projectId: string;
  imageId: string;
  versionId: string;
  imageRect: ScreenRect;
}

export interface AnnotationSourceIdentity {
  projectId: string;
  imageId: string;
  versionId: string;
}

export interface AnnotationSourceMismatch {
  code: 'source-mismatch';
  expected: AnnotationSourceIdentity;
  received: AnnotationSourceIdentity;
}

export type AnnotationGesture =
  | { kind: 'idle' }
  | {
      kind: 'region' | 'arrow';
      source: AnnotationSource;
      start: ScreenPoint;
      current: ScreenPoint;
    }
  | {
      kind: 'brush';
      source: AnnotationSource;
      start: ScreenPoint;
      current: ScreenPoint;
      points: ScreenPoint[];
    }
  | {
      kind: 'text';
      source: AnnotationSource;
      point: ScreenPoint;
    }
  | {
      kind: 'semantic-object';
      source: AnnotationSource;
      point: ScreenPoint;
    };

export interface AnnotationControllerState {
  isOpen: boolean;
  tool: AnnotationType;
  annotations: CanvasAnnotationV2[];
  gesture: AnnotationGesture;
  selectedAnnotationId: string | null;
  prompt: string;
  brushSize: number;
  brushScreenWidths: Record<string, number>;
  sourceLock: AnnotationSourceIdentity | null;
  sourceMismatch: AnnotationSourceMismatch | null;
}

function sourceIdentity(source: AnnotationSource): AnnotationSourceIdentity {
  return {
    projectId: source.projectId,
    imageId: source.imageId,
    versionId: source.versionId,
  };
}

function annotationSourceIdentity(
  annotation: CanvasAnnotationV2,
): AnnotationSourceIdentity {
  return {
    projectId: annotation.projectId,
    imageId: annotation.sourceImageId,
    versionId: annotation.sourceVersionId,
  };
}

function sourcesMatch(
  first: AnnotationSourceIdentity,
  second: AnnotationSourceIdentity,
): boolean {
  // 只比较 projectId + imageId，不比较 versionId：
  // 图片编辑后 URL 变化会导致 versionId 失效，但用户仍应能在同一张图上继续批注。
  return (
    first.projectId === second.projectId
    && first.imageId === second.imageId
  );
}

function sourceIdentityEquals(
  first: AnnotationSourceIdentity,
  second: AnnotationSourceIdentity,
): boolean {
  return (
    first.projectId === second.projectId
    && first.imageId === second.imageId
    && first.versionId === second.versionId
  );
}

function migrateSourceIdentity(
  identity: AnnotationSourceIdentity,
  from: AnnotationSourceIdentity,
  to: AnnotationSourceIdentity,
): AnnotationSourceIdentity {
  return sourceIdentityEquals(identity, from) ? { ...to } : identity;
}

export function migrateAnnotationControllerSource(
  state: AnnotationControllerState,
  from: AnnotationSourceIdentity,
  to: AnnotationSourceIdentity,
): AnnotationControllerState {
  if (sourceIdentityEquals(from, to)) return state;

  const annotations = state.annotations.map((annotation) => {
    const identity = annotationSourceIdentity(annotation);
    if (!sourceIdentityEquals(identity, from)) return annotation;
    return {
      ...annotation,
      projectId: to.projectId,
      sourceImageId: to.imageId,
      sourceVersionId: to.versionId,
      updatedAt: Date.now(),
    };
  });
  const gesture = state.gesture.kind === 'idle'
    ? state.gesture
    : sourceIdentityEquals(sourceIdentity(state.gesture.source), from)
      ? {
          ...state.gesture,
          source: {
            ...state.gesture.source,
            projectId: to.projectId,
            imageId: to.imageId,
            versionId: to.versionId,
          },
        }
      : state.gesture;
  const sourceLock = state.sourceLock
    ? migrateSourceIdentity(state.sourceLock, from, to)
    : null;
  const sourceMismatch = state.sourceMismatch
    ? {
        ...state.sourceMismatch,
        expected: migrateSourceIdentity(state.sourceMismatch.expected, from, to),
        received: migrateSourceIdentity(state.sourceMismatch.received, from, to),
      }
    : null;

  return {
    ...state,
    annotations,
    gesture,
    sourceLock,
    sourceMismatch,
  };
}

export function createInitialAnnotationControllerState(
  annotations: CanvasAnnotationV2[] = [],
): AnnotationControllerState {
  const sourceLock = annotations[0]
    ? annotationSourceIdentity(annotations[0])
    : null;
  const compatibleAnnotations = sourceLock
    ? annotations.filter((annotation) =>
        sourcesMatch(annotationSourceIdentity(annotation), sourceLock))
    : annotations;
  const rejectedAnnotation = sourceLock
    ? annotations.find((annotation) =>
        !sourcesMatch(annotationSourceIdentity(annotation), sourceLock))
    : undefined;

  return {
    isOpen: true,
    tool: 'semantic-object',
    annotations: compatibleAnnotations,
    gesture: { kind: 'idle' },
    selectedAnnotationId: null,
    prompt: '',
    brushSize: 12,
    brushScreenWidths: {},
    sourceLock,
    sourceMismatch: rejectedAnnotation && sourceLock
      ? {
          code: 'source-mismatch',
          expected: sourceLock,
          received: annotationSourceIdentity(rejectedAnnotation),
        }
      : null,
  };
}

export function selectAnnotationTool(
  state: AnnotationControllerState,
  tool: AnnotationType,
): AnnotationControllerState {
  return {
    ...state,
    isOpen: true,
    tool,
    gesture: { kind: 'idle' },
    sourceLock: state.annotations.length > 0 ? state.sourceLock : null,
    sourceMismatch: null,
  };
}

export function beginAnnotationGesture(
  state: AnnotationControllerState,
  source: AnnotationSource,
  point: ScreenPoint,
): AnnotationControllerState {
  if (!state.isOpen || state.annotations.length >= 10) return state;

  const received = sourceIdentity(source);
  const expected = state.sourceLock
    ?? (state.annotations[0] ? annotationSourceIdentity(state.annotations[0]) : null);
  if (expected && !sourcesMatch(expected, received)) {
    return {
      ...state,
      sourceMismatch: {
        code: 'source-mismatch',
        expected,
        received,
      },
    };
  }

  const lockedState = {
    ...state,
    sourceLock: expected ?? received,
    sourceMismatch: null,
  };

  if (state.tool === 'brush') {
    return {
      ...lockedState,
      gesture: {
        kind: 'brush',
        source,
        start: point,
        current: point,
        points: [point],
      },
    };
  }
  if (state.tool === 'region' || state.tool === 'arrow') {
    return {
      ...lockedState,
      gesture: {
        kind: state.tool,
        source,
        start: point,
        current: point,
      },
    };
  }
  if (state.tool === 'text') {
    return {
      ...lockedState,
      gesture: { kind: 'text', source, point },
    };
  }
  return {
    ...lockedState,
    gesture: { kind: 'semantic-object', source, point },
  };
}

export function updateAnnotationGesture(
  state: AnnotationControllerState,
  point: ScreenPoint,
): AnnotationControllerState {
  const gesture = state.gesture;
  if (gesture.kind === 'region' || gesture.kind === 'arrow') {
    return { ...state, gesture: { ...gesture, current: point } };
  }
  if (gesture.kind === 'brush') {
    return {
      ...state,
      gesture: {
        ...gesture,
        current: point,
        points: [...gesture.points, point],
      },
    };
  }
  return state;
}

function appendAnnotation(
  state: AnnotationControllerState,
  annotation: CanvasAnnotationV2,
  brushScreenWidth?: number,
): AnnotationControllerState {
  if (state.annotations.length >= 10) {
    return { ...state, gesture: { kind: 'idle' } };
  }
  return {
    ...state,
    annotations: [...state.annotations, annotation],
    selectedAnnotationId: annotation.id,
    gesture: { kind: 'idle' },
    brushScreenWidths: brushScreenWidth === undefined
      ? state.brushScreenWidths
      : {
          ...state.brushScreenWidths,
          [annotation.id]: brushScreenWidth,
        },
    sourceMismatch: null,
  };
}

function baseAnnotation(
  gesture: Exclude<AnnotationGesture, { kind: 'idle' }>,
  id: string,
  now: number,
): Pick<
  CanvasAnnotationV2,
  'id' | 'projectId' | 'sourceImageId' | 'sourceVersionId' | 'status' | 'createdAt' | 'updatedAt'
> {
  return {
    id,
    projectId: gesture.source.projectId,
    sourceImageId: gesture.source.imageId,
    sourceVersionId: gesture.source.versionId,
    status: 'ready',
    createdAt: now,
    updatedAt: now,
  };
}

export function commitAnnotationGesture(
  state: AnnotationControllerState,
  end: ScreenPoint,
  id: string,
  now: number,
): AnnotationControllerState {
  const gesture = state.gesture;
  if (gesture.kind === 'idle' || gesture.kind === 'text' || gesture.kind === 'semantic-object') {
    return state;
  }
  const brushPoints = gesture.kind === 'brush'
    ? [...gesture.points, end]
    : [];
  const brushPathLength = brushPoints.reduce((length, point, index) => {
    if (index === 0) return length;
    const previous = brushPoints[index - 1];
    return length + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
  const meaningfulGesture = gesture.kind === 'brush'
    ? brushPathLength >= 8
    : shouldCommitGesture(gesture.start, end);
  if (!meaningfulGesture) {
    return {
      ...state,
      gesture: { kind: 'idle' },
      sourceLock: state.annotations.length > 0 ? state.sourceLock : null,
    };
  }

  if (gesture.kind === 'region') {
    return appendAnnotation(state, {
      ...baseAnnotation(gesture, id, now),
      type: 'region',
      geometry: {
        kind: 'region',
        region: normalizedRegionFromScreenPoints(
          gesture.start,
          end,
          gesture.source.imageRect,
        ),
      },
    });
  }

  if (gesture.kind === 'arrow') {
    return appendAnnotation(state, {
      ...baseAnnotation(gesture, id, now),
      type: 'arrow',
      geometry: {
        kind: 'arrow',
        start: normalizeScreenPoint(gesture.start, gesture.source.imageRect),
        end: normalizeScreenPoint(end, gesture.source.imageRect),
      },
      instruction: state.prompt.trim() || undefined,
    });
  }

  if (gesture.kind !== 'brush') return state;

  const points = normalizeScreenPath(
    brushPoints,
    gesture.source.imageRect,
    4,
  );
  return appendAnnotation(
    state,
    {
      ...baseAnnotation(gesture, id, now),
      type: 'brush',
      geometry: {
        kind: 'brush',
        points,
        width: Math.min(1, state.brushSize / Math.min(
          gesture.source.imageRect.width,
          gesture.source.imageRect.height,
        )),
      },
    },
    state.brushSize,
  );
}

export function commitTextAnnotation(
  state: AnnotationControllerState,
  text: string,
  id: string,
  now: number,
): AnnotationControllerState {
  const gesture = state.gesture;
  const instruction = text.trim();
  if (gesture.kind !== 'text') {
    return { ...state, gesture: { kind: 'idle' } };
  }

  return appendAnnotation(state, {
    ...baseAnnotation(gesture, id, now),
    type: 'text',
    geometry: {
      kind: 'text',
      point: normalizeScreenPoint(gesture.point, gesture.source.imageRect),
    },
    instruction: instruction || undefined,
  });
}

export interface ResolvedSemanticTarget {
  label: string;
  confidence: number;
  region: AnnotationRegion;
}

export function commitResolvedSemanticAnnotation(
  state: AnnotationControllerState,
  target: ResolvedSemanticTarget,
  id: string,
  now: number,
): AnnotationControllerState {
  const gesture = state.gesture;
  if (gesture.kind !== 'semantic-object') return state;

  return appendAnnotation(state, {
    ...baseAnnotation(gesture, id, now),
    type: 'semantic-object',
    geometry: {
      kind: 'semantic-object',
      region: clampNormalizedRegion(target.region),
    },
    label: target.label.trim() || undefined,
    confidence: Math.min(1, Math.max(0, target.confidence)),
  });
}

export function updateAnnotationInstruction(
  state: AnnotationControllerState,
  annotationId: string,
  instruction: string,
  now: number,
): AnnotationControllerState {
  const nextInstruction = instruction.trim();
  return {
    ...state,
    annotations: state.annotations.map((annotation) =>
      annotation.id === annotationId
        ? {
            ...annotation,
            instruction: nextInstruction || undefined,
            updatedAt: now,
          }
        : annotation),
  };
}

export function moveTextAnnotation(
  state: AnnotationControllerState,
  annotationId: string,
  point: ScreenPoint,
  imageRect: ScreenRect,
  now: number,
): AnnotationControllerState {
  return {
    ...state,
    annotations: state.annotations.map((annotation) =>
      annotation.id === annotationId && annotation.geometry.kind === 'text'
        ? {
            ...annotation,
            geometry: {
              kind: 'text' as const,
              point: normalizeScreenPoint(point, imageRect),
            },
            updatedAt: now,
          }
        : annotation),
    selectedAnnotationId: annotationId,
  };
}

export function removeAnnotation(
  state: AnnotationControllerState,
  annotationId: string,
): AnnotationControllerState {
  const annotations = state.annotations.filter(
    (annotation) => annotation.id !== annotationId,
  );
  const brushScreenWidths = { ...state.brushScreenWidths };
  delete brushScreenWidths[annotationId];
  return {
    ...state,
    annotations,
    brushScreenWidths,
    selectedAnnotationId:
      state.selectedAnnotationId === annotationId
        ? null
        : state.selectedAnnotationId,
    sourceLock:
      annotations.length === 0 && state.gesture.kind === 'idle'
        ? null
        : state.sourceLock,
    sourceMismatch: null,
  };
}

export function cancelGestureOrCloseMode(
  state: AnnotationControllerState,
): AnnotationControllerState {
  if (state.gesture.kind !== 'idle') {
    return {
      ...state,
      gesture: { kind: 'idle' },
      sourceLock: state.annotations.length > 0 ? state.sourceLock : null,
      sourceMismatch: null,
    };
  }
  return { ...state, isOpen: false };
}

function createClientAnnotationId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useAnnotationController(initialAnnotations: CanvasAnnotationV2[] = []) {
  const [state, setReactState] = useState<AnnotationControllerState>(() =>
    createInitialAnnotationControllerState(initialAnnotations),
  );
  const stateRef = useRef(state);

  const updateState = useCallback((
    update: AnnotationControllerState | ((current: AnnotationControllerState) => AnnotationControllerState),
  ): AnnotationControllerState => {
    const next = typeof update === 'function' ? update(stateRef.current) : update;
    stateRef.current = next;
    setReactState(next);
    return next;
  }, []);
  const getState = useCallback((): AnnotationControllerState => stateRef.current, []);
  const migrateSource = useCallback((
    from: AnnotationSourceIdentity,
    to: AnnotationSourceIdentity,
  ): AnnotationControllerState => updateState((current) =>
    migrateAnnotationControllerSource(current, from, to)), [updateState]);

  const selectTool = useCallback((tool: AnnotationType) => {
    updateState((current) => selectAnnotationTool(current, tool));
  }, [updateState]);
  const pointerDown = useCallback((source: AnnotationSource, point: ScreenPoint) => {
    updateState((current) => beginAnnotationGesture(current, source, point));
  }, [updateState]);
  const pointerMove = useCallback((point: ScreenPoint) => {
    updateState((current) => updateAnnotationGesture(current, point));
  }, [updateState]);
  const pointerUp = useCallback((point: ScreenPoint) => {
    updateState((current) =>
      commitAnnotationGesture(current, point, createClientAnnotationId(), Date.now()),
    );
  }, [updateState]);
  const commitText = useCallback((text: string) => {
    updateState((current) =>
      commitTextAnnotation(current, text, createClientAnnotationId(), Date.now()),
    );
  }, [updateState]);
  const commitResolvedSemantic = useCallback((target: ResolvedSemanticTarget) => {
    updateState((current) =>
      commitResolvedSemanticAnnotation(
        current,
        target,
        createClientAnnotationId(),
        Date.now(),
      ),
    );
  }, [updateState]);
  const escape = useCallback(() => {
    updateState((current) => cancelGestureOrCloseMode(current));
  }, [updateState]);
  const updateInstruction = useCallback((annotationId: string, instruction: string) => {
    updateState((current) =>
      updateAnnotationInstruction(current, annotationId, instruction, Date.now()),
    );
  }, [updateState]);
  const moveText = useCallback((
    annotationId: string,
    point: ScreenPoint,
    imageRect: ScreenRect,
  ) => {
    updateState((current) =>
      moveTextAnnotation(current, annotationId, point, imageRect, Date.now()),
    );
  }, [updateState]);
  const remove = useCallback((annotationId: string) => {
    updateState((current) => removeAnnotation(current, annotationId));
  }, [updateState]);

  return {
    state,
    setState: updateState,
    getState,
    migrateSource,
    selectTool,
    pointerDown,
    pointerMove,
    pointerUp,
    commitText,
    commitResolvedSemantic,
    updateInstruction,
    moveText,
    remove,
    escape,
  };
}

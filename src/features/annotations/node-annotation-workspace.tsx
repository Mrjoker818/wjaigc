'use client';

import NextImage from 'next/image';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { buildEditIntentBundle } from './annotation-bundle';
import {
  AnnotationClientError,
  resolveSemanticAnnotation,
} from './annotation-client';
import {
  AnnotationComposer,
  type AnnotationModelOption,
} from './annotation-composer';
import { AnnotationOverlay } from './annotation-overlay';
import type { EditIntentBundle } from './annotation-types';
import {
  createInitialAnnotationControllerState,
  useAnnotationController,
} from './use-annotation-controller';

export interface NodeAnnotationSource {
  projectId: string;
  sourceNodeId: string;
  sourceImageId: string;
  sourceVersionId: string;
  imageUrl: string;
  label: string;
}

interface NodeAnnotationWorkspaceProps {
  source: NodeAnnotationSource;
  models: AnnotationModelOption[];
  initialBundle?: EditIntentBundle | null;
  onCreateNode: (bundle: EditIntentBundle) => void;
  onClose: () => void;
}

interface MeasuredImageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function pointInside(
  point: { x: number; y: number },
  bounds: MeasuredImageBounds,
): boolean {
  return point.x >= bounds.left
    && point.x <= bounds.left + bounds.width
    && point.y >= bounds.top
    && point.y <= bounds.top + bounds.height;
}

export function NodeAnnotationWorkspace({
  source,
  models,
  initialBundle = null,
  onCreateNode,
  onClose,
}: NodeAnnotationWorkspaceProps) {
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const semanticRequestRef = useRef(0);
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [imageBounds, setImageBounds] = useState<MeasuredImageBounds | null>(null);
  const [modelId, setModelId] = useState(
    initialBundle?.providerId
      ? `${initialBundle.providerId}::${initialBundle.modelId}`
      : models[0]?.id || '',
  );
  const [error, setError] = useState<string | null>(null);
  const {
    state,
    setState,
    selectTool,
    pointerDown,
    pointerMove,
    pointerUp,
    commitText,
    commitResolvedSemantic,
    updateInstruction,
    remove,
    escape,
  } = useAnnotationController(initialBundle?.annotations || []);

  useEffect(() => {
    const nextState = createInitialAnnotationControllerState(
      initialBundle?.annotations || [],
    );
    setState({
      ...nextState,
      prompt: initialBundle?.prompt || '',
    });
    setModelId(
      initialBundle?.providerId
        ? `${initialBundle.providerId}::${initialBundle.modelId}`
        : models[0]?.id || '',
    );
    setError(null);
  }, [
    initialBundle,
    models,
    setState,
    source.sourceImageId,
    source.sourceVersionId,
  ]);

  const measureImage = useCallback(() => {
    const frame = imageFrameRef.current?.getBoundingClientRect();
    if (!frame || naturalSize.width <= 0 || naturalSize.height <= 0) return;
    const scale = Math.min(
      frame.width / naturalSize.width,
      frame.height / naturalSize.height,
    );
    const width = naturalSize.width * scale;
    const height = naturalSize.height * scale;
    setImageBounds({
      left: frame.left + (frame.width - width) / 2,
      top: frame.top + (frame.height - height) / 2,
      width,
      height,
    });
  }, [naturalSize.height, naturalSize.width]);

  useLayoutEffect(() => {
    measureImage();
    const frame = imageFrameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(measureImage);
    observer.observe(frame);
    window.addEventListener('resize', measureImage);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureImage);
    };
  }, [measureImage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (event.code === 'KeyC') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (state.gesture.kind === 'idle') onClose();
      else escape();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [escape, onClose, state.gesture.kind]);

  const annotationSource = useCallback(() => {
    if (!imageBounds) return null;
    return {
      projectId: source.projectId,
      imageId: source.sourceImageId,
      versionId: source.sourceVersionId,
      imageRect: {
        x: imageBounds.left,
        y: imageBounds.top,
        width: imageBounds.width,
        height: imageBounds.height,
      },
    };
  }, [imageBounds, source]);

  const releasePointer = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pointerIdRef.current === event.pointerId) pointerIdRef.current = null;
  }, []);

  const resolveSemanticGesture = useCallback(async () => {
    if (state.gesture.kind !== 'semantic-object') return;
    const requestSequence = ++semanticRequestRef.current;
    const gesture = state.gesture;
    const point = {
      x: Math.min(1, Math.max(
        0,
        (gesture.point.x - gesture.source.imageRect.x)
          / gesture.source.imageRect.width,
      )),
      y: Math.min(1, Math.max(
        0,
        (gesture.point.y - gesture.source.imageRect.y)
          / gesture.source.imageRect.height,
      )),
    };
    setError(null);
    try {
      const result = await resolveSemanticAnnotation({
        projectId: source.projectId,
        sourceImageId: source.sourceImageId,
        sourceVersionId: source.sourceVersionId,
        point,
      });
      if (requestSequence !== semanticRequestRef.current) return;
      if (result.requiresConfirmation) {
        setState((current) => ({ ...current, gesture: { kind: 'idle' } }));
        selectTool('region');
        setError('对象识别置信度较低，请改用框选确认区域');
        return;
      }
      commitResolvedSemantic(result.target);
    } catch (caught) {
      if (requestSequence !== semanticRequestRef.current) return;
      setState((current) => ({ ...current, gesture: { kind: 'idle' } }));
      selectTool('region');
      const baseMessage = caught instanceof AnnotationClientError
        ? caught.message
        : '对象识别失败，请改用框选工具';
      setError(baseMessage.includes('框选')
        ? baseMessage
        : `${baseMessage}，请改用框选工具`);
    }
  }, [
    commitResolvedSemantic,
    selectTool,
    setState,
    source,
    state.gesture,
  ]);

  const handlePointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!event.isPrimary || event.button !== 0 || !imageBounds) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-toolbar], [data-floating-panel], [data-modal]')) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (!pointInside(point, imageBounds)) {
      setError('请在聚焦图片内创建批注');
      return;
    }
    const nextSource = annotationSource();
    if (!nextSource) return;
    setError(null);
    pointerDown(nextSource, point);
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [annotationSource, imageBounds, pointerDown]);

  const handlePointerMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerMove({ x: event.clientX, y: event.clientY });
  }, [pointerMove]);

  const handlePointerUp = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (pointerIdRef.current !== event.pointerId) return;
    if (state.gesture.kind === 'text') {
      commitText(state.prompt);
    } else if (state.gesture.kind === 'semantic-object') {
      void resolveSemanticGesture();
    } else {
      pointerUp({ x: event.clientX, y: event.clientY });
    }
    releasePointer(event);
  }, [
    commitText,
    pointerUp,
    releasePointer,
    resolveSemanticGesture,
    state.gesture.kind,
    state.prompt,
  ]);

  const handleCreateNode = useCallback(() => {
    const separatorIndex = modelId.indexOf('::');
    const providerId = separatorIndex >= 0 ? modelId.slice(0, separatorIndex) : '';
    const selectedModelId = separatorIndex >= 0
      ? modelId.slice(separatorIndex + 2)
      : modelId;
    if (!providerId || !selectedModelId) {
      setError('请选择已配置提供商的图像编辑模型');
      return;
    }
    try {
      const bundle = buildEditIntentBundle(state.annotations, {
        prompt: state.prompt,
        providerId,
        modelId: selectedModelId,
      });
      onCreateNode(bundle);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批注数据无效');
    }
  }, [modelId, onCreateNode, state.annotations, state.prompt]);

  const overlayImage = imageBounds
    ? [{
        id: source.sourceImageId,
        x: imageBounds.left,
        y: imageBounds.top,
        width: imageBounds.width,
        height: imageBounds.height,
      }]
    : [];

  return (
    <div
      data-testid="node-annotation-workspace"
      className="fixed inset-0 z-[210] bg-black/75"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => {
        escape();
        releasePointer(event);
      }}
    >
      <div
        ref={imageFrameRef}
        className="absolute left-1/2 top-[44%] h-[min(64vh,760px)] w-[min(76vw,1120px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border border-white/15 bg-[#0d1117] shadow-2xl"
      >
        <NextImage
          unoptimized
          fill
          sizes="76vw"
          src={source.imageUrl}
          alt={source.label}
          className="object-contain"
          onLoad={(event) => {
            setNaturalSize({
              width: event.currentTarget.naturalWidth || 1,
              height: event.currentTarget.naturalHeight || 1,
            });
          }}
          priority
        />
      </div>

      <AnnotationOverlay
        annotations={state.annotations}
        images={overlayImage}
        zoom={1}
        viewOffset={{ x: 0, y: 0 }}
        gesture={state.gesture}
        viewportOrigin={{ x: 0, y: 0 }}
        brushSize={state.brushSize}
        brushScreenWidths={state.brushScreenWidths}
        selectedAnnotationId={state.selectedAnnotationId}
      />

      <AnnotationComposer
        annotations={state.annotations}
        selectedAnnotationId={state.selectedAnnotationId}
        tool={state.tool}
        prompt={state.prompt}
        modelId={modelId}
        models={models}
        sourceLabel={source.label}
        executeLabel="创建修改节点"
        onToolChange={selectTool}
        onPromptChange={(prompt) => {
          setState((current) => ({ ...current, prompt }));
        }}
        onModelChange={setModelId}
        onSelectAnnotation={(annotationId) => {
          setState((current) => ({
            ...current,
            selectedAnnotationId: annotationId,
          }));
        }}
        onRemoveAnnotation={remove}
        onUpdateInstruction={updateInstruction}
        onExecute={handleCreateNode}
        onCancel={() => undefined}
        error={state.sourceMismatch
          ? '所有批注必须来自同一图片版本'
          : error}
        onClose={onClose}
      />
    </div>
  );
}

'use client';

import NextImage from 'next/image';
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';

import type { CanvasRenderPriority } from '@/lib/canvas-kernel/render-policy';

export type CanvasMediaLoadState =
  | { kind: 'placeholder' }
  | { kind: 'loading' }
  | { kind: 'ready'; naturalWidth: number; naturalHeight: number }
  | { kind: 'broken'; reason: 'missing' | 'decode-failed' | 'unrecoverable' };

export interface CanvasMediaSourceState {
  committedSource: string | null;
  pendingSource: string | null;
  loadState: CanvasMediaLoadState;
  retainedLoadState?: CanvasMediaLoadState;
}

interface CanvasMediaNodeProps {
  imageId: string;
  source: string;
  sourceKind: 'thumbnail' | 'original';
  alt: string;
  width: number;
  height: number;
  priority: CanvasRenderPriority;
  className?: string;
  style?: CSSProperties;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export interface CanvasMediaRenderProps {
  'data-canvas-media-node'?: string;
  'data-canvas-media-state'?: string;
  'data-canvas-media-source'?: string;
  source: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  loading: 'eager' | 'lazy';
  fetchPriority: 'high' | 'auto' | 'low';
  style?: CSSProperties;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError: (event: SyntheticEvent<HTMLImageElement>) => void;
}

function canvasMediaStylesEqual(left?: CSSProperties, right?: CSSProperties): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left) as Array<keyof CSSProperties>;
  const rightKeys = Object.keys(right) as Array<keyof CSSProperties>;
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => left[key] === right[key]);
}

export function areCanvasMediaRenderPropsEqual(
  left: CanvasMediaRenderProps,
  right: CanvasMediaRenderProps,
): boolean {
  return left.source === right.source
    && left['data-canvas-media-node'] === right['data-canvas-media-node']
    && left['data-canvas-media-state'] === right['data-canvas-media-state']
    && left['data-canvas-media-source'] === right['data-canvas-media-source']
    && left.alt === right.alt
    && left.width === right.width
    && left.height === right.height
    && left.className === right.className
    && left.loading === right.loading
    && left.fetchPriority === right.fetchPriority
    && left.onLoad === right.onLoad
    && left.onError === right.onError
    && canvasMediaStylesEqual(left.style, right.style);
}

const StableCanvasImage = memo(function StableCanvasImage({
  'data-canvas-media-node': mediaNode,
  'data-canvas-media-state': mediaState,
  'data-canvas-media-source': mediaSource,
  source,
  alt,
  width,
  height,
  className,
  loading,
  fetchPriority,
  style,
  onLoad,
  onError,
}: CanvasMediaRenderProps) {
  return (
    <NextImage
      unoptimized
      data-canvas-media-node={mediaNode}
      data-canvas-media-state={mediaState}
      data-canvas-media-source={mediaSource}
      src={source}
      alt={alt}
      width={width}
      height={height}
      className={className}
      draggable={false}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      style={style}
      onLoad={onLoad}
      onError={onError}
    />
  );
}, areCanvasMediaRenderPropsEqual);

export function getCanvasMediaLoadingPolicy(priority: CanvasRenderPriority): {
  loading: 'eager' | 'lazy';
  fetchPriority: 'high' | 'auto' | 'low';
} {
  if (priority === 'critical') return { loading: 'eager', fetchPriority: 'high' };
  if (priority === 'visible') return { loading: 'eager', fetchPriority: 'auto' };
  if (priority === 'overscan') return { loading: 'lazy', fetchPriority: 'auto' };
  return { loading: 'lazy', fetchPriority: 'low' };
}

function createCanvasMediaSourceState(source: string): CanvasMediaSourceState {
  if (!source) {
    return {
      committedSource: null,
      pendingSource: null,
      loadState: { kind: 'placeholder' },
    };
  }
  return {
    committedSource: source,
    pendingSource: null,
    loadState: { kind: 'loading' },
  };
}

export function beginCanvasMediaSourceTransition(
  current: CanvasMediaSourceState,
  nextSource: string,
): CanvasMediaSourceState {
  if (!nextSource) {
    return {
      committedSource: current.committedSource,
      pendingSource: null,
      loadState: current.committedSource
        ? { kind: 'broken', reason: 'missing' }
        : { kind: 'placeholder' },
    };
  }
  if (nextSource === current.committedSource) {
    if (current.pendingSource === null) return current;
    return {
      committedSource: current.committedSource,
      pendingSource: null,
      loadState: current.retainedLoadState ?? current.loadState,
    };
  }
  return {
    committedSource: current.committedSource,
    pendingSource: nextSource,
    loadState: { kind: 'loading' },
    retainedLoadState: current.retainedLoadState ?? current.loadState,
  };
}

export function completeCanvasMediaSourceTransition(
  current: CanvasMediaSourceState,
  source: string,
  naturalWidth: number,
  naturalHeight: number,
): CanvasMediaSourceState {
  if (current.pendingSource && current.pendingSource !== source) return current;
  const normalizedWidth = Math.max(1, naturalWidth);
  const normalizedHeight = Math.max(1, naturalHeight);
  if (
    current.committedSource === source
    && current.pendingSource === null
    && current.loadState.kind === 'ready'
    && current.loadState.naturalWidth === normalizedWidth
    && current.loadState.naturalHeight === normalizedHeight
  ) {
    return current;
  }
  return {
    committedSource: source,
    pendingSource: null,
    loadState: {
      kind: 'ready',
      naturalWidth: normalizedWidth,
      naturalHeight: normalizedHeight,
    },
  };
}

export function resolveCanvasMediaLoadedSource(
  current: CanvasMediaSourceState,
  requestedSource: string,
  browserCurrentSource: string,
): string {
  return current.committedSource
    || requestedSource
    || browserCurrentSource;
}

export function CanvasMediaNode({
  imageId,
  source,
  sourceKind,
  alt,
  width,
  height,
  priority,
  className,
  style,
  onError,
}: CanvasMediaNodeProps) {
  const [mediaState, setMediaState] = useState<CanvasMediaSourceState>(() => (
    createCanvasMediaSourceState(source)
  ));
  const loadingPolicy = getCanvasMediaLoadingPolicy(priority);
  const onErrorRef = useRef(onError);

  useLayoutEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!source) {
      setMediaState(current => beginCanvasMediaSourceTransition(current, source));
      return;
    }
    if (source === mediaState.committedSource) {
      if (mediaState.pendingSource !== null) {
        setMediaState(current => beginCanvasMediaSourceTransition(current, source));
      }
      return;
    }
    if (mediaState.pendingSource !== source) {
      setMediaState(current => beginCanvasMediaSourceTransition(current, source));
      return;
    }

    let cancelled = false;
    const probe = new window.Image();
    probe.decoding = 'async';
    const complete = async () => {
      try {
        if (typeof probe.decode === 'function') await probe.decode();
        if (cancelled) return;
        setMediaState(current => completeCanvasMediaSourceTransition(
          current,
          source,
          probe.naturalWidth,
          probe.naturalHeight,
        ));
      } catch {
        if (cancelled) return;
        setMediaState({
          committedSource: source,
          pendingSource: null,
          loadState: { kind: 'broken', reason: 'decode-failed' },
        });
      }
    };
    probe.onload = () => { void complete(); };
    probe.onerror = () => {
      if (cancelled) return;
      setMediaState({
        committedSource: source,
        pendingSource: null,
        loadState: { kind: 'broken', reason: 'decode-failed' },
      });
    };
    probe.src = source;
    return () => { cancelled = true; };
  }, [mediaState.committedSource, mediaState.pendingSource, source]);

  const dimensions = useMemo(() => ({
    width: Math.max(1, Math.round(Math.abs(width))),
    height: Math.max(1, Math.round(Math.abs(height))),
  }), [height, width]);
  const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    setMediaState(current => {
      const loadedSource = resolveCanvasMediaLoadedSource(
        current,
        source,
        element.currentSrc || element.src,
      );
      return completeCanvasMediaSourceTransition(
        current,
        loadedSource,
        element.naturalWidth,
        element.naturalHeight,
      );
    });
  }, [source]);
  const handleError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    setMediaState(current => ({
      committedSource: current.committedSource,
      pendingSource: null,
      loadState: { kind: 'broken', reason: 'decode-failed' },
    }));
    onErrorRef.current?.(event);
  }, []);

  if (!mediaState.committedSource) {
    return (
      <div
        data-canvas-media-node={imageId}
        data-canvas-media-state="placeholder"
        role="status"
        className={`flex h-full w-full items-center justify-center bg-black/10 text-xs text-white/60 ${className || ''}`}
        style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}`, ...style }}
      >
        图片载入中
      </div>
    );
  }

  return (
    <StableCanvasImage
      data-canvas-media-node={imageId}
      data-canvas-media-state={mediaState.loadState.kind}
      data-canvas-media-source={sourceKind}
      source={mediaState.committedSource}
      alt={alt}
      width={dimensions.width}
      height={dimensions.height}
      className={className}
      loading={loadingPolicy.loading}
      fetchPriority={loadingPolicy.fetchPriority}
      style={{
        aspectRatio: `${dimensions.width} / ${dimensions.height}`,
        contain: 'paint',
        ...style,
      }}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

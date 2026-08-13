'use client';

import NextImage from 'next/image';
import React, {
  useEffect,
  useMemo,
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
  if (nextSource === current.committedSource && current.pendingSource === null) return current;
  return {
    committedSource: current.committedSource,
    pendingSource: nextSource,
    loadState: { kind: 'loading' },
  };
}

export function completeCanvasMediaSourceTransition(
  current: CanvasMediaSourceState,
  source: string,
  naturalWidth: number,
  naturalHeight: number,
): CanvasMediaSourceState {
  if (current.pendingSource && current.pendingSource !== source) return current;
  return {
    committedSource: source,
    pendingSource: null,
    loadState: {
      kind: 'ready',
      naturalWidth: Math.max(1, naturalWidth),
      naturalHeight: Math.max(1, naturalHeight),
    },
  };
}

export function resolveCanvasMediaLoadedSource(
  current: CanvasMediaSourceState,
  requestedSource: string,
  browserCurrentSource: string,
): string {
  return current.pendingSource
    || current.committedSource
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

  useEffect(() => {
    if (!source || source === mediaState.committedSource) return;
    setMediaState(current => beginCanvasMediaSourceTransition(current, source));

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
  }, [mediaState.committedSource, source]);

  const dimensions = useMemo(() => ({
    width: Math.max(1, Math.round(Math.abs(width))),
    height: Math.max(1, Math.round(Math.abs(height))),
  }), [height, width]);

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
    <NextImage
      unoptimized
      data-canvas-media-node={imageId}
      data-canvas-media-state={mediaState.loadState.kind}
      data-canvas-media-source={sourceKind}
      src={mediaState.committedSource}
      alt={alt}
      width={dimensions.width}
      height={dimensions.height}
      className={className}
      draggable={false}
      loading={loadingPolicy.loading}
      fetchPriority={loadingPolicy.fetchPriority}
      decoding="async"
      style={{
        aspectRatio: `${dimensions.width} / ${dimensions.height}`,
        contain: 'paint',
        ...style,
      }}
      onLoad={(event) => {
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
      }}
      onError={(event) => {
        setMediaState(current => ({
          ...current,
          pendingSource: null,
          loadState: { kind: 'broken', reason: 'decode-failed' },
        }));
        onError?.(event);
      }}
    />
  );
}

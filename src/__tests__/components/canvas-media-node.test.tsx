import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CanvasMediaNode,
  beginCanvasMediaSourceTransition,
  completeCanvasMediaSourceTransition,
  getCanvasMediaLoadingPolicy,
  resolveCanvasMediaLoadedSource,
} from '@/components/canvas/CanvasMediaNode';
import { CanvasSurface } from '@/components/canvas/CanvasSurface';

describe('CanvasMediaNode', () => {
  it('maps render priority to loading and fetch priority', () => {
    expect(getCanvasMediaLoadingPolicy('critical')).toEqual({ loading: 'eager', fetchPriority: 'high' });
    expect(getCanvasMediaLoadingPolicy('visible')).toEqual({ loading: 'eager', fetchPriority: 'auto' });
    expect(getCanvasMediaLoadingPolicy('overscan')).toEqual({ loading: 'lazy', fetchPriority: 'auto' });
    expect(getCanvasMediaLoadingPolicy('deferred')).toEqual({ loading: 'lazy', fetchPriority: 'low' });
  });

  it('retains the last decoded pixels until a replacement source decodes', () => {
    const loading = beginCanvasMediaSourceTransition({
      committedSource: '/old.png',
      pendingSource: null,
      loadState: { kind: 'ready', naturalWidth: 800, naturalHeight: 600 },
    }, '/new.png');

    expect(loading.committedSource).toBe('/old.png');
    expect(loading.pendingSource).toBe('/new.png');
    expect(loading.loadState).toEqual({ kind: 'loading' });

    expect(completeCanvasMediaSourceTransition(loading, '/new.png', 1600, 1200)).toEqual({
      committedSource: '/new.png',
      pendingSource: null,
      loadState: { kind: 'ready', naturalWidth: 1600, naturalHeight: 1200 },
    });
  });

  it('commits the requested source when the browser expands currentSrc to an absolute URL', () => {
    const loading = beginCanvasMediaSourceTransition({
      committedSource: '/old.png',
      pendingSource: null,
      loadState: { kind: 'ready', naturalWidth: 800, naturalHeight: 600 },
    }, '/new.png');

    expect(resolveCanvasMediaLoadedSource(
      loading,
      '/new.png',
      'https://example.test/new.png',
    )).toBe('/new.png');
  });

  it('renders stable dimensions and explicit media state', () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaNode
        imageId="image-a"
        source="/image-a.png"
        sourceKind="original"
        alt="image a"
        width={320}
        height={240}
        priority="critical"
      />,
    );

    expect(markup).toContain('data-canvas-media-node="image-a"');
    expect(markup).toContain('data-canvas-media-state="loading"');
    expect(markup).toContain('width="320"');
    expect(markup).toContain('height="240"');
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('fetchPriority="high"');
    expect(markup).toContain('decoding="async"');
  });

  it('renders a visible placeholder instead of an empty success frame', () => {
    const markup = renderToStaticMarkup(
      <CanvasMediaNode
        imageId="missing"
        source=""
        sourceKind="original"
        alt="missing"
        width={320}
        height={240}
        priority="visible"
      />,
    );

    expect(markup).toContain('data-canvas-media-state="placeholder"');
    expect(markup).toContain('图片载入中');
  });
});

describe('CanvasSurface', () => {
  it('owns the stable transform surface without changing child markup', () => {
    const markup = renderToStaticMarkup(
      <CanvasSurface offset={{ x: 120, y: 80 }} zoom={1.5}>
        <span>child</span>
      </CanvasSurface>,
    );

    expect(markup).toContain('data-canvas-surface="true"');
    expect(markup).toContain('translate(120px, 80px) scale(1.5)');
    expect(markup).toContain('<span>child</span>');
  });
});

describe('infinite canvas render projection wiring', () => {
  it('uses the projection, media node, surface and incremental spatial updates', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n');

    expect(source).toContain("import { CanvasMediaNode } from '@/components/canvas/CanvasMediaNode'");
    expect(source).toContain("import { CanvasSurface } from '@/components/canvas/CanvasSurface'");
    expect(source).toContain('buildCanvasRenderProjection(');
    expect(source).toContain('getMountedCanvasRenderItems(');
    expect(source).toMatch(/\b\w+\.applyChanges\(/);
    expect(source).toContain('<CanvasMediaNode');
    expect(source).toContain('<CanvasSurface');
    expect(source).not.toContain('const index = new CanvasSpatialIndex();\n    index.rebuild(images);');
  });
});

describe('canvas media lint contract', () => {
  it('uses the existing unoptimized Next image path instead of adding a native image warning', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/canvas/CanvasMediaNode.tsx'),
      'utf8',
    );

    expect(source).toContain("import NextImage from 'next/image'");
    expect(source).toContain('<NextImage');
    expect(source).not.toContain('<img');
  });
});

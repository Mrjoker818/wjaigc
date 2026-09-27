import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { commitCanvasImageRefChange } from '@/lib/collaboration/canvas-document-image-bridge';

function sizeEffect(bindings: Record<string, unknown>): () => (() => void) | undefined {
  const path = resolve('src/components/infinite-canvas.tsx');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0]?.getText(source).includes('imagesNeedingSize')) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!effect) throw new Error('Production size recovery effect not found');
  const js = ts.transpileModule(`const effect = ${effect.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return effect;`)(...Object.values(bindings));
}

function setup(originalWidth?: number, originalHeight?: number, secondImage = false) {
  const loads: Array<{ onload?: () => void; onerror?: () => void; src: string }> = [];
  class TestImage {
    naturalWidth = 1254;
    naturalHeight = 1254;
    src = '';
    onload?: () => void;
    onerror?: () => void;
    constructor() { loads.push(this); }
  }
  const image = { id: 'restored', url: '/cake.png', width: 420, height: 420, originalWidth, originalHeight };
  const images = secondImage ? [image, { ...image, id: 'other', url: '/other.png' }] : [image];
  const imagesRef = { current: images };
  const onImagesChange = vi.fn();
  const run = sizeEffect({ images, imagesRef, onImagesChange, commitCanvasImageRefChange,
    sizeFillAttemptedRef: { current: new Set<string>() }, window: { Image: TestImage } });
  return { run, loads, onImagesChange, imagesRef };
}

describe('production canvas image size recovery', () => {
  it.each([[undefined, undefined], [1, 1]])('fills real dimensions for placeholder %s x %s', async (width, height) => {
    const test = setup(width, height);
    test.run();
    expect(test.loads).toHaveLength(1);
    test.loads[0].onload!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.onImagesChange).toHaveBeenCalledWith([
      expect.objectContaining({ originalWidth: 1254, originalHeight: 1254, width: 420, height: 420 }),
    ]);
  });

  it('does not apply dimensions from an old URL to a replaced image', async () => {
    const test = setup();
    test.run();
    test.imagesRef.current = [{ ...test.imagesRef.current[0], url: '/new.png' }];
    test.loads[0].onload!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.onImagesChange).not.toHaveBeenCalled();
  });

  it('retries an interrupted read after effect cleanup without applying the old result', async () => {
    const test = setup();
    const cleanup = test.run();
    const lateLoad = test.loads[0].onload!;
    cleanup!();
    test.run();
    expect(test.loads).toHaveLength(2);
    lateLoad();
    await Promise.resolve();
    expect(test.onImagesChange).not.toHaveBeenCalled();
    test.loads[1].onload!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.onImagesChange).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed URL on every render or change the original image', async () => {
    const test = setup();
    const cleanup = test.run();
    test.loads[0].onerror!();
    await Promise.resolve();
    await Promise.resolve();
    cleanup!();
    test.run();
    expect(test.loads).toHaveLength(1);
    expect(test.onImagesChange).not.toHaveBeenCalled();
  });

  it('does not restore an image deleted while dimensions are loading', async () => {
    const test = setup();
    test.run();
    test.imagesRef.current = [];
    test.loads[0].onload!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.onImagesChange).not.toHaveBeenCalled();
  });

  it('allows a new URL for the same image after the previous URL failed', () => {
    const test = setup();
    const cleanup = test.run();
    test.loads[0].onerror!();
    cleanup!();
    test.imagesRef.current[0].url = '/recovered.png';
    test.run();
    expect(test.loads).toHaveLength(2);
    expect(test.loads[1].src).toBe('/recovered.png');
  });

  it('fills a completed image without waiting for another image and preserves both updates', async () => {
    const test = setup(undefined, undefined, true);
    test.run();
    test.loads[0].onload!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(test.onImagesChange).toHaveBeenCalledTimes(1);
    test.loads[1].onload!();
    await Promise.resolve();
    expect(test.onImagesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'restored', originalWidth: 1254 }),
      expect.objectContaining({ id: 'other', originalWidth: 1254 }),
    ]);
  });
});

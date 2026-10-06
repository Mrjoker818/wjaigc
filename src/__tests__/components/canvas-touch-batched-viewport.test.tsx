// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useCallback, useRef } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { applyCanvasTouchIntent, useCanvasViewport } from '@/components/canvas/use-canvas-viewport';
import type { CanvasKernelMode } from '@/lib/canvas-kernel/mode';
import type { CanvasPersistedViewport, CanvasPoint } from '@/lib/canvas-kernel/types';
import { createCanvasTouchGestureController, type CanvasTouchIntent,
  type CanvasTouchSample } from '@/lib/canvas-touch-gestures';

interface TouchConsumerResult {
  zoom: number;
  viewOffset: CanvasPoint;
  applyTouchGestureIntent: (intent: CanvasTouchIntent) => void;
}

// Execute the current InfiniteCanvas viewport declaration, render-ref update,
// and touch callback, not a copied implementation or source-text assertion.
// React batching, the gesture controller and viewport state remain real.
function loadTouchConsumer(): (
  canvasKernelMode: CanvasKernelMode,
  normalizedInitialViewState: CanvasPersistedViewport,
  canvasTransformRef: { current: HTMLDivElement | null },
) => TouchConsumerResult {
  const path = resolve('src/components/infinite-canvas.tsx');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      if (node.initializer.expression.getText(source) === 'useCanvasViewport') {
        declarations.set('viewport', `const ${node.getText(source)};`);
      }
      if (node.name.getText(source) === 'zoomRef' || node.name.getText(source) === 'applyTouchGestureIntent') {
        declarations.set(node.name.getText(source), `const ${node.getText(source)};`);
      }
    }
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
      && node.expression.left.getText(source) === 'zoomRef.current') {
      declarations.set('zoomRefUpdate', node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const pieces = ['viewport', 'zoomRef', 'zoomRefUpdate', 'applyTouchGestureIntent'].map(key => {
    const piece = declarations.get(key);
    if (!piece) throw new Error(`InfiniteCanvas touch consumer declaration missing: ${key}`);
    return piece;
  });
  const js = ts.transpileModule(`
    return function useActualTouchConsumer(canvasKernelMode, normalizedInitialViewState, canvasTransformRef) {
      const canvasRef = canvasTransformRef;
      const touchGestureExclusiveRef = useRef(false);
      const viewportPanPointerIdRef = useRef(null);
      const directPanPointerIdRef = useRef(null);
      const imageDragPointerIdRef = useRef(null);
      ${pieces.join('\n')}
      return { zoom, viewOffset, applyTouchGestureIntent };
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  // These unrelated selection/UI side effects are not part of the pinch path.
  const noop = (): void => {};
  const bindings = {
    useCallback, useRef, useCanvasViewport, applyCanvasTouchIntent,
    handlePanViewportSync: noop, setIsPanning: noop, setIsMiddlePanning: noop,
    setIsLongPressing: noop, cancelSelectionGesture: noop, cancelImageDragPreview: noop,
    rollbackHistoryTransaction: noop, openContextMenuAt: noop,
  };
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings)) as ReturnType<typeof loadTouchConsumer>;
}

const useActualTouchConsumer = loadTouchConsumer();

function touch(pointerId: number, x: number): CanvasTouchSample {
  return { pointerId, pointerType: 'touch', point: { x, y: 480 }, target: 'blank' };
}

afterEach(cleanup);

describe.each<CanvasKernelMode>(['legacy', 'shadow', 'canvas-v2'])('batched touch viewport (%s)', mode => {
  it.each([{ initial: 1, want: 1.5 }, { initial: 1.44, want: 2.16 }])(
    'keeps both pinch increments before React renders (initial $initial)', ({ initial, want }) => {
      const transformRef = { current: document.createElement('div') };
      const { result } = renderHook(() => useActualTouchConsumer(mode,
        { offsetX: 0, offsetY: 0, zoom: initial }, transformRef));
      const controller = createCanvasTouchGestureController();
      const apply = (intents: CanvasTouchIntent[]): void => {
        intents.forEach(intent => result.current.applyTouchGestureIntent(intent));
      };
      try {
        act(() => {
          apply(controller.pointerDown(touch(1, 140)));
          apply(controller.pointerDown(touch(2, 260)));
        });
        // One native touch move produces two pointer moves: 120 -> 150 -> 180px.
        // No intermediate act/render: 1.25 * 1.2 must be 1.5, not just 1.2.
        act(() => {
          apply(controller.pointerMove(touch(1, 110)));
          apply(controller.pointerMove(touch(2, 290)));
        });
        expect(result.current.zoom).toBe(want);
      } finally {
        controller.dispose();
      }
    },
  );

  it('preserves opposite pinch increments in the same render batch', () => {
    const transformRef = { current: document.createElement('div') };
    const { result } = renderHook(() => useActualTouchConsumer(mode,
      { offsetX: 0, offsetY: 0, zoom: 1 }, transformRef));
    const controller = createCanvasTouchGestureController();
    const apply = (intents: CanvasTouchIntent[]): void => {
      intents.forEach(intent => result.current.applyTouchGestureIntent(intent));
    };
    try {
      act(() => {
        apply(controller.pointerDown(touch(1, 140)));
        apply(controller.pointerDown(touch(2, 260)));
      });
      act(() => {
        apply(controller.pointerMove(touch(1, 110)));
        apply(controller.pointerMove(touch(2, 290)));
        apply(controller.pointerMove(touch(2, 260)));
        apply(controller.pointerMove(touch(1, 140)));
      });
      expect(result.current.zoom).toBe(1);
    } finally {
      controller.dispose();
    }
  });
});

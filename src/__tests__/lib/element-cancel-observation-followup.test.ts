import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelElementDecomposition, pollElementDecomposition, type ElementDecomposeTaskResponse } from '@/lib/element-decomposition/client';
import { cancelElementDecompositionObserved } from '@/lib/element-decomposition/cancel-observation';

let observer: AbortController;
let operations: string[];
let deleting: 'unsupported' | 'network-error' | 'unknown' | 'confirmed';
let reads: number;
let mayReadFinal: boolean;
let releaseRead: (() => void) | undefined;
const task = (status: 'processing' | 'failed' | 'cancelled'): ElementDecomposeTaskResponse => ({
  taskId: 'original-parent-14', status, overallStatus: status, progress: status === 'processing' ? 20 : 100,
  source: { sourceImageId: 'original-image', canonicalUrl: '/original.png', managedUrl: '/original.png',
    sha256: 'a'.repeat(64), width: 300, height: 300, mimeType: 'image/png' },
  branches: { board: { branch: 'board', taskId: 'original-board-14', status, progress: 20,
    result: { originalCreditCost: 14 }, error: status === 'failed' ? 'provider failed' : undefined } },
});

/** Execute the actual UI callback in both phases, with real client/observation logic. */
async function action(): Promise<unknown> {
  const file = path.resolve('src/components/infinite-canvas.tsx');
  const text = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleCancelElementDecomposition'
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!callback) throw Error('Existing cancellation callback not found');
  const code = ts.transpileModule(`const invoke = ${callback.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const scope = vm.createContext({ elementDecomposeTask: task('processing'),
    elementDecomposeControllerRef: { current: observer }, cancelElementDecomposition, cancelElementDecompositionObserved,
    setElementDecomposeTask: () => {}, elementDecomposePlaceholderRef: { current: null },
    removeProcessingFrame: () => {}, toast: { success() {}, error() {}, info() {} }, Error });
  vm.runInContext(code, scope);
  return vm.runInContext('invoke()', scope);
}

beforeEach(() => {
  observer = new AbortController(); operations = []; deleting = 'unsupported'; reads = 0;
  mayReadFinal = false; releaseRead = undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/element-decompose?taskId=original-parent-14');
    const method = init?.method || 'GET'; operations.push(method);
    if (method === 'DELETE') {
      mayReadFinal = true; releaseRead?.();
      if (deleting === 'network-error') throw new TypeError('synthetic connection lost');
      if (deleting === 'unsupported') return Response.json({ success: false, message: 'provider does not support cancellation', retryable: true }, { status: 500 });
      return Response.json(task(deleting === 'confirmed' ? 'cancelled' : 'processing'));
    }
    expect(method).toBe('GET');
    reads++;
    if (reads > 1 && !mayReadFinal) {
      await new Promise<void>((resolve, reject) => {
        releaseRead = resolve;
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        if (init?.signal?.aborted) reject(init.signal.reason);
      });
    }
    init?.signal?.throwIfAborted();
    return Response.json(task(reads === 1 ? 'processing' : 'failed'));
  }));
});
afterEach(() => { observer.abort(); vi.unstubAllGlobals(); });

it('keeps reading the same charged original task after an unsupported cancellation without a new paid submit (P2)', async () => {
  const states: string[] = [];
  const polling = pollElementDecomposition('original-parent-14', value => states.push(value.overallStatus), observer.signal, 0)
    .catch(() => undefined);
  await vi.waitFor(() => expect(states).toContain('processing'));
  await action().catch(() => undefined);
  expect(observer.signal.aborted).toBe(false);
  const final = await polling;
  expect(final?.overallStatus).toBe('failed');
  expect(states.at(-1)).toBe('failed');
  expect(operations.filter(method => method === 'DELETE')).toHaveLength(1);
  expect(operations.every(method => method === 'GET' || method === 'DELETE')).toBe(true);
  expect(final?.branches.board?.result).toEqual({ originalCreditCost: 14 });
});

it.each(['network-error', 'unknown'] as const)('does not abort observation or invent a terminal state on %s cancellation', async mode => {
  deleting = mode;
  await action().catch(() => undefined);
  expect(observer.signal.aborted).toBe(false);
  expect(operations).toEqual(['DELETE']);
});

it('stops observation only after the server returns the confirmed terminal cancellation', async () => {
  deleting = 'confirmed';
  await action();
  expect(observer.signal.aborted).toBe(true);
  expect(operations).toEqual(['DELETE']);
});

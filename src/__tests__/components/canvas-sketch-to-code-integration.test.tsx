// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';
import type { SketchScope } from '@/lib/sketch-to-code/client';

function actual<T>(name: string, bindings: Record<string, unknown>): T {
  const source = ts.createSourceFile('workspace.tsx', readFileSync('src/components/canvas-workspace.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = '';
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) text = `const ${name} = ${node.initializer.arguments[0].getText(source)};`;
    ts.forEachChild(node, visit);
  }; visit(source);
  if (!text) throw new Error(`Actual callback missing: ${name}`);
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), `${js};return ${name};`)(...Object.values(bindings)) as T;
}
function scopeFixture(mode = 'legacy') {
  const actor = { current: { id: 'u1' } }, project = { current: { id: 'p1' } }, epoch = { current: 1 }, history = { current: 'p1' };
  const authority = { current: { projectId: 'p1', authority: mode, recordMediaHistory: (): void => {}, refreshMedia: async (): Promise<CanvasImage[]> => [], isSessionActive: (): boolean => true, isWritable: (): boolean => true } };
  const mounted = { current: true }, pending = { current: false }, recovery = { current: false };
  const capture = actual<() => SketchScope>('captureSketchScope', { currentUserRef: actor, currentProjectRef: project, historyTransitionEpochRef: epoch, historyProjectIdRef: history,
    collaborativeCanvasRef: authority, isMountedRef: mounted, historyLifecyclePendingRef: pending, isDocumentHistoryRecoveryPending: (): boolean => recovery.current, sketchContextKey: 'scope1' });
  return { actor, project, epoch, history, authority, mounted, pending, recovery, capture };
}
beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string): string | null => items.get(key) ?? null, setItem: (key: string, value: string): void => { items.set(key, value); }, removeItem: (key: string): void => { items.delete(key); } });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('actual canvas sketch integration', () => {
  it.each(['actor', 'project', 'epoch', 'history', 'authority', 'generation', 'refresh', 'pending', 'recovery', 'unmount'] as const)('fences the actual parent scope when %s changes', change => {
    const f = scopeFixture(); const scope = f.capture(); scope.assertCurrent(true);
    if (change === 'actor') f.actor.current.id = 'u2'; if (change === 'project') f.project.current.id = 'p2';
    if (change === 'epoch') f.epoch.current++; if (change === 'history') f.history.current = 'p2';
    if (change === 'authority') f.authority.current.authority = 'document';
    if (change === 'generation') f.authority.current.recordMediaHistory = (): void => {};
    if (change === 'refresh') f.authority.current.refreshMedia = async (): Promise<CanvasImage[]> => [];
    if (change === 'pending') f.pending.current = true; if (change === 'recovery') f.recovery.current = true;
    if (change === 'unmount') f.mounted.current = false;
    expect(() => scope.assertCurrent()).toThrow();
  });
  it('allows current document reads only and rejects invalid session, unknown authority and write loss', () => {
    const f = scopeFixture('document'); const scope = f.capture(); scope.assertCurrent();
    f.authority.current.isWritable = (): boolean => false;
    scope.assertCurrent(false); expect(() => scope.assertCurrent(true)).toThrow();
    f.authority.current.isSessionActive = (): boolean => false; expect(() => scope.assertCurrent()).toThrow();
    expect(() => scopeFixture('unknown').capture().assertCurrent()).toThrow();
  });
  it.each(['desktop', 'mobile'] as const)('opens the registered lazy drawer from the original %s action catalog without changing the five mobile slots', async entry => {
    const f = scopeFixture(); const view = render(<InfiniteCanvas projectId="p1" images={[]} selectedImage={null} onImagesChange={() => true} onSelectImage={() => {}} onPreviewImage={() => {}} onGenerateVariation={() => {}} onExtractKeywords={() => {}} onFusion={() => {}} onAddImages={() => {}} onRequestTaskPoll={async () => new Response('{}')}
      sketchContext={{ key: 'scope1', captureScope: f.capture, insert: async () => {} }} />);
    const toolbar = entry === 'mobile' ? view.container.querySelector('[data-mobile-canvas-toolbar]')! : view.container.querySelector('[data-toolbar="bottom-toolbar"]')!;
    expect(view.container.querySelectorAll('[data-mobile-toolbar-primary]')).toHaveLength(5);
    fireEvent.click(toolbar.querySelector('button[aria-label="全部工具"]')!);
    const actions = entry === 'mobile' ? screen.getByRole('dialog', { name: '全部工具' }) : document.getElementById('canvas-bottom-toolbar-drawer')!;
    fireEvent.click(within(actions as HTMLElement).getByRole('button', { name: '草图转代码' }));
    expect(await screen.findByRole('region', { name: '草图转代码' })).toBeDefined();
    expect(view.container.querySelector('[data-canvas-active-tool]')?.getAttribute('data-canvas-active-tool')).toBe('sketch-to-code');
    const onUndo = vi.fn(); window.addEventListener('keydown', onUndo);
    fireEvent.keyDown(screen.getByLabelText('页面说明'), { key: 'Delete' });
    fireEvent.keyDown(screen.getByLabelText('绘图区'), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '草图转代码' })).toBeNull(); expect(onUndo).not.toHaveBeenCalled(); window.removeEventListener('keydown', onUndo);
  });
});

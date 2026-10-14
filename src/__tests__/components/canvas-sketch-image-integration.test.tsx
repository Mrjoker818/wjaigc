// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SketchPanelSession, SketchScope } from '@/lib/sketch-to-code/client';
import type { SketchImagePanelSession } from '@/lib/sketch-to-code/image-client';
const seen = vi.hoisted(() => ({ props: undefined as { session: SketchPanelSession; imageSession?: SketchImagePanelSession; onClose: () => void } | undefined }));
vi.mock('@/components/sketch-to-code-panel', () => ({ SketchToCodePanel: (props: NonNullable<typeof seen.props>) => {
  seen.props = props;
  return React.createElement('section', { role: 'region', 'aria-label': 'controlled sketch panel' }, React.createElement('button', { onClick: props.onClose }, 'close controlled panel'));
} }));
import { InfiniteCanvas } from '@/components/infinite-canvas';
function scope(key = 'scope1', projectId = 'p1'): SketchScope {
  return { actorId: 'u1', projectId, key, authority: 'legacy', assertCurrent: () => {} };
}
function props(current: SketchScope, enabled?: boolean): React.ComponentProps<typeof InfiniteCanvas> & { sketchImageEnabled?: boolean } {
  return { projectId: current.projectId, images: [], selectedImage: null, onImagesChange: () => true, onSelectImage: () => {}, onPreviewImage: () => {},
    onGenerateVariation: () => {}, onExtractKeywords: () => {}, onAddImages: () => {}, onFusion: () => {}, onRequestTaskPoll: async () => new Response('{}'),
    sketchContext: { key: current.key, captureScope: () => current, insert: async () => {} }, ...(enabled === undefined ? {} : { sketchImageEnabled: enabled }) };
}
beforeEach(() => {
  seen.props = undefined;
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string): string | null => items.get(key) ?? null, setItem: (key: string, value: string): void => { items.set(key, value); }, removeItem: (key: string): void => { items.delete(key); } });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open(view: ReturnType<typeof render>, label: string): Promise<NonNullable<typeof seen.props>> {
  const toolbar = view.container.querySelector('[data-toolbar="bottom-toolbar"]')!;
  fireEvent.click(toolbar.querySelector('button[aria-label="全部工具"]')!);
  const actions = document.getElementById('canvas-bottom-toolbar-drawer')!;
  fireEvent.click(within(actions).getByRole('button', { name: label }));
  await screen.findByRole('region', { name: 'controlled sketch panel' });
  expect(seen.props).toBeDefined(); return seen.props!;
}
describe('actual canvas image-session opt-in integration; controlled panel, no generation', () => {
  it('keeps code-only embedding compatibility when the runtime image gate is absent', async () => {
    const view = render(<InfiniteCanvas {...props(scope())} />), panel = await open(view, '草图转代码');
    expect(panel.imageSession).toBeUndefined(); expect(panel.session.client.scope.projectId).toBe('p1');
  });
  it('creates two separate original scoped clients and passes no second drawing history', async () => {
    const current = scope(), view = render(<InfiniteCanvas {...props(current, true)} />), panel = await open(view, '草图创作');
    expect(panel.imageSession).toBeDefined(); expect(panel.imageSession!.client.scope).toEqual(current); expect(Object.isFrozen(panel.imageSession!.client.scope)).toBe(true);
    expect(panel.session.client.scope).toBe(current); expect(panel.imageSession!.client.scope.assertCurrent).toBe(current.assertCurrent);
    expect(panel.imageSession!.client).not.toBe(panel.session.client); expect('history' in panel.imageSession!).toBe(false);
    expect(view.container.querySelectorAll('[data-mobile-toolbar-primary]')).toHaveLength(5);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/sketch-to-'))).toBe(false);
  });
  it('closes both read clients and reopens the same scoped draft without generation or cancellation', async () => {
    const view = render(<InfiniteCanvas {...props(scope(), true)} />), first = await open(view, '草图创作');
    const code = vi.spyOn(first.session.client, 'stop'), image = vi.spyOn(first.imageSession!.client, 'stop');
    fireEvent.click(screen.getByRole('button', { name: 'close controlled panel' }));
    expect(code).toHaveBeenCalled(); expect(image).toHaveBeenCalled();
    const second = await open(view, '草图创作'); expect(second.session).toBe(first.session); expect(second.imageSession).toBe(first.imageSession);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /sketch-to-|cancel-task/.test(String(url)))).toBe(false);
  });
  it('stops both old scoped clients on project change and opens fresh original scope', async () => {
    const view = render(<InfiniteCanvas {...props(scope(), true)} />), first = await open(view, '草图创作');
    const code = vi.spyOn(first.session.client, 'stop'), image = vi.spyOn(first.imageSession!.client, 'stop');
    view.rerender(<InfiniteCanvas {...props(scope('scope2', 'p2'), true)} />);
    expect(code).toHaveBeenCalled(); expect(image).toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'controlled sketch panel' })).toBeNull();
    const next = await open(view, '草图创作'); expect(next.imageSession).not.toBe(first.imageSession); expect(next.imageSession!.client.scope.projectId).toBe('p2');
  });
  it('stops an image draft when its runtime gate is withdrawn, without a hidden server cancellation', async () => {
    const current = scope(), view = render(<InfiniteCanvas {...props(current, true)} />), first = await open(view, '草图创作');
    const stop = vi.spyOn(first.imageSession!.client, 'stop'); view.rerender(<InfiniteCanvas {...props(current, false)} />);
    expect(stop).toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'controlled sketch panel' })).toBeNull();
    const codeOnly = await open(view, '草图转代码'); expect(codeOnly.imageSession).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/cancel-task'))).toBe(false);
  });
});

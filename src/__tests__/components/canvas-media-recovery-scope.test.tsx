// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { installJsdomMediaQueries, runJsdomFixtureCleanup } from '../helpers/jsdom-browser-apis';
import { InfiniteCanvas, type CanvasImage } from '@/components/infinite-canvas';

const recovery = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/asset-core/canvas-media-recovery-client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/asset-core/canvas-media-recovery-client')>(),
  recoverCanvasMediaUntilTerminal: recovery.execute,
}));

const original: CanvasImage = {
  id: 'same-id', url: '/original.png', prompt: '原项目', x: 0, y: 0, width: 200, height: 200,
  createdAt: 1, assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
  mediaAvailability: 'missing', mediaErrorCode: 'SYNTHETIC_MISSING',
};
const replacement: CanvasImage = {
  ...original, url: '/replacement.png', prompt: '新项目', assetId: 'asset-b',
  assetVersionId: 'version-b', placementId: 'placement-b',
};

function deferred(): { promise: Promise<{ recovered: boolean; availability: 'ready'; url: string }>; resolve: () => void; reject: () => void } {
  let resolve!: (value: { recovered: boolean; availability: 'ready'; url: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ recovered: boolean; availability: 'ready'; url: string }>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve: () => resolve({ recovered: true, availability: 'ready', url: '/old-recovery.png' }), reject: () => reject(new Error('synthetic failure')) };
}

function canvas(project: string, actor: string, image: CanvasImage, onChange: (images: CanvasImage[]) => void): React.JSX.Element {
  return <InfiniteCanvas images={[image]} projectId={project} canvasGeneratorActorId={actor}
    onImagesChange={onChange} selectedImage={null} onSelectImage={() => undefined}
    onPreviewImage={() => undefined} onGenerateVariation={() => undefined} onExtractKeywords={() => undefined}
    onFusion={() => undefined} onAddImages={() => undefined}
    onRequestTaskPoll={async (): Promise<Response> => new Response('{}')} />;
}

let restoreMedia: (() => void) | undefined;
beforeEach(() => {
  restoreMedia = installJsdomMediaQueries(window, { colorScheme: 'light', reducedMotion: false });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear() });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', async (): Promise<Response> => new Response('{}'));
  recovery.execute.mockReset();
});
afterEach(() => { runJsdomFixtureCleanup([cleanup, () => { restoreMedia?.(); restoreMedia = undefined; }]); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('canvas media recovery scope', () => {
  it.each([
    { name: 'project change', project: 'project-b', actor: 'actor-a', image: replacement },
    { name: 'account change', project: 'project-a', actor: 'actor-b', image: replacement },
    { name: 'same-id asset replacement', project: 'project-a', actor: 'actor-a', image: replacement },
  ])('does not apply an earlier recovery after $name', async ({ project, actor, image }) => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    const broken = view.container.querySelector('[data-canvas-missing-media]');
    expect(broken).not.toBeNull();
    fireEvent.click(within(broken as HTMLElement).getByRole('button', { name: '重试' }));
    expect(recovery.execute).toHaveBeenCalledTimes(1);
    view.rerender(canvas(project, actor, image, onChange));
    onChange.mockClear();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not apply an old result after leaving and returning to the original project', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    const broken = view.container.querySelector('[data-canvas-missing-media]')!;
    fireEvent.click(within(broken as HTMLElement).getByRole('button', { name: '重试' }));
    view.rerender(canvas('project-b', 'actor-a', replacement, onChange));
    view.rerender(canvas('project-a', 'actor-a', original, onChange));
    onChange.mockClear();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still applies the successful recovery to the unchanged image', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    const broken = view.container.querySelector('[data-canvas-missing-media]')!;
    fireEvent.click(within(broken as HTMLElement).getByRole('button', { name: '重试' }));
    onChange.mockClear();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      id: 'same-id', assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
      url: '/old-recovery.png', mediaAvailability: 'ready',
    })]);
  });

  it('does not apply an earlier recovery failure after changing projects', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    view.rerender(canvas('project-b', 'actor-a', replacement, onChange));
    onChange.mockClear();
    await act(async () => { pending.reject(); await pending.promise.catch(() => undefined); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'project', project: 'project-b', actor: 'actor-a' },
    { name: 'account', project: 'project-a', actor: 'actor-b' },
  ])('aborts the previous recovery when the $name changes', async ({ project, actor }) => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const view = render(canvas('project-a', 'actor-a', original, vi.fn()));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    const signal = recovery.execute.mock.calls[0][0].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    view.rerender(canvas(project, actor, replacement, vi.fn()));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(); await pending.promise; });
  });

  it('aborts the recovery when the canvas unmounts', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const view = render(canvas('project-a', 'actor-a', original, vi.fn()));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    const signal = recovery.execute.mock.calls[0][0].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(); await pending.promise; });
  });

  it('does not replace a newer URL while the same asset is still recovering', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    view.rerender(canvas('project-a', 'actor-a', { ...original, url: '/newer.png', mediaAvailability: 'recovering' }, onChange));
    onChange.mockClear();
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still reports a failure on the unchanged image', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    onChange.mockClear();
    await act(async () => { pending.reject(); await pending.promise.catch(() => undefined); });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({
      id: 'same-id', assetId: 'asset-a', mediaAvailability: 'missing', mediaErrorCode: 'MEDIA_RECOVERY_FAILED',
    })]);
  });

  it('does not send a recovery request when the canvas rejects the initial change', async () => {
    const onChange = vi.fn(() => false);
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(recovery.execute).not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
  });

  it('does not claim success if the recovered image is rejected by the canvas', async () => {
    const pending = deferred(); recovery.execute.mockReturnValue(pending.promise);
    const onChange = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const success = vi.spyOn(toast, 'success');
    const view = render(canvas('project-a', 'actor-a', original, onChange));
    fireEvent.click(within(view.container.querySelector('[data-canvas-missing-media]') as HTMLElement).getByRole('button', { name: '重试' }));
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(success).not.toHaveBeenCalled();
  });
});

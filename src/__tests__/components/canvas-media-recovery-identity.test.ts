import { describe, expect, it, vi } from 'vitest';
import { recoverCanvasMediaUntilTerminal } from '@/lib/asset-core/canvas-media-recovery-client';

const image = { assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a' };
const response = (url: string): Response => Response.json({ recovered: true, availability: 'ready', url });

describe('media recovery shared polling identity', () => {
  it('does not share one account’s response with another account', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response('/account-a.png')).mockResolvedValueOnce(response('/account-b.png'));
    const first = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, maxAttempts: 1 });
    const second = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-b', image, fetcher, maxAttempts: 1 });
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ url: '/account-a.png' }, { url: '/account-b.png' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not share a response between distinct placements', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response('/first.png')).mockResolvedValueOnce(response('/second.png'));
    const first = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, maxAttempts: 1 });
    const second = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image: { ...image, placementId: 'placement-b' }, fetcher, maxAttempts: 1 });
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ url: '/first.png' }, { url: '/second.png' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not share a pending request across distinct cancellation scopes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response('/first.png')).mockResolvedValueOnce(response('/second.png'));
    const a = new AbortController(); const b = new AbortController();
    const first = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, signal: a.signal, maxAttempts: 1 });
    const second = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, signal: b.signal, maxAttempts: 1 });
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ url: '/first.png' }, { url: '/second.png' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-flight request when its scope is cancelled', async () => {
    let sentSignal: AbortSignal | undefined;
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      sentSignal = init?.signal ?? undefined;
      return new Promise<Response>(resolve => { finish = resolve; });
    });
    const controller = new AbortController();
    const result = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, signal: controller.signal, maxAttempts: 1 });
    controller.abort();
    try { expect(sentSignal?.aborted).toBe(true); } finally { finish(response('/late.png')); await result.catch(() => undefined); }
  });

  it('keeps sharing requests inside the same cancellation scope', async () => {
    const fetcher = vi.fn().mockResolvedValue(response('/same.png'));
    const controller = new AbortController();
    const first = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, signal: controller.signal, maxAttempts: 1 });
    const second = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, signal: controller.signal, maxAttempts: 1 });
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ url: '/same.png' }, { url: '/same.png' }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not start another poll when cancelled during the wait', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ recovered: false, availability: 'recovering', deferred: true }));
    let finishWait!: () => void;
    const wait = vi.fn(() => new Promise<void>(resolve => { finishWait = resolve; }));
    const controller = new AbortController();
    const result = recoverCanvasMediaUntilTerminal({ projectId: 'project-a', actorId: 'actor-a', image, fetcher, wait, signal: controller.signal, maxAttempts: 2 });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    finishWait();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

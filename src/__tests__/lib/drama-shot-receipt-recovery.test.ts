import { describe, expect, it, vi } from 'vitest';
import { isRetryableTake, runShot, type RunShotOptions } from '@/lib/drama/shot-runner';
import type { DramaProjectV1, DramaShot, DramaTake } from '@/lib/drama/types';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const shot: DramaShot = {
  id: 'shot_1', index: 0, title: '镜头', purpose: '', actionBeat: '', prompt: '雨夜', duration: 5,
  durationSec: 5, aspectRatio: '9:16', references: [], continuityNotes: [], status: 'planned', takes: [],
};
const doc: DramaProjectV1 = {
  schemaId: 'drama-project-v1', title: '雨夜', genre: '', style: 'music-video', aspectRatio: '9:16',
  episodes: [], cast: [], locations: [], props: [], timeline: { transition: 'cut', transitionSec: 0, subtitles: false },
};
const base = { doc, shot, modelId: 'video-v1', providerId: 'provider_1', capability: { imageToVideo: false, maxReferenceImages: 0 } };

describe('shot original receipt safety', () => {
  it('awaits durable saving of the same take and model before the sole paid submission', async () => {
    let saved: DramaTake | undefined;
    let release!: () => void;
    const savedGate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/video/generate') {
        expect(saved).toMatchObject({ status: 'submitted', modelId: 'video-v1', providerId: 'provider_1' });
        expect(new Headers(init?.headers).get('idempotency-key')).toBe(`drama:shot_1:${saved!.id}`);
        return json({ taskId: 'task_1' });
      }
      return json({ status: 'completed', videoUrl: '/video.mp4' });
    });
    const before = vi.fn(async (take: DramaTake) => { saved = { ...take }; await savedGate; });
    const pending = runShot({ ...base, fetch: fetcher, sleep: async () => {}, onBeforeSubmit: before } as RunShotOptions);
    await vi.waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    expect(fetcher).not.toHaveBeenCalled();
    release();
    expect(await pending).toMatchObject({ id: saved!.id, status: 'completed', taskId: 'task_1' });
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/video/generate')).toHaveLength(1);
  });

  it('aborts without submitting when durable saving rejects', async () => {
    const fetcher = vi.fn(async () => json({ taskId: 'must-not-submit' }));
    const take = await runShot({ ...base, fetch: fetcher, onBeforeSubmit: async () => { throw new Error('save rejected'); }, timeoutMs: 0 } as RunShotOptions);
    expect(take).toMatchObject({ status: 'failed', error: 'save rejected' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['network', 'malformed', 'gateway', 'unstructured-rejection'])('keeps an ambiguous %s submission pending and never retries it', async failure => {
    const fetcher = vi.fn(async () => {
      if (failure === 'network') throw new TypeError('connection lost after charge');
      if (failure === 'unstructured-rejection') return new Response('proxy refused response', { status: 400 });
      return failure === 'malformed' ? json({ success: true }) : json({ error: 'gateway timeout', retryable: true }, 504);
    });
    const take = await runShot({ ...base, fetch: fetcher, sleep: async () => {} });
    expect(take).toMatchObject({ status: 'submitted', retryable: false, deliveryState: { generation: 'unknown', result: 'pending' } });
    expect(isRetryableTake(take)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains the task id after the poll deadline instead of making a retryable failed take', async () => {
    const fetcher = vi.fn(async () => json({ taskId: 'task_still_running' }));
    const take = await runShot({ ...base, fetch: fetcher, timeoutMs: 0 });
    expect(take).toMatchObject({ status: 'generating', taskId: 'task_still_running', retryable: false, deliveryState: { generation: 'pending', result: 'pending', code: 'DRAMA_POLL_TIMEOUT' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves a task when polling reports timeout without inventing a refund', async () => {
    const responses = [json({ taskId: 'task_1' }), json({ status: 'timeout', retryable: true })];
    const take = await runShot({ ...base, fetch: async () => responses.shift()!, sleep: async () => {} });
    expect(take).toMatchObject({ taskId: 'task_1', status: 'generating', retryable: false });
    expect(isRetryableTake(take)).toBe(false);
  });

  it('distinguishes completed generation from a result that has not been retrieved', async () => {
    const responses = [json({ taskId: 'task_1' }), json({ status: 'completed', result: {} })];
    const take = await runShot({ ...base, fetch: async () => responses.shift()!, sleep: async () => {} });
    expect(take).toMatchObject({ status: 'generating', taskId: 'task_1', retryable: false, deliveryState: { generation: 'completed', result: 'pending' } });
  });

  it('keeps an aborted submission recoverable because its response may have been lost after charging', async () => {
    const controller = new AbortController();
    const take = await runShot({ ...base, signal: controller.signal, fetch: async () => {
      controller.abort(); throw new DOMException('aborted', 'AbortError');
    } });
    expect(take).toMatchObject({ status: 'submitted', retryable: false, deliveryState: { generation: 'unknown', result: 'pending' } });
  });
});

describe('recoverTakeReceipt read-only client', () => {
  it('unwraps only the exact provider prefix used by saved catalog model keys', async () => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    let body: unknown;
    await recoverTakeReceipt({ id: 'take_1', status: 'submitted', createdAt: 1 }, 'provider_1::vendor/video-v1', 'provider_1', {
      shotId: 'shot_1', fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return json({ status: 'pending' }, 202); },
    });
    expect(body).toEqual({ shotId: 'shot_1', takeId: 'take_1', modelId: 'vendor/video-v1', providerId: 'provider_1' });
  });

  it('does not look up a catalog key from a different provider', async () => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    const fetcher = vi.fn();
    const take = await recoverTakeReceipt({ id: 'take_1', status: 'submitted', createdAt: 1 }, 'provider_other::video-v1', 'provider_1', { shotId: 'shot_1', fetch: fetcher });
    expect(take).toMatchObject({ status: 'submitted', retryable: false, deliveryState: { code: 'DRAMA_RECEIPT_IDENTITY_REQUIRED' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('recovers the originally charged task after a lost submission response without a second paid call', async () => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    let saved: DramaTake | undefined;
    let paidCalls = 0;
    const calls: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url === '/api/video/generate') {
        paidCalls += 1;
        expect(new Headers(init?.headers).get('idempotency-key')).toBe(`drama:shot_1:${saved!.id}`);
        throw new TypeError('receipt lost after the server charged and admitted original_task');
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({ shotId: 'shot_1', takeId: saved!.id });
      return json({ taskId: 'original_task', status: 'processing', creditStatus: 'charged' });
    };
    const lost = await runShot({ ...base, fetch: fetcher, onBeforeSubmit: async take => { saved = { ...take }; } });
    const recovered = await recoverTakeReceipt(lost, lost.modelId, lost.providerId, { shotId: 'shot_1', fetch: fetcher });
    expect(recovered).toMatchObject({ id: saved!.id, taskId: 'original_task', status: 'generating', retryable: false });
    expect(paidCalls).toBe(1);
    expect(calls).toEqual(['/api/video/generate', '/api/drama/take-receipt']);
  });

  it('recovers a lost response with only the owner receipt lookup, preserving take identity and snapshot', async () => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    const take = { id: 'take_1', status: 'submitted' as const, createdAt: 1, inputSnapshot: 'original-version', retryable: true };
    const calls: Array<{ url: string; body: unknown }> = [];
    const recovered = await recoverTakeReceipt(take, 'video-v1', 'provider_1', { shotId: 'shot_1', fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return json({ taskId: 'paid_task', status: 'processing', creditStatus: 'charged' });
    } });
    expect(calls).toEqual([{ url: '/api/drama/take-receipt', body: { shotId: 'shot_1', takeId: 'take_1', modelId: 'video-v1', providerId: 'provider_1' } }]);
    expect(recovered).toMatchObject({ id: 'take_1', inputSnapshot: 'original-version', taskId: 'paid_task', status: 'generating', retryable: false, deliveryState: { generation: 'pending', result: 'pending', creditStatus: 'charged' } });
  });

  it('leaves known task polling to the parent without any fetch', async () => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    const take: DramaTake = { id: 'take_1', taskId: 'known', status: 'generating', createdAt: 1 };
    const fetcher = vi.fn();
    expect(await recoverTakeReceipt(take, 'video-v1', 'provider_1', { shotId: 'shot_1', fetch: fetcher })).toEqual(take);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['missing', 'network', 'mismatch'])('keeps %s receipt recovery pending without assuming refunded credits', async failure => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    const take: DramaTake = { id: 'take_1', status: 'failed', createdAt: 1, retryable: true };
    const fetcher = vi.fn(async () => {
      if (failure === 'network') throw new Error('offline');
      return failure === 'missing' ? json({ status: 'pending', code: 'DRAMA_RECEIPT_PENDING' }, 202)
        : json({ status: 'pending', code: 'DRAMA_RECEIPT_MISMATCH' }, 409);
    });
    const recovered = await recoverTakeReceipt(take, 'video-v1', 'provider_1', { shotId: 'shot_1', fetch: fetcher });
    expect(recovered).toMatchObject({ id: 'take_1', status: 'submitted', retryable: false, deliveryState: { generation: 'unknown', result: 'pending' } });
    expect(recovered.deliveryState?.creditStatus).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('maps completed receipts and reports missing result separately (has result: %s)', async hasResult => {
    const { recoverTakeReceipt } = await import('@/lib/drama/receipt-client');
    const take: DramaTake = { id: 'take_1', status: 'submitted', createdAt: 1, error: 'old network error' };
    const recovered = await recoverTakeReceipt(take, 'video-v1', 'provider_1', { shotId: 'shot_1', fetch: async () => json({
      taskId: 'paid_task', status: 'completed', creditStatus: 'charged', result: hasResult ? { videoUrl: '/v.mp4', videoThumbnailUrl: '/v.jpg' } : {},
    }) });
    expect(recovered).toMatchObject({ taskId: 'paid_task', status: hasResult ? 'completed' : 'generating', deliveryState: { generation: 'completed', result: hasResult ? 'available' : 'pending' } });
    if (hasResult) expect(recovered).toMatchObject({ videoUrl: '/v.mp4', thumbnailUrl: '/v.jpg', error: undefined });
  });
});

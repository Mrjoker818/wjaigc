import { describe, expect, it, vi } from 'vitest';
import { followProductionImage, submitProductionImage } from '@/lib/drama/production-image-client';
import type { DramaProductionImage } from '@/lib/drama/production-state';

const initial: DramaProductionImage = { id: 'image_a', target: { kind: 'keyframe', entityId: 's', view: 'first' }, providerId: 'p', modelId: 'm', state: 'submitting', createdAt: 1, updatedAt: 1 };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe('durable image delivery', () => {
  it('freezes the paid request and persists its version before awaiting the checkpoint', async () => {
    const input = { prompt: 'original', aspectRatio: '9:16', referenceImages: ['/original-reference.png'] };
    const states: DramaProductionImage[] = [];
    const requests: RequestInit[] = [];
    const result = await submitProductionImage(initial, input, {
      fetch: async (_url, init) => { requests.push(init!); return response({ imageUrl: '/original.png' }); },
      checkpoint: async op => {
        states.push(op);
        input.prompt = 'edited while saving'; input.aspectRatio = '16:9'; input.referenceImages[0] = '/new-reference.png';
      },
    });
    expect(states[0]).toMatchObject({ inputSnapshot: expect.any(String) });
    expect(JSON.parse(String(requests[0].body))).toMatchObject({ prompt: 'original', aspectRatio: '9:16', referenceImages: ['/original-reference.png'] });
    expect(result.inputSnapshot).toBe(states[0].inputSnapshot);
    expect(new Headers(requests[0].headers).get('idempotency-key')).toBe('drama:image:image_a');
  });
  it('keeps a polling timeout as an unresolved original receipt', async () => {
    const result = await followProductionImage({ ...initial, taskId: 'known', state: 'generating' }, { fetch: async () => response({ status: 'timeout' }), checkpoint: async () => {} });
    expect(result.state).toBe('generating'); expect(result.taskId).toBe('known');
  });
  it.each(['failed', 'cancelled'])('preserves the original identity and versions on a %s terminal receipt', async status => {
    const fetcher = vi.fn(async () => response({ status, error: 'original terminal failure' }));
    const result = await followProductionImage({ ...initial, taskId: 'known', state: 'generating', inputSnapshot: 'request-version', targetSnapshot: 'target-version' }, {
      fetch: fetcher, checkpoint: async () => {},
    });
    expect(result).toMatchObject({ id: 'image_a', taskId: 'known', state: 'failed', inputSnapshot: 'request-version', targetSnapshot: 'target-version' });
    expect(result.url).toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('honors stop while the durable checkpoint is being saved, before any paid call', async () => {
    const stop = new AbortController(); const fetcher = vi.fn();
    const result = await submitProductionImage(initial, { prompt: 'x', aspectRatio: '9:16' }, { signal: stop.signal, fetch: fetcher, checkpoint: async () => { stop.abort(); } });
    expect(fetcher).not.toHaveBeenCalled(); expect(result.state).toBe('failed');
  });
  it('makes no paid request unless the original operation checkpoint was saved', async () => {
    const fetcher = vi.fn();
    await expect(submitProductionImage(initial, { prompt: 'x', aspectRatio: '9:16' }, { fetch: fetcher, checkpoint: async () => { throw new Error('save failed'); } })).rejects.toThrow('save failed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('records upstream success before saving and resumes storage without regenerating', async () => {
    const states: DramaProductionImage[] = [];
    const fetcher = vi.fn(async (url: string) => url === '/api/generate' ? response({ imageUrl: 'https://example.com/a.png' }) : response({ error: 'storage down' }, 503));
    const result = await submitProductionImage(initial, { prompt: 'x', aspectRatio: '9:16' }, { fetch: fetcher, checkpoint: async op => { states.push(op); } });
    expect(states.some(op => op.sourceUrl && op.state === 'retrieving')).toBe(true);
    expect(result).toMatchObject({ state: 'retrieving', sourceUrl: 'https://example.com/a.png' });
    const retry = vi.fn(async () => response({ url: '/api/serve-upload/saved.png' }));
    expect(await followProductionImage(result, { fetch: retry, checkpoint: async () => {} })).toMatchObject({ state: 'stored', url: '/api/serve-upload/saved.png' });
    expect(retry.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => call[0] === '/api/generate')).toHaveLength(1);
  });
  it('keeps an unknown submit receipt and checks it read-only without charging again', async () => {
    const result = await submitProductionImage(initial, { prompt: 'x', aspectRatio: '9:16' }, { fetch: async () => { throw new Error('connection lost'); }, checkpoint: async () => {} });
    expect(result.state).toBe('unknown');
    const fetcher = vi.fn(async (_url: string) => response({ error: 'not found' }, 404));
    expect((await followProductionImage(result, { fetch: fetcher, checkpoint: async () => {} })).state).toBe('unknown');
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/drama/take-receipt');
  });
});

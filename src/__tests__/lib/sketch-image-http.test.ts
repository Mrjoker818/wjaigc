import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSketchImageBody } from '@/lib/sketch-to-code/image-http';

const input = { projectId: 'project', imageDataUrl: 'png', instruction: '', visionProviderId: 'vision-p', visionModelId: 'vision-m',
  imageProviderId: 'image-p', imageModelId: 'image-m', idempotencyKey: 'nonce', aspectRatio: '4:3' };
function incoming(body: unknown, signal?: AbortSignal): Request {
  return new Request('http://localhost', { method: 'POST', body: JSON.stringify(body), signal, headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('image ingress shares bounded original reader without weakening code mode', () => {
  it('accepts exactly the nine image fields and preserves two explicit bindings', async () => {
    expect(await readSketchImageBody(incoming(input))).toEqual(input);
  });
  it('accepts the two optional string settings without inventing defaults', async () => {
    expect(await readSketchImageBody(incoming({ ...input, size: '1024x768', quality: 'high' }))).toEqual({ ...input, size: '1024x768', quality: 'high' });
  });
  it('accepts one optional setting alone', async () => {
    expect(await readSketchImageBody(incoming({ ...input, size: '1024x768' }))).toEqual({ ...input, size: '1024x768' });
  });
  it.each(Object.keys(input))('rejects missing required %s', async key => {
    const body: Record<string, unknown> = { ...input }; delete body[key];
    await expect(readSketchImageBody(incoming(body))).rejects.toMatchObject({ status: 400 });
  });
  it.each(['apiKey', 'userId', 'price', 'result', 'providerId', 'modelId'])('rejects unknown or old-mode %s', async key => {
    await expect(readSketchImageBody(incoming({ ...input, [key]: 'spoof' }))).rejects.toMatchObject({ status: 400 });
  });
  it.each(['size', 'quality', 'instruction', 'visionModelId'])('rejects nonstring %s', async key => {
    await expect(readSketchImageBody(incoming({ ...input, [key]: null }))).rejects.toMatchObject({ status: 400 });
  });
  it.each(['deadline', 'abort'] as const)('drains late rejection after image-mode %s', async variant => {
    vi.useFakeTimers(); const controller = new AbortController(); let fail!: (reason: Error) => void;
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => { fail = reject; }));
    const cancel = vi.fn(() => new Promise<void>(() => {})); const releaseLock = vi.fn();
    const body = { getReader: () => ({ read, cancel, releaseLock }) } as unknown as ReadableStream<Uint8Array>;
    const running = readSketchImageBody({ body, headers: new Headers({ 'content-type': 'application/json' }), signal: controller.signal });
    const assertion = expect(running).rejects.toMatchObject({ status: variant === 'deadline' ? 408 : 400 });
    await Promise.resolve();
    if (variant === 'deadline') await vi.advanceTimersByTimeAsync(10_000); else controller.abort();
    await assertion; fail(new Error('late-secret')); await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

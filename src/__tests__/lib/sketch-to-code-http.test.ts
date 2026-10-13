import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSketchBody, SketchHttpError, sketchFields, sketchHttpId } from '@/lib/sketch-to-code/http';

const value = { projectId: 'p', imageDataUrl: 'png', instruction: '', providerId: 'provider', modelId: 'model', idempotencyKey: 'nonce' };
function incoming(bytes: Uint8Array, headers: Record<string, string> = {}, signal = new AbortController().signal): Request {
  return new Request('http://localhost', { method: 'POST', body: new Uint8Array(bytes), signal, headers: { 'content-type': 'application/json', ...headers } });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('bounded sketch request reader (real stream, no business ports)', () => {
  it('accepts exactly 6MiB actual JSON bytes and a multibyte code point split across chunks', async () => {
    const json = Buffer.from(JSON.stringify({ ...value, instruction: '中文' }));
    const padding = Buffer.alloc(6 * 1024 * 1024 - json.length, 32);
    const bytes = Buffer.concat([json, padding]); const boundary = json.indexOf(Buffer.from('中')) + 1;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.subarray(0, boundary)); c.enqueue(bytes.subarray(boundary)); c.close(); } });
    expect(await readSketchBody({ body, headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }), signal: new AbortController().signal })).toEqual({ ...value, instruction: '中文' });
  });
  it.each<Record<string, string>>([{}, { 'content-length': '1' }])('counts actual bytes regardless of declared length %j', async headers => {
    await expect(readSketchBody(incoming(Buffer.alloc(6 * 1024 * 1024 + 1, 32), headers))).rejects.toMatchObject({ status: 413 });
  });
  it('declared oversize rejects without starting a stream read', async () => {
    const getReader = vi.fn();
    await expect(readSketchBody({ body: { getReader } as unknown as ReadableStream<Uint8Array>, headers: new Headers({ 'content-type': 'application/json', 'content-length': '6291457' }), signal: new AbortController().signal })).rejects.toMatchObject({ status: 413 });
    expect(getReader).not.toHaveBeenCalled();
  });
  it.each(['', 'null', '[]', '1', '{', '{}', '{"projectId":"p","userId":"spoof"}'])('rejects invalid or incomplete body %s', async raw => {
    await expect(readSketchBody(incoming(Buffer.from(raw)))).rejects.toBeInstanceOf(SketchHttpError);
  });
  it.each(['image/png', 'text/plain', 'application/json; charset=latin1'])('rejects content type %s', async type => {
    await expect(readSketchBody(incoming(Buffer.from(JSON.stringify(value)), { 'content-type': type }))).rejects.toMatchObject({ status: 415 });
  });
  it('rejects invalid UTF8 instead of replacement-character JSON', async () => {
    const bytes = Buffer.concat([Buffer.from('{"projectId":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    await expect(readSketchBody(incoming(bytes))).rejects.toMatchObject({ code: 'SKETCH_BODY_INVALID', status: 400 });
  });
  it.each(['deadline', 'abort'] as const)('bounds %s even when read and cancel never settle; drains late rejection', async variant => {
    vi.useFakeTimers(); let fail!: (error: Error) => void;
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => { fail = reject; }));
    const cancel = vi.fn(() => new Promise<void>(() => {})); const releaseLock = vi.fn();
    const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const body = { getReader: () => ({ read, cancel, releaseLock }) } as unknown as ReadableStream<Uint8Array>;
    const running = readSketchBody({ body, headers: new Headers({ 'content-type': 'application/json' }), signal: controller.signal });
    const rejected = expect(running).rejects.toMatchObject({ status: variant === 'deadline' ? 408 : 400 });
    await Promise.resolve();
    if (variant === 'deadline') await vi.advanceTimersByTimeAsync(10_000); else controller.abort();
    await rejected; fail(new Error('late-read-failure')); await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(releaseLock).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('an already-aborted request never begins a body read', async () => {
    const controller = new AbortController(); controller.abort(); const getReader = vi.fn();
    await expect(readSketchBody({ body: { getReader } as unknown as ReadableStream<Uint8Array>, headers: new Headers({ 'content-type': 'application/json' }), signal: controller.signal })).rejects.toMatchObject({ status: 400 });
    expect(getReader).not.toHaveBeenCalled();
  });
  it.each(['', ' x', 'x\r\nfoo', 'x'.repeat(257)])('rejects unsafe id %j', id => { expect(() => sketchHttpId(id)).toThrow(SketchHttpError); });
  it('never invokes an accessor as a field validator', () => {
    const get = vi.fn(); expect(() => sketchFields({ get taskId() { get(); return 'x'; } }, ['taskId'])).toThrow(SketchHttpError); expect(get).not.toHaveBeenCalled();
  });
});

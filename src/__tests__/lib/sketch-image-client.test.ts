import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { SketchImageClient, createSketchImagePanelSession } from '@/lib/sketch-to-code/image-client';
import type { SketchScope } from '@/lib/sketch-to-code/client';
import type { SketchImageInput } from '@/lib/sketch-to-code/image-contract';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==';
const input = (): SketchImageInput => ({ projectId: 'project', imageDataUrl: `data:image/png;base64,${png}`, instruction: '蓝色房子',
  visionProviderId: 'vision', visionModelId: 'same', imageProviderId: 'image', imageModelId: 'same', idempotencyKey: 'nonce', aspectRatio: '4:3' });
const scope = (): SketchScope => ({ actorId: 'actor', projectId: 'project', key: 'scope-key', authority: 'legacy', assertCurrent: (): void => {} });
const pricing = (): object => ({ version: 1, vision: { providerId: 'vision', modelId: 'same', calls: 1, mode: 'flat', reserveCredits: 2 },
  image: { providerId: 'image', modelId: 'same', calls: 1, credits: 3 }, totalReserveCredits: 5 });
function receipt(extra: object = {}): Record<string, unknown> {
  return { success: true, type: 'sketch-to-image', taskId: 'task', projectId: 'project', status: 'processing', progress: 10,
    visionProviderId: 'vision', visionModelId: 'same', imageProviderId: 'image', imageModelId: 'same', reserveCredits: 5, pricing: pricing(), ...extra };
}
function completed(extra: object = {}): Record<string, unknown> {
  return receipt({ status: 'completed', progress: 100, previewAssetId: 'input', previewAssetVersionId: 'input-version',
    imageAssetId: 'output', imageAssetVersionId: 'output-version', previewUrl: '/api/serve-upload/input.png', imageUrl: '/api/serve-upload/output.png',
    actualCredits: 8, analysis: { summary: '房子', composition: '居中', prompt: '蓝色房子', negativePrompt: '' }, ...extra });
}
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
interface Call { url: string; init: RequestInit }
function harness(respond: (call: Call, index: number) => Promise<Response> | Response): { calls: Call[]; fetcher: typeof fetch } {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (url, init): Promise<Response> => {
    const call = { url: String(url), init: init ?? {} }; calls.push(call); return respond(call, calls.length - 1);
  };
  return { calls, fetcher };
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}
const clients: SketchImageClient[] = [];
function client(fetcher: typeof fetch, current = scope(), timeout = 1000): SketchImageClient {
  const value = new SketchImageClient(current, fetcher, timeout); clients.push(value); return value;
}
afterEach((): void => { clients.forEach(value => value.stop()); clients.length = 0; vi.useRealTimers(); });

describe('Task9 explicit image client (no provider or DB)', (): void => {
  it('publishes a separate session with no drawing state or automatic selection', (): void => {
    const session = createSketchImagePanelSession(scope());
    expect(session).toMatchObject({ instruction: '', visionSelection: '', imageSelection: '', aspectRatio: '4:3' });
    expect(session).not.toHaveProperty('history'); expect(session.client).toBeInstanceOf(SketchImageClient);
  });
  it('submits exactly frozen dual input with same-origin actor gate', async (): Promise<void> => {
    const h = harness(() => json(receipt(), 202)), c = client(h.fetcher), original = input();
    const started = c.start(original); original.instruction = 'mutated';
    const task = await started;
    expect(h.calls).toHaveLength(1); expect(h.calls[0].url).toBe('/api/sketch-to-image');
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual(input());
    expect(h.calls[0].init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    expect(new Headers(h.calls[0].init.headers).get('x-wujie-expected-actor-id')).toBe('actor');
    expect(Object.isFrozen(c.input)).toBe(true); expect(Object.isFrozen(task.pricing.vision)).toBe(true);
  });
  it('deduplicates simultaneous identical admissions', async (): Promise<void> => {
    const d = deferred<Response>(), h = harness(() => d.promise), c = client(h.fetcher);
    const first = c.start(input()), second = c.start(input()); d.resolve(json(receipt(), 202));
    expect(await first).toEqual(await second); expect(h.calls).toHaveLength(1);
  });
  it('unknown admission blocks a changed nonce until exact explicit reconciliation', async (): Promise<void> => {
    const h = harness((_call, index) => { if (index === 0) throw new Error('lost ACK secret'); return json(receipt()); }), c = client(h.fetcher);
    await expect(c.start(input())).rejects.toThrow(); expect(c.admissionUnknown).toBe(true);
    await expect(c.start({ ...input(), idempotencyKey: 'new' })).rejects.toThrow();
    await expect(c.start(input())).rejects.toThrow();
    await expect(c.start({ ...input(), instruction: 'changed' }, true)).rejects.toThrow();
    expect(h.calls).toHaveLength(1);
    await c.start(input(), true); expect(h.calls).toHaveLength(2);
    expect(h.calls[0].init.body).toBe(h.calls[1].init.body); expect(c.admissionUnknown).toBe(false);
  });
  it('known task start only polls original task, never readmits', async (): Promise<void> => {
    const h = harness(() => json(receipt())), c = client(h.fetcher); await c.start(input()); await c.start(input(), true);
    expect(h.calls.map(call => call.url)).toEqual(['/api/sketch-to-image', '/api/poll-task']);
    expect(JSON.parse(String(h.calls[1].init.body))).toEqual({ taskId: 'task', projectId: 'project' });
    await expect(c.start({ ...input(), idempotencyKey: 'next' })).rejects.toThrow(); expect(h.calls).toHaveLength(2);
  });
  it('terminal task permits only a fresh nonce and cannot reuse a historic nonce', async (): Promise<void> => {
    const h = harness(() => json(receipt({ status: 'failed' }))), c = client(h.fetcher);
    await c.start(input()); await c.start({ ...input(), idempotencyKey: 'next' });
    await expect(c.start(input())).rejects.toThrow(); expect(h.calls).toHaveLength(2);
  });
  it.each(['dispatchPending', 'recoveryPending'] as const)('terminal %s blocks a new nonce until the original task is reconciled', async flag => {
    const h = harness(call => json(call.url === '/api/sketch-to-image' ? receipt() : completed({ [flag]: true }))), c = client(h.fetcher);
    await c.start(input()); await c.poll('task');
    await expect(c.start({ ...input(), idempotencyKey: 'new-unconfirmed' })).rejects.toThrow();
    expect(h.calls.map(call => call.url)).toEqual(['/api/sketch-to-image', '/api/poll-task']);
    expect(c.input?.idempotencyKey).toBe('nonce'); expect(c.task).toMatchObject({ taskId: 'task', [flag]: true });
  });
  it.each(['needsReconcile', 'dispatchPending', 'recoveryPending'] as const)('completed %s permits original polling but no output byte GET', async flag => {
    const h = harness(call => call.url === '/api/poll-task' ? json(completed({ [flag]: true }))
      : new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } })), c = client(h.fetcher);
    await expect(c.image('task')).rejects.toThrow();
    expect(h.calls.map(call => call.url)).toEqual(['/api/poll-task']); expect(c.task).toMatchObject({ status: 'completed', [flag]: true });
  });
  it('original protected reconciliation clears all flags before bytes without a second admission', async () => {
    let confirmed = false;
    const h = harness(call => call.url === '/api/sketch-to-image' ? json(receipt()) : call.url === '/api/poll-task'
      ? json(completed({ needsReconcile: !confirmed, dispatchPending: !confirmed, recoveryPending: !confirmed }))
      : new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } })), c = client(h.fetcher);
    await c.start(input()); await c.start(input(), true); confirmed = true;
    expect(await c.start(input(), true)).toMatchObject({ needsReconcile: false, dispatchPending: false, recoveryPending: false });
    expect((await c.image('task')).type).toBe('image/png');
    expect(h.calls.filter(call => call.url === '/api/sketch-to-image')).toHaveLength(1); expect(c.input).toEqual(input());
  });
  it('bare completed admission is never usable before fresh protected poll', async (): Promise<void> => {
    const h = harness((_call, index) => index === 0 ? json(receipt({ status: 'completed' })) : json({ success: false }, 503)), c = client(h.fetcher);
    const task = await c.start(input()); expect(task.status).toBe('processing'); expect(task.needsReconcile).toBe(true);
    expect(task.imageUrl).toBeUndefined(); expect(c.admissionUnknown).toBe(false);
    expect(h.calls.map(call => call.url)).toEqual(['/api/sketch-to-image', '/api/poll-task']);
  });
  it('even full completed admission is gated by protected poll', async (): Promise<void> => {
    const h = harness((_call, index) => json(index === 0 ? completed() : completed({ imageUrl: '/api/serve-upload/fresh.png' }))), c = client(h.fetcher);
    expect((await c.start(input())).imageUrl).toBe('/api/serve-upload/fresh.png'); expect(h.calls).toHaveLength(2);
  });
  it.each([8, 3, 0])('accepts legal net credits %i without inventing a reserve cap', async (actualCredits): Promise<void> => {
    const h = harness(() => json(completed({ actualCredits }))), c = client(h.fetcher);
    expect((await c.poll('task')).actualCredits).toBe(actualCredits);
  });
  it.each([
    { visionProviderId: 'other' }, { imageProviderId: 'other' }, { visionModelId: 'other' }, { imageModelId: 'other' },
    { reserveCredits: 6 }, { pricing: { ...pricing(), totalReserveCredits: 6 } }, { projectId: 'other' }, { taskId: 'other' },
    { pricing: { version: 1, vision: { providerId: 'vision', modelId: 'same', calls: 1, mode: 'flat', reserveCredits: 1 },
      image: { providerId: 'image', modelId: 'same', calls: 1, credits: 4 }, totalReserveCredits: 5 } },
  ])('rejects pinned pair/price/task drift %#', async (patch): Promise<void> => {
    const h = harness((_call, index) => json(index === 0 ? receipt() : completed(patch))), c = client(h.fetcher); await c.start(input());
    await expect(c.poll('task')).rejects.toThrow(); expect(c.task?.status).toBe('processing');
  });
  it.each([
    { imageAssetId: 'input' }, { imageAssetVersionId: 'input-version' }, { imageAssetVersionId: undefined }, { analysis: { prompt: 'only' } },
    { imageUrl: 'data:image/png;base64,AAAA' }, { imageUrl: 'https://provider.invalid/result.png' }, { imageUrl: '/private/result.png' },
    { imageUrl: '/api/serve-upload/../private.png' }, { imageUrl: '/api/serve-upload/%2e%2e/private.png' },
    { imageUrl: '/api/serve-upload/output.png?key=secret' }, { actualCredits: -1 }, { remoteId: 'remote' }, { secret: 'key' },
    { progress: 101 }, { needsReconcile: 'true' }, { phase: 'reconstruction' },
  ])('rejects incomplete or unsafe protected completed body %#', async (patch): Promise<void> => {
    const h = harness(() => json(completed(patch))), c = client(h.fetcher); await expect(c.poll('task')).rejects.toThrow(); expect(c.task).toBeUndefined();
  });
  it('unknown cancellation leaves known status unchanged and 409 only polls', async (): Promise<void> => {
    const h = harness((_call, index) => index === 1 ? json({ success: false }, 503) : index === 2 ? json({ success: false }, 409) : json(receipt())), c = client(h.fetcher);
    await c.start(input()); await expect(c.cancel('task')).rejects.toThrow(); expect(c.task?.status).toBe('processing');
    expect((await c.cancel('task')).status).toBe('processing');
    expect(h.calls.map(call => call.url)).toEqual(['/api/sketch-to-image', '/api/cancel-task', '/api/cancel-task', '/api/poll-task']);
  });
  it('only a cancelled task ACK changes local cancellation/refund projection', async (): Promise<void> => {
    const h = harness((_call, index) => json(index === 0 ? receipt() : receipt({ status: 'cancelled', progress: 0, refunded: true }))), c = client(h.fetcher);
    await c.start(input()); expect(await c.cancel('task')).toMatchObject({ status: 'cancelled', refunded: true });
  });
  it('stop rejects a late admission while preserving original nonce as unknown', async (): Promise<void> => {
    const d = deferred<Response>(), h = harness(() => d.promise), c = client(h.fetcher);
    const pending = c.start(input()); c.stop(); d.resolve(json(receipt())); await expect(pending).rejects.toThrow();
    expect(c.task).toBeUndefined(); expect(c.admissionUnknown).toBe(true); expect(c.input?.idempotencyKey).toBe('nonce');
    expect(h.calls[0].init.signal?.aborted).toBe(true);
  });
  it('rejects changed project and permission during a late read', async (): Promise<void> => {
    const d = deferred<Response>(), h = harness(() => d.promise), current = scope(), c = client(h.fetcher, current);
    const pending = c.poll('task'); current.projectId = 'other'; d.resolve(json(completed()));
    await expect(pending).rejects.toThrow(); expect(c.task).toBeUndefined();
  });
  it('native timer bounds a transport ignoring abort', async (): Promise<void> => {
    const h = harness(() => new Promise<Response>(() => {})), c = client(h.fetcher, scope(), 15);
    await expect(c.start(input())).rejects.toThrow(); expect(c.admissionUnknown).toBe(true); expect(h.calls[0].init.signal?.aborted).toBe(true);
  });
  it.each([{ instruction: 'bad\u0000' }, { idempotencyKey: '..' }, { aspectRatio: '' }, { imageDataUrl: 'data:image/png;base64,AAAA' }, { extra: true }])('strict input rejects malformed field %# before fetch', async (patch): Promise<void> => {
    const h = harness(() => json(receipt())), c = client(h.fetcher);
    await expect(c.start({ ...input(), ...patch })).rejects.toThrow(); expect(h.calls).toHaveLength(0);
  });
  it('cancelled ACK wins over an older in-flight poll', async (): Promise<void> => {
    const d = deferred<Response>(), h = harness((call, index) => index === 1 ? d.promise : json(call.url === '/api/cancel-task' ? receipt({ status: 'cancelled', refunded: true }) : receipt())), c = client(h.fetcher);
    await c.start(input()); const polling = c.poll('task'); await c.cancel('task'); d.resolve(json(receipt()));
    await expect(polling).rejects.toThrow(); expect(c.task?.status).toBe('cancelled');
  });
  it('JSON declared oversize is rejected before body consumption', async (): Promise<void> => {
    const h = harness(() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } })), c = client(h.fetcher);
    await expect(c.poll('task')).rejects.toThrow();
  });
  it('bounds an unending JSON body rather than awaiting response.json forever', async (): Promise<void> => {
    const h = harness(() => new Response(new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(new TextEncoder().encode('{')); } }),
      { headers: { 'content-type': 'application/json' } })), c = client(h.fetcher, scope(), 15);
    await expect(c.poll('task')).rejects.toThrow(); expect(c.task).toBeUndefined();
  });
  it('stream-enforced JSON budget cancels oversize bodies without content-length', async (): Promise<void> => {
    let cancelled = false;
    const h = harness(() => new Response(new ReadableStream<Uint8Array>({ pull(controller): void { controller.enqueue(new Uint8Array(600_000)); },
      cancel(): void { cancelled = true; } }), { headers: { 'content-type': 'application/json' } })), c = client(h.fetcher);
    await expect(c.poll('task')).rejects.toThrow(); expect(cancelled).toBe(true);
  });
  it('download polls afresh and returns actual native PNG bytes', async (): Promise<void> => {
    const bytes = Buffer.from(png, 'base64'), h = harness(call => call.url === '/api/poll-task' ? json(completed()) : new Response(bytes, { headers: { 'content-type': 'image/png' } })), c = client(h.fetcher);
    const blob = await c.image('task'); expect(blob).toBeInstanceOf(Blob); expect(blob.type).toBe('image/png');
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes);
    expect(h.calls.map(call => call.url)).toEqual(['/api/poll-task', '/api/serve-upload/output.png']);
  });
  it.each([
    ['image/jpeg', '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAB//Z'],
    ['image/webp', 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA='],
  ])('returns actual %s Blob without relabelling as PNG', async (mime, encoded): Promise<void> => {
    const bytes = Buffer.from(encoded, 'base64'), h = harness(call => call.url === '/api/poll-task' ? json(completed()) : new Response(bytes, { headers: { 'content-type': mime } })), c = client(h.fetcher);
    const blob = await c.image('task'); expect(blob.type).toBe(mime); expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes);
  });
  it('foreign managed byte reads omit cookies and actor headers', async (): Promise<void> => {
    const h = harness(call => call.url === '/api/poll-task' ? json(completed({ imageUrl: 'https://media.invalid/api/serve-upload/output.png' })) : new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } })), c = client(h.fetcher);
    await c.image('task'); expect(h.calls[1].init.credentials).toBe('omit');
    expect(new Headers(h.calls[1].init.headers).has('x-wujie-expected-actor-id')).toBe(false); expect(h.calls[1].init.redirect).toBe('error');
  });
  it.each(['text/html', 'image/svg+xml', 'image/png'])('rejects invalid actual bytes/MIME %s', async (mime): Promise<void> => {
    const h = harness(call => call.url === '/api/poll-task' ? json(completed()) : new Response('<html>not an image</html>', { headers: { 'content-type': mime } })), c = client(h.fetcher);
    await expect(c.image('task')).rejects.toThrow();
  });
  it('enforces 32MiB streamed image budget with no declared size', async (): Promise<void> => {
    let cancelled = false;
    const h = harness(call => call.url === '/api/poll-task' ? json(completed()) : new Response(new ReadableStream<Uint8Array>({ pull(controller): void { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel(): void { cancelled = true; } }), { headers: { 'content-type': 'image/png' } })), c = client(h.fetcher);
    await expect(c.image('task')).rejects.toThrow(); expect(cancelled).toBe(true);
  });
  it('actual local HTTP fetch completes protected poll and binary download', async (): Promise<void> => {
    const seen: string[] = [];
    const server = createServer((request, response): void => {
      seen.push(request.url ?? ''); response.setHeader('content-type', request.url === '/api/poll-task' ? 'application/json' : 'image/png');
      response.end(request.url === '/api/poll-task' ? JSON.stringify(completed()) : Buffer.from(png, 'base64'));
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address();
    if (!address || typeof address === 'string') throw new Error('local fixture address');
    const fetcher: typeof fetch = (url, init): Promise<Response> => fetch(`http://127.0.0.1:${address.port}${String(url)}`, init);
    try { expect((await client(fetcher).image('task')).size).toBe(Buffer.from(png, 'base64').length); expect(seen).toEqual(['/api/poll-task', '/api/serve-upload/output.png']); }
    finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
  });
});

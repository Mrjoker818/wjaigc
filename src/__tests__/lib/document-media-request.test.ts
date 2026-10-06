import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertCanvasShareMutationOrigin, assertCanvasShareMutationRequest } from '@/lib/canvas-share/request';
import { consumeMediaBody, mediaBodyIdentity, mediaDeadline, parseMediaAdoption, parseUploadHeaders,
  readMediaAdoptionJson, readMediaVersionImportJson, parseMediaVersionImport, readMediaBody, reserveMediaPreparation } from '@/lib/collaboration/document-media-request';

const command = { action: 'attach', transform: { x: 0, y: 0, width: 4, height: 3, rotation: 0, zIndex: 0 } };
const metadata = { projectId: 'p', idempotencyKey: 'k', filename: '图片.png', command };
function headers(value: unknown = metadata, mime: string = 'image/png'): Headers {
  return new Headers({ 'content-type': mime, 'x-wujie-asset-import': Buffer.from(JSON.stringify(value)).toString('base64url') });
}
afterEach(() => vi.useRealTimers());

vi.mock('server-only', () => ({}));
describe('document media transport', () => {
  const versionInput = { projectId: 'p', sourceVersionId: 'v', idempotencyKey: 'k', command };
  it('version schema permits attach/replace but never widens task adoption', (): void => {
    expect(parseMediaVersionImport(versionInput)).toEqual(versionInput);
    const replace = { ...versionInput, command: { action: 'replace', placementId: 'placement', expectedAssetVersionId: 'old' } };
    expect(parseMediaVersionImport(replace)).toEqual(replace);
    expect(() => parseMediaAdoption(versionInput)).toThrow('DOCUMENT_MEDIA_INVALID');
    for (const field of ['taskId', 'outputIndex', 'url', 'ownerId', 'actorId', 'trusted', 'storageKey']) {
      expect(() => parseMediaVersionImport({ ...versionInput, [field]: 'forged' })).toThrow('DOCUMENT_MEDIA_INVALID');
    }
    for (const field of ['projectId', 'sourceVersionId', 'idempotencyKey']) {
      for (const value of ['', ' ', 'x'.repeat(257), 'bad\u0000', 'bad\u007f', null, 42]) {
        expect(() => parseMediaVersionImport({ ...versionInput, [field]: value })).toThrow('DOCUMENT_MEDIA_INVALID');
      }
    }
    for (const invalidCommand of [{ ...command, assetVersionId: 'injected' }, { ...command, transform: { ...command.transform, width: 0 } },
      { action: 'remove', placementId: 'p', expectedAssetVersionId: 'v' }, { action: 'replace', placementId: 'p' }]) {
      expect(() => parseMediaVersionImport({ ...versionInput, command: invalidCommand })).toThrow('DOCUMENT_MEDIA_INVALID');
    }
  });
  it('version JSON counts UTF-8 bytes, rejects invalid encodings and cancels stalled reads at 120 seconds', async (): Promise<void> => {
    const request = (body: BodyInit): Request => new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readMediaVersionImportJson(request(JSON.stringify(versionInput)))).toEqual(versionInput);
    await expect(readMediaVersionImportJson(request(' '.repeat(8193)))).rejects.toThrow('DOCUMENT_MEDIA_TOO_LARGE');
    await expect(readMediaVersionImportJson(request('中'.repeat(3000)))).rejects.toThrow('DOCUMENT_MEDIA_TOO_LARGE');
    await expect(readMediaVersionImportJson(request(new Uint8Array([255])))).rejects.toThrow('DOCUMENT_MEDIA_INVALID');
    vi.useFakeTimers(); let cancelled = false;
    const pending = readMediaVersionImportJson(request(new ReadableStream({ cancel(): void { cancelled = true; } }))).catch((error: unknown): unknown => error);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toMatchObject({ code: 'DOCUMENT_MEDIA_CANCELLED' }); expect(cancelled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif'],
    ['avif', 'image/avif'], ['bmp', 'image/bmp'], ['mp4', 'video/mp4'], ['webm', 'video/webm'],
    ['mov', 'video/quicktime'], ['m4v', 'video/x-m4v']])('accepts the %s import MIME contract', (extension, mime): void => {
    expect(parseUploadHeaders(headers({ ...metadata, filename: `媒体.${extension}` }, mime)).mimeType).toBe(mime);
  });
  it('accepts same-origin binary independently of the existing JSON wrapper', (): void => {
    const request = new NextRequest('http://localhost:5000/api/collaboration/document-assets/upload', {
      method: 'POST', headers: { origin: 'http://localhost:5000', 'content-type': 'image/png' }, body: 'x',
    });
    expect(() => assertCanvasShareMutationOrigin(request)).not.toThrow();
    expect(() => assertCanvasShareMutationRequest(request)).toThrow();
  });
  it('rejects actual body length different from the declaration', async (): Promise<void> => {
    const request = new NextRequest('http://localhost:5000', {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: '{}',
    });
    await expect(readMediaAdoptionJson(request)).rejects.toThrow();
  });
  it('accepts canonical UTF-8 metadata and rejects injected authority and malformed encodings', (): void => {
    expect(parseUploadHeaders(headers()).metadata).toEqual(metadata);
    for (const field of ['actorId', 'ownerId', 'url', 'storageKey', 'assetVersionId', 'validated']) {
      expect(() => parseUploadHeaders(headers({ ...metadata, [field]: 'untrusted' }))).toThrow();
    }
    for (const encoded of ['*', 'e30=', 'e30,e30', 'a'.repeat(8193), Buffer.from([255]).toString('base64url')]) {
      const input = headers(); input.set('x-wujie-asset-import', encoded);
      expect(() => parseUploadHeaders(input)).toThrow();
    }
    expect(() => parseUploadHeaders(headers({ ...metadata, command: { ...command, assetVersionId: 'x' } }))).toThrow();
    for (const mime of ['application/json', 'application/zip', 'image/svg+xml', 'image/png; charset=utf8', 'video/mp4']) {
      expect(() => parseUploadHeaders(headers(metadata, mime))).toThrow();
    }
  });
  it('rejects adoption URL/owner, remove, bad output index, and invalid geometry', (): void => {
    const input = { projectId: 'p', idempotencyKey: 'k', taskId: 't', outputIndex: 1, command };
    expect(parseMediaAdoption(input)).toEqual(input);
    for (const outputIndex of [-1, 1.1, NaN, Infinity, '0']) expect(() => parseMediaAdoption({ ...input, outputIndex })).toThrow();
    for (const field of ['url', 'owner', 'actorId', 'validated']) expect(() => parseMediaAdoption({ ...input, [field]: 'x' })).toThrow();
    expect(() => parseMediaAdoption({ ...input, command: { action: 'remove', placementId: 'p', expectedAssetVersionId: 'v' } })).toThrow();
    expect(() => parseUploadHeaders(headers({ ...metadata, command: { ...command, transform: { ...command.transform, width: 0 } } }))).toThrow();
  });
  it('hashes actual replay bytes without retaining a reusable buffer capability', async (): Promise<void> => {
    const body = await readMediaBody(new Request('http://localhost', { method: 'POST', body: 'abc' }), 10, new AbortController().signal, true);
    expect(mediaBodyIdentity(body)).toEqual({ byteSize: 3, checksum: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
    expect(consumeMediaBody(body).bytes).toBeUndefined();
    expect(() => consumeMediaBody(body)).toThrow();
    expect(() => consumeMediaBody({} as typeof body)).toThrow();
  });
  it('counts streamed bytes even with a low declared length and cancels as soon as oversized', async (): Promise<void> => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(new Uint8Array(5)); }, cancel(): void { cancelled = true; } });
    const request = new Request('http://localhost', { method: 'POST', body: stream, headers: { 'content-length': '1' }, duplex: 'half' } as RequestInit);
    await expect(readMediaBody(request, 4, new AbortController().signal)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_TOO_LARGE' });
    expect(cancelled).toBe(true);
    for (const length of ['0', '1', '4', '-1', '01', '1,3']) {
      await expect(readMediaBody(new Request('http://localhost', { method: 'POST', body: 'abc', headers: { 'content-length': length } }), 10, new AbortController().signal))
        .rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_INVALID' });
    }
  });
  it.each(['abort', 'body-timeout', 'total-timeout'] as const)('cancels a stalled stream on %s and releases resources', async (mode): Promise<void> => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const deadline = mediaDeadline(controller.signal, 300_000);
    let cancelled = false;
    const request = new Request('http://localhost', { method: 'POST', body: new ReadableStream({ cancel(): void { cancelled = true; } }), duplex: 'half' } as RequestInit);
    const pending = readMediaBody(request, 10, deadline.signal).catch((error: unknown): unknown => error);
    if (mode === 'abort') controller.abort();
    else await vi.advanceTimersByTimeAsync(mode === 'body-timeout' ? 120_000 : 300_000);
    expect(await pending).toMatchObject({ code: 'DOCUMENT_MEDIA_CANCELLED' });
    expect(cancelled).toBe(true);
    deadline.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds active preparations and format-ceiling reservations with no admission queue', (): void => {
    const signal = new AbortController().signal;
    const release = reserveMediaPreparation(512 * 1024 * 1024, signal);
    try { expect(() => reserveMediaPreparation(1, signal)).toThrow('DOCUMENT_MEDIA_BUSY'); } finally { release(); release(); }
    const one = reserveMediaPreparation(1, signal); const two = reserveMediaPreparation(1, signal);
    try { expect(() => reserveMediaPreparation(0, signal)).toThrow('DOCUMENT_MEDIA_BUSY'); } finally { one(); two(); }
  });
});

// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDocumentCanvasUploadIntent, commitDocumentCanvasFile, deliverCanvasImageFiles, getDocumentCanvasUploadIntent,
  uniqueDocumentCanvasFiles, uploadDocumentCanvasFile, loadDocumentCanvasVideoSize } from '@/lib/collaboration/document-canvas-upload';

const transform = { x: 12, y: 24, width: 80, height: 60, rotation: 0, zIndex: 2 };
const reference = { assetId: 'asset-a', assetVersionId: 'version-a', placementId: 'placement-a',
  entityId: 'entity-a', kind: 'image', url: '/api/serve-upload/images/a.png' };

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('document canvas file upload', () => {
  it('refreshes a submitted media reference before testing final writability when the live projection is catching up', async () => {
    let writable = true;
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      writable = false;
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a', assetVersionId: 'version-a',
        documentSequence: 7, assetReference: reference }), { status: 200 });
    });
    const result = await commitDocumentCanvasFile({ file: new File(['png'], 'catchup.png', { type: 'image/png' }),
      projectId: 'project-a', transform, isWritableProject: () => writable,
      refreshMedia: async (sequence): Promise<void> => { expect(sequence).toBe(7); writable = true; } });
    expect(result.placementId).toBe('placement-a'); expect(writable).toBe(true);
  });
  it('freezes the expected actor in the upload header without deriving authorization from it', async () => {
    let headers: Headers | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a', assetVersionId: 'version-a',
        documentSequence: 7, assetReference: reference }), { status: 200 });
    });
    await uploadDocumentCanvasFile({ file: new File(['png'], 'a.png', { type: 'image/png' }),
      expectedActorId: 'actor-a', projectId: 'project-a', idempotencyKey: 'actor-intent', transform });
    expect(headers?.get('x-wujie-expected-actor-id')).toBe('actor-a');
  });
  it('reads a video fingerprint in bounded chunks rather than retaining a whole large video buffer', async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024); bytes[4 * 1024 * 1024] = 1;
    const file = new File([bytes], 'large.mp4', { type: 'video/mp4' });
    const sizes: number[] = [];
    const read = FileReader.prototype.readAsArrayBuffer;
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(function (this: FileReader, blob: Blob): void {
      sizes.push(blob.size); read.call(this, blob);
    });
    await uniqueDocumentCanvasFiles([file]);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
  it('binds video retry identities to middle and tail content, preserving the identity for an exact copy', async () => {
    const original = new Uint8Array(5 * 1024 * 1024);
    const file = (bytes: Uint8Array<ArrayBuffer>): File => new File([bytes], 'same.mp4', { type: 'video/mp4' });
    const first = await getDocumentCanvasUploadIntent('project-a', file(original));
    expect(await getDocumentCanvasUploadIntent('project-a', file(original.slice()))).toBe(first);
    const middle = original.slice(); middle[3 * 1024 * 1024] = 1;
    const tail = original.slice(); tail[tail.length - 1] = 1;
    const second = await getDocumentCanvasUploadIntent('project-a', file(middle));
    const third = await getDocumentCanvasUploadIntent('project-a', file(tail));
    expect(new Set([first, second, third]).size).toBe(3);
  });
  it.each([0, NaN, Infinity])('rejects invalid decoded video width %s', async (width: number) => {
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:invalid', revokeObjectURL: revoke });
    const createElement = document.createElement.bind(document);
    const video = document.createElement('video');
    Object.defineProperties(video, { videoWidth: { value: width }, videoHeight: { value: 24 } });
    vi.spyOn(document as { createElement: (tag: string, options?: ElementCreationOptions) => HTMLElement }, 'createElement')
      .mockImplementation((tag: string, options?: ElementCreationOptions): HTMLElement => tag === 'video' ? video : createElement(tag, options));
    const promise = loadDocumentCanvasVideoSize(new File(['video'], 'clip.mp4', { type: 'video/mp4' }));
    video.dispatchEvent(new Event('loadedmetadata'));
    await expect(promise).rejects.toMatchObject({ code: 'unsupported' });
    expect(revoke).toHaveBeenCalledWith('blob:invalid');
  });
  it('rejects metadata timeout and releases the temporary URL', async () => {
    vi.useFakeTimers(); const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:timeout', revokeObjectURL: revoke });
    const outcome = expect(loadDocumentCanvasVideoSize(new File(['video'], 'clip.mp4', { type: 'video/mp4' })))
      .rejects.toMatchObject({ code: 'unsupported' });
    await vi.advanceTimersByTimeAsync(10_000); await outcome;
    expect(revoke).toHaveBeenCalledWith('blob:timeout');
  });
  it('aborts an in-flight metadata wait and releases the temporary URL', async () => {
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:abort', revokeObjectURL: revoke });
    const controller = new AbortController();
    const promise = loadDocumentCanvasVideoSize(new File(['video'], 'clip.mp4', { type: 'video/mp4' }), controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(revoke).toHaveBeenCalledWith('blob:abort');
  });

  it('uses decoded video dimensions and releases the temporary URL after metadata arrives', async () => {
    const create = vi.fn(() => 'blob:video-preview'); const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const createElement = document.createElement.bind(document);
    const video = createElement('video');
    Object.defineProperties(video, { videoWidth: { value: 32 }, videoHeight: { value: 24 } });
    vi.spyOn(document as { createElement: (tag: string, options?: ElementCreationOptions) => HTMLElement }, 'createElement')
      .mockImplementation((tag: string, options?: ElementCreationOptions): HTMLElement => {
      if (tag === 'video') { queueMicrotask(() => video.dispatchEvent(new Event('loadedmetadata'))); return video; }
      return createElement(tag, options);
    });
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    expect(await loadDocumentCanvasVideoSize(file)).toEqual({ width: 32, height: 24 });
    expect(revoke).toHaveBeenCalledWith('blob:video-preview');
  });

  it('rejects stopped or undecodable video metadata without a fabricated square size', async () => {
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:bad-video', revokeObjectURL: revoke });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document as { createElement: (tag: string, options?: ElementCreationOptions) => HTMLElement }, 'createElement')
      .mockImplementation((tag: string, options?: ElementCreationOptions): HTMLElement => {
      const element = createElement(tag, options);
      if (tag === 'video') queueMicrotask(() => element.dispatchEvent(new Event('error')));
      return element;
    });
    const file = new File(['bad'], 'clip.mp4', { type: 'video/mp4' });
    await expect(loadDocumentCanvasVideoSize(file)).rejects.toMatchObject({ code: 'unsupported' });
    expect(revoke).toHaveBeenCalledWith('blob:bad-video');
    const controller = new AbortController(); controller.abort();
    await expect(loadDocumentCanvasVideoSize(file, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it.each(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'])('submits original %s bytes and confirms a video receipt', async mime => {
    const file = new File(['video bytes'], 'original.clip', { type: mime });
    const videoReference = { ...reference, kind: 'video', url: '/api/serve-upload/exports/video.mp4' };
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(init);
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a', assetVersionId: 'version-a',
        documentSequence: 8, assetReference: videoReference }), { status: 200 });
    });
    const result = await uploadDocumentCanvasFile({ file, projectId: 'project-a', idempotencyKey: 'video-intent', transform });
    expect(result.assetReference.kind).toBe('video');
    expect(requests[0].body).toBe(file);
    expect(new Headers(requests[0].headers).get('content-type')).toBe(mime);
  });

  it('admits videos beyond the image ceiling but rejects files beyond their own 512 MiB ceiling before HTTP', async () => {
    const video = new File(['small fixture'], 'large.mp4', { type: 'video/mp4' });
    Object.defineProperty(video, 'size', { value: 33 * 1024 * 1024 });
    const oversized = new File(['small fixture'], 'oversized.mp4', { type: 'video/mp4' });
    Object.defineProperty(oversized, 'size', { value: 512 * 1024 * 1024 + 1 });
    const image = new File(['small fixture'], 'oversized.png', { type: 'image/png' });
    Object.defineProperty(image, 'size', { value: 32 * 1024 * 1024 + 1 });
    const batches = await uniqueDocumentCanvasFiles([video, oversized, image]);
    expect(batches.files).toEqual([video]);
    expect(batches.rejected.map(entry => entry.code)).toEqual(['too-large', 'too-large']);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(uploadDocumentCanvasFile({ file: oversized, projectId: 'project-a', idempotencyKey: 'too-large', transform }))
      .rejects.toMatchObject({ code: 'too-large' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates mixed video/image originals, keeps video retry identity after an uncertain response and rejects a wrong-kind receipt', async () => {
    const video = new File(['video'], 'same.mp4', { type: 'video/mp4' });
    const duplicate = new File(['video'], 'same.mp4', { type: 'video/mp4' });
    const image = new File(['png'], 'a.png', { type: 'image/png' });
    expect((await uniqueDocumentCanvasFiles([video, image, duplicate])).files).toEqual([video, image]);
    const key = await getDocumentCanvasUploadIntent('project-a', video);
    vi.stubGlobal('fetch', async () => { throw new Error('lost response'); });
    await expect(commitDocumentCanvasFile({ file: video, projectId: 'project-a', transform, refreshMedia: vi.fn() }))
      .rejects.toMatchObject({ code: 'network' });
    expect(await getDocumentCanvasUploadIntent('project-a', video)).toBe(key);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, placementId: 'placement-a',
      assetVersionId: 'version-a', documentSequence: 7, assetReference: reference }), { status: 200 }));
    await expect(uploadDocumentCanvasFile({ file: video, projectId: 'project-a', idempotencyKey: key, transform }))
      .rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('routes document files only to the authorized uploader and keeps the legacy handler for personal mode', async () => {
    const files = [new File(['png'], 'a.png', { type: 'image/png' })];
    const documentUpload = vi.fn(async () => { throw new Error('document unavailable'); });
    const legacyUpload = vi.fn(async () => undefined);
    await expect(deliverCanvasImageFiles({ files, authority: 'document', documentUpload, legacyUpload }))
      .rejects.toThrow('document unavailable');
    expect(documentUpload).toHaveBeenCalledWith(files);
    expect(legacyUpload).not.toHaveBeenCalled();
    await deliverCanvasImageFiles({ files, authority: 'legacy', documentUpload, legacyUpload });
    expect(legacyUpload).toHaveBeenCalledWith(files);
    legacyUpload.mockClear();
    await expect(deliverCanvasImageFiles({ files, authority: 'unknown', documentUpload, legacyUpload }))
      .rejects.toMatchObject({ code: 'authority-unresolved' });
    expect(legacyUpload).not.toHaveBeenCalled();
  });

  it('reuses an uncertain file intent for the same project until confirmed and never across projects', async () => {
    const file = new File(['png'], 'a.png', { type: 'image/png', lastModified: 123 });
    const first = await getDocumentCanvasUploadIntent('project-a', file);
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(first);
    expect(await getDocumentCanvasUploadIntent('project-b', file)).not.toBe(first);
    await clearDocumentCanvasUploadIntent('project-a', file, first);
    expect(await getDocumentCanvasUploadIntent('project-a', file)).not.toBe(first);
  });

  it('separates same-metadata files with different bytes and de-duplicates only identical batch files', async () => {
    const first = new File(['one'], 'a.png', { type: 'image/png', lastModified: 123 });
    const retry = new File(['one'], 'a.png', { type: 'image/png', lastModified: 123 });
    const different = new File(['two'], 'a.png', { type: 'image/png', lastModified: 123 });
    expect(await getDocumentCanvasUploadIntent('project-a', retry))
      .toBe(await getDocumentCanvasUploadIntent('project-a', first));
    expect(await getDocumentCanvasUploadIntent('project-a', different))
      .not.toBe(await getDocumentCanvasUploadIntent('project-a', first));
    expect(await uniqueDocumentCanvasFiles([first, retry, different])).toEqual({
      files: [first, different], rejected: [],
    });
  });

  it('keeps valid files when a mixed batch contains an unsupported image', async () => {
    const valid = new File(['png'], 'a.png', { type: 'image/png' });
    const unsupported = new File(['svg'], 'b.svg', { type: 'image/svg+xml' });
    expect(await uniqueDocumentCanvasFiles([valid, unsupported])).toEqual({
      files: [valid], rejected: [{ file: unsupported, code: 'unsupported' }],
    });
  });

  it('sends the original image bytes with only the server import command metadata', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], '猫.png', { type: 'image/png' });
    let submitted: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      submitted = { url, init };
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a',
        assetVersionId: 'version-a', documentSequence: 7, assetReference: reference }), { status: 200 });
    });
    await expect(uploadDocumentCanvasFile({ file, projectId: 'project-a', idempotencyKey: 'intent-a', transform }))
      .resolves.toEqual({ placementId: 'placement-a', assetVersionId: 'version-a',
        documentSequence: 7, assetReference: reference });
    expect(submitted?.url).toBe('/api/collaboration/document-assets/upload');
    expect(submitted?.init.method).toBe('POST');
    expect(submitted?.init.credentials).toBe('include');
    expect(submitted?.init.body).toBe(file);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    expect(Array.from(new Uint8Array(bytes))).toEqual([137, 80, 78, 71]);
    const headers = new Headers(submitted?.init.headers);
    expect(headers.get('content-type')).toBe('image/png');
    const encoded = headers.get('x-wujie-asset-import')!;
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    const binary = atob(encoded.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - encoded.length % 4) % 4));
    const metadata = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    expect(metadata).toEqual({ projectId: 'project-a', idempotencyKey: 'intent-a', filename: '猫.png',
      command: { action: 'attach', transform } });
  });

  it('rejects unsupported files before the request and does not turn an error into a successful import', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(uploadDocumentCanvasFile({ file: new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
      projectId: 'project-a', idempotencyKey: 'intent-a', transform })).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: 'DOCUMENT_FORBIDDEN' }), { status: 403 }));
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    await expect(uploadDocumentCanvasFile({ file, projectId: 'project-a', idempotencyKey: 'intent-a', transform }))
      .rejects.toMatchObject({ code: 'forbidden' });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, placementId: 'p',
      assetVersionId: 'v', documentSequence: 7 }), { status: 200 }));
    await expect(uploadDocumentCanvasFile({ file, projectId: 'project-a', idempotencyKey: 'intent-a', transform }))
      .rejects.toMatchObject({ code: 'invalid-response' });
  });

  it.each([[401, 'unauthenticated'], [403, 'forbidden'], [409, 'conflict'],
    [413, 'too-large'], [503, 'busy']] as const)('maps HTTP %i to %s without a successful import', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    await expect(uploadDocumentCanvasFile({ file: new File(['png'], 'a.png', { type: 'image/png' }),
      projectId: 'project-a', idempotencyKey: 'intent-a', transform })).rejects.toMatchObject({ code });
  });

  it('keeps the replay key when media refresh fails and clears it only after confirmation', async () => {
    const file = new File(['png'], 'a.png', { type: 'image/png', lastModified: 123 });
    const firstKey = await getDocumentCanvasUploadIntent('project-a', file);
    const uploaded = { success: true, placementId: 'placement-a', assetVersionId: 'version-a',
      documentSequence: 7, assetReference: reference };
    const requests: Array<{ key: string; transform: typeof transform }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const header = new Headers(init.headers).get('x-wujie-asset-import')!;
      const binary = atob(header.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - header.length % 4) % 4));
      const metadata = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
      requests.push({ key: metadata.idempotencyKey, transform: metadata.command.transform });
      return new Response(JSON.stringify(uploaded), { status: 200 });
    });
    const input = { file, projectId: 'project-a', transform };
    await expect(commitDocumentCanvasFile({ ...input, refreshMedia: async () => { throw new Error('offline'); } }))
      .rejects.toThrow('offline');
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(firstKey);
    const seen: Array<[number, string]> = [];
    await commitDocumentCanvasFile({ ...input, transform: { ...transform, x: 999 }, refreshMedia: async (sequence, result) => {
      seen.push([sequence, result.placementId]);
    } });
    expect(requests).toEqual([
      { key: firstKey, transform }, { key: firstKey, transform },
    ]);
    expect(seen).toEqual([[7, 'placement-a']]);
    expect(await getDocumentCanvasUploadIntent('project-a', file)).not.toBe(firstKey);
  });

  it('does not refresh another project after the upload response arrives', async () => {
    const file = new File(['png'], 'a.png', { type: 'image/png', lastModified: 124 });
    const firstKey = await getDocumentCanvasUploadIntent('project-a', file);
    let current = true;
    vi.stubGlobal('fetch', async () => {
      current = false;
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a',
        assetVersionId: 'version-a', documentSequence: 7, assetReference: reference }), { status: 200 });
    });
    const refreshMedia = vi.fn();
    await expect(commitDocumentCanvasFile({ file, projectId: 'project-a', transform,
      isCurrentProject: () => current, refreshMedia })).rejects.toMatchObject({ code: 'stale-project' });
    expect(refreshMedia).not.toHaveBeenCalled();
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(firstKey);
  });

  it('stops a pre-aborted import before making a request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(commitDocumentCanvasFile({ file: new File(['png'], 'cancel-before.png', { type: 'image/png' }),
      projectId: 'project-a', transform, signal: controller.signal, refreshMedia: vi.fn() }))
      .rejects.toMatchObject({ code: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the replay identity and skips media refresh when an in-flight request is stopped', async () => {
    const file = new File(['png'], 'cancel-inflight.png', { type: 'image/png' });
    const key = await getDocumentCanvasUploadIntent('project-a', file);
    const controller = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      expect(init.signal).toBe(controller.signal);
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      requestStarted();
    })));
    const refreshMedia = vi.fn();
    const pending = commitDocumentCanvasFile({ file, projectId: 'project-a', transform,
      signal: controller.signal, refreshMedia });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(refreshMedia).not.toHaveBeenCalled();
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(key);
  });

  it('does not publish a completed server response after the user stops waiting', async () => {
    const file = new File(['png'], 'cancel-after-response.png', { type: 'image/png' });
    const key = await getDocumentCanvasUploadIntent('project-a', file);
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a',
        assetVersionId: 'version-a', documentSequence: 7, assetReference: reference }), { status: 200 });
    }));
    const refreshMedia = vi.fn();
    await expect(commitDocumentCanvasFile({ file, projectId: 'project-a', transform,
      signal: controller.signal, refreshMedia })).rejects.toMatchObject({ code: 'cancelled' });
    expect(refreshMedia).not.toHaveBeenCalled();
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(key);
  });

  it('stops waiting for media refresh promptly and retains the retry identity', async () => {
    const file = new File(['png'], 'cancel-refresh.png', { type: 'image/png' });
    const key = await getDocumentCanvasUploadIntent('project-a', file);
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true,
      placementId: 'placement-a', assetVersionId: 'version-a', documentSequence: 7,
      assetReference: reference }), { status: 200 })));
    let releaseRefresh!: () => void;
    let refreshStarted!: () => void;
    const started = new Promise<void>(resolve => { refreshStarted = resolve; });
    const refreshMedia = (): Promise<void> => {
      refreshStarted();
      return new Promise<void>(resolve => { releaseRefresh = resolve; });
    };
    const pending = commitDocumentCanvasFile({ file, projectId: 'project-a', transform,
      signal: controller.signal, refreshMedia });
    const outcome = pending.then(() => 'confirmed', error => error?.code ?? 'failed');
    await started;
    controller.abort();
    const promptOutcome = await Promise.race([outcome, new Promise<string>(resolve => setTimeout(() => resolve('still-waiting'), 100))]);
    releaseRefresh();
    await outcome;
    expect(promptOutcome).toBe('cancelled');
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(key);
  });

  it('does not submit after the document becomes unwritable during file preparation', async () => {
    const file = new File(['png'], 'unwritable-before.png', { type: 'image/png' });
    let writable = true;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true,
      placementId: 'placement-a', assetVersionId: 'version-a', documentSequence: 7,
      assetReference: reference }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const pending = commitDocumentCanvasFile({ file, projectId: 'project-a', transform,
      isWritableProject: () => writable, refreshMedia: vi.fn() });
    writable = false;
    await expect(pending).rejects.toMatchObject({ code: 'not-writable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains the retry identity when authorized refresh cannot restore final writability', async () => {
    const file = new File(['png'], 'unwritable-response.png', { type: 'image/png' });
    const key = await getDocumentCanvasUploadIntent('project-a', file);
    let writable = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      writable = false;
      return new Response(JSON.stringify({ success: true, placementId: 'placement-a',
        assetVersionId: 'version-a', documentSequence: 7, assetReference: reference }), { status: 200 });
    }));
    const refreshMedia = vi.fn();
    await expect(commitDocumentCanvasFile({ file, projectId: 'project-a', transform,
      isWritableProject: () => writable, refreshMedia })).rejects.toMatchObject({ code: 'not-writable' });
    expect(refreshMedia).toHaveBeenCalledWith(7, expect.objectContaining({ placementId: 'placement-a', assetVersionId: 'version-a' }));
    expect(await getDocumentCanvasUploadIntent('project-a', file)).toBe(key);
  });
});

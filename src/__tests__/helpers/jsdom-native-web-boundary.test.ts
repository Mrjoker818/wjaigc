// @vitest-environment jsdom
import { browserBinaryResponse, jsdomCrypto as webcrypto } from './jsdom-native-web-boundary';
import { describe, expect, it } from 'vitest';

function read(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as ArrayBuffer);
    reader.onerror = (): void => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('native cryptography and browser binary response test boundary', () => {
  it('hashes actual browser FileReader bytes with native SHA-256', async () => {
    const bytes = await read(new File(['abc'], 'sample.png', { type: 'image/png' }));
    const digest = await webcrypto.subtle.digest('SHA-256', bytes);
    expect(Buffer.from(digest).toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('respects a typed-array subview rather than hashing adjacent bytes', async () => {
    const bytes = new Uint8Array([0, 97, 98, 99, 255]);
    const digest = await webcrypto.subtle.digest('SHA-256', bytes.subarray(1, 4));
    expect(Buffer.from(digest).toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(Array.from(bytes)).toEqual([0, 97, 98, 99, 255]);
  });

  it('preserves response status, MIME, consumption and exact bytes in a FileReader-compatible blob', async () => {
    const response = browserBinaryResponse(new Uint8Array([0, 255, 7]), { status: 206, headers: { 'content-type': 'Video/WebM' } });
    expect(response.status).toBe(206); expect(response.bodyUsed).toBe(false);
    const blob = await response.blob();
    expect(blob.type).toBe('video/webm');
    expect(Array.from(new Uint8Array(await read(blob)))).toEqual([0, 255, 7]);
    expect(response.bodyUsed).toBe(true);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});

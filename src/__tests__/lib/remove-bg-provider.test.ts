import JSZip from 'jszip';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiProvider } from '@/lib/universal-api-types';
import {
  decodeDedicatedRemoveBgResponse,
  parseRemoveBgProviderOptions,
  submitDedicatedRemoveBg,
} from '@/lib/remove-bg-provider';

function provider(advancedParams: Record<string, string> = {}): ApiProvider {
  return {
    id: 'remove-bg-provider',
    name: 'Remove BG',
    baseUrl: 'https://api.remove.example',
    apiKey: 'server-secret',
    isEnabled: true,
    type: 'removebg',
    modelType: 'removebg',
    createdAt: 1,
    updatedAt: 1,
    advancedParams,
  };
}

async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: '#cc8844' },
  }).png().toBuffer();
}

async function transparentPng(): Promise<Buffer> {
  const rgba = Buffer.alloc(4 * 4 * 4, 0);
  for (let pixel = 0; pixel < 16; pixel += 1) {
    const offset = pixel * 4;
    rgba[offset] = 204;
    rgba[offset + 1] = 136;
    rgba[offset + 2] = 68;
    rgba[offset + 3] = pixel < 8 ? 255 : 0;
  }
  return sharp(rgba, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
}

function dataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dedicated RemoveBG provider adapter', () => {
  it('parses a bounded multipart provider profile', () => {
    expect(parseRemoveBgProviderOptions({
      removeBgRequestProfile: 'removebg-multipart',
      removeBgImageInput: 'file',
      removeBgResponseMode: 'zip',
      removeBgEndpointPath: '/v1.0/removebg',
      removeBgApiKeyHeader: 'Authorization',
      removeBgTransparentOutput: 'false',
      removeBgMaxInputMegapixels: '999',
      removeBgZipColorFile: 'result/color.png',
      removeBgZipAlphaFile: 'result/alpha.png',
    })).toMatchObject({
      requestProfile: 'removebg-multipart',
      imageInput: 'file',
      responseMode: 'zip',
      endpointPath: '/v1.0/removebg',
      apiKeyHeader: 'Authorization',
      transparentOutputRequired: false,
      maxInputMegapixels: 40,
      zipColorFile: 'result/color.png',
      zipAlphaFile: 'result/alpha.png',
    });
  });

  it('sends source bytes as multipart data and keeps the API key server-side', async () => {
    const source = await sourcePng();
    const output = await transparentPng();
    const fetchMock = vi.fn().mockResolvedValue(new Response(Uint8Array.from(output), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitDedicatedRemoveBg(
      provider({ removeBgRequestProfile: 'removebg-multipart' }),
      dataUrl(source),
    );

    expect(result.mimeType).toBe('image/png');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.remove.example/v1.0/removebg');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'server-secret' });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('image_file')).toBeInstanceOf(Blob);
    expect(JSON.stringify(result)).not.toContain('server-secret');
  });

  it('rejects an opaque response when transparent output is required', async () => {
    const source = await sourcePng();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Uint8Array.from(source), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));

    await expect(submitDedicatedRemoveBg(provider(), dataUrl(source))).rejects.toMatchObject({
      code: 'REMOVE_BG_OUTPUT_INVALID',
    });
  });

  it('composes ZIP color and alpha images into a real transparent PNG', async () => {
    const source = await sourcePng();
    const alpha = Buffer.from([
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const alphaPng = await sharp(alpha, { raw: { width: 4, height: 4, channels: 1 } }).png().toBuffer();
    const zip = new JSZip();
    zip.file('result/color.png', source);
    zip.file('result/alpha.png', alphaPng);
    const archive = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await decodeDedicatedRemoveBgResponse(
      new Response(Uint8Array.from(archive), { headers: { 'content-type': 'application/zip' } }),
      source,
      parseRemoveBgProviderOptions({
        removeBgResponseMode: 'zip',
        removeBgZipColorFile: 'result/color.png',
        removeBgZipAlphaFile: 'result/alpha.png',
      }),
    );
    const stats = await sharp(result.buffer).stats();

    expect(result.mimeType).toBe('image/png');
    expect(stats.channels[3].min).toBe(0);
    expect(stats.channels[3].max).toBe(255);
  });

  it('rejects ZIP traversal before decoding provider output', async () => {
    const source = await sourcePng();
    const zip = new JSZip();
    zip.file('../secret.png', source);
    zip.file('result/color.png', source);
    zip.file('result/alpha.png', source);
    const archive = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(decodeDedicatedRemoveBgResponse(
      new Response(Uint8Array.from(archive), { headers: { 'content-type': 'application/zip' } }),
      source,
      parseRemoveBgProviderOptions({ removeBgResponseMode: 'zip' }),
    )).rejects.toMatchObject({ code: 'REMOVE_BG_OUTPUT_INVALID' });
  });
});

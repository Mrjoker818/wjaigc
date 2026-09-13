import { describe, expect, it } from 'vitest';

import { readGatewayJson } from '@/lib/media-gateway/http';
import {
  digestGatewayRequest,
  normalizeGatewayImageRequest,
  normalizeGatewayVideoRequest,
} from '@/lib/media-gateway/schema';
import { GatewayError } from '@/lib/media-gateway/types';

function expectGatewayError(action: () => unknown, code: string, status: number): void {
  try {
    action();
    throw new Error('Expected gateway validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ code, status });
  }
}

function requestFromBytes(bytes: Uint8Array, contentLength?: string): Request {
  const request = new Request('http://gateway.test', {
    method: 'POST',
    body: bytes.slice().buffer as ArrayBuffer,
  });
  if (contentLength !== undefined) {
    Object.defineProperty(request, 'headers', {
      value: { get: (name: string) => name.toLowerCase() === 'content-length' ? contentLength : null },
    });
  }
  return request;
}

describe('media gateway request boundary', () => {
  it('accepts a JSON body whose encoded size is exactly the configured limit', async () => {
    const maxBytes = 64;
    const prefix = '{"value":"';
    const suffix = '"}';
    const body = `${prefix}${'x'.repeat(maxBytes - prefix.length - suffix.length)}${suffix}`;

    await expect(readGatewayJson(new Request('http://gateway.test', {
      method: 'POST',
      body,
      headers: { 'content-length': String(maxBytes) },
    }), maxBytes)).resolves.toEqual({ value: 'x'.repeat(52) });
  });

  it('rejects declared and streamed bodies over the byte limit', async () => {
    const declared = new Request('http://gateway.test', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': '65' },
    });
    await expect(readGatewayJson(declared, 64)).rejects.toMatchObject({
      code: 'GATEWAY_BODY_TOO_LARGE', status: 413,
    });

    const streamed = new Request('http://gateway.test', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    });
    await expect(readGatewayJson(streamed, 64)).rejects.toMatchObject({
      code: 'GATEWAY_BODY_TOO_LARGE', status: 413,
    });
  });

  it('rejects invalid and empty JSON bodies without exposing parser details', async () => {
    for (const body of ['', '{bad json']) {
      await expect(readGatewayJson(new Request('http://gateway.test', {
        method: 'POST', body,
      }))).rejects.toMatchObject({
        code: 'GATEWAY_INVALID_REQUEST', status: 400,
        message: '请求体不是有效 JSON',
      });
    }
  });

  it.each([
    Uint8Array.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]),
    Uint8Array.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0xe4, 0xb8, 0x22, 0x7d]),
  ])('rejects malformed UTF-8 bytes with a stable invalid-request error', async (bytes) => {
    await expect(readGatewayJson(requestFromBytes(bytes))).rejects.toMatchObject({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 400,
      message: '请求体不是有效 JSON',
    });
  });

  it('counts valid multibyte JSON by bytes at the exact limit and over it', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ value: '边界' }));

    await expect(readGatewayJson(
      requestFromBytes(bytes, String(bytes.byteLength)),
      bytes.byteLength,
    )).resolves.toEqual({ value: '边界' });
    await expect(readGatewayJson(
      requestFromBytes(bytes),
      bytes.byteLength - 1,
    )).rejects.toMatchObject({
      code: 'GATEWAY_BODY_TOO_LARGE',
      status: 413,
    });
  });

  it.each(['1.5', '1e3', '0x10', '+2', '-0', '-1', ' 2', '2 ', '\t2', '2\n', '', '2bytes'])
  ('rejects malformed Content-Length syntax: %j', async (contentLength) => {
    await expect(readGatewayJson(
      requestFromBytes(new TextEncoder().encode('{}'), contentLength),
    )).rejects.toMatchObject({
      code: 'GATEWAY_INVALID_REQUEST',
      status: 400,
      message: '请求体长度无效',
    });
  });

  it('accepts non-negative base-10 integer Content-Length syntax', async () => {
    await expect(readGatewayJson(
      requestFromBytes(new TextEncoder().encode('{}'), '0002'),
    )).resolves.toEqual({});
  });
});

describe('media gateway schema normalization', () => {
  it('normalizes the supported image request fields', () => {
    expect(normalizeGatewayImageRequest({
      prompt: '  draw this  ', providerId: 'provider/a', modelId: 'model:v1',
      n: 4, aspectRatio: '16:9', size: '1536x1024', quality: 'high',
      referenceImages: [' https://images.example/a.png ', '/uploads/b.png'],
      apiKey: 'must-not-pass-through', sourceChannel: 'must-not-pass-through',
    })).toEqual({
      prompt: 'draw this', providerId: 'provider/a', modelId: 'model:v1',
      n: 4, aspectRatio: '16:9', size: '1536x1024', quality: 'high',
      referenceImages: ['https://images.example/a.png', '/uploads/b.png'],
    });
  });

  it('enforces prompt boundaries from 1 through 20000 trimmed characters', () => {
    expect(normalizeGatewayImageRequest({
      prompt: ` ${'x'.repeat(20_000)} `, providerId: 'p', modelId: 'm',
    }).prompt).toHaveLength(20_000);
    for (const prompt of ['', '   ', 'x'.repeat(20_001)]) {
      expectGatewayError(
        () => normalizeGatewayImageRequest({ prompt, providerId: 'p', modelId: 'm' }),
        'GATEWAY_INVALID_REQUEST', 400,
      );
    }
  });

  it('enforces provider and model identifier character and length boundaries', () => {
    const validId = `a${'b'.repeat(198)}z`;
    expect(normalizeGatewayImageRequest({
      prompt: 'x', providerId: validId, modelId: 'vendor/model:v1.2_test',
    })).toMatchObject({ providerId: validId, modelId: 'vendor/model:v1.2_test' });

    for (const value of ['', 'contains space', '../escape', 'x'.repeat(201)]) {
      expectGatewayError(
        () => normalizeGatewayImageRequest({ prompt: 'x', providerId: value, modelId: 'm' }),
        'GATEWAY_INVALID_REQUEST', 400,
      );
    }
  });

  it('enforces the platform image output ceiling', () => {
    expect(normalizeGatewayImageRequest({
      prompt: 'x', providerId: 'p', modelId: 'm', n: 1,
    }).n).toBe(1);
    for (const n of [0, 5, 1.5, '2']) {
      expectGatewayError(
        () => normalizeGatewayImageRequest({ prompt: 'x', providerId: 'p', modelId: 'm', n }),
        'GATEWAY_INVALID_REQUEST', 400,
      );
    }
  });

  it('reuses the existing image URL validator and preserves reference order', () => {
    expect(normalizeGatewayImageRequest({
      prompt: 'x', providerId: 'p', modelId: 'm',
      referenceImages: ['/uploads/first.png', 'data:image/png;base64,AAAA'],
    }).referenceImages).toEqual(['/uploads/first.png', 'data:image/png;base64,AAAA']);
    expectGatewayError(
      () => normalizeGatewayImageRequest({
        prompt: 'x', providerId: 'p', modelId: 'm', referenceImages: ['file:///secret.png'],
      }),
      'GATEWAY_INVALID_REQUEST', 400,
    );
  });

  it('normalizes video duration, frames, and reference images', () => {
    expect(normalizeGatewayVideoRequest({
      prompt: '  animate  ', providerId: 'video-provider', modelId: 'video/model',
      duration: 10, aspectRatio: '16:9',
      firstFrameImageUrl: '/uploads/first.png',
      lastFrameImageUrl: 'https://images.example/last.png',
      referenceImages: ['/api/serve-upload/reference.png'],
    })).toEqual({
      prompt: 'animate', providerId: 'video-provider', modelId: 'video/model',
      duration: 10, aspectRatio: '16:9',
      firstFrameImageUrl: '/uploads/first.png',
      lastFrameImageUrl: 'https://images.example/last.png',
      referenceImages: ['/api/serve-upload/reference.png'],
    });
    expectGatewayError(
      () => normalizeGatewayVideoRequest({
        prompt: 'x', providerId: 'p', modelId: 'm', duration: 0,
      }),
      'GATEWAY_INVALID_REQUEST', 400,
    );
  });

  it.each([
    ['image', normalizeGatewayImageRequest],
    ['video', normalizeGatewayVideoRequest],
  ] as const)('treats null aspectRatio as omission for %s requests', (_mediaType, normalize) => {
    expect(normalize({
      prompt: 'x', providerId: 'p', modelId: 'm', aspectRatio: null,
    })).not.toHaveProperty('aspectRatio');
  });

  it.each([
    ['image', normalizeGatewayImageRequest, 1],
    ['image', normalizeGatewayImageRequest, true],
    ['image', normalizeGatewayImageRequest, {}],
    ['image', normalizeGatewayImageRequest, []],
    ['video', normalizeGatewayVideoRequest, 1],
    ['video', normalizeGatewayVideoRequest, true],
    ['video', normalizeGatewayVideoRequest, {}],
    ['video', normalizeGatewayVideoRequest, []],
  ] as const)('rejects non-string aspectRatio for %s requests', (_mediaType, normalize, aspectRatio) => {
    expectGatewayError(
      () => normalize({ prompt: 'x', providerId: 'p', modelId: 'm', aspectRatio }),
      'GATEWAY_INVALID_REQUEST',
      400,
    );
  });
});

describe('media gateway request digest', () => {
  it('canonicalizes object keys but preserves ordered reference images', () => {
    expect(digestGatewayRequest({ prompt: ' x ', providerId: 'p', modelId: 'm', referenceImages: ['a', 'b'] }))
      .toBe(digestGatewayRequest({ modelId: 'm', referenceImages: ['a', 'b'], providerId: 'p', prompt: 'x' }));
    expect(digestGatewayRequest({ providerId: 'p', modelId: 'm', prompt: 'x', referenceImages: ['b', 'a'] }))
      .not.toBe(digestGatewayRequest({ providerId: 'p', modelId: 'm', prompt: 'x', referenceImages: ['a', 'b'] }));
  });

  it('does not incorporate gateway or provider secrets', () => {
    const request = { prompt: 'x', providerId: 'p', modelId: 'm' };
    expect(digestGatewayRequest({ ...request, apiKey: 'provider-secret', gatewayKey: 'gateway-secret' }))
      .toBe(digestGatewayRequest({ ...request, apiKey: 'different', gatewayKey: 'different' }));
    expect(digestGatewayRequest(request)).toMatch(/^[a-f0-9]{64}$/);
  });
});

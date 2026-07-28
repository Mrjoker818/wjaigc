import { describe, expect, it } from 'vitest';
import {
  parseLayerRequest,
  readLayerRequest,
  validateLayerIdempotencyKey,
} from '@/lib/layer-decomposition/validation';

describe('layer decomposition request validation', () => {
  it('accepts the three explicit engine modes', () => {
    for (const engine of ['smart', 'cloud', 'local'] as const) {
      expect(parseLayerRequest({
        imageUrl: '/api/serve-upload/source.png',
        engine,
      }).engine).toBe(engine);
    }
  });

  it('applies safe defaults and trims exact provider selection', () => {
    expect(parseLayerRequest({
      imageUrl: ' /api/serve-upload/source.png ',
      providerId: ' pear ',
      modelId: ' Image-Layered ',
    })).toEqual({
      imageUrl: '/api/serve-upload/source.png',
      engine: 'smart',
      providerId: 'pear',
      modelId: 'Image-Layered',
    });
  });

  it('rejects oversized data URLs and unknown modes', () => {
    expect(() => parseLayerRequest({
      imageUrl: `data:image/png;base64,${'A'.repeat(21_000_000)}`,
    })).toThrow(/image/i);
    expect(() => parseLayerRequest({
      imageUrl: '/a.png',
      engine: 'automatic',
    })).toThrow(/mode/i);
  });

  it('rejects unsupported data URL MIME types and malformed base64', () => {
    expect(() => parseLayerRequest({
      imageUrl: 'data:text/html;base64,PGgxPng8L2gxPg==',
    })).toThrow(/image/i);
    expect(() => parseLayerRequest({
      imageUrl: 'data:image/png;base64,%%%%',
    })).toThrow(/image/i);
  });

  it('requires a stable 8-128 character idempotency key', () => {
    expect(validateLayerIdempotencyKey('layer_123456')).toBe('layer_123456');
    expect(() => validateLayerIdempotencyKey('short')).toThrow(/idempotency/i);
    expect(() => validateLayerIdempotencyKey('bad key')).toThrow(/idempotency/i);
    expect(() => validateLayerIdempotencyKey(`layer_${'x'.repeat(129)}`))
      .toThrow(/idempotency/i);
  });

  it('stops reading request bodies above 16 MiB', async () => {
    const request = new Request('http://localhost/api/layered-decompose', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: '/api/serve-upload/source.png',
        padding: 'x'.repeat(16 * 1024 * 1024),
      }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(readLayerRequest(request)).rejects.toThrow(/body/i);
  });
});

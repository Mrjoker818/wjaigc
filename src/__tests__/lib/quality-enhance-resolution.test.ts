import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhanceViaAI } from '@/lib/quality-enhance';
import type { ApiProvider } from '@/lib/universal-api-types';

const media = vi.hoisted(() => ({ download: vi.fn(), persist: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-api-config', () => ({ findProviderForModel: async (): Promise<never> => { throw new Error('Unexpected provider lookup'); } }));
vi.mock('@/lib/safe-image-download', () => ({ downloadPublicImage: media.download }));
vi.mock('@/lib/asset-core/binary-persistence', () => ({ persistAssetBytes: media.persist }));

afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('upscale enhancement request resolution / real helper and Sharp', (): void => {
  // Wrong tier thresholds, ignored targets/models or ignored source aspect ratios break these literal requests.
  it.each([
    ['2K square', 4, 4, 2048, 2048, '2048x2048'],
    ['4K square', 4, 4, 4096, 4096, '4096x4096'],
    ['8K capped at 4K', 4, 4, 8192, 8192, '4096x4096'],
    ['2K landscape', 16, 9, 2048, 1152, '2560x1440'],
    ['4K landscape', 16, 9, 4096, 2304, '4096x2304'],
    ['8K portrait', 9, 16, 4608, 8192, '2304x4096'],
    ['below threshold', 4, 4, 3071, 3071, '2048x2048'],
    ['threshold', 4, 4, 3072, 3072, '4096x4096'],
  ] as const)('%s sends the exact model and requested tier', async (_name, width, height, targetWidth, targetHeight, size): Promise<void> => {
    vi.stubEnv('INTERNAL_API_SECRET', 'offline-j4f-resolution-secret-at-least-32-characters');
    const source = 'https://media.invalid/j4f-resolution.png';
    const output = 'https://media.invalid/j4f-enhanced.png';
    const model = 'seedream-4-5';
    const p: ApiProvider = { id: 'admitted-resolution', name: 'Resolution', type: 'image', isEnabled: true,
      baseUrl: 'https://resolution.invalid/v1', apiKey: 'offline-resolution-key', createdAt: 1, updatedAt: 1 };
    const png = await sharp({ create: { width, height, channels: 3, background: '#997744' } }).png().toBuffer();
    media.download.mockResolvedValue({ buffer: png, mimeType: 'image/png' });
    media.persist.mockResolvedValue({ url: '/api/serve-upload/exports/j4f-resolution.png' });
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      if (request.url === source && request.method === 'GET') return new Response(Uint8Array.from(png), { headers: { 'content-type': 'image/png' } });
      if (request.url === p.baseUrl + '/images/generations' && request.method === 'POST') {
        requests.push(request); return Response.json({ imageUrl: output });
      }
      throw new Error('Undeclared network: ' + request.method + ' ' + request.url);
    });
    expect(await enhanceViaAI(source, model, p.id, { targetWidth, targetHeight }, p)).toEqual({ url: '/api/serve-upload/exports/j4f-resolution.png', enhanced: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('authorization')).toBe('Bearer offline-resolution-key');
    expect(await requests[0].json()).toMatchObject({ model: 'seedream-4-5', size, n: 1, response_format: 'url', image_urls: [source], referenceStrength: 30 });
  });
});

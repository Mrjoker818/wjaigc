// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { analyzeImageWithAIForTest } from '@/lib/psd-export';

const image = 'data:image/png;base64,aW1hZ2U=';

describe('PSD analysis browser client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses one dedicated request with a stable idempotency key and never calls chat', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      taskId: 'task-1',
      requestId: 'req-1',
      providerId: 'pear',
      model: 'gpt-4o',
      analysis: {
        backgroundColor: [255, 255, 255],
        backgroundMode: 'white',
        layers: [{ name: 'Background', role: 'bg', description: 'White background' }],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(analyzeImageWithAIForTest(image)).resolves.toMatchObject({
      bgColor: [255, 255, 255],
      backgroundMode: 'white',
      layers: [{ role: 'background' }],
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/analyze-psd');
    const init = vi.mocked(fetch).mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toMatch(/^psd-analysis-[A-Za-z0-9-]+$/);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null after a dedicated endpoint failure without a second paid request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      success: false,
      code: 'PSD_ANALYSIS_UPSTREAM_FAILED',
    }), { status: 502 }));

    await expect(analyzeImageWithAIForTest(image)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/analyze-psd');
  });
});

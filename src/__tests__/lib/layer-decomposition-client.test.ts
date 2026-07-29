import { describe, expect, it } from 'vitest';

import {
  cancelLayerDecomposition,
  getLayerPhasePresentation,
  LayerClientError,
  normalizeLayerImageUrlForSubmission,
  runLayerDecomposition,
} from '@/lib/layer-decomposition-client';

describe('layer decomposition client', () => {
  it('maps provider phases to approved user-facing progress labels', () => {
    expect(getLayerPhasePresentation('waiting-for-pear')).toEqual({
      label: 'Pear 正在生成 PSD', progress: 35,
    });
    expect(getLayerPhasePresentation('checking-quality')).toEqual({
      label: '正在检查分层质量', progress: 88,
    });
    expect(getLayerPhasePresentation('ready')).toEqual({
      label: '正在打开图层编辑器', progress: 100,
    });
  });

  it('submits current-origin managed media as a server-owned relative path', () => {
    expect(normalizeLayerImageUrlForSubmission(
      'https://preview.example/api/serve-upload/generate/source.png?cache=1',
      'https://preview.example',
    )).toBe('/api/serve-upload/generate/source.png');
  });

  it('does not rewrite external or unmanaged image URLs', () => {
    expect(normalizeLayerImageUrlForSubmission(
      'https://cdn.example/api/serve-upload/generate/source.png',
      'https://preview.example',
    )).toBe('https://cdn.example/api/serve-upload/generate/source.png');
    expect(normalizeLayerImageUrlForSubmission(
      'https://preview.example/public/source.png',
      'https://preview.example',
    )).toBe('https://preview.example/public/source.png');
  });

  it('submits once and polls until persisted layers are completed', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const responses = [
      { success: true, taskId: 'layer-1', status: 'processing', phase: 'waiting-for-pear', progress: 15 },
      { success: true, taskId: 'layer-1', status: 'processing', phase: 'refining-layers', progress: 75 },
      {
        success: true,
        taskId: 'layer-1',
        status: 'completed',
        phase: 'ready',
        progress: 100,
        result: { width: 8, height: 8, layers: [], engine: 'pear', quality: { status: 'pass', score: 99, warnings: [] } },
      },
    ];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method || 'GET' });
      return new Response(JSON.stringify(responses.shift()), {
        status: calls.length === 1 ? 202 : 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await runLayerDecomposition({
      imageUrl: '/source.png',
      engine: 'cloud',
      providerId: 'pear-provider',
      modelId: 'Image-Layered',
      fetcher,
      wait: async () => {},
      idempotencyKey: 'layer-request-123',
    });

    expect(result.engine).toBe('pear');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
  });

  it('does not silently run local when cloud mode has no authorized model', async () => {
    const fetcher = async () => new Response(JSON.stringify({ success: true, models: [] }), {
      headers: { 'content-type': 'application/json' },
    });

    await expect(runLayerDecomposition({
      imageUrl: '/source.png',
      engine: 'cloud',
      fetcher,
      wait: async () => {},
      idempotencyKey: 'layer-request-456',
    })).rejects.toMatchObject({ code: 'LAYER_PROVIDER_REQUIRED' } satisfies Partial<LayerClientError>);
  });

  it('cancels through the persisted task endpoint', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/layered-decompose?taskId=layer-1');
      expect(init?.method).toBe('DELETE');
      return new Response(JSON.stringify({
        success: true, taskId: 'layer-1', status: 'cancelled', progress: 35,
      }), { headers: { 'content-type': 'application/json' } });
    };

    await expect(cancelLayerDecomposition('layer-1', { fetcher })).resolves.toMatchObject({
      taskId: 'layer-1', status: 'cancelled',
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  cancelLayerDecomposition,
  createLayerIdempotencyKey,
  getLayerPhasePresentation,
  LayerClientError,
  normalizeLayerImageUrlForSubmission,
  runLayerDecomposition,
} from '@/lib/layer-decomposition-client';

describe('layer decomposition client', () => {
  it('creates a bounded stable-format idempotency key for one editor attempt', () => {
    const key = createLayerIdempotencyKey();

    expect(key).toMatch(/^layer-[A-Za-z0-9-]+$/);
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
  });

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
    const calls: Array<{ url: string; method: string; keepalive?: boolean }> = [];
    const targetEvents: string[] = [];
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
      calls.push({ url: String(input), method: init?.method || 'GET', keepalive: init?.keepalive });
      if (init?.method === 'POST') targetEvents.push('post');
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
      keepalive: true,
      idempotencyKey: 'layer-request-123',
      onResolvedTarget: async ({ providerId, modelId }: { providerId: string; modelId: string }) => {
        targetEvents.push(`${providerId}/${modelId}`);
      },
    } as Parameters<typeof runLayerDecomposition>[0] & {
      onResolvedTarget: (target: { providerId: string; modelId: string }) => Promise<void>;
    });

    expect(result.engine).toBe('pear');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.find((call) => call.method === 'POST')?.keepalive).toBe(true);
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    expect(targetEvents).toEqual(['pear-provider/Image-Layered', 'post']);
  });

  it('resumes an accepted task directly without another submit', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method || 'GET' });
      return new Response(JSON.stringify({
        success: true,
        taskId: 'layer-resume-1',
        status: 'completed',
        phase: 'ready',
        progress: 100,
        result: {
          width: 8,
          height: 8,
          layers: [],
          engine: 'pear',
          quality: { status: 'pass', score: 99, warnings: [] },
        },
      }), { headers: { 'content-type': 'application/json' } });
    };

    await runLayerDecomposition({
      imageUrl: '/source.png',
      engine: 'smart',
      resumeTaskId: 'layer-resume-1',
      fetcher,
      wait: async () => {},
      idempotencyKey: 'layer-request-resume-1',
    });

    expect(calls).toEqual([{
      url: '/api/layered-decompose?taskId=layer-resume-1',
      method: 'GET',
    }]);
  });

  it('uses the authoritative persisted target returned before POST', async () => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        success: true,
        taskId: 'authoritative-target-task',
        status: 'completed',
        phase: 'ready',
        progress: 100,
        result: {
          width: 8,
          height: 8,
          layers: [],
          engine: 'pear',
          quality: { status: 'pass', score: 99, warnings: [] },
        },
      }), { headers: { 'content-type': 'application/json' } });
    };

    await runLayerDecomposition({
      imageUrl: '/source.png',
      engine: 'cloud',
      providerId: 'new-provider',
      modelId: 'new-model',
      fetcher,
      idempotencyKey: 'authoritative-target-key',
      onResolvedTarget: async () => ({
        providerId: 'persisted-provider',
        modelId: 'persisted-model',
      }),
    } as Parameters<typeof runLayerDecomposition>[0] & {
      onResolvedTarget: () => Promise<{ providerId: string; modelId: string }>;
    });

    expect(submittedBody).toMatchObject({
      providerId: 'persisted-provider',
      modelId: 'persisted-model',
    });
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

  it('replays a frozen empty smart target without resolving a new provider', async () => {
    const calls: string[] = [];
    const resolvedTargets: Array<{ providerId: string; modelId: string } | null> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      expect(String(input)).toBe('/api/layered-decompose');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty('providerId');
      expect(body).not.toHaveProperty('modelId');
      return new Response(JSON.stringify({
        success: true,
        taskId: 'frozen-empty-target-task',
        status: 'completed',
        phase: 'ready',
        progress: 100,
        result: {
          width: 8,
          height: 8,
          layers: [],
          engine: 'local',
          quality: { status: 'pass', score: 99, warnings: [] },
        },
      }), { headers: { 'content-type': 'application/json' } });
    };

    await runLayerDecomposition({
      imageUrl: '/source.png',
      engine: 'smart',
      skipDefaultTargetResolution: true,
      fetcher,
      idempotencyKey: 'frozen-empty-target-key',
      onResolvedSubmissionTarget: (target) => { resolvedTargets.push(target); },
    });

    expect(calls).toEqual(['/api/layered-decompose']);
    expect(resolvedTargets).toEqual([null]);
  });

  it('cancels through the persisted task endpoint', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/layered-decompose?taskId=layer-1');
      expect(init?.method).toBe('DELETE');
      expect(init?.keepalive).toBe(true);
      return new Response(JSON.stringify({
        success: true, taskId: 'layer-1', status: 'cancelled', progress: 35,
      }), { headers: { 'content-type': 'application/json' } });
    };

    await expect(cancelLayerDecomposition('layer-1', {
      fetcher,
      keepalive: true,
    })).resolves.toMatchObject({
      taskId: 'layer-1', status: 'cancelled',
    });
  });
});

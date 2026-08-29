import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelElementDecomposition,
  createElementDecompositionRequest,
  createResolvedElementDecompositionRequest,
  getRefundedLocalLayerFallbackMessage,
  pollElementDecomposition,
  recoverElementDecomposition,
  resolveCompletedElementLayersEditorPayload,
  retryElementDecompositionBranch,
  submitElementDecomposition,
  type ElementDecomposeTaskResponse,
} from '@/lib/element-decomposition/client';

const source = {
  projectId: 'project-1',
  sourceImageId: 'image-1',
  sourceVersionId: 'version-1',
  imageUrl: '/api/serve-upload/uploads/source.png',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('element decomposition client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('creates a frozen dual-output request by default', () => {
    const request = createElementDecompositionRequest(source, {
      aspectRatio: '16:9',
      background: 'transparent',
      engine: 'smart',
    });

    source.imageUrl = '/api/serve-upload/uploads/changed.png';

    expect(request).toMatchObject({
      projectId: 'project-1',
      sourceImageId: 'image-1',
      sourceVersionId: 'version-1',
      imageUrl: '/api/serve-upload/uploads/source.png',
      outputMode: 'both',
      board: { aspectRatio: '16:9', background: 'transparent' },
      layers: { engine: 'smart', requireTransparentSubject: true },
    });
  });

  it('describes any refunded local layer fallback without inventing a quality-gate cause', () => {
    expect(getRefundedLocalLayerFallbackMessage({
      branch: 'layers',
      taskId: 'layer-1',
      status: 'completed',
      progress: 100,
      creditStatus: 'refunded',
      fallbackReason: 'Pear provider timed out',
      providerError: { code: 'PEAR_TIMEOUT', message: 'Pear provider timed out' },
      result: { engine: 'local' },
    })).toBe('Pear 云端分层未完成，已退款并使用本地分层');
  });

  it('does not report a refunded local fallback when the branch did not use local output', () => {
    expect(getRefundedLocalLayerFallbackMessage({
      branch: 'layers',
      taskId: 'layer-1',
      status: 'completed',
      progress: 100,
      creditStatus: 'refunded',
      fallbackReason: 'Pear provider timed out',
      result: { engine: 'pear' },
    })).toBeNull();
  });

  it('resolves a completed layer result into editor state without making a second request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const layerResult = {
      width: 800,
      height: 600,
      engine: 'pear',
      layers: [{ id: 'layer-1', name: '主体' }],
    };
    const task: ElementDecomposeTaskResponse = {
      taskId: 'parent-task-1',
      status: 'completed',
      overallStatus: 'completed',
      progress: 100,
      source: {
        sourceImageId: 'image-1',
        sourceVersionId: 'version-1',
        canonicalUrl: '/api/serve-upload/source.png',
        managedUrl: '/api/serve-upload/source.png',
        sha256: 'sha256',
        width: 800,
        height: 600,
        mimeType: 'image/png',
      },
      branches: {
        layers: {
          branch: 'layers',
          taskId: 'layer-task-1',
          status: 'completed',
          progress: 100,
          result: layerResult,
        },
      },
    };

    expect(resolveCompletedElementLayersEditorPayload(task, 'project-1')).toEqual({
      imageUrl: '/api/serve-upload/source.png',
      initialResult: layerResult,
      source: {
        projectId: 'project-1',
        sourceImageId: 'image-1',
        sourceVersionId: 'version-1',
        imageUrl: '/api/serve-upload/source.png',
        taskId: 'parent-task-1',
      },
      mode: 'studio',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not expose an editor payload for a non-completed layer branch', () => {
    const task = {
      taskId: 'parent-task-1',
      status: 'processing',
      overallStatus: 'processing',
      progress: 50,
      source: {
        sourceImageId: 'image-1',
        sourceVersionId: 'version-1',
        canonicalUrl: '/api/serve-upload/source.png',
        managedUrl: '/api/serve-upload/source.png',
        sha256: 'sha256',
        width: 800,
        height: 600,
        mimeType: 'image/png',
      },
      branches: {
        layers: {
          branch: 'layers',
          taskId: 'layer-task-1',
          status: 'processing',
          progress: 50,
          result: { width: 800, height: 600, engine: 'pear', layers: [{ id: 'layer-1' }] },
        },
      },
    } as ElementDecomposeTaskResponse;

    expect(resolveCompletedElementLayersEditorPayload(task, 'project-1')).toBeNull();
  });

  it('keeps the board image model separate from the layer model', () => {
    const request = createElementDecompositionRequest(source, {
      aspectRatio: '16:9',
      boardProviderId: 'image-provider',
      boardModelId: 'gpt-image-1',
      engine: 'cloud',
      layerProviderId: 'pear-provider',
      layerModelId: 'Image-Layered',
    });

    expect(request.board).toEqual({
      aspectRatio: '16:9',
      background: 'light-gray',
      providerId: 'image-provider',
      modelId: 'gpt-image-1',
    });
    expect(request.layers).toEqual({
      engine: 'cloud',
      providerId: 'pear-provider',
      modelId: 'Image-Layered',
      requireTransparentSubject: false,
    });
  });

  it('resolves the authorized Pear layer provider before building a layer request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      success: true,
      models: [
        {
          id: 'Image-Layered',
          name: 'Image Layered',
          providerId: 'pear-layer-provider',
          type: 'layer',
        },
      ],
    }));

    const request = await createResolvedElementDecompositionRequest(source, {
      outputMode: 'layers',
      aspectRatio: '1:1',
      engine: 'smart',
    }, { fetcher: fetchMock });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow/models?type=layer', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }));
    expect(request.layers).toMatchObject({
      engine: 'smart',
      providerId: 'pear-layer-provider',
      modelId: 'Image-Layered',
    });
  });

  it('preserves the smart local fallback when the layer catalog is temporarily unavailable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network unavailable'));

    await expect(createResolvedElementDecompositionRequest(source, {
      outputMode: 'layers',
      aspectRatio: '1:1',
      engine: 'smart',
    }, { fetcher: fetchMock })).resolves.toMatchObject({
      layers: {
        engine: 'smart',
        providerId: undefined,
        modelId: undefined,
      },
    });
  });

  it('submits exactly once with an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      taskId: 'parent-1', status: 'processing', overallStatus: 'processing', progress: 5,
      source: {}, branches: {},
    }, 202));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitElementDecomposition(
      createElementDecompositionRequest(source, { aspectRatio: '16:9' }),
      'element-click-1',
    );

    expect(result.taskId).toBe('parent-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/element-decompose', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'idempotency-key': 'element-click-1' }),
    }));
  });

  it('polls until a partial terminal result and exposes both branch states', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        taskId: 'parent-1', status: 'processing', overallStatus: 'processing', progress: 45,
        source: {},
        branches: {
          board: { branch: 'board', taskId: 'board-1', status: 'completed', progress: 100, result: { imageUrl: '/board.png' } },
          layers: { branch: 'layers', taskId: 'layers-1', status: 'processing', progress: 20 },
        },
      }))
      .mockResolvedValueOnce(response({
        taskId: 'parent-1', status: 'completed', overallStatus: 'partial', progress: 50,
        source: {},
        branches: {
          board: { branch: 'board', taskId: 'board-1', status: 'completed', progress: 100, result: { imageUrl: '/board.png' } },
          layers: { branch: 'layers', taskId: 'layers-1', status: 'failed', progress: 0, error: 'PSD parse failed' },
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const updates: unknown[] = [];

    const pending = pollElementDecomposition('parent-1', update => updates.push(update), undefined, 25);
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;

    expect(result.overallStatus).toBe('partial');
    expect(result.branches.board?.status).toBe('completed');
    expect(result.branches.layers?.status).toBe('failed');
    expect(updates).toHaveLength(2);
  });

  it('recovers a project parent with one read-only GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      taskId: 'parent-recovered', status: 'completed', overallStatus: 'completed', progress: 100,
      source: {}, branches: {},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverElementDecomposition('project/one')).resolves.toMatchObject({ taskId: 'parent-recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/element-decompose?projectId=project%2Fone',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('maps a missing recovery to null and preserves other structured errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ success: false, code: 'ELEMENT_TASK_NOT_FOUND', message: 'missing' }, 404))
      .mockResolvedValueOnce(response({ success: false, code: 'ELEMENT_INTERNAL_ERROR', message: 'offline', retryable: true }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(recoverElementDecomposition('project-1')).resolves.toBeNull();
    await expect(recoverElementDecomposition('project-1')).rejects.toMatchObject({
      code: 'ELEMENT_INTERNAL_ERROR', status: 503, retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries only the requested failed branch and can cancel the parent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ taskId: 'parent-1', status: 'processing', overallStatus: 'processing', progress: 50, source: {}, branches: {} }))
      .mockResolvedValueOnce(response({ taskId: 'parent-1', status: 'cancelled', overallStatus: 'cancelled', progress: 50, source: {}, branches: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await retryElementDecompositionBranch('parent-1', 'layers');
    await cancelElementDecomposition('parent-1');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: 'retry', taskId: 'parent-1', branch: 'layers',
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/element-decompose?taskId=parent-1',
      expect.objectContaining({ method: 'DELETE' }),
    ]);
  });

  it('preserves the structured API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      success: false,
      code: 'ELEMENT_SOURCE_STALE',
      message: 'source changed',
      retryable: false,
    }, 409)));

    await expect(submitElementDecomposition(
      createElementDecompositionRequest(source, { aspectRatio: '16:9' }),
      'element-click-2',
    )).rejects.toMatchObject({
      code: 'ELEMENT_SOURCE_STALE', status: 409, retryable: false,
    });
  });
});

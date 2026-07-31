import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelElementDecomposition,
  createElementDecompositionRequest,
  pollElementDecomposition,
  retryElementDecompositionBranch,
  submitElementDecomposition,
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
      layers: { engine: 'smart' },
    });
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

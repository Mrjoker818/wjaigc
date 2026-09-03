import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildWorkflowLayerIdempotencyKey,
  cancelLayerWorkflowTask,
  executeLayerWorkflowTask,
} from '@/lib/workflow-layer-task';

const workflowRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('workflow layered task execution', () => {
  it('polls the layered status endpoint and preserves editable layer output', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      {
        success: true,
        taskId: 'layer-task-1',
        status: 'processing',
        phase: 'waiting-for-pear',
        progress: 35,
      },
      {
        success: true,
        taskId: 'layer-task-1',
        status: 'completed',
        phase: 'ready',
        progress: 100,
        result: {
          width: 1200,
          height: 800,
          layers: [{ id: 'subject', imageUrl: '/api/serve-upload/subject.png' }],
          psdUrl: '/api/serve-upload/result.psd',
          quality: { status: 'pass', score: 96, warnings: [] },
          engine: 'pear',
        },
      },
    ];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(responses.shift()), {
        status: calls.length === 1 ? 202 : 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const progress: Array<{ phase?: string; progress: number }> = [];

    const result = await executeLayerWorkflowTask({
      submitUrl: 'http://localhost:5000/api/layered-decompose',
      body: {
        imageUrl: '/source.png',
        engine: 'smart',
        providerId: 'pear-provider',
        modelId: 'Image-Layered',
      },
      fetchOptions: { headers: { authorization: 'Bearer internal' } },
      nodeId: 'segment-1',
      idempotencyKey: 'workflow-layer-12345678',
      fetcher,
      wait: async () => {},
      onProgress: (task) => {
        progress.push({ phase: task.phase, progress: task.progress });
      },
    });

    expect(result.status).toBe('success');
    expect(result.output).toMatchObject({
      imageUrl: '/source.png',
      psdUrl: '/api/serve-upload/result.psd',
      engine: 'pear',
      quality: { status: 'pass', score: 96, warnings: [] },
      layers: [{ id: 'subject', imageUrl: '/api/serve-upload/subject.png' }],
    });
    expect(calls[0]).toMatchObject({
      url: 'http://localhost:5000/api/layered-decompose',
      init: {
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'workflow-layer-12345678' }),
      },
    });
    expect(calls[1]).toMatchObject({
      url: 'http://localhost:5000/api/layered-decompose?taskId=layer-task-1',
      init: { method: 'GET' },
    });
    expect(calls.some((call) => call.url.includes('/api/poll-task'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/api/save-image'))).toBe(false);
    expect(progress).toEqual([
      { phase: 'waiting-for-pear', progress: 35 },
      { phase: 'ready', progress: 100 },
    ]);
  });

  it('uses stable idempotency for one attempt and a new key for an intentional retry', () => {
    const first = buildWorkflowLayerIdempotencyKey('exec-1', 'segment-1', 0);

    expect(buildWorkflowLayerIdempotencyKey('exec-1', 'segment-1', 0)).toBe(first);
    expect(buildWorkflowLayerIdempotencyKey('exec-1', 'segment-1', 1)).not.toBe(first);
    expect(first).toMatch(/^workflow-layer-[a-f0-9]{64}$/);
  });

  it('cancels the persisted layer task through its DELETE endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      taskId: 'layer-task-1',
      status: 'cancelled',
      progress: 100,
    }), { headers: { 'content-type': 'application/json' } }));

    await cancelLayerWorkflowTask(
      'http://localhost:5000/api/layered-decompose',
      'layer-task-1',
      { headers: { authorization: 'Bearer internal' } },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:5000/api/layered-decompose?taskId=layer-task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('cancels and fails instead of polling forever after the workflow deadline', async () => {
    let now = 0;
    const calls: Array<{ url: string; method?: string }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({
          success: true,
          taskId: 'layer-timeout',
          status: 'cancelled',
          progress: 100,
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        success: true,
        taskId: 'layer-timeout',
        status: init?.method === 'GET' ? 'completed' : 'processing',
        phase: init?.method === 'GET' ? 'ready' : 'waiting-for-pear',
        progress: init?.method === 'GET' ? 100 : 35,
        ...(init?.method === 'GET' ? {
          result: {
            width: 10,
            height: 10,
            layers: [],
            engine: 'pear',
            quality: { status: 'pass', score: 100, warnings: [] },
          },
        } : {}),
      }), { status: init?.method === 'POST' ? 202 : 200, headers: { 'content-type': 'application/json' } });
    });
    const options = {
      submitUrl: 'http://localhost:5000/api/layered-decompose',
      body: { imageUrl: '/source.png', engine: 'smart' },
      fetchOptions: { headers: { authorization: 'Bearer internal' } },
      nodeId: 'segment-timeout',
      idempotencyKey: 'workflow-layer-timeout-1234',
      fetcher,
      wait: async () => {},
      now: () => {
        now += 600;
        return now;
      },
      maxWaitMs: 500,
    };

    const result = await executeLayerWorkflowTask(options);

    expect(result).toMatchObject({
      status: 'failed',
      error: 'LAYER_WORKFLOW_TIMEOUT: 图片分层任务等待超时',
    });
    expect(calls).toContainEqual({
      url: 'http://localhost:5000/api/layered-decompose?taskId=layer-timeout',
      method: 'DELETE',
    });
  });

  it('preserves a cancelled workflow instead of overwriting its terminal state', () => {
    expect(workflowRouteSource).toMatch(
      /if \(execState\.status === 'cancelled' \|\| execState\.cancellationState\?\.cancelled\) \{\n\s+execState\.status = 'cancelled';\n\s+await persistWorkflowExecution\(executionId, execState\);\n\s+return;/,
    );
  });
});

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '@/lib/workflow-engine';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn(async () => ({ userId: 'scope-user', userRole: 'user', user: { productType: 'all' } })),
  getInternalRequestHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask: mocks.create, updateCloudTask: mocks.update, getCloudTaskForUser: vi.fn(),
}));
vi.mock('@/lib/op-log', () => ({ logError: vi.fn(), OP_ACTIONS: { WORKFLOW_EXECUTE: 'workflow' } }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: vi.fn(async () => null), findProviderForFeature: vi.fn(async () => null), findProviderById: vi.fn(async () => null),
}));

import { POST } from '@/app/api/workflow/execute/route';

async function post(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/workflow/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('workflow execution route scoped dispatch', () => {
  it('runs the loop body twice before completing a cascade started at out-done', async () => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 2;
    loop.loopCount = 2;
    const body = createWorkflowNode('ai-upscale', 0, 0);
    body.config.imageUrl = '/test-input.png';
    const done = createWorkflowNode('input-text', 0, 0);
    const upstream = vi.fn(async () => new Response(JSON.stringify({ imageUrl: '/test-result.png' })));
    vi.stubGlobal('fetch', upstream);
    const response = await post({
      action: 'start', nodes: [loop, body, done], startNodeId: done.id, tailNodeId: done.id,
      connections: [
        { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
        { id: 'done', fromNodeId: loop.id, toNodeId: done.id, fromPortId: 'out-done', toPortId: 'in-prompt', type: 'prompt' },
      ],
    });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('completed');
      expect(status.results[body.id]).toMatchObject({ status: 'success', output: { _loopIteration: 2 } });
    });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('executes only the requested isolated chain and persists only its results', async () => {
    const selected = createWorkflowNode('input-text', 0, 0);
    const unrelated = createWorkflowNode('input-text', 500, 0);
    selected.config.text = 'selected';
    unrelated.config.text = 'unrelated';
    const response = await post({ action: 'start', nodes: [selected, unrelated], connections: [], startNodeId: selected.id, tailNodeId: selected.id });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('completed');
      expect(Object.keys(status.results)).toEqual([selected.id]);
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalled();
  });

  it('rejects a missing scoped start before creating a durable task', async () => {
    const response = await post({ action: 'start', nodes: [createWorkflowNode('input-text', 0, 0)], connections: [], startNodeId: 'deleted' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: '运行起点不存在，请重新选择节点' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

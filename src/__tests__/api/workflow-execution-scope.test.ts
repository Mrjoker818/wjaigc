import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '@/lib/workflow-engine';
import { findProviderById } from '@/lib/server-api-config';
import { getInternalRequestHeaders } from '@/lib/api-auth';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), get: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn(async () => ({ userId: 'scope-user', userRole: 'user', user: { productType: 'all' } })),
  getInternalRequestHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/cloud-task-storage', () => ({
  createCloudTask: mocks.create, updateCloudTask: mocks.update, getCloudTaskForUser: mocks.get,
  claimCloudTaskLease: vi.fn(async () => null),
  renewCloudTaskLease: vi.fn(async () => false),
  releaseCloudTaskLease: vi.fn(async () => false),
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findProviderById).mockResolvedValue(null);
  mocks.update.mockResolvedValue(true);
  mocks.get.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('workflow execution route scoped dispatch', () => {
  it('polls an accepted graphless edit child with the current actor identity', async () => {
    const executionId = `auth-status-${crypto.randomUUID()}`;
    const nodeId = 'edit-node';
    const childId = `auth-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${nodeId}`;
    const parent = { id: executionId, type: 'workflow', projectId: 'project-1',
      status: 'processing', revision: 1, createdAt: 1, updatedAt: 1,
      result: { workflowStatus: 'running', currentNodeId: nodeId,
        activeChildTasks: { [sourceEntityId]: childId } } };
    const child = { id: childId, type: 'edit', projectId: 'project-1', status: 'processing',
      messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}`,
      model: 'gpt-image-1', providerId: 'provider-a' };
    mocks.get.mockImplementation(async (taskId: string) => taskId === executionId ? parent : child);
    vi.mocked(getInternalRequestHeaders).mockImplementationOnce(async userId => ({ 'x-test-actor': userId }));
    const requests: Array<{ url: string; actor: string | null; taskId: string }> = [];
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), actor: new Headers(init?.headers).get('x-test-actor'),
        taskId: (JSON.parse(String(init?.body)) as { taskId: string }).taskId });
      return Response.json({ status: 'processing' });
    });
    vi.stubGlobal('fetch', provider);

    expect((await post({ action: 'status', executionId })).status).toBe(200);
    expect(requests).toEqual([{ url: 'http://127.0.0.1:5000/api/poll-task',
      actor: 'scope-user', taskId: childId }]);
  });

  it('cancels an accepted edit child with the current actor identity before its parent', async () => {
    const executionId = `auth-cancel-${crypto.randomUUID()}`;
    const childId = `auth-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:edit-node`;
    const parent = { id: executionId, type: 'workflow', projectId: 'project-1',
      status: 'processing', revision: 1, result: { workflowStatus: 'running',
        activeChildTasks: { [sourceEntityId]: childId } } };
    const child = { id: childId, type: 'edit', projectId: 'project-1', status: 'processing',
      messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}` };
    mocks.get.mockImplementation(async (taskId: string) => taskId === executionId ? parent : child);
    vi.mocked(getInternalRequestHeaders).mockImplementationOnce(async userId => ({ 'x-test-actor': userId }));
    const requests: Array<{ url: string; actor: string | null; taskId: string }> = [];
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), actor: new Headers(init?.headers).get('x-test-actor'),
        taskId: (JSON.parse(String(init?.body)) as { taskId: string }).taskId });
      return Response.json({ success: true });
    });
    vi.stubGlobal('fetch', provider);

    expect((await post({ action: 'cancel', executionId })).status).toBe(200);
    expect(requests).toEqual([{ url: 'http://127.0.0.1:5000/api/cancel-task',
      actor: 'scope-user', taskId: childId }]);
    expect(mocks.update).toHaveBeenCalledWith(executionId, expect.objectContaining({ status: 'cancelled' }));
  });

  it.each(['ai-edit', 'ai-color-adjust'] as const)('does not dispatch a %s node without a declared project scope', async type => {
    const node = createWorkflowNode(type, 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    const provider = vi.fn(async () => Response.json({ success: true, imageUrl: '/api/serve-upload/result.png' }));
    vi.stubGlobal('fetch', provider);

    const response = await post({ action: 'start', nodes: [node], connections: [] });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[node.id]).toMatchObject({
        status: 'failed',
        error: 'WORKFLOW_EDIT_PROJECT_REQUIRED',
      });
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['erase', 'mask', 'extend'] as const)('does not dispatch an explicit %s edit without a declared project scope', async action => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config = { ...node.config, action, imageUrl: '/api/serve-upload/source.png',
      maskUrl: '/api/serve-upload/mask.png' };
    const provider = vi.fn(async () => Response.json({ success: true, imageUrl: '/api/serve-upload/result.png' }));
    vi.stubGlobal('fetch', provider);

    const response = await post({ action: 'start', nodes: [node], connections: [] });
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[node.id]).toMatchObject({ status: 'failed', error: 'WORKFLOW_EDIT_PROJECT_REQUIRED' });
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('keeps the project-scope guard when retrying a failed explicit edit node', async () => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config = { ...node.config, action: 'extend', imageUrl: '/api/serve-upload/source.png' };
    const provider = vi.fn(async () => Response.json({ success: true, imageUrl: '/api/serve-upload/result.png' }));
    vi.stubGlobal('fetch', provider);
    const started = await post({ action: 'start', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
    });

    const retried = await post({ action: 'retry', executionId, nodeId: node.id, nodes: [node], connections: [] });
    expect(await retried.json()).toMatchObject({ success: false, error: 'WORKFLOW_EDIT_PROJECT_REQUIRED' });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['ai-edit', 'ai-color-adjust'] as const)('preserves the configured provider-model pair for a %s submit', async type => {
    vi.mocked(findProviderById).mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider.example.test', apiKey: 'test-key',
      selectedModels: ['gpt-image-1-4k'],
    } as Awaited<ReturnType<typeof findProviderById>>);
    const node = createWorkflowNode(type, 0, 0);
    node.config = {
      ...node.config,
      imageUrl: '/api/serve-upload/source.png',
      prompt: 'Make the sky blue',
      model: 'provider-a::gpt-image-1-4k',
    };
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain('/api/edit');
      expect(init?.method).toBe('POST');
      return Response.json({ success: false, error: 'fixture-stop' });
    });
    vi.stubGlobal('fetch', provider);
    const started = await post({ action: 'start', projectId: 'project-1', workflowId: 'workflow-a', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(provider.mock.calls[0][1]?.body))).toMatchObject({
      model: 'gpt-image-1-4k', providerId: 'provider-a', projectId: 'project-1',
      assetWorkspace: 'workflow', workflowId: 'workflow-a', nodeId: node.id,
    });
  });

  it('rejects a retry that replaces the frozen provider-model pair', async () => {
    const configuredProviders = {
      'provider-a': { id: 'provider-a', name: 'Provider A', isEnabled: true,
        baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
        type: 'image' as const, createdAt: 1, updatedAt: 1 },
      'provider-b': { id: 'provider-b', name: 'Provider B', isEnabled: true,
        baseUrl: 'https://provider-b.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
        type: 'image' as const, createdAt: 1, updatedAt: 1 },
    };
    vi.mocked(findProviderById).mockImplementation(async id => configuredProviders[id as keyof typeof configuredProviders] || null);
    const original = createWorkflowNode('ai-generate', 0, 0);
    original.config.model = 'provider-a::image-v1';
    original.config.prompt = 'A studio photograph of a speaker';
    const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
    vi.stubGlobal('fetch', send);
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [original], connections: [] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
    });
    expect(send).toHaveBeenCalledTimes(1);

    const changed = { ...original, config: { ...original.config, model: 'provider-b::image-v1' } };
    const retried = await post({ action: 'retry', executionId, nodeId: original.id,
      projectId: 'project-1', nodes: [changed], connections: [] });
    expect(retried.status).toBe(409);
    expect(await retried.json()).toMatchObject({ code: 'WORKFLOW_MODEL_BINDING_CHANGED' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['prompt', 'type', 'connections'] as const)(
    'rejects a retry that changes the frozen %s without a second submit', async changedField => {
      vi.mocked(findProviderById).mockResolvedValue({
        id: 'provider-a', name: 'Provider A', isEnabled: true,
        baseUrl: 'https://provider-a.example.test', apiKey: 'test-key',
        selectedModels: ['image-v1'], type: 'image', createdAt: 1, updatedAt: 1,
      });
      const original = createWorkflowNode('ai-generate', 0, 0);
      original.config.model = 'provider-a::image-v1';
      original.config.prompt = 'A studio photograph of a speaker';
      const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
      vi.stubGlobal('fetch', send);
      const started = await post({ action: 'start', projectId: 'project-1', nodes: [original], connections: [] });
      expect(started.status).toBe(200);
      const { executionId } = await started.json();
      await vi.waitFor(async () => {
        const status = await (await post({ action: 'status', executionId })).json();
        expect(status.status).toBe('failed');
      });
      expect(send).toHaveBeenCalledTimes(1);

      const changed = { ...original, config: { ...original.config } };
      if (changedField === 'prompt') changed.config.prompt = 'A different product photograph';
      if (changedField === 'type') changed.type = 'ai-video-generate';
      const connections = changedField === 'connections'
        ? [{ id: 'forged-link', fromNodeId: original.id, fromPortId: 'out-image',
          toNodeId: original.id, toPortId: 'in-image', type: 'image' }]
        : [];
      const retried = await post({ action: 'retry', executionId, nodeId: original.id,
        projectId: 'project-1', nodes: [changed], connections });
      expect(retried.status).toBe(409);
      expect(await retried.json()).toMatchObject({ code: 'WORKFLOW_RETRY_GRAPH_CHANGED' });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('retries an unchanged frozen image node using the original provider and prompt', async () => {
    vi.mocked(findProviderById).mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key',
      selectedModels: ['image-v1'], type: 'image', createdAt: 1, updatedAt: 1,
    });
    const node = createWorkflowNode('ai-generate', 0, 0);
    node.config.model = 'provider-a::image-v1';
    node.config.prompt = 'A studio photograph of a speaker';
    const submissions: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ success: false, error: 'test stop' });
    }));
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(() => expect(submissions).toHaveLength(1));
    const retried = await post({ action: 'retry', executionId, nodeId: node.id,
      projectId: 'project-1', nodes: [node], connections: [] });
    expect(retried.status).toBe(200);
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toMatchObject({
      prompt: 'A studio photograph of a speaker', model: 'image-v1', providerId: 'provider-a',
    });
  });

  it('marks an asynchronous image node failed when its submit API returns HTTP 200 with success false', async () => {
    const node = createWorkflowNode('ai-removebg', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      success: false,
      error: 'provider rejected this image',
    })));

    const response = await post({ action: 'start', nodes: [node], connections: [] });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[node.id]).toMatchObject({
        status: 'failed',
        error: 'provider rejected this image',
      });
      expect(status.results[node.id].output).toBeUndefined();
    });
  });

  it('marks a synchronous image analysis node failed when its API returns HTTP 200 with success false', async () => {
    const node = createWorkflowNode('ai-analyze', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));

    const response = await post({ action: 'start', nodes: [node], connections: [] });
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[node.id]).toMatchObject({ status: 'failed', error: '同步接口返回失败' });
    });
  });

  it('keeps a successful asynchronous image task on the submit and poll path', async () => {
    const node = createWorkflowNode('ai-removebg', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/image-edit')) return Response.json({ success: true, taskId: 'edit-child-1' });
      if (url.includes('/api/poll-task')) return Response.json({
        status: 'completed',
        result: { imageUrl: '/api/serve-upload/result.png' },
      });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const response = await post({ action: 'start', nodes: [node], connections: [] });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('completed');
      expect(status.results[node.id]).toMatchObject({
        status: 'success',
        output: { imageUrl: '/api/serve-upload/result.png' },
      });
    }, { timeout: 4000 });
  });

  it('persists an accepted edit child task before the first poll can finish', async () => {
    mocks.update.mockResolvedValue(true);
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    const submitted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) {
        submitted.push(url);
        return Response.json({ success: true, taskId: 'edit-child-durable-1' });
      }
      if (url.includes('/api/poll-task')) {
        await pollHeld;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    try {
      await vi.waitFor(() => {
        expect(submitted).toHaveLength(1);
        expect(mocks.update.mock.calls.some(([id, update]) => id === executionId
          && update.result?.activeChildTasks?.[`${executionId}:${node.id}`] === 'edit-child-durable-1')).toBe(true);
      }, { timeout: 4000 });
    } finally { releasePoll(); }
  });

  it('retains the accepted edit task identity in the completed node result', async () => {
    mocks.update.mockResolvedValue(true);
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskId: 'edit-child-result-1' });
      if (url.includes('/api/poll-task')) return Response.json({
        status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' },
      });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.results[node.id]).toMatchObject({
        status: 'success', output: { taskId: 'edit-child-result-1', imageUrl: '/api/serve-upload/result.png' },
      });
    }, { timeout: 4000 });
  });

  it('cancels an accepted edit child and does not publish its late completion as a completed parent', async () => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    const childCancels: string[] = [];
    let sourceEntityId = '';
    mocks.get.mockImplementation(async (taskId: string) => taskId === 'edit-child-to-cancel'
      ? { id: taskId, type: 'edit', status: 'processing', projectId: 'project-1', userId: 'scope-user',
        messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}` }
      : null);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskId: 'edit-child-to-cancel' });
      if (url.includes('/api/cancel-task')) {
        childCancels.push(JSON.parse(String(init?.body)).taskId);
        return Response.json({ success: true });
      }
      if (url.includes('/api/poll-task')) {
        await pollHeld;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/late.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    sourceEntityId = `${executionId}:${node.id}`;
    await vi.waitFor(() => expect(mocks.update.mock.calls.some(([id, update]) => id === executionId
      && update.result?.activeChildTasks?.[`${executionId}:${node.id}`] === 'edit-child-to-cancel')).toBe(true));
    try {
      const cancelled = await post({ action: 'cancel', executionId });
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toMatchObject({ status: 'cancelled' });
      expect(childCancels).toEqual(['edit-child-to-cancel']);
    } finally { releasePoll(); }
    await new Promise(resolve => setTimeout(resolve, 1700));
    const status = await (await post({ action: 'status', executionId })).json();
    expect(status.status).toBe('cancelled');
    expect(status.results[node.id]?.status).not.toBe('success');
  });

  it('does not acknowledge parent cancellation when its durable terminal write loses a revision race', async () => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let sourceEntityId = '';
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    mocks.get.mockImplementation(async (taskId: string) => taskId === 'edit-child-parent-cas'
      ? { id: taskId, type: 'edit', status: 'processing', projectId: 'project-1',
        userId: 'scope-user', messageId: sourceEntityId,
        idempotencyKey: `workflow:${sourceEntityId}` }
      : null);
    mocks.update.mockImplementation(async (_taskId: string, update: { status?: string }) => update.status !== 'cancelled');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskId: 'edit-child-parent-cas' });
      if (url.includes('/api/cancel-task')) return Response.json({ success: true });
      if (url.includes('/api/poll-task')) {
        await pollHeld;
        return Response.json({ status: 'cancelled' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    sourceEntityId = `${executionId}:${node.id}`;
    await vi.waitFor(() => expect(mocks.update.mock.calls.some(([id, update]) => id === executionId
      && update.result?.activeChildTasks?.[sourceEntityId] === 'edit-child-parent-cas')).toBe(true));
    try {
      const response = await post({ action: 'cancel', executionId });
      expect(response.status).toBe(409);
      expect((await response.json()).status).not.toBe('cancelled');
    } finally { releasePoll(); }
  });

  it.each(['rejected response', 'network error'] as const)(
    'pauses the parent when child cancellation has a %s and ignores a late child result', async failure => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let sourceEntityId = '';
    mocks.get.mockImplementation(async (taskId: string) => taskId === 'edit-child-cancel-failed'
      ? { id: taskId, type: 'edit', status: 'processing', projectId: 'project-1', userId: 'scope-user',
        messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}` }
      : null);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskId: 'edit-child-cancel-failed' });
      if (url.includes('/api/cancel-task')) {
        if (failure === 'network error') throw new Error('cancel endpoint unreachable');
        return Response.json({ success: false }, { status: 503 });
      }
      if (url.includes('/api/poll-task')) return Response.json({
        status: 'completed', result: { imageUrl: '/api/serve-upload/late.png' },
      });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    sourceEntityId = `${executionId}:${node.id}`;
    await vi.waitFor(() => expect(mocks.update.mock.calls.some(([id, update]) => id === executionId
      && update.result?.activeChildTasks?.[`${executionId}:${node.id}`] === 'edit-child-cancel-failed')).toBe(true));
    const cancelled = await post({ action: 'cancel', executionId });
    expect(cancelled.status).toBe(502);
    await new Promise(resolve => setTimeout(resolve, 1700));
    const status = await (await post({ action: 'status', executionId })).json();
    expect(status.status).toBe('paused');
    expect(status.results[node.id]?.status).not.toBe('success');
  });

  it('retains persisted edit child ids after a cache-miss restore before cancelling', async () => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    const executionId = `restored-parent-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${node.id}`;
    const childId = 'edit-child-restored';
    const cancelledIds: string[] = [];
    mocks.get.mockImplementation(async (taskId: string) => {
      if (taskId === childId) return { id: childId, type: 'edit', status: 'processing',
        projectId: 'project-1', userId: 'scope-user', messageId: sourceEntityId,
        idempotencyKey: `workflow:${sourceEntityId}` };
      if (taskId === executionId) return { id: executionId, type: 'workflow', status: 'processing', revision: 1,
        projectId: 'project-1', userId: 'scope-user', createdAt: Date.now(), result: {
          workflowStatus: 'running', projectId: 'project-1', totalNodes: 1, currentNodeId: node.id,
          startedAt: Date.now(), results: {}, executionGraph: { nodes: [node], connections: [] },
          activeChildTasks: { [sourceEntityId]: childId },
        } };
      return null;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes('/api/cancel-task')) throw new Error(`unexpected fetch: ${input}`);
      cancelledIds.push(JSON.parse(String(init?.body)).taskId);
      return Response.json({ success: true });
    }));
    expect((await (await post({ action: 'status', executionId })).json()).status).toBe('running');
    const cancelled = await post({ action: 'cancel', executionId });
    expect(cancelled.status).toBe(200);
    expect(cancelledIds).toEqual([childId]);
  });

  it('does not cancel another edit task in the same project when its workflow identity differs', async () => {
    const executionId = `parent-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:edit-node`;
    const childId = 'unrelated-edit-task';
    mocks.get.mockImplementation(async (taskId: string) => {
      if (taskId === childId) return { id: childId, type: 'edit', status: 'processing',
        projectId: 'project-1', userId: 'scope-user', messageId: 'other-workflow:edit-node',
        idempotencyKey: 'workflow:other-workflow:edit-node' };
      if (taskId === executionId) return { id: executionId, type: 'workflow', status: 'processing', revision: 1,
        projectId: 'project-1', userId: 'scope-user', result: {
          workflowStatus: 'running', results: {}, activeChildTasks: { [sourceEntityId]: childId },
        } };
      return null;
    });
    const cancelledIds: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      cancelledIds.push(JSON.parse(String(init?.body)).taskId);
      return Response.json({ success: true });
    }));
    const response = await post({ action: 'cancel', executionId });
    expect(response.status).toBe(502);
    expect(cancelledIds).toEqual([]);
    expect(mocks.update.mock.calls.at(-1)?.[1]?.result?.workflowStatus).toBe('paused');
  });

  it('does not overwrite a newer parent checkpoint while pausing an unverified child after cache miss', async () => {
    const executionId = `parent-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:edit-node`;
    let durableRevision = 1;
    mocks.get.mockImplementation(async (taskId: string) => {
      if (taskId === executionId) return { id: executionId, type: 'workflow', status: 'processing',
        projectId: 'project-1', userId: 'scope-user', revision: 1, result: {
          workflowStatus: 'running', results: {}, activeChildTasks: { [sourceEntityId]: 'unverified-child' },
        } };
      if (taskId === 'unverified-child') {
        durableRevision = 2; // A second instance committed a newer parent checkpoint.
        return { id: taskId, type: 'edit', status: 'processing', projectId: 'project-1',
          userId: 'scope-user', messageId: 'other-workflow:edit-node' };
      }
      return null;
    });
    mocks.update.mockImplementation(async (_taskId: string, update: { expectedRevision?: number }) => (
      update.expectedRevision === undefined || update.expectedRevision === durableRevision
    ));
    const response = await post({ action: 'cancel', executionId });
    expect(response.status).toBe(409);
    expect((await response.json()).status).toBe('unconfirmed');
    expect(mocks.update.mock.calls.at(-1)?.[1]?.expectedRevision).toBe(1);
  });

  it('does not acknowledge cancellation after a cache miss if the parent terminal write loses its revision', async () => {
    const executionId = `parent-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:edit-node`;
    let durableRevision = 1;
    mocks.get.mockImplementation(async (taskId: string) => {
      if (taskId === executionId) return { id: executionId, type: 'workflow', status: 'processing',
        projectId: 'project-1', userId: 'scope-user', revision: 1, result: {
          workflowStatus: 'running', results: {}, activeChildTasks: { [sourceEntityId]: 'accepted-child' },
        } };
      if (taskId === 'accepted-child') return { id: taskId, type: 'edit', status: 'processing',
        projectId: 'project-1', userId: 'scope-user', messageId: sourceEntityId,
        idempotencyKey: `workflow:${sourceEntityId}` };
      return null;
    });
    mocks.update.mockImplementation(async (_taskId: string, update: { expectedRevision?: number }) => (
      update.expectedRevision === undefined || update.expectedRevision === durableRevision
    ));
    vi.stubGlobal('fetch', vi.fn(async () => {
      durableRevision = 2; // A concurrent parent checkpoint commits while child cancellation is in flight.
      return Response.json({ success: true });
    }));
    const response = await post({ action: 'cancel', executionId });
    expect(response.status).toBe(409);
    expect((await response.json()).status).toBe('unconfirmed');
    expect(mocks.update.mock.calls.at(-1)?.[1]?.expectedRevision).toBe(1);
  });

  it.each(['completed', 'failed', 'timeout'] as const)(
    'does not report parent cancellation when its edit child is already %s', async childStatus => {
    const executionId = `parent-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:edit-node`;
    const childId = `edit-child-${childStatus}`;
    mocks.get.mockImplementation(async (taskId: string) => {
      if (taskId === childId) return { id: childId, type: 'edit', status: childStatus,
        projectId: 'project-1', userId: 'scope-user', messageId: sourceEntityId,
        idempotencyKey: `workflow:${sourceEntityId}` };
      if (taskId === executionId) return { id: executionId, type: 'workflow', status: 'processing', revision: 1,
        projectId: 'project-1', userId: 'scope-user', result: {
          workflowStatus: 'running', results: {}, activeChildTasks: { [sourceEntityId]: childId },
        } };
      return null;
    });
    const cancelFetch = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', cancelFetch);
    const response = await post({ action: 'cancel', executionId });
    expect(response.status).toBe(502);
    expect((await response.json()).status).toBe('paused');
    expect(cancelFetch).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls.at(-1)?.[1]?.result?.workflowStatus).toBe('paused');
  });

  it('does not poll multiple edit child ids without a durable checkpoint for each one', async () => {
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let pollCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskIds: ['edit-child-a', 'edit-child-b'] });
      if (url.includes('/api/poll-task')) {
        pollCount++;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.results[node.id]).toMatchObject({
        status: 'failed', error: 'WORKFLOW_CHILD_TASK_IDS_UNSUPPORTED',
      });
    }, { timeout: 4000 });
    expect(pollCount).toBe(0);
  });

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

  it.each(['ai-edit', 'ai-color-adjust'] as const)('does not bypass project scope for a %s node inside a loop', async type => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 2;
    loop.loopCount = 2;
    const body = createWorkflowNode(type, 0, 0);
    body.config.imageUrl = '/api/serve-upload/source.png';
    body.config.prompt = 'Make the sky blue';
    const provider = vi.fn(async () => Response.json({ success: true, imageUrl: '/api/serve-upload/result.png' }));
    vi.stubGlobal('fetch', provider);

    const response = await post({
      action: 'start', nodes: [loop, body], connections: [
        { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
      ],
    });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[body.id]).toMatchObject({
        status: 'failed',
        error: 'WORKFLOW_EDIT_PROJECT_REQUIRED',
      });
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['erase', 'mask', 'extend'] as const)('does not bypass project scope for an explicit %s edit inside a loop', async action => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const body = createWorkflowNode('ai-edit', 0, 0);
    body.config = { ...body.config, action, imageUrl: '/api/serve-upload/source.png',
      maskUrl: '/api/serve-upload/mask.png' };
    const provider = vi.fn(async () => Response.json({ success: true, imageUrl: '/api/serve-upload/result.png' }));
    vi.stubGlobal('fetch', provider);

    const response = await post({
      action: 'start', nodes: [loop, body], connections: [
        { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
      ],
    });
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[body.id]).toMatchObject({ status: 'failed', error: 'WORKFLOW_EDIT_PROJECT_REQUIRED' });
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('submits and polls a project-scoped language edit inside a loop with a stable child identity', async () => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const body = createWorkflowNode('ai-edit', 0, 0);
    body.config.imageUrl = '/api/serve-upload/source.png';
    body.config.prompt = 'Make the sky blue';
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/edit')) {
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          image: '/api/serve-upload/source.png',
          projectId: 'project-1',
          sessionId: 'workflow:project-1',
        });
        expect(payload.messageId).toContain(`${body.id}:loop:1`);
        return Response.json({ success: true, taskId: 'loop-edit-child-1' });
      }
      if (url.includes('/api/poll-task')) return Response.json({
        status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' },
      });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', provider);

    const response = await post({
      action: 'start', projectId: 'project-1', nodes: [loop, body], connections: [
        { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
      ],
    });
    expect(response.status).toBe(200);
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('completed');
      expect(status.results[body.id]).toMatchObject({
        status: 'success',
        output: { imageUrl: '/api/serve-upload/result.png', _loopIteration: 1 },
      });
    }, { timeout: 4000 });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('keeps separate durable child identities for two iterations of the same edit node', async () => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 2;
    loop.loopCount = 2;
    const body = createWorkflowNode('ai-edit', 0, 0);
    body.config.imageUrl = '/api/serve-upload/source.png';
    body.config.prompt = 'Make the sky blue';
    let submitted = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskId: `loop-child-${++submitted}` });
      if (url.includes('/api/poll-task')) return Response.json({
        status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' },
      });
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, body], connections: [
      { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
    ] });
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('completed');
    }, { timeout: 6000 });
    const checkpoint = mocks.update.mock.calls.at(-1)?.[1]?.result;
    expect(checkpoint.activeChildTasks).toEqual({
      [`${executionId}:${body.id}:loop:1`]: 'loop-child-1',
      [`${executionId}:${body.id}:loop:2`]: 'loop-child-2',
    });
  });

  it('submits and polls an explicit project-scoped extend edit inside a loop', async () => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const body = createWorkflowNode('ai-edit', 0, 0);
    body.config = { ...body.config, action: 'extend', imageUrl: '/api/serve-upload/source.png' };
    const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/image-edit')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ action: 'extend', projectId: 'project-1' });
        return Response.json({ success: true, taskId: 'loop-extend-child-1' });
      }
      if (url.includes('/api/poll-task')) return Response.json({
        status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' },
      });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', provider);
    const response = await post({
      action: 'start', projectId: 'project-1', nodes: [loop, body], connections: [
        { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
      ],
    });
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('completed');
      expect(status.results[body.id]).toMatchObject({
        status: 'success', output: { imageUrl: '/api/serve-upload/result.png', _loopIteration: 1 },
      });
    }, { timeout: 4000 });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('fails an explicit edit inside a loop when submit returns HTTP 200 with success false', async () => {
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const body = createWorkflowNode('ai-edit', 0, 0);
    body.config = { ...body.config, action: 'extend', imageUrl: '/api/serve-upload/source.png' };
    const provider = vi.fn(async () => Response.json({ success: false, error: 'extend rejected' }));
    vi.stubGlobal('fetch', provider);
    const response = await post({
      action: 'start', projectId: 'project-1', nodes: [loop, body], connections: [
        { id: 'body', fromNodeId: loop.id, toNodeId: body.id, fromPortId: 'out-loop', toPortId: 'in-image', type: 'image' },
      ],
    });
    const { executionId } = await response.json();
    await vi.waitFor(async () => {
      const status = await (await post({ action: 'status', executionId })).json();
      expect(status.status).toBe('failed');
      expect(status.results[body.id]).toMatchObject({ status: 'failed', error: 'extend rejected' });
    });
    expect(provider).toHaveBeenCalledTimes(1);
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

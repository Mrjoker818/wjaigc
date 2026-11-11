import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloudTask, CreateCloudTaskInput, UpdateCloudTaskInput } from '@/lib/cloud-task-storage';
import type { AgentEvent } from '@/lib/agent-runtime/types';
import {
  continueWorkflowSkillRun,
  executeWorkflowSkillRun,
  shouldDeferWorkflowDownstream,
} from '@/lib/workflow-skill-execution';
import { createBriefToVideoSkill } from '@/lib/skill-runtime/brief-to-video-preset';
import {
  buildWorkflowSkillRunRequest,
  configureWorkflowSkillNodePorts,
  createConnection,
  createWorkflowNode,
  getNodeInputs,
  type ExecutionResult,
  type WorkflowConnection,
  type WorkflowNode,
} from '@/lib/workflow-engine';

const routeMocks = vi.hoisted(() => ({
  claimCloudTaskLease: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ taskId: 'lease-task', owner: 'lease-owner', expiresAt: Date.now() + 120_000, attemptCount: 1 })),
  createCloudTask: vi.fn(async (_task: CreateCloudTaskInput): Promise<void> => undefined),
  getCloudTaskForUser: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  releaseCloudTaskLease: vi.fn(async (_id: string, _owner: string) => true),
  renewCloudTaskLease: vi.fn(async () => true),
  updateCloudTask: vi.fn(async (_id: string, _update: UpdateCloudTaskInput) => true),
}));
const authMocks = vi.hoisted(() => ({
  getInternalRequestHeaders: vi.fn(async () => ({})),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: vi.fn(async () => ({
    userId: 'workflow-user', userRole: 'user', user: { productType: 'all' },
  })),
  getInternalRequestHeaders: authMocks.getInternalRequestHeaders,
}));
vi.mock('@/lib/cloud-task-storage', () => routeMocks);
vi.mock('@/lib/op-log', () => ({
  logError: vi.fn(), OP_ACTIONS: { WORKFLOW_EXECUTE: 'workflow' },
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: vi.fn(async () => null),
  findProviderForFeature: vi.fn(async () => null),
  findProviderById: vi.fn(async () => null),
}));
const assetRead = vi.hoisted(() => vi.fn());
const approvalQuery = vi.hoisted(() => vi.fn());
const approvalEvents = vi.hoisted(() => vi.fn<() => Promise<AgentEvent[]>>());
const imageReceiver = vi.hoisted(() => vi.fn());
vi.mock('@/lib/asset-core/storage', () => ({
  createPostgresAssetStorage: vi.fn(() => ({ read: assetRead })),
  withAssetCoreTransaction: async (work: (client: { query: typeof approvalQuery }) => Promise<unknown>) =>
    work({ query: approvalQuery }),
}));
vi.mock('@/lib/agent-runtime/event-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/agent-runtime/event-storage')>(),
  listAgentEventsForActor: approvalEvents,
}));
vi.mock('@/lib/workflow-image-input-execution', () => ({ executeWorkflowImageInputForActor: imageReceiver }));
vi.mock('@/lib/workflow-image-runtime-publication', () => ({
  workflowImageRuntimeOperationId: (input: { parentExecutionId: string; nodeId: string }) =>
    [input.parentExecutionId, input.nodeId].join(':'),
}));
const cancelPrepaidChildren = vi.hoisted(() => vi.fn());
const abortChild = vi.hoisted(() => vi.fn());
vi.mock('@/lib/skill-runtime/prepaid-generation', () => ({ cancelSkillPrepaidChildren: cancelPrepaidChildren }));
vi.mock('@/lib/task-core/task-abort', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/task-core/task-abort')>(), abortTaskExecution: abortChild,
}));
vi.mock('@/lib/skill-runtime/storage', () => ({
  loadUserSkillCatalog: vi.fn(async () => [createBriefToVideoSkill(true)]),
}));
vi.mock('@/lib/task-core/model-catalog', () => ({
  resolveTaskModel: vi.fn(async (providerId: string, modelId: string) => ({
    providerId, modelId, kind: modelId === 'video-model' ? 'video' : 'chat',
  })),
}));

import { POST } from '@/app/api/workflow/execute/route';

function postWorkflow(body: Record<string, unknown>): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/workflow/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  assetRead.mockReset();
  approvalQuery.mockReset();
  approvalEvents.mockReset().mockResolvedValue([]);
  imageReceiver.mockReset();
  cancelPrepaidChildren.mockReset().mockResolvedValue([]);
  routeMocks.claimCloudTaskLease.mockResolvedValue({
    taskId: 'lease-task', owner: 'lease-owner',
    expiresAt: Date.now() + 120_000, attemptCount: 1,
  });
  routeMocks.createCloudTask.mockResolvedValue(undefined);
  routeMocks.getCloudTaskForUser.mockResolvedValue(null);
  routeMocks.releaseCloudTaskLease.mockResolvedValue(true);
  routeMocks.renewCloudTaskLease.mockResolvedValue(true);
  routeMocks.updateCloudTask.mockResolvedValue(true);
  authMocks.getInternalRequestHeaders.mockResolvedValue({});
});

afterEach(() => vi.unstubAllGlobals());

const approval = {
  schemaId: 'skill-approval-state-v1',
  status: 'pending',
  stepId: 'plan-film',
  nextStepId: 'generate-film',
  outputSchemaId: 'brief-to-video-plan-v1',
  planChecksum: 'a'.repeat(64),
  revision: 0,
  generation: 0,
  allowRevision: true,
};

const result = {
  schemaId: 'brief-to-video-result-v1',
  runId: 'run-video-1',
  planChecksum: 'a'.repeat(64),
  videoAssetVersionId: 'video-v1',
  sourceAssetVersionIds: ['start-v1', 'end-v1'],
  providerId: 'pear-video',
  modelId: 'video-model',
  remoteTaskId: 'remote-video-1',
  durationSeconds: 10,
  aspectRatio: '16:9',
};

function briefVideoNode(): WorkflowNode {
  const skill = createBriefToVideoSkill(true);
  const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 300, 0), skill);
  node.config = {
    ...node.config, skillId: skill.id, version: skill.version,
    inputValues: { brief: 'Synthetic brief', audience: 'Synthetic audience', durationSeconds: '10', aspectRatio: '16:9' },
    modelBindings: {
      orchestrator: { providerId: 'fixture-chat', modelId: 'chat-model' },
      video: { providerId: 'fixture-video', modelId: 'video-model' },
    },
  };
  return node;
}

function persistWorkflowInMemory(options: {
  afterClaim?: (task: CloudTask) => CloudTask;
  rejectApprovalWrite?: (next: Record<string, unknown>) => boolean;
  afterApprovalWrite?: (next: Record<string, unknown>) => void;
} = {}): () => CloudTask | undefined {
  let task: CloudTask | undefined;
  routeMocks.createCloudTask.mockImplementation(async input => {
    task = { ...structuredClone(input), creditStatus: 'not-applicable', revision: 0 };
  });
  routeMocks.getCloudTaskForUser.mockImplementation(async (id, userId) => (
    task && task.id === id && task.userId === userId ? structuredClone(task) : null
  ));
  routeMocks.claimCloudTaskLease.mockImplementation(async (id, owner, ttl) => {
    if (!task || task.id !== id || (task.leaseExpiresAt ?? 0) > Date.now()
      || typeof owner !== 'string' || typeof ttl !== 'number') return null;
    task = { ...task, leaseOwner: owner, leaseExpiresAt: Date.now() + ttl, attemptCount: (task.attemptCount ?? 0) + 1 };
    task = options.afterClaim?.(task) ?? task;
    return { taskId: id, owner, expiresAt: task.leaseExpiresAt, attemptCount: task.attemptCount };
  });
  routeMocks.updateCloudTask.mockImplementation(async (id, { expectedRevision, leaseOwner, expectedLeaseAttemptCount, ...update }) => {
    if (!task || task.id !== id
      || (expectedRevision !== undefined && task.revision !== expectedRevision)
      || (leaseOwner !== undefined && task.leaseOwner !== leaseOwner)
      || (expectedLeaseAttemptCount !== undefined && task.attemptCount !== expectedLeaseAttemptCount)) return false;
    task = { ...task, ...structuredClone(update), revision: (task.revision ?? 0) + 1 };
    return true;
  });
  routeMocks.releaseCloudTaskLease.mockImplementation(async (id, owner) => {
    if (!task || task.id !== id || task.leaseOwner !== owner) return false;
    task = { ...task, leaseOwner: undefined, leaseExpiresAt: undefined };
    return true;
  });
  approvalQuery.mockImplementation(async (sql: string, params: [
    string, string, string | null, number, string, number, string, string, CloudTask['status'], number,
  ]) => {
    expect(sql).toContain('attempt_count = $6');
    expect(sql).toMatch(/lease_expires_at\s*>[^\n]*clock_timestamp/);
    expect(sql).toContain("result->>'workflowStatus' = 'paused'");
    const [id, actor, project, revision, owner, attempt, expected, next, status, progress] = params;
    const result = JSON.parse(next) as Record<string, unknown>;
    if (!task || task.id !== id || task.userId !== actor || (task.projectId ?? null) !== project
      || task.status !== 'processing' || task.revision !== revision || task.leaseOwner !== owner
      || task.attemptCount !== attempt || (task.leaseExpiresAt ?? 0) <= Date.now()
      || JSON.stringify(task.result) !== expected || options.rejectApprovalWrite?.(result)) {
      return { rowCount: 0, rows: [] };
    }
    task = { ...task, result, status, progress, revision: revision + 1 };
    options.afterApprovalWrite?.(result);
    return { rowCount: 1, rows: [{ revision: task.revision }] };
  });
  return () => task;
}

async function startWorkflow(nodes: WorkflowNode[], connections: WorkflowConnection[]): Promise<string> {
  const response = await postWorkflow({
    action: 'start', projectId: 'project-a', workflowId: 'workflow-a', nodes, connections,
  });
  const body = await response.json();
  expect(body).toMatchObject({ executionId: expect.any(String) });
  expect(response.status).toBe(200);
  return body.executionId as string;
}

async function pausedWorkflowApproval(executionId: string, options: Parameters<typeof persistWorkflowInMemory>[0] = {},
  output: 'video' | 'image' = 'video') {
  const stored = persistWorkflowInMemory(options);
  const node = briefVideoNode();
  const downstream = createWorkflowNode(output === 'image' ? 'input-image' : 'output-video', 600, 0);
  if (output === 'image') {
    downstream.ports.push({ id: 'in-image', label: '图片', type: 'image', direction: 'in' });
    downstream.config = { ...downstream.config, source: 'upstream', imageInputTransform: { version: 1, kind: 'identity' } };
  }
  const edge = output === 'image' ? createConnection(node.id, 'out-image', downstream.id, 'in-image', 'image')
    : createConnection(node.id, 'out-video', downstream.id, 'in-video', 'video');
  const runId = result.runId;
  await routeMocks.createCloudTask({
    id: executionId, userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
    status: 'processing', progress: 50, createdAt: 1, updatedAt: 2, attemptCount: 4,
    result: {
      workflowStatus: 'paused', projectId: 'project-a', workflowId: 'workflow-a', totalNodes: 2,
      currentNodeId: node.id, startedAt: 1, completedAt: null,
      activeSkillRuns: { [[executionId, node.id].join(':')]: runId },
      results: { [node.id]: {
        nodeId: node.id, status: 'waiting-approval', durationMs: 1,
        output: { runId, status: 'waiting-approval', approval },
      } },
      executionGraph: { nodes: [node, downstream], connections: [edge] },
    },
  });
  routeMocks.createCloudTask.mockClear();
  const approve = (action: 'approve' | 'revise' | 'cancel' = 'approve', revisionInstruction?: string): Promise<Response> => postWorkflow({
    action: 'approve-skill', controlAction: action, executionId, nodeId: node.id,
    projectId: 'project-a', workflowId: 'workflow-a', nodes: [node], connections: [],
    revision: approval.revision, generation: approval.generation, planChecksum: approval.planChecksum,
    revisionInstruction,
  });
  const status = (): Promise<Response> => postWorkflow({ action: 'status', executionId });
  return { approve, status, stored, node, downstream, runId, executionId };
}

function durableApprovalEvents(runId: string, action: 'approve' | 'cancel', generation = approval.generation): AgentEvent[] {
  const event = (sequence: number, type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent => ({
    eventId: runId + ':' + sequence, runId, sequence, type, timestamp: new Date(sequence).toISOString(), payload,
  });
  return [
    event(1, 'run.created', { workspace: 'workflow', workspaceId: 'workflow:workflow-a' }),
    event(2, 'run.paused', { pauseReason: 'approval', nextStepId: approval.nextStepId, approval }),
    action === 'cancel' ? event(3, 'run.cancelled', {}) : event(3, 'run.resumed', {
      nextStepId: approval.nextStepId, generation: 1,
      approval: { action, generation, revision: approval.revision, planChecksum: approval.planChecksum },
    }),
  ];
}

describe('Workflow Brief 到视频审批执行', () => {
  it('真实路由允许 approve-skill 到达审批恢复分支', async () => {
    routeMocks.getCloudTaskForUser.mockResolvedValueOnce(null);
    const response = await postWorkflow({
      action: 'approve-skill', executionId: 'exec-missing', nodeId: 'node-video',
      projectId: 'project-a', workflowId: 'workflow-a', nodes: [{}], connections: [],
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: '执行实例不存在、已过期或不在待审批状态',
    });
  });

  it('真实路由在 CloudTask 初始化失败时返回 503', async () => {
    routeMocks.createCloudTask.mockRejectedValueOnce(new Error('database unavailable'));
    const node = createWorkflowNode('input-text', 0, 0);
    const response = await postWorkflow({
      action: 'start', projectId: 'project-a', workflowId: 'workflow-a',
      nodes: [node], connections: [],
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: '工作流持久化初始化失败，未启动执行',
    });
  });

  it('让服务端执行暂停等待审批，并通过原执行实例继续下游', async () => {
    const stored = persistWorkflowInMemory();
    const node = briefVideoNode();
    const downstream = createWorkflowNode('output-video', 600, 0);
    const connections = [createConnection(node.id, 'out-video', downstream.id, 'in-video', 'video')];
    const runId = result.runId;
    const videoUrl = '/api/serve-upload/videos/final.mp4';
    assetRead.mockResolvedValue({
      assetId: 'video-asset-1', assetVersionId: result.videoAssetVersionId, kind: 'video', url: videoUrl,
    });
    const calls: string[] = [];
    let approved = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const request = (init?.method ?? 'GET') + ' ' + path;
      calls.push(request);
      if (request === 'POST /api/skill-runs') return Response.json({ runId }, { status: 201 });
      if (path === '/api/skill-runs/' + runId && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          action: 'approve', revision: approval.revision, generation: approval.generation, planChecksum: approval.planChecksum,
        });
        approved = true;
        return Response.json({ accepted: true });
      }
      if (request !== 'GET /api/skill-runs/' + runId) return new Response(null, { status: 404 });
      return Response.json({ run: approved ? {
        runId, status: 'completed', assetVersionIds: [result.videoAssetVersionId],
        outputs: [{ stepId: 'generate-film', kind: 'json', schemaId: result.schemaId, content: JSON.stringify(result) }],
      } : { runId, status: 'paused', assetVersionIds: [], approval, resumeFromStepId: 'generate-film', outputs: [] } });
    }));

    const executionId = await startWorkflow([node, downstream], connections);
    await vi.waitFor(() => expect(stored()?.result).toMatchObject({
      workflowStatus: 'paused', currentNodeId: node.id,
      results: { [node.id]: { status: 'waiting-approval', output: { runId } } },
    }));
    expect(stored()?.result?.results).not.toHaveProperty(downstream.id);
    const pausedRevision = stored()?.revision;

    const response = await postWorkflow({
      action: 'approve-skill', controlAction: 'approve', executionId, nodeId: node.id,
      projectId: 'project-a', workflowId: 'workflow-a', nodes: [node], connections: [],
      revision: approval.revision, generation: approval.generation, planChecksum: approval.planChecksum,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true, executionId, status: 'running' });
    expect(approvalQuery).toHaveBeenCalledTimes(2);
    const [prepared, finalized] = approvalQuery.mock.calls.map(([, params]) => params);
    expect(prepared.slice(0, 6)).toEqual([
      executionId, 'workflow-user', 'project-a', pausedRevision, expect.stringMatching(/^workflow-approval:/), 1,
    ]);
    expect(finalized.slice(0, 6)).toEqual([...prepared.slice(0, 3), pausedRevision! + 1, prepared[4], prepared[5]]);
    expect(JSON.parse(finalized[7])).toMatchObject({ workflowStatus: 'running', currentNodeId: node.id });
    await vi.waitFor(() => expect(routeMocks.releaseCloudTaskLease).toHaveBeenCalledWith(
      executionId, expect.stringMatching(/^workflow-approval:/),
    ));
    expect(stored()?.result).toMatchObject({
      workflowStatus: 'completed',
      results: {
        [node.id]: { status: 'success', output: { runId } },
        [downstream.id]: { status: 'success', output: { videoUrl } },
      },
    });
    expect(routeMocks.createCloudTask).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'POST /api/skill-runs', 'GET /api/skill-runs/' + runId,
      'PATCH /api/skill-runs/' + runId, 'GET /api/skill-runs/' + runId,
    ]);
  });

  describe('workflow approval handoff', () => {
    it.each(['changed-run', 'expired-lease', 'rejected-CAS'] as const)('rejects %s before any child PATCH', async reason => {
      const fixture = await pausedWorkflowApproval('exec-approval-' + reason, {
        afterClaim: task => {
          if (reason === 'expired-lease') return { ...task, leaseExpiresAt: Date.now() - 1 };
          if (reason === 'changed-run') {
            const saved = task.result!;
            const results = saved.results as Record<string, ExecutionResult>;
            const nodeId = String(saved.currentNodeId);
            return { ...task, revision: task.revision! + 1, result: { ...saved, results: {
              ...results, [nodeId]: { ...results[nodeId], output: { ...results[nodeId].output, runId: 'different-run' } },
            } } };
          }
          return task;
        },
        rejectApprovalWrite: () => reason === 'rejected-CAS',
      });
      const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetcher);
      expect((await fixture.approve()).status).toBe(409);
      expect(fetcher).not.toHaveBeenCalled();
      expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
    });

    it('treats child HTTP 200 with accepted false as a rejected approval', async () => {
      const fixture = await pausedWorkflowApproval('exec-approval-declined');
      const fetcher = vi.fn(async () => Response.json({ accepted: false }));
      vi.stubGlobal('fetch', fetcher);
      const reply = await fixture.approve();
      expect(reply.status).toBe(409);
      expect(await reply.json()).toMatchObject({ accepted: false, status: 'paused' });
      expect(fixture.stored()?.result).toMatchObject({ workflowStatus: 'paused' });
      expect(fixture.stored()?.result).not.toHaveProperty('skillApprovalHandoff');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
    });

    it.each(['approve', 'cancel'] as const)('recovers a confirmed child %s after a parent checkpoint failure', async action => {
      let failFinal = true;
      const fixture = await pausedWorkflowApproval('exec-approval-recover-' + action, {
        rejectApprovalWrite: next => failFinal && next.workflowStatus === (action === 'cancel' ? 'cancelled' : 'running'),
      });
      const videoUrl = '/api/serve-upload/videos/final.mp4';
      assetRead.mockResolvedValue({ assetId: 'video-asset-1', assetVersionId: result.videoAssetVersionId, kind: 'video', url: videoUrl });
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith('/api/skill-runs/' + fixture.runId)) return new Response(null, { status: 404 });
        if (init?.method === 'PATCH') return Response.json({ accepted: true,
          ...(action === 'cancel' ? { projection: { runId: fixture.runId, status: 'cancelled' } } : {}) });
        if (init?.method !== 'GET' || action === 'cancel') return new Response(null, { status: 404 });
        return Response.json({ run: {
          runId: fixture.runId, status: 'completed', assetVersionIds: [result.videoAssetVersionId],
          outputs: [{ stepId: 'generate-film', kind: 'json', schemaId: result.schemaId, content: JSON.stringify(result) }],
        } });
      });
      vi.stubGlobal('fetch', fetcher);
      const reply = await fixture.approve(action);
      expect(reply.status).toBe(503);
      expect(await reply.json()).toMatchObject({ status: 'paused', approvalPending: true });
      expect(approvalQuery).toHaveBeenCalledTimes(2);
      expect(fixture.stored()?.result).toMatchObject({
        workflowStatus: 'paused', skillApprovalHandoff: { nodeId: fixture.node.id, runId: fixture.runId, action },
      });
      expect(fixture.stored()?.result?.results).not.toHaveProperty(fixture.downstream.id);
      expect((await fixture.approve(action === 'cancel' ? 'approve' : 'cancel')).status).toBe(409);

      failFinal = false;
      if (action === 'approve') {
        approvalEvents.mockResolvedValue(durableApprovalEvents(fixture.runId, 'approve', approval.generation + 1));
        expect(await (await fixture.status()).json()).toMatchObject({ status: 'paused', approvalPending: true });
      }
      approvalEvents.mockResolvedValue(durableApprovalEvents(fixture.runId, action));
      if (action === 'cancel') {
        expect(await (await fixture.status()).json()).toMatchObject({ status: 'paused', approvalPending: true });
        expect(cancelPrepaidChildren).not.toHaveBeenCalled();
        routeMocks.getCloudTaskForUser.mockImplementation(async (id, actor) => {
          if (actor !== 'workflow-user') return null;
          if (id === fixture.executionId) return structuredClone(fixture.stored());
          return id === fixture.runId ? { id, userId: actor, projectId: 'project-a', type: 'agent-run', status: 'cancelled' } : null;
        });
        cancelPrepaidChildren.mockResolvedValue(['synthetic-paid-child']);
      }
      const recovered = await (action === 'cancel' ? fixture.approve('cancel') : fixture.status());
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ executionId: fixture.executionId, status: action === 'cancel' ? 'cancelled' : 'running' });
      await vi.waitFor(() => expect(fixture.stored()?.result).toMatchObject({
        workflowStatus: action === 'cancel' ? 'cancelled' : 'completed',
        results: action === 'cancel' ? { [fixture.node.id]: { status: 'failed' } }
          : { [fixture.node.id]: { status: 'success', output: { runId: fixture.runId } },
            [fixture.downstream.id]: { status: 'success', output: { videoUrl } } },
      }));
      if (action === 'cancel') {
        expect(fixture.stored()?.result?.results).not.toHaveProperty(fixture.downstream.id);
        expect(cancelPrepaidChildren).toHaveBeenCalledExactlyOnceWith({ actorUserId: 'workflow-user', runId: fixture.runId });
        expect(abortChild).toHaveBeenCalledExactlyOnceWith('synthetic-paid-child', 'cancelled');
      }
      expect(fixture.stored()?.result).not.toHaveProperty('skillApprovalHandoff');
      expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(action === 'cancel' ? ['PATCH'] : ['PATCH', 'GET']);
      expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
    });

    it('recovers a saved revise intent when the first request ends before child dispatch', async () => {
      let lostPrepare = true;
      const fixture = await pausedWorkflowApproval('exec-approval-before-dispatch', {
        afterApprovalWrite: next => {
          if (lostPrepare && next.skillApprovalHandoff) {
            lostPrepare = false;
            throw new Error('Synthetic commit acknowledgement lost');
          }
        },
      });
      const revised = { ...approval, revision: approval.revision + 1, generation: approval.generation + 1 };
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith('/api/skill-runs/' + fixture.runId)) return new Response(null, { status: 404 });
        if (init?.method === 'PATCH') return Response.json({ accepted: true });
        if (init?.method === 'GET') return Response.json({ run: { runId: fixture.runId, status: 'paused', approval: revised } });
        return new Response(null, { status: 404 });
      });
      vi.stubGlobal('fetch', fetcher);
      const instruction = 'Keep the original pacing';
      expect((await fixture.approve('revise', '  ' + instruction + '  ')).status).toBe(503);
      expect(fixture.stored()?.result).toMatchObject({ workflowStatus: 'paused', dispatchStopped: true,
        skillApprovalHandoff: { nodeId: fixture.node.id, runId: fixture.runId, action: 'revise', revisionInstruction: instruction },
      });
      const waiting = await (await fixture.status()).json();
      expect(waiting).toMatchObject({ executionId: fixture.executionId, status: 'paused', approvalPending: true,
        results: { [fixture.node.id]: { status: 'waiting-approval', output: { runId: fixture.runId } } },
      });
      expect(waiting).not.toHaveProperty('skillApprovalHandoff');
      expect((await fixture.approve('revise', 'Use a different pace')).status).toBe(409);
      expect(fetcher).not.toHaveBeenCalled();

      expect((await fixture.approve('revise')).status).toBe(200);
      await vi.waitFor(() => expect(fixture.stored()?.result).toMatchObject({ workflowStatus: 'paused',
        results: { [fixture.node.id]: { status: 'waiting-approval', output: { runId: fixture.runId, approval: revised } } },
      }));
      expect(fixture.stored()?.result).not.toHaveProperty('skillApprovalHandoff');
      expect(fixture.stored()?.result?.results).not.toHaveProperty(fixture.downstream.id);
      const patches = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ action: 'revise', revision: approval.revision,
        generation: approval.generation, planChecksum: approval.planChecksum, revisionInstruction: instruction,
      });
      expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
    });

    it('carries the current approval lease attempt into an image receiver', async () => {
      const fixture = await pausedWorkflowApproval('exec-approval-image', {}, 'image');
      const imageUrl = '/api/serve-upload/images/final.png';
      assetRead.mockResolvedValue({ assetId: 'image-asset', assetVersionId: 'image-version', kind: 'image', url: imageUrl });
      imageReceiver.mockResolvedValue({
        status: 'committed', nodeResult: { nodeId: fixture.downstream.id, status: 'success', output: { imageUrl } },
      });
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) => (
        init?.method === 'PATCH' ? Response.json({ accepted: true }) : Response.json({ run: {
          runId: fixture.runId, status: 'completed', assetVersionIds: ['image-version'], outputs: [],
        } })
      ));
      vi.stubGlobal('fetch', fetcher);
      expect((await fixture.approve()).status).toBe(200);
      await vi.waitFor(() => expect(imageReceiver).toHaveBeenCalledExactlyOnceWith(
        expect.any(Object), expect.any(Map), expect.objectContaining({
          parentExecutionId: fixture.executionId, nodeId: fixture.downstream.id,
          leaseOwner: expect.stringMatching(/^workflow-approval:/), leaseAttemptCount: 5,
        }), expect.any(AbortSignal),
      ));
      await vi.waitFor(() => expect(fixture.stored()?.result?.workflowStatus).toBe('completed'));
      expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['PATCH', 'GET']);
      expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
    });
  });

  describe('approval concurrency fences', () => {
    it.each(['running', 'completed'] as const)('shows durable %s over a cached pause', async status => {
      const fixture = await pausedWorkflowApproval('exec-approval-cache-' + status);
      expect(await (await fixture.status()).json()).toMatchObject({ status: 'paused' });

      // Another worker advanced the durable task after this route cached the pause.
      const task = fixture.stored()!;
      const nodeStatus = status === 'completed' ? 'success' : 'running';
      Object.assign(task, {
        status: status === 'completed' ? 'completed' : 'processing',
        revision: task.revision! + 1,
        leaseOwner: 'other-workflow-worker',
        leaseExpiresAt: Date.now() + 120_000,
        attemptCount: task.attemptCount! + 1,
        result: {
          ...task.result, workflowStatus: status, completedAt: status === 'completed' ? 3 : null,
          activeSkillRuns: status === 'completed' ? {} : task.result!.activeSkillRuns,
          results: { [fixture.node.id]: {
            nodeId: fixture.node.id, status: nodeStatus, durationMs: 1,
            output: { runId: fixture.runId },
          } },
        },
      });
      const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetcher);

      const response = await fixture.status();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        executionId: fixture.executionId, status,
        results: { [fixture.node.id]: { status: nodeStatus, output: { runId: fixture.runId } } },
      });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.each(['cancel', 'retry'] as const)('blocks generic %s on a stale cache during a durable handoff', async action => {
      const fixture = await pausedWorkflowApproval('exec-approval-cache-' + action);
      expect(await (await fixture.status()).json()).toMatchObject({ status: 'paused' });

      const task = fixture.stored()!;
      task.revision = task.revision! + 1;
      task.result = {
        ...task.result, dispatchStopped: true,
        skillApprovalHandoff: {
          nodeId: fixture.node.id, runId: fixture.runId, action: 'approve',
          identity: { revision: approval.revision, generation: approval.generation, planChecksum: approval.planChecksum },
        },
      };
      const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetcher);

      const response = await postWorkflow({
        action, executionId: fixture.executionId, nodeId: fixture.node.id,
        projectId: task.projectId, workflowId: task.result.workflowId,
        nodes: [fixture.node], connections: [],
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        executionId: fixture.executionId, status: 'paused', approvalPending: true,
      });
    });

    it('fences the first continuation write with the claimed owner and attempt', async () => {
      const fixture = await pausedWorkflowApproval('exec-approval-first-progress-lease');
      const persist = routeMocks.updateCloudTask.getMockImplementation()!;
      let firstWrite: UpdateCloudTaskInput | undefined;
      routeMocks.updateCloudTask.mockImplementationOnce(async (id, update) => {
        firstWrite = structuredClone(update);
        // The new worker claims the task after renewal but before this write reaches storage.
        const task = fixture.stored()!;
        task.leaseOwner = 'other-workflow-worker';
        task.leaseExpiresAt = Date.now() + 120_000;
        task.attemptCount = 6;
        return persist(id, update);
      });
      const revised = { ...approval, revision: 1, generation: 1 };
      const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'PATCH' ? Response.json({ accepted: true }) : Response.json({
          run: { runId: fixture.runId, status: 'paused', approval: revised },
        }));
      vi.stubGlobal('fetch', fetcher);

      const response = await fixture.approve('revise', 'Keep the original pacing');
      expect(response.status).toBe(200);
      const owner = routeMocks.claimCloudTaskLease.mock.calls[0]?.[1];
      expect(owner).toEqual(expect.any(String));
      await vi.waitFor(() => expect(routeMocks.releaseCloudTaskLease).toHaveBeenCalledWith(fixture.executionId, owner));

      expect(routeMocks.updateCloudTask.mock.calls[0]?.[0]).toBe(fixture.executionId);
      expect(firstWrite).toMatchObject({
        leaseOwner: owner,
        expectedLeaseAttemptCount: 5,
        result: { workflowStatus: 'running', results: { [fixture.node.id]: { status: 'running' } } },
      });
      expect(fixture.stored()).toMatchObject({
        leaseOwner: 'other-workflow-worker',
        attemptCount: 6,
        result: { results: { [fixture.node.id]: { status: 'waiting-approval', output: { approval } } } },
      });
    });
  });

  it('沙箱重启后只从当前用户持久化的 paused 快照恢复原始执行图', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');
    expect(source).toContain('restorePausedWorkflowExecution');
    expect(source).toContain("!['paused', 'running'].includes(String(persistedResult.workflowStatus))");
    expect(source).toContain('persistedResult.executionGraph');
    expect(source).toContain('executionCache.set(input.executionId, restored)');
    expect(source).toContain('expectedRevision: parent.revision, expectedResult: parent.result');
    expect(source).toContain('state.executionNodes?.find');
    expect(source).not.toContain('exec.executionNodes || nodes');
  });

  it('真实状态查询在沙箱重启后恢复同一个运行中 Skill Run', async () => {
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };
    const persisted: CloudTask = {
      id: 'exec-recover', userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
      status: 'processing', progress: 50, creditStatus: 'not-applicable', createdAt: 1, updatedAt: 2,
      result: {
        workflowStatus: 'running', projectId: 'project-a', workflowId: 'workflow-a', totalNodes: 1,
        currentNodeId: node.id, startedAt: 1, completedAt: null,
        results: { [node.id]: {
          nodeId: node.id, status: 'running', durationMs: 1,
          output: { runId: 'run-video-recover', status: 'executing' },
        } },
        activeSkillRuns: { [`exec-recover:${node.id}`]: 'run-video-recover' },
        executionGraph: { nodes: [node], connections: [] },
      },
    };
    // Status classification and cold recovery both read the same persisted row.
    routeMocks.getCloudTaskForUser.mockImplementation(async (id, userId) => (
      id === persisted.id && userId === persisted.userId ? structuredClone(persisted) : null
    ));
    const fetchSkillRun = vi.fn(async () => Response.json({ run: {
      runId: 'run-video-recover', status: 'paused', assetVersionIds: [], approval,
      resumeFromStepId: 'generate-film', outputs: [],
    } }));
    vi.stubGlobal('fetch', fetchSkillRun);

    const response = await postWorkflow({ action: 'status', executionId: 'exec-recover' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ executionId: 'exec-recover', status: 'running' });
    await vi.waitFor(() => expect(routeMocks.updateCloudTask).toHaveBeenCalledWith(
      'exec-recover', expect.objectContaining({
        result: expect.objectContaining({
          workflowStatus: 'paused',
          activeSkillRuns: { [`exec-recover:${node.id}`]: 'run-video-recover' },
        }),
      }),
    ));
    expect(routeMocks.claimCloudTaskLease).toHaveBeenCalledExactlyOnceWith(
      'exec-recover', expect.stringMatching(/^workflow-recovery:/), 120_000,
    );
    expect(fetchSkillRun).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/api\/skill-runs\/run-video-recover$/), expect.objectContaining({ method: 'GET' }),
    );
    expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
  });

  it('恢复抢租失败后下一次状态查询会重新尝试抢租', async () => {
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };
    const snapshot = {
      id: 'exec-retry-lease', userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
      status: 'processing', progress: 50, creditStatus: 'none', createdAt: 1, updatedAt: 2,
      result: {
        workflowStatus: 'running', projectId: 'project-a', workflowId: 'workflow-a', totalNodes: 1,
        currentNodeId: node.id, startedAt: 1, completedAt: null,
        results: { [node.id]: { nodeId: node.id, status: 'running', durationMs: 1,
          output: { runId: 'run-retry-lease', status: 'executing' } } },
        executionGraph: { nodes: [node], connections: [] },
      },
    };
    routeMocks.getCloudTaskForUser.mockResolvedValue(snapshot);
    routeMocks.claimCloudTaskLease.mockResolvedValue(null);

    await postWorkflow({ action: 'status', executionId: 'exec-retry-lease' });
    await postWorkflow({ action: 'status', executionId: 'exec-retry-lease' });

    expect(routeMocks.claimCloudTaskLease).toHaveBeenCalledTimes(2);
  });

  it('恢复抢租抛错后下一次状态查询仍会重新尝试', async () => {
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };
    routeMocks.getCloudTaskForUser.mockResolvedValue({
      id: 'exec-retry-error', userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
      status: 'processing', progress: 50, creditStatus: 'none', createdAt: 1, updatedAt: 2,
      result: {
        workflowStatus: 'running', projectId: 'project-a', workflowId: 'workflow-a', totalNodes: 1,
        currentNodeId: node.id, startedAt: 1, completedAt: null,
        results: { [node.id]: { nodeId: node.id, status: 'running', durationMs: 1,
          output: { runId: 'run-retry-error', status: 'executing' } } },
        executionGraph: { nodes: [node], connections: [] },
      },
    });
    routeMocks.claimCloudTaskLease
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(null);

    expect((await postWorkflow({ action: 'status', executionId: 'exec-retry-error' })).status).toBe(500);
    await postWorkflow({ action: 'status', executionId: 'exec-retry-error' });

    expect(routeMocks.claimCloudTaskLease).toHaveBeenCalledTimes(2);
  });

  it('恢复请求头读取失败后释放租约并允许下一次状态查询重试', async () => {
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };
    routeMocks.getCloudTaskForUser.mockResolvedValue({
      id: 'exec-retry-headers', userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
      status: 'processing', progress: 50, creditStatus: 'none', createdAt: 1, updatedAt: 2,
      result: {
        workflowStatus: 'running', projectId: 'project-a', workflowId: 'workflow-a', totalNodes: 1,
        currentNodeId: node.id, startedAt: 1, completedAt: null,
        results: { [node.id]: { nodeId: node.id, status: 'running', durationMs: 1,
          output: { runId: 'run-retry-headers', status: 'executing' } } },
        executionGraph: { nodes: [node], connections: [] },
      },
    });
    authMocks.getInternalRequestHeaders
      .mockRejectedValueOnce(new Error('header unavailable'))
      .mockResolvedValueOnce({});
    routeMocks.claimCloudTaskLease
      .mockResolvedValueOnce({ taskId: 'exec-retry-headers', owner: 'first', expiresAt: Date.now() + 120_000, attemptCount: 1 })
      .mockResolvedValueOnce(null);

    expect((await postWorkflow({ action: 'status', executionId: 'exec-retry-headers' })).status).toBe(500);
    await postWorkflow({ action: 'status', executionId: 'exec-retry-headers' });

    expect(routeMocks.releaseCloudTaskLease).toHaveBeenCalledTimes(1);
    expect(routeMocks.claimCloudTaskLease).toHaveBeenCalledTimes(2);
  });

  it('并发批准只允许一个请求取得数据库租约并继续同一 Run', async () => {
    const fixture = await pausedWorkflowApproval('exec-concurrent');
    let acknowledge!: (response: Response) => void;
    const childReply = new Promise<Response>(resolve => { acknowledge = resolve; });
    const child = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/api/skill-runs/' + fixture.runId)) return new Response(null, { status: 404 });
      if (init?.method === 'PATCH') return childReply;
      return Response.json({ run: {
        runId: fixture.runId, status: 'completed', assetVersionIds: [], outputs: [],
      } });
    });
    vi.stubGlobal('fetch', child);
    const winner = fixture.approve();
    try {
      await vi.waitFor(() => expect(child.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1));
      expect((await fixture.approve()).status).toBe(409);
    } finally {
      acknowledge(Response.json({ accepted: true }));
    }
    expect((await winner).status).toBe(200);
    await vi.waitFor(() => expect(routeMocks.releaseCloudTaskLease).toHaveBeenCalledWith(
      fixture.executionId, expect.stringMatching(/^workflow-approval:/),
    ));
    const leaseAttempts = await Promise.all(routeMocks.claimCloudTaskLease.mock.results.map(result => result.value));
    expect(leaseAttempts.filter(Boolean)).toHaveLength(1);
    expect(child.mock.calls.map(([, init]) => init?.method)).toEqual(['PATCH', 'GET']);
    expect(routeMocks.createCloudTask).not.toHaveBeenCalled();
  });

  it('循环内部 Skill 待审批时暂停整个工作流且不进入下一轮', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');
    const loopSkill = source.indexOf("if (dsNode.type === 'ai-skill')");
    const loopEnd = source.indexOf('loopContextStack.pop()', loopSkill);
    const loopSection = source.slice(loopSkill, loopEnd);
    expect(loopSection).toContain("dsResult.status === 'waiting-approval'");
    expect(loopSection).toContain("execState.status = 'paused'");
    expect(loopSection).toContain('execState.loopResume =');
    expect(loopSection).toContain('pausedNodeId: dsNode.id');
    expect(loopSection).toContain('resultMap.delete(node.id)');
    expect(loopSection).toContain('return;');
  });

  it('并行分支任一 Skill 待审批时暂停父工作流', async () => {
    const stored = persistWorkflowInMemory();
    const fork = createWorkflowNode('parallel', 0, 0);
    fork.ports = fork.ports.map(port => port.id === 'out-1' ? { ...port, type: 'prompt' } : port);
    const skill = briefVideoNode();
    const sibling = createWorkflowNode('condition-if', 300, 200);
    const downstream = createWorkflowNode('output-video', 600, 0);
    const connections = [
      createConnection(fork.id, 'out-1', skill.id, 'in-prompt', 'prompt'),
      createConnection(fork.id, 'out-2', sibling.id, 'in-data', 'any'),
      createConnection(skill.id, 'out-video', downstream.id, 'in-video', 'video'),
    ];
    const runId = 'run-video-parallel';
    const submitted: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/skill-runs' && init?.method === 'POST') {
        submitted.push(JSON.parse(String(init.body)));
        return Response.json({ runId }, { status: 201 });
      }
      if (path !== '/api/skill-runs/' + runId || init?.method !== 'GET') return new Response(null, { status: 404 });
      return Response.json({ run: {
        runId, status: 'paused', assetVersionIds: [], approval, resumeFromStepId: 'generate-film', outputs: [],
      } });
    }));

    const executionId = await startWorkflow([fork, skill, sibling, downstream], connections);
    await vi.waitFor(() => expect(stored()).toMatchObject({
      id: executionId, status: 'processing',
      result: {
        workflowStatus: 'paused', currentNodeId: skill.id,
        results: {
          [fork.id]: { output: { parallelResults: {
            [skill.id]: { nodeId: skill.id, status: 'waiting-approval', output: { runId } },
            [sibling.id]: { nodeId: sibling.id, status: 'success' },
          } } },
          [skill.id]: { status: 'waiting-approval', output: { runId } },
        },
      },
    }));
    expect(stored()?.result?.results).not.toHaveProperty(downstream.id);
    expect(submitted).toEqual([expect.objectContaining({
      idempotencyKey: ['workflow', executionId, fork.id, skill.id, skill.id, 'attempt', 0].join(':'),
    })]);
    expect(routeMocks.createCloudTask).toHaveBeenCalledTimes(1);
  });

  it('初始工作流持久化失败时不启动可能扣费的执行', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');
    expect(source).toContain("error: '工作流持久化初始化失败，未启动执行'");
    expect(source).toContain('executionCache.delete(executionIdNew)');
  });

  it('按独立端口把首帧和尾帧绑定到各自的 AssetVersion', () => {
    const skill = createBriefToVideoSkill(true);
    const start = createWorkflowNode('input-image', 0, 0);
    const end = createWorkflowNode('input-image', 0, 200);
    const target = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 300, 0), skill);
    target.config = { ...target.config, skillId: skill.id, version: skill.version };
    const results = new Map<string, ExecutionResult>([
      [start.id, { nodeId: start.id, status: 'success', durationMs: 0, output: {
        imageUrl: '/start.png', assetVersionId: 'start-v1',
      } }],
      [end.id, { nodeId: end.id, status: 'success', durationMs: 0, output: {
        imageUrl: '/end.png', assetVersionId: 'end-v1',
      } }],
    ]);
    const connections = [
      createConnection(start.id, 'out-image', target.id, 'in-start-frame', 'image'),
      createConnection(end.id, 'out-image', target.id, 'in-end-frame', 'image'),
    ];

    const inputs = getNodeInputs(target, connections, results);
    const request = buildWorkflowSkillRunRequest(target, inputs, skill, {
      projectId: 'project-a', workflowId: 'workflow-a', executionId: 'execution-a',
    });

    expect(request.body).toMatchObject({
      inputValues: { startFrame: 'start-v1', endFrame: 'end-v1' },
      sourceVersionIds: ['start-v1', 'end-v1'],
    });
  });

  it('把视频端口输出传给下游视频消费者', () => {
    const source = createWorkflowNode('ai-skill', 0, 0);
    const target = createWorkflowNode('output-video', 300, 0);
    const inputs = getNodeInputs(target, [
      createConnection(source.id, 'out-video', target.id, 'in-video', 'video'),
    ], new Map([[source.id, {
      nodeId: source.id, status: 'success', durationMs: 0,
      output: { videoUrl: '/videos/final.mp4', videoAssetVersionId: 'video-v1' },
    }]]));

    expect(inputs).toMatchObject({
      videoUrl: '/videos/final.mp4', videoAssetVersionId: 'video-v1',
    });
  });

  it('把审批暂停投影为可恢复状态，并阻止下游执行', async () => {
    const downstream = { execute: vi.fn() };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-video-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: {
        runId: 'run-video-1', status: 'paused', assetVersionIds: [], approval,
        resumeFromStepId: 'generate-film', outputs: [],
      } }), { status: 200 }));

    const projected = await executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'preset-brief-to-video-film' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async () => null,
    });

    expect(projected).toMatchObject({
      runId: 'run-video-1',
      status: 'waiting-approval',
      approval,
      resumeFromStepId: 'generate-film',
    });
    if (!shouldDeferWorkflowDownstream(projected)) await downstream.execute();
    expect(downstream.execute).not.toHaveBeenCalled();
  });

  it('在 paused 状态先于审批载荷可见时继续等待同一 Run', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-video-race' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: {
        runId: 'run-video-race', status: 'paused', pauseReason: 'approval',
        error: { code: 'SKILL_APPROVAL_REQUIRED', message: 'approval pending', retryable: false },
        assetVersionIds: ['plan-version'],
        outputs: [{ stepId: 'plan-film', kind: 'text', content: '已冻结的视频脚本' }],
      } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ run: {
        runId: 'run-video-race', status: 'paused', pauseReason: 'approval',
        assetVersionIds: ['plan-version'], approval,
        resumeFromStepId: 'generate-film',
        outputs: [{ stepId: 'plan-film', kind: 'text', content: '已冻结的视频脚本' }],
      } }), { status: 200 }));

    const projected = await executeWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      requestBody: { skillId: 'preset-brief-to-video-film' },
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async () => null,
    });

    expect(projected).toMatchObject({
      runId: 'run-video-race',
      status: 'waiting-approval',
      approval,
      resumeFromStepId: 'generate-film',
      assetVersionIds: ['plan-version'],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('批准后继续同一个 Run，并只投影授权视频 AssetVersion', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ run: {
      runId: 'run-video-1', status: 'completed', assetVersionIds: ['video-v1'],
      outputs: [{
        stepId: 'generate-film', kind: 'json', schemaId: 'brief-to-video-result-v1',
        content: JSON.stringify(result),
      }],
    } }), { status: 200 }));

    const output = await continueWorkflowSkillRun({
      submitUrl: 'http://localhost:5000/api/skill-runs',
      runId: 'run-video-1',
      headers: { 'Content-Type': 'application/json' },
      fetcher,
      pollIntervalMs: 0,
      resolveAssetVersion: async versionId => ({
        assetId: 'video-asset-1', assetVersionId: versionId,
        url: '/api/serve-upload/videos/final.mp4', kind: 'video',
      }),
    });

    expect(output).toMatchObject({
      runId: 'run-video-1',
      status: 'completed',
      videoAssetVersionId: 'video-v1',
      videoUrl: '/api/serve-upload/videos/final.mp4',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

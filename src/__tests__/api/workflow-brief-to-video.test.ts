import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
} from '@/lib/workflow-engine';

const routeMocks = vi.hoisted(() => ({
  claimCloudTaskLease: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ taskId: 'lease-task', owner: 'lease-owner', expiresAt: Date.now() + 120_000, attemptCount: 1 })),
  createCloudTask: vi.fn(async () => undefined),
  getCloudTaskForUser: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
  releaseCloudTaskLease: vi.fn(async () => true),
  renewCloudTaskLease: vi.fn(async () => true),
  updateCloudTask: vi.fn(async () => undefined),
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
vi.mock('@/lib/asset-core/storage', () => ({
  createPostgresAssetStorage: vi.fn(() => ({ read: vi.fn() })),
}));

import { POST } from '@/app/api/workflow/execute/route';

function postWorkflow(body: Record<string, unknown>): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/workflow/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  routeMocks.claimCloudTaskLease.mockResolvedValue({
    taskId: 'lease-task', owner: 'lease-owner',
    expiresAt: Date.now() + 120_000, attemptCount: 1,
  });
  routeMocks.createCloudTask.mockResolvedValue(undefined);
  routeMocks.getCloudTaskForUser.mockResolvedValue(null);
  routeMocks.releaseCloudTaskLease.mockResolvedValue(true);
  routeMocks.renewCloudTaskLease.mockResolvedValue(true);
  routeMocks.updateCloudTask.mockResolvedValue(undefined);
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

  it('让服务端执行暂停等待审批，并通过原执行实例继续下游', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');
    expect(source).toContain("result.status === 'waiting-approval'");
    expect(source).toContain("execState.status = 'paused'");
    expect(source).toContain("action === 'approve-skill'");
    expect(source).toContain('continueWorkflowSkillRun');
    expect(source).toContain('void continueApprovedSkillWorkflow');
    expect(source).toContain('leaseHeartbeat');
    expect(source).toContain('renewRecoveryLeaseBeforeDispatch');
    expect(source).toContain('pendingApprovalNodeId');
    expect(source).toContain("if (action !== 'start' && action !== 'approve-skill')");
  });

  it('沙箱重启后只从当前用户持久化的 paused 快照恢复原始执行图', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');
    expect(source).toContain('restorePausedWorkflowExecution');
    expect(source).toContain("!['paused', 'running'].includes(String(persistedResult.workflowStatus))");
    expect(source).toContain('persistedResult.executionGraph');
    expect(source).toContain('executionCache.set(input.executionId, restored)');
    expect(source).toContain('if (!exec.executionNodes || !exec.executionConnections)');
    expect(source).not.toContain('exec.executionNodes || nodes');
  });

  it('真实状态查询在沙箱重启后恢复同一个运行中 Skill Run', async () => {
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };
    routeMocks.getCloudTaskForUser.mockResolvedValueOnce({
      id: 'exec-recover', userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
      status: 'processing', progress: 50, creditStatus: 'none', createdAt: 1, updatedAt: 2,
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
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ run: {
      runId: 'run-video-recover', status: 'paused', assetVersionIds: [], approval,
      resumeFromStepId: 'generate-film', outputs: [],
    } })));

    const response = await postWorkflow({ action: 'status', executionId: 'exec-recover' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ executionId: 'exec-recover', status: 'running' });
    await vi.waitFor(() => expect(routeMocks.updateCloudTask).toHaveBeenCalledWith(
      'exec-recover', expect.objectContaining({
        result: expect.objectContaining({ workflowStatus: 'paused' }),
      }),
    ));
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
    const skill = createBriefToVideoSkill(true);
    const node = configureWorkflowSkillNodePorts(createWorkflowNode('ai-skill', 0, 0), skill);
    node.config = { ...node.config, skillId: skill.id, version: skill.version };
    const snapshot = {
      id: 'exec-concurrent', userId: 'workflow-user', projectId: 'project-a', type: 'workflow',
      status: 'processing', progress: 50, creditStatus: 'none', createdAt: 1, updatedAt: 2,
      result: {
        workflowStatus: 'paused', projectId: 'project-a', workflowId: 'workflow-a', totalNodes: 1,
        currentNodeId: node.id, startedAt: 1, completedAt: null,
        results: { [node.id]: {
          nodeId: node.id, status: 'waiting-approval', durationMs: 1,
          output: { runId: 'run-video-concurrent', status: 'waiting-approval' },
        } },
        activeSkillRuns: { [`exec-concurrent:${node.id}`]: 'run-video-concurrent' },
        executionGraph: { nodes: [node], connections: [] },
      },
    };
    routeMocks.getCloudTaskForUser.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot);
    routeMocks.claimCloudTaskLease
      .mockResolvedValueOnce({ taskId: 'exec-concurrent', owner: 'winner', expiresAt: Date.now() + 120_000, attemptCount: 1 })
      .mockResolvedValueOnce(null);
    const provider = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
      ? Response.json({ accepted: true })
      : Response.json({ run: {
          runId: 'run-video-concurrent', status: 'paused', assetVersionIds: [], approval,
          resumeFromStepId: 'generate-film', outputs: [],
        } }));
    vi.stubGlobal('fetch', provider);
    const body = {
      action: 'approve-skill', controlAction: 'approve', executionId: 'exec-concurrent',
      nodeId: node.id, projectId: 'project-a', workflowId: 'workflow-a',
      nodes: [node], connections: [], revision: 0, generation: 0, planChecksum: 'a'.repeat(64),
    };

    const responses = await Promise.all([postWorkflow(body), postWorkflow(body)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(provider.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
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

  it('并行分支任一 Skill 待审批时暂停父工作流', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/workflow/execute/route.ts'), 'utf8');
    const branchMerge = source.indexOf('for (const branch of branchStates)');
    const branchEnd = source.indexOf('if (isLoopNode)', branchMerge);
    const branchSection = source.slice(branchMerge, branchEnd);
    expect(branchSection).toContain("branch.state.status === 'paused'");
    expect(branchSection).toContain("execState.status = 'paused'");
    expect(branchSection).toContain('return;');
    expect(source).toContain("result.status === 'waiting-approval'");
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

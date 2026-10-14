import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createWorkflowNode, type WorkflowNode, type ExecutionResult } from '@/lib/workflow-engine';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { CloudTask } from '@/lib/cloud-task-storage';
import type { WorkflowSketchHost } from '@/lib/sketch-to-code/workflow';
import type { WorkflowSketchImageIntent } from '@/lib/sketch-to-code/image-workflow';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), headers: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(),
  claim: vi.fn(), renew: vi.fn(), release: vi.fn(), model: vi.fn(), executeImage: vi.fn(), cancelImage: vi.fn(),
  executeCode: vi.fn(), cancelCode: vi.fn(), provider: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: mocks.auth, getInternalRequestHeaders: mocks.headers }));
vi.mock('@/lib/cloud-task-storage', async original => ({ ...await original<typeof import('@/lib/cloud-task-storage')>(),
  getCloudTaskForUser: mocks.get, createCloudTask: mocks.create, updateCloudTask: mocks.update,
  claimCloudTaskLease: mocks.claim, renewCloudTaskLease: mocks.renew, releaseCloudTaskLease: mocks.release }));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: mocks.model }));
vi.mock('@/lib/server-api-config', () => ({ findProviderById: mocks.provider, findProviderForModel: mocks.provider, findProviderForFeature: mocks.provider }));
vi.mock('@/lib/sketch-to-code/image-workflow', () => ({ executeWorkflowSketchImage: mocks.executeImage, cancelWorkflowSketchImage: mocks.cancelImage }));
vi.mock('@/lib/sketch-to-code/workflow', async original => ({ ...await original<typeof import('@/lib/sketch-to-code/workflow')>(),
  executeWorkflowSketch: mocks.executeCode, cancelWorkflowSketch: mocks.cancelCode }));
vi.mock('@/lib/op-log', () => ({ logError: vi.fn(), OP_ACTIONS: { WORKFLOW_EXECUTE: 'workflow' } }));
import { POST } from '@/app/api/workflow/execute/route';

const png = 'data:image/png;base64,iVBORw0KGgo='; // No image preparation is mocked as successful here: this file isolates parent dispatch.
let tasks: Map<string, CloudTask>, leases: Set<string>, lostFences: Set<string>, childWork: Set<string>;
const descriptor = (role: 'vision' | 'image'): TaskModelDescriptor => ({
  providerId: `${role}-p`, modelId: `${role}-m`, kind: role === 'vision' ? 'chat' : 'image', sourceType: role === 'vision' ? 'chat' : 'image',
  protocol: role === 'vision' ? 'chat-completions' : 'images-generations', executionMode: role === 'vision' ? 'sync' : 'async',
  supportsVision: role === 'vision', supportsReferenceImages: role === 'image', supportsMask: false,
  allowedRatios: ['4:3'], allowedSizes: [], qualityOptions: [], maxOutputs: 1, outputKinds: [role === 'vision' ? 'text' : 'image'], capabilitySources: {},
});
function imageNode(id = 'image-node'): WorkflowNode {
  const node = createWorkflowNode('ai-sketch-to-image', 0, 0); node.id = id;
  node.config = { visionModel: 'vision-p::vision-m', visionProviderId: 'vision-p', imageModel: 'image-p::image-m', imageProviderId: 'image-p', instruction: '小屋', imageUrl: png };
  return node;
}
async function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/workflow/execute', { method: 'POST', body: JSON.stringify(body) }));
}
async function settled(id: string, expected = 'completed'): Promise<void> {
  await vi.waitFor(() => { expect(tasks.get(id)?.result?.workflowStatus).toBe(expected); expect(leases.has(id)).toBe(false); });
}
async function executeImage(node: WorkflowNode, _inputs: Record<string, unknown>, host: WorkflowSketchHost<WorkflowSketchImageIntent>): Promise<ExecutionResult> {
  await host.assertCurrent();
  childWork.add(host.instanceId);
  host.intents[host.instanceId] ||= { version: 2, actorUserId: host.actorUserId, projectId: host.projectId, parentExecutionId: host.parentExecutionId,
    executionId: host.executionId, nodeId: host.nodeId, instanceId: host.instanceId, attempt: host.attempt,
    input: { projectId: host.projectId, imageDataUrl: png, instruction: '小屋', visionProviderId: 'vision-p', visionModelId: 'vision-m',
      imageProviderId: 'image-p', imageModelId: 'image-m', aspectRatio: '4:3', idempotencyKey: `original:${host.instanceId}` },
    access: { kind: 'personal', actorUserId: host.actorUserId, ownerId: host.actorUserId, projectId: host.projectId }, requestDigest: 'f'.repeat(64), childTaskId: `skimg_${node.id}` };
  await host.checkpoint(); await host.assertCurrent();
  return { nodeId: host.nodeId, status: 'success' as const, durationMs: 1, output: { taskId: `skimg_${node.id}`, imageUrl: '/api/serve-upload/generated.png',
    assetId: 'new-asset', assetVersionId: 'new-version', sketchImageReference: { kind: 'sketch-image-reference', taskId: `skimg_${node.id}`, projectId: host.projectId,
      visionProviderId: 'vision-p', visionModelId: 'vision-m', imageProviderId: 'image-p', imageModelId: 'image-m',
      previewAssetId: 'source-asset', previewAssetVersionId: 'source-version', imageAssetId: 'new-asset', imageAssetVersionId: 'new-version' } } };
}
beforeEach(() => {
  vi.clearAllMocks(); tasks = new Map(); leases = new Set(); lostFences = new Set(); childWork = new Set();
  mocks.auth.mockResolvedValue({ userId: 'u1', userRole: 'user', user: { id: 'u1', productType: 'all' } });
  mocks.headers.mockResolvedValue({ 'x-test-actor': 'u1' }); mocks.provider.mockResolvedValue(null);
  mocks.model.mockImplementation(async (providerId: string, modelId: string) => {
    const result = descriptor(providerId === 'vision-p' ? 'vision' : 'image');
    if (result.providerId !== providerId || result.modelId !== modelId) throw new Error('MODEL_UNAVAILABLE');
    return result;
  });
  mocks.create.mockImplementation(async (task: CloudTask) => { tasks.set(task.id, { ...structuredClone(task), revision: 1 }); });
  mocks.get.mockImplementation(async (id: string, actor: string) => { const task = tasks.get(id); return task?.userId === actor ? task : null; });
  mocks.update.mockImplementation(async (id: string, update: Partial<CloudTask> & { expectedRevision?: number }) => {
    const task = tasks.get(id); if (!task || update.expectedRevision !== undefined && update.expectedRevision !== task.revision) return false;
    tasks.set(id, { ...task, ...structuredClone(update), revision: (task.revision || 0) + 1 }); return true;
  });
  mocks.claim.mockImplementation(async (id: string) => { leases.add(id); return {}; }); mocks.renew.mockResolvedValue(true);
  mocks.release.mockImplementation(async (id: string) => { leases.delete(id); return true; });
  mocks.executeImage.mockImplementation(executeImage); mocks.cancelImage.mockResolvedValue('confirmed'); mocks.cancelCode.mockResolvedValue('winner');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('UNEXPECTED_NETWORK'); }));
});
afterEach(async () => {
  // Wait for actual original parent finalizers before replacing a fixture; no cross-case async owner.
  await vi.waitFor(() => {
    expect(leases.size).toBe(0);
    for (const task of tasks.values()) if (task.result?.workflowStatus === 'running') expect(lostFences.has(task.id)).toBe(true);
  });
  vi.unstubAllGlobals();
});

describe('same parent image sketch dispatch; controlled child adapter, isolated persistence ports', () => {
  it('freezes both exact role bindings, uses the image adapter and persists one parent intent map', async () => {
    const response = await post({ action: 'start', projectId: 'project-a', nodes: [imageNode()], connections: [] });
    expect(response.status).toBe(200); const { executionId } = await response.json(); await settled(executionId);
    expect(mocks.model.mock.calls.map(call => call.slice(0, 3))).toEqual([['vision-p', 'vision-m', 'u1'], ['image-p', 'image-m', 'u1']]);
    expect(mocks.executeImage).toHaveBeenCalledTimes(1); expect(mocks.executeCode).not.toHaveBeenCalled(); expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const parent = tasks.get(executionId)!;
    expect(Object.values(parent.result!.sketchIntents as Record<string, WorkflowSketchImageIntent>)).toHaveLength(1);
    expect(parent.result?.results).toMatchObject({ 'image-node': { status: 'success', output: { assetVersionId: 'new-version', sketchImageReference: { kind: 'sketch-image-reference' } } } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['vision-kind', 'vision-support', 'vision-mode', 'vision-protocol', 'image-kind', 'image-reference', 'image-operation', 'image-output', 'wrong-provider'])(
    'rejects unavailable explicit capability %s before parent creation', async condition => {
      mocks.model.mockImplementation(async (providerId: string) => {
        const result = descriptor(providerId === 'vision-p' ? 'vision' : 'image');
        if (condition === 'vision-kind' && providerId === 'vision-p') result.kind = 'image';
        if (condition === 'vision-support' && providerId === 'vision-p') result.supportsVision = false;
        if (condition === 'vision-mode' && providerId === 'vision-p') result.executionMode = 'async';
        if (condition === 'vision-protocol' && providerId === 'vision-p') result.protocol = 'unknown';
        if (condition === 'image-kind' && providerId === 'image-p') result.kind = 'chat';
        if (condition === 'image-reference' && providerId === 'image-p') result.supportsReferenceImages = false;
        if (condition === 'image-operation' && providerId === 'image-p') result.supportedOperations = ['text-to-image'];
        if (condition === 'image-output' && providerId === 'image-p') result.outputKinds = ['text'];
        if (condition === 'wrong-provider') result.providerId = 'other';
        return result;
      });
      const response = await post({ action: 'start', projectId: 'project-a', nodes: [imageNode()], connections: [] });
      expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: 'WORKFLOW_MODEL_BINDING_UNAVAILABLE' });
      expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.executeImage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
  it('retains original lease failure fence before child work instead of generic generation', async () => {
    mocks.renew.mockImplementation(async (id: string) => { lostFences.add(id); return false; });
    const response = await post({ action: 'start', projectId: 'project-a', nodes: [imageNode()], connections: [] });
    expect(response.status).toBe(200); const { executionId } = await response.json();
    await vi.waitFor(() => expect(mocks.release.mock.calls.some(call => call[0] === executionId)).toBe(true));
    // The original lost worker deliberately has no authority to overwrite the durable parent terminal state.
    expect(tasks.get(executionId)).toMatchObject({ status: 'processing', result: { workflowStatus: 'running' } });
    expect(childWork.size).toBe(0); expect(mocks.executeCode).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('persists uncertain child on the same parent and retries its frozen image intent without switching adapters', async () => {
    let first = true;
    mocks.executeImage.mockImplementation(async (...args: Parameters<typeof executeImage>) => {
      const completed = await executeImage(...args);
      if (!first) return completed; first = false;
      return { ...completed, status: 'running', output: { taskId: 'skimg_image-node', needsReconcile: true }, error: 'WORKFLOW_SKETCH_ADMISSION_UNKNOWN' };
    });
    const node = imageNode(); const response = await post({ action: 'start', projectId: 'project-a', nodes: [node], connections: [] });
    expect(response.status).toBe(200); const { executionId } = await response.json(); await settled(executionId, 'paused');
    const original = structuredClone(tasks.get(executionId)!.result!.sketchIntents);
    const retried = await post({ action: 'retry', executionId, nodeId: node.id, projectId: 'project-a', nodes: [node], connections: [] });
    expect((await retried.json()).success).toBe(true); await settled(executionId);
    expect(tasks.get(executionId)!.result!.sketchIntents).toEqual(original); expect(mocks.executeImage).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.executeCode).not.toHaveBeenCalled();
  });
  it.each(['confirmed', 'winner', 'unknown'] as const)('routes original image cancellation %s after persisted parent stop fence', async outcome => {
    mocks.executeImage.mockImplementation(async (...args: Parameters<typeof executeImage>) => ({ ...await executeImage(...args), status: 'running', error: 'WAIT_FOR_RESULT' }));
    const response = await post({ action: 'start', projectId: 'project-a', nodes: [imageNode()], connections: [] });
    expect(response.status).toBe(200); const { executionId } = await response.json(); await settled(executionId, 'paused');
    mocks.cancelImage.mockImplementation(async (intent: WorkflowSketchImageIntent) => {
      expect(tasks.get(executionId)?.result?.dispatchStopped).toBe(true); expect(intent.version).toBe(2); return outcome;
    });
    const cancelled = await post({ action: 'cancel', executionId, projectId: 'project-a' });
    expect(cancelled.status).toBe(outcome === 'confirmed' ? 200 : outcome === 'winner' ? 409 : 503);
    expect(mocks.cancelImage).toHaveBeenCalledTimes(1); expect(mocks.cancelCode).not.toHaveBeenCalled();
    expect(tasks.get(executionId)?.result?.workflowStatus).toBe(outcome === 'confirmed' ? 'cancelled' : 'paused');
  });
  it('uses original nested instance identity and retains one root intent authority', async () => {
    const subgraph = createWorkflowNode('subgraph', 0, 0); subgraph.id = 'subgraph-a'; subgraph.config.inlineWorkflow = { nodes: [imageNode()], connections: [] };
    const response = await post({ action: 'start', projectId: 'project-a', nodes: [subgraph], connections: [] });
    expect(response.status).toBe(200); const { executionId } = await response.json(); await settled(executionId);
    const intent = Object.values(tasks.get(executionId)!.result!.sketchIntents as Record<string, WorkflowSketchImageIntent>)[0];
    expect(intent.parentExecutionId).toBe(executionId); expect(intent.executionId).toBe(`${executionId}:subgraph-a`);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.executeImage).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('retains separate image loop instances in the same root map and freezes different original nonces', async () => {
    const loop = createWorkflowNode('loop-for', 0, 0); loop.id = 'loop-a'; loop.loopCount = 2; loop.config.loopCount = 2;
    const node = imageNode();
    const response = await post({ action: 'start', projectId: 'project-a', nodes: [loop, node], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: node.id, toPortId: 'in-prompt', type: 'prompt' },
    ] });
    expect(response.status).toBe(200); const { executionId } = await response.json(); await settled(executionId);
    const intents = Object.values(tasks.get(executionId)!.result!.sketchIntents as Record<string, WorkflowSketchImageIntent>);
    expect(intents).toHaveLength(2); expect(new Set(intents.map(intent => intent.input.idempotencyKey)).size).toBe(2);
    expect(intents.every(intent => intent.version === 2 && intent.parentExecutionId === executionId)).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.executeImage).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not let an older completed code child stop cancellation of the later image child', async () => {
    const code = createWorkflowNode('ai-sketch-to-code', 0, 0); code.id = 'code-node';
    code.config = { model: 'vision-p::vision-m', providerId: 'vision-p', instruction: '页面', imageUrl: png };
    mocks.executeCode.mockImplementation(async (_node: WorkflowNode, _inputs: Record<string, unknown>, host: WorkflowSketchHost) => {
      await host.assertCurrent();
      host.intents[host.instanceId] = { version: 1, actorUserId: host.actorUserId, projectId: host.projectId, parentExecutionId: host.parentExecutionId,
        executionId: host.executionId, nodeId: host.nodeId, instanceId: host.instanceId, attempt: host.attempt,
        input: { projectId: host.projectId, imageDataUrl: png, instruction: '页面', providerId: 'vision-p', modelId: 'vision-m', idempotencyKey: 'old-code-nonce' },
        access: { kind: 'personal', actorUserId: host.actorUserId, ownerId: host.actorUserId, projectId: host.projectId }, requestDigest: 'c'.repeat(64), childTaskId: 'sketch_old' };
      await host.checkpoint(); return { nodeId: host.nodeId, status: 'success', durationMs: 1, output: { taskId: 'sketch_old' } };
    });
    mocks.executeImage.mockImplementation(async (...args: Parameters<typeof executeImage>) => ({ ...await executeImage(...args), status: 'running', error: 'WAIT_FOR_RESULT' }));
    const response = await post({ action: 'start', projectId: 'project-a', nodes: [code, imageNode()], connections: [] });
    expect(response.status).toBe(200); const { executionId } = await response.json(); await settled(executionId, 'paused');
    expect(Object.values(tasks.get(executionId)!.result!.sketchIntents as Record<string, { version: number }>).map(intent => intent.version)).toEqual([1, 2]);
    const cancelled = await post({ action: 'cancel', executionId, projectId: 'project-a' });
    expect(cancelled.status).toBe(409); // Original completed code result is preserved, not falsely cancelled/refunded.
    expect(mocks.cancelCode).toHaveBeenCalledTimes(1); expect(mocks.cancelImage).toHaveBeenCalledTimes(1);
    expect(tasks.get(executionId)?.result?.results).toMatchObject({ 'code-node': { status: 'success', output: { taskId: 'sketch_old' } } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

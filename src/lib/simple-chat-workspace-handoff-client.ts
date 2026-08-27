import type { WorkspaceAssetReference } from './asset-core/types';
import {
  appendSimpleChatHandoffToWorkflow,
  stabilizeSimpleChatImportWorkflow,
  type PendingSimpleChatHandoffImage,
  type SimpleChatWorkspaceHandoff,
  type SimpleChatWorkspaceHandoffIntent,
} from './simple-chat-workspace-handoff';
import type { Workflow } from './workflow-engine';

export interface SimpleChatWorkflowTransferRequest {
  sourceVersion: string;
  targetProject: string;
  targetWorkspace: string;
  entityType: 'workflow-input';
  entityId: string;
  idempotencyKey: string;
  metadata: {
    sourceTrace: PendingSimpleChatHandoffImage['sourceTrace'];
    imageIndex: number;
    name: string | undefined;
  };
}

export interface ExecuteSimpleChatWorkspaceHandoffInput {
  intent: SimpleChatWorkspaceHandoffIntent;
  currentWorkflow: Workflow | null;
  getCurrentWorkflow?: () => Workflow | null;
  resolve: (intent: SimpleChatWorkspaceHandoffIntent) => Promise<SimpleChatWorkspaceHandoff>;
  transfer: (request: SimpleChatWorkflowTransferRequest) => Promise<WorkspaceAssetReference>;
  persist: (workflow: Workflow) => Promise<void>;
  cleanUrl: () => void;
  now: () => number;
}

export interface ExecuteSimpleChatWorkspaceHandoffResult {
  status: 'success' | 'partial-success';
  workflow: Workflow;
  addedNodeIds: string[];
  warnings: SimpleChatWorkspaceHandoff['warnings'];
}

export function toSimpleChatHandoffMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    UNAUTHORIZED: '登录状态已失效，请重新登录后再试',
    INVALID_HANDOFF: '智能对话发送信息不完整，请返回对话重新发送',
    FORBIDDEN: '无权读取该对话或写入当前项目',
    HANDOFF_SOURCE_NOT_FOUND: '原智能对话消息已不存在',
    NO_MANAGED_MEDIA: '该消息没有可导入的托管内容',
    SOURCE_PROJECT_FORBIDDEN: '无权读取该智能对话项目',
    TARGET_PROJECT_FORBIDDEN: '无权写入当前画布项目',
    CHAT_MESSAGE_NOT_FOUND: '原智能对话消息已不存在',
    ASSET_NOT_FOUND: '对话中的图片素材已不存在',
    ASSET_TRANSFER_FAILED: '图片素材导入失败，请稍后重试',
    ASSET_IDEMPOTENCY_CONFLICT: '导入请求与已有记录冲突，已停止且链接保留；请刷新或检查目标后重试',
  };
  return messages[code]
    || (code.includes('保存') || code.includes('已取消')
      ? code
      : '智能对话内容导入失败，请刷新页面重试');
}

export interface SimpleChatWorkspaceHandoffRunGuard {
  begin: (identity: string) => boolean;
  complete: (identity: string) => void;
  fail: (identity: string) => void;
}

export interface SimpleChatWorkspaceHandoffProjectQueue {
  enqueue: <T>(projectId: string, task: () => Promise<T>) => Promise<T>;
}

export function createSimpleChatWorkspaceHandoffProjectQueue(): SimpleChatWorkspaceHandoffProjectQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    enqueue: <T>(projectId: string, task: () => Promise<T>): Promise<T> => {
      const previous = tails.get(projectId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(task);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(projectId, tail);
      void tail.finally(() => {
        if (tails.get(projectId) === tail) tails.delete(projectId);
      });
      return result;
    },
  };
}

export function getSimpleChatWorkspaceHandoffIdentity(
  intent: SimpleChatWorkspaceHandoffIntent,
): string {
  return JSON.stringify([
    intent.targetProjectId,
    intent.chatProjectId,
    intent.chatTaskId,
    intent.chatMessageId,
  ]);
}

export function shouldConsumeSimpleChatWorkspaceHandoff(
  intent: SimpleChatWorkspaceHandoffIntent | null,
  currentProjectId: string | null | undefined,
): intent is SimpleChatWorkspaceHandoffIntent {
  return Boolean(intent && currentProjectId && intent.targetProjectId === currentProjectId);
}

export function createSimpleChatWorkspaceHandoffRunGuard(): SimpleChatWorkspaceHandoffRunGuard {
  const runningIdentities = new Set<string>();
  const release = (identity: string): void => {
    runningIdentities.delete(identity);
  };
  return {
    begin: identity => {
      if (runningIdentities.has(identity)) return false;
      runningIdentities.add(identity);
      return true;
    },
    complete: release,
    fail: release,
  };
}

export interface ConsumeSimpleChatWorkspaceHandoffForProjectInput
  extends Omit<ExecuteSimpleChatWorkspaceHandoffInput, 'intent' | 'currentWorkflow'> {
  intent: SimpleChatWorkspaceHandoffIntent | null;
  currentProjectId: string | null | undefined;
  currentWorkflow?: Workflow | null;
  guard: SimpleChatWorkspaceHandoffRunGuard;
  queue?: SimpleChatWorkspaceHandoffProjectQueue;
  getCurrentProjectId?: () => string | null | undefined;
  getCurrentIdentity?: () => string | null;
  getCurrentWorkflow?: () => Workflow | null;
  applyWorkflow?: (workflow: Workflow) => void;
}

function assertSimpleChatHandoffProjectScope(
  input: ConsumeSimpleChatWorkspaceHandoffForProjectInput,
  expectedProjectId: string,
): void {
  const projectMatches = !input.getCurrentProjectId
    || input.getCurrentProjectId() === expectedProjectId;
  if (!projectMatches) {
    throw new Error('智能对话导入已取消：当前项目已发生变化');
  }
}

function assertSimpleChatHandoffIdentity(
  input: ConsumeSimpleChatWorkspaceHandoffForProjectInput,
  expectedIdentity: string,
): void {
  if (input.getCurrentIdentity && input.getCurrentIdentity() !== expectedIdentity) {
    throw new Error('智能对话导入已取消：当前导入链接已发生变化');
  }
}

export async function consumeSimpleChatWorkspaceHandoffForProject(
  input: ConsumeSimpleChatWorkspaceHandoffForProjectInput,
): Promise<ExecuteSimpleChatWorkspaceHandoffResult | null> {
  if (!shouldConsumeSimpleChatWorkspaceHandoff(input.intent, input.currentProjectId)) return null;
  const intent = input.intent;
  const identity = getSimpleChatWorkspaceHandoffIdentity(intent);
  if (!input.guard.begin(identity)) return null;
  try {
    const run = async (): Promise<ExecuteSimpleChatWorkspaceHandoffResult> => {
      assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
      assertSimpleChatHandoffIdentity(input, identity);
      return executeSimpleChatWorkspaceHandoff({
        intent,
        currentWorkflow: input.getCurrentWorkflow
          ? input.getCurrentWorkflow()
          : input.currentWorkflow ?? null,
        resolve: input.resolve,
        transfer: input.transfer,
        getCurrentWorkflow: input.getCurrentWorkflow,
        persist: async workflow => {
          assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
          assertSimpleChatHandoffIdentity(input, identity);
          await input.persist(workflow);
          assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
        },
        cleanUrl: () => {
          assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
          if (input.getCurrentIdentity && input.getCurrentIdentity() !== identity) return;
          input.cleanUrl();
        },
        now: input.now,
      }).then(result => {
        assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
        input.applyWorkflow?.(result.workflow);
        return result;
      });
    };
    const result = input.queue
      ? await input.queue.enqueue(intent.targetProjectId, run)
      : await run();
    input.guard.complete(identity);
    return result;
  } catch (error) {
    input.guard.fail(identity);
    throw error;
  }
}

function buildTransferIdempotencyKey(
  intent: SimpleChatWorkspaceHandoffIntent,
  workflowId: string,
  pending: PendingSimpleChatHandoffImage,
  sourceVersion: string,
): string {
  return `simple-chat-workflow:${JSON.stringify([
    intent.targetProjectId,
    workflowId,
    intent.chatProjectId,
    intent.chatTaskId,
    intent.chatMessageId,
    pending.imageIndex,
    sourceVersion,
  ])}`;
}

export function buildSimpleChatWorkflowTransfer(
  intent: SimpleChatWorkspaceHandoffIntent,
  workflowId: string,
  pending: PendingSimpleChatHandoffImage,
): SimpleChatWorkflowTransferRequest {
  const sourceVersion = pending.assetRef.assetVersionId;
  if (!sourceVersion) throw new Error('Managed handoff image is missing an asset version');
  return {
    sourceVersion,
    targetProject: intent.targetProjectId,
    targetWorkspace: workflowId,
    entityType: 'workflow-input',
    entityId: pending.nodeId,
    idempotencyKey: buildTransferIdempotencyKey(intent, workflowId, pending, sourceVersion),
    metadata: {
      sourceTrace: pending.sourceTrace,
      imageIndex: pending.imageIndex,
      name: pending.assetRef.name,
    },
  };
}

export function applyTransferredImageReference(
  workflow: Workflow,
  nodeId: string,
  reference: WorkspaceAssetReference,
): Workflow {
  let found = false;
  const nodes = workflow.nodes.map(node => {
    if (node.id !== nodeId) return node;
    found = true;
    return {
      ...node,
      config: {
        ...node.config,
        imageUrl: reference.url,
        ...(reference.assetId ? { assetId: reference.assetId } : {}),
        ...(reference.assetVersionId ? { assetVersionId: reference.assetVersionId } : {}),
        ...(reference.placementId ? { placementId: reference.placementId } : {}),
        ...(reference.name ? { name: reference.name } : {}),
        ...(reference.sourceTrace ? { sourceTrace: reference.sourceTrace } : {}),
      },
    };
  });
  if (!found) throw new Error(`Workflow input node not found: ${nodeId}`);
  return { ...workflow, nodes };
}

export async function executeSimpleChatWorkspaceHandoff(
  input: ExecuteSimpleChatWorkspaceHandoffInput,
): Promise<ExecuteSimpleChatWorkspaceHandoffResult> {
  const startedWithoutWorkflow = input.currentWorkflow === null;
  const handoff = await input.resolve(input.intent);
  const now = input.now();
  const currentWorkflow = (): Workflow | null => {
    const latest = input.getCurrentWorkflow?.() ?? input.currentWorkflow;
    return startedWithoutWorkflow
      ? stabilizeSimpleChatImportWorkflow(latest, input.intent.targetProjectId, now)
      : latest;
  };
  const planned = appendSimpleChatHandoffToWorkflow(
    currentWorkflow(),
    input.intent.targetProjectId,
    handoff,
    now,
  );
  const transferred = new Map<string, WorkspaceAssetReference>();
  for (const pending of planned.pendingImages) {
    const reference = await input.transfer(buildSimpleChatWorkflowTransfer(
      input.intent,
      planned.workflow.id,
      pending,
    ));
    transferred.set(pending.nodeId, reference);
  }

  const applyPatch = (base: Workflow | null): Workflow => {
    const appended = appendSimpleChatHandoffToWorkflow(
      base,
      input.intent.targetProjectId,
      handoff,
      now,
    );
    let next = appended.workflow;
    for (const [nodeId, reference] of transferred) {
      next = applyTransferredImageReference(next, nodeId, reference);
    }
    return next;
  };

  const persistedWorkflow = applyPatch(currentWorkflow());
  await input.persist(persistedWorkflow);
  const workflow = applyPatch(input.getCurrentWorkflow ? currentWorkflow() : persistedWorkflow);
  input.cleanUrl();
  return {
    status: handoff.warnings.length > 0 ? 'partial-success' : 'success',
    workflow,
    addedNodeIds: planned.addedNodeIds,
    warnings: handoff.warnings,
  };
}

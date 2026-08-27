import type { WorkspaceAssetReference } from './asset-core/types';
import {
  appendSimpleChatHandoffToWorkflow,
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
        persist: async workflow => {
          assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
          assertSimpleChatHandoffIdentity(input, identity);
          await input.persist(workflow);
          assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
          input.applyWorkflow?.(workflow);
        },
        cleanUrl: () => {
          assertSimpleChatHandoffProjectScope(input, intent.targetProjectId);
          if (input.getCurrentIdentity && input.getCurrentIdentity() !== identity) return;
          input.cleanUrl();
        },
        now: input.now,
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
  const handoff = await input.resolve(input.intent);
  const planned = appendSimpleChatHandoffToWorkflow(
    input.currentWorkflow,
    input.intent.targetProjectId,
    handoff,
    input.now(),
  );
  let workflow = planned.workflow;
  for (const pending of planned.pendingImages) {
    const reference = await input.transfer(buildSimpleChatWorkflowTransfer(
      input.intent,
      workflow.id,
      pending,
    ));
    workflow = applyTransferredImageReference(workflow, pending.nodeId, reference);
  }
  await input.persist(workflow);
  input.cleanUrl();
  return {
    status: handoff.warnings.length > 0 ? 'partial-success' : 'success',
    workflow,
    addedNodeIds: planned.addedNodeIds,
    warnings: handoff.warnings,
  };
}

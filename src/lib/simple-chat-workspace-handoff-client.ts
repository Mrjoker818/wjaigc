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

import type { WorkspaceSourceTrace } from './asset-core/source-trace';
import type { WorkspaceAssetReference } from './asset-core/types';
import {
  createEmptyWorkflow,
  createWorkflowNode,
  type Workflow,
  type WorkflowNode,
} from './workflow-engine';

export interface SimpleChatWorkspaceHandoffIntent {
  targetProjectId: string;
  chatProjectId: string;
  chatTaskId: string;
  chatMessageId: string;
}

export interface SimpleChatWorkspaceHandoffImage {
  imageIndex: number;
  assetRef: WorkspaceAssetReference;
  sourceTrace: WorkspaceSourceTrace;
}

export interface SimpleChatWorkspaceHandoff {
  text: string | null;
  images: SimpleChatWorkspaceHandoffImage[];
  sourceTrace: WorkspaceSourceTrace;
  warnings: Array<'UNMANAGED_IMAGE_SKIPPED'>;
}

export interface PendingSimpleChatHandoffImage extends SimpleChatWorkspaceHandoffImage {
  nodeId: string;
}

export interface AppendSimpleChatHandoffResult {
  workflow: Workflow;
  addedNodeIds: string[];
  pendingImages: PendingSimpleChatHandoffImage[];
}

const HANDOFF_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const IMPORT_WORKFLOW_NAME = '智能对话导入';
const NODE_X_GAP = 80;
const NODE_Y_GAP = 40;
const EMPTY_WORKFLOW_X = 80;
const EMPTY_WORKFLOW_Y = 120;

function stableHash(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  return seeds.map((seed, seedIndex) => {
    let hash = seed;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index) + Math.imul(seedIndex + 1, 0x9e37);
      hash = Math.imul(hash, 0x01000193);
      hash ^= hash >>> 13;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
}

function parseHandoffIds(value: Record<string, unknown>): SimpleChatWorkspaceHandoffIntent | null {
  if (
    typeof value.targetProjectId !== 'string' || !HANDOFF_ID.test(value.targetProjectId)
    || typeof value.chatProjectId !== 'string' || !HANDOFF_ID.test(value.chatProjectId)
    || typeof value.chatTaskId !== 'string' || !HANDOFF_ID.test(value.chatTaskId)
    || typeof value.chatMessageId !== 'string' || !HANDOFF_ID.test(value.chatMessageId)
  ) return null;
  return {
    targetProjectId: value.targetProjectId,
    chatProjectId: value.chatProjectId,
    chatTaskId: value.chatTaskId,
    chatMessageId: value.chatMessageId,
  };
}

export function buildSimpleChatWorkspaceHandoffUrl(intent: SimpleChatWorkspaceHandoffIntent): string {
  const parsed = parseHandoffIds(intent as unknown as Record<string, unknown>);
  if (!parsed) throw new Error('Invalid simple chat workspace handoff intent');
  const params = new URLSearchParams({
    projectId: parsed.targetProjectId,
    mode: 'node',
    chatProjectId: parsed.chatProjectId,
    chatTaskId: parsed.chatTaskId,
    chatMessageId: parsed.chatMessageId,
  });
  return `/?${params.toString()}`;
}

export function parseSimpleChatWorkspaceHandoffIntent(
  value: string | URLSearchParams,
): SimpleChatWorkspaceHandoffIntent | null {
  const params = typeof value === 'string'
    ? new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
    : value;
  if (params.get('mode') !== 'node') return null;
  return parseHandoffIds({
    targetProjectId: params.get('projectId'),
    chatProjectId: params.get('chatProjectId'),
    chatTaskId: params.get('chatTaskId'),
    chatMessageId: params.get('chatMessageId'),
  });
}

export function parseSimpleChatWorkspaceHandoffBody(value: unknown): SimpleChatWorkspaceHandoffIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return parseHandoffIds(value as Record<string, unknown>);
}

export function stableChatImportWorkflowId(projectId: string): string {
  return `wf-chat-import-${stableHash(projectId)}`;
}

export function stableChatImportNodeId(
  intent: SimpleChatWorkspaceHandoffIntent,
  kind: 'text' | 'image',
  index: number,
): string {
  return `node-chat-${stableHash(JSON.stringify([intent.chatProjectId, intent.chatTaskId, intent.chatMessageId, kind, index]))}`;
}

export function createSimpleChatImportWorkflow(projectId: string, now: number): Workflow {
  return {
    ...createEmptyWorkflow(IMPORT_WORKFLOW_NAME),
    id: stableChatImportWorkflowId(projectId),
    createdAt: now,
    updatedAt: now,
  };
}

export function stabilizeSimpleChatImportWorkflow(
  workflow: Workflow | null,
  projectId: string,
  now: number,
): Workflow {
  if (!workflow) return createSimpleChatImportWorkflow(projectId, now);
  return {
    ...workflow,
    id: stableChatImportWorkflowId(projectId),
    name: IMPORT_WORKFLOW_NAME,
  };
}

function getAppendOrigin(nodes: WorkflowNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: EMPTY_WORKFLOW_X, y: EMPTY_WORKFLOW_Y };
  return {
    x: Math.max(...nodes.map(node => node.x + node.width)) + NODE_X_GAP,
    y: Math.min(...nodes.map(node => node.y)),
  };
}

export function appendSimpleChatHandoffToWorkflow(
  currentWorkflow: Workflow | null,
  targetProjectId: string,
  handoff: SimpleChatWorkspaceHandoff,
  now: number,
): AppendSimpleChatHandoffResult {
  const sourceIntent: SimpleChatWorkspaceHandoffIntent = {
    targetProjectId,
    chatProjectId: handoff.sourceTrace.chatProjectId,
    chatTaskId: handoff.sourceTrace.chatTaskId,
    chatMessageId: handoff.sourceTrace.messageId,
  };
  const baseWorkflow = currentWorkflow ?? createSimpleChatImportWorkflow(targetProjectId, now);
  const existingIds = new Set(baseWorkflow.nodes.map(node => node.id));
  const origin = getAppendOrigin(baseWorkflow.nodes);
  const candidates: Array<{ node: WorkflowNode; pendingImage?: PendingSimpleChatHandoffImage }> = [];

  if (handoff.text) {
    const id = stableChatImportNodeId(sourceIntent, 'text', 0);
    const node = createWorkflowNode('input-text', origin.x, origin.y, '智能对话文本');
    candidates.push({
      node: {
        ...node,
        id,
        config: { ...node.config, text: handoff.text, sourceTrace: handoff.sourceTrace },
      },
    });
  }

  handoff.images.forEach(image => {
    const id = stableChatImportNodeId(sourceIntent, 'image', image.imageIndex);
    const y = origin.y + candidates.length * (200 + NODE_Y_GAP);
    const node = createWorkflowNode('input-image', origin.x, y, '智能对话图片');
    candidates.push({
      node: {
        ...node,
        id,
        config: {
          ...node.config,
          imageIndex: image.imageIndex,
          ...(image.assetRef.name ? { name: image.assetRef.name } : {}),
          sourceTrace: image.sourceTrace,
        },
      },
      pendingImage: { ...image, nodeId: id },
    });
  });

  const additions = candidates.filter(candidate => !existingIds.has(candidate.node.id));
  const addedNodeIds = additions.map(candidate => candidate.node.id);
  const workflow = additions.length === 0
    ? baseWorkflow
    : {
      ...baseWorkflow,
      nodes: [...baseWorkflow.nodes, ...additions.map(candidate => candidate.node)],
      updatedAt: now,
    };
  return {
    workflow,
    addedNodeIds,
    pendingImages: additions.flatMap(candidate => candidate.pendingImage ? [candidate.pendingImage] : []),
  };
}

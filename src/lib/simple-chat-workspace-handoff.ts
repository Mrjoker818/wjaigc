import type { SimpleChatWorkspaceSourceTrace as WorkspaceSourceTrace } from './asset-core/source-trace';
import type { WorkspaceAssetReference } from './asset-core/types';

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

const HANDOFF_ID = /^[A-Za-z0-9._:-]{1,200}$/;
// Links created before the drama workbench used mode=node; keep them working.
const HANDOFF_MODES = new Set(['drama', 'node']);

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
    mode: 'drama',
    chatProjectId: parsed.chatProjectId,
    chatTaskId: parsed.chatTaskId,
    chatMessageId: parsed.chatMessageId,
  });
  return `/video?${params.toString()}`;
}

export function parseSimpleChatWorkspaceHandoffIntent(
  value: string | URLSearchParams,
): SimpleChatWorkspaceHandoffIntent | null {
  const params = typeof value === 'string'
    ? new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
    : value;
  if (!HANDOFF_MODES.has(params.get('mode') ?? '')) return null;
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

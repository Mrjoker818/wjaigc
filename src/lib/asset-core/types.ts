export type AssetKind =
  | 'image'
  | 'video'
  | 'model-3d'
  | 'psd'
  | 'svg'
  | 'document'
  | 'audio';

export type AssetStatus = 'active' | 'trashed';

export type MediaAvailability =
  | 'ready'
  | 'pending-persist'
  | 'missing'
  | 'recovering'
  | 'unrecoverable';

export type WorkspaceKind = 'canvas' | 'workflow' | 'chat';

export type WorkspaceEntityType =
  | 'canvas-image'
  | 'workflow-input'
  | 'workflow-output'
  | 'chat-attachment'
  | 'chat-result';

export type AssetGraphMode = 'legacy' | 'shadow' | 'asset-v3';

export interface AssetFile {
  url: string;
  availability: MediaAvailability;
  recoverySourceUrl?: string;
  storageKey?: string;
  checksum?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
}

export interface Asset {
  id: string;
  ownerId: string;
  projectId: string;
  kind: AssetKind;
  status: AssetStatus;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetVersion {
  id: string;
  assetId: string;
  ownerId: string;
  projectId: string;
  file: AssetFile;
  parentVersionIds: string[];
  taskId?: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface WorkspacePlacement {
  id: string;
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  workspace: WorkspaceKind;
  workspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
  status: AssetStatus;
  deletedAt: string | null;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const WORKSPACE_ENTITY_TYPES: ReadonlySet<WorkspaceEntityType> = new Set([
  'canvas-image',
  'workflow-input',
  'workflow-output',
  'chat-attachment',
  'chat-result',
]);

export function isTerminalMediaAvailability(
  availability: MediaAvailability,
): boolean {
  return availability === 'ready' || availability === 'unrecoverable';
}

export function assertWorkspaceEntityType(
  value: string,
): WorkspaceEntityType {
  if (WORKSPACE_ENTITY_TYPES.has(value as WorkspaceEntityType)) {
    return value as WorkspaceEntityType;
  }
  throw new Error(`Unsupported workspace entity type: ${value}`);
}

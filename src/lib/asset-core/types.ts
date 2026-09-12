import type { WorkspaceSourceTrace } from './source-trace';

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
  | 'canvas-video'
  | 'workflow-input'
  | 'workflow-output'
  | 'chat-attachment'
  | 'chat-result';

export interface WorkspaceEntityTypes {
  canvas: 'canvas-image' | 'canvas-video';
  workflow: 'workflow-input' | 'workflow-output';
  chat: 'chat-attachment' | 'chat-result';
}

export type WorkspaceEntityTypeFor<TWorkspace extends WorkspaceKind> =
  WorkspaceEntityTypes[TWorkspace];

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
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceAssetReference {
  assetId?: string;
  assetVersionId?: string;
  kind?: AssetKind;
  placementId?: string;
  entityId?: string;
  url: string;
  name?: string;
  sourceTrace?: WorkspaceSourceTrace;
}

export interface RegisteredWorkspaceAssetReference extends WorkspaceAssetReference {
  assetId: string;
  assetVersionId: string;
  placementId: string;
  entityId: string;
}

/** Server-only readable reference returned after actor/project/version authorization. */
export interface WorkspaceReadableAssetReference extends WorkspaceAssetReference {
  assetId: string;
  assetVersionId: string;
  kind: AssetKind;
  storageKey?: string;
  checksum?: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
}

export type WorkspacePlacement = {
  [TWorkspace in WorkspaceKind]: WorkspacePlacementFor<TWorkspace>;
}[WorkspaceKind];

export interface WorkspacePlacementFor<TWorkspace extends WorkspaceKind> {
  id: string;
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  workspace: TWorkspace;
  workspaceId: string;
  entityType: WorkspaceEntityTypeFor<TWorkspace>;
  entityId: string;
  status: AssetStatus;
  deletedAt: string | null;
  lifecycleRevision?: string;
  transform?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const WORKSPACE_ENTITY_TYPES = {
  canvas: new Set<WorkspaceEntityTypeFor<'canvas'>>(['canvas-image', 'canvas-video']),
  workflow: new Set<WorkspaceEntityTypeFor<'workflow'>>([
    'workflow-input',
    'workflow-output',
  ]),
  chat: new Set<WorkspaceEntityTypeFor<'chat'>>([
    'chat-attachment',
    'chat-result',
  ]),
} as const;

export function isTerminalMediaAvailability(
  availability: MediaAvailability,
): boolean {
  return availability === 'ready' || availability === 'unrecoverable';
}

export function assertWorkspaceEntityType<TWorkspace extends WorkspaceKind>(
  workspace: TWorkspace,
  value: string,
): WorkspaceEntityTypeFor<TWorkspace> {
  if ((WORKSPACE_ENTITY_TYPES[workspace] as ReadonlySet<string>).has(value)) {
    return value as WorkspaceEntityTypeFor<TWorkspace>;
  }
  throw new Error(`Unsupported workspace entity type for ${workspace}: ${value}`);
}

import type { WorkspaceAssetReference } from './types';

export const CANVAS_ASSET_DRAG_MIME = 'application/x-wujie-canvas-asset+json';

export interface CanvasAssetDragPayload extends WorkspaceAssetReference {
  id: string;
  projectId?: string;
  width?: number;
  height?: number;
  versionId?: string;
}

export function findWorkspaceAssetReferenceByUrl(
  url: string,
  references: WorkspaceAssetReference[],
): WorkspaceAssetReference | null {
  const matches = references.filter(reference => (
    reference.url === url
    && Boolean(reference.assetVersionId)
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function canvasEntityIdForTransferredReference(
  reference: WorkspaceAssetReference,
  fallbackId: string,
): string {
  return reference.entityId || fallbackId;
}

export function extractTaskAssetReferences(payload: unknown): WorkspaceAssetReference[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const urls = Array.isArray(record.imageUrls)
    ? record.imageUrls.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : typeof record.imageUrl === 'string' && record.imageUrl
      ? [record.imageUrl]
      : [];
  const projection = record.assetProjection && typeof record.assetProjection === 'object'
    ? record.assetProjection as Record<string, unknown>
    : null;
  const projectedReferences = Array.isArray(projection?.references)
    ? projection.references.flatMap((value): WorkspaceAssetReference[] => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const reference = value as Record<string, unknown>;
        if (
          typeof reference.url !== 'string'
          || !reference.url
          || typeof reference.assetVersionId !== 'string'
          || !reference.assetVersionId
          || typeof reference.placementId !== 'string'
          || !reference.placementId
        ) return [];
        return [{
          url: reference.url,
          assetVersionId: reference.assetVersionId,
          placementId: reference.placementId,
          ...(typeof reference.assetId === 'string' && reference.assetId
            ? { assetId: reference.assetId }
            : {}),
          ...(typeof reference.entityId === 'string' && reference.entityId
            ? { entityId: reference.entityId }
            : {}),
          ...(typeof reference.name === 'string' && reference.name
            ? { name: reference.name }
            : {}),
        }];
      })
    : [];
  if (projectedReferences.length > 0) return projectedReferences;
  const versionIds = Array.isArray(projection?.versionIds)
    ? projection.versionIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  if (urls.length !== versionIds.length) return [];
  return urls.map((url, index) => ({ url, assetVersionId: versionIds[index] }));
}

export function mergeWorkspaceAssetReferences(
  current: WorkspaceAssetReference[] | undefined,
  incoming: WorkspaceAssetReference[],
): WorkspaceAssetReference[] {
  const merged = new Map<string, WorkspaceAssetReference>();
  for (const reference of current || []) {
    if (reference.assetVersionId) merged.set(reference.assetVersionId, reference);
  }
  for (const reference of incoming) {
    if (reference.assetVersionId) merged.set(reference.assetVersionId, reference);
  }
  return [...merged.values()];
}

export function isWorkspaceResultScopeCurrent(
  expectedProjectId: string | undefined,
  currentProjectId: string | undefined,
): boolean {
  return Boolean(expectedProjectId) && expectedProjectId === currentProjectId;
}

export async function applyWorkspaceResultToCurrentProject<T>(options: {
  expectedProjectId: string;
  getCurrentProjectId: () => string | undefined;
  load: () => Promise<T>;
  apply: (result: T) => void | Promise<void>;
}): Promise<'applied' | 'stale'> {
  const result = await options.load();
  if (!isWorkspaceResultScopeCurrent(
    options.expectedProjectId,
    options.getCurrentProjectId(),
  )) return 'stale';
  await options.apply(result);
  return 'applied';
}

export function serializeCanvasAssetDragPayload(payload: CanvasAssetDragPayload): string {
  return JSON.stringify(payload);
}

export function parseCanvasAssetDragPayload(value: string): CanvasAssetDragPayload | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string' || typeof parsed.url !== 'string') {
      return null;
    }
    return {
      id: parsed.id,
      url: parsed.url,
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.projectId === 'string' ? { projectId: parsed.projectId } : {}),
      ...(typeof parsed.assetId === 'string' ? { assetId: parsed.assetId } : {}),
      ...(typeof parsed.assetVersionId === 'string' ? { assetVersionId: parsed.assetVersionId } : {}),
      ...(typeof parsed.placementId === 'string' ? { placementId: parsed.placementId } : {}),
      ...(typeof parsed.entityId === 'string' ? { entityId: parsed.entityId } : {}),
      ...(typeof parsed.versionId === 'string' ? { versionId: parsed.versionId } : {}),
      ...(typeof parsed.width === 'number' ? { width: parsed.width } : {}),
      ...(typeof parsed.height === 'number' ? { height: parsed.height } : {}),
    };
  } catch {
    return null;
  }
}

type CanvasChatAsset = {
  id: string;
  url: string;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
};

export async function prepareCanvasAssetForChat<TAsset extends CanvasChatAsset>(
  image: TAsset,
  transfer: (image: TAsset) => Promise<WorkspaceAssetReference>,
): Promise<TAsset> {
  const fallback = { ...image };
  delete fallback.assetId;
  delete fallback.assetVersionId;
  delete fallback.placementId;
  if (!image.assetVersionId) return fallback;

  try {
    const transferred = await transfer(image);
    if (
      transferred.assetVersionId !== image.assetVersionId
      || !transferred.placementId
    ) {
      return fallback;
    }
    return {
      ...image,
      url: transferred.url,
      assetId: transferred.assetId,
      assetVersionId: transferred.assetVersionId,
      placementId: transferred.placementId,
    };
  } catch {
    return fallback;
  }
}

type WorkflowInputCanvasAsset = {
  id: string;
  url: string;
  versionId?: string;
  assetVersionId?: string;
};

export interface PendingWorkflowInputReference {
  imageUrl: string;
  source: 'canvas';
  sourceImageId: string;
  sourceVersionId?: string;
  assetTransferPending: boolean;
}

export function createPendingWorkflowInputReference(
  image: WorkflowInputCanvasAsset,
): PendingWorkflowInputReference {
  return {
    imageUrl: image.url,
    source: 'canvas',
    sourceImageId: image.id,
    ...(image.versionId ? { sourceVersionId: image.versionId } : {}),
    assetTransferPending: Boolean(image.assetVersionId),
  };
}

export interface WorkflowInputTransferToken {
  nodeId: string;
  generation: number;
}

export interface WorkflowInputTransferGuard {
  begin: (nodeId: string) => WorkflowInputTransferToken;
  invalidate: (nodeId: string) => void;
  isCurrent: (token: WorkflowInputTransferToken) => boolean;
}

export function createWorkflowInputTransferGuard(): WorkflowInputTransferGuard {
  const generations = new Map<string, number>();
  const advance = (nodeId: string): number => {
    const generation = (generations.get(nodeId) || 0) + 1;
    generations.set(nodeId, generation);
    return generation;
  };
  return {
    begin: nodeId => ({ nodeId, generation: advance(nodeId) }),
    invalidate: nodeId => { advance(nodeId); },
    isCurrent: token => generations.get(token.nodeId) === token.generation,
  };
}

export function shouldInvalidateWorkflowInputTransfer(
  currentImageUrl: unknown,
  configUpdate: Record<string, unknown> | undefined,
): boolean {
  return Boolean(
    configUpdate
    && Object.prototype.hasOwnProperty.call(configUpdate, 'imageUrl')
    && configUpdate.imageUrl !== currentImageUrl,
  );
}

export async function runGuardedWorkflowInputTransfer(options: {
  guard: WorkflowInputTransferGuard;
  token: WorkflowInputTransferToken;
  transfer: () => Promise<WorkspaceAssetReference>;
  onSuccess: (reference: WorkspaceAssetReference) => void | Promise<void>;
  onFailure?: () => void | Promise<void>;
}): Promise<'applied' | 'failed' | 'stale'> {
  let reference: WorkspaceAssetReference;
  try {
    reference = await options.transfer();
  } catch {
    if (!options.guard.isCurrent(options.token)) return 'stale';
    await options.onFailure?.();
    return 'failed';
  }
  if (!options.guard.isCurrent(options.token)) return 'stale';
  await options.onSuccess(reference);
  return 'applied';
}

export interface WorkflowCanvasOutputCandidate {
  outputNodeId: string;
  url: string;
  managed: boolean;
  sourceReference?: WorkspaceAssetReference;
}

export interface WorkflowCanvasInsertionItem {
  outputNodeId: string;
  url: string;
  assetReference?: WorkspaceAssetReference;
}

export interface WorkflowCanvasInsertionResult {
  items: WorkflowCanvasInsertionItem[];
  failedOutputNodeIds: string[];
}

export function filterUniqueCanvasImageInsertions<
  T extends { id: string; placementId?: string },
>(existing: readonly T[], incoming: readonly T[]): T[] {
  const imageIds = new Set(existing.map(image => image.id));
  const placementIds = new Set(
    existing.flatMap(image => image.placementId ? [image.placementId] : []),
  );
  return incoming.filter(image => {
    if (imageIds.has(image.id)) return false;
    if (image.placementId && placementIds.has(image.placementId)) return false;
    imageIds.add(image.id);
    if (image.placementId) placementIds.add(image.placementId);
    return true;
  });
}

export async function prepareWorkflowCanvasInsertions(
  candidates: WorkflowCanvasOutputCandidate[],
  transfer: (
    reference: WorkspaceAssetReference,
    candidate: WorkflowCanvasOutputCandidate,
  ) => Promise<WorkspaceAssetReference>,
): Promise<WorkflowCanvasInsertionResult> {
  const result: WorkflowCanvasInsertionResult = {
    items: [],
    failedOutputNodeIds: [],
  };

  for (const candidate of candidates) {
    if (!candidate.managed) {
      result.items.push({
        outputNodeId: candidate.outputNodeId,
        url: candidate.url,
      });
      continue;
    }
    if (!candidate.sourceReference?.assetVersionId) {
      result.failedOutputNodeIds.push(candidate.outputNodeId);
      continue;
    }
    try {
      const transferred = await transfer(candidate.sourceReference, candidate);
      if (!transferred.assetVersionId || !transferred.placementId) {
        result.failedOutputNodeIds.push(candidate.outputNodeId);
        continue;
      }
      result.items.push({
        outputNodeId: candidate.outputNodeId,
        url: transferred.url,
        assetReference: transferred,
      });
    } catch {
      result.failedOutputNodeIds.push(candidate.outputNodeId);
    }
  }

  return result;
}

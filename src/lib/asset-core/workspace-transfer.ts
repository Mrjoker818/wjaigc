import type { WorkspaceAssetReference } from './types';

export const CANVAS_ASSET_DRAG_MIME = 'application/x-wujie-canvas-asset+json';

export interface CanvasAssetDragPayload extends WorkspaceAssetReference {
  id: string;
  projectId?: string;
  width?: number;
  height?: number;
  versionId?: string;
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

export interface WorkflowCanvasOutputCandidate {
  outputNodeId: string;
  url: string;
  managed: boolean;
  sourceReference?: WorkspaceAssetReference;
}

export interface WorkflowCanvasInsertionResult {
  urls: string[];
  assetReferences: WorkspaceAssetReference[];
  failedOutputNodeIds: string[];
}

export async function prepareWorkflowCanvasInsertions(
  candidates: WorkflowCanvasOutputCandidate[],
  transfer: (
    reference: WorkspaceAssetReference,
    candidate: WorkflowCanvasOutputCandidate,
  ) => Promise<WorkspaceAssetReference>,
): Promise<WorkflowCanvasInsertionResult> {
  const result: WorkflowCanvasInsertionResult = {
    urls: [],
    assetReferences: [],
    failedOutputNodeIds: [],
  };

  for (const candidate of candidates) {
    if (!candidate.managed) {
      result.urls.push(candidate.url);
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
      result.urls.push(transferred.url);
      result.assetReferences.push(transferred);
    } catch {
      result.failedOutputNodeIds.push(candidate.outputNodeId);
    }
  }

  return result;
}

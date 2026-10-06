export interface CanvasUpscaleSourceInput {
  projectId?: string;
  documentMetadataMode: boolean;
  assetVersionId?: string;
}

export type CanvasUpscaleSource =
  | { kind: 'ready'; fields: { projectId?: string; assetParentVersionIds?: [string] } }
  | { kind: 'project-required' }
  | { kind: 'invalid-source' }
  | { kind: 'import-required' };

export function resolveCanvasUpscaleSource(input: CanvasUpscaleSourceInput): CanvasUpscaleSource {
  const projectId = input.documentMetadataMode ? input.projectId : input.projectId?.trim();
  const assetVersionId = input.assetVersionId;
  if (input.documentMetadataMode) {
    if (!projectId?.trim() || projectId !== projectId.trim()) return { kind: 'project-required' };
    if (!assetVersionId?.trim()) return { kind: 'import-required' };
    if (assetVersionId !== assetVersionId.trim()) return { kind: 'invalid-source' };
  }
  if (!projectId) return { kind: 'ready', fields: {} };
  return { kind: 'ready', fields: {
    projectId,
    ...(assetVersionId ? { assetParentVersionIds: [assetVersionId] as [string] } : {}),
  } };
}

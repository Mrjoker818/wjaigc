import 'server-only';
import type { GenerationProjectAccess } from './collaboration/generation-project-access';
import { isDeepStrictEqual } from 'node:util';
import { getPool } from './db-client';
import { CanvasOrdinaryAdmissionError, parseCanvasOrdinaryPublication } from './collaboration/canvas-ordinary-generation-admission';
import { readOrdinaryPublicationSourceSnapshot, type CanvasTaskPublicationInput } from './collaboration/task-publication';
import { parseCanvasPublicationIntentProposal } from './collaboration/task-publication-intent';
import { readCollaborativeProject } from './collaboration/document-project-bridge';
import { resolveDocumentWorkspaceReference } from './collaboration/document-workspace-reference';

/** Video-only adaptation; ordinary image admission and its source policy stay unchanged. */
export async function prepareVideoCanvasPublication(access: GenerationProjectAccess,
  body: Record<string, unknown>, origin: string, type: 'video' | 'video-extend'): Promise<CanvasTaskPublicationInput | undefined> {
  if (access.kind !== 'document') return undefined;
  if (body.assetWorkspace !== 'canvas' || body.assetProjectionMode && body.assetProjectionMode !== 'derived') {
    throw new CanvasOrdinaryAdmissionError(400, 'CANVAS_VIDEO_INVALID');
  }
  const scalar = [body.imageUrl, body.lastFrameImageUrl, body.videoUrl];
  const arrays = [body.referenceImages, body.characterReferences];
  if (scalar.some(value => value !== undefined && (typeof value !== 'string' || !value.trim()))
    || arrays.some(value => value !== undefined && (!Array.isArray(value)
      || value.some(item => typeof item !== 'string' || !item.trim())))) {
    throw new CanvasOrdinaryAdmissionError(400, 'CANVAS_VIDEO_INVALID');
  }
  const references = [...scalar.filter((value): value is string => typeof value === 'string'),
    ...arrays.flatMap(value => Array.isArray(value) ? value as string[] : [])];
  const sourceBody = { ...body, referenceImages: [...new Set(references)] };
  const publication: CanvasTaskPublicationInput = {
    ...parseCanvasOrdinaryPublication(access, sourceBody), singleAdmission: type,
  };
  const proposal = parseCanvasPublicationIntentProposal(publication.intent);
  const urls = sourceBody.referenceImages;
  const identity = (url: string): string => {
    const parsed = new URL(url, origin);
    if (url.trim() !== url || url.includes('\\') || url.startsWith('//') || parsed.origin !== new URL(origin).origin
      || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_VIDEO_SOURCE_MISMATCH');
    }
    return parsed.href;
  };
  const before = await readOrdinaryPublicationSourceSnapshot(getPool(), access.ownerId, access.projectId, proposal.parentVersionIds, false);
  if (urls.length) {
    const read = await readCollaborativeProject(access.actorUserId, access.projectId);
    if (read.ownerId !== access.ownerId || read.projectId !== access.projectId || read.readOnly) {
      throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_VIDEO_SOURCE_FORBIDDEN');
    }
    for (let index = 0; index < proposal.parentVersionIds.length; index++) {
      const versionId = proposal.parentVersionIds[index];
      const matches = read.canvasImages.filter(image => image.assetVersionId === versionId
        && proposal.placement.action === 'append' && proposal.placement.selectedEntityIds.includes(image.id));
      if (matches.length !== 1 || !matches[0].placementId) throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_VIDEO_SOURCE_MISMATCH');
      const reference = await resolveDocumentWorkspaceReference(access.actorUserId, {
        projectId: access.projectId, assetVersionId: versionId, placementId: matches[0].placementId,
      });
      if (!reference || typeof reference.kind !== 'string' || !['image', 'video'].includes(reference.kind) || reference.entityId !== matches[0].id
        || reference.assetId !== matches[0].assetId || reference.assetVersionId !== versionId
        || reference.placementId !== matches[0].placementId || identity(reference.url) !== identity(urls[index])) {
        throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_VIDEO_SOURCE_MISMATCH');
      }
    }
  }
  const after = await readOrdinaryPublicationSourceSnapshot(getPool(), access.ownerId, access.projectId, proposal.parentVersionIds, false);
  if (!isDeepStrictEqual(before, after)) throw new CanvasOrdinaryAdmissionError(403, 'CANVAS_VIDEO_SOURCE_MISMATCH');
  publication.ordinarySourceSnapshot = before;
  return publication;
}

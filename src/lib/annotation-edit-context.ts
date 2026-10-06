import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import type { PersistedCloudTask } from './cloud-task-storage';
import { assertAnnotationSourceUnchanged, AnnotationSourceAdmissionError, type AuthorizedAnnotationSource } from './annotation-authorized-source';
import { loadSafeImageInput, safeSharp } from './safe-image-input';
import { buildCanonicalAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import { DocumentAccessError } from './collaboration/document-access';
import { resolveDocumentImageEditSourceLocked, ImageEditSourceAdmissionError } from './collaboration/image-edit-source-admission';
import type { GenerationProjectAccess } from './collaboration/generation-project-access';

export class AnnotationEditContextError extends Error {
  readonly status = 400;
  readonly code = 'ANNOTATION_EDIT_CONTEXT_INVALID';
  constructor() { super('批注修图内部来源或编译产物无效'); this.name = 'AnnotationEditContextError'; }
}

export interface TrustedAnnotationEdit {
  source: AuthorizedAnnotationSource;
  referenceImage: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function identifier(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/\p{Cc}/u.test(value);
}
function invalid(): never { throw new AnnotationEditContextError(); }

/** Only authenticated server-to-server requests may carry compiled artifacts. No free/billing bypass. */
export function parseTrustedAnnotationEdit(body: Record<string, unknown>, authenticationSource: string,
  actorUserId: string): TrustedAnnotationEdit | undefined {
  if (!Object.hasOwn(body, '_annotationSource') && !Object.hasOwn(body, '_annotationReferenceImage')) return undefined;
  if (authenticationSource !== 'internal') return invalid();
  const source = record(body._annotationSource);
  const referenceImage = body._annotationReferenceImage;
  if (!source || !identifier(source.actorUserId) || source.actorUserId !== actorUserId
    || !identifier(source.projectId) || source.projectId !== body.projectId
    || !identifier(source.imageId, 128) || !identifier(source.versionId, 96)
    || !identifier(source.imageUrl, 8192) || body.image !== source.imageUrl
    || Object.keys(source).some(key => !['actorUserId', 'projectId', 'imageId', 'imageUrl', 'versionId',
      'access', 'assetId', 'assetVersionId', 'placementId'].includes(key))
    || typeof referenceImage !== 'string' || referenceImage.length > 35 * 1024 * 1024
    || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(referenceImage)
    || body._skipCredits !== undefined || body._skipCloudTaskPersistence !== undefined
    || body.count !== 1 || !Array.isArray(body.referenceImages) || body.referenceImages.length !== 0) return invalid();
  const access = source.access === undefined ? undefined : record(source.access);
  if (source.access !== undefined && (!access || !['personal', 'document'].includes(String(access.kind))
    || access.actorUserId !== actorUserId || access.projectId !== source.projectId || !identifier(access.ownerId)
    || Object.keys(access).some(key => !['kind', 'actorUserId', 'ownerId', 'projectId', 'grantGeneration'].includes(key)))) return invalid();
  if (access?.kind === 'document') {
    if (!identifier(access.grantGeneration, 19) || !/^(0|[1-9][0-9]*)$/.test(access.grantGeneration)
      || BigInt(access.grantGeneration) > BigInt('9223372036854775807')
      || !identifier(source.assetId, 128) || !identifier(source.assetVersionId, 128) || !identifier(source.placementId, 128)
      || source.versionId !== buildCanonicalAnnotationSourceVersionId(source.imageId, source.assetVersionId)
      || body.assetWorkspace !== 'canvas' || body.assetWorkspaceId !== source.projectId
      || !isDeepStrictEqual(body.assetParentVersionIds, [source.assetVersionId])
      || !isDeepStrictEqual(body.assetSelectedEntityIds, [source.imageId])
      || body.assetSourcePlacementId !== source.placementId || body.sourceEntityId !== source.imageId) return invalid();
  } else if (source.assetId !== undefined || source.assetVersionId !== undefined || source.placementId !== undefined
    || access?.grantGeneration !== undefined) return invalid();
  // Source was type/shape checked above, then copied before any asynchronous admission.
  return { source: structuredClone(source) as unknown as AuthorizedAnnotationSource, referenceImage };
}

/** CPU-bounded, no file/remote I/O. Validate the PNG before a task or charge exists. */
export async function validateCompiledAnnotationReference(referenceImage: string, signal?: AbortSignal): Promise<void> {
  try {
    const decoded = await loadSafeImageInput(referenceImage, { maxBytes: 25 * 1024 * 1024,
      maxPixels: 2048 * 2048, signal });
    if (decoded.mimeType !== 'image/png') return invalid();
    // metadata alone is not a full PNG pixel decode.
    await safeSharp(decoded.buffer, { maxPixels: 2048 * 2048, signal }).png().toBuffer();
    signal?.throwIfAborted();
  } catch { return invalid(); }
}

export async function validateAnnotationEditSource(edit: TrustedAnnotationEdit): Promise<void> {
  await assertAnnotationSourceUnchanged(edit.source);
}

/** Persist opaque original identity, not source URLs, compiled bytes, or caller-supplied capabilities. */
export function privateAnnotationSourceIdentity(source: AuthorizedAnnotationSource,
  requestDigest: string): { version: 1; sourceDigest: string; requestDigest: string } {
  const access = source.access;
  const tuple = [source.actorUserId, source.projectId, source.imageId, source.imageUrl, source.versionId,
    access?.kind, access?.actorUserId, access?.ownerId, access?.projectId,
    access?.kind === 'document' ? access.grantGeneration : null,
    source.assetId, source.assetVersionId, source.placementId];
  return { version: 1, sourceDigest: createHash('sha256').update(JSON.stringify(tuple)).digest('hex'), requestDigest };
}

export function assertPrivateAnnotationTaskIdentity(task: PersistedCloudTask | null, taskId: string,
  source: AuthorizedAnnotationSource, requestDigest: string): void {
  if (!task || task.id !== taskId || task.type !== 'edit' || task.userId !== source.actorUserId
    || task.projectId !== source.projectId || task.requestDigest !== requestDigest
    || !isDeepStrictEqual(task.result?.annotationSourceIdentity, privateAnnotationSourceIdentity(source, requestDigest))) {
    throw new AnnotationSourceAdmissionError(409);
  }
}

/** Repeat the exact entity/placement/version/grant tuple in the existing billing transaction. */
export async function assertAnnotationDocumentSourceLocked(client: PoolClient,
  source: AuthorizedAnnotationSource, access: Extract<GenerationProjectAccess, { kind: 'document' }>): Promise<void> {
  if (!isDeepStrictEqual(source.access, access) || source.actorUserId !== access.actorUserId
    || source.projectId !== access.projectId || !source.assetVersionId || !source.assetId || !source.placementId
    || source.versionId !== buildCanonicalAnnotationSourceVersionId(source.imageId, source.assetVersionId)) throw new DocumentAccessError();
  try {
    await resolveDocumentImageEditSourceLocked(client, { access, parentVersionIds: [source.assetVersionId],
      imageUrl: source.imageUrl, expectedCanonicalUrl: source.imageUrl, expectedPlacementId: source.placementId,
      origin: new URL(source.imageUrl, 'http://localhost').origin });
    const placement = await client.query(`SELECT 1 FROM wujie_workspace_placements
      WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND entity_id=$4 AND asset_id=$5
        AND asset_version_id=$6 AND status='active' AND deleted_at IS NULL FOR SHARE`,
    [source.placementId, access.ownerId, access.projectId, source.imageId, source.assetId, source.assetVersionId]);
    if (placement.rowCount !== 1) throw new DocumentAccessError();
  } catch (error) {
    if (error instanceof ImageEditSourceAdmissionError && error.status !== 503) throw new DocumentAccessError();
    throw error;
  }
}

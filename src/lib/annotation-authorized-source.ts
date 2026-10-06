import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { buildCanonicalAnnotationSourceVersionId, buildAnnotationSourceVersionId } from '@/features/annotations/annotation-source-version';
import { findOwnedAnnotationSource, type OwnedAnnotationSource } from '@/lib/annotation-project-source';
import { getPool, isDatabaseConfigured } from '@/lib/db-client';
import { validateCanvasDocumentProjection } from '@/lib/collaboration/canvas-document';
import { GenerationProjectAccessError, readGenerationProjectAccess, type GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { PROJECT_REVISION_DATA_KEY } from '@/lib/asset-core/canvas-project-sync';

export interface AuthorizedAnnotationSource extends OwnedAnnotationSource {
  actorUserId: string;
  access?: Exclude<GenerationProjectAccess, { kind: 'unscoped' }>;
  assetId?: string;
  assetVersionId?: string;
  placementId?: string;
}

export class AnnotationSourceAdmissionError extends Error {
  constructor(readonly status: 404 | 409 | 503) {
    super(status === 503 ? '批注来源验证暂不可用，请稍后重试'
      : status === 409 ? '来源版本或项目授权已变化，请重新确认批注' : '项目或来源图片不存在');
    this.name = 'AnnotationSourceAdmissionError';
  }
  get code(): string {
    return this.status === 503 ? 'ANNOTATION_SOURCE_UNAVAILABLE'
      : this.status === 409 ? 'ANNOTATION_SOURCE_STALE' : 'ANNOTATION_PROJECT_NOT_FOUND';
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function projects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') {
    try { return projects(JSON.parse(value) as unknown); } catch { return []; }
  }
  return Array.isArray(value) ? value.map(record).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
}

async function privateSource(client: PoolClient, actorUserId: string, projectId: string,
  imageId: string, locked = false): Promise<OwnedAnnotationSource | null> {
  const data = await client.query<{ data_value: unknown }>(
    "SELECT data_value FROM wujie_user_data WHERE user_id=$1 AND data_key='projects'"
      + (locked ? ' FOR SHARE' : ''), [actorUserId]);
  const matching = projects(data.rows[0]?.data_value).filter(project => project.id === projectId
    && (!project.userId || project.userId === actorUserId) && (!project.status || project.status === 'active'));
  if (matching.length !== 1) return null;
  const project = matching[0];
  const images = Array.isArray(project.canvasImages) ? project.canvasImages : project.images;
  const matchingImages = (Array.isArray(images) ? images : []).map(record)
    .filter(image => image?.id === imageId);
  if (matchingImages.length !== 1) return null;
  const image = matchingImages[0]!;
  if (image.mediaType === 'video' || image.videoUrl) return null;
  const imageUrl = String(image.url || image.sourceUrl || '').trim();
  if (!imageUrl) return null;
  return { projectId, imageId, imageUrl,
    versionId: typeof image.annotationVersionId === 'string' && image.annotationVersionId.trim()
      ? image.annotationVersionId.trim() : buildAnnotationSourceVersionId(imageId,
        typeof image.createdAt === 'number' ? image.createdAt : undefined, imageUrl) };
}

/** Only server reads mint a source. A configured but failed PG never falls back to private files. */
export async function findAuthorizedAnnotationSource(actorUserId: string, projectId: string,
  imageId: string): Promise<AuthorizedAnnotationSource | null> {
  if (!actorUserId || !projectId || !imageId || projectId.length > 256 || imageId.length > 128
    || projectId.trim() !== projectId || imageId.trim() !== imageId || /\p{Cc}/u.test(projectId + imageId)) return null;
  if (!isDatabaseConfigured()) {
    const source = await findOwnedAnnotationSource(actorUserId, projectId, imageId);
    return source ? { ...source, actorUserId } : null;
  }
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const access = await readGenerationProjectAccess(client, actorUserId, projectId);
    if (access.kind === 'unscoped') throw new AnnotationSourceAdmissionError(404);
    let source: AuthorizedAnnotationSource | null = null;
    if (access.kind === 'personal') {
      const legacy = await privateSource(client, actorUserId, projectId, imageId);
      source = legacy ? { ...legacy, actorUserId, access } : null;
    } else {
      const document = await client.query<{ projection: unknown }>(
        'SELECT projection FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2',
        [projectId, access.ownerId]);
      let projection: ReturnType<typeof validateCanvasDocumentProjection>;
      try { projection = validateCanvasDocumentProjection(document.rows[0]?.projection); }
      catch { throw new AnnotationSourceAdmissionError(503); }
      const rows = await client.query<{ placement_id: string; asset_id: string; asset_version_id: string; file_url: string }>(
        `SELECT p.id AS placement_id,p.asset_id,p.asset_version_id,v.file_url
         FROM wujie_workspace_placements p JOIN wujie_asset_versions v
           ON v.id=p.asset_version_id AND v.asset_id=p.asset_id AND v.owner_id=p.owner_id AND v.project_id=p.project_id
         JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
         WHERE p.owner_id=$1 AND p.project_id=$2 AND p.entity_id=$3
           AND p.workspace_kind='canvas' AND p.workspace_id IN ($2,'canvas:' || $2)
           AND p.entity_type='canvas-image' AND p.status='active' AND p.deleted_at IS NULL
           AND a.kind='image' AND a.status='active' AND v.availability='ready'
           AND (v.mime_type IS NULL OR v.mime_type IN ('image/png','image/jpeg','image/webp','image/gif','image/avif','image/heic','image/heif'))`,
        [access.ownerId, projectId, imageId]);
      // Ambiguous aliases or inconsistent SQL/document state fail closed, never pick a client URL.
      if (rows.rows.length === 1) {
        const row = rows.rows[0];
        const placement = projection.placements[row.placement_id];
        if (placement && !placement.deleted && placement.assetVersionId === row.asset_version_id && row.file_url) {
          source = { actorUserId, access, projectId, imageId, imageUrl: row.file_url,
            versionId: buildCanonicalAnnotationSourceVersionId(imageId, row.asset_version_id),
            assetId: row.asset_id, assetVersionId: row.asset_version_id, placementId: row.placement_id };
        }
      }
    }
    await client.query('COMMIT');
    return source;
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    if (error instanceof AnnotationSourceAdmissionError && !discard) throw error;
    if (error instanceof GenerationProjectAccessError && error.status !== 503 && !discard) return null;
    throw new AnnotationSourceAdmissionError(503);
  } finally { client?.release(discard); }
}

/** Point-in-time revalidation, not a durable publication capability. No remote I/O under these reads. */
export async function assertAnnotationSourceUnchanged(source: AuthorizedAnnotationSource): Promise<void> {
  const current = await findAuthorizedAnnotationSource(source.actorUserId, source.projectId, source.imageId);
  if (!current) throw new AnnotationSourceAdmissionError(404);
  if (!isDeepStrictEqual(current, source)) throw new AnnotationSourceAdmissionError(409);
}

/** Private admission on the caller's billing transaction; never owns a connection or remote I/O. */
export async function assertPrivateAnnotationSourceLocked(client: PoolClient,
  source: AuthorizedAnnotationSource): Promise<void> {
  if (source.access?.kind !== 'personal' || source.access.actorUserId !== source.actorUserId
    || source.access.ownerId !== source.actorUserId || source.access.projectId !== source.projectId) {
    throw new AnnotationSourceAdmissionError(409);
  }
  try {
    // Same serialization/row order as private project persistence and document activation.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [source.actorUserId, PROJECT_REVISION_DATA_KEY]);
    const actor = await client.query("SELECT 1 FROM wujie_users WHERE id=$1 AND status='active' FOR SHARE",
      [source.actorUserId]);
    if (actor.rowCount !== 1) throw new AnnotationSourceAdmissionError(404);
    const original = await privateSource(client, source.actorUserId, source.projectId, source.imageId, true);
    if (!original) throw new AnnotationSourceAdmissionError(404);
    await client.query('SELECT id FROM wujie_projects WHERE id=$1 FOR SHARE', [source.projectId]);
    const access = await readGenerationProjectAccess(client, source.actorUserId, source.projectId);
    const current = { ...original, actorUserId: source.actorUserId, access };
    if (!isDeepStrictEqual(current, source)) throw new AnnotationSourceAdmissionError(409);
  } catch (error) {
    if (error instanceof AnnotationSourceAdmissionError) throw error;
    if (error instanceof GenerationProjectAccessError && error.status !== 503) {
      throw new AnnotationSourceAdmissionError(404);
    }
    throw new AnnotationSourceAdmissionError(503);
  }
}

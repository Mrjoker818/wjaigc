import 'server-only';
import type { PoolClient } from 'pg';
import { AgentContextNotFoundError, authorizeAgentContext, resolveAgentMediaUrls } from '@/lib/agent-runtime/context-adapters';
import { completeCloudTask, ensureCloudTaskTables, getCloudTaskForUser } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import { readPrivateInpaintDocumentSource, type PrivateInpaintInputIdentity } from '@/lib/task-core/inpaint-private-inputs';
import { validateCanvasDocumentProjection } from './canvas-document';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError,
  DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from './document-access';
import { GenerationProjectAccessError, type GenerationProjectAccess } from './generation-project-access';

export class ImageEditSourceAdmissionError extends Error {
  constructor(readonly status: 400 | 403 | 503, readonly code: string) {
    super(status === 503 ? '图片来源验证暂不可用，请稍后重试' : '图片来源与项目资产版本不匹配');
    this.name = 'ImageEditSourceAdmissionError';
  }
}

export class ImageEditCompletionUnknownError extends Error {
  readonly code = 'IMAGE_EDIT_COMPLETION_UNKNOWN';
  constructor() {
    super('图片编辑完成提交状态待核对');
    this.name = 'ImageEditCompletionUnknownError';
  }
}

function managedMediaIdentity(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || value.includes('\\') || value.startsWith('//')) {
    throw new ImageEditSourceAdmissionError(400, 'IMAGE_EDIT_SOURCE_INVALID');
  }
  let url: URL;
  try { url = new URL(value, origin); }
  catch { throw new ImageEditSourceAdmissionError(400, 'IMAGE_EDIT_SOURCE_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin
    || url.username || url.password || url.hash) {
    throw new ImageEditSourceAdmissionError(403, 'IMAGE_EDIT_SOURCE_MISMATCH');
  }
  return url.href;
}

/** A short point-in-time source check; the durable executor must repeat it before execution and publication. */
export async function authorizeDocumentImageEditSource(input: {
  access: GenerationProjectAccess;
  action: string;
  parentVersionIds: unknown;
  imageUrl: unknown;
  origin: string;
}): Promise<string> {
  const { access, action, parentVersionIds, imageUrl, origin } = input;
  if (access.kind !== 'document' || !['upscale', 'removebg', 'remove_background'].includes(action)) {
    return imageUrl as string;
  }
  if (!Array.isArray(parentVersionIds) || parentVersionIds.length !== 1
    || typeof parentVersionIds[0] !== 'string' || !parentVersionIds[0]) {
    throw new ImageEditSourceAdmissionError(400, 'IMAGE_EDIT_SOURCE_INVALID');
  }
  try {
    const context = await authorizeAgentContext({ actorUserId: access.actorUserId, request: {
      projectId: access.projectId, workspace: 'canvas', workspaceId: access.projectId,
      mode: 'agent', executionRuntime: 'local', prompt: '', allowedToolIds: [],
      idempotencyKey: 'image-edit-source-read', sourceVersionIds: parentVersionIds,
      context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
    } });
    if (context.projectAccess?.ownerId !== access.ownerId
      || context.projectAccess.actorUserId !== access.actorUserId
      || context.projectAccess.grantGeneration !== access.grantGeneration) {
      throw new AgentContextNotFoundError();
    }
    const expected = managedMediaIdentity(resolveAgentMediaUrls(context, parentVersionIds)[0], origin);
    if (managedMediaIdentity(imageUrl, origin) !== expected) {
      throw new ImageEditSourceAdmissionError(403, 'IMAGE_EDIT_SOURCE_MISMATCH');
    }
    const canonical = new URL(expected);
    return `${canonical.pathname}${canonical.search}`;
  } catch (error) {
    if (error instanceof ImageEditSourceAdmissionError) throw error;
    if (error instanceof AgentContextNotFoundError
      || (error instanceof GenerationProjectAccessError && error.status !== 503)) {
      throw new ImageEditSourceAdmissionError(403, 'IMAGE_EDIT_SOURCE_FORBIDDEN');
    }
    throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE');
  }
}

type DocumentSourceInput = {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  parentVersionIds: unknown;
  imageUrl: unknown;
  origin: string;
  expectedCanonicalUrl: string;
  expectedPlacementId?: string;
};

/** The task row is locked by the caller first. Every mutable source/permission row
 * remains SHARE-locked until the checkpoint or terminal update commits. */
export async function resolveDocumentImageEditSourceLocked(
  client: PoolClient, input: DocumentSourceInput,
): Promise<{ placementId: string; canonicalUrl: string }> {
  const { access, parentVersionIds, imageUrl, origin, expectedCanonicalUrl, expectedPlacementId } = input;
  if (!Array.isArray(parentVersionIds) || parentVersionIds.length !== 1
    || typeof parentVersionIds[0] !== 'string' || !parentVersionIds[0]) {
    throw new ImageEditSourceAdmissionError(400, 'IMAGE_EDIT_SOURCE_INVALID');
  }
  try {
    const { ownerId } = await assertDocumentEditor(access.actorUserId, access.projectId,
      client, access.grantGeneration);
    if (ownerId !== access.ownerId) throw new DocumentAccessError();
    await assertDocumentProjectEnabled(client, ownerId, access.projectId);
    const document = await client.query<{ projection: unknown }>(
      `SELECT projection FROM wujie_project_canvas_documents
       WHERE project_id=$1 AND owner_id=$2 FOR SHARE`, [access.projectId, ownerId]);
    let projection: ReturnType<typeof validateCanvasDocumentProjection>;
    try { projection = validateCanvasDocumentProjection(document.rows[0]?.projection); }
    catch { throw new AgentContextNotFoundError(); }
    const source = await client.query<{
      asset_id: string; file_url: string; mime_type: string | null; availability: string;
      kind: string; asset_status: string;
    }>(`SELECT v.asset_id,v.file_url,v.mime_type,v.availability,a.kind,a.status AS asset_status
       FROM wujie_asset_versions v JOIN wujie_assets a
         ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
       WHERE v.id=$1 AND v.owner_id=$2 AND v.project_id=$3 FOR SHARE OF v,a`,
    [parentVersionIds[0], ownerId, access.projectId]);
    const version = source.rows[0];
    const mime = version?.mime_type?.trim().toLowerCase();
    if (!version || version.kind !== 'image' || version.asset_status !== 'active'
      || version.availability !== 'ready'
      || (mime && !new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'image/avif', 'image/heic', 'image/heif']).has(mime))) {
      throw new AgentContextNotFoundError();
    }
    const placements = await client.query<{ id: string; asset_version_id: string }>(
      `SELECT id,asset_version_id FROM wujie_workspace_placements
       WHERE owner_id=$1 AND project_id=$2 AND asset_id=$3 AND asset_version_id=$4
         AND workspace_kind='canvas' AND workspace_id IN ($2,'canvas:' || $2)
         AND entity_type='canvas-image' AND status='active' AND deleted_at IS NULL
       ORDER BY id FOR SHARE`,
      [ownerId, access.projectId, version.asset_id, parentVersionIds[0]]);
    const placement = placements.rows.find(placement => {
      const canonical = projection.placements[placement.id];
      return (!expectedPlacementId || placement.id === expectedPlacementId)
        && canonical && !canonical.deleted && canonical.assetVersionId === placement.asset_version_id;
    });
    if (!placement) throw new AgentContextNotFoundError();
    const expected = managedMediaIdentity(version.file_url, origin);
    if (managedMediaIdentity(imageUrl, origin) !== expected
      || managedMediaIdentity(expectedCanonicalUrl, origin) !== expected) {
      throw new ImageEditSourceAdmissionError(403, 'IMAGE_EDIT_SOURCE_MISMATCH');
    }
    return { placementId: placement.id, canonicalUrl: version.file_url };
  } catch (error) {
    if (error instanceof ImageEditSourceAdmissionError) throw error;
    if (error instanceof DocumentAccessError || error instanceof DocumentProjectNotEnabledError
      || error instanceof DocumentFeatureDisabledError || error instanceof AgentContextNotFoundError) {
      throw new ImageEditSourceAdmissionError(403, 'IMAGE_EDIT_SOURCE_FORBIDDEN');
    }
    throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE');
  }
}

export async function authorizeDocumentImageEditSourceLocked(
  client: PoolClient, input: DocumentSourceInput,
): Promise<void> {
  await resolveDocumentImageEditSourceLocked(client, input);
}

/** Replay is a read, not a new charge, but it must still use the frozen source. */
export async function authorizeDocumentImageEditSourceNow(input: DocumentSourceInput): Promise<void> {
  const client = await getPool().connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await authorizeDocumentImageEditSourceLocked(client, input);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

/** Rebuild a document source only from the charged task's private snapshot. */
export async function completeDocumentInpaintTask(input: {
  identity: PrivateInpaintInputIdentity;
  result: Record<string, unknown>;
  leaseOwner: string;
  leaseExpiresAt: number;
  leaseAttemptCount: number;
}): Promise<boolean> {
  const source = await readPrivateInpaintDocumentSource(input.identity);
  if (!source) throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE');
  return completeDocumentImageEditTask({ taskId: input.identity.taskId, result: input.result,
    access: { kind: 'document', actorUserId: input.identity.userId,
      projectId: input.identity.projectId, ownerId: source.ownerId,
      grantGeneration: source.grantGeneration },
    parentVersionIds: [source.sourceVersionId], imageUrl: source.canonicalUrl,
    expectedCanonicalUrl: source.canonicalUrl, expectedPlacementId: source.sourcePlacementId,
    origin: source.origin, leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseExpiresAt,
    leaseAttemptCount: input.leaseAttemptCount });
}

/** Locks task first, then source, and commits both permission decision and terminal result. */
export async function completeDocumentImageEditTask(input: DocumentSourceInput & {
  taskId: string;
  result: Record<string, unknown>;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  leaseAttemptCount?: number;
}): Promise<boolean> {
  await ensureCloudTaskTables();
  const client = await getPool().connect();
  let discard = false;
  let commitIssued = false;
  try {
    await client.query('BEGIN');
    const task = await client.query<{ id: string }>('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [input.taskId]);
    if (task.rowCount !== 1) {
      await client.query('COMMIT');
      return false;
    }
    await authorizeDocumentImageEditSourceLocked(client, input);
    const completed = await completeCloudTask(input.taskId, input.result, { client,
      leaseOwner: input.leaseOwner, deadlineAt: input.leaseExpiresAt,
      leaseAttemptCount: input.leaseAttemptCount });
    commitIssued = true;
    await client.query('COMMIT');
    return completed;
  } catch (error) {
    if (!commitIssued) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    }
    // COMMIT may have reached PostgreSQL even if its response was lost. Never
    // refund or fall back until durable task state proves the outcome.
    discard = true;
  } finally { client.release(discard); }
  try {
    const task = await getCloudTaskForUser(input.taskId, input.access.actorUserId);
    if (task?.status === 'completed' && task.result && task.result.imageUrl === input.result.imageUrl
      && task.result.action === input.result.action
      && task.result.providerId === input.result.providerId
      && task.result.model === input.result.model) return true;
  } catch { /* A failed reconciliation is still unknown, never a safe failure. */ }
  throw new ImageEditCompletionUnknownError();
}

/** Only deployment configuration may name the public host sent to a remote image provider. */
export function documentImageEditProviderUrl(localUrl: string, configuredDomain: string | undefined): string {
  if (!configuredDomain || !localUrl.startsWith('/api/serve-upload/') || localUrl.includes('\\')) {
    throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE');
  }
  let media: URL;
  try { media = new URL(localUrl, 'https://local.invalid'); }
  catch { throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE'); }
  if (media.origin !== 'https://local.invalid' || media.hash
    || !/^\/api\/serve-upload\/[A-Za-z0-9._/-]+$/.test(media.pathname)) {
    throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE');
  }
  let base: URL;
  try { base = new URL(configuredDomain.includes('://') ? configuredDomain : `https://${configuredDomain}`); }
  catch { throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new ImageEditSourceAdmissionError(503, 'IMAGE_EDIT_SOURCE_UNAVAILABLE');
  }
  return new URL(`${media.pathname}${media.search}`, base).href;
}

import 'server-only';
import type { GenerationProjectAccess } from './collaboration/generation-project-access';
import type { PoolClient } from 'pg';
import { completeCloudTask, ensureCloudTaskTables, getCloudTaskById, terminateCloudTaskAndRefund,
  type CompleteCloudTaskOptions } from './cloud-task-storage';
import { isDeepStrictEqual } from 'node:util';
import { getPool } from './db-client';
import { CanvasOrdinaryAdmissionError, parseCanvasOrdinaryPublication } from './collaboration/canvas-ordinary-generation-admission';
import { readOrdinaryPublicationSourceSnapshot, type CanvasTaskPublicationInput } from './collaboration/task-publication';
import { CanvasPublicationIntentError, parseCanvasPublicationIntentProposal, validateCanvasBatchSources,
  type CanvasTaskPublicationIntent } from './collaboration/task-publication-intent';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError,
  DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from './collaboration/document-access';
import { readTaskPublicationAccess, readTaskPublicationIntent, type TaskPublicationAccess } from './collaboration/task-publication-access';
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

export class VideoCompletionUnknownError extends Error {
  constructor() { super('视频完成提交状态待核对'); this.name = 'VideoCompletionUnknownError'; }
}
interface VideoPublicationTask {
  id: string; user_id: string; project_id: string; type: string; status: string;
  result: Record<string, unknown>; lease_owner: string; attempt_count: number; deadline_valid: boolean;
}
const deniedReason = 'CANVAS_VIDEO_COMPLETION_FORBIDDEN';

/** Repeat the immutable admission tuple and source fingerprints. No media I/O under these locks. */
export async function assertVideoPublicationSources(client: PoolClient,
  task: Pick<VideoPublicationTask, 'type' | 'result'>, access: NonNullable<TaskPublicationAccess>,
  intent: CanvasTaskPublicationIntent): Promise<void> {
  const submission = task.result.submissionPayload as Record<string, unknown> | undefined;
  const publication = submission?.videoCanvasAdmission as CanvasTaskPublicationInput | undefined;
  const source = publication?.ordinarySourceSnapshot;
  if (!['video', 'video-extend'].includes(task.type) || publication?.singleAdmission !== task.type
    || publication.workspace !== 'canvas' || publication.workspaceId !== access.workspaceId
    || publication.access?.kind !== 'document' || publication.access.actorUserId !== access.actorId
    || publication.access.ownerId !== access.ownerId || publication.access.projectId !== access.projectId
    || publication.access.grantGeneration !== access.grantGeneration
    || intent.projectionMode !== 'derived' || intent.placement.action !== 'attach'
    || !intent.selectionSnapshot || !isDeepStrictEqual(publication.intent?.parentVersionIds, intent.parentVersionIds)
    || !Array.isArray(source) || source.length !== intent.parentVersionIds.length
    || source.some((entry, index) => !entry || entry.versionId !== intent.parentVersionIds[index]
      || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint))) {
    throw new CanvasPublicationIntentError();
  }
  await validateCanvasBatchSources(client, access.ownerId, access.projectId, intent);
  const current = await readOrdinaryPublicationSourceSnapshot(client, access.ownerId,
    access.projectId, intent.parentVersionIds, true);
  if (!isDeepStrictEqual(current, source)) throw new CanvasPublicationIntentError();
}

/** Document-only completion: task lock, then frozen publication/grant/source.
 * Complete or refund once in the SAME transaction, before pending becomes charged. */
export async function completeDocumentVideoTask(taskId: string, result: Record<string, unknown>,
  leaseOwnerOrOptions?: string | Omit<CompleteCloudTaskOptions, 'client'>): Promise<boolean> {
  await ensureCloudTaskTables();
  const options = typeof leaseOwnerOrOptions === 'string' ? { leaseOwner: leaseOwnerOrOptions } : leaseOwnerOrOptions ?? {};
  const client = await getPool().connect();
  let discard = false; let commitIssued = false; let denied = false;
  try {
    await client.query('BEGIN');
    const task = (await client.query<VideoPublicationTask>(`SELECT id,user_id,project_id,type,status,result,lease_owner,attempt_count,
      ($2::bigint IS NULL OR ((EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint <= $2
        AND lease_expires_at >= (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint)) AS deadline_valid
      FROM cloud_tasks WHERE id=$1 FOR UPDATE`, [taskId, options.deadlineAt ?? null])).rows[0];
    // A stale worker cannot revoke/refund a newer attempt.
    if (!task || task.status !== 'processing' || !task.deadline_valid
      || options.leaseOwner !== undefined && task.lease_owner !== options.leaseOwner
      || options.leaseAttemptCount !== undefined && task.attempt_count !== options.leaseAttemptCount) {
      commitIssued = true; await client.query('COMMIT'); return false;
    }
    try {
      const access = await readTaskPublicationAccess(client, task.user_id, taskId);
      const intent = await readTaskPublicationIntent(client, task.user_id, taskId);
      if (!access || !intent || access.projectId !== task.project_id) throw new DocumentAccessError();
      const { ownerId } = await assertDocumentEditor(task.user_id, task.project_id, client, access.grantGeneration);
      if (ownerId !== access.ownerId) throw new DocumentAccessError();
      await assertDocumentProjectEnabled(client, ownerId, task.project_id);
      await assertVideoPublicationSources(client, task, access, intent);
    } catch (error) {
      if (!(error instanceof DocumentAccessError || error instanceof DocumentFeatureDisabledError
        || error instanceof DocumentProjectNotEnabledError || error instanceof CanvasPublicationIntentError)) throw error;
      denied = true;
    }
    let completed = false;
    if (denied) await terminateCloudTaskAndRefund(taskId, 'failed', deniedReason, options.leaseOwner,
      { client, requireActive: true });
    else completed = await completeCloudTask(taskId, result, { ...options, client });
    commitIssued = true;
    await client.query('COMMIT');
    return completed;
  } catch (error) {
    if (!commitIssued) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    }
    // A lost COMMIT reply is not permission to refund or delete persisted media.
    discard = true;
  } finally { client.release(discard); }
  try {
    const task = await getCloudTaskById(taskId);
    if (denied && task?.status === 'failed' && task.error === deniedReason
      && (task.creditCost === 0 || task.creditStatus === 'refunded')) return false;
    if (!denied && task?.status === 'completed'
      && Object.entries(result).every(([key, value]) => isDeepStrictEqual(task.result?.[key], value))) return true;
  } catch { /* An unavailable reconciliation remains unknown. */ }
  throw new VideoCompletionUnknownError();
}

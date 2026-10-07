import 'server-only';

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifyFrozenAnnotationImageByteProof } from '../annotation-image-byte-proof';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { outputUrls, type ProjectionTask } from '@/lib/asset-core/task-projector';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError,
  DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from './document-access';
import { mediaImportCommandSchema } from './canvas-asset-command';
import type { MediaAdoptionRequest } from './document-media-request';
import { readTaskPublicationAccess, readTaskPublicationIntent, type TaskPublicationAccess } from './task-publication-access';
import { CanvasPublicationIntentError, parseCanvasTaskPublicationIntent, validateImageEditPublicationPlacements, validateCanvasBatchSources,
  type CanvasTaskPublicationIntent } from './task-publication-intent';
import { imageEditPublicationOutputs, type TaskPublicationOutput } from './image-edit-publication-output';
import { CanvasTaskPublicationError, readOrdinaryPublicationSourceSnapshot, type CanvasTaskPublicationInput,
  type OrdinaryPublicationSourceSnapshot, type ProvenOrdinaryRevisionHead } from './task-publication';

interface PublicationTask {
  id: string; user_id: string; project_id: string; type: string; status: string;
  provider_id: string | null; model: string | null; result: Record<string, unknown>;
  request_digest: string | null;
}
interface PublicationSnapshot {
  access: NonNullable<TaskPublicationAccess>; intent: CanvasTaskPublicationIntent;
  task: PublicationTask; requests: MediaAdoptionRequest[]; outputs: TaskPublicationOutput[];
}
declare const publicationBrand: unique symbol;
export interface PreparedTaskPublication { readonly [publicationBrand]: true }
const publications = new WeakMap<PreparedTaskPublication, PublicationSnapshot>();
export function canvasTaskOutputCommandKey(input: { actorId: string; projectId: string; taskId: string; outputIndex: number }): string {
  return `canvas-task-output:v1:${createHash('sha256').update(JSON.stringify([
    input.actorId, input.projectId, input.taskId, input.outputIndex,
  ])).digest('hex')}`;
}
function conflict(): never { throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT'); }
export function taskPublicationSnapshot(capability: PreparedTaskPublication): PublicationSnapshot {
  const snapshot = publications.get(capability);
  if (!snapshot) conflict();
  // Never expose the WeakMap's mutable state to consumers.
  return structuredClone(snapshot);
}
export function withoutAssetProjection(result: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...result };
  delete copy.assetProjection;
  return copy;
}
async function readSnapshot(client: PoolClient, actorId: string, taskId: string): Promise<PublicationSnapshot | null> {
  const access = await readTaskPublicationAccess(client, actorId, taskId);
  if (!access) { if (taskId.startsWith('image_edit_')) conflict(); return null; }
  const intent = await readTaskPublicationIntent(client, actorId, taskId);
  if (!intent) conflict();
  const task = (await client.query<PublicationTask>(`SELECT id,user_id,project_id,type,status,provider_id,model,result,request_digest
    FROM cloud_tasks WHERE id=$1 AND user_id=$2`, [taskId, actorId])).rows[0];
  if (!task || task.project_id !== access.projectId || task.status !== 'completed') conflict();
  if (!task.result || typeof task.result !== 'object' || Array.isArray(task.result)) conflict();
  task.result = withoutAssetProjection(task.result);
  let outputs: TaskPublicationOutput[];
  if (task.id.startsWith('image_edit_') || intent.imageEditOutputs) {
    try { outputs = imageEditPublicationOutputs(task, intent); } catch { conflict(); }
  } else {
    const urls = outputUrls({ ...task, userId: task.user_id, status: 'completed' } as ProjectionTask);
    if (urls.length && /3d|model/i.test(task.type) && !/video/i.test(task.type)) conflict();
    if (intent.placement.action === 'replace' && urls.length > 1) conflict();
    try {
      outputs = urls.map((url, index) => ({ url, intent: parseCanvasTaskPublicationIntent({ ...intent,
        placement: intent.placement.action === 'attach' ? { ...intent.placement,
          transform: { ...intent.placement.transform, x: intent.placement.transform.x + index * intent.placement.strideX } } : intent.placement }) }));
    } catch (error) { if (error instanceof CanvasPublicationIntentError) conflict(); throw error; }
  }
  const requests = outputs.map((output, outputIndex): MediaAdoptionRequest => {
    const placement = output.intent.placement;
    const command = mediaImportCommandSchema.safeParse(placement.action === 'attach'
      ? { action: 'attach', transform: { ...placement.transform } }
      : placement);
    if (!command.success) conflict();
    return { projectId: access.projectId, taskId, outputIndex, command: command.data,
      idempotencyKey: canvasTaskOutputCommandKey({ actorId, projectId: access.projectId, taskId, outputIndex }) };
  });
  return { access, intent, task, requests, outputs };
}
export async function assertTaskPublication(client: PoolClient, capability: PreparedTaskPublication): Promise<void> {
  const previous = taskPublicationSnapshot(capability);
  const current = await readSnapshot(client, previous.access.actorId, previous.access.taskId);
  if (!current || !isDeepStrictEqual(previous, current)) conflict();
  const { ownerId } = await assertDocumentEditor(current.access.actorId, current.access.projectId, client, current.access.grantGeneration);
  if (ownerId !== current.access.ownerId) throw new DocumentAccessError();
  await assertDocumentProjectEnabled(client, ownerId, current.access.projectId);
  if ((await client.query('SELECT 1 FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2 FOR SHARE',
    [current.access.projectId, ownerId])).rowCount !== 1) throw new DocumentAccessError();
  await assertOrdinaryPublicationSources(client, current);
}

/** Both preparation and the final import transaction enforce the admission source,
 * not merely the newer media-preparation snapshot. Personal task recovery is separate. */
async function assertOrdinaryPublicationSources(client: PoolClient, snapshot: PublicationSnapshot): Promise<void> {
  const { task, access, intent } = snapshot;
  if (task.type === 'video' || task.type === 'video-extend') {
    const { assertVideoPublicationSources } = await import('../video-document-admission');
    await assertVideoPublicationSources(client, task, access, intent);
    return;
  }
  // Language edits freeze source entities at admission. Repeat that exact tuple
  // on completion and every final import, not just before remote model I/O.
  if (task.type === 'edit' && intent.selectionSnapshot) {
    await validateCanvasBatchSources(client, access.ownerId, access.projectId, intent);
  }
  if (intent.annotationEditSource) {
    if (task.type !== 'edit' || intent.annotationEditSource.requestDigest !== task.request_digest) conflict();
    const proof = intent.annotationEditSource.byteProof;
    if (proof && (proof.actorUserId !== access.actorId || proof.ownerId !== access.ownerId
      || proof.projectId !== access.projectId || proof.grantGeneration !== access.grantGeneration)) conflict();
    await assertFrozenSources(client, snapshot, intent.annotationEditSource.sourceSnapshot);
  }
  if (intent.imageEditOutputs) {
    await assertFrozenSources(client, snapshot, intent.imageEditOutputs.sourceSnapshot);
    await assertImageEditPlacements(client, snapshot);
    return;
  }
  if (!task.id.startsWith('ordinary_') && !('ordinaryGeneration' in task.result)) return;
  const raw = task.result.ordinaryGeneration;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) conflict();
  const descriptor = raw as { version?: unknown; route?: unknown; requestDigest?: unknown; publication?: CanvasTaskPublicationInput };
  const publication = descriptor.publication;
  const source = publication?.ordinarySourceSnapshot;
  if (task.type !== 'generate' || !task.id.startsWith('ordinary_') || descriptor.version !== 1
    || descriptor.route !== '/api/generate' || typeof descriptor.requestDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(descriptor.requestDigest) || descriptor.requestDigest !== task.request_digest
    || publication?.singleAdmission !== 'generate' || publication.workspace !== 'canvas'
    || publication.access?.kind !== 'document' || publication.access.actorUserId !== access.actorId
    || publication.access.ownerId !== access.ownerId || publication.access.projectId !== access.projectId
    || publication.access.grantGeneration !== access.grantGeneration
    || !isDeepStrictEqual(publication.intent?.parentVersionIds, intent.parentVersionIds)
    || publication.intent?.projectionMode !== intent.projectionMode
    || !Array.isArray(source) || source.length !== intent.parentVersionIds.length
    || source.some((entry, index) => !entry || typeof entry !== 'object' || Array.isArray(entry)
      || entry.versionId !== intent.parentVersionIds[index] || typeof entry.fingerprint !== 'string'
      || !/^[a-f0-9]{64}$/.test(entry.fingerprint))) conflict();
  await assertFrozenSources(client, snapshot, source);
}

/** Placement replacement proof is independent of source-head normalization:
 * a derived primary replaces the placement while leaving the original head alone. */
async function assertImageEditPlacements(client: PoolClient, snapshot: PublicationSnapshot): Promise<void> {
  const { access, intent } = snapshot;
  let ownReplacement: { placementId: string; assetVersionId: string } | undefined;
  if (intent.placement.action === 'replace') {
    const command = (await client.query(`SELECT asset_id,asset_version_id,placement_id FROM wujie_canvas_asset_commands
      WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3 FOR SHARE`,
    [access.actorId, access.projectId, snapshot.requests[0].idempotencyKey])).rows[0];
    if (command) {
      if (command.placement_id !== intent.placement.placementId) conflict();
      await assertOwnPublishedVersion(client, snapshot, command.asset_id, command.asset_version_id, 'placement');
      ownReplacement = { placementId: command.placement_id, assetVersionId: command.asset_version_id };
    }
  }
  try { await validateImageEditPublicationPlacements(client, access.ownerId, access.projectId, intent, ownReplacement); }
  catch (error) { if (error instanceof CanvasPublicationIntentError) conflict(); throw error; }
}

export async function assertImageEditReplaySources(client: PoolClient, actorId: string, taskId: string): Promise<void> {
  const snapshot = await readSnapshot(client, actorId, taskId);
  if (!snapshot?.intent.imageEditOutputs) conflict();
  await assertOrdinaryPublicationSources(client, snapshot);
}

async function assertFrozenSources(client: PoolClient, snapshot: PublicationSnapshot,
  source: readonly OrdinaryPublicationSourceSnapshot[]): Promise<void> {
  const { access, intent } = snapshot;
  let actual: OrdinaryPublicationSourceSnapshot[];
  try { actual = await readOrdinaryPublicationSourceSnapshot(client, access.ownerId, access.projectId, intent.parentVersionIds, true); }
  catch (error) { if (error instanceof CanvasPublicationIntentError) conflict(); throw error; }
  const matches = (current: OrdinaryPublicationSourceSnapshot, frozen: OrdinaryPublicationSourceSnapshot): boolean =>
    isDeepStrictEqual(frozen.assetId === undefined && frozen.assetCurrentVersionId === undefined
      ? { versionId: current.versionId, fingerprint: current.fingerprint } : current, frozen);
  const heads: ProvenOrdinaryRevisionHead[] = [];
  for (let index = 0; index < source.length; index++) {
    const frozen = source[index]; const current = actual[index];
    if (matches(current, frozen)) continue;
    if (intent.projectionMode !== 'revision' || typeof frozen.assetId !== 'string' || !frozen.assetId
      || !(frozen.assetCurrentVersionId === null || typeof frozen.assetCurrentVersionId === 'string' && frozen.assetCurrentVersionId)
      || current.assetId !== frozen.assetId || !current.assetCurrentVersionId
      || current.assetCurrentVersionId === frozen.assetCurrentVersionId) conflict();
    await assertOwnPublishedVersion(client, snapshot, frozen.assetId, current.assetCurrentVersionId);
    heads.push({ versionId: frozen.versionId, assetId: frozen.assetId,
      currentVersionId: current.assetCurrentVersionId, admittedVersionId: frozen.assetCurrentVersionId });
  }
  if (heads.length) {
    const normalized = await readOrdinaryPublicationSourceSnapshot(client, access.ownerId, access.projectId,
      intent.parentVersionIds, true, heads);
    if (normalized.some((entry, index) => !matches(entry, source[index]))) conflict();
  }
}

/** Joint durable proof, locked again inside every final import transaction. A task_id
 * or cached assetProjection alone never grants permission to normalize a source. */
async function assertOwnPublishedVersion(client: PoolClient, snapshot: PublicationSnapshot,
  assetId: string, headId: string, purpose: 'head' | 'placement' = 'head'): Promise<void> {
  const { access, task, intent } = snapshot;
  const version = (await client.query(`SELECT id,metadata,provider_id,model_id FROM wujie_asset_versions
    WHERE id=$1 AND asset_id=$2 AND owner_id=$3 AND project_id=$4 AND task_id=$5
      AND availability='ready' FOR SHARE`, [headId, assetId, access.ownerId, access.projectId, task.id])).rows[0];
  const lineage = (await client.query(`SELECT * FROM wujie_canvas_media_lineage
    WHERE target_version_id=$1 FOR SHARE`, [headId])).rows[0];
  if (!version || !lineage || lineage.target_asset_id !== assetId || lineage.target_owner_id !== access.ownerId
    || lineage.target_project_id !== access.projectId || lineage.actor_id !== access.actorId
    || lineage.task_id !== task.id || lineage.source_kind !== 'task' || lineage.source_project_id !== access.projectId
    || lineage.source_version_id !== null || !Number.isSafeInteger(lineage.output_index)
    || lineage.output_index < 0 || lineage.output_index >= snapshot.requests.length) conflict();
  if (intent.imageEditOutputs) {
    const primary = snapshot.outputs[0];
    if (lineage.output_index !== 0 || primary?.role !== 'primary'
      || (purpose === 'head' && primary.intent.projectionMode !== 'revision')
      || (primary.intent.projectionMode === 'revision' ? assetId !== intent.imageEditOutputs.sourceSnapshot[0].assetId
        : intent.imageEditOutputs.sourceSnapshot.some(source => source.assetId === assetId))
      || version.metadata?.outputRole !== 'primary' || version.metadata?.outputIndex !== 0
      || version.provider_id !== primary.providerId || version.model_id !== primary.modelId) conflict();
  }
  const input = snapshot.requests[lineage.output_index];
  const sourceDigest = createHash('sha256').update(JSON.stringify({ kind: 'task', input })).digest('hex');
  const command = (await client.query(`SELECT * FROM wujie_canvas_asset_commands
    WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3 FOR SHARE`,
  [access.actorId, access.projectId, input.idempotencyKey])).rows[0];
  if (!command || command.owner_id !== access.ownerId || command.asset_id !== assetId
    || command.asset_version_id !== headId || command.source_kind !== 'task'
    || command.source_request_digest !== sourceDigest || lineage.source_request_digest !== sourceDigest) conflict();
  const parents = (await client.query(`SELECT parent_version_id,parent_order,owner_id,project_id,asset_id
    FROM wujie_asset_version_parents WHERE version_id=$1 ORDER BY parent_order,parent_version_id FOR SHARE`, [headId])).rows;
  if (parents.length !== intent.parentVersionIds.length || parents.some((parent, index) =>
    parent.parent_version_id !== intent.parentVersionIds[index] || parent.parent_order !== index
    || parent.owner_id !== access.ownerId || parent.project_id !== access.projectId || parent.asset_id !== assetId)) conflict();
}

/** Server DB is the only mint. null is reserved for the compatible private path. */
export async function prepareTaskPublication(actorId: string, taskId: string, targetProjectId?: string,
  workspace: string = 'canvas'): Promise<PreparedTaskPublication | null> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await getPool().connect();
    // readTaskPublicationIntent acquires SHARE locks. Bound its first query,
    // including legacy/typed callers, rather than setting timeouts afterward.
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const verifiedProof = (await readTaskPublicationIntent(client, actorId, taskId))?.annotationEditSource?.byteProof;
    await client.query('COMMIT');
    if (verifiedProof) {
      // Release the connection before media reads. No task/grant/source SQL lock
      // is held while the original image is re-read and fully decoded.
      client.release(); client = undefined;
      await verifyFrozenAnnotationImageByteProof(verifiedProof, actorId, verifiedProof.ownerId, verifiedProof.projectId);
      client = await getPool().connect();
    }
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const snapshot = await readSnapshot(client, actorId, taskId);
    if (!snapshot) {
      const task = (await client.query<{ user_id: string; project_id: string }>('SELECT user_id,project_id FROM cloud_tasks WHERE id=$1', [taskId])).rows[0];
      if (!task || task.user_id !== actorId) throw new DocumentAccessError();
      if (workspace === 'canvas') {
        const enabled = await client.query(`SELECT 1 FROM wujie_project_document_settings
          WHERE project_id IN ($1,$2) AND enabled=true`, [task.project_id, targetProjectId ?? task.project_id]);
        if (enabled.rowCount) conflict();
      }
      await client.query('COMMIT');
      return null;
    }
    if (targetProjectId !== undefined && targetProjectId !== snapshot.access.projectId) conflict();
    if (!isDeepStrictEqual(verifiedProof, snapshot.intent.annotationEditSource?.byteProof)) conflict();
    const capability = Object.freeze({}) as PreparedTaskPublication;
    publications.set(capability, snapshot);
    await assertTaskPublication(client, capability);
    await client.query('COMMIT');
    return capability;
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch { discard = true; }
    if (error instanceof CanvasTaskPublicationError || error instanceof DocumentAccessError
      || error instanceof DocumentFeatureDisabledError || error instanceof DocumentProjectNotEnabledError) throw error;
    throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
  } finally { client?.release(discard); }
}

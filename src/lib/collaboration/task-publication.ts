import 'server-only';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { GenerationProjectAccess } from './generation-project-access';
import type { AuthorizedAnnotationSource } from '../annotation-authorized-source';
import { annotationImageByteProof, type PreparedAnnotationImageByteProof } from '../annotation-image-byte-proof';
import { CanvasPublicationIntentError, parseCanvasPublicationIntentProposal, parseCanvasTaskPublicationIntent,
  validateCanvasBatchSources, resolveCanvasPublicationIntent, freezeImageEditOutputs, validateImageEditPublicationPlacements,
  type CanvasPublicationIntentProposal, type CanvasTaskPublicationIntent } from './task-publication-intent';
import {
  assertDocumentEditor, assertDocumentProjectEnabled,
  DocumentAccessError, DocumentFeatureDisabledError, DocumentProjectNotEnabledError,
} from './document-access';

export interface CanvasTaskPublicationInput {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  workspace: 'canvas';
  workspaceId: string;
  intent?: CanvasPublicationIntentProposal;
  /** Server-only opt-in; the core supplies the actual task identity separately. */
  batchAdmission?: true;
  singleAdmission?: 'edit' | 'universal-generate' | 'generate' | 'image-edit';
  imageEditOutputs?: { version: 1; includeMask: boolean };
  /** Server-captured ordinary source identities; never accepted from a request body. */
  ordinarySourceSnapshot?: OrdinaryPublicationSourceSnapshot[];
  /** Authenticated internal annotation source, repeated under existing task/source locks. */
  annotationSource?: AuthorizedAnnotationSource;
  /** Opaque capability minted by an actual server-side NULL-MIME read. */
  annotationByteProof?: PreparedAnnotationImageByteProof;
  batchPlacement?: { anchorTaskId: string; slotIndex: number; slotCount: number; requestDigest: string };
}

export interface OrdinaryPublicationSourceSnapshot {
  versionId: string; fingerprint: string;
  /** Server-captured admission head. Optional only for strictly matching old candidates. */
  assetId?: string; assetCurrentVersionId?: string | null;
}
export interface ProvenOrdinaryRevisionHead {
  versionId: string; assetId: string; currentVersionId: string; admittedVersionId: string | null;
}

export async function readOrdinaryPublicationSourceSnapshot(client: Pick<PoolClient, 'query'>, ownerId: string,
  projectId: string, versionIds: readonly string[], lock: boolean,
  provenRevisionHeads: readonly ProvenOrdinaryRevisionHead[] = []): Promise<OrdinaryPublicationSourceSnapshot[]> {
  if (!versionIds.length) return [];
  const versions = await client.query(`SELECT v.id,to_jsonb(v) AS version,to_jsonb(a) AS asset
    FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
    WHERE v.id=ANY($1::text[]) AND v.owner_id=$2 AND v.project_id=$3 ORDER BY v.id${lock ? ' FOR SHARE OF v,a' : ''}`,
  [versionIds, ownerId, projectId]);
  const parents = await client.query(`SELECT version_id,to_jsonb(p) AS identity FROM wujie_asset_version_parents p
    WHERE version_id=ANY($1::text[]) ORDER BY version_id,parent_order,parent_version_id${lock ? ' FOR SHARE' : ''}`, [versionIds]);
  if (versions.rows.length !== versionIds.length) throw new CanvasPublicationIntentError();
  return versionIds.map((versionId): OrdinaryPublicationSourceSnapshot => {
    const source = versions.rows.find(row => row.id === versionId);
    if (!source) throw new CanvasPublicationIntentError();
    const head = provenRevisionHeads.find(entry => entry.versionId === versionId);
    // Only the completed-publication caller supplies DB-proven heads. Every other
    // caller retains the original full-row comparison, including current_version_id.
    if (head) {
      if (!lock || source.asset.id !== head.assetId || source.asset.current_version_id !== head.currentVersionId) {
        throw new CanvasPublicationIntentError();
      }
      source.asset = { ...source.asset, current_version_id: head.admittedVersionId };
    }
    return { versionId, fingerprint: createHash('sha256').update(JSON.stringify({
      source, parents: parents.rows.filter(row => row.version_id === versionId),
    })).digest('hex'), assetId: source.asset.id, assetCurrentVersionId: source.asset.current_version_id };
  });
}

export interface CanvasBatchTaskIdentity {
  idempotencyKey: string; requestDigest: string;
  batchId: string; slotId: string; slotIndex: number; slotCount: number;
}

export interface CanvasSingleTaskIdentity {
  type: 'edit' | 'universal-generate' | 'generate' | 'image-edit'; idempotencyKey: string; requestDigest: string;
}

function batchRoot(identity: CanvasBatchTaskIdentity): string {
  if (!Number.isSafeInteger(identity.slotIndex) || !Number.isSafeInteger(identity.slotCount)
    || identity.slotCount < 1 || identity.slotCount > 4 || identity.slotIndex < 0 || identity.slotIndex >= identity.slotCount
    || typeof identity.idempotencyKey !== 'string' || !identity.idempotencyKey.endsWith(`:${identity.slotIndex}`)
    || typeof identity.requestDigest !== 'string' || !identity.requestDigest) throw new CanvasPublicationIntentError();
  const root = identity.idempotencyKey.slice(0, -`:${identity.slotIndex}`.length);
  if (!root || identity.batchId !== `batch-${createHash('sha256').update(root).digest('hex').slice(0, 24)}`
    || identity.slotId !== `${identity.batchId}:${identity.slotIndex}`) throw new CanvasPublicationIntentError();
  return root;
}

async function readSingleEditIntent(client: PoolClient, taskId: string, snapshot: PublicationSnapshot,
  identity: CanvasSingleTaskIdentity): Promise<CanvasTaskPublicationIntent> {
  const task = (await client.query('SELECT user_id,project_id,type,idempotency_key,request_digest FROM cloud_tasks WHERE id=$1 FOR SHARE', [taskId])).rows[0];
  const { readTaskPublicationAccess, readTaskPublicationIntent } = await import('./task-publication-access');
  const access = await readTaskPublicationAccess(client, snapshot.actorId, taskId);
  const intent = await readTaskPublicationIntent(client, snapshot.actorId, taskId);
  if (!task || task.type !== identity.type || task.user_id !== snapshot.actorId || task.project_id !== snapshot.projectId
    || task.idempotency_key !== identity.idempotencyKey || task.request_digest !== identity.requestDigest
    || !access || access.ownerId !== snapshot.ownerId || access.projectId !== snapshot.projectId
    || access.workspaceId !== snapshot.workspaceId || access.grantGeneration !== snapshot.grantGeneration
    || (identity.type === 'image-edit'
      ? !taskId.startsWith('image_edit_') || !intent?.imageEditOutputs || intent.imageEditOutputs.requestDigest !== identity.requestDigest
      : !intent?.selectionSnapshot || intent.placement.action !== 'attach')) throw new CanvasPublicationIntentError();
  if (!intent) throw new CanvasPublicationIntentError();
  return intent;
}

async function readBatchIntent(
  client: PoolClient, taskId: string, snapshot: PublicationSnapshot,
  identity: CanvasBatchTaskIdentity, anchor: boolean,
): Promise<CanvasTaskPublicationIntent> {
  const root = batchRoot(identity);
  // Locks must precede project authorization, including when completion holds the task.
  const task = (await client.query(`SELECT user_id,project_id,idempotency_key,request_digest,status,result
    FROM cloud_tasks WHERE id=$1 FOR SHARE`, [taskId])).rows[0];
  const { readTaskPublicationAccess, readTaskPublicationIntent } = await import('./task-publication-access');
  const access = await readTaskPublicationAccess(client, snapshot.actorId, taskId);
  const intent = await readTaskPublicationIntent(client, snapshot.actorId, taskId);
  const index = anchor ? 0 : identity.slotIndex;
  const payload = task?.result?.submissionPayload;
  if (!task || task.user_id !== snapshot.actorId || task.project_id !== snapshot.projectId
    || task.idempotency_key !== `${root}:${index}` || task.request_digest !== identity.requestDigest
    || !access || access.ownerId !== snapshot.ownerId || access.projectId !== snapshot.projectId
    || access.workspaceId !== snapshot.workspaceId || access.grantGeneration !== snapshot.grantGeneration
    || !intent || !intent.selectionSnapshot || intent.placement.action !== 'attach'
    || payload?.batchId !== identity.batchId || payload.slotIndex !== index
    || payload.slotId !== `${identity.batchId}:${index}` || payload.slotCount !== identity.slotCount
    || (anchor && ['cancelled', 'failed', 'timeout'].includes(task.status))) throw new CanvasPublicationIntentError();
  return intent;
}

const preparedBrand: unique symbol = Symbol('PreparedCanvasTaskPublication');
export interface PreparedCanvasTaskPublication {
  readonly [preparedBrand]: true;
}
interface PublicationSnapshot {
  client: PoolClient;
  actorId: string;
  ownerId: string;
  projectId: string;
  workspaceId: string;
  grantGeneration: string;
  intent: CanvasTaskPublicationIntent | null;
  imageEditIdentity?: CanvasSingleTaskIdentity;
}
const prepared = new WeakMap<PreparedCanvasTaskPublication, PublicationSnapshot>();

export class CanvasTaskPublicationError extends Error {
  readonly status: 403 | 409 | 503;
  constructor(readonly code: 'CANVAS_TASK_PUBLICATION_FORBIDDEN' | 'CANVAS_TASK_PUBLICATION_CONFLICT' | 'CANVAS_TASK_PUBLICATION_UNAVAILABLE') {
    const errors = {
      CANVAS_TASK_PUBLICATION_FORBIDDEN: { status: 403, message: '无权冻结此任务的画布发布授权' },
      CANVAS_TASK_PUBLICATION_CONFLICT: { status: 409, message: '任务画布发布授权冲突' },
      CANVAS_TASK_PUBLICATION_UNAVAILABLE: { status: 503, message: '任务画布发布授权服务暂不可用，请稍后重试' },
    } as const;
    super(errors[code].message);
    this.name = 'CanvasTaskPublicationError';
    this.status = errors[code].status;
  }
}

function forbidden(): never {
  throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_FORBIDDEN');
}

function rethrowPublicationError(error: unknown): never {
  if (error instanceof CanvasTaskPublicationError) throw error;
  if (error instanceof CanvasPublicationIntentError) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT');
  if (error instanceof DocumentAccessError || error instanceof DocumentFeatureDisabledError
    || error instanceof DocumentProjectNotEnabledError) return forbidden();
  throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
}

/** Freezes admission only; completion must authorize the frozen generation again. */
export async function prepareCanvasTaskPublicationInTransaction(
  client: PoolClient,
  input: { actorUserId: string; projectId: string; publication: CanvasTaskPublicationInput;
    taskIdentity?: CanvasBatchTaskIdentity; singleTaskIdentity?: CanvasSingleTaskIdentity; replayTaskId?: string },
): Promise<PreparedCanvasTaskPublication> {
  const byteProofHandle = input.publication?.annotationByteProof;
  input = structuredClone(input);
  const publication = input.publication;
  const access = publication?.access;
  if (!access || access.kind !== 'document' || typeof input.actorUserId !== 'string' || !input.actorUserId
    || typeof input.projectId !== 'string' || !input.projectId
    || access.actorUserId !== input.actorUserId || access.projectId !== input.projectId
    || typeof access.ownerId !== 'string' || !access.ownerId
    || publication.workspace !== 'canvas'
    || (publication.workspaceId !== input.projectId && publication.workspaceId !== `canvas:${input.projectId}`)
    || typeof access.grantGeneration !== 'string' || !/^(0|[1-9][0-9]*)$/.test(access.grantGeneration)
    || access.grantGeneration.trim() !== access.grantGeneration
    || access.grantGeneration.length > 19 || BigInt(access.grantGeneration) > BigInt('9223372036854775807')
    || (access.ownerId === input.actorUserId ? access.grantGeneration !== '0' : access.grantGeneration === '0')) {
    return forbidden();
  }
  // Copy before awaiting: callers cannot change the frozen tuple while SQL waits.
  const snapshot: PublicationSnapshot = {
    client, actorId: input.actorUserId, ownerId: access.ownerId, projectId: input.projectId,
    workspaceId: input.projectId, grantGeneration: access.grantGeneration, intent: null,
  };
  try {
    if (byteProofHandle && (!publication.annotationSource || publication.singleAdmission !== 'edit')) return forbidden();
    const byteProof = byteProofHandle ? annotationImageByteProof(byteProofHandle, publication.annotationSource!) : undefined;
    const proposal = publication.intent === undefined ? undefined : parseCanvasPublicationIntentProposal(publication.intent);
    const isImageEdit = publication.singleAdmission === 'image-edit';
    if (isImageEdit !== (publication.imageEditOutputs !== undefined)
      || (isImageEdit && (!publication.imageEditOutputs || publication.imageEditOutputs.version !== 1
        || typeof publication.imageEditOutputs.includeMask !== 'boolean'
        || Object.keys(publication.imageEditOutputs).some(key => !['version', 'includeMask'].includes(key))
        || !/^[a-f0-9]{64}$/.test(input.singleTaskIdentity?.requestDigest ?? '')
        || !proposal?.parentVersionIds.length))) throw new CanvasPublicationIntentError();
    if (publication.singleAdmission && (publication.batchAdmission || publication.batchPlacement
      || !['edit', 'universal-generate', 'generate', 'image-edit'].includes(publication.singleAdmission)
      || input.singleTaskIdentity?.type !== publication.singleAdmission || !input.singleTaskIdentity.idempotencyKey
      || !input.singleTaskIdentity.idempotencyKey.trim()
      || !input.singleTaskIdentity.requestDigest || (!isImageEdit && proposal?.placement.action !== 'append')
      || (publication.singleAdmission === 'edit' && !proposal?.parentVersionIds.length))) throw new CanvasPublicationIntentError();
    if (isImageEdit) snapshot.imageEditIdentity = input.singleTaskIdentity;
    let frozen: CanvasTaskPublicationIntent | undefined;
    if (publication.singleAdmission && input.replayTaskId) {
      frozen = await readSingleEditIntent(client, input.replayTaskId, snapshot, input.singleTaskIdentity!);
      if (JSON.stringify(frozen.parentVersionIds) !== JSON.stringify(proposal!.parentVersionIds)
        || frozen.projectionMode !== proposal!.projectionMode
        || (isImageEdit && (frozen.imageEditOutputs?.includeMask !== publication.imageEditOutputs!.includeMask
          || frozen.imageEditOutputs?.requestDigest !== input.singleTaskIdentity!.requestDigest))
        || (proposal!.placement.action === 'replace' ? !isDeepStrictEqual(frozen.placement, proposal!.placement)
          : frozen.placement.action !== 'attach'
            || !isDeepStrictEqual(frozen.selectionSnapshot?.map(source => source.entityId), proposal!.placement.selectedEntityIds))) {
        throw new CanvasPublicationIntentError();
      }
    }
    if (publication.batchAdmission || publication.batchPlacement) {
      if (!input.taskIdentity || proposal?.placement.action !== 'append') throw new CanvasPublicationIntentError();
      batchRoot(input.taskIdentity);
      const offset = publication.batchPlacement;
      if (input.replayTaskId) {
        frozen = await readBatchIntent(client, input.replayTaskId, snapshot, input.taskIdentity, false);
      } else if (input.taskIdentity.slotIndex > 0) {
        if (!offset || offset.slotIndex !== input.taskIdentity.slotIndex || offset.slotCount !== input.taskIdentity.slotCount
          || offset.requestDigest !== input.taskIdentity.requestDigest) throw new CanvasPublicationIntentError();
        frozen = await readBatchIntent(client, offset.anchorTaskId, snapshot, input.taskIdentity, true);
      } else if (offset) throw new CanvasPublicationIntentError();
      if (frozen && (JSON.stringify(frozen.parentVersionIds) !== JSON.stringify(proposal.parentVersionIds)
        || frozen.projectionMode !== proposal.projectionMode
        || JSON.stringify(frozen.selectionSnapshot?.map(source => source.entityId)) !== JSON.stringify(proposal.placement.selectedEntityIds))) {
        throw new CanvasPublicationIntentError();
      }
    }
    const { ownerId } = await assertDocumentEditor(snapshot.actorId, snapshot.projectId, client, snapshot.grantGeneration);
    if (ownerId !== snapshot.ownerId) return forbidden();
    await assertDocumentProjectEnabled(client, ownerId, snapshot.projectId);
    const document = await client.query(
      `SELECT 1 FROM wujie_project_canvas_documents WHERE project_id=$1 AND owner_id=$2 FOR SHARE`,
      [snapshot.projectId, ownerId],
    );
    if (document.rowCount !== 1) return forbidden();
    if (publication.annotationSource) {
      if (publication.singleAdmission !== 'edit') return forbidden();
      const { assertAnnotationDocumentSourceLocked } = await import('../annotation-edit-context');
      await assertAnnotationDocumentSourceLocked(client, publication.annotationSource, access);
    }
    if (publication.singleAdmission === 'edit' && frozen
      && Boolean(frozen.annotationEditSource) !== Boolean(publication.annotationSource)) throw new CanvasPublicationIntentError();
    if (frozen) {
      if (isImageEdit) {
        const current = await readOrdinaryPublicationSourceSnapshot(client, ownerId, snapshot.projectId, frozen.parentVersionIds, true);
        let originalPlacements = true;
        try { await validateImageEditPublicationPlacements(client, ownerId, snapshot.projectId, frozen); }
        catch (error) { if (!(error instanceof CanvasPublicationIntentError)) throw error; originalPlacements = false; }
        if (!originalPlacements || !isDeepStrictEqual(current, frozen.imageEditOutputs!.sourceSnapshot)) {
          const { assertImageEditReplaySources } = await import('./task-publication-output');
          await assertImageEditReplaySources(client, snapshot.actorId, input.replayTaskId!);
        }
        snapshot.intent = frozen;
      } else {
        if (!input.replayTaskId || publication.singleAdmission) await validateCanvasBatchSources(client, ownerId, snapshot.projectId, frozen);
        if (frozen.placement.action !== 'attach') throw new CanvasPublicationIntentError();
        snapshot.intent = input.replayTaskId ? frozen : parseCanvasTaskPublicationIntent({ ...frozen,
          placement: { ...frozen.placement, transform: { ...frozen.placement.transform,
            x: frozen.placement.transform.x + input.taskIdentity!.slotIndex * frozen.placement.strideX } } });
      }
    } else if (proposal) {
      snapshot.intent = await resolveCanvasPublicationIntent(client, ownerId, snapshot.projectId, proposal,
        publication.batchAdmission || publication.singleAdmission ? { freezeSelectionSnapshot: true } : undefined);
    }
    if (publication.singleAdmission) {
      // The shared intent resolver also supports video. Single language edits require image parents,
      // checked under the same source locks so a front-door image check cannot become stale.
      const images = await client.query(`SELECT v.id FROM wujie_asset_versions v
        JOIN wujie_assets a ON a.id=v.asset_id AND a.owner_id=v.owner_id AND a.project_id=v.project_id
        WHERE v.id=ANY($1::text[]) AND v.owner_id=$2 AND v.project_id=$3
          AND a.kind='image' AND (v.mime_type LIKE 'image/%'${byteProof ? ' OR (v.mime_type IS NULL AND v.id=$4)' : ''}) FOR SHARE OF v,a`,
      [proposal!.parentVersionIds, ownerId, snapshot.projectId, ...(byteProof ? [byteProof.assetVersionId] : [])]);
      if (images.rows.length !== proposal!.parentVersionIds.length) throw new CanvasPublicationIntentError();
    }
    if (publication.singleAdmission === 'generate' && publication.ordinarySourceSnapshot) {
      const current = await readOrdinaryPublicationSourceSnapshot(client, ownerId, snapshot.projectId, proposal!.parentVersionIds, true);
      if (!isDeepStrictEqual(current, publication.ordinarySourceSnapshot)) throw new CanvasPublicationIntentError();
    }
    if (publication.annotationSource) {
      const source = await readOrdinaryPublicationSourceSnapshot(client, ownerId, snapshot.projectId, proposal!.parentVersionIds, true);
      if (byteProof && (source.length !== 1 || byteProof.actorUserId !== snapshot.actorId
        || byteProof.ownerId !== ownerId || byteProof.projectId !== snapshot.projectId
        || byteProof.grantGeneration !== snapshot.grantGeneration
        || byteProof.assetVersionId !== source[0].versionId || byteProof.assetId !== source[0].assetId
        || byteProof.sourceFingerprint !== source[0].fingerprint)) throw new CanvasPublicationIntentError();
      if (frozen) {
        if (frozen.annotationEditSource?.requestDigest !== input.singleTaskIdentity!.requestDigest
          || !isDeepStrictEqual(source, frozen.annotationEditSource.sourceSnapshot)
          || !isDeepStrictEqual(byteProof, frozen.annotationEditSource.byteProof)) throw new CanvasPublicationIntentError();
      } else {
        snapshot.intent = parseCanvasTaskPublicationIntent({ ...snapshot.intent, annotationEditSource: {
          version: 1, requestDigest: input.singleTaskIdentity!.requestDigest, sourceSnapshot: source,
          ...(byteProof ? { byteProof } : {}),
        } });
      }
    }
    if (isImageEdit && !frozen) {
      const source = await readOrdinaryPublicationSourceSnapshot(client, ownerId, snapshot.projectId, proposal!.parentVersionIds, true);
      // The reader always supplies these fields; parse again instead of trusting a caller-supplied snapshot.
      const policy = { ...publication.imageEditOutputs!, requestDigest: input.singleTaskIdentity!.requestDigest,
        sourceSnapshot: source as NonNullable<CanvasTaskPublicationIntent['imageEditOutputs']>['sourceSnapshot'] };
      snapshot.intent = await freezeImageEditOutputs(client, ownerId, snapshot.projectId, snapshot.intent!, policy);
    }
    const handle: PreparedCanvasTaskPublication = Object.freeze({ [preparedBrand]: true as const });
    prepared.set(handle, snapshot);
    return handle;
  } catch (error) { return rethrowPublicationError(error); }
}

export async function persistCanvasTaskPublicationInTransaction(
  client: PoolClient,
  input: { taskId: string; publication: PreparedCanvasTaskPublication },
): Promise<void> {
  const snapshot = prepared.get(input.publication);
  if (!snapshot || snapshot.client !== client) return forbidden();
  try {
    const task = await client.query<{ user_id: string; project_id: string; type: string; idempotency_key: string; request_digest: string }>(
      'SELECT user_id,project_id,type,idempotency_key,request_digest FROM cloud_tasks WHERE id=$1 FOR SHARE', [input.taskId],
    );
    if (task.rows[0]?.user_id !== snapshot.actorId || task.rows[0]?.project_id !== snapshot.projectId) return forbidden();
    if (snapshot.imageEditIdentity && (!input.taskId.startsWith('image_edit_') || task.rows[0].type !== 'image-edit'
      || task.rows[0].idempotency_key !== snapshot.imageEditIdentity.idempotencyKey
      || task.rows[0].request_digest !== snapshot.imageEditIdentity.requestDigest)) throw new CanvasPublicationIntentError();
    const tuple = [input.taskId, snapshot.actorId, snapshot.ownerId, snapshot.projectId, snapshot.workspaceId,
      snapshot.grantGeneration, snapshot.intent === null ? null : JSON.stringify(snapshot.intent)];
    await client.query(`INSERT INTO wujie_canvas_task_publications
      (task_id,actor_id,owner_id,project_id,workspace_id,grant_generation,publication_intent)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (task_id) DO NOTHING`, tuple);
    const exact = await client.query(`SELECT 1 FROM wujie_canvas_task_publications
      WHERE task_id=$1 AND actor_id=$2 AND owner_id=$3 AND project_id=$4 AND workspace_id=$5 AND grant_generation=$6
        AND publication_intent IS NOT DISTINCT FROM $7::jsonb`, tuple);
    if (exact.rowCount !== 1) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT');
  } catch (error) { rethrowPublicationError(error); }
}

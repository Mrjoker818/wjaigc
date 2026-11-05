import 'server-only';

import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getAdvisoryLockPool, getPool } from '@/lib/db-client';
import { createAssetStorageTransaction, lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { loadDocumentInTransaction } from '@/lib/collaboration/document-store';
import { readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError,
  DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from '@/lib/collaboration/document-access';
import { readTaskPublicationAccess, type TaskPublicationAccess } from '@/lib/collaboration/task-publication-access';
import { CanvasTaskPublicationError } from '@/lib/collaboration/task-publication';
import { resolvePrivateTaskVersion, type PreparedPrivateTaskVersion } from '@/lib/collaboration/document-task-version-adapter';
import { assertTaskPublication, prepareTaskPublication, taskPublicationSnapshot, type PreparedTaskPublication } from '@/lib/collaboration/task-publication-output';
import { executeDocumentAssetCommandInTransaction } from '@/lib/collaboration/document-asset-commands';
import { bindImportedDocumentMedia, prepareDocumentAssetsForImport, assertPreparedDocumentAssets, type PreparedDocumentAssets } from '@/lib/collaboration/document-asset-validation';
import { parseDocumentAssetCommandRequest, type DocumentMediaImportResult } from '@/lib/collaboration/canvas-asset-command';
import { assertMediaActive, consumeMediaBody, DocumentMediaError, mediaBodyIdentity, mediaDeadline, mediaImportLimit,
  parseMediaAdoption, parseMediaVersionImport, parseUploadHeaders, readMediaBody, reserveMediaPreparation, VIDEO_IMPORT_LIMIT,
  type MediaAdoptionRequest, type MediaVersionImportRequest, type MediaUploadRequest } from '@/lib/collaboration/document-media-request';
import { assertMediaTaskSource, importedMediaIdentity, importedMediaRevision, mediaSourceLimit, mediaSourceProject, prepareAdoptedMedia,
  prepareMediaTaskSource, prepareMediaVersionSource, assertMediaVersionSource, prepareUploadedMedia, type PreparedImportedMedia } from '@/lib/collaboration/document-media-source';

type ImportRequest = MediaUploadRequest | MediaAdoptionRequest | MediaVersionImportRequest;
type MediaSource = Awaited<ReturnType<typeof prepareMediaTaskSource>> | Awaited<ReturnType<typeof prepareMediaVersionSource>>;
interface StoredImport {
  source_request_digest: string | null;
  source_kind: string | null;
  placement_id: string;
  asset_version_id: string;
  document_sequence: string;
  assetReference: DocumentMediaImportResult['assetReference'];
}
interface ImportReferenceRow extends Omit<StoredImport, 'assetReference'> {
  owner_id: string;
  asset_id: string;
  registered_asset_id: string | null;
  registered_version_id: string | null;
  registered_placement_id: string | null;
  entity_id: string | null;
  file_url: string | null;
  kind: string | null;
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function conflict(): never { throw new DocumentMediaError('DOCUMENT_MEDIA_CONFLICT'); }
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Read only server-persisted accepted outputs; the public group marker is not provenance authority. */
function ordinaryOutputIdentity(task: { id: string; type: string; result: Record<string, unknown> },
  outputIndex: number, requestDigest: string | null): { providerId: string; modelId: string } {
  const descriptor = asRecord(task.result.ordinaryGeneration);
  const plan = asRecord(descriptor?.plan); const checkpoint = asRecord(task.result.ordinaryCheckpoint);
  const persisted = asRecord(checkpoint?.persistedOutputs);
  if (task.type !== 'generate' || !task.id.startsWith('ordinary_') || descriptor?.version !== 1
    || descriptor.route !== '/api/generate' || !requestDigest || !/^[a-f0-9]{64}$/i.test(requestDigest)
    || descriptor.requestDigest !== requestDigest || !Array.isArray(plan?.targets)
    || !Array.isArray(checkpoint?.attempts) || !persisted || !Array.isArray(task.result.imageUrls)) conflict();
  const outputs: Array<{ key: string; providerId: string; modelId: string }> = [];
  let previousSlot = -1; let previousAttempt = -1;
  for (const entry of checkpoint.attempts) {
    const attempt = asRecord(entry);
    if (!attempt || typeof attempt.slotIndex !== 'number' || !Number.isInteger(attempt.slotIndex) || attempt.slotIndex < 0
      || typeof attempt.attemptIndex !== 'number' || !Number.isInteger(attempt.attemptIndex) || attempt.attemptIndex < 0
      || attempt.slotIndex < previousSlot || (attempt.slotIndex === previousSlot && attempt.attemptIndex <= previousAttempt)) conflict();
    previousSlot = attempt.slotIndex; previousAttempt = attempt.attemptIndex;
    if (attempt.status === 'rejected') continue;
    if (attempt.status !== 'accepted' || typeof attempt.targetIndex !== 'number' || !Number.isInteger(attempt.targetIndex)) conflict();
    const target = asRecord(plan.targets[attempt.targetIndex]);
    if (!target || typeof target.providerId !== 'string' || !target.providerId.trim()
      || typeof target.modelId !== 'string' || !target.modelId.trim()) conflict();
    const prefix = `${attempt.slotIndex}:${attempt.attemptIndex}`;
    const add = (urls: unknown, suffix: string): void => {
      if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string' || !url)) conflict();
      urls.forEach((_url, index) => outputs.push({ key: `${prefix}:${suffix}:${index}`,
        providerId: target.providerId as string, modelId: target.modelId as string }));
    };
    add(attempt.directUrls ?? [], 'direct');
    if (!Array.isArray(attempt.remotes)) conflict();
    attempt.remotes.forEach((entry: unknown, remoteIndex: number) => {
      const remote = asRecord(entry);
      if (!remote || typeof remote.id !== 'string' || !remote.id) conflict();
      if (remote.urls !== undefined) add(remote.urls, String(remoteIndex));
      else if (remote.failed !== true) conflict();
    });
  }
  if (outputs.length !== task.result.imageUrls.length || outputs.some((output, index) =>
    typeof persisted[output.key] !== 'string' || persisted[output.key] !== (task.result.imageUrls as unknown[])[index])) conflict();
  const selected = outputs[outputIndex]; if (!selected) conflict();
  return { providerId: selected.providerId, modelId: selected.modelId };
}
interface ImportAuthorization { snapshot?: TaskPublicationAccess; publication?: PreparedTaskPublication }
async function authorize(client: PoolClient, actorId: string, input: ImportRequest, authorization: ImportAuthorization): Promise<string> {
  if (authorization.publication) await assertTaskPublication(client, authorization.publication);
  if (!('taskId' in input)) {
    const { ownerId } = await assertDocumentEditor(actorId, input.projectId, client);
    await assertDocumentProjectEnabled(client, ownerId, input.projectId);
    return ownerId;
  }
  try {
    const current = await readTaskPublicationAccess(client, actorId, input.taskId);
    if (authorization.snapshot === undefined) authorization.snapshot = current;
    else if (!isDeepStrictEqual(authorization.snapshot, current)) throw new DocumentAccessError();
    const frozen = current?.projectId === input.projectId ? current : null;
    const { ownerId } = await assertDocumentEditor(actorId, input.projectId, client, frozen?.grantGeneration);
    await assertDocumentProjectEnabled(client, ownerId, input.projectId);
    if (frozen) {
      if (ownerId !== frozen.ownerId) throw new DocumentAccessError();
      const document = await client.query(`SELECT 1 FROM wujie_project_canvas_documents
        WHERE project_id=$1 AND owner_id=$2 FOR SHARE`, [input.projectId, ownerId]);
      if (document.rowCount !== 1) throw new DocumentAccessError();
    }
    return ownerId;
  } catch (error) {
    if (error instanceof DocumentAccessError || error instanceof CanvasTaskPublicationError) throw error;
    if (error instanceof DocumentFeatureDisabledError || error instanceof DocumentProjectNotEnabledError) {
      throw error;
    }
    throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
  }
}
async function resultRow(client: PoolClient, actorId: string, input: ImportRequest, ownerId: string): Promise<StoredImport | undefined> {
  // Keep the command visible even when a canonical reference is broken. The
  // command pins historical asset/version identity; the placement may have
  // legitimately been replaced or removed since this command committed.
  const row = (await client.query<ImportReferenceRow>(`SELECT source_request_digest,c.source_kind,c.placement_id,
      c.asset_id,c.asset_version_id,c.document_sequence,c.owner_id,
      a.id AS registered_asset_id,v.id AS registered_version_id,p.id AS registered_placement_id,
      a.kind,v.file_url,p.entity_id
    FROM wujie_canvas_asset_commands c
    LEFT JOIN wujie_assets a ON a.id=c.asset_id AND a.owner_id=$4 AND a.project_id=$2
    LEFT JOIN wujie_asset_versions v ON v.id=c.asset_version_id AND v.asset_id=c.asset_id AND v.owner_id=$4 AND v.project_id=$2
    LEFT JOIN wujie_workspace_placements p ON p.id=c.placement_id AND p.owner_id=$4 AND p.project_id=$2
      AND p.workspace_kind='canvas' AND p.workspace_id IN ($2,'canvas:' || $2)
      AND p.entity_type IN ('canvas-image','canvas-video')
    WHERE c.actor_id=$1 AND c.project_id=$2 AND c.idempotency_key=$3`,
  [actorId, input.projectId, input.idempotencyKey, ownerId])).rows[0];
  if (!row) return undefined;
  if (row.owner_id !== ownerId || !row.registered_asset_id || !row.registered_version_id || !row.registered_placement_id
    || !row.asset_id?.trim() || !row.asset_version_id?.trim() || !row.placement_id?.trim()
    || !row.entity_id?.trim() || !row.file_url?.trim() || (row.kind !== 'image' && row.kind !== 'video')) conflict();
  return { ...row, assetReference: { assetId: row.asset_id, assetVersionId: row.asset_version_id,
    placementId: row.placement_id, entityId: row.entity_id, url: row.file_url, kind: row.kind } };
}
function replay(row: StoredImport, sourceDigest: string, kind: string): DocumentMediaImportResult {
  if (row.source_request_digest !== sourceDigest || row.source_kind !== kind) conflict();
  const documentSequence = Number(row.document_sequence);
  if (!Number.isSafeInteger(documentSequence) || documentSequence < 0) throw new Error('INVALID_COMMAND_SEQUENCE');
  return { placementId: row.placement_id, assetVersionId: row.asset_version_id, documentSequence, assetReference: row.assetReference };
}
/** Replay from currently authorized durable identity, never today's private source. */
async function replayTaskVersionImport(client: PoolClient, actorId: string, input: MediaVersionImportRequest,
  ownerId: string, row: StoredImport): Promise<MediaAdoptionRequest> {
  const lineage = (await client.query<{ task_id: string; output_index: number; source_version_id: string; source_request_digest: string }>(`SELECT l.task_id,l.output_index,l.source_version_id,l.source_request_digest
    FROM wujie_canvas_media_lineage l
    WHERE l.target_version_id=$1 AND l.target_asset_id=$2 AND l.target_owner_id=$3 AND l.target_project_id=$4
      AND l.actor_id=$5 AND l.source_kind='task'`,
  [row.asset_version_id, row.assetReference.assetId, ownerId, input.projectId, actorId])).rows;
  if (lineage.length !== 1 || lineage[0].source_version_id !== input.sourceVersionId
    || !lineage[0].task_id || !Number.isSafeInteger(lineage[0].output_index) || lineage[0].output_index < 0) conflict();
  const derived = parseMediaAdoption({ ...input, taskId: lineage[0].task_id, outputIndex: lineage[0].output_index });
  const sourceDigest = digest({ kind: 'task', input: derived });
  if (lineage[0].source_request_digest !== sourceDigest || row.source_request_digest !== sourceDigest) conflict();
  return derived;
}
async function authorizedResult(actorId: string, input: ImportRequest, authorization: ImportAuthorization): Promise<{ ownerId: string; row?: StoredImport; taskVersionInput?: MediaAdoptionRequest }> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const ownerId = await authorize(client, actorId, input, authorization);
    const row = await resultRow(client, actorId, input, ownerId);
    const taskVersionInput = row?.source_kind === 'task' && 'sourceVersionId' in input && !('taskId' in input)
      ? await replayTaskVersionImport(client, actorId, input, ownerId, row) : undefined;
    await client.query('COMMIT');
    return { ownerId, row, taskVersionInput };
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch { discard = true; }
    if ('taskId' in input && !(error instanceof DocumentMediaError) && !(error instanceof DocumentAccessError) && !(error instanceof CanvasTaskPublicationError)
      && !(error instanceof DocumentFeatureDisabledError) && !(error instanceof DocumentProjectNotEnabledError)) {
      throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
    }
    throw error;
  } finally { client?.release(discard); }
}
export interface ImportLock { check(): Promise<void>; release(): Promise<void> }
/** Abandonment destroys the session, not just this wait. Late connect successes
 * must also be disposed; both late SQL success and failure are always observed. */
function waitForLock<T>(start: () => Promise<T>, signal: AbortSignal, milliseconds: number,
  abandon: () => void, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject): void => {
    let settled = false;
    const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true; cleanup(); abandon(); reject(error);
    };
    const abort = (): void => fail(new DocumentMediaError('DOCUMENT_MEDIA_CANCELLED'));
    const timer = setTimeout((): void => fail(new DocumentMediaError('DOCUMENT_MEDIA_BUSY')), Math.max(0, milliseconds));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    if (milliseconds <= 0) { fail(new DocumentMediaError('DOCUMENT_MEDIA_BUSY')); return; }
    try {
      void start().then(value => {
        if (settled) { late?.(value); return; }
        settled = true; cleanup(); resolve(value);
      }, fail);
    } catch (error) { fail(error); }
  });
}
export async function acquireKey(actorId: string, input: Pick<ImportRequest, 'projectId' | 'idempotencyKey'>, signal: AbortSignal): Promise<ImportLock> {
  return acquireKeys(actorId, [input], signal);
}
/** One session owns the entire set, including keys shared with the public single
 * API. A failed try releases every partial key before returning the connection. */
async function acquireKeys(actorId: string, inputs: ReadonlyArray<Pick<ImportRequest, 'projectId' | 'idempotencyKey'>>,
  signal: AbortSignal): Promise<ImportLock> {
  const keys = [...new Set(inputs.map(input => `document-media:${digest([actorId, input.projectId, input.idempotencyKey])}`))].sort();
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    assertMediaActive(signal);
    // Try-lock and promptly return unsuccessful connections to the independent
    // pool. Twenty waiters never hold twenty business-pool transactions.
    const client = await waitForLock(() => getAdvisoryLockPool().connect(), signal, until - Date.now(),
      (): void => undefined, (late): void => late.release(true));
    let lost = false;
    let released = false;
    const onError = (): void => { lost = true; };
    client.on('error', onError);
    const dispose = (destroy: boolean): void => {
      if (released) return;
      released = true;
      if (destroy) { lost = true; client.once('end', (): void => { client.off('error', onError); }); }
      else client.off('error', onError);
      client.release(destroy);
    };
    const query = async (sql: string, parameters?: string[], timeout: number = 30_000): Promise<{ rows: Array<Record<string, unknown>> }> => {
      try {
        assertMediaActive(signal);
        if (lost || released) throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
        const result = await waitForLock(() => client.query<Record<string, unknown>>(sql, parameters), signal, timeout, (): void => dispose(true));
        if (lost) throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
        return result;
      } catch (error) { dispose(true); throw error; }
    };
    try {
      const owned: string[] = [];
      for (const key of keys) {
        const acquired = (await query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key], until - Date.now())).rows[0]?.acquired === true;
        if (!acquired) break;
        owned.push(key);
      }
      assertMediaActive(signal);
      if (owned.length === keys.length) return {
        check: async (): Promise<void> => {
          await query('SELECT 1');
        },
        release: async (): Promise<void> => {
          try {
            if (!lost && !released) {
              for (const key of [...owned].reverse()) {
                const result = await query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released', [key]);
                if (!result.rows[0]?.released) { lost = true; break; }
              }
            }
          } catch { lost = true; }
          finally { dispose(lost); }
        },
      };
      for (const key of [...owned].reverse()) {
        const result = await query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released', [key], until - Date.now());
        if (!result.rows[0]?.released) throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
      }
    } catch (error) {
      dispose(true); throw error;
    }
    dispose(false);
    await delay(Math.min(25, Math.max(0, until - Date.now())), undefined, { signal }).catch((): never => { throw new DocumentMediaError('DOCUMENT_MEDIA_CANCELLED'); });
  }
  throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
}

/** Actual single-item writing boundary: no BEGIN/COMMIT or caller validators. */
async function writePreparedMediaInTransaction(client: PoolClient, actorId: string, input: ImportRequest,
  sourceDigest: string, kind: 'upload' | 'task' | 'version', media: PreparedImportedMedia,
  source: MediaSource | undefined, prepared: PreparedDocumentAssets, signal: AbortSignal,
  authorization: ImportAuthorization, deferRevisionHead: boolean = false,
  derived?: DerivedGridContext): Promise<DocumentMediaImportResult> {
  const identity = importedMediaIdentity(media);
  if (derived && (source || authorization.publication || importedMediaRevision(media) || kind !== 'version'
    || !('sourceVersionId' in input) || input.sourceVersionId !== derived.sourceVersionId
    || identity.actorId !== actorId || identity.ownerId !== derived.ownerId
    || input.projectId !== derived.sourceProjectId || identity.projectId !== input.projectId)) conflict();
  const ownerId = await authorize(client, actorId, input, authorization);
  if (ownerId !== identity.ownerId) conflict();
  const prior = await resultRow(client, actorId, input, ownerId);
  if (prior) conflict(); // Same-key session lock forbids an import race; ready commands can still race.
  if (source) {
    if ('taskId' in input) await assertMediaTaskSource(client, actorId, input, source);
    else if ('sourceVersionId' in input) await assertMediaVersionSource(client, actorId, input, source);
  }
  assertMediaActive(signal);
  const revision = importedMediaRevision(media);
  if (!revision) await client.query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind,status,metadata)
    VALUES ($1,$2,$3,$4,'active','{"source":"document-media-import"}')`, [identity.assetId, ownerId, input.projectId, identity.kind]);
  const file = identity.file;
  const publication = authorization.publication ? taskPublicationSnapshot(authorization.publication) : undefined;
  const output = publication && 'outputIndex' in input ? publication.outputs[input.outputIndex] : undefined;
  if (publication && (!output || !('outputIndex' in input)
    || !isDeepStrictEqual(input, publication.requests[input.outputIndex]))) conflict();
  let outputIdentity: { providerId: string; modelId: string } | undefined;
  if (publication && (publication.task.id.startsWith('ordinary_') || 'ordinaryGeneration' in publication.task.result)) {
    if (!('outputIndex' in input)) conflict();
    const digestRow = (await client.query<{ request_digest: string | null }>(
      'SELECT request_digest FROM cloud_tasks WHERE id=$1 AND user_id=$2', [publication.task.id, actorId])).rows[0];
    outputIdentity = ordinaryOutputIdentity(publication.task, input.outputIndex, digestRow?.request_digest ?? null);
  }
  await client.query(`INSERT INTO wujie_asset_versions
    (id,asset_id,owner_id,project_id,file_url,storage_key,checksum,mime_type,byte_size,availability,metadata,task_id,provider_id,model_id,width,height)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10::jsonb,$11,$12,$13,$14,$15)`,
  [identity.versionId, identity.assetId, ownerId, input.projectId, file.url, file.storageKey ?? null, file.checksum, file.mimeType, file.byteSize,
    JSON.stringify({ source: 'document-media-import', ...(output ? { sourceVersionIds: output.intent.parentVersionIds }
      : derived ? { sourceVersionIds: [derived.sourceVersionId], [derived.runtimeCell ? 'workflowImageRuntimeCell' : 'workflowImageGrid']: derived.metadata } : {}),
      ...(output?.role && 'outputIndex' in input ? { outputRole: output.role, outputIndex: input.outputIndex } : {}) }),
    publication?.task.id ?? null, output?.providerId ?? outputIdentity?.providerId ?? publication?.task.provider_id ?? null,
    output?.modelId ?? outputIdentity?.modelId ?? publication?.task.model ?? null, file.width ?? null, file.height ?? null]);
  for (const [index, parent] of (output?.intent.parentVersionIds ?? (derived ? [derived.sourceVersionId] : [])).entries()) {
    await client.query(`INSERT INTO wujie_asset_version_parents(version_id,parent_version_id,owner_id,project_id,parent_order,asset_id)
      VALUES ($1,$2,$3,$4,$5,$6)`, [identity.versionId, parent, ownerId, input.projectId, index, identity.assetId]);
  }
  if (!revision) await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [identity.assetId, identity.versionId]);
  await client.query(`INSERT INTO wujie_canvas_media_lineage
    (target_version_id,target_asset_id,target_owner_id,target_project_id,actor_id,source_kind,task_id,output_index,source_project_id,source_version_id,source_request_digest)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [identity.versionId, identity.assetId, ownerId, input.projectId, actorId, kind,
    'taskId' in input ? input.taskId : null, 'outputIndex' in input ? input.outputIndex : null,
    source ? mediaSourceProject(source) : derived?.sourceProjectId ?? null,
    'sourceVersionId' in input ? input.sourceVersionId ?? null : null, sourceDigest]);
  await bindImportedDocumentMedia(client, actorId, prepared, media);
  await executeDocumentAssetCommandInTransaction(client, { actorId, projectId: input.projectId,
    idempotencyKey: input.idempotencyKey, command: { ...input.command, assetVersionId: identity.versionId } }, prepared);
  // The original pre/post prepared asset + annotation assertions run before
  // this sole intentional current-pointer change, inside the same transaction.
  if (revision && !deferRevisionHead) await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [identity.assetId, identity.versionId]);
  await client.query(`UPDATE wujie_canvas_asset_commands SET source_request_digest=$4,source_kind=$5
    WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`, [actorId, input.projectId, input.idempotencyKey, sourceDigest, kind]);
  const registered = await resultRow(client, actorId, input, ownerId);
  if (!registered) conflict();
  return replay(registered, sourceDigest, kind);
}

async function finalTransaction(actorId: string, input: ImportRequest, sourceDigest: string, kind: 'upload' | 'task' | 'version',
  media: PreparedImportedMedia, source: MediaSource | undefined, lock: ImportLock, signal: AbortSignal,
  authorization: ImportAuthorization): Promise<DocumentMediaImportResult> {
  const prepared = await prepareDocumentAssetsForImport(actorId, input.projectId, input.command, signal);
  const client = await getPool().connect();
  let commitSent = false;
  let released = false;
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'");
    await client.query("SET LOCAL statement_timeout='10000ms'");
    await lockAssetGraphWriteGate(client, 'shared');
    // Pin task/publication first without taking project SHARE locks. Keep the
    // sorted NOWAIT project gate ahead of authorize's project permission reads.
    if ('taskId' in input) await readTaskPublicationAccess(client, actorId, input.taskId);
    // Sorted NOWAIT also breaks cycles with legacy adoption, whose target SHARE
    // precedes its source SHARE. On contention roll back the whole transaction;
    // the caller may retry this same key without a second committed result.
    const projects = [...new Set([input.projectId, ...(source ? [mediaSourceProject(source)] : [])])].sort();
    for (const projectId of projects) {
      const project = await client.query("SELECT id FROM wujie_projects WHERE id=$1 AND status='active' FOR UPDATE NOWAIT", [projectId]);
      if (project.rowCount !== 1) {
        // Target invalidation is an authorization denial at every phase;
        // a distinct source invalidation still means the prepared source changed.
        if (projectId === input.projectId) throw new DocumentAccessError();
        conflict();
      }
    }
    await lock.check();
    const result = await writePreparedMediaInTransaction(client, actorId, input, sourceDigest, kind,
      media, source, prepared, signal, authorization);
    await lock.check();
    assertMediaActive(signal);
    commitSent = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (commitSent) {
      client.release(true); released = true;
      // No cleanup after COMMIT was sent, even if the recovery read fails or
      // returns no result. Only freshly authorized durable state can ACK.
      try {
        const persisted = await authorizedResult(actorId, input, authorization);
        if (persisted.row) return replay(persisted.row, sourceDigest, kind);
      } catch { /* outcome remains uncertain; media stays intact */ }
      throw new UnknownMediaCommitError();
    }
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { if (!released) client.release(discard); }
}
class UnknownMediaCommitError extends Error { constructor() { super('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED'); } }

async function executeImport(actorId: string, input: ImportRequest, request: Request, mimeType?: string,
  publication?: PreparedTaskPublication, privateVersion?: PreparedPrivateTaskVersion): Promise<DocumentMediaImportResult> {
  const deadline = mediaDeadline(request.signal);
  let lock: ImportLock | undefined;
  let release: (() => void) | undefined;
  let media: PreparedImportedMedia | undefined;
  let preserve = false;
  const authorization: ImportAuthorization = { publication };
  try {
    assertMediaActive(deadline.signal);
    await authorizedResult(actorId, input, authorization);
    lock = await acquireKey(actorId, input, deadline.signal);
    const initial = await authorizedResult(actorId, input, authorization);
    assertMediaActive(deadline.signal);
    const kind = 'taskId' in input ? 'task' : 'sourceVersionId' in input ? 'version' : 'upload';
    let sourceDigest: string;
    let source: MediaSource | undefined;
    if ('taskId' in input || 'sourceVersionId' in input) {
      sourceDigest = digest({ kind, input });
      if (initial.row) return replay(initial.row, sourceDigest, kind);
      source = 'taskId' in input ? await prepareMediaTaskSource(actorId, input, publication, privateVersion) : await prepareMediaVersionSource(actorId, input);
      release = reserveMediaPreparation(mediaSourceLimit(source), deadline.signal);
      media = await prepareAdoptedMedia(source, actorId, initial.ownerId, input.projectId, deadline.signal);
    } else {
      const limit = mediaImportLimit(mimeType!);
      release = reserveMediaPreparation(initial.row ? 0 : limit, deadline.signal);
      const body = await readMediaBody(request, limit, deadline.signal, !!initial.row);
      sourceDigest = digest({ kind, input, mimeType, ...mediaBodyIdentity(body) });
      if (initial.row) {
        consumeMediaBody(body);
        await lock.check();
        const current = await authorizedResult(actorId, input, authorization);
        if (!current.row) conflict();
        return replay(current.row, sourceDigest, kind);
      }
      media = await prepareUploadedMedia(body, mimeType!, input.filename, actorId, initial.ownerId, input.projectId, deadline.signal);
    }
    await lock.check();
    const result = await finalTransaction(actorId, input, sourceDigest, kind, media, source, lock, deadline.signal, authorization);
    preserve = true;
    return result;
  } catch (error) {
    if (error instanceof UnknownMediaCommitError) preserve = true;
    if (media && !preserve) await importedMediaIdentity(media).file.cleanup();
    if (error && typeof error === 'object' && 'code' in error && ['55P03', '57014', '40P01'].includes(String(error.code))) {
      throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
    }
    throw error;
  } finally {
    release?.();
    try { await lock?.release(); } finally { deadline.dispose(); }
  }
}
export async function importDocumentUpload(actorId: string, request: Request): Promise<DocumentMediaImportResult> {
  const { metadata, mimeType } = parseUploadHeaders(request.headers);
  return executeImport(actorId, metadata, request, mimeType);
}
export async function adoptDocumentTaskResult(actorId: string, value: unknown, signal?: AbortSignal,
  privateVersion?: PreparedPrivateTaskVersion): Promise<DocumentMediaImportResult> {
  const input = parseMediaAdoption(value);
  if (input.taskId.startsWith('image_edit_')) {
    const capability = await prepareTaskPublication(actorId, input.taskId, input.projectId);
    if (!capability || !isDeepStrictEqual(input, taskPublicationSnapshot(capability).requests[input.outputIndex])) conflict();
    return publishPreparedDocumentTaskOutput(capability, input.outputIndex, signal);
  }
  return executeImport(actorId, input, new Request('http://localhost/internal-media-import', { signal }), undefined, undefined, privateVersion);
}

export async function importDocumentAssetVersion(actorId: string, value: unknown, signal?: AbortSignal): Promise<DocumentMediaImportResult> {
  const input = parseMediaVersionImport(value);
  if (signal) assertMediaActive(signal);
  const initial = await authorizedResult(actorId, input, {});
  if (signal) assertMediaActive(signal);
  if (initial.row && initial.taskVersionInput) return replay(initial.row, digest({ kind: 'task', input: initial.taskVersionInput }), 'task');
  if (!initial.row) {
    const taskInput = await resolvePrivateTaskVersion(actorId, input);
    if (taskInput) return adoptDocumentTaskResult(actorId, taskInput.input, signal, taskInput.source);
  }
  return executeImport(actorId, input, new Request('http://localhost/internal-media-import', { signal }));
}

export async function publishDocumentTaskOutput(actorId: string, taskId: string, outputIndex: number,
  signal?: AbortSignal): Promise<DocumentMediaImportResult> {
  const capability = await prepareTaskPublication(actorId, taskId);
  if (!capability) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT');
  return publishPreparedDocumentTaskOutput(capability, outputIndex, signal);
}

/** Internal orchestration entry; only the DB-minted WeakMap capability is accepted. */
export async function publishPreparedDocumentTaskOutput(capability: PreparedTaskPublication, outputIndex: number,
  signal?: AbortSignal): Promise<DocumentMediaImportResult> {
  if (!Number.isSafeInteger(outputIndex) || outputIndex < 0) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT');
  const snapshot = taskPublicationSnapshot(capability);
  const input = snapshot.requests[outputIndex];
  if (!input) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_CONFLICT');
  return executeImport(snapshot.access.actorId, input, new Request('http://localhost/internal-task-publication', { signal }), undefined, capability);
}

declare const commitBrand: unique symbol;

/** Verify legacy prefixes through the same command/lineage reader plus publication
 * metadata and ordered parents. A marker alone is never durable source authority. */
async function publishedTaskRows(client: PoolClient, capability: PreparedTaskPublication): Promise<Array<DocumentMediaImportResult | undefined>> {
  const snapshot = taskPublicationSnapshot(capability);
  const { actorId, ownerId, projectId } = snapshot.access;
  await assertTaskPublication(client, capability);
  const results: Array<DocumentMediaImportResult | undefined> = [];
  for (const [index, input] of snapshot.requests.entries()) {
    const row = await resultRow(client, actorId, input, ownerId);
    if (!row) { results.push(undefined); continue; }
    // Historical publication digests used the DB-minted request field order.
    // Keep that identity; public batch/version callers still parse their input.
    const receipt = await readMediaChild(client, actorId, ownerId, input, projectId);
    const output = snapshot.outputs[index];
    const version = (await client.query(`SELECT task_id,provider_id,model_id,metadata,availability
      FROM wujie_asset_versions WHERE id=$1 AND asset_id=$2 AND owner_id=$3 AND project_id=$4`,
      [receipt.assetVersionId, receipt.assetReference.assetId, ownerId, projectId])).rows[0];
    const expectedMetadata = { source: 'document-media-import', sourceVersionIds: output.intent.parentVersionIds,
      ...(output.role ? { outputRole: output.role, outputIndex: index } : {}) };
    const provenance = snapshot.task.id.startsWith('ordinary_') || 'ordinaryGeneration' in snapshot.task.result
      ? ordinaryOutputIdentity(snapshot.task, index, snapshot.task.request_digest) : undefined;
    if (!version || version.task_id !== snapshot.task.id || version.availability !== 'ready'
      || version.provider_id !== (output.providerId ?? provenance?.providerId ?? snapshot.task.provider_id)
      || version.model_id !== (output.modelId ?? provenance?.modelId ?? snapshot.task.model)
      || !isDeepStrictEqual(version.metadata, expectedMetadata)) conflict();
    const parents = (await client.query(`SELECT parent_version_id,parent_order,asset_id,owner_id,project_id
      FROM wujie_asset_version_parents WHERE version_id=$1 ORDER BY parent_order,parent_version_id`, [receipt.assetVersionId])).rows;
    if (parents.length !== output.intent.parentVersionIds.length || parents.some((parent, order) =>
      parent.parent_version_id !== output.intent.parentVersionIds[order] || parent.parent_order !== order
      || parent.asset_id !== receipt.assetReference.assetId || parent.owner_id !== ownerId || parent.project_id !== projectId)) conflict();
    if (output.intent.projectionMode === 'revision') {
      const parent = (await client.query('SELECT asset_id FROM wujie_asset_versions WHERE id=$1 AND owner_id=$2 AND project_id=$3',
        [output.intent.parentVersionIds[0], ownerId, projectId])).rows[0];
      if (!parent || parent.asset_id !== receipt.assetReference.assetId) conflict();
    }
    results.push(receipt);
  }
  return results;
}

async function publishedTaskMarker(client: PoolClient, capability: PreparedTaskPublication,
  rows: Array<DocumentMediaImportResult | undefined>, requireComplete: boolean): Promise<boolean> {
  const { access } = taskPublicationSnapshot(capability);
  const marker = (await client.query("SELECT result->'assetProjection' AS marker FROM cloud_tasks WHERE id=$1 AND user_id=$2",
    [access.taskId, access.actorId])).rows[0]?.marker;
  const completed = marker?.status === 'completed';
  if (completed) {
    if (rows.some(row => !row)) conflict();
    const references = rows.map(row => row!.assetReference);
    if (!isDeepStrictEqual(marker.references, references)
      || !isDeepStrictEqual(marker.versionIds, references.map(ref => ref.assetVersionId))) conflict();
  }
  if (requireComplete && !completed) conflict();
  return completed;
}

async function readPublishedTaskBatch(capability: PreparedTaskPublication, requireComplete: boolean = false): Promise<{
  rows: Array<DocumentMediaImportResult | undefined>; completed: boolean;
}> {
  const client = await getPool().connect(); let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const rows = await publishedTaskRows(client, capability);
    const completed = await publishedTaskMarker(client, capability, rows, requireComplete);
    await client.query('COMMIT');
    return { rows, completed };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

/** All outputs of one DB-minted publication, composed through the existing writer.
 * The legacy single-output API keeps its own key/commit behavior. Both hold the
 * same sorted output locks; no caller-supplied source, owner or validator exists. */
export async function publishPreparedDocumentTaskBatch(capability: PreparedTaskPublication,
  signal?: AbortSignal): Promise<DocumentMediaImportResult['assetReference'][]> {
  const snapshot = taskPublicationSnapshot(capability);
  if (!snapshot.requests.length) return [];
  const { actorId, ownerId, projectId, taskId } = snapshot.access;
  const deadline = mediaDeadline(signal);
  let lock: ImportLock | undefined;
  const media: Array<{ input: MediaAdoptionRequest; source: MediaSource; media: PreparedImportedMedia }> = [];
  let preserve = false;
  try {
    assertMediaActive(deadline.signal);
    // One advisory connection holds all deterministically sorted single-output keys.
    lock = await acquireKeys(actorId, snapshot.requests, deadline.signal);
    const initial = await readPublishedTaskBatch(capability);
    if (initial.completed) return initial.rows.map(row => row!.assetReference);
    let retainedBytes = 0;
    for (const [index, input] of snapshot.requests.entries()) {
      assertMediaActive(deadline.signal);
      if (initial.rows[index]) continue;
      const source = await prepareMediaTaskSource(actorId, input, capability);
      // Reserve actual read ceilings for RAM and a separate cumulative ceiling for
      // every owned prepared file; releasing RAM never releases the batch budget.
      const ceiling = mediaSourceLimit(source);
      const release = reserveMediaPreparation(ceiling, deadline.signal);
      try {
        const preparedMedia = await prepareAdoptedMedia(source, actorId, ownerId, projectId, deadline.signal);
        media.push({ input, source, media: preparedMedia });
        const bytes = importedMediaIdentity(preparedMedia).file.byteSize;
        if (!Number.isSafeInteger(bytes) || !bytes || bytes < 1 || retainedBytes + bytes > VIDEO_IMPORT_LIMIT)
          throw new DocumentMediaError('DOCUMENT_MEDIA_TOO_LARGE');
        retainedBytes += bytes;
        assertMediaActive(deadline.signal);
      } finally { release(); }
    }
    // One mutable opaque preparation binds each actual new version, so all
    // command pre/post checks still see all preceding children in this transaction.
    const prepared = media.length ? await prepareDocumentAssetsForImport(actorId, projectId, media[0].input.command, deadline.signal) : undefined;
    const client = await getPool().connect();
    let sent = false; let released = false; let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
      await lockAssetGraphWriteGate(client, 'shared');
      // UPDATE before any task SHARE avoids concurrent marker writer upgrades.
      await client.query('SELECT 1 FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE', [taskId, actorId]);
      await readTaskPublicationAccess(client, actorId, taskId);
      const projects = [...new Set([projectId, ...media.map(entry => mediaSourceProject(entry.source))])].sort();
      for (const project of projects) {
        const row = await client.query("SELECT id FROM wujie_projects WHERE id=$1 AND status='active' FOR UPDATE NOWAIT", [project]);
        if (row.rowCount !== 1) { if (project === projectId) throw new DocumentAccessError(); conflict(); }
      }
      await lock.check();
      const before = await publishedTaskRows(client, capability);
      for (const [index, prior] of initial.rows.entries()) {
        if (!isDeepStrictEqual(prior, before[index])) conflict();
      }
      const authorization: ImportAuthorization = { publication: capability };
      for (const entry of media) {
        await writePreparedMediaInTransaction(client, actorId, entry.input, digest({ kind: 'task', input: entry.input }),
          'task', entry.media, entry.source, prepared!, deadline.signal, authorization, true);
      }
      // The original strict source snapshots and opaque PreparedAssets checks
      // remain in force for every child before the sole intentional head change.
      for (const entry of media) await assertMediaTaskSource(client, actorId, entry.input, entry.source);
      const rows = await publishedTaskRows(client, capability);
      if (rows.some(row => !row)) conflict();
      const heads = new Map<string, string>();
      for (const [index, row] of rows.entries()) {
        if (snapshot.outputs[index].intent.projectionMode === 'revision')
          heads.set(row!.assetReference.assetId, row!.assetVersionId);
      }
      for (const [assetId, versionId] of heads)
        await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [assetId, versionId]);
      await assertTaskPublication(client, capability);
      const references = rows.map(row => row!.assetReference);
      await client.query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{assetProjection}',$3::jsonb,true)
        WHERE id=$1 AND user_id=$2 AND status='completed'
          AND COALESCE(result->'assetProjection'->>'status','') <> 'completed'`,
        [taskId, actorId, JSON.stringify({ status: 'completed', references,
          versionIds: references.map(ref => ref.assetVersionId), completedAt: new Date().toISOString() })]);
      await assertTaskPublication(client, capability);
      await publishedTaskMarker(client, capability, rows, true);
      await lock.check();
      assertMediaActive(deadline.signal);
      sent = true; await client.query('COMMIT');
      preserve = true; return references;
    } catch (error) {
      if (sent) {
        preserve = true; client.release(true); released = true;
        try {
          const recovered = await readPublishedTaskBatch(capability, true);
          return recovered.rows.map(row => row!.assetReference);
        } catch { throw new UnknownMediaCommitError(); }
      }
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { if (!released) client.release(discard); }
  } catch (error) {
    if (!preserve) {
      const failures: unknown[] = [];
      for (const entry of media) {
        try { await importedMediaIdentity(entry.media).file.cleanup(); } catch (failure) { failures.push(failure); }
      }
      if (failures.length) throw new AggregateError([error, ...failures], 'DOCUMENT_MEDIA_BATCH_CLEANUP_FAILED');
    }
    if (error && typeof error === 'object' && 'code' in error && ['55P03', '57014', '40P01'].includes(String(error.code)))
      throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
    throw error;
  } finally {
    try { await lock?.release(); }
    finally { deadline.dispose(); }
  }
}
export interface PreparedDocumentMediaCommit { readonly [commitBrand]: true }
interface PreparedCommit {
  actorId: string; input: MediaVersionImportRequest | MediaAdoptionRequest; kind: 'task' | 'version';
  media: PreparedImportedMedia; source: MediaSource; authorization: ImportAuthorization; sourceDigest: string;
}
const mediaCommits = new WeakMap<PreparedDocumentMediaCommit, PreparedCommit>();
function preparedCommit(capability: PreparedDocumentMediaCommit): PreparedCommit {
  const commit = mediaCommits.get(capability);
  if (!commit) conflict();
  return commit;
}
/** Same DB-derived source / exact image_edit preparation as the single entry,
 * with sequential bounded media IO outside the eventual batch transaction. */
export async function prepareDocumentVersionForBatch(actorId: string, value: unknown,
  signal: AbortSignal): Promise<PreparedDocumentMediaCommit> {
  const versionInput = parseMediaVersionImport(value);
  assertMediaActive(signal);
  let input: MediaVersionImportRequest | MediaAdoptionRequest = versionInput;
  let authorization: ImportAuthorization = {};
  const initial = await authorizedResult(actorId, versionInput, authorization);
  if (initial.row) conflict(); // A child must never collide with a single/root namespace.
  const privateTask = await resolvePrivateTaskVersion(actorId, versionInput);
  if (privateTask) {
    input = parseMediaAdoption(privateTask.input);
    if (input.taskId.startsWith('image_edit_')) {
      const publication = await prepareTaskPublication(actorId, input.taskId, input.projectId);
      if (!publication || !isDeepStrictEqual(input, taskPublicationSnapshot(publication).requests[input.outputIndex])) conflict();
      authorization = { publication };
    }
  }
  const kind = 'taskId' in input ? 'task' : 'version';
  const source = 'taskId' in input
    ? await prepareMediaTaskSource(actorId, input, authorization.publication, authorization.publication ? undefined : privateTask?.source)
    : await prepareMediaVersionSource(actorId, input);
  const release = reserveMediaPreparation(mediaSourceLimit(source), signal);
  let media: PreparedImportedMedia | undefined;
  try {
    media = await prepareAdoptedMedia(source, actorId, initial.ownerId, input.projectId, signal);
    assertMediaActive(signal);
    const capability = Object.freeze({}) as PreparedDocumentMediaCommit;
    mediaCommits.set(capability, { actorId, input, source, media, authorization, kind, sourceDigest: digest({ kind, input }) });
    return capability;
  } catch (error) {
    if (media) await importedMediaIdentity(media).file.cleanup();
    throw error;
  } finally { release(); }
}
/** A detached description for sorted locks / durable lineage, not authority. */
export function preparedDocumentMediaCommitIdentity(capability: PreparedDocumentMediaCommit): {
  actorId: string; input: MediaVersionImportRequest | MediaAdoptionRequest; sourceProjectId: string;
  sourceDigest: string; kind: 'task' | 'version'; byteSize: number;
} {
  const commit = preparedCommit(capability);
  const byteSize = importedMediaIdentity(commit.media).file.byteSize;
  if (typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize < 1) conflict();
  return { actorId: commit.actorId, input: structuredClone(commit.input), sourceProjectId: mediaSourceProject(commit.source),
    sourceDigest: commit.sourceDigest, kind: commit.kind, byteSize };
}
export async function cleanupPreparedDocumentMediaCommit(capability: PreparedDocumentMediaCommit): Promise<void> {
  await importedMediaIdentity(preparedCommit(capability).media).file.cleanup();
}
export async function commitPreparedDocumentMediaInTransaction(client: PoolClient, actorId: string,
  capability: PreparedDocumentMediaCommit, prepared: PreparedDocumentAssets,
  signal: AbortSignal): Promise<DocumentMediaImportResult> {
  const commit = preparedCommit(capability);
  if (commit.actorId !== actorId) conflict();
  return writePreparedMediaInTransaction(client, actorId, commit.input, commit.sourceDigest, commit.kind,
    commit.media, commit.source, prepared, signal, commit.authorization);
}

/** Authorized batch replay uses durable child/lineage identity, not live source rows. */
export async function readDocumentMediaBatchChild(client: PoolClient, actorId: string, ownerId: string,
  value: unknown, sourceProjectId: string): Promise<DocumentMediaImportResult> {
  const input = value && typeof value === 'object' && 'taskId' in value ? parseMediaAdoption(value) : parseMediaVersionImport(value);
  return readMediaChild(client, actorId, ownerId, input, sourceProjectId);
}
async function readMediaChild(client: PoolClient, actorId: string, ownerId: string,
  input: MediaAdoptionRequest | MediaVersionImportRequest, sourceProjectId: string): Promise<DocumentMediaImportResult> {
  const kind = 'taskId' in input ? 'task' : 'version';
  const sourceDigest = digest({ kind, input });
  const row = await resultRow(client, actorId, input, ownerId);
  if (!row) conflict();
  const receipt = replay(row, sourceDigest, kind);
  const child = (await client.query<{ request_digest: string; batch_manifest: unknown }>(
    'SELECT request_digest,batch_manifest FROM wujie_canvas_asset_commands WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3',
    [actorId, input.projectId, input.idempotencyKey])).rows;
  const command = parseDocumentAssetCommandRequest({ projectId: input.projectId, idempotencyKey: input.idempotencyKey,
    command: { ...input.command, assetVersionId: receipt.assetVersionId } }).command;
  if (child.length !== 1 || child[0].batch_manifest !== null || child[0].request_digest !== digest(command)) conflict();
  const lineage = (await client.query<{ source_project_id: string; source_version_id: string;
    task_id: string | null; output_index: number | null; source_request_digest: string }>(`SELECT source_project_id,source_version_id,task_id,output_index,source_request_digest
    FROM wujie_canvas_media_lineage WHERE target_version_id=$1 AND target_asset_id=$2 AND target_owner_id=$3
      AND target_project_id=$4 AND actor_id=$5 AND source_kind=$6`,
    [receipt.assetVersionId, receipt.assetReference.assetId, ownerId, input.projectId, actorId, kind])).rows;
  if (lineage.length !== 1 || lineage[0].source_project_id !== sourceProjectId
    || lineage[0].source_version_id !== (input.sourceVersionId ?? null) || lineage[0].source_request_digest !== sourceDigest
    || lineage[0].task_id !== ('taskId' in input ? input.taskId : null)
    || lineage[0].output_index !== ('outputIndex' in input ? input.outputIndex : null)) conflict();
  return receipt;
}

import {workflowImageGridPreparationIdentity,workflowImageGridDocumentMedia,assertWorkflowImageGridPreparationInTransaction,
  type WorkflowImageGridPreparationIdentity,type PreparedWorkflowImageGrid} from '../workflow-image-preparation';
import type {MediaImportCommand} from "@/lib/collaboration/document-media-request";
import type {WorkflowImageGridPublicationValue} from "../workflow-image-publication";
export interface WorkflowDocumentDerivedGridResult extends WorkflowImageGridPublicationValue {documentSequence:number}
interface DerivedGridContext {ownerId:string;sourceProjectId:string;sourceVersionId:string;metadata:Record<string,unknown>;runtimeCell?:true}
interface DerivedGridIntent {
  identity:WorkflowImageGridPreparationIdentity;ownerId:string;parentVersionId:string;
  root:string;digest:string;keys:string[];media:PreparedImportedMedia[];
}
interface DerivedGridRootRow {
  owner_id:string;placement_id:string;asset_id:string;asset_version_id:string;document_sequence:string;
  request_digest:string;source_request_digest:string|null;source_kind:string|null;batch_manifest:unknown;
}
interface DerivedGridItem {
  nodeId:string;cell:WorkflowImageGridPreparationIdentity['tiles'][number]['cell'];
  command:MediaImportCommand;sourceDigest:string;result:DocumentMediaImportResult;
}
interface DerivedGridManifest {
  kind:'workflow-image-grid';version:1;actorId:string;ownerId:string;projectId:string;workspaceId:string;
  operationId:string;sourceVersionId:string;digest:string;items:DerivedGridItem[];documentSequence:number;
}
function gridObject(value:unknown,keys:readonly string[]):Record<string,unknown> {
  const record=asRecord(value);
  if(!record||Object.keys(record).length!==keys.length||keys.some(key=>!Object.hasOwn(record,key)))conflict();
  return record;
}
function gridSequence(value:unknown):value is number {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
/** Actual WeakMap capabilities and the real actor are required before SQL. */
function derivedGridIntent(grid:PreparedWorkflowImageGrid,actorId:string):DerivedGridIntent {
  const identity=workflowImageGridPreparationIdentity(grid),{input,source}=identity;
  if(input.actorUserId!==actorId||source.access.kind!=='document'||source.access.actorUserId!==actorId
    ||source.access.projectId!==input.projectId||source.input.actorUserId!==actorId
    ||source.input.projectId!==input.projectId||source.input.workspaceId!==input.workspaceId
    ||source.input.entityId!==input.entityId||!source.version||!source.reference?.placementId
    ||!source.reference.entityId||source.version.ownerId!==source.access.ownerId
    ||source.version.projectId!==input.projectId||source.reference.assetId!==source.version.assetId
    ||source.reference.assetVersionId!==source.version.id||source.reference.kind!=='image'
    ||identity.legacyParentFile||identity.tiles.length<1||identity.tiles.length>64)conflict();
  const media=identity.tiles.map((tile,index)=>{
    const prepared=workflowImageGridDocumentMedia(grid,index),bound=importedMediaIdentity(prepared);
    if(bound.actorId!==actorId||bound.ownerId!==source.access.ownerId||bound.projectId!==input.projectId
      ||bound.kind!=='image'||importedMediaRevision(prepared)
      ||['url','availability','storageKey','checksum','mimeType','byteSize','width','height'].some(key=>
        bound.file[key as keyof typeof bound.file]!==tile.file[key as keyof typeof tile.file]))conflict();
    return prepared;
  });
  const root='batch-root:workflow-image-grid:v1:'+digest([actorId,input.projectId,input.workspaceId,input.operationId]);
  // Current canvas position and freshly minted staging IDs/URLs are not crop identity.
  const semantic=digest({version:1,actorId,ownerId:source.access.ownerId,projectId:input.projectId,
    workspaceId:input.workspaceId,operationId:input.operationId,sourceEntityId:input.entityId,
    source:{assetId:source.version.assetId,versionId:source.version.id,placementId:source.reference.placementId,
      entityId:source.reference.entityId,sha256:source.sha256,grantGeneration:source.access.grantGeneration},
    columns:input.columns,rows:input.rows,tiles:identity.tiles.map(tile=>({nodeId:tile.targetNodeId,cell:tile.cell,
      checksum:tile.file.checksum,mimeType:tile.file.mimeType,byteSize:tile.file.byteSize,width:tile.file.width,height:tile.file.height}))});
  return {identity,ownerId:source.access.ownerId,parentVersionId:source.version.id,root,digest:semantic,
    keys:identity.tiles.map((_,index)=>root+':tile:'+index),media};
}
function derivedGridMetadata(op:DerivedGridIntent,index:number):Record<string,unknown> {
  return {schema:'workflow-image-grid/v1',rootKey:op.root,operationDigest:op.digest,operationId:op.identity.input.operationId,
    workspaceId:op.identity.input.workspaceId,sourceEntityId:op.identity.input.entityId,sourceSha256:op.identity.source.sha256,
    index,targetNodeId:op.identity.tiles[index].targetNodeId,cell:op.identity.tiles[index].cell};
}
function derivedGridSourceDigest(op:DerivedGridIntent,index:number):string {return digest([op.digest,index,'derived-version']);}
async function lockDerivedGrid(client:PoolClient,grid:PreparedWorkflowImageGrid,op:DerivedGridIntent,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();await lockAssetGraphWriteGate(client,'shared');
  // Exclusive project lock precedes the original source SHARE fence; no lock upgrade.
  const locked=await client.query("SELECT 1 FROM wujie_projects WHERE id=$1 AND owner_id=$2 AND status='active' FOR UPDATE NOWAIT",
    [op.identity.input.projectId,op.ownerId]);
  if(locked.rowCount!==1)conflict();
  await assertWorkflowImageGridPreparationInTransaction(client,grid,signal);signal.throwIfAborted();
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',['wujie-document-derived-grid',op.root]);
}
async function derivedGridRow(client:PoolClient,op:DerivedGridIntent,key:string):Promise<DerivedGridRootRow|undefined> {
  const rows=(await client.query<DerivedGridRootRow>(`SELECT owner_id,placement_id,asset_id,asset_version_id,document_sequence::text,
    request_digest,source_request_digest,source_kind,batch_manifest FROM wujie_canvas_asset_commands
    WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`,
    [op.identity.input.actorUserId,op.identity.input.projectId,key])).rows;
  if(rows.length>1)conflict();return rows[0];
}
function derivedGridManifest(row:DerivedGridRootRow,op:DerivedGridIntent):DerivedGridManifest {
  const value=gridObject(row.batch_manifest,['kind','version','actorId','ownerId','projectId','workspaceId',
    'operationId','sourceVersionId','digest','items','documentSequence']),{input}=op.identity;
  if(value.kind!=='workflow-image-grid'||value.version!==1||value.actorId!==input.actorUserId
    ||value.ownerId!==op.ownerId||value.projectId!==input.projectId||value.workspaceId!==input.workspaceId
    ||value.operationId!==input.operationId||value.sourceVersionId!==op.parentVersionId||value.digest!==op.digest
    ||row.owner_id!==op.ownerId||row.source_kind!==null||row.request_digest!==op.digest
    ||row.source_request_digest!==op.digest||!gridSequence(value.documentSequence)
    ||String(value.documentSequence)!==row.document_sequence||!Array.isArray(value.items)
    ||value.items.length!==op.identity.tiles.length)conflict();
  const items:DerivedGridItem[]=value.items.map((raw,index)=>{
    const item=gridObject(raw,['nodeId','cell','command','sourceDigest','result']),tile=op.identity.tiles[index];
    if(item.nodeId!==tile.targetNodeId||!isDeepStrictEqual(item.cell,tile.cell)
      ||item.sourceDigest!==derivedGridSourceDigest(op,index))conflict();
    let command:MediaImportCommand;
    try{command=parseMediaVersionImport({projectId:input.projectId,sourceVersionId:op.parentVersionId,
      idempotencyKey:op.keys[index],command:item.command}).command;}catch{conflict();}
    if(command.action!=='attach'||!isDeepStrictEqual(command,item.command))conflict();
    const result=gridObject(item.result,['placementId','assetVersionId','documentSequence','assetReference']);
    const ref=gridObject(result.assetReference,['assetId','assetVersionId','placementId','entityId','url','kind']);
    if(!gridSequence(result.documentSequence)||result.documentSequence>Number(value.documentSequence)||ref.kind!=='image'
      ||['assetId','assetVersionId','placementId','entityId','url'].some(key=>typeof ref[key]!=='string'||!(ref[key] as string).trim())
      ||result.assetVersionId!==ref.assetVersionId||result.placementId!==ref.placementId)conflict();
    return {nodeId:tile.targetNodeId,cell:tile.cell,command,sourceDigest:derivedGridSourceDigest(op,index),
      result:result as unknown as DocumentMediaImportResult};
  });
  const first=items[0].result;
  if(Number(value.documentSequence)!==Math.max(...items.map(item=>item.result.documentSequence))
    ||row.placement_id!==first.placementId||row.asset_version_id!==first.assetVersionId||row.asset_id!==first.assetReference.assetId)conflict();
  return {...value,items} as unknown as DerivedGridManifest;
}
function derivedGridValue(op:DerivedGridIntent,sealed:DerivedGridManifest):WorkflowDocumentDerivedGridResult {
  const {input}=op.identity;
  return {projectId:input.projectId,workspaceId:input.workspaceId,operationId:input.operationId,
    parentVersionId:op.parentVersionId,documentSequence:sealed.documentSequence,
    tiles:sealed.items.map(item=>({nodeId:item.nodeId,cell:structuredClone(item.cell),reference:{...item.result.assetReference}}))};
}
/** Broken children, deleted outputs and altered lineage never imply implicit repair. */
async function inspectDerivedGrid(client:PoolClient,op:DerivedGridIntent,signal:AbortSignal):Promise<WorkflowDocumentDerivedGridResult|undefined> {
  const root=await derivedGridRow(client,op,op.root),{input}=op.identity;
  if(!root){for(const key of op.keys){signal.throwIfAborted();if(await derivedGridRow(client,op,key))conflict();}return undefined;}
  const sealed=derivedGridManifest(root,op),loaded=await loadDocumentInTransaction(client,input.projectId);
  try{
    if(loaded.sequence<sealed.documentSequence)conflict();
    const projection=readCanvasDocument(loaded.doc),storage=createAssetStorageTransaction(client);
    for(const [index,item]of sealed.items.entries()){
      signal.throwIfAborted();
      const request=parseMediaVersionImport({projectId:input.projectId,sourceVersionId:op.parentVersionId,
        idempotencyKey:op.keys[index],command:item.command});
      const row=await resultRow(client,input.actorUserId,request,op.ownerId);
      if(!row||!isDeepStrictEqual(replay(row,item.sourceDigest,'version'),item.result))conflict();
      const child=await derivedGridRow(client,op,op.keys[index]);
      const command=parseDocumentAssetCommandRequest({projectId:input.projectId,idempotencyKey:op.keys[index],
        command:{...item.command,assetVersionId:item.result.assetVersionId}}).command;
      if(!child||child.owner_id!==op.ownerId||child.batch_manifest!==null||child.request_digest!==digest(command))conflict();
      const ref=item.result.assetReference,p=projection.placements[ref.placementId];
      if(!p||p.deleted||p.assetVersionId!==ref.assetVersionId)conflict();
      const canonical=(await client.query<{placement_id:string;asset_id:string;asset_version_id:string;entity_id:string;file_url:string;kind:string}>(
        `SELECT placement.id AS placement_id,version.asset_id,version.id AS asset_version_id,placement.entity_id,version.file_url,asset.kind
        FROM wujie_workspace_placements placement
        JOIN wujie_asset_versions version ON version.id=placement.asset_version_id AND version.asset_id=placement.asset_id
          AND version.owner_id=placement.owner_id AND version.project_id=placement.project_id
        JOIN wujie_assets asset ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
        JOIN wujie_projects project ON project.id=asset.project_id AND project.owner_id=asset.owner_id
        WHERE placement.id=$1 AND placement.owner_id=$2 AND placement.project_id=$3 AND placement.asset_version_id=$4
          AND placement.status='active' AND placement.deleted_at IS NULL AND placement.workspace_kind='canvas'
          AND placement.workspace_id IN ($3,'canvas:' || $3) AND placement.entity_type='canvas-image'
          AND version.availability='ready' AND asset.status='active' AND project.status='active' AND asset.kind='image'
        FOR SHARE OF placement,version,asset,project`,[ref.placementId,op.ownerId,input.projectId,ref.assetVersionId])).rows;
      if(canonical.length!==1||!isDeepStrictEqual({assetId:canonical[0].asset_id,assetVersionId:canonical[0].asset_version_id,
        placementId:canonical[0].placement_id,entityId:canonical[0].entity_id,url:canonical[0].file_url,kind:canonical[0].kind},ref))conflict();
      const version=await storage.findVersion(op.ownerId,input.projectId,ref.assetVersionId),file=op.identity.tiles[index].file;
      if(!version||version.assetId!==ref.assetId||version.ownerId!==op.ownerId||version.projectId!==input.projectId
        ||version.file.url!==ref.url||version.file.availability!=='ready'||version.taskId
        ||!isDeepStrictEqual(version.parentVersionIds,[op.parentVersionId])
        ||!isDeepStrictEqual(version.metadata?.sourceVersionIds,[op.parentVersionId])
        ||!isDeepStrictEqual(version.metadata?.workflowImageGrid,derivedGridMetadata(op,index))
        ||['checksum','mimeType','byteSize','width','height'].some(key=>
          version.file[key as keyof typeof version.file]!==file[key as keyof typeof file]))conflict();
      const lineage=(await client.query<{source_project_id:string;source_version_id:string;task_id:string|null;
        output_index:number|null;source_kind:string;source_request_digest:string}>(`SELECT source_project_id,source_version_id,
          task_id,output_index,source_kind,source_request_digest FROM wujie_canvas_media_lineage
        WHERE target_version_id=$1 AND target_asset_id=$2 AND target_owner_id=$3 AND target_project_id=$4 AND actor_id=$5 AND source_kind=$6`,
        [ref.assetVersionId,ref.assetId,op.ownerId,input.projectId,input.actorUserId,'version'])).rows;
      if(lineage.length!==1||lineage[0].source_kind!=='version'||lineage[0].source_project_id!==input.projectId
        ||lineage[0].source_version_id!==op.parentVersionId||lineage[0].task_id!==null||lineage[0].output_index!==null
        ||lineage[0].source_request_digest!==item.sourceDigest)conflict();
    }
    signal.throwIfAborted();return derivedGridValue(op,sealed);
  }finally{loaded.doc.destroy();}
}
/** Pending receipt only: the caller owns BEGIN/COMMIT/ROLLBACK. */
export async function commitPreparedDocumentDerivedGridInTransaction(client:PoolClient,actorId:string,grid:PreparedWorkflowImageGrid,
  assets:PreparedDocumentAssets,commands:readonly MediaImportCommand[],signal:AbortSignal):Promise<WorkflowDocumentDerivedGridResult> {
  const op=derivedGridIntent(grid,actorId),{input}=op.identity;
  await lockDerivedGrid(client,grid,op,signal);
  const prior=await inspectDerivedGrid(client,op,signal);if(prior)return prior;
  if(commands.length!==op.keys.length)conflict();
  const items:DerivedGridItem[]=[];
  for(const [index,raw]of commands.entries()){
    signal.throwIfAborted();
    const request=parseMediaVersionImport({projectId:input.projectId,sourceVersionId:op.parentVersionId,
      idempotencyKey:op.keys[index],command:raw});
    if(request.command.action!=='attach')conflict();
    const sourceDigest=derivedGridSourceDigest(op,index);
    const result=await writePreparedMediaInTransaction(client,actorId,request,sourceDigest,'version',op.media[index],
      undefined,assets,signal,{},false,{ownerId:op.ownerId,sourceProjectId:input.projectId,
        sourceVersionId:op.parentVersionId,metadata:derivedGridMetadata(op,index)});
    items.push({nodeId:op.identity.tiles[index].targetNodeId,cell:op.identity.tiles[index].cell,
      command:request.command,sourceDigest,result});
  }
  signal.throwIfAborted();
  const sealed:DerivedGridManifest={kind:'workflow-image-grid',version:1,actorId,ownerId:op.ownerId,projectId:input.projectId,
    workspaceId:input.workspaceId,operationId:input.operationId,sourceVersionId:op.parentVersionId,digest:op.digest,items,
    documentSequence:Math.max(...items.map(item=>item.result.documentSequence))},first=items[0].result;
  await client.query(`INSERT INTO wujie_canvas_asset_commands
    (actor_id,project_id,idempotency_key,request_digest,owner_id,placement_id,asset_id,asset_version_id,document_sequence,source_request_digest,batch_manifest)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4,$10::jsonb)`,
    [actorId,input.projectId,op.root,op.digest,op.ownerId,first.placementId,first.assetReference.assetId,
      first.assetVersionId,sealed.documentSequence,JSON.stringify(sealed)]);
  signal.throwIfAborted();return derivedGridValue(op,sealed);
}
export async function readPreparedDocumentDerivedGridInTransaction(client:PoolClient,actorId:string,grid:PreparedWorkflowImageGrid,
  signal:AbortSignal):Promise<WorkflowDocumentDerivedGridResult|undefined> {
  const op=derivedGridIntent(grid,actorId);await lockDerivedGrid(client,grid,op,signal);
  return inspectDerivedGrid(client,op,signal);
}

import {getAgentExecutionFence} from '@/lib/agent-runtime/execution-fence';
import {resolveInlineSubgraph,type ExecutionResult} from '@/lib/workflow-engine';
import type {CanvasDocumentProjection} from '@/lib/collaboration/canvas-document';
import {workflowImageCellPreparationIdentity,workflowImageCellDocumentMedia,assertWorkflowImageCellPreparationInTransaction,
  type PreparedWorkflowImageCell,type WorkflowImageCellPreparationIdentity} from '../workflow-image-preparation';
import {assertWorkflowImageExecutionInTransaction} from '../workflow-image-execution-fence';
import {workflowImageRuntimeOperationId,workflowImageRuntimeTarget,readWorkflowImageRuntimeParentInTransaction,
  assertWorkflowImageRuntimeDurableSource,writeWorkflowImageRuntimeNodeCheckpoint,matchWorkflowImageRuntimeNodeCheckpoint,
  type WorkflowImageCellRuntimeExpectation,type WorkflowImageCellReceiptExpectation,type WorkflowImageLogicalExecution} from '../workflow-image-runtime-publication';
import type {WorkflowDocumentRuntimeCellValue} from '../workflow-image-document-runtime-publication';
import type {AssetVersion} from '@/lib/asset-core/types';
import {readManagedAssetVersionBytes} from '@/lib/asset-core/managed-media-read';
interface RuntimeCellReadIntent {identity:WorkflowImageCellPreparationIdentity;held:WorkflowImageCellReceiptExpectation;ownerId:string;parentVersionId:string;
  root:string;key:string;digest:string;sourceDigest:string}
interface RuntimeCellIntent extends RuntimeCellReadIntent {held:WorkflowImageCellRuntimeExpectation;media:PreparedImportedMedia}
interface RuntimeCellRow extends DerivedGridRootRow {actor_id:string;project_id:string;idempotency_key:string}
interface RuntimeCellManifest {kind:'workflow-image-runtime-cell';version:1;actorId:string;ownerId:string;projectId:string;workspaceId:string;targetNodeId:string;
  operationId:string;sourceVersionId:string;digest:string;items:[DerivedGridItem];documentSequence:number}
declare const runtimeReplayBrand:unique symbol;
declare const runtimeVerifiedReplayBrand:unique symbol;
export interface PreparedDocumentRuntimeCellReplay {readonly [runtimeReplayBrand]:true}
export interface VerifiedDocumentRuntimeCellReplay {readonly [runtimeVerifiedReplayBrand]:true}
export type DocumentRuntimeCellTransactionResult={status:'pending';value:WorkflowDocumentRuntimeCellValue}|{status:'verify-media';replay:PreparedDocumentRuntimeCellReplay};
interface RuntimeReplaySnapshot {root:string;digest:string;contextDigest:string;version:AssetVersion;manifest:RuntimeCellManifest;node:ExecutionResult}
interface RuntimeReplayRecord {cell:PreparedWorkflowImageCell;snapshot:RuntimeReplaySnapshot;signal:AbortSignal}
const pendingRuntimeReplays=new WeakMap<PreparedDocumentRuntimeCellReplay,RuntimeReplayRecord>();
const verifiedRuntimeReplays=new WeakMap<VerifiedDocumentRuntimeCellReplay,RuntimeReplayRecord>();
/** Real bytes are read outside every SQL transaction. A plain snapshot or a
 * caller-supplied validation callback cannot mint this verification proof. */
export async function verifyPreparedDocumentRuntimeCellReplay(replay:PreparedDocumentRuntimeCellReplay,signal:AbortSignal):Promise<VerifiedDocumentRuntimeCellReplay> {
  const record=pendingRuntimeReplays.get(replay);if(!record)conflict();
  const active=():void=>{record.signal.throwIfAborted();signal.throwIfAborted();workflowImageCellPreparationIdentity(record.cell);};active();
  const version=record.snapshot.version,media=await readManagedAssetVersionBytes(version,'image',{signal,maxBytes:32*1024*1024});active();
  if(media.mimeType!==version.file.mimeType||media.bytes.length!==version.file.byteSize||media.totalBytes!==media.bytes.length
    ||createHash('sha256').update(media.bytes).digest('hex')!==version.file.checksum)conflict();
  const proof=Object.freeze({}) as VerifiedDocumentRuntimeCellReplay;
  verifiedRuntimeReplays.set(proof,{cell:record.cell,snapshot:structuredClone(record.snapshot),signal:record.signal});return proof;
}
function cellId(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/\p{Cc}/u.test(value);}
function runtimeRoot(actorId:string,projectId:string,workspaceId:string,operationId:string):string {return 'batch-root:workflow-image-runtime-cell:v1:'+digest([actorId,projectId,workspaceId,operationId]);}
function runtimeCellIntent(cell:PreparedWorkflowImageCell,actorId:string,expectation:WorkflowImageCellRuntimeExpectation):RuntimeCellIntent {
  const identity=workflowImageCellPreparationIdentity(cell),held=structuredClone(expectation),op=runtimeCellReadIntent(identity,actorId,held),source=identity.source,input=identity.input;
  const media=workflowImageCellDocumentMedia(cell),bound=importedMediaIdentity(media);
  if(bound.actorId!==actorId||bound.ownerId!==source.access.ownerId||bound.projectId!==input.projectId||bound.kind!=='image'||importedMediaRevision(media)
    ||['url','availability','storageKey','checksum','mimeType','byteSize','width','height'].some(key=>bound.file[key as keyof typeof bound.file]!==identity.tile.file[key as keyof typeof identity.tile.file]))conflict();
  return {...op,held,media};
}
function runtimeCellReadIntent(identity:WorkflowImageCellPreparationIdentity,actorId:string,held:WorkflowImageCellReceiptExpectation):RuntimeCellReadIntent {
  const {input,source}=identity,ex=held.execution,target=workflowImageRuntimeTarget(ex);
  if(input.actorUserId!==actorId||ex.actorUserId!==actorId||source.access.kind!=='document'||source.access.actorUserId!==actorId
    ||source.access.projectId!==input.projectId||ex.projectId!==input.projectId||input.workspaceId!==ex.workflowId||input.workspaceId!==target.workspaceId
    ||input.entityId!==target.entityId||input.targetNodeId!==target.entityId||source.input.actorUserId!==actorId||source.input.projectId!==input.projectId
    ||source.input.workspaceId!==input.workspaceId||source.input.entityId!==input.entityId||input.operationId!==workflowImageRuntimeOperationId(ex)
    ||!source.version||!source.reference?.placementId||!source.reference.entityId||source.version.ownerId!==source.access.ownerId
    ||source.version.projectId!==input.projectId||source.reference.assetId!==source.version.assetId||source.reference.assetVersionId!==source.version.id
    ||source.reference.kind!=='image'||identity.legacyParentFile)conflict();
  if(held.expectedTarget!==null&&(!asRecord(held.expectedTarget)||Object.keys(held.expectedTarget).sort().join(',')!=='assetId,assetVersionId,placementId'
    ||![held.expectedTarget.placementId,held.expectedTarget.assetId,held.expectedTarget.assetVersionId].every(cellId)))conflict();
  const semantic=digest({schema:'workflow-image-runtime-cell/v1',actorId,ownerId:source.access.ownerId,projectId:input.projectId,workspaceId:input.workspaceId,
    targetNodeId:input.targetNodeId,operationId:input.operationId,source:{assetId:source.version.assetId,versionId:source.version.id,placementId:source.reference.placementId,
      entityId:source.reference.entityId,sha256:source.sha256,grantGeneration:source.access.grantGeneration},cell:identity.tile.cell,
    file:{checksum:identity.tile.file.checksum,mimeType:identity.tile.file.mimeType,byteSize:identity.tile.file.byteSize,width:identity.tile.file.width,height:identity.tile.file.height}});
  const root=runtimeRoot(actorId,input.projectId,input.workspaceId,input.operationId);
  return {identity,held,ownerId:source.access.ownerId,parentVersionId:source.version.id,root,key:root+':cell',digest:semantic,sourceDigest:digest([semantic,'runtime-cell-version'])};
}
function runtimeCellMetadata(op:RuntimeCellReadIntent):Record<string,unknown> {return {schema:'workflow-image-runtime-cell/v1',rootKey:op.root,operationDigest:op.digest,
  operationId:op.identity.input.operationId,workspaceId:op.identity.input.workspaceId,targetNodeId:op.identity.input.targetNodeId,
  sourceSha256:op.identity.source.sha256,cell:op.identity.tile.cell};}
async function runtimeCellRow(client:PoolClient,actorId:string,projectId:string,key:string):Promise<RuntimeCellRow|undefined> {
  const rows=(await client.query<RuntimeCellRow>(`SELECT actor_id,project_id,idempotency_key,owner_id,placement_id,asset_id,asset_version_id,
    document_sequence::text,request_digest,source_request_digest,source_kind,batch_manifest FROM wujie_canvas_asset_commands
    WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`,[actorId,projectId,key])).rows;
  if(rows.length>1)conflict();return rows[0];
}
function runtimeManifest(row:RuntimeCellRow,op:RuntimeCellReadIntent,current:boolean):RuntimeCellManifest {
  const value=gridObject(row.batch_manifest,['kind','version','actorId','ownerId','projectId','workspaceId','targetNodeId','operationId','sourceVersionId','digest','items','documentSequence']);
  const {input}=op.identity;
  if(value.kind!=='workflow-image-runtime-cell'||value.version!==1||value.ownerId!==op.ownerId||value.projectId!==input.projectId
    ||value.workspaceId!==input.workspaceId||value.targetNodeId!==input.targetNodeId||!cellId(value.actorId)||!cellId(value.operationId)||!cellId(value.sourceVersionId)
    ||row.actor_id!==value.actorId||row.project_id!==value.projectId||row.owner_id!==op.ownerId||row.source_kind!==null
    ||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/u.test(value.digest)||row.request_digest!==value.digest||row.source_request_digest!==value.digest
    ||row.idempotency_key!==runtimeRoot(value.actorId,input.projectId,input.workspaceId,value.operationId)
    ||!gridSequence(value.documentSequence)||String(value.documentSequence)!==row.document_sequence||!Array.isArray(value.items)||value.items.length!==1)conflict();
  if(current&&(value.actorId!==input.actorUserId||value.operationId!==input.operationId||value.sourceVersionId!==op.parentVersionId||value.digest!==op.digest))conflict();
  const raw=gridObject(value.items[0],['nodeId','cell','command','sourceDigest','result']),cell=gridObject(raw.cell,['index','column','row','columns','rows','left','top','width','height']);
  if(raw.nodeId!==input.targetNodeId||!Object.values(cell).every(number=>typeof number==='number'&&Number.isSafeInteger(number)&&number>=0)
    ||Number(cell.width)<1||Number(cell.height)<1||Number(cell.columns)<1||Number(cell.rows)<1||Number(cell.columns)*Number(cell.rows)>64
    ||Number(cell.column)>=Number(cell.columns)||Number(cell.row)>=Number(cell.rows)||cell.index!==Number(cell.row)*Number(cell.columns)+Number(cell.column)
    ||current&&!isDeepStrictEqual(raw.cell,op.identity.tile.cell)||raw.sourceDigest!==digest([value.digest,'runtime-cell-version']))conflict();
  const request=parseMediaVersionImport({projectId:input.projectId,sourceVersionId:value.sourceVersionId,idempotencyKey:row.idempotency_key+':cell',command:raw.command});
  if(!isDeepStrictEqual(request.command,raw.command))conflict();
  const result=gridObject(raw.result,['placementId','assetVersionId','documentSequence','assetReference']),ref=gridObject(result.assetReference,['assetId','assetVersionId','placementId','entityId','url','kind']);
  if(!gridSequence(result.documentSequence)||result.documentSequence!==value.documentSequence||ref.kind!=='image'
    ||!['assetId','assetVersionId','placementId','entityId'].every(key=>cellId(ref[key]))||typeof ref.url!=='string'||!ref.url.trim()||ref.url.trim()!==ref.url
    ||result.assetVersionId!==ref.assetVersionId||result.placementId!==ref.placementId||row.placement_id!==ref.placementId
    ||row.asset_id!==ref.assetId||row.asset_version_id!==ref.assetVersionId)conflict();
  return {...value,items:[{nodeId:input.targetNodeId,cell:raw.cell,command:request.command,sourceDigest:raw.sourceDigest,result}]} as unknown as RuntimeCellManifest;
}
async function assertRuntimeChildReceipt(client:PoolClient,manifest:RuntimeCellManifest,op:RuntimeCellReadIntent):Promise<void> {
  const item=manifest.items[0],ref=item.result.assetReference,key=runtimeRoot(manifest.actorId,manifest.projectId,manifest.workspaceId,manifest.operationId)+':cell';
  const row=await runtimeCellRow(client,manifest.actorId,manifest.projectId,key);
  const command=parseDocumentAssetCommandRequest({projectId:manifest.projectId,idempotencyKey:key,command:{...item.command,assetVersionId:ref.assetVersionId}}).command;
  if(!row||row.owner_id!==op.ownerId||row.batch_manifest!==null||row.source_kind!=='version'||row.source_request_digest!==item.sourceDigest
    ||row.request_digest!==digest(command)||row.placement_id!==ref.placementId||row.asset_id!==ref.assetId||row.asset_version_id!==ref.assetVersionId
    ||row.document_sequence!==String(item.result.documentSequence))conflict();
}
async function activeRuntimeReference(client:PoolClient,op:RuntimeCellReadIntent,projection:CanvasDocumentProjection,placementId:string,derived=false):Promise<DocumentMediaImportResult['assetReference']> {
  const placed=projection.placements[placementId];if(!placed||placed.deleted)conflict();
  const rows=(await client.query<{placement_id:string;asset_id:string;asset_version_id:string;entity_id:string;file_url:string;kind:string;task_id:string|null;provider_id:string|null;model_id:string|null}>(
    `SELECT placement.id AS placement_id,version.asset_id,version.id AS asset_version_id,placement.entity_id,version.file_url,asset.kind,version.task_id,version.provider_id,version.model_id
    FROM wujie_workspace_placements placement
    JOIN wujie_asset_versions version ON version.id=placement.asset_version_id AND version.asset_id=placement.asset_id AND version.owner_id=placement.owner_id AND version.project_id=placement.project_id
    JOIN wujie_assets asset ON asset.id=version.asset_id AND asset.owner_id=version.owner_id AND asset.project_id=version.project_id
    JOIN wujie_projects project ON project.id=asset.project_id AND project.owner_id=asset.owner_id
    WHERE placement.id=$1 AND placement.owner_id=$2 AND placement.project_id=$3 AND placement.asset_version_id=$4
      AND placement.status='active' AND placement.deleted_at IS NULL AND placement.workspace_kind='canvas'
      AND placement.workspace_id IN ($3,'canvas:' || $3) AND placement.entity_type='canvas-image'
      AND version.availability='ready' AND asset.status='active' AND project.status='active' AND asset.kind='image'
    FOR SHARE OF placement,version,asset,project`,[placementId,op.ownerId,op.identity.input.projectId,placed.assetVersionId])).rows;
  if(rows.length!==1||derived&&[rows[0].task_id,rows[0].provider_id,rows[0].model_id].some(value=>value!==null))conflict();
  const row=rows[0];return {assetId:row.asset_id,assetVersionId:row.asset_version_id,placementId:row.placement_id,entityId:row.entity_id,url:row.file_url,kind:'image'};
}
function frozenRuntimeTarget(op:RuntimeCellIntent):Record<string,unknown>|null {
  let graph=op.held.execution.expectedGraph;
  for(const id of op.held.execution.subgraphPath){const container=graph.nodes.find(node=>node.id===id),nested=container?resolveInlineSubgraph(container):null;if(!nested)conflict();graph=nested;}
  const config=graph.nodes.find(node=>node.id===op.held.execution.nodeId)?.config;if(!config)conflict();
  if(config.projectId!==undefined&&config.projectId!==''&&config.projectId!==op.identity.input.projectId)conflict();
  const keys=['assetId','assetVersionId','placementId','entityId'];if(!keys.some(key=>config[key]!==undefined&&config[key]!==''))return null;
  if(!keys.every(key=>cellId(config[key])))conflict();return config;
}
async function runtimeTarget(client:PoolClient,op:RuntimeCellIntent,projection:CanvasDocumentProjection,sequence:number):Promise<DocumentMediaImportResult['assetReference']|null> {
  const {input}=op.identity;
  const heads=(await client.query<RuntimeCellRow>(`SELECT c.actor_id,c.project_id,c.idempotency_key,c.owner_id,c.placement_id,c.asset_id,c.asset_version_id,c.document_sequence::text,
    c.request_digest,c.source_request_digest,c.source_kind,c.batch_manifest FROM wujie_canvas_asset_commands c /* workflow-runtime-cell-head */
    WHERE c.project_id=$1 AND c.owner_id=$2 AND c.batch_manifest->>'kind'='workflow-image-runtime-cell'
      AND c.batch_manifest->>'workspaceId'=$3 AND c.batch_manifest->>'targetNodeId'=$4 ORDER BY c.document_sequence DESC LIMIT 1`,
    [input.projectId,op.ownerId,input.workspaceId,input.targetNodeId])).rows;
  let target:DocumentMediaImportResult['assetReference']|null=null;
  if(heads.length){const manifest=runtimeManifest(heads[0],op,false);if(manifest.documentSequence>sequence)conflict();await assertRuntimeChildReceipt(client,manifest,op);
    target=await activeRuntimeReference(client,op,projection,manifest.items[0].result.placementId);if(target.entityId!==manifest.items[0].result.assetReference.entityId)conflict();}
  else {const frozen=frozenRuntimeTarget(op);if(frozen){target=await activeRuntimeReference(client,op,projection,frozen.placementId as string);
    if(target.assetId!==frozen.assetId||target.assetVersionId!==frozen.assetVersionId||target.entityId!==frozen.entityId)conflict();}}
  const expected=op.held.expectedTarget;
  if(target){if(!expected||target.placementId!==expected.placementId||target.assetId!==expected.assetId||target.assetVersionId!==expected.assetVersionId)conflict();
    if(target.placementId===op.identity.source.reference?.placementId||target.entityId===op.identity.source.reference?.entityId)conflict();}
  else if(expected)conflict();return target;
}
function runtimeAttach(op:RuntimeCellIntent,projection:CanvasDocumentProjection):MediaImportCommand {
  const p=projection.placements[op.identity.source.reference!.placementId!],version=op.identity.source.version!,cell=op.identity.tile.cell;
  if(!p||p.deleted||p.assetVersionId!==version.id||!version.file.width||!version.file.height)conflict();
  const scale=Math.min(p.width/version.file.width,p.height/version.file.height,1200/version.file.width,1200/version.file.height);
  if(!Number.isFinite(scale)||scale<=0)conflict();const coordinate=(value:number):number=>Math.min(1_000_000,Math.max(-1_000_000,value));
  return parseMediaVersionImport({projectId:op.identity.input.projectId,sourceVersionId:op.parentVersionId,idempotencyKey:op.key,
    command:{action:'attach',transform:{x:coordinate(p.x+p.width+32+cell.left*scale+cell.column*16),y:coordinate(p.y+cell.top*scale+cell.row*16),
      width:cell.width*scale,height:cell.height*scale,rotation:0,zIndex:coordinate(Math.trunc(p.zIndex)+1)}}}).command;
}
function runtimeNodeResult(op:RuntimeCellReadIntent,reference:DocumentMediaImportResult['assetReference']):ExecutionResult {
  return {nodeId:op.held.execution.nodeId,status:'success',durationMs:0,output:{_type:'input-image',projectId:op.identity.input.projectId,imageUrl:reference.url,
    assetId:reference.assetId,assetVersionId:reference.assetVersionId,placementId:reference.placementId,entityId:reference.entityId,
    imageInput:{version:1,operationId:op.identity.input.operationId,parentVersionId:op.parentVersionId,cell:structuredClone(op.identity.tile.cell)}}};
}
async function inspectRuntimeCell(client:PoolClient,op:RuntimeCellReadIntent,projection:CanvasDocumentProjection):Promise<{manifest:RuntimeCellManifest;version:AssetVersion}|undefined> {
  const {input}=op.identity,row=await runtimeCellRow(client,input.actorUserId,input.projectId,op.root);
  if(!row){if(await runtimeCellRow(client,input.actorUserId,input.projectId,op.key))conflict();return undefined;}
  const manifest=runtimeManifest(row,op,true),item=manifest.items[0];await assertRuntimeChildReceipt(client,manifest,op);
  const current=await activeRuntimeReference(client,op,projection,item.result.placementId,true);
  if(!isDeepStrictEqual(current,item.result.assetReference))conflict();
  const version=await createAssetStorageTransaction(client).findVersion(op.ownerId,input.projectId,current.assetVersionId),file=op.identity.tile.file;
  if(!version||version.assetId!==current.assetId||version.file.url!==current.url||version.file.availability!=='ready'||version.taskId
    ||!isDeepStrictEqual(version.parentVersionIds,[op.parentVersionId])||!isDeepStrictEqual(version.metadata?.sourceVersionIds,[op.parentVersionId])
    ||!isDeepStrictEqual(version.metadata?.workflowImageRuntimeCell,runtimeCellMetadata(op))
    ||['checksum','mimeType','byteSize','width','height'].some(key=>version.file[key as keyof typeof version.file]!==file[key as keyof typeof file]))conflict();
  const lineage=(await client.query<{source_project_id:string;source_version_id:string;task_id:string|null;output_index:number|null;source_kind:string;source_request_digest:string}>(
    `SELECT source_project_id,source_version_id,task_id,output_index,source_kind,source_request_digest FROM wujie_canvas_media_lineage
    WHERE target_version_id=$1 AND target_asset_id=$2 AND target_owner_id=$3 AND target_project_id=$4 AND actor_id=$5 AND source_kind=$6`,
    [current.assetVersionId,current.assetId,op.ownerId,input.projectId,input.actorUserId,'version'])).rows;
  if(lineage.length!==1||lineage[0].source_project_id!==input.projectId||lineage[0].source_version_id!==op.parentVersionId||lineage[0].task_id!==null
    ||lineage[0].output_index!==null||lineage[0].source_kind!=='version'||lineage[0].source_request_digest!==op.sourceDigest)conflict();return {manifest,version};
}
/** Read the original canonical command/lineage and checkpoint. Never publish, bind or repair. */
export async function readDocumentWorkflowImageCellReceiptInTransaction(client:PoolClient,identity:WorkflowImageCellPreparationIdentity,execution:WorkflowImageLogicalExecution,local:Record<string,unknown>,signal:AbortSignal):Promise<ExecutionResult> {
  signal.throwIfAborted();
  const op=runtimeCellReadIntent(identity,execution.actorUserId,{execution,expectedTarget:null});
  await lockAssetGraphWriteGate(client,'shared');
  const locked=await client.query("SELECT 1 FROM wujie_projects WHERE id=$1 AND owner_id=$2 AND status='active' FOR SHARE",[identity.input.projectId,op.ownerId]);
  if(locked.rowCount!==1)conflict();
  const loaded=await loadDocumentInTransaction(client,identity.input.projectId);
  try{
    const prior=await inspectRuntimeCell(client,op,readCanvasDocument(loaded.doc));
    if(!prior||loaded.sequence<prior.manifest.documentSequence)conflict();
    const result=matchWorkflowImageRuntimeNodeCheckpoint(local,runtimeNodeResult(op,prior.manifest.items[0].result.assetReference));
    if(!result)throw new Error('WORKFLOW_IMAGE_RUNTIME_CHECKPOINT_UNCONFIRMED');
    signal.throwIfAborted();return result;
  }finally{loaded.doc.destroy();}
}
async function publishRuntimeCellInTransaction(client:PoolClient,actorId:string,cell:PreparedWorkflowImageCell,expectation:WorkflowImageCellRuntimeExpectation,
  assets:PreparedDocumentAssets,signal:AbortSignal,write:boolean,verification?:VerifiedDocumentRuntimeCellReplay):Promise<DocumentRuntimeCellTransactionResult|undefined> {
  signal.throwIfAborted();const op=runtimeCellIntent(cell,actorId,expectation),{input}=op.identity,agent=getAgentExecutionFence(),heldAgent=agent?structuredClone(agent):undefined;
  const verified=verification?verifiedRuntimeReplays.get(verification):undefined;if(verification&&(!verified||verified.cell!==cell))conflict();verified?.signal.throwIfAborted();
  await lockAssetGraphWriteGate(client,'shared');const execution=structuredClone(op.held.execution);
  if(!write){const fresh=await client.query('SELECT revision FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE',[execution.parentExecutionId,actorId]);
    if(fresh.rows.length!==1||!Number.isSafeInteger(fresh.rows[0].revision))throw new Error('WORKFLOW_EXECUTION_FENCE_LOST');execution.expectedRevision=fresh.rows[0].revision as number;}
  const fence=await assertWorkflowImageExecutionInTransaction(client,execution,signal);
  const locked=await client.query("SELECT 1 FROM wujie_projects WHERE id=$1 AND owner_id=$2 AND status='active' FOR UPDATE NOWAIT",[input.projectId,op.ownerId]);if(locked.rowCount!==1)conflict();
  const parent=await readWorkflowImageRuntimeParentInTransaction(client,execution,heldAgent),local=assertWorkflowImageRuntimeDurableSource(op.identity,execution,parent);
  await assertWorkflowImageCellPreparationInTransaction(client,cell,signal);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',['wujie-document-runtime-cell-slot',digest([op.ownerId,input.projectId,input.workspaceId,input.targetNodeId])]);
  const loaded=await loadDocumentInTransaction(client,input.projectId);
  try {
    const projection=readCanvasDocument(loaded.doc);await assertPreparedDocumentAssets(client,op.ownerId,input.projectId,projection,assets);signal.throwIfAborted();
    const prior=await inspectRuntimeCell(client,op,projection);
    if(prior){const {manifest,version}=prior;if(loaded.sequence<manifest.documentSequence)conflict();const expected=runtimeNodeResult(op,manifest.items[0].result.assetReference),node=matchWorkflowImageRuntimeNodeCheckpoint(local,expected);
      if(!node)throw new Error('WORKFLOW_IMAGE_RUNTIME_CHECKPOINT_UNCONFIRMED');
      const ex=op.held.execution,snapshot:RuntimeReplaySnapshot={root:op.root,digest:op.digest,contextDigest:digest({actorId,ownerId:op.ownerId,projectId:input.projectId,
        parentExecutionId:ex.parentExecutionId,workflowId:ex.workflowId,nodeId:ex.nodeId,subgraphPath:ex.subgraphPath,graph:ex.expectedGraph,attempt:ex.attempt,
        loop:ex.loop??null,leaseOwner:ex.leaseOwner,leaseAttemptCount:ex.leaseAttemptCount}),version:structuredClone(version),manifest:structuredClone(manifest),node:structuredClone(node)};
      if(!verified){const replay=Object.freeze({}) as PreparedDocumentRuntimeCellReplay;pendingRuntimeReplays.set(replay,{cell,snapshot,signal});return {status:'verify-media',replay};}
      if(!isDeepStrictEqual(verified.snapshot,snapshot))conflict();
      return {status:'pending',value:{projectId:input.projectId,workflowId:input.workspaceId,operationId:input.operationId,parentVersionId:op.parentVersionId,nodeResult:node,revision:fence.revision,documentSequence:manifest.documentSequence}};}
    if(!write)return undefined;
    if(verification)conflict();
    const target=await runtimeTarget(client,op,projection,loaded.sequence),command:MediaImportCommand=target?{action:'replace',placementId:target.placementId,expectedAssetVersionId:target.assetVersionId}:runtimeAttach(op,projection);
    const request=parseMediaVersionImport({projectId:input.projectId,sourceVersionId:op.parentVersionId,idempotencyKey:op.key,command});
    const result=await writePreparedMediaInTransaction(client,actorId,request,op.sourceDigest,'version',op.media,undefined,assets,signal,{},false,
      {ownerId:op.ownerId,sourceProjectId:input.projectId,sourceVersionId:op.parentVersionId,metadata:runtimeCellMetadata(op),runtimeCell:true});
    const sealed:RuntimeCellManifest={kind:'workflow-image-runtime-cell',version:1,actorId,ownerId:op.ownerId,projectId:input.projectId,workspaceId:input.workspaceId,
      targetNodeId:input.targetNodeId,operationId:input.operationId,sourceVersionId:op.parentVersionId,digest:op.digest,
      items:[{nodeId:input.targetNodeId,cell:op.identity.tile.cell,command:request.command,sourceDigest:op.sourceDigest,result}],documentSequence:result.documentSequence};
    await client.query(`INSERT INTO wujie_canvas_asset_commands
      (actor_id,project_id,idempotency_key,request_digest,owner_id,placement_id,asset_id,asset_version_id,document_sequence,source_request_digest,batch_manifest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4,$10::jsonb)`,[actorId,input.projectId,op.root,op.digest,op.ownerId,result.placementId,result.assetReference.assetId,result.assetVersionId,result.documentSequence,JSON.stringify(sealed)]);
    signal.throwIfAborted();const node=runtimeNodeResult(op,result.assetReference),revision=await writeWorkflowImageRuntimeNodeCheckpoint(client,fence,node,heldAgent);
    signal.throwIfAborted();return {status:'pending',value:{projectId:input.projectId,workflowId:input.workspaceId,operationId:input.operationId,parentVersionId:op.parentVersionId,nodeResult:node,revision,documentSequence:result.documentSequence}};
  }finally{loaded.doc.destroy();}
}
/** Pending only: all canonical writes and the node checkpoint use this caller client. */
export async function commitPreparedDocumentRuntimeCellInTransaction(client:PoolClient,actorId:string,cell:PreparedWorkflowImageCell,
  expectation:WorkflowImageCellRuntimeExpectation,assets:PreparedDocumentAssets,signal:AbortSignal,verification?:VerifiedDocumentRuntimeCellReplay):Promise<DocumentRuntimeCellTransactionResult> {
  const result=await publishRuntimeCellInTransaction(client,actorId,cell,expectation,assets,signal,true,verification);if(!result)conflict();return result;
}
/** Recovery never creates a missing child, repairs a receipt or rebinds a target. */
export async function readPreparedDocumentRuntimeCellInTransaction(client:PoolClient,actorId:string,cell:PreparedWorkflowImageCell,
  expectation:WorkflowImageCellRuntimeExpectation,assets:PreparedDocumentAssets,signal:AbortSignal,verification?:VerifiedDocumentRuntimeCellReplay):Promise<DocumentRuntimeCellTransactionResult|undefined> {
  return publishRuntimeCellInTransaction(client,actorId,cell,expectation,assets,signal,false,verification);
}

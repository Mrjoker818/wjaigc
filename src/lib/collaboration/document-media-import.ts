import 'server-only';

import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getAdvisoryLockPool, getPool } from '@/lib/db-client';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError,
  DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from './document-access';
import { readTaskPublicationAccess, type TaskPublicationAccess } from './task-publication-access';
import { CanvasTaskPublicationError } from './task-publication';
import { assertTaskPublication, prepareTaskPublication, taskPublicationSnapshot, type PreparedTaskPublication } from './task-publication-output';
import { executeDocumentAssetCommandInTransaction } from './document-asset-commands';
import { bindImportedDocumentMedia, prepareDocumentAssetsForImport } from './document-asset-validation';
import type { DocumentMediaImportResult } from './canvas-asset-command';
import { assertMediaActive, consumeMediaBody, DocumentMediaError, mediaBodyIdentity, mediaDeadline, mediaImportLimit,
  parseMediaAdoption, parseMediaVersionImport, parseUploadHeaders, readMediaBody, reserveMediaPreparation,
  type MediaAdoptionRequest, type MediaVersionImportRequest, type MediaUploadRequest } from './document-media-request';
import { assertMediaTaskSource, importedMediaIdentity, importedMediaRevision, mediaSourceLimit, mediaSourceProject, prepareAdoptedMedia,
  prepareMediaTaskSource, prepareMediaVersionSource, assertMediaVersionSource, prepareUploadedMedia, type PreparedImportedMedia } from './document-media-source';

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
async function authorizedResult(actorId: string, input: ImportRequest, authorization: ImportAuthorization): Promise<{ ownerId: string; row?: StoredImport }> {
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='10000ms'");
    const ownerId = await authorize(client, actorId, input, authorization);
    const row = await resultRow(client, actorId, input, ownerId);
    await client.query('COMMIT');
    return { ownerId, row };
  } catch (error) {
    try { await client?.query('ROLLBACK'); } catch { discard = true; }
    if ('taskId' in input && !(error instanceof DocumentMediaError) && !(error instanceof DocumentAccessError) && !(error instanceof CanvasTaskPublicationError)
      && !(error instanceof DocumentFeatureDisabledError) && !(error instanceof DocumentProjectNotEnabledError)) {
      throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_UNAVAILABLE');
    }
    throw error;
  } finally { client?.release(discard); }
}
interface ImportLock { check(): Promise<void>; release(): Promise<void> }
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
async function acquireKey(actorId: string, input: ImportRequest, signal: AbortSignal): Promise<ImportLock> {
  const key = `document-media:${digest([actorId, input.projectId, input.idempotencyKey])}`;
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
      const owned = (await query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [key], until - Date.now())).rows[0]?.acquired === true;
      assertMediaActive(signal);
      if (owned) return {
        check: async (): Promise<void> => {
          await query('SELECT 1');
        },
        release: async (): Promise<void> => {
          try {
            if (!lost && !released) {
              const result = await query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released', [key]);
              if (!result.rows[0]?.released) lost = true;
            }
          } catch { lost = true; }
          finally { dispose(lost); }
        },
      };
    } catch (error) {
      dispose(true); throw error;
    }
    dispose(false);
    await delay(Math.min(25, Math.max(0, until - Date.now())), undefined, { signal }).catch((): never => { throw new DocumentMediaError('DOCUMENT_MEDIA_CANCELLED'); });
  }
  throw new DocumentMediaError('DOCUMENT_MEDIA_BUSY');
}

async function finalTransaction(actorId: string, input: ImportRequest, sourceDigest: string, kind: 'upload' | 'task' | 'version',
  media: PreparedImportedMedia, source: MediaSource | undefined, lock: ImportLock, signal: AbortSignal,
  authorization: ImportAuthorization): Promise<DocumentMediaImportResult> {
  const identity = importedMediaIdentity(media);
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
    const ownerId = await authorize(client, actorId, input, authorization);
    if (ownerId !== identity.ownerId) conflict();
    const prior = await resultRow(client, actorId, input, ownerId);
    if (prior) conflict(); // Same-key session lock forbids an import race; ready commands can still race.
    if (source) {
      if ('taskId' in input) await assertMediaTaskSource(client, actorId, input, source);
      else if ('sourceVersionId' in input) await assertMediaVersionSource(client, actorId, input, source);
    }
    assertMediaActive(signal);
    await lock.check();
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
      JSON.stringify({ source: 'document-media-import', ...(output ? { sourceVersionIds: output.intent.parentVersionIds } : {}),
        ...(output?.role && 'outputIndex' in input ? { outputRole: output.role, outputIndex: input.outputIndex } : {}) }),
      publication?.task.id ?? null, output?.providerId ?? outputIdentity?.providerId ?? publication?.task.provider_id ?? null,
      output?.modelId ?? outputIdentity?.modelId ?? publication?.task.model ?? null, file.width ?? null, file.height ?? null]);
    for (const [index, parent] of (output?.intent.parentVersionIds ?? []).entries()) {
      await client.query(`INSERT INTO wujie_asset_version_parents(version_id,parent_version_id,owner_id,project_id,parent_order,asset_id)
        VALUES ($1,$2,$3,$4,$5,$6)`, [identity.versionId, parent, ownerId, input.projectId, index, identity.assetId]);
    }
    if (!revision) await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [identity.assetId, identity.versionId]);
    await client.query(`INSERT INTO wujie_canvas_media_lineage
      (target_version_id,target_asset_id,target_owner_id,target_project_id,actor_id,source_kind,task_id,output_index,source_project_id,source_version_id,source_request_digest)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [identity.versionId, identity.assetId, ownerId, input.projectId, actorId, kind,
      'taskId' in input ? input.taskId : null, 'outputIndex' in input ? input.outputIndex : null,
      source ? mediaSourceProject(source) : null, 'sourceVersionId' in input ? input.sourceVersionId ?? null : null, sourceDigest]);
    await bindImportedDocumentMedia(client, actorId, prepared, media);
    await executeDocumentAssetCommandInTransaction(client, { actorId, projectId: input.projectId,
      idempotencyKey: input.idempotencyKey, command: { ...input.command, assetVersionId: identity.versionId } }, prepared);
    // The original pre/post prepared asset + annotation assertions run before
    // this sole intentional current-pointer change, inside the same transaction.
    if (revision) await client.query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [identity.assetId, identity.versionId]);
    await client.query(`UPDATE wujie_canvas_asset_commands SET source_request_digest=$4,source_kind=$5
      WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`, [actorId, input.projectId, input.idempotencyKey, sourceDigest, kind]);
    const registered = await resultRow(client, actorId, input, ownerId);
    if (!registered) conflict();
    const result = replay(registered, sourceDigest, kind);
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
  publication?: PreparedTaskPublication): Promise<DocumentMediaImportResult> {
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
      source = 'taskId' in input ? await prepareMediaTaskSource(actorId, input, publication) : await prepareMediaVersionSource(actorId, input);
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
export async function adoptDocumentTaskResult(actorId: string, value: unknown, signal?: AbortSignal): Promise<DocumentMediaImportResult> {
  const input = parseMediaAdoption(value);
  if (input.taskId.startsWith('image_edit_')) {
    const capability = await prepareTaskPublication(actorId, input.taskId, input.projectId);
    if (!capability || !isDeepStrictEqual(input, taskPublicationSnapshot(capability).requests[input.outputIndex])) conflict();
    return publishPreparedDocumentTaskOutput(capability, input.outputIndex, signal);
  }
  return executeImport(actorId, input, new Request('http://localhost/internal-media-import', { signal }));
}

export async function importDocumentAssetVersion(actorId: string, value: unknown, signal?: AbortSignal): Promise<DocumentMediaImportResult> {
  const input = parseMediaVersionImport(value);
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

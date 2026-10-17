import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import type { SketchPublicationInput } from './execution';
import { getPool } from '@/lib/db-client';
import { completeCloudTask } from '@/lib/cloud-task-storage';
import { createAssetService, type CreateAssetVersionInput } from '@/lib/asset-core/service';
import { createAssetStorageTransaction, lockAssetGraphWriteGate, type AssetStorageTransaction } from '@/lib/asset-core/storage';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { inspectBinaryImage } from '@/lib/asset-core/binary-image-validation';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { prepareVerifiedLegacyProjectMedia, migrateLegacyProjectOnWriteInTransaction } from '@/lib/asset-core/legacy-migration';
import { inspectDocumentEnableMedia, assertDocumentEnableMediaUnchanged } from '@/lib/collaboration/document-enable-media';
import { loadSafeImageInput } from '@/lib/safe-image-input';
import type { Asset, AssetVersion, AssetFile } from '@/lib/asset-core/types';
import { validateSketchDraft, parseSketchDocumentVersion, freezeSketchValue, sketchId,
  sketchDocumentUrl, assertSketchFenceRestoringTimeouts } from './document';
import { validateSketchCodeUsage } from './usage';
import { createSketchRuntimeObserver, type SketchRuntimeObserver } from './runtime-observation';
import { lockSketchTokenLedger, settleSketchTokenCredits, verifySketchTokenSettlement,
  SketchTokenBillingRejectedError, SketchTokenPublicationRejectedError, type SketchTokenSettlement } from './token-billing';
export interface SketchPublicationDependencies {
  connect?: () => Promise<PoolClient>;
  persistBytes?: typeof persistAssetBytes;
  observe?: SketchRuntimeObserver;
}
export class SketchPublicationError extends Error {
  readonly code = 'SKETCH_PUBLICATION_UNCONFIRMED'; readonly status = 503;
  constructor() { super('SKETCH_PUBLICATION_UNCONFIRMED'); }
}
interface TaskRow {
  id: string; user_id: string; project_id: string; type: string; status: string; model: string; provider_id: string;
  idempotency_key: string; request_digest: string; result: Record<string, unknown>; credit_status: string;
  refunded_transaction_id: string | null; lease_owner: string; attempt_count: number; lease_expires_at: string;
  credit_cost: string; charged_transaction_id: string | null;
}
class Refused extends Error {
  constructor(readonly reason: string) { super(); }
}
function refuse(reason: string): never { throw new Refused(reason); }
function publicationObserver(input: SketchPublicationInput, dependencies: SketchPublicationDependencies): SketchRuntimeObserver {
  try {
    // Do not invoke getters to obtain diagnostic identity or a caller's sink.
    const data = (value: unknown, key: string): unknown => {
      if (!value || typeof value !== 'object') return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    };
    const supplied = data(dependencies, 'observe');
    if (typeof supplied === 'function') return supplied as SketchRuntimeObserver;
    const task = data(input, 'task');
    const text = (key: string): string | undefined => {
      const value = data(task, key); return typeof value === 'string' ? value : undefined;
    };
    return createSketchRuntimeObserver({ taskId: text('id'), providerId: text('providerId'), modelId: text('model') });
  } catch { return (): void => undefined; }
}
function digest(value: SketchPublicationInput['input']): string {
  return createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: value.projectId,
    imageDataUrl: value.imageDataUrl, instruction: value.instruction, providerId: value.providerId, modelId: value.modelId })).digest('hex');
}
function sameTask(row: TaskRow | undefined, value: SketchPublicationInput, requestDigest: string): row is TaskRow {
  const { task, input, access, lease } = value;
  const a = row?.result?.sketchAdmission as Record<string, unknown> | undefined;
  return !!row && row.id === task.id && row.type === 'sketch-to-code' && row.user_id === task.userId
    && row.project_id === input.projectId && row.provider_id === input.providerId && row.model === input.modelId
    && row.idempotency_key === input.idempotencyKey && row.request_digest === requestDigest && row.credit_status !== 'refunded'
    && !row.refunded_transaction_id && row.lease_owner === lease.owner && row.attempt_count === lease.attemptCount
    && Number(row.lease_expires_at) === lease.expiresAt && a?.version === 1 && a.route === '/api/sketch-to-code'
    && a.requestDigest === requestDigest && isDeepStrictEqual(a.access, access)
    && Number(row.credit_cost) === task.creditCost && (row.charged_transaction_id || undefined) === task.chargedTransactionId;
}
async function dbTimeFence(client: PoolClient, value: SketchPublicationInput, requestDigest: string, deadline: number,
  completed = false): Promise<TaskRow> {
  const rows = await client.query<TaskRow & { now_ms: string }>(
    'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1', [value.task.id]);
  const row = rows.rows[0];
  if (!sameTask(row, value, requestDigest) || row.status !== (completed ? 'completed' : 'processing')
    || Number(row.now_ms) >= value.lease.expiresAt || Number(row.now_ms) >= deadline) refuse('SKETCH_PUBLICATION_TASK_FENCE_REFUSED');
  value.signal.throwIfAborted(); return row;
}
function fileData(value: PersistedAssetFile): AssetFile {
  const { cleanup, createdThisCall, ...file } = value; void cleanup; void createdThisCall; return file;
}
async function verifyVersion(client: PoolClient, storage: AssetStorageTransaction, version: AssetVersion, kind: 'image' | 'document',
  value: SketchPublicationInput, requestDigest: string, png: Buffer): Promise<Asset> {
  await client.query(`SELECT v.id FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id
    WHERE v.id=$1 FOR SHARE OF v,a`, [version.id]);
  const asset = await storage.findAsset(value.access.ownerId, value.input.projectId, version.assetId);
  const meta = version.metadata;
  if (!asset || asset.status !== 'active' || asset.kind !== kind || asset.currentVersionId !== version.id
    || version.ownerId !== value.access.ownerId || version.projectId !== value.input.projectId || version.taskId !== value.task.id
    || version.parentVersionIds.length !== 0 || version.idempotencyKey !== `sketch:${value.task.id}:${kind === 'image' ? 'preview' : 'html'}`
    || meta?.taskId !== value.task.id || meta.actorUserId !== value.task.userId || meta.ownerId !== value.access.ownerId
    || meta.projectId !== value.input.projectId || meta.requestDigest !== requestDigest) refuse('SKETCH_PUBLICATION_ASSET_IDENTITY_REFUSED');
  if (kind === 'document') {
    const content = parseSketchDocumentVersion(version);
    if (content.html !== value.draft.html || !isDeepStrictEqual(content.analysis, value.draft.analysis)
      || !isDeepStrictEqual(meta.uiTree, value.draft.uiTree)) refuse('SKETCH_PUBLICATION_DOCUMENT_MISMATCH');
  } else {
    if (meta.schemaId !== 'sketch-code-preview-v1' || meta.role !== 'input-sketch' || version.file.mimeType !== 'image/png'
      || version.file.availability !== 'ready' || version.file.checksum !== createHash('sha256').update(png).digest('hex')
      || version.file.byteSize !== png.length) refuse('SKETCH_PUBLICATION_PREVIEW_METADATA_REFUSED');
    const content = await readManagedAssetVersionBytes(version, 'image', { signal: value.signal, maxBytes: 4 * 1024 * 1024 });
    if (!content.bytes.equals(png)) refuse('SKETCH_PUBLICATION_PREVIEW_BYTES_MISMATCH');
    const dimensions = await inspectBinaryImage(content.bytes, 'image/png', value.signal);
    if (version.file.width !== dimensions.width || version.file.height !== dimensions.height) refuse('SKETCH_PUBLICATION_PREVIEW_DIMENSIONS_MISMATCH');
  }
  return asset;
}
async function cleanupRolledBack(client: PoolClient, files: PersistedAssetFile[]): Promise<void> {
  const owned = files.filter(file => file.createdThisCall);
  if (!owned.length) return;
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    // Hold the same original graph gate while checking and removing owned files.
    await lockAssetGraphWriteGate(client, 'exclusive');
    for (const file of owned) {
      const refs = await client.query(`SELECT 1 FROM wujie_asset_versions WHERE file_url=$1
        OR ($2::text IS NOT NULL AND storage_key=$2) LIMIT 1`, [file.url, file.storageKey ?? null]);
      if (!refs.rows.length) await file.cleanup();
    }
    await client.query('COMMIT');
  } catch { await client.query('ROLLBACK'); throw new SketchPublicationError(); }
}
/** Trusted execution callback. No refund, task replacement or second asset transaction. */
export async function publishSketchTask(inputValue: SketchPublicationInput, dependencies: SketchPublicationDependencies = {}): Promise<boolean> {
  let value: SketchPublicationInput; let png: Buffer; let requestDigest: string; let invalidUsage = false;
  const persist = dependencies.persistBytes ?? persistAssetBytes;
  const connect = dependencies.connect ?? (() => getPool().connect());
  let checkpoint = 'DRAFT_VALIDATION';
  const observedStart = performance.now();
  const observe = publicationObserver(inputValue, dependencies);
  // Diagnostic-only: no raw error, draft, admission or authority values. The
  // bounded observer supplies correlation and redaction.
  const report = (error: unknown, event: 'publication-refused' | 'publication-rejected' | 'publication-commit-unknown' = 'publication-refused'): void => {
    try {
      let reason = event === 'publication-commit-unknown' ? 'SKETCH_PUBLICATION_COMMIT_UNCONFIRMED'
        : error instanceof Refused ? error.reason : `SKETCH_PUBLICATION_${checkpoint}_ERROR`;
      // This event is emitted only after the original confirmed rollback guard.
      // Even reflection/traps are diagnostics and must not alter rejection.
      if (event === 'publication-rejected') {
        const descriptor = Object.getOwnPropertyDescriptor(error, 'reason');
        const detail: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
        if (detail === 'SKETCH_TOKEN_USAGE_INVALID' || detail === 'SKETCH_TOKEN_INSUFFICIENT_CREDITS'
          || detail === 'SKETCH_TOKEN_INTEGER_OVERFLOW') reason = detail;
      }
      observe({ event, phase: 'publication', reason, elapsedMs: performance.now() - observedStart });
    } catch { /* A diagnostic callback is never publication or rollback authority. */ }
  };
  try {
    // Invalid usage must reach the original locked authority before becoming a
    // confirmed financial rejection. HTML/source validation still fails closed.
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(inputValue.draft);
    const usageDescriptor = descriptors.usage; delete descriptors.usage;
    const content = Object.create(Object.getPrototypeOf(inputValue.draft), descriptors) as unknown;
    const draft = validateSketchDraft(content);
    let usage: ReturnType<typeof validateSketchCodeUsage> | undefined;
    if (usageDescriptor) {
      try { if (!('value' in usageDescriptor)) throw new Error('Invalid descriptor'); usage = validateSketchCodeUsage(usageDescriptor.value); }
      catch { invalidUsage = true; }
    }
    // AbortSignal is a live native capability; detach all business values first.
    checkpoint = 'INPUT_SNAPSHOT';
    value = Object.freeze({ ...freezeSketchValue(structuredClone({ task: inputValue.task, access: inputValue.access,
      input: inputValue.input, draft: { ...draft, ...(usage ? { usage } : {}) }, lease: inputValue.lease })), signal: inputValue.signal });
    const { task, input, access, lease } = value;
    checkpoint = 'INPUT_IDENTITY';
    [task.id, task.userId, input.projectId, input.providerId, input.modelId, input.idempotencyKey, lease.owner, access.ownerId].forEach(sketchId);
    if (Object.keys(input).sort().join(',') !== 'idempotencyKey,imageDataUrl,instruction,modelId,projectId,providerId'
      || typeof input.instruction !== 'string' || input.instruction.length > 4096 || typeof input.imageDataUrl !== 'string'
      || input.imageDataUrl.length > Math.ceil(4 * 1024 * 1024 / 3) * 4 + 22 || task.type !== 'sketch-to-code'
      || task.userId !== access.actorUserId || task.projectId !== input.projectId || access.projectId !== input.projectId
      || task.providerId !== input.providerId || task.model !== input.modelId || task.idempotencyKey !== input.idempotencyKey
      || lease.taskId !== task.id || task.leaseOwner !== lease.owner || task.attemptCount !== lease.attemptCount
      || task.leaseExpiresAt !== lease.expiresAt || !Number.isSafeInteger(lease.expiresAt) || !Number.isSafeInteger(lease.attemptCount)
      || lease.attemptCount < 1 || !['personal', 'document'].includes(access.kind)
      || access.kind === 'personal' && access.ownerId !== task.userId
      || access.kind === 'document' && !/^(0|[1-9]\d*)$/.test(access.grantGeneration)) refuse('SKETCH_PUBLICATION_INPUT_IDENTITY_REFUSED');
    const fields = access.kind === 'personal' ? 'actorUserId,kind,ownerId,projectId' : 'actorUserId,grantGeneration,kind,ownerId,projectId';
    if (Object.keys(access).sort().join(',') !== fields) refuse('SKETCH_PUBLICATION_ACCESS_SHAPE_REFUSED');
    checkpoint = 'ADMISSION';
    requestDigest = digest(input);
    const admission = task.result?.sketchAdmission as Record<string, unknown> | undefined;
    if (task.requestDigest !== requestDigest || admission?.version !== 1 || admission.route !== '/api/sketch-to-code'
      || admission.requestDigest !== requestDigest || !isDeepStrictEqual(admission.access, access)) refuse('SKETCH_PUBLICATION_ADMISSION_MISMATCH');
    checkpoint = 'INPUT_PNG';
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.imageDataUrl);
    if (!match) refuse('SKETCH_PUBLICATION_PNG_INPUT_REFUSED'); png = Buffer.from(match[1], 'base64');
    if (png.length > 4 * 1024 * 1024 || png.toString('base64') !== match[1]) refuse('SKETCH_PUBLICATION_PNG_BYTES_REFUSED');
    checkpoint = 'PRE_SQL';
    value.signal.throwIfAborted();
  } catch (error) { report(error); return false; }
  let client: PoolClient | undefined; let discard = false; let committing = false; let began = false; let tokenGate = false;
  const files: PersistedAssetFile[] = [];
  const timerAbort = new AbortController(), deadline = Math.min(value.lease.expiresAt, Date.now() + 30_000);
  const timer = setTimeout(() => timerAbort.abort(), 30_000);
  const signal = AbortSignal.any([value.signal, timerAbort.signal]);
  value = { ...value, signal };
  try {
    checkpoint = 'PNG_INSPECTION';
    const dimensions = await inspectBinaryImage(png, 'image/png', signal);
    if (dimensions.width > 2048 || dimensions.height > 2048) refuse('SKETCH_PUBLICATION_PNG_DIMENSIONS_REFUSED');
    checkpoint = 'CONNECT';
    signal.throwIfAborted(); client = await connect(); signal.throwIfAborted();
    checkpoint = 'BEGIN';
    await client.query('BEGIN'); began = true;
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    checkpoint = 'TASK_LOCK';
    const task = (await client.query<TaskRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', [value.task.id])).rows[0];
    if (!sameTask(task, value, requestDigest) || !['processing', 'completed'].includes(task.status)) refuse('SKETCH_PUBLICATION_TASK_IDENTITY_REFUSED');
    checkpoint = 'PROJECT_AUTHORIZATION';
    await assertSketchFenceRestoringTimeouts(client, value.access);
    const storage = createAssetStorageTransaction(client);
    checkpoint = 'PROJECT_GRAPH';
    const graph = (await client.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM wujie_projects WHERE owner_id=$1 AND id=$2', [value.access.ownerId, value.input.projectId])).rows[0];
    if (!await storage.findProject(value.access.ownerId, value.input.projectId) || graph?.metadata.presenceProjection === true) {
      if (value.access.kind !== 'personal') refuse('SKETCH_PUBLICATION_PROJECT_MIGRATION_REFUSED');
      checkpoint = 'LEGACY_MEDIA';
      const verified = await prepareVerifiedLegacyProjectMedia({ actorUserId: value.access.ownerId, projectId: value.input.projectId,
        inspectManagedMedia: inspectDocumentEnableMedia, verifyManagedVideos: true }, client);
      checkpoint = 'LEGACY_MIGRATION';
      await migrateLegacyProjectOnWriteInTransaction(client, { actorUserId: value.access.ownerId, projectId: value.input.projectId,
        verifiedMediaByImageId: verified, verifyManagedVideos: true, persistMedia: async legacy => {
          const media = await loadSafeImageInput(legacy.dataUrl, { signal, maxBytes: 32 * 1024 * 1024 });
          const extension = media.mimeType === 'image/jpeg' ? 'jpg' : media.mimeType.slice('image/'.length);
          const saved = await persist({ bytes: media.buffer, mimeType: media.mimeType, filename: `sketch-legacy.${extension}`, signal });
          files.push(saved); signal.throwIfAborted(); return fileData(saved);
        } });
      await assertDocumentEnableMediaUnchanged(verified);
    }
    const ownerId = value.access.ownerId, projectId = value.input.projectId;
    const keys = { preview: `sketch:${value.task.id}:preview`, html: `sketch:${value.task.id}:html` };
    checkpoint = 'VERSION_LOCK';
    for (const key of [keys.html, keys.preview]) await storage.lockVersionIdempotency(ownerId, projectId, key);
    const oldPreview = await storage.findVersionByIdempotency(ownerId, projectId, keys.preview);
    const oldHtml = await storage.findVersionByIdempotency(ownerId, projectId, keys.html);
    if (oldPreview && oldPreview.requestDigest !== requestDigest || oldHtml && oldHtml.requestDigest !== requestDigest) refuse('SKETCH_PUBLICATION_VERSION_DIGEST_REFUSED');
    checkpoint = 'PRIOR_VERSION_READBACK';
    const previewAsset = oldPreview ? await verifyVersion(client, storage, oldPreview.version, 'image', value, requestDigest, png) : undefined;
    const htmlAsset = oldHtml ? await verifyVersion(client, storage, oldHtml.version, 'document', value, requestDigest, png) : undefined;
    checkpoint = 'LEDGER_LOCK';
    const ledger = await lockSketchTokenLedger(client, task);
    if (task.status === 'completed') {
      checkpoint = 'COMPLETED_REPLAY';
      if (!oldPreview || !oldHtml || task.result.previewAssetId !== previewAsset?.id || task.result.htmlAssetId !== htmlAsset?.id
        || task.result.previewAssetVersionId !== oldPreview.version.id || task.result.htmlAssetVersionId !== oldHtml.version.id
        || task.result.html !== value.draft.html || !isDeepStrictEqual(task.result.analysis, value.draft.analysis)) refuse('SKETCH_PUBLICATION_COMPLETED_ASSET_MISMATCH');
      await dbTimeFence(client, value, requestDigest, deadline, true);
      if (ledger) {
        const settlement = verifySketchTokenSettlement(ledger, [task.result.sketchTokenSettlement,
          oldPreview.version.metadata?.sketchTokenSettlement, oldHtml.version.metadata?.sketchTokenSettlement]);
        if (invalidUsage || !isDeepStrictEqual(settlement.usage, value.draft.usage)) refuse('SKETCH_PUBLICATION_COMPLETED_USAGE_MISMATCH');
      } else if (oldPreview.version.metadata?.sketchTokenSettlement || oldHtml.version.metadata?.sketchTokenSettlement || invalidUsage) refuse('SKETCH_PUBLICATION_UNEXPECTED_SETTLEMENT_REFUSED');
      checkpoint = 'COMMIT';
      signal.throwIfAborted(); committing = true; await client.query('COMMIT'); return true;
    }
    checkpoint = 'DATABASE_FENCE';
    await dbTimeFence(client, value, requestDigest, deadline);
    let settlement: Readonly<SketchTokenSettlement> | undefined;
    if (ledger) {
      checkpoint = 'TOKEN_SETTLEMENT';
      tokenGate = true;
      if (invalidUsage) throw new SketchTokenBillingRejectedError('SKETCH_TOKEN_USAGE_INVALID');
      settlement = await settleSketchTokenCredits(client, ledger, value.draft.usage);
      if (oldPreview || oldHtml) refuse('SKETCH_PUBLICATION_PREEXISTING_ASSET_REFUSED');
    } else if (invalidUsage) refuse('SKETCH_PUBLICATION_FIXED_USAGE_REFUSED');
    let previewFile: AssetFile;
    if (oldPreview) previewFile = oldPreview.version.file;
    else {
      checkpoint = 'PREVIEW_PERSISTENCE';
      const prepared = await persist({ bytes: png, filename: 'input-sketch.png', mimeType: 'image/png', signal });
      files.push(prepared); signal.throwIfAborted(); previewFile = fileData(prepared);
    }
    const shared = { taskId: value.task.id, actorUserId: value.task.userId, ownerId, projectId, requestDigest,
      ...(settlement ? { sketchTokenSettlement: settlement } : {}) };
    const creates: CreateAssetVersionInput[] = [
      { actorUserId: ownerId, projectId, kind: 'image', idempotencyKey: keys.preview, requestDigest, file: previewFile,
        metadata: { ...shared, schemaId: 'sketch-code-preview-v1', role: 'input-sketch' } },
      { actorUserId: ownerId, projectId, kind: 'document', idempotencyKey: keys.html, requestDigest,
        file: { url: sketchDocumentUrl(value.task.id), mimeType: 'text/html', availability: 'ready', byteSize: Buffer.byteLength(value.draft.html),
          checksum: createHash('sha256').update(value.draft.html).digest('hex') },
        metadata: { ...shared, schemaId: 'sketch-code-html-v1', compilerVersion: 1, role: 'html',
          uiTree: value.draft.uiTree, html: value.draft.html, analysis: value.draft.analysis } },
    ];
    const bound = new Proxy(storage, { get(target, key) {
      if (key === 'insertVersion') return async (version: AssetVersion, d: string, metadata?: Record<string, unknown>): Promise<void> => {
        if (version.ownerId !== ownerId || version.projectId !== projectId || d !== requestDigest
          || !Object.values(keys).includes(version.idempotencyKey || '') || metadata?.taskId !== value.task.id) refuse('SKETCH_PUBLICATION_ASSET_WRITE_IDENTITY_REFUSED');
        version.taskId = value.task.id; await target.insertVersion(version, d, metadata);
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    checkpoint = 'ASSET_CREATION';
    const service = createAssetService({ read: async callback => callback(bound), transaction: async callback => callback(bound) });
    const [preview, html] = await service.createAssetVersionsAtomically(creates);
    checkpoint = 'ASSET_READBACK';
    await verifyVersion(client, storage, preview.version, 'image', value, requestDigest, png);
    await verifyVersion(client, storage, html.version, 'document', value, requestDigest, png);
    if (settlement && (!isDeepStrictEqual(preview.version.metadata?.sketchTokenSettlement, settlement)
      || !isDeepStrictEqual(html.version.metadata?.sketchTokenSettlement, settlement))) refuse('SKETCH_PUBLICATION_SETTLEMENT_MISMATCH');
    checkpoint = 'DATABASE_FENCE';
    await dbTimeFence(client, value, requestDigest, deadline);
    checkpoint = 'TASK_COMPLETION';
    const completed = await completeCloudTask(value.task.id, { analysis: value.draft.analysis, html: value.draft.html,
      previewAssetId: preview.asset.id, htmlAssetId: html.asset.id, previewAssetVersionId: preview.version.id, htmlAssetVersionId: html.version.id,
      ...(settlement ? { sketchTokenSettlement: settlement } : {}) },
      { client, leaseOwner: value.lease.owner, leaseAttemptCount: value.lease.attemptCount, deadlineAt: deadline });
    if (!completed) refuse('SKETCH_PUBLICATION_TASK_COMPLETION_UNCONFIRMED');
    checkpoint = 'DATABASE_FENCE';
    await dbTimeFence(client, value, requestDigest, deadline, true);
    checkpoint = 'COMMIT';
    signal.throwIfAborted(); committing = true; await client.query('COMMIT'); return true;
  } catch (error) {
    if (committing) { discard = true; report(error, 'publication-commit-unknown'); throw new SketchPublicationError(); }
    if (client && began) {
      let rolledBack = false;
      try { await client.query('ROLLBACK'); rolledBack = true; } catch { discard = true; }
      let cleaned = true;
      if (rolledBack) try { await cleanupRolledBack(client, files); } catch { discard = true; cleaned = false; }
      if (rolledBack && cleaned && tokenGate && !signal.aborted && error instanceof SketchTokenBillingRejectedError) {
        report(error, 'publication-rejected');
        throw new SketchTokenPublicationRejectedError({ taskId: value.task.id, requestDigest, leaseOwner: value.lease.owner,
          attemptCount: value.lease.attemptCount, leaseExpiresAt: value.lease.expiresAt }, error.reason);
      }
    }
    report(error);
    return false;
  } finally { clearTimeout(timer); client?.release(discard); }
}

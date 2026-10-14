import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { completeCloudTask, type CloudTaskLease } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import { listManagedUsersWithClient } from '@/lib/server-auth';
import { getApiProvidersWithClient } from '@/lib/server-api-config';
import { resolveTaskModelFromProviders } from '@/lib/task-core/model-catalog';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { createAssetService } from '@/lib/asset-core/service';
import { createAssetStorageTransaction, lockAssetGraphWriteGate, type AssetStorageTransaction } from '@/lib/asset-core/storage';
import type { Asset, AssetVersion, AssetFile } from '@/lib/asset-core/types';
import { inspectBinaryImage } from '@/lib/asset-core/binary-image-validation';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { prepareVerifiedLegacyProjectMedia, migrateLegacyProjectOnWriteInTransaction } from '@/lib/asset-core/legacy-migration';
import { inspectDocumentEnableMedia, assertDocumentEnableMediaUnchanged } from '@/lib/collaboration/document-enable-media';
import { loadSafeImageInput } from '@/lib/safe-image-input';
import { assertSketchImageTaskRow, type SketchImageTaskIdentity, type SketchImageTaskRow } from './image-task-state';
import { readSketchImageCheckpoint, type SketchImageCheckpoint } from './image-execution';
import { parseStoredSketchImageInput } from './image-contract';
import { lockSketchImageLedger, settleSketchImageCredits, verifySketchImageSettlement, type SketchImageLedgerSettlement } from './image-ledger';
import { assertSketchFenceRestoringTimeouts } from './document';
import { sketchFields } from './http';
import { getConfiguredSketchImageRouting } from './configured-image-dependencies';

export interface SketchImagePublicationInput {
  identity: Readonly<SketchImageTaskIdentity>;
  lease: Readonly<CloudTaskLease>;
  checkpoint: Readonly<SketchImageCheckpoint>;
  imageUrl: string;
  signal: AbortSignal;
}
export interface SketchImagePublicationDependencies {
  connect?: () => Promise<PoolClient>;
  persistBytes?: typeof persistAssetBytes;
}
export class SketchImagePublicationError extends Error {
  readonly code = 'SKETCH_IMAGE_PUBLICATION_UNCONFIRMED'; readonly status = 503;
  constructor() { super('SKETCH_IMAGE_PUBLICATION_UNCONFIRMED'); }
}
const INPUT_MAX = 4 * 1024 * 1024, OUTPUT_MAX = 32 * 1024 * 1024;
function refuse(): never { throw new Error('SKETCH_IMAGE_PUBLICATION_REFUSED'); }
/** Own data only, detached before the first await. Native signal/client are never cloned/frozen. */
function snapshot<T>(value: T, depth = 0, ancestors = new Set<object>(), budget = { nodes: 0 }): T {
  if (++budget.nodes > 100_000 || depth > 64) refuse();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) refuse();
  ancestors.add(value); let copy: unknown;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) refuse();
    const items: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const property = Object.getOwnPropertyDescriptor(value, String(i));
      if (!property || !('value' in property) || !property.enumerable) refuse();
      items.push(snapshot(property.value as unknown, depth + 1, ancestors, budget));
    }
    copy = Object.freeze(items);
  } else {
    const raw = sketchFields(value), fields: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      if (['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
        || !Object.getOwnPropertyDescriptor(value, key)?.enumerable) refuse();
      fields[key] = snapshot(raw[key], depth + 1, ancestors, budget);
    }
    copy = Object.freeze(fields);
  }
  ancestors.delete(value); return copy as T;
}
function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function taskSnapshot(row: SketchImageTaskRow): SketchImageTaskRow {
  const fields = sketchFields(row), copy: Record<string, unknown> = {};
  // SELECT * can include native Date columns unrelated to this private contract.
  for (const key of ['id', 'user_id', 'project_id', 'type', 'status', 'provider_id', 'model', 'request_digest', 'idempotency_key',
    'result', 'credit_cost', 'credit_status', 'charged_transaction_id', 'refunded_transaction_id', 'lease_owner', 'attempt_count', 'lease_expires_at']) copy[key] = fields[key];
  return snapshot(copy) as unknown as SketchImageTaskRow;
}
function keys(value: SketchImagePublicationInput): { input: string; output: string } {
  return { input: `sketch-image:${value.identity.taskId}:input`, output: `sketch-image:${value.identity.taskId}:output` };
}
function metadata(value: SketchImagePublicationInput, settlement: SketchImageLedgerSettlement, role: 'input' | 'output'): Record<string, unknown> {
  const { identity } = value, { input, access } = identity;
  return snapshot({ schemaId: `sketch-image-${role}-v1`, role: role === 'input' ? 'input-sketch' : 'generated-image',
    taskId: identity.taskId, actorUserId: identity.actorUserId, ownerId: access.ownerId, projectId: identity.projectId, requestDigest: identity.requestDigest,
    visionProviderId: input.visionProviderId, visionModelId: input.visionModelId, imageProviderId: input.imageProviderId, imageModelId: input.imageModelId,
    analysis: value.checkpoint.analysis, sketchImageSettlement: settlement });
}
async function taskFence(client: PoolClient, value: SketchImagePublicationInput, deadline: number, status: string): Promise<SketchImageTaskRow> {
  const row = (await client.query<SketchImageTaskRow & { now_ms: unknown }>(
    'SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1', [value.identity.taskId])).rows[0];
  assertSketchImageTaskRow(row, value.identity, value.lease, row?.now_ms, deadline, status);
  if (!isDeepStrictEqual(readSketchImageCheckpoint(row.result.sketchImageExecution, value.identity), value.checkpoint)) refuse();
  value.signal.throwIfAborted();
  // Original identity validation above already established a canonical integer
  // equal to the frozen reserve. Adapt only that NUMERIC wire representation;
  // the sealed ledger still receives its strict number contract, never a new price.
  return taskSnapshot({ ...row, credit_cost: Number(row.credit_cost) });
}
async function currentFence(client: PoolClient, value: SketchImagePublicationInput, deadline: number, status: string): Promise<SketchImageTaskRow> {
  await assertSketchFenceRestoringTimeouts(client, value.identity.access);
  return taskFence(client, value, deadline, status);
}
async function currentModelFence(client: PoolClient, value: SketchImagePublicationInput): Promise<void> {
  // The original project fence already holds the actor's user row FOR SHARE.
  // SHARE also covers catalogue inserts/deletes, including legacy-model ambiguity.
  // Both locks are retained on this original client through its COMMIT/ROLLBACK.
  await client.query('LOCK TABLE wujie_api_providers IN SHARE MODE');
  const users = await listManagedUsersWithClient(client);
  const user = users.find(candidate => candidate.id === value.identity.actorUserId);
  if (!user || user.status === 'disabled') refuse();
  const providers = await getApiProvidersWithClient(client), input = value.identity.input;
  const vision = resolveTaskModelFromProviders(providers, input.visionProviderId, input.visionModelId, user);
  const image = resolveTaskModelFromProviders(providers, input.imageProviderId, input.imageModelId, user);
  const routing = getConfiguredSketchImageRouting(input, vision, image,
    providers.find(provider => provider.id === input.visionProviderId) || null,
    providers.find(provider => provider.id === input.imageProviderId) || null);
  if (!isDeepStrictEqual(routing, value.checkpoint.routing)) refuse();
  value.signal.throwIfAborted();
}
function trackFile(saved: PersistedAssetFile, files: PersistedAssetFile[]): AssetFile {
  const raw = sketchFields(saved, ['url', 'availability', 'storageKey', 'checksum', 'mimeType', 'byteSize', 'width', 'height',
    'recoverySourceUrl', 'cleanup', 'createdThisCall']);
  const { cleanup, createdThisCall, ...business } = raw;
  if (typeof cleanup !== 'function' || typeof createdThisCall !== 'boolean') refuse();
  const file = snapshot(business) as unknown as AssetFile;
  // Keep the native cleanup capability, not its caller-owned mutable descriptor.
  files.push(Object.freeze({ ...file, createdThisCall, cleanup: (cleanup as PersistedAssetFile['cleanup']).bind(saved) }));
  return file;
}
async function verifyVersion(client: PoolClient, storage: AssetStorageTransaction, version: AssetVersion,
  role: 'input' | 'output', value: SketchImagePublicationInput, settlement: SketchImageLedgerSettlement,
  original: Buffer, parent?: string, expectedOutput?: Buffer): Promise<Asset> {
  const locked = await client.query(`SELECT v.id FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id
    WHERE v.id=$1 FOR SHARE OF v,a`, [version.id]);
  if (locked.rows.length !== 1) refuse();
  const { identity, signal } = value;
  const asset = await storage.findAsset(identity.access.ownerId, identity.projectId, version.assetId);
  if (!asset || asset.kind !== 'image' || asset.status !== 'active' || asset.currentVersionId !== version.id
    || version.ownerId !== identity.access.ownerId || version.projectId !== identity.projectId || version.taskId !== identity.taskId
    || version.idempotencyKey !== keys(value)[role] || !isDeepStrictEqual(version.parentVersionIds, role === 'input' ? [] : [parent])
    || !isDeepStrictEqual(snapshot(version.metadata), metadata(value, settlement, role))
    || version.file.availability !== 'ready' || version.file.recoverySourceUrl
    || !['image/png', 'image/jpeg', 'image/webp'].includes(version.file.mimeType || '') || role === 'input' && version.file.mimeType !== 'image/png') refuse();
  const content = await readManagedAssetVersionBytes(version, 'image', { signal, maxBytes: role === 'input' ? INPUT_MAX : OUTPUT_MAX });
  if (content.mimeType !== version.file.mimeType || version.file.byteSize !== content.bytes.length || version.file.checksum !== sha(content.bytes)
    || role === 'input' && !content.bytes.equals(original) || expectedOutput && !content.bytes.equals(expectedOutput)) refuse();
  const dimensions = await inspectBinaryImage(content.bytes, version.file.mimeType!, signal);
  if (version.file.width !== dimensions.width || version.file.height !== dimensions.height
    || role === 'input' && (dimensions.width > 2048 || dimensions.height > 2048)) refuse();
  return asset;
}
function assertCompletedResult(row: SketchImageTaskRow, value: SketchImagePublicationInput, preview: AssetVersion, image: AssetVersion): void {
  if (preview.assetId === image.assetId || row.result.previewAssetId !== preview.assetId || row.result.previewAssetVersionId !== preview.id
    || row.result.imageAssetId !== image.assetId || row.result.imageAssetVersionId !== image.id
    || !isDeepStrictEqual(row.result.analysis, value.checkpoint.analysis)) refuse();
}
async function finalCompletion(client: PoolClient, storage: AssetStorageTransaction, value: SketchImagePublicationInput,
  deadline: number, preview: AssetVersion, image: AssetVersion): Promise<void> {
  const row = await currentFence(client, value, deadline, 'completed');
  assertCompletedResult(row, value, preview, image);
  const ledger = await lockSketchImageLedger(client, row);
  // Their original SHARE locks remain held since CPU/managed-byte validation.
  // Re-read SQL projections too: completeCloudTask's ACK is not asset evidence.
  const owner = value.identity.access.ownerId, project = value.identity.projectId;
  const currentPreview = snapshot(await storage.findVersion(owner, project, preview.id));
  const currentImage = snapshot(await storage.findVersion(owner, project, image.id));
  if (!currentPreview || !currentImage || !isDeepStrictEqual(currentPreview, preview) || !isDeepStrictEqual(currentImage, image)) refuse();
  for (const version of [currentPreview, currentImage]) {
    const asset = await storage.findAsset(owner, project, version.assetId);
    if (!asset || asset.status !== 'active' || asset.kind !== 'image' || asset.currentVersionId !== version.id) refuse();
  }
  const settlement = verifySketchImageSettlement(ledger, [row.result.sketchImageSettlement,
    currentPreview.metadata?.sketchImageSettlement, currentImage.metadata?.sketchImageSettlement]);
  if (!isDeepStrictEqual(settlement.usage, value.checkpoint.usage)) refuse();
  const final = await currentFence(client, value, deadline, 'completed');
  assertCompletedResult(final, value, currentPreview, currentImage);
  if (!isDeepStrictEqual(final.result.sketchImageSettlement, settlement)) refuse();
}
async function cleanupRolledBack(client: PoolClient, files: readonly PersistedAssetFile[]): Promise<void> {
  const owned = files.filter(file => file.createdThisCall); if (!owned.length) return;
  let committing = false;
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    await lockAssetGraphWriteGate(client, 'exclusive');
    for (const file of owned) {
      const refs = await client.query(`SELECT 1 FROM wujie_asset_versions WHERE file_url=$1
        OR ($2::text IS NOT NULL AND storage_key=$2) LIMIT 1`, [file.url, file.storageKey ?? null]);
      if (!refs.rows.length) await file.cleanup();
    }
    committing = true; await client.query('COMMIT');
  } catch {
    // Even the cleanup transaction must not ROLLBACK an unknown COMMIT.
    if (!committing) await client.query('ROLLBACK');
    throw new SketchImagePublicationError();
  }
}
/** Publisher port of the original owner/lease task. No compute, refund, terminal
 * authority or independent asset transaction; a remote receipt is GET-confirmed by the worker. */
export async function publishSketchImageTask(value: SketchImagePublicationInput,
  deps: SketchImagePublicationDependencies = {}): Promise<boolean> {
  let actual: SketchImagePublicationInput;
  const persist = deps.persistBytes ?? persistAssetBytes, connect = deps.connect ?? (() => getPool().connect());
  try {
    const fields = sketchFields(value, ['identity', 'lease', 'checkpoint', 'imageUrl', 'signal']);
    if (Object.keys(fields).length !== 5) refuse();
    const business = snapshot({ identity: fields.identity, lease: fields.lease, checkpoint: fields.checkpoint, imageUrl: fields.imageUrl });
    actual = Object.freeze({ ...business, signal: fields.signal }) as SketchImagePublicationInput;
    if (!(actual.signal instanceof AbortSignal) || typeof actual.imageUrl !== 'string' || !actual.imageUrl
      || Object.keys(actual.identity).sort().join(',') !== 'access,actorUserId,input,pricing,projectId,requestDigest,taskId'
      || Object.keys(actual.lease).sort().join(',') !== 'attemptCount,expiresAt,owner,taskId') refuse();
    // The private original reference is canonical data:PNG, never a URL to fetch.
    if (!isDeepStrictEqual(parseStoredSketchImageInput(actual.identity.input), actual.identity.input)) refuse();
    const checkpoint = readSketchImageCheckpoint(actual.checkpoint, actual.identity);
    if (!checkpoint || checkpoint.phase !== 'accepted' || !checkpoint.receipt || !isDeepStrictEqual(checkpoint, actual.checkpoint)
      || checkpoint.receipt.directImageUrls.length && checkpoint.receipt.directImageUrls[0] !== actual.imageUrl) refuse();
    actual.signal.throwIfAborted();
  } catch { return false; }
  const controller = new AbortController(), deadline = Math.min(actual.lease.expiresAt, Date.now() + 30_000);
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  const signal = AbortSignal.any([actual.signal, controller.signal]); actual = Object.freeze({ ...actual, signal });
  let client: PoolClient | undefined, guarded: PoolClient | undefined;
  let began = false, committing = false, discard = false;
  const files: PersistedAssetFile[] = [];
  try {
    const original = await loadSafeImageInput(actual.identity.input.imageDataUrl, { signal, maxBytes: INPUT_MAX });
    if (original.mimeType !== 'image/png') refuse();
    const dimensions = await inspectBinaryImage(original.buffer, 'image/png', signal);
    if (dimensions.width > 2048 || dimensions.height > 2048) refuse();
    signal.throwIfAborted(); client = await connect(); signal.throwIfAborted();
    // Await the driver operation even after cancellation. A busy connection may
    // never be released or used for ROLLBACK by a timed-out Promise.race consumer.
    guarded = new Proxy(client, { get(target, key) {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
        signal.throwIfAborted(); const query = Reflect.get(target, 'query') as (...args: unknown[]) => Promise<unknown>;
        const result = await query.apply(target, args); signal.throwIfAborted(); return result;
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    // BEGIN ACK can arrive after abort; remember it before checking the signal.
    began = true; await client.query('BEGIN'); signal.throwIfAborted();
    // Do not inherit a pooled REPEATABLE READ snapshot taken before a waited lock.
    await guarded.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await guarded.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const rawTask = (await guarded.query<SketchImageTaskRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR UPDATE', [actual.identity.taskId])).rows[0];
    if (!rawTask || !['processing', 'completed'].includes(rawTask.status)) refuse();
    const task = taskSnapshot(rawTask);
    assertSketchImageTaskRow(task, actual.identity, actual.lease, 0, deadline, task.status);
    if (!isDeepStrictEqual(readSketchImageCheckpoint(task.result.sketchImageExecution, actual.identity), actual.checkpoint)) refuse();
    await currentFence(guarded, actual, deadline, task.status);
    if (task.status === 'processing') await currentModelFence(guarded, actual);
    const storage = createAssetStorageTransaction(guarded), { identity } = actual;
    const { ownerId } = identity.access, projectId = identity.projectId;
    const graph = (await guarded.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM wujie_projects WHERE owner_id=$1 AND id=$2', [ownerId, projectId])).rows[0];
    if (!await storage.findProject(ownerId, projectId) || graph?.metadata.presenceProjection === true) {
      if (identity.access.kind !== 'personal' || task.status === 'completed') refuse();
      const verified = await prepareVerifiedLegacyProjectMedia({ actorUserId: ownerId, projectId,
        inspectManagedMedia: inspectDocumentEnableMedia, verifyManagedVideos: true }, guarded);
      await migrateLegacyProjectOnWriteInTransaction(guarded, { actorUserId: ownerId, projectId, verifiedMediaByImageId: verified,
        verifyManagedVideos: true, persistMedia: async legacy => {
          const media = await loadSafeImageInput(legacy.dataUrl, { signal, maxBytes: OUTPUT_MAX });
          const saved = await persist({ bytes: media.buffer, mimeType: media.mimeType,
            filename: `sketch-legacy.${media.mimeType === 'image/jpeg' ? 'jpg' : media.mimeType.slice(6)}`, signal });
          const file = trackFile(saved, files); signal.throwIfAborted(); return file;
        } });
      await assertDocumentEnableMediaUnchanged(verified);
    }
    const idempotency = keys(actual);
    for (const key of Object.values(idempotency).sort()) await storage.lockVersionIdempotency(ownerId, projectId, key);
    const oldInput = snapshot(await storage.findVersionByIdempotency(ownerId, projectId, idempotency.input));
    const oldOutput = snapshot(await storage.findVersionByIdempotency(ownerId, projectId, idempotency.output));
    if (task.status === 'processing' && (oldInput || oldOutput)) refuse();
    const ledgerTask = await currentFence(guarded, actual, deadline, task.status);
    const ledger = await lockSketchImageLedger(guarded, ledgerTask);
    await currentFence(guarded, actual, deadline, task.status); // AFTER task/project/graph/idempotency/ledger locks.
    if (task.status === 'completed') {
      if (!oldInput || !oldOutput || oldInput.requestDigest !== identity.requestDigest || oldOutput.requestDigest !== identity.requestDigest
        || oldInput.version.assetId === oldOutput.version.assetId) refuse();
      const settlement = verifySketchImageSettlement(ledger, [task.result.sketchImageSettlement,
        oldInput.version.metadata?.sketchImageSettlement, oldOutput.version.metadata?.sketchImageSettlement]);
      if (!isDeepStrictEqual(settlement.usage, actual.checkpoint.usage)) refuse();
      // A data receipt has its original bytes durably saved; bind those too.
      // HTTP/remote receipts never trigger another download/model query on replay.
      const direct = actual.checkpoint.receipt!.directImageUrls[0];
      const expected = direct?.startsWith('data:') ? await loadSafeImageInput(direct, { signal, maxBytes: OUTPUT_MAX }) : undefined;
      await verifyVersion(guarded, storage, oldInput.version, 'input', actual, settlement, original.buffer);
      await verifyVersion(guarded, storage, oldOutput.version, 'output', actual, settlement, original.buffer, oldInput.version.id, expected?.buffer);
      assertCompletedResult(task, actual, oldInput.version, oldOutput.version);
      await finalCompletion(guarded, storage, actual, deadline, oldInput.version, oldOutput.version);
      signal.throwIfAborted(); committing = true; await client.query('COMMIT'); return true;
    }
    const output = await loadSafeImageInput(actual.imageUrl, { signal, maxBytes: OUTPUT_MAX });
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.mimeType)) refuse();
    await inspectBinaryImage(output.buffer, output.mimeType, signal);
    await currentFence(guarded, actual, deadline, 'processing');
    const settlement = await settleSketchImageCredits(guarded, ledger, actual.checkpoint.usage);
    const bound = new Proxy(storage, { get(target, key) {
      if (key === 'insertVersion') return async (version: AssetVersion, digest: string, meta?: Record<string, unknown>): Promise<void> => {
        if (version.ownerId !== ownerId || version.projectId !== projectId || digest !== identity.requestDigest
          || !Object.values(idempotency).includes(version.idempotencyKey || '') || meta?.taskId !== identity.taskId) refuse();
        version.taskId = identity.taskId; await target.insertVersion(version, digest, meta);
      };
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    const service = createAssetService({ read: async callback => callback(bound), transaction: async callback => callback(bound) });
    const save = async (bytes: Buffer, mimeType: string, filename: string): Promise<AssetFile> => {
      const saved = await persist({ bytes, mimeType, filename, signal }); const file = trackFile(saved, files); signal.throwIfAborted(); return file;
    };
    const preview = await service.createAssetVersion({ actorUserId: ownerId, projectId, kind: 'image', idempotencyKey: idempotency.input,
      requestDigest: identity.requestDigest, file: await save(original.buffer, 'image/png', 'input-sketch.png'), metadata: metadata(actual, settlement, 'input') });
    const image = await service.createAssetVersion({ actorUserId: ownerId, projectId, kind: 'image', idempotencyKey: idempotency.output,
      requestDigest: identity.requestDigest, parentVersionIds: [preview.version.id],
      file: await save(output.buffer, output.mimeType, `generated-image.${output.mimeType === 'image/jpeg' ? 'jpg' : output.mimeType.slice(6)}`), metadata: metadata(actual, settlement, 'output') });
    if (preview.reused || image.reused || preview.asset.id === image.asset.id) refuse();
    // Re-read original SQL rows; never trust just the returned service objects or persistence metadata.
    const storedInput = snapshot(await storage.findVersion(ownerId, projectId, preview.version.id));
    const storedOutput = snapshot(await storage.findVersion(ownerId, projectId, image.version.id));
    if (!storedInput || !storedOutput) refuse();
    await verifyVersion(guarded, storage, storedInput, 'input', actual, settlement, original.buffer);
    await verifyVersion(guarded, storage, storedOutput, 'output', actual, settlement, original.buffer, storedInput.id, output.buffer);
    await currentFence(guarded, actual, deadline, 'processing');
    if (!await completeCloudTask(identity.taskId, snapshot({ previewAssetId: preview.asset.id, previewAssetVersionId: preview.version.id,
      imageAssetId: image.asset.id, imageAssetVersionId: image.version.id, analysis: actual.checkpoint.analysis, sketchImageSettlement: settlement }),
    { client: guarded, leaseOwner: actual.lease.owner, leaseAttemptCount: actual.lease.attemptCount, deadlineAt: deadline })) refuse();
    await finalCompletion(guarded, storage, actual, deadline, storedInput, storedOutput);
    await currentModelFence(guarded, actual);
    signal.throwIfAborted(); committing = true; await client.query('COMMIT'); return true;
  } catch {
    if (committing) { discard = true; throw new SketchImagePublicationError(); }
    if (client && began) {
      let rolledBack = false;
      try { await client.query('ROLLBACK'); rolledBack = true; } catch { discard = true; }
      if (rolledBack) {
        try { await cleanupRolledBack(client, files); }
        catch { discard = true; throw new SketchImagePublicationError(); }
      }
    }
    return false;
  } finally { clearTimeout(timer); client?.release(discard); }
}

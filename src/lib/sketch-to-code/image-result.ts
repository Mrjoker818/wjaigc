import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { createAssetStorageTransaction, lockAssetGraphWriteGate, type AssetStorageTransaction } from '@/lib/asset-core/storage';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { readGenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { readSketchImageTaskRowIdentity, type SketchImageTaskIdentity, type SketchImageTaskRow } from './image-task-state';
import { readSketchImageCheckpoint } from './image-execution';
import { lockSketchImageLedger, verifySketchImageSettlement } from './image-ledger';
import { assertSketchFenceRestoringTimeouts } from './document';
import { inspectBinaryImage } from '@/lib/asset-core/binary-image-validation';
import { sketchHttpId } from './http';
import type { AssetVersion, Asset } from '@/lib/asset-core/types';
import type { SketchImageAnalysis } from './image-contract';
export interface SketchImageResultInput { actorUserId: string; projectId: string; taskId: string; signal?: AbortSignal }
export interface SketchImageResultDependencies {
  connect?: () => Promise<PoolClient>; storage?: (client: PoolClient) => AssetStorageTransaction;
  readAccess?: typeof readGenerationProjectAccess; readMedia?: typeof readManagedAssetVersionBytes;
}
export interface SketchImageAuthorizedResult {
  readonly taskId: string; readonly projectId: string; readonly previewAssetId: string; readonly previewAssetVersionId: string;
  readonly imageAssetId: string; readonly imageAssetVersionId: string; readonly previewUrl: string; readonly imageUrl: string;
  readonly visionProviderId: string; readonly visionModelId: string; readonly imageProviderId: string; readonly imageModelId: string;
  readonly analysis: SketchImageAnalysis; readonly reserveCredits: number; readonly actualCredits: number;
  readonly pricing: SketchImageTaskIdentity['pricing'];
}
function reject(): never { throw new Error('SKETCH_IMAGE_RESULT_UNAVAILABLE'); }
/** Current original owner/editor access held through original asset/finance reads.
 * A completed task does not require its obsolete worker lease or original grant
 * generation. No model call, new asset, refund or private checkpoint projection. */
export async function readSketchImageResult(value: SketchImageResultInput,
  dependencies: SketchImageResultDependencies = {}): Promise<Readonly<SketchImageAuthorizedResult>> {
  const scope = { actorUserId: sketchHttpId(value.actorUserId), projectId: sketchHttpId(value.projectId), taskId: sketchHttpId(value.taskId) };
  const connect = dependencies.connect || (() => getPool().connect()), storageFactory = dependencies.storage || createAssetStorageTransaction;
  const readAccess = dependencies.readAccess || readGenerationProjectAccess, media = dependencies.readMedia || readManagedAssetVersionBytes;
  const deadline = Date.now() + 30_000, timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 30_000);
  const signal = value.signal ? AbortSignal.any([value.signal, timeout.signal]) : timeout.signal;
  let raw: PoolClient | undefined, began = false, committing = false, discard = false;
  const guard = (): void => { if (signal.aborted || Date.now() >= deadline) reject(); };
  try {
    guard(); raw = await connect(); guard();
    const client = new Proxy(raw, { get(target, key) {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => { guard(); const result: unknown = await Reflect.apply(target.query, target, args); guard(); return result; };
      const item: unknown = Reflect.get(target, key); return typeof item === 'function' ? item.bind(target) : item;
    } });
    began = true; await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const task = (await client.query<SketchImageTaskRow>('SELECT * FROM cloud_tasks WHERE id=$1 FOR SHARE', [scope.taskId])).rows[0];
    if (!task || task.id !== scope.taskId || task.project_id !== scope.projectId || task.status !== 'completed' || task.refunded_transaction_id) reject();
    const source = readSketchImageTaskRowIdentity(task), result = structuredClone(task.result);
    const checkpoint = readSketchImageCheckpoint(result.sketchImageExecution, source);
    if (checkpoint?.phase !== 'accepted' || !isDeepStrictEqual(result.analysis, checkpoint.analysis)) reject();
    const current = await readAccess(client, scope.actorUserId, scope.projectId);
    if (current.kind === 'unscoped' || current.actorUserId !== scope.actorUserId || current.projectId !== scope.projectId || current.ownerId !== source.access.ownerId) reject();
    await assertSketchFenceRestoringTimeouts(client, current); await lockAssetGraphWriteGate(client, 'shared');
    const inputId = sketchHttpId(result.previewAssetVersionId), outputId = sketchHttpId(result.imageAssetVersionId);
    if (inputId === outputId || result.previewAssetId === result.imageAssetId) reject();
    const held = await client.query<{ id: string }>(`SELECT v.id FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id
      WHERE v.id=ANY($1::text[]) ORDER BY v.id FOR SHARE OF v,a`, [[inputId, outputId]]);
    if (held.rows.length !== 2 || ![inputId, outputId].every(id => held.rows.some(row => row.id === id))) reject();
    const storage = storageFactory(client), input = await storage.findVersion(current.ownerId, scope.projectId, inputId), output = await storage.findVersion(current.ownerId, scope.projectId, outputId);
    if (!input || !output) reject();
    const inputAsset = await storage.findAsset(current.ownerId, scope.projectId, input.assetId), outputAsset = await storage.findAsset(current.ownerId, scope.projectId, output.assetId);
    const verifyVersion = (version: AssetVersion, asset: Asset | null, role: 'input' | 'output'): void => {
      const metadata = version.metadata, inputRole = role === 'input';
      if (!asset || asset.id !== result[inputRole ? 'previewAssetId' : 'imageAssetId'] || asset.kind !== 'image' || asset.status !== 'active'
        || asset.ownerId !== current.ownerId || asset.projectId !== scope.projectId || asset.currentVersionId !== version.id
        || version.ownerId !== current.ownerId || version.projectId !== scope.projectId || version.taskId !== source.taskId
        || version.idempotencyKey !== `sketch-image:${source.taskId}:${role}` || !isDeepStrictEqual(version.parentVersionIds, inputRole ? [] : [input.id])
        || metadata?.schemaId !== `sketch-image-${role}-v1` || metadata.role !== (inputRole ? 'input-sketch' : 'generated-image')
        || metadata.taskId !== source.taskId || metadata.actorUserId !== source.actorUserId || metadata.ownerId !== current.ownerId
        || metadata.projectId !== scope.projectId || metadata.requestDigest !== source.requestDigest
        || metadata.visionProviderId !== source.input.visionProviderId || metadata.visionModelId !== source.input.visionModelId
        || metadata.imageProviderId !== source.input.imageProviderId || metadata.imageModelId !== source.input.imageModelId
        || !isDeepStrictEqual(metadata.analysis, checkpoint.analysis) || version.file.availability !== 'ready'
        || !(inputRole ? version.file.mimeType === 'image/png' : ['image/png','image/jpeg','image/webp'].includes(version.file.mimeType || ''))) reject();
    };
    verifyVersion(input, inputAsset, 'input'); verifyVersion(output, outputAsset, 'output');
    const ledger = await lockSketchImageLedger(client, { ...task, credit_cost: source.pricing.totalReserveCredits }, true);
    const settlement = verifySketchImageSettlement(ledger, [result.sketchImageSettlement, input.metadata?.sketchImageSettlement, output.metadata?.sketchImageSettlement]);
    if (!isDeepStrictEqual(settlement.usage, checkpoint.usage)) reject();
    const clockFence = async (): Promise<void> => {
      const row = (await client.query<SketchImageTaskRow & { now_ms: unknown }>('SELECT *, (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now_ms FROM cloud_tasks WHERE id=$1', [scope.taskId])).rows[0];
      const now = typeof row?.now_ms === 'string' && /^(0|[1-9]\d*)$/.test(row.now_ms) ? Number(row.now_ms) : row?.now_ms;
      if (!row || !isDeepStrictEqual(readSketchImageTaskRowIdentity(row), source) || row.status !== 'completed' || row.refunded_transaction_id
        || row.credit_status !== task.credit_status || row.charged_transaction_id !== task.charged_transaction_id || !isDeepStrictEqual(row.result, result)
        || typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0 || now >= deadline) reject(); guard();
    };
    await clockFence();
    for (const [version, maxBytes] of [[input,4*1024*1024],[output,32*1024*1024]] as const) {
      const content = await media(version, 'image', { signal, maxBytes }); guard();
      if (content.mimeType !== version.file.mimeType || version.file.byteSize !== content.bytes.length
        || version.file.checksum !== createHash('sha256').update(content.bytes).digest('hex')) reject();
      if (version === input && !content.bytes.equals(Buffer.from(source.input.imageDataUrl.slice('data:image/png;base64,'.length),'base64'))) reject();
      const dimensions = await inspectBinaryImage(content.bytes, content.mimeType, signal); guard();
      if (version.file.width !== dimensions.width || version.file.height !== dimensions.height || version === input && (dimensions.width > 2048 || dimensions.height > 2048)) reject();
    }
    await clockFence();
    const projection = Object.freeze({ taskId: source.taskId, projectId: scope.projectId, previewAssetId: input.assetId, previewAssetVersionId: input.id,
      imageAssetId: output.assetId, imageAssetVersionId: output.id, previewUrl: input.file.url, imageUrl: output.file.url,
      visionProviderId: source.input.visionProviderId, visionModelId: source.input.visionModelId,
      imageProviderId: source.input.imageProviderId, imageModelId: source.input.imageModelId, analysis: checkpoint.analysis!,
      reserveCredits: source.pricing.totalReserveCredits, actualCredits: settlement.actualCredits, pricing: source.pricing });
    guard(); committing = true; await client.query('COMMIT'); return projection;
  } catch {
    if (committing) discard = true;
    else if (raw && began) try { await raw.query('ROLLBACK'); } catch { discard = true; }
    return reject();
  } finally { clearTimeout(timer); raw?.release(discard); }
}

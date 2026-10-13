import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { createAssetStorageTransaction } from '@/lib/asset-core/storage';
import type { AssetVersion } from '@/lib/asset-core/types';
import type { SketchCodeDraft, SketchAnalysis } from './generation';
import type { SketchCodePreparation } from './generation';
import { compileSketchHtml } from './html';
import { validateSketchCodeUsage } from './usage';
import { assertSketchProjectFence } from './admission';
import { readGenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import { inspectBinaryImage } from '@/lib/asset-core/binary-image-validation';
import { lockSketchTokenLedger, verifySketchTokenSettlement, parseSketchAdmissionPricing, type SketchAdmissionPricing, type SketchTokenTaskRow } from './token-billing';
export class SketchDocumentError extends Error {
  readonly code = 'SKETCH_DOCUMENT_UNAVAILABLE'; readonly status = 404;
  constructor() { super('SKETCH_DOCUMENT_UNAVAILABLE'); }
}
export interface ValidatedSketchDraft extends SketchCodeDraft { uiTree: unknown }
export interface SketchDocumentContent { html: string; bytes: Buffer; analysis: SketchAnalysis }
export interface SketchAuthorizedDocument extends SketchDocumentContent {
  readonly taskId: string; readonly projectId: string; readonly providerId: string; readonly modelId: string;
  readonly previewAssetId: string; readonly htmlAssetId: string; readonly previewAssetVersionId: string; readonly htmlAssetVersionId: string;
  readonly documentUrl: string; readonly reserveCredits: number; readonly actualCredits: number; readonly pricing: Readonly<SketchAdmissionPricing>;
}
export interface SketchDocumentReadInput { actorUserId: string; projectId: string; taskId: string; signal?: AbortSignal }
function reject(): never { throw new SketchDocumentError(); }
export function freezeSketchValue<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freezeSketchValue); Object.freeze(value); }
  return value;
}
export function sketchId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value !== value.trim() || /\p{Cc}/u.test(value)) reject();
  return value;
}
// Both callers copy a single draft/metadata envelope (root depth0, uiTree
// depth1). The original compiler allows 12 UI nodes along a path: each of
// 11 child edges adds a children array plus node, then leaf style + scalar
// adds 2. Thus the deepest permitted data value is 1 + 2*(12-1) + 2 = 25.
// This is a structural copy bound, not permission for a deeper UI tree;
// compileSketchHtml still enforces the original depth/node/style/byte limits.
const MAX_COPY_DEPTH = 1 + 2 * (12 - 1) + 2;
/** Copy data descriptors only, never run getters/toJSON while checking a source. */
function jsonCopy(value: unknown, depth = 0, counter = { count: 0 }): unknown {
  if (++counter.count > 10000 || depth > MAX_COPY_DEPTH) reject();
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') { if (value.length > 256 * 1024) reject(); return value; }
  if (!value || typeof value !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) reject();
  if (Array.isArray(value)) {
    if (value.length > 200 || Reflect.ownKeys(value).length !== value.length + 1) reject();
    return Array.from({ length: value.length }, (_, index) => {
      const d = Object.getOwnPropertyDescriptor(value, String(index));
      if (!d || !('value' in d)) reject(); return jsonCopy(d.value, depth + 1, counter);
    });
  }
  const result: Record<string, unknown> = {};
  if (Reflect.ownKeys(value).length > 40) reject();
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || key === '__proto__' || !d || !('value' in d)) reject();
    result[key] = jsonCopy(d.value, depth + 1, counter);
  }
  return result;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(); return value as Record<string, unknown>;
}
export function validateSketchDraft(value: unknown): Readonly<ValidatedSketchDraft> {
  try {
    // Validate the original usage descriptors before the general JSON copy can
    // erase prototype information. Usage never supplies compilation provenance.
    const usageDescriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'usage') : undefined;
    const usage = usageDescriptor ? ('value' in usageDescriptor ? validateSketchCodeUsage(usageDescriptor.value) : reject()) : undefined;
    const raw = record(jsonCopy(value));
    if (Object.keys(raw).some(key => !['uiTree', 'html', 'analysis', 'usage'].includes(key)) || !Object.hasOwn(raw, 'uiTree')
      || typeof raw.html !== 'string' || Buffer.byteLength(raw.html) > 256 * 1024
      || Buffer.from(raw.html).toString('utf8') !== raw.html
      || Buffer.byteLength(JSON.stringify(raw.uiTree)) > 256 * 1024 || compileSketchHtml(raw.uiTree) !== raw.html) reject();
    const a = record(raw.analysis);
    if (Object.keys(a).sort().join(',') !== 'controls,layout,summary,text') reject();
    if (typeof a.summary !== 'string' || !a.summary.trim() || typeof a.layout !== 'string' || !a.layout.trim()) reject();
    if (!Array.isArray(a.controls) || !Array.isArray(a.text) || [...a.controls, ...a.text].some(v => typeof v !== 'string')) reject();
    const strings = [a.summary, a.layout, ...a.controls, ...a.text] as string[];
    if (strings.reduce((sum, s) => sum + Buffer.byteLength(s), 0) > 65536) reject();
    return freezeSketchValue({ html: raw.html, uiTree: raw.uiTree,
      analysis: { summary: a.summary, layout: a.layout, controls: a.controls as string[], text: a.text as string[] }, ...(usage ? { usage } : {}) });
  } catch { return reject(); }
}
export function sketchDocumentUrl(taskId: string): string { return `/api/sketch-to-code/${encodeURIComponent(sketchId(taskId))}/document`; }
export function parseSketchDocumentVersion(version: AssetVersion): SketchDocumentContent {
  try {
    const m = record(jsonCopy(version.metadata));
    const draft = validateSketchDraft({ html: m.html, uiTree: m.uiTree, analysis: m.analysis });
    const bytes = Buffer.from(draft.html);
    if (m.schemaId !== 'sketch-code-html-v1' || m.compilerVersion !== 1 || m.role !== 'html'
      || sketchId(m.taskId) !== version.taskId || sketchId(m.ownerId) !== version.ownerId
      || sketchId(m.projectId) !== version.projectId || !sketchId(m.actorUserId)
      || typeof m.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(m.requestDigest)
      || version.idempotencyKey !== `sketch:${version.taskId}:html` || version.parentVersionIds.length !== 0
      || version.file.url !== sketchDocumentUrl(version.taskId) || version.file.availability !== 'ready'
      || version.file.mimeType !== 'text/html' || version.file.storageKey !== undefined
      || version.file.byteSize !== bytes.length || version.file.checksum !== createHash('sha256').update(bytes).digest('hex')) reject();
    return { html: draft.html, bytes, analysis: draft.analysis };
  } catch { return reject(); }
}
/** Restore the original fence's local timeout overrides without releasing locks. */
export async function assertSketchFenceRestoringTimeouts(client: PoolClient, access: SketchCodePreparation['access']): Promise<void> {
  const settings = (await client.query<{ lock_timeout: string; statement_timeout: string }>(
    "SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout")).rows[0];
  await assertSketchProjectFence(client, access);
  await client.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)",
    [settings.lock_timeout, settings.statement_timeout]);
}
/** Today's original project permission, held through content read and commit.
 * The platform has owner/editor document readers, not a new viewer grant here.
 */
export async function readSketchDocument(input: SketchDocumentReadInput): Promise<Readonly<SketchAuthorizedDocument>> {
  const scope = { actorUserId: sketchId(input.actorUserId), projectId: sketchId(input.projectId), taskId: sketchId(input.taskId), signal: input.signal };
  let client: PoolClient | undefined; let discard = false; let committing = false;
  try {
    scope.signal?.throwIfAborted(); client = await getPool().connect(); scope.signal?.throwIfAborted();
    await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
    const task = (await client.query<SketchTokenTaskRow & { user_id: string; project_id: string; type: string; status: string; result: Record<string, unknown>;
      request_digest: string; idempotency_key: string; credit_status: string; refunded_transaction_id: string | null }>(
      'SELECT * FROM cloud_tasks WHERE id=$1 FOR SHARE', [scope.taskId])).rows[0];
    if (!task || task.id !== scope.taskId || task.project_id !== scope.projectId || task.type !== 'sketch-to-code' || task.status !== 'completed'
      || task.credit_status === 'refunded' || task.refunded_transaction_id) reject();
    const providerId = sketchId(task.provider_id), modelId = sketchId(task.model);
    const current = await readGenerationProjectAccess(client, scope.actorUserId, scope.projectId);
    if (current.kind === 'unscoped') reject();
    await assertSketchFenceRestoringTimeouts(client, current);
    const result = task.result, admission = record(result.sketchAdmission), oldAccess = record(admission.access);
    if (admission.version !== 1 || admission.route !== '/api/sketch-to-code' || admission.requestDigest !== task.request_digest
      || !/^[a-f0-9]{64}$/.test(task.request_digest) || !sketchId(task.idempotency_key)
      || oldAccess.actorUserId !== task.user_id || oldAccess.ownerId !== current.ownerId || oldAccess.projectId !== scope.projectId
      || !['personal', 'document'].includes(String(oldAccess.kind))) reject();
    if (oldAccess.kind === 'personal' ? Object.keys(oldAccess).length !== 4 || oldAccess.ownerId !== task.user_id
      : Object.keys(oldAccess).length !== 5 || !sketchId(oldAccess.grantGeneration)) reject();
    const pricing = parseSketchAdmissionPricing(admission.pricing);
    const creditCost = typeof task.credit_cost === 'string' && /^(0|[1-9]\d*)$/.test(task.credit_cost) ? Number(task.credit_cost) : task.credit_cost;
    if (creditCost !== pricing.totalCredits || !(task.credit_status === 'charged' || pricing.totalCredits === 0 && task.credit_status === 'not-applicable')) reject();
    const versionId = sketchId(result.htmlAssetVersionId), previewId = sketchId(result.previewAssetVersionId);
    if (versionId === previewId) reject();
    await client.query(`SELECT v.id FROM wujie_asset_versions v JOIN wujie_assets a ON a.id=v.asset_id
      WHERE v.id=ANY($1::text[]) ORDER BY v.id FOR SHARE OF v,a`, [[versionId, previewId]]);
    const storage = createAssetStorageTransaction(client);
    const version = await storage.findVersion(current.ownerId, scope.projectId, versionId);
    const preview = await storage.findVersion(current.ownerId, scope.projectId, previewId);
    if (!version || !preview) reject();
    const asset = await storage.findAsset(current.ownerId, scope.projectId, version.assetId);
    const previewAsset = await storage.findAsset(current.ownerId, scope.projectId, preview.assetId);
    if (!asset || asset.status !== 'active' || asset.kind !== 'document' || asset.id !== result.htmlAssetId
      || asset.currentVersionId !== version.id || !previewAsset || previewAsset.status !== 'active' || previewAsset.kind !== 'image'
      || previewAsset.currentVersionId !== preview.id || previewAsset.id !== result.previewAssetId || preview.taskId !== scope.taskId
      || preview.metadata?.schemaId !== 'sketch-code-preview-v1' || preview.metadata.role !== 'input-sketch'
      || preview.metadata.requestDigest !== task.request_digest || preview.metadata.actorUserId !== task.user_id
      || preview.metadata.taskId !== scope.taskId || preview.metadata.ownerId !== current.ownerId
      || preview.metadata.projectId !== scope.projectId || preview.idempotencyKey !== `sketch:${scope.taskId}:preview`
      || preview.parentVersionIds.length !== 0 || preview.file.mimeType !== 'image/png' || preview.file.availability !== 'ready'
      || version.taskId !== scope.taskId || version.metadata?.requestDigest !== task.request_digest
      || version.metadata.actorUserId !== task.user_id) reject();
    const content = parseSketchDocumentVersion(version);
    if (result.html !== content.html || !isDeepStrictEqual(result.analysis, content.analysis)) reject();
    const ledger = await lockSketchTokenLedger(client, task, true);
    let actualCredits = pricing.totalCredits;
    if (ledger) actualCredits = verifySketchTokenSettlement(ledger, [result.sketchTokenSettlement,
      preview.metadata?.sketchTokenSettlement, version.metadata?.sketchTokenSettlement]).actualCredits;
    else if (preview.metadata?.sketchTokenSettlement || version.metadata?.sketchTokenSettlement) reject();
    const media = await readManagedAssetVersionBytes(preview, 'image', { signal: scope.signal, maxBytes: 4 * 1024 * 1024 });
    if (preview.file.byteSize !== media.bytes.length
      || preview.file.checksum !== createHash('sha256').update(media.bytes).digest('hex')) reject();
    const dimensions = await inspectBinaryImage(media.bytes, 'image/png', scope.signal);
    if (preview.file.width !== dimensions.width || preview.file.height !== dimensions.height
      || dimensions.width > 2048 || dimensions.height > 2048) reject();
    const projection = Object.freeze({ ...content, taskId: scope.taskId, projectId: scope.projectId, providerId, modelId,
      previewAssetId: previewAsset.id, htmlAssetId: asset.id, previewAssetVersionId: preview.id, htmlAssetVersionId: version.id,
      documentUrl: sketchDocumentUrl(scope.taskId), reserveCredits: pricing.totalCredits, actualCredits, pricing });
    scope.signal?.throwIfAborted(); committing = true; await client.query('COMMIT'); return projection;
  } catch {
    if (client) { if (committing) discard = true; else try { await client.query('ROLLBACK'); } catch { discard = true; } }
    return reject();
  } finally { client?.release(discard); }
}

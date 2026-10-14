import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTaskBillingTransactionId } from '@/lib/credits';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
import type { SketchImagePricing } from '@/lib/sketch-to-code/image-pricing';
import type { SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { publishSketchImageTask, type SketchImagePublicationInput, type SketchImagePublicationDependencies } from '@/lib/sketch-to-code/image-publication';
import { sketchImageModelConfig, sketchImageFixtureRouting } from '../../../tests/helpers/sketch-image-model-config';
import type { SketchImageRouting } from '@/lib/sketch-to-code/image-execution';

const isolation = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wujie-sketch-publication-'));
  await fs.mkdir(path.join(root, 'exports'));
  return { root, system: path.join(root, 'system'), users: path.join(root, 'users'), ddl: [] as string[], unexpected: [] as string[] };
});
vi.mock('server-only', () => ({}));
// Configuration and SQL driver ports ONLY. Real asset/ledger/managed validation remain loaded.
vi.mock('@/lib/server-data-root', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server-data-root')>(),
  getServerDataRoot: (): string => isolation.root,
  getServerSystemDir: (): string => isolation.system,
  getServerUsersDir: (): string => isolation.users,
  isServerDataRootDurable: (): boolean => true,
}));
vi.mock('@/lib/db-client', () => ({
  getPool: (): never => { throw new Error('BUSINESS_DB_FORBIDDEN'); },
  getAdvisoryLockPool: (): never => { throw new Error('BUSINESS_DB_FORBIDDEN'); },
  isDatabaseConfigured: (): boolean => false,
  execSql: async (sql: string): Promise<{ rows: unknown[]; rowCount: number }> => {
    const normalized = sql.trim().replace(/\s+/g, ' ');
    if (!/^(CREATE TABLE IF NOT EXISTS (cloud_tasks|wujie_agent_execution_leases)|ALTER TABLE (cloud_tasks|wujie_agent_execution_leases)|CREATE (UNIQUE )?INDEX IF NOT EXISTS idx_)/.test(normalized)) {
      isolation.unexpected.push(normalized); throw new Error('UNKNOWN_GLOBAL_SQL');
    }
    isolation.ddl.push(normalized); return { rows: [], rowCount: 0 };
  },
}));

type Row = Record<string, unknown>;
interface Call { sql: string; values: unknown[] }
interface State {
  task: SketchImageTaskRow; assets: Row[]; versions: Row[]; transactions: Row[];
  credit: { balance: number; total_used: number } | null; project: boolean;
}
interface Fixture {
  state: State; value: SketchImagePublicationInput; client: PoolClient; deps: SketchImagePublicationDependencies;
  calls: Call[]; releases: boolean[]; saved: string[]; cleaned: string[]; now: number; fences: number;
  authorized: boolean; grant: string; document: boolean; owner: string; rollbackFailure: boolean;
  commitFailure: 'none' | 'before' | 'after'; referenced: boolean; owned: boolean; persistMode: string;
  before?: (call: Call) => Promise<void> | void;
  currentUser: Row; currentProviders: Row[];
}
const selection = { visionProviderId: 'vision-provider', visionModelId: 'same-model', imageProviderId: 'image-provider', imageModelId: 'same-model' };
const token: SketchImagePricing = { version: 1, vision: { providerId: selection.visionProviderId, modelId: selection.visionModelId,
  calls: 1, mode: 'token', reserveCredits: 7, tokenPricing: { input: 1_000_000, output: 2_000_000 } },
image: { providerId: selection.imageProviderId, modelId: selection.imageModelId, calls: 1, credits: 30 }, totalReserveCredits: 37 };
const flat: SketchImagePricing = { ...token, vision: { providerId: selection.visionProviderId, modelId: selection.visionModelId, calls: 1, mode: 'flat', reserveCredits: 7 } };
const free: SketchImagePricing = { ...flat, vision: { ...flat.vision, reserveCredits: 0 }, image: { ...flat.image, credits: 0 }, totalReserveCredits: 0 };
let png: Buffer, jpeg: Buffer, webp: Buffer;
let frozenRouting: Readonly<SketchImageRouting>;
const fixtures: Fixture[] = [];
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const url = (bytes: Buffer, mime = 'image/png'): string => `data:${mime};base64,${bytes.toString('base64')}`;
const result = (rows: unknown[] = []): { rows: unknown[]; rowCount: number } => ({ rows: structuredClone(rows), rowCount: rows.length });
const output = (f: Fixture): Row => f.state.versions.find(v => (v.metadata as Row).role === 'generated-image')!;
const input = (f: Fixture): Row => f.state.versions.find(v => (v.metadata as Row).role === 'input-sketch')!;
const writes = (f: Fixture): Call[] => f.calls.filter(c => /^(INSERT|UPDATE|WITH .*UPDATE cloud_tasks)/.test(c.sql));
function fixture(pricing: SketchImagePricing = flat, usage?: { inputTokens: number; outputTokens: number }): Fixture {
  const taskId = `skimg_${randomUUID()}`, expiresAt = Date.now() + 120_000;
  const imageInput = { projectId: 'project', imageDataUrl: url(png), instruction: 'preserve sketch', ...selection, idempotencyKey: 'nonce', aspectRatio: '1:1' };
  const requestDigest = sketchImageRequestDigest(imageInput), access = { kind: 'personal' as const, actorUserId: 'actor', ownerId: 'actor', projectId: 'project' };
  const identity = { taskId, actorUserId: 'actor', projectId: 'project', input: imageInput, access, pricing: structuredClone(pricing), requestDigest };
  const checkpoint = { version: 1 as const, phase: 'accepted' as const, routing: { ...frozenRouting },
    analysis: { summary: 'summary', composition: 'composition', prompt: 'prompt', negativePrompt: '' }, ...(usage ? { usage } : {}),
    receipt: { taskIds: [], directImageUrls: [url(png)], usedProviderId: selection.imageProviderId, usedModel: selection.imageModelId } };
  const reserve = pricing.totalReserveCredits, chargeId = reserve ? createTaskBillingTransactionId('charge', taskId) : null;
  const task: SketchImageTaskRow = { id: taskId, user_id: 'actor', project_id: 'project', type: 'sketch-to-image', status: 'processing',
    provider_id: selection.imageProviderId, model: selection.imageModelId, credit_cost: reserve, charged_transaction_id: chargeId,
    refunded_transaction_id: null, credit_status: reserve ? 'pending' : 'not-applicable', lease_owner: 'lease', attempt_count: 1, lease_expires_at: String(expiresAt),
    request_digest: requestDigest, idempotency_key: 'nonce', result: { sketchImageAdmission: { version: 1, route: '/api/sketch-to-image', requestDigest,
      input: structuredClone(imageInput), access: structuredClone(access), pricing: structuredClone(pricing) }, sketchImageExecution: structuredClone(checkpoint) } };
  const f: Fixture = { value: { identity, checkpoint, lease: { taskId, owner: 'lease', attemptCount: 1, expiresAt }, imageUrl: url(png), signal: new AbortController().signal },
    state: { task, assets: [], versions: [], credit: reserve ? { balance: 100 - reserve, total_used: reserve } : null, project: true,
      transactions: reserve ? [{ id: chargeId, user_id: 'actor', type: 'consume', amount: -reserve, balance_after: 100 - reserve,
        model: selection.imageModelId, task_id: taskId, reference_id: taskId }] : [] }, client: {} as PoolClient, deps: {},
    calls: [], releases: [], saved: [], cleaned: [], now: Date.now(), fences: 0, authorized: true, grant: '4', document: false, owner: 'actor',
    rollbackFailure: false, commitFailure: 'none', referenced: false, owned: true, persistMode: 'normal',
    currentUser: { id: 'actor', name: 'Actor', password_hash: 'synthetic', role: 'user', status: 'active', created_at: 1, updated_at: 1 },
    currentProviders: sketchImageModelConfig('same-model', 'same-model').rows };
  let backup: State | undefined;
  const query = async (source: string, values: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    const sql = source.trim().replace(/\s+/g, ' '), call = { sql, values: structuredClone(values) }; f.calls.push(call); await f.before?.(call);
    if (sql === 'BEGIN') { if (backup) throw new Error('NESTED_TRANSACTION'); backup = structuredClone(f.state); return result(); }
    if (sql === 'ROLLBACK') { if (f.rollbackFailure) throw new Error('rollback password secret'); if (backup) f.state = backup; backup = undefined; return result(); }
    if (sql === 'COMMIT') { if (f.commitFailure === 'before') throw new Error('commit password secret'); backup = undefined;
      if (f.commitFailure === 'after') throw new Error('commit password secret'); return result(); }
    if (sql.startsWith('SET LOCAL ') || sql.startsWith('SELECT set_config(')) return result();
    if (sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' || sql === 'LOCK TABLE wujie_api_providers IN SHARE MODE') return result();
    if (sql === 'SELECT * FROM wujie_users ORDER BY created_at ASC') return result([f.currentUser]);
    if (sql === 'SELECT * FROM wujie_api_providers ORDER BY COALESCE(sort_order, 999999) ASC, created_at ASC') return result(f.currentProviders);
    if (sql.startsWith("SELECT current_setting('lock_timeout')")) return result([{ lock_timeout: '5s', statement_timeout: '10s' }]);
    if (/^SELECT pg_advisory_xact_lock(_shared)?\(/.test(sql)) {
      if (!(values[0] === 'wujie:asset-graph-write-gate:v1' || values[0] === f.owner && values[1] === '__asset_graph_projects_revision'
        || typeof values[0] === 'string' && values[0].startsWith(`asset-version:${f.owner}:project:sketch-image:${taskId}:`))) throw new Error('WRONG_ADVISORY_KEY');
      return result();
    }
    if (sql.includes('AS now_ms FROM cloud_tasks')) return result([{ ...f.state.task, now_ms: String(f.now) }]);
    if (sql.startsWith('SELECT *') && sql.includes('FROM cloud_tasks')) return result([f.state.task]);
    if (sql.startsWith('SELECT id FROM wujie_users WHERE id = ANY')) return result([{ id: 'actor' }]);
    if (sql.startsWith('SELECT id FROM wujie_projects WHERE id =')) return result(f.state.project ? [{ id: 'project' }] : []);
    if (sql.startsWith('SELECT status FROM wujie_users')) return result([{ status: f.authorized ? 'active' : 'disabled' }]);
    if (sql.startsWith('SELECT p.owner_id, p.status')) { f.fences++; return result(f.state.project
      ? [{ owner_id: f.owner, status: 'active', owner_status: 'active', enabled: f.document, has_document: f.document }] : []); }
    if (sql.startsWith('SELECT p.owner_id FROM wujie_projects')) return result(f.authorized ? [{ owner_id: f.owner }] : []);
    if (sql.startsWith('SELECT 1 FROM wujie_project_document_editors')) return result(values[3] === f.grant ? [{}] : []);
    if (sql.startsWith('SELECT grant_generation::text')) return result([{ grant_generation: f.grant }]);
    if (sql.startsWith('SELECT enabled FROM wujie_project_document_settings')) return result([{ enabled: f.document }]);
    if (/^SELECT (user_id|project_id) FROM wujie_(user_data|project_document_settings|project_canvas_documents)/.test(sql)) return result();
    const legacy = { id: 'project', userId: 'actor', name: 'legacy', canvasImages: [], createdAt: 1, updatedAt: 1 };
    if (sql.startsWith('SELECT data_value FROM wujie_user_data')) return result([{ data_value: [legacy] }]);
    if (sql.startsWith('SELECT legacy.value AS legacy_project')) return result([{ legacy_project: legacy }]);
    if (sql.startsWith('SELECT status, checkpoint FROM wujie_asset_migration_checkpoints')) return result();
    if (sql.startsWith('SELECT schema_version, metadata FROM wujie_projects')) return result();
    if (sql.startsWith('INSERT INTO wujie_projects')) { f.state.project = true; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO wujie_asset_migration_checkpoints') || sql.startsWith('UPDATE wujie_asset_migration_checkpoints')
      || sql.startsWith('UPDATE wujie_projects SET schema_version = 3')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT metadata FROM wujie_projects')) return result(f.state.project ? [{ metadata: {} }] : []);
    if (sql.startsWith('SELECT 1 FROM wujie_projects WHERE id =')) return result(f.state.project && values[1] === f.owner ? [{}] : []);
    if (sql.startsWith('SELECT balance,total_used FROM wujie_credits')) return result(f.state.credit ? [f.state.credit] : []);
    if (sql.includes('FROM wujie_credit_transactions WHERE task_id=$1')) return result(f.state.transactions);
    if (sql.startsWith('UPDATE wujie_credits')) { f.state.credit = { balance: values[0] as number, total_used: values[1] as number }; return result([f.state.credit]); }
    if (sql.startsWith('INSERT INTO wujie_credit_transactions')) {
      if (f.state.transactions.some(v => v.id === values[0])) throw new Error('DUPLICATE_CHARGE');
      f.state.transactions.push({ id: values[0], user_id: values[1], type: values[2], amount: values[3], balance_after: values[4], model: values[6], task_id: values[7], reference_id: values[7] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT v.*, COALESCE(')) return result(f.state.versions.filter(v => sql.includes('WHERE v.id = $1')
      ? v.id === values[0] && v.owner_id === values[1] && v.project_id === values[2]
      : v.owner_id === values[0] && v.project_id === values[1] && v.idempotency_key === values[2]));
    if (sql.startsWith('SELECT * FROM wujie_assets')) return result(f.state.assets.filter(v => v.id === values[0] && v.owner_id === values[1] && v.project_id === values[2]));
    if (sql.startsWith('SELECT v.id FROM wujie_asset_versions v JOIN wujie_assets')) return result(f.state.versions.filter(v => v.id === values[0]).map(v => ({ id: v.id })));
    if (sql.startsWith('INSERT INTO wujie_assets(')) {
      f.state.assets.push({ id: values[0], owner_id: values[1], project_id: values[2], kind: values[3], status: values[4], current_version_id: values[5], created_at: new Date(values[6] as string), updated_at: new Date(values[6] as string) });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO wujie_asset_versions(')) {
      const fields = ['id', 'asset_id', 'owner_id', 'project_id', 'file_url', 'storage_key', 'checksum', 'mime_type', 'byte_size', 'width', 'height', 'availability', 'recovery_source_url', 'task_id', 'idempotency_key'];
      const v: Row = Object.fromEntries(fields.map((key, i) => [key, values[i]]));
      v.metadata = JSON.parse(values[15] as string) as Row; v.created_at = new Date(values[16] as string); v.parent_version_ids = [];
      if (f.persistMode === 'sql-metadata') (v.metadata as Row).imageProviderId = 'vision-provider';
      f.state.versions.push(v); return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO wujie_asset_version_parents')) {
      const v = f.state.versions.find(v => v.id === values[3]), parent = f.state.versions.find(v => v.id === values[4] && v.owner_id === values[1] && v.project_id === values[2]);
      if (!v || !parent) throw new Error('MISSING_OR_FOREIGN_PARENT'); (v.parent_version_ids as unknown[]).push(values[4]); return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE wujie_assets SET current_version_id')) {
      const a = f.state.assets.find(v => v.id === values[0] && v.owner_id === values[1] && v.project_id === values[2]);
      if (!a) return result(); a.current_version_id = values[3]; return result([a]);
    }
    if (sql.includes('UPDATE cloud_tasks') && sql.includes("status = 'completed'") && sql.includes('AS committed')) {
      const t = f.state.task;
      if (values[0] !== t.id || values[3] !== t.lease_owner || values[5] !== t.attempt_count || f.now >= Number(t.lease_expires_at) || f.now >= Number(values[4]) || t.status !== 'processing') return result();
      t.result = { ...t.result, ...JSON.parse(values[1] as string) as Row }; t.status = 'completed'; if (t.credit_status === 'pending') t.credit_status = 'charged';
      return result([{ id: t.id, committed: true }]);
    }
    if (sql.startsWith('SELECT 1 FROM wujie_asset_versions WHERE file_url=$1')) return result(f.referenced || f.state.versions.some(v => v.file_url === values[0] || values[1] !== null && v.storage_key === values[1]) ? [{}] : []);
    isolation.unexpected.push(sql); throw new Error(`UNKNOWN_SQL ${sql}`);
  };
  f.client = { query, release: (discard = false): void => { f.releases.push(discard); } } as unknown as PoolClient;
  f.deps = { connect: async (): Promise<PoolClient> => f.client, persistBytes: async value => {
    value.signal?.throwIfAborted(); const fileName = `${randomUUID()}.${value.mimeType === 'image/jpeg' ? 'jpg' : value.mimeType.slice(6)}`;
    const actual = f.persistMode === 'wrong-bytes' ? jpeg : value.bytes;
    await fs.writeFile(path.join(isolation.root, 'exports', fileName), actual, { flag: 'wx' });
    const publicUrl = `/api/serve-upload/exports/${fileName}`; f.saved.push(publicUrl);
    const dimensions = await sharp(value.bytes).metadata();
    return { url: f.persistMode === 'external-url' ? 'https://example.invalid/file.png' : publicUrl,
      mimeType: value.mimeType, availability: 'ready', byteSize: value.bytes.length, checksum: sha(value.bytes),
      width: f.persistMode === 'wrong-dimensions' ? 999 : dimensions.width, height: dimensions.height, createdThisCall: f.owned,
      cleanup: async (): Promise<void> => { f.cleaned.push(publicUrl); await fs.rm(path.join(isolation.root, 'exports', fileName)); } };
  } };
  fixtures.push(f); return f;
}
function remote(f: Fixture, bytes: Buffer, mime: string): void {
  f.value.imageUrl = url(bytes, mime); f.value.checkpoint = { ...f.value.checkpoint, receipt: { taskIds: ['remote-task'], directImageUrls: [], usedProviderId: selection.imageProviderId, usedModel: selection.imageModelId } };
  f.state.task.result.sketchImageExecution = structuredClone(f.value.checkpoint);
}
function collaborator(f: Fixture): void {
  f.document = true; f.owner = 'owner';
  const access = { kind: 'document' as const, actorUserId: 'actor', ownerId: 'owner', projectId: 'project', grantGeneration: '4' };
  f.value.identity = { ...f.value.identity, access }; (f.state.task.result.sketchImageAdmission as Row).access = structuredClone(access);
}
async function publish(f: Fixture): Promise<boolean> { return publishSketchImageTask(f.value, f.deps); }
async function completed(): Promise<Fixture> { const f = fixture(token, { inputTokens: 0, outputTokens: 0 }); expect(await publish(f)).toBe(true); expect(f.state.versions).toHaveLength(2); f.calls = []; f.saved = []; f.cleaned = []; f.releases = []; return f; }
beforeAll(async () => {
  frozenRouting = await sketchImageFixtureRouting(sketchImageModelConfig('same-model', 'same-model').providers);
  png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#f00' } }).png().toBuffer();
  jpeg = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#0f0' } }).jpeg().toBuffer();
  webp = await sharp(jpeg).webp().toBuffer(); vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  vi.stubGlobal('fetch', vi.fn((): never => { throw new Error('NETWORK_FORBIDDEN'); }));
});
afterEach(() => { expect(isolation.unexpected).toEqual([]); expect(fetch).not.toHaveBeenCalled(); });
afterAll(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  const relative = path.relative(os.tmpdir(), isolation.root);
  if (!relative.startsWith('wujie-sketch-publication-') || path.isAbsolute(relative) || relative.includes('..')) throw new Error('UNSAFE_FIXTURE_CLEANUP');
  await fs.rm(isolation.root, { recursive: true, force: true });
});

describe('callable publisher on the original transaction and real media', () => {
  it('creates input then output in independent assets, one original completion and identical three projections', async () => {
    const f = fixture(token, { inputTokens: 0, outputTokens: 0 }); const acknowledged = await publish(f);
    expect(acknowledged, JSON.stringify(f.calls)).toBe(true);
    expect(f.state.task.status).toBe('completed'); expect(f.state.assets).toHaveLength(2); expect(f.state.versions).toHaveLength(2);
    expect(f.state.versions.map(v => (v.metadata as Row).schemaId)).toEqual(['sketch-image-input-v1', 'sketch-image-output-v1']);
    expect(input(f).parent_version_ids).toEqual([]); expect(output(f).parent_version_ids).toEqual([input(f).id]); expect(output(f).asset_id).not.toBe(input(f).asset_id);
    const settlement = f.state.task.result.sketchImageSettlement;
    expect(settlement).toMatchObject({ actualCredits: 31, deltaCredits: -6, usage: { inputTokens: 0, outputTokens: 0 } });
    expect((input(f).metadata as Row).sketchImageSettlement).toEqual(settlement); expect((output(f).metadata as Row).sketchImageSettlement).toEqual(settlement);
    expect(f.state.transactions.map(t => t.amount)).toEqual([-37, 6]); expect(f.state.credit).toEqual({ balance: 69, total_used: 31 });
    expect(f.state.task.refunded_transaction_id).toBeNull(); expect(f.state.task.credit_status).toBe('charged');
    expect(f.state.task.result).toMatchObject({ previewAssetId: input(f).asset_id, previewAssetVersionId: input(f).id, imageAssetId: output(f).asset_id, imageAssetVersionId: output(f).id, analysis: f.value.checkpoint.analysis });
    expect(f.state.task.result).not.toHaveProperty('imageUrl'); expect(f.calls.filter(c => c.sql === 'BEGIN')).toHaveLength(1); expect(f.calls.filter(c => c.sql === 'COMMIT')).toHaveLength(1);
    expect(f.fences).toBeGreaterThanOrEqual(3); expect(f.releases).toEqual([false]); expect(f.cleaned).toEqual([]);
  });
  it.each(['image/png', 'image/jpeg', 'image/webp'])('remote accepted receipt saves real decoded %s without querying a model', async mime => {
    const f = fixture(); remote(f, mime === 'image/png' ? png : mime === 'image/jpeg' ? jpeg : webp, mime); expect(await publish(f)).toBe(true);
    expect(output(f).mime_type).toBe(mime); expect(output(f).width).toBe(mime === 'image/png' ? 8 : 12);
  });
  it('free never initializes or fabricates a credit account or usage', async () => {
    const f = fixture(free); expect(await publish(f)).toBe(true); expect(f.state.credit).toBeNull(); expect(f.state.transactions).toEqual([]);
    expect(f.state.task.result.sketchImageSettlement).toMatchObject({ actualCredits: 0, chargedTransactionId: null, adjustmentTransactionId: null });
    expect(f.state.task.result.sketchImageSettlement).not.toHaveProperty('usage'); expect(writes(f).some(c => /wujie_credit/.test(c.sql))).toBe(false);
  });
  it.each([flat, free])('adapts original canonical NUMERIC task cost only after original identity/lease checks (%j)', async pricing => {
    const f = fixture(pricing); f.state.task.credit_cost = String(pricing.totalReserveCredits);
    expect(await publish(f)).toBe(true); expect(f.state.task.credit_cost).toBe(String(pricing.totalReserveCredits));
    expect(f.state.task.status).toBe('completed'); expect(f.state.transactions).toHaveLength(pricing.totalReserveCredits ? 1 : 0);
  });
  it.each(['037', '37.0', '37e0', '38', 'NaN', '37secret', null, -1])('does not normalize an unvalidated task cost %s', async cost => {
    const f = fixture(); f.state.task.credit_cost = cost; expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]);
  });
  it.each([{ inputTokens: 2, outputTokens: 3 }, { inputTokens: 7, outputTokens: 0 }])('settles one real vision usage %j plus one image', async usage => {
    const f = fixture(token, usage); expect(await publish(f)).toBe(true); const delta = usage.outputTokens ? 1 : 0;
    expect(f.state.task.result.sketchImageSettlement).toMatchObject({ actualCredits: 37 + delta, deltaCredits: delta, usage });
    expect(f.state.transactions).toHaveLength(delta ? 2 : 1);
  });
  it('missing token usage fails before writes and never fabricates zero', async () => { const f = fixture(token); expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]); });
  it('migrates an original empty personal legacy project without enabling document collaboration', async () => {
    const f = fixture(); f.state.project = false; expect(await publish(f)).toBe(true); expect(f.state.project).toBe(true);
    expect(f.calls.some(c => c.sql.startsWith('INSERT INTO wujie_asset_migration_checkpoints'))).toBe(true);
    expect(writes(f).some(c => /document_(settings|editors)/.test(c.sql))).toBe(false);
  });
  it('document collaborator preserves owner scope and generation grant', async () => { const f = fixture(); collaborator(f); expect(await publish(f)).toBe(true); expect(f.state.assets.every(a => a.owner_id === 'owner')).toBe(true); });
  it('detaches business values across awaited SQL and never freezes the live signal/client', async () => {
    const f = fixture(); f.before = call => { if (call.sql === 'BEGIN') { (f.value.identity.input as { instruction: string }).instruction = 'mutated'; (f.value.checkpoint.analysis as { prompt: string }).prompt = 'mutated'; } };
    expect(await publish(f)).toBe(true); expect((output(f).metadata as Row).analysis).toMatchObject({ prompt: 'prompt' });
    expect(Object.isFrozen(f.value.signal)).toBe(false); expect(Object.isFrozen(f.client)).toBe(false); expect(Object.isFrozen(f.value.identity.input)).toBe(false);
  });
});
describe('fail closed on private evidence, clock and current grant', () => {
  it.each(['vision-permission', 'image-assignment', 'provider-disabled', 'provider-routing', 'reference-capability'])
    ('refuses new publication after current selected-model revocation: %s', async change => {
      const f = fixture();
      if (change === 'vision-permission') f.currentUser.api_permissions = { chat: false };
      if (change === 'image-assignment') f.currentUser.image_models = ['other-provider::other-model'];
      if (change === 'provider-disabled') f.currentProviders[1].is_enabled = false;
      if (change === 'provider-routing') f.currentProviders[0].base_url = 'https://changed.example.invalid/v1';
      if (change === 'reference-capability') f.currentProviders[1].advanced_params = { taskModelCapabilities: JSON.stringify({ version: 1,
        models: { 'same-model': { supportsReferenceImages: false, maxReferenceImages: 0, outputKinds: ['image'] } } }) };
      const accepted = structuredClone(f.state.task.result.sketchImageExecution);
      expect(await publish(f)).toBe(false);
      expect(f.state.task.status).toBe('processing'); expect(f.state.task.credit_status).toBe('pending');
      expect(f.state.task.result.sketchImageExecution).toEqual(accepted);
      expect(f.state.assets).toEqual([]); expect(f.state.versions).toEqual([]); expect(f.saved).toEqual([]);
      expect(f.state.transactions).toHaveLength(1); expect(f.state.transactions[0].amount).toBe(-37);
      expect(f.state.task.refunded_transaction_id).toBeNull(); expect(writes(f)).toEqual([]);
    });
  it.each(['analysis', 'analysis-complete', 'generation'])('rejects nonaccepted %s checkpoint', async phase => { const f = fixture(); f.value.checkpoint = { ...f.value.checkpoint, phase: phase as 'accepted' }; expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]); });
  it.each(['absent', 'analysis', 'routing', 'receipt', 'usage'])('private checkpoint mismatch %s', async key => {
    const f = fixture(); const c = f.state.task.result.sketchImageExecution as Row;
    if (key === 'absent') delete f.state.task.result.sketchImageExecution;
    if (key === 'analysis') (c.analysis as Row).prompt = 'different'; if (key === 'routing') (c.routing as Row).image = 'c'.repeat(64);
    if (key === 'receipt') (c.receipt as Row).usedProviderId = 'vision-provider'; if (key === 'usage') c.usage = { inputTokens: 0, outputTokens: 0 };
    expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]);
  });
  it('direct receipt refuses any other direct URL', async () => { const f = fixture(); f.value.imageUrl = url(jpeg, 'image/jpeg'); expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]); });
  it.each(['getter', 'toJSON', 'symbol', 'cycle', 'extra'])('business snapshot rejects %s without invoking executable values', async key => {
    const f = fixture(), called = vi.fn(); const value = f.value as unknown as Row;
    if (key === 'getter') Object.defineProperty(value, 'checkpoint', { get: called }); if (key === 'toJSON') (f.value.identity as unknown as Row).toJSON = called;
    if (key === 'symbol') Object.defineProperty(f.value.identity, Symbol('hidden'), { value: 1 }); if (key === 'cycle') (f.value.identity as unknown as Row).loop = f.value.identity;
    if (key === 'extra') value.html = '<html></html>'; expect(await publish(f)).toBe(false); expect(called).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  });
  it.each(['cancelled', 'refunded', 'owner', 'attempt', 'expiry', 'digest', 'provider', 'price'])('refuses original task mismatch %s', async key => {
    const f = fixture(), t = f.state.task;
    if (key === 'cancelled') t.status = 'cancelled'; if (key === 'refunded') t.refunded_transaction_id = 'refund'; if (key === 'owner') t.lease_owner = 'other';
    if (key === 'attempt') t.attempt_count++; if (key === 'expiry') t.lease_expires_at = String(f.value.lease.expiresAt + 1);
    if (key === 'digest') t.request_digest = 'f'.repeat(64); if (key === 'provider') t.provider_id = 'vision-provider'; if (key === 'price') t.credit_cost = 38;
    expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]);
  });
  it.each(['clock', 'cancel', 'grant', 'checkpoint', 'ledger'])('rechecks after ledger locks for %s', async key => {
    const f = fixture(); if (key === 'grant') collaborator(f);
    f.before = call => { if (call.sql.includes('FROM wujie_credit_transactions')) {
      if (key === 'clock') f.now = f.value.lease.expiresAt; if (key === 'cancel') f.state.task.status = 'cancelled'; if (key === 'grant') f.grant = '5';
      if (key === 'checkpoint') (f.state.task.result.sketchImageExecution as Row).routing = { vision: 'c'.repeat(64), image: 'b'.repeat(64) };
      if (key === 'ledger') f.state.transactions[0].amount = -1;
    } }; expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]);
  });
  it.each(['clock', 'cancel', 'grant', 'checkpoint', 'ledger'])('rechecks before commit for %s and rolls back created assets', async key => {
    const f = fixture(); if (key === 'grant') collaborator(f);
    f.before = call => { if (call.sql.includes('UPDATE cloud_tasks') && call.sql.includes('AS committed')) {
      if (key === 'clock') f.now = f.value.lease.expiresAt; if (key === 'cancel') f.state.task.status = 'cancelled'; if (key === 'grant') f.grant = '5';
      if (key === 'checkpoint') (f.state.task.result.sketchImageExecution as Row).routing = { vision: 'c'.repeat(64), image: 'b'.repeat(64) };
      if (key === 'ledger') f.state.transactions[0].amount = -1;
    } }; expect(await publish(f)).toBe(false); expect(f.state.versions).toEqual([]); expect(f.cleaned).toHaveLength(2); expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
  });
  it.each(['input-metadata', 'output-metadata', 'completed-ref', 'completed-analysis'])('re-reads final completed projections after the completion SQL: %s', async key => {
    const f = fixture(); let changed = false;
    f.before = call => { if (!changed && f.state.task.status === 'completed' && call.sql.includes('AS now_ms FROM cloud_tasks')) {
      changed = true;
      if (key === 'input-metadata') (input(f).metadata as Row).visionProviderId = 'other';
      if (key === 'output-metadata') (output(f).metadata as Row).analysis = { ...f.value.checkpoint.analysis, prompt: 'other' };
      if (key === 'completed-ref') f.state.task.result.imageAssetVersionId = 'foreign';
      if (key === 'completed-analysis') f.state.task.result.analysis = { ...f.value.checkpoint.analysis, prompt: 'other' };
    } }; expect(await publish(f)).toBe(false); expect(changed).toBe(true); expect(f.state.versions).toEqual([]); expect(f.cleaned).toHaveLength(2);
  });
  it('rejects an expired publication deadline even when the original lease remains valid', async () => {
    const f = fixture(); f.now = Date.now() + 31_000; expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]);
  });
  it('definite financial rejection remains pending without inventing full-refund authority', async () => {
    const f = fixture(token, { inputTokens: 1000, outputTokens: 0 }); expect(await publish(f)).toBe(false);
    expect(f.state.transactions).toHaveLength(1); expect(f.state.task.status).toBe('processing'); expect(f.state.task.refunded_transaction_id).toBeNull(); expect(f.saved).toEqual([]);
  });
  it.each(['truncated', 'mime', 'svg', 'size'])('actual output validation rejects %s', async key => {
    const f = fixture(); remote(f, key === 'size' ? Buffer.alloc(32 * 1024 * 1024 + 1) : key === 'truncated' ? png.subarray(0, 45) : key === 'svg' ? Buffer.from('<svg/>') : png,
      key === 'mime' ? 'image/jpeg' : key === 'svg' ? 'image/svg+xml' : 'image/png'); expect(await publish(f)).toBe(false); expect(f.state.versions).toEqual([]);
  });
  it.each(['wrong-bytes', 'wrong-dimensions', 'external-url', 'sql-metadata'])('verifies actual managed files and SQL metadata against %s persistence', async mode => {
    const f = fixture(); f.persistMode = mode; expect(await publish(f)).toBe(false); expect(f.state.versions).toEqual([]); expect(f.cleaned.length).toBeGreaterThan(0);
  });
});
describe('completed ACK-loss verification, not a new financial or model attempt', () => {
  it('valid replay re-reads both original managed binaries and three projections without any writes', async () => {
    const f = await completed(); expect(await publish(f)).toBe(true); expect(writes(f)).toEqual([]); expect(f.saved).toEqual([]); expect(f.state.transactions).toHaveLength(2);
  });
  it.each(['parent', 'same-asset', 'input-ref', 'output-ref', 'current', 'schema', 'role', 'actor', 'model', 'analysis', 'settlement-task', 'settlement-input', 'settlement-output', 'checksum', 'dimensions', 'availability', 'ledger', 'lease', 'clock'])('replay rejects %s', async key => {
    const f = await completed(), v = output(f), m = v.metadata as Row;
    if (key === 'parent') v.parent_version_ids = []; if (key === 'same-asset') v.asset_id = input(f).asset_id;
    if (key === 'input-ref') f.state.task.result.previewAssetVersionId = 'foreign'; if (key === 'output-ref') f.state.task.result.imageAssetId = 'foreign';
    if (key === 'current') f.state.assets.find(a => a.id === v.asset_id)!.current_version_id = 'other'; if (key === 'schema') m.schemaId = 'wrong';
    if (key === 'role') m.role = 'input-sketch'; if (key === 'actor') m.actorUserId = 'owner'; if (key === 'model') m.imageProviderId = 'vision-provider';
    if (key === 'analysis') (m.analysis as Row).prompt = 'bad'; if (key.startsWith('settlement-')) {
      const projection = key === 'settlement-task' ? f.state.task.result.sketchImageSettlement : (key === 'settlement-input' ? input(f).metadata as Row : m).sketchImageSettlement;
      (projection as Row).actualCredits = 0;
    }
    if (key === 'checksum') v.checksum = '0'.repeat(64); if (key === 'dimensions') v.width = 999; if (key === 'availability') v.availability = 'missing';
    if (key === 'ledger') f.state.transactions.push({ ...f.state.transactions[0], id: 'extra' }); if (key === 'lease') f.state.task.attempt_count++;
    if (key === 'clock') f.now = f.value.lease.expiresAt;
    expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]); expect(f.saved).toEqual([]); expect(f.cleaned).toEqual([]);
  });
  it('replay actually detects same-size corrupted managed bytes', async () => {
    const f = await completed(), v = output(f); const local = path.join(isolation.root, 'exports', path.basename(v.file_url as string));
    const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1; await fs.writeFile(local, corrupt);
    expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]);
  });
  it('data receipt replay binds the managed output to the original receipt bytes, not replaced matching metadata', async () => {
    const f = await completed(), v = output(f);
    const replacement = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#00f' } }).png().toBuffer();
    await fs.writeFile(path.join(isolation.root, 'exports', path.basename(v.file_url as string)), replacement);
    v.checksum = sha(replacement); v.byte_size = replacement.length;
    expect(await publish(f)).toBe(false); expect(writes(f)).toEqual([]); expect(f.saved).toEqual([]);
  });
});
describe('commit uncertainty and confirmed rollback cleanup', () => {
  it.each(['before', 'after'] as const)('commit failure %s ACK discards with fixed error, no rollback/cleanup/refund', async mode => {
    const f = fixture(token, { inputTokens: 0, outputTokens: 0 }); f.commitFailure = mode;
    await expect(publish(f)).rejects.toThrow(/^SKETCH_IMAGE_PUBLICATION_UNCONFIRMED$/); expect(f.releases).toEqual([true]); expect(f.cleaned).toEqual([]);
    expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(false); expect(f.state.transactions).toHaveLength(2);
    if (mode === 'after') { f.commitFailure = 'none'; f.calls = []; expect(await publish(f)).toBe(true); expect(writes(f)).toEqual([]); }
  });
  it.each(['owned', 'unowned', 'referenced', 'rollback-failed'])('only confirmed rollback cleans owned unreferenced media: %s', async mode => {
    const f = fixture(); f.owned = mode !== 'unowned'; f.referenced = mode === 'referenced'; f.rollbackFailure = mode === 'rollback-failed';
    f.before = call => { if (call.sql.includes('UPDATE cloud_tasks') && call.sql.includes('AS committed')) throw new Error('completion failed'); };
    expect(await publish(f)).toBe(false); expect(f.cleaned).toHaveLength(mode === 'owned' ? 2 : 0); expect(f.releases).toEqual([mode === 'rollback-failed']);
    if (mode === 'owned') { const rollback = f.calls.findIndex(c => c.sql === 'ROLLBACK'), gate = f.calls.findIndex((c, i) => i > rollback && c.sql.startsWith('SELECT pg_advisory_xact_lock(')); expect(gate).toBeGreaterThan(rollback); }
  });
  it('does not release or rollback a busy query on cancellation, then uses actual rollback ACK', async () => {
    const f = fixture(), controller = new AbortController(); f.value.signal = controller.signal;
    let unblock!: () => void, entered!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.before = async call => { if (call.sql.includes('FROM wujie_credit_transactions')) { entered(); await blocked; } };
    const pending = publish(f); expect(await Promise.race([started.then(() => true), pending.then(() => false)])).toBe(true);
    controller.abort(); await new Promise(resolve => setTimeout(resolve, 10)); expect(f.releases).toEqual([]); expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(false);
    unblock(); expect(await pending).toBe(false); expect(f.releases).toEqual([false]); expect(writes(f)).toEqual([]);
  });
  it('aborted COMMIT consumer never releases the busy producer or starts rollback; known ACK can still finish', async () => {
    const f = fixture(), controller = new AbortController(); f.value.signal = controller.signal;
    let unblock!: () => void, entered!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.before = async call => { if (call.sql === 'COMMIT') { entered(); await blocked; } };
    const pending = publish(f); expect(await Promise.race([started.then(() => true), pending.then(() => false)])).toBe(true);
    controller.abort(); await new Promise(resolve => setTimeout(resolve, 10)); expect(f.releases).toEqual([]); expect(f.cleaned).toEqual([]); expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(false);
    unblock(); expect(await pending).toBe(true); expect(f.releases).toEqual([false]); expect(f.state.task.status).toBe('completed');
  });
  it('waits for actual ROLLBACK ACK before graph-gated cleanup and release', async () => {
    const f = fixture(); let unblock!: () => void, entered!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.before = async call => {
      if (call.sql.includes('UPDATE cloud_tasks') && call.sql.includes('AS committed')) throw new Error('completion failure');
      if (call.sql === 'ROLLBACK') { entered(); await blocked; }
    };
    const pending = publish(f); expect(await Promise.race([started.then(() => true), pending.then(() => false)])).toBe(true);
    expect(f.releases).toEqual([]); expect(f.cleaned).toEqual([]); unblock(); expect(await pending).toBe(false); expect(f.cleaned).toHaveLength(2); expect(f.releases).toEqual([false]);
  });
  it('detaches persistence ownership evidence without freezing the live persistence result', async () => {
    const f = fixture(), originalPersist = f.deps.persistBytes!;
    let first: Awaited<ReturnType<typeof originalPersist>> | undefined;
    f.deps.persistBytes = async value => { const saved = await originalPersist(value);
      if (first) first.createdThisCall = false; else first = saved; return saved;
    };
    f.before = call => { if (call.sql.includes('UPDATE cloud_tasks') && call.sql.includes('AS committed')) throw new Error('completion failure'); };
    expect(await publish(f)).toBe(false); expect(f.cleaned).toHaveLength(2); expect(Object.isFrozen(first)).toBe(false);
  });
});

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertOwnedSketchSchema, readOwnedSketchFixture, withOwnedSketchPostgres,
} from '../helpers/owned-sketch-postgres-fixture';
import type { IsolatedPostgresContext, QueryFn } from '../helpers/postgres-test-database';
import { ensureCoreTables } from '@/lib/db-storage';
import { getPool } from '@/lib/db-client';
import { ensureCloudTaskTables, getCloudTaskById, type PersistedCloudTask } from '@/lib/cloud-task-storage';
import { authorizeGenerationProject } from '@/lib/collaboration/generation-project-access';
import { revokeDocumentEditor } from '@/lib/collaboration/document-access';
import { persistAssetBytes, type PersistedAssetFile } from '@/lib/asset-core/binary-persistence';
import { createAssetStorageTransaction } from '@/lib/asset-core/storage';
import { readManagedAssetVersionBytes } from '@/lib/asset-core/managed-media-read';
import type { TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';
import type { OrdinaryQueryResult } from '@/lib/task-core/ordinary-generation-provider';
import type { CreditPricingConfig } from '@/lib/credit-pricing';
import type { PoolClient } from 'pg';
import { getApiProviders } from '@/lib/server-api-config';
import { createConfiguredSketchImageDependencies } from '@/lib/sketch-to-code/configured-image-dependencies';
import { sketchImageModelConfig, sketchImageFixtureRouting } from '../helpers/sketch-image-model-config';
import type { SketchImageAnalysis, SketchImageInput } from '@/lib/sketch-to-code/image-contract';
import type { SketchImageGenerationDependencies } from '@/lib/sketch-to-code/image-generation';
import { admitSketchImageTask, type SketchImageTaskAdmission } from '@/lib/sketch-to-code/image-admission';
import { readSketchImageCheckpoint, type SketchImageRouting } from '@/lib/sketch-to-code/image-execution';
import { readSketchImageTaskIdentity, type SketchImageTaskIdentity } from '@/lib/sketch-to-code/image-task-state';
import { executeSketchImageTask, recoverSketchImageTask, type SketchImageWorkerDependencies, type SketchImagePublicationValue } from '@/lib/sketch-to-code/image-worker';
import { publishSketchImageTask } from '@/lib/sketch-to-code/image-publication';
import { readSketchImageResult } from '@/lib/sketch-to-code/image-result';
import { cancelSketchImageTask, pollSketchImageTask } from '@/lib/sketch-to-code/image-public-http';
import { markSketchImageKnownFailure } from '@/lib/sketch-to-code/image-known-failure';

// No business/database mock. Only the server import sentinel and external S3
// upload are replaced; migrations, SQL, billing, authority, leases, decoding,
// local persistence, publisher, protected reader and public helpers stay real.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(),
  uploadBinaryToS3: async (): Promise<null> => null,
}));
afterEach((): void => { vi.unstubAllEnvs(); });

const analysis: SketchImageAnalysis = Object.freeze({
  summary: '手绘山与太阳', composition: '左侧山峰，右上太阳',
  prompt: '保持草图构图，生成蓝色山峰插画', negativePrompt: '水印，文字',
});
let routing: Readonly<SketchImageRouting>;

function makePng(width: number, height: number, fill: string): string {
  const canvas = createCanvas(width, height), context = canvas.getContext('2d');
  context.fillStyle = fill; context.fillRect(0, 0, width, height);
  context.strokeStyle = '#111111'; context.beginPath(); context.moveTo(0, height - 1);
  context.lineTo(width / 2, 0); context.lineTo(width - 1, height - 1); context.stroke();
  return canvas.toDataURL('image/png');
}
// Actual differently sized/colored PNGs, never a header-only or external image.
const inputPng = makePng(6, 4, '#ffffff'), outputPng = makePng(8, 6, '#3366cc');
const inputBytes = Buffer.from(inputPng.split(',')[1], 'base64');
const outputBytes = Buffer.from(outputPng.split(',')[1], 'base64');

interface Calls { analysis: number; generation: number; remoteIds: string[] }
interface FixtureOptions {
  usage?: { inputTokens: number; outputTokens: number };
  generate?: SketchImageGenerationDependencies['generate'];
  analyze?: SketchImageGenerationDependencies['analyze'];
  query?: SketchImageWorkerDependencies['query'];
}
interface ImageFixture {
  calls: Calls;
  generation: SketchImageGenerationDependencies;
  worker: SketchImageWorkerDependencies;
}
function descriptor(providerId: string, modelId: string): TaskModelDescriptor {
  const vision = providerId === 'vision-provider' && modelId === 'vision-model';
  if (!vision && !(providerId === 'image-provider' && modelId === 'image-model')) {
    throw new Error('Unexpected synthetic model binding');
  }
  return {
    providerId, modelId, kind: vision ? 'chat' : 'image', sourceType: vision ? 'vlm' : 'image',
    protocol: vision ? 'chat-completions' : 'openai', executionMode: vision ? 'sync' : 'async',
    allowedRatios: vision ? [] : ['4:3'], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
    supportsVision: vision, supportsReferenceImages: !vision, supportsMask: false,
    outputKinds: vision ? ['text'] : ['image'], capabilitySources: {},
    ...(!vision ? { maxReferenceImages: 1, supportedOperations: ['image-to-image' as const] } : {}),
  };
}
function directReceipt(): { taskIds: string[]; directImageUrls: string[]; usedModel: string; usedProviderId: string } {
  return { taskIds: [], directImageUrls: [outputPng], usedModel: 'image-model', usedProviderId: 'image-provider' };
}
function fixture(files: PersistedAssetFile[], options: FixtureOptions = {}): ImageFixture {
  const calls: Calls = { analysis: 0, generation: 0, remoteIds: [] };
  const generation: SketchImageGenerationDependencies = {
    authorizeProject: (actorUserId: string, projectId: string) => authorizeGenerationProject({ actorUserId, projectId }),
    resolveTaskModel: async (providerId: string, modelId: string, actorUserId: string): Promise<TaskModelDescriptor> => {
      expect(['owner', 'editor']).toContain(actorUserId);
      return descriptor(providerId, modelId);
    },
    analyze: async (image: string, instruction: string, binding, signal: AbortSignal): Promise<unknown> => {
      calls.analysis++; signal.throwIfAborted();
      expect(image).toBe(inputPng); expect(instruction).toBe('蓝色山峰，保持手绘构图');
      expect(binding).toEqual({ providerId: 'vision-provider', modelId: 'vision-model' });
      return options.analyze ? options.analyze(image, instruction, binding, signal)
        : { analysis, ...(options.usage ? { usage: options.usage } : {}) };
    },
    generate: async (body, binding, signal: AbortSignal): Promise<unknown> => {
      calls.generation++; signal.throwIfAborted();
      expect(body.referenceImages).toEqual([inputPng]);
      expect(binding).toEqual({ providerId: 'image-provider', modelId: 'image-model' });
      return options.generate ? options.generate(body, binding, signal) : directReceipt();
    },
  };
  const worker: SketchImageWorkerDependencies = {
    routing,
    // Original synthetic compute ports; routing now freezes the seeded real
    // catalogue. Publication still uses its real current-model SQL fence.
    checkCurrent: async (identity, signal: AbortSignal): Promise<Readonly<SketchImageRouting>> => {
      signal.throwIfAborted();
      const access = await authorizeGenerationProject({ actorUserId: identity.actorUserId, projectId: identity.projectId });
      if (!isDeepStrictEqual(access, identity.access)) throw new Error('Current project authority changed');
      signal.throwIfAborted(); return routing;
    },
    query: async (remoteId: string, identity, signal: AbortSignal): Promise<Readonly<OrdinaryQueryResult>> => {
      calls.remoteIds.push(remoteId); signal.throwIfAborted();
      expect(identity.input.imageProviderId).toBe('image-provider'); expect(identity.input.imageModelId).toBe('image-model');
      if (!options.query) throw new Error('Direct receipt must not query a provider');
      return options.query(remoteId, identity, signal);
    },
    // Observe cleanup capabilities, but delegate every write/validation to the
    // original persistence. No fabricated file descriptor or replacement SQL.
    publisher: value => publishSketchImageTask(value, { persistBytes: async input => {
      const saved = await persistAssetBytes(input); files.push(saved); return saved;
    } }),
  };
  return { calls, generation, worker };
}
function request(projectId = 'personal'): SketchImageInput {
  return { projectId, imageDataUrl: inputPng, instruction: '蓝色山峰，保持手绘构图',
    visionProviderId: 'vision-provider', visionModelId: 'vision-model',
    imageProviderId: 'image-provider', imageModelId: 'image-model', idempotencyKey: randomUUID(), aspectRatio: '4:3' };
}
function pricing(mode: 'flat' | 'token' | 'free' = 'flat'): CreditPricingConfig {
  return { modelCredits: {
    'vision-provider::vision-model': mode === 'token'
      ? { credits: 7, tokenPricing: { input: 1_000_000, output: 1_000_000 } } : mode === 'free' ? 0 : 7,
    'image-provider::image-model': mode === 'free' ? 0 : 11,
  } };
}
async function admission(value: SketchImageInput, f: ImageFixture, mode: 'flat' | 'token' | 'free' = 'flat',
  actorUserId = 'owner'): Promise<SketchImageTaskAdmission> {
  return admitSketchImageTask(value, { actorUserId, signal: new AbortController().signal }, {
    generation: f.generation, loadPricingConfig: async (): Promise<CreditPricingConfig> => pricing(mode),
  });
}
async function originalTask(taskId: string): Promise<PersistedCloudTask> {
  const task = await getCloudTaskById(taskId);
  if (!task) throw new Error('Original real task missing');
  return task;
}
async function seed(context: IsolatedPostgresContext): Promise<void> {
  assertOwnedSketchSchema(context.databaseUrl);
  const migrations = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, DATABASE_URL: context.databaseUrl, PGDATABASE_URL: context.databaseUrl },
  });
  expect(migrations.status, migrations.stdout + migrations.stderr).toBe(0);
  expect(migrations.signal).toBeNull(); expect(migrations.error).toBeUndefined();
  await ensureCoreTables(); await ensureCloudTaskTables();
  for (const row of sketchImageModelConfig('vision-model', 'image-model').rows) {
    if (row.id === 'image-provider') {
      // The original unknown-model OpenAI profile requires multipart edits.
      // Use an explicitly supported JSON reference-image protocol for this transport fixture.
      const params = row.advanced_params as Record<string, string>;
      const capabilities = JSON.parse(params.taskModelCapabilities) as { version: 1; models: Record<string, Record<string, unknown>> };
      capabilities.models['image-model'].protocol = 'apimart';
      row.advanced_params = { ...params, compatProfile: 'apimart', taskModelCapabilities: JSON.stringify(capabilities) };
    }
    await context.query(`INSERT INTO wujie_api_providers
      (id,name,display_name,base_url,api_key,is_enabled,type,model_type,request_style,selected_models,advanced_params,
       is_default,created_at,updated_at,connection_status,discovered_models,sort_order,balance_username,balance_password)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)`,
    [row.id,row.name,row.display_name,row.base_url,row.api_key,row.is_enabled,row.type,row.model_type,row.request_style,
      row.selected_models,JSON.stringify(row.advanced_params),row.is_default,row.created_at,row.updated_at,
      row.connection_status,JSON.stringify(row.discovered_models),row.sort_order,row.balance_username,row.balance_password]);
  }
  routing = await sketchImageFixtureRouting(await getApiProviders({ strict: true, migrateFileProviders: false }));
  await context.query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('owner','Owner','test','active','user',1,1),('editor','Editor','test','active','user',1,1),
    ('reader','Reader','test','active','user',1,1),('stranger','Stranger','test','active','admin',1,1)`);
  // Real managed-user reads require the already-present default administrator.
  // Reuse only the existing synthetic admin row; never bootstrap credentials/files.
  await context.query("UPDATE wujie_users SET name='Mr.joker' WHERE id='stranger'");
  await context.query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','owner','Personal'),('shared','owner','Shared')");
  await context.query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)");
  await context.query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('shared','owner')");
  await context.query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor'),('shared','owner','reader')");
  await context.query("INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at) SELECT 'c_'||id,id,100,100,0,1,1 FROM wujie_users");
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
}
async function ownedCase(name: string,
  run: (context: IsolatedPostgresContext, files: PersistedAssetFile[]) => Promise<void>): Promise<void> {
  // Mandatory proof BEFORE calling a helper whose historical no-receipt branch
  // otherwise permits generic PG. No skip, legacy-cluster or business fallback.
  const receipt = readOwnedSketchFixture();
  if (!receipt) throw new Error('TASK6 explicit owned sketch receipt is required for image PG acceptance');
  const files: PersistedAssetFile[] = [];
  let failed = false, operationError: unknown;
  try {
    await withOwnedSketchPostgres(name, async (context): Promise<void> => {
      assertOwnedSketchSchema(context.databaseUrl); await seed(context); await run(context, files);
    });
  } catch (error) { failed = true; operationError = error; }
  // The original helper has already drained/closed pools and dropped only this
  // schema. Now remove only files created by this test via their original native
  // cleanup capability; never enumerate/delete a media root or stop shared PG.
  const cleanupErrors: unknown[] = [];
  for (const file of files) {
    if (!file.createdThisCall) continue;
    try { await file.cleanup(); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError(failed ? [operationError, ...cleanupErrors] : cleanupErrors,
    'Owned image PG operation/file cleanup failed');
  if (failed) throw operationError;
}
async function counts(query: QueryFn): Promise<{ tasks: number; assets: number; versions: number; refunds: number }> {
  return (await query<{ tasks: number; assets: number; versions: number; refunds: number }>(`SELECT
    (SELECT count(*)::int FROM cloud_tasks) tasks, (SELECT count(*)::int FROM wujie_assets) assets,
    (SELECT count(*)::int FROM wujie_asset_versions) versions,
    (SELECT count(*)::int FROM wujie_credit_transactions WHERE type='refund') refunds`)).rows[0];
}
async function financial(query: QueryFn, taskId: string, actorUserId: string, actual: number,
  transactions: { type: string; amount: number; balance_after: number }[], refundModel = 'image-model'): Promise<void> {
  expect((await query('SELECT balance,total_used FROM wujie_credits WHERE user_id=$1', [actorUserId])).rows)
    .toEqual([{ balance: 100 - actual, total_used: actual }]);
  expect((await query(`SELECT type,amount,balance_after FROM wujie_credit_transactions
    WHERE task_id=$1 OR reference_id=$1
    ORDER BY CASE WHEN id=(SELECT charged_transaction_id FROM cloud_tasks WHERE id=$1) THEN 0 ELSE 1 END,id`, [taskId])).rows)
    .toEqual(transactions);
  expect((await query(`SELECT user_id,model,task_id,reference_id FROM wujie_credit_transactions WHERE task_id=$1
    ORDER BY CASE WHEN id=(SELECT charged_transaction_id FROM cloud_tasks WHERE id=$1) THEN 0 ELSE 1 END,id`, [taskId])).rows)
    .toEqual(transactions.map(row => ({ user_id: actorUserId,
      model: row.type === 'refund' ? refundModel : 'image-model', task_id: taskId, reference_id: taskId })));
}
async function delivered(query: QueryFn, taskId: string, actorUserId: string, projectId: string,
  reserve: number, actual: number, mode: 'flat' | 'token' | 'free' = 'flat'): Promise<void> {
  const task = await originalTask(taskId), identity = readSketchImageTaskIdentity(task);
  expect(task).toMatchObject({ type: 'sketch-to-image', status: 'completed', creditCost: reserve,
    creditStatus: reserve ? 'charged' : 'not-applicable', providerId: 'image-provider', model: 'image-model' });
  expect(task.refundedTransactionId).toBeUndefined();
  // Exercise original NUMERIC wire representation; do not register a driver
  // parser that would hide the reviewed SQL-boundary adapters.
  expect((await query('SELECT credit_cost::text reserve FROM cloud_tasks WHERE id=$1', [taskId])).rows)
    .toEqual([{ reserve: String(reserve) }]);
  const checkpoint = readSketchImageCheckpoint(task.result?.sketchImageExecution, identity);
  expect(checkpoint).toMatchObject({ phase: 'accepted', routing, analysis });
  const result = await readSketchImageResult({ actorUserId, projectId, taskId });
  expect(result).toMatchObject({ taskId, projectId, reserveCredits: reserve, actualCredits: actual,
    visionProviderId: 'vision-provider', visionModelId: 'vision-model',
    imageProviderId: 'image-provider', imageModelId: 'image-model', analysis });
  expect(result.pricing).toEqual({ version: 1,
    vision: { providerId: 'vision-provider', modelId: 'vision-model', calls: 1,
      mode: mode === 'token' ? 'token' : 'flat', reserveCredits: mode === 'free' ? 0 : 7,
      ...(mode === 'token' ? { tokenPricing: { input: 1_000_000, output: 1_000_000 } } : {}) },
    image: { providerId: 'image-provider', modelId: 'image-model', calls: 1, credits: mode === 'free' ? 0 : 11 },
    totalReserveCredits: reserve });
  expect(result.imageAssetId).not.toBe(result.previewAssetId);
  expect(result.imageAssetVersionId).not.toBe(result.previewAssetVersionId);
  const client = await getPool().connect();
  try {
    const storage = createAssetStorageTransaction(client);
    const preview = await storage.findVersion('owner', projectId, result.previewAssetVersionId);
    const image = await storage.findVersion('owner', projectId, result.imageAssetVersionId);
    if (!preview || !image) throw new Error('Original persisted versions missing');
    expect(preview).toMatchObject({ assetId: result.previewAssetId, taskId, ownerId: 'owner', projectId, parentVersionIds: [],
      metadata: { schemaId: 'sketch-image-input-v1', role: 'input-sketch', taskId } });
    expect(image).toMatchObject({ assetId: result.imageAssetId, taskId, ownerId: 'owner', projectId,
      parentVersionIds: [preview.id], metadata: { schemaId: 'sketch-image-output-v1', role: 'generated-image', taskId } });
    for (const version of [preview, image]) {
      expect(version.metadata).toMatchObject({ visionProviderId: 'vision-provider', visionModelId: 'vision-model',
        imageProviderId: 'image-provider', imageModelId: 'image-model',
        sketchImageSettlement: { reserveCredits: reserve, actualCredits: actual, deltaCredits: actual - reserve } });
    }
    const source = await readManagedAssetVersionBytes(preview, 'image', { maxBytes: 4 * 1024 * 1024 });
    const output = await readManagedAssetVersionBytes(image, 'image', { maxBytes: 32 * 1024 * 1024 });
    expect(source.bytes.equals(inputBytes)).toBe(true); expect(output.bytes.equals(outputBytes)).toBe(true);
    expect(output.bytes.equals(inputBytes)).toBe(false);
    expect(preview.file).toMatchObject({ width: 6, height: 4, mimeType: 'image/png',
      checksum: createHash('sha256').update(inputBytes).digest('hex') });
    expect(image.file).toMatchObject({ width: 8, height: 6, mimeType: 'image/png',
      checksum: createHash('sha256').update(outputBytes).digest('hex') });
  } finally { client.release(); }
  // Default protected-result dependency, not a mocked completed projection.
  const response = await pollSketchImageTask({ taskId, projectId, providerId: 'image-provider', model: 'image-model' },
    task, identity.actorUserId, `owned-image-${taskId}`);
  expect(response.status).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(body).toMatchObject({ success: true, status: 'completed', taskId, projectId,
    reserveCredits: reserve, actualCredits: actual, imageAssetId: result.imageAssetId,
    imageAssetVersionId: result.imageAssetVersionId, previewAssetId: result.previewAssetId,
    previewAssetVersionId: result.previewAssetVersionId, imageUrl: result.imageUrl, previewUrl: result.previewUrl });
  expect(body).not.toHaveProperty('sketchImageAdmission'); expect(body).not.toHaveProperty('sketchImageExecution');
  expect(body).not.toHaveProperty('imageDataUrl'); expect(body).not.toHaveProperty('html');
}
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolveGate => { open = resolveGate; });
  return { promise, open };
}

async function configuredCase(files: PersistedAssetFile[]): Promise<{
  accepted: SketchImageTaskAdmission; worker: SketchImageWorkerDependencies; calls: Calls;
}> {
  const calls: Calls = { analysis: 0, generation: 0, remoteIds: [] };
  // Only transport is synthetic. Real selected-provider/user/model resolution,
  // capability checks, protocol factories, response readers and SQL stay loaded.
  const configured = createConfiguredSketchImageDependencies({ requestId: 'owned-configured-model',
    transport: async (url, options): Promise<Response> => {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      expect(options?.method).toBe('POST');
      if (url === 'https://vision.example.invalid/v1/chat/completions') {
        calls.analysis++; expect(body.model).toBe('vision-model'); expect(JSON.stringify(body)).toContain(inputPng);
        return Response.json({ model: 'vision-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] });
      }
      if (url === 'https://image.example.invalid/v1/images/generations') {
        calls.generation++; expect(body.model).toBe('image-model'); expect(JSON.stringify(body)).toContain(inputPng);
        return Response.json({ model: 'image-model', data: [{ b64_json: outputBytes.toString('base64') }] });
      }
      throw new Error('OWNED_MODEL_EXTERNAL_NETWORK_FORBIDDEN');
    } });
  const accepted = await admitSketchImageTask(request(), { actorUserId: 'owner', signal: new AbortController().signal }, {
    generation: configured.generation, loadPricingConfig: async () => pricing(),
  });
  const worker: SketchImageWorkerDependencies = { routing: configured.routing(), checkCurrent: configured.checkCurrent, query: configured.query,
    publisher: value => publishSketchImageTask(value, { persistBytes: async input => {
      const saved = await persistAssetBytes(input); files.push(saved); return saved;
    } }) };
  return { accepted, worker, calls };
}
async function retainedReceipt(query: QueryFn, taskId: string): Promise<void> {
  const task = await originalTask(taskId), identity = readSketchImageTaskIdentity(task);
  expect(task).toMatchObject({ status: 'processing', creditStatus: 'pending', creditCost: 18 });
  expect(task.refundedTransactionId).toBeUndefined();
  expect(readSketchImageCheckpoint(task.result?.sketchImageExecution, identity)).toMatchObject({ phase: 'accepted',
    receipt: { taskIds: [], directImageUrls: [outputPng], usedProviderId: 'image-provider', usedModel: 'image-model' } });
  await financial(query, taskId, 'owner', 18, [{ type: 'consume', amount: -18, balance_after: 82 }]);
  expect(await counts(query)).toEqual({ tasks: 1, assets: 0, versions: 0, refunds: 0 });
  expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([]);
}
async function observePublicationClient(before: (sql: string, client: PoolClient) => Promise<void>,
  repeatableRead = false): Promise<PoolClient> {
  const client = await getPool().connect();
  try {
    if (repeatableRead) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    return new Proxy(client, { get(target, key): unknown {
      if (key === 'query') return async (...args: unknown[]): Promise<unknown> => {
        if (typeof args[0] !== 'string') throw new Error('OWNED_SQL_OBSERVER_EXPECTED_STRING');
        await before(args[0].trim().replace(/\s+/g, ' '), target);
        const query = Reflect.get(target, 'query') as (...args: unknown[]) => Promise<unknown>;
        return query.apply(target, args);
      };
      // A test-only session setting must never leak to the next pooled consumer.
      if (key === 'release' && repeatableRead) return (): void => target.release(true);
      const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
  } catch (error) { client.release(true); throw error; }
}
async function waitForSqlBlock(query: QueryFn, writerPid: number, publisherPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  do {
    const rows = (await query<{ blocked: boolean }>('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked', [writerPid, publisherPid])).rows;
    if (rows[0]?.blocked) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  } while (Date.now() < deadline);
  throw new Error('OWNED_CONFIG_WRITER_NOT_BLOCKED_BY_PUBLICATION');
}

describe.sequential('I1 real configured models and original publication transaction', () => {
  it.each(['active', 'disabled'])('preserves existing default-administrator normalization without persisting privileges (%s)', async status => {
    await ownedCase('image_pg_default_admin', async ({ query }, files) => {
      await query("UPDATE wujie_users SET name='Stranger' WHERE id='stranger'");
      await query(`UPDATE wujie_users SET name='Mr.joker',role='user',status=$1,
        chat_models=ARRAY['other-provider::other-model']::text[],
        image_models=ARRAY['other-provider::other-model']::text[],
        api_permissions='{"chat":false,"image":false}'::jsonb WHERE id='owner'`, [status]);
      const usersBefore = (await query('SELECT * FROM wujie_users ORDER BY id')).rows;
      if (status === 'disabled') {
        await expect(configuredCase(files)).rejects.toThrow('SKETCH_IMAGE_CONFIGURATION_UNAVAILABLE');
        expect(await counts(query)).toEqual({ tasks: 0, assets: 0, versions: 0, refunds: 0 });
        await financial(query, '', 'owner', 0, []);
      } else {
        const f = await configuredCase(files);
        expect(await executeSketchImageTask(f.accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker))
          .toEqual({ status: 'completed' });
        await delivered(query, f.accepted.task.id, 'owner', 'personal', 18, 18);
        await financial(query, f.accepted.task.id, 'owner', 18, [{ type: 'consume', amount: -18, balance_after: 82 }]);
        expect(await counts(query)).toEqual({ tasks: 1, assets: 2, versions: 2, refunds: 0 });
        expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
      }
      expect((await query('SELECT * FROM wujie_users ORDER BY id')).rows).toEqual(usersBefore);
    });
  }, 30_000);

  it.each(['model-grant', 'provider-routing'])('retains accepted receipt if %s changes after the worker check but before publication', async change => {
    await ownedCase('image_pg_model_gap', async ({ query }, files) => {
      const f = await configuredCase(files), publisher = f.worker.publisher!;
      f.worker.publisher = async value => {
        if (change === 'model-grant') await query("UPDATE wujie_users SET image_models=ARRAY['other-provider::other-model']::text[] WHERE id='owner'");
        else await query("UPDATE wujie_api_providers SET base_url='https://changed.example.invalid/v1' WHERE id='vision-provider'");
        return publisher(value);
      };
      const observed = await executeSketchImageTask(f.accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker);
      expect(observed, JSON.stringify({ calls: f.calls, checkpoint: (await originalTask(f.accepted.task.id)).result?.sketchImageExecution }))
        .toEqual({ status: 'deferred', reason: 'SKETCH_IMAGE_PUBLICATION_UNCONFIRMED' });
      await retainedReceipt(query, f.accepted.task.id); expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
    });
  }, 30_000);

  it.each(['model-grant', 'provider-update'])('holds %s writer through actual COMMIT and preserves historical completed replay', async change => {
    await ownedCase('image_pg_commit_lock', async ({ query }, files) => {
      const f = await configuredCase(files), entered = gate(), release = gate();
      const writer = await getPool().connect();
      let publisherPid = 0, observedIsolation: unknown, publication: SketchImagePublicationValue | undefined, write: Promise<unknown> | undefined, settled = false;
      const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      f.worker.publisher = value => {
        publication = value;
        return publishSketchImageTask(value, { connect: () => observePublicationClient(async (sql, client) => {
          if (sql === 'COMMIT') { publisherPid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            observedIsolation = (await client.query('SHOW transaction_isolation')).rows;
            entered.open(); await release.promise; }
        }, true), persistBytes: async input => { const saved = await persistAssetBytes(input); files.push(saved); return saved; } });
      };
      const running = executeSketchImageTask(f.accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker);
      try {
        await Promise.race([entered.promise, running.then((result): never => { throw new Error(`Publisher ended before COMMIT observer: ${JSON.stringify({ result, calls: f.calls })}`); })]);
        write = writer.query(change === 'model-grant'
          ? "UPDATE wujie_users SET image_models=ARRAY['other-provider::other-model']::text[] WHERE id='owner'"
          : "UPDATE wujie_api_providers SET is_enabled=false WHERE id='image-provider'").finally(() => { settled = true; });
        // Register the failure consumer immediately; always release and drain below.
        void write.catch(() => undefined);
        await waitForSqlBlock(query, writerPid, publisherPid); expect(settled).toBe(false);
        expect(observedIsolation).toEqual([{ transaction_isolation: 'read committed' }]);
        release.open(); expect(await running).toEqual({ status: 'completed' }); await write;
        expect(publication).toBeDefined();
        expect(await publishSketchImageTask({ ...publication!, signal: new AbortController().signal })).toBe(true);
        expect((await readSketchImageResult({ actorUserId: 'owner', projectId: 'personal', taskId: f.accepted.task.id })).taskId).toBe(f.accepted.task.id);
        await financial(query, f.accepted.task.id, 'owner', 18, [{ type: 'consume', amount: -18, balance_after: 82 }]);
        expect(await counts(query)).toEqual({ tasks: 1, assets: 2, versions: 2, refunds: 0 });
        expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
      } finally { release.open(); await running; if (write) await write.catch(() => undefined); writer.release(); }
    });
  }, 30_000);

  it('does not publish a stale catalogue snapshot inherited from a pooled REPEATABLE READ session', async () => {
    await ownedCase('image_pg_current_snapshot', async ({ query }, files) => {
      const f = await configuredCase(files); let observed = false;
      f.worker.publisher = value => publishSketchImageTask(value, {
        connect: () => observePublicationClient(async sql => {
          if (sql === 'LOCK TABLE wujie_api_providers IN SHARE MODE' && !observed) {
            observed = true;
            await query("UPDATE wujie_api_providers SET base_url='https://changed.example.invalid/v1' WHERE id='vision-provider'");
          }
        }, true), persistBytes: async input => { const saved = await persistAssetBytes(input); files.push(saved); return saved; },
      });
      expect(await executeSketchImageTask(f.accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker))
        .toEqual({ status: 'deferred', reason: 'SKETCH_IMAGE_PUBLICATION_UNCONFIRMED' });
      expect(observed).toBe(true); await retainedReceipt(query, f.accepted.task.id);
      expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
    });
  }, 30_000);
});

describe.sequential('Task8 sketch image increment on mandatory owned real PostgreSQL', () => {
  it('publishes flat18 original PNG/new image and replays the original nonce without new work or charge', async (): Promise<void> => {
    await ownedCase('image_pg_flat', async ({ query }, files): Promise<void> => {
      const f = fixture(files), value = request('shared'), accepted = await admission(value, f, 'flat', 'editor');
      expect(accepted).toMatchObject({ reused: false, charged: true });
      expect(f.calls).toEqual({ analysis: 0, generation: 0, remoteIds: [] });
      expect(await executeSketchImageTask(accepted, { actorUserId: 'editor', projectId: 'shared' }, f.worker))
        .toEqual({ status: 'completed' });
      await delivered(query, accepted.task.id, 'reader', 'shared', 18, 18);
      await financial(query, accepted.task.id, 'editor', 18, [{ type: 'consume', amount: -18, balance_after: 82 }]);
      const before = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      const replay = await admission(value, f, 'flat', 'editor');
      expect(replay).toMatchObject({ reused: true, charged: false, task: { id: accepted.task.id, status: 'completed' } });
      expect(replay.prepared).toBeUndefined();
      expect(await executeSketchImageTask(replay, { actorUserId: 'editor', projectId: 'shared' }, f.worker))
        .toEqual({ status: 'skipped', reason: 'SKETCH_IMAGE_REUSED' });
      expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(before);
      expect(await counts(query)).toEqual({ tasks: 1, assets: 2, versions: 2, refunds: 0 });
      expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toHaveLength(0);
      await revokeDocumentEditor('owner', 'shared', 'reader');
      await expect(readSketchImageResult({ actorUserId: 'reader', projectId: 'shared', taskId: accepted.task.id }))
        .rejects.toThrow('SKETCH_IMAGE_RESULT_UNAVAILABLE');
    });
  }, 30_000);

  it.each([
    { inputTokens: 1, outputTokens: 1, actual: 13, type: 'refund', amount: 5, balance: 87 },
    { inputTokens: 10, outputTokens: 5, actual: 26, type: 'consume', amount: -8, balance: 74 },
  ])('settles Token reserve18 using true $inputTokens+$outputTokens usage to literal net $actual', async (example): Promise<void> => {
    await ownedCase('image_pg_token', async ({ query }, files): Promise<void> => {
      // Hand calculation: 1M credits/1M tokens => input+output, plus image11.
      // These literal expected values are NOT derived from pricing/settlement SUT.
      const f = fixture(files, { usage: { inputTokens: example.inputTokens, outputTokens: example.outputTokens } });
      const accepted = await admission(request(), f, 'token');
      expect(accepted.task.creditCost).toBe(18);
      expect(await executeSketchImageTask(accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker))
        .toEqual({ status: 'completed' });
      await delivered(query, accepted.task.id, 'owner', 'personal', 18, example.actual, 'token');
      await financial(query, accepted.task.id, 'owner', example.actual, [
        { type: 'consume', amount: -18, balance_after: 82 },
        { type: example.type, amount: example.amount, balance_after: example.balance },
      ]);
      expect(await counts(query)).toEqual({ tasks: 1, assets: 2, versions: 2, refunds: example.type === 'refund' ? 1 : 0 });
      // Original claim guard covers every refund, including the literal delta5.
      expect((await query('SELECT identity FROM wujie_refund_identity_claims ORDER BY identity')).rows)
        .toEqual(example.actual === 13 ? [{ identity: accepted.task.id }] : []);
      // A partial settlement refund is not a full terminal task refund.
      expect((await query('SELECT status,credit_status,refunded_transaction_id FROM cloud_tasks WHERE id=$1', [accepted.task.id])).rows)
        .toEqual([{ status: 'completed', credit_status: 'charged', refunded_transaction_id: '' }]);
      expect((await query(`SELECT
        EXISTS (SELECT 1 FROM pg_constraint claim_key JOIN pg_attribute identity_column
          ON identity_column.attrelid=claim_key.conrelid AND identity_column.attnum=claim_key.conkey[1]
          WHERE claim_key.conrelid=to_regclass('wujie_refund_identity_claims') AND claim_key.contype='p'
            AND claim_key.conname='wujie_refund_identity_claims_pkey' AND cardinality(claim_key.conkey)=1
            AND identity_column.attname='identity') AS primary_key,
        EXISTS (SELECT 1 FROM pg_trigger claim_trigger
          WHERE claim_trigger.tgrelid=to_regclass('wujie_credit_transactions')
            AND claim_trigger.tgname='trg_wujie_claim_refund_identity' AND claim_trigger.tgenabled IN ('O','A')
            AND claim_trigger.tgtype=23 AND cardinality(claim_trigger.tgattr)=0
            AND claim_trigger.tgfoid=to_regprocedure('wujie_claim_refund_identity()')) AS trigger_enabled`)).rows)
        .toEqual([{ primary_key: true, trigger_enabled: true }]);
      expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
    });
  }, 30_000);

  it('publishes free0 through the same guarded chain without financial transaction identities', async (): Promise<void> => {
    await ownedCase('image_pg_free', async ({ query }, files): Promise<void> => {
      const f = fixture(files), accepted = await admission(request(), f, 'free');
      expect(accepted).toMatchObject({ charged: false, reused: false });
      expect(await executeSketchImageTask(accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker))
        .toEqual({ status: 'completed' });
      await delivered(query, accepted.task.id, 'owner', 'personal', 0, 0, 'free');
      await financial(query, accepted.task.id, 'owner', 0, []);
      expect((await query('SELECT charged_transaction_id,refunded_transaction_id FROM cloud_tasks')).rows)
        .toEqual([{ charged_transaction_id: '', refunded_transaction_id: '' }]);
      expect((await query('SELECT * FROM wujie_refund_identity_claims')).rows).toHaveLength(0);
      expect(await counts(query)).toEqual({ tasks: 1, assets: 2, versions: 2, refunds: 0 });
    });
  }, 30_000);

  it('confirms original owner cancellation once after grant revocation and fences a late generation success', async (): Promise<void> => {
    await ownedCase('image_pg_cancel', async ({ query }, files): Promise<void> => {
      const entered = gate(), release = gate(), drained = gate();
      let generationStarted = false;
      const f = fixture(files, { generate: async (): Promise<unknown> => {
        generationStarted = true; entered.open(); await release.promise;
        try { return directReceipt(); } finally { drained.open(); }
      } });
      const accepted = await admission(request('shared'), f, 'flat', 'editor');
      const running = executeSketchImageTask(accepted, { actorUserId: 'editor', projectId: 'shared' }, f.worker);
      try {
        await Promise.race([entered.promise, running.then((): never => { throw new Error('Original worker ended before generation gate'); })]);
        await revokeDocumentEditor('owner', 'shared', 'editor');
        const task = await originalTask(accepted.task.id);
        const cancelBody = { taskId: task.id, projectId: 'shared' };
        const cancelled = await cancelSketchImageTask(cancelBody, task, 'editor', 'owned-image-cancel');
        expect(cancelled.status).toBe(200);
        expect(await cancelled.json()).toMatchObject({ success: true, status: 'cancelled', refunded: true });
        const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
        const repeated = await cancelSketchImageTask(cancelBody, await originalTask(task.id), 'editor', 'owned-image-cancel-repeat');
        expect(repeated.status).toBe(200); expect(await repeated.json()).toMatchObject({ refunded: true });
        expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
      } finally { release.open(); if (generationStarted) await drained.promise; await running; }
      expect(await running).toEqual({ status: 'deferred', reason: 'SKETCH_IMAGE_EXECUTION_UNCONFIRMED' });
      expect((await originalTask(accepted.task.id))).toMatchObject({ status: 'cancelled', creditStatus: 'refunded' });
      await financial(query, accepted.task.id, 'editor', 0, [
        { type: 'consume', amount: -18, balance_after: 82 }, { type: 'refund', amount: 18, balance_after: 100 },
      ], ''); // Original generic terminal refund omits model, preserving schema default ''.
      expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: accepted.task.id }]);
      expect(await counts(query)).toEqual({ tasks: 1, assets: 0, versions: 0, refunds: 1 });
      expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: [] });
    });
  }, 30_000);

  it('settles only the private known analysis failure under original phase/lease/ledger authority', async (): Promise<void> => {
    await ownedCase('image_pg_known_failure', async ({ query }, files): Promise<void> => {
      const f = fixture(files, { analyze: async (): Promise<never> => {
        throw markSketchImageKnownFailure(new Error('Synthetic known rejection'), {
          phase: 'analysis', providerId: 'vision-provider', modelId: 'vision-model', kind: 'rejected',
        });
      } });
      const accepted = await admission(request(), f);
      expect(await executeSketchImageTask(accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker))
        .toEqual({ status: 'failed' });
      const task = await originalTask(accepted.task.id);
      expect(task).toMatchObject({ status: 'failed', creditStatus: 'refunded', attemptCount: 1 });
      expect(task.leaseOwner).toBeUndefined(); expect(task.leaseExpiresAt).toBeUndefined();
      expect((await query('SELECT lease_owner,lease_expires_at::text FROM cloud_tasks WHERE id=$1', [task.id])).rows)
        .toEqual([{ lease_owner: '', lease_expires_at: '0' }]);
      expect(readSketchImageCheckpoint(task.result?.sketchImageExecution, readSketchImageTaskIdentity(task)))
        .toMatchObject({ phase: 'analysis' });
      await financial(query, task.id, 'owner', 0, [
        { type: 'consume', amount: -18, balance_after: 82 }, { type: 'refund', amount: 18, balance_after: 100 },
      ], ''); // Different from the image-ledger's model-bound Token adjustment.
      expect((await query('SELECT identity FROM wujie_refund_identity_claims')).rows).toEqual([{ identity: task.id }]);
      const before = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      expect((await executeSketchImageTask(accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker)).status).toBe('skipped');
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(before);
      expect(f.calls).toEqual({ analysis: 1, generation: 0, remoteIds: [] });
      expect(await counts(query)).toEqual({ tasks: 1, assets: 0, versions: 0, refunds: 1 });
    });
  }, 30_000);

  it('defers an unknown query and recovers only the original accepted remote receipt after synthetic lease expiry', async (): Promise<void> => {
    await ownedCase('image_pg_recover', async ({ query }, files): Promise<void> => {
      let queries = 0;
      const f = fixture(files, {
        generate: async (): Promise<unknown> => ({ taskIds: ['synthetic-remote-original'], directImageUrls: [],
          usedModel: 'image-model', usedProviderId: 'image-provider' }),
        query: async (remoteId: string, identity: Readonly<SketchImageTaskIdentity>, signal: AbortSignal): Promise<Readonly<OrdinaryQueryResult>> => {
          expect(remoteId).toBe('synthetic-remote-original'); expect(identity.input.imageModelId).toBe('image-model'); signal.throwIfAborted();
          if (++queries === 1) throw new Error('Synthetic unknown query acknowledgment');
          return { status: 'completed', imageUrls: [outputPng] };
        },
      });
      const value = request(), accepted = await admission(value, f);
      expect(await executeSketchImageTask(accepted, { actorUserId: 'owner', projectId: 'personal' }, f.worker))
        .toEqual({ status: 'deferred', reason: 'SKETCH_IMAGE_EXECUTION_UNCONFIRMED' });
      const deferred = await originalTask(accepted.task.id), identity = readSketchImageTaskIdentity(deferred, 'owner');
      expect(deferred).toMatchObject({ status: 'processing', creditStatus: 'pending', attemptCount: 1 });
      expect(readSketchImageCheckpoint(deferred.result?.sketchImageExecution, identity))
        .toMatchObject({ phase: 'accepted', receipt: { taskIds: ['synthetic-remote-original'], directImageUrls: [] } });
      expect(await counts(query)).toEqual({ tasks: 1, assets: 0, versions: 0, refunds: 0 });
      const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      // Dedicated synthetic task only: emulate expiry, NOT a real process crash.
      // No identity, checkpoint, attempt, created_at or business timeout changed.
      const fixtureExpiry = Date.now() - 1;
      await query('UPDATE cloud_tasks SET lease_expires_at=$2 WHERE id=$1', [deferred.id, fixtureExpiry]);
      expect(await recoverSketchImageTask(deferred.id, identity, f.worker)).toEqual({ status: 'completed' });
      expect((await originalTask(deferred.id)).attemptCount).toBe(2);
      await delivered(query, deferred.id, 'owner', 'personal', 18, 18);
      await financial(query, deferred.id, 'owner', 18, [{ type: 'consume', amount: -18, balance_after: 82 }]);
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
      expect(f.calls).toEqual({ analysis: 1, generation: 1, remoteIds: ['synthetic-remote-original', 'synthetic-remote-original'] });
      expect(await counts(query)).toEqual({ tasks: 1, assets: 2, versions: 2, refunds: 0 });
    });
  }, 30_000);
});

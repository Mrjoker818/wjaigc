import { mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import type { PoolClient } from 'pg';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/workflow/image-actions/route';
import * as managedMedia from '@/lib/asset-core/managed-media-read';
import { createPostgresAssetStorage } from '@/lib/asset-core/storage';
import { claimCloudTaskLease, createCloudTask, ensureCloudTaskTables, getCloudTaskForUser } from '@/lib/cloud-task-storage';
import { importDocumentUpload } from '@/lib/collaboration/document-media-import';
import * as documentAssets from '@/lib/collaboration/document-asset-validation';
import { getPool } from '@/lib/db-client';
import { ensureCoreTables } from '@/lib/db-storage';
import * as safeImageInput from '@/lib/safe-image-input';
import { createConnection, createEmptyWorkflow, createWorkflowNode, type ExecutionResult } from '@/lib/workflow-engine';
import { partitionWorkflowImageGrid } from '@/lib/workflow-image-actions';
import * as gridCrop from '@/lib/workflow-image-grid';
import { executeWorkflowImageInputForActor } from '@/lib/workflow-image-input-execution';
import { prepareAndPublishWorkflowImageCell, prepareAndPublishWorkflowImageGrid } from '@/lib/workflow-image-preparation';
import type { WorkflowImageGridPublicationValue } from '@/lib/workflow-image-publication';
import { publishPreparedDocumentWorkflowImageGrid } from '@/lib/workflow-image-document-publication';
import { publishPreparedDocumentWorkflowImageCell } from '@/lib/workflow-image-document-runtime-publication';
import { publishPreparedPersonalWorkflowImageCell, workflowImageRuntimeOperationId } from '@/lib/workflow-image-runtime-publication';
import { admitWorkflowImageRetry } from '@/lib/workflow-image-retry-admission';
import { verifyCompletedWorkflowImageRetry, verifyRunningWorkflowImageCheckpoints } from '@/lib/workflow-image-terminal-receipt';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { withIsolatedPostgres, type IsolatedPostgresContext } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => ({ userId: 'editor' }) }));
vi.mock('@/lib/server-data-root', () => ({ getServerDataRoot: () => mediaRoot }));
vi.mock('@/lib/s3-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/s3-storage')>(),
  uploadBinaryToS3: async () => null,
  inspectS3ObjectExact: async () => { throw new Error('Unexpected remote media read'); },
  readS3ObjectRangeExact: async () => { throw new Error('Unexpected remote media read'); },
}));

const postgresEnabled = Boolean(process.env.POSTGRES_TEST_DATABASE_URL);
if (postgresEnabled) requireOfflineBridgeTestDatabaseUrl(process.env);
const postgres = postgresEnabled ? describe : describe.skip;
const personal = 'personal-project', document = 'document-project', workspaceId = 'image-workflow';
const sourceNodeId = 'source-node', nodeId = 'receiver-node', actorUserId = 'editor';
const cap = 32 * 1024 * 1024;
let mediaRoot: string, png: Buffer;

async function isolated(name: string, run: (context: IsolatedPostgresContext) => Promise<void>): Promise<void> {
  await withIsolatedPostgres(name, async context => {
    const migration = spawnSync(process.execPath, ['scripts/run-migrations.mjs'], { encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: context.databaseUrl, PGDATABASE_URL: context.databaseUrl } });
    expect(migration.status, migration.stderr).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await context.query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
      VALUES ('owner','Owner','test','active',1,1),('editor','Editor','test','active',1,1)`);
    await context.query('INSERT INTO wujie_projects (id,owner_id,name) VALUES ($1,$3,$1),($2,$4,$2)', [personal, document, actorUserId, 'owner']);
    await run(context);
  });
}

function dataUrl(bytes = png): string { return `data:image/png;base64,${bytes.toString('base64')}`; }

// Pad a valid 2×2 PNG with an ancillary chunk so both byte boundaries are exact.
// Sharp is still used for the source and for the real persistence/read validators.
function pngAtSize(size: number): Buffer {
  const text = Buffer.alloc(size - png.length - 12, 0x61);
  text.write('Fixture\0');
  const typeAndData = Buffer.concat([Buffer.from('tEXt'), text]);
  const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
  prefix.writeUInt32BE(text.length); suffix.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([png.subarray(0, -12), prefix, typeAndData, suffix, png.subarray(-12)]);
}

function request(operationId: string, source = { imageUrl: dataUrl() }) {
  return { action: 'grid' as const, projectId: personal, workspaceId, sourceNodeId, operationId, columns: 1, rows: 1, targetNodeIds: [nodeId], source };
}

function post(body: ReturnType<typeof request>) {
  return POST(new NextRequest('http://fixture.invalid/api/workflow/image-actions', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wujie-expected-actor-id': actorUserId }, body: JSON.stringify(body) }));
}

function managedFile(url: string): string { return path.join(mediaRoot, 'exports', path.posix.basename(url)); }

async function counts({ query }: IsolatedPostgresContext) {
  return (await query(`SELECT
    (SELECT count(*)::int FROM wujie_asset_versions) versions,
    (SELECT count(*)::int FROM wujie_workspace_placements) placements,
    (SELECT count(*)::int FROM wujie_canvas_media_lineage) lineage,
    (SELECT count(*)::int FROM wujie_canvas_asset_commands) commands,
    (SELECT count(*)::int FROM wujie_project_canvas_updates) updates,
    (SELECT count(*)::int FROM cloud_tasks) tasks,
    (SELECT count(*)::int FROM wujie_credit_transactions) credits`)).rows[0];
}

function lostAcknowledgement(match: (sql: string) => boolean, afterCommit?: () => Promise<void>) {
  const pool = getPool(), connect = pool.connect.bind(pool), discards: (boolean | Error | undefined)[] = [];
  let lost = 0;
  const wrappedConnect = async (): Promise<PoolClient> => {
    const client = await connect();
    let matchingWrite = false;
    return new Proxy(client, { get(target, prop) {
      if (prop === 'query') return async (sql: string, values?: unknown[]) => {
        const result = await target.query(sql, values);
        matchingWrite ||= match(sql);
        if (sql === 'COMMIT' && matchingWrite && lost === 0) {
          lost++;
          await afterCommit?.();
          throw new Error('fixture: lost COMMIT acknowledgement');
        }
        return result;
      };
      if (prop === 'release') return (discard?: boolean | Error) => { discards.push(discard); target.release(discard); };
      return Reflect.get(target, prop);
    } });
  };
  return { connect: wrappedConnect, discards, lost: () => lost, install() {
    return vi.spyOn(pool, 'connect').mockImplementation(((callback?: Parameters<typeof pool.connect>[0]) =>
      callback ? connect(callback) : wrappedConnect()) as typeof pool.connect);
  } };
}

type Reference = { projectId: string; imageUrl: string; assetId?: string; assetVersionId?: string; placementId?: string };
async function runtime(projectId: string, reference: Reference, status: 'processing' | 'failed' = 'processing',
  target?: { placementId: string; assetId: string; assetVersionId: string; entityId: string }) {
  const source = createWorkflowNode('input-image', 0, 0), receiver = createWorkflowNode('input-image', 300, 0);
  source.id = sourceNodeId; receiver.id = nodeId;
  // The durable upstream result carries the source, as it does after ordinary node execution.
  receiver.config = { source: 'upstream', ...target, imageInputTransform: { version: 1, kind: 'grid', columns: 1, rows: 1, column: 0, row: 0 } };
  receiver.ports.unshift({ id: 'in-image', label: 'Source', type: 'image', direction: 'in' });
  const draft = { nodes: [source, receiver], connections: [createConnection(source.id,
    source.ports.find(port => port.type === 'image' && port.direction === 'out')!.id, receiver.id, 'in-image', 'image')] };
  const graph = JSON.parse(JSON.stringify(draft)) as typeof draft;
  const workflow = { ...createEmptyWorkflow('Grid receiver'), ...graph, id: workspaceId };
  const upstream: ExecutionResult = { nodeId: source.id, status: 'success', durationMs: 1, output: reference };
  const results = new Map([[source.id, upstream]]);
  const execution = { actorUserId, projectId, workflowId: workspaceId, parentExecutionId: 'fixture-execution', nodeId,
    subgraphPath: [], expectedGraph: graph, expectedRevision: 0, leaseOwner: 'fixture-worker', leaseAttemptCount: 1, attempt: 0 };
  await createCloudTask({ id: execution.parentExecutionId, userId: actorUserId, projectId, type: 'workflow', status,
    progress: 0, createdAt: 1, updatedAt: 1, creditCost: status === 'failed' ? 3 : 0,
    creditStatus: status === 'failed' ? 'charged' : 'not-applicable',
    ...(status === 'processing' ? { leaseOwner: execution.leaseOwner, leaseExpiresAt: Date.now() + 120_000, attemptCount: 1 } : {}),
    result: { projectId, workflowId: workspaceId, workflowStatus: status === 'failed' ? 'failed' : 'running',
      currentNodeId: nodeId, executionGraph: graph, results: Object.fromEntries(results) } });
  return { workflow, results, execution, graph };
}

const attach = { action: 'attach' as const, transform: { x: 10, y: 20, width: 64, height: 64, rotation: 0, zIndex: 1 } };
function uploadDocumentImage(idempotencyKey: string) {
  return importDocumentUpload(actorUserId, new Request('http://fixture.invalid/upload', { method: 'POST', body: new Uint8Array(png), headers: {
    'content-type': 'image/png', 'x-wujie-asset-import': Buffer.from(JSON.stringify({ projectId: document,
      idempotencyKey, filename: 'source.png', command: attach })).toString('base64url'),
  } }));
}

async function uploadDocument({ query }: IsolatedPostgresContext) {
  await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at) VALUES ('owner','projects',$1::jsonb,1)`,
    [JSON.stringify([{ id: document, userId: 'owner', name: 'Shared fixture', schemaVersion: 3,
      createdAt: 1, updatedAt: 1, settings: {}, canvasImages: [] }])]);
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ($1,'owner',true)`, [document]);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id,status) VALUES ($1,'owner',$2,'active')`, [document, actorUserId]);
  return uploadDocumentImage('fixture-source');
}

function documentReference({ assetReference }: Awaited<ReturnType<typeof uploadDocument>>): Reference {
  return { projectId: document, assetId: assetReference.assetId, assetVersionId: assetReference.assetVersionId,
    placementId: assetReference.placementId, imageUrl: assetReference.url };
}

function documentGrid(reference: Reference, operationId: string, connect?: () => Promise<PoolClient>) {
  return prepareAndPublishWorkflowImageGrid({ actorUserId, projectId: document, workspaceId, entityId: sourceNodeId,
    reference, columns: 2, rows: 1, targetNodeIds: ['left-node', 'right-node'], operationId },
  (prepared, signal) => publishPreparedDocumentWorkflowImageGrid(prepared, signal, { connect }));
}

postgres('workflow image publication in an isolated database and local media directory', () => {
  beforeAll(async () => { png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer(); });
  beforeEach(async () => {
    mediaRoot = await mkdtemp(path.join(await realpath(tmpdir()), 'workflow-image-test-'));
    vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request'); }));
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    const parent = await realpath(tmpdir());
    const relative = path.relative(parent, await realpath(mediaRoot));
    expect(relative).toMatch(/^workflow-image-test-[\w]+$/);
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('rejects a personal PNG one byte over the canonical bound at the grid route before staging', async () => {
    await isolated('image-grid-oversize', async context => {
      vi.spyOn(gridCrop, 'cropWorkflowImageGrid').mockResolvedValueOnce([{ cell: partitionWorkflowImageGrid(2, 2, 1, 1)[0],
        bytes: pngAtSize(cap + 1), mimeType: 'image/png' }]);
      const reply = await post(request('grid-over-limit'));
      expect(reply.status).toBe(413);
      expect(await reply.json()).toEqual({ success: false, code: 'WORKFLOW_IMAGE_ACTION_TOO_LARGE' });
      expect(await counts(context)).toEqual({ versions: 0, placements: 0, lineage: 0, commands: 0, updates: 0, tasks: 0, credits: 0 });
      await expect(readdir(path.join(mediaRoot, 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }, 30_000);

  it('reconciles one personal whole-grid commit at exactly 32 MiB and replays the same references', async () => {
    await isolated('image-grid-boundary', async context => {
      const tile = { cell: partitionWorkflowImageGrid(2, 2, 1, 1)[0], bytes: pngAtSize(cap), mimeType: 'image/png' as const };
      vi.spyOn(gridCrop, 'cropWorkflowImageGrid').mockResolvedValue([tile]);
      const ack = lostAcknowledgement(sql => sql.includes('INSERT INTO wujie_asset_versions'));
      const connection = ack.install(), body = request('exact-grid');
      let value: WorkflowImageGridPublicationValue;
      try {
        const first = await post(body);
        expect(first.status).toBe(200);
        const receipt = await first.json();
        expect(receipt).toMatchObject({ status: 'committed', value: { operationId: body.operationId } });
        value = receipt.value as WorkflowImageGridPublicationValue;
        expect(ack.lost()).toBe(1); expect(ack.discards).toContain(true);
        const replay = await post(body);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toMatchObject({ status: 'committed', value });
      } finally { connection.mockRestore(); }
      const version = await createPostgresAssetStorage().read(tx => tx.findVersion(actorUserId, personal, value.tiles[0].reference.assetVersionId));
      expect((await managedMedia.readManagedAssetVersionBytes(version!, 'image')).bytes.equals(tile.bytes)).toBe(true);
      expect(await counts(context)).toEqual({ versions: 2, placements: 1, lineage: 0, commands: 0, updates: 0, tasks: 0, credits: 0 });
      expect(await readdir(path.join(mediaRoot, 'exports'))).toHaveLength(2);
    });
  }, 40_000);

  it('checks the personal receiver lease before any placement or checkpoint write', async () => {
    await isolated('image-cell-lease', async context => {
      const { execution } = await runtime(personal, { projectId: personal, imageUrl: dataUrl() });
      const connect = async () => {
        await context.query("UPDATE cloud_tasks SET lease_owner='next-worker' WHERE id=$1", [execution.parentExecutionId]);
        return getPool().connect();
      };
      await expect(prepareAndPublishWorkflowImageCell({ actorUserId, projectId: personal, workspaceId, entityId: nodeId,
        targetNodeId: nodeId, operationId: workflowImageRuntimeOperationId(execution), columns: 1, rows: 1, column: 0, row: 0,
        reference: { imageUrl: dataUrl() } }, (cell, signal) => publishPreparedPersonalWorkflowImageCell(cell,
        { execution, expectedTarget: null }, signal, { connect }))).rejects.toThrow('WORKFLOW_EXECUTION_FENCE_LOST');
      expect(await counts(context)).toMatchObject({ versions: 0, placements: 0, tasks: 1, credits: 0 });
      expect((await getCloudTaskForUser(execution.parentExecutionId, actorUserId))?.revision).toBe(0);
      expect(await readdir(path.join(mediaRoot, 'exports'))).toEqual([]);
    });
  }, 30_000);

  it('blocks an oversized personal receiver result before publishing any asset or checkpoint', async () => {
    await isolated('image-cell-oversize', async context => {
      const { workflow, results, execution } = await runtime(personal, { projectId: personal, imageUrl: dataUrl() });
      vi.spyOn(gridCrop, 'cropWorkflowImageGridCell').mockResolvedValueOnce({ cell: partitionWorkflowImageGrid(2, 2, 1, 1)[0],
        bytes: pngAtSize(cap + 1), mimeType: 'image/png' });
      await expect(executeWorkflowImageInputForActor(workflow, results, execution, new AbortController().signal))
        .rejects.toThrow('WORKFLOW_IMAGE_GRID_OUTPUT_LIMIT');
      expect(await counts(context)).toMatchObject({ versions: 0, placements: 0, tasks: 1, credits: 0 });
      const parent = await getCloudTaskForUser(execution.parentExecutionId, actorUserId);
      expect(parent?.revision).toBe(0);
      expect(parent?.result?.results).toEqual(Object.fromEntries(results));
    });
  }, 30_000);

  it('verifies a boundary-size legacy cell after lost acknowledgement and expiry of the original URL', async () => {
    await isolated('image-cell-terminal', async context => {
      const legacyUrl = '/api/serve-upload/images/now-expired.png';
      const legacyPath = path.join(mediaRoot, 'images', 'now-expired.png');
      await mkdir(path.dirname(legacyPath)); await writeFile(legacyPath, png);
      const { execution } = await runtime(personal, { projectId: personal, imageUrl: legacyUrl });
      const legacyRead = vi.spyOn(safeImageInput, 'loadSafeImageInput');
      vi.spyOn(gridCrop, 'cropWorkflowImageGridCell').mockResolvedValueOnce({ cell: partitionWorkflowImageGrid(2, 2, 1, 1)[0],
        bytes: pngAtSize(cap), mimeType: 'image/png' });
      const ack = lostAcknowledgement(sql => sql.includes('UPDATE cloud_tasks SET result=jsonb_set'));
      const result = await prepareAndPublishWorkflowImageCell({ actorUserId, projectId: personal, workspaceId, entityId: nodeId,
        targetNodeId: nodeId, operationId: workflowImageRuntimeOperationId(execution), columns: 1, rows: 1, column: 0, row: 0,
        reference: { imageUrl: legacyUrl } }, (cell, signal) => publishPreparedPersonalWorkflowImageCell(cell,
        { execution, expectedTarget: null }, signal, { connect: ack.connect }));
      if (result.status !== 'committed') throw result.error instanceof AggregateError ? result.error.errors.at(-1) : result.error;
      expect(ack.lost()).toBe(1); expect(ack.discards[0]).toBe(true);
      const parent = (await getCloudTaskForUser(execution.parentExecutionId, actorUserId))!;
      expect(parent.revision).toBe(1);
      const before = await counts(context);
      await unlink(legacyPath); legacyRead.mockClear();
      await verifyRunningWorkflowImageCheckpoints(parent, actorUserId);
      expect(legacyRead).not.toHaveBeenCalled();
      expect(await counts(context)).toEqual(before);
      expect(await getCloudTaskForUser(execution.parentExecutionId, actorUserId)).toEqual(parent);
      const parentVersion = await createPostgresAssetStorage().read(tx => tx.findVersion(actorUserId, personal, result.value.parentVersionId));
      const parentPath = managedFile(parentVersion!.file.url), corrupt = Buffer.from(png);
      corrupt[corrupt.length - 1] ^= 1;
      await writeFile(parentPath, corrupt);
      await expect(verifyRunningWorkflowImageCheckpoints(parent, actorUserId)).rejects.toThrow();
      expect(legacyRead).not.toHaveBeenCalled();
    });
  }, 40_000);

  it('admits one nonbillable retry across acknowledgement loss and duplicate admission', async () => {
    await isolated('image-retry-ack', async context => {
      const { execution, graph } = await runtime(personal, { projectId: personal, imageUrl: dataUrl() }, 'failed');
      const original = (await getCloudTaskForUser(execution.parentExecutionId, actorUserId))!;
      const ack = lostAcknowledgement(sql => sql.includes('INSERT INTO cloud_tasks'));
      const connection = ack.install();
      const input = { actorUserId, original, expectedGraph: graph, nodeId };
      try {
        const first = await admitWorkflowImageRetry(input);
        expect(first).toMatchObject({ reused: false, task: { creditStatus: 'not-applicable', creditCost: 0 } });
        expect(ack.lost()).toBe(1); expect(ack.discards).toContain(true);
        expect(await admitWorkflowImageRetry(input)).toMatchObject({ reused: true, task: first.task });
        expect(await getCloudTaskForUser(original.id, actorUserId)).toEqual(original);
        expect(await counts(context)).toMatchObject({ tasks: 2, credits: 0 });
      } finally { connection.mockRestore(); }
    });
  }, 30_000);

  it('verifies a completed retry through its archived source and rejects changed accounting on the locked child', async () => {
    await isolated('image-retry-terminal', async context => {
      const legacyUrl = '/api/serve-upload/images/retry-original.png', legacyPath = path.join(mediaRoot, 'images', 'retry-original.png');
      await mkdir(path.dirname(legacyPath)); await writeFile(legacyPath, png);
      const { execution, graph, workflow, results } = await runtime(personal, { projectId: personal, imageUrl: legacyUrl }, 'failed');
      const original = (await getCloudTaskForUser(execution.parentExecutionId, actorUserId))!;
      const { task } = await admitWorkflowImageRetry({ actorUserId, original, expectedGraph: graph, nodeId });
      const lease = await claimCloudTaskLease(task.id, execution.leaseOwner, 120_000);
      expect(lease?.attemptCount).toBe(1);
      const published = await executeWorkflowImageInputForActor(workflow, results,
        { ...execution, parentExecutionId: task.id, attempt: 1 }, new AbortController().signal);
      if (published.status !== 'committed') throw published.error;
      await context.query(`UPDATE cloud_tasks SET status='completed',result=jsonb_set(result,'{workflowStatus}','"completed"'),revision=revision+1
        WHERE id=$1`, [task.id]);
      const finished = (await getCloudTaskForUser(task.id, actorUserId))!;
      await unlink(legacyPath);
      expect(await verifyCompletedWorkflowImageRetry(finished, actorUserId)).toMatchObject({ [nodeId]: published.nodeResult });
      await context.query("UPDATE cloud_tasks SET credit_status='pending' WHERE id=$1", [task.id]);
      await expect(verifyCompletedWorkflowImageRetry(finished, actorUserId)).rejects.toThrow('WORKFLOW_IMAGE_TERMINAL_RECEIPT_UNCONFIRMED');
      expect(await getCloudTaskForUser(original.id, actorUserId)).toEqual(original);
      expect(await counts(context)).toMatchObject({ versions: 2, placements: 1, tasks: 2, credits: 0 });
    });
  }, 30_000);

  it.each([
    ['credit cost', 'credit_cost=1'],
    ['credit status', "credit_status='pending'"],
    ['charged transaction', "charged_transaction_id='fixture-accounting-link'"],
  ])('rejects reuse of a child with a changed %s', async (name, change) => {
    await isolated(`image-retry-${name}`, async context => {
      const { execution, graph } = await runtime(personal, { projectId: personal, imageUrl: dataUrl() }, 'failed');
      const original = (await getCloudTaskForUser(execution.parentExecutionId, actorUserId))!;
      const input = { actorUserId, original, expectedGraph: graph, nodeId };
      const { task } = await admitWorkflowImageRetry(input);
      await context.query(`UPDATE cloud_tasks SET ${change} WHERE id=$1`, [task.id]);
      await expect(admitWorkflowImageRetry(input)).rejects.toMatchObject({ code: 'WORKFLOW_IMAGE_RETRY_CONFLICT' });
      expect(await getCloudTaskForUser(original.id, actorUserId)).toEqual(original);
      expect(await counts(context)).toMatchObject({ tasks: 2, credits: 0 });
    });
  }, 30_000);

  it('reconciles one document grid commit and refuses a replay with a missing tile outside the preflight snapshot', async () => {
    await isolated('document-grid-physical', async context => {
      const source = documentReference(await uploadDocument(context));
      const preflight = await documentAssets.prepareDocumentAssetsForImport(actorUserId, document, attach, new AbortController().signal);
      const ack = lostAcknowledgement(sql => sql.includes('INSERT INTO wujie_canvas_asset_commands') && sql.includes('batch_manifest'));
      const first = await documentGrid(source, 'document-grid', ack.connect);
      if (first.status !== 'committed') throw first.error;
      expect(ack.lost()).toBe(1); expect(ack.discards[0]).toBe(true);
      const snapshot = await counts(context);
      expect(snapshot).toMatchObject({ versions: 3, placements: 3, lineage: 3, tasks: 0, credits: 0 });
      const tilePath = managedFile(first.value.tiles[1].reference.url), bytes = await readFile(tilePath);
      const spy = vi.spyOn(documentAssets, 'prepareDocumentAssetsForImport').mockResolvedValueOnce(preflight);
      await unlink(tilePath);
      // The authorized snapshot was taken just before the grid existed.
      // Replaying a manifest now must check the actual returned child files.
      await expect(documentGrid(source, 'document-grid')).rejects.toThrow();
      expect(spy).toHaveBeenCalled(); spy.mockRestore();
      const corrupt = Buffer.from(bytes);
      corrupt[corrupt.length - 1] ^= 1;
      await writeFile(tilePath, corrupt);
      await expect(documentGrid(source, 'document-grid')).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      await writeFile(tilePath, bytes);
      expect(await documentGrid(source, 'document-grid')).toMatchObject({ status: 'committed', value: first.value });
      expect(await counts(context)).toEqual(snapshot);
    });
  }, 30_000);

  it('leaves a document grid unconfirmed when the editor grant changes after COMMIT', async () => {
    await isolated('document-grid-grant', async context => {
      const source = documentReference(await uploadDocument(context));
      const ack = lostAcknowledgement(sql => sql.includes('INSERT INTO wujie_canvas_asset_commands') && sql.includes('batch_manifest'), async () => {
        await context.query(`UPDATE wujie_project_document_editors SET grant_generation=grant_generation+1
          WHERE project_id=$1 AND member_user_id=$2`, [document, actorUserId]);
      });
      const connection = ack.install(), body = { ...request('document-grant-change', source), projectId: document,
        columns: 2, targetNodeIds: ['left-node', 'right-node'] };
      try {
        const reply = await post(body);
        expect(reply.status).toBe(202);
        expect(await reply.json()).toMatchObject({ status: 'unknown', operationId: body.operationId, projectId: document,
          workspaceId, retrySameOperation: true });
        expect(ack.lost()).toBe(1); expect(ack.discards).toContain(true);
      } finally { connection.mockRestore(); }
      expect(await counts(context)).toMatchObject({ versions: 3, placements: 3, tasks: 0, credits: 0 });
      expect(await readdir(path.join(mediaRoot, 'exports'))).toHaveLength(3);
    });
  }, 30_000);

  it('reconciles a document runtime replacement and its exact checkpoint once after COMMIT acknowledgement loss', async () => {
    await isolated('document-cell-replace', async context => {
      const source = documentReference(await uploadDocument(context));
      const target = (await uploadDocumentImage('fixture-target')).assetReference;
      const { workflow, results, execution } = await runtime(document, source, 'processing', target);
      const ack = lostAcknowledgement(sql => sql.includes('UPDATE cloud_tasks SET result=jsonb_set'));
      const physicalRead = vi.spyOn(managedMedia, 'readManagedAssetVersionBytes');
      const first = await prepareAndPublishWorkflowImageCell({ actorUserId, projectId: document, workspaceId, entityId: nodeId,
        targetNodeId: nodeId, operationId: workflowImageRuntimeOperationId(execution), columns: 1, rows: 1, column: 0, row: 0,
        reference: source }, (cell, signal) => publishPreparedDocumentWorkflowImageCell(cell,
        { execution, expectedTarget: { placementId: target.placementId, assetId: target.assetId, assetVersionId: target.assetVersionId } },
        signal, { connect: ack.connect }));
      if (first.status !== 'committed') throw first.error;
      const published = first.value.nodeResult.output!;
      expect(published.placementId).toBe(target.placementId);
      expect(published.assetVersionId).not.toBe(target.assetVersionId);
      expect(physicalRead.mock.calls.some(([version]) => version.id === published.assetVersionId)).toBe(true);
      expect(ack.lost()).toBe(1); expect(ack.discards[0]).toBe(true);
      const parent = (await getCloudTaskForUser(execution.parentExecutionId, actorUserId))!;
      expect(parent.revision).toBe(1);
      expect(parent.result?.results).toMatchObject({ [nodeId]: first.value.nodeResult });
      const snapshot = await counts(context);
      expect(snapshot).toMatchObject({ versions: 3, placements: 2, lineage: 3, updates: 3, tasks: 1, credits: 0 });
      const replay = await executeWorkflowImageInputForActor(workflow, results, { ...execution, expectedRevision: 1 }, new AbortController().signal);
      expect(replay).toMatchObject({ status: 'committed', nodeResult: first.value.nodeResult, revision: 1 });
      expect(await counts(context)).toEqual(snapshot);
      expect(await getCloudTaskForUser(execution.parentExecutionId, actorUserId)).toEqual(parent);
    });
  }, 30_000);
});

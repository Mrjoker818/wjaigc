import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as fileSystem from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { adoptDocumentTaskResult, importDocumentUpload, importDocumentAssetVersion, publishDocumentTaskOutput } from '../../src/lib/collaboration/document-media-import';
import { prepareCanvasTaskPublicationInTransaction, persistCanvasTaskPublicationInTransaction } from '../../src/lib/collaboration/task-publication';
import { executeDocumentAssetCommand } from '../../src/lib/collaboration/document-asset-commands';
import { reserveMediaPreparation, VIDEO_IMPORT_LIMIT } from '../../src/lib/collaboration/document-media-request';
import { assetBinaryFileOps } from '../../src/lib/asset-core/binary-file-ops';
import { getPool, getAdvisoryLockPool } from '../../src/lib/db-client';
import type { PoolClient, QueryResult } from 'pg';
import { projectCompletedTaskToAssets } from '../../src/lib/asset-core/task-projector';
import { adoptCompletedResultIntoProject } from '../../src/lib/asset-core/collaboration-adoption';
import { drainPendingAssetCleanup } from '../../src/lib/asset-core/cleanup-outbox';
import { Readable } from 'node:stream';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import * as managedMedia from '../../src/lib/asset-core/managed-media-read';
import { POST as uploadPost } from '../../src/app/api/collaboration/document-assets/upload/route';
import { POST as adoptPost } from '../../src/app/api/collaboration/document-assets/adopt/route';
import { POST as versionPost } from '../../src/app/api/collaboration/document-assets/import-version/route';
import { getServerDataRoot } from '../../src/lib/server-data-root';
import { readAssetV3Projects } from '../../src/lib/asset-core/canvas-project-sync';
const roots = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const paths = await import('node:path');
  const os = await import('node:os');
  const previousRoot = process.env.WUJIE_DATA_DIR;
  const base = previousRoot ?? os.tmpdir();
  if (!base || !paths.isAbsolute(base) || !fs.statSync(base).isDirectory()) throw new Error('Valid existing media base required');
  const root = fs.mkdtempSync(paths.join(base, 'document-media-import-'));
  process.env.WUJIE_DATA_DIR = root;
  return { base, root, previousRoot };
});
const auth = vi.hoisted(() => ({ user: { id: 'editor' } as { id: string } | null }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<{ id: string } | null> => auth.user }));

vi.mock('server-only', () => ({}));
vi.mock('node:fs/promises', async (importOriginal): Promise<typeof import('node:fs/promises')> => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
}));
const mediaRoot = roots.root;
let image: Buffer;
let video: Buffer;
beforeAll(async (): Promise<void> => {
  expect(path.resolve(getServerDataRoot())).toBe(path.resolve(mediaRoot));
  console.info('Task8Cb1 temporary media directory:', mediaRoot);
  process.env.WUJIE_DATA_DIR = mediaRoot;
  await mkdir(path.join(mediaRoot, 'images'), { recursive: true });
  image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  await writeFile(path.join(mediaRoot, 'images', 'source.png'), image);
  video = Buffer.from(await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8'), 'base64');
  await writeFile(path.join(mediaRoot, 'images', 'source.mp4'), video);
});
afterAll(async (): Promise<void> => {
  const relative = path.relative(path.resolve(roots.base), path.resolve(mediaRoot));
  expect(relative.startsWith('document-media-import-') && !relative.includes(path.sep)).toBe(true);
  await rm(mediaRoot, { recursive: true, force: true });
  if (roots.previousRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = roots.previousRoot;
});
beforeEach(() => vi.stubEnv('WUJIE_YJS_ENABLED', 'true'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function seed(query: QueryFn, versionMigration: boolean = true): Promise<void> {
  for (const name of ['20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
    '20260811_wj_stable_s2_asset_transfer_idempotency.sql', '20260811_wj_stable_s2_cross_project_transfer.sql',
    '20260815_wj_cloud_tasks.sql', '20260909_mpe_cross_asset_parents.sql', '20260909_mpe_export_cleanup_outbox.sql', '20260910_mpe_export_cleanup_leases.sql',
    '20260913_canvas_video_placements.sql', '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql',
    '20260925_yjs_canvas_asset_adoptions.sql', '20260927_yjs_canvas_asset_commands.sql', '20261004_yjs_canvas_removal_snapshots.sql',
    '20260927_asset_cleanup_local_identity.sql', '20260927_yjs_canvas_media_imports.sql',
    '20260927_yjs_canvas_task_publications.sql',
    ...(versionMigration ? ['20260927_yjs_canvas_version_imports.sql'] : [])]) {
    await query(await readFile(path.join('migrations', name), 'utf8'));
  }
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1),('editor','Editor','test','active',1,1)`);
  await query(`INSERT INTO wujie_projects (id,owner_id,name) VALUES ('target','owner','Target'),('source','editor','Source')`);
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled,authority_revision) VALUES ('target','owner',true,0)`);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id,status) VALUES ('target','owner','editor','active')`);
  await query(`INSERT INTO cloud_tasks (id,user_id,project_id,type,status,result,credit_status,credit_cost,charged_transaction_id,created_at,updated_at)
    VALUES ('task','editor','source','image-generate','completed',$1::jsonb,'charged',12,'charge',1,1)`,
  [JSON.stringify({ imageUrl: '/api/serve-upload/images/source.png' })]);
  await query(`CREATE TABLE wujie_credit_transactions (id text PRIMARY KEY,user_id text,amount integer,task_id text);
    INSERT INTO wujie_credit_transactions VALUES ('charge','editor',-12,'task')`);
  await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('original','editor','source','image')`);
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,task_id,file_url,availability,mime_type,byte_size,checksum,width,height)
    VALUES ('original-version','original','editor','source','task','/api/serve-upload/images/source.png','ready','image/png',$1,$2,2,2)`,
  [image.length, createHash('sha256').update(image).digest('hex')]);
  await query(`UPDATE wujie_assets SET current_version_id='original-version' WHERE id='original'`);
}

const command = { action: 'attach' as const, transform: { x: 10, y: 20, width: 32, height: 24, rotation: 0, zIndex: 1 } };
const adoption = { projectId: 'target', taskId: 'task', outputIndex: 0, sourceVersionId: 'original-version', idempotencyKey: 'adopt', command };
function upload(bytes: Buffer = image, mimeType: string = 'image/png', key: string = 'upload', extra: Record<string, unknown> = {}): Request {
  const filename = mimeType === 'video/mp4' ? 'upload.mp4' : `upload.${mimeType.split('/')[1]}`;
  return new Request('http://localhost/upload', { method: 'POST', body: new Uint8Array(bytes), headers: {
    'content-type': mimeType, 'x-wujie-asset-import': Buffer.from(JSON.stringify({ projectId: 'target', idempotencyKey: key, filename, command, ...extra })).toString('base64url'),
  } });
}
async function files(): Promise<string[]> {
  return readdir(path.join(mediaRoot, 'exports')).then(names => names.sort(), (): string[] => []);
}
async function counts(query: QueryFn): Promise<Record<string, number>> {
  return (await query(`SELECT
    (SELECT count(*)::int FROM wujie_assets WHERE project_id='target') AS assets,
    (SELECT count(*)::int FROM wujie_asset_versions WHERE project_id='target') AS versions,
    (SELECT count(*)::int FROM wujie_canvas_media_lineage) AS lineage,
    (SELECT count(*)::int FROM wujie_workspace_placements WHERE project_id='target') AS placements,
    (SELECT count(*)::int FROM wujie_canvas_asset_commands) AS commands,
    (SELECT count(*)::int FROM wujie_project_canvas_updates) AS updates,
    (SELECT count(*)::int FROM wujie_project_canvas_documents) AS documents`)).rows[0];
}
const empty = { assets: 0, versions: 0, lineage: 0, placements: 0, commands: 0, updates: 0, documents: 0 };
const single = { assets: 1, versions: 1, lineage: 1, placements: 1, commands: 1, updates: 1, documents: 1 };
const versionImport = { projectId: 'target', sourceVersionId: 'original-version', idempotencyKey: 'version-import', command };
async function taskless(query: QueryFn, kind: 'image' | 'video' = 'image'): Promise<void> {
  await query('UPDATE wujie_assets SET kind=$1 WHERE id=\'original\'', [kind]);
  const bytes = kind === 'image' ? image : video;
  await query(`UPDATE wujie_asset_versions SET task_id=NULL,file_url=$1,mime_type=$2,byte_size=$3,checksum=$4
    WHERE id='original-version'`, [kind === 'image' ? '/api/serve-upload/images/source.png' : '/api/serve-upload/images/source.mp4',
    kind === 'image' ? 'image/png' : 'video/mp4', bytes.length, createHash('sha256').update(bytes).digest('hex')]);
}
async function originals(query: QueryFn): Promise<unknown> {
  return (await query(`SELECT
    (SELECT jsonb_agg(t) FROM cloud_tasks t) tasks,
    (SELECT jsonb_agg(t) FROM wujie_credit_transactions t) credits,
    (SELECT to_jsonb(v) FROM wujie_asset_versions v WHERE id='original-version') version,
    (SELECT to_jsonb(a) FROM wujie_assets a WHERE id='original') asset`)).rows[0];
}
describe('Task8Cb1 version imports', () => {
  it.each([
    { mode: 'upload-image', width: 2, height: 2 },
    { mode: 'upload-video', width: 32, height: 24 },
    { mode: 'adopt', width: 2, height: 2 },
    { mode: 'version', width: 2, height: 2 },
  ] as const)('preserves verified source pixels through $mode and authoritative canvas read', async ({ mode, width, height }): Promise<void> => {
    await withIsolatedPostgres(`source-pixels-${mode}`, async ({ query }): Promise<void> => {
      await seed(query);
      if (mode === 'version') await taskless(query);
      const baseline = await originals(query);
      const result = mode === 'adopt' ? await adoptDocumentTaskResult('editor', adoption)
        : mode === 'version' ? await importDocumentAssetVersion('editor', versionImport)
        : await importDocumentUpload('editor', upload(mode === 'upload-video' ? video : image,
          mode === 'upload-video' ? 'video/mp4' : 'image/png'));
      expect((await query('SELECT width,height FROM wujie_asset_versions WHERE id=$1', [result.assetVersionId])).rows)
        .toEqual([{ width, height }]);
      const [project] = await readAssetV3Projects('owner', [{
        id: 'target', userId: 'owner', name: 'Target', createdAt: 1, updatedAt: 1, canvasImages: [], settings: {},
      }]);
      expect(project.canvasImages).toHaveLength(1);
      expect(project.canvasImages[0]).toMatchObject({
        assetVersionId: result.assetVersionId, width: 32, height: 24, originalWidth: width, originalHeight: height,
      });
      expect(await originals(query)).toEqual(baseline);
    });
  });

  it.each(['same-project', 'owned-target', 'editor-target'] as const)('imports owned versions with %s authorization', async (mode): Promise<void> => {
    await withIsolatedPostgres('8cb1-authorized', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query);
      let projectId = 'target';
      if (mode !== 'editor-target') {
        projectId = mode === 'same-project' ? 'source' : 'owned-target';
        if (mode === 'owned-target') await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ('owned-target','editor','Own target')");
        await query('INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ($1,\'editor\',true)', [projectId]);
      }
      const baseline = await originals(query);
      const result = await importDocumentAssetVersion('editor', { ...versionImport, projectId });
      expect(result.documentSequence).toBe(1);
      expect((await query('SELECT owner_id,project_id,task_id FROM wujie_asset_versions WHERE id=$1', [result.assetVersionId])).rows[0])
        .toEqual({ owner_id: mode === 'editor-target' ? 'owner' : 'editor', project_id: projectId, task_id: null });
      expect(await originals(query)).toEqual(baseline);
    });
  });
  it.each(['foreign', 'missing', 'pending-persist', 'missing-media', 'asset-trashed', 'project-trashed', 'kind', 'splice',
    'task-completed', 'task-failed', 'task-cancelled'] as const)('rejects version source %s before file/network IO', async (mode): Promise<void> => {
    await withIsolatedPostgres('8cb1-reject', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query);
      if (mode === 'pending-persist' || mode === 'missing-media') await query('UPDATE wujie_asset_versions SET availability=$1', [mode === 'missing-media' ? 'missing' : mode]);
      if (mode === 'asset-trashed') await query("UPDATE wujie_assets SET status='trashed'");
      if (mode === 'project-trashed') await query("UPDATE wujie_projects SET status='trashed' WHERE id='source'");
      if (mode === 'kind') await query("UPDATE wujie_assets SET kind='audio'");
      if (mode === 'splice') {
        // Corrupt only this disposable schema to prove the server join itself rejects a forged association.
        await query('ALTER TABLE wujie_asset_versions DROP CONSTRAINT wujie_asset_versions_asset_id_owner_id_project_id_fkey');
        await query("UPDATE wujie_assets SET current_version_id=NULL");
        await query("UPDATE wujie_asset_versions SET project_id='target'");
      }
      if (mode.startsWith('task-')) {
        await query("UPDATE wujie_asset_versions SET task_id='task'");
        await query('UPDATE cloud_tasks SET status=$1', [mode.slice(5)]);
      }
      const opened = vi.spyOn(fileSystem, 'open'); const network = vi.spyOn(S3Client.prototype, 'send');
      const baseline = await originals(query);
      await expect(importDocumentAssetVersion(mode === 'foreign' ? 'owner' : 'editor', { ...versionImport,
        sourceVersionId: mode === 'missing' ? 'missing' : 'original-version' })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      expect(opened).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(await originals(query)).toEqual(baseline);
      if (mode !== 'splice') expect(await counts(query)).toEqual(empty);
      if (mode === 'task-completed') expect((await adoptDocumentTaskResult('editor', adoption)).documentSequence).toBe(1);
      if (mode === 'task-failed' || mode === 'task-cancelled') await expect(adoptDocumentTaskResult('editor', adoption)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
    });
  });
  it.each([
    ['version', "UPDATE wujie_asset_versions SET metadata='{\"changed\":true}'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['availability', "UPDATE wujie_asset_versions SET availability='missing'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['asset', "UPDATE wujie_assets SET metadata='{\"changed\":true}'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['asset-kind', "UPDATE wujie_assets SET kind='video'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['source-project', "UPDATE wujie_projects SET metadata='{\"changed\":true}' WHERE id='source'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['source-archived', "UPDATE wujie_projects SET status='trashed' WHERE id='source'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['file', "UPDATE wujie_asset_versions SET file_url='/api/serve-upload/images/changed.png'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['task-link', "UPDATE wujie_asset_versions SET task_id='task'", 'DOCUMENT_MEDIA_CONFLICT'],
    ['revoke', "UPDATE wujie_project_document_editors SET status='revoked'", 'DOCUMENT_FORBIDDEN'],
    ['disabled', 'UPDATE wujie_project_document_settings SET enabled=false', 'DOCUMENT_PROJECT_NOT_ENABLED'],
    ['archived', "UPDATE wujie_projects SET status='trashed' WHERE id='target'", 'DOCUMENT_FORBIDDEN'],
    ['actor-disabled', "UPDATE wujie_users SET status='disabled' WHERE id='editor'", 'DOCUMENT_FORBIDDEN'],
    ['owner-disabled', "UPDATE wujie_users SET status='disabled' WHERE id='owner'", 'DOCUMENT_FORBIDDEN'],
  ])('revalidates taskless %s after lock-free preparation and rolls back', async (_mode, sql, code): Promise<void> => {
    await withIsolatedPostgres('8cb1-source-race', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query); const before = await files(); const barrier = stagedBarrier();
      const pending = importDocumentAssetVersion('editor', versionImport).catch((error: unknown): unknown => error);
      await barrier.arrived;
      try { await query("SET lock_timeout='1000ms'"); await query(sql); }
      finally { barrier.release(); }
      expect(await pending).toMatchObject({ code }); expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      expect(await readFile(path.join(mediaRoot, 'images/source.png'))).toEqual(image);
    });
  });
  it.each(['wujie_assets', 'wujie_asset_versions', 'wujie_canvas_media_lineage', 'wujie_workspace_placements',
    'wujie_project_canvas_documents', 'wujie_project_canvas_updates', 'wujie_canvas_asset_commands', 'pg_notify'])(
    'rolls back taskless graph/document and prepared file at %s', async (table): Promise<void> => {
      await withIsolatedPostgres('8cb1-write-fault', async ({ query }): Promise<void> => {
        await seed(query); await taskless(query); const before = await files(); const baseline = await originals(query);
        const restore = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
          if (sql.includes('INSERT INTO ' + table) || (table === 'pg_notify' && sql.includes('pg_notify'))) throw new Error('version write fault');
          return next();
        });
        try { await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toThrow('version write fault'); }
        finally { restore(); }
        expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before); expect(await originals(query)).toEqual(baseline);
      });
    });
  it('repeats the appended migration, preserves old upload/task rows and enforces every source combination', async (): Promise<void> => {
    await withIsolatedPostgres('8cb1-migration', async ({ query }): Promise<void> => {
      await seed(query, false);
      await importDocumentUpload('editor', upload()); await adoptDocumentTaskResult('editor', adoption);
      const old = (await query('SELECT * FROM wujie_canvas_media_lineage ORDER BY target_version_id')).rows;
      const commands = (await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows;
      const migration = await readFile('migrations/20260927_yjs_canvas_version_imports.sql', 'utf8');
      await query(migration); await query(migration);
      expect((await query('SELECT * FROM wujie_canvas_media_lineage ORDER BY target_version_id')).rows).toEqual(old);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows).toEqual(commands);
      await taskless(query); await importDocumentAssetVersion('editor', versionImport);
      for (const sql of [
        "UPDATE wujie_canvas_media_lineage SET task_id='task' WHERE source_kind='version'",
        "UPDATE wujie_canvas_media_lineage SET output_index=0 WHERE source_kind='version'",
        "UPDATE wujie_canvas_media_lineage SET source_project_id=NULL WHERE source_kind='version'",
        "UPDATE wujie_canvas_media_lineage SET source_version_id=NULL WHERE source_kind='version'",
        "UPDATE wujie_canvas_media_lineage SET task_id=NULL WHERE source_kind='task'",
        "UPDATE wujie_canvas_media_lineage SET output_index=NULL WHERE source_kind='task'",
        "UPDATE wujie_canvas_media_lineage SET source_project_id=NULL WHERE source_kind='task'",
        "UPDATE wujie_canvas_media_lineage SET task_id='task' WHERE source_kind='upload'",
        "UPDATE wujie_canvas_media_lineage SET output_index=0 WHERE source_kind='upload'",
        "UPDATE wujie_canvas_media_lineage SET source_project_id='source' WHERE source_kind='upload'",
        "UPDATE wujie_canvas_media_lineage SET source_version_id='original-version' WHERE source_kind='upload'",
        "UPDATE wujie_canvas_media_lineage SET source_kind='forged'",
        "UPDATE wujie_canvas_asset_commands SET source_kind='forged'",
      ]) await expect(query(sql)).rejects.toMatchObject({ code: '23514' });
      expect((await query("SELECT * FROM wujie_canvas_media_lineage WHERE source_kind<>'version' ORDER BY target_version_id")).rows).toEqual(old);
    });
  });
  it.each(['image', 'video'] as const)('prepares one taskless %s for twenty same-key requests, rejects drift/cross-source keys and never resurrects deleted placement', async (kind): Promise<void> => {
    await withIsolatedPostgres('8cb1-twenty', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query, kind); const write = vi.spyOn(assetBinaryFileOps, 'writeFile');
      const results = await Promise.all(Array.from({ length: 20 }, () => importDocumentAssetVersion('editor', versionImport)));
      const result = results[0]; expect(results.every(value => JSON.stringify(value) === JSON.stringify(result))).toBe(true);
      expect(write).toHaveBeenCalledTimes(1); expect(await counts(query)).toEqual(single);
      for (const drift of [{ sourceVersionId: 'missing' }, { command: { ...command, transform: { ...command.transform, x: 99 } } },
        { command: { action: 'replace', placementId: result.placementId, expectedAssetVersionId: result.assetVersionId } }]) {
        await expect(importDocumentAssetVersion('editor', { ...versionImport, ...drift })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      }
      await expect(importDocumentUpload('editor', upload(image, 'image/png', versionImport.idempotencyKey))).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      await expect(adoptDocumentTaskResult('editor', { ...adoption, idempotencyKey: versionImport.idempotencyKey })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      await expect(executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: versionImport.idempotencyKey,
        command: { ...command, assetVersionId: result.assetVersionId } })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'delete-version',
        command: { action: 'remove', placementId: result.placementId, expectedAssetVersionId: result.assetVersionId } });
      await query("UPDATE wujie_asset_versions SET availability='missing',file_url='/api/serve-upload/images/gone.png' WHERE id='original-version'");
      const opened = vi.spyOn(fileSystem, 'open');
      expect(await importDocumentAssetVersion('editor', versionImport)).toEqual(result); expect(opened).not.toHaveBeenCalled();
      expect((await query('SELECT status FROM wujie_workspace_placements')).rows[0].status).toBe('trashed');
      expect((await counts(query)).updates).toBe(2);
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    });
  }, 15_000);
  it('rejects version reuse of upload/task/ready keys and replaces with version CAS', async (): Promise<void> => {
    await withIsolatedPostgres('8cb1-replace', async ({ query }): Promise<void> => {
      await seed(query); const attached = await importDocumentUpload('editor', upload());
      await adoptDocumentTaskResult('editor', adoption);
      await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'ready', command: { ...command, assetVersionId: attached.assetVersionId } });
      await taskless(query, 'video');
      for (const idempotencyKey of ['upload', 'adopt', 'ready']) {
        await expect(importDocumentAssetVersion('editor', { ...versionImport, idempotencyKey })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      }
      const replacement = { ...versionImport, command: { action: 'replace', placementId: attached.placementId, expectedAssetVersionId: attached.assetVersionId } };
      const result = await importDocumentAssetVersion('editor', replacement);
      expect(result.placementId).toBe(attached.placementId); expect(result.assetVersionId).not.toBe(attached.assetVersionId); expect(result.documentSequence).toBe(4);
      expect(await importDocumentAssetVersion('editor', replacement)).toEqual(result);
      const before = await counts(query); const beforeFiles = await files();
      await expect(importDocumentAssetVersion('editor', { ...replacement, idempotencyKey: 'stale' })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      expect(await counts(query)).toEqual(before); expect(await files()).toEqual(beforeFiles);
      expect((await query('SELECT asset_version_id,entity_type FROM wujie_workspace_placements WHERE id=$1', [attached.placementId])).rows[0])
        .toEqual({ asset_version_id: result.assetVersionId, entity_type: 'canvas-video' });
      expect((await query('SELECT projection FROM wujie_project_canvas_documents')).rows[0].projection.placements[result.placementId].assetVersionId).toBe(result.assetVersionId);
    });
  });
  it('cancels taskless leader and same-key waiter, sharing the upload preparation reservation', async (): Promise<void> => {
    await withIsolatedPostgres('8cb1-cancel', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query, 'video'); const before = await files(); const barrier = stagedBarrier();
      const leaderAbort = new AbortController(); const waiterAbort = new AbortController();
      const leader = importDocumentAssetVersion('editor', versionImport, leaderAbort.signal).catch((error: unknown): unknown => error);
      await barrier.arrived;
      try {
        const waiter = importDocumentAssetVersion('editor', versionImport, waiterAbort.signal).catch((error: unknown): unknown => error);
        waiterAbort.abort(); expect(await waiter).toMatchObject({ code: 'DOCUMENT_MEDIA_CANCELLED' });
        const request = upload(); await expect(importDocumentUpload('editor', request)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
        expect(request.bodyUsed).toBe(false);
        await expect(importDocumentAssetVersion('editor', { ...versionImport, idempotencyKey: 'another' })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
        leaderAbort.abort();
      } finally { barrier.release(); }
      expect(await leader).toBeInstanceOf(Error); expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      expect((await importDocumentAssetVersion('editor', versionImport)).documentSequence).toBe(1);
    });
  });
  it('shares the two-preparation ceiling between image versions and uploads before source IO', async (): Promise<void> => {
    await withIsolatedPostgres('8cb1-two-preparations', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query);
      const arrived = deferred(); const resume = deferred(); const write = assetBinaryFileOps.writeFile; let writes = 0;
      vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args: Parameters<typeof write>): Promise<void> => {
        await write(...args); writes++; if (writes === 2) arrived.resolve(); await resume.promise;
      });
      const one = importDocumentAssetVersion('editor', versionImport).catch((error: unknown): unknown => error);
      const two = importDocumentUpload('editor', upload()).catch((error: unknown): unknown => error);
      await arrived.promise;
      const opened = vi.spyOn(fileSystem, 'open');
      try {
        await expect(importDocumentAssetVersion('editor', { ...versionImport, idempotencyKey: 'third' })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
        expect(opened).not.toHaveBeenCalled(); expect(await counts(query)).toEqual(empty);
      } finally { resume.resolve(); }
      await Promise.all([one, two]);
      // Independent keys may contend at NOWAIT; retries converge to exactly two commits.
      await importDocumentAssetVersion('editor', versionImport); await importDocumentUpload('editor', upload());
      expect((await counts(query)).commands).toBe(2);
    });
  });
  it.each(['key-wait', 'total', 'feature-disabled'] as const)('bounds taskless %s without retaining staged media or a transaction', async (mode): Promise<void> => {
    await withIsolatedPostgres('8cb1-time-bounds', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query); const before = await files(); const barrier = stagedBarrier();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const leader = importDocumentAssetVersion('editor', versionImport).catch((error: unknown): unknown => error);
      await barrier.arrived;
      try {
        if (mode === 'key-wait') {
          const trying = deferred();
          const pool = getAdvisoryLockPool(); const onAcquire = (client: PoolClient): void => {
            const execute = client.query.bind(client);
            vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]): Promise<QueryResult> => {
              const result = await execute(sql, values); if (sql.includes('pg_try_advisory_lock')) trying.resolve(); return result;
            }) as PoolClient['query']);
          };
          pool.once('acquire', onAcquire);
          const waiter = importDocumentAssetVersion('editor', versionImport).catch((error: unknown): unknown => error);
          await trying.promise; await vi.advanceTimersByTimeAsync(30_000);
          expect(await waiter).toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
          await vi.advanceTimersByTimeAsync(270_000);
        } else if (mode === 'total') await vi.advanceTimersByTimeAsync(300_000);
        else vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      } finally { barrier.release(); }
      try { expect(await leader).toMatchObject({ code: mode === 'feature-disabled' ? 'DOCUMENT_DISABLED' : 'DOCUMENT_MEDIA_CANCELLED' }); }
      finally { vi.useRealTimers(); }
      expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      expect((await query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'")).rows[0].n).toBe(0);
    });
  });
  it.each(['committed', 'uncommitted', 'recovery-failed', 'revoked'] as const)('preserves taskless media across %s unknown COMMIT', async (mode): Promise<void> => {
    await withIsolatedPostgres('8cb1-unknown-commit', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query); const before = await files(); const baseline = await originals(query);
      const writing = new Set<PoolClient>(); let lost = false;
      const restore = interceptQueries(async (client, sql, _values, next): Promise<QueryResult> => {
        if (lost && mode === 'recovery-failed' && sql.includes('SELECT source_request_digest')) throw new Error('recovery unavailable');
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage')) writing.add(client);
        if (sql === 'COMMIT' && writing.has(client) && !lost) {
          if (mode !== 'uncommitted') await next();
          if (mode === 'revoked') await query("UPDATE wujie_project_document_editors SET status='revoked'");
          lost = true; throw new Error('lost version commit ACK');
        }
        return next();
      });
      try {
        if (mode === 'committed') expect((await importDocumentAssetVersion('editor', versionImport)).documentSequence).toBe(1);
        else await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toThrow('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED');
      } finally { restore(); }
      expect(lost).toBe(true); expect((await files()).length).toBe(before.length + 1);
      expect(await counts(query)).toEqual(mode === 'uncommitted' ? empty : single); expect(await originals(query)).toEqual(baseline);
      if (mode === 'revoked') await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      else expect((await importDocumentAssetVersion('editor', versionImport)).documentSequence).toBe(1);
      expect((await counts(query)).commands).toBe(1);
    });
  });
  it('runs the version HTTP route against real PostgreSQL without caller authority or task writes', async (): Promise<void> => {
    await withIsolatedPostgres('8cb1-route', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query); vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', ''); auth.user = { id: 'editor' };
      const before = await originals(query);
      const req = (): NextRequest => new NextRequest('http://localhost/api/collaboration/document-assets/import-version', {
        method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(versionImport),
      });
      const response = await versionPost(req()); expect(response.status).toBe(200);
      const body = await response.json(); expect(body.success).toBe(true); expect(body.documentSequence).toBe(1);
      expect(await counts(query)).toEqual(single); expect(await originals(query)).toEqual(before);
      expect(await (await versionPost(req())).json()).toEqual(body);
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      expect((await versionPost(req())).status).toBe(403);
    });
  });
  it.each(['image', 'video'] as const)('rejects taskless %s MIME conflicts before IO and oversized/checksum/size/local replacement during reading', async (kind): Promise<void> => {
    await withIsolatedPostgres('8cb1-local-media', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query, kind);
      const bytes = kind === 'image' ? image : video; const limit = (kind === 'image' ? 32 : 512) * 1024 * 1024;
      const filename = path.join(mediaRoot, 'images', 'version-mutable.' + (kind === 'image' ? 'png' : 'mp4'));
      const url = '/api/serve-upload/images/' + path.basename(filename); const before = await files();
      await query('UPDATE wujie_asset_versions SET file_url=$1,mime_type=$2', [url, kind === 'image' ? 'video/mp4' : 'image/png']);
      const opened = vi.spyOn(fileSystem, 'open'); const allocate = vi.spyOn(Buffer, 'allocUnsafe');
      await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      expect(opened).not.toHaveBeenCalled(); expect(allocate.mock.calls.some(([size]) => size >= limit)).toBe(false);
      opened.mockRestore(); allocate.mockRestore();
      await query('UPDATE wujie_asset_versions SET mime_type=$1', [kind === 'image' ? 'image/png' : 'video/mp4']);
      for (const mode of ['checksum', 'size', 'replacement', 'truncation', 'oversized'] as const) {
        let mutations = 0;
        await writeFile(filename, bytes);
        await query('UPDATE wujie_asset_versions SET checksum=$1,byte_size=$2', [mode === 'checksum' ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'), mode === 'size' ? bytes.length + 1 : bytes.length]);
        if (mode === 'oversized') await fileSystem.truncate(filename, limit + 1);
        const open = fileSystem.open;
        const spy = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof open>): ReturnType<typeof open> => {
          const handle = await open(...args);
          if (path.basename(String(args[0])) === path.basename(filename) && (mode === 'replacement' || mode === 'truncation')) {
            const read = handle.read.bind(handle); let first = true;
            handle.read = (async (...readArgs: unknown[]): Promise<unknown> => {
              if (first) {
                first = false; mutations++;
                if (mode === 'truncation') await fileSystem.truncate(filename, 1);
                else { await fileSystem.rename(filename, filename + '.old'); await writeFile(filename, bytes); }
              }
              return Reflect.apply(read, handle, readArgs);
            }) as typeof handle.read;
          }
          return handle;
        });
        try { await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toMatchObject({ code: mode === 'oversized' ? 'DOCUMENT_MEDIA_TOO_LARGE' : 'DOCUMENT_MEDIA_CONFLICT' }); }
        finally { spy.mockRestore(); }
        expect(mutations).toBe(mode === 'replacement' || mode === 'truncation' ? 1 : 0);
        expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      }
    });
  });
  it.each(['image', 'video'] as const)('uses bounded fixed-identity S3 bytes for taskless %s and rejects range changes', async (kind): Promise<void> => {
    await withIsolatedPostgres('8cb1-s3', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query, kind);
      let bytes = kind === 'image' ? image : video;
      if (kind === 'video') { const free = Buffer.alloc(17 * 1024 * 1024); free.writeUInt32BE(free.length); free.write('free', 4); bytes = Buffer.concat([video, free]); }
      const mime = kind === 'image' ? 'image/png' : 'video/mp4'; const key = kind === 'image' ? 'images/source.png' : 'images/source.mp4';
      await query('UPDATE wujie_asset_versions SET storage_key=$1,byte_size=$2,checksum=$3', [key, bytes.length, createHash('sha256').update(bytes).digest('hex')]);
      vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1'); vi.stubEnv('COZE_BUCKET_NAME', 'isolated-test');
      const created = new Map<string, Buffer>(); let mode = ''; let heads = 0; let ranges = 0;
      vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (request: unknown): Promise<unknown> => {
        const input = (request as { input: { Key: string; Body?: Buffer; Range?: string; IfMatch?: string; VersionId?: string } }).input;
        if (request instanceof PutObjectCommand) { created.set(input.Key, Buffer.from(input.Body!)); return {}; }
        if (request instanceof DeleteObjectCommand) { created.delete(input.Key); return {}; }
        expect(input.Key).toBe(key);
        if (request instanceof HeadObjectCommand) { heads++; return { ContentLength: mode === 'oversized' ? (kind === 'image' ? 32 : 512) * 1024 * 1024 + 1 : bytes.length,
          ContentType: mime, ETag: '"fixed"', VersionId: 'one' }; }
        expect(input.IfMatch).toBe('"fixed"'); expect(input.VersionId).toBe('one'); ranges++;
        const [start, end] = input.Range!.slice(6).split('-').map(Number); const part = bytes.subarray(start, end + 1);
        return { ContentLength: part.length, ContentType: mime, ContentRange: `bytes ${start}-${end}/${bytes.length}`,
          ETag: mode === 'changed' ? '"changed"' : '"fixed"', VersionId: 'one',
          Body: Readable.from([mode === 'truncated' ? part.subarray(1) : part, ...(mode === 'overlong' ? [Buffer.from('x')] : [])]) };
      }) as never);
      for (const fault of ['changed', 'truncated', 'overlong', 'oversized']) {
        mode = fault;
        await expect(importDocumentAssetVersion('editor', versionImport)).rejects.toMatchObject({ code: mode === 'oversized' ? 'DOCUMENT_MEDIA_TOO_LARGE' : 'DOCUMENT_MEDIA_CONFLICT' });
        expect(await counts(query)).toEqual(empty); expect(created.size).toBe(0);
      }
      mode = ''; heads = 0; ranges = 0;
      const result = await importDocumentAssetVersion('editor', versionImport);
      expect(result.documentSequence).toBe(1); expect(heads).toBe(1); expect(ranges).toBe(kind === 'image' ? 1 : 2);
      expect(created.size).toBe(1);
      const copied = [...created.values()][0];
      expect(copied.length).toBe(bytes.length); expect(copied.equals(bytes)).toBe(true);
      expect(await counts(query)).toEqual(single);
      const row = (await query('SELECT storage_key,checksum,owner_id FROM wujie_asset_versions WHERE id=$1', [result.assetVersionId])).rows[0];
      expect(created.has(row.storage_key)).toBe(true); expect(row.owner_id).toBe('owner'); expect(row.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    });
  }, 15_000);
  it.each([false, true])('finishes reverse project version imports with sorted NOWAIT and retry (task interleaving=%s)', async (taskInterleaving): Promise<void> => {
    await withIsolatedPostgres('8cb1-reverse', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query);
      await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('source','editor',true);
        INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id,status) VALUES ('source','editor','owner','active');
        INSERT INTO cloud_tasks (id,user_id,project_id,type,status,result,created_at,updated_at)
          VALUES ('reverse-task','owner','target','image-generate','completed','{"imageUrl":"/api/serve-upload/images/source.png"}',1,1);
        INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('reverse-asset','owner','target','image')`);
      await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,task_id,file_url,availability,mime_type,byte_size)
          VALUES ('reverse-version','reverse-asset','owner','target',$1,'/api/serve-upload/images/source.png','ready','image/png',$2)`,
      [taskInterleaving ? 'reverse-task' : null, image.length]);
      const both = deferred(); const conflictSeen = deferred(); const release = deferred(); let finals = 0; let held = false;
      const restore = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
        if (sql === "SET LOCAL lock_timeout='2000ms'") { finals++; if (finals === 2) both.resolve(); await both.promise; }
        let result: QueryResult;
        try { result = await next(); } catch (error) { if (sql.includes('FOR UPDATE NOWAIT')) conflictSeen.resolve(); throw error; }
        if (!held && sql.includes('FOR UPDATE NOWAIT')) { held = true; await release.promise; }
        return result;
      });
      const reverseInput = { ...versionImport, projectId: 'source', sourceVersionId: 'reverse-version' };
      const reverse = (): ReturnType<typeof importDocumentAssetVersion> => taskInterleaving
        ? adoptDocumentTaskResult('owner', { ...reverseInput, taskId: 'reverse-task', outputIndex: 0 }) : importDocumentAssetVersion('owner', reverseInput);
      const forward = (): ReturnType<typeof importDocumentAssetVersion> => importDocumentAssetVersion('editor', versionImport);
      const pending = [forward(), reverse()].map(value => value.then(result => ({ result }), (error: unknown) => ({ error })));
      try { await conflictSeen.promise; } finally { release.resolve(); }
      let outcomes: Awaited<(typeof pending)[number]>[];
      try { outcomes = await Promise.all(pending); } finally { restore(); }
      expect(outcomes.filter(value => 'result' in value)).toHaveLength(1);
      expect(outcomes.filter(value => 'error' in value)).toEqual([{ error: expect.objectContaining({ code: 'DOCUMENT_MEDIA_BUSY' }) }]);
      const first = await forward(); const second = await reverse();
      expect(first.documentSequence).toBe(1); expect(second.documentSequence).toBe(1);
      expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_media_lineage')).rows[0].n).toBe(2);
      expect((await query('SELECT count(*)::int AS n FROM wujie_project_canvas_updates')).rows[0].n).toBe(2);
      expect((await query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'")).rows[0].n).toBe(0);
    });
  }, 15_000);
  it.each(['image', 'video'] as const)('imports an owned taskless %s atomically without changing source or billing', async (kind): Promise<void> => {
    await withIsolatedPostgres('8cb1-owned-taskless', async ({ query }): Promise<void> => {
      await seed(query); await taskless(query, kind);
      const before = await originals(query);
      const bytes = await readFile(path.join(mediaRoot, 'images', kind === 'image' ? 'source.png' : 'source.mp4'));
      const reached = deferred(); const release = deferred(); const writers = new Set<PoolClient>();
      const restore = interceptQueries(async (client, sql, _values, next): Promise<QueryResult> => {
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage')) writers.add(client);
        if (sql === 'COMMIT' && writers.has(client)) { reached.resolve(); await release.promise; }
        return next();
      });
      const pending = importDocumentAssetVersion('editor', versionImport);
      const outcome = pending.catch((error: unknown): unknown => error);
      try {
        await Promise.race([reached.promise, outcome.then(value => { if (value instanceof Error) throw value; })]);
        expect(await counts(query)).toEqual(empty);
      } finally { release.resolve(); await outcome; restore(); }
      const result = await pending;
      expect(result.documentSequence).toBe(1); expect(await counts(query)).toEqual(single);
      expect(await originals(query)).toEqual(before);
      expect(await readFile(path.join(mediaRoot, 'images', kind === 'image' ? 'source.png' : 'source.mp4'))).toEqual(bytes);
      expect((await query('SELECT source_kind,task_id,output_index,source_project_id,source_version_id,actor_id,target_owner_id FROM wujie_canvas_media_lineage')).rows)
        .toEqual([{ source_kind: 'version', task_id: null, output_index: null, source_project_id: 'source', source_version_id: 'original-version', actor_id: 'editor', target_owner_id: 'owner' }]);
      const target = (await query('SELECT * FROM wujie_asset_versions WHERE id=$1', [result.assetVersionId])).rows[0];
      expect(target.owner_id).toBe('owner'); expect(target.project_id).toBe('target'); expect(target.task_id).toBeNull();
      expect(await readFile(path.join(mediaRoot, target.file_url.slice('/api/serve-upload/'.length)))).toEqual(bytes);
      const projection = (await query('SELECT projection FROM wujie_project_canvas_documents')).rows[0].projection;
      expect(projection.placements[result.placementId].assetVersionId).toBe(result.assetVersionId);
      expect((await query('SELECT asset_version_id FROM wujie_workspace_placements WHERE id=$1', [result.placementId])).rows[0].asset_version_id).toBe(result.assetVersionId);
    });
  });
});
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: (): void => resolve() };
}
function stagedBarrier(): { arrived: Promise<void>; release(): void } {
  const arrived = deferred(); const released = deferred();
  const write = assetBinaryFileOps.writeFile;
  let first = true;
  vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args: Parameters<typeof write>): Promise<void> => {
    await write(...args);
    if (first) { first = false; arrived.resolve(); await released.promise; }
  });
  return { arrived: arrived.promise, release: released.resolve };
}
type QueryIntercept = (client: PoolClient, sql: string, values: unknown[] | undefined, next: () => Promise<QueryResult>) => Promise<QueryResult>;
function interceptQueries(intercept: QueryIntercept): () => void {
  const pool = getPool(); const seen = new Set<PoolClient>(); const restores: Array<() => void> = [];
  const acquire = (client: PoolClient): void => {
    if (seen.has(client)) return;
    seen.add(client);
    const query = client.query.bind(client);
    type Callback = (error: Error | null, result?: QueryResult) => void;
    const spy = vi.spyOn(client, 'query').mockImplementation(((sql: string, values?: unknown[] | Callback, callback?: Callback): Promise<QueryResult> | undefined => {
      const parameters = Array.isArray(values) ? values : undefined;
      const done = typeof values === 'function' ? values : callback;
      const pending = intercept(client, sql, parameters, () => query(sql, parameters));
      if (done) { void pending.then(result => done(null, result), (error: Error) => done(error)); return undefined; }
      return pending;
    }) as PoolClient['query']);
    restores.push((): void => spy.mockRestore());
  };
  pool.on('acquire', acquire);
  return (): void => { pool.off('acquire', acquire); restores.forEach(restore => restore()); };
}

describe('Task8B2b real PostgreSQL common media/document transaction', () => {
  it.each((['connect', 'try', 'check-before', 'check-final', 'unlock'] as const).flatMap(stage =>
    (['abort', 'timeout', 'total'] as const).flatMap(mode => [false, true].map(lateError => ({ stage, mode, lateError }))))
  )('bounds advisory $stage on $mode (late error=$lateError)', async ({ stage, mode, lateError }): Promise<void> => {
    await withIsolatedPostgres('8b2b-fix1-lock', async ({ query }): Promise<void> => {
      await seed(query); const before = await files(); const arrived = deferred(); const resume = deferred();
      const controller = new AbortController(); const pool = getAdvisoryLockPool();
      const connect = pool.connect.bind(pool); let client: PoolClient | undefined; let releases = 0; const destructions: boolean[] = [];
      let checkIndex = 0; let stalled = false; let firstCommit = true;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const restoreBusiness = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
        const result = await next();
        if (mode === 'total' && firstCommit && sql === 'COMMIT') { firstCommit = false; await vi.advanceTimersByTimeAsync(299_990); }
        return result;
      });
      const connectSpy = vi.spyOn(pool, 'connect').mockImplementation((async (): Promise<PoolClient> => {
        const acquired = await connect(); client = acquired;
        const release = acquired.release.bind(acquired);
        acquired.release = (destroy?: boolean | Error): void => { releases++; destructions.push(!!destroy); release(destroy); };
        if (stage === 'connect') {
          arrived.resolve(); await resume.promise;
          // A failed pool.connect owns cleanup of a connection it never hands out.
          if (lateError) { acquired.release(true); throw new Error('late connect failure'); }
        } else {
          const execute = acquired.query.bind(acquired);
          acquired.query = (async (sql: string, values?: unknown[]): Promise<QueryResult> => {
            const result = await execute(sql, values);
            if (sql === 'SELECT 1') checkIndex++;
            const selected = stage === 'try' ? sql.includes('pg_try_advisory_lock')
              : stage === 'unlock' ? sql.includes('pg_advisory_unlock')
              : sql === 'SELECT 1' && checkIndex === (stage === 'check-before' ? 1 : 3);
            if (!stalled && selected) { stalled = true; arrived.resolve(); await resume.promise; if (lateError) throw new Error('late SQL failure'); }
            return result;
          }) as PoolClient['query'];
        }
        return acquired;
      }) as typeof pool.connect);
      const request = new Request(upload(), { signal: controller.signal });
      const pending = importDocumentUpload('editor', request).then(value => ({ value }), (error: unknown) => ({ error }));
      let outcome: Awaited<typeof pending> | 'pending';
      try {
        await arrived.promise;
        if (mode === 'abort') controller.abort();
        else await vi.advanceTimersByTimeAsync(mode === 'total' ? 10 : 30_000);
        outcome = await Promise.race([pending, realDelay(750).then((): 'pending' => 'pending')]);
        // Capture prompt completion BEFORE permitting a late response.
        expect(outcome).not.toBe('pending');
        if (stage !== 'connect') { expect(releases).toBe(1); expect(destructions).toEqual([true]); }
        expect(vi.getTimerCount()).toBe(getPool().idleCount + pool.idleCount);
      } finally {
        resume.resolve(); await pending; await new Promise<void>(done => setImmediate(done));
        restoreBusiness(); connectSpy.mockRestore(); vi.useRealTimers();
      }
      expect(releases).toBe(1); expect(destructions).toEqual([true]);
      const committed = stage === 'unlock';
      if (committed) expect(outcome!).toHaveProperty('value.documentSequence', 1);
      else expect(outcome!).toMatchObject({ error: { code: mode === 'timeout' ? 'DOCUMENT_MEDIA_BUSY' : 'DOCUMENT_MEDIA_CANCELLED' } });
      expect(await counts(query)).toEqual(committed ? single : empty);
      expect((await files()).length).toBe(before.length + (committed ? 1 : 0));
      const pid = (client as PoolClient & { processID?: number } | undefined)?.processID;
      const locks = await query('SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND locktype=\'advisory\'', [pid]);
      expect(locks.rows[0].n).toBe(0); expect(getPool().waitingCount).toBe(0);
      expect((await query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'")).rows[0].n).toBe(0);
      const releaseBudget = reserveMediaPreparation(VIDEO_IMPORT_LIMIT, new AbortController().signal); releaseBudget();
      // A fresh request proves both the reservation and business transaction ended.
      expect((await importDocumentUpload('editor', upload(image, 'image/png', 'after-stall'))).documentSequence).toBe(committed ? 2 : 1);
    });
  }, 15_000);
  it.each([
    ['local', true, 'image'], ['local', false, 'image'], ['s3', true, 'image'], ['s3', false, 'image'],
    ['local', true, 'video'], ['local', false, 'video'], ['s3', true, 'video'], ['s3', false, 'video'],
  ] as const)('rejects %s version=%s task=%s MIME mismatch before media IO or allocation', async (transport, hasVersion, kind): Promise<void> => {
    await withIsolatedPostgres('8b2b-fix1-kind', async ({ query }): Promise<void> => {
      await seed(query);
      const mime = kind === 'image' ? 'video/mp4' : 'image/png';
      const filename = kind === 'image' ? 'mismatch.mp4' : 'source.png';
      const size = kind === 'image' ? 33 * 1024 * 1024 : image.length;
      if (kind === 'image') { await writeFile(path.join(mediaRoot, 'images', filename), video); await fileSystem.truncate(path.join(mediaRoot, 'images', filename), size); }
      const url = '/api/serve-upload/images/' + filename;
      const metadata = { url, mimeType: mime, byteSize: size, ...(transport === 's3' ? { storageKey: 'images/' + filename } : {}) };
      await query('UPDATE cloud_tasks SET project_id=$1,type=$2,result=$3::jsonb', [hasVersion ? 'source' : 'target', kind + '-generate', JSON.stringify({ images: [metadata] })]);
      await query('UPDATE wujie_assets SET kind=$1', [kind]);
      await query('UPDATE wujie_asset_versions SET file_url=$1,mime_type=$2,byte_size=$3,checksum=NULL,storage_key=$4', [url, mime, size, transport === 's3' ? 'images/' + filename : null]);
      const input = { ...adoption, sourceVersionId: hasVersion ? 'original-version' : undefined };
      let opened = 0; let heads = 0; let ranges = 0; let largeAllocations = 0;
      const openFile = fileSystem.open; const allocate = Buffer.allocUnsafe;
      vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof openFile>): ReturnType<typeof openFile> => { opened++; return openFile(...args); });
      vi.spyOn(Buffer, 'allocUnsafe').mockImplementation((length: number): ReturnType<typeof allocate> => { if (length >= 33 * 1024 * 1024) largeAllocations++; return allocate(length); });
      if (transport === 's3') {
        vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1'); vi.stubEnv('COZE_BUCKET_NAME', 'isolated-test');
        vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (request: unknown): Promise<unknown> => {
          if (request instanceof HeadObjectCommand) { heads++; return { ContentLength: size, ContentType: mime, ETag: '"one"', VersionId: 'v1' }; }
          const input = (request as { input: { Range: string } }).input;
          const [start, end] = input.Range.slice(6).split('-').map(Number); ranges++;
          return { ContentLength: end - start + 1, ContentType: mime, ContentRange: `bytes ${start}-${end}/${size}`, ETag: '"one"', VersionId: 'v1', Body: Readable.from([Buffer.alloc(end - start + 1)]) };
        }) as never);
      }
      await expect(adoptDocumentTaskResult('editor', input)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      expect({ opened, heads, ranges, largeAllocations }).toEqual({ opened: 0, heads: 0, ranges: 0, largeAllocations: 0 });
      expect(await counts(query)).toEqual(empty);
    });
  });
  it.each(['image/png', 'video/mp4'] as const)('rejects fixed local %s identity replacement, truncation and oversize without references', async (mime): Promise<void> => {
    await withIsolatedPostgres('8b2b-local-identity', async ({ query }): Promise<void> => {
      await seed(query); const bytes = mime === 'image/png' ? image : video;
      const filename = path.join(mediaRoot, 'images', `mutable.${mime === 'image/png' ? 'png' : 'mp4'}`);
      const url = '/api/serve-upload/images/' + path.basename(filename); const baseline = await files();
      await query('UPDATE wujie_assets SET kind=$1', [mime.startsWith('video') ? 'video' : 'image']);
      await query('UPDATE cloud_tasks SET type=$1,result=$2::jsonb', [mime.startsWith('video') ? 'video-generate' : 'image-generate', JSON.stringify({ [mime.startsWith('video') ? 'videoUrl' : 'imageUrl']: url })]);
      await query('UPDATE wujie_asset_versions SET file_url=$1,mime_type=$2,byte_size=$3,checksum=$4', [url, mime, bytes.length, createHash('sha256').update(bytes).digest('hex')]);
      const openFile = fileSystem.open;
      for (const mode of ['replaced', 'truncated', 'oversized']) {
        await writeFile(filename, bytes);
        if (mode === 'oversized') await fileSystem.truncate(filename, (mime.startsWith('video') ? 512 : 32) * 1024 * 1024 + 1);
        const spy = vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof openFile>): ReturnType<typeof openFile> => {
          const file = await openFile(...args);
          if (path.basename(String(args[0])) === path.basename(filename) && mode !== 'oversized') {
            const read = file.read.bind(file); let first = true;
            file.read = (async (...readArgs: unknown[]): Promise<unknown> => {
              if (first) {
                first = false;
                if (mode === 'truncated') await fileSystem.truncate(filename, 1);
                else { await fileSystem.rename(filename, filename + '.old'); await writeFile(filename, bytes); }
              }
              return Reflect.apply(read, file, readArgs);
            }) as typeof file.read;
          }
          return file;
        });
        try { await expect(adoptDocumentTaskResult('editor', adoption)).rejects.toMatchObject({ code: mode === 'oversized' ? 'DOCUMENT_MEDIA_TOO_LARGE' : 'DOCUMENT_MEDIA_CONFLICT' }); }
        finally { spy.mockRestore(); }
        expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(baseline);
      }
    });
  });
  it('propagates preparation cancellation into existing document reference inspection', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-reference-signal', async ({ query }): Promise<void> => {
      await seed(query); await importDocumentUpload('editor', upload());
      const inspect = managedMedia.getManagedAssetMediaDescriptor; let received = false;
      vi.spyOn(managedMedia, 'getManagedAssetMediaDescriptor').mockImplementation(async (...args: Parameters<typeof inspect>): ReturnType<typeof inspect> => {
        received = args[2]?.signal instanceof AbortSignal;
        return inspect(...args);
      });
      await importDocumentUpload('editor', upload(image, 'image/png', 'next'));
      expect(received).toBe(true);
    });
  });
  it('rejects a completed task with a null server result as a forbidden source', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-null-result', async ({ query }): Promise<void> => {
      await seed(query); await query("UPDATE cloud_tasks SET result='null'::jsonb");
      await expect(adoptDocumentTaskResult('editor', adoption)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      expect(await counts(query)).toEqual(empty);
    });
  });
  it('bounds preflight authorization lock contention before reading the body', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-preflight', async ({ query }): Promise<void> => {
      await seed(query); const holder = await getPool().connect();
      await holder.query('BEGIN'); await holder.query("SELECT id FROM wujie_projects WHERE id='target' FOR UPDATE");
      const request = upload(); const pending = importDocumentUpload('editor', request).catch((error: unknown): unknown => error);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome: unknown;
      try {
        outcome = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve('unbounded preflight'), 2700); })]);
        expect(request.bodyUsed).toBe(false);
      } finally { clearTimeout(timer); await holder.query('ROLLBACK'); holder.release(); await pending; }
      expect(outcome).toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
      expect(await counts(query)).toEqual(empty);
    });
  });
  it.each(['image/png', 'video/mp4'] as const)('rejects admission over the active/byte reservation limit for %s before consuming another body', async (mime): Promise<void> => {
    await withIsolatedPostgres('8b2b-admission', async ({ query }): Promise<void> => {
      await seed(query); const arrived = deferred(); const resume = deferred(); const write = assetBinaryFileOps.writeFile;
      const target = mime === 'image/png' ? 2 : 1; let writes = 0;
      vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args: Parameters<typeof write>): Promise<void> => {
        await write(...args); if (++writes === target) arrived.resolve(); await resume.promise;
      });
      const controllers = Array.from({ length: target }, () => new AbortController());
      const pending = controllers.map((controller, index) => importDocumentUpload('editor', new Request(upload(mime === 'image/png' ? image : video, mime, `leader-${index}`), { signal: controller.signal }))
        .catch((error: unknown): unknown => error));
      try {
        await arrived.promise; const blocked = upload(image, 'image/png', 'busy'); blocked.headers.set('content-length', '1');
        await expect(importDocumentUpload('editor', blocked)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
        expect(blocked.bodyUsed).toBe(false); expect(writes).toBe(target);
      } finally { controllers.forEach(controller => controller.abort()); resume.resolve(); await Promise.all(pending); }
      expect(await counts(query)).toEqual(empty);
    });
  });
  it('expires the full 300 second preparation after body completion and rejects late IO success', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-total-deadline', async ({ query }): Promise<void> => {
      await seed(query); const barrier = stagedBarrier(); const before = await files();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const pending = importDocumentUpload('editor', upload()).catch((error: unknown): unknown => error);
      try {
        await barrier.arrived; await vi.advanceTimersByTimeAsync(300_000); barrier.release();
        expect(await pending).toBeInstanceOf(Error); expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      } finally { barrier.release(); vi.useRealTimers(); await pending; }
    });
  });
  it.each(['jpeg', 'webp', 'gif', 'avif', 'bmp', 'webm'] as const)('imports real %s through the common transaction', async (format): Promise<void> => {
    await withIsolatedPostgres('8b2b-formats', async ({ query }): Promise<void> => {
      await seed(query);
      let bytes: Buffer;
      if (format === 'webm') bytes = Buffer.from(await readFile('tests/fixtures/yjs-task8b2-tiny-valid.webm.base64', 'utf8'), 'base64');
      else if (format === 'bmp') {
        bytes = Buffer.alloc(58); bytes.write('BM'); bytes.writeUInt32LE(58, 2); bytes.writeUInt32LE(54, 10);
        bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(1, 18); bytes.writeInt32LE(1, 22);
        bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
      } else bytes = await sharp(image)[format]().toBuffer();
      const result = await importDocumentUpload('editor', upload(bytes, `${format === 'webm' ? 'video' : 'image'}/${format}`));
      expect(await counts(query)).toEqual(single);
      expect((await query('SELECT checksum FROM wujie_asset_versions WHERE id=$1', [result.assetVersionId])).rows[0].checksum)
        .toBe(createHash('sha256').update(bytes).digest('hex'));
    });
  });
  it('adopts shared-task video and serializes twenty same-key adoptions to one persisted copy', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-adopt-video', async ({ query }): Promise<void> => {
      await seed(query);
      await query(`UPDATE cloud_tasks SET project_id='target',type='video-generate',result='{"videoUrl":"/api/serve-upload/images/source.mp4"}'`);
      const input = { projectId: 'target', taskId: 'task', outputIndex: 0, idempotencyKey: 'shared-video', command };
      const write = vi.spyOn(assetBinaryFileOps, 'writeFile');
      const results = await Promise.all(Array.from({ length: 20 }, () => adoptDocumentTaskResult('editor', input)));
      expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
      expect(write).toHaveBeenCalledTimes(1); expect(await counts(query)).toEqual(single);
      expect((await query('SELECT checksum FROM wujie_asset_versions WHERE id=$1', [results[0].assetVersionId])).rows[0].checksum)
        .toBe(createHash('sha256').update(video).digest('hex'));
      await expect(adoptDocumentTaskResult('editor', { ...input, outputIndex: 1 })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      await expect(adoptDocumentTaskResult('editor', input)).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    });
  }, 15_000);
  it('rejects foreign user/project/task/output and unavailable versions before preparing bytes', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-source-auth', async ({ query }): Promise<void> => {
      await seed(query); const write = vi.spyOn(assetBinaryFileOps, 'writeFile');
      for (const input of [ { ...adoption, sourceVersionId: undefined }, { ...adoption, taskId: 'missing' },
        { ...adoption, outputIndex: 1 }, { ...adoption, sourceVersionId: 'missing' } ]) {
        await expect(adoptDocumentTaskResult('editor', input)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      }
      await expect(adoptDocumentTaskResult('owner', adoption)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      for (const status of ['processing', 'failed', 'cancelled']) {
        await query('UPDATE cloud_tasks SET status=$1', [status]);
        await expect(adoptDocumentTaskResult('editor', adoption)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      }
      await query("UPDATE cloud_tasks SET status='completed'");
      await query("UPDATE wujie_asset_versions SET availability='missing'");
      await expect(adoptDocumentTaskResult('editor', adoption)).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_SOURCE_FORBIDDEN' });
      expect(write).not.toHaveBeenCalled(); expect(await counts(query)).toEqual(empty);
    });
  });
  it('replaces a placement atomically with CAS and rejects ready-key collisions in either direction', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-replace', async ({ query }): Promise<void> => {
      await seed(query); const attached = await importDocumentUpload('editor', upload());
      await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'ready', command: { ...command, assetVersionId: attached.assetVersionId } });
      await expect(importDocumentUpload('editor', upload(image, 'image/png', 'ready'))).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      const replacement = { action: 'replace', placementId: attached.placementId, expectedAssetVersionId: attached.assetVersionId };
      const replaced = await importDocumentUpload('editor', upload(video, 'video/mp4', 'replace', { command: replacement }));
      expect(replaced.placementId).toBe(attached.placementId); expect(replaced.assetVersionId).not.toBe(attached.assetVersionId);
      expect(replaced.documentSequence).toBe(3);
      expect(await importDocumentUpload('editor', upload(video, 'video/mp4', 'replace', { command: replacement }))).toEqual(replaced);
      const before = await files();
      await expect(importDocumentUpload('editor', upload(video, 'video/mp4', 'stale', { command: replacement }))).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      expect(await files()).toEqual(before);
      expect((await query('SELECT asset_version_id FROM wujie_workspace_placements WHERE id=$1', [attached.placementId])).rows[0].asset_version_id).toBe(replaced.assetVersionId);
    });
  });
  it('cancels a same-key waiter before body read and cancels the leader after slow media IO', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-cancel', async ({ query }): Promise<void> => {
      await seed(query); const barrier = stagedBarrier(); const before = await files();
      const leaderSignal = new AbortController(); const waiterSignal = new AbortController();
      const leader = importDocumentUpload('editor', new Request(upload(), { signal: leaderSignal.signal })).catch((error: unknown): unknown => error);
      await barrier.arrived;
      const waiterRequest = new Request(upload(), { signal: waiterSignal.signal });
      const waiter = importDocumentUpload('editor', waiterRequest).catch((error: unknown): unknown => error);
      waiterSignal.abort();
      expect(await waiter).toMatchObject({ code: 'DOCUMENT_MEDIA_CANCELLED' }); expect(waiterRequest.bodyUsed).toBe(false);
      leaderSignal.abort(); barrier.release();
      expect(await leader).toBeInstanceOf(Error); expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
    });
  });
  it('keeps cleanup failure in the existing outbox and retries only the new unreferenced object', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-outbox', async ({ query }): Promise<void> => {
      await seed(query); const before = await files();
      const restore = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage')) throw new Error('rollback before lineage'); return next();
      });
      const remove = assetBinaryFileOps.rm;
      const spy = vi.spyOn(assetBinaryFileOps, 'rm').mockImplementation(async (...args: Parameters<typeof remove>): Promise<void> => {
        if (!String(args[0]).endsWith('.tmp')) throw Object.assign(new Error('locked media'), { code: 'EACCES' });
        return remove(...args);
      });
      try { await expect(importDocumentUpload('editor', upload())).rejects.toThrow(); }
      finally { restore(); spy.mockRestore(); }
      expect(await counts(query)).toEqual(empty);
      expect((await query("SELECT status FROM wujie_asset_cleanup_outbox WHERE local_path IS NOT NULL")).rows).toEqual([{ status: 'pending' }]);
      await drainPendingAssetCleanup({ limit: 5 });
      expect(await files()).toEqual(before); expect(await readFile(path.join(mediaRoot, 'images/source.png'))).toEqual(image);
    });
  });
  it('executes both real API routes against PostgreSQL and rejects an unauthorized body before reading it', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-api', async ({ query }): Promise<void> => {
      await seed(query); vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
      const make = (): NextRequest => { const original = upload(); return new NextRequest(original.url, {
        method: 'POST', headers: { ...Object.fromEntries(original.headers), origin: 'http://localhost' }, body: new Uint8Array(image),
      }); };
      auth.user = null;
      const anonymous = make(); expect((await uploadPost(anonymous)).status).toBe(401); expect(anonymous.bodyUsed).toBe(false);
      auth.user = { id: 'missing-actor' };
      const forbidden = make(); expect((await uploadPost(forbidden)).status).toBe(403); expect(forbidden.bodyUsed).toBe(false);
      auth.user = { id: 'editor' };
      expect((await uploadPost(make())).status).toBe(200);
      const response = await adoptPost(new NextRequest('http://localhost/adopt', { method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(adoption) }));
      expect(response.status).toBe(200); expect((await response.json()).documentSequence).toBe(2);
      expect((await counts(query)).commands).toBe(2);
    });
  });
  it.each(['image/png', 'video/mp4'] as const)('fixes one S3 identity for %s and rejects swapped, truncated or overlong response bytes', async (mime): Promise<void> => {
    await withIsolatedPostgres('8b2b-s3', async ({ query }): Promise<void> => {
      await seed(query);
      let bytes = image;
      if (mime === 'video/mp4') {
        const padding = Buffer.alloc(17 * 1024 * 1024); padding.writeUInt32BE(padding.length); padding.write('free', 4);
        bytes = Buffer.concat([video, padding]);
      }
      const key = mime === 'image/png' ? 'images/original.png' : 'images/original.mp4';
      await query('UPDATE wujie_assets SET kind=$1', [mime.startsWith('video') ? 'video' : 'image']);
      await query(`UPDATE cloud_tasks SET type=$1,result=$2::jsonb`, [mime.startsWith('video') ? 'video-generate' : 'image-generate',
        JSON.stringify({ [mime.startsWith('video') ? 'videoUrl' : 'imageUrl']: '/api/serve-upload/' + key })]);
      await query('UPDATE wujie_asset_versions SET file_url=$1,storage_key=$2,mime_type=$3,byte_size=$4,checksum=$5',
        ['/api/serve-upload/' + key, key, mime, bytes.length, createHash('sha256').update(bytes).digest('hex')]);
      vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', 'http://127.0.0.1:1'); vi.stubEnv('COZE_BUCKET_NAME', 'isolated-test');
      let fault = ''; let heads = 0; const ranges: string[] = []; const streams: Readable[] = []; const created = new Map<string, Buffer>();
      vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (request: unknown): Promise<unknown> => {
        const input = (request as { input: { Key: string; Range?: string; IfMatch?: string; VersionId?: string; Body?: Buffer } }).input;
        if (request instanceof PutObjectCommand) { created.set(input.Key, Buffer.from(input.Body!)); return {}; }
        if (request instanceof DeleteObjectCommand) { created.delete(input.Key); return {}; }
        expect(input.Key).toBe(key);
        if (request instanceof HeadObjectCommand) { heads++; return { ContentLength: fault === 'oversized' ? (mime.startsWith('video') ? 512 : 32) * 1024 * 1024 + 1 : bytes.length, ContentType: mime, ETag: '"first"', VersionId: 'v1' }; }
        expect(request).toBeInstanceOf(GetObjectCommand); expect(input.IfMatch).toBe('"first"'); expect(input.VersionId).toBe('v1');
        const [start, end] = input.Range!.slice(6).split('-').map(Number); ranges.push(input.Range!);
        const part = bytes.subarray(start, end + 1);
        const stream = Readable.from([fault === 'truncated' ? part.subarray(0, part.length - 1) : part, ...(fault === 'overlong' ? [Buffer.from('x')] : [])]);
        streams.push(stream);
        return { ContentLength: part.length, ContentType: mime, ContentRange: `bytes ${start}-${end}/${bytes.length}`,
          ETag: fault === 'changed' ? '"second"' : '"first"', VersionId: 'v1', Body: stream };
      }) as never);
      for (const mode of ['changed', 'truncated', 'overlong', 'oversized']) {
        fault = mode;
        await expect(adoptDocumentTaskResult('editor', adoption)).rejects.toMatchObject({ code: mode === 'oversized' ? 'DOCUMENT_MEDIA_TOO_LARGE' : 'DOCUMENT_MEDIA_CONFLICT' });
        expect(await counts(query)).toEqual(empty); expect(created.size).toBe(0);
      }
      fault = ''; heads = 0; ranges.length = 0;
      const result = await adoptDocumentTaskResult('editor', adoption);
      expect(result.documentSequence).toBe(1); expect(heads).toBe(1); expect(ranges.length).toBe(mime === 'video/mp4' ? 2 : 1);
      const copied = [...created.values()][0];
      expect(copied.length).toBe(bytes.length);
      expect(createHash('sha256').update(copied).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(streams.every(stream => stream.destroyed)).toBe(true);
      expect(await counts(query)).toEqual(single);
    });
  }, 15_000);
  it.each(['committed', 'uncommitted', 'recovery-failed', 'revoked'] as const)('retains media and recovers only durable authorized state after %s ACK loss', async (mode): Promise<void> => {
    await withIsolatedPostgres('8b2b-ack', async ({ query }): Promise<void> => {
      await seed(query); const before = await files(); const writing = new Set<PoolClient>(); let lost = false;
      const restore = interceptQueries(async (client, sql, _values, next): Promise<QueryResult> => {
        if (lost && mode === 'recovery-failed' && sql.includes('SELECT source_request_digest')) throw new Error('recovery unavailable');
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage')) writing.add(client);
        if (sql === 'COMMIT' && writing.has(client) && !lost) {
          if (mode !== 'uncommitted') await next();
          if (mode === 'revoked') await query("UPDATE wujie_project_document_editors SET status='revoked'");
          lost = true; throw new Error('lost commit ack');
        }
        return next();
      });
      try {
        if (mode === 'committed') expect((await importDocumentUpload('editor', upload())).documentSequence).toBe(1);
        else await expect(importDocumentUpload('editor', upload())).rejects.toThrow('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED');
      } finally { restore(); }
      expect(lost).toBe(true); expect((await files()).length).toBe(before.length + 1);
      expect(await counts(query)).toEqual(mode === 'uncommitted' ? empty : single);
      if (mode === 'revoked') await expect(importDocumentUpload('editor', upload())).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      else if (mode !== 'uncommitted') expect((await importDocumentUpload('editor', upload())).documentSequence).toBe(1);
      expect((await getPool().query('SELECT 1 AS n')).rows[0].n).toBe(1);
    });
  });
  it('discards failed rollback connection and does not retain a business-pool transaction', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-rollback', async ({ query }): Promise<void> => {
      await seed(query); const before = await files();
      const restore = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage') || sql === 'ROLLBACK') throw new Error('rollback fault');
        return next();
      });
      try { await expect(importDocumentUpload('editor', upload())).rejects.toThrow('rollback fault'); }
      finally { restore(); }
      expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      expect((await importDocumentUpload('editor', upload())).documentSequence).toBe(1);
    });
  });
  it('loses an advisory backend during media preparation and refuses to commit', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-lock-loss', async ({ query }): Promise<void> => {
      await seed(query); const barrier = stagedBarrier(); const before = await files();
      const pending = importDocumentUpload('editor', upload()).catch((error: unknown): unknown => error);
      await barrier.arrived;
      try {
        const locked = (await query(`SELECT DISTINCT pid FROM pg_locks WHERE locktype='advisory' AND granted AND mode='ExclusiveLock' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)).rows;
        expect(locked.length).toBe(1);
        await query('SELECT pg_terminate_backend($1)', [locked[0].pid]);
      } finally { barrier.release(); }
      expect(await pending).toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
      expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      expect((await getAdvisoryLockPool().query('SELECT 1 AS n')).rows[0].n).toBe(1);
    });
  });
  it('allows unified publication with an injected task UPDATE pressure lock to finish project FK writes before the competing import', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-projector', async ({ query }): Promise<void> => {
      await seed(query);
      // Same owner/project is essential: both operations really contend on the target FK.
      await query("UPDATE cloud_tasks SET project_id='target',user_id='owner'");
      // The private projector remains forbidden for this enabled canvas project.
      await expect(projectCompletedTaskToAssets({ actorUserId: 'owner', taskId: 'task', targetProjectId: 'target', workspace: 'canvas', parentVersionIds: [] }))
        .rejects.toMatchObject({ code: 'TASK_PROJECTION_CONFLICT' });
      expect(await counts(query)).toEqual(empty);
      await query(await readFile('migrations/20260927_yjs_canvas_task_publications_intent.sql', 'utf8'));
      await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('target','owner')");
      const admissionClient = await getPool().connect();
      try {
        await admissionClient.query('BEGIN');
        const publication = await prepareCanvasTaskPublicationInTransaction(admissionClient, {
          actorUserId: 'owner', projectId: 'target', publication: {
            access: { kind: 'document', actorUserId: 'owner', ownerId: 'owner', projectId: 'target', grantGeneration: '0' },
            workspace: 'canvas', workspaceId: 'target',
            intent: { parentVersionIds: [], projectionMode: 'derived', placement: { action: 'append', selectedEntityIds: [] } },
          },
        });
        await persistCanvasTaskPublicationInTransaction(admissionClient, { taskId: 'task', publication });
        await admissionClient.query('COMMIT');
      } catch (error) { await admissionClient.query('ROLLBACK'); throw error; }
      finally { admissionClient.release(); }
      const creditsBefore = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      // Publication admission now locks the task before source preparation too.
      // Hold actual media IO after the source snapshot, then start the projector,
      // so this still tests mutation between preparation and the final task lock.
      const mediaBarrier = stagedBarrier();
      const pending = adoptDocumentTaskResult('owner', { projectId: 'target', taskId: 'task', outputIndex: 0, idempotencyKey: 'new', command })
        .catch((error: unknown): unknown => error);
      await mediaBarrier.arrived;
      const taskHeld = deferred(); const letProjectorContinue = deferred(); const importAtTask = deferred();
      let projectionClient: PoolClient | undefined;
      let upgraded = false; let committed = false; let importLockObserved = false;
      const order: string[] = [];
      const restore = interceptQueries(async (client, sql, _values, next): Promise<QueryResult> => {
        // Only the final publication transaction uses this separate SET. The
        // production path holds SHARE; UPDATE below is explicit test pressure.
        if (!projectionClient && sql === "SET LOCAL lock_timeout='2000ms'") projectionClient = client;
        if (client === projectionClient && !upgraded && sql.includes('FROM cloud_tasks') && sql.includes('FOR SHARE')) {
          const result = await next(); upgraded = true;
          await client.query("SELECT id FROM cloud_tasks WHERE id='task' FOR UPDATE");
          order.push('publication-task-update'); taskHeld.resolve(); await letProjectorContinue.promise; return result;
        }
        if (client !== projectionClient && upgraded && !importLockObserved && sql.includes('FROM cloud_tasks') && sql.includes('FOR SHARE')) {
          importLockObserved = true; order.push('import-task-wait'); importAtTask.resolve();
          const result = await next(); order.push('import-task-acquired'); return result;
        }
        if (client === projectionClient && sql.includes('INSERT INTO wujie_asset_versions')) order.push('publication-version-fk');
        if (client === projectionClient && !committed && sql === 'COMMIT') {
          committed = true;
          await client.query("UPDATE cloud_tasks SET result=result || '{\"changedDuringProjection\":true}'::jsonb WHERE id='task'");
          order.push('publication-commit');
        }
        return next();
      });
      const projection = publishDocumentTaskOutput('owner', 'task', 0);
      try {
        await taskHeld.promise;
        mediaBarrier.release();
        await importAtTask.promise; letProjectorContinue.resolve();
        const published = await projection; expect(published.assetReference.assetVersionId).toBeTruthy();
        expect(await pending).toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
        expect(order).toEqual(['publication-task-update', 'import-task-wait', 'publication-version-fk', 'publication-commit', 'import-task-acquired']);
        expect(await counts(query)).toEqual(single);
        expect((await query("SELECT count(*)::int AS n FROM wujie_canvas_asset_commands WHERE idempotency_key='new'")).rows[0].n).toBe(0);
        expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(creditsBefore);
      } finally { mediaBarrier.release(); letProjectorContinue.resolve(); await projection.catch((): void => undefined); await pending; restore(); }
    });
  }, 15_000);
  it.each([false, true])('finishes bidirectional project adoption without a lock cycle (legacy=%s)', async (legacy): Promise<void> => {
    await withIsolatedPostgres('8b2b-bidirectional', async ({ query }): Promise<void> => {
      await seed(query);
      await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('source','editor',true);
        INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id,status) VALUES ('source','editor','owner','active');
        INSERT INTO cloud_tasks (id,user_id,project_id,type,status,result,created_at,updated_at)
          VALUES ('other-task','owner','target','image-generate','completed','{"imageUrl":"/api/serve-upload/images/source.png"}',1,1);
        INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('other-asset','owner','target','image');
        INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,task_id,file_url,availability,mime_type,byte_size)
          VALUES ('other-version','other-asset','owner','target','other-task','/api/serve-upload/images/source.png','ready','image/png',${image.length});
        UPDATE wujie_assets SET current_version_id='other-version' WHERE id='other-asset'`);
      const reached = deferred(); const resume = deferred(); const conflictSeen = deferred(); const bothFinal = deferred();
      let finals = 0; let held = false;
      const restore = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
        if (!legacy && sql === "SET LOCAL lock_timeout='2000ms'") { finals++; if (finals === 2) bothFinal.resolve(); await bothFinal.promise; }
        let result: QueryResult;
        try { result = await next(); }
        catch (error) { if (sql.includes('FOR UPDATE NOWAIT')) conflictSeen.resolve(); throw error; }
        if (!held && (legacy ? sql.includes('SELECT project_id, status FROM cloud_tasks') && sql.includes('FOR SHARE') : sql.includes('FOR UPDATE NOWAIT'))) {
          held = true; reached.resolve(); await resume.promise;
        }
        return result;
      });
      const first = legacy ? adoptCompletedResultIntoProject({ actorId: 'editor', ownerId: 'owner', projectId: 'target',
        taskId: 'task', sourceVersionId: 'original-version', idempotencyKey: 'legacy' }) : adoptDocumentTaskResult('editor', adoption);
      const firstOutcome = first.then(value => ({ value }), (error: unknown) => ({ error }));
      try {
        if (legacy) await reached.promise;
        const reverse = adoptDocumentTaskResult('owner', { ...adoption, projectId: 'source', taskId: 'other-task', sourceVersionId: 'other-version' });
        const reverseOutcome = reverse.then(value => ({ value }), (error: unknown) => ({ error }));
        // Both new final transactions reached the lock phase, or the legacy
        // transaction holds its target SHARE. Observe real 55P03 before release.
        await conflictSeen.promise;
        resume.resolve();
        const outcomes = await Promise.all([firstOutcome, reverseOutcome]);
        for (const outcome of outcomes) {
          if ('error' in outcome) expect(outcome.error).toMatchObject({ code: 'DOCUMENT_MEDIA_BUSY' });
          else expect(outcome.value.assetVersionId).toBeTruthy();
        }
        expect(outcomes.some(outcome => 'value' in outcome)).toBe(true);
      } finally { bothFinal.resolve(); resume.resolve(); await firstOutcome; restore(); }
    });
  }, 15_000);
  it.each([['owner', 'image/png'], ['editor', 'image/png'], ['owner', 'video/mp4'], ['editor', 'video/mp4']] as const)(
    'publishes %s upload %s with identical bytes, durable result and untouched task/billing', async (actor, mime): Promise<void> => {
      await withIsolatedPostgres('8b2b-upload', async ({ query }): Promise<void> => {
        await seed(query);
        const before = (await query('SELECT to_jsonb(t) AS task FROM cloud_tasks t')).rows;
        const ledger = (await query('SELECT * FROM wujie_credit_transactions')).rows;
        const bytes = mime.startsWith('video/') ? video : image;
        const result = await importDocumentUpload(actor, upload(bytes, mime));
        expect(await counts(query)).toEqual(single);
        const version = (await query('SELECT * FROM wujie_asset_versions WHERE id=$1', [result.assetVersionId])).rows[0];
        expect(version.owner_id).toBe('owner');
        expect(version.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(await readFile(path.join(mediaRoot, version.file_url.slice('/api/serve-upload/'.length)))).toEqual(bytes);
        const stored = (await query('SELECT * FROM wujie_canvas_asset_commands')).rows[0];
        const document = (await query('SELECT projection FROM wujie_project_canvas_documents')).rows[0].projection;
        expect(stored.asset_version_id).toBe(result.assetVersionId);
        expect(Number(stored.document_sequence)).toBe(result.documentSequence);
        expect(document.placements[result.placementId].assetVersionId).toBe(result.assetVersionId);
        expect((await query('SELECT to_jsonb(t) AS task FROM cloud_tasks t')).rows).toEqual(before);
        expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toEqual(ledger);
        expect(await readFile(path.join(mediaRoot, 'images', 'source.png'))).toEqual(image);
      });
    });
  it('adopts the selected shared-task output without requiring a source version and checks its known checksum', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-shared', async ({ query }): Promise<void> => {
      await seed(query);
      const url = '/api/serve-upload/images/source.png';
      const input = { projectId: 'target', taskId: 'task', outputIndex: 0, idempotencyKey: 'adopt', command };
      await query(`UPDATE cloud_tasks SET project_id='target',result=$1::jsonb`, [JSON.stringify({ images: [
        { url: '/api/serve-upload/images/missing.png' }, { url, checksum: '0'.repeat(64), mimeType: 'image/png', byteSize: image.length },
      ] })]);
      await expect(adoptDocumentTaskResult('editor', { ...input, outputIndex: 1 })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      expect(await counts(query)).toEqual(empty);
      await query(`UPDATE cloud_tasks SET result=$1::jsonb`, [JSON.stringify({ images: [
        { url: '/api/serve-upload/images/missing.png' }, { url, checksum: createHash('sha256').update(image).digest('hex'), mimeType: 'image/png', byteSize: image.length },
      ] })]);
      const result = await adoptDocumentTaskResult('editor', { ...input, outputIndex: 1 });
      expect(result.documentSequence).toBe(1);
      const row = (await query('SELECT * FROM wujie_canvas_media_lineage')).rows[0];
      expect(row.source_version_id).toBeNull(); expect(row.output_index).toBe(1); expect(row.actor_id).toBe('editor');
      expect((await query('SELECT user_id,credit_status FROM cloud_tasks')).rows[0]).toEqual({ user_id: 'editor', credit_status: 'charged' });
    });
  });
  it('prepares once for twenty same-key uploads, rejects intent drift and never resurrects a tombstone', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-twenty', async ({ query }): Promise<void> => {
      await seed(query);
      const writes = vi.spyOn(assetBinaryFileOps, 'writeFile');
      const results = await Promise.all(Array.from({ length: 20 }, () => importDocumentUpload('editor', upload())));
      expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
      expect(writes).toHaveBeenCalledTimes(1); expect(await counts(query)).toEqual(single);
      await expect(importDocumentUpload('editor', upload(Buffer.from('different')))).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      await expect(importDocumentUpload('editor', upload(image, 'image/png', 'upload', { filename: 'other.png' }))).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      await expect(adoptDocumentTaskResult('editor', { ...adoption, idempotencyKey: 'upload' })).rejects.toMatchObject({ code: 'DOCUMENT_MEDIA_CONFLICT' });
      const result = results[0];
      await expect(executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'upload',
        command: { ...command, assetVersionId: result.assetVersionId } })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'remove', command: {
        action: 'remove', placementId: result.placementId, expectedAssetVersionId: result.assetVersionId,
      } });
      expect(await importDocumentUpload('editor', upload())).toEqual(result);
      expect((await query('SELECT status FROM wujie_workspace_placements')).rows[0].status).toBe('trashed');
      expect((await query('SELECT count(*)::int AS n FROM wujie_project_canvas_updates')).rows[0].n).toBe(2);
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      await expect(importDocumentUpload('editor', upload())).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    });
  }, 20_000);
  it.each(['failed', 'cancelled', 'result', 'version', 'revoke', 'disabled', 'archived', 'source-archived', 'feature'] as const)(
    'permits independent mutations during media IO then rejects %s', async (change): Promise<void> => {
      await withIsolatedPostgres('8b2b-source-race', async ({ query }): Promise<void> => {
        await seed(query); const baseline = await files(); const barrier = stagedBarrier();
        const pending = adoptDocumentTaskResult('editor', adoption).catch((error: unknown): unknown => error);
        await barrier.arrived;
        try {
          await query("SET lock_timeout='1000ms'");
          if (change === 'failed' || change === 'cancelled') await query('UPDATE cloud_tasks SET status=$1', [change]);
          if (change === 'result') await query(`UPDATE cloud_tasks SET result='{"imageUrl":"/api/serve-upload/images/other.png"}'`);
          if (change === 'version') await query(`UPDATE wujie_asset_versions SET metadata='{"changed":true}'`);
          if (change === 'revoke') await query("UPDATE wujie_project_document_editors SET status='revoked'");
          if (change === 'disabled') await query('UPDATE wujie_project_document_settings SET enabled=false');
          if (change === 'feature') vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
          if (change === 'archived' || change === 'source-archived') await query("UPDATE wujie_projects SET status='trashed' WHERE id=$1", [change === 'archived' ? 'target' : 'source']);
        } finally { barrier.release(); }
        expect(await pending).toBeInstanceOf(Error); expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(baseline);
      });
    });
  it.each(['wujie_assets', 'wujie_asset_versions', 'wujie_canvas_media_lineage', 'wujie_workspace_placements',
    'wujie_project_canvas_documents', 'wujie_project_canvas_updates', 'wujie_canvas_asset_commands', 'pg_notify'])(
    'rolls back all rows and only newly prepared media on %s failure', async (table): Promise<void> => {
      await withIsolatedPostgres('8b2b-fault', async ({ query }): Promise<void> => {
        await seed(query); const before = await files();
        const restore = interceptQueries(async (_client, sql, _values, next): Promise<QueryResult> => {
          if ((sql.includes('INSERT INTO ' + table)) || (table === 'pg_notify' && sql.includes('pg_notify'))) throw new Error('injected write failure');
          return next();
        });
        try { await expect(importDocumentUpload('editor', upload())).rejects.toThrow('injected write failure'); }
        finally { restore(); }
        expect(await counts(query)).toEqual(empty); expect(await files()).toEqual(before);
      });
    });
  it('keeps every new reference invisible to another connection until the single final COMMIT', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-visibility', async ({ query }): Promise<void> => {
      await seed(query); const reached = deferred(); const release = deferred(); const writers = new Set<PoolClient>();
      const restore = interceptQueries(async (client, sql, _values, next): Promise<QueryResult> => {
        if (sql.includes('INSERT INTO wujie_canvas_media_lineage')) writers.add(client);
        if (sql === 'COMMIT' && writers.has(client)) { reached.resolve(); await release.promise; }
        return next();
      });
      const pending = importDocumentUpload('editor', upload());
      try { await reached.promise; expect(await counts(query)).toEqual(empty); }
      finally { release.resolve(); }
      try { await pending; expect(await counts(query)).toEqual(single); } finally { restore(); }
    });
  });
  it('publishes the adopted graph placement and canonical document together', async (): Promise<void> => {
    await withIsolatedPostgres('8b2b-common', async ({ query }): Promise<void> => {
      await seed(query);
      await query(await readFile('migrations/20260927_yjs_canvas_media_imports.sql', 'utf8'));
      const baseline = (await query(`SELECT (SELECT jsonb_agg(t) FROM cloud_tasks t) AS tasks,
        (SELECT jsonb_agg(v) FROM wujie_asset_versions v) AS versions,
        (SELECT jsonb_agg(c) FROM wujie_credit_transactions c) AS ledger`)).rows[0];
      const result = await adoptDocumentTaskResult('editor', { projectId: 'target', taskId: 'task', outputIndex: 0,
        sourceVersionId: 'original-version', idempotencyKey: 'adopt', command: { action: 'attach',
          transform: { x: 0, y: 0, width: 2, height: 2, rotation: 0, zIndex: 0 } } });
      const graph = await query('SELECT asset_version_id FROM wujie_workspace_placements WHERE id=$1', [result.placementId]);
      expect(graph.rows[0].asset_version_id).toBe(result.assetVersionId);
      const document = await query('SELECT projection FROM wujie_project_canvas_documents WHERE project_id=$1', ['target']);
      expect(document.rows[0]?.projection.placements[result.placementId]?.assetVersionId).toBe(result.assetVersionId);
      expect((await query(`SELECT (SELECT jsonb_agg(t) FROM cloud_tasks t) AS tasks,
        (SELECT jsonb_agg(v) FROM wujie_asset_versions v WHERE id='original-version') AS versions,
        (SELECT jsonb_agg(c) FROM wujie_credit_transactions c) AS ledger`)).rows[0]).toEqual(baseline);
      expect(createHash('sha256').update(await readFile(path.join(mediaRoot, 'images/source.png'))).digest('hex'))
        .toBe(createHash('sha256').update(image).digest('hex'));
    });
  });
});

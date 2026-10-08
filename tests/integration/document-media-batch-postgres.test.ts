// Prepared for controller-authorized isolated PG execution only; NOT run by 1394.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Client } from 'pg';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { requireOfflineBridgeTestMediaRoot } from '../helpers/offline-bridge-media-guard';
import { importDocumentMediaBatch } from '../../src/lib/collaboration/document-media-batch';
import { getServerDataRoot } from '../../src/lib/server-data-root';
vi.mock('server-only', () => ({}));
let root: string, image: Buffer;
const previousRoot = process.env.WUJIE_DATA_DIR;
beforeAll(async () => {
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const admitted = requireOfflineBridgeTestMediaRoot(previousRoot);
  root = await mkdtemp(path.join(admitted, 'document-media-batch-'));
  process.env.WUJIE_DATA_DIR = root;
  expect(path.resolve(getServerDataRoot())).toBe(path.resolve(root));
  await mkdir(path.join(root, 'images'));
  image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  await writeFile(path.join(root, 'images', 'source.png'), image);
});
beforeEach(() => vi.stubEnv('WUJIE_YJS_ENABLED', 'true'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  if (root) {
    const relative = path.relative(path.resolve(previousRoot!), path.resolve(root));
    if (!relative.startsWith('document-media-batch-') || relative.includes(path.sep)) throw new Error('Unsafe owned cleanup path');
    await rm(root, { recursive: true, force: true });
  }
  if (previousRoot === undefined) delete process.env.WUJIE_DATA_DIR; else process.env.WUJIE_DATA_DIR = previousRoot;
});
async function seed(query: QueryFn): Promise<void> {
  for (const name of ['20260809_wj_core_users.sql','20260810_wj_stable_s2_assets.sql',
    '20260811_wj_stable_s2_asset_transfer_idempotency.sql','20260811_wj_stable_s2_cross_project_transfer.sql',
    '20260815_wj_cloud_tasks.sql','20260909_mpe_cross_asset_parents.sql','20260909_mpe_export_cleanup_outbox.sql',
    '20260910_mpe_export_cleanup_leases.sql','20260913_canvas_video_placements.sql','20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_documents.sql','20260925_yjs_canvas_asset_adoptions.sql','20260927_yjs_canvas_asset_commands.sql',
    '20261004_yjs_canvas_removal_snapshots.sql','20260927_asset_cleanup_local_identity.sql','20260927_yjs_canvas_media_imports.sql',
    '20260927_yjs_canvas_task_publications.sql','20260927_yjs_canvas_version_imports.sql','20261006_yjs_canvas_media_batch_receipts.sql']) {
    await query(await readFile(path.join('migrations', name), 'utf8'));
  }
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','fixture','active',1,1),('editor','Editor','fixture','active',1,1);
    INSERT INTO wujie_projects(id,owner_id,name) VALUES ('target','owner','Target'),('source','editor','Private');
    INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('target','owner',true);
    INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id,status) VALUES ('target','owner','editor','active');
    CREATE TABLE wujie_credit_transactions(id text PRIMARY KEY,user_id text,amount integer,task_id text);
    INSERT INTO wujie_credit_transactions VALUES ('original-charge','editor',-12,'task');`);
  await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,result,credit_status,credit_cost,charged_transaction_id,created_at,updated_at)
    VALUES ('task','editor','source','generate','completed',$1::jsonb,'charged',12,'original-charge',1,1)`,
    [JSON.stringify({ imageUrls: ['/api/serve-upload/images/source.png','/api/serve-upload/images/source.png'] })]);
  for (const [index, id] of ['private-a','private-b'].entries()) {
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ($1,'editor','source','image')", ['asset-' + id]);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,task_id,file_url,mime_type,byte_size,checksum,availability,width,height,metadata)
      VALUES ($1,$2,'editor','source',$3,'/api/serve-upload/images/source.png','image/png',$4,$5,'ready',2,2,$6::jsonb)`,
      [id,'asset-' + id,index === 1 ? 'task' : null,image.length,createHash('sha256').update(image).digest('hex'),
        JSON.stringify(index === 1 ? { source: 'task-projection', outputIndex: 1 } : {})]);
    await query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', ['asset-' + id,id]);
  }
}
const command = { action: 'attach' as const, transform: { x: 1, y: 2, width: 20, height: 10, rotation: 0, zIndex: 1 } };
const request = { projectId: 'target', idempotencyKey: 'integration-intent',
  items: ['private-a','private-b'].map(sourceVersionId => ({ sourceVersionId, command })) };
async function counts(query: QueryFn): Promise<unknown> {
  return (await query(`SELECT
    (SELECT count(*)::int FROM wujie_asset_versions WHERE project_id='target') versions,
    (SELECT count(*)::int FROM wujie_workspace_placements WHERE project_id='target') placements,
    (SELECT count(*)::int FROM wujie_canvas_asset_commands) commands,
    (SELECT count(*)::int FROM wujie_canvas_media_lineage) lineage,
    (SELECT count(*)::int FROM wujie_project_canvas_updates) updates`)).rows[0];
}
async function originals(query: QueryFn): Promise<unknown> {
  return (await query(`SELECT (SELECT jsonb_agg(v ORDER BY id) FROM wujie_asset_versions v WHERE project_id='source') versions,
    (SELECT jsonb_agg(t ORDER BY id) FROM cloud_tasks t) tasks,
    (SELECT jsonb_agg(c ORDER BY id) FROM wujie_credit_transactions c) credits`)).rows[0];
}
describe('1394 real PostgreSQL batch (prepared, not executed)', () => {
  it('20 simultaneous identical intentions commit one whole batch and preserve source pixels/task/ledger', async () => {
    await withIsolatedPostgres('media-batch-20', async ({ query }) => {
      await seed(query); const before = await originals(query);
      const receipts = await Promise.all(Array.from({ length: 20 }, () => importDocumentMediaBatch('editor', request)));
      expect(receipts.every(receipt => JSON.stringify(receipt) === JSON.stringify(receipts[0]))).toBe(true);
      expect(await counts(query)).toEqual({ versions: 2, placements: 2, commands: 3, lineage: 2, updates: 2 });
      expect(await originals(query)).toEqual(before);
      for (const item of receipts[0].items) {
        const row = (await query('SELECT checksum,width,height,file_url FROM wujie_asset_versions WHERE id=$1', [item.assetVersionId])).rows[0];
        expect(row).toMatchObject({ checksum: createHash('sha256').update(image).digest('hex'), width: 2, height: 2 });
        const bytes = await readFile(path.join(root, String(row.file_url).slice('/api/serve-upload/'.length)));
        expect(bytes).toEqual(image);
      }
    });
  }, 30_000);
  it('database rejection at item2 rolls back item1 and removes only owned attempt files', async () => {
    await withIsolatedPostgres('media-batch-rollback', async ({ query }) => {
      await seed(query); const before = await originals(query);
      await query(`CREATE FUNCTION fail_second_media() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.project_id='target' AND EXISTS(SELECT 1 FROM wujie_asset_versions WHERE project_id='target')
          THEN RAISE EXCEPTION 'second item fixture'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_second_media BEFORE INSERT ON wujie_asset_versions FOR EACH ROW EXECUTE FUNCTION fail_second_media();`);
      const beforeFiles = await readdir(path.join(root, 'exports')).catch(() => []);
      await expect(importDocumentMediaBatch('editor', request)).rejects.toThrow('second item fixture');
      expect(await counts(query)).toEqual({ versions: 0, placements: 0, commands: 0, lineage: 0, updates: 0 });
      expect(await originals(query)).toEqual(before);
      expect(await readdir(path.join(root, 'exports')).catch(() => [])).toEqual(beforeFiles);
    });
  }, 30_000);
  it('independent observer sees none before sole final COMMIT; lost reply recovers full authorized durable receipt', async () => {
    await withIsolatedPostgres('media-batch-commit', async ({ query, databaseUrl }) => {
      await seed(query);
      const observer = new Client({ connectionString: databaseUrl }); await observer.connect();
      const native = Client.prototype.query, rootPending = new WeakSet<Client>(); let finalIntercepted = false;
      let preCommitCounts: unknown;
      // Preserve native connect/query callback overloads; intercept only the final COMMIT reply.
      const querySpy = vi.spyOn(Client.prototype, 'query').mockImplementation((function (this: Client, ...args: unknown[]): unknown {
          const sql = args[0];
          if (typeof sql === 'string' && sql.includes('INSERT INTO wujie_canvas_asset_commands') && sql.includes('batch_manifest')) rootPending.add(this);
          if (sql === 'COMMIT' && rootPending.has(this) && !finalIntercepted) {
            finalIntercepted = true;
            return (async () => {
              preCommitCounts = await counts(observer.query.bind(observer));
              await Reflect.apply(native, this, args); throw new Error('lost COMMIT reply fixture');
            })();
          }
          return Reflect.apply(native, this, args);
      }) as Client['query']);
      try {
        const result = await importDocumentMediaBatch('editor', request);
        expect(preCommitCounts).toEqual({ versions: 0, placements: 0, commands: 0, lineage: 0, updates: 0 });
        expect(finalIntercepted).toBe(true); expect(result.items).toHaveLength(2);
        expect(await counts(observer.query.bind(observer))).toEqual({ versions: 2, placements: 2, commands: 3, lineage: 2, updates: 2 });
        expect(await importDocumentMediaBatch('editor', request)).toEqual(result);
      } finally { querySpy.mockRestore(); await observer.end(); }
    });
  }, 30_000);
});

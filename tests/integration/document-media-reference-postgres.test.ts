import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { POST as adoptPost } from '../../src/app/api/collaboration/document-assets/adopt/route';
import { getServerDataRoot } from '../../src/lib/server-data-root';
import { POST as uploadPost } from '../../src/app/api/collaboration/document-assets/upload/route';
import { POST as versionPost } from '../../src/app/api/collaboration/document-assets/import-version/route';
import { executeDocumentAssetCommand } from '../../src/lib/collaboration/document-asset-commands';
import { assetBinaryFileOps } from '../../src/lib/asset-core/binary-file-ops';
import * as managedMedia from '../../src/lib/asset-core/managed-media-read';
import { getPool } from '../../src/lib/db-client';
import type { PoolClient, QueryResult } from 'pg';

// Bind the unique media root before ANY product module (including the PG helper).
const roots = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const paths = await import('node:path');
  const os = await import('node:os');
  const database = process.env.POSTGRES_TEST_DATABASE_URL;
  if (!database || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)) {
    throw new Error('Explicit loopback POSTGRES_TEST_DATABASE_URL required');
  }
  const previous = process.env.WUJIE_DATA_DIR;
  const base = paths.resolve(previous ?? os.tmpdir());
  const root = fs.mkdtempSync(paths.join(base, 'document-media-reference-'));
  process.env.WUJIE_DATA_DIR = root;
  return { previous, base, root };
});
const auth = vi.hoisted(() => ({ user: { id: 'editor' } }));
vi.mock('server-only', () => ({}));
// Only the session boundary is substituted; the POST, storage and PG are real.
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<{ id: string }> => auth.user }));
let image: Buffer;
let video: Buffer;
beforeAll(async (): Promise<void> => {
  expect(path.resolve(getServerDataRoot())).toBe(roots.root);
  console.info('Task8Cb3c temporary media directory:', roots.root);
  image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  video = Buffer.from(await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8'), 'base64');
  await mkdir(path.join(roots.root, 'images'));
});
beforeEach(async (): Promise<void> => {
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  auth.user = { id: 'editor' };
  await writeFile(path.join(roots.root, 'images/source.png'), image);
  await writeFile(path.join(roots.root, 'images/source.mp4'), video);
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async (): Promise<void> => {
  const relative = path.relative(roots.base, path.resolve(roots.root));
  expect(relative.startsWith('document-media-reference-') && !relative.includes(path.sep)).toBe(true);
  try { await rm(roots.root, { recursive: true, force: true }); }
  finally {
    if (roots.previous === undefined) delete process.env.WUJIE_DATA_DIR;
    else process.env.WUJIE_DATA_DIR = roots.previous;
  }
});

async function seed(query: QueryFn, actor: string = 'editor'): Promise<void> {
  for (const name of ['20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
    '20260811_wj_stable_s2_asset_transfer_idempotency.sql', '20260811_wj_stable_s2_cross_project_transfer.sql',
    '20260815_wj_cloud_tasks.sql', '20260909_mpe_cross_asset_parents.sql', '20260909_mpe_export_cleanup_outbox.sql',
    '20260910_mpe_export_cleanup_leases.sql', '20260913_canvas_video_placements.sql', '20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_documents.sql', '20260925_yjs_canvas_asset_adoptions.sql', '20260927_yjs_canvas_asset_commands.sql', '20261004_yjs_canvas_removal_snapshots.sql',
    '20260927_asset_cleanup_local_identity.sql', '20260927_yjs_canvas_media_imports.sql',
    '20260927_yjs_canvas_task_publications.sql', '20260927_yjs_canvas_version_imports.sql']) {
    await query(await readFile(path.join('migrations', name), 'utf8'));
  }
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner','Owner','test','active',1,1),('editor','Editor','test','active',1,1)`);
  await query(`INSERT INTO wujie_projects (id,owner_id,name) VALUES ('target','owner','Target'),('source',$1,'Source')`, [actor]);
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled,authority_revision) VALUES ('target','owner',true,0)`);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id,status) VALUES ('target','owner','editor','active')`);
  await query(`INSERT INTO cloud_tasks (id,user_id,project_id,type,status,result,credit_status,credit_cost,charged_transaction_id,created_at,updated_at)
    VALUES ('task',$2,'source','image-generate','completed',$1::jsonb,'charged',12,'charge',1,1)`,
  [JSON.stringify({ imageUrl: '/api/serve-upload/images/source.png' }), actor]);
  await query('CREATE TABLE wujie_credit_transactions (id text PRIMARY KEY,user_id text,amount integer,task_id text)');
  await query("INSERT INTO wujie_credit_transactions VALUES ('charge',$1,-12,'task')", [actor]);
  await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('original',$1,'source','image')`, [actor]);
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,task_id,file_url,availability,mime_type,byte_size,checksum,width,height)
    VALUES ('original-version','original',$3,'source','task','/api/serve-upload/images/source.png','ready','image/png',$1,$2,2,2)`,
  [image.length, createHash('sha256').update(image).digest('hex'), actor]);
  await query(`UPDATE wujie_assets SET current_version_id='original-version' WHERE id='original'`);
}
const command = { action: 'attach' as const, transform: { x: 10, y: 20, width: 32, height: 24, rotation: 0, zIndex: 1 } };
const adoption = { projectId: 'target', taskId: 'task', outputIndex: 0, sourceVersionId: 'original-version', idempotencyKey: 'adopt', command };
function jsonRequest(input: unknown, endpoint: string = 'adopt'): NextRequest {
  return new NextRequest(`http://localhost/api/collaboration/document-assets/${endpoint}`, {
    method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
}
async function originals(query: QueryFn): Promise<unknown> {
  return (await query(`SELECT
    (SELECT jsonb_agg(t) FROM cloud_tasks t) tasks,
    (SELECT jsonb_agg(t) FROM wujie_credit_transactions t) credits,
    (SELECT to_jsonb(v) FROM wujie_asset_versions v WHERE id='original-version') version,
    (SELECT to_jsonb(a) FROM wujie_assets a WHERE id='original') asset`)).rows[0];
}
async function files(): Promise<string[]> {
  return readdir(path.join(roots.root, 'exports')).then(names => names.sort(), (): string[] => []);
}
type Source = 'upload' | 'task' | 'version';
type Kind = 'image' | 'video';
async function configureSource(query: QueryFn, source: Source, kind: Kind): Promise<void> {
  const bytes = kind === 'image' ? image : video;
  const url = `/api/serve-upload/images/source.${kind === 'image' ? 'png' : 'mp4'}`;
  await query("UPDATE wujie_assets SET kind=$1 WHERE id='original'", [kind]);
  await query(`UPDATE wujie_asset_versions SET task_id=$1,file_url=$2,mime_type=$3,byte_size=$4,checksum=$5
    WHERE id='original-version'`, [source === 'version' ? null : 'task', url,
    kind === 'image' ? 'image/png' : 'video/mp4', bytes.length, createHash('sha256').update(bytes).digest('hex')]);
  await query("UPDATE cloud_tasks SET type=$1,result=$2::jsonb WHERE id='task'",
    [`${kind}-generate`, JSON.stringify({ [kind === 'image' ? 'imageUrl' : 'videoUrl']: url })]);
}
function post(source: Source, kind: Kind = 'image', key: string = 'reference', extra: Record<string, unknown> = {}): Promise<Response> {
  if (source === 'task') return adoptPost(jsonRequest({ ...adoption, idempotencyKey: key, ...extra }));
  if (source === 'version') return versionPost(jsonRequest({ projectId: 'target', sourceVersionId: 'original-version',
    idempotencyKey: key, command, ...extra }, 'import-version'));
  return uploadPost(new NextRequest('http://localhost/api/collaboration/document-assets/upload', {
    method: 'POST', body: new Uint8Array(kind === 'image' ? image : video), headers: {
      origin: 'http://localhost', 'content-type': kind === 'image' ? 'image/png' : 'video/mp4',
      'x-wujie-asset-import': Buffer.from(JSON.stringify({ projectId: 'target', idempotencyKey: key,
        filename: kind === 'image' ? 'upload.png' : 'upload.mp4', command, ...extra })).toString('base64url'),
    },
  }));
}
async function canonical(query: QueryFn, key: string = 'reference'): Promise<Record<string, unknown>> {
  const row = (await query(`SELECT c.asset_id,c.asset_version_id,c.placement_id,p.entity_id,v.file_url,a.kind
    FROM wujie_canvas_asset_commands c JOIN wujie_asset_versions v ON v.id=c.asset_version_id
    JOIN wujie_assets a ON a.id=c.asset_id JOIN wujie_workspace_placements p ON p.id=c.placement_id
    WHERE c.idempotency_key=$1`, [key])).rows[0];
  expect(row.entity_id).not.toBe(row.placement_id);
  return { assetId: row.asset_id, assetVersionId: row.asset_version_id, placementId: row.placement_id,
    entityId: row.entity_id, url: row.file_url, kind: row.kind };
}
async function snapshot(query: QueryFn): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of ['wujie_assets', 'wujie_asset_versions', 'wujie_workspace_placements', 'wujie_canvas_asset_commands',
    'wujie_canvas_media_lineage', 'wujie_project_canvas_documents', 'wujie_project_canvas_updates']) {
    result[table] = (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
type QueryIntercept = (client: PoolClient, sql: string, next: () => Promise<QueryResult>) => Promise<QueryResult>;
function interceptQueries(intercept: QueryIntercept): () => void {
  const pool = getPool();
  const seen = new Set<PoolClient>();
  const restores: Array<() => void> = [];
  const acquire = (client: PoolClient): void => {
    if (seen.has(client)) return;
    seen.add(client);
    const query = client.query.bind(client);
    type Callback = (error: Error | null, result?: QueryResult) => void;
    const spy = vi.spyOn(client, 'query').mockImplementation(((sql: string, values?: unknown[] | Callback, callback?: Callback): Promise<QueryResult> | undefined => {
      const parameters = Array.isArray(values) ? values : undefined;
      const done = typeof values === 'function' ? values : callback;
      const pending = intercept(client, sql, () => query(sql, parameters));
      if (done) { void pending.then(result => done(null, result), (error: Error) => done(error)); return undefined; }
      return pending;
    }) as PoolClient['query']);
    restores.push((): void => spy.mockRestore());
  };
  pool.on('acquire', acquire);
  return (): void => { pool.off('acquire', acquire); restores.forEach(restore => restore()); };
}
function referenceSelect(sql: string): boolean {
  return sql.includes('FROM wujie_canvas_asset_commands c') && sql.includes('LEFT JOIN wujie_assets');
}
const brokenReferences: ReadonlyArray<readonly [string, string]> = [
  ['command owner', "UPDATE wujie_canvas_asset_commands SET owner_id='editor'"],
  ['command asset', "UPDATE wujie_canvas_asset_commands SET asset_id='original'"],
  ['command version', "UPDATE wujie_canvas_asset_commands SET asset_version_id='original-version'"],
  ['command placement', "UPDATE wujie_canvas_asset_commands SET placement_id='absent'"],
  ['empty command asset', "UPDATE wujie_canvas_asset_commands SET asset_id=''"],
  ['missing asset', "DELETE FROM wujie_assets WHERE project_id='target'"],
  ['asset owner', "UPDATE wujie_assets SET owner_id='editor' WHERE project_id='target'"],
  ['asset project', "UPDATE wujie_assets SET project_id='source' WHERE project_id='target'"],
  ['invalid kind', "UPDATE wujie_assets SET kind='audio' WHERE project_id='target'"],
  ['missing version', "DELETE FROM wujie_asset_versions WHERE project_id='target'"],
  ['version owner', "UPDATE wujie_asset_versions SET owner_id='editor' WHERE project_id='target'"],
  ['version project', "UPDATE wujie_asset_versions SET project_id='source' WHERE project_id='target'"],
  ['version asset splice', "UPDATE wujie_asset_versions SET asset_id='original' WHERE project_id='target'"],
  ['empty URL', "UPDATE wujie_asset_versions SET file_url='' WHERE project_id='target'"],
  ['blank URL', "UPDATE wujie_asset_versions SET file_url='  ' WHERE project_id='target'"],
  ['null URL', "ALTER TABLE wujie_asset_versions ALTER COLUMN file_url DROP NOT NULL; UPDATE wujie_asset_versions SET file_url=NULL WHERE project_id='target'"],
  ['missing placement', 'DELETE FROM wujie_workspace_placements'],
  ['placement owner', "UPDATE wujie_workspace_placements SET owner_id='editor'"],
  ['placement project', "UPDATE wujie_workspace_placements SET project_id='source'"],
  ['workspace kind', "UPDATE wujie_workspace_placements SET workspace_kind='workflow'"],
  ['workspace alias suffix', "UPDATE wujie_workspace_placements SET workspace_id='canvas:target:forged'"],
  ['workspace other project', "UPDATE wujie_workspace_placements SET workspace_id='source'"],
  ['entity type', "UPDATE wujie_workspace_placements SET entity_type='workflow-output'"],
  ['empty entity', "UPDATE wujie_workspace_placements SET entity_id=''"],
  ['blank entity', "UPDATE wujie_workspace_placements SET entity_id='  '"],
  ['null entity', 'ALTER TABLE wujie_workspace_placements ALTER COLUMN entity_id DROP NOT NULL; UPDATE wujie_workspace_placements SET entity_id=NULL'],
];

/** Corrupt only inside the product's authorized transaction in its test_ schema.
 * Its ROLLBACK restores both rows and constraints; independent snapshots prove it. */
async function corruptReference(client: PoolClient, mutation: string): Promise<void> {
  const schema = (await client.query<{ name: string }>('SELECT current_schema() AS name')).rows[0].name;
  if (!/^test_[a-z0-9_]+$/.test(schema)) throw new Error('Disposable test schema required');
  const constraints = (await client.query<{ table_name: string; name: string }>(`SELECT r.relname AS table_name,c.conname AS name
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    WHERE c.connamespace=current_schema()::regnamespace AND c.contype IN ('f','c')`)).rows;
  const quote = (value: string): string => '"' + value.replaceAll('"', '""') + '"';
  for (const row of constraints) await client.query(`ALTER TABLE ${quote(schema)}.${quote(row.table_name)} DROP CONSTRAINT ${quote(row.name)}`);
  await client.query(mutation);
}

describe('document media registered references', () => {
  // Break caught: a successful real command returns only its old three-field ACK.
  it('returns registered reference from real adoption POST', async (): Promise<void> => {
    await withIsolatedPostgres('8cb3c-reference', async ({ query, schemaName }): Promise<void> => {
      console.info('Task8Cb3c schema:', schemaName);
      await seed(query);
      const baseline = await originals(query);
      const before = await files();
      const response = await adoptPost(jsonRequest(adoption));
      const body = await response.json();
      const row = (await query(`SELECT c.asset_id,c.asset_version_id,c.placement_id,p.entity_id,v.file_url,v.task_id
        FROM wujie_canvas_asset_commands c JOIN wujie_asset_versions v ON v.id=c.asset_version_id
        JOIN wujie_workspace_placements p ON p.id=c.placement_id WHERE c.idempotency_key='adopt'`)).rows[0];
      expect(response.status).toBe(200);
      expect(await originals(query)).toEqual(baseline);
      expect(await readFile(path.join(roots.root, 'images/source.png'))).toEqual(image);
      expect((await files()).length - before.length).toBe(1);
      expect(row.task_id).toBeNull();
      expect(row.entity_id).not.toBe(row.placement_id);
      expect(body.assetReference).toEqual({ assetId: row.asset_id, assetVersionId: row.asset_version_id,
        placementId: row.placement_id, entityId: row.entity_id, url: row.file_url, kind: 'image' });
    });
  });

  // Wrong kind/owner, a missing POST field, or replay side effects fail this matrix.
  for (const source of ['upload', 'task', 'version'] as const) {
    for (const actor of ['owner', 'editor']) {
      it.each(['image', 'video'] as const)(`${source}/${actor} returns canonical %s and twenty identical committed ACKs`, async (kind): Promise<void> => {
        await withIsolatedPostgres('8cb3c-matrix', async ({ query }): Promise<void> => {
          await seed(query, actor); await configureSource(query, source, kind); auth.user.id = actor;
          const original = await originals(query); const beforeFiles = await files();
          const responses = await Promise.all(Array.from({ length: 20 }, () => post(source, kind)));
          const bodies = await Promise.all(responses.map(response => response.json()));
          for (const response of responses) {
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            expect(response.headers.get('vary')).toBe('Cookie');
          }
          for (const body of bodies) expect(body).toEqual(bodies[0]);
          expect(bodies[0].assetReference).toEqual(await canonical(query));
          expect(bodies[0].assetReference.kind).toBe(kind);
          expect((await files()).length - beforeFiles.length).toBe(1);
          const rows = await snapshot(query);
          for (const [table, records] of Object.entries(rows)) {
            expect(records).toHaveLength(table === 'wujie_assets' || table === 'wujie_asset_versions' ? 2 : 1);
          }
          expect((await query("SELECT task_id FROM wujie_asset_versions WHERE project_id='target'")).rows).toEqual([{ task_id: null }]);
          expect(await originals(query)).toEqual(original);
          for (const other of ['upload', 'task', 'version'] as const) {
            if (other !== source) expect((await post(other, kind)).status).toBe(409);
          }
          expect((await post(source, kind, 'reference', { command: { ...command, transform: { ...command.transform, x: 999 } } })).status).toBe(409);
          expect(await snapshot(query)).toEqual(rows);
          expect(await originals(query)).toEqual(original);
        });
      }, 30_000);
    }

    // Historical identity must not follow current placement version/type or resurrect deletion.
    it(`${source} replays historical image after video replacement and deletion without media IO`, async (): Promise<void> => {
      await withIsolatedPostgres('8cb3c-history', async ({ query }): Promise<void> => {
        await seed(query); await configureSource(query, source, 'image');
        const first = await (await post(source)).json();
        const replacement = await post('upload', 'video', 'replace', { command: { action: 'replace',
          placementId: first.placementId, expectedAssetVersionId: first.assetVersionId } });
        expect(replacement.status).toBe(200);
        const second = await replacement.json();
        expect(second.assetReference).toEqual(await canonical(query, 'replace'));
        expect(second.assetReference).toMatchObject({ kind: 'video', entityId: first.assetReference.entityId, placementId: first.placementId });
        expect(second.assetReference.assetId).not.toBe(first.assetReference.assetId);
        const original = await originals(query);
        await rm(path.join(roots.root, 'images/source.png'));
        for (const stage of ['replaced', 'deleted']) {
          if (stage === 'deleted') await executeDocumentAssetCommand({ actorId: 'editor', projectId: 'target', idempotencyKey: 'remove',
            command: { action: 'remove', placementId: first.placementId, expectedAssetVersionId: second.assetVersionId } });
          if (stage === 'deleted') {
            // A historical ACK also survives disappearance of its own result file.
            expect(first.assetReference.url).toMatch(/^\/api\/serve-upload\/exports\/[^/]+$/);
            await rm(path.join(roots.root, first.assetReference.url.replace('/api/serve-upload/', '')));
          }
          const rows = await snapshot(query); const beforeFiles = await files();
          const read = vi.spyOn(managedMedia, 'getManagedAssetMediaDescriptor');
          const write = vi.spyOn(assetBinaryFileOps, 'writeFile');
          const response = await post(source);
          expect(response.status).toBe(200); expect(await response.json()).toEqual(first);
          expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
          read.mockRestore(); write.mockRestore();
          expect(await snapshot(query)).toEqual(rows); expect(await originals(query)).toEqual(original);
          expect(await files()).toEqual(beforeFiles);
        }
      });
    });

    it.each(brokenReferences)(`${source} rejects broken %s without treating a committed command as a miss`, async (_name, sql): Promise<void> => {
      await withIsolatedPostgres('8cb3c-broken', async ({ query }): Promise<void> => {
        await seed(query); await configureSource(query, source, 'image');
        expect((await post(source)).status).toBe(200);
        const rows = await snapshot(query); const original = await originals(query); const beforeFiles = await files();
        const read = vi.spyOn(managedMedia, 'getManagedAssetMediaDescriptor');
        const write = vi.spyOn(assetBinaryFileOps, 'writeFile');
        let injected = false;
        const restore = interceptQueries(async (client, statement, next): Promise<QueryResult> => {
          if (!injected && referenceSelect(statement)) { injected = true; await corruptReference(client, sql); }
          return next();
        });
        let response: Response;
        try { response = await post(source); } finally { restore(); }
        expect(injected).toBe(true);
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_MEDIA_CONFLICT' });
        expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
        expect(await snapshot(query)).toEqual(rows); expect(await originals(query)).toEqual(original);
        expect(await files()).toEqual(beforeFiles);
      });
    });

    it(`${source} accepts the exact prefixed canvas alias on replay`, async (): Promise<void> => {
      await withIsolatedPostgres('8cb3c-alias', async ({ query }): Promise<void> => {
        await seed(query); await configureSource(query, source, 'image');
        const first = await (await post(source)).json();
        await query("UPDATE wujie_workspace_placements SET workspace_id='canvas:target'");
        const rows = await snapshot(query);
        const replay = await post(source); expect(replay.status).toBe(200);
        expect(await replay.json()).toEqual(first); expect(await snapshot(query)).toEqual(rows);
      });
    });

    // Real server query failure after all writes must roll back the entire graph and file.
    it(`${source} rolls back when the final reference SELECT fails before COMMIT`, async (): Promise<void> => {
      await withIsolatedPostgres('8cb3c-select-fault', async ({ query }): Promise<void> => {
        await seed(query); await configureSource(query, source, 'image');
        const rows = await snapshot(query); const original = await originals(query); const beforeFiles = await files();
        const writing = new Set<PoolClient>(); let injected = false;
        const restore = interceptQueries(async (client, sql, next): Promise<QueryResult> => {
          if (sql.includes('UPDATE wujie_canvas_asset_commands SET source_request_digest')) writing.add(client);
          if (writing.has(client) && referenceSelect(sql)) {
            injected = true;
            expect(await snapshot(query)).toEqual(rows); // separate connection: no early COMMIT
            await client.query('SELECT 1/0 /* private_reference_path_credential */');
          }
          return next();
        });
        let response: Response;
        try { response = await post(source); } finally { restore(); }
        expect(injected).toBe(true);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' });
        expect(await snapshot(query)).toEqual(rows); expect(await originals(query)).toEqual(original);
        expect(await files()).toEqual(beforeFiles);
      });
    });

    it(`${source} validates the complete reference before committing new writes`, async (): Promise<void> => {
      await withIsolatedPostgres('8cb3c-final-invalid', async ({ query }): Promise<void> => {
        await seed(query); await configureSource(query, source, 'image');
        const rows = await snapshot(query); const original = await originals(query); const beforeFiles = await files();
        const writing = new Set<PoolClient>(); let injected = false;
        const restore = interceptQueries(async (client, sql, next): Promise<QueryResult> => {
          if (sql.includes('UPDATE wujie_canvas_asset_commands SET source_request_digest')) writing.add(client);
          if (!injected && writing.has(client) && referenceSelect(sql)) {
            injected = true;
            await client.query("UPDATE wujie_workspace_placements SET entity_id=''");
          }
          return next();
        });
        let response: Response;
        try { response = await post(source); } finally { restore(); }
        expect(injected).toBe(true); expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_MEDIA_CONFLICT' });
        expect(await snapshot(query)).toEqual(rows); expect(await originals(query)).toEqual(original);
        expect(await files()).toEqual(beforeFiles);
      });
    });

    it.each(['recovered', 'query-failed', 'missing', 'revoked'] as const)(`${source} preserves committed media after ACK loss: %s`, async (mode): Promise<void> => {
      await withIsolatedPostgres('8cb3c-ack', async ({ query }): Promise<void> => {
        await seed(query); await configureSource(query, source, 'image');
        const original = await originals(query); const beforeFiles = await files();
        const writing = new Set<PoolClient>(); let lost = false; let recoveryFailed = false;
        const restore = interceptQueries(async (client, sql, next): Promise<QueryResult> => {
          if (sql.includes('UPDATE wujie_canvas_asset_commands SET source_request_digest')) writing.add(client);
          if (lost && referenceSelect(sql) && mode === 'query-failed') {
            recoveryFailed = true;
            await client.query('SELECT 1/0 /* private_recovery_path */');
          }
          if (sql === 'COMMIT' && writing.has(client) && !lost) {
            const result = await next(); // actual PostgreSQL COMMIT completed
            expect(result.command).toBe('COMMIT');
            lost = true;
            expect((await query('SELECT count(*)::int AS n FROM wujie_canvas_asset_commands')).rows[0].n).toBe(1);
            if (mode === 'missing') await query('DELETE FROM wujie_canvas_asset_commands');
            if (mode === 'revoked') await query("UPDATE wujie_project_document_editors SET status='revoked'");
            throw new Error('simulated lost commit acknowledgement');
          }
          return next();
        });
        let response: Response;
        try { response = await post(source); } finally { restore(); }
        expect(lost).toBe(true);
        expect(response.status).toBe(mode === 'recovered' ? 200 : 500);
        if (mode === 'recovered') expect((await response.json()).assetReference).toEqual(await canonical(query));
        else expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_INTERNAL_ERROR' });
        expect(recoveryFailed).toBe(mode === 'query-failed');
        expect((await files()).length - beforeFiles.length).toBe(1);
        const row = (await query("SELECT file_url FROM wujie_asset_versions WHERE project_id='target'")).rows[0];
        expect(await readFile(path.join(roots.root, row.file_url.replace('/api/serve-upload/', '')))).toEqual(image);
        expect(await originals(query)).toEqual(original);
        if (mode === 'query-failed') {
          const retry = await post(source); expect(retry.status).toBe(200);
          expect((await retry.json()).assetReference).toEqual(await canonical(query));
          expect((await files()).length - beforeFiles.length).toBe(1);
        }
      });
    });
  }

  it('validates the upload reference again after consuming the replay body', async (): Promise<void> => {
    await withIsolatedPostgres('8cb3c-upload-reread', async ({ query }): Promise<void> => {
      await seed(query);
      expect((await post('upload')).status).toBe(200);
      const rows = await snapshot(query); const beforeFiles = await files(); const original = await originals(query);
      let reads = 0;
      const restore = interceptQueries(async (client, sql, next): Promise<QueryResult> => {
        if (referenceSelect(sql) && ++reads === 3) await client.query("UPDATE wujie_workspace_placements SET entity_id=''");
        return next();
      });
      let response: Response;
      try { response = await post('upload'); } finally { restore(); }
      expect(reads).toBe(3); expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ success: false, code: 'DOCUMENT_MEDIA_CONFLICT' });
      expect(await snapshot(query)).toEqual(rows); expect(await files()).toEqual(beforeFiles);
      expect(await originals(query)).toEqual(original);
    });
  });

  it('does not upgrade a committed task reference after revoke and regrant', async (): Promise<void> => {
    await withIsolatedPostgres('8cb3c-regrant', async ({ query }): Promise<void> => {
      await seed(query);
      await query("UPDATE cloud_tasks SET project_id='target' WHERE id='task'");
      await query("INSERT INTO wujie_project_canvas_documents (project_id,owner_id) VALUES ('target','owner')");
      await query(`INSERT INTO wujie_canvas_task_publications (task_id,actor_id,owner_id,project_id,workspace_id,grant_generation)
        VALUES ('task','editor','owner','target','target',1)`);
      const extra = { sourceVersionId: undefined };
      const response = await post('task', 'image', 'reference', extra); expect(response.status).toBe(200);
      expect((await response.json()).assetReference).toEqual(await canonical(query));
      const original = await originals(query); const rows = await snapshot(query); const beforeFiles = await files();
      await query("UPDATE wujie_project_document_editors SET status='revoked',grant_generation=2");
      expect((await post('task', 'image', 'reference', extra)).status).toBe(403);
      await query("UPDATE wujie_project_document_editors SET status='active',grant_generation=3");
      expect((await post('task', 'image', 'reference', extra)).status).toBe(403);
      expect(await originals(query)).toEqual(original); expect(await snapshot(query)).toEqual(rows);
      expect(await files()).toEqual(beforeFiles);
    });
  });
});

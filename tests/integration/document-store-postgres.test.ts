import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { QueryFn } from '../helpers/postgres-test-database';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '../../src/lib/collaboration/canvas-document';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
const previousDataRoot = process.env.WUJIE_DATA_DIR;
let mediaRoot = '';
let imageSize = 0;

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-yjs-document-store-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  await mkdir(path.join(mediaRoot, 'images'));
  const image = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#d4af37' },
  }).png().toBuffer();
  imageSize = image.length;
  await writeFile(path.join(mediaRoot, 'images', 'one.png'), image);
  await writeFile(path.join(mediaRoot, 'images', 'two.png'), image);
});

afterAll(async () => {
  if (previousDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = previousDataRoot;
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

async function seedDatabase(query: QueryFn): Promise<void> {
  for (const migration of [
    '20260809_wj_core_users.sql',
    '20260810_wj_stable_s2_assets.sql',
    '20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_documents.sql',
  ]) {
    const sql = await readFile(path.join('migrations', migration), 'utf8');
    await query(sql);
    if (migration === '20260925_yjs_canvas_documents.sql') await query(sql);
  }
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('editor-a', 'Editor A', 'test', 'active', 1, 1)
  `);
  await query("INSERT INTO wujie_projects (id, owner_id, name) VALUES ('project-a', 'owner-a', 'A')");
  await query(`
    INSERT INTO wujie_project_document_editors
      (project_id, owner_id, member_user_id, status)
    VALUES ('project-a', 'owner-a', 'editor-a', 'active')
  `);
  await query(`
    INSERT INTO wujie_assets (id, owner_id, project_id, kind)
    VALUES ('asset-one', 'owner-a', 'project-a', 'image'),
           ('asset-two', 'owner-a', 'project-a', 'image')
  `);
  await query(`
    INSERT INTO wujie_asset_versions
      (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
    VALUES ('version-one', 'asset-one', 'owner-a', 'project-a',
            '/api/serve-upload/images/one.png', 'ready', 'image/png', $1),
           ('version-two', 'asset-two', 'owner-a', 'project-a',
            '/api/serve-upload/images/two.png', 'ready', 'image/png', $1)
  `, [imageSize]);
}

function placementUpdate(placementId: string, versionId: string): Uint8Array {
  const doc = createCanvasDocument();
  applyCanvasImagePatch(doc, {
    placementId,
    assetVersionId: versionId,
    x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
  }, 'local');
  return Y.encodeStateAsUpdate(doc);
}

async function runStoreInSeparateProcess(
  databaseUrl: string,
  action: 'commit' | 'load',
  bytes?: Uint8Array,
): Promise<{ sequence: number; placements?: Record<string, unknown> }> {
  const source = `
    const storeModule = await import('./src/lib/collaboration/document-store.ts');
    const canvasModule = await import('./src/lib/collaboration/canvas-document.ts');
    const dbModule = await import('./src/lib/db-client.ts');
    const store = storeModule.default ?? storeModule;
    const canvas = canvasModule.default ?? canvasModule;
    const db = dbModule.default ?? dbModule;
    try {
      const result = process.env.DOCUMENT_TEST_ACTION === 'commit'
        ? await store.commitDocumentUpdate({
            actorId: 'owner-a', projectId: 'project-a',
            bytes: Buffer.from(process.env.DOCUMENT_TEST_BYTES, 'base64'),
          })
        : await store.loadDocument('project-a');
      process.stdout.write('DOCUMENT_RESULT:' + JSON.stringify({
        sequence: result.sequence,
        ...(result.doc ? { placements: canvas.readCanvasDocument(result.doc).placements } : {}),
      }) + '\\n');
    } finally {
      await db.closePool();
    }
  `;
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', source,
    ], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PGDATABASE_URL: databaseUrl,
        DOCUMENT_TEST_ACTION: action,
        DOCUMENT_TEST_BYTES: bytes ? Buffer.from(bytes).toString('base64') : '',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Document child process exited ${code}: ${stderr}`));
        return;
      }
      const result = stdout.split(/\r?\n/).find(line => line.startsWith('DOCUMENT_RESULT:'));
      if (!result) {
        reject(new Error(`Document child process returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(result.slice('DOCUMENT_RESULT:'.length)));
    });
  });
}

describe('Yjs document store on isolated PostgreSQL', () => {
  postgresIt('rejects an old connection generation after revoke and regrant', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-stale-grant', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate } = await import('../../src/lib/collaboration/document-store');
      const { grantDocumentEditor, revokeDocumentEditor, DocumentAccessError } =
        await import('../../src/lib/collaboration/document-access');
      const bytes = placementUpdate('placement-one', 'version-one');
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      await expect(commitDocumentUpdate({
        actorId: 'editor-a', projectId: 'project-a', bytes,
        expectedGrantGeneration: '1',
      })).rejects.toBeInstanceOf(DocumentAccessError);
      expect((await query("SELECT 1 FROM wujie_project_canvas_documents WHERE project_id = 'project-a'")).rowCount)
        .toBe(0);
      await expect(commitDocumentUpdate({
        actorId: 'editor-a', projectId: 'project-a', bytes,
        expectedGrantGeneration: '3',
      })).resolves.toMatchObject({ sequence: 1 });
    });
  });

  postgresIt('acknowledges only durable canonical state, and duplicate updates do not advance sequence', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-durable', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument, readDocumentUpdatesAfter } =
        await import('../../src/lib/collaboration/document-store');
      const bytes = placementUpdate('placement-one', 'version-one');
      const first = await commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes });
      expect(first.sequence).toBe(1);
      expect(first.update).toBeInstanceOf(Uint8Array);
      const loaded = await loadDocument('project-a');
      expect(loaded.sequence).toBe(1);
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].assetVersionId).toBe('version-one');
      expect((await readDocumentUpdatesAfter('project-a', 0)).map(row => row.sequence)).toEqual([1]);

      const duplicate = await commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes });
      expect(duplicate.sequence).toBe(1);
      expect((await readDocumentUpdatesAfter('project-a', 1))).toEqual([]);
      const projection = await query<{ projection: { placements: Record<string, unknown> } }>(
        "SELECT projection FROM wujie_project_canvas_documents WHERE project_id = 'project-a'",
      );
      expect(Object.keys(projection.rows[0].projection.placements)).toEqual(['placement-one']);
      const { closePool } = await import('../../src/lib/db-client');
      await closePool();
      expect((await loadDocument('project-a')).sequence).toBe(1);
    });
  });

  postgresIt('merges independent clients and catches up after a lost notification', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-replay', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument, readDocumentUpdatesAfter, compactDocument } =
        await import('../../src/lib/collaboration/document-store');
      const first = placementUpdate('placement-one', 'version-one');
      const second = placementUpdate('placement-two', 'version-two');
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: second });
      await commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes: first });
      const before = await loadDocument('project-a');
      expect(Object.keys(readCanvasDocument(before.doc).placements).sort()).toEqual([
        'placement-one', 'placement-two',
      ]);
      const stateVector = Buffer.from(Y.encodeStateVector(before.doc));
      await compactDocument('project-a');
      const after = await loadDocument('project-a');
      expect(Buffer.from(Y.encodeStateVector(after.doc))).toEqual(stateVector);
      const catchup = await readDocumentUpdatesAfter('project-a', 0);
      const stale = createCanvasDocument();
      for (const item of catchup) Y.applyUpdate(stale, item.update);
      expect(readCanvasDocument(stale)).toEqual(readCanvasDocument(after.doc));
    });
  });

  postgresIt('rejects invalid and historical transient bytes without persisting a log or projection', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-rejection', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument, compactDocument } =
        await import('../../src/lib/collaboration/document-store');
      const badRoot = new Y.Doc();
      badRoot.getMap('extra').set('secret', 'value');
      const invalidProjection = new Y.Doc();
      invalidProjection.getMap('assetVersions').set('placement-one', 'version-one');
      invalidProjection.getMap('transforms').set('placement-one', {
        x: Infinity, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
      });
      const hiddenHistory = new Y.Doc();
      applyCanvasImagePatch(hiddenHistory, {
        placementId: 'placement-one', assetVersionId: 'version-one',
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
      }, 'local');
      hiddenHistory.getMap('annotations').set('placement-one', 'data:image/png;base64,SECRET');
      hiddenHistory.getMap('annotations').set('placement-one', 'safe');
      const failures = [
        Y.encodeStateAsUpdate(badRoot),
        Y.encodeStateAsUpdate(invalidProjection),
        placementUpdate('placement-one', 'version-outside'),
        new Uint8Array(1_048_577),
      ];
      for (const bytes of failures) {
        await expect(commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes }))
          .rejects.toThrow();
      }
      try {
        await commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(hiddenHistory),
        });
      } catch {
        // Rejecting the entire update is permitted when history cannot be cleaned.
      }
      const log = await query<{ update_bytes: Buffer }>(
        'SELECT update_bytes FROM wujie_project_canvas_updates WHERE project_id = $1', ['project-a'],
      );
      for (const row of log.rows) {
        expect(row.update_bytes.toString('utf8')).not.toContain('data:image/png;base64,SECRET');
      }
      const loaded = await loadDocument('project-a');
      const placements = readCanvasDocument(loaded.doc).placements;
      expect(Object.keys(placements).every(id => id === 'placement-one')).toBe(true);
      if (placements['placement-one']) expect(placements['placement-one'].annotation).toBe('safe');
      const storedProjection = await query<{ projection: unknown }>(
        "SELECT projection FROM wujie_project_canvas_documents WHERE project_id = 'project-a'",
      );
      for (const row of storedProjection.rows) {
        expect(JSON.stringify(row.projection)).not.toContain('data:image/png;base64,SECRET');
      }
      await compactDocument('project-a');
      const snapshots = await query<{ snapshot_bytes: Buffer }>(
        "SELECT snapshot_bytes FROM wujie_project_canvas_documents WHERE project_id = 'project-a'",
      );
      for (const row of snapshots.rows) {
        expect(row.snapshot_bytes.toString('utf8')).not.toContain('data:image/png;base64,SECRET');
      }
    });
  });

  postgresIt('serializes concurrent duplicate submissions and rejects revoked editors', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-concurrent', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, readDocumentUpdatesAfter } =
        await import('../../src/lib/collaboration/document-store');
      const bytes = placementUpdate('placement-one', 'version-one');
      const results = await Promise.all(Array.from({ length: 5 }, () =>
        commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes })));
      expect(results.map(result => result.sequence)).toEqual([1, 1, 1, 1, 1]);
      expect((await readDocumentUpdatesAfter('project-a', 0))).toHaveLength(1);
      await query(`UPDATE wujie_project_document_editors SET status = 'revoked'
        WHERE project_id = 'project-a' AND member_user_id = 'editor-a'`);
      const other = placementUpdate('placement-two', 'version-two');
      await expect(commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes: other }))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      expect((await readDocumentUpdatesAfter('project-a', 0))).toHaveLength(1);
    });
  });

  postgresIt('does not allow raw updates to remove a tombstone or placement', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-tombstone', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument, readDocumentUpdatesAfter } =
        await import('../../src/lib/collaboration/document-store');
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a',
        bytes: placementUpdate('placement-one', 'version-one'),
      });
      const deletion = (await loadDocument('project-a')).doc;
      applyCanvasImagePatch(deletion, { placementId: 'placement-one', deleted: true }, 'local');
      const committed = await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(deletion),
      });
      expect(committed.sequence).toBe(2);
      const attacker = (await loadDocument('project-a')).doc;
      attacker.getMap('tombstones').delete('placement-one');
      await expect(commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(attacker),
      })).rejects.toThrow();
      const replayedTombstone = (await loadDocument('project-a')).doc;
      replayedTombstone.transact(() => {
        replayedTombstone.getMap('tombstones').delete('placement-one');
        replayedTombstone.getMap('tombstones').set('placement-one', true);
      });
      await expect(commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a',
        bytes: Y.encodeStateAsUpdate(replayedTombstone),
      })).rejects.toThrow();
      const another = (await loadDocument('project-a')).doc;
      another.getMap('assetVersions').delete('placement-one');
      await expect(commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(another),
      })).rejects.toThrow();
      const replayedVersion = (await loadDocument('project-a')).doc;
      replayedVersion.transact(() => {
        replayedVersion.getMap('assetVersions').delete('placement-one');
        replayedVersion.getMap('assetVersions').set('placement-one', 'version-one');
      });
      await expect(commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(replayedVersion),
      })).rejects.toThrow();
      const loaded = await loadDocument('project-a');
      expect(loaded.sequence).toBe(2);
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].deleted).toBe(true);
      expect((await readDocumentUpdatesAfter('project-a', 0))).toHaveLength(2);
      const persisted = await query<{ sequence: string }>(
        "SELECT sequence FROM wujie_project_canvas_documents WHERE project_id = 'project-a'",
      );
      expect(Number(persisted.rows[0].sequence)).toBe(2);
    });
  });

  postgresIt('automatically bounds the durable recovery log while old clients can still catch up', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-auto-compact', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument, readDocumentUpdatesAfter } =
        await import('../../src/lib/collaboration/document-store');
      const source = createCanvasDocument();
      applyCanvasImagePatch(source, {
        placementId: 'placement-one', assetVersionId: 'version-one',
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
      }, 'local');
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(source),
      });
      for (let index = 0; index < 33; index += 1) {
        applyCanvasImagePatch(source, {
          placementId: 'placement-one', annotation: `note-${index}`,
        }, 'local');
        await commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(source),
        });
      }
      const count = await query<{ total: string }>(
        "SELECT count(*)::text AS total FROM wujie_project_canvas_updates WHERE project_id = 'project-a'",
      );
      expect(Number(count.rows[0].total)).toBeLessThanOrEqual(32);
      const loaded = await loadDocument('project-a');
      expect(loaded.sequence).toBe(34);
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].annotation).toBe('note-32');
      const stale = createCanvasDocument();
      for (const update of await readDocumentUpdatesAfter('project-a', 0)) {
        Y.applyUpdate(stale, update.update);
      }
      expect(readCanvasDocument(stale)).toEqual(readCanvasDocument(loaded.doc));
    });
  });

  postgresIt('does not revalidate historical media of tombstoned placements on unrelated edits', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-tombstoned-media', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument } =
        await import('../../src/lib/collaboration/document-store');
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a',
        bytes: placementUpdate('placement-one', 'version-one'),
      });
      const clientDoc = (await loadDocument('project-a')).doc;
      applyCanvasImagePatch(clientDoc, { placementId: 'placement-one', deleted: true }, 'local');
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(clientDoc),
      });
      await query("UPDATE wujie_asset_versions SET availability = 'missing' WHERE id = 'version-one'");
      applyCanvasImagePatch(clientDoc, {
        placementId: 'placement-two', assetVersionId: 'version-two',
        x: 30, y: 40, width: 80, height: 60, rotation: 0, zIndex: 2,
      }, 'local');
      const ack = await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(clientDoc),
      });
      expect(ack.sequence).toBe(3);
      const loaded = await loadDocument('project-a');
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].deleted).toBe(true);
      expect(readCanvasDocument(loaded.doc).placements['placement-two'].assetVersionId).toBe('version-two');
    });
  });

  postgresIt('stores a verified incremental edit instead of another full document copy', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-incremental-log', async ({ query }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, loadDocument } =
        await import('../../src/lib/collaboration/document-store');
      const source = createCanvasDocument();
      applyCanvasImagePatch(source, {
        placementId: 'placement-one', assetVersionId: 'version-one',
        x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
        annotation: 'A'.repeat(800),
      }, 'local');
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(source),
      });
      applyCanvasImagePatch(source, { placementId: 'placement-one', x: 11 }, 'local');
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(source),
      });
      const stored = await query<{ sequence: string; size: number }>(
        `SELECT sequence, octet_length(update_bytes) AS size
           FROM wujie_project_canvas_updates WHERE project_id = 'project-a' ORDER BY sequence`,
      );
      expect(stored.rows).toHaveLength(2);
      expect(stored.rows[1].size).toBeLessThan(stored.rows[0].size);
      const loaded = await loadDocument('project-a');
      expect(loaded.sequence).toBe(2);
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].x).toBe(11);
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].annotation).toBe('A'.repeat(800));
    });
  });

  postgresIt('emits only project and sequence after commit, then replays a missed notification', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-notification', async ({ query, databaseUrl }) => {
      await seedDatabase(query);
      const { commitDocumentUpdate, readDocumentUpdatesAfter, loadDocument } =
        await import('../../src/lib/collaboration/document-store');
      const listener = new Client({ connectionString: databaseUrl });
      await listener.connect();
      try {
        await listener.query('LISTEN wujie_canvas_document_changed');
        const notified = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('document notification timed out')), 5_000);
          listener.once('notification', message => {
            clearTimeout(timeout);
            resolve(message.payload || '');
          });
        });
        await commitDocumentUpdate({
          actorId: 'owner-a', projectId: 'project-a',
          bytes: placementUpdate('placement-one', 'version-one'),
        });
        expect(JSON.parse(await notified)).toEqual({ projectId: 'project-a', sequence: 1 });
      } finally {
        await listener.end();
      }
      await commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a',
        bytes: placementUpdate('placement-two', 'version-two'),
      });
      const updates = await readDocumentUpdatesAfter('project-a', 1);
      expect(updates.map(update => update.sequence)).toEqual([2]);
      const stale = createCanvasDocument();
      Y.applyUpdate(stale, (await readDocumentUpdatesAfter('project-a', 0))[0].update);
      for (const update of updates) Y.applyUpdate(stale, update.update);
      expect(readCanvasDocument(stale)).toEqual(readCanvasDocument((await loadDocument('project-a')).doc));
    });
  });

  postgresIt('rolls back projection and sequence when appending the update fails', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-rollback', async ({ query }) => {
      await seedDatabase(query);
      await query(`
        CREATE FUNCTION reject_canvas_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected update failure'; END $$
      `);
      await query(`
        CREATE TRIGGER reject_canvas_update_before_insert
        BEFORE INSERT ON wujie_project_canvas_updates
        FOR EACH ROW EXECUTE FUNCTION reject_canvas_update()
      `);
      const { commitDocumentUpdate, loadDocument } =
        await import('../../src/lib/collaboration/document-store');
      await expect(commitDocumentUpdate({
        actorId: 'owner-a', projectId: 'project-a',
        bytes: placementUpdate('placement-one', 'version-one'),
      })).rejects.toThrow('injected update failure');
      const documents = await query<{ total: string }>(
        "SELECT count(*)::text AS total FROM wujie_project_canvas_documents WHERE project_id = 'project-a'",
      );
      expect(documents.rows[0].total).toBe('0');
      expect((await loadDocument('project-a')).sequence).toBe(0);
    });
  });

  postgresIt('converges two independent Node processes and reloads from a third process', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-store-multi-process', async ({ query, databaseUrl }) => {
      await seedDatabase(query);
      const acknowledgements = await Promise.all([
        runStoreInSeparateProcess(databaseUrl, 'commit', placementUpdate('placement-two', 'version-two')),
        runStoreInSeparateProcess(databaseUrl, 'commit', placementUpdate('placement-one', 'version-one')),
      ]);
      expect(acknowledgements.map(result => result.sequence).sort()).toEqual([1, 2]);
      const restarted = await runStoreInSeparateProcess(databaseUrl, 'load');
      expect(restarted.sequence).toBe(2);
      expect(Object.keys(restarted.placements || {}).sort()).toEqual([
        'placement-one', 'placement-two',
      ]);
    });
  }, 45_000);
});

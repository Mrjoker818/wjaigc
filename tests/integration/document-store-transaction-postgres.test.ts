import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client, Pool, type Notification, type PoolClient } from 'pg';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '../../src/lib/collaboration/canvas-document';
import { commitDocumentUpdate, commitDocumentUpdateInTransaction, loadDocumentInTransaction } from '../../src/lib/collaboration/document-store';
import * as database from '../../src/lib/db-client';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
const previousDataRoot = process.env.WUJIE_DATA_DIR;
let mediaRoot = '';
let imageSize = 0;

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-yjs-transaction-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  await mkdir(path.join(mediaRoot, 'images'));
  const image = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#d4af37' },
  }).png().toBuffer();
  imageSize = image.length;
  await writeFile(path.join(mediaRoot, 'images', 'one.png'), image);
});

afterAll(async () => {
  if (previousDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = previousDataRoot;
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

beforeEach(() => vi.stubEnv('WUJIE_YJS_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

async function seedDatabase(query: QueryFn): Promise<void> {
  for (const migration of [
    '20260809_wj_core_users.sql',
    '20260810_wj_stable_s2_assets.sql',
    '20260913_canvas_video_placements.sql',
    '20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_documents.sql',
  ]) {
    await query(await readFile(path.join('migrations', migration), 'utf8'));
  }
  await query(`INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('editor-a', 'Editor A', 'test', 'active', 1, 1),
           ('stranger', 'Stranger', 'test', 'active', 1, 1)`);
  await query(`INSERT INTO wujie_projects (id, owner_id, name)
    VALUES ('project-a', 'owner-a', 'A'), ('project-b', 'owner-a', 'B')`);
  await query(`INSERT INTO wujie_project_document_settings
    (project_id, owner_id, enabled, authority_revision)
    VALUES ('project-a', 'owner-a', true, 0)`);
  await query(`INSERT INTO wujie_project_document_editors
    (project_id, owner_id, member_user_id, status)
    VALUES ('project-a', 'owner-a', 'editor-a', 'active')`);
}

async function insertMedia(query: QueryFn, suffix = 'one', projectId = 'project-a'): Promise<void> {
  await query(`INSERT INTO wujie_assets (id, owner_id, project_id, kind)
    VALUES ($1, 'owner-a', $2, 'image')`, [`asset-${suffix}`, projectId]);
  await query(`INSERT INTO wujie_asset_versions
    (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
    VALUES ($1, $2, 'owner-a', $3, '/api/serve-upload/images/one.png', 'ready', 'image/png', $4)`,
  [`version-${suffix}`, `asset-${suffix}`, projectId, imageSize]);
  await query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1',
    [`asset-${suffix}`, `version-${suffix}`]);
  await query(`INSERT INTO wujie_workspace_placements
    (id, owner_id, project_id, asset_id, asset_version_id,
     workspace_kind, workspace_id, entity_type, entity_id)
    VALUES ($1, 'owner-a', $2, $3, $4, 'canvas', $2, 'canvas-image', $1)`,
  [`placement-${suffix}`, projectId, `asset-${suffix}`, `version-${suffix}`]);
}

function placementUpdate(suffix = 'one'): Uint8Array {
  const doc = createCanvasDocument();
  applyCanvasImagePatch(doc, {
    placementId: `placement-${suffix}`, assetVersionId: `version-${suffix}`,
    x: 10, y: 20, width: 80, height: 60, rotation: 0, zIndex: 1,
  }, 'local');
  return Y.encodeStateAsUpdate(doc);
}

interface TransactionFixture {
  client: PoolClient;
  callerQuery: QueryFn;
  observerQuery: QueryFn;
  databaseUrl: string;
}

async function withTransactionFixture(
  name: string,
  run: (fixture: TransactionFixture) => Promise<void>,
): Promise<void> {
  await withIsolatedPostgres(name, async ({ query, databaseUrl }) => {
    await seedDatabase(query);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await run({ client, callerQuery: (sql, values) => client.query(sql, values),
        observerQuery: query, databaseUrl });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
}

interface StoredCounts {
  assets: number;
  versions: number;
  placements: number;
  documents: number;
  updates: number;
}

async function storedCounts(query: QueryFn): Promise<StoredCounts> {
  const result = await query<StoredCounts>(`SELECT
    (SELECT count(*)::int FROM wujie_assets WHERE project_id = 'project-a') AS assets,
    (SELECT count(*)::int FROM wujie_asset_versions WHERE project_id = 'project-a') AS versions,
    (SELECT count(*)::int FROM wujie_workspace_placements WHERE project_id = 'project-a') AS placements,
    (SELECT count(*)::int FROM wujie_project_canvas_documents WHERE project_id = 'project-a') AS documents,
    (SELECT count(*)::int FROM wujie_project_canvas_updates WHERE project_id = 'project-a') AS updates`);
  return result.rows[0];
}

const emptyCounts: StoredCounts = { assets: 0, versions: 0, placements: 0, documents: 0, updates: 0 };
const committedCounts: StoredCounts = { assets: 1, versions: 1, placements: 1, documents: 1, updates: 1 };

/** A committed sentinel on the same LISTEN session drains earlier notifications.
 * The timeout diagnoses a missing barrier; elapsed time is never evidence of absence. */
async function notificationBarrier(listener: Client, query: QueryFn): Promise<void> {
  const token = randomUUID();
  let receive: (message: Notification) => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arrived = new Promise<void>((resolve, reject) => {
    receive = (message: Notification): void => {
      if (message.channel === 'task8a_notification_barrier' && message.payload === token) resolve();
    };
    listener.on('notification', receive);
    timer = setTimeout(() => reject(new Error('PostgreSQL notification barrier not received')), 2_000);
  });
  try {
    await Promise.all([
      arrived,
      query("SELECT pg_notify('task8a_notification_barrier', $1)", [token]),
    ]);
    await listener.query('SELECT 1');
  } finally {
    clearTimeout(timer);
    listener.off('notification', receive);
  }
}

describe('document writes composed in caller PostgreSQL transactions', () => {
  postgresIt('keeps document and log invisible until the outer transaction commits', async () => {
    await withTransactionFixture('document-tx-visible', async ({ client, callerQuery, observerQuery }) => {
      await insertMedia(observerQuery);
      await client.query('BEGIN');
      await insertMedia(callerQuery, 'other', 'project-b');
      const pending = await commitDocumentUpdateInTransaction(client, {
        actorId: 'editor-a', projectId: 'project-a', bytes: placementUpdate(),
      });
      expect(pending.sequence).toBe(1);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_documents')).rowCount).toBe(0);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_updates')).rowCount).toBe(0);
      await client.query('COMMIT');
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_documents')).rowCount).toBe(1);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_updates')).rowCount).toBe(1);
    });
  });

  postgresIt('rolls document and log back when the outer command fails after the write', async () => {
    await withTransactionFixture('document-tx-rollback', async ({ client, callerQuery, observerQuery }) => {
      await insertMedia(observerQuery);
      await client.query('BEGIN');
      try {
        await insertMedia(callerQuery, 'other', 'project-b');
        await commitDocumentUpdateInTransaction(client, {
          actorId: 'editor-a', projectId: 'project-a', bytes: placementUpdate(),
        });
        throw new Error('injected upper command failure');
      } catch (error) {
        expect(error).toMatchObject({ message: 'injected upper command failure' });
        await client.query('ROLLBACK');
      }
      expect((await observerQuery("SELECT * FROM wujie_assets WHERE id = 'asset-other'")).rowCount).toBe(0);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_documents')).rowCount).toBe(0);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_updates')).rowCount).toBe(0);
    });
  });

  postgresIt('references uncommitted media and publishes all rows only on the caller COMMIT', async () => {
    await withTransactionFixture('document-tx-media', async ({ client, callerQuery, observerQuery }) => {
      await client.query('BEGIN');
      await client.query('SAVEPOINT caller_owned');
      await insertMedia(callerQuery);
      const transaction = await client.query<{ xid: string }>('SELECT txid_current()::text AS xid');
      const poolAccess = vi.spyOn(database, 'getPool');
      const release = vi.spyOn(client, 'release');
      const queries = vi.spyOn(client, 'query');
      try {
        const pending = await commitDocumentUpdateInTransaction(client, {
          actorId: 'editor-a', projectId: 'project-a', bytes: placementUpdate(), expectedGrantGeneration: '1',
        });
        expect(pending.sequence).toBe(1);
        expect(poolAccess).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
        expect(queries.mock.calls.some(([sql]) => typeof sql === 'string' &&
          /^\s*(BEGIN|COMMIT|ROLLBACK|END)\b/i.test(sql))).toBe(false);
        const replay = createCanvasDocument();
        Y.applyUpdate(replay, pending.update);
        expect(readCanvasDocument(replay).placements['placement-one']).toMatchObject({
          assetVersionId: 'version-one', x: 10, y: 20,
        });
      } finally {
        queries.mockRestore();
        release.mockRestore();
        poolAccess.mockRestore();
      }
      expect((await client.query('SELECT txid_current()::text AS xid')).rows).toEqual(transaction.rows);
      await client.query('RELEASE SAVEPOINT caller_owned');
      expect(await storedCounts(callerQuery)).toEqual(committedCounts);
      expect(await storedCounts(observerQuery)).toEqual(emptyCounts);
      await client.query('COMMIT');
      expect(await storedCounts(observerQuery)).toEqual(committedCounts);
      const loaded = await loadDocumentInTransaction(client, 'project-a');
      expect(loaded.sequence).toBe(1);
      expect(readCanvasDocument(loaded.doc).placements['placement-one'].assetVersionId).toBe('version-one');
    });
  });

  postgresIt('rolls back uncommitted assets, versions, placements, document and update log together', async () => {
    await withTransactionFixture('document-tx-all-rollback', async ({ client, callerQuery, observerQuery }) => {
      await client.query('BEGIN');
      try {
        await insertMedia(callerQuery);
        await commitDocumentUpdateInTransaction(client, {
          actorId: 'owner-a', projectId: 'project-a', bytes: placementUpdate(),
        });
        expect(await storedCounts(callerQuery)).toEqual(committedCounts);
        expect(await storedCounts(observerQuery)).toEqual(emptyCounts);
        throw new Error('injected upper command failure');
      } catch (error) {
        expect(error).toMatchObject({ message: 'injected upper command failure' });
        await client.query('ROLLBACK');
      }
      expect(await storedCounts(observerQuery)).toEqual(emptyCounts);
    });
  });

  for (const finish of ['COMMIT', 'ROLLBACK'] as const) {
    postgresIt(`delivers a document notification only for outer COMMIT (${finish})`, async () => {
      await withTransactionFixture(`document-tx-notify-${finish}`, async ({
        client, callerQuery, observerQuery, databaseUrl,
      }) => {
        const listener = new Client({ connectionString: databaseUrl });
        const notifications: unknown[] = [];
        await listener.connect();
        listener.on('notification', (message: Notification): void => {
          if (message.channel === 'wujie_canvas_document_changed') {
            notifications.push(JSON.parse(message.payload || 'null'));
          }
        });
        try {
          await listener.query('LISTEN wujie_canvas_document_changed');
          await listener.query('LISTEN task8a_notification_barrier');
          await notificationBarrier(listener, observerQuery);
          await client.query('BEGIN');
          await insertMedia(callerQuery);
          const pending = await commitDocumentUpdateInTransaction(client, {
            actorId: 'editor-a', projectId: 'project-a', bytes: placementUpdate(),
          });
          expect(pending.sequence).toBe(1);
          await notificationBarrier(listener, observerQuery);
          expect(notifications).toEqual([]);
          expect(await storedCounts(observerQuery)).toEqual(emptyCounts);
          await client.query(finish);
          await notificationBarrier(listener, observerQuery);
          expect(notifications).toEqual(finish === 'COMMIT' ? [{ projectId: 'project-a', sequence: 1 }] : []);
          expect(await storedCounts(observerQuery)).toEqual(finish === 'COMMIT' ? committedCounts : emptyCounts);
        } finally {
          await listener.end();
        }
      });
    });
  }

  postgresIt('returns the old sequence for a duplicate without committing other caller writes', async () => {
    await withTransactionFixture('document-tx-duplicate', async ({ client, callerQuery, observerQuery }) => {
      await insertMedia(observerQuery);
      const bytes = placementUpdate();
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes });
      const original = await observerQuery('SELECT * FROM wujie_project_canvas_documents');
      const log = await observerQuery('SELECT * FROM wujie_project_canvas_updates');
      await client.query('BEGIN');
      await client.query('SAVEPOINT caller_owned');
      await insertMedia(callerQuery, 'two');
      const duplicate = await commitDocumentUpdateInTransaction(client, {
        actorId: 'editor-a', projectId: 'project-a', bytes,
      });
      expect(duplicate.sequence).toBe(1);
      expect(await storedCounts(callerQuery)).toEqual({ ...committedCounts, assets: 2, versions: 2, placements: 2 });
      expect(await storedCounts(observerQuery)).toEqual(committedCounts);
      await client.query('ROLLBACK TO SAVEPOINT caller_owned');
      await client.query('ROLLBACK');
      expect(await storedCounts(observerQuery)).toEqual(committedCounts);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_documents')).rows).toEqual(original.rows);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_updates')).rows).toEqual(log.rows);
    });
  });

  const rejectionCases = [
    { name: 'no document grant', actorId: 'stranger', code: 'DOCUMENT_FORBIDDEN' },
    { name: 'revoked editor', actorId: 'editor-a', code: 'DOCUMENT_FORBIDDEN',
      setup: "UPDATE wujie_project_document_editors SET status = 'revoked', grant_generation = 2" },
    { name: 'stale grant generation', actorId: 'editor-a', code: 'DOCUMENT_FORBIDDEN',
      setup: 'UPDATE wujie_project_document_editors SET grant_generation = 3' },
    { name: 'disabled project', actorId: 'owner-a', code: 'DOCUMENT_PROJECT_NOT_ENABLED',
      setup: 'UPDATE wujie_project_document_settings SET enabled = false' },
    { name: 'disabled feature', actorId: 'owner-a', code: 'DOCUMENT_DISABLED', flag: 'false' },
    { name: 'default disabled feature', actorId: 'owner-a', code: 'DOCUMENT_DISABLED', flag: undefined },
  ];
  for (const rejection of rejectionCases) {
    postgresIt(`rejects ${rejection.name} while leaving transaction ownership to the caller`, async () => {
      await withTransactionFixture('document-tx-access', async ({ client, callerQuery, observerQuery }) => {
        if (rejection.setup) await observerQuery(rejection.setup);
        if ('flag' in rejection) vi.stubEnv('WUJIE_YJS_ENABLED', rejection.flag);
        await client.query('BEGIN');
        await client.query('SAVEPOINT caller_owned');
        await insertMedia(callerQuery);
        await expect(commitDocumentUpdateInTransaction(client, {
          actorId: rejection.actorId, projectId: 'project-a', bytes: placementUpdate(),
          expectedGrantGeneration: rejection.actorId === 'owner-a' ? '0' : '1',
        })).rejects.toMatchObject({ code: rejection.code });
        expect(await storedCounts(callerQuery)).toEqual({ ...emptyCounts, assets: 1, versions: 1, placements: 1 });
        await client.query('ROLLBACK TO SAVEPOINT caller_owned');
        await client.query('ROLLBACK');
        expect(await storedCounts(observerQuery)).toEqual(emptyCounts);
      });
    });
  }

  postgresIt('rejects a real cross-project asset version even inside the same transaction', async () => {
    await withTransactionFixture('document-tx-cross-project', async ({ client, callerQuery, observerQuery }) => {
      await client.query('BEGIN');
      await insertMedia(callerQuery, 'one', 'project-b');
      await expect(commitDocumentUpdateInTransaction(client, {
        actorId: 'owner-a', projectId: 'project-a', bytes: placementUpdate(),
      })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await client.query('ROLLBACK');
      expect(await storedCounts(observerQuery)).toEqual(emptyCounts);
      expect((await observerQuery('SELECT * FROM wujie_assets')).rowCount).toBe(0);
    });
  });

  postgresIt('rejects raw assetVersions replacement even when the caller updates the graph to match', async () => {
    await withTransactionFixture('document-tx-version-rewrite', async ({ client, callerQuery, observerQuery }) => {
      await insertMedia(observerQuery);
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: placementUpdate() });
      const original = await observerQuery('SELECT * FROM wujie_project_canvas_documents');
      const log = await observerQuery('SELECT * FROM wujie_project_canvas_updates');
      await client.query('BEGIN');
      await callerQuery(`INSERT INTO wujie_asset_versions
        (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
        VALUES ('version-replacement', 'asset-one', 'owner-a', 'project-a',
                '/api/serve-upload/images/one.png', 'ready', 'image/png', $1)`, [imageSize]);
      await callerQuery("UPDATE wujie_workspace_placements SET asset_version_id = 'version-replacement'");
      const loaded = await loadDocumentInTransaction(client, 'project-a');
      loaded.doc.getMap('assetVersions').set('placement-one', 'version-replacement');
      await expect(commitDocumentUpdateInTransaction(client, {
        actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(loaded.doc),
      })).rejects.toMatchObject({ name: 'DocumentUpdateRejectedError',
        message: 'Canvas document immutable placement history cannot be rewritten' });
      await client.query('ROLLBACK');
      expect(await storedCounts(observerQuery)).toEqual(committedCounts);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_documents')).rows).toEqual(original.rows);
      expect((await observerQuery('SELECT * FROM wujie_project_canvas_updates')).rows).toEqual(log.rows);
      expect((await observerQuery('SELECT asset_version_id FROM wujie_workspace_placements')).rows)
        .toEqual([{ asset_version_id: 'version-one' }]);
    });
  });
});

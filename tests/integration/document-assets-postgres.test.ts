import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;
let mediaRoot = '';
let imageBytes: Buffer;
const priorDataRoot = process.env.WUJIE_DATA_DIR;

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-yjs-adoption-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  await mkdir(path.join(mediaRoot, 'images'));
  imageBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } })
    .png().toBuffer();
  await writeFile(path.join(mediaRoot, 'images', 'source.png'), imageBytes);
  await writeFile(path.join(mediaRoot, 'images', 'a.png'), imageBytes);
});

afterAll(async () => {
  if (priorDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = priorDataRoot;
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

async function exportFilenames(): Promise<string[]> {
  try {
    return (await readdir(path.join(mediaRoot, 'exports'))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function setupAssetDatabase(query: QueryFn): Promise<void> {
  await query(await readFile('migrations/20260809_wj_core_users.sql', 'utf8'));
  await query(await readFile('migrations/20260810_wj_stable_s2_assets.sql', 'utf8'));
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('owner-b', 'Owner B', 'test', 'active', 1, 1)
  `);
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name)
    VALUES ('project-a', 'owner-a', 'A'),
           ('project-b', 'owner-a', 'B'),
           ('project-c', 'owner-b', 'C')
  `);
  await query(`
    INSERT INTO wujie_assets (id, owner_id, project_id, kind)
    VALUES ('asset-a', 'owner-a', 'project-a', 'image'),
           ('asset-b', 'owner-a', 'project-b', 'image'),
           ('asset-c', 'owner-b', 'project-c', 'image')
  `);
  await query(`
    INSERT INTO wujie_asset_versions
      (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size)
    VALUES ('version-a', 'asset-a', 'owner-a', 'project-a', '/api/serve-upload/images/a.png', 'ready', 'image/png', $1),
           ('version-b', 'asset-b', 'owner-a', 'project-b', '/api/serve-upload/images/b.png', 'ready', 'image/png', $1),
           ('version-c', 'asset-c', 'owner-b', 'project-c', '/api/serve-upload/images/c.png', 'ready', 'image/png', $1)
  `, [imageBytes.length]);
}

async function setupAdoptionDatabase(query: QueryFn): Promise<void> {
  await setupAssetDatabase(query);
  await query(await readFile('migrations/20260815_wj_cloud_tasks.sql', 'utf8'));
  await query(await readFile('migrations/20260909_mpe_cross_asset_parents.sql', 'utf8'));
  await query(await readFile('migrations/20260909_mpe_export_cleanup_outbox.sql', 'utf8'));
  await query(await readFile('migrations/20260910_mpe_export_cleanup_leases.sql', 'utf8'));
  await query(await readFile('migrations/20260925_yjs_canvas_editors.sql', 'utf8'));
  const migration = await readFile('migrations/20260925_yjs_canvas_asset_adoptions.sql', 'utf8');
  await query(migration);
  await query(migration);
  await query(`
    CREATE TABLE wujie_credits (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
      balance INTEGER NOT NULL DEFAULT 0, total_recharged INTEGER NOT NULL DEFAULT 0,
      total_used INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
    )
  `);
  await query(`
    CREATE TABLE wujie_credit_transactions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      amount INTEGER NOT NULL, balance_after INTEGER DEFAULT 0,
      description TEXT DEFAULT '', model TEXT DEFAULT '', task_id TEXT DEFAULT '',
      reference_id TEXT DEFAULT '', created_at BIGINT NOT NULL
    )
  `);
  await query("INSERT INTO wujie_users (id, name, password_hash, status, credits, created_at, updated_at) VALUES ('editor-a', 'Editor A', 'test', 'active', 88, 1, 1)");
  await query("INSERT INTO wujie_projects (id, owner_id, name) VALUES ('project-editor', 'editor-a', 'Editor source')");
  await query("INSERT INTO wujie_assets (id, owner_id, project_id, kind) VALUES ('source-asset', 'editor-a', 'project-editor', 'image')");
  await query(`
    INSERT INTO wujie_asset_versions
      (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size, width, height, task_id, checksum)
    VALUES ('source-version', 'source-asset', 'editor-a', 'project-editor',
      '/api/serve-upload/images/source.png', 'ready', 'image/png', $1, 2, 2, 'source-task', $2)
  `, [imageBytes.length, createHash('sha256').update(imageBytes).digest('hex')]);
  await query("UPDATE wujie_assets SET current_version_id = 'source-version' WHERE id = 'source-asset'");
  await query(`
    INSERT INTO cloud_tasks
      (id, user_id, project_id, type, status, result, credit_status,
       credit_cost, charged_transaction_id, created_at, updated_at)
    VALUES ('source-task', 'editor-a', 'project-editor', 'image-generate', 'completed',
      '{"imageUrls":["/api/serve-upload/images/source.png"]}'::jsonb,
      'charged', 12, 'charge-1', 1, 1)
  `);
  await query("INSERT INTO wujie_credits (id, user_id, balance, total_used, created_at, updated_at) VALUES ('credits-editor', 'editor-a', 88, 12, 1, 1)");
  await query("INSERT INTO wujie_credit_transactions (id, user_id, type, amount, balance_after, task_id, created_at) VALUES ('charge-1', 'editor-a', 'consume', -12, 88, 'source-task', 1)");
}

describe('Yjs canvas project asset reference authority on PostgreSQL', () => {
  postgresIt('accepts only a ready version in the exact active owner project and asset', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-reference', async ({ query }) => {
      await setupAssetDatabase(query);
      const { getPool } = await import('../../src/lib/db-client');
      const { assertProjectAssetVersion } =
        await import('../../src/lib/collaboration/document-assets');
      const client = await getPool().connect();
      try {
        await expect(assertProjectAssetVersion('owner-a', 'project-a', 'version-a', client))
          .resolves.toBeUndefined();
        for (const versionId of ['version-b', 'version-c', 'missing']) {
          await expect(assertProjectAssetVersion('owner-a', 'project-a', versionId, client))
            .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
        }

        await query("UPDATE wujie_asset_versions SET availability = 'pending-persist' WHERE id = 'version-a'");
        await expect(assertProjectAssetVersion('owner-a', 'project-a', 'version-a', client))
          .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
        await query("UPDATE wujie_asset_versions SET availability = 'ready' WHERE id = 'version-a'");

        await query("UPDATE wujie_asset_versions SET file_url = 'data:image/png;base64,AAAA' WHERE id = 'version-a'");
        await expect(assertProjectAssetVersion('owner-a', 'project-a', 'version-a', client))
          .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
        await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/a.png' WHERE id = 'version-a'");

        await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/gone.png' WHERE id = 'version-a'");
        await expect(assertProjectAssetVersion('owner-a', 'project-a', 'version-a', client))
          .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
        await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/a.png' WHERE id = 'version-a'");

        await query("UPDATE wujie_assets SET status = 'trashed' WHERE id = 'asset-a'");
        await expect(assertProjectAssetVersion('owner-a', 'project-a', 'version-a', client))
          .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
        await query("UPDATE wujie_assets SET status = 'active' WHERE id = 'asset-a'");

        await query("UPDATE wujie_projects SET status = 'trashed' WHERE id = 'project-a'");
        await expect(assertProjectAssetVersion('owner-a', 'project-a', 'version-a', client))
          .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      } finally {
        client.release();
      }
    });
  });

  postgresIt('adopts one independently persisted version under 20 concurrent replays without touching source or billing', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-adoption-replay', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      // Existing completed tasks may have an empty project_id; the projected
      // source version still carries the authoritative actor-owned project.
      await query("UPDATE cloud_tasks SET project_id = '' WHERE id = 'source-task'");

      const input = {
        actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
        taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'adopt-1',
      };
      const results = await Promise.all(Array.from({ length: 20 }, () => adoptCompletedResultIntoProject(input)));
      expect(new Set(results.map(result => `${result.assetVersionId}:${result.placementId}`)).size).toBe(1);
      expect(await adoptCompletedResultIntoProject({ ...input, idempotencyKey: 'adopt-2' }))
        .toEqual(results[0]);
      await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/gone.png' WHERE id = 'source-version'");
      expect(await adoptCompletedResultIntoProject(input)).toEqual(results[0]);
      expect(await adoptCompletedResultIntoProject({ ...input, idempotencyKey: 'adopt-3' }))
        .toEqual(results[0]);
      await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/source.png' WHERE id = 'source-version'");

      await query(`
        INSERT INTO wujie_asset_versions
          (id, asset_id, owner_id, project_id, file_url, availability, mime_type, byte_size, task_id)
        VALUES ('source-version-b', 'source-asset', 'editor-a', 'project-editor',
          '/api/serve-upload/images/source.png', 'ready', 'image/png', $1, 'source-task')
      `, [imageBytes.length]);
      await expect(adoptCompletedResultIntoProject({ ...input, sourceVersionId: 'source-version-b' }))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });

      const adopted = await query<{
        id: string; asset_id: string; owner_id: string; project_id: string;
        file_url: string; byte_size: string;
      }>(`SELECT id, asset_id, owner_id, project_id, file_url, byte_size
           FROM wujie_asset_versions
           WHERE owner_id = 'owner-a' AND project_id = 'project-a' AND id <> 'version-a'`);
      expect(adopted.rows).toHaveLength(1);
      expect(adopted.rows[0]).toMatchObject({
        id: results[0].assetVersionId, owner_id: 'owner-a', project_id: 'project-a',
        byte_size: String(imageBytes.length),
      });
      expect(adopted.rows[0].file_url).not.toBe('/api/serve-upload/images/source.png');
      const adoptedFile = path.join(mediaRoot, adopted.rows[0].file_url.slice('/api/serve-upload/'.length));
      expect(await readFile(adoptedFile)).toEqual(imageBytes);
      const assets = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM wujie_assets WHERE owner_id = 'owner-a' AND project_id = 'project-a'");
      expect(assets.rows[0].count).toBe(2);
      const lineage = await query<{ target_version_id: string; source_version_id: string }>(
        'SELECT target_version_id, source_version_id FROM wujie_canvas_asset_adoptions',
      );
      expect(lineage.rows).toEqual([{ target_version_id: results[0].assetVersionId, source_version_id: 'source-version' }]);
      const placements = await query<{ id: string }>("SELECT id FROM wujie_workspace_placements WHERE owner_id = 'owner-a' AND project_id = 'project-a'");
      expect(placements.rows).toEqual([{ id: results[0].placementId }]);
      const source = await query<{ owner_id: string; file_url: string }>("SELECT owner_id, file_url FROM wujie_asset_versions WHERE id = 'source-version'");
      expect(source.rows).toEqual([{ owner_id: 'editor-a', file_url: '/api/serve-upload/images/source.png' }]);
      const task = await query<{ user_id: string; status: string; credit_status: string; charged_transaction_id: string }>(
        "SELECT user_id, status, credit_status, charged_transaction_id FROM cloud_tasks WHERE id = 'source-task'",
      );
      expect(task.rows).toEqual([{
        user_id: 'editor-a', status: 'completed', credit_status: 'charged', charged_transaction_id: 'charge-1',
      }]);
      const ledger = await query<{ count: number; amount: string }>(
        "SELECT COUNT(*)::int AS count, SUM(amount)::text AS amount FROM wujie_credit_transactions WHERE user_id = 'editor-a'",
      );
      expect(ledger.rows).toEqual([{ count: 1, amount: '-12' }]);
    });
  });

  postgresIt('rejects unfinished task, missing media, and revoked editor without creating a target asset', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-adoption-rejection', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      const input = {
        actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
        taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'adopt-reject',
      };
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const { idempotencyKey: _omitted, ...missingKey } = input;
      await expect(adoptCompletedResultIntoProject(missingKey as typeof input))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await query("UPDATE cloud_tasks SET status = 'processing' WHERE id = 'source-task'");
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await query("UPDATE cloud_tasks SET status = 'completed' WHERE id = 'source-task'");
      await query("UPDATE cloud_tasks SET project_id = 'project-b' WHERE id = 'source-task'");
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await query("UPDATE cloud_tasks SET project_id = 'project-editor' WHERE id = 'source-task'");
      await query("UPDATE wujie_asset_versions SET availability = 'missing' WHERE id = 'source-version'");
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await query("UPDATE wujie_asset_versions SET availability = 'ready' WHERE id = 'source-version'");
      await query("UPDATE wujie_asset_versions SET task_id = NULL WHERE id = 'source-version'");
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await query("UPDATE wujie_asset_versions SET task_id = 'source-task' WHERE id = 'source-version'");
      await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/gone.png' WHERE id = 'source-version'");
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await query("UPDATE wujie_asset_versions SET file_url = '/api/serve-upload/images/source.png' WHERE id = 'source-version'");
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      await expect(adoptCompletedResultIntoProject(input))
        .rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      const target = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM wujie_asset_versions WHERE owner_id = 'owner-a' AND project_id = 'project-a' AND id <> 'version-a'");
      expect(target.rows[0].count).toBe(0);
    });
  });

  postgresIt('rejects changed source bytes even when the replacement is a valid PNG with the recorded size', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-source-checksum', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const changed = await sharp({ create: {
        width: 2, height: 2, channels: 4, background: '#d4af38',
      } }).png().toBuffer();
      expect(changed.length).toBe(imageBytes.length);
      const sourceFile = path.join(mediaRoot, 'images', 'source.png');
      await writeFile(sourceFile, changed);
      try {
        await expect(adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'adopt-changed',
        })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      } finally {
        await writeFile(sourceFile, imageBytes);
      }
      const target = await query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM wujie_canvas_asset_adoptions",
      );
      expect(target.rows[0].count).toBe(0);
    });
  });

  postgresIt('retains committed media when the COMMIT acknowledgement is lost', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-commit-uncertain', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { getPool } = await import('../../src/lib/db-client');
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const pool = getPool();
      const originalConnect = pool.connect.bind(pool);
      let lostAck = false;
      let commits = 0;
      const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
        if (typeof callback === 'function') {
          return (originalConnect as (...args: unknown[]) => unknown)(callback);
        }
        return originalConnect().then(client => {
          const originalQuery = client.query.bind(client);
          const originalRelease = client.release.bind(client);
          const querySpy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
            const result = await originalQuery(sql, values);
            if (sql === 'COMMIT' && ++commits === 2) {
              lostAck = true;
              throw new Error('COMMIT_ACK_LOST');
            }
            return result;
          }) as typeof client.query);
          const releaseSpy = vi.spyOn(client, 'release').mockImplementation(((...args: unknown[]) => {
            querySpy.mockRestore();
            releaseSpy.mockRestore();
            return (originalRelease as (...releaseArgs: unknown[]) => void)(...args);
          }) as typeof client.release);
          return client;
        });
      }) as typeof pool.connect);
      try {
        const result = await adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'lost-ack',
        });
        expect(lostAck).toBe(true);
        const adopted = await query<{ file_url: string }>(
          'SELECT file_url FROM wujie_asset_versions WHERE id = $1', [result.assetVersionId],
        );
        expect(adopted.rows).toHaveLength(1);
        const persistedPath = path.join(mediaRoot, adopted.rows[0].file_url.slice('/api/serve-upload/'.length));
        expect(await readFile(persistedPath)).toEqual(imageBytes);
      } finally {
        connectSpy.mockRestore();
      }
    });
  }, 20_000);

  postgresIt('does not make editor revocation wait for a staged media write', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-revoke-during-stage', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const { assetBinaryFileOps } = await import('../../src/lib/asset-core/binary-file-ops');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');

      let markStaging!: () => void;
      let releaseStaging!: () => void;
      const staging = new Promise<void>(resolve => { markStaging = resolve; });
      const gate = new Promise<void>(resolve => { releaseStaging = resolve; });
      const originalWrite = assetBinaryFileOps.writeFile;
      let held = false;
      const writeSpy = vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args) => {
        if (!held) {
          held = true;
          markStaging();
          await gate;
        }
        return originalWrite(...args);
      });
      try {
        const adoption = adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'revoke-stage',
        });
        await staging;
        const revoke = revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
        const revocationState = await Promise.race([
          revoke.then(() => 'completed' as const),
          new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), 500)),
        ]);
        releaseStaging();
        await revoke;
        await expect(adoption).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
        expect(revocationState).toBe('completed');
        const target = await query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM wujie_canvas_asset_adoptions',
        );
        expect(target.rows[0].count).toBe(0);
      } finally {
        releaseStaging();
        writeSpy.mockRestore();
      }
    });
  }, 20_000);

  postgresIt('keeps revocation responsive while five replays wait for one staged adoption', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-replay-revoke', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const { assetBinaryFileOps } = await import('../../src/lib/asset-core/binary-file-ops');
      const { getAdvisoryLockPool } = await import('../../src/lib/db-client');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');

      const lockPool = getAdvisoryLockPool();
      const originalConnect = lockPool.connect.bind(lockPool);
      const observedClients = new WeakSet<PoolClient>();
      let failedTryLocks = 0;
      const connectSpy = vi.spyOn(lockPool, 'connect').mockImplementation(((callback?: unknown) => {
        if (typeof callback === 'function') {
          return (originalConnect as (...args: unknown[]) => unknown)(callback);
        }
        return originalConnect().then(client => {
          if (!observedClients.has(client)) {
            observedClients.add(client);
            const originalQuery = client.query.bind(client);
            vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
              const result = await originalQuery(sql, values);
              if (sql.includes('pg_try_advisory_lock') && result.rows[0]?.acquired === false) {
                failedTryLocks += 1;
              }
              return result;
            }) as typeof client.query);
          }
          return client;
        });
      }) as typeof lockPool.connect);

      let markStaging!: () => void;
      let releaseStaging!: () => void;
      const staging = new Promise<void>(resolve => { markStaging = resolve; });
      const gate = new Promise<void>(resolve => { releaseStaging = resolve; });
      const originalWrite = assetBinaryFileOps.writeFile;
      let held = false;
      const writeSpy = vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args) => {
        if (!held) {
          held = true;
          markStaging();
          await gate;
        }
        return originalWrite(...args);
      });
      const input = {
        actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
        taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'replay-revoke',
      };
      try {
        const leader = adoptCompletedResultIntoProject(input).then(
          () => 'adopted' as const, error => error as Error,
        );
        await staging;
        const replays = Array.from({ length: 5 }, () => adoptCompletedResultIntoProject(input).then(
          () => 'adopted' as const, error => error as Error,
        ));
        const waitDeadline = Date.now() + 5_000;
        while (failedTryLocks < 5 && Date.now() < waitDeadline) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(failedTryLocks).toBeGreaterThanOrEqual(5);
        const revoke = revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
        const revocationState = await Promise.race([
          revoke.then(() => 'completed' as const),
          new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), 500)),
        ]);
        releaseStaging();
        await revoke;
        const outcomes = await Promise.all([leader, ...replays]);
        expect(revocationState).toBe('completed');
        expect(outcomes.every(outcome => outcome instanceof Error
          && (outcome as Error & { code?: string }).code === 'DOCUMENT_FORBIDDEN')).toBe(true);
        const target = await query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM wujie_canvas_asset_adoptions',
        );
        expect(target.rows[0].count).toBe(0);
      } finally {
        releaseStaging();
        writeSpy.mockRestore();
        connectSpy.mockRestore();
      }
    });
  }, 30_000);

  postgresIt('discards a pooled connection when advisory-lock acknowledgement is lost', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-lock-uncertain', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { getAdvisoryLockPool } = await import('../../src/lib/db-client');
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const pool = getAdvisoryLockPool();
      const originalConnect = pool.connect.bind(pool);
      let backendPid = 0;
      let injected = false;
      const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
        if (typeof callback === 'function') {
          return (originalConnect as (...args: unknown[]) => unknown)(callback);
        }
        return originalConnect().then(async client => {
          const originalQuery = client.query.bind(client);
          backendPid = (await originalQuery<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
            const result = await originalQuery(sql, values);
            if (!injected && /pg_(?:try_)?advisory_lock\(/.test(sql)) {
              injected = true;
              throw new Error('LOCK_ACK_LOST');
            }
            return result;
          }) as typeof client.query);
          return client;
        });
      }) as typeof pool.connect);
      try {
        await expect(adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'lock-uncertain',
        })).rejects.toThrow('LOCK_ACK_LOST');
        expect(injected).toBe(true);
        expect(backendPid).toBeGreaterThan(0);
        const leaked = await query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND granted",
          [backendPid],
        );
        expect(leaked.rows[0].count).toBe(0);
      } finally {
        connectSpy.mockRestore();
      }
    });
  }, 20_000);

  postgresIt('lets revocation finish while five distinct adoptions stage media', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-distinct-revoke', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const { assetBinaryFileOps } = await import('../../src/lib/asset-core/binary-file-ops');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');

      for (let index = 2; index <= 5; index += 1) {
        await query(
          `INSERT INTO cloud_tasks
             (id, user_id, project_id, type, status, result, credit_status,
              credit_cost, created_at, updated_at)
           VALUES ($1, 'editor-a', 'project-editor', 'image-generate', 'completed',
             '{}'::jsonb, 'charged', 0, 1, 1)`,
          [`source-task-${index}`],
        );
        await query(
          `INSERT INTO wujie_asset_versions
             (id, asset_id, owner_id, project_id, file_url, availability,
              mime_type, byte_size, width, height, task_id, checksum)
           VALUES ($1, 'source-asset', 'editor-a', 'project-editor',
             '/api/serve-upload/images/source.png', 'ready', 'image/png',
             $2, 2, 2, $3, $4)`,
          [`source-version-${index}`, imageBytes.length, `source-task-${index}`,
            createHash('sha256').update(imageBytes).digest('hex')],
        );
      }

      let markAllStaging!: () => void;
      let releaseStaging!: () => void;
      const allStaging = new Promise<void>(resolve => { markAllStaging = resolve; });
      const gate = new Promise<void>(resolve => { releaseStaging = resolve; });
      const originalWrite = assetBinaryFileOps.writeFile;
      let stagingCount = 0;
      const writeSpy = vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args) => {
        stagingCount += 1;
        if (stagingCount === 5) markAllStaging();
        await gate;
        return originalWrite(...args);
      });
      try {
        const outcomes = Array.from({ length: 5 }, (_, index) => {
          const suffix = index === 0 ? '' : `-${index + 1}`;
          return adoptCompletedResultIntoProject({
            actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
            taskId: `source-task${suffix}`, sourceVersionId: `source-version${suffix}`,
            idempotencyKey: `distinct-${index}`,
          }).then(() => 'adopted' as const, error => error as Error);
        });
        await Promise.race([
          allStaging,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FIVE_STAGES_NOT_REACHED')), 5_000)),
        ]);
        const revoke = revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
        const state = await Promise.race([
          revoke.then(() => 'completed' as const),
          new Promise<'waiting'>(resolve => setTimeout(() => resolve('waiting'), 500)),
        ]);
        releaseStaging();
        await revoke;
        const results = await Promise.all(outcomes);
        expect(state).toBe('completed');
        expect(results.every(result => result instanceof Error
          && (result as Error & { code?: string }).code === 'DOCUMENT_FORBIDDEN')).toBe(true);
        const grant = await query<{ status: string; grant_generation: string }>(
          `SELECT status, grant_generation::text AS grant_generation
             FROM wujie_project_document_editors
            WHERE project_id = 'project-a' AND member_user_id = 'editor-a'`,
        );
        expect(grant.rows).toEqual([{ status: 'revoked', grant_generation: '2' }]);
        const adoption = await query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM wujie_canvas_asset_adoptions',
        );
        expect(adoption.rows[0].count).toBe(0);
      } finally {
        releaseStaging();
        writeSpy.mockRestore();
      }
    });
  }, 20_000);

  postgresIt('does not return an unconfirmed rollback transaction to the business pool', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-rollback-uncertain', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { getPool } = await import('../../src/lib/db-client');
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const exportsBefore = await exportFilenames();
      const pool = getPool();
      const originalConnect = pool.connect.bind(pool);
      let backendPid = 0;
      let writeAckLost = false;
      let rollbackAckLost = false;
      const connectSpy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: unknown) => {
        if (typeof callback === 'function') {
          return (originalConnect as (...args: unknown[]) => unknown)(callback);
        }
        return originalConnect().then(async client => {
          const originalQuery = client.query.bind(client);
          const originalRelease = client.release.bind(client);
          backendPid = (await originalQuery<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const querySpy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
            if (sql === 'ROLLBACK' && writeAckLost) {
              rollbackAckLost = true;
              throw new Error('ROLLBACK_ACK_LOST');
            }
            const result = await originalQuery(sql, values);
            if (sql.includes('INSERT INTO wujie_canvas_asset_adoptions')) {
              writeAckLost = true;
              throw new Error('WRITE_ACK_LOST');
            }
            return result;
          }) as typeof client.query);
          const releaseSpy = vi.spyOn(client, 'release').mockImplementation(((...args: unknown[]) => {
            querySpy.mockRestore();
            releaseSpy.mockRestore();
            return (originalRelease as (...releaseArgs: unknown[]) => void)(...args);
          }) as typeof client.release);
          return client;
        });
      }) as typeof pool.connect);
      try {
        await expect(adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'rollback-unknown',
        })).rejects.toThrow('WRITE_ACK_LOST');
        expect(writeAckLost).toBe(true);
        expect(rollbackAckLost).toBe(true);
        const state = await query<{ state: string }>(
          'SELECT state FROM pg_stat_activity WHERE pid = $1', [backendPid],
        );
        expect(state.rows.some(row => row.state.startsWith('idle in transaction'))).toBe(false);
        expect(await exportFilenames()).toEqual(exportsBefore);
      } finally {
        connectSpy.mockRestore();
      }
    });
  }, 20_000);

  postgresIt('rejects staged media if the advisory-lock backend disconnects before commit', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-lock-disconnect', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { getAdvisoryLockPool } = await import('../../src/lib/db-client');
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { assetBinaryFileOps } = await import('../../src/lib/asset-core/binary-file-ops');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const exportsBefore = await exportFilenames();
      let lockPid = 0;
      const lockHolder: { client: PoolClient | null } = { client: null };
      const lockPool = getAdvisoryLockPool();
      const onAcquire = (client: PoolClient): void => {
        lockHolder.client = client;
        lockPid = (client as PoolClient & { processID?: number }).processID ?? 0;
      };
      lockPool.on('acquire', onAcquire);
      let markStaging!: () => void;
      let releaseStaging!: () => void;
      const staging = new Promise<void>(resolve => { markStaging = resolve; });
      const gate = new Promise<void>(resolve => { releaseStaging = resolve; });
      const originalWrite = assetBinaryFileOps.writeFile;
      const writeSpy = vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args) => {
        markStaging();
        await gate;
        return originalWrite(...args);
      });
      try {
        const adoption = adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'lock-disconnect',
        }).then(() => 'adopted' as const, error => error as Error);
        await staging;
        expect(lockPid).toBeGreaterThan(0);
        // A test listener prevents the old implementation's unhandled event
        // from terminating the Vitest worker; the business assertion stays real.
        const productionErrorListeners = lockHolder.client?.listenerCount('error') ?? 0;
        lockHolder.client?.on('error', () => undefined);
        await query('SELECT pg_terminate_backend($1)', [lockPid]);
        releaseStaging();
        const result = await adoption;
        expect(productionErrorListeners).toBeGreaterThan(0);
        expect(result).toBeInstanceOf(Error);
        const adopted = await query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM wujie_canvas_asset_adoptions',
        );
        expect(adopted.rows[0].count).toBe(0);
        expect(await exportFilenames()).toEqual(exportsBefore);
      } finally {
        releaseStaging();
        writeSpy.mockRestore();
        lockPool.off('acquire', onAcquire);
      }
    });
  }, 20_000);

  postgresIt('handles lock-backend loss while the first advisory query is in flight', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-asset-lock-acquire-loss', async ({ query }) => {
      await setupAdoptionDatabase(query);
      const { getAdvisoryLockPool } = await import('../../src/lib/db-client');
      const { grantDocumentEditor } = await import('../../src/lib/collaboration/document-access');
      const { adoptCompletedResultIntoProject } =
        await import('../../src/lib/asset-core/collaboration-adoption');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      const lockPool = getAdvisoryLockPool();
      const originalConnect = lockPool.connect.bind(lockPool);
      let markQuery!: () => void;
      let releaseQuery!: () => void;
      const queryStarted = new Promise<void>(resolve => { markQuery = resolve; });
      const gate = new Promise<void>(resolve => { releaseQuery = resolve; });
      let lockPid = 0;
      let productionErrorListeners = -1;
      const connectSpy = vi.spyOn(lockPool, 'connect').mockImplementation(((callback?: unknown) => {
        if (typeof callback === 'function') {
          return (originalConnect as (...args: unknown[]) => unknown)(callback);
        }
        return originalConnect().then(client => {
          lockPid = (client as PoolClient & { processID?: number }).processID ?? 0;
          const originalQuery = client.query.bind(client);
          vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
            if (sql.includes('pg_try_advisory_lock')) {
              productionErrorListeners = client.listenerCount('error');
              client.on('error', () => undefined);
              markQuery();
              await gate;
            }
            return originalQuery(sql, values);
          }) as typeof client.query);
          return client;
        });
      }) as typeof lockPool.connect);
      try {
        const adoption = adoptCompletedResultIntoProject({
          actorId: 'editor-a', ownerId: 'owner-a', projectId: 'project-a',
          taskId: 'source-task', sourceVersionId: 'source-version', idempotencyKey: 'acquire-loss',
        }).then(() => 'adopted' as const, error => error as Error);
        await queryStarted;
        expect(lockPid).toBeGreaterThan(0);
        await query('SELECT pg_terminate_backend($1)', [lockPid]);
        releaseQuery();
        const result = await adoption;
        expect(productionErrorListeners).toBeGreaterThan(0);
        expect(result).toBeInstanceOf(Error);
        const rows = await query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM wujie_canvas_asset_adoptions',
        );
        expect(rows.rows[0].count).toBe(0);
      } finally {
        releaseQuery();
        connectSpy.mockRestore();
      }
    });
  }, 20_000);
});

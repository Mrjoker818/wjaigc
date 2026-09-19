import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCanvasShare } from '../../src/lib/canvas-share/service';
import { insertCanvasShare } from '../../src/lib/canvas-share/storage';
import type { CanvasShareItemRecord, CanvasShareRecord } from '../../src/lib/canvas-share/types';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const originalDataRoot = process.env.WUJIE_DATA_DIR;
let testDataRoot: string | undefined;

if (!databaseUrl) {
  console.warn('BLOCKED: canvas share snapshot PostgreSQL verification requires POSTGRES_TEST_DATABASE_URL');
}

beforeAll(async () => {
  if (!databaseUrl) return;
  testDataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-postgres-media-'));
  process.env.WUJIE_DATA_DIR = testDataRoot;
  const uploadDirectory = path.join(testDataRoot, 'uploads');
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, 'ready.png'), Buffer.alloc(128, 1));
});

afterAll(async () => {
  if (originalDataRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = originalDataRoot;
  if (testDataRoot) await rm(testDataRoot, { recursive: true, force: true });
});

async function applyMigrations(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  for (const migrationPath of [
    'migrations/20260810_wj_stable_s2_assets.sql',
    'migrations/20260810_wj_stable_s2_workspace_entity_pairs.sql',
    'migrations/20260913_canvas_video_placements.sql',
    'migrations/20260919_read_only_canvas_shares.sql',
  ]) {
    await query(await readFile(migrationPath, 'utf8'));
  }
  await query(`
    CREATE TABLE IF NOT EXISTS wujie_user_data (
      user_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data_value JSONB,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, data_key)
    )
  `);
}

async function seedReadyCanvas(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name)
    VALUES ('project-1', 'owner-1', 'Project')
  `);
  await query(`
    INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
    VALUES ('owner-1', '__asset_graph_projects_revision', '1'::jsonb, 1)
  `);
  await query(`
    INSERT INTO wujie_assets (
      id, owner_id, project_id, kind, status, current_version_id
    ) VALUES (
      'asset-1', 'owner-1', 'project-1', 'image', 'active', NULL
    )
  `);
  await query(`
    INSERT INTO wujie_asset_versions (
      id, asset_id, owner_id, project_id, file_url, storage_key,
      checksum, mime_type, byte_size, width, height, availability
    ) VALUES (
      'version-1', 'asset-1', 'owner-1', 'project-1',
      '/api/serve-upload/uploads/ready.png', NULL,
      'checksum-1', 'image/png', 128, 640, 480, 'ready'
    )
  `);
  await query(`
    UPDATE wujie_assets
    SET current_version_id = 'version-1'
    WHERE id = 'asset-1' AND owner_id = 'owner-1'
  `);
  await query(`
    INSERT INTO wujie_workspace_placements (
      id, owner_id, project_id, asset_id, asset_version_id,
      workspace_kind, workspace_id, entity_type, entity_id,
      status, transform, metadata, created_at, updated_at
    ) VALUES (
      'placement-1', 'owner-1', 'project-1', 'asset-1', 'version-1',
      'canvas', 'project-1', 'canvas-image', 'image-1', 'active',
      '{"x":10,"y":20,"width":640,"height":480,"rotation":0,"zIndex":1}'::jsonb,
      '{"label":"Ready"}'::jsonb,
      '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'
    )
  `);
}

describe('canvas-share snapshot transaction on PostgreSQL', () => {
  postgresIt('keeps revision and placement consistent while a shared-gate mutation races creation', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-snapshot-race', async ({ databaseUrl: isolatedUrl, query }) => {
      await applyMigrations(query);
      await seedReadyCanvas(query);
      await query(`
        CREATE OR REPLACE FUNCTION delay_canvas_share_insert() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtextextended('canvas-share-test-delay', 0));
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER delay_canvas_share_insert_trigger
        BEFORE INSERT ON wujie_canvas_shares
        FOR EACH ROW EXECUTE FUNCTION delay_canvas_share_insert();
      `);

      const mutator = new Client({ connectionString: isolatedUrl });
      const insertBlocker = new Client({ connectionString: isolatedUrl });
      await Promise.all([mutator.connect(), insertBlocker.connect()]);
      try {
        await insertBlocker.query(
          "SELECT pg_advisory_lock(hashtextextended('canvas-share-test-delay', 0))",
        );
        const creation = createCanvasShare({
          actorUserId: 'owner-1',
          projectId: 'project-1',
          title: 'Race snapshot',
          requestedViewport: { offsetX: 0, offsetY: 0, zoom: 1 },
        });
        let insertIsBlocked = false;
        for (let attempt = 0; attempt < 100 && !insertIsBlocked; attempt += 1) {
          const blocked = await query<{ blocked: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND wait_event = 'advisory'
                AND query LIKE '%INSERT INTO wujie_canvas_shares%'
            ) AS blocked
          `);
          insertIsBlocked = blocked.rows[0]?.blocked === true;
          if (!insertIsBlocked) await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(insertIsBlocked).toBe(true);
        const mutation = (async () => {
          await mutator.query('BEGIN');
          await mutator.query(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
            ['wujie:asset-graph-write-gate:v1'],
          );
          await mutator.query(
            'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
            ['owner-1', '__asset_graph_projects_revision'],
          );
          await mutator.query(`
            UPDATE wujie_workspace_placements
            SET transform = '{"x":999,"y":20,"width":640,"height":480,"rotation":0,"zIndex":1}'::jsonb,
                updated_at = now()
            WHERE id = 'placement-1'
          `);
          await mutator.query(`
            UPDATE wujie_user_data SET data_value = '2'::jsonb
            WHERE user_id = 'owner-1' AND data_key = '__asset_graph_projects_revision'
          `);
          await mutator.query('COMMIT');
        })();
        await insertBlocker.query(
          "SELECT pg_advisory_unlock(hashtextextended('canvas-share-test-delay', 0))",
        );

        const [created] = await Promise.all([creation, mutation]);
        expect(created.share.projectRevision).toBe(1);
        const persisted = await query<{
          project_revision: number;
          transform: { x: number };
        }>(`
          SELECT share.project_revision, item.transform
          FROM wujie_canvas_shares share
          JOIN wujie_canvas_share_items item ON item.share_id = share.id
          WHERE share.id = $1
        `, [created.share.id]);
        expect(persisted.rows).toEqual([{
          project_revision: 1,
          transform: expect.objectContaining({ x: 10 }),
        }]);
        const persistedPayload = await query<{ payload: string }>(`
          SELECT row_to_json(share)::text || COALESCE(jsonb_agg(item)::text, '[]') AS payload
          FROM wujie_canvas_shares share
          LEFT JOIN wujie_canvas_share_items item ON item.share_id = share.id
          WHERE share.id = $1
          GROUP BY share.id
        `, [created.share.id]);
        expect(persistedPayload.rows[0]?.payload).not.toContain(created.token);
        expect(persistedPayload.rows[0]?.payload).not.toContain('/api/serve-upload/');
        expect(persistedPayload.rows[0]?.payload).not.toContain('https://');
        const current = await query<{ revision: string; x: number }>(`
          SELECT revision.data_value #>> '{}' AS revision,
                 (placement.transform->>'x')::integer AS x
          FROM wujie_user_data revision
          CROSS JOIN wujie_workspace_placements placement
          WHERE revision.user_id = 'owner-1'
            AND revision.data_key = '__asset_graph_projects_revision'
            AND placement.id = 'placement-1'
        `);
        expect(current.rows).toEqual([{ revision: '2', x: 999 }]);
      } finally {
        await insertBlocker.query(
          "SELECT pg_advisory_unlock(hashtextextended('canvas-share-test-delay', 0))",
        ).catch(() => undefined);
        await mutator.query('ROLLBACK').catch(() => undefined);
        await Promise.all([mutator.end(), insertBlocker.end()]);
      }
    });
  }, 30_000);

  postgresIt('returns project conflict when a mutation wins before snapshot enumeration', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-mutation-first-conflict', async ({
      databaseUrl: isolatedUrl,
      query,
    }) => {
      await applyMigrations(query);
      await seedReadyCanvas(query);
      const mutator = new Client({ connectionString: isolatedUrl });
      await mutator.connect();
      try {
        await mutator.query('BEGIN');
        await mutator.query(
          "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
          ['wujie:asset-graph-write-gate:v1'],
        );
        await mutator.query(
          'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
          ['owner-1', '__asset_graph_projects_revision'],
        );
        await mutator.query(`
          UPDATE wujie_assets SET status = 'trashed' WHERE id = 'asset-1'
        `);
        await mutator.query(`
          UPDATE wujie_user_data SET data_value = '2'::jsonb
          WHERE user_id = 'owner-1' AND data_key = '__asset_graph_projects_revision'
        `);

        const creation = createCanvasShare({
          actorUserId: 'owner-1',
          projectId: 'project-1',
          title: 'Mutation-first conflict',
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        await mutator.query('COMMIT');

        await expect(creation).rejects.toMatchObject({
          code: 'CANVAS_SHARE_PROJECT_CONFLICT',
        });
        const counts = await query<{ shares: string; items: string }>(`
          SELECT
            (SELECT count(*) FROM wujie_canvas_shares)::text AS shares,
            (SELECT count(*) FROM wujie_canvas_share_items)::text AS items
        `);
        expect(counts.rows).toEqual([{ shares: '0', items: '0' }]);
      } finally {
        await mutator.query('ROLLBACK').catch(() => undefined);
        await mutator.end();
      }
    });
  }, 30_000);

  postgresIt('rolls back an inserted main row when any item insert fails', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-item-insert-rollback', async ({ query }) => {
      await applyMigrations(query);
      await seedReadyCanvas(query);
      const createdAt = '2026-09-19T00:00:00.000Z';
      const record: CanvasShareRecord = {
        id: 'share-atomic',
        ownerId: 'owner-1',
        projectId: 'project-1',
        projectRevision: 1,
        tokenHash: 'a'.repeat(64),
        title: 'Atomic share',
        status: 'active',
        expiresAt: '2026-10-19T00:00:00.000Z',
        allowDownload: false,
        viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
        snapshotDigest: 'b'.repeat(64),
        viewCount: 0,
        lastViewedAt: null,
        createdAt,
        revokedAt: null,
      };
      const item = (id: string, placementId: string): CanvasShareItemRecord => ({
        id,
        shareId: record.id,
        placementId,
        assetId: 'asset-1',
        assetVersionId: 'version-1',
        entityType: 'canvas-image',
        assetKind: 'image',
        transform: { x: 0, y: 0, width: 640, height: 480, rotation: 0, zIndex: 0 },
        displayMetadata: {},
        mimeType: 'image/png',
        width: 640,
        height: 480,
        byteSize: 128,
        checksum: 'checksum-1',
        availability: 'ready',
        sortOrder: id === 'item-valid' ? 0 : 1,
        createdAt,
      });

      await expect(insertCanvasShare(record, [
        item('item-valid', 'placement-1'),
        item('item-invalid', 'placement-missing'),
      ])).rejects.toMatchObject({ code: '23503' });
      const counts = await query<{ shares: string; items: string }>(`
        SELECT
          (SELECT count(*) FROM wujie_canvas_shares)::text AS shares,
          (SELECT count(*) FROM wujie_canvas_share_items)::text AS items
      `);
      expect(counts.rows).toEqual([{ shares: '0', items: '0' }]);
    });
  }, 30_000);

  postgresIt('rejects unready media before inserting a share row or item', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-snapshot-rollback', async ({ query }) => {
      await applyMigrations(query);
      await seedReadyCanvas(query);
      await query(`
        UPDATE wujie_asset_versions
        SET availability = 'pending-persist'
        WHERE id = 'version-1'
      `);

      await expect(createCanvasShare({
        actorUserId: 'owner-1',
        projectId: 'project-1',
        title: 'Must roll back',
      })).rejects.toMatchObject({ code: 'CANVAS_SHARE_MEDIA_NOT_READY' });
      const counts = await query<{ shares: string; items: string }>(`
        SELECT
          (SELECT count(*) FROM wujie_canvas_shares)::text AS shares,
          (SELECT count(*) FROM wujie_canvas_share_items)::text AS items
      `);
      expect(counts.rows).toEqual([{ shares: '0', items: '0' }]);
    });
  }, 30_000);
});

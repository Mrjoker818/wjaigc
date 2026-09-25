import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  readPublicCanvasShare,
  readPublicCanvasShareMedia,
} from '../../src/lib/canvas-share/service';
import { enforceCanvasSharePublicRateLimit } from '../../src/lib/canvas-share/public-rate-limit';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;
const originalDataRoot = process.env.WUJIE_DATA_DIR;
let testDataRoot: string | undefined;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: canvas share public PostgreSQL verification requires POSTGRES_TEST_DATABASE_URL',
  );
}

beforeAll(async () => {
  if (!databaseUrl) return;
  testDataRoot = await mkdtemp(path.join(tmpdir(), 'canvas-share-public-postgres-'));
  process.env.WUJIE_DATA_DIR = testDataRoot;
  await mkdir(path.join(testDataRoot, 'uploads'), { recursive: true });
  await writeFile(path.join(testDataRoot, 'uploads', 'one.png'), Buffer.from([1, 2, 3, 4]));
  await writeFile(path.join(testDataRoot, 'uploads', 'two.png'), Buffer.from([5, 6, 7, 8]));
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
}

async function seedTwoShares(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<{ tokenOne: string; tokenTwo: string }> {
  const tokenOne = 'A'.repeat(43);
  const tokenTwo = 'B'.repeat(43);
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name) VALUES
      ('project-one', 'owner-one', 'One'),
      ('project-two', 'owner-two', 'Two')
  `);
  await query(`
    INSERT INTO wujie_assets (
      id, owner_id, project_id, kind, status, current_version_id
    ) VALUES
      ('asset-one', 'owner-one', 'project-one', 'image', 'active', NULL),
      ('asset-two', 'owner-two', 'project-two', 'image', 'active', NULL)
  `);
  await query(`
    INSERT INTO wujie_asset_versions (
      id, asset_id, owner_id, project_id, file_url, checksum,
      mime_type, byte_size, width, height, availability
    ) VALUES
      ('version-one', 'asset-one', 'owner-one', 'project-one',
       '/api/serve-upload/uploads/one.png', 'sum-one', 'image/png', 4, 10, 20, 'ready'),
      ('version-two', 'asset-two', 'owner-two', 'project-two',
       '/api/serve-upload/uploads/two.png', 'sum-two', 'image/png', 4, 30, 40, 'ready')
  `);
  await query(`
    UPDATE wujie_assets SET current_version_id = 'version-one' WHERE id = 'asset-one';
    UPDATE wujie_assets SET current_version_id = 'version-two' WHERE id = 'asset-two'
  `);
  await query(`
    INSERT INTO wujie_workspace_placements (
      id, owner_id, project_id, asset_id, asset_version_id,
      workspace_kind, workspace_id, entity_type, entity_id, status,
      transform, metadata, created_at, updated_at
    ) VALUES
      ('placement-one', 'owner-one', 'project-one', 'asset-one', 'version-one',
       'canvas', 'project-one', 'canvas-image', 'entity-one', 'active',
       '{"x":1,"y":2,"width":10,"height":20,"rotation":0,"zIndex":0}'::jsonb,
       '{}'::jsonb, '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z'),
      ('placement-two', 'owner-two', 'project-two', 'asset-two', 'version-two',
       'canvas', 'project-two', 'canvas-image', 'entity-two', 'active',
       '{"x":3,"y":4,"width":30,"height":40,"rotation":0,"zIndex":0}'::jsonb,
       '{}'::jsonb, '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z')
  `);
  await query(`
    INSERT INTO wujie_canvas_shares (
      id, owner_id, project_id, project_revision, token_hash, title, status,
      expires_at, allow_download, viewport, snapshot_digest, created_at
    ) VALUES
      ('share-one', 'owner-one', 'project-one', 1, $1, 'One', 'active',
       '2099-09-19T00:00:00Z', TRUE, '{"offsetX":0,"offsetY":0,"zoom":1}'::jsonb, $3,
       '2026-09-19T00:00:00Z'),
      ('share-two', 'owner-two', 'project-two', 1, $2, 'Two', 'active',
       '2099-09-19T00:00:00Z', TRUE, '{"offsetX":0,"offsetY":0,"zoom":1}'::jsonb, $4,
       '2026-09-19T00:00:00Z')
  `, [
    createHash('sha256').update(tokenOne).digest('hex'),
    createHash('sha256').update(tokenTwo).digest('hex'),
    '98fbc2a03e94abe701dddc1eb71322c17d9d400522138f754d6269e53d5af7cb',
    '0434c00ab02648a8d623a27d7e61bbf8dd761160f3018705f3d54fddabfb35c8',
  ]);
  await query(`
    INSERT INTO wujie_canvas_share_items (
      id, share_id, placement_id, asset_id, asset_version_id, entity_type,
      asset_kind, transform, display_metadata, mime_type, width, height,
      byte_size, checksum, availability, sort_order, created_at
    ) VALUES
      ('item-one', 'share-one', 'placement-one', 'asset-one', 'version-one', 'canvas-image',
       'image', '{"x":1,"y":2,"width":10,"height":20,"rotation":0,"zIndex":0}'::jsonb,
       '{}'::jsonb, 'image/png', 10, 20, 4, 'sum-one', 'ready', 0, '2026-09-19T00:00:00Z'),
      ('item-two', 'share-two', 'placement-two', 'asset-two', 'version-two', 'canvas-image',
       'image', '{"x":3,"y":4,"width":30,"height":40,"rotation":0,"zIndex":0}'::jsonb,
       '{}'::jsonb, 'image/png', 30, 40, 4, 'sum-two', 'ready', 0, '2026-09-19T00:00:00Z')
  `);
  return { tokenOne, tokenTwo };
}

describe('canvas-share public access on PostgreSQL', () => {
  postgresIt('isolates two users and shares, then blocks metadata/media/download immediately after revoke', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-public-idor-revoke', async ({ query }) => {
      await applyMigrations(query);
      const { tokenOne, tokenTwo } = await seedTwoShares(query);

      const one = await readPublicCanvasShare(tokenOne);
      const two = await readPublicCanvasShare(tokenTwo);
      expect(one.title).toBe('One');
      expect(two.title).toBe('Two');
      expect(one.items[0].itemRef).not.toBe(two.items[0].itemRef);
      await expect(readPublicCanvasShareMedia({
        token: tokenOne,
        itemRef: two.items[0].itemRef,
        download: false,
        rangeHeader: null,
      })).rejects.toMatchObject({ code: 'CANVAS_SHARE_NOT_FOUND' });
      await expect(readPublicCanvasShareMedia({
        token: tokenOne,
        itemRef: one.items[0].itemRef,
        download: false,
        rangeHeader: null,
      })).resolves.toMatchObject({ bytes: Buffer.from([1, 2, 3, 4]) });

      await query(`
        UPDATE wujie_canvas_shares
        SET status = 'revoked', revoked_at = now()
        WHERE id = 'share-one'
      `);
      await expect(readPublicCanvasShare(tokenOne)).rejects.toMatchObject({
        code: 'CANVAS_SHARE_NOT_FOUND',
      });
      for (const download of [false, true]) {
        await expect(readPublicCanvasShareMedia({
          token: tokenOne,
          itemRef: one.items[0].itemRef,
          download,
          rangeHeader: null,
        })).rejects.toMatchObject({ code: 'CANVAS_SHARE_NOT_FOUND' });
      }
    });
  }, 30_000);

  postgresIt('enforces the durable metadata window atomically under contention', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-public-rate-window', async ({ query }) => {
      await applyMigrations(query);
      const attempts = await Promise.allSettled(Array.from({ length: 80 }, () => (
        enforceCanvasSharePublicRateLimit({
          tokenDigest: 'a'.repeat(64),
          itemScope: 'metadata',
          ipAddress: '203.0.113.8',
          routeBucket: 'metadata',
          now: new Date('2026-09-19T12:00:00.000Z'),
        })
      )));

      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(60);
      expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(20);
      const persisted = await query<{ attempt_count: string }>(`
        SELECT attempt_count::text AS attempt_count
        FROM wujie_canvas_share_rate_windows
      `);
      expect(persisted.rows).toEqual([{ attempt_count: '80' }]);
    });
  }, 30_000);
});

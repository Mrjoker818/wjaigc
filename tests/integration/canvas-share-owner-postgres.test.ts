import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  patchCanvasSharePolicy,
  preflightCanvasShare,
  revokeCanvasShare,
} from '../../src/lib/canvas-share/service';
import {
  findCanvasShareForOwner,
  insertCanvasShare,
  revokeCanvasShare as revokeCanvasShareInStorage,
} from '../../src/lib/canvas-share/storage';
import type { CanvasShareRecord } from '../../src/lib/canvas-share/types';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn('BLOCKED: canvas share owner lifecycle PostgreSQL verification requires POSTGRES_TEST_DATABASE_URL');
}

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

async function seedProject(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  await query(`
    INSERT INTO wujie_projects (id, owner_id, name)
    VALUES ('project-1', 'owner-1', 'Project')
  `);
  await query(`
    INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
    VALUES ('owner-1', '__asset_graph_projects_revision', '7'::jsonb, 1)
  `);
}

function shareRecord(id: string, overrides: Partial<CanvasShareRecord> = {}): CanvasShareRecord {
  return {
    id,
    ownerId: 'owner-1',
    projectId: 'project-1',
    projectRevision: 1,
    tokenHash: createHash('sha256').update(id).digest('hex'),
    title: 'Owner lifecycle',
    status: 'active',
    expiresAt: '2099-10-19T00:00:00.000Z',
    allowDownload: false,
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    snapshotDigest: 'd'.repeat(64),
    viewCount: 0,
    lastViewedAt: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

describe('canvas-share owner lifecycle on PostgreSQL', () => {
  postgresIt('preflights authoritative non-ready state without creating a share', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-owner-preflight', async ({ query }) => {
      await applyMigrations(query);
      await seedProject(query);
      await query(`
        INSERT INTO wujie_assets (
          id, owner_id, project_id, kind, status, current_version_id
        ) VALUES (
          'asset-private', 'owner-1', 'project-1', 'image', 'active', NULL
        )
      `);
      await query(`
        INSERT INTO wujie_asset_versions (
          id, asset_id, owner_id, project_id, file_url, storage_key,
          checksum, mime_type, byte_size, width, height, availability, metadata
        ) VALUES (
          'version-private', 'asset-private', 'owner-1', 'project-1',
          'https://private.example/media.png', 'private/path/media.png',
          'private-checksum', 'image/png', 128, 640, 480, 'pending-persist',
          '{"providerError":"private provider failure"}'::jsonb
        )
      `);
      await query(`
        UPDATE wujie_assets
        SET current_version_id = 'version-private'
        WHERE id = 'asset-private' AND owner_id = 'owner-1'
      `);
      await query(`
        INSERT INTO wujie_workspace_placements (
          id, owner_id, project_id, asset_id, asset_version_id,
          workspace_kind, workspace_id, entity_type, entity_id,
          status, transform, metadata, created_at, updated_at
        ) VALUES (
          'placement-private', 'owner-1', 'project-1', 'asset-private', 'version-private',
          'canvas', 'project-1', 'canvas-image', 'entity-private', 'active',
          '{}'::jsonb,
          '{"label":"安全显示名","sourceUrl":"https://private.example/source.png"}'::jsonb,
          '2026-09-19T00:00:00.000Z', '2026-09-19T00:00:00.000Z'
        )
      `);

      const result = await preflightCanvasShare({
        actorUserId: 'owner-1',
        projectId: 'project-1',
        requestedViewport: { offsetX: Number.NaN, offsetY: -0, zoom: 999 },
      });

      expect(result).toEqual({
        projectRevision: 7,
        itemCount: 1,
        viewport: { offsetX: 0, offsetY: 0, zoom: 5 },
        readiness: {
          ready: false,
          failures: [{
            itemIndex: 0,
            display: { label: '安全显示名' },
            code: 'CANVAS_SHARE_MEDIA_NOT_READY',
            message: '画布中有媒体尚未就绪',
          }],
        },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /asset-private|version-private|placement-private|private\.example|provider|private\/path/iu,
      );
      const counts = await query<{ shares: string; items: string }>(`
        SELECT
          (SELECT count(*) FROM wujie_canvas_shares)::text AS shares,
          (SELECT count(*) FROM wujie_canvas_share_items)::text AS items
      `);
      expect(counts.rows).toEqual([{ shares: '0', items: '0' }]);
    });
  });

  postgresIt('keeps owner scope and turns a concurrent stale policy update into a conflict', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-owner-policy-conflict', async ({ query }) => {
      await applyMigrations(query);
      await seedProject(query);
      const record = shareRecord('share-policy');
      await insertCanvasShare(record, []);

      let bothRead = 0;
      let releaseReads: (() => void) | undefined;
      const readsReady = new Promise<void>(resolve => { releaseReads = resolve; });
      const find = async (ownerId: string, shareId: string) => {
        const found = await findCanvasShareForOwner(ownerId, shareId);
        bothRead += 1;
        if (bothRead === 2) releaseReads?.();
        await readsReady;
        return found;
      };
      const dependencies = {
        now: () => new Date('2026-09-19T01:00:00.000Z'),
        find,
      };

      const results = await Promise.allSettled([
        patchCanvasSharePolicy({
          actorUserId: 'owner-1', shareId: record.id, patch: { allowDownload: true },
        }, dependencies),
        patchCanvasSharePolicy({
          actorUserId: 'owner-1', shareId: record.id,
          patch: { expiresAt: '2099-11-19T00:00:00.000Z' },
        }, dependencies),
      ]);

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(results.find(result => result.status === 'rejected')).toMatchObject({
        reason: { code: 'CANVAS_SHARE_POLICY_CONFLICT' },
      });
      const foreign = await findCanvasShareForOwner('owner-2', record.id);
      expect(foreign).toBeNull();
    });
  });

  postgresIt('keeps revoke idempotent and never reactivates an expired share', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-owner-revoke-expiry', async ({ query }) => {
      await applyMigrations(query);
      await seedProject(query);
      const active = shareRecord('share-revoke');
      const expired = shareRecord('share-expired', {
        expiresAt: '2026-09-19T00:30:00.000Z',
      });
      await insertCanvasShare(active, []);
      await insertCanvasShare(expired, []);

      const dependencies = {
        now: () => new Date('2026-09-19T01:00:00.000Z'),
        find: findCanvasShareForOwner,
        revoke: revokeCanvasShareInStorage,
      };
      const first = await revokeCanvasShare({
        actorUserId: 'owner-1', shareId: active.id,
      }, dependencies);
      const second = await revokeCanvasShare({
        actorUserId: 'owner-1', shareId: active.id,
      }, dependencies);

      expect(second).toEqual(first);
      expect(second).toMatchObject({
        status: 'revoked',
        createdAt: active.createdAt,
        snapshotDigest: active.snapshotDigest,
      });
      await expect(patchCanvasSharePolicy({
        actorUserId: 'owner-1',
        shareId: expired.id,
        patch: { expiresAt: null, allowDownload: true },
      }, {
        now: dependencies.now,
        find: findCanvasShareForOwner,
      })).rejects.toMatchObject({ code: 'CANVAS_SHARE_POLICY_CONFLICT' });
      const persistedExpired = await findCanvasShareForOwner('owner-1', expired.id);
      expect(persistedExpired?.record).toMatchObject({
        status: 'active',
        expiresAt: expired.expiresAt,
        allowDownload: false,
      });
    });
  });

  postgresIt('creates separate immutable records instead of replacing an existing active share', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-owner-no-replacement', async ({ query }) => {
      await applyMigrations(query);
      await seedProject(query);
      const first = shareRecord('share-first', { snapshotDigest: '1'.repeat(64) });
      const second = shareRecord('share-second', {
        tokenHash: '2'.repeat(64),
        snapshotDigest: '2'.repeat(64),
        createdAt: '2026-09-19T00:01:00.000Z',
      });
      await insertCanvasShare(first, []);
      await insertCanvasShare(second, []);

      const rows = await query<{
        id: string;
        status: string;
        snapshot_digest: string;
      }>(`
        SELECT id, status, snapshot_digest
        FROM wujie_canvas_shares
        WHERE owner_id = 'owner-1' AND project_id = 'project-1'
        ORDER BY created_at, id
      `);
      expect(rows.rows).toEqual([
        { id: first.id, status: 'active', snapshot_digest: first.snapshotDigest },
        { id: second.id, status: 'active', snapshot_digest: second.snapshotDigest },
      ]);
    });
  });
});

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createCanvasShareToken } from '../../src/lib/canvas-share/token';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn('BLOCKED: canvas share schema requires POSTGRES_TEST_DATABASE_URL');
}

async function applyCanvasShareMigration(
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

const digest = (character: string): string => character.repeat(64);

function normalizeDefinition(definition: string): string {
  return definition.toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ').trim();
}

describe('canvas share schema on PostgreSQL', () => {
  postgresIt('creates the three tables without raw token or plain IP rate-window columns', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-tables', async ({ query }) => {
      await applyCanvasShareMigration(query);

      const tables = await query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN (
            'wujie_canvas_shares',
            'wujie_canvas_share_items',
            'wujie_canvas_share_rate_windows'
          )
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'wujie_canvas_share_items',
        'wujie_canvas_share_rate_windows',
        'wujie_canvas_shares',
      ]);

      const rateColumns = await query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'wujie_canvas_share_rate_windows'
        ORDER BY ordinal_position
      `);
      expect(rateColumns.rows.map((row) => row.column_name)).toEqual([
        'scope_digest',
        'route_bucket',
        'window_start',
        'attempt_count',
      ]);
    });
  }, 30_000);

  postgresIt('creates constraints and indexes over the required columns in contract order', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-constraints', async ({ query }) => {
      await applyCanvasShareMigration(query);

      const constraints = await query<{
        table_name: string;
        conname: string;
        definition: string;
      }>(`
        SELECT pg_class.relname AS table_name,
               pg_constraint.conname,
               pg_get_constraintdef(pg_constraint.oid) AS definition
        FROM pg_constraint
        JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_namespace.nspname = current_schema()
          AND pg_class.relname IN (
            'wujie_canvas_shares',
            'wujie_canvas_share_items',
            'wujie_canvas_share_rate_windows',
            'wujie_workspace_placements'
          )
      `);
      const constraintMap = new Map(
        constraints.rows.map((row) => [
          row.conname,
          `${row.table_name}: ${normalizeDefinition(row.definition)}`,
        ]),
      );
      expect(constraintMap.get('wujie_canvas_shares_token_hash_check')).toMatch(
        /wujie_canvas_shares: check .*char_length\(token_hash\) = 64.*token_hash ~ '\^\[0-9a-f\]\{64\}\$'/,
      );
      expect(constraintMap.get('wujie_canvas_shares_project_scope_fk')).toMatch(
        /foreign key \(project_id, owner_id\) references wujie_projects\(id, owner_id\)/,
      );
      expect(constraintMap.get('wujie_canvas_shares_revision_check')).toMatch(
        /project_revision >= 0/,
      );
      expect(constraintMap.get('wujie_canvas_shares_view_count_check')).toMatch(
        /view_count >= 0/,
      );
      expect(constraintMap.get('wujie_canvas_shares_viewport_check')).toMatch(
        /jsonb_typeof\(viewport\) = 'object'/,
      );
      expect(constraintMap.get('wujie_canvas_shares_status_check')).toMatch(
        /status.*active.*revoked.*expired/,
      );
      expect(constraintMap.get('wujie_canvas_shares_lifecycle_check')).toMatch(
        /status = 'active'.*revoked_at is null.*status = 'revoked'.*revoked_at is not null.*status = 'expired'.*revoked_at is null.*expires_at is not null/,
      );
      expect(constraintMap.get('wujie_canvas_shares_expiry_check')).toMatch(
        /expires_at is null.*expires_at > created_at/,
      );
      expect(constraintMap.get('wujie_canvas_share_items_source_fk')).toMatch(
        /foreign key \(placement_id, asset_id, asset_version_id, entity_type\) references wujie_workspace_placements\(id, asset_id, asset_version_id, entity_type\)/,
      );
      expect(constraintMap.get('wujie_canvas_share_items_asset_kind_fk')).toMatch(
        /foreign key \(asset_id, asset_kind\) references wujie_assets\(id, kind\)/,
      );
      expect(constraintMap.get('wujie_canvas_share_items_share_fk')).toMatch(
        /foreign key \(share_id\) references wujie_canvas_shares\(id\) on delete cascade/,
      );
      expect(constraintMap.get('wujie_canvas_share_items_entity_asset_pair_check')).toMatch(
        /canvas-image.*image.*canvas-video.*video/,
      );
      expect(constraintMap.get('wujie_canvas_share_items_dimensions_check')).toMatch(
        /width is null.*width >= 0.*height is null.*height >= 0.*byte_size is null.*byte_size >= 0.*sort_order >= 0/,
      );
      expect(constraintMap.get('wujie_canvas_share_items_availability_check')).toMatch(
        /availability = 'ready'/,
      );
      expect(constraintMap.get('wujie_canvas_share_rate_windows_scope_digest_check')).toMatch(
        /wujie_canvas_share_rate_windows: check .*char_length\(scope_digest\) = 64.*scope_digest ~ '\^\[0-9a-f\]\{64\}\$'/,
      );
      expect(constraintMap.get('wujie_canvas_share_rate_windows_pkey')).toMatch(
        /primary key \(scope_digest, route_bucket, window_start\)/,
      );
      expect(constraintMap.get('wujie_canvas_share_rate_windows_attempt_count_check')).toMatch(
        /attempt_count >= 0/,
      );
      expect(constraintMap.get('wujie_workspace_placements_entity_type_check')).toMatch(
        /canvas-image.*canvas-video.*workflow-input.*workflow-output.*chat-attachment.*chat-result/,
      );
      expect(constraintMap.get('wujie_workspace_placements_workspace_entity_pair_check')).toMatch(
        /workspace_kind = 'canvas'.*canvas-image.*canvas-video/,
      );

      const indexes = await query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename IN (
            'wujie_canvas_shares',
            'wujie_canvas_share_items',
            'wujie_canvas_share_rate_windows',
            'wujie_workspace_placements',
            'wujie_assets'
          )
      `);
      const indexMap = new Map(
        indexes.rows.map((row) => [row.indexname, normalizeDefinition(row.indexdef)]),
      );
      expect(indexMap.get('wujie_canvas_shares_token_hash_unique')).toMatch(
        /create unique index .* on .*wujie_canvas_shares using btree \(token_hash\)$/,
      );
      expect(indexMap.get('wujie_canvas_shares_owner_project_status_created_idx')).toMatch(
        /\(owner_id, project_id, status, created_at desc\)$/,
      );
      expect(indexMap.get('wujie_canvas_shares_expires_at_idx')).toMatch(
        /\(expires_at\) where \(expires_at is not null\)$/,
      );
      expect(indexMap.get('wujie_canvas_share_items_share_id_id_idx')).toMatch(
        /\(share_id, id\)$/,
      );
      expect(indexMap.get('wujie_canvas_share_items_share_id_sort_order_idx')).toMatch(
        /\(share_id, sort_order\)$/,
      );
      expect(indexMap.get('wujie_canvas_share_items_asset_version_id_idx')).toMatch(
        /\(asset_version_id\)$/,
      );
      expect(indexMap.get('wujie_canvas_share_rate_windows_window_start_idx')).toMatch(
        /\(window_start\)$/,
      );
      expect(indexMap.get('wujie_workspace_placements_share_source_unique')).toMatch(
        /create unique index .*\(id, asset_id, asset_version_id, entity_type\)$/,
      );
      expect(indexMap.get('wujie_assets_share_kind_unique')).toMatch(
        /create unique index .*\(id, kind\)$/,
      );
    });
  }, 30_000);

  postgresIt('rejects invalid digests and lifecycle transitions', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-invalid-values', async ({ query }) => {
      await applyCanvasShareMigration(query);
      await query(`
        INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-1', 'owner-1', 'Project')
      `);

      const insertShare = (
        id: string,
        tokenHash: string,
        status = 'active',
        expiresAt: string | null = null,
        revokedAt: string | null = null,
      ) => query(`
        INSERT INTO wujie_canvas_shares (
          id, owner_id, project_id, project_revision, token_hash, title,
          status, viewport, snapshot_digest, created_at, expires_at, revoked_at
        ) VALUES (
          $1, 'owner-1', 'project-1', 1, $2, '只读画布', $3,
          '{}'::jsonb, $4, '2026-09-19T00:00:00.000Z', $5, $6
        )
      `, [id, tokenHash, status, digest('d'), expiresAt, revokedAt]);

      await expect(insertShare('bad-status', digest('a'), 'pending')).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertShare('empty-token', '')).rejects.toMatchObject({ code: '23514' });
      await expect(insertShare('raw-token', createCanvasShareToken())).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertShare('uppercase-token', 'A'.repeat(64))).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        insertShare('active-revoked-at', digest('b'), 'active', null, '2026-09-20T00:00:00.000Z'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(insertShare('revoked-no-time', digest('c'), 'revoked')).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertShare('expired-no-expiry', digest('e'), 'expired')).rejects.toMatchObject({
        code: '23514',
      });
      await expect(
        insertShare('invalid-expiry-order', digest('f'), 'active', '2026-09-19T00:00:00.000Z'),
      ).rejects.toMatchObject({ code: '23514' });
      await insertShare(
        'valid-revoked',
        digest('5'),
        'revoked',
        null,
        '2026-09-20T00:00:00.000Z',
      );
      await insertShare(
        'valid-expired',
        digest('6'),
        'expired',
        '2026-09-20T00:00:00.000Z',
      );
      await insertShare('share-1', digest('1'));
      await expect(insertShare('duplicate-token', digest('1'))).rejects.toMatchObject({ code: '23505' });

      await expect(query(`
        INSERT INTO wujie_canvas_share_rate_windows (
          scope_digest, route_bucket, window_start, attempt_count
        ) VALUES ('203.0.113.42', 'metadata', now(), 1)
      `)).rejects.toMatchObject({ code: '23514' });
      await expect(query(`
        INSERT INTO wujie_canvas_share_rate_windows (
          scope_digest, route_bucket, window_start, attempt_count
        ) VALUES ($1, 'metadata', now(), 1)
      `, [createCanvasShareToken()])).rejects.toMatchObject({ code: '23514' });
      await expect(query(`
        INSERT INTO wujie_canvas_share_rate_windows (
          scope_digest, route_bucket, window_start, attempt_count
        ) VALUES ($1, 'metadata', now(), -1)
      `, [digest('2')])).rejects.toMatchObject({ code: '23514' });
    });
  }, 30_000);

  postgresIt('accepts canonical image/video items and rejects inconsistent source tuples', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-source-consistency', async ({ query }) => {
      await applyCanvasShareMigration(query);
      await query(`
        INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-1', 'owner-1', 'Project')
      `);
      await query(`
        INSERT INTO wujie_canvas_shares (
          id, owner_id, project_id, project_revision, token_hash, title,
          status, viewport, snapshot_digest
        ) VALUES (
          'share-1', 'owner-1', 'project-1', 1, $1, '只读画布',
          'active', '{}'::jsonb, $2
        )
      `, [digest('3'), digest('4')]);

      await query(`
        INSERT INTO wujie_assets (id, owner_id, project_id, kind) VALUES
          ('asset-image', 'owner-1', 'project-1', 'image'),
          ('asset-video', 'owner-1', 'project-1', 'video')
      `);
      await query(`
        INSERT INTO wujie_asset_versions (
          id, asset_id, owner_id, project_id, file_url, availability
        ) VALUES
          ('version-image', 'asset-image', 'owner-1', 'project-1', '/api/serve-upload/image.png', 'ready'),
          ('version-image-2', 'asset-image', 'owner-1', 'project-1', '/api/serve-upload/image-2.png', 'ready'),
          ('version-video', 'asset-video', 'owner-1', 'project-1', '/api/serve-upload/video.mp4', 'ready')
      `);
      await query(`
        INSERT INTO wujie_workspace_placements (
          id, owner_id, project_id, asset_id, asset_version_id,
          workspace_kind, workspace_id, entity_type, entity_id
        ) VALUES
          ('placement-image', 'owner-1', 'project-1', 'asset-image', 'version-image',
           'canvas', 'project-1', 'canvas-image', 'image-1'),
          ('placement-video', 'owner-1', 'project-1', 'asset-video', 'version-video',
           'canvas', 'project-1', 'canvas-video', 'video-1')
      `);

      const insertItem = (
        id: string,
        placementId: string,
        assetId: string,
        assetVersionId: string,
        entityType: string,
        assetKind: string,
        sortOrder: number,
        width = 640,
      ) => query(`
        INSERT INTO wujie_canvas_share_items (
          id, share_id, placement_id, asset_id, asset_version_id,
          entity_type, asset_kind, transform, display_metadata,
          mime_type, width, height, byte_size, checksum, availability, sort_order
        ) VALUES (
          $1, 'share-1', $2, $3, $4, $5, $6, '{}'::jsonb, '{}'::jsonb,
          'application/octet-stream', $8, 480, 1024, 'checksum', 'ready', $7
        )
      `, [id, placementId, assetId, assetVersionId, entityType, assetKind, sortOrder, width]);

      await insertItem(
        'item-image',
        'placement-image',
        'asset-image',
        'version-image',
        'canvas-image',
        'image',
        0,
      );
      await insertItem(
        'item-video',
        'placement-video',
        'asset-video',
        'version-video',
        'canvas-video',
        'video',
        1,
      );
      await expect(insertItem(
        'mismatched-asset',
        'placement-image',
        'asset-video',
        'version-video',
        'canvas-video',
        'video',
        2,
      )).rejects.toMatchObject({ code: '23503' });
      await expect(insertItem(
        'mismatched-version',
        'placement-image',
        'asset-image',
        'version-image-2',
        'canvas-image',
        'image',
        3,
      )).rejects.toMatchObject({ code: '23503' });
      await expect(insertItem(
        'mismatched-kind',
        'placement-image',
        'asset-image',
        'version-image',
        'canvas-image',
        'video',
        4,
      )).rejects.toMatchObject({ code: '23514' });
      await expect(insertItem(
        'negative-dimension',
        'placement-image',
        'asset-image',
        'version-image',
        'canvas-image',
        'image',
        5,
        -1,
      )).rejects.toMatchObject({ code: '23514' });
    });
  }, 30_000);
});

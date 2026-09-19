import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn('BLOCKED: canvas share schema requires POSTGRES_TEST_DATABASE_URL');
}

async function applyCanvasShareMigration(
  query: (text: string, values?: unknown[]) => Promise<unknown>,
): Promise<void> {
  const assetSchema = await readFile(
    'migrations/20260810_wj_stable_s2_assets.sql',
    'utf8',
  );
  const canvasShareSchema = await readFile(
    'migrations/20260919_read_only_canvas_shares.sql',
    'utf8',
  );
  await query(assetSchema);
  await query(canvasShareSchema);
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

  postgresIt('creates lifecycle constraints plus owner, expiry, item, version, and cleanup indexes', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-constraints', async ({ query }) => {
      await applyCanvasShareMigration(query);

      const constraints = await query<{ conname: string; definition: string }>(`
        SELECT constraint_name AS conname,
               pg_get_constraintdef(pg_constraint.oid) AS definition
        FROM pg_constraint
        JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        JOIN information_schema.table_constraints
          ON table_constraints.constraint_name = pg_constraint.conname
         AND table_constraints.table_schema = pg_namespace.nspname
        WHERE pg_namespace.nspname = current_schema()
          AND pg_class.relname IN (
            'wujie_canvas_shares',
            'wujie_canvas_share_items',
            'wujie_canvas_share_rate_windows'
          )
      `);
      const constraintMap = new Map(
        constraints.rows.map((row) => [row.conname, row.definition]),
      );
      for (const name of [
        'wujie_canvas_shares_status_check',
        'wujie_canvas_shares_revision_check',
        'wujie_canvas_shares_view_count_check',
        'wujie_canvas_shares_viewport_check',
        'wujie_canvas_shares_lifecycle_check',
        'wujie_canvas_shares_expiry_check',
        'wujie_canvas_share_items_entity_type_check',
        'wujie_canvas_share_items_asset_kind_check',
        'wujie_canvas_share_items_availability_check',
        'wujie_canvas_share_items_dimensions_check',
        'wujie_canvas_share_rate_windows_attempt_count_check',
      ]) {
        expect(constraintMap.has(name), name).toBe(true);
      }

      const indexes = await query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename IN (
            'wujie_canvas_shares',
            'wujie_canvas_share_items',
            'wujie_canvas_share_rate_windows'
          )
      `);
      const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
      for (const name of [
        'wujie_canvas_shares_token_hash_unique',
        'wujie_canvas_shares_owner_project_status_created_idx',
        'wujie_canvas_shares_expires_at_idx',
        'wujie_canvas_share_items_share_id_id_idx',
        'wujie_canvas_share_items_share_id_sort_order_idx',
        'wujie_canvas_share_items_asset_version_id_idx',
        'wujie_canvas_share_rate_windows_window_start_idx',
      ]) {
        expect(indexMap.has(name), name).toBe(true);
      }
      expect(indexMap.get('wujie_canvas_shares_token_hash_unique')).toContain('UNIQUE');
    });
  }, 30_000);

  postgresIt('rejects invalid status, negative dimensions, empty token hashes, and negative attempts', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('canvas-share-invalid-values', async ({ query }) => {
      await applyCanvasShareMigration(query);
      await query(`
        INSERT INTO wujie_projects (id, owner_id, name)
        VALUES ('project-1', 'owner-1', 'Project')
      `);

      const insertShare = (id: string, tokenHash: string, status = 'active') => query(`
        INSERT INTO wujie_canvas_shares (
          id, owner_id, project_id, project_revision, token_hash, title,
          status, viewport, snapshot_digest
        ) VALUES ($1, 'owner-1', 'project-1', 1, $2, '只读画布', $3, '{}'::jsonb, $4)
      `, [id, tokenHash, status, 'd'.repeat(64)]);

      await expect(insertShare('bad-status', 'a'.repeat(64), 'pending')).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertShare('empty-token', '')).rejects.toMatchObject({ code: '23514' });
      await insertShare('share-1', 'b'.repeat(64));

      await query(`
        INSERT INTO wujie_assets (id, owner_id, project_id, kind)
        VALUES ('asset-1', 'owner-1', 'project-1', 'image')
      `);
      await query(`
        INSERT INTO wujie_asset_versions (
          id, asset_id, owner_id, project_id, file_url, availability
        ) VALUES (
          'version-1', 'asset-1', 'owner-1', 'project-1',
          '/api/serve-upload/image.png', 'ready'
        )
      `);
      await query(`
        INSERT INTO wujie_workspace_placements (
          id, owner_id, project_id, asset_id, asset_version_id,
          workspace_kind, workspace_id, entity_type, entity_id
        ) VALUES (
          'placement-1', 'owner-1', 'project-1', 'asset-1', 'version-1',
          'canvas', 'project-1', 'canvas-image', 'image-1'
        )
      `);

      await expect(query(`
        INSERT INTO wujie_canvas_share_items (
          id, share_id, placement_id, asset_id, asset_version_id,
          entity_type, asset_kind, transform, display_metadata,
          mime_type, width, height, byte_size, checksum, availability, sort_order
        ) VALUES (
          'item-1', 'share-1', 'placement-1', 'asset-1', 'version-1',
          'canvas-image', 'image', '{}'::jsonb, '{}'::jsonb,
          'image/png', -1, 480, 1024, 'checksum', 'ready', 0
        )
      `)).rejects.toMatchObject({ code: '23514' });

      await expect(query(`
        INSERT INTO wujie_canvas_share_rate_windows (
          scope_digest, route_bucket, window_start, attempt_count
        ) VALUES ('scope-digest', 'metadata', now(), -1)
      `)).rejects.toMatchObject({ code: '23514' });
    });
  }, 30_000);
});

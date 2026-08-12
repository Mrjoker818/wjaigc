import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const mediaHealth = readFileSync(resolve(process.cwd(), 'src/lib/asset-core/media-health.ts'), 'utf8');
const dashboard = readFileSync(resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'migrations/20260812_wj_stable_s2_asset_lifecycle.sql'),
  'utf8',
);
const postgresLifecycle = readFileSync(
  resolve(process.cwd(), 'tests/integration/stage-2-asset-lifecycle-postgres.test.ts'),
  'utf8',
);

describe('media health governance boundaries', () => {
  it('uses the asset-core transaction boundary and treats only exact completed migration checkpoints as confirmed', () => {
    expect(mediaHealth).toContain('withAssetCoreTransaction');
    expect(mediaHealth).toContain("status = 'completed'");
    expect(mediaHealth).toContain('wujie_user_data');
    expect(mediaHealth).not.toContain("schema_version >= 3 AS migration_confirmed");
  });

  it('checks legacy references across every user and requires project-specific legacy ownership', () => {
    expect(mediaHealth).not.toContain('legacy_data.user_id = a.owner_id');
    expect(mediaHealth).toContain(
      "legacy_data.data_key IN ('projects', 'workflows', 'workflow', 'chat', 'chat-history', 'simple-chat')",
    );
    expect(mediaHealth).toContain('jsonb_array_elements');
    expect(mediaHealth).toContain("legacy_project.value->>'id' = a.project_id");
    expect(mediaHealth).toContain("legacy_project.value->>'userId' = a.owner_id");
  });

  it('keeps network recovery outside locks and publishes a new URL only behind the recovery lease fence', () => {
    expect(mediaHealth).not.toContain('fetch(');
    expect(mediaHealth).toContain("'deferred'");
    expect(mediaHealth).toContain("AND status = 'deferred'");
    expect(mediaHealth).toContain("file_url = CASE WHEN $4 = 'ready' THEN coalesce($5, file_url) ELSE file_url END");
    expect(mediaHealth.indexOf("AND status = 'deferred'")).toBeLessThan(mediaHealth.indexOf('file_url = CASE'));
  });

  it('waits for placement deletion requests before filtering the dashboard legacy image list', () => {
    expect(dashboard).toContain('await reconcileImageBatchDeletion(');
    expect(dashboard).toContain("await fetch(`/api/assets/placements/\${image.placementId}?");
    expect(dashboard).toContain('if (!response.ok) throw new Error');
  });

  it('creates the recovery-attempt table before changing its constraint', () => {
    expect(migration.indexOf('CREATE TABLE IF NOT EXISTS wujie_asset_media_recovery_attempts')).toBeLessThan(
      migration.indexOf('ALTER TABLE wujie_asset_media_recovery_attempts'),
    );
  });

  it('keeps physical purge disabled and requires a real PostgreSQL lock/recheck test', () => {
    expect(mediaHealth).not.toMatch(/deleteImageFromS3|deleteFileFromS3|unlinkSync|rmSync|RemoveObject|DeleteObjectCommand/);
    expect(postgresLifecycle).toContain('purgeEligibleAsset');
    expect(postgresLifecycle).toContain('pg_stat_activity');
    expect(postgresLifecycle).toContain("wait_event_type = 'Lock'");
    expect(postgresLifecycle).toContain('CONFIRMATION_DIGEST_STALE');
    expect(postgresLifecycle).toContain('physicalPurgeDisabled');
  });
});

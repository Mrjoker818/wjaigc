import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const mediaHealth = readFileSync(resolve(process.cwd(), 'src/lib/asset-core/media-health.ts'), 'utf8');
const dashboard = readFileSync(resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'migrations/20260812_wj_stable_s2_asset_lifecycle.sql'),
  'utf8',
);

describe('media health governance boundaries', () => {
  it('uses the asset-core transaction boundary and treats only exact completed migration checkpoints as confirmed', () => {
    expect(mediaHealth).toContain('withAssetCoreTransaction');
    expect(mediaHealth).toContain("status = 'completed'");
    expect(mediaHealth).toContain('wujie_user_data');
    expect(mediaHealth).not.toContain("schema_version >= 3 AS migration_confirmed");
  });

  it('keeps recovery deferred outside locks without fetching or changing immutable file URLs', () => {
    expect(mediaHealth).not.toContain('fetch(');
    expect(mediaHealth).not.toContain("file_url = CASE");
    expect(mediaHealth).toContain("'deferred'");
  });

  it('waits for placement deletion requests before filtering the dashboard legacy image list', () => {
    expect(dashboard).toContain("await fetch(`/api/assets/placements/\${placementId}?");
    expect(dashboard).toContain('if (!response.ok) throw new Error');
  });

  it('creates the recovery-attempt table before changing its constraint', () => {
    expect(migration.indexOf('CREATE TABLE IF NOT EXISTS wujie_asset_media_recovery_attempts')).toBeLessThan(
      migration.indexOf('ALTER TABLE wujie_asset_media_recovery_attempts'),
    );
  });
});

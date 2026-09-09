import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('@/lib/db-client', () => mocks);

import {
  dbCreatePlatformExportPresetVersion,
  dbSetPlatformExportPresetEnabled,
  ensureCoreTables,
} from '@/lib/db-storage';

const preset = {
  id: 'custom-banner',
  version: 1,
  platform: 'custom',
  usage: 'banner',
  label: '自定义横幅',
  width: 1600,
  height: 900,
  recommendedFormat: 'png' as const,
  supportsTransparency: true,
  enabled: true,
};

describe('platform export preset PostgreSQL storage contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    delete process.env.PGDATABASE_URL;
  });

  it('creates a table uniquely keyed by preset id and version', async () => {
    process.env.PGDATABASE_URL = 'postgresql://storage-contract/task-2';

    await ensureCoreTables();

    const schemaCall = mocks.execSql.mock.calls.find(([sql]) => (
      String(sql).includes('CREATE TABLE IF NOT EXISTS wujie_platform_export_presets')
    ));
    expect(schemaCall?.[0]).toContain('PRIMARY KEY (preset_id, version)');
  });

  it('inserts new versions without overwriting a conflicting historical version', async () => {
    mocks.execSql.mockResolvedValueOnce({
      rows: [{
        preset_id: preset.id,
        version: preset.version,
        platform: preset.platform,
        usage: preset.usage,
        label: preset.label,
        width: preset.width,
        height: preset.height,
        recommended_format: preset.recommendedFormat,
        supports_transparency: preset.supportsTransparency,
        enabled: preset.enabled,
      }],
      rowCount: 1,
    });

    await expect(dbCreatePlatformExportPresetVersion(preset)).resolves.toEqual(preset);
    const [sql] = mocks.execSql.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (preset_id, version) DO NOTHING');
  });

  it('updates only enabled and updated_at for an existing version', async () => {
    await expect(dbSetPlatformExportPresetEnabled(preset, false)).resolves.toBe(true);

    const [sql] = mocks.execSql.mock.calls[0];
    const conflictClause = String(sql).split('ON CONFLICT (preset_id, version) DO UPDATE SET')[1];
    expect(conflictClause).toContain('enabled = EXCLUDED.enabled');
    expect(conflictClause).toContain('updated_at = EXCLUDED.updated_at');
    expect(conflictClause).not.toContain('width =');
    expect(conflictClause).not.toContain('height =');
    expect(conflictClause).not.toContain('recommended_format =');
  });
});

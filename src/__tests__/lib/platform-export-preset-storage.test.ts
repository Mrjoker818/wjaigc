import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  getPool: vi.fn(),
}));

vi.mock('@/lib/db-client', () => mocks);
vi.mock('@/lib/refund-identity-claim', () => ({
  ensureRefundIdentityClaims: vi.fn(async (): Promise<void> => {}),
}));

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
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execSql.mockResolvedValue({ rows: [], rowCount: 0 });
    client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
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
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ version: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({
      rows: [{
        preset_id: preset.id,
        version: 3,
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
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const input = { ...preset };
    delete (input as Partial<typeof input>).version;
    await expect(dbCreatePlatformExportPresetVersion(input, 1)).resolves.toEqual({ ...preset, version: 3 });
    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements[2]).toContain('MAX(version)');
    expect(statements[2]).toContain('GREATEST');
    expect(client.query.mock.calls[2][1]).toEqual([preset.id, 1]);
    expect(statements[3]).toContain('INSERT INTO wujie_platform_export_presets');
    expect(statements[4]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and exposes a named conflict when the atomic insert conflicts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ version: 2 }], rowCount: 1 })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const input = { ...preset };
    delete (input as Partial<typeof input>).version;

    await expect(dbCreatePlatformExportPresetVersion(input, 0)).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_VERSION_CONFLICT',
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('exposes a named storage error when the transaction connection cannot be opened', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getPool.mockReturnValue({
      connect: vi.fn().mockRejectedValue(new Error('connection unavailable')),
    });
    const input = { ...preset };
    delete (input as Partial<typeof input>).version;

    await expect(dbCreatePlatformExportPresetVersion(input, 0)).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
    });
    consoleError.mockRestore();
  });

  it.each([
    { label: 'starts a new non-built-in preset at v1', floor: 0, databaseVersion: 1, expected: 1 },
    { label: 'continues above a higher stored version', floor: 1, databaseVersion: 5, expected: 5 },
  ])('$label', async ({ floor, databaseVersion, expected }) => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ version: databaseVersion }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          preset_id: preset.id, version: expected, platform: preset.platform, usage: preset.usage,
          label: preset.label, width: preset.width, height: preset.height,
          recommended_format: preset.recommendedFormat,
          supports_transparency: preset.supportsTransparency, enabled: preset.enabled,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const input = { ...preset };
    delete (input as Partial<typeof input>).version;

    await expect(dbCreatePlatformExportPresetVersion(input, floor)).resolves.toMatchObject({ version: expected });
    expect(client.query.mock.calls[2][1]).toEqual([preset.id, floor]);
  });

  it('does not turn a storage read failure into an empty override set', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.execSql.mockRejectedValueOnce(new Error('database unavailable'));
    const { dbListPlatformExportPresets } = await import('@/lib/db-storage');

    await expect(dbListPlatformExportPresets()).rejects.toMatchObject({
      code: 'PLATFORM_EXPORT_PRESET_STORAGE_UNAVAILABLE',
    });
    consoleError.mockRestore();
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

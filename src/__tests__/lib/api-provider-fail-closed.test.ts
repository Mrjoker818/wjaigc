import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ sql: vi.fn(), read: vi.fn(), write: vi.fn(), mkdir: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', async original => ({
  ...await original<typeof import('@/lib/db-client')>(), execSql: io.sql,
  getPool: (): never => { throw new Error('Pool access forbidden in offline test'); },
}));
vi.mock('fs/promises', async original => ({
  ...await original<typeof import('fs/promises')>(), readFile: io.read, writeFile: io.write, mkdir: io.mkdir,
}));
import { getApiProviders, updateApiProvider } from '@/lib/server-api-config';
import { dbGetApiProviders, migrateFileDataToDb } from '@/lib/db-storage';
import { prepareImageEditModelPlan } from '@/lib/task-core/image-edit-model-plan';

const oldFile = JSON.stringify({ providers: [{ id: 'stale', name: 'Stale provider', apiKey: 'stale-key', baseUrl: 'https://stale.invalid',
  isEnabled: true, type: 'image', modelType: 'image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }] });
const row = { id: 'db-provider', name: 'DB provider', display_name: 'DB provider', api_key: 'offline-db',
  base_url: 'https://db.invalid', is_enabled: true, type: 'image', model_type: 'image', selected_models: ['gpt-image-1'],
  request_style: 'images-generations', advanced_params: {}, created_at: 1, updated_at: 1 };
function fileMode(): void { vi.stubEnv('DATABASE_URL', ''); vi.stubEnv('PGDATABASE_URL', ''); }
function assertReadOnly(): void {
  for (const [sql] of io.sql.mock.calls) expect(sql).toMatch(/^SELECT \* FROM wujie_api_providers ORDER BY/);
  expect(io.write).not.toHaveBeenCalled();
  expect(io.mkdir).not.toHaveBeenCalled();
}
beforeEach((): void => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('PGDATABASE_URL', 'postgresql://postgres@127.0.0.1:55492/wujie_offline_mock_never_connect');
  io.sql.mockResolvedValue({ rows: [], rowCount: 0 });
  io.read.mockResolvedValue(oldFile);
  vi.stubGlobal('fetch', vi.fn((): never => { throw new Error('Network forbidden'); }));
});
afterEach((): void => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('real provider configuration chain strict read', (): void => {
  it('db strict getter propagates SQL errors; default getter remains compatible', async (): Promise<void> => {
    io.sql.mockRejectedValue(new Error('offline-db-failed'));
    await expect(dbGetApiProviders({ throwOnError: true })).rejects.toThrow('offline-db-failed');
    expect(await dbGetApiProviders()).toEqual([]);
  });
  it('does not resurrect stale file credentials on database failure', async (): Promise<void> => {
    io.sql.mockRejectedValue(new Error('offline-db-failed'));
    await expect(getApiProviders({ strict: true })).rejects.toThrow('offline-db-failed');
    expect(io.read).not.toHaveBeenCalled();
    assertReadOnly();
  });
  it('treats authoritative empty database as empty even with stale file providers', async (): Promise<void> => {
    expect(await getApiProviders({ strict: true })).toEqual([]);
    expect(io.read).not.toHaveBeenCalled();
    assertReadOnly();
  });
  it('normalizes a valid database row without file fallback or migration', async (): Promise<void> => {
    io.sql.mockResolvedValue({ rows: [row], rowCount: 1 });
    expect(await getApiProviders({ strict: true })).toEqual([expect.objectContaining({ id: 'db-provider',
      apiKey: 'offline-db', selectedModels: ['gpt-image-1'], modelType: 'image' })]);
    expect(io.read).not.toHaveBeenCalled();
    assertReadOnly();
  });
  it('reads valid file only when database is not configured and never migrates it', async (): Promise<void> => {
    fileMode();
    expect(await getApiProviders({ strict: true })).toEqual([expect.objectContaining({ id: 'stale' })]);
    expect(io.sql).not.toHaveBeenCalled();
    assertReadOnly();
  });
  it('accepts missing file as empty configuration only in file mode', async (): Promise<void> => {
    fileMode(); io.read.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await getApiProviders({ strict: true })).toEqual([]);
    expect(io.sql).not.toHaveBeenCalled();
    assertReadOnly();
  });
  it.each(['{', '{}', '{"providers":{}}', 'null', '[]'])('rejects malformed configuration %s', async (content): Promise<void> => {
    fileMode(); io.read.mockResolvedValue(content);
    await expect(getApiProviders({ strict: true })).rejects.toThrow();
    expect(io.sql).not.toHaveBeenCalled();
    assertReadOnly();
  });
  it('propagates unreadable files instead of declaring an empty configuration', async (): Promise<void> => {
    fileMode(); io.read.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(getApiProviders({ strict: true })).rejects.toThrow('denied');
    assertReadOnly();
  });
  it('default read retains file fallback after empty database or database failure', async (): Promise<void> => {
    expect(await getApiProviders({ migrateFileProviders: false })).toEqual([expect.objectContaining({ id: 'stale' })]);
    io.sql.mockRejectedValue(new Error('offline-db-failed'));
    expect(await getApiProviders({ migrateFileProviders: false })).toEqual([expect.objectContaining({ id: 'stale' })]);
    expect(io.read).toHaveBeenCalledTimes(2);
    assertReadOnly();
  });
  it('real planner maps underlying SQL exception to a sanitized 503 instead of stale execution', async (): Promise<void> => {
    io.sql.mockRejectedValue(new Error('do-not-expose-offline-secret'));
    await expect(prepareImageEditModelPlan({ action: 'mask', source: 'cookie',
      user: { id: 'actor', name: 'actor', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 } }))
      .rejects.toMatchObject({ status: 503, code: 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE', message: 'IMAGE_EDIT_MODEL_PLAN_UNAVAILABLE' });
    expect(io.read).not.toHaveBeenCalled();
    assertReadOnly();
  });
});

describe('deployment database credentials', () => {
  beforeEach(() => {
    vi.stubEnv('WUJIE_DEPLOYMENT_DB_ONLY', '1');
    vi.stubEnv('WUJIE_BOOTSTRAP_PROVIDERS_JSON', '');
  });

  it('ignores a legacy provider file when a deployed database is empty', async () => {
    expect(await getApiProviders()).toEqual([]);
    expect(io.read).not.toHaveBeenCalled();
  });

  it('reports a database failure without returning a legacy provider file', async () => {
    io.sql.mockRejectedValue(new Error('synthetic-private-database-value'));
    await expect(getApiProviders()).rejects.toThrow('DEPLOYMENT_PROVIDER_CONFIGURATION_UNAVAILABLE');
    expect(io.read).not.toHaveBeenCalled();
  });

  it('does not import or regenerate legacy credential files on deployed startup', async () => {
    await migrateFileDataToDb();
    expect(io.read).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
    expect(io.sql).not.toHaveBeenCalled();
  });

  it('stores an administrator model change in PostgreSQL without a file copy', async () => {
    io.sql.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT * FROM wujie_api_providers') ? [row] : [],
      rowCount: 1,
    }));
    const provider = await updateApiProvider('db-provider', { selectedModels: ['next-image'] });
    expect(provider?.selectedModels).toEqual(['next-image']);
    expect(io.sql.mock.calls.filter(([sql]) => sql.includes('INSERT INTO wujie_api_providers'))).toHaveLength(1);
    expect(io.write).not.toHaveBeenCalled();
    expect(io.mkdir).not.toHaveBeenCalled();
  });
});

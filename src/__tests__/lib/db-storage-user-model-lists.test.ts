import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execSql: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, getPool: vi.fn() }));
import { dbWriteUsers } from '@/lib/db-storage';

describe('user model permission list database storage', () => {
  const user = {
    id: 'synthetic-model-list-user', name: 'Synthetic model list', passwordHash: 'synthetic-hash',
    role: 'user', status: 'active', apiPermissions: { image: true, chat: true },
    storageFolder: 'synthetic-model-list-user', createdAt: 1, updatedAt: 2,
  };
  let columns: Array<{ column_name: string; data_type: string; udt_name: string }>;
  beforeEach(() => {
    vi.clearAllMocks();
    columns = ['chat_models', 'image_models'].map(column_name => ({
      column_name, data_type: 'ARRAY', udt_name: '_text',
    }));
    mocks.execSql.mockImplementation(async (sql: string) => (
      sql.includes('information_schema.columns')
        ? { rows: columns, rowCount: columns.length } : { rows: [], rowCount: 1 }
    ));
  });
  function insertedParameters(): unknown[] {
    const insert = mocks.execSql.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wujie_users'));
    expect(insert).toBeDefined();
    return insert![1] as unknown[];
  }
  it('writes native TEXT[] without corrupting punctuation or Unicode model names', async () => {
    const chatModels = ['pear/model-v1', '视觉,"alpha"\\beta'];
    const imageModels = ['image-v2'];
    await expect(dbWriteUsers([{ ...user, chatModels, imageModels }])).resolves.toBe(true);
    expect(insertedParameters().slice(7, 9)).toEqual([chatModels, imageModels]);
  });
  it('preserves explicit empty TEXT[] as empty model grants', async () => {
    await expect(dbWriteUsers([{ ...user, chatModels: [], imageModels: [] }])).resolves.toBe(true);
    expect(insertedParameters().slice(7, 9)).toEqual([[], []]);
  });
  it('preserves unspecified and null lists as null', async () => {
    await expect(dbWriteUsers([{ ...user, imageModels: null }])).resolves.toBe(true);
    expect(insertedParameters().slice(7, 9)).toEqual([null, null]);
  });
  it('retains historical JSONB storage encoding', async () => {
    columns = columns.map(column => ({ ...column, data_type: 'jsonb', udt_name: 'jsonb' }));
    await expect(dbWriteUsers([{ ...user, chatModels: ['chat-1'], imageModels: [] }])).resolves.toBe(true);
    expect(insertedParameters().slice(7, 9)).toEqual(['["chat-1"]', '[]']);
  });
  it('encodes each column independently for a mixed historical schema', async () => {
    columns[1] = { column_name: 'image_models', data_type: 'text', udt_name: 'text' };
    await expect(dbWriteUsers([{ ...user, chatModels: ['chat-1'], imageModels: ['image-1'] }])).resolves.toBe(true);
    expect(insertedParameters().slice(7, 9)).toEqual([['chat-1'], '["image-1"]']);
  });
  it('does not write when schema inspection fails', async () => {
    mocks.execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) throw new Error('synthetic schema unavailable');
      return { rows: [], rowCount: 1 };
    });
    await expect(dbWriteUsers([{ ...user, chatModels: [] }])).resolves.toBe(false);
    expect(mocks.execSql.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO wujie_users'))).toBe(false);
  });
});

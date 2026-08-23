import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execSql: vi.fn(),
  readFile: vi.fn(),
  writeFileSync: vi.fn(),
  writeAuthJsonFileAtomic: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({
  execSql: mocks.execSql,
  getPool: vi.fn(),
}));

vi.mock('@/lib/server-data-root', () => ({
  getServerSystemDir: () => '/fixture/system',
}));

vi.mock('fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs/promises')>();
  return {
    ...original,
    readFile: mocks.readFile,
  };
});

vi.mock('@/lib/auth/auth-persistence', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/auth-persistence')>();
  return {
    ...original,
    writeAuthJsonFileAtomic: mocks.writeAuthJsonFileAtomic,
  };
});

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    default: {
      ...original,
      writeFileSync: mocks.writeFileSync,
    },
    writeFileSync: mocks.writeFileSync,
  };
});

import { migrateFileDataToDb } from '@/lib/db-storage';

const missingFile = Object.assign(new Error('missing fixture file'), { code: 'ENOENT' });
const originalPersistenceMode = process.env.WUJIE_AUTH_PERSISTENCE_MODE;

describe('file to database user migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_PLUS_FILE';
    mocks.execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM wujie_users')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (!filePath.endsWith('users.json')) throw missingFile;
      return JSON.stringify({
        users: [{
          id: 'legacy-profile-user',
          name: 'Legacy Profile User',
          passwordHash: 'a'.repeat(64),
          credentialHash: 'scrypt-v1$32768$8$1$sidecar',
          role: 'user',
          status: 'active',
          productType: 'canvas,chat',
          groupId: 'group-pro',
          chatModels: ['chat-pro'],
          imageModels: ['image-pro'],
          dailyTokenLimit: 101,
          monthlyTokenLimit: 202,
          dailyImageLimit: 303,
          avatar: '/avatar.png',
          nickname: 'Profile',
          apiPermissions: { image: true, chat: true },
          storageFolder: 'data/users/legacy-profile-user',
          email: 'profile@example.test',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_001,
        }],
      });
    });
  });

  afterAll(() => {
    if (originalPersistenceMode === undefined) delete process.env.WUJIE_AUTH_PERSISTENCE_MODE;
    else process.env.WUJIE_AUTH_PERSISTENCE_MODE = originalPersistenceMode;
  });

  it('preserves the complete user profile without overwriting a concurrent database row', async () => {
    await migrateFileDataToDb();

    const insert = mocks.execSql.mock.calls.find(([sql]) => (
      String(sql).includes('INSERT INTO wujie_users')
    ));
    expect(insert).toBeDefined();

    const [sql, params] = insert as [string, unknown[]];
    expect(sql).toContain('product_type');
    expect(sql).toContain('chat_models');
    expect(sql).toContain('image_models');
    expect(sql).toContain('daily_token_limit');
    expect(sql).toContain('monthly_token_limit');
    expect(sql).toContain('daily_image_limit');
    expect(sql).toContain('avatar');
    expect(sql).toContain('nickname');
    expect(sql).toContain('group_id');
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(params).toEqual([
      'legacy-profile-user',
      'Legacy Profile User',
      'a'.repeat(64),
      'scrypt-v1$32768$8$1$sidecar',
      'user',
      'active',
      'canvas,chat',
      ['chat-pro'],
      ['image-pro'],
      101,
      202,
      303,
      '/avatar.png',
      'Profile',
      JSON.stringify({ image: true, chat: true }),
      'data/users/legacy-profile-user',
      'profile@example.test',
      'group-pro',
      1_700_000_000_000,
      1_700_000_000_001,
    ]);
  });

  it('writes a stable-compatible camelCase file replica for database-only users', async () => {
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (!filePath.endsWith('users.json')) throw missingFile;
      return JSON.stringify({ users: [] });
    });
    mocks.execSql.mockImplementation(async (sql: string) => {
      if (!sql.includes('SELECT * FROM wujie_users')) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          id: 'database-only-user',
          name: 'Database Only User',
          password_hash: 'b'.repeat(64),
          credential_hash: 'scrypt-v1$32768$8$1$database-sidecar',
          role: 'user',
          status: 'active',
          product_type: 'canvas,chat',
          chat_models: ['chat-db'],
          image_models: ['image-db'],
          daily_token_limit: 11,
          monthly_token_limit: 22,
          daily_image_limit: 33,
          avatar: '/db-avatar.png',
          nickname: 'Database',
          api_permissions: { image: true, chat: true },
          storage_folder: 'data/users/database-only-user',
          email: 'database@example.test',
          group_id: 'group-db',
          created_at: 1_700_000_000_010,
          updated_at: 1_700_000_000_011,
        }],
        rowCount: 1,
      };
    });

    await migrateFileDataToDb();

    expect(mocks.writeAuthJsonFileAtomic).toHaveBeenCalledTimes(1);
    const [, replica] = mocks.writeAuthJsonFileAtomic.mock.calls[0] as [string, {
      users: Array<Record<string, unknown>>;
      updatedAt: number;
    }];
    expect(Number.isSafeInteger(replica.updatedAt)).toBe(true);
    expect(replica.users).toEqual([{
      id: 'database-only-user',
      name: 'Database Only User',
      passwordHash: 'b'.repeat(64),
      credentialHash: 'scrypt-v1$32768$8$1$database-sidecar',
      role: 'user',
      status: 'active',
      productType: 'canvas,chat',
      groupId: 'group-db',
      chatModels: ['chat-db'],
      imageModels: ['image-db'],
      dailyTokenLimit: 11,
      monthlyTokenLimit: 22,
      dailyImageLimit: 33,
      avatar: '/db-avatar.png',
      nickname: 'Database',
      apiPermissions: { image: true, chat: true },
      storageFolder: 'data/users/database-only-user',
      email: 'database@example.test',
      createdAt: 1_700_000_000_010,
      updatedAt: 1_700_000_000_011,
    }]);
  });

  it('replaces stale file rows with the database-authoritative replica', async () => {
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (!filePath.endsWith('users.json')) throw missingFile;
      return JSON.stringify({
        users: [{
          id: 'shared-user',
          name: 'Stale File Name',
          passwordHash: 'c'.repeat(64),
          role: 'admin',
          status: 'active',
          productType: 'canvas',
          createdAt: 1,
          updatedAt: 1,
        }],
      });
    });
    mocks.execSql.mockImplementation(async (sql: string) => {
      if (!sql.includes('SELECT * FROM wujie_users')) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: 'shared-user',
          name: 'Database Name',
          password_hash: 'd'.repeat(64),
          credential_hash: null,
          role: 'user',
          status: 'disabled',
          product_type: 'canvas,chat',
          chat_models: [],
          image_models: [],
          api_permissions: { image: false, chat: true },
          storage_folder: 'data/users/shared-user',
          created_at: 10,
          updated_at: 20,
        }],
        rowCount: 1,
      };
    });

    await migrateFileDataToDb();

    expect(mocks.writeAuthJsonFileAtomic).toHaveBeenCalledTimes(1);
    const replica = mocks.writeAuthJsonFileAtomic.mock.calls[0]?.[1] as {
      users: Array<Record<string, unknown>>;
    };
    expect(replica.users).toEqual([expect.objectContaining({
      id: 'shared-user',
      name: 'Database Name',
      passwordHash: 'd'.repeat(64),
      role: 'user',
      status: 'disabled',
      productType: 'canvas,chat',
    })]);
  });

  it('does not write an authentication file replica in DB_ONLY mode', async () => {
    process.env.WUJIE_AUTH_PERSISTENCE_MODE = 'DB_ONLY';
    mocks.readFile.mockRejectedValue(missingFile);
    mocks.execSql.mockImplementation(async (sql: string) => (
      sql.includes('SELECT * FROM wujie_users')
        ? { rows: [{
          id: 'database-only-user',
          name: 'Database Only User',
          password_hash: 'e'.repeat(64),
          credential_hash: null,
          role: 'user',
          status: 'active',
          product_type: 'canvas,chat',
          chat_models: [],
          image_models: [],
          api_permissions: {},
          storage_folder: 'data/users/database-only-user',
          created_at: 10,
          updated_at: 20,
        }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));

    await migrateFileDataToDb();

    expect(mocks.writeAuthJsonFileAtomic).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it('continues migrating later users when one file row is invalid', async () => {
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (!filePath.endsWith('users.json')) throw missingFile;
      return JSON.stringify({
        users: [
          { id: 'invalid-user', name: 'Invalid', passwordHash: 'x' },
          { id: 'valid-user', name: 'Valid', passwordHash: 'f'.repeat(64) },
        ],
      });
    });
    mocks.execSql.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT * FROM wujie_users')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO wujie_users') && params?.[0] === 'invalid-user') {
        throw new Error('invalid fixture row');
      }
      return { rows: [], rowCount: 1 };
    });

    await migrateFileDataToDb();

    const insertedIds = mocks.execSql.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO wujie_users'))
      .map(([, params]) => (params as unknown[])[0]);
    expect(insertedIds).toEqual(['invalid-user', 'valid-user']);
  });

  it('preserves the existing rollback file when the database read fails', async () => {
    mocks.execSql.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM wujie_users')) throw new Error('database unavailable');
      return { rows: [], rowCount: 0 };
    });

    await migrateFileDataToDb();

    expect(mocks.writeAuthJsonFileAtomic).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects malformed model arrays and removes non-boolean permission values', async () => {
    mocks.readFile.mockImplementation(async (filePath: string) => {
      if (!filePath.endsWith('users.json')) throw missingFile;
      return JSON.stringify({
        users: [{
          id: 'dirty-profile-user',
          name: 'Dirty Profile',
          passwordHash: 'f'.repeat(64),
          chatModels: ['chat-valid', 42],
          imageModels: ['image-valid'],
          apiPermissions: { image: 'yes', chat: true, video: false },
        }],
      });
    });

    await migrateFileDataToDb();

    const insert = mocks.execSql.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wujie_users'));
    const params = insert?.[1] as unknown[];
    expect(params[7]).toBeNull();
    expect(params[8]).toEqual(['image-valid']);
    expect(params[14]).toBe(JSON.stringify({ chat: true, video: false }));
  });
});

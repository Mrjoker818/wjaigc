import { beforeEach, describe, expect, it, vi } from 'vitest';

import { project } from '@/__tests__/fixtures/simple-chat-sync';

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: mocks.getPool }));

import {
  compareAndSetSimpleChatSnapshot,
  parseStoredSimpleChatSnapshot,
  readSimpleChatSnapshot,
  SimpleChatSyncConflictError,
} from '@/lib/simple-chat-sync-server';

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function useClient(query: MockClient['query']): MockClient {
  const client = { query, release: vi.fn() };
  mocks.getPool.mockReturnValue({
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  });
  return client;
}

function normalizedSql(client: MockClient): string[] {
  return client.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());
}

describe('simple chat server snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads a legacy array as schema version one at revision zero', () => {
    expect(parseStoredSimpleChatSnapshot([project('legacy')])).toEqual({
      schemaVersion: 1,
      revision: 0,
      projects: [project('legacy')],
    });
  });

  it('reads a valid versioned snapshot', () => {
    const stored = { schemaVersion: 1, revision: 7, projects: [project('versioned')] };
    expect(parseStoredSimpleChatSnapshot(stored)).toEqual(stored);
  });

  it.each([
    ['schema', { schemaVersion: 2, revision: 0, projects: [] }],
    ['negative revision', { schemaVersion: 1, revision: -1, projects: [] }],
    ['fractional revision', { schemaVersion: 1, revision: 1.5, projects: [] }],
    ['projects', { schemaVersion: 1, revision: 0, projects: [{}] }],
  ])('fails closed for invalid stored %s', (_label, stored) => {
    expect(() => parseStoredSimpleChatSnapshot(stored)).toThrow(/invalid simple chat snapshot/i);
  });

  it('reads only the fixed logical key for the requested user', async () => {
    const query = vi.fn(async (_sql: string, params?: unknown[]) => {
      expect(params).toEqual(['user-b', 'simple-chat-sync:user-b:chat_simple_projects']);
      return {
        rows: [{ data_value: { schemaVersion: 1, revision: 3, projects: [project('b')] } }],
        rowCount: 1,
      };
    });
    mocks.getPool.mockReturnValue({ query });

    await expect(readSimpleChatSnapshot('user-b')).resolves.toMatchObject({
      revision: 3,
      projects: [{ id: 'b' }],
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('creates the first snapshot with revision one in one locked transaction', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT data_value')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO')) {
        expect(params?.[0]).toBe('user-a');
        expect(params?.[1]).toBe('simple-chat-sync:user-a:chat_simple_projects');
        expect(JSON.parse(String(params?.[2]))).toEqual({
          schemaVersion: 1,
          revision: 1,
          projects: [project('a')],
        });
        expect(params?.[3]).toBe(1234);
      }
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);

    await expect(compareAndSetSimpleChatSnapshot({
      userId: 'user-a',
      expectedRevision: 0,
      projects: [project('a')],
      now: 1234,
    })).resolves.toEqual({
      schemaVersion: 1,
      revision: 1,
      projects: [project('a')],
    });

    expect(normalizedSql(client)).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      'SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = $2 FOR UPDATE',
      expect.stringContaining('INSERT INTO wujie_user_data'),
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1]?.[1]).toEqual([
      'simple-chat-sync:user-a:chat_simple_projects',
    ]);
    expect(mocks.getPool().query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('reports the current revision on a compare-and-set conflict', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT data_value')) {
        return {
          rows: [{ data_value: { schemaVersion: 1, revision: 4, projects: [project('remote')] } }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);

    const error = await compareAndSetSimpleChatSnapshot({
      userId: 'user-a',
      expectedRevision: 3,
      projects: [project('local')],
    }).catch(value => value);

    expect(error).toBeInstanceOf(SimpleChatSyncConflictError);
    expect(error).toMatchObject({ code: 'CHAT_SYNC_CONFLICT', currentRevision: 4 });
    expect(normalizedSql(client)).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      'SELECT data_value FROM wujie_user_data WHERE user_id = $1 AND data_key = $2 FOR UPDATE',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects invalid projects before acquiring a database client', async () => {
    await expect(compareAndSetSimpleChatSnapshot({
      userId: 'user-a',
      expectedRevision: 0,
      projects: [{}] as never,
    })).rejects.toThrow(/invalid simple chat projects/i);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('rejects an expected revision that cannot be incremented safely', async () => {
    await expect(compareAndSetSimpleChatSnapshot({
      userId: 'user-a',
      expectedRevision: Number.MAX_SAFE_INTEGER,
      projects: [],
    })).rejects.toThrow(/invalid simple chat expected revision/i);
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('rolls back before releasing when a write fails', async () => {
    const writeError = new Error('write failed');
    const events: string[] = [];
    const query = vi.fn(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      events.push(normalized);
      if (sql.includes('SELECT data_value')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO')) throw writeError;
      return { rows: [], rowCount: 0 };
    });
    const client = useClient(query);
    client.release.mockImplementation(() => events.push('RELEASE'));

    await expect(compareAndSetSimpleChatSnapshot({
      userId: 'user-a',
      expectedRevision: 0,
      projects: [project('a')],
    })).rejects.toBe(writeError);
    expect(events.at(-2)).toBe('ROLLBACK');
    expect(events.at(-1)).toBe('RELEASE');
  });
});

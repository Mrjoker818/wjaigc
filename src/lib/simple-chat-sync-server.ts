import 'server-only';

import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';
import { getPool } from '@/lib/db-client';
import { validateSimpleChatProjects } from '@/lib/simple-chat-project-sync';

export interface SimpleChatStoredSnapshot {
  schemaVersion: 1;
  revision: number;
  projects: SimpleChatProject[];
}

export class SimpleChatSyncConflictError extends Error {
  readonly code = 'CHAT_SYNC_CONFLICT';

  constructor(readonly currentRevision: number) {
    super('智能对话数据已在其他位置更新');
    this.name = 'SimpleChatSyncConflictError';
  }
}

const DATA_KEY_SUFFIX = 'chat_simple_projects';

function dataKeyForUser(userId: string): string {
  return `simple-chat-sync:${userId}:${DATA_KEY_SUFFIX}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertValidProjects(
  value: unknown,
  errorPrefix = 'Invalid simple chat snapshot',
): asserts value is SimpleChatProject[] {
  if (!Array.isArray(value)) {
    throw new Error(`${errorPrefix}: projects`);
  }
  const validation = validateSimpleChatProjects(value as SimpleChatProject[]);
  if (!validation.success) {
    throw new Error(`${errorPrefix}: ${validation.field}`);
  }
}

function assertExpectedRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid simple chat expected revision');
  }
}

export function parseStoredSimpleChatSnapshot(value: unknown): SimpleChatStoredSnapshot {
  if (Array.isArray(value)) {
    assertValidProjects(value);
    return { schemaVersion: 1, revision: 0, projects: value };
  }

  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
  ) {
    throw new Error('Invalid simple chat snapshot: schema or revision');
  }
  assertValidProjects(value.projects);
  return {
    schemaVersion: 1,
    revision: value.revision as number,
    projects: value.projects,
  };
}

export async function readSimpleChatSnapshot(
  userId: string,
): Promise<SimpleChatStoredSnapshot> {
  const dataKey = dataKeyForUser(userId);
  const result = await getPool().query<{ data_value: unknown }>(
    `SELECT data_value
     FROM wujie_user_data
     WHERE user_id = $1 AND data_key = $2`,
    [userId, dataKey],
  );
  const row = result.rows[0];
  if (!row) return { schemaVersion: 1, revision: 0, projects: [] };
  return parseStoredSimpleChatSnapshot(row.data_value);
}

export async function compareAndSetSimpleChatSnapshot(input: {
  userId: string;
  expectedRevision: number;
  projects: SimpleChatProject[];
  now?: number;
}): Promise<SimpleChatStoredSnapshot> {
  assertExpectedRevision(input.expectedRevision);
  assertValidProjects(input.projects, 'Invalid simple chat projects');

  const dataKey = dataKeyForUser(input.userId);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [dataKey],
    );
    const result = await client.query<{ data_value: unknown }>(
      `SELECT data_value
       FROM wujie_user_data
       WHERE user_id = $1 AND data_key = $2
       FOR UPDATE`,
      [input.userId, dataKey],
    );
    const row = result.rows[0];
    const current = row
      ? parseStoredSimpleChatSnapshot(row.data_value)
      : { schemaVersion: 1 as const, revision: 0, projects: [] };
    if (current.revision !== input.expectedRevision) {
      throw new SimpleChatSyncConflictError(current.revision);
    }

    const snapshot: SimpleChatStoredSnapshot = {
      schemaVersion: 1,
      revision: input.expectedRevision + 1,
      projects: input.projects,
    };
    const params = [
      input.userId,
      dataKey,
      JSON.stringify(snapshot),
      input.now ?? Date.now(),
    ];
    if (row) {
      await client.query(
        `UPDATE wujie_user_data
         SET data_value = $3::jsonb, updated_at = $4
         WHERE user_id = $1 AND data_key = $2`,
        params,
      );
    } else {
      await client.query(
        `INSERT INTO wujie_user_data (user_id, data_key, data_value, updated_at)
         VALUES ($1, $2, $3::jsonb, $4)`,
        params,
      );
    }
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('authentication rollback replica refresh', () => {
  it('reads the authoritative database store inside the cross-process database lock', () => {
    const serverAuthSource = readFileSync(path.resolve(process.cwd(), 'src/lib/server-auth.ts'), 'utf8');
    const start = serverAuthSource.indexOf('async function refreshUserFileReplicaBestEffort()');
    const end = serverAuthSource.indexOf('\nasync function readStore()', start);
    const refresh = serverAuthSource.slice(start, end);
    const migrationSource = readFileSync(path.resolve(process.cwd(), 'src/lib/db-storage.ts'), 'utf8');
    const migrationStart = migrationSource.indexOf('// In DB_PLUS_FILE mode');
    const migrationEnd = migrationSource.indexOf('// Migrate API providers', migrationStart);
    const migrationRefresh = migrationSource.slice(migrationStart, migrationEnd);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(refresh).toContain('withDatabaseAuthReplicaLock(async client => {');
    expect(refresh).toContain('refreshAuthJsonFileAtomic(USERS_PATH, async () => {');
    expect(refresh.indexOf('readDatabaseStore(client)')).toBeGreaterThan(
      refresh.indexOf('withDatabaseAuthReplicaLock(async client => {'),
    );
    expect(refresh).not.toContain('writeUsersFile(');
    expect(migrationRefresh).toContain('withDatabaseAuthReplicaLock(async client => {');
    expect(migrationRefresh).toContain('dbReadUsersWithClient(client)');
  });
});

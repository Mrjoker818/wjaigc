const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'] as const;

export function resolveIsolatedChildDatabaseAliases(parent: Readonly<NodeJS.ProcessEnv>): Record<(typeof aliases)[number], string> {
  const connectionString = parent.POSTGRES_TEST_DATABASE_URL;
  if (!connectionString || aliases.some(alias => parent[alias] !== connectionString)) {
    throw new Error('Isolated child database boundary rejected: four matching parent aliases are required');
  }
  let database: URL;
  try {
    database = new URL(connectionString);
  } catch {
    throw new Error('Isolated child database boundary rejected: invalid parent database identity');
  }
  if (database.protocol !== 'postgresql:' || database.hostname !== '127.0.0.1'
    || !/^[0-9]+$/.test(database.port) || Number(database.port) < 1024 || Number(database.port) > 65535
    || !/^\/wujie_bridge_test_[a-z0-9_]+$/.test(database.pathname)
    || database.search !== '' || database.hash !== '') {
    throw new Error('Isolated child database boundary rejected: explicit dedicated loopback PostgreSQL identity required');
  }
  return {
    DATABASE_URL: connectionString,
    PGDATABASE_URL: connectionString,
    POSTGRES_TEST_DATABASE_URL: connectionString,
    TEST_POSTGRES_URL: connectionString,
  };
}

// Offline fixtures keep their original guards; only an explicitly selected worker file uses this scope.
const offlineDatabaseBinding = /^(PG|DATABASE|POSTGRES|TEST_POSTGRES|COZE_SUPABASE)|^WUJIE_.*DB|^WUJIE_AUTH_PERSISTENCE_MODE$/;

export function scopeOfflineDatabaseEnvironment(environment: NodeJS.ProcessEnv): () => void {
  const inherited = new Map(Object.keys(environment)
    .filter(key => offlineDatabaseBinding.test(key))
    .map(key => [key, environment[key]] as const));
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    for (const key of Object.keys(environment)) {
      if (offlineDatabaseBinding.test(key)) delete environment[key];
    }
    for (const [key, value] of inherited) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
    inherited.clear();
    restored = true;
  };
  try {
    for (const key of inherited.keys()) delete environment[key];
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

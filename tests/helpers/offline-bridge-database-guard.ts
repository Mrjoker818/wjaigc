export function requireOfflineBridgeTestDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const keys = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'] as const;
  const connectionString = environment.POSTGRES_TEST_DATABASE_URL;
  if (!connectionString || keys.some(key => environment[key] !== connectionString)) {
    throw new Error('Offline bridge test requires four matching database URL variables');
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Offline bridge test database URL is invalid');
  }
  if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1'
    || !/^[0-9]+$/.test(parsed.port) || Number(parsed.port) < 1024
    || Number(parsed.port) > 65535 || !/^\/wujie_bridge_test_[a-z0-9_]+$/.test(parsed.pathname)
    || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('Offline bridge test requires an explicit dedicated loopback database');
  }
  return connectionString;
}

export function isActiveOfflineBridgeTestConnection(environment: NodeJS.ProcessEnv, candidate: string): boolean {
  try {
    const base = requireOfflineBridgeTestDatabaseUrl({
      ...environment,
      DATABASE_URL: environment.POSTGRES_TEST_DATABASE_URL,
      PGDATABASE_URL: environment.POSTGRES_TEST_DATABASE_URL,
    });
    if (candidate !== environment.DATABASE_URL || candidate !== environment.PGDATABASE_URL) return false;
    if (candidate === base) return true;
    const parsed = new URL(candidate);
    if (parsed.searchParams.size !== 1
      || !/^-csearch_path=test_[a-z0-9_]{1,58}$/.test(parsed.searchParams.get('options') || '')
      || parsed.hash !== '') return false;
    parsed.searchParams.delete('options');
    return parsed.toString() === new URL(base).toString();
  } catch {
    return false;
  }
}

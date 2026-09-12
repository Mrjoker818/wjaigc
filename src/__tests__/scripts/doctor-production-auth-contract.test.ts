import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEST_DATABASE_URL = 'postgresql://doctor:doctor@127.0.0.1:1/wujie';
const CLEAN_ENVIRONMENT_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'COZE_BUCKET_ACCESS_KEY',
  'COZE_BUCKET_ENDPOINT_URL',
  'COZE_BUCKET_NAME',
  'COZE_BUCKET_SECRET_KEY',
  'DATABASE_URL',
  'PGDATABASE_URL',
  'POSTGRES_TEST_DATABASE_URL',
  'WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS',
  'WUJIE_AUTH_PERSISTENCE_MODE',
  'WUJIE_AUTH_SECRET',
] as const;

function doctorEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  remove: readonly string[] = [],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CLEAN_ENVIRONMENT_KEYS) delete environment[key];
  Object.assign(environment, {
    COZE_PROJECT_ENV: 'PROD',
    NODE_ENV: 'production',
    NEXTAUTH_SECRET: 'n'.repeat(32),
    INTERNAL_API_SECRET: 'i'.repeat(32),
    PAYMENT_TOKEN_SECRET: 'p'.repeat(32),
    WUJIE_ADMIN_PASSWORD: 'administrator-password',
    MANDATORY_API_AUTH: 'true',
    DOCTOR_SKIP_ENV_FILE: '1',
  }, overrides);
  for (const key of remove) delete environment[key];
  return environment;
}

function runDoctor(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  args: string[] = ['--production'],
  remove: readonly string[] = [],
) {
  return spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/doctor.mjs'), ...args], {
    cwd: process.cwd(),
    env: doctorEnvironment(overrides, remove),
    encoding: 'utf8',
  });
}

describe('production doctor authentication contract', () => {
  it('uses the runtime PostgreSQL connection contract for every application database probe', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/doctor.mjs'), 'utf8');
    expect(source).toContain("searchParams.set('uselibpqcompat', 'true')");
    expect(source).toContain("import { connectionOptions } from './run-migrations.mjs'");
    expect(source.match(/\.\.\.connectionOptions\(/g)).toHaveLength(6);
  });

  it('does not fail the GC output for normal due or physically deferred candidates', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/doctor.mjs'), 'utf8');
    expect(source).not.toContain('summary.gc.purged + summary.gc.due');
    expect(source).toContain('summary.gc.purged + summary.gc.unregistered + summary.gc.physicalFailed');
  });

  it('accepts NEXTAUTH_SECRET when WUJIE_AUTH_SECRET is absent', () => {
    const result = runDoctor();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[PASS] authentication-secret: configured');
    expect(result.stdout).not.toContain('WUJIE_AUTH_SECRET: missing or placeholder value');
  });

  it('keeps credential findings visible but non-blocking during an existing Coze startup', () => {
    const result = runDoctor({}, ['--startup'], [
      'NEXTAUTH_SECRET',
      'INTERNAL_API_SECRET',
      'PAYMENT_TOKEN_SECRET',
      'WUJIE_ADMIN_PASSWORD',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[WARN] authentication-secret:');
    expect(result.stdout).toContain('[WARN] WUJIE_ADMIN_PASSWORD:');
    expect(result.stdout).toContain('[FAIL] database:');
  });

  it('allows Coze startup to use managed object-storage credentials', () => {
    const result = runDoctor({
      COZE_BUCKET_ENDPOINT_URL: 'https://bucket.example.test',
      COZE_BUCKET_NAME: 'managed-bucket',
    }, ['--startup']);

    expect(result.stdout).toContain('[WARN] object-storage: bucket endpoint configured without explicit credentials; managed identity must be verified after startup');
    expect(result.stdout).not.toContain('[FAIL] object-storage:');
  });

  it('resolves an omitted production mode to DB_ONLY when a database URL exists', () => {
    const result = runDoctor({ PGDATABASE_URL: TEST_DATABASE_URL });

    expect(result.stdout).toContain('[PASS] auth-persistence-mode: DB_ONLY');
  });

  it('fails an omitted production mode when its no-database default is FILE_ONLY', () => {
    const result = runDoctor();

    expect(result.stdout).toContain(
      '[FAIL] auth-persistence-mode: file persistence is not allowed in production',
    );
  });

  it.each(['DB_ONLY', 'DB_PLUS_FILE'])('requires a database URL for production mode %s', mode => {
    const result = runDoctor({ WUJIE_AUTH_PERSISTENCE_MODE: mode });

    expect(result.stdout).toContain(
      '[FAIL] auth-persistence-mode: database URL is required for the configured mode',
    );
  });

  it.each([
    ['DB_ONLY', 'PGDATABASE_URL'],
    ['DB_PLUS_FILE', 'DATABASE_URL'],
  ])('accepts production mode %s with %s', (mode, databaseVariable) => {
    const result = runDoctor({
      WUJIE_AUTH_PERSISTENCE_MODE: mode,
      [databaseVariable]: TEST_DATABASE_URL,
    });

    expect(result.stdout).toContain(`[PASS] auth-persistence-mode: ${mode}`);
  });

  it('fails explicit FILE_ONLY in production', () => {
    const result = runDoctor({ WUJIE_AUTH_PERSISTENCE_MODE: 'FILE_ONLY' });

    expect(result.stdout).toContain(
      '[FAIL] auth-persistence-mode: file persistence is not allowed in production',
    );
  });

  it('fails an unsupported persistence mode without echoing its value', () => {
    const sentinel = 'SENSITIVE_UNSUPPORTED_AUTH_MODE';
    const result = runDoctor({ WUJIE_AUTH_PERSISTENCE_MODE: sentinel });

    expect(result.stdout).toContain('[FAIL] auth-persistence-mode: unsupported value');
    expect(result.stdout).not.toContain(sentinel);
  });

  it('retains the non-production FILE_ONLY default', () => {
    const result = runDoctor({
      COZE_PROJECT_ENV: 'DEV',
      NODE_ENV: 'test',
    }, []);

    expect(result.stdout).toContain('[PASS] auth-persistence-mode: FILE_ONLY');
  });

  it.each(['true', 'false'])('accepts the exact previous-session value %s', value => {
    const result = runDoctor({ WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS: value });

    expect(result.stdout).toContain('[PASS] auth-previous-sessions: configured');
  });

  it.each(['TRUE', ' true', 'false ', 'SENSITIVE_PREVIOUS_SESSION_VALUE'])(
    'fails invalid previous-session value %j without echoing it',
    value => {
      const result = runDoctor({ WUJIE_AUTH_ACCEPT_PREVIOUS_SESSIONS: value });

      const finding = result.stdout.split(/\r?\n/).find(line => (
        line.startsWith('[FAIL] auth-previous-sessions:')
      ));
      expect(finding).toBe(
        '[FAIL] auth-previous-sessions: value must be exactly true or false',
      );
      if (value.startsWith('SENSITIVE_')) expect(result.stdout).not.toContain(value);
    },
  );
});

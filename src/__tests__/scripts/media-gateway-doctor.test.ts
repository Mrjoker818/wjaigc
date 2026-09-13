import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DATABASE_PASSWORD_SENTINEL = 'MEDIA_GATEWAY_DATABASE_PASSWORD_SENTINEL';
const API_KEY_SENTINEL = 'MEDIA_GATEWAY_API_KEY_SENTINEL';

function runDoctor(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'DATABASE_URL',
    'PGDATABASE_URL',
    'POSTGRES_TEST_DATABASE_URL',
    'GATEWAY_ENABLED',
    'MEDIA_GATEWAY_API_KEY',
  ]) delete environment[key];

  Object.assign(environment, {
    COZE_PROJECT_ENV: 'DEV',
    NODE_ENV: 'test',
    DOCTOR_SKIP_ENV_FILE: '1',
    MEDIA_GATEWAY_API_KEY: API_KEY_SENTINEL,
  }, overrides);

  return spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/doctor.mjs')], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
  });
}

describe('media gateway doctor', () => {
  it('reports the default-disabled gateway as a non-failing warning', () => {
    const result = runDoctor();

    expect(result.stdout).toContain('[WARN] media-gateway: disabled');
    expect(result.stdout).not.toContain('[FAIL] media-gateway:');
    expect(result.stdout).not.toContain(API_KEY_SENTINEL);
  });

  it('fails closed when the enabled gateway database cannot be reached', () => {
    const result = runDoctor({
      GATEWAY_ENABLED: 'true',
      PGDATABASE_URL: `postgresql://doctor:${DATABASE_PASSWORD_SENTINEL}@127.0.0.1:1/wujie`,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[PASS] media-gateway: enabled');
    expect(result.stdout).toContain('[FAIL] media-gateway-database: verification failed');
    expect(result.stdout).not.toContain(DATABASE_PASSWORD_SENTINEL);
    expect(result.stdout).not.toContain(API_KEY_SENTINEL);
  });

  it('checks the complete existing gateway migration table contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/doctor.mjs'), 'utf8');

    expect(source).toContain('checkMediaGateway');
    expect(source).toContain('wujie_gateway_keys');
    expect(source).toContain('wujie_gateway_rate_windows');
    expect(source).toContain('wujie_gateway_requests');
    expect(source).toContain('required gateway tables verified');
  });

  it('verifies all gateway tables against the required real PostgreSQL test database', () => {
    const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
    expect(databaseUrl, 'POSTGRES_TEST_DATABASE_URL is required; this test must not be skipped').toBeTruthy();

    const result = runDoctor({
      GATEWAY_ENABLED: 'true',
      PGDATABASE_URL: databaseUrl,
      POSTGRES_TEST_DATABASE_URL: databaseUrl,
    });

    expect(result.stdout).toContain('[PASS] media-gateway: enabled');
    expect(result.stdout).toContain(
      '[PASS] media-gateway-database: required gateway tables verified: '
        + 'wujie_gateway_keys,wujie_gateway_rate_windows,wujie_gateway_requests',
    );
    expect(result.stdout).not.toContain(API_KEY_SENTINEL);
  });
});

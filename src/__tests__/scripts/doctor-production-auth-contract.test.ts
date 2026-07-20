import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production doctor authentication contract', () => {
  it('normalizes sslmode=require before creating the PostgreSQL client', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/doctor.mjs'), 'utf8');
    expect(source).toContain("searchParams.set('uselibpqcompat', 'true')");
    expect(source).toContain('new Client({ connectionString: normalizedConnectionString');
  });

  it('accepts NEXTAUTH_SECRET when WUJIE_AUTH_SECRET is absent', () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      COZE_PROJECT_ENV: 'PROD',
      NODE_ENV: 'production',
      NEXTAUTH_SECRET: 'n'.repeat(32),
      INTERNAL_API_SECRET: 'i'.repeat(32),
      PAYMENT_TOKEN_SECRET: 'p'.repeat(32),
      WUJIE_ADMIN_PASSWORD: 'administrator-password',
      MANDATORY_API_AUTH: 'true',
    };
    delete environment.WUJIE_AUTH_SECRET;
    delete environment.PGDATABASE_URL;
    delete environment.DATABASE_URL;

    const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/doctor.mjs'), '--production'], {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[PASS] authentication-secret: configured');
    expect(result.stdout).not.toContain('WUJIE_AUTH_SECRET: missing or placeholder value');
  });

  it('keeps credential findings visible but non-blocking during an existing Coze startup', () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      COZE_PROJECT_ENV: 'PROD',
      NODE_ENV: 'production',
    };
    delete environment.WUJIE_AUTH_SECRET;
    delete environment.NEXTAUTH_SECRET;
    delete environment.INTERNAL_API_SECRET;
    delete environment.PAYMENT_TOKEN_SECRET;
    delete environment.WUJIE_ADMIN_PASSWORD;
    delete environment.PGDATABASE_URL;
    delete environment.DATABASE_URL;

    const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/doctor.mjs'), '--startup'], {
      cwd: process.cwd(),
      env: environment,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[WARN] authentication-secret:');
    expect(result.stdout).toContain('[WARN] WUJIE_ADMIN_PASSWORD:');
    expect(result.stdout).toContain('[FAIL] database:');
  });
});

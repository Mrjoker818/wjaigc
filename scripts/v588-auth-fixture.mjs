import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment input: ${name}`);
  return value;
}

function randomSecret() {
  return randomBytes(36).toString('base64url');
}

function legacyHash(secret, password) {
  return createHash('sha256').update(`${secret}:${password}`).digest('hex');
}

async function prepare(root) {
  const runId = `v588-auth-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const dataDirectory = join(root, 'data');
  const systemDirectory = join(dataDirectory, 'system');
  const environmentPath = join(root, 'run-env.json');
  const authSecret = randomSecret();
  const admin = {
    id: `fixture-admin-${randomUUID()}`,
    name: `fixture-admin-${randomUUID()}`,
    password: randomSecret(),
    role: 'admin',
  };
  const user = {
    id: `fixture-user-${randomUUID()}`,
    name: `fixture-user-${randomUUID()}`,
    password: randomSecret(),
    role: 'user',
  };
  const now = Date.now();
  const storedUsers = [admin, user].map(account => ({
    id: account.id,
    name: account.name,
    passwordHash: legacyHash(authSecret, account.password),
    role: account.role,
    status: 'active',
    productType: 'canvas,chat',
    createdAt: now,
    updatedAt: now,
  }));
  const environment = {
    E2E_BASE_URL: 'http://127.0.0.1:5011',
    E2E_AUTH_RUN_ID: runId,
    E2E_RUN_ID: runId,
    E2E_ADMIN_ID: admin.id,
    E2E_ADMIN_USERNAME: admin.name,
    E2E_ADMIN_PASSWORD: admin.password,
    E2E_USER_ID: user.id,
    E2E_USER_USERNAME: user.name,
    E2E_USER_PASSWORD: user.password,
    E2E_TEST_ID: user.id,
    E2E_TEST_USERNAME: user.name,
    E2E_TEST_PASSWORD: user.password,
    E2E_TEST_ROLE: user.role,
    WUJIE_DATA_DIR: dataDirectory,
    WUJIE_DATA_DIR_DURABLE: 'true',
    WUJIE_AUTH_PERSISTENCE_MODE: 'FILE_ONLY',
    WUJIE_AUTH_SECRET: authSecret,
    WUJIE_ADMIN_USERNAME: admin.name,
    WUJIE_ADMIN_PASSWORD: admin.password,
    INTERNAL_API_SECRET: randomSecret(),
    PAYMENT_TOKEN_SECRET: randomSecret(),
    MANDATORY_API_AUTH: 'true',
    COZE_PROJECT_ENV: 'PROD',
  };
  await mkdir(systemDirectory, { recursive: true });
  await writeFile(join(systemDirectory, 'users.json'), `${JSON.stringify({ users: storedUsers, updatedAt: now }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    result: 'PREPARED',
    runId,
    fixtureRoot: root,
    environmentPath,
    persistenceMode: 'FILE_ONLY',
    roles: ['admin', 'user'],
    databaseUrlPresent: false,
    pgdatabaseUrlPresent: false,
  })}\n`);
}

async function main() {
  const command = process.argv[2];
  const root = resolve(required('V588_FIXTURE_ROOT'));
  if (command === 'prepare') {
    await rm(root, { recursive: true, force: true });
    await prepare(root);
    return;
  }
  if (command === 'destroy') {
    await rm(root, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({ result: 'DESTROYED', fixtureRoot: root })}\n`);
    return;
  }
  throw new Error('Usage: node scripts/v588-auth-fixture.mjs <prepare|destroy>');
}

main().catch(error => {
  process.stderr.write(`V588 fixture lifecycle failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});

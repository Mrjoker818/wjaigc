/**
 * Prepare synthetic users for the isolated Stage4 current-lineage CI job.
 * This entry point never resets data or substitutes for browser acceptance.
 */
import assert from 'node:assert/strict';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT_NAME = 'stage-4-current-lineage-fixtures.ts';
const PROFILES = ['chromium', 'chromium-1080p', 'firefox', 'webkit', 'mobile-chromium'] as const;
let phase = 'context';

export async function prepareCurrentLineageCiAccounts(): Promise<void> {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_OS, 'Linux');
  assert.equal(process.env.NODE_ENV, 'test');
  const deployment = process.env.COZE_PROJECT_ENV?.trim().toUpperCase();
  assert.ok(deployment !== 'PROD' && deployment !== 'PRODUCTION');

  const expectedSettings = {
    E2E_BASE_URL: 'http://localhost:5000',
    PORT: '5000',
    DEPLOY_RUN_PORT: '5000',
    COZE_PROJECT_DOMAIN_DEFAULT: 'http://localhost:5000',
    WUJIE_YJS_ENABLED: 'true',
    WUJIE_YJS_HTTP_ENABLED: 'false',
    WUJIE_PRESENCE_ENABLED: 'true',
    WUJIE_ASSET_GRAPH_MODE: 'legacy',
    WUJIE_AGENT_RUNTIME_MODE: 'agent-v2',
    E2E_STAGE4_EXPECTED_AGENT_MODE: 'agent-v2',
    WUJIE_AUTH_PERSISTENCE_MODE: 'DB_ONLY',
    WUJIE_DEPLOYMENT_DB_ONLY: '1',
  } as const;
  for (const [key, value] of Object.entries(expectedSettings)) {
    assert.equal(process.env[key], value);
  }

  const workspace = process.env.GITHUB_WORKSPACE;
  const runNumber = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  assert.ok(workspace && runNumber && attempt);
  assert.match(runNumber, /^[1-9][0-9]*$/);
  assert.match(attempt, /^[1-9][0-9]*$/);
  assert.equal(resolve(process.cwd()), resolve(workspace));
  assert.ok(process.argv[1]);
  assert.equal(resolve(process.argv[1]), resolve(workspace, 'scripts', SCRIPT_NAME));
  const runId = 'ci_' + runNumber + '_' + attempt;
  assert.equal(process.env.E2E_STAGE4_RUN_ID, runId);
  const fromWorkspace = (path: string) => pathToFileURL(resolve(workspace, path)).href;

  phase = 'database-guard';
  const { assertStage4FixtureDatabaseEnvironment, buildStage4FixturePlan } =
    await import(fromWorkspace('scripts/stage-4-e2e-fixtures.mjs'));
  assertStage4FixtureDatabaseEnvironment(process.env);
  const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL',
    'E2E_STAGE4_DATABASE_URL'] as const;
  const target = process.env.E2E_STAGE4_DATABASE_URL;
  assert.ok(target);
  for (const key of aliases) assert.equal(process.env[key], target);
  const url = new URL(target);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port || '5432', '5432');
  assert.equal(decodeURIComponent(url.username), 'postgres');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), 'wujie_stage4_' + runId);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');

  const plan = buildStage4FixturePlan(runId);
  const accounts: Array<{ username: string; password: string }> = [];
  for (const profile of PROFILES) {
    const a = plan.users.find((entry: { browserProfile: string }) => entry.browserProfile === profile);
    assert.ok(a);
    const b = { ...a, username: a.username.replace(/^stage4_/, 'stage4_b_') };
    assert.notEqual(a.username, b.username);
    accounts.push(a, b);
  }
  assert.equal(accounts.length, 10);
  assert.equal(new Set(accounts.map(account => account.username)).size, 10);

  const { getPool, closePool } = await import(fromWorkspace('src/lib/db-client.ts'));
  try {
    phase = 'database-identity';
    const identity = await getPool().query(
      'SELECT current_database() AS db, current_user AS actor, inet_server_port() AS port',
    );
    assert.equal(identity.rows.length, 1);
    assert.equal(identity.rows[0].db, 'wujie_stage4_' + runId);
    assert.equal(identity.rows[0].actor, 'postgres');
    assert.equal(identity.rows[0].port, 5432);

    const assertFreshData = async (): Promise<void> => {
      const relations = await getPool().query(`
        SELECT to_regclass('wujie_users') AS users,
          to_regclass('wujie_projects') AS projects,
          to_regclass('wujie_user_data') AS snapshots,
          to_regclass('wujie_credits') AS credits,
          to_regclass('wujie_credit_transactions') AS transactions,
          to_regclass('cloud_tasks') AS tasks
      `);
      assert.equal(relations.rows.length, 1);
      const counts = {
        users: 'SELECT COUNT(*)::int AS count FROM wujie_users',
        projects: 'SELECT COUNT(*)::int AS count FROM wujie_projects',
        snapshots: 'SELECT COUNT(*)::int AS count FROM wujie_user_data',
        credits: 'SELECT COUNT(*)::int AS count FROM wujie_credits',
        transactions: 'SELECT COUNT(*)::int AS count FROM wujie_credit_transactions',
        tasks: 'SELECT COUNT(*)::int AS count FROM cloud_tasks',
      };
      for (const [key, sql] of Object.entries(counts)) {
        if (relations.rows[0][key] === null) continue;
        const result = await getPool().query(sql);
        assert.equal(result.rows[0]?.count, 0);
      }
    };
    // Refuse existing data before schema initialization can change the database.
    phase = 'fresh-run';
    await assertFreshData();
    phase = 'schema';
    const { ensureCoreTables } = await import(fromWorkspace('src/lib/db-storage.ts'));
    await ensureCoreTables();
    phase = 'fresh-run';
    await assertFreshData();

    phase = 'create-accounts';
    const { createManagedUser } = await import(fromWorkspace('src/lib/server-auth.ts'));
    let created = 0;
    for (const account of accounts) {
      const user = await createManagedUser({
        name: account.username, password: account.password,
        productType: 'canvas,chat', imageModels: [], chatModels: [],
        apiPermissions: { image: true, chat: true, vlm: true },
      });
      assert.equal(user.role, 'user');
      assert.equal(user.status, 'active');
      assert.equal(user.name, account.username);
      created += 1;
    }
    assert.equal(created, 10);
    phase = 'prepared';
    console.log(JSON.stringify({ preparedProfiles: PROFILES.length, createdAccounts: created }));
  } finally {
    await closePool();
  }
}

// Match the fixed CLI entry without import.meta, including tsx's CommonJS loading.
if (process.argv[1] && basename(process.argv[1]) === SCRIPT_NAME) {
  void prepareCurrentLineageCiAccounts().catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error
      ? error.code : undefined;
    const sqlState = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
      ? code : undefined;
    console.error({
      code: 'STAGE4_CURRENT_LINEAGE_CI_SETUP_FAILED',
      phase,
      ...(sqlState ? { sqlState } : {}),
    });
    process.exitCode = 1;
  });
}

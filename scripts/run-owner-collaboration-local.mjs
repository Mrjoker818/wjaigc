import { spawn } from 'node:child_process';
import { lstat, mkdtemp, realpath } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

// Disposable local UI gate only; never inherits API/storage/auth credentials.
const databaseName = 'wujie_bridge_test_ownerui_20261003';
const resume = process.argv.slice(2).includes('--resume');
if (process.argv.slice(2).some(arg => arg !== '--resume')) throw new Error('Unsupported local gate argument');
const root = await realpath(process.cwd());
if (path.basename(root) !== '_upstream-wjaigc-restore') throw new Error('Unexpected checkout');
const retainedMediaRoot = path.join(path.dirname(root), '_tmp_e2e', 'wujie-bridge-test-ownerui-ClHV9L');
if (resume) {
  const stat = await lstat(retainedMediaRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || (await realpath(retainedMediaRoot)) !== retainedMediaRoot) throw new Error('Invalid retained fixture root');
}
const database = new pg.Client({ connectionString: 'postgresql://postgres@127.0.0.1:55494/postgres' });
await database.connect();
try {
  const exists = await database.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
  if (resume) {
    if (!exists.rowCount) throw new Error('Retained fixture database missing');
  } else {
    if (exists.rowCount) throw new Error('Disposable UI database already exists; inspect before reuse');
    await database.query(`CREATE DATABASE ${databaseName}`);
  }
} finally { await database.end(); }

const mediaRoot = resume ? retainedMediaRoot
  : await mkdtemp(path.join(path.dirname(root), '_tmp_e2e', 'wujie-bridge-test-ownerui-'));
const environment = {};
for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
  if (process.env[key]) environment[key] = process.env[key];
}
environment.PATH = [path.dirname(process.execPath), path.join(process.env.SystemRoot, 'System32'),
  'C:/ffmpeg/ffmpeg-8.1-full_build/bin'].join(path.delimiter);
const url = `postgresql://postgres@127.0.0.1:55494/${databaseName}`;
if (resume) {
  const fixture = new pg.Client({ connectionString: url });
  await fixture.connect();
  try {
    const owner = await fixture.query(
      "SELECT 1 FROM wujie_users WHERE id='admin_mr_joker' AND name='owner-ui-local' AND role='admin' AND status='active'",
    );
    if (owner.rowCount !== 1) throw new Error('Retained owner fixture mismatch');
  } finally { await fixture.end(); }
}
Object.assign(environment, {
  DATABASE_URL: url, PGDATABASE_URL: url, POSTGRES_TEST_DATABASE_URL: url, TEST_POSTGRES_URL: url,
  WUJIE_DATA_DIR: mediaRoot, LOCAL_AI_ENABLED: 'false', WUJIE_YJS_ENABLED: 'true',
  WUJIE_ADMIN_USERNAME: 'owner-ui-local', WUJIE_ADMIN_PASSWORD: 'OwnerUi-Local-Fixture-20261003!',
  WUJIE_AUTH_SECRET: 'owner-ui-local-isolated-fixture-secret-20261003',
  WUJIE_CANVAS_KERNEL_MODE: 'canvas-v2', NEXT_TELEMETRY_DISABLED: '1',
  WUJIE_PRESENCE_ENABLED: 'true', PORT: '5010',
  COZE_PROJECT_DOMAIN_DEFAULT: 'http://localhost:5010',
});
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Local gate child exit ${code}`)));
  });
}
console.log(JSON.stringify({ code: 'OWNER_UI_LOCAL_GATE', databaseName, mediaRoot, port: 5010 }));
if (!resume) await run(['scripts/run-migrations.mjs']);
await run(['--require', 'next/dist/server/node-environment', '--conditions=react-server',
  '--import', 'tsx', 'scripts/presence-server.ts', '--dev']);

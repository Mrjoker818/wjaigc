import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'];
const connectionString = process.env.POSTGRES_TEST_DATABASE_URL;

function reject(reason) {
  console.error(`Isolated Vitest database boundary rejected: ${reason}`);
  process.exit(2);
}

if (!connectionString || aliases.some(alias => process.env[alias] !== connectionString)) {
  reject('four matching dedicated test database aliases are required');
}

let database;
try {
  database = new URL(connectionString);
} catch {
  reject('invalid test database URL');
}

if (database.protocol !== 'postgresql:' || database.hostname !== '127.0.0.1'
  || !/^[0-9]+$/.test(database.port) || Number(database.port) < 1024
  || Number(database.port) > 65535
  || !/^\/wujie_bridge_test_[a-z0-9_]+$/.test(database.pathname)
  || database.search !== '' || database.hash !== '') {
  reject('an explicit dedicated loopback PostgreSQL database is required');
}

const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(process.execPath, [vitestCli, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) {
  console.error('Isolated Vitest could not start its test runner');
  process.exit(1);
}
process.exit(result.status ?? 1);

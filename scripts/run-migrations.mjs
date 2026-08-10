import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from 'pg';

const root = process.cwd();
const migrationsDirectory = resolve(root, 'migrations');

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or PGDATABASE_URL is required to run migrations');
  }
  return connectionString;
}

function connectionOptions(connectionString) {
  return {
    connectionString,
    ssl: connectionString.includes('supabase') || connectionString.includes('aidap')
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

async function migrationFiles() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function checksum(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wujie_schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applyMigrations() {
  const client = new Client(connectionOptions(getConnectionString()));
  await client.connect();

  try {
    await ensureLedger(client);

    for (const version of await migrationFiles()) {
      const contents = await readFile(resolve(migrationsDirectory, version));
      const digest = checksum(contents);
      const recorded = await client.query(
        'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
        [version],
      );
      const existingChecksum = recorded.rows[0]?.checksum;

      if (existingChecksum) {
        if (existingChecksum !== digest) {
          throw new Error(`Migration checksum mismatch for ${version}`);
        }
        console.log(`Skipped ${version}`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(contents.toString('utf8'));
        await client.query(
          'INSERT INTO wujie_schema_migrations(version, checksum) VALUES ($1, $2)',
          [version, digest],
        );
        await client.query('COMMIT');
        console.log(`Applied ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

applyMigrations().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

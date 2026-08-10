import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

export function normalizePostgresConnectionString(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (
      parsed.searchParams.get('sslmode')?.toLowerCase() === 'require'
      && !parsed.searchParams.has('uselibpqcompat')
    ) {
      parsed.searchParams.set('uselibpqcompat', 'true');
      return parsed.toString();
    }
  } catch {
    return connectionString;
  }
  return connectionString;
}

export function connectionOptions(connectionString) {
  const normalizedConnectionString = normalizePostgresConnectionString(connectionString);
  return {
    connectionString: normalizedConnectionString,
    ssl: normalizedConnectionString.includes('supabase') || normalizedConnectionString.includes('aidap')
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

export async function applyMigrations() {
  const client = new Client(connectionOptions(getConnectionString()));
  await client.connect();

  try {
    const messages = [];
    await client.query('BEGIN');
    try {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        ['wujie-schema-migrations'],
      );
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
          messages.push(`Skipped ${version}`);
          continue;
        }

        await client.query(contents.toString('utf8'));
        await client.query(
          'INSERT INTO wujie_schema_migrations(version, checksum) VALUES ($1, $2)',
          [version, digest],
        );
        messages.push(`Applied ${version}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    for (const message of messages) console.log(message);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyMigrations().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

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

export async function listMigrationFiles() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function migrationChecksum(contents) {
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

/** Retiring an entry point is not permission to discard saved data or publication receipts. */
export async function assertWorkflowRetirementSafe(client, version) {
  if (version !== '20261118_wj_remove_node_workflows.sql') return;
  const names = ['wujie_user_data', 'wujie_projects', 'wujie_workflow_edit_outputs', 'wujie_workflow_edit_publications'];
  const { rows: tables } = await client.query(`
    SELECT c.relname AS table_name, n.nspname AS schema_name, c.relkind AS relation_kind
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.oid IN (SELECT pg_catalog.to_regclass(name)::oid FROM pg_catalog.unnest($1::text[]) names(name))
     ORDER BY c.relname
  `, [names]);
  if (tables.some(table => !['r', 'p'].includes(table.relation_kind))) {
    throw new Error('WORKFLOW_RETIREMENT_RELATION_REQUIRES_REVIEW: unexpected relation type must be reviewed before this migration');
  }
  const { rows: [settings] } = await client.query("SELECT current_setting('lock_timeout') AS lock_timeout");
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  try {
    await client.query("SELECT set_config('lock_timeout', '2000', true)");
    for (const table of tables) {
      if (!names.includes(table.table_name)) throw new Error('Unexpected workflow retirement relation');
      await client.query(`LOCK TABLE ${quote(table.schema_name)}.${quote(table.table_name)} IN ACCESS EXCLUSIVE MODE`);
    }
    for (const table of tables) {
      const relation = `${quote(table.schema_name)}.${quote(table.table_name)}`;
      const condition = table.table_name === 'wujie_user_data'
        ? `WHERE data_key LIKE 'workflow\\_%' ESCAPE '\\'
           OR (data_key = 'projects' AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data_value) = 'array' THEN data_value ELSE '[]'::jsonb END) item(value)
              WHERE jsonb_typeof(item.value->'metadata') = 'object' AND (item.value->'metadata') ? 'workflow'
           ))`
        : table.table_name === 'wujie_projects' ? "WHERE metadata ? 'workflow'" : '';
      const { rows: [result] } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${relation} ${condition}) AS has_history`);
      if (result?.has_history !== false) throw new Error('WORKFLOW_RETIREMENT_HISTORY_REQUIRES_REVIEW: saved workflows or publication receipts must be preserved before this migration');
    }
  } finally {
    await client.query("SELECT set_config('lock_timeout', $1, true)", [settings.lock_timeout]).catch(() => undefined);
  }
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

      for (const version of await listMigrationFiles()) {
        const contents = await readFile(resolve(migrationsDirectory, version));
        const digest = migrationChecksum(contents);
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

        await assertWorkflowRetirementSafe(client, version);
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

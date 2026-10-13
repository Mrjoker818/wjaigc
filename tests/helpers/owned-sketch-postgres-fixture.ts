import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { IsolatedPostgresContext, QueryFn } from './postgres-test-database';
import { withIsolatedPostgres } from './postgres-test-database';

interface FilePin { path: string; sha256: string }
interface DatabaseIdentity {
  database: string;
  username: string;
  serverPort: string;
  listenAddresses: string;
  systemIdentifier: string;
  postmasterStartedAt: string;
  dataDirectoryHex: string;
  dataDirectory: string;
}
interface DatabaseReady {
  kind: string;
  ready: boolean;
  databaseUrl: string;
  runtimeDatabaseUrl: string;
  dataDirectory: string;
  identity: DatabaseIdentity;
  oldFixturesUntouched: boolean;
  loopbackOnly: boolean;
}
interface ServerIdentityRow {
  database: string;
  username: string;
  address: string;
  port: number;
  system_identifier: string;
  postmaster_started_at: Date | string;
  data_directory_hex: string;
}
export interface OwnedSketchFixture {
  kind: string;
  sourceRoot: string;
  mirrorRoot: string;
  context: FilePin;
  databaseReady: FilePin;
  databaseUrl: string;
  runtimeDatabaseUrl: string;
  mediaRoot: string;
  mediaProof: FilePin & { realPath: string };
  stage7Accepted: false;
  researchNotStarted: true;
}

function requireProof(condition: unknown): asserts condition {
  if (!condition) throw new Error('Owned sketch fixture proof required');
}
function contained(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function physical(candidate: string, kind: 'file' | 'directory'): string {
  requireProof(typeof candidate === 'string' && isAbsolute(candidate));
  const absolute = resolve(candidate);
  let current = parse(absolute).root;
  const parts = relative(current, absolute).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const entry = lstatSync(current);
    requireProof(!entry.isSymbolicLink());
    requireProof(index < parts.length - 1 || kind === 'directory' ? entry.isDirectory() : entry.isFile());
  }
  return realpathSync(absolute);
}
function pinned(pin: FilePin, parent: string): Buffer {
  requireProof(pin && typeof pin.path === 'string' && /^[a-f0-9]{64}$/.test(pin.sha256));
  requireProof(contained(parent, resolve(pin.path)));
  const actual = physical(pin.path, 'file');
  requireProof(contained(physical(parent, 'directory'), actual));
  const bytes = readFileSync(actual);
  requireProof(createHash('sha256').update(bytes).digest('hex') === pin.sha256);
  return bytes;
}
function dedicatedUrl(value: string): URL {
  requireProof(typeof value === 'string');
  const url = new URL(value);
  requireProof(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1'
    && /^[0-9]+$/.test(url.port) && Number(url.port) >= 1024 && Number(url.port) <= 65535
    && ![53648, 53649, 53650, 53651].includes(Number(url.port))
    && /^[a-z][a-z0-9_]*$/.test(url.username) && !url.password
    && /^\/wujie_bridge_test_[a-z0-9_]+$/.test(url.pathname) && !url.search && !url.hash);
  return url;
}
function readyFor(fixture: OwnedSketchFixture): DatabaseReady {
  const own = join(fixture.sourceRoot, '.superpowers/sdd/2026-10-09-sketch-to-code');
  const ready = JSON.parse(pinned(fixture.databaseReady, own).toString('utf8')) as DatabaseReady;
  const url = dedicatedUrl(fixture.databaseUrl);
  const runtime = dedicatedUrl(fixture.runtimeDatabaseUrl);
  requireProof(ready.kind === 'TASK6_NEW_EXCLUSIVE_POSTGRESQL_FIXTURE_READY_NOT_PRODUCT_ACCEPTANCE'
    && ready.ready === true && ready.oldFixturesUntouched === true && ready.loopbackOnly === true
    && ready.databaseUrl === fixture.databaseUrl && ready.runtimeDatabaseUrl === fixture.runtimeDatabaseUrl
    && fixture.databaseUrl !== fixture.runtimeDatabaseUrl && url.origin === runtime.origin
    && url.hostname === runtime.hostname && url.port === runtime.port && url.username === runtime.username
    && ready.identity?.database === url.pathname.slice(1) && ready.identity.username === url.username
    && ready.identity.serverPort === url.port && ready.identity.listenAddresses === '127.0.0.1'
    && /^[0-9]+$/.test(ready.identity.systemIdentifier)
    && Number.isFinite(new Date(ready.identity.postmasterStartedAt).getTime())
    && /^(?:[a-f0-9]{2})+$/.test(ready.identity.dataDirectoryHex));
  const decoded = new TextDecoder('gb18030', { fatal: true }).decode(Buffer.from(ready.identity.dataDirectoryHex, 'hex'));
  requireProof(resolve(decoded) === resolve(ready.dataDirectory)
    && resolve(ready.identity.dataDirectory) === resolve(ready.dataDirectory));
  const data = physical(ready.dataDirectory, 'directory');
  const cluster = dirname(data);
  requireProof(basename(data) === 'data' && dirname(cluster) === physical(dirname(fixture.sourceRoot), 'directory')
    && /^_task6-sketch-pg-20261010-[a-z0-9]+$/.test(basename(cluster)));
  return ready;
}

export function readOwnedSketchFixture(
  environment: NodeJS.ProcessEnv = process.env,
): OwnedSketchFixture | undefined {
  if (environment.TASK6_OWNED_FIXTURE_RECEIPT === undefined
    && environment.TASK6_OWNED_FIXTURE_SHA256 === undefined) return undefined;
  const sourceRoot = physical(process.cwd(), 'directory');
  const own = join(sourceRoot, '.superpowers/sdd/2026-10-09-sketch-to-code');
  const fixture = JSON.parse(pinned({ path: environment.TASK6_OWNED_FIXTURE_RECEIPT!,
    sha256: environment.TASK6_OWNED_FIXTURE_SHA256! }, own).toString('utf8')) as OwnedSketchFixture;
  requireProof(fixture.kind === 'TASK6_EXPLICIT_OWNED_SKETCH_FIXTURE'
    && fixture.stage7Accepted === false && fixture.researchNotStarted === true
    && physical(fixture.sourceRoot, 'directory') === sourceRoot);
  const projects = physical(dirname(sourceRoot), 'directory');
  const mirror = physical(fixture.mirrorRoot, 'directory');
  requireProof(dirname(mirror) === projects && /^_task6-sketch-20261010-[a-z0-9]+$/.test(basename(mirror))
    && mirror !== sourceRoot);
  const context = JSON.parse(pinned(fixture.context, own).toString('utf8')) as {
    kind: string; sourceRoot: string; mirrorRoot: string; testDatabaseUrl: string; runtimeDatabaseUrl: string;
    databaseReady: FilePin; task5Accepted: boolean; stage7Accepted: boolean; researchNotStarted: boolean;
  };
  requireProof(context.kind === 'TASK6_ACCEPTED_SOURCE_ISOLATED_CONTEXT' && context.task5Accepted === true
    && context.stage7Accepted === false && context.researchNotStarted === true
    && physical(context.sourceRoot, 'directory') === sourceRoot && physical(context.mirrorRoot, 'directory') === mirror
    && context.testDatabaseUrl === fixture.databaseUrl && context.runtimeDatabaseUrl === fixture.runtimeDatabaseUrl
    && resolve(sourceRoot, context.databaseReady.path) === resolve(fixture.databaseReady.path)
    && context.databaseReady.sha256 === fixture.databaseReady.sha256);
  readyFor(fixture);
  for (const key of ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL']) {
    requireProof(environment[key] === fixture.databaseUrl);
  }
  const media = physical(fixture.mediaRoot, 'directory');
  requireProof(dirname(media) === projects && /^wujie-bridge-test-[a-z0-9-]+$/i.test(basename(media))
    && media !== sourceRoot && media !== mirror && environment.WUJIE_DATA_DIR !== undefined
    && physical(environment.WUJIE_DATA_DIR, 'directory') === media
    && physical(fixture.mediaProof.realPath, 'directory') === media);
  physical(join(media, 'exports'), 'directory');
  const proof = JSON.parse(pinned(fixture.mediaProof, media).toString('utf8')) as { kind: string; realPath: string };
  requireProof(proof.kind === 'TASK6_EXCLUSIVE_MEDIA_ROOT_WRITABLE' && physical(proof.realPath, 'directory') === media);
  return fixture;
}

export function assertOwnedSketchSchema(databaseUrl: string): void {
  const base = process.env.POSTGRES_TEST_DATABASE_URL;
  const fixture = readOwnedSketchFixture({ ...process.env, DATABASE_URL: base, PGDATABASE_URL: base });
  if (!fixture) return;
  requireProof(databaseUrl === process.env.DATABASE_URL && databaseUrl === process.env.PGDATABASE_URL);
  const url = new URL(databaseUrl);
  requireProof(url.searchParams.size === 1 && !url.hash
    && /^-csearch_path=test_[a-z0-9_]{1,58}$/.test(url.searchParams.get('options') || ''));
  url.searchParams.delete('options');
  requireProof(url.toString() === new URL(fixture.databaseUrl).toString());
}

async function proveServerIdentity(query: QueryFn, fixture: OwnedSketchFixture): Promise<void> {
  const ready = readyFor(fixture);
  const row = (await query<ServerIdentityRow>(`SELECT current_database() AS database, current_user AS username,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
    pg_postmaster_start_time() AS postmaster_started_at,
    encode(pg_catalog.textsend(current_setting('data_directory')),'hex') AS data_directory_hex`)).rows[0];
  requireProof(row && row.database === ready.identity.database && row.username === ready.identity.username
    && row.address === '127.0.0.1' && row.port === Number(ready.identity.serverPort)
    && row.system_identifier === ready.identity.systemIdentifier
    && row.data_directory_hex === ready.identity.dataDirectoryHex
    && new Date(row.postmaster_started_at).getTime() === new Date(ready.identity.postmasterStartedAt).getTime());
  const decoded = new TextDecoder('gb18030', { fatal: true }).decode(Buffer.from(row.data_directory_hex, 'hex'));
  requireProof(physical(decoded, 'directory') === physical(ready.dataDirectory, 'directory'));
}

export async function withOwnedSketchPostgres<T>(
  testName: string,
  callback: (context: IsolatedPostgresContext) => Promise<T>,
): Promise<T> {
  const fixture = readOwnedSketchFixture();
  return withIsolatedPostgres(testName, callback, fixture ? {
    beforeCreateSchema: async ({ connectionString, query }) => {
      requireProof(connectionString === fixture.databaseUrl);
      const fresh = readOwnedSketchFixture();
      requireProof(fresh && fresh.databaseUrl === fixture.databaseUrl
        && fresh.context.sha256 === fixture.context.sha256 && fresh.databaseReady.sha256 === fixture.databaseReady.sha256);
      await proveServerIdentity(query, fixture);
    },
  } : undefined);
}

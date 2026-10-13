import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ statements: [] as string[], identity: {} as Record<string, unknown>, ends: 0, productDirectoryCalls: 0 }));
vi.mock('pg', () => ({ Client: class {
  async connect(): Promise<void> { state.statements.push('CONNECT'); }
  async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    state.statements.push(text);
    return { rows: text.includes('pg_control_system') ? [state.identity] : [] };
  }
  async end(): Promise<void> { state.ends += 1; }
} }));
vi.mock('../../src/lib/db-client', () => ({ closePool: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/server-data-root', () => ({
  getServerSystemDir: (): never => { state.productDirectoryCalls += 1; throw new Error('Unproved product DataRoot initialization'); },
}));

import { readOwnedSketchFixture, assertOwnedSketchSchema, withOwnedSketchPostgres } from '../helpers/owned-sketch-postgres-fixture';

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const aliases = ['DATABASE_URL', 'PGDATABASE_URL', 'POSTGRES_TEST_DATABASE_URL', 'TEST_POSTGRES_URL'] as const;
const fixtureKeys = [...aliases, 'TASK6_OWNED_FIXTURE_RECEIPT', 'TASK6_OWNED_FIXTURE_SHA256', 'WUJIE_DATA_DIR'] as const;
let container: string;
let root: string;
let own: string;
let media: string;
let contextPath: string;
let readyPath: string;
let receiptPath: string;
let base: string;
let ready: Record<string, unknown>;
let receipt: Record<string, unknown>;
let previous: Partial<Record<typeof fixtureKeys[number], string>>;

function jsonFile(file: string, value: unknown): string {
  const bytes = JSON.stringify(value);
  writeFileSync(file, bytes);
  return hash(bytes);
}
function saveReceipt(): void {
  process.env.TASK6_OWNED_FIXTURE_SHA256 = jsonFile(receiptPath, receipt);
}
function schemaUrl(): string {
  const url = new URL(base);
  url.searchParams.set('options', '-csearch_path=test_owned_schema');
  return url.toString();
}
function rebindDatabase(testUrl: string, runtimeUrl: string): void {
  const parsed = new URL(testUrl);
  ready.databaseUrl = testUrl; ready.runtimeDatabaseUrl = runtimeUrl;
  Object.assign(ready.identity as Record<string, unknown>, {
    database: parsed.pathname.slice(1), username: parsed.username, serverPort: parsed.port,
  });
  const readySha = jsonFile(readyPath, ready);
  const context = JSON.parse(readFileSync(contextPath, 'utf8'));
  context.testDatabaseUrl = testUrl; context.runtimeDatabaseUrl = runtimeUrl;
  context.databaseReady.sha256 = readySha;
  receipt.databaseUrl = testUrl; receipt.runtimeDatabaseUrl = runtimeUrl;
  receipt.databaseReady = { path: readyPath, sha256: readySha };
  receipt.context = { path: contextPath, sha256: jsonFile(contextPath, context) };
  for (const key of aliases) process.env[key] = testUrl;
  saveReceipt();
}

beforeEach(() => {
  previous = Object.fromEntries(fixtureKeys.map(key => [key, process.env[key]]));
  container = mkdtempSync(join(tmpdir(), 'owned-sketch-unit-'));
  const projects = join(container, 'projects');
  root = join(projects, '_upstream-wjaigc-restore');
  own = join(root, '.superpowers/sdd/2026-10-09-sketch-to-code');
  media = join(projects, 'wujie-bridge-test-task6-ci-20261010-unit');
  const mirror = join(projects, '_task6-sketch-20261010-unit');
  const dataDirectory = join(projects, '_task6-sketch-pg-20261010-unit/data');
  for (const directory of [own, join(media, 'exports'), mirror, dataDirectory]) mkdirSync(directory, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  base = 'postgresql://task6_owner@127.0.0.1:49841/wujie_bridge_test_task6_20261010';
  const runtime = 'postgresql://task6_owner@127.0.0.1:49841/wujie_bridge_test_task6_runtime_20261010';
  readyPath = join(own, 'ready.json');
  contextPath = join(own, 'context.json');
  receiptPath = join(own, 'fixture.json');
  const postmasterStartedAt = '2026-10-10T04:55:13.038212+08:00';
  const dataDirectoryHex = Buffer.from(dataDirectory, 'utf8').toString('hex');
  ready = { kind: 'TASK6_NEW_EXCLUSIVE_POSTGRESQL_FIXTURE_READY_NOT_PRODUCT_ACCEPTANCE', ready: true,
    databaseUrl: base, runtimeDatabaseUrl: runtime, dataDirectory, oldFixturesUntouched: true, loopbackOnly: true,
    identity: { database: 'wujie_bridge_test_task6_20261010', username: 'task6_owner', serverPort: '49841',
      listenAddresses: '127.0.0.1', systemIdentifier: '7694774214099586376', postmasterStartedAt, dataDirectoryHex, dataDirectory } };
  const readySha = jsonFile(readyPath, ready);
  const contextSha = jsonFile(contextPath, { kind: 'TASK6_ACCEPTED_SOURCE_ISOLATED_CONTEXT', sourceRoot: root,
    mirrorRoot: mirror, testDatabaseUrl: base, runtimeDatabaseUrl: runtime,
    databaseReady: { path: readyPath, sha256: readySha }, task5Accepted: true, stage7Accepted: false, researchNotStarted: true });
  const mediaProofPath = join(media, 'owned-media-proof.json');
  const mediaSha = jsonFile(mediaProofPath, { kind: 'TASK6_EXCLUSIVE_MEDIA_ROOT_WRITABLE', realPath: media });
  receipt = { kind: 'TASK6_EXPLICIT_OWNED_SKETCH_FIXTURE', sourceRoot: root, mirrorRoot: mirror,
    context: { path: contextPath, sha256: contextSha }, databaseReady: { path: readyPath, sha256: readySha },
    databaseUrl: base, runtimeDatabaseUrl: runtime, mediaRoot: media,
    mediaProof: { path: mediaProofPath, sha256: mediaSha, realPath: media }, stage7Accepted: false, researchNotStarted: true };
  for (const key of aliases) process.env[key] = base;
  process.env.WUJIE_DATA_DIR = media;
  process.env.TASK6_OWNED_FIXTURE_RECEIPT = receiptPath;
  saveReceipt();
  state.statements = []; state.ends = 0; state.productDirectoryCalls = 0;
  state.identity = { database: 'wujie_bridge_test_task6_20261010', username: 'task6_owner', address: '127.0.0.1', port: 49841,
    system_identifier: '7694774214099586376', postmaster_started_at: new Date(postmasterStartedAt), data_directory_hex: dataDirectoryHex };
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of fixtureKeys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  // Exact test-created temporary subtree only; no business/project tree is removed.
  expect(resolve(container).startsWith(resolve(tmpdir()) + '\\') || resolve(container).startsWith(resolve(tmpdir()) + '/')).toBe(true);
  rmSync(container, { recursive: true, force: true });
});

describe('explicit owned sketch fixture proof', () => {
  it('retains the legacy mode only when both new mode fields are absent', () => {
    delete process.env.TASK6_OWNED_FIXTURE_RECEIPT;
    delete process.env.TASK6_OWNED_FIXTURE_SHA256;
    expect(readOwnedSketchFixture()).toBeUndefined();
  });
  it('accepts exactly bound nonbusiness media and database evidence', () => {
    expect(readOwnedSketchFixture()).toMatchObject({ databaseUrl: base, mediaRoot: media });
  });
  it.each(['TASK6_OWNED_FIXTURE_RECEIPT', 'TASK6_OWNED_FIXTURE_SHA256'] as const)('rejects partial explicit mode: %s', key => {
    delete process.env[key]; expect(() => readOwnedSketchFixture()).toThrow();
  });
  it('rejects wrong receipt raw hash even with syntactically valid JSON', () => {
    process.env.TASK6_OWNED_FIXTURE_SHA256 = '0'.repeat(64); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it.each(aliases)('rejects a divergent base alias: %s', key => {
    process.env[key] = String(receipt.runtimeDatabaseUrl); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it.each([53648, 53649, 53650, 53651])('rejects old fixture port %s even when all receipt URLs agree', port => {
    const value = new URL(base); value.port = String(port);
    const runtime = new URL(String(receipt.runtimeDatabaseUrl)); runtime.port = String(port);
    rebindDatabase(value.toString(), runtime.toString());
    expect(() => readOwnedSketchFixture()).toThrow();
  });
  it.each(['https://task6_owner@127.0.0.1:49841/wujie_bridge_test_task6_20261010',
    'postgresql://task6_owner@localhost:49841/wujie_bridge_test_task6_20261010',
    'postgresql://task6_owner@127.0.0.1/wujie_bridge_test_task6_20261010',
    'postgresql://task6_owner@127.0.0.1:49841/business',
    `${'postgresql://task6_owner@127.0.0.1:49841/wujie_bridge_test_task6_20261010'}?sslmode=disable`,
    `${'postgresql://task6_owner@127.0.0.1:49841/wujie_bridge_test_task6_20261010'}#hash`,
    'postgresql://task6_owner:secret@127.0.0.1:49841/wujie_bridge_test_task6_20261010'])('rejects fully rebound unsafe database %s', value => {
    rebindDatabase(value, String(receipt.runtimeDatabaseUrl)); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it('rejects test/runtime identity collapse even when every pin and alias agrees', () => {
    rebindDatabase(base, base); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it.each(['context', 'databaseReady', 'mediaProof'])('rejects changed pinned %s bytes', name => {
    const pin = receipt[name] as { path: string }; writeFileSync(pin.path, readFileSync(pin.path).toString() + '\n');
    expect(() => readOwnedSketchFixture()).toThrow();
  });
  it('rejects media escape into the product source root', () => {
    receipt.mediaRoot = root; process.env.WUJIE_DATA_DIR = root; saveReceipt(); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it('rejects unproved media environment drift', () => {
    process.env.WUJIE_DATA_DIR = join(root, 'business'); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it('rejects a real directory junction before any product resolver or SQL', () => {
    const linked = join(container, 'projects/wujie-bridge-test-task6-ci-20261010-link');
    symlinkSync(media, linked, 'junction'); receipt.mediaRoot = linked; process.env.WUJIE_DATA_DIR = linked;
    saveReceipt(); expect(() => readOwnedSketchFixture()).toThrow(); expect(state.statements).toEqual([]);
  });
  it('rejects a fully pinned directory outside the new owned PG cluster', () => {
    const directory = join(root, 'old-business-data'); mkdirSync(directory);
    ready.dataDirectory = directory;
    Object.assign(ready.identity as Record<string, unknown>, { dataDirectory: directory, dataDirectoryHex: Buffer.from(directory).toString('hex') });
    rebindDatabase(base, String(receipt.runtimeDatabaseUrl)); expect(() => readOwnedSketchFixture()).toThrow();
  });
  it('accepts only the active schema relationship before migrations', () => {
    process.env.DATABASE_URL = schemaUrl(); process.env.PGDATABASE_URL = schemaUrl();
    expect(() => assertOwnedSketchSchema(schemaUrl())).not.toThrow();
    expect(process.env.POSTGRES_TEST_DATABASE_URL).toBe(base); expect(process.env.TEST_POSTGRES_URL).toBe(base);
  });
  it.each(['options=-csearch_path=public', 'options=-csearch_path=test_owned_schema&sslmode=disable'])('rejects unowned schema options %s', query => {
    const value = `${base}?${query}`; process.env.DATABASE_URL = value; process.env.PGDATABASE_URL = value;
    expect(() => assertOwnedSketchSchema(value)).toThrow();
  });
});

describe('identity must precede every owned CREATE SCHEMA', () => {
  it('requests the exact host address rather than PostgreSQL inet text with a CIDR suffix', async () => {
    await withOwnedSketchPostgres('exact_host', async () => undefined);
    const identitySql = state.statements.find(text => text.includes('pg_control_system'))!;
    expect(identitySql).toContain('host(inet_server_addr()) AS address');
    expect(identitySql).not.toContain('inet_server_addr()::text');
  });
  it.each([['', undefined], [undefined, ''], ['', '']] as const)('rejects explicit empty fields %s/%s without legacy CONNECT or callback', async (receiptValue, shaValue) => {
    if (receiptValue === undefined) delete process.env.TASK6_OWNED_FIXTURE_RECEIPT;
    else process.env.TASK6_OWNED_FIXTURE_RECEIPT = receiptValue;
    if (shaValue === undefined) delete process.env.TASK6_OWNED_FIXTURE_SHA256;
    else process.env.TASK6_OWNED_FIXTURE_SHA256 = shaValue;
    const callback = vi.fn().mockResolvedValue(undefined);
    await expect(withOwnedSketchPostgres('empty_explicit', callback)).rejects.toThrow();
    expect(state.statements).toEqual([]); expect(callback).not.toHaveBeenCalled();
  });
  it('rejects a changed receipt before connecting or creating any schema', async () => {
    process.env.TASK6_OWNED_FIXTURE_SHA256 = '0'.repeat(64);
    await expect(withOwnedSketchPostgres('no_connect', vi.fn())).rejects.toThrow();
    expect(state.statements).toEqual([]); expect(state.ends).toBe(0);
  });
  it('retains unmodified two-argument legacy isolation when new mode is absent', async () => {
    delete process.env.TASK6_OWNED_FIXTURE_RECEIPT; delete process.env.TASK6_OWNED_FIXTURE_SHA256;
    expect(await withOwnedSketchPostgres('legacy', async ({ query }) => {
      await query('SELECT fixture_callback'); return 'legacy';
    })).toBe('legacy');
    expect(state.statements.some(text => text.startsWith('CREATE SCHEMA'))).toBe(true);
    expect(state.statements.some(text => text.includes('pg_control_system'))).toBe(false);
    expect(state.ends).toBe(1); for (const key of aliases) expect(process.env[key]).toBe(base);
  });
  it('uses the same helper client to prove identity before the first write and restores aliases', async () => {
    const result = await withOwnedSketchPostgres('owned_proof', async ({ query, databaseUrl }) => {
      assertOwnedSketchSchema(databaseUrl); await query('SELECT fixture_callback'); return 'accepted';
    });
    expect(result).toBe('accepted');
    const identityIndex = state.statements.findIndex(text => text.includes('pg_control_system'));
    const createIndex = state.statements.findIndex(text => text.startsWith('CREATE SCHEMA'));
    expect(identityIndex).toBeGreaterThan(0); expect(createIndex).toBeGreaterThan(identityIndex);
    expect(state.statements[identityIndex]).toContain("encode(pg_catalog.textsend(current_setting('data_directory')),'hex')");
    expect(state.ends).toBe(1); for (const key of aliases) expect(process.env[key]).toBe(base);
  });
  it.each(['database', 'username', 'address', 'port', 'system_identifier', 'postmaster_started_at', 'data_directory_hex'])('rejects mismatched %s before any schema or callback write', async field => {
    state.identity[field] = field === 'port' ? 53651 : 'WRONG'; const callback = vi.fn();
    await expect(withOwnedSketchPostgres('wrong_identity', callback)).rejects.toThrow();
    expect(state.statements.some(text => /^(CREATE|SET|DROP|SELECT fixture_callback)/.test(text))).toBe(false);
    expect(callback).not.toHaveBeenCalled(); expect(state.ends).toBe(1);
    for (const key of aliases) expect(process.env[key]).toBe(base);
  });
});

describe('proof precedes real integration product-module initialization', () => {
  it.each(['execution', 'publication', 'token'] as const)('rejects invalid %s proof before DataRoot, SQL or original cases register', async name => {
    process.env.TASK6_OWNED_FIXTURE_SHA256 = '0'.repeat(64);
    vi.resetModules();
    const loaders = {
      execution: () => import('../integration/sketch-to-code-execution-postgres.test'),
      publication: () => import('../integration/sketch-to-code-publication-postgres.test'),
      token: () => import('../integration/sketch-to-code-token-postgres.test'),
    };
    await expect(loaders[name]()).rejects.toThrow('Owned sketch fixture proof required');
    expect(state.productDirectoryCalls).toBe(0); expect(state.statements).toEqual([]);
  });
});

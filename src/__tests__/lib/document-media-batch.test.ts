import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import sharp from 'sharp';
import { isDeepStrictEqual } from 'node:util';
import * as Y from 'yjs';
vi.mock('server-only', () => ({}));
const io = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), download: vi.fn(), persist: vi.fn(), media: vi.fn(), load: vi.fn(), commit: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ getPool: () => io, getAdvisoryLockPool: () => io }));
vi.mock('@/lib/safe-image-download', () => ({ downloadPublicImage: io.download }));
vi.mock('@/lib/asset-core/binary-persistence', () => ({ persistAssetBytes: io.persist }));
vi.mock('@/lib/asset-core/managed-media-read', () => ({ getManagedAssetMediaDescriptor: io.media }));
vi.mock('@/lib/media-gateway/artifact-persistence', () => ({ downloadSafeVideoArtifact: io.download }));
vi.mock('@/lib/collaboration/document-store', () => ({ loadDocumentInTransaction: io.load, commitDocumentAssetCommandInTransaction: io.commit }));
import { applyCanvasAssetCommand, type DocumentAssetCommandInput } from '@/lib/collaboration/canvas-asset-command';
import { readCanvasDocument } from '@/lib/collaboration/canvas-document';
import { importDocumentMediaBatch, documentMediaBatchKeys } from '@/lib/collaboration/document-media-batch';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';
import { commitPreparedDocumentMediaInTransaction } from '@/lib/collaboration/document-media-import';
import * as access from '@/lib/collaboration/document-access';
import * as mediaRequest from '@/lib/collaboration/document-media-request';
import * as mediaSource from '@/lib/collaboration/document-media-source';
import * as publication from '@/lib/collaboration/task-publication-output';
import { readTaskPublicationAccess } from '@/lib/collaboration/task-publication-access';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { executeDocumentAssetCommandInTransaction } from '@/lib/collaboration/document-asset-commands';
import { bindImportedDocumentMedia, prepareDocumentAssetsForImport } from '@/lib/collaboration/document-asset-validation';
import { parseDocumentMediaBatchRequest } from '@/lib/collaboration/document-media-batch-request';
import type { PoolClient } from 'pg';

type Row = Record<string, unknown>;
type State = { versions: Record<string, Row>; assets: Record<string, Row>; placements: Record<string, Row>;
  commands: Record<string, Row>; lineage: Row[]; projection: Record<string, { assetVersionId: string; x: number; y: number; width: number; height: number; rotation: number; zIndex: number; deleted?: boolean }>; sequence: number };
const transform = { x: 3, y: 4, width: 20, height: 10, rotation: 0, zIndex: 1 };
const command = { action: 'attach' as const, transform };
const request = { projectId: 'target', idempotencyKey: 'intent', items: [
  { sourceVersionId: 'private-a', command }, { sourceVersionId: 'private-b', command }] };
const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 200, g: 20, b: 0, alpha: 1 } } }).png().toBuffer();
let committed: State, events: string[], files: Array<{ cleanup: ReturnType<typeof vi.fn> }>, authorized: boolean;
let failSecond: boolean, commitUnknown: 'none' | 'durable' | 'absent', abortBeforeCommit: AbortController | undefined;
let delayedCommit: (() => Promise<void>) | undefined;
let mutateSource: (() => void) | undefined;
let taskRows: Record<string, Row>;
function empty(): State { return { versions: {}, assets: {}, placements: {}, commands: {}, lineage: [], projection: {}, sequence: 0 }; }
function source(state: State, id: string, kind = 'image', owner = 'actor', project = 'private'): void {
  state.assets['asset-' + id] = { id: 'asset-' + id, owner_id: owner, project_id: project, kind, status: 'active', current_version_id: id };
  state.versions[id] = { id, asset_id: 'asset-' + id, owner_id: owner, project_id: project, task_id: null,
    availability: 'ready', file_url: 'https://media.example/' + id + '.png', storage_key: null,
    checksum: null, mime_type: kind === 'video' ? 'video/mp4' : 'image/png', byte_size: null,
    recovery_source_url: null, metadata: {}, width: 1, height: 1 };
}
function shared(id = 'shared', placementId = 'shared-placement'): void {
  source(committed, id, 'image', 'owner', 'target');
  committed.projection[placementId] = { assetVersionId: id, ...transform };
  committed.placements[placementId] = { id: placementId, owner_id: 'owner', project_id: 'target',
    asset_id: 'asset-' + id, asset_version_id: id, entity_id: 'entity-' + id, status: 'active', workspace_kind: 'canvas',
    workspace_id: 'target', entity_type: 'canvas-image' };
}
function joinedVersion(state: State, id: string): Row | undefined {
  const version = state.versions[id]; if (!version) return;
  const asset = state.assets[String(version.asset_id)]; if (!asset) return;
  return { ...structuredClone(version), kind: asset.kind, current_version_id: asset.current_version_id,
    version_record: structuredClone(version), asset_record: structuredClone(asset),
    project_record: { id: version.project_id, owner_id: version.owner_id, status: 'active' } };
}
function doc(state: State): Y.Doc {
  const result = new Y.Doc();
  for (const [id, placement] of Object.entries(state.projection)) {
    const { x, y, width, height, rotation, zIndex } = placement;
    applyCanvasAssetCommand(result, { action: 'attach', assetVersionId: placement.assetVersionId,
      transform: { x, y, width, height, rotation, zIndex } }, id);
    if (placement.deleted) result.getMap('tombstones').set(id, true);
  }
  return result;
}
function enriched(state: State, stored: Row): Row {
  const version = state.versions[String(stored.asset_version_id)], placement = state.placements[String(stored.placement_id)];
  return { ...stored, registered_asset_id: version?.asset_id, registered_version_id: version?.id,
    registered_placement_id: placement?.id, entity_id: placement?.entity_id, file_url: version?.file_url,
    kind: state.assets[String(version?.asset_id)]?.kind };
}
// SQL/media IO are bounded fixtures. Actual authorization, source capabilities,
// prepared-assets validation, media writing, asset command and batch composition run.
// This is not evidence of PostgreSQL MVCC/atomicity or durable filesystem cleanup.
function client() {
  let local: State | undefined;
  const current = (): State => local ?? committed;
  const query = async (sql: string, parameters: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> => {
    const p = parameters, state = current();
    const rows = (value: Row[]): { rows: Row[]; rowCount: number } => ({ rows: value, rowCount: value.length });
    if (sql === 'BEGIN') { local = structuredClone(committed); events.push('BEGIN'); return rows([]); }
    if (sql === 'ROLLBACK') { local = undefined; events.push('ROLLBACK'); return rows([]); }
    if (sql === 'COMMIT') {
      const changed = local && Object.keys(local.commands).length > Object.keys(committed.commands).length;
      if (changed) {
        events.push('FINAL-COMMIT'); await delayedCommit?.();
        if (commitUnknown === 'absent') throw new Error('connection lost before durable receipt');
        committed = local!; local = undefined;
        if (commitUnknown === 'durable') throw new Error('connection lost after commit');
      } else { if (local) committed = local; local = undefined; events.push('READ-COMMIT'); }
      return rows([]);
    }
    if (sql.includes('pg_try_advisory_lock')) return rows([{ acquired: true }]);
    if (sql.includes('pg_advisory_unlock')) return rows([{ released: true }]);
    if (sql.includes('SET LOCAL') || sql.includes('pg_advisory') || sql === 'SELECT 1') return rows([]);
    if (sql.includes('FROM cloud_tasks')) return rows(taskRows[String(p[0])] ? [taskRows[String(p[0])]] : []);
    if (sql.includes('wujie_canvas_task_publications')) return rows([]);
    if (sql.includes('FROM wujie_projects p')) return rows(authorized ? [{ owner_id: 'owner' }] : []);
    if (sql.includes('wujie_project_document_editors')) return rows(authorized ? [{ present: true }] : []);
    if (sql.includes('wujie_project_document_settings')) {
      const target = p.includes('target'); return rows(target ? [{ enabled: true }] : []);
    }
    if (sql.includes('FROM wujie_projects')) return rows([{ id: p[0] }]);
    if (sql.includes('FROM wujie_project_canvas_documents')) return rows([{ projection: { placements: state.projection } }]);
    if (sql.includes('SELECT owner_id,project_id FROM wujie_asset_versions')) {
      const version = state.versions[String(p[0])];
      return rows(version && (version.owner_id === p[1] || (version.owner_id === p[2] && version.project_id === p[3])) ? [version] : []);
    }
    if (sql.includes('FROM wujie_canvas_media_lineage')) return rows(state.lineage.filter(row =>
      row.target_version_id === p[0] && row.target_asset_id === p[1] && row.target_owner_id === p[2] && row.target_project_id === p[3] && row.actor_id === p[4]));
    if (sql.includes('FROM wujie_canvas_asset_commands')) {
      const stored = state.commands[String(p[2])];
      return rows(stored && stored.actor_id === p[0] && stored.project_id === p[1] ? [enriched(state, stored)] : []);
    }
    if (sql.includes('FROM wujie_workspace_placements placement')) {
      const placement = state.placements[String(p[0])], version = placement && state.versions[String(placement.asset_version_id)];
      if (!placement || !version || placement.status !== 'active' || placement.owner_id !== p[1] || placement.project_id !== p[2]
        || placement.asset_version_id !== p[3] || version.availability !== 'ready' || state.assets[String(version.asset_id)]?.status !== 'active') return rows([]);
      return rows([{ placement_id: placement.id, asset_id: version.asset_id, asset_version_id: version.id,
        entity_id: placement.entity_id, file_url: version.file_url, kind: state.assets[String(version.asset_id)].kind }]);
    }
    if (sql.includes('FROM wujie_asset_versions version')) {
      const row = joinedVersion(state, String(p[0]));
      if (!row || row.owner_id !== p[1] || (p[2] && row.project_id !== p[2]) || row.availability !== 'ready'
        || state.assets[String(row.asset_id)].status !== 'active' || (sql.includes('task_id IS NULL') && row.task_id !== null)) return rows([]);
      return rows([row]);
    }
    if (sql.startsWith('INSERT INTO wujie_assets')) {
      state.assets[String(p[0])] = { id: p[0], owner_id: p[1], project_id: p[2], kind: p[3], status: 'active', metadata: { source: 'document-media-import' }, current_version_id: null };
      events.push('asset'); return rows([]);
    }
    if (sql.startsWith('INSERT INTO wujie_asset_versions')) {
      if (failSecond && Object.values(state.versions).filter(version => version.project_id === 'target' && version.metadata
        && (version.metadata as Row).source === 'document-media-import').length === 1) throw new Error('second item write failed');
      state.versions[String(p[0])] = { id: p[0], asset_id: p[1], owner_id: p[2], project_id: p[3], file_url: p[4],
        storage_key: p[5], checksum: p[6], mime_type: p[7], byte_size: String(p[8]), availability: 'ready',
        metadata: JSON.parse(String(p[9])), task_id: p[10], provider_id: p[11], model_id: p[12], width: p[13], height: p[14] };
      events.push('version'); return rows([]);
    }
    if (sql.startsWith('UPDATE wujie_assets SET current_version_id')) { state.assets[String(p[0])].current_version_id = p[1]; return rows([]); }
    if (sql.startsWith('INSERT INTO wujie_canvas_media_lineage')) {
      state.lineage.push(Object.fromEntries(['target_version_id','target_asset_id','target_owner_id','target_project_id','actor_id','source_kind','task_id','output_index','source_project_id','source_version_id','source_request_digest'].map((name,i) => [name,p[i]]))); return rows([]);
    }
    if (sql.startsWith('INSERT INTO wujie_workspace_placements')) {
      state.placements[String(p[0])] = { id: p[0], owner_id: p[1], project_id: p[2], asset_id: p[3], asset_version_id: p[4],
        workspace_kind: 'canvas', workspace_id: p[2], entity_type: p[5], entity_id: p[6], status: 'active' }; return rows([]);
    }
    if (sql.startsWith('INSERT INTO wujie_canvas_asset_commands')) {
      if (state.commands[String(p[2])]) throw new Error('unique key conflict');
      state.commands[String(p[2])] = { actor_id: p[0], project_id: p[1], idempotency_key: p[2], request_digest: p[3], owner_id: p[4],
        placement_id: p[5], asset_id: p[6], asset_version_id: p[7], document_sequence: String(p[8]),
        source_request_digest: sql.includes('batch_manifest') ? p[3] : null, source_kind: null,
        batch_manifest: sql.includes('batch_manifest') ? JSON.parse(String(p[9])) : null };
      events.push(sql.includes('batch_manifest') ? 'root' : 'child'); abortBeforeCommit?.abort(); return rows([]);
    }
    if (sql.startsWith('UPDATE wujie_canvas_asset_commands')) {
      Object.assign(state.commands[String(p[2])], { source_request_digest: p[3], source_kind: p[4] }); return rows([]);
    }
    throw new Error('Unhandled SQL fixture: ' + sql);
  };
  const instance = { query, release: vi.fn(), on: vi.fn(), once: vi.fn(), off: vi.fn(), current };
  return instance;
}
beforeEach(() => {
  committed = empty(); source(committed, 'private-a'); source(committed, 'private-b');
  events = []; files = []; authorized = true; failSecond = false; commitUnknown = 'none'; taskRows = {};
  abortBeforeCommit = undefined; delayedCommit = undefined; mutateSource = undefined;
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  io.connect.mockReset().mockImplementation(async () => client());
  io.query.mockReset().mockImplementation(async (sql, p) => client().query(sql,p));
  io.load.mockReset().mockImplementation(async (connection) => {
    const state = connection.current(); return { doc: doc(state), sequence: state.sequence };
  });
  io.commit.mockReset().mockImplementation(async (connection, input: DocumentAssetCommandInput & { placementId: string }) => {
    const state = connection.current(); const document = doc(state);
    applyCanvasAssetCommand(document, input.command, input.placementId);
    state.projection = readCanvasDocument(document).placements; document.destroy();
    state.sequence += 1; events.push('Yjs'); return { sequence: state.sequence };
  });
  io.download.mockReset().mockImplementation(async () => {
    mutateSource?.(); return { buffer: png, mimeType: 'image/png', mediaType: { mimeType: 'video/mp4' } };
  });
  io.persist.mockReset().mockImplementation(async ({ bytes, mimeType }) => {
    const file = { url: '/api/serve-upload/new-' + files.length + '.png', storageKey: null,
      checksum: createHash('sha256').update(bytes).digest('hex'), mimeType, byteSize: bytes.length,
      width: 1, height: 1, availability: 'ready', createdThisCall: true, cleanup: vi.fn(async () => undefined) };
    files.push(file); return file;
  });
  io.media.mockReset().mockResolvedValue({ width: 1, height: 1, kind: 'image' });
});
afterEach(() => vi.unstubAllEnvs());

// Controlled counterexample only: execute the sealed old production transaction,
// not a handwritten "legacy" loop implementation or a missing-module assertion.
async function oldSelfCommittingBoundary(): Promise<void> {
  const frozen = JSON.parse(readFileSync('J:/无界本地版/projects/_upstream-wjaigc-restore/output/playwright/semantic-target-source-20261004/stage7-document-media-transfer-1394-baseline.json', 'utf8')) as { files: Array<{ path: string; content: string }> };
  const original = frozen.files.find(file => file.path === 'src/lib/collaboration/document-media-import.ts')!.content;
  expect(createHash('sha256').update(original).digest('hex')).toBe('1bee384525b729c4a03842475b1de44c304afa310559d9d6dbb436e58d73fb09');
  const tree = ts.createSourceFile('old-media-import.ts', original, ts.ScriptTarget.Latest, true);
  const names = new Set(['digest','conflict','asRecord','ordinaryOutputIdentity','authorize','resultRow','replay','finalTransaction']);
  const text = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
    .map(node => node.getText(tree)).join('\n');
  const bindings = { ...access, ...mediaRequest, ...mediaSource, ...publication, createHash, isDeepStrictEqual,
    readTaskPublicationAccess, getPool: () => io, lockAssetGraphWriteGate, bindImportedDocumentMedia,
    prepareDocumentAssetsForImport, executeDocumentAssetCommandInTransaction };
  const js = ts.transpileModule(text + '\nreturn finalTransaction;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const final = new Function(...Object.keys(bindings), js)(...Object.values(bindings)) as (...args: unknown[]) => Promise<unknown>;
  const signal = new AbortController().signal;
  const { acquireKey } = await import('@/lib/collaboration/document-media-import');
  for (const [index, item] of request.items.entries()) {
    const input = mediaRequest.parseMediaVersionImport({ projectId: 'target', idempotencyKey: 'old-single-' + index,
      sourceVersionId: item.sourceVersionId, command: item.command });
    const source = await mediaSource.prepareMediaVersionSource('actor', input);
    const media = await mediaSource.prepareAdoptedMedia(source, 'actor', 'owner', 'target', signal);
    const lock = await acquireKey('actor', input, signal);
    try { await final('actor', input, createHash('sha256').update(JSON.stringify({ kind: 'version', input })).digest('hex'),
      'version', media, source, lock, signal, {}); }
    finally { await lock.release(); }
  }
}
describe('1394 actual batch / original prepared writing composition (SQL fixtures, NOT PG evidence)', () => {
  it('commits both private items once with all children, lineage and root in the same outer transaction', async () => {
    const result = await importDocumentMediaBatch('actor', request);
    expect(result.items.map(item => item.mode)).toEqual(['import','import']);
    expect(events.filter(event => event === 'FINAL-COMMIT')).toEqual(['FINAL-COMMIT']);
    expect(Object.keys(committed.commands)).toHaveLength(3); expect(committed.lineage).toHaveLength(2);
    expect(Object.keys(committed.projection)).toHaveLength(2); expect(files.every(file => file.cleanup.mock.calls.length === 0)).toBe(true);
  });
  it('second item write failure rolls back the first child and cleans both newly prepared files', async () => {
    failSecond = true; const before = structuredClone(committed);
    const operation = process.env.WUJIE_DOCUMENT_BATCH_OLD_BOUNDARY === 'true'
      ? oldSelfCommittingBoundary() : importDocumentMediaBatch('actor', request);
    await expect(operation).rejects.toThrow('second item write failed');
    expect(committed).toEqual(before); expect(events).toContain('Yjs'); expect(events).not.toContain('FINAL-COMMIT');
    expect(files.map(file => file.cleanup.mock.calls.length)).toEqual([1,1]);
  });
  it('pure confirmation makes zero version/placement/Yjs writes yet persists one replayable root', async () => {
    shared(); const input = { ...request, items: [{ sourceVersionId: 'shared', placementId: 'shared-placement', command }] };
    const result = await importDocumentMediaBatch('actor', input);
    expect(result.items[0]).toMatchObject({ mode: 'confirm', childKey: null, placementId: 'shared-placement' });
    expect(events.filter(event => ['version','asset','Yjs','child'].includes(event))).toEqual([]);
    expect(await importDocumentMediaBatch('actor', input)).toEqual(result); expect(files).toEqual([]);
  });
  it('mixed first-confirm root verifies every private child and replays without current private source', async () => {
    shared(); const input = { ...request, items: [{ sourceVersionId: 'shared', command }, ...request.items] };
    const result = await importDocumentMediaBatch('actor', input);
    delete committed.versions['private-a']; delete committed.versions['private-b'];
    expect(await importDocumentMediaBatch('actor', input)).toEqual(result);
    const root = committed.commands[documentMediaBatchKeys('actor', input).root];
    expect(root.placement_id).toBe('shared-placement'); expect(Object.keys(committed.commands)).toHaveLength(3);
    const child = documentMediaBatchKeys('actor', input).child(2); delete committed.commands[child];
    await expect(importDocumentMediaBatch('actor', input)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
  });
  it('one root namespace rejects changed ordering/content and cannot be interpreted by old ordinary command', async () => {
    shared(); const input = { ...request, items: [{ sourceVersionId: 'shared', command }] };
    await importDocumentMediaBatch('actor', input);
    await expect(importDocumentMediaBatch('actor', { ...input, items: [{ sourceVersionId: 'shared', command: { ...command, transform: { ...transform, x: 8 } } }] })).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    await expect(executeDocumentAssetCommand({ actorId: 'actor', projectId: 'target',
      idempotencyKey: documentMediaBatchKeys('actor', input).root, command: { ...command, assetVersionId: 'shared' } })).rejects.toThrow();
  });
  it.each(['deleted','replaced','DB mismatch','multiple'] as const)('refuses a shared %s placement; never falls back to private preparation', async mutation => {
    shared();
    if (mutation === 'deleted') committed.projection['shared-placement'].deleted = true;
    if (mutation === 'replaced') committed.projection['shared-placement'].assetVersionId = 'replacement';
    if (mutation === 'DB mismatch') committed.placements['shared-placement'].asset_version_id = 'forged';
    if (mutation === 'multiple') shared('shared','second-placement');
    await expect(importDocumentMediaBatch('actor', { ...request, items: [{ sourceVersionId: 'shared', command }] })).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(files).toEqual([]); expect(events).not.toContain('Yjs');
  });
  it('explicit placement disambiguates multiple exact live shared placements', async () => {
    shared(); shared('shared','second-placement');
    const result = await importDocumentMediaBatch('actor', { ...request, items: [{ sourceVersionId: 'shared', placementId: 'second-placement', command }] });
    expect(result.items[0].placementId).toBe('second-placement');
  });
  it('private video uses the same actual prepared-media / canvas-video path', async () => {
    source(committed, 'private-b', 'video');
    const result = await importDocumentMediaBatch('actor', request);
    expect(result.items[1].assetReference.kind).toBe('video');
  });
  it('private task capability pins the actual persisted output slot through preparation and final writes', async () => {
    const row = committed.versions['private-a'];
    row.task_id = 'generate-private'; row.metadata = { source: 'task-projection', outputIndex: 1 };
    taskRows['generate-private'] = { id: 'generate-private', user_id: 'actor', project_id: 'private', type: 'generate',
      status: 'completed', result: { imageUrls: [row.file_url, row.file_url] } };
    mutateSource = () => { (committed.versions['private-a'].metadata as Row).outputIndex = 0; };
    await expect(importDocumentMediaBatch('actor', request)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(events).not.toContain('FINAL-COMMIT');
  });
  it.each(['durable','absent'] as const)('unknown COMMIT %s preserves every prepared file and only authorized complete durable state can ACK', async outcome => {
    commitUnknown = outcome;
    const operation = importDocumentMediaBatch('actor', request);
    if (outcome === 'durable') await expect(operation).resolves.toMatchObject({ documentSequence: 2 });
    else await expect(operation).rejects.toThrow('DOCUMENT_MEDIA_COMMIT_UNCONFIRMED');
    expect(files.map(file => file.cleanup.mock.calls.length)).toEqual([0,0]);
  });
  it('has no ACK before COMMIT finishes and retains source/billing rows unchanged', async () => {
    let release: (() => void) | undefined; const barrier = new Promise<void>(resolve => { release = resolve; });
    const before = structuredClone(committed.versions); let done = false;
    delayedCommit = async () => { await barrier; };
    const operation = importDocumentMediaBatch('actor', request).then(result => { done = true; return result; });
    await vi.waitFor(() => expect(events).toContain('FINAL-COMMIT')); expect(done).toBe(false);
    release!(); await operation;
    expect(committed.versions['private-a']).toEqual(before['private-a']); expect(committed.versions['private-b']).toEqual(before['private-b']);
  });
  it('cancel after pending child writes rolls back everything; no ACK or subsequent child', async () => {
    abortBeforeCommit = new AbortController();
    await expect(importDocumentMediaBatch('actor', request, abortBeforeCommit.signal)).rejects.toThrow('DOCUMENT_MEDIA_CANCELLED');
    expect(committed.commands).toEqual({}); expect(committed.projection).toEqual({});
    expect(files.map(file => file.cleanup.mock.calls.length)).toEqual([1,1]);
  });
  it('replay after revocation is forbidden, even with intact durable receipt', async () => {
    await importDocumentMediaBatch('actor', request); authorized = false;
    await expect(importDocumentMediaBatch('actor', request)).rejects.toThrow('无权编辑');
    expect(files).toHaveLength(2);
  });
  it('rejects manufactured writing capabilities before SQL mutation', async () => {
    await expect(commitPreparedDocumentMediaInTransaction({ query: (): never => { throw new Error('unexpected'); } } as unknown as PoolClient,
      'actor', {} as never, {} as never, new AbortController().signal)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
  });
  it('durable root final sequence must equal its complete item receipt maximum, not a later document sequence', async () => {
    const result = await importDocumentMediaBatch('actor', request);
    const root = committed.commands[documentMediaBatchKeys('actor', request).root];
    root.document_sequence = String(result.documentSequence + 1);
    (root.batch_manifest as Row).documentSequence = result.documentSequence + 1;
    committed.sequence += 1;
    await expect(importDocumentMediaBatch('actor', request)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(files).toHaveLength(2);
  });
  it('attempt cleanup failure is not hidden, all owned files are still attempted and the lock is released', async () => {
    failSecond = true;
    const persist = io.persist.getMockImplementation()!;
    io.persist.mockImplementation(async value => { const file = await persist(value);
      if (files.length === 1) file.cleanup.mockRejectedValue(new Error('owned cleanup failed fixture'));
      return file; });
    await expect(importDocumentMediaBatch('actor', request)).rejects.toThrow('DOCUMENT_MEDIA_BATCH_CLEANUP_FAILED');
    expect(files.map(file => file.cleanup.mock.calls.length)).toEqual([1,1]);
    expect(committed.commands).toEqual({});
  });
  it('private task success seals the actual nonzero slot and replays after source metadata disappears', async () => {
    const row = committed.versions['private-a']; row.task_id = 'generate-private';
    row.metadata = { source: 'task-projection', outputIndex: 1 };
    taskRows['generate-private'] = { id: 'generate-private', user_id: 'actor', project_id: 'private', type: 'generate',
      status: 'completed', result: { imageUrls: [row.file_url, row.file_url] } };
    const result = await importDocumentMediaBatch('actor', request);
    expect(committed.lineage[0]).toMatchObject({ task_id: 'generate-private', output_index: 1, source_version_id: 'private-a' });
    delete committed.versions['private-a']; delete taskRows['generate-private'];
    expect(await importDocumentMediaBatch('actor', request)).toEqual(result);
  });
  it.each(['deleted','replaced','missing child','changed lineage','changed root anchor'] as const)('complete durable replay refuses %s rather than partial ACK', async mutation => {
    shared(); const input = { ...request, items: [{ sourceVersionId: 'shared', command }, ...request.items] };
    await importDocumentMediaBatch('actor', input);
    if (mutation === 'deleted') committed.projection['shared-placement'].deleted = true;
    if (mutation === 'replaced') committed.projection['shared-placement'].assetVersionId = 'private-a';
    if (mutation === 'missing child') delete committed.commands[documentMediaBatchKeys('actor', input).child(2)];
    if (mutation === 'changed lineage') committed.lineage[1].output_index = 1;
    if (mutation === 'changed root anchor') committed.commands[documentMediaBatchKeys('actor', input).root].placement_id = 'forged';
    await expect(importDocumentMediaBatch('actor', input)).rejects.toThrow('DOCUMENT_MEDIA_CONFLICT');
    expect(files).toHaveLength(2);
  });
  it('second slow media failure cleans only this attempt new media, with no SQL children', async () => {
    let downloads = 0;
    io.download.mockImplementation(async () => { downloads += 1; if (downloads === 2) throw new Error('second preparation failed');
      return { buffer: png, mimeType: 'image/png' }; });
    await expect(importDocumentMediaBatch('actor', request)).rejects.toThrow('second preparation failed');
    expect(committed.commands).toEqual({}); expect(files.map(file => file.cleanup.mock.calls.length)).toEqual([1]);
  });
  it('actual persisted-file byte accounting stops cumulative new media above 512MiB without partial writes', async () => {
    const persist = io.persist.getMockImplementation()!;
    io.persist.mockImplementation(async value => { const file = await persist(value); return { ...file, byteSize: 300 * 1024 * 1024 }; });
    await expect(importDocumentMediaBatch('actor', request)).rejects.toThrow('DOCUMENT_MEDIA_TOO_LARGE');
    expect(committed.commands).toEqual({}); expect(files.map(file => file.cleanup.mock.calls.length)).toEqual([1,1]);
  });
  it('strictly normalizes bounded attach-only items and stable keys independent of members', () => {
    const a = parseDocumentMediaBatchRequest(request);
    const reordered = { ...a, items: [...a.items].reverse() };
    expect(documentMediaBatchKeys('actor', a).root).toBe(documentMediaBatchKeys('actor', reordered).root);
    for (const value of [{ ...request, items: [] }, { ...request, actor: 'forged' },
      { ...request, items: [request.items[0], request.items[0]] },
      { ...request, items: [{ ...request.items[0], taskId: 'forged' }] },
      { ...request, items: [{ ...request.items[0], command: { action: 'remove', placementId: 'p', expectedAssetVersionId: 'v' } }] }]) {
      expect(() => parseDocumentMediaBatchRequest(value)).toThrow('Invalid document media batch');
    }
  });
});

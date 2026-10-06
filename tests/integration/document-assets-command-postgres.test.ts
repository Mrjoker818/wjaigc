import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import { Client, type Notification, type PoolClient } from 'pg';

import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { readCanvasDocument } from '../../src/lib/collaboration/canvas-document';
import { commitDocumentUpdate, loadDocument } from '../../src/lib/collaboration/document-store';
import { getPool } from '../../src/lib/db-client';
import { executeDocumentAssetCommand, executeDocumentAssetCommandInTransaction } from '../../src/lib/collaboration/document-asset-commands';
import { prepareDocumentAssets } from '../../src/lib/collaboration/document-asset-validation';
import type { CanvasAssetCommand, DocumentAssetCommandResult } from '../../src/lib/collaboration/canvas-asset-command';
import { createCanvasDocumentSession } from '../../src/lib/collaboration/document-client';

vi.mock('server-only', () => ({}));
let mediaRoot = '';
let image: Buffer;
let video: Buffer;
const oldRoot = process.env.WUJIE_DATA_DIR;
const transform = { x: 10, y: 20, width: 80, height: 60, rotation: 5, zIndex: 1 };

beforeAll(async () => {
  mediaRoot = await mkdtemp(path.join(tmpdir(), 'wujie-8b1-'));
  process.env.WUJIE_DATA_DIR = mediaRoot;
  await mkdir(path.join(mediaRoot, 'images'));
  image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#d4af37' } }).png().toBuffer();
  await writeFile(path.join(mediaRoot, 'images', 'source.png'), image);
  video = Buffer.from(await readFile('tests/fixtures/yjs-task8b1-tiny-valid.mp4.base64', 'utf8'), 'base64');
  await mkdir(path.join(mediaRoot, 'videos'));
  await writeFile(path.join(mediaRoot, 'videos', 'source.mp4'), video);
});
afterAll(async () => {
  if (oldRoot === undefined) delete process.env.WUJIE_DATA_DIR;
  else process.env.WUJIE_DATA_DIR = oldRoot;
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});
beforeEach(() => vi.stubEnv('WUJIE_YJS_ENABLED', 'true'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seed(query: QueryFn): Promise<void> {
  for (const name of ['20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql',
    '20260913_canvas_video_placements.sql', '20260924_project_presence.sql', '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql',
    '20260927_yjs_canvas_asset_commands.sql', '20260927_yjs_canvas_asset_commands.sql',
    '20261004_yjs_canvas_removal_snapshots.sql', '20261004_yjs_canvas_removal_snapshots.sql']) {
    await query(await readFile(path.join('migrations', name), 'utf8'));
  }
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,created_at,updated_at)
    VALUES ('owner-a','Owner','test','active',1,1),('editor-a','Editor','test','active',1,1),('stranger','Stranger','test','active',1,1)`);
  await query(`INSERT INTO wujie_projects (id,owner_id,name) VALUES ('project-a','owner-a','A'),('project-b','owner-a','B')`);
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled,authority_revision)
    VALUES ('project-a','owner-a',true,0)`);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id,status)
    VALUES ('project-a','owner-a','editor-a','active')`);
  await query(`INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id) VALUES ('project-a','owner-a','stranger')`);
  for (const suffix of ['one', 'two']) {
    await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ($1,'owner-a','project-a','image')`, [`asset-${suffix}`]);
    await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,availability,mime_type,byte_size,checksum)
      VALUES ($1,$2,'owner-a','project-a','/api/serve-upload/images/source.png','ready','image/png',$3,$4)`,
    [`version-${suffix}`, `asset-${suffix}`, image.length, createHash('sha256').update(image).digest('hex')]);
    await query('UPDATE wujie_assets SET current_version_id=$2 WHERE id=$1', [`asset-${suffix}`, `version-${suffix}`]);
  }
  await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('asset-video','owner-a','project-a','video')`);
  await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,availability,mime_type,byte_size,checksum,width,height)
    VALUES ('version-video','asset-video','owner-a','project-a','/api/serve-upload/videos/source.mp4','ready','video/mp4',$1,$2,32,24)`,
  [video.length, createHash('sha256').update(video).digest('hex')]);
  await query(`UPDATE wujie_assets SET current_version_id='version-video' WHERE id='asset-video'`);
  await query(await readFile('migrations/20260815_wj_cloud_tasks.sql', 'utf8'));
  await query(`INSERT INTO cloud_tasks (id,user_id,project_id,type,status,result,credit_status,credit_cost,charged_transaction_id,created_at,updated_at)
    VALUES ('source-task','owner-a','project-a','image-generate','completed','{}','charged',12,'charge-1',1,1)`);
  await query(`CREATE TABLE wujie_credit_transactions (id TEXT PRIMARY KEY,user_id TEXT,amount INTEGER,task_id TEXT);
    INSERT INTO wujie_credit_transactions VALUES ('charge-1','owner-a',-12,'source-task')`);
}

function execute(command: CanvasAssetCommand, key: string = randomUUID(), actorId: string = 'editor-a'): Promise<DocumentAssetCommandResult> {
  return executeDocumentAssetCommand({ actorId, projectId: 'project-a', idempotencyKey: key, command });
}

const attach: CanvasAssetCommand = { action: 'attach', assetVersionId: 'version-one', transform };

// Real client/session emits the exact frame sent to the normal server update
// transaction. Only WebSocket transport is held in memory; no local SQL is used
// to install the restored result and no raw mutation guard is bypassed.
async function restorationFrame(actorId: string, assetVersionId: string): Promise<{
  frame: Uint8Array; previousPlacementId: string; nextPlacementId: string; disconnect(): void;
}> {
  const first = await execute({ action: 'attach', assetVersionId, transform }, 'restore-first', actorId);
  await metadata(first.placementId);
  const removed = await execute({ action: 'remove', placementId: first.placementId,
    expectedAssetVersionId: assetVersionId }, 'restore-remove', actorId);
  expect(removed.removeSnapshot).toBeDefined();
  const changed = await loadDocument('project-a');
  try {
    const group = readCanvasDocument(changed.doc).groupDefinitions!['group-1'];
    changed.doc.getMap('groupDefinitions').set(group.id, { ...group, name: 'remote renamed after remove', note: 'remote note' });
    await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(changed.doc) });
  } finally { changed.doc.destroy(); }
  const next = await execute({ action: 'attach', assetVersionId, transform }, 'restore-next', actorId);
  const loaded = await loadDocument('project-a');
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const frames: Uint8Array[] = [];
  const socket = { readyState: 1, binaryType: 'blob', onmessage: null as ((event: MessageEvent) => void) | null,
    onclose: null, onerror: null, close: (): void => {}, send: (frame: Uint8Array): void => { frames.push(frame); } };
  const session = createCanvasDocumentSession(socket as unknown as WebSocket);
  try {
    const update = Y.encodeStateAsUpdate(loaded.doc);
    const frame = new Uint8Array(9 + update.length);
    frame[0] = 0x11; new DataView(frame.buffer).setBigUint64(1, BigInt(loaded.sequence)); frame.set(update, 9);
    socket.onmessage?.({ data: frame.buffer } as MessageEvent);
    session.restorePlacementHistoryMetadata({ previousPlacementId: first.placementId,
      nextPlacementId: next.placementId, assetVersionId, removal: { projectId: 'project-a',
        snapshot: removed.removeSnapshot!, annotationIds: { 'annotation-1': 'restored-annotation-1' } } });
    expect(frames).toHaveLength(1);
    return { frame: frames[0].subarray(1), previousPlacementId: first.placementId,
      nextPlacementId: next.placementId, disconnect: (): void => { session.disconnect(); } };
  } catch (error) { session.disconnect(); throw error; }
  finally { loaded.doc.destroy(); }
}

describe('real client removal metadata frame through PostgreSQL authorization', () => {
  it.each([
    ['owner-a', 'version-one'], ['editor-a', 'version-one'],
    ['owner-a', 'version-video'], ['editor-a', 'version-video'],
  ] as const)('accepts %s metadata restoration for %s with unchanged assets, tasks and billing', async (actorId, assetVersionId) => {
    await withIsolatedPostgres('h2-metadata-frame', async ({ query }) => {
      await seed(query); const originalSources = await sources(query);
      const emitted = await restorationFrame(actorId, assetVersionId);
      try {
        const result = await commitDocumentUpdate({ actorId, projectId: 'project-a', bytes: emitted.frame });
        const replay = await commitDocumentUpdate({ actorId, projectId: 'project-a', bytes: emitted.frame });
        expect(replay.sequence).toBe(result.sequence);
        const saved = await loadDocument('project-a');
        try {
          const projection = readCanvasDocument(saved.doc);
          expect(projection.placements[emitted.previousPlacementId]).toMatchObject({ deleted: true, assetVersionId });
          expect(projection.placements[emitted.nextPlacementId]).toMatchObject({ assetVersionId, groupId: 'group-1' });
          expect(projection.groupDefinitions?.['group-1']).toEqual({ id: 'group-1', name: 'remote renamed after remove',
            note: 'remote note', imageIds: [emitted.nextPlacementId] });
          expect(projection.annotationRecords?.['restored-annotation-1']).toMatchObject({ id: 'restored-annotation-1',
            sourceImageId: emitted.nextPlacementId, sourceVersionId: 'version-one', maskAssetId: 'asset-two', overlayAssetId: 'asset-one' });
          expect(projection.annotationTombstones).toEqual({ 'annotation-1': true, 'annotation-deleted': true });
        } finally { saved.doc.destroy(); }
        expect(await sources(query)).toEqual(originalSources);
      } finally { emitted.disconnect(); }
    });
  });

  it('revoked editor cannot commit an already generated restoration frame or partially restore metadata', async () => {
    await withIsolatedPostgres('h2-metadata-revoked', async ({ query }) => {
      await seed(query);
      const emitted = await restorationFrame('editor-a', 'version-one');
      try {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE project_id='project-a' AND member_user_id='editor-a'");
        const before = await counts(query); const beforeSources = await sources(query);
        await expect(commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes: emitted.frame })).rejects.toThrow();
        const saved = await loadDocument('project-a');
        try {
          const projection = readCanvasDocument(saved.doc);
          expect(projection.groupDefinitions?.['group-1'].imageIds).toEqual([]);
          expect(projection.annotationRecords?.['restored-annotation-1']).toBeUndefined();
          expect(projection.annotationTombstones?.['annotation-1']).toBe(true);
        } finally { saved.doc.destroy(); }
        expect(await counts(query)).toEqual(before);
        expect(await sources(query)).toEqual(beforeSources);
      } finally { emitted.disconnect(); }
    });
  });
});

async function counts(query: QueryFn): Promise<Record<string, number>> {
  return (await query(`SELECT
    (SELECT count(*)::int FROM wujie_workspace_placements) AS placements,
    (SELECT count(*)::int FROM wujie_project_canvas_documents) AS documents,
    (SELECT count(*)::int FROM wujie_project_canvas_updates) AS updates,
    (SELECT count(*)::int FROM wujie_canvas_asset_commands) AS commands`)).rows[0];
}
const empty = { placements: 0, documents: 0, updates: 0, commands: 0 };
async function sources(query: QueryFn): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const table of ['wujie_assets', 'wujie_asset_versions', 'cloud_tasks', 'wujie_credit_transactions']) {
    result.push((await query(`SELECT * FROM ${table} ORDER BY id`)).rows);
  }
  result.push(createHash('sha256').update(await readFile(path.join(mediaRoot, 'images', 'source.png'))).digest('hex'));
  result.push(createHash('sha256').update(await readFile(path.join(mediaRoot, 'videos', 'source.mp4'))).digest('hex'));
  return result;
}
async function metadata(placementId: string): Promise<void> {
  const { doc } = await loadDocument('project-a');
  doc.getMap('groups').set(placementId, 'group-1');
  doc.getMap('groupDefinitions').set('group-1', { id: 'group-1', name: 'Group', note: 'keep', imageIds: [placementId] });
  for (const id of ['annotation-1', 'annotation-deleted']) doc.getMap('annotationRecords').set(id, {
    id, projectId: 'project-a', sourceImageId: placementId, sourceVersionId: 'version-one', type: 'region',
    geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
    maskAssetId: 'asset-two', overlayAssetId: 'asset-one', status: 'ready', createdAt: 1, updatedAt: 2,
  });
  await commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(doc) });
  const persisted = await loadDocument('project-a');
  persisted.doc.getMap('annotationTombstones').set('annotation-deleted', true);
  await commitDocumentUpdate({ actorId: 'editor-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(persisted.doc) });
}

async function barrier(listener: Client, query: QueryFn): Promise<void> {
  const token = randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let receive: (message: Notification) => void = () => undefined;
  const arrived = new Promise<void>((resolve, reject) => {
    receive = message => { if (message.channel === 'task8b1_barrier' && message.payload === token) resolve(); };
    listener.on('notification', receive);
    timer = setTimeout(() => reject(new Error('notification barrier missing')), 2500);
  });
  try {
    await Promise.all([arrived, query("SELECT pg_notify('task8b1_barrier',$1)", [token])]);
    await listener.query('SELECT 1');
  } finally { clearTimeout(timer); listener.off('notification', receive); }
}

function commandBarrier(): { reached: Promise<void>; signal: () => void } {
  let signal: () => void = () => undefined;
  const reached = new Promise<void>(resolve => { signal = resolve; });
  return { reached, signal };
}

/** Pause B after its real initial read transaction commits (no lock held),
 * then after its real preflight rollback. A runs the production wrapper between
 * those barriers. Only pg transport timing is intercepted; no core is mocked. */
async function withPreflightReplayRace(
  action: 'remove' | 'replace',
  scenario: 'success' | 'revoked' | 'feature-disabled' | 'project-disabled' | 'digest-mismatch' | 'recovery-read-failed',
): Promise<void> {
  await withIsolatedPostgres(`8b1-fix1-${action}`, async ({ query }) => {
    await seed(query);
    const attached = await execute(attach);
    const command: CanvasAssetCommand = action === 'remove'
      ? { action, placementId: attached.placementId, expectedAssetVersionId: 'version-one' }
      : { action, placementId: attached.placementId, expectedAssetVersionId: 'version-one', assetVersionId: 'version-two' };
    const winnerCommand: CanvasAssetCommand = scenario !== 'digest-mismatch' ? command
      : action === 'remove'
        ? { action: 'replace', placementId: attached.placementId, expectedAssetVersionId: 'version-one', assetVersionId: 'version-two' }
        : { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
    const key = 'preflight-race';
    const initialCommitted = commandBarrier();
    const resumePreflight = commandBarrier();
    const preflightRolledBack = commandBarrier();
    const resumeRecovery = commandBarrier();
    const pool = getPool();
    const instrumented = new Set<PoolClient>();
    const initialMissClients = new Set<PoolClient>();
    const restores: Array<() => void> = [];
    const recoveryError = new Error('fix1 recovery SELECT transport failure');
    let delayedClient: PoolClient | undefined;
    let winnerCommitted = false;
    let recoveryReached = false;
    let failRecovery = false;
    const instrument = (client: PoolClient): void => {
      if (instrumented.has(client)) return;
      instrumented.add(client);
      const realQuery = client.query.bind(client);
      let preflightRead = false;
      const spy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
        if (failRecovery && sql.includes('SELECT request_digest') && values?.[2] === key) throw recoveryError;
        const result = await realQuery(sql, values);
        if (sql.includes('SELECT request_digest') && values?.[2] === key && result.rowCount === 0) {
          initialMissClients.add(client);
          delayedClient ??= client;
        }
        if (sql === 'COMMIT' && client === delayedClient && !winnerCommitted) {
          initialCommitted.signal();
          await resumePreflight.reached;
        }
        if (winnerCommitted && sql.startsWith('SELECT projection FROM wujie_project_canvas_documents')) preflightRead = true;
        if (sql === 'ROLLBACK' && preflightRead && !recoveryReached) {
          recoveryReached = true;
          preflightRolledBack.signal();
          await resumeRecovery.reached;
        }
        return result;
      }) as PoolClient['query']);
      restores.push(() => spy.mockRestore());
    };
    pool.on('acquire', instrument);
    const loser = execute(command, key).then(value => ({ value }), error => ({ error: error as Error }));
    try {
      await Promise.race([initialCommitted.reached, loser.then(() => { throw new Error('B ended before initial miss barrier'); })]);
      const winner = await execute(winnerCommand, key);
      winnerCommitted = true;
      // Distinct live connections both executed real missing-result reads.
      expect(initialMissClients.size).toBe(2);
      expect(winner.documentSequence).toBe(2);
      const committedDocument = (await query('SELECT * FROM wujie_project_canvas_documents')).rows;
      const committedGraph = (await query('SELECT * FROM wujie_workspace_placements')).rows;
      const committedUpdates = (await query('SELECT * FROM wujie_project_canvas_updates ORDER BY sequence')).rows;
      const committedResults = (await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows;
      resumePreflight.signal();
      await Promise.race([preflightRolledBack.reached, loser.then(() => { throw new Error('B ended before preflight rollback barrier'); })]);
      if (scenario === 'revoked') await query("UPDATE wujie_project_document_editors SET status='revoked'");
      if (scenario === 'feature-disabled') vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      if (scenario === 'project-disabled') await query('UPDATE wujie_project_document_settings SET enabled=false');
      if (scenario === 'recovery-read-failed') failRecovery = true;
      resumeRecovery.signal();
      const outcome = await loser;
      if (scenario === 'success') expect(outcome).toEqual({ value: winner });
      else if (scenario === 'recovery-read-failed') expect(outcome).toEqual({ error: recoveryError });
      else expect(outcome).toMatchObject({ error: { code: {
        revoked: 'DOCUMENT_FORBIDDEN', 'feature-disabled': 'DOCUMENT_DISABLED',
        'project-disabled': 'DOCUMENT_PROJECT_NOT_ENABLED', 'digest-mismatch': 'DOCUMENT_ASSET_COMMAND_CONFLICT',
      }[scenario] } });
      expect((await query('SELECT * FROM wujie_project_canvas_documents')).rows).toEqual(committedDocument);
      expect((await query('SELECT * FROM wujie_workspace_placements')).rows).toEqual(committedGraph);
      expect((await query('SELECT * FROM wujie_project_canvas_updates ORDER BY sequence')).rows).toEqual(committedUpdates);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows).toEqual(committedResults);
      expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 2, commands: 2 });
    } finally {
      resumePreflight.signal();
      resumeRecovery.signal();
      await loser;
      pool.off('acquire', instrument);
      restores.forEach(restore => restore());
    }
  });
}

describe('fix1 concurrent preflight idempotency recovery', () => {
  it.each(['remove', 'replace'] as const)('returns the durable same-key %s result after both initial reads miss', async action => {
    await withPreflightReplayRace(action, 'success');
  });
  for (const scenario of ['revoked', 'feature-disabled', 'project-disabled', 'digest-mismatch', 'recovery-read-failed'] as const) {
    it.each(['remove', 'replace'] as const)(`rejects %s recovery when ${scenario} after preflight rollback`, async action => {
      await withPreflightReplayRace(action, scenario);
    });
  }
  it('preserves the original preflight error when no scoped durable result exists', async () => {
    await withIsolatedPostgres('8b1-fix1-no-result', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
      const original = new Error('fix1 preflight database transport failure');
      const pool = getPool();
      const instrumented = new Set<PoolClient>();
      const restores: Array<() => void> = [];
      let injected = false;
      const instrument = (client: PoolClient): void => {
        if (instrumented.has(client)) return;
        instrumented.add(client);
        const realQuery = client.query.bind(client);
        const spy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
          if (!injected && sql.startsWith('SELECT projection FROM wujie_project_canvas_documents')) {
            injected = true;
            throw original;
          }
          return realQuery(sql, values);
        }) as PoolClient['query']);
        restores.push(() => spy.mockRestore());
      };
      pool.on('acquire', instrument);
      try {
        await expect(execute(command, 'no-durable-result')).rejects.toBe(original);
        expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
        expect(await execute(command, 'no-durable-result')).toMatchObject({ placementId: attached.placementId, documentSequence: 2 });
      } finally { pool.off('acquire', instrument); restores.forEach(restore => restore()); }
    });
  });
});

describe('project controlled asset commands on real PostgreSQL', () => {
  it.each(['version-one', 'version-video'])('captures %s metadata changed after media preparation and excludes already deleted groups', async version => {
    await withIsolatedPostgres('h2-preflight-preimage', async ({ query }) => {
      await seed(query);
      const attached = await execute({ action: 'attach', assetVersionId: version, transform });
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: version };
      const prepared = await prepareDocumentAssets('editor-a', 'project-a', command);
      const { doc } = await loadDocument('project-a');
      doc.getMap('transforms').set(attached.placementId, { ...transform, x: 456 });
      for (const id of ['group-live', 'group-dead']) doc.getMap('groupDefinitions').set(id, { id, name: 'Group', note: '', imageIds: [attached.placementId] });
      doc.getMap('annotationRecords').set('annotation-stale', { id: 'annotation-stale', projectId: 'project-a', sourceImageId: attached.placementId,
        sourceVersionId: 'version-two', type: 'region', geometry: { kind: 'region', region: { x: 0, y: 0, w: 1, h: 1 } },
        status: 'stale', createdAt: 1, updatedAt: 2 });
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(doc) });
      // Publish the group before deleting it; creating and tombstoning metadata
      // in one raw update is intentionally rejected by the production guard.
      const tombstoned = await loadDocument('project-a');
      tombstoned.doc.getMap('groupTombstones').set('group-dead', true);
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(tombstoned.doc) });
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const result = await executeDocumentAssetCommandInTransaction(client, { actorId: 'editor-a', projectId: 'project-a',
          idempotencyKey: 'prepared-remove', command }, prepared);
        expect(result).toMatchObject({ removeSnapshot: { placement: { x: 456, assetVersionId: version }, groupIds: ['group-live'],
          annotationRecords: { 'annotation-stale': { sourceVersionId: 'version-two', status: 'stale' } } } });
        await client.query('COMMIT');
        expect(await execute(command, 'prepared-remove')).toEqual(result);
      } finally { await client.query('ROLLBACK'); client.release(); }
    });
  });
  it.each(['lost-ack', 'rollback'] as const)('keeps removal snapshot atomic when command transport has %s', async failure => {
    await withIsolatedPostgres('h2-remove-atomic', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      await metadata(attached.placementId);
      const before = await counts(query);
      const projection = readCanvasDocument((await loadDocument('project-a')).doc);
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
      const client = await getPool().connect();
      const realQuery = client.query.bind(client); let written = false, lost = false;
      const spy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
        if (sql.includes('INSERT INTO wujie_canvas_asset_commands') && failure === 'rollback') throw new Error('snapshot write rejected');
        const result = await realQuery(sql, values);
        if (sql.includes('INSERT INTO wujie_canvas_asset_commands')) written = true;
        if (sql === 'COMMIT' && written && !lost) { lost = true; throw new Error('snapshot commit ack lost'); }
        return result;
      }) as PoolClient['query']);
      client.release();
      try {
        if (failure === 'rollback') {
          await expect(execute(command, 'atomic-remove')).rejects.toThrow('snapshot write rejected');
          expect(await counts(query)).toEqual(before);
          expect(readCanvasDocument((await loadDocument('project-a')).doc)).toEqual(projection);
          expect((await query('SELECT status FROM wujie_workspace_placements WHERE id=$1', [attached.placementId])).rows).toEqual([{ status: 'active' }]);
        } else {
          const result = await execute(command, 'atomic-remove');
          expect(lost).toBe(true);
          expect(result).toMatchObject({ removeSnapshot: { groupIds: ['group-1'], placement: { groupId: 'group-1' },
            annotationRecords: { 'annotation-1': { sourceImageId: attached.placementId } } } });
          expect((await query("SELECT remove_snapshot FROM wujie_canvas_asset_commands WHERE idempotency_key='atomic-remove'")).rows)
            .toEqual([{ remove_snapshot: result.removeSnapshot }]);
          expect(await execute(command, 'atomic-remove')).toEqual(result);
          expect((await counts(query)).commands).toBe(before.commands + 1);
        }
      } finally { spy.mockRestore(); }
    });
  });
  it('returns the actual locked deletion geometry, live group memberships and live annotations, not an earlier UI snapshot', async () => {
    await withIsolatedPostgres('h2-remove-preimage', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      await metadata(attached.placementId);
      const localBefore = readCanvasDocument((await loadDocument('project-a')).doc);
      const { doc } = await loadDocument('project-a');
      doc.getMap('transforms').set(attached.placementId, { ...transform, x: 777, rotation: 40 });
      doc.getMap('annotations').set(attached.placementId, 'actual remote note');
      doc.getMap('groupDefinitions').set('group-late', { id: 'group-late', name: 'Late', note: 'remote', imageIds: [attached.placementId] });
      const live = localBefore.annotationRecords!['annotation-1'];
      doc.getMap('annotationRecords').set('annotation-late', { ...live, id: 'annotation-late', instruction: 'actual remote instruction', updatedAt: 9 });
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(doc) });
      const sourceBefore = await sources(query);
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
      const result = await execute(command, 'remove-preimage');
      const expected = { version: 1, projectId: 'project-a', placementId: attached.placementId,
        placement: { assetVersionId: 'version-one', ...transform, x: 777, rotation: 40, groupId: 'group-1', annotation: 'actual remote note' },
        groupIds: ['group-1', 'group-late'], annotationRecords: {
          'annotation-1': live, 'annotation-late': { ...live, id: 'annotation-late', instruction: 'actual remote instruction', updatedAt: 9 },
        } };
      expect(result).toMatchObject({ removeSnapshot: expected });
      expect(localBefore.placements[attached.placementId].x).toBe(10);
      expect((await query("SELECT remove_snapshot FROM wujie_canvas_asset_commands WHERE idempotency_key='remove-preimage'")).rows)
        .toEqual([{ remove_snapshot: expected }]);
      const after = readCanvasDocument((await loadDocument('project-a')).doc);
      expect(after.groupDefinitions!['group-late'].imageIds).toEqual([]);
      expect(after.annotationTombstones).toEqual({ 'annotation-1': true, 'annotation-deleted': true, 'annotation-late': true });
      const changed = await loadDocument('project-a');
      changed.doc.getMap('groupDefinitions').set('group-late', { ...after.groupDefinitions!['group-late'], name: 'later rename' });
      await commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(changed.doc) });
      const beforeReplay = await counts(query);
      expect(await execute(command, 'remove-preimage')).toEqual(result);
      expect(await counts(query)).toEqual(beforeReplay);
      expect(await sources(query)).toEqual(sourceBefore);
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='editor-a'");
      await expect(execute(command, 'remove-preimage')).rejects.toThrow();
      expect(await counts(query)).toEqual(beforeReplay);
    });
  });
  it.each(['malformed', 'wrong-project', 'wrong-placement', 'wrong-version'] as const)('rejects %s persisted removal snapshot without any new write', async corruption => {
    await withIsolatedPostgres('h2-remove-corrupt', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
      await execute(command, 'remove-corrupt');
      const snapshot = { version: 1, projectId: corruption === 'wrong-project' ? 'project-b' : 'project-a',
        placementId: corruption === 'wrong-placement' ? 'foreign-placement' : attached.placementId,
        placement: { assetVersionId: corruption === 'wrong-version' ? 'version-two' : 'version-one', ...transform },
        groupIds: [], annotationRecords: {}, ...(corruption === 'malformed' ? { unexpected: true } : {}) };
      await query("UPDATE wujie_canvas_asset_commands SET remove_snapshot=$1::jsonb WHERE idempotency_key='remove-corrupt'", [JSON.stringify(snapshot)]);
      const before = await counts(query);
      await expect(execute(command, 'remove-corrupt')).rejects.toThrow();
      expect(await counts(query)).toEqual(before);
    });
  });
  it('keeps historical null remove receipts three-field and never fabricates metadata from the deleted document', async () => {
    await withIsolatedPostgres('h2-remove-old', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
      const result = await execute(command, 'old-remove');
      expect(result).toHaveProperty('removeSnapshot');
      await query("UPDATE wujie_canvas_asset_commands SET remove_snapshot=NULL WHERE idempotency_key='old-remove'");
      const before = await counts(query);
      expect(await execute(command, 'old-remove')).toEqual({ placementId: attached.placementId, assetVersionId: 'version-one', documentSequence: result.documentSequence });
      expect(await counts(query)).toEqual(before);
    });
  });
  it('replaces the active version in both graph and document', async () => {
    await withIsolatedPostgres('8b1-replace', async ({ query }) => {
      await seed(query);
      const attached = await execute({ action: 'attach', assetVersionId: 'version-one', transform });
      await expect(execute({ action: 'replace', placementId: attached.placementId, expectedAssetVersionId: 'version-one', assetVersionId: 'version-two' }))
        .resolves.toMatchObject({ assetVersionId: 'version-two', documentSequence: 2 });
      expect(readCanvasDocument((await loadDocument('project-a')).doc).placements[attached.placementId].assetVersionId).toBe('version-two');
      expect((await query('SELECT asset_version_id FROM wujie_workspace_placements')).rows).toEqual([{ asset_version_id: 'version-two' }]);
    });
  });
  it('removes the graph placement together with the document tombstone', async () => {
    await withIsolatedPostgres('8b1-remove', async ({ query }) => {
      await seed(query);
      const attached = await execute({ action: 'attach', assetVersionId: 'version-one', transform });
      await execute({ action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' });
      expect(readCanvasDocument((await loadDocument('project-a')).doc).placements[attached.placementId].deleted).toBe(true);
      expect((await query('SELECT status, deleted_at IS NOT NULL AS deleted FROM wujie_workspace_placements')).rows)
        .toEqual([{ status: 'trashed', deleted: true }]);
    });
  });

  it('attaches owner/editor image/video without changing media, assets, versions, tasks or ledger', async () => {
    await withIsolatedPostgres('8b1-owner-editor', async ({ query }) => {
      await seed(query);
      const before = await sources(query);
      for (const actor of ['owner-a', 'editor-a']) for (const version of ['version-one', 'version-video']) {
        const result = await execute({ action: 'attach', assetVersionId: version, transform }, randomUUID(), actor);
        const doc = readCanvasDocument((await loadDocument('project-a')).doc);
        expect(doc.placements[result.placementId]).toEqual({ assetVersionId: version, ...transform });
        expect((await query('SELECT asset_version_id,entity_type FROM wujie_workspace_placements WHERE id=$1', [result.placementId])).rows)
          .toEqual([{ asset_version_id: version, entity_type: version === 'version-video' ? 'canvas-video' : 'canvas-image' }]);
        expect((await query('SELECT document_sequence FROM wujie_canvas_asset_commands WHERE placement_id=$1', [result.placementId])).rows)
          .toEqual([{ document_sequence: String(result.documentSequence) }]);
      }
      expect(await counts(query)).toEqual({ placements: 4, documents: 1, updates: 4, commands: 4 });
      expect(await sources(query)).toEqual(before);
    });
  });
  it('removes groups/annotations atomically and replay of attach never revives deleted records', async () => {
    await withIsolatedPostgres('8b1-remove-metadata', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach, 'original');
      await metadata(attached.placementId);
      const before = readCanvasDocument((await loadDocument('project-a')).doc);
      await execute({ action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' });
      const after = readCanvasDocument((await loadDocument('project-a')).doc);
      expect(after.placements[attached.placementId]).toEqual({ ...before.placements[attached.placementId], deleted: true });
      expect(after.groupDefinitions?.['group-1']).toEqual({ id: 'group-1', name: 'Group', note: 'keep', imageIds: [] });
      expect(after.annotationRecords).toEqual(before.annotationRecords);
      expect(after.annotationTombstones).toEqual({ 'annotation-1': true, 'annotation-deleted': true });
      const beforeReplay = await counts(query);
      await query("UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-one'");
      expect(await execute(attach, 'original')).toEqual(attached);
      expect(await counts(query)).toEqual(beforeReplay);
      expect(readCanvasDocument((await loadDocument('project-a')).doc)).toEqual(after);
    });
  });
  it('replaces cross-asset image/video with CAS and marks only live annotation status stale', async () => {
    await withIsolatedPostgres('8b1-replace-cas', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      await metadata(attached.placementId);
      const before = readCanvasDocument((await loadDocument('project-a')).doc);
      const graphBefore = (await query('SELECT * FROM wujie_workspace_placements')).rows[0];
      const sourceBefore = await sources(query);
      const command: CanvasAssetCommand = { action: 'replace', placementId: attached.placementId, expectedAssetVersionId: 'version-one', assetVersionId: 'version-video' };
      const result = await execute(command);
      expect(result.documentSequence).toBe(4);
      const after = readCanvasDocument((await loadDocument('project-a')).doc);
      expect(after.placements[attached.placementId]).toEqual({ ...before.placements[attached.placementId], assetVersionId: 'version-video' });
      expect(after.groupDefinitions).toEqual(before.groupDefinitions);
      expect(after.annotationRecords?.['annotation-1']).toEqual({ ...before.annotationRecords?.['annotation-1'], status: 'stale' });
      expect(after.annotationRecords?.['annotation-deleted']).toEqual(before.annotationRecords?.['annotation-deleted']);
      const graph = (await query('SELECT * FROM wujie_workspace_placements')).rows[0];
      expect(graph).toMatchObject({ asset_id: 'asset-video', entity_type: 'canvas-video', asset_version_id: 'version-video', transform: graphBefore.transform, entity_id: graphBefore.entity_id });
      const noop = await execute({ ...command, expectedAssetVersionId: 'version-video' });
      expect(noop.documentSequence).toBe(4);
      expect((await counts(query)).updates).toBe(4);
      expect((await query('SELECT * FROM wujie_workspace_placements')).rows[0]).toEqual(graph);
      for (const expected of ['version-one', 'not-a-version']) await expect(execute({ ...command, expectedAssetVersionId: expected })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      await expect(execute({ action: 'remove', placementId: 'missing', expectedAssetVersionId: 'version-one' })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      expect(await sources(query)).toEqual(sourceBefore);
    });
  });
  it('serializes 20 replays, rejects payload drift and scopes results to actor', async () => {
    await withIsolatedPostgres('8b1-concurrent', async ({ query }) => {
      await seed(query);
      const results = await Promise.all(Array.from({ length: 20 }, () => execute(attach, 'parallel')));
      expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
      expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
      await expect(execute({ ...attach, assetVersionId: 'version-two' }, 'parallel')).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      const owner = await execute(attach, 'parallel', 'owner-a');
      expect(owner.placementId).not.toBe(results[0].placementId);
      expect(await counts(query)).toEqual({ placements: 2, documents: 1, updates: 2, commands: 2 });
      await query("UPDATE wujie_project_document_editors SET status='revoked'");
      await expect(execute(attach, 'parallel')).rejects.toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
      vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      await expect(execute(attach, 'parallel', 'owner-a')).rejects.toMatchObject({ code: 'DOCUMENT_DISABLED' });
    });
  });
  it.each([
    ['presence only', '', 'stranger', 'DOCUMENT_FORBIDDEN'],
    ['administrator without project grant', "UPDATE wujie_users SET role='admin' WHERE id='stranger'", 'stranger', 'DOCUMENT_FORBIDDEN'],
    ['project disabled', 'UPDATE wujie_project_document_settings SET enabled=false', 'editor-a', 'DOCUMENT_PROJECT_NOT_ENABLED'],
    ['pending', "UPDATE wujie_asset_versions SET availability='pending-persist' WHERE id='version-one'", 'editor-a', 'DOCUMENT_ASSET_FORBIDDEN'],
    ['missing', "UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-one'", 'editor-a', 'DOCUMENT_ASSET_FORBIDDEN'],
    ['trashed', "UPDATE wujie_assets SET status='trashed' WHERE id='asset-one'", 'editor-a', 'DOCUMENT_ASSET_FORBIDDEN'],
    ['arbitrary URL', "UPDATE wujie_asset_versions SET file_url='https://example.com/image.png' WHERE id='version-one'", 'editor-a', 'DOCUMENT_ASSET_FORBIDDEN'],
    ['missing file', "UPDATE wujie_asset_versions SET file_url='/api/serve-upload/images/gone.png' WHERE id='version-one'", 'editor-a', 'DOCUMENT_ASSET_FORBIDDEN'],
  ])('rejects %s with no command state written', async (_name, sql, actor, code) => {
    await withIsolatedPostgres('8b1-reject', async ({ query }) => {
      await seed(query);
      if (sql) await query(sql);
      await expect(execute(attach, randomUUID(), actor)).rejects.toMatchObject({ code });
      expect(await counts(query)).toEqual(empty);
    });
  });
  it('rejects cross-project versions, unknown versions and invalid geometry', async () => {
    await withIsolatedPostgres('8b1-invalid', async ({ query }) => {
      await seed(query);
      await query(`INSERT INTO wujie_assets (id,owner_id,project_id,kind) VALUES ('foreign','owner-a','project-b','image');
        INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url) VALUES ('foreign-version','foreign','owner-a','project-b','/api/serve-upload/images/source.png')`);
      for (const id of ['foreign-version', 'not-found']) await expect(execute({ ...attach, assetVersionId: id })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_FORBIDDEN' });
      await expect(execute({ ...attach, transform: { ...transform, zIndex: 0.5 } })).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_INVALID' });
      expect(await counts(query)).toEqual(empty);
    });
  });
  it.each(['wujie_project_canvas_documents', 'wujie_canvas_asset_commands'])('rolls back graph/log/results if %s fails', async table => {
    await withIsolatedPostgres('8b1-rollback', async ({ query }) => {
      await seed(query);
      await query(`CREATE FUNCTION fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;
        CREATE TRIGGER reject_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_write()`);
      await expect(execute(attach)).rejects.toThrow('injected failure');
      expect(await counts(query)).toEqual(empty);
    });
  });
  it.each(['COMMIT', 'ROLLBACK'])('keeps pending graph/document/log/result/NOTIFY invisible until %s', async finish => {
    await withIsolatedPostgres('8b1-notify', async ({ query, databaseUrl }) => {
      await seed(query);
      const input = { actorId: 'editor-a', projectId: 'project-a', idempotencyKey: 'notification', command: attach };
      const prepared = await prepareDocumentAssets(input.actorId, input.projectId, attach);
      const listener = new Client({ connectionString: databaseUrl });
      const client = await getPool().connect();
      const notifications: string[] = [];
      try {
        await listener.connect();
        listener.on('notification', message => { if (message.channel === 'wujie_canvas_document_changed') notifications.push(message.payload ?? ''); });
        await listener.query('LISTEN wujie_canvas_document_changed; LISTEN task8b1_barrier');
        await client.query('BEGIN');
        const pending = await executeDocumentAssetCommandInTransaction(client, input, prepared);
        expect(pending.documentSequence).toBe(1);
        await barrier(listener, query);
        expect(notifications).toEqual([]);
        expect(await counts(query)).toEqual(empty);
        await client.query(finish);
        await barrier(listener, query);
        expect(notifications.map(value => JSON.parse(value))).toEqual(finish === 'COMMIT' ? [{ projectId: 'project-a', sequence: 1 }] : []);
        expect(await counts(query)).toEqual(finish === 'COMMIT' ? { placements: 1, documents: 1, updates: 1, commands: 1 } : empty);
      } finally { await client.query('ROLLBACK'); client.release(); await listener.end(); }
    });
  });
  it.each([
    "UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-one'",
    "UPDATE wujie_assets SET status='trashed' WHERE id='asset-one'",
    "UPDATE wujie_asset_versions SET checksum='changed' WHERE id='version-one'",
    "UPDATE wujie_asset_versions SET file_url='/api/serve-upload/images/other.png' WHERE id='version-one'",
    "UPDATE wujie_assets SET metadata='{\"changed\":true}' WHERE id='asset-one'",
  ])('rejects DB identity changes after media preparation %#', async sql => {
    await withIsolatedPostgres('8b1-identity', async ({ query }) => {
      await seed(query);
      const prepared = await prepareDocumentAssets('editor-a', 'project-a', attach);
      await query(sql);
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await expect(executeDocumentAssetCommandInTransaction(client, { actorId: 'editor-a', projectId: 'project-a', idempotencyKey: 'identity', command: attach }, prepared))
          .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
        await client.query('ROLLBACK');
        expect(await counts(query)).toEqual(empty);
      } finally { await client.query('ROLLBACK'); client.release(); }
    });
  });
  it('rejects an unprepared reference introduced by a concurrent command', async () => {
    await withIsolatedPostgres('8b1-reference-race', async ({ query }) => {
      await seed(query);
      const prepared = await prepareDocumentAssets('editor-a', 'project-a', attach);
      await execute({ ...attach, assetVersionId: 'version-two' });
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await expect(executeDocumentAssetCommandInTransaction(client, { actorId: 'editor-a', projectId: 'project-a', idempotencyKey: 'race', command: attach }, prepared)).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
        await client.query('ROLLBACK');
        expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
      } finally { await client.query('ROLLBACK'); client.release(); }
    });
  });
  it('keeps raw Yjs immutable version rewriting rejected', async () => {
    await withIsolatedPostgres('8b1-raw-guard', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      const { doc } = await loadDocument('project-a');
      doc.getMap('assetVersions').set(attached.placementId, 'version-two');
      await expect(commitDocumentUpdate({ actorId: 'owner-a', projectId: 'project-a', bytes: Y.encodeStateAsUpdate(doc) }))
        .rejects.toMatchObject({ name: 'DocumentUpdateRejectedError', message: 'Canvas document immutable placement history cannot be rewritten' });
      expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
    });
  });
  it('rejects annotation current-version changes and forged preparation capabilities', async () => {
    await withIsolatedPostgres('8b1-mask-race', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      await metadata(attached.placementId);
      const command: CanvasAssetCommand = { action: 'replace', placementId: attached.placementId, expectedAssetVersionId: 'version-one', assetVersionId: 'version-video' };
      const prepared = await prepareDocumentAssets('editor-a', 'project-a', command);
      const before = await counts(query);
      await query(`INSERT INTO wujie_asset_versions (id,asset_id,owner_id,project_id,file_url,availability,mime_type,byte_size)
        VALUES ('mask-next','asset-two','owner-a','project-a','/api/serve-upload/images/source.png','ready','image/png',$1)`, [image.length]);
      await query("UPDATE wujie_assets SET current_version_id='mask-next' WHERE id='asset-two'");
      const client = await getPool().connect();
      try {
        for (const capability of [prepared, {} as typeof prepared]) {
          await client.query('BEGIN');
          await expect(executeDocumentAssetCommandInTransaction(client, { actorId: 'editor-a', projectId: 'project-a', idempotencyKey: 'mask-race', command }, capability))
            .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
          await client.query('ROLLBACK');
        }
        expect(await counts(query)).toEqual(before);
      } finally { await client.query('ROLLBACK'); client.release(); }
    });
  });
  it('rejects graph-only version drift and tombstoned command targets without any further mutation', async () => {
    await withIsolatedPostgres('8b1-graph-cas', async ({ query }) => {
      await seed(query);
      const attached = await execute(attach);
      const command: CanvasAssetCommand = { action: 'remove', placementId: attached.placementId, expectedAssetVersionId: 'version-one' };
      await query("UPDATE wujie_workspace_placements SET asset_id='asset-two',asset_version_id='version-two'");
      await expect(execute(command)).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
      await query("UPDATE wujie_workspace_placements SET asset_id='asset-one',asset_version_id='version-one'");
      await execute(command);
      const before = await counts(query);
      await expect(execute(command)).rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      await expect(execute({ action: 'replace', placementId: attached.placementId, expectedAssetVersionId: 'version-one', assetVersionId: 'version-two' }))
        .rejects.toMatchObject({ code: 'DOCUMENT_ASSET_COMMAND_CONFLICT' });
      expect(await counts(query)).toEqual(before);
    });
  });
  it('rechecks revoked actor, disabled feature and disabled project after preparation', async () => {
    await withIsolatedPostgres('8b1-authorization-race', async ({ query }) => {
      await seed(query);
      const prepared = await prepareDocumentAssets('editor-a', 'project-a', attach);
      const client = await getPool().connect();
      try {
        for (const code of ['DOCUMENT_FORBIDDEN', 'DOCUMENT_DISABLED', 'DOCUMENT_PROJECT_NOT_ENABLED']) {
          if (code === 'DOCUMENT_FORBIDDEN') await query("UPDATE wujie_project_document_editors SET status='revoked'");
          if (code === 'DOCUMENT_DISABLED') vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
          if (code === 'DOCUMENT_PROJECT_NOT_ENABLED') await query('UPDATE wujie_project_document_settings SET enabled=false');
          await client.query('BEGIN');
          await expect(executeDocumentAssetCommandInTransaction(client, { actorId: 'editor-a', projectId: 'project-a', idempotencyKey: 'auth-race', command: attach }, prepared))
            .rejects.toMatchObject({ code });
          await client.query('ROLLBACK');
          await query("UPDATE wujie_project_document_editors SET status='active'");
          vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
        }
        expect(await counts(query)).toEqual(empty);
      } finally { await client.query('ROLLBACK'); client.release(); }
    });
  });
  it.each([false, true])('resolves lost COMMIT ACK from durable results (recovery query fails=%s)', async failRecovery => {
    await withIsolatedPostgres('8b1-ack-loss', async ({ query }) => {
      await seed(query);
      const pool = getPool();
      let lost = false;
      let uncertainClient: PoolClient | undefined;
      const removedClients: PoolClient[] = [];
      const onRemove = (client: PoolClient): void => { removedClients.push(client); };
      const restores: Array<() => void> = [];
      const instrument = (client: PoolClient): void => {
        const realQuery = client.query.bind(client);
        let commandWritten = false;
        const spy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
          if (lost && failRecovery && sql.includes('SELECT request_digest')) throw new Error('injected recovery read failure');
          const result = await realQuery(sql, values);
          if (sql.includes('INSERT INTO wujie_canvas_asset_commands')) commandWritten = true;
          if (sql === 'COMMIT' && commandWritten && !lost) {
            lost = true;
            uncertainClient = client;
            throw new Error('injected lost commit acknowledgement');
          }
          return result;
        }) as PoolClient['query']);
        restores.push(() => spy.mockRestore());
      };
      // Observe connection eviction independently of query interception.
      pool.on('connect', instrument);
      pool.on('remove', onRemove);
      try {
        if (failRecovery) await expect(execute(attach, 'lost-ack')).rejects.toThrow('injected recovery read failure');
        else expect(await execute(attach, 'lost-ack')).toMatchObject({ assetVersionId: 'version-one', documentSequence: 1 });
        expect(lost).toBe(true);
        // pg-pool evicts on release(true), but emits remove only after the
        // asynchronous client.end callback. Require this exact uncertain client.
        await vi.waitFor(() => { expect(removedClients).toContain(uncertainClient); }, { timeout: 2500 });
      } finally { pool.off('connect', instrument); pool.off('remove', onRemove); restores.forEach(restore => restore()); }
      const stored = (await query('SELECT placement_id, asset_version_id, document_sequence FROM wujie_canvas_asset_commands')).rows[0];
      const replay = await execute(attach, 'lost-ack');
      expect(replay).toEqual({ placementId: stored.placement_id, assetVersionId: stored.asset_version_id, documentSequence: 1 });
      expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
    });
  });
  it('discards a connection when rollback itself fails and leaves no partial writes', async () => {
    await withIsolatedPostgres('8b1-rollback-loss', async ({ query }) => {
      await seed(query);
      const pool = getPool();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const eviction = new Promise<void>((resolve, reject) => {
        pool.once('remove', () => { clearTimeout(timer); resolve(); });
        timer = setTimeout(() => reject(new Error('failed rollback connection was not discarded')), 2500);
      });
      const restores: Array<() => void> = [];
      const instrument = (client: PoolClient): void => {
        const realQuery = client.query.bind(client);
        const spy = vi.spyOn(client, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
          if (sql.includes('INSERT INTO wujie_canvas_asset_commands')) throw new Error('injected command write failure');
          if (sql === 'ROLLBACK') throw new Error('injected rollback failure');
          return realQuery(sql, values);
        }) as PoolClient['query']);
        restores.push(() => spy.mockRestore());
      };
      pool.on('connect', instrument);
      try {
        await expect(execute(attach, 'rollback')).rejects.toThrow('injected command write failure');
        await eviction;
      } finally { clearTimeout(timer); pool.off('connect', instrument); restores.forEach(restore => restore()); }
      expect(await counts(query)).toEqual(empty);
      expect(await execute(attach, 'rollback')).toMatchObject({ documentSequence: 1 });
    });
  });
  it('allows revocation while a real loopback S3 HEAD is paused, then rejects final authorization', async () => {
    await withIsolatedPostgres('8b1-s3-revoke', async ({ query }) => {
      await seed(query);
      let received: (response: ServerResponse) => void = () => undefined;
      const requests: string[] = [];
      const server = createServer((req, res) => { requests.push(`${req.method} ${req.url}`); received(res); });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing loopback endpoint');
      vi.stubEnv('COZE_BUCKET_ENDPOINT_URL', `http://127.0.0.1:${address.port}`);
      vi.stubEnv('COZE_BUCKET_NAME', 'fixture');
      vi.stubEnv('COZE_BUCKET_ACCESS_KEY', 'fixture');
      vi.stubEnv('COZE_BUCKET_SECRET_KEY', 'fixture');
      vi.stubEnv('COZE_WORKLOAD_IDENTITY_API_KEY', '');
      await query("UPDATE wujie_asset_versions SET storage_key='images/source.png' WHERE id='version-one'");
      try {
        for (const revoke of [true, false]) {
          await query("UPDATE wujie_project_document_editors SET status='active'");
          const arrived = new Promise<ServerResponse>(resolve => { received = resolve; });
          const pending = execute(attach, revoke ? 'revoke' : 'valid');
          // Attach rejection handling immediately; assertions still consume the real result.
          const outcome = pending.then(value => ({ value }), error => ({ error: error as Error }));
          const response = await arrived;
          try {
            await query('BEGIN');
            await query("SELECT 1 FROM wujie_projects WHERE id='project-a' FOR UPDATE NOWAIT");
            await query('SELECT 1 FROM wujie_project_document_editors FOR UPDATE NOWAIT');
            await query('SELECT 1 FROM wujie_assets FOR UPDATE NOWAIT');
            await query('SELECT 1 FROM wujie_asset_versions FOR UPDATE NOWAIT');
            if (revoke) await query("UPDATE wujie_project_document_editors SET status='revoked'");
            await query('COMMIT');
          } finally {
            await query('ROLLBACK');
            response.writeHead(200, { 'Content-Length': String(image.length), 'Content-Type': 'image/png', ETag: '"fixture"' });
            response.end();
          }
          if (revoke) expect(await outcome).toMatchObject({ error: { code: 'DOCUMENT_FORBIDDEN' } });
          else expect(await outcome).toMatchObject({ value: { documentSequence: 1 } });
        }
        expect(requests).toHaveLength(2);
        expect(requests.every(value => value.startsWith('HEAD /fixture/images/source.png'))).toBe(true);
        expect(await counts(query)).toEqual({ placements: 1, documents: 1, updates: 1, commands: 1 });
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  });
});

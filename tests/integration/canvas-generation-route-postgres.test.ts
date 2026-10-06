import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
await vi.hoisted(async () => {
  const { requireOfflineBridgeTestDatabaseUrl } = await import('../helpers/offline-bridge-database-guard');
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const fs = await import('node:fs'); const path = await import('node:path');
  process.env.WUJIE_DATA_DIR = fs.mkdtempSync(path.join(process.env.WUJIE_DATA_DIR!, 'batch-route-'));
  process.env.WUJIE_YJS_ENABLED = 'true';
  process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'false';
});
const boundary = vi.hoisted(() => ({ actor: 'editor', callbacks: [] as Array<() => Promise<void>>, auto: false, running: [] as Promise<unknown>[] }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => {
    if (boundary.auto) boundary.running.push(Promise.resolve().then(callback));
    else boundary.callbacks.push(callback);
  } }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (request: NextRequest): Promise<unknown> => ({ userId: boundary.actor, userRole: 'user',
    source: request.headers.get('x-test-auth') === boundary.actor ? 'internal' : 'session',
    user: { id: boundary.actor, name: boundary.actor, role: 'user', status: 'active', imageModels: ['provider::gpt-image-1'] } }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({ 'x-test-auth': boundary.actor }),
  getRequestUser: async (request: NextRequest): Promise<unknown> => ({ user: { id: boundary.actor, role: 'user', status: 'active' }, userId: boundary.actor, userRole: 'user',
    source: request.headers.get('x-test-auth') === boundary.actor ? 'internal' : 'session' }),
  getTrustedRequestAgentExecutionFence: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<unknown> => ({ id: boundary.actor }) }));
vi.mock('@/lib/server-api-config', () => {
  const provider = { id: 'provider', name: 'Fixture', modelType: 'image', type: 'image', isEnabled: true, createdAt: 1, updatedAt: 1,
    baseUrl: 'https://provider.invalid', apiKey: 'test-only', selectedModels: ['gpt-image-1'], discoveredModels: [], compatProfile: 'openai' };
  return { findProviderById: async (): Promise<unknown> => provider, findProviderForModel: async (): Promise<unknown> => provider,
    findAllProvidersForType: async (): Promise<unknown[]> => [provider], getApiProviders: async (): Promise<unknown[]> => [provider],
    normalizeApiBaseUrl: (value: string): string => value };
});
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasGeneration, canvasBilling, loseCanvasCommitReply, pauseCanvasSecondTransaction } from '../helpers/canvas-generation-fixture';
import { POST } from '@/app/api/generate/route';
import { GET } from '@/app/api/tasks/recover/route';
import { recordImageTaskTerminal } from '@/lib/cloud-task-persistence';
import { settleFailedTask } from '@/lib/task-core/billing-service';
import { executeDocumentAssetCommand } from '@/lib/collaboration/document-asset-commands';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';

afterEach(async (): Promise<void> => { await Promise.allSettled(boundary.running); boundary.auto = false; boundary.running = [];
  boundary.actor = 'editor'; boundary.callbacks = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function request(body: Record<string, unknown> = {}, key: string = 'first'): NextRequest {
  return new NextRequest('http://localhost/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ prompt: 'A golden square', model: 'gpt-image-1', providerId: 'provider', submitOnly: true,
      projectId: 'shared', outputCount: 2, assetParentVersionIds: ['version-shared'], assetSelectedEntityIds: ['image-shared'], ...body }) });
}

it('real POST freezes two canvas task intents with editor billing', async () => {
  await withIsolatedPostgres('batch-real-post', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const source = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    const placements = (await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows;
    vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Unexpected external request'); });
    const response = await POST(request()); const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.taskIds).toHaveLength(2);
    const consumes = (await query("SELECT user_id,amount FROM wujie_credit_transactions WHERE type='consume' ORDER BY id")).rows;
    expect(consumes.map(row => [row.user_id, row.amount])).toEqual([['editor', -7], ['editor', -7]]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0].balance).toBe(86);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='owner'")).rows[0].balance).toBe(100);
    const publicationRows = (await query('SELECT * FROM wujie_canvas_task_publications')).rows;
    expect(publicationRows).toHaveLength(2);
    expect(body.taskIds.map((id: string) => {
      const row = publicationRows.find(row => row.task_id === id);
      if (!row) throw new Error('Missing task publication');
      return row.publication_intent.placement.transform.x;
    })).toEqual([132, 264]);
    for (const taskId of body.taskIds) await recordImageTaskTerminal(taskId, { status: 'completed', imageUrl: '/api/serve-upload/second.png' });
    const commands = (await query(`SELECT c.*,p.entity_id,v.file_url,v.task_id FROM wujie_canvas_asset_commands c
      JOIN wujie_workspace_placements p ON p.id=c.placement_id JOIN wujie_asset_versions v ON v.id=c.asset_version_id ORDER BY v.task_id`)).rows;
    expect(commands).toHaveLength(2);
    const document = (await query('SELECT projection FROM wujie_project_canvas_documents')).rows[0].projection;
    expect(body.taskIds.map((id: string) => {
      const command = commands.find(row => row.task_id === id);
      if (!command) throw new Error('Missing task canvas command');
      const placement = document.placements[command.placement_id];
      return { x: placement.x, y: placement.y, width: placement.width, height: placement.height, rotation: placement.rotation, zIndex: placement.zIndex };
    })).toEqual([{ x: 132, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }, { x: 264, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }]);
    expect((await query("SELECT owner_id FROM wujie_asset_versions WHERE task_id IS NOT NULL AND task_id<>''")).rows).toEqual([{ owner_id: 'owner' }, { owner_id: 'owner' }]);
    expect(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'))).toEqual(source);
    expect((await query("SELECT * FROM wujie_workspace_placements WHERE id IN ('placement-shared','placement-second') ORDER BY id")).rows).toEqual(placements);
    const before = await canvasBilling(query);
    const versionCount = (await query('SELECT count(*) FROM wujie_asset_versions')).rows;
    for (let index = 0; index < 2; index++) {
      const recovered = await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
      expect(recovered.status).toBe(200);
      const recoveredBody = await recovered.json();
      expect(recoveredBody.tasks).toHaveLength(2);
      for (const task of recoveredBody.tasks) {
        const row = commands.find(command => command.task_id === task.id);
        if (!row) throw new Error('Missing recovered task canvas command');
        expect(task.result.assetProjection.references).toEqual([{ assetId: row.asset_id, assetVersionId: row.asset_version_id,
          placementId: row.placement_id, entityId: row.entity_id, url: row.file_url, kind: 'image' }]);
      }
    }
    boundary.callbacks = [];
    const replay = await (await POST(request())).json();
    expect(replay.taskIds).toEqual(body.taskIds);
    let dispatches = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => { dispatches++; return Response.json({ status: 'completed' }); });
    for (const callback of boundary.callbacks) await callback();
    expect(dispatches).toBe(0);
    expect(await canvasBilling(query)).toEqual(before);
    expect((await query('SELECT count(*) FROM wujie_canvas_asset_commands')).rows[0].count).toBe('2');
    expect((await query('SELECT count(*) FROM wujie_asset_versions')).rows).toEqual(versionCount);
    expect((await query("SELECT * FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([]);
  });
}, 60_000);

it.each([
  { label: 'empty array', refs: [], hasImage: false },
  { label: 'empty string', refs: [''], hasImage: false },
  { label: 'whitespace', refs: [' \t\r\n '], hasImage: false },
  { label: 'local image', refs: ['/api/serve-upload/shared.png'], hasImage: true },
  { label: 'local image with blank slots', refs: ['', '/api/serve-upload/shared.png', ' \t '], hasImage: true },
])('fix2 N1 no-parent $label admits and replays equivalent terminal references without consuming again', async ({ refs, hasImage }) => {
  await withIsolatedPostgres('batch-fix2-blank-refs', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    let mediaIO = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('localhost'); expect(target.pathname).toBe('/api/serve-upload/shared.png');
      mediaIO++; return new Response(new Uint8Array(png));
    });
    const first = await POST(request({ assetParentVersionIds: [], referenceImages: refs }, 'blank-refs'));
    expect(first.status).toBe(200); const ids = (await first.json()).taskIds;
    expect(ids).toHaveLength(2);
    expect(mediaIO).toBe(0);
    const payloads = (await query('SELECT result FROM cloud_tasks ORDER BY idempotency_key')).rows;
    for (const row of payloads) expect(row.result.submissionPayload.referenceImages).toEqual(hasImage
      ? ['/api/serve-upload/shared.png'] : []);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows).toEqual([
      { user_id: 'editor', type: 'consume', amount: -7 }, { user_id: 'editor', type: 'consume', amount: -7 },
    ]);
    for (const taskId of ids) await recordImageTaskTerminal(taskId, { status: 'completed', imageUrl: '/api/serve-upload/second.png' });
    const before = await canvasBilling(query);
    const commands = (await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows;
    expect(commands).toHaveLength(2);
    const variants = hasImage
      ? [['/api/serve-upload/shared.png'], ['', '/api/serve-upload/shared.png', ' \t\r\n ']]
      : [[], [''], [' \t\r\n '], ['', ' ', '']];
    mediaIO = 0; boundary.callbacks = [];
    for (const references of variants) {
      const replay = await POST(request({ assetParentVersionIds: [], referenceImages: references }, 'blank-refs'));
      expect(replay.status).toBe(200); const body = await replay.json();
      expect(body.taskIds).toEqual(ids);
      expect(body.slots.map((slot: { status: string }) => slot.status)).toEqual(['completed', 'completed']);
      expect(await canvasBilling(query)).toEqual(before);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows).toEqual(commands);
    }
    expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it('fix2 N1 blank normalization never admits invalid objects or relaxes declared parent binding', async () => {
  await withIsolatedPostgres('batch-fix2-strict-refs', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    let mediaIO = 0;
    vi.stubGlobal('fetch', async (): Promise<never> => { mediaIO++; throw new Error('Invalid input must not read media'); });
    const before = await canvasBilling(query);
    for (const referenceImages of [[null], [{}], [{ url: '' }], [{ url: null }], [7], [false], null]) {
      expect((await POST(request({ assetParentVersionIds: [], referenceImages }, 'invalid-refs'))).status).toBe(400);
      expect(await canvasBilling(query)).toEqual(before);
    }
    for (const referenceImages of [[''], [' \t '], ['', '/api/serve-upload/shared.png'], ['/api/serve-upload/shared.png', ' ']]) {
      const response = await POST(request({ referenceImages }, 'parent-blanks'));
      expect([400, 403]).toContain(response.status);
      expect(await canvasBilling(query)).toEqual(before);
    }
    expect((await POST(request({ referenceImages: ['/api/serve-upload/second.png'] }, 'parent-mismatch'))).status).toBe(403);
    expect(await canvasBilling(query)).toEqual(before);
    expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it.each([false, true])('fix1 I1 creator failure cannot settle a batch taken over by successful POST dispatched=%s', async (dispatched) => {
  await withIsolatedPostgres('batch-fix1-takeover', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const { POST: poll } = await import('@/app/api/poll-task/route');
    let providerCalls = 0;
    let releaseProvider: () => void = (): void => {};
    let providerStarted: () => void = (): void => {};
    const heldProvider = new Promise<void>(resolve => { releaseProvider = resolve; });
    const bothStarted = new Promise<void>(resolve => { providerStarted = resolve; });
    vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, 'http://localhost');
      if (target.pathname === '/api/serve-upload/second.png') return new Response(new Uint8Array(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png'))));
      if (target.pathname === '/api/poll-task') return poll(new NextRequest(target, { ...options, signal: options?.signal ?? undefined }));
      if (target.pathname === '/api/generate') return POST(new NextRequest(target, { ...options, signal: options?.signal ?? undefined }));
      if (target.hostname === 'provider.invalid') {
        expect(target.pathname).toMatch(/\/images\/generations$/);
        expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'gpt-image-1', n: 1 });
        if (++providerCalls === 2) providerStarted();
        await heldProvider;
        return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
      }
      throw new Error('Unexpected network boundary');
    });
    const proxy = await pauseCanvasSecondTransaction(databaseUrl);
    const a = POST(request({ assetParentVersionIds: [] }, 'takeover'));
    let kicked: Promise<void>[] = [];
    try {
      await proxy.paused;
      expect((await query('SELECT status FROM cloud_tasks')).rows).toEqual([{ status: 'processing' }]);
      const b = await POST(request({ assetParentVersionIds: [] }, 'takeover'));
      expect(b.status).toBe(200); const bBody = await b.json();
      expect(bBody.taskIds).toHaveLength(2);
      expect((await query('SELECT revision FROM cloud_tasks ORDER BY idempotency_key')).rows).toEqual([{ revision: 1 }, { revision: 0 }]);
      if (dispatched) {
        boundary.auto = true;
        kicked = boundary.callbacks.splice(0).map(callback => callback());
        await bothStarted;
      }
      expect((await query("SELECT count(*) FROM cloud_tasks WHERE lease_owner<>''")).rows[0].count).toBe(dispatched ? '2' : '0');
      proxy.failBeforeCommit();
      const aResponse = await a;
      expect(aResponse.status).toBe(503);
      expect((await aResponse.json()).taskIds).toEqual([bBody.taskIds[0]]);
      expect(proxy.connectionErrors.map(error => error.message)).toEqual(['Connection terminated unexpectedly']);
      expect((await query('SELECT status FROM cloud_tasks ORDER BY idempotency_key')).rows).toEqual([{ status: 'processing' }, { status: 'processing' }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([{ type: 'consume', amount: -7 }, { type: 'consume', amount: -7 }]);
      expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toHaveLength(2);
      if (!dispatched) { boundary.auto = true; kicked = boundary.callbacks.splice(0).map(callback => callback()); }
      releaseProvider(); await Promise.all(kicked); await Promise.all(boundary.running);
      expect(providerCalls).toBe(2);
      const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
      expect(recovered.tasks.map((task: { id: string }) => task.id).sort()).toEqual([...bBody.taskIds].sort());
      expect(recovered.tasks.map((task: { status: string }) => task.status)).toEqual(['completed', 'completed']);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(2);
      expect((await query("SELECT * FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([]);
    } finally {
      proxy.failBeforeCommit(); releaseProvider(); await a; await Promise.allSettled(kicked); await Promise.allSettled(boundary.running);
      boundary.auto = false; await proxy.close();
    }
  });
}, 60_000);

it.each([
  ['completed', 'delete'], ['completed', 'unavailable'], ['cancelled', 'delete'], ['cancelled', 'unavailable'],
] as const)('fix1 I2 all %s slots replay after parent %s without IO', async (status, change) => {
    await withIsolatedPostgres(`batch-fix1-terminal-${change}`, async ({ query, databaseUrl, schemaName }) => {
      await seedCanvasGeneration(query, databaseUrl, schemaName);
      let mediaIO = 0;
      vi.stubGlobal('fetch', async (): Promise<Response> => { mediaIO++; return new Response(new Uint8Array(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')))); });
      const body = { referenceImages: ['/api/serve-upload/shared.png'], background: 'opaque' };
      const first = await POST(request(body, 'terminal'));
      expect(first.status).toBe(200); const ids = (await first.json()).taskIds;
      for (const taskId of ids) {
        if (status === 'completed') await recordImageTaskTerminal(taskId, { status, imageUrl: '/api/serve-upload/second.png' });
        else await settleFailedTask({ taskId, status, error: { code: 'USER_CANCELLED', message: 'cancel' } });
      }
      if (change === 'delete') await executeDocumentAssetCommand({ actorId: 'owner', projectId: 'shared', idempotencyKey: 'remove-parent',
        command: { action: 'remove', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } });
      else await query("UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-shared'");
      const before = await canvasBilling(query);
      const assetsBefore = (await query('SELECT row_to_json(v) AS value FROM wujie_asset_versions v ORDER BY id')).rows;
      const commandsBefore = (await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows;
      const placementsBefore = (await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows;
      const documentBefore = (await query('SELECT * FROM wujie_project_canvas_documents')).rows;
      mediaIO = 0; boundary.callbacks = [];
      const replay = await POST(request(body, 'terminal'));
      expect(replay.status).toBe(200);
      const replayBody = await replay.json();
      expect(replayBody.taskIds).toEqual(ids);
      expect(replayBody.slots.map((slot: { status: string }) => slot.status)).toEqual([status, status]);
      expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
      expect(await canvasBilling(query)).toEqual(before);
      expect((await query('SELECT row_to_json(v) AS value FROM wujie_asset_versions v ORDER BY id')).rows).toEqual(assetsBefore);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows).toEqual(commandsBefore);
      expect((await query('SELECT * FROM wujie_workspace_placements ORDER BY id')).rows).toEqual(placementsBefore);
      expect((await query('SELECT * FROM wujie_project_canvas_documents')).rows).toEqual(documentBefore);
      expect((await POST(request({ ...body, prompt: 'changed' }, 'terminal'))).status).toBe(409);
      expect(mediaIO).toBe(0); expect(await canvasBilling(query)).toEqual(before);
      if (status === 'completed' && change === 'delete') {
        for (const changed of [{ aspectRatio: '4:3' }, { size: '1024x1024' }, { outputCount: 1 },
          { referenceImages: ['/api/serve-upload/second.png'] }, { referenceMode: 'style' }, { referenceCategories: ['style'] },
          { referenceStrengths: { style: 50 } }, { referenceCategoryStrengths: [{ style: 50 }] }, { referenceDescriptions: ['different'] },
          { imageCategory: 'product' }, { productCategory: 'shoes' }, { stylePreset: 'ink' }, { strength: 0.5 },
          { quality: 'high' }, { resolution: '2K' }, { background: 'transparent' }, { output_format: 'jpeg' },
          { assetParentVersionIds: ['version-second'] }, { assetSelectedEntityIds: ['image-second'] }, { assetProjectionMode: 'revision' }]) {
          expect((await POST(request({ ...body, ...changed }, 'terminal'))).status, JSON.stringify(changed)).toBe(409);
        }
        const equivalent = await POST(request({ ...body, referenceImages: [{ url: 'http://localhost/api/serve-upload/shared.png' }], assetWorkspaceId: 'canvas:shared' }, 'terminal'));
        expect(equivalent.status).toBe(200); expect((await equivalent.json()).taskIds).toEqual(ids);
        expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
        expect(await canvasBilling(query)).toEqual(before);
        // A payload digest is not a substitute for the actual immutable top-level identity.
        const stored = (await query('SELECT request_digest,result FROM cloud_tasks WHERE id=$1', [ids[0]])).rows[0];
        for (const digest of ['', 'different']) {
          await query('UPDATE cloud_tasks SET request_digest=$2 WHERE id=$1', [ids[0], digest]);
          const corrupted = await canvasBilling(query);
          expect((await POST(request(body, 'terminal'))).status).toBe(409);
          expect(await canvasBilling(query)).toEqual(corrupted);
        }
        await query('UPDATE cloud_tasks SET request_digest=$2 WHERE id=$1', [ids[0], stored.request_digest]);
        for (const metadata of [{ batchId: 'other-root' }, { slotId: 'other:0' }, { slotIndex: 1 }, { slotCount: 3 }]) {
          await query('UPDATE cloud_tasks SET result=$2::jsonb WHERE id=$1', [ids[0], JSON.stringify({ ...stored.result,
            submissionPayload: { ...stored.result.submissionPayload, ...metadata } })]);
          expect((await POST(request(body, 'terminal'))).status).toBe(409);
        }
        await query('UPDATE cloud_tasks SET result=$2::jsonb,project_id=$3 WHERE id=$1', [ids[0], JSON.stringify(stored.result), 'other-project']);
        expect((await POST(request(body, 'terminal'))).status).toBe(409);
        await query("UPDATE cloud_tasks SET project_id='shared' WHERE id=$1", [ids[0]]);
        await revokeDocumentEditor('owner', 'shared', 'editor');
        expect((await POST(request(body, 'terminal'))).status).toBe(403);
        await grantDocumentEditor('owner', 'shared', 'editor');
        const regranted = await POST(request(body, 'terminal'));
        expect(regranted.status).toBe(200); expect((await regranted.json()).taskIds).toEqual(ids);
        expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
        expect(await canvasBilling(query)).toEqual(before);
      }
    });
}, 60_000);

it.each([
  ['missing', 'delete'], ['missing', 'unavailable'], ['processing', 'delete'], ['processing', 'unavailable'],
] as const)('fix1 I2 %s batch still rejects parent %s before media IO', async (state, change) => {
  await withIsolatedPostgres('batch-fix1-source-control', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    if (state === 'missing') await query("UPDATE wujie_credits SET balance=7 WHERE user_id='editor'");
    let mediaIO = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => { mediaIO++; return new Response(new Uint8Array(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')))); });
    const body = { referenceImages: ['/api/serve-upload/shared.png'] };
    expect((await POST(request(body, 'source-control'))).status).toBe(state === 'missing' ? 402 : 200);
    expect((await query('SELECT status FROM cloud_tasks')).rows).toEqual(state === 'missing'
      ? [{ status: 'cancelled' }] : [{ status: 'processing' }, { status: 'processing' }]);
    if (change === 'delete') await executeDocumentAssetCommand({ actorId: 'owner', projectId: 'shared', idempotencyKey: 'remove-parent',
      command: { action: 'remove', placementId: 'placement-shared', expectedAssetVersionId: 'version-shared' } });
    else await query("UPDATE wujie_asset_versions SET availability='missing' WHERE id='version-shared'");
    const before = await canvasBilling(query);
    mediaIO = 0; boundary.callbacks = [];
    expect((await POST(request(body, 'source-control'))).status).toBe(403);
    expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

it('fix1 I2 nonterminal regrant rejects before media IO and leaves original tasks intact', async () => {
  await withIsolatedPostgres('batch-fix1-grant', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    let mediaIO = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => { mediaIO++; return new Response(new Uint8Array(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')))); });
    const body = { referenceImages: ['/api/serve-upload/shared.png'] };
    expect((await POST(request(body))).status).toBe(200);
    await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor');
    const before = await canvasBilling(query); mediaIO = 0; boundary.callbacks = [];
    expect((await POST(request(body))).status).toBe(409);
    expect(mediaIO).toBe(0); expect(boundary.callbacks).toHaveLength(0);
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

it('twenty concurrent real POSTs reuse two paid tasks and reject changed identity without new ledger rows', async () => {
  await withIsolatedPostgres('batch-concurrent-post', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const responses = await Promise.all(Array.from({ length: 20 }, () => POST(request())));
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(responses.map(response => response.status)).toEqual(Array(20).fill(200));
    bodies.forEach(body => expect(body.taskIds).toEqual(bodies[0].taskIds));
    expect((await query('SELECT count(*) FROM cloud_tasks')).rows[0].count).toBe('2');
    expect((await query('SELECT count(*) FROM wujie_canvas_task_publications')).rows[0].count).toBe('2');
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows).toEqual([
      { user_id: 'editor', type: 'consume', amount: -7 }, { user_id: 'editor', type: 'consume', amount: -7 },
    ]);
    expect((await query("SELECT user_id,balance FROM wujie_credits ORDER BY user_id")).rows).toEqual([
      { user_id: 'editor', balance: 86 }, { user_id: 'owner', balance: 100 },
    ]);
    const before = await canvasBilling(query);
    for (const changed of [{ outputCount: 3 }, { assetParentVersionIds: ['version-second'] },
      { assetProjectionMode: 'revision' }, { assetSelectedEntityIds: ['image-second'] }, { prompt: 'different' }]) {
      expect((await POST(request(changed))).status).toBe(409);
      expect(await canvasBilling(query)).toEqual(before);
    }
    const ordered = { assetParentVersionIds: ['version-shared', 'version-second'] };
    expect((await POST(request(ordered, 'ordered'))).status).toBe(200);
    const orderedBefore = await canvasBilling(query);
    expect((await POST(request({ assetParentVersionIds: ['version-second', 'version-shared'] }, 'ordered'))).status).toBe(409);
    expect(await canvasBilling(query)).toEqual(orderedBefore);
  });
}, 60_000);

it('zero price still freezes both intents; owner pays own price; cancelled replay never dispatches', async () => {
  await withIsolatedPostgres('batch-zero-owner', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    await query(`UPDATE wujie_system_settings SET value='{"modelCredits":{"provider::gpt-image-1":0}}' WHERE key='credit_pricing_config'`);
    const free = await (await POST(request())).json();
    expect(free.taskIds).toHaveLength(2);
    expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toHaveLength(2);
    expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toHaveLength(0);
    for (const taskId of free.taskIds) await settleFailedTask({ taskId, status: 'cancelled', error: { code: 'USER_CANCELLED', message: 'cancel' } });
    boundary.callbacks = [];
    const replay = await POST(request()); expect(replay.status).toBe(200);
    let dispatches = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => { dispatches++; return Response.json({ status: 'completed' }); });
    for (const callback of boundary.callbacks) await callback();
    expect(dispatches).toBe(0);
    await query(`UPDATE wujie_system_settings SET value='{"modelCredits":{"provider::gpt-image-1":7}}' WHERE key='credit_pricing_config'`);
    boundary.actor = 'owner'; expect((await POST(request({}, 'owner'))).status).toBe(200);
    expect((await query('SELECT user_id,amount FROM wujie_credit_transactions ORDER BY id')).rows).toEqual([{ user_id: 'owner', amount: -7 }, { user_id: 'owner', amount: -7 }]);
  });
}, 60_000);

it('ordinary private, unscoped, chat and workflow POSTs retain one consume per output without canvas intents', async () => {
  await withIsolatedPostgres('batch-other-branches', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    for (const [index, body] of [{ projectId: 'private' }, { projectId: undefined }, { assetWorkspace: 'chat' }, { assetWorkspace: 'workflow' }].entries()) {
      const response = await POST(request(body, `other-${index}`)); expect(response.status).toBe(200);
      expect((await response.json()).taskIds).toHaveLength(2);
    }
    expect((await query('SELECT * FROM cloud_tasks')).rows).toHaveLength(8);
    expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toEqual([]);
    expect((await query("SELECT amount FROM wujie_credit_transactions WHERE type='consume'")).rows).toEqual(Array.from({ length: 8 }, () => ({ amount: -7 })));
  });
}, 60_000);

it('invalid proposals, destination and escape flags reject before billing; layout selection does not require a parent', async () => {
  await withIsolatedPostgres('batch-invalid-post', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const before = await canvasBilling(query);
    for (const body of [{ assetParentVersionIds: 'version-shared' }, { assetParentVersionIds: ['version-shared', 'version-shared'] },
      { assetProjectionMode: 'replace' }, { assetSelectedEntityIds: ['missing'] }, { assetWorkspaceId: 'other' },
      { _skipCredits: true }, { _skipCloudTaskPersistence: true },
      { referenceImages: ['/api/serve-upload/second.png'] }]) {
      expect([400, 403, 409]).toContain((await POST(request(body))).status);
      expect(await canvasBilling(query)).toEqual(before);
    }
    expect((await POST(request({ assetParentVersionIds: [] }))).status).toBe(200);
    const rows = (await query('SELECT publication_intent FROM wujie_canvas_task_publications')).rows;
    expect(rows.map(row => row.publication_intent.parentVersionIds)).toEqual([[], []]);
    expect(rows.map(row => row.publication_intent.selectionSnapshot)).toEqual(Array.from({ length: 2 }, () => [
      { entityId: 'image-shared', placementId: 'placement-shared', assetVersionId: 'version-shared' },
    ]));
  });
}, 60_000);

it('explicit null publication fields are invalid types and never become default empty intents', async () => {
  await withIsolatedPostgres('batch-null-proposal', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const before = await canvasBilling(query);
    for (const field of ['assetParentVersionIds', 'assetSelectedEntityIds', 'assetProjectionMode']) {
      expect((await POST(request({ [field]: null }, field))).status).toBe(400);
      expect(await canvasBilling(query)).toEqual(before);
    }
  });
}, 60_000);

it('real recovery lease dispatches two provider calls across repeated POST kickoff and completed replay dispatches none', async () => {
  await withIsolatedPostgres('batch-provider-dispatch', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const { POST: poll } = await import('@/app/api/poll-task/route');
    let providerCalls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, 'http://localhost');
      if (target.pathname === '/api/serve-upload/second.png') return new Response(new Uint8Array(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png'))), { headers: { 'content-type': 'image/png' } });
      if (target.pathname === '/api/poll-task') return poll(new NextRequest(target, { ...options, signal: options?.signal ?? undefined }));
      if (target.pathname === '/api/generate') return POST(new NextRequest(target, { ...options, signal: options?.signal ?? undefined }));
      if (target.hostname === 'provider.invalid') {
        expect(target.pathname).toMatch(/\/images\/generations$/);
        const body = JSON.parse(String(options?.body)); expect(body.model).toBe('gpt-image-1'); expect(body.n).toBe(1);
        providerCalls++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
      }
      throw new Error(`Unexpected network boundary: ${target.origin}${target.pathname}`);
    });
    const first = await (await POST(request({}, 'dispatch'))).json();
    expect((await POST(request({}, 'dispatch'))).status).toBe(200);
    const callbacks = boundary.callbacks.splice(0); boundary.auto = true;
    try { await Promise.all(callbacks.map(callback => callback())); await Promise.all(boundary.running); }
    finally { boundary.auto = false; }
    expect(providerCalls).toBe(2);
    expect((await query('SELECT status FROM cloud_tasks')).rows).toEqual([{ status: 'completed' }, { status: 'completed' }]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(2);
    expect((await (await POST(request({}, 'dispatch'))).json()).taskIds).toEqual(first.taskIds);
    await Promise.all(boundary.callbacks.splice(0).map(callback => callback()));
    expect(providerCalls).toBe(2);
    expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toHaveLength(2);
  });
}, 60_000);

it('revision batch stays in the original asset family while appending two results without replacing the source', async () => {
  await withIsolatedPostgres('batch-revision', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    const response = await POST(request({ assetProjectionMode: 'revision' }, 'revision'));
    expect(response.status).toBe(200); const body = await response.json();
    for (const taskId of body.taskIds) await recordImageTaskTerminal(taskId, { status: 'completed', imageUrl: '/api/serve-upload/second.png' });
    expect((await query("SELECT asset_id FROM wujie_asset_versions WHERE task_id IS NOT NULL AND task_id<>''")).rows).toEqual([{ asset_id: 'asset-shared' }, { asset_id: 'asset-shared' }]);
    expect((await query("SELECT asset_version_id FROM wujie_workspace_placements WHERE id='placement-shared'")).rows).toEqual([{ asset_version_id: 'version-shared' }]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(2);
  });
}, 60_000);

it.each([
  { reused: false, slot: 1 }, { reused: false, slot: 2 },
  { reused: true, slot: 1 }, { reused: true, slot: 2 },
])('real POST unknown COMMIT reused=$reused slot=$slot returns safe partial IDs without kickoff or settlement', async ({ reused, slot }) => {
  await withIsolatedPostgres('batch-route-unknown', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasGeneration(query, databaseUrl, schemaName);
    // No parent context transaction: the front door has one read-only COMMIT,
    // followed by the real core slot COMMITs targeted below.
    const body = { assetParentVersionIds: [] };
    if (reused) expect((await POST(request(body, 'unknown'))).status).toBe(200);
    boundary.callbacks = [];
    let dispatches = 0;
    vi.stubGlobal('fetch', async (): Promise<never> => { dispatches++; throw new Error('No dispatch before full admission'); });
    const proxy = await loseCanvasCommitReply(databaseUrl, slot + 1);
    try {
      const response = await POST(request(body, 'unknown'));
      const responseBody = await response.json();
      expect(response.status).toBe(503);
      expect(responseBody.code).toBe('CANVAS_BATCH_COMMIT_UNKNOWN');
      expect(proxy.dropped()).toBe(true);
      expect(proxy.connectionErrors.map(error => error.message)).toEqual(['Connection terminated unexpectedly']);
      const rows = (await query('SELECT id,status FROM cloud_tasks ORDER BY idempotency_key')).rows;
      expect(rows.map(row => row.status)).toEqual(Array(reused ? 2 : slot).fill('processing'));
      expect(responseBody.taskIds).toEqual(slot === 1 ? [] : [rows[0].id]);
      expect(boundary.callbacks).toHaveLength(0);
      expect(dispatches).toBe(0);
      expect((await query("SELECT * FROM wujie_credit_transactions WHERE type='refund'")).rows).toEqual([]);
      const responseText = JSON.stringify(responseBody);
      expect(responseText).not.toMatch(/SELECT|INSERT|ROLLBACK|postgres|test-only|submissionPayload/);
    } finally { await proxy.close(); }
    const existing = (await query('SELECT id FROM cloud_tasks ORDER BY idempotency_key')).rows.map(row => row.id);
    const recovered = await POST(request(body, 'unknown'));
    expect(recovered.status).toBe(200);
    const recoveredIds = (await recovered.json()).taskIds;
    expect(recoveredIds.slice(0, existing.length)).toEqual(existing);
    expect(recoveredIds).toHaveLength(2);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([
      { type: 'consume', amount: -7 }, { type: 'consume', amount: -7 },
    ]);
    expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toHaveLength(2);
    expect(dispatches).toBe(0);
  });
}, 60_000);

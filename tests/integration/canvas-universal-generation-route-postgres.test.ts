import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const boundary = vi.hoisted(() => ({ actor: 'editor', unauthorized: false, throwAfter: false, denied: 0, discoveries: 0, callbacks: [] as Array<() => Promise<void>>,
  providerReads: [] as string[], catalogReads: 0, alternateFirst: false,
  alternate: { id: 'alternate', name: 'Alternate', modelType: 'image', type: 'image', isEnabled: true, createdAt: 1, updatedAt: 1,
    baseUrl: 'https://alternate.invalid', apiKey: 'alternate-only', selectedModels: ['gpt-image-1'], discoveredModels: [] },
  provider: { id: 'provider', name: 'Fixture', modelType: 'image', type: 'image', isEnabled: true, createdAt: 1, updatedAt: 1,
    baseUrl: 'https://provider.invalid', apiKey: 'test-only', selectedModels: ['gpt-image-1'], discoveredModels: [], compatProfile: 'openai', advancedParams: { compatProfile: 'openai' } } }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { if (boundary.throwAfter) throw new Error('Scheduler unavailable'); boundary.callbacks.push(callback); } }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<unknown> => ({ userId: boundary.actor, userRole: 'user', source: 'session',
    user: { id: boundary.actor, name: boundary.actor, role: 'user', status: 'active', imageModels: boundary.unauthorized ? ['other::other'] : ['provider::gpt-image-1'] } }),
  getRequestUser: async (): Promise<unknown> => ({ user: { id: boundary.actor, role: 'user' }, userId: boundary.actor }),
  getTrustedRequestAgentExecutionFence: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<unknown> => ({ id: boundary.actor }) }));
vi.mock('@/lib/server-api-config', () => ({
  findProviderById: async (id: string): Promise<unknown> => { boundary.providerReads.push(id); return id === boundary.provider.id ? boundary.provider : id === boundary.alternate.id ? boundary.alternate : null; },
  findProviderForModel: async (): Promise<unknown> => { boundary.discoveries++; return boundary.alternateFirst ? boundary.alternate : boundary.provider; },
  getApiProviders: async (): Promise<unknown[]> => { boundary.catalogReads++; return boundary.alternateFirst ? [boundary.alternate, boundary.provider] : [boundary.provider, boundary.alternate]; },
  normalizeApiBaseUrl: (value: string): string => value,
}));
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasUniversal, universalBody, universalSnapshot, universalGate, lockUniversalAdmission, invalidUniversalSource } from '../helpers/canvas-universal-generation-fixture';
import { canvasBilling, moveCanvasSource, loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { abortTaskExecution } from '@/lib/task-core/task-abort';
import { getTaskInfo } from '@/lib/task-registry';
import sharp from 'sharp';
import { POST } from '@/app/api/universal-generate/route';
import { POST as POLL } from '@/app/api/poll-task/route';
import { POST as CANCEL } from '@/app/api/cancel-task/route';
import { GET } from '@/app/api/tasks/recover/route';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';
import { getCloudTaskForUser, claimCloudTaskLease, updateCloudTask, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import * as safeImageInput from '@/lib/safe-image-input';

beforeEach((): void => {
  boundary.denied = 0;
  boundary.discoveries = 0;
  boundary.providerReads = []; boundary.catalogReads = 0; boundary.alternateFirst = false;
  vi.stubGlobal('fetch', async (): Promise<never> => { boundary.denied++; throw new Error('Unconfigured network forbidden'); });
});
afterEach((): void => { boundary.callbacks = []; boundary.actor = 'editor'; boundary.unauthorized = false; boundary.provider.isEnabled = true; boundary.throwAfter = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function request(body: Record<string, unknown> = universalBody(), key: string = 'universal-once', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/universal-generate', { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key, ...headers }, body: JSON.stringify(body) });
}
it('Fix1 W03: actual poll keeps admitted provider, normalized alias, endpoint and cost after discovery/configuration changes', async () => {
  await withIsolatedPostgres('task8cb3h_fix1_frozen', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const body = universalBody({ submitOnly: true, providerId: undefined, model: 'gpt-image-1-4k' });
    const admitted = await (await POST(request(body))).json(); expect(admitted.taskId).toMatch(/^universal_/); expect(boundary.discoveries).toBe(1);
    const original = structuredClone(boundary.provider); boundary.callbacks = [];
    boundary.providerReads = []; boundary.catalogReads = 0; boundary.discoveries = 0;
    try {
      boundary.alternateFirst = true;
      // The advertised alias now exists as an independent configured model, not the old base name.
      boundary.provider.selectedModels = ['gpt-image-1-4k']; boundary.provider.baseUrl = 'https://changed.invalid';
      boundary.provider.advancedParams.compatProfile = 'apimart'; boundary.provider.apiKey = 'rotated-test-only';
      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 99, 'alternate::gpt-image-1': 88 } })]);
      let submits = 0;
      vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
        expect(url).toBe('https://provider.invalid/images/generations'); expect(init.method).toBe('POST');
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer rotated-test-only');
        expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-image-1', prompt: '蓝色杯子', n: 1 });
        submits++; return Response.json({ data: [{ url: pngUrl() }] });
      });
      expect((await POLL(pollRequest(admitted.taskId))).status).toBe(200); await drain();
      expect((await getCloudTaskForUser(admitted.taskId, 'editor'))).toMatchObject({ status: 'completed', providerId: 'provider', model: 'gpt-image-1', creditCost: 7 });
      expect(boundary.providerReads).toEqual(['provider']); expect(boundary.catalogReads).toBe(0); expect(boundary.discoveries).toBe(0); expect(submits).toBe(1);
      const before = await universalSnapshot(query);
      expect((await (await POST(request(body))).json()).taskId).toBe(admitted.taskId);
      await POLL(pollRequest(admitted.taskId)); await drain(); expect(await universalSnapshot(query)).toEqual(before);
      const state = await canvasBilling(query); expect(state.transactions.map(row => Number(row.amount))).toEqual([-7]);
      expect(boundary.providerReads).toEqual(['provider']); expect(submits).toBe(1);
    } finally { Object.assign(boundary.provider, original); boundary.alternateFirst = false; }
  });
}, 60_000);

it.each(['missing', 'foreign', 'disabled', 'unauthorized'])('Fix1 W04: %s model/provider rejection never calls the real safe reader', async scenario => {
  await withIsolatedPostgres('task8cb3h_fix1_reader', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const media = vi.spyOn(safeImageInput, 'loadSafeImageInput'); const before = await universalSnapshot(query);
    if (scenario === 'disabled') boundary.provider.isEnabled = false;
    if (scenario === 'unauthorized') boundary.unauthorized = true;
    const response = await POST(request(universalBody({ referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'],
      ...(scenario === 'missing' ? { providerId: 'missing' } : scenario === 'foreign' ? { model: 'other' } : {}) })));
    expect(response.status).toBe(400); expect(media).not.toHaveBeenCalled(); expect(boundary.denied).toBe(0);
    expect(boundary.discoveries).toBe(0); expect(await universalSnapshot(query)).toEqual(before); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);
it.each(['sync', 'after', 'poll'].flatMap(mode => (['invalid', 'oversized', 'corrupt'] as const).map(kind => ({ mode, kind }))))(
  'Fix1 I03: $mode terminates confirmed pre-submit $kind media and refunds only once', async ({ mode, kind }) => {
    await withIsolatedPostgres('task8cb3h_fix1_media', async ({ query, databaseUrl, schemaName }) => {
      await seedCanvasUniversal(query, databaseUrl, schemaName); const source = await invalidUniversalSource(query, kind);
      const media = vi.spyOn(safeImageInput, 'loadSafeImageInput');
      const sourceRow = (await query("SELECT * FROM wujie_asset_versions WHERE id='version-shared'")).rows[0]; expect(sourceRow.availability).toBe('ready');
      const result = await (await POST(request(universalBody({ submitOnly: mode !== 'sync', referenceImageUrl: source.url, assetParentVersionIds: ['version-shared'] })))).json();
      expect(result.taskId).toMatch(/^universal_/);
      if (mode === 'poll') { boundary.callbacks = []; await POLL(pollRequest(result.taskId)); }
      if (mode !== 'sync') await drain();
      const task = await getCloudTaskForUser(result.taskId, 'editor');
      expect(media).toHaveBeenCalledWith(source.url, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(task?.result?.submissionPhase).toBeUndefined(); expect(boundary.denied).toBe(0);
      expect(task?.status).toBe('failed'); expect(getTaskInfo(result.taskId)?.status).toBe('failed');
      const beforeReplay = await universalSnapshot(query);
      for (let count = 0; count < 2; count++) {
        const polled = await (await POLL(pollRequest(result.taskId))).json(); expect(polled).toMatchObject({ success: false, status: 'failed' }); await drain();
      }
      expect(await universalSnapshot(query)).toEqual(beforeReplay);
      const state = await canvasBilling(query); expect(state.transactions.filter(row => row.type === 'consume')).toHaveLength(1);
      expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1); expect(state.credits.map(row => Number(row.balance))).toEqual([100, 100]);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
      expect((await query("SELECT * FROM wujie_asset_versions WHERE id='version-shared'")).rows[0]).toEqual(sourceRow);
    });
  }, 60_000);

it('Fix1 I03: unavailable managed storage stays retryable before started and real poll completes when bytes return', async () => {
  await withIsolatedPostgres('task8cb3h_fix1_media_retry', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const source = await invalidUniversalSource(query, 'unavailable');
    const result = await (await POST(request(universalBody({ referenceImageUrl: source.url, assetParentVersionIds: ['version-shared'] })))).json();
    expect(result.status).toBe('processing'); expect((await getCloudTaskForUser(result.taskId, 'editor'))?.result?.submissionPhase).toBeUndefined();
    expect((await canvasBilling(query)).transactions).toHaveLength(1); expect(boundary.denied).toBe(0);
    writeFileSync(source.path, readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')));
    const provider = directProvider(); await POLL(pollRequest(result.taskId)); await drain();
    expect((await getCloudTaskForUser(result.taskId, 'editor'))?.status).toBe('completed'); expect(provider.submits()).toBe(1);
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);
it.each([
  ...['', null, false, 0, 1, true, [], {}, ' ', ' provider', 'provider '].map(providerId => ({ label: `provider=${JSON.stringify(providerId)}`, fields: { providerId } })),
  ...['::gpt-image-1', 'provider::', '::', ' ::gpt-image-1', 'provider:: ', 'provider::gpt-image-1::', 'other::gpt-image-1', null, false, 0].map(model => ({ label: `model=${JSON.stringify(model)}`, fields: { model } })),
])('Fix1 I02/W04: explicit invalid $label cannot discover, bill or read source bytes', async ({ fields }) => {
  await withIsolatedPostgres('task8cb3h_fix1_provider', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    // Observation only: vi.spyOn forwards to the real safe reader without replacing its return/error.
    const media = vi.spyOn(safeImageInput, 'loadSafeImageInput'); const before = await universalSnapshot(query);
    const response = await POST(request(universalBody({ submitOnly: true, referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'], ...fields })));
    expect(response.status).toBe(400); expect(await universalSnapshot(query)).toEqual(before);
    expect(boundary.discoveries).toBe(0); expect(boundary.denied).toBe(0); expect(boundary.callbacks).toHaveLength(0); expect(media).not.toHaveBeenCalled();
  });
}, 60_000);

it.each(['omitted', 'composite', 'matching'])('Fix1 I02: valid %s provider identity still completes through the actual reader', async scenario => {
  await withIsolatedPostgres('task8cb3h_fix1_valid_provider', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const media = vi.spyOn(safeImageInput, 'loadSafeImageInput'); const provider = directProvider();
    const response = await POST(request(universalBody({ providerId: scenario === 'matching' ? 'provider' : undefined,
      model: scenario === 'omitted' ? 'gpt-image-1' : 'provider::gpt-image-1', referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'] })));
    expect(response.status).toBe(200); expect((await response.json()).status).toBe('completed');
    expect(boundary.discoveries).toBe(scenario === 'omitted' ? 1 : 0); expect(provider.submits()).toBe(1);
    expect(media).toHaveBeenCalledWith('/api/serve-upload/shared.png', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);
it('Fix1 I01: no-key COMMIT ACK loss returns the generated key and recovers one actual task', async () => {
  await withIsolatedPostgres('task8cb3h_fix1_key_ack', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const body = universalBody({ submitOnly: true }); const proxy = await loseCanvasCommitReply(databaseUrl, 2);
    let response: Response;
    try {
      response = await POST(new NextRequest('http://localhost/api/universal-generate', { method: 'POST', body: JSON.stringify(body) }));
      expect(proxy.dropped()).toBe(true);
    } finally { await proxy.close(); }
    expect(response.status).toBe(503); const result = await response.json();
    const admitted = await canvasBilling(query);
    expect(admitted.tasks).toHaveLength(1); expect(admitted.publications).toHaveLength(1); expect(admitted.transactions).toHaveLength(1);
    expect(result).not.toHaveProperty('taskId');
    expect(result.idempotencyKey).toBe(admitted.tasks[0].idempotency_key);
    expect(result.idempotencyKey).toEqual(expect.any(String));
    const replay = await (await POST(request(body, result.idempotencyKey))).json();
    expect(replay.taskId).toBe(admitted.tasks[0].id);
    const provider = directProvider(); await drain(); expect(provider.submits()).toBe(1);
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(1); expect(state.publications).toHaveLength(1); expect(state.transactions).toHaveLength(1);
  });
}, 60_000);

it('Fix1 I01: admitted no-key task preserves identity on a real database read outage without resubmitting', async () => {
  await withIsolatedPostgres('task8cb3h_fix1_key_outage', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); let submits = 0;
    vi.stubGlobal('fetch', async (url: string): Promise<Response> => {
      expect(url).toBe('https://provider.invalid/images/generations'); submits++;
      await query('ALTER TABLE cloud_tasks RENAME TO unavailable_cloud_tasks');
      return Response.json({ data: [{ url: pngUrl() }] });
    });
    let response: Response;
    try { response = await POST(new NextRequest('http://localhost/api/universal-generate', { method: 'POST', body: JSON.stringify(universalBody()) })); }
    finally { await query('ALTER TABLE unavailable_cloud_tasks RENAME TO cloud_tasks'); }
    expect(response.status).toBe(503); const result = await response.json(); const before = await canvasBilling(query);
    expect(before.tasks).toHaveLength(1); expect(result.idempotencyKey).toBe(before.tasks[0].idempotency_key);
    expect(result).not.toHaveProperty('taskId');
    const replay = await (await POST(request(universalBody(), result.idempotencyKey))).json();
    expect(replay.taskId).toBe(before.tasks[0].id); expect(replay.status).toBe('processing');
    // The outage also prevented release: an active lease must not be stolen.
    await query('UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1', [replay.taskId]);
    const recovered = await (await POST(request(universalBody(), result.idempotencyKey))).json();
    expect(recovered.taskId).toBe(replay.taskId); expect(recovered.code).toBe('UNIVERSAL_SUBMISSION_UNCERTAIN'); expect(submits).toBe(1);
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(1); expect(state.publications).toHaveLength(1); expect(state.transactions).toHaveLength(1);
  });
}, 60_000);
it('A: real synchronous POST creates one atomic actor task, publication and consume', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3h_first', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
      expect(url).toBe('https://provider.invalid/images/generations'); expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-image-1', prompt: '蓝色杯子', n: 1 });
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    });
    const response = await POST(request());
    expect(response.status).toBe(200); expect((await response.json()).images).toHaveLength(1);
    const state = await canvasBilling(query);
    console.info('BUSINESS RED: task/intent/consume counts', state.tasks.length, state.publications.length, state.transactions.length);
    expect(state.tasks).toHaveLength(1); expect(state.publications).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ type: 'universal-generate', user_id: 'editor' });
    expect(state.transactions.filter(row => row.type === 'consume')).toHaveLength(1);
    expect(state.credits.map(row => [row.user_id, Number(row.balance)])).toEqual([['editor', 93], ['owner', 100]]);
  });
}, 60_000);

it.each(['regrant', 'actor', 'owner', 'archive', 'document', 'global', 'delete-selection', 'change-selection'])('B: real PG admission lock sees %s and rolls back all effects', async scenario => {
  await withIsolatedPostgres('task8cb3h_lock', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const lock = await lockUniversalAdmission('locked');
    const pending = POST(request(universalBody({ submitOnly: true, assetSelectedEntityIds: ['image-shared'] }), 'locked'));
    try {
      await lock.wait(query);
      if (scenario === 'regrant') { await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor'); }
      if (['actor', 'owner'].includes(scenario)) await query("UPDATE wujie_users SET status='disabled' WHERE id=$1", [scenario === 'actor' ? 'editor' : 'owner']);
      if (scenario === 'archive') await query("UPDATE wujie_projects SET status='trashed'");
      if (scenario === 'document') await query('UPDATE wujie_project_document_settings SET enabled=false');
      if (scenario === 'global') process.env.WUJIE_YJS_ENABLED = 'false';
      if (scenario === 'delete-selection') await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
      if (scenario === 'change-selection') await query("UPDATE wujie_workspace_placements SET asset_id='asset-second',asset_version_id='version-second' WHERE id='placement-shared'");
    } finally { await lock.release(); }
    expect((await pending).status).toBeGreaterThanOrEqual(400);
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(0); expect(state.publications).toHaveLength(0); expect(state.transactions).toHaveLength(0);
    expect(boundary.denied).toBe(0);
  });
}, 60_000);

it.each(['completed', 'failed', 'cancelled', 'timeout'])('B: %s replay is full-schema read-only after sources disappear', async status => {
  await withIsolatedPostgres('task8cb3h_terminal', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const body = universalBody({ submitOnly: true, referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'] });
    const { taskId } = await (await POST(request(body))).json();
    if (status === 'completed') { directProvider(); await drain(); }
    else await terminateCloudTaskAndRefund(taskId, status as 'failed' | 'cancelled' | 'timeout', 'Fixture terminal');
    await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'"); boundary.callbacks = [];
    const before = await universalSnapshot(query); const result = await (await POST(request(body))).json();
    expect(result.status).toBe(status); expect(result.success).toBe(status === 'completed');
    expect(await universalSnapshot(query)).toEqual(before); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it.each(['video', 'missing', 'cross-owner', 'cross-project', 'wrong-url'])('B: real %s reference cannot enter billing', async scenario => {
  await withIsolatedPostgres('task8cb3h_source', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    if (scenario === 'video') await query("UPDATE wujie_assets SET kind='video'");
    if (scenario === 'missing') await query("UPDATE wujie_asset_versions SET availability='missing'");
    if (scenario.startsWith('cross-')) {
      const owner = scenario === 'cross-owner' ? 'editor' : 'owner';
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('foreign',$1,'Other')", [owner]);
      await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('foreign-asset',$1,'foreign','image')", [owner]);
      await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
        SELECT 'foreign-version','foreign-asset',$1,'foreign',file_url,mime_type,byte_size,checksum,width,height FROM wujie_asset_versions WHERE id='version-shared'`, [owner]);
    }
    const response = await POST(request(universalBody({ referenceImageUrl: scenario === 'wrong-url' ? '/api/serve-upload/second.png' : '/api/serve-upload/shared.png',
      assetParentVersionIds: [scenario.startsWith('cross-') ? 'foreign-version' : 'version-shared'] })));
    expect([400, 403, 409]).toContain(response.status); expect((await canvasBilling(query)).tasks).toHaveLength(0); expect(boundary.denied).toBe(0);
  });
}, 60_000);

it('B: canvas movement and changed provider pricing leave frozen task target and coordinates intact', async () => {
  await withIsolatedPostgres('task8cb3h_frozen', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const body = universalBody({ submitOnly: true, assetSelectedEntityIds: ['image-shared'] });
    const { taskId } = await (await POST(request(body))).json();
    await moveCanvasSource(500); await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 99 } })]);
    const original = boundary.provider.baseUrl; boundary.provider.baseUrl = 'https://changed.invalid';
    try {
      expect((await POST(request(body))).status).toBe(200); const provider = directProvider(); await drain(); expect(provider.submits()).toBe(1);
      const state = await canvasBilling(query); expect(state.tasks[0].id).toBe(taskId); expect(Number(state.tasks[0].credit_cost)).toBe(7);
      const intent = state.publications[0].publication_intent as { placement: { transform: { x: number } } }; expect(intent.placement.transform.x).toBe(132);
    } finally { boundary.provider.baseUrl = original; }
  });
}, 60_000);

it('C: route COMMIT ACK loss returns 503 then original key recovers same task', async () => {
  await withIsolatedPostgres('task8cb3h_route_ack', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const proxy = await loseCanvasCommitReply(databaseUrl, 2);
    try { expect((await POST(request(universalBody({ submitOnly: true })))).status).toBe(503); expect(proxy.dropped()).toBe(true); }
    finally { await proxy.close(); }
    const before = await canvasBilling(query); expect(before.tasks).toHaveLength(1); expect(before.transactions).toHaveLength(1); expect(before.publications).toHaveLength(1);
    const response = await POST(request(universalBody({ submitOnly: true }))); expect((await response.json()).taskId).toBe(before.tasks[0].id);
    const provider = directProvider(); await drain(); expect(provider.submits()).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it.each(['multi', 'revoked', 'regrant', 'deleted', 'closed', 'archived'])('C: real remote checkpoint %s survives restart and poll never resubmits', async scenario => {
  await withIsolatedPostgres('task8cb3h_remote', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); let submits = 0; let interrupted = false; const polls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
      if (init.method === 'POST') { submits++; return Response.json({ data: [{ task_id: 'remote-one' }, { task_id: 'remote-two' }] }); }
      expect(url).toMatch(/^https:\/\/provider.invalid\/tasks\/remote-(one|two)\?language=zh$/);
      if (!interrupted) { interrupted = true; throw new Error('Worker interrupted after persisted checkpoint'); }
      polls.push(url); return Response.json({ status: 'completed', result: { images: [{ url: pngUrl() }] } });
    });
    const body = universalBody({ submitOnly: true, n: 2, referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'] });
    const { taskId } = await (await POST(request(body))).json(); await drain();
    const stored = await getCloudTaskForUser(taskId, 'editor'); expect(stored?.result?.universalCheckpoint).toMatchObject({ kind: 'remote' });
    if (scenario === 'revoked' || scenario === 'regrant') await revokeDocumentEditor('owner', 'shared', 'editor');
    if (scenario === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
    if (scenario === 'closed') await query('UPDATE wujie_project_document_settings SET enabled=false');
    if (scenario === 'archived') await query("UPDATE wujie_projects SET status='trashed'");
    if (scenario === 'deleted') await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
    (globalThis as unknown as { __wujie_task_store__: { registry: Map<string, unknown> } }).__wujie_task_store__.registry.delete(taskId);
    expect(getTaskInfo(taskId)).toBeUndefined();
    expect((await POLL(pollRequest(taskId))).status).toBe(200); await drain();
    const completed = await (await POLL(pollRequest(taskId))).json(); expect(completed.status).toBe('completed'); expect(completed.images).toHaveLength(2);
    expect(submits).toBe(1); expect(polls).toEqual(['https://provider.invalid/tasks/remote-one?language=zh', 'https://provider.invalid/tasks/remote-two?language=zh']);
    await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(scenario === 'multi' ? 2 : 0);
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('C: direct image checkpoint survives failed completion SQL and actual poll recovers without POST', async () => {
  await withIsolatedPostgres('task8cb3h_direct_checkpoint', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    await query(`CREATE FUNCTION fail_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='completed' THEN RAISE EXCEPTION 'completion interrupted'; END IF; RETURN NEW; END $$`);
    await query('CREATE TRIGGER fail_complete BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION fail_complete()');
    const provider = directProvider(); const { taskId } = await (await POST(request())).json();
    expect((await getCloudTaskForUser(taskId, 'editor'))?.result?.universalCheckpoint).toMatchObject({ kind: 'direct' });
    await query('DROP TRIGGER fail_complete ON cloud_tasks'); await POLL(pollRequest(taskId)); await drain();
    expect((await getCloudTaskForUser(taskId, 'editor'))?.status).toBe('completed'); expect(provider.submits()).toBe(1);
  });
}, 60_000);

it('C: scheduling failure leaves the admitted task recoverable by poll', async () => {
  await withIsolatedPostgres('task8cb3h_after', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); boundary.throwAfter = true;
    const response = await POST(request(universalBody({ submitOnly: true }))); expect(response.status).toBe(200); const { taskId } = await response.json();
    boundary.throwAfter = false; const provider = directProvider(); await POLL(pollRequest(taskId)); await drain();
    expect((await getCloudTaskForUser(taskId, 'editor'))?.status).toBe('completed'); expect(provider.submits()).toBe(1);
  });
}, 60_000);

it.each([400, 404, 405])('C: explicit HTTP %i uses only the permitted rejection or v1 fallback', async status => {
  await withIsolatedPostgres('task8cb3h_http', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => { expect(init.signal).toBeInstanceOf(AbortSignal); urls.push(url);
      return urls.length === 1 ? Response.json({ error: { message: 'rejected' } }, { status }) : Response.json({ data: [{ url: pngUrl() }] }); });
    const response = await POST(request()); const result = await response.json();
    expect(result.status).toBe(status === 400 ? 'failed' : 'completed');
    expect(urls).toEqual(status === 400 ? ['https://provider.invalid/images/generations'] : ['https://provider.invalid/images/generations', 'https://provider.invalid/v1/images/generations']);
    expect((await canvasBilling(query)).transactions.filter(row => row.type === 'refund')).toHaveLength(status === 400 ? 1 : 0);
  });
}, 60_000);

it.each(['failed', 'timeout'])('D: confirmed remote %s settles exactly once', async ending => {
  await withIsolatedPostgres('task8cb3h_remote_terminal', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); let taskId = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit): Promise<Response> => {
      if (init.method === 'POST') return Response.json({ task_id: 'remote-one' });
      if (ending === 'timeout') { abortTaskExecution(taskId, 'timeout'); throw new Error('Deadline'); }
      return Response.json({ status: 'failed', error: { message: 'Provider failed' } });
    });
    taskId = (await (await POST(request(universalBody({ submitOnly: true })))).json()).taskId; await drain();
    await POLL(pollRequest(taskId)); await drain(); const state = await canvasBilling(query);
    expect(state.tasks[0].status).toBe(ending); expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1);
  });
}, 60_000);

it.each(['success', 'failure'])('D: lease takeover fences old worker late %s and all local progress', async ending => {
  await withIsolatedPostgres('task8cb3h_takeover', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const hold = universalGate(); let io = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => { io++; hold.enter(); await hold.released;
      return ending === 'success' ? Response.json({ data: [{ url: pngUrl() }] }) : Response.json({ error: 'failed' }, { status: 400 }); });
    const { taskId } = await (await POST(request(universalBody({ submitOnly: true })))).json(); const running = drain(); await hold.reached;
    try {
      await query('UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1', [taskId]); expect(await claimCloudTaskLease(taskId, 'successor', 660000)).not.toBeNull();
      await updateCloudTask(taskId, { leaseOwner: 'successor', progress: 77 });
      const before = await canvasBilling(query); const local = structuredClone(getTaskInfo(taskId));
      hold.release(); await running;
      expect(await canvasBilling(query)).toEqual(before); expect(getTaskInfo(taskId)).toEqual(local); expect(io).toBe(1);
    } finally { hold.release(); await running; }
  });
}, 60_000);

it('D: projection SQL failure preserves personal completed result and GET retries publication once', async () => {
  await withIsolatedPostgres('task8cb3h_projection', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    await query("ALTER TABLE wujie_canvas_asset_commands ADD CONSTRAINT reject_universal_command CHECK (false)");
    const provider = directProvider(); const response = await POST(request()); const { taskId } = await response.json();
    expect((await getCloudTaskForUser(taskId, 'editor'))?.status).toBe('completed');
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    await query('ALTER TABLE wujie_canvas_asset_commands DROP CONSTRAINT reject_universal_command');
    for (let i = 0; i < 2; i++) expect((await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).status).toBe(200);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    expect(provider.submits()).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

function pngUrl(): string { return `data:image/png;base64,${readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')).toString('base64')}`; }
function directProvider(count: number = 1): { submits: () => number } {
  let submits = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit): Promise<Response> => {
    expect(url).toMatch(/^https:\/\/provider.invalid\/(v1\/)?images\/(generations|edits)$/); expect(init.method).toBe('POST');
    submits++; return Response.json({ data: Array.from({ length: count }, () => ({ url: pngUrl() })) });
  });
  return { submits: (): number => submits };
}
async function drain(): Promise<void> { await Promise.all(boundary.callbacks.splice(0).map(callback => callback())); }
function pollRequest(taskId: string, extra: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/poll-task', { method: 'POST', body: JSON.stringify({ taskId, ...extra }) });
}

it.each([{ mode: 'derived', n: 1, reference: true }, { mode: 'revision', n: 1, reference: true },
  { mode: 'derived', n: 5, reference: false }, { mode: 'derived', n: 3, reference: true }])('A: $mode n=$n reference=$reference persists actual canonical outputs and immutable source', async ({ mode, n, reference }) => {
  await withIsolatedPostgres('task8cb3h_outputs', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const original = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    const source = (await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-shared'")).rows;
    const sourceVersion = (await query("SELECT * FROM wujie_asset_versions WHERE id='version-shared'")).rows;
    const provider = directProvider(n === 3 ? 2 : n);
    const response = await POST(request(universalBody({ n, assetProjectionMode: mode, assetSelectedEntityIds: ['image-shared'],
      ...(reference ? { referenceImageUrl: 'http://localhost/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'] } : {}) })));
    expect(response.status).toBe(200); const result = await response.json();
    expect(result.images).toHaveLength(n === 3 ? 2 : n);
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1); expect(state.publications).toHaveLength(1);
    expect(state.transactions.filter(row => row.type === 'consume').map(row => Number(row.amount))).toEqual([-7 * n]);
    expect(state.credits.map(row => Number(row.balance))).toEqual([100 - 7 * n, 100]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(result.images.length);
    expect(result.assetProjection.references).toHaveLength(result.images.length);
    expect(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'))).toEqual(original);
    expect((await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-shared'")).rows).toEqual(source);
    // Fix1 W02: immutable source version, but revision is allowed to advance the asset pointer.
    expect((await query("SELECT * FROM wujie_asset_versions WHERE id='version-shared'")).rows).toEqual(sourceVersion);
    const references = result.assetProjection.references as Array<{ assetId: string; assetVersionId: string; placementId: string; entityId: string }>;
    expect(new Set(references.map(ref => ref.assetVersionId)).size).toBe(result.images.length);
    expect(new Set(references.map(ref => ref.placementId)).size).toBe(result.images.length);
    for (const ref of references) {
      expect(ref.assetVersionId).not.toBe('version-shared'); expect(ref.placementId).not.toBe('placement-shared'); expect(ref.entityId).not.toBe('image-shared');
      if (mode === 'revision') expect(ref.assetId).toBe('asset-shared'); else expect(ref.assetId).not.toBe('asset-shared');
      expect((await query('SELECT * FROM wujie_asset_versions WHERE id=$1', [ref.assetVersionId])).rows[0]).toMatchObject({
        asset_id: ref.assetId, owner_id: 'owner', project_id: 'shared', task_id: result.taskId, availability: 'ready', provider_id: 'provider', model_id: 'gpt-image-1',
      });
      expect((await query('SELECT parent_version_id FROM wujie_asset_version_parents WHERE version_id=$1 ORDER BY parent_order', [ref.assetVersionId])).rows.map(row => row.parent_version_id)).toEqual(reference ? ['version-shared'] : []);
      expect((await query('SELECT * FROM wujie_workspace_placements WHERE id=$1', [ref.placementId])).rows[0]).toMatchObject({
        asset_id: ref.assetId, asset_version_id: ref.assetVersionId, entity_id: ref.entityId, owner_id: 'owner', project_id: 'shared', workspace_kind: 'canvas', workspace_id: 'shared',
      });
      expect((await query('SELECT current_version_id FROM wujie_assets WHERE id=$1', [ref.assetId])).rows[0].current_version_id).toBe(ref.assetVersionId);
    }
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0].current_version_id).toBe(mode === 'revision' ? references[0].assetVersionId : 'version-shared');
    expect(provider.submits()).toBe(1);
    const history = await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
    expect(history.status).toBe(200); expect((await history.json()).tasks[0].result.assetProjection.references).toHaveLength(result.images.length);
  });
}, 60_000);

it.each([0, 101])('A: configured unit price %i preserves atomic free/insufficient behavior', async cost => {
  await withIsolatedPostgres('task8cb3h_price', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': cost } })]);
    const provider = directProvider(); const response = await POST(request());
    expect(response.status).toBe(cost ? 402 : 200);
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(cost ? 0 : 1);
    expect(state.publications).toHaveLength(cost ? 0 : 1); expect(state.transactions).toHaveLength(0);
    expect(provider.submits()).toBe(cost ? 0 : 1);
  });
}, 60_000);

it('A: submitOnly and 20 concurrent same-key requests share one task, one charge and one dispatch', async () => {
  await withIsolatedPostgres('task8cb3h_20', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const provider = directProvider();
    const responses = await Promise.all(Array.from({ length: 20 }, () => POST(request(universalBody({ submitOnly: true })))));
    expect(responses.map(response => response.status)).toEqual(Array(20).fill(200));
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(new Set(bodies.map(body => body.taskId)).size).toBe(1); expect(bodies[0]).toMatchObject({ mode: 'polling', idempotencyKey: 'universal-once' });
    await drain(); expect(provider.submits()).toBe(1);
    const state = await canvasBilling(query); expect(state.tasks).toHaveLength(1); expect(state.publications).toHaveLength(1); expect(state.transactions).toHaveLength(1);
  });
}, 60_000);

it.each(['prompt', 'model', 'providerId', 'n', 'referenceImageUrl', 'assetParentVersionIds', 'assetProjectionMode', 'assetSelectedEntityIds', 'projectId', 'extra',
  'quality', 'aspectRatio', 'background', 'assetScope', 'apiKey', 'baseUrl', 'submitOnly'])('B: complete-body identity rejects changed %s before effects', async field => {
  await withIsolatedPostgres('task8cb3h_identity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); await POST(request(universalBody({ submitOnly: true })));
    const before = await universalSnapshot(query);
    const values: Record<string, unknown> = { prompt: 'changed', model: 'other', providerId: 'other', n: 2,
      referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared'], assetProjectionMode: 'revision', assetSelectedEntityIds: ['image-shared'], projectId: 'second-project', extra: { key: 'value' },
      quality: 'high', aspectRatio: '16:9', background: 'transparent', assetScope: 'chat', apiKey: 'changed-secret', baseUrl: 'https://wrong.invalid', submitOnly: false };
    if (field === 'projectId') {
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('second-project','editor','Other')");
      await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('second-project','editor',true)");
      await query("INSERT INTO wujie_project_canvas_documents(project_id,owner_id) VALUES ('second-project','editor')");
    }
    const expected = field === 'projectId' ? await universalSnapshot(query) : before;
    const response = await POST(request(universalBody({ submitOnly: true, [field]: values[field] })));
    expect(response.status).toBe(409); expect(await universalSnapshot(query)).toEqual(expected); expect(boundary.denied).toBe(0);
  });
}, 60_000);

it.each([
  { label: 'missing provider', body: { providerId: 'absent' } }, { label: 'foreign model', body: { model: 'other' } },
  { label: 'conflicting composite', body: { model: 'absent::gpt-image-1' } },
  ...[0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, null, '2'].map(n => ({ label: `n=${n}`, body: { n } })),
  ...['', null, 'https://foreign.invalid/x', '//localhost/x', 'data:image/png;base64,eA==', 'blob:x', 'http://[', '/api\\serve-upload/shared.png', '/api/serve-upload/shared.png#x'].map(referenceImageUrl => ({ label: `reference=${referenceImageUrl}`, body: { referenceImageUrl, assetParentVersionIds: ['version-shared'] } })),
  { label: 'reference without parents', body: { referenceImageUrl: '/api/serve-upload/shared.png' } },
  { label: 'parents without reference', body: { assetParentVersionIds: ['version-shared'] } },
  { label: 'duplicate parents', body: { referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared', 'version-shared'] } },
  { label: 'multiple parents', body: { referenceImageUrl: '/api/serve-upload/shared.png', assetParentVersionIds: ['version-shared', 'version-second'] } },
  { label: 'skip credits', body: { _skipCredits: true } }, { label: 'unknown scope', body: { assetScope: 'private' } },
])('B: rejects $label with no task/media/provider effects', async ({ body }) => {
  await withIsolatedPostgres('task8cb3h_invalid', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const before = await canvasBilling(query);
    const response = await POST(request(universalBody(body))); expect(response.status).toBe(400);
    expect(await canvasBilling(query)).toEqual(before); expect(boundary.denied).toBe(0); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it.each(['disabled', 'unauthorized'])('B: %s model selection fails before dispatch or charge', async scenario => {
  await withIsolatedPostgres('task8cb3h_model', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    if (scenario === 'disabled') boundary.provider.isEnabled = false;
    else boundary.unauthorized = true;
    expect((await POST(request())).status).toBe(400); expect((await canvasBilling(query)).tasks).toHaveLength(0); expect(boundary.denied).toBe(0);
  });
}, 60_000);

it('A: caller without key receives a server key and active lease returns same polling identity', async () => {
  await withIsolatedPostgres('task8cb3h_no_key', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const body = universalBody({ submitOnly: true });
    const response = await POST(new NextRequest('http://localhost/api/universal-generate', { method: 'POST', body: JSON.stringify(body) }));
    const result = await response.json(); expect(result.idempotencyKey).toEqual(expect.any(String)); expect(result.idempotencyKey.length).toBeGreaterThan(10);
    boundary.callbacks = []; await claimCloudTaskLease(result.taskId, 'active-worker', 660000);
    const retry = await POST(request(body, result.idempotencyKey)); expect((await retry.json()).taskId).toBe(result.taskId); await drain();
    expect(boundary.denied).toBe(0); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('C: real checkpoint write failure stops IO and leaves uncertain task without refund or resubmission', async () => {
  await withIsolatedPostgres('task8cb3h_checkpoint_failure', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    await query(`CREATE FUNCTION fail_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result ? 'universalCheckpoint' THEN RAISE EXCEPTION 'checkpoint storage failed'; END IF; RETURN NEW; END $$`);
    await query('CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION fail_checkpoint()');
    const provider = directProvider(); const response = await POST(request()); const result = await response.json(); expect(result.code).toBe('UNIVERSAL_SUBMISSION_UNCERTAIN');
    await query('DROP TRIGGER fail_checkpoint ON cloud_tasks'); await POLL(pollRequest(result.taskId)); await drain();
    expect(provider.submits()).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('B: same key cannot move an admitted canvas task to the unscoped private transport', async () => {
  await withIsolatedPostgres('task8cb3h_scope_downgrade', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); await POST(request(universalBody({ submitOnly: true })));
    const before = await universalSnapshot(query);
    expect((await POST(request(universalBody({ submitOnly: true, projectId: undefined })))).status).toBe(409);
    expect(await universalSnapshot(query)).toEqual(before); expect(boundary.denied).toBe(0);
  });
}, 60_000);

it('C: actual poll resumes a submitted-only task from DB and authorizes actual actor/type', async () => {
  await withIsolatedPostgres('task8cb3h_poll', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const { taskId } = await (await POST(request(universalBody({ submitOnly: true })))).json(); boundary.callbacks = [];
    const provider = directProvider();
    const responses = await Promise.all([POLL(pollRequest(taskId)), POLL(pollRequest(taskId, { providerId: 'forged', remoteTaskId: 'forged' }))]);
    expect(responses.map(response => response.status)).toEqual([200, 200]); await drain();
    expect(provider.submits()).toBe(1);
    expect((await (await POLL(pollRequest(taskId))).json()).images).toHaveLength(1);
    boundary.actor = 'owner'; expect((await POLL(pollRequest(taskId))).status).toBe(404);
    boundary.actor = 'editor'; await query("UPDATE cloud_tasks SET type='edit' WHERE id=$1", [taskId]);
    expect((await POLL(pollRequest(taskId))).status).toBe(404);
  });
}, 60_000);

it.each(['unscoped', 'personal', 'chat', 'workflow'])('A: private %s preserves images and has no canvas task/publication', async scope => {
  await withIsolatedPostgres('task8cb3h_private', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','editor','Personal')");
    const provider = directProvider(2);
    const body = universalBody({ n: 2, projectId: scope === 'unscoped' ? undefined : scope === 'personal' ? 'personal' : 'shared',
      ...(['chat', 'workflow'].includes(scope) ? { assetScope: scope } : {}) });
    const response = await POST(request(body)); expect(response.status).toBe(200); const result = await response.json();
    expect(result.images).toHaveLength(2); expect(result.images[0]).toMatchObject({ url: pngUrl(), prompt: '蓝色杯子', originalPrompt: '蓝色杯子', model: 'gpt-image-1' });
    expect(provider.submits()).toBe(1); const state = await canvasBilling(query); expect(state.tasks).toHaveLength(0); expect(state.publications).toHaveLength(0); expect(state.transactions).toHaveLength(0);
  });
}, 60_000);

it.each(['alpha', 'opaque', 'invalid', 'unsupported', 'async', 'rejected'])('A: private original %s protocol and transparency behavior', async scenario => {
  await withIsolatedPostgres('task8cb3h_private_protocol', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); let submits = 0; let polls = 0;
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 40, b: 60, alpha: scenario === 'alpha' ? 0 : 1 } } }).png().toBuffer();
    const url = scenario === 'invalid' ? 'data:image/png;base64,eA==' : `data:image/png;base64,${png.toString('base64')}`;
    vi.stubGlobal('fetch', async (target: string, init: RequestInit): Promise<Response> => {
      expect(target).toMatch(/^https:\/\/provider.invalid\//);
      if (init.method === 'POST') {
        submits++; if (scenario === 'rejected') return Response.json({ error: { message: 'Invalid quality parameter' } }, { status: 400 });
        expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-image-1', background: 'transparent', output_format: 'png' });
        if (scenario === 'async') return Response.json({ task_id: 'private-remote' });
        return Response.json({ data: [{ url }] });
      }
      polls++; expect(target).toBe('https://provider.invalid/tasks/private-remote?language=zh');
      return Response.json({ status: 'completed', result: { images: [{ url: [url] }, { url }] } });
    });
    const response = await POST(request(universalBody({ projectId: undefined, backgroundMode: 'transparent', outputFormat: 'png', model: scenario === 'unsupported' ? 'dall-e-3' : 'gpt-image-1' })));
    const result = await response.json();
    if (scenario === 'unsupported') { expect(response.status).toBe(400); expect(result.code).toBe('TRANSPARENT_BACKGROUND_UNSUPPORTED'); expect(submits).toBe(0); }
    else if (scenario === 'rejected') { expect(response.status).toBe(400); expect(result.error).toBe('Invalid quality parameter'); expect(submits).toBe(2); }
    else {
      expect(response.status).toBe(200); expect(result.images).toHaveLength(scenario === 'async' ? 2 : 1); expect(result.images[0].url).toBe(url);
      expect(result.alphaVerification.status).toBe(scenario === 'alpha' ? 'verified' : scenario === 'invalid' ? 'invalid' : 'opaque');
      if (scenario !== 'alpha') expect(result.nextAction).toEqual({ type: 'remove-background', requiresConfirmation: true, separatelyBilled: true });
      expect(submits).toBe(1); expect(polls).toBe(scenario === 'async' ? 1 : 0);
    }
    expect((await canvasBilling(query)).transactions).toHaveLength(0);
  });
}, 60_000);

it.each(['alpha', 'opaque', 'invalid'])('A: collaborative %s keeps real alpha metadata and never auto-removes background', async scenario => {
  await withIsolatedPostgres('task8cb3h_alpha', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); let submits = 0;
    const buffer = scenario === 'invalid' ? Buffer.from('invalid image') : await sharp({ create: { width: 2, height: 2, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: scenario === 'alpha' ? 0 : 1 } } }).png().toBuffer();
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit): Promise<Response> => { submits++; expect(JSON.parse(String(init.body))).toMatchObject({ background: 'transparent', output_format: 'png' }); return Response.json({ data: [{ b64_json: buffer.toString('base64') }] }); });
    const response = await POST(request(universalBody({ background: 'transparent' }))); const result = await response.json();
    expect(result.status).toBe('completed'); expect(result.images).toHaveLength(1);
    expect(result.alphaVerification.status).toBe(scenario === 'alpha' ? 'verified' : scenario);
    if (scenario !== 'alpha') expect(result.nextAction).toEqual({ type: 'remove-background', requiresConfirmation: true, separatelyBilled: true });
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('B: forged actor, internal headers and client checkpoint cannot bypass revoked unsent intent', async () => {
  await withIsolatedPostgres('task8cb3h_forged', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName);
    const body = universalBody({ submitOnly: true, userId: 'owner', apiKey: 'secret-client-key', baseUrl: 'https://forged.invalid',
      remoteTaskId: 'forged', submissionPhase: 'started', universalCheckpoint: { kind: 'direct', urls: [pngUrl()] }, universalGeneration: { providerId: 'forged' } });
    const { taskId } = await (await POST(request(body, 'forged', { 'x-internal-request': 'true', 'x-internal-user-id': 'owner' }))).json();
    const stored = await getCloudTaskForUser(taskId, 'editor'); expect(stored?.userId).toBe('editor');
    expect(JSON.stringify(stored?.result)).not.toContain('secret-client-key'); expect(stored?.result?.universalCheckpoint).toBeUndefined();
    await revokeDocumentEditor('owner', 'shared', 'editor'); await drain();
    expect(boundary.denied).toBe(0); expect((await getCloudTaskForUser(taskId, 'editor'))?.status).toBe('failed');
    const response = await POLL(pollRequest(taskId)); const text = await response.text();
    expect(text).not.toContain('universalGeneration'); expect(text).not.toContain('grantGeneration'); expect(text).not.toContain('test-only');
  });
}, 60_000);

it.each(['started', 'corrupt-descriptor', 'missing-intent', 'legacy-terminal'])('B/C: stored %s never authorizes client recovery payload', async scenario => {
  await withIsolatedPostgres('task8cb3h_stored', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const body = universalBody({ submitOnly: true });
    const { taskId } = await (await POST(request(body))).json(); boundary.callbacks = [];
    if (scenario === 'started' || scenario === 'corrupt-descriptor') await query("UPDATE cloud_tasks SET result=result || '{\"submissionPhase\":\"started\"}'::jsonb");
    if (scenario === 'corrupt-descriptor') await query("UPDATE cloud_tasks SET result=result - 'universalGeneration'");
    if (scenario === 'missing-intent' || scenario === 'legacy-terminal') await query('DELETE FROM wujie_canvas_task_publications');
    if (scenario === 'legacy-terminal') await terminateCloudTaskAndRefund(taskId, 'failed', 'Legacy terminal');
    const before = await universalSnapshot(query);
    if (scenario === 'legacy-terminal') { expect((await (await POST(request(body))).json()).status).toBe('failed'); expect(await universalSnapshot(query)).toEqual(before); }
    else if (scenario === 'missing-intent') { expect((await POST(request(body))).status).toBe(409); expect(await universalSnapshot(query)).toEqual(before); }
    else {
      await POLL(pollRequest(taskId, { universalGeneration: { version: 1 }, remoteTaskId: 'fake' })); await drain();
      const state = await canvasBilling(query); expect(state.tasks[0].status).toBe('processing'); expect(state.transactions).toHaveLength(1);
    }
    expect(boundary.denied).toBe(0);
  });
}, 60_000);

it.each(['network', 'non-json', '5xx'])('C: %s after submission stays uncertain without retry/refund', async kind => {
  await withIsolatedPostgres('task8cb3h_unknown', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); let submits = 0;
    vi.stubGlobal('fetch', async (): Promise<Response> => { submits++; if (kind === 'network') throw new Error('Lost reply');
      return kind === 'non-json' ? new Response('<html>') : Response.json({ error: 'unknown' }, { status: 502 }); });
    const response = await POST(request()); const body = await response.json();
    expect(body.code).toBe('UNIVERSAL_SUBMISSION_UNCERTAIN'); expect(body.taskId).toMatch(/^universal_/);
    await POST(request()); await POLL(pollRequest(body.taskId)); await drain();
    expect(submits).toBe(1); const state = await canvasBilling(query);
    expect(state.tasks[0].status).toBe('processing'); expect(state.transactions).toHaveLength(1);
  });
}, 60_000);

it('D: actual cancel wins against late successful provider and refunds once', async () => {
  await withIsolatedPostgres('task8cb3h_cancel', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasUniversal(query, databaseUrl, schemaName); const hold = universalGate();
    vi.stubGlobal('fetch', async (): Promise<Response> => { hold.enter(); await hold.released; return Response.json({ data: [{ url: pngUrl() }] }); });
    const { taskId } = await (await POST(request(universalBody({ submitOnly: true })))).json();
    const running = drain(); await hold.reached;
    try { const response = await CANCEL(new NextRequest('http://localhost/api/cancel-task', { method: 'POST', body: JSON.stringify({ taskId }) })); expect(response.status).toBe(200); }
    finally { hold.release(); await running; }
    const state = await canvasBilling(query); expect(state.tasks[0].status).toBe('cancelled');
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

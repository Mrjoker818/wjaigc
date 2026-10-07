import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ApiProvider } from '@/lib/server-api-config';

await vi.hoisted(async () => {
  const { requireOfflineBridgeTestDatabaseUrl } = await import('../helpers/offline-bridge-database-guard');
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const fs = await import('node:fs'); const path = await import('node:path');
  process.env.WUJIE_DATA_DIR = fs.mkdtempSync(path.join(process.env.WUJIE_DATA_DIR!, 'ordinary-route-'));
  process.env.WUJIE_YJS_ENABLED = 'true';
  process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'false';
});
const boundary = vi.hoisted(() => ({ actor: 'editor', source: 'session', callbacks: [] as Array<() => Promise<void>>,
  baseUrl: 'https://provider.invalid', apiKey: 'test-only', profile: 'openai', models: ['gpt-image-1'], maxReferences: 1,
  fallback: null as ApiProvider | null, vision: null as null | { id: string; name: string; modelType: string; type: string; isEnabled: boolean;
    baseUrl: string; apiKey: string; selectedModels: string[]; discoveredModels: never[] },
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { boundary.callbacks.push(callback); } }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<unknown> => ({ userId: boundary.actor, userRole: 'user', source: boundary.source,
    user: { id: boundary.actor, name: boundary.actor, role: 'user', status: 'active', imageModels: ['provider::gpt-image-1', 'provider::dall-e-2', 'provider::gemini-2.5-flash-image', 'fallback::gpt-image-1-mini'] } }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({ 'x-test-auth': boundary.actor }),
  getRequestUser: async (): Promise<unknown> => ({ user: { id: boundary.actor, role: 'user', status: 'active' }, userId: boundary.actor, userRole: 'user', source: 'session' }),
  getTrustedRequestAgentExecutionFence: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<unknown> => ({ id: boundary.actor }) }));
vi.mock('@/lib/server-api-config', () => {
  const provider = { id: 'provider', name: 'Fixture', modelType: 'image', type: 'image', isEnabled: true, createdAt: 1, updatedAt: 1,
    get baseUrl(): string { return boundary.baseUrl; }, get apiKey(): string { return boundary.apiKey; },
    get selectedModels(): string[] { return boundary.models; },
    get discoveredModels(): unknown[] { return [{ id: 'gpt-image-1', name: 'Image', providerId: 'provider', type: 'image', maxReferenceImages: boundary.maxReferences }]; },
    get compatProfile(): string { return boundary.profile; } };
  return { findProviderById: async (id: string): Promise<unknown> => id === 'vision' ? boundary.vision : id === 'fallback' ? boundary.fallback : provider,
    findProviderForModel: async (): Promise<unknown> => provider, findProviderForFeature: async (): Promise<unknown> => boundary.vision,
    findAllProvidersForType: async (): Promise<unknown[]> => [{ provider, models: ['gpt-image-1'] }, ...(boundary.fallback ? [{ provider: boundary.fallback, models: boundary.fallback.selectedModels }] : [])],
    getApiProviders: async (): Promise<unknown[]> => [provider, ...(boundary.fallback ? [boundary.fallback] : []), ...(boundary.vision ? [boundary.vision] : [])],
    normalizeApiBaseUrl: (value: string): string => value };
});
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { canvasBilling, loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { seedOrdinaryGeneration, loseOrdinaryCompletionReply } from '../helpers/canvas-ordinary-generation-fixture';
import { POST } from '@/app/api/generate/route';
import { POST as POLL } from '@/app/api/poll-task/route';
import { POST as CANCEL } from '@/app/api/cancel-task/route';
import { createImageGenerationSession } from '@/lib/image-generation-session';
import { GET } from '@/app/api/tasks/recover/route';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { extractTaskAssetReferences } from '@/lib/asset-core/workspace-transfer';
import sharp from 'sharp';
import * as safeImages from '@/lib/safe-image-input';
import * as mediaSources from '@/lib/collaboration/document-media-source';
import { publishDocumentTaskOutput } from '@/lib/collaboration/document-media-import';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';
import { getTaskInfo } from '@/lib/task-registry';
import { validateCanvasOrdinaryReplay, validateCanvasOrdinarySources } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import type { OrdinaryGenerationDescriptor } from '@/lib/task-core/ordinary-generation-task';
import { lockEditAdmission, editDatabaseSnapshot } from '../helpers/canvas-edit-fixture';

function ordinaryRequest(body: Record<string, unknown> = {}, key = 'ordinary-first'): NextRequest {
  return new NextRequest('http://localhost/api/generate', { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ projectId: 'shared', providerId: 'provider', model: 'gpt-image-1', prompt: '蓝色杯子', outputCount: 1, ...body }) });
}
function ownedTaskRequest(path: string, taskId: string): NextRequest {
  return new NextRequest(`http://localhost/api/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId }) });
}

beforeEach((): void => { vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared IO'); }); });
afterEach((): void => { boundary.actor = 'editor'; boundary.source = 'session'; boundary.callbacks = []; boundary.baseUrl = 'https://provider.invalid'; boundary.vision = null;
  boundary.apiKey = 'test-only'; boundary.profile = 'openai'; boundary.models = ['gpt-image-1']; boundary.maxReferences = 1; boundary.fallback = null;
  process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'false'; vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['revoke', 'regrant', 'source-url', 'source-checksum', 'parent-lineage', 'selection', 'rollback'])('real POST admission rejects %s interleaving before media or task/consume/publication writes', async mode => {
  await withIsolatedPostgres('ordinary-post-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    const lock = await lockEditAdmission('ordinary-race'); const media = vi.spyOn(safeImages, 'loadSafeImageInput');
    const pending = POST(ordinaryRequest({ submitOnly: true, referenceImages: ['/api/serve-upload/shared.png'],
      assetParentVersionIds: ['version-shared'], assetSelectedEntityIds: ['image-shared'] }, 'ordinary-race'));
    let before: Record<string, unknown>;
    try {
      await lock.wait(query);
      if (mode === 'revoke' || mode === 'regrant') await revokeDocumentEditor('owner', 'shared', 'editor');
      if (mode === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
      if (mode === 'source-url') await query("UPDATE wujie_asset_versions SET file_url='/api/serve-upload/second.png' WHERE id='version-shared'");
      if (mode === 'source-checksum') await query("UPDATE wujie_asset_versions SET checksum='changed-source' WHERE id='version-shared'");
      if (mode === 'parent-lineage') await query(`INSERT INTO wujie_asset_version_parents(version_id,parent_version_id,owner_id,project_id,parent_order,asset_id)
        VALUES ('version-shared','version-second','owner','shared',0,'asset-shared')`);
      if (mode === 'selection') await query("UPDATE wujie_workspace_placements SET entity_id='changed' WHERE id='placement-shared'");
      if (mode === 'rollback') {
        await query("CREATE FUNCTION reject_ordinary_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ordinary admission rollback'; END $$");
        await query('CREATE TRIGGER reject_ordinary_intent BEFORE INSERT ON wujie_canvas_task_publications FOR EACH ROW EXECUTE FUNCTION reject_ordinary_intent()');
      }
      before = await editDatabaseSnapshot(query);
    } finally { await lock.release(); }
    expect((await pending).status).toBeGreaterThanOrEqual(400);
    expect(await editDatabaseSnapshot(query)).toEqual(before!); expect(media).not.toHaveBeenCalled();
    expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it.each(['owner', 'editor'])('concurrent real %s POSTs recover one root and never persist nested request credentials', async actor => {
  await withIsolatedPostgres('ordinary-post-concurrent', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); boundary.actor = actor;
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    const body = { submitOnly: true, apiKey: 'request-top-secret', custom: { apiKey: 'request-nested-secret', entries: [{ authorization: 'request-array-secret' }] } };
    const responses = await Promise.all([POST(ordinaryRequest(body)), POST(ordinaryRequest(body))]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(response => response.json())); expect(results[0].taskId).toBe(results[1].taskId);
    const billing = await canvasBilling(query); expect([billing.tasks.length, billing.transactions.length, billing.publications.length]).toEqual([1, 1, 1]);
    expect(billing.credits.find(row => row.user_id === actor)?.balance).toBe(93);
    expect(billing.credits.find(row => row.user_id !== actor)?.balance).toBe(100);
    for (const secret of ['request-top-secret', 'request-nested-secret', 'request-array-secret', 'test-only'])
      expect(JSON.stringify(billing.tasks[0].result)).not.toContain(secret);
  });
}, 60_000);

it.each(['multiple', 'partial', 'json', 'error'])('real POST/POLL preserves Responses %s output identity and never resubmits accepted or unknown work', async mode => {
  await withIsolatedPostgres('ordinary-responses-output', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    boundary.baseUrl = mode === 'json' ? 'https://fhl.mom' : 'https://api.openai.com'; vi.stubEnv('RESPONSES_API_ENABLED', 'true'); let submits = 0;
    const first = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const second = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#0000ff' } }).png().toBuffer();
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== `${boundary.baseUrl}/v1/responses` || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; const billing = await canvasBilling(query);
      expect([billing.tasks.length, billing.transactions.length, billing.publications.length]).toEqual([1, 1, 1]);
      const outputs = [{ type: 'image_generation_call', id: 'red-a', result: first.toString('base64') },
        { type: 'image_generation_call', id: 'blue-b', result: second.toString('base64') },
        { type: 'image_generation_call', id: 'red-c', result: first.toString('base64') }];
      if (mode === 'json') {
        expect(JSON.parse(String(options.body)).stream).toBe(false);
        return Response.json({ id: 'response-json', status: 'completed', output: outputs });
      }
      const events = mode === 'error' ? [{ type: 'response.failed', response: { error: { code: 'UPSTREAM_STREAM_FAILED', message: 'stream failed test-only' } } }]
        : mode === 'partial' ? [{ type: 'response.image_generation_call.partial_image', partial_image_b64: first.toString('base64') }]
        : [{ type: 'response.output_item.done', output_index: 1, item: outputs[1] },
          { type: 'response.output_item.done', output_index: 0, item: outputs[0] },
          { type: 'response.completed', response: { output: outputs } }];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    });
    const post = await (await POST(ordinaryRequest())).json();
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(submits).toBe(1); const billing = await canvasBilling(query);
    expect(billing.transactions.map(row => row.amount)).toEqual([-7]);
    if (mode === 'json') expect((billing.tasks[0].result as { ordinaryCheckpoint: { attempts: Array<{ remotes: unknown[] }> } })
      .ordinaryCheckpoint.attempts[0].remotes).toEqual([]);
    if (mode === 'partial' || mode === 'error') {
      expect(post.code).toBe('ORDINARY_SUBMISSION_UNCERTAIN'); expect(poll.code).toBe('ORDINARY_SUBMISSION_UNCERTAIN');
      expect(poll.requiresReconciliation).toBe(true); expect(poll.retryable).toBe(false);
      expect((await query('SELECT count(*)::int AS n FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows[0].n).toBe(0);
      if (mode === 'error') {
        expect(poll.routeAudit.attempts[0].diagnostic).toEqual({ status: 200, code: 'UPSTREAM_STREAM_FAILED', message: 'stream failed [redacted]' });
        expect(JSON.stringify(poll)).not.toContain('test-only');
      }
    } else {
      expect(post.status).toBe('completed'); expect(poll.imageUrls).toHaveLength(3);
      const refs = extractTaskAssetReferences(poll); expect(refs).toHaveLength(3);
      expect(new Set(refs.map(ref => ref.assetVersionId)).size).toBe(3);
      const actual = [];
      for (const ref of refs) {
        const row = (await query('SELECT file_url FROM wujie_asset_versions WHERE id=$1', [ref.assetVersionId])).rows[0];
        const image = await safeImages.loadSafeImageInput(row.file_url);
        actual.push([...await sharp(image.buffer).removeAlpha().raw().toBuffer()].slice(0, 3));
      }
      expect(actual).toEqual([[255, 0, 0], [0, 0, 255], [255, 0, 0]]);
      expect((await query('SELECT result FROM cloud_tasks WHERE id=$1', [post.taskId])).rows[0].result.imageUrls).toEqual(poll.imageUrls);
    }
  });
}, 60_000);

it.each(['repeat', 'distinct', 'snapshot-before', 'snapshot-after'])('fix1 I3 real POST publishes completed event identity once: %s', async mode => {
  await withIsolatedPostgres('ordinary-event-identity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    boundary.baseUrl = 'https://api.openai.com'; vi.stubEnv('RESPONSES_API_ENABLED', 'true'); let submits = 0;
    const redBytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const blueBytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#0000ff' } }).png().toBuffer();
    const red = { type: 'image_generation.completed', item_id: 'red-a', output_index: 0, b64_json: redBytes.toString('base64') };
    const snapshot = { type: 'response.completed', response: { output: [
      { type: 'image_generation_call', id: 'blue', result: blueBytes.toString('base64') },
      { type: 'image_generation_call', id: 'red-a', result: redBytes.toString('base64') },
    ] } };
    const events = mode === 'repeat' ? [red, red] : mode === 'distinct' ? [red, { ...red, item_id: 'red-b', output_index: 1 }]
      : mode === 'snapshot-before' ? [snapshot, red, red] : [red, red, snapshot];
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://api.openai.com/v1/responses' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    });
    const post = await (await POST(ordinaryRequest())).json();
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(post.status).toBe('completed'); expect(poll.status).toBe('completed');
    const refs = extractTaskAssetReferences(poll); const count = mode === 'repeat' ? 1 : 2;
    expect(refs).toHaveLength(count); expect(new Set(refs.map(ref => ref.assetVersionId)).size).toBe(count);
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows).toHaveLength(count);
    const colors = [];
    for (const ref of refs) {
      const row = (await query('SELECT file_url FROM wujie_asset_versions WHERE id=$1', [ref.assetVersionId])).rows[0];
      const image = await safeImages.loadSafeImageInput(row.file_url);
      colors.push([...await sharp(image.buffer).removeAlpha().raw().toBuffer()].slice(0, 3));
    }
    expect(colors).toEqual(mode === 'repeat' ? [[255, 0, 0]] : mode === 'distinct' ? [[255, 0, 0], [255, 0, 0]] : [[0, 0, 255], [255, 0, 0]]);
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it('autocommitted completion with lost wire ACK is recovered as completed without refund or resubmission', async () => {
  await withIsolatedPostgres('ordinary-completion-ack', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); let submits = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const proxy = await loseOrdinaryCompletionReply(databaseUrl); let response: Response;
    try { response = await POST(ordinaryRequest()); expect(proxy.dropped()).toBe(true); } finally { await proxy.close(); }
    const post = await response.json(); expect(post.status).toBe('completed');
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(poll.status).toBe('completed'); expect(extractTaskAssetReferences(poll)).toHaveLength(1);
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.type)).toEqual(['consume']);
  });
}, 60_000);

it.each(['zero', 'active-lease', 'started', 'other-actor'])('owned ordinary route preserves the %s boundary in real PG', async mode => {
  await withIsolatedPostgres('ordinary-owned-boundary', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    if (mode === 'zero') await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 0 } })]);
    const post = await (await POST(ordinaryRequest({ submitOnly: true }))).json(); let submits = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    if (mode === 'other-actor') {
      boundary.actor = 'owner'; expect((await POLL(ownedTaskRequest('poll-task', post.taskId))).status).toBe(404);
      expect(submits).toBe(0); return;
    }
    if (mode === 'active-lease') {
      await query("UPDATE cloud_tasks SET lease_owner='other-worker',lease_expires_at=$1", [Date.now() + 60000]);
      await POLL(ownedTaskRequest('poll-task', post.taskId)); expect(submits).toBe(0);
      await query('UPDATE cloud_tasks SET lease_expires_at=$1', [Date.now() - 1000]);
    }
    if (mode === 'started') await query("UPDATE cloud_tasks SET result=result || $1::jsonb", [JSON.stringify({ ordinaryCheckpoint: {
      attempts: [{ slotIndex: 0, attemptIndex: 0, targetIndex: 0, route: 'https://provider.invalid/images/generations', status: 'started' }],
      finishedSlots: [], persistedOutputs: {}, enhancedPrompt: 'cup',
    } })]);
    const store = (globalThis as Record<string, unknown>).__wujie_task_store__ as { registry: Map<string, unknown>; pendingDurableTaskMarkers: Map<string, unknown> };
    store.registry.delete(post.taskId); store.pendingDurableTaskMarkers.delete(post.taskId); boundary.callbacks = [];
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    if (mode === 'started') {
      expect(poll.code).toBe('ORDINARY_SUBMISSION_UNCERTAIN'); expect(submits).toBe(0);
      await CANCEL(ownedTaskRequest('cancel-task', post.taskId));
      expect((await canvasBilling(query)).transactions.map(row => row.type).sort()).toEqual(['consume', 'refund']);
    } else {
      expect(poll.status).toBe('completed'); expect(submits).toBe(1);
      const billing = await canvasBilling(query); expect(billing.tasks).toHaveLength(1); expect(billing.publications).toHaveLength(1);
      expect(billing.transactions).toHaveLength(mode === 'zero' ? 0 : 1);
    }
  });
}, 60_000);

it.each([
  ['gemini', true], ['gemini', false], ['fallback', true], ['fallback', false],
] as const)('fix1 I1 real %s chat with id=%s completes without a fake remote', async (protocol, hasId) => {
  await withIsolatedPostgres('ordinary-chat-identity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const model = protocol === 'gemini' ? 'gemini-2.5-flash-image' : 'gpt-image-1';
    boundary.models = [model]; boundary.baseUrl = 'https://provider.invalid/v1';
    if (protocol === 'gemini') boundary.profile = 'gemini-image';
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png')).toString('base64');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(resource); calls.push(url);
      if (options?.method !== 'POST') throw new Error(`Undeclared IO ${url}`);
      const billing = await canvasBilling(query);
      expect([billing.tasks.length, billing.transactions.length, billing.publications.length]).toEqual([1, 1, 1]);
      if (protocol === 'fallback' && url === 'https://provider.invalid/v1/images/generations')
        return Response.json({ error: { code: 'no_available_channel', message: 'no available channel' } }, { status: 503 });
      if (url !== 'https://provider.invalid/v1/chat/completions') throw new Error(`Undeclared IO ${url}`);
      return Response.json({ ...(hasId ? { id: 'chatcmpl-complete' } : {}), object: 'chat.completion', choices: [{
        index: 0, finish_reason: 'stop', message: { role: 'assistant', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
        ] },
      }] });
    });
    const post = await (await POST(ordinaryRequest({ model }))).json();
    const checkpoint = (await query('SELECT result FROM cloud_tasks WHERE id=$1', [post.taskId])).rows[0].result.ordinaryCheckpoint;
    expect(checkpoint.attempts.at(-1).remotes).toEqual([]);
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
    expect(post.status).toBe('completed'); expect(poll.status).toBe('completed');
    for (const value of [post, poll, recovered.tasks.find((task: { id: string }) => task.id === post.taskId).result])
      expect(extractTaskAssetReferences(value)).toHaveLength(2);
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows).toHaveLength(2);
    expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([protocol === 'gemini' ? -40 : -7]);
    expect(calls).toEqual(protocol === 'gemini' ? ['https://provider.invalid/v1/chat/completions']
      : ['https://provider.invalid/v1/images/generations', 'https://provider.invalid/v1/chat/completions']);
  });
}, 60_000);

it.each(['gemini', 'json-edits', 'multipart', 'mixed'])('real POST checkpoints the complete offline %s protocol before all provider IO', async protocol => {
  await withIsolatedPostgres('ordinary-protocols', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const editing = ['json-edits', 'multipart'].includes(protocol);
    const model = protocol === 'gemini' ? 'gemini-2.5-flash-image' : editing ? 'dall-e-2' : 'gpt-image-1';
    boundary.models = [model]; boundary.baseUrl = 'https://provider.invalid/v1';
    if (protocol === 'gemini') boundary.profile = 'gemini-image';
    const calls: string[] = [];
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png')).toString('base64');
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(resource); calls.push(url);
      if (url === 'https://provider.invalid/v1/tasks/mixed-remote?language=zh' && !options?.method)
        return Response.json({ status: 'completed', result: { images: [{ url: `data:image/png;base64,${png}` }] } });
      if (options?.method !== 'POST' || !['https://provider.invalid/v1/images/generations', 'https://provider.invalid/v1/images/edits', 'https://provider.invalid/v1/chat/completions'].includes(url)) throw new Error(`Undeclared IO ${url}`);
      const billing = await canvasBilling(query); expect([billing.tasks.length, billing.publications.length, billing.transactions.length]).toEqual([1, 1, 1]);
      const checkpoint = (billing.tasks[0].result as { ordinaryCheckpoint: { attempts: Array<{ status: string }> } }).ordinaryCheckpoint;
      expect(checkpoint.attempts.at(-1)?.status).toBe('started');
      if (editing && calls.length === 1) {
        expect(url).toBe('https://provider.invalid/v1/images/edits');
        return Response.json({ error: { message: protocol === 'multipart' ? 'expected multipart form-data' : 'endpoint not found' } }, { status: protocol === 'multipart' ? 415 : 404 });
      }
      if (protocol === 'multipart') expect(new Headers(options.headers).get('content-type')).toContain('multipart/form-data');
      if (protocol === 'json-edits') expect(url).toBe('https://provider.invalid/v1/images/generations');
      if (protocol === 'gemini') {
        expect(url).toBe('https://provider.invalid/v1/chat/completions');
        return Response.json({ choices: [{ message: { content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] } }] });
      }
      return Response.json({ data: [{ b64_json: png }, ...(protocol === 'mixed' ? [{ task_id: 'mixed-remote' }] : [])] });
    });
    const post = await (await POST(ordinaryRequest({ model, ...(editing ? { referenceImages: ['/api/serve-upload/shared.png'],
      assetParentVersionIds: ['version-shared'], referenceDescriptions: ['cup'] } : {}) }))).json();
    const result = protocol === 'mixed' ? await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json() : post;
    expect(result.status).toBe('completed'); expect(result.imageUrls).toHaveLength(['mixed', 'gemini'].includes(protocol) ? 2 : 1);
    expect(extractTaskAssetReferences(result)).toHaveLength(result.imageUrls.length);
    expect(calls).toHaveLength(protocol === 'gemini' ? 1 : 2);
    const checkpoint = (await query('SELECT result FROM cloud_tasks')).rows[0].result.ordinaryCheckpoint;
    expect(checkpoint.attempts.map((attempt: { status: string }) => attempt.status)).toEqual(editing ? ['rejected', 'accepted'] : ['accepted']);
  });
}, 60_000);

it.each([true, false])('real admission COMMIT ACK loss returns only the recoverable key, provided=%s', async provided => {
  await withIsolatedPostgres('ordinary-ack', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    const media = vi.spyOn(safeImages, 'loadSafeImageInput'); let submissions = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submissions++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const request = ordinaryRequest({ submitOnly: true }); if (!provided) request.headers.delete('idempotency-key');
    const proxy = await loseCanvasCommitReply(databaseUrl, 2); let response: Response;
    try { response = await POST(request); expect(proxy.dropped()).toBe(true); } finally { await proxy.close(); }
    expect(response.status).toBe(503); const lost = await response.json();
    expect(lost).not.toHaveProperty('taskId'); expect(lost.idempotencyKey).toEqual(expect.any(String));
    expect(submissions).toBe(0); expect(media).not.toHaveBeenCalled();
    const admitted = await canvasBilling(query);
    expect([admitted.tasks.length, admitted.transactions.length, admitted.publications.length]).toEqual([1, 1, 1]);
    expect(lost.idempotencyKey).toBe(admitted.tasks[0].idempotency_key);
    const replay = await (await POST(ordinaryRequest({ submitOnly: true }, lost.idempotencyKey))).json();
    expect(replay.taskId).toBe(admitted.tasks[0].id);
    const poll = await (await POLL(ownedTaskRequest('poll-task', replay.taskId))).json(); expect(poll.status).toBe('completed');
    await Promise.all(boundary.callbacks.splice(0).map(callback => callback()));
    expect(submissions).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('full-body idempotency conflicts reject before media, provider or additional billing', async () => {
  await withIsolatedPostgres('ordinary-digest-fields', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true'; boundary.maxReferences = 2;
    const base = { submitOnly: true, referenceImages: ['/api/serve-upload/shared.png', '/api/serve-upload/second.png'],
      assetParentVersionIds: ['version-shared', 'version-second'], referenceDescriptions: ['cup', 'plate'] };
    const post = await POST(ordinaryRequest(base)); expect(post.status).toBe(200);
    const before = await canvasBilling(query); const media = vi.spyOn(safeImages, 'loadSafeImageInput');
    for (const delta of [{ prompt: 'new cup' }, { referenceImages: [...base.referenceImages].reverse(), assetParentVersionIds: [...base.assetParentVersionIds].reverse() },
      { referenceStrengths: [0.2, 0.7] }, { referenceCategories: { '0': ['style'] } }, { stylePreset: 'anime' },
      { size: '1024x1536' }, { quality: 'low' }, { background: 'transparent' }, { assetSelectedEntityIds: ['image-second'] },
      { assetWorkspaceId: 'canvas:shared' }, { sessionId: 'changed-session' }, { referenceMode: 'style' }, { outputCount: 2 }]) {
      const conflict = await POST(ordinaryRequest({ ...base, ...delta })); expect(conflict.status, JSON.stringify(delta)).toBe(409);
    }
    expect(await canvasBilling(query)).toEqual(before); expect(media).not.toHaveBeenCalled();
  });
}, 60_000);

it.each(['derived', 'revision'])('real %s multi-output publication appends canonical versions without replacing the selected source', async mode => {
  await withIsolatedPostgres('ordinary-lineage', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const source = (await query("SELECT * FROM wujie_asset_versions WHERE id='version-shared'")).rows;
    const placement = (await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-shared'")).rows;
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    let submits = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; const billing = await canvasBilling(query);
      expect([billing.tasks.length, billing.publications.length, billing.transactions.length]).toEqual([1, 1, 1]);
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const post = await (await POST(ordinaryRequest({ outputCount: 2, referenceImages: ['/api/serve-upload/shared.png'], referenceDescriptions: ['cup'],
      assetParentVersionIds: ['version-shared'], assetSelectedEntityIds: ['image-shared'], assetProjectionMode: mode }))).json();
    expect(post.status).toBe('completed'); expect(submits).toBe(2); const refs = extractTaskAssetReferences(post); expect(refs).toHaveLength(2);
    for (const ref of refs) {
      expect(ref.assetVersionId).not.toBe('version-shared'); expect(ref.placementId).not.toBe('placement-shared');
      if (mode === 'revision') expect(ref.assetId).toBe('asset-shared'); else expect(ref.assetId).not.toBe('asset-shared');
    }
    expect((await query("SELECT * FROM wujie_asset_versions WHERE id='version-shared'")).rows).toEqual(source);
    expect((await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-shared'")).rows).toEqual(placement);
    expect(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'))).toEqual(png);
    expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(2);
  });
}, 60_000);

it('accepted output download outage recovers the same output without generating another image', async () => {
  await withIsolatedPostgres('ordinary-download-outage', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); let submits = 0;
    const path = join(process.env.WUJIE_DATA_DIR!, 'second.png'); renameSync(path, `${path}.held`);
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    let taskId: string;
    try {
      const post = await (await POST(ordinaryRequest())).json(); taskId = post.taskId;
      expect(post.status).toBe('processing'); await POLL(ownedTaskRequest('poll-task', taskId)); expect(submits).toBe(1);
      expect((await query('SELECT result FROM cloud_tasks')).rows[0].result.ordinaryCheckpoint.attempts[0].status).toBe('accepted');
    } finally { renameSync(`${path}.held`, path); }
    const poll = await (await POLL(ownedTaskRequest('poll-task', taskId))).json(); expect(poll.status).toBe('completed');
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it('processing SSE registry projects only the validated group and safe fields', async () => {
  await withIsolatedPostgres('ordinary-sse-group', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      return Response.json({ data: [{ task_id: 'pending-remote' }] });
    });
    const post = await (await POST(ordinaryRequest({ outputCount: 2 }))).json();
    const registry = getTaskInfo(post.taskId); expect((registry?.result as Record<string, unknown> | undefined)?.outputGroup).toEqual(post.outputGroup);
    expect(JSON.stringify(registry?.result)).not.toMatch(/ordinaryGeneration|ordinaryCheckpoint|grantGeneration|test-only/);
  });
}, 60_000);

it.each([
  ['remote', 'url'], ['remote', 'checksum'], ['remote', 'lineage'],
  ['pending', 'url'], ['pending', 'checksum'], ['pending', 'lineage'],
  ['remote', 'missing-snapshot'], ['pending', 'invalid-snapshot'],
] as const)('fix1 I2 %s recovery refuses changed %s admission source but preserves personal output', async (phase, mutation) => {
  await withIsolatedPostgres('ordinary-final-source', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    if (phase === 'pending') await query('ALTER TABLE wujie_canvas_asset_commands ADD CONSTRAINT fix1_pending CHECK (false)');
    let submits = 0; let polls = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(resource);
      if (url === 'https://provider.invalid/images/generations' && options?.method === 'POST') {
        submits++;
        return Response.json(phase === 'remote' ? { data: [{ task_id: 'source-remote' }] }
          : { data: [{ url: '/api/serve-upload/second.png' }] });
      }
      if (url === 'https://provider.invalid/tasks/source-remote?language=zh' && !options?.method) {
        polls++; return Response.json({ status: 'completed', result: { images: [{ url: '/api/serve-upload/second.png' }] } });
      }
      throw new Error(`Undeclared IO ${url}`);
    });
    const post = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'], referenceDescriptions: ['cup'],
      assetParentVersionIds: ['version-shared'], assetProjectionMode: 'derived' }))).json();
    expect(post.status).toBe(phase === 'pending' ? 'completed' : 'processing');
    expect(extractTaskAssetReferences(post)).toHaveLength(0);
    if (phase === 'pending') await query('ALTER TABLE wujie_canvas_asset_commands DROP CONSTRAINT fix1_pending');
    if (mutation === 'url') await query("UPDATE wujie_asset_versions SET file_url='/api/serve-upload/second.png' WHERE id='version-shared'");
    if (mutation === 'checksum') await query("UPDATE wujie_asset_versions SET checksum='changed-after-acceptance' WHERE id='version-shared'");
    if (mutation === 'lineage') await query(`INSERT INTO wujie_asset_version_parents(version_id,parent_version_id,owner_id,project_id,parent_order,asset_id)
      VALUES ('version-shared','version-second','owner','shared',0,'asset-shared')`);
    if (mutation === 'missing-snapshot') await query(`UPDATE cloud_tasks SET result=result #- '{ordinaryGeneration,publication,ordinarySourceSnapshot}' WHERE id=$1`, [post.taskId]);
    if (mutation === 'invalid-snapshot') await query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{ordinaryGeneration,publication,ordinarySourceSnapshot}','[]'::jsonb) WHERE id=$1`, [post.taskId]);
    const tables = ['wujie_assets', 'wujie_asset_versions', 'wujie_asset_version_parents', 'wujie_workspace_placements',
      'wujie_canvas_media_lineage', 'wujie_canvas_asset_commands', 'wujie_project_canvas_documents', 'wujie_project_canvas_updates'];
    const before = await Promise.all(tables.map(async table => (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
    const task = recovered.tasks.find((value: { id: string }) => value.id === post.taskId);
    expect(poll.status).toBe('completed'); expect(poll.imageUrls).toHaveLength(1); expect(task.result.imageUrls).toHaveLength(1);
    expect(extractTaskAssetReferences(poll)).toHaveLength(0); expect(extractTaskAssetReferences(task.result)).toHaveLength(0);
    expect(await Promise.all(tables.map(async table => (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows))).toEqual(before);
    expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
    expect(submits).toBe(1); expect(polls).toBe(phase === 'remote' ? 1 : 0);
  });
}, 60_000);

it.each(['validate', 'replay'] as const)('fix1 I2 same source with reordered snapshot object keys: %s', async phase => {
  await withIsolatedPostgres('ordinary-source-key-order', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    let submits = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) === 'https://provider.invalid/images/generations' && options?.method === 'POST') {
        submits++; return Response.json({ task_id: 'key-order-remote' });
      }
      if (String(resource) === 'https://provider.invalid/tasks/key-order-remote?language=zh' && !options?.method) {
        return Response.json({ status: 'completed', result: { images: [{ url: '/api/serve-upload/second.png' }] } });
      }
      throw new Error(`Undeclared IO: ${String(resource)}`);
    });
    const post = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'], referenceDescriptions: ['cup'],
      assetParentVersionIds: ['version-shared'] }))).json();
    expect(post.status).toBe('processing');
    const row = (await query('SELECT result,request_digest,idempotency_key FROM cloud_tasks WHERE id=$1', [post.taskId])).rows[0];
    const descriptor = row.result.ordinaryGeneration as OrdinaryGenerationDescriptor;
    const source = descriptor.publication.ordinarySourceSnapshot!;
    const reordered = source.map(entry => Object.fromEntries(Object.entries(entry).reverse())) as typeof source;
    expect(reordered).toEqual(source); expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(source));
    descriptor.publication.ordinarySourceSnapshot = reordered;
    if (phase === 'validate') await expect(validateCanvasOrdinarySources(descriptor.publication, descriptor.plan.body, 'http://localhost'))
      .resolves.toEqual(['/api/serve-upload/shared.png']);
    else await expect(validateCanvasOrdinaryReplay(descriptor.publication,
      { type: 'generate', requestDigest: row.request_digest, idempotencyKey: row.idempotency_key }, post.taskId)).resolves.toBeUndefined();
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(poll.status).toBe('completed'); expect(extractTaskAssetReferences(poll)).toHaveLength(1);
    const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
    expect(extractTaskAssetReferences(recovered.tasks.find((task: { id: string }) => task.id === post.taskId).result)).toHaveLength(1);
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it.each(['recover', 'foreign-head', 'wrong-root', 'missing-lineage', 'wrong-index', 'wrong-digest',
  'missing-command', 'wrong-command', 'wrong-parent', 'asset-metadata', 'source-content', 'missing-head'])
('fix1 I2 revision head proof and interrupted recovery: %s', async mutation => {
  await withIsolatedPostgres('ordinary-revision-head', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    await query('ALTER TABLE wujie_canvas_media_lineage ADD CONSTRAINT fix1_second CHECK (output_index <> 1)');
    let submits = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }, { url: '/api/serve-upload/shared.png' }] });
    });
    const post = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'], referenceDescriptions: ['cup'],
      assetParentVersionIds: ['version-shared'], assetProjectionMode: 'revision' }))).json();
    expect(post.status).toBe('completed'); expect(post.imageUrls).toHaveLength(2);
    // A new two-output attempt is atomic even when the second lineage write fails.
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows).toEqual([]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toEqual([]);
    expect((await query('SELECT * FROM wujie_canvas_media_lineage')).rows).toEqual([]);
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0].current_version_id)
      .toBe('version-shared');
    expect((await query("SELECT result->'assetProjection' AS marker FROM cloud_tasks WHERE id=$1", [post.taskId])).rows[0].marker?.status)
      .not.toBe('completed');
    // Model a legitimate historical partial through the public, DB-minted single entry.
    const historical = await publishDocumentTaskOutput('editor', post.taskId, 0);
    const first = (await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows;
    expect(first).toHaveLength(1); const head = first[0].id;
    expect(head).toBe(historical.assetVersionId);
    expect((await query("SELECT current_version_id FROM wujie_assets WHERE id='asset-shared'")).rows[0].current_version_id).toBe(head);
    expect((await query('SELECT target_version_id,output_index FROM wujie_canvas_media_lineage')).rows)
      .toEqual([{ target_version_id: head, output_index: 0 }]);
    expect((await query('SELECT asset_version_id FROM wujie_canvas_asset_commands')).rows)
      .toEqual([{ asset_version_id: head }]);
    expect((await query("SELECT result->'assetProjection' AS marker FROM cloud_tasks WHERE id=$1", [post.taskId])).rows[0].marker?.status)
      .not.toBe('completed');
    await query('ALTER TABLE wujie_canvas_media_lineage DROP CONSTRAINT fix1_second');
    if (mutation === 'foreign-head') {
      await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,availability)
        VALUES ('foreign-head','asset-shared','owner','shared','/api/serve-upload/second.png','image/png','ready')`);
      await query("UPDATE wujie_assets SET current_version_id='foreign-head' WHERE id='asset-shared'");
    }
    if (mutation === 'wrong-root') {
      await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,created_at,updated_at)
        VALUES ('foreign-root','editor','shared','generate','completed',1,1)`);
      await query("UPDATE wujie_asset_versions SET task_id='foreign-root' WHERE id=$1", [head]);
    }
    if (mutation === 'missing-lineage') await query('DELETE FROM wujie_canvas_media_lineage WHERE target_version_id=$1', [head]);
    if (mutation === 'wrong-index') await query('UPDATE wujie_canvas_media_lineage SET output_index=2 WHERE target_version_id=$1', [head]);
    if (mutation === 'wrong-digest') await query("UPDATE wujie_canvas_media_lineage SET source_request_digest=repeat('a',64) WHERE target_version_id=$1", [head]);
    if (mutation === 'missing-command') await query('DELETE FROM wujie_canvas_asset_commands WHERE asset_version_id=$1', [head]);
    if (mutation === 'wrong-command') await query("UPDATE wujie_canvas_asset_commands SET idempotency_key='foreign-command' WHERE asset_version_id=$1", [head]);
    if (mutation === 'wrong-parent') await query("UPDATE wujie_asset_version_parents SET parent_version_id='version-second' WHERE version_id=$1", [head]);
    if (mutation === 'asset-metadata') await query("UPDATE wujie_assets SET metadata='{\"foreign\":true}'::jsonb WHERE id='asset-shared'");
    if (mutation === 'source-content') await query("UPDATE wujie_asset_versions SET checksum='changed' WHERE id='version-shared'");
    if (mutation === 'missing-head') await query(`UPDATE cloud_tasks SET result=result #- '{ordinaryGeneration,publication,ordinarySourceSnapshot,0,assetCurrentVersionId}' WHERE id=$1`, [post.taskId]);
    const tables = ['wujie_assets', 'wujie_asset_versions', 'wujie_asset_version_parents', 'wujie_workspace_placements',
      'wujie_canvas_media_lineage', 'wujie_canvas_asset_commands', 'wujie_project_canvas_documents', 'wujie_project_canvas_updates'];
    const snapshot = async (): Promise<unknown[]> => Promise.all(tables.map(async table =>
      (await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
    expect(poll.status).toBe('completed'); expect(poll.imageUrls).toHaveLength(2);
    if (mutation === 'recover') {
      expect(extractTaskAssetReferences(poll)).toHaveLength(2);
      const after = await snapshot();
      await POLL(ownedTaskRequest('poll-task', post.taskId)); await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
      expect(await snapshot()).toEqual(after);
      expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows).toHaveLength(2);
      expect((await query('SELECT asset_version_id FROM wujie_canvas_asset_commands WHERE asset_version_id=$1', [head])).rows).toHaveLength(1);
    } else expect(await snapshot()).toEqual(before);
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it('fix1 I2 final transaction rejects source lineage changed after real publication media preparation', async () => {
  await withIsolatedPostgres('ordinary-final-window', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    await query('ALTER TABLE wujie_canvas_asset_commands ADD CONSTRAINT fix1_prepare CHECK (false)');
    let submits = 0;
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const post = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'], referenceDescriptions: ['cup'],
      assetParentVersionIds: ['version-shared'] }))).json();
    await query('ALTER TABLE wujie_canvas_asset_commands DROP CONSTRAINT fix1_prepare');
    let mutated = false; const prepare = mediaSources.prepareAdoptedMedia;
    vi.spyOn(mediaSources, 'prepareAdoptedMedia').mockImplementation(async (...args: Parameters<typeof prepare>) => {
      const media = await prepare(...args);
      if (!mutated) {
        mutated = true;
        await query(`INSERT INTO wujie_asset_version_parents(version_id,parent_version_id,owner_id,project_id,parent_order,asset_id)
          VALUES ('version-shared','version-second','owner','shared',0,'asset-shared')`);
      }
      return media;
    });
    const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
    expect(mutated).toBe(true);
    const task = recovered.tasks.find((value: { id: string }) => value.id === post.taskId);
    expect(task.status).toBe('completed'); expect(task.result.imageUrls).toHaveLength(1);
    expect(extractTaskAssetReferences(task.result)).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [post.taskId])).rows).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_project_canvas_updates')).rows).toHaveLength(0);
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it('publication failure preserves personal outputs and real GET restores all references exactly once', async () => {
  await withIsolatedPostgres('ordinary-projection-recovery', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); let submits = 0;
    await query('ALTER TABLE wujie_canvas_asset_commands ADD CONSTRAINT reject_ordinary_publication CHECK (false)');
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }, { url: '/api/serve-upload/shared.png' }] });
    });
    const post = await (await POST(ordinaryRequest())).json(); expect(post.status).toBe('completed'); expect(post.imageUrls).toHaveLength(2);
    expect(extractTaskAssetReferences(post)).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    await query('ALTER TABLE wujie_canvas_asset_commands DROP CONSTRAINT reject_ordinary_publication');
    const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
    const task = recovered.tasks.find((value: { id: string }) => value.id === post.taskId);
    expect(extractTaskAssetReferences(task.result)).toHaveLength(2); expect(task.result.outputGroup).toEqual(post.outputGroup);
    await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared')); await POLL(ownedTaskRequest('poll-task', post.taskId));
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(2);
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it.each(['revoke', 'regrant', 'source-version'])('multi-reference %s barrier after the first real read forbids the second shared read and all provider IO', async change => {
  await withIsolatedPostgres('ordinary-reference-barrier', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); boundary.maxReferences = 2;
    const original = safeImages.loadSafeImageInput; const reads: string[] = []; let calls = 0;
    vi.stubGlobal('fetch', async (): Promise<never> => { calls++; throw new Error('Undeclared IO'); });
    vi.spyOn(safeImages, 'loadSafeImageInput').mockImplementation(async (input, options) => {
      const image = await original(input, options); reads.push(String(input));
      if (reads.length === 1) {
        if (change === 'source-version') await query("UPDATE wujie_asset_versions SET file_url='/api/serve-upload/shared.png' WHERE id='version-second'");
        else {
          await revokeDocumentEditor('owner', 'shared', 'editor');
          if (change === 'regrant') await grantDocumentEditor('owner', 'shared', 'editor');
        }
      }
      return image;
    });
    const post = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png', '/api/serve-upload/second.png'],
      assetParentVersionIds: ['version-shared', 'version-second'] }))).json();
    expect(reads).toEqual(['/api/serve-upload/shared.png']); expect(calls).toBe(0);
    expect(post.status).toBe('failed');
    expect((await canvasBilling(query)).transactions.map(row => row.type).sort()).toEqual(['consume', 'refund']);
  });
}, 60_000);

it.each([false, true])('frozen candidate routing retains per-output provenance and safe raw diagnostics, explicit=%s', async explicit => {
  await withIsolatedPostgres('ordinary-candidate-audit', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    const fallback: ApiProvider = { id: 'fallback', name: 'Fallback', type: 'image', modelType: 'image', isEnabled: true,
      baseUrl: 'https://fallback.invalid', apiKey: 'fallback-key', selectedModels: ['gpt-image-1-mini'], discoveredModels: [],
      createdAt: 1, updatedAt: 1, advancedParams: { compatProfile: 'openai' } };
    boundary.fallback = fallback;
    const post = await (await POST(ordinaryRequest({ providerId: explicit ? 'provider' : undefined, outputCount: 2, submitOnly: true }))).json();
    expect(post.taskId).toMatch(/^ordinary_/);
    boundary.baseUrl = 'https://changed-primary.invalid'; boundary.profile = 'apimart'; boundary.models = [];
    fallback.baseUrl = 'https://changed-fallback.invalid'; fallback.selectedModels = []; fallback.apiKey = 'rotated-fallback-key';
    let primaryCalls = 0; const calls: Array<{ url: string; model: string }> = [];
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(resource); const body = JSON.parse(String(options?.body || '{}')); calls.push({ url, model: body.model });
      if (options?.method !== 'POST') throw new Error('Undeclared IO');
      if (['https://provider.invalid/images/generations', 'https://provider.invalid/v1/images/generations'].includes(url)) {
        primaryCalls++;
        if (primaryCalls === 1) return Response.json({ data: [{ url: '/api/serve-upload/shared.png' }] });
        return Response.json({ error: { code: 'invalid_quality', message: 'invalid quality; api_key=test-only' } }, { status: 400 });
      }
      if (url === 'https://fallback.invalid/images/generations') {
        expect(new Headers(options.headers).get('authorization')).toBe('Bearer rotated-fallback-key');
        return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
      }
      throw new Error(`Undeclared IO ${url}`);
    });
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(poll.status).toBe('completed');
    const refs = extractTaskAssetReferences(poll); expect(refs).toHaveLength(explicit ? 1 : 2);
    expect(calls.filter(call => call.url.startsWith('https://fallback.invalid'))).toHaveLength(explicit ? 0 : 1);
    const versions = await Promise.all(refs.map(ref => query('SELECT provider_id,model_id FROM wujie_asset_versions WHERE id=$1', [ref.assetVersionId])));
    console.info('ACTUAL_OUTPUT_PROVENANCE', versions.map(result => result.rows[0]));
    expect.soft(versions.map(result => result.rows[0])).toEqual(explicit ? [{ provider_id: 'provider', model_id: 'gpt-image-1' }]
      : [{ provider_id: 'provider', model_id: 'gpt-image-1' }, { provider_id: 'fallback', model_id: 'gpt-image-1-mini' }]);
    expect.soft(poll.routeAudit?.outputs?.map((output: { providerId: string; model: string }) => [output.providerId, output.model]))
      .toEqual(explicit ? [['provider', 'gpt-image-1']] : [['provider', 'gpt-image-1'], ['fallback', 'gpt-image-1-mini']]);
    expect.soft(poll.routeAudit?.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ slotIndex: 1,
      providerId: 'provider', model: 'gpt-image-1', status: 'rejected', diagnostic: { status: 400, code: 'invalid_quality', message: 'invalid quality; api_key=[redacted]' } })]));
    const recovered = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
    const recovery = recovered.tasks.find((task: { id: string }) => task.id === post.taskId);
    expect.soft(recovery.result.routeAudit).toEqual(poll.routeAudit);
    expect(JSON.stringify([poll, recovery])).not.toMatch(/test-only|rotated-fallback-key|ordinaryGeneration|ordinaryCheckpoint|grantGeneration/);
  });
}, 60_000);

it.each(['missing-descriptor', 'bad-target', 'wrong-output-url'])('publication refuses %s ordinary output provenance instead of using the root candidate', async corruption => {
  await withIsolatedPostgres('ordinary-invalid-provenance', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    await query('ALTER TABLE wujie_canvas_asset_commands ADD CONSTRAINT hold_ordinary_publication CHECK (false)');
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const post = await (await POST(ordinaryRequest())).json(); expect(post.status).toBe('completed');
    if (corruption === 'missing-descriptor') await query("UPDATE cloud_tasks SET result=result-'ordinaryGeneration'");
    if (corruption === 'bad-target') await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{ordinaryCheckpoint,attempts,0,targetIndex}','99'::jsonb)");
    if (corruption === 'wrong-output-url') await query("UPDATE cloud_tasks SET result=jsonb_set(result,'{ordinaryCheckpoint,persistedOutputs}','{}'::jsonb)");
    await query('ALTER TABLE wujie_canvas_asset_commands DROP CONSTRAINT hold_ordinary_publication');
    await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    expect((await query("SELECT * FROM wujie_asset_versions WHERE task_id=$1", [post.taskId])).rows).toHaveLength(0);
    expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it('provider deduplication keys separate slots, roots and actors while accepted recovery never resubmits', async () => {
  await withIsolatedPostgres('ordinary-provider-identity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const cache = new Map<string, string>(); const calls: string[] = [];
    const pixels = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    const images = await Promise.all(pixels.map(async background => `data:image/png;base64,${(await sharp({
      create: { width: 2, height: 2, channels: 3, background },
    }).png().toBuffer()).toString('base64')}`));
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(resource);
      if (url === 'https://provider.invalid/images/generations' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body)); const key = body.idempotency_key as string;
        expect(key).toBeTruthy(); expect(key.length).toBeLessThanOrEqual(128);
        const billing = await canvasBilling(query);
        expect(billing.tasks.length).toBe(billing.transactions.length);
        expect(billing.tasks.length).toBe(billing.publications.length);
        const current = billing.tasks.find(task => task.status === 'processing')!;
        expect(current.user_id).toBe(boundary.actor);
        expect((current.result as { ordinaryCheckpoint: { attempts: Array<{ status: string }> } }).ordinaryCheckpoint.attempts.at(-1)?.status).toBe('started');
        calls.push(key);
        if (!cache.has(key)) cache.set(key, `remote-${cache.size}`);
        return Response.json({ data: [{ task_id: cache.get(key) }] });
      }
      const match = /^https:\/\/provider\.invalid\/tasks\/remote-(\d)\?language=zh$/.exec(url);
      if (match && !options?.method) return Response.json({ status: 'completed', result: { images: [{ url: images[Number(match[1])] }] } });
      throw new Error(`Undeclared IO ${url}`);
    });
    const actualPixels: number[][] = []; const roots: string[] = [];
    for (const [actor, clientKey] of [['editor', 'shared-client-key'], ['owner', 'shared-client-key'], ['editor', 'other-client-key']]) {
      boundary.actor = actor;
      const post = await (await POST(ordinaryRequest({ outputCount: 2 }, clientKey))).json();
      roots.push(post.taskId); expect(post.idempotencyKey).toBe(clientKey);
      const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
      expect(poll.status).toBe('completed'); expect(poll.imageUrls).toHaveLength(2);
      for (const url of poll.imageUrls) actualPixels.push(Array.from((await sharp((await safeImages.loadSafeImageInput(url)).buffer).removeAlpha().raw().toBuffer()).subarray(0, 3)));
      await POST(ordinaryRequest({ outputCount: 2 }, clientKey));
      await POLL(ownedTaskRequest('poll-task', post.taskId));
    }
    expect(new Set(roots).size).toBe(3);
    expect(calls).toHaveLength(6); expect(new Set(calls).size).toBe(6);
    expect(actualPixels).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]]);
    const billing = await canvasBilling(query);
    expect(billing.tasks).toHaveLength(3); expect(billing.transactions.map(row => row.amount)).toEqual([-7, -7, -7]);
  });
}, 60_000);

it.each([{}, { _skipCredits: false, _skipCloudTaskPersistence: false }])('internal auth-boundary result with inactive skips still atomically admits in real PG: %j', async flags => {
  await withIsolatedPostgres('ordinary-internal-first', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); boundary.source = 'internal';
    vi.stubGlobal('fetch', async (resource: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(resource) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      const billing = await canvasBilling(query);
      expect([billing.tasks.length, billing.transactions.length, billing.publications.length]).toEqual([1, 1, 1]);
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const response = await (await POST(ordinaryRequest(flags))).json();
    expect(response.taskId).toMatch(/^ordinary_/); expect(response.status).toBe('completed');
    expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it.each([true, false])('freezes the actual Responses choice across environment changes: admitted=%s', async enabled => {
  await withIsolatedPostgres(`ordinary-responses-${enabled}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    boundary.baseUrl = 'https://api.openai.com';
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    vi.stubEnv('RESPONSES_API_ENABLED', String(enabled));
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png')).toString('base64');
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(input); calls.push(url);
      if (options?.method !== 'POST') throw new Error('Undeclared IO');
      if (url === 'https://api.openai.com/v1/responses') return new Response(`data: ${JSON.stringify({ type: 'response.completed',
        response: { output: [{ type: 'image_generation_call', result: png }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      if (url === 'https://api.openai.com/images/generations') return Response.json({ data: [{ b64_json: png }] });
      throw new Error(`Undeclared IO ${url}`);
    });
    const post = await (await POST(ordinaryRequest({ submitOnly: true }))).json();
    vi.stubEnv('RESPONSES_API_ENABLED', String(!enabled));
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(calls).toEqual([enabled ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/images/generations']);
    expect(poll.status).toBe('completed');
    expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
  });
}, 60_000);

it('freezes auxiliary target and enhanced prompt before generation, allowing only its key to rotate', async () => {
  await withIsolatedPostgres('ordinary-frozen-vision', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    boundary.vision = { id: 'vision', name: 'Vision', modelType: 'chat', type: 'chat', isEnabled: true,
      baseUrl: 'https://vision.invalid', apiKey: 'old-vision-key', selectedModels: ['gpt-4o'], discoveredModels: [] };
    const calls: Array<{ url: string; model: string; auth: string }> = [];
    const unexpected: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(input); const body = JSON.parse(String(options?.body || '{}'));
      if (options?.method === 'POST' && url === 'https://vision.invalid/chat/completions') {
        const billing = await canvasBilling(query);
        expect([billing.tasks.length, billing.transactions.length, billing.publications.length]).toEqual([1, 1, 1]);
        calls.push({ url, model: body.model, auth: new Headers(options.headers).get('authorization')! });
        return Response.json({ choices: [{ message: { content: 'EN: blue cup\nZH: 蓝杯' } }] });
      }
      if (options?.method === 'POST' && ['https://provider.invalid/images/edits', 'https://provider.invalid/images/generations'].includes(url)) {
        expect(body.prompt).toContain('blue cup');
        const checkpoint = (await query('SELECT result FROM cloud_tasks')).rows[0].result.ordinaryCheckpoint;
        expect(checkpoint.enhancedPrompt).toContain('blue cup');
        return Response.json({ data: [{ task_id: 'vision-remote' }] });
      }
      if (url === 'https://provider.invalid/tasks/vision-remote?language=zh' && !options?.method)
        return Response.json({ status: 'completed', result: { images: [{ url: '/api/serve-upload/second.png' }] } });
      unexpected.push(url); throw new Error('Undeclared IO');
    });
    const post = await (await POST(ordinaryRequest({ submitOnly: true, referenceImages: ['/api/serve-upload/shared.png'],
      assetParentVersionIds: ['version-shared'], referenceMode: 'reference' }))).json();
    boundary.vision.baseUrl = 'https://changed.invalid'; boundary.vision.selectedModels = ['gemini-new']; boundary.vision.apiKey = 'rotated-vision-key';
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(unexpected).toEqual([]);
    expect(calls).toEqual([{ url: 'https://vision.invalid/chat/completions', model: 'gpt-4o', auth: 'Bearer rotated-vision-key' }]);
    expect(poll.status).toBe('completed');
    await POLL(ownedTaskRequest('poll-task', post.taskId));
    expect(calls).toHaveLength(1);
    expect(JSON.stringify((await query('SELECT result FROM cloud_tasks')).rows)).not.toMatch(/old-vision-key|rotated-vision-key/);
  });
}, 60_000);

it('ordinary real POST atomically admits task, editor consumption and publication before provider IO', async (): Promise<void> => {
  await withIsolatedPostgres('ordinary-first', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    let observedBeforeProvider: unknown;
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname !== 'provider.invalid' || !['/images/generations', '/v1/images/generations'].includes(url.pathname)
        || options?.method !== 'POST') throw new Error(`Undeclared IO: ${options?.method || 'GET'} ${url.origin}${url.pathname}`);
      const billing = await canvasBilling(query);
      observedBeforeProvider = { tasks: billing.tasks.length, consumes: billing.transactions.filter(row => row.type === 'consume').length,
        publications: billing.publications.length, userId: billing.tasks[0]?.user_id };
      return Response.json({ data: [{ task_id: 'offline-ordinary-remote' }] });
    });
    const response = await POST(new NextRequest('http://localhost/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'ordinary-first' },
      body: JSON.stringify({ projectId: 'shared', providerId: 'provider', model: 'gpt-image-1', prompt: '蓝色杯子', outputCount: 1 }),
    }));
    expect(observedBeforeProvider).toEqual({ tasks: 1, consumes: 1, publications: 1, userId: 'editor' });
    expect((await response.json()).taskIds).toHaveLength(1);
  });
}, 60_000);

it('failed accepted checkpoint stops the next slot and retains the charge for reconciliation', async (): Promise<void> => {
  await withIsolatedPostgres('ordinary-checkpoint-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    await query(`CREATE FUNCTION reject_ordinary_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected accepted checkpoint failure'; END $$`);
    await query(`CREATE TRIGGER reject_ordinary_checkpoint BEFORE UPDATE ON cloud_tasks FOR EACH ROW
      WHEN (NEW.result::text LIKE '%"status": "accepted"%') EXECUTE FUNCTION reject_ordinary_checkpoint()`);
    let submissions = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submissions++; return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const body = await (await POST(ordinaryRequest({ outputCount: 2 }))).json();
    expect(body.code).toBe('ORDINARY_SUBMISSION_UNCERTAIN');
    expect(submissions).toBe(1);
    await query('DROP TRIGGER reject_ordinary_checkpoint ON cloud_tasks');
    await POLL(ownedTaskRequest('poll-task', body.taskId));
    expect(submissions).toBe(1);
    expect((await canvasBilling(query)).transactions.map(row => row.type)).toEqual(['consume']);
  });
}, 60_000);

it('multiple remote outputs survive one transient query failure and feed real session and GET without duplicate publication', async (): Promise<void> => {
  await withIsolatedPostgres('ordinary-multi-remote', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
    const pngs = await Promise.all(colors.map(background => sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer()));
    const images = pngs.map(png => `data:image/png;base64,${png.toString('base64')}`);
    let submissions = 0; let remoteA = 0; let remoteB = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === 'https://provider.invalid/images/generations' && options?.method === 'POST') {
        submissions++; return Response.json({ data: submissions === 1
          ? [{ task_id: 'remote-a' }, { task_id: 'remote-b' }] : [{ task_id: 'remote-c' }] });
      }
      if (url === 'https://provider.invalid/tasks/remote-a?language=zh' && !options?.method) {
        remoteA++; return Response.json({ status: 'completed', result: { images: [{ url: images.slice(0, 2) }] } });
      }
      if (url === 'https://provider.invalid/tasks/remote-b?language=zh' && !options?.method) {
        if (++remoteB === 1) throw new Error('offline temporary poll failure');
        return Response.json({ status: 'completed', result: { images: [{ url: images[2] }] } });
      }
      if (url === 'https://provider.invalid/tasks/remote-c?language=zh' && !options?.method)
        return Response.json({ status: 'completed', result: { images: [{ url: images[3] }] } });
      throw new Error(`Undeclared IO ${url}`);
    });
    const post = await (await POST(ordinaryRequest({ outputCount: 2 }))).json();
    expect(post.taskIds).toEqual([post.taskId]);
    const first = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(first.status).toBe('processing'); expect(first.imageUrls).toHaveLength(3);
    const second = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(second.status).toBe('completed'); expect(second.imageUrls).toHaveLength(4);
    expect(extractTaskAssetReferences(second)).toHaveLength(4);
    expect(remoteA).toBe(1); expect(remoteB).toBe(2); expect(submissions).toBe(2);
    const storedPixels = await Promise.all(second.imageUrls.map(async (url: string): Promise<number[]> => {
      const { buffer: bytes } = await safeImages.loadSafeImageInput(url);
      return Array.from((await sharp(bytes).removeAlpha().raw().toBuffer()).subarray(0, 3));
    }));
    expect(storedPixels).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]);
    const refs = extractTaskAssetReferences(second);
    const canonicalPixels = await Promise.all(refs.map(async ref => Array.from(
      (await sharp((await safeImages.loadSafeImageInput(ref.url)).buffer).removeAlpha().raw().toBuffer()).subarray(0, 3))));
    expect(canonicalPixels).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]);
    const before = await canvasBilling(query);
    const commands = (await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows;
    const session = createImageGenerationSession({ submit: async () => post,
      subscribeTaskEvents: (): (() => void) => (): void => {}, isTaskEventsConnected: (): boolean => false,
      cancelTask: async () => ({ success: false }), extractAssetReferences: extractTaskAssetReferences,
      restoreTasks: async () => {
        const payload = await (await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).json();
        return payload.tasks.map((task: { id: string }) => ({ ...task, taskId: task.id }));
      },
    });
    try {
      for (let index = 0; index < 2; index++) {
        const restored = await session.restore('shared');
        expect(restored).toHaveLength(4);
        expect(restored.map(slot => slot.outputIndex)).toEqual([0, 1, 2, 3]);
        expect(restored.map(slot => slot.url)).toEqual(refs.map(ref => ref.url));
        expect(restored.every(slot => slot.status === 'completed')).toBe(true);
        expect(new Set(restored.map(slot => slot.placementId)).size).toBe(4);
        await POST(ordinaryRequest({ outputCount: 2 })); await POLL(ownedTaskRequest('poll-task', post.taskId));
      }
    } finally { session.dispose(); }
    expect(await canvasBilling(query)).toEqual(before);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY idempotency_key')).rows).toEqual(commands);
    expect(submissions).toBe(2);
  });
}, 60_000);

it('remote-result checkpoint failure stops subsequent queries and media reads until a later owned poll', async (): Promise<void> => {
  await withIsolatedPostgres('ordinary-remote-checkpoint-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const image = `data:image/png;base64,${readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png')).toString('base64')}`;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === 'https://provider.invalid/images/generations' && options?.method === 'POST') {
        calls.push('submit'); return Response.json({ data: [{ task_id: 'remote-a' }, { task_id: 'remote-b' }] });
      }
      if (['https://provider.invalid/tasks/remote-a?language=zh', 'https://provider.invalid/tasks/remote-b?language=zh'].includes(url) && !options?.method) {
        calls.push(url.includes('remote-a') ? 'remote-a' : 'remote-b');
        return Response.json({ status: 'completed', result: { images: [{ url: image }] } });
      }
      throw new Error(`Undeclared IO ${url}`);
    });
    const post = await (await POST(ordinaryRequest())).json();
    await query(`CREATE FUNCTION reject_ordinary_remote_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected remote checkpoint failure'; END $$`);
    await query(`CREATE TRIGGER reject_ordinary_remote_checkpoint BEFORE UPDATE ON cloud_tasks FOR EACH ROW
      WHEN (NEW.result->'ordinaryCheckpoint'->'attempts'->0->'remotes'->0 ? 'urls') EXECUTE FUNCTION reject_ordinary_remote_checkpoint()`);
    const media = vi.spyOn(safeImages, 'loadSafeImageInput');
    const failed = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(calls).toEqual(['submit', 'remote-a']);
    expect(media).not.toHaveBeenCalled();
    expect(failed.code).toBe('ORDINARY_SUBMISSION_UNCERTAIN');
    expect((await canvasBilling(query)).transactions.map(row => row.type)).toEqual(['consume']);
    await query('DROP TRIGGER reject_ordinary_remote_checkpoint ON cloud_tasks');
    const recovered = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(recovered.status).toBe('completed');
    expect(recovered.code).toBeUndefined();
    expect(recovered.success).toBe(true);
    expect(calls).toEqual(['submit', 'remote-a', 'remote-a', 'remote-b']);
    expect(recovered.imageUrls).toHaveLength(2);
  });
}, 60_000);

it.each(['524', '504', '400', 'disconnect', 'non-json', 'empty'])('uncertain %s POST cannot submit again through owned POLL', async (failure): Promise<void> => {
  await withIsolatedPostgres(`ordinary-uncertain-${failure}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    let submissions = 0;
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(input);
      urls.push(url);
      if (url !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error(`Undeclared IO ${url}`);
      submissions++;
      if (failure === 'disconnect') throw new TypeError('offline injected disconnect');
      if (failure === 'non-json') return new Response('<html>unknown</html>');
      if (failure === 'empty') return Response.json({ data: [] });
      return Response.json({ error: { message: 'upstream result unknown' } }, { status: Number(failure) });
    });
    const post = await POST(ordinaryRequest()); const body = await post.json();
    expect(body.code).toBe('ORDINARY_SUBMISSION_UNCERTAIN');
    expect(body.requiresReconciliation).toBe(true); expect(body.retryable).toBe(false);
    const poll = await POLL(ownedTaskRequest('poll-task', body.taskId));
    expect(poll.status).toBe(200);
    expect((await poll.json()).code).toBe('ORDINARY_SUBMISSION_UNCERTAIN');
    for (const callback of boundary.callbacks.splice(0)) await callback();
    expect(submissions).toBe(1);
    expect(urls).toEqual(['https://provider.invalid/images/generations']);
    const billing = await canvasBilling(query);
    expect(billing.transactions.map(row => [row.type, row.amount])).toEqual([['consume', -7]]);
    expect(billing.publications).toHaveLength(1);
  });
}, 60_000);

it('revocation stops unsent slots but still recovers accepted remote outputs for the actor without shared publication', async () => {
  await withIsolatedPostgres('ordinary-accepted-revoked', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === 'https://provider.invalid/images/generations' && options?.method === 'POST') {
        calls.push('submit'); await revokeDocumentEditor('owner', 'shared', 'editor');
        return Response.json({ data: [{ task_id: 'already-accepted' }] });
      }
      if (url === 'https://provider.invalid/tasks/already-accepted?language=zh' && !options?.method) {
        calls.push('poll'); return Response.json({ status: 'completed', result: { images: [{ url: '/api/serve-upload/second.png' }] } });
      }
      throw new Error(`Undeclared IO ${url}`);
    });
    const post = await (await POST(ordinaryRequest({ outputCount: 2 }))).json();
    expect(post.status).toBe('processing');
    const poll = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(poll.status).toBe('completed'); expect(poll.imageUrls).toHaveLength(1);
    expect(calls).toEqual(['submit', 'poll']);
    expect((await canvasBilling(query)).transactions.map(row => row.type)).toEqual(['consume']);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each(['corrupt', 'missing'])('distinguishes confirmed bad source bytes from temporary unreadable media: %s', async kind => {
  await withIsolatedPostgres(`ordinary-source-${kind}`, async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const path = join(process.env.WUJIE_DATA_DIR!, 'shared.png');
    if (kind === 'corrupt') writeFileSync(path, Buffer.from('not an image'));
    else renameSync(path, `${path}.temporarily-offline`);
    const unexpected: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<never> => { unexpected.push(String(input)); throw new Error('Undeclared IO'); });
    const post = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'], assetParentVersionIds: ['version-shared'] }))).json();
    expect(post.status).toBe(kind === 'corrupt' ? 'failed' : 'processing');
    expect(unexpected).toEqual([]);
    expect((await canvasBilling(query)).transactions.map(row => row.type).sort()).toEqual(kind === 'corrupt' ? ['consume', 'refund'] : ['consume']);
  });
}, 60_000);

it('times out an unsubmitted ordinary task after its source stays unreadable and refunds only once', async () => {
  await withIsolatedPostgres('ordinary-source-unavailable-timeout', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const source = join(process.env.WUJIE_DATA_DIR!, 'shared.png');
    renameSync(source, `${source}.temporarily-offline`);
    const providerRequests: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<never> => {
      providerRequests.push(String(input));
      throw new Error('Undeclared IO');
    });

    const first = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'],
      assetParentVersionIds: ['version-shared'] }))).json();
    expect(first.status).toBe('processing');
    const before = (await query('SELECT result FROM cloud_tasks WHERE id=$1', [first.taskId])).rows[0].result;
    expect(typeof before.ordinaryCheckpoint?.sourceUnavailableSince).toBe('number');
    expect((await canvasBilling(query)).transactions.map(row => row.type)).toEqual(['consume']);

    await query(`UPDATE cloud_tasks SET result=jsonb_set(result, '{ordinaryCheckpoint,sourceUnavailableSince}',
      to_jsonb($2::bigint), true) WHERE id=$1`, [first.taskId, Date.now() - 11 * 60_000]);
    const poll = await (await POLL(ownedTaskRequest('poll-task', first.taskId))).json();
    expect(poll.status).toBe('timeout');
    const repeat = await (await POLL(ownedTaskRequest('poll-task', first.taskId))).json();
    expect(repeat.status).toBe('timeout');
    expect(providerRequests).toEqual([]);
    expect((await canvasBilling(query)).transactions.map(row => row.type).sort()).toEqual(['consume', 'refund']);
  });
}, 60_000);

it('restarts the source recovery window after a readable interval', async () => {
  await withIsolatedPostgres('ordinary-source-recovered-window', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const source = join(process.env.WUJIE_DATA_DIR!, 'shared.png');
    const offline = `${source}.temporarily-offline`;
    renameSync(source, offline);
    const first = await (await POST(ordinaryRequest({ referenceImages: ['/api/serve-upload/shared.png'],
      assetParentVersionIds: ['version-shared'] }))).json();
    expect(first.status).toBe('processing');
    await query(`UPDATE cloud_tasks SET result=jsonb_set(result, '{ordinaryCheckpoint,sourceUnavailableSince}',
      to_jsonb($2::bigint), true) WHERE id=$1`, [first.taskId, Date.now() - 11 * 60_000]);

    renameSync(offline, source);
    boundary.apiKey = '';
    const recovered = await (await POLL(ownedTaskRequest('poll-task', first.taskId))).json();
    expect(recovered.status).toBe('processing');
    renameSync(source, offline);
    const missingAgain = await (await POLL(ownedTaskRequest('poll-task', first.taskId))).json();
    expect(missingAgain.status).toBe('processing');
    expect((await canvasBilling(query)).transactions.map(row => row.type)).toEqual(['consume']);
  });
}, 60_000);

it.each(['cancel', 'lease'])('late provider completion cannot update or publish after %s fence changes', async scenario => {
  await withIsolatedPostgres(`ordinary-late-${scenario}`, async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    let submissions = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submissions++;
      const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id;
      if (scenario === 'cancel') expect((await CANCEL(ownedTaskRequest('cancel-task', taskId))).status).toBe(200);
      else await query("UPDATE cloud_tasks SET lease_owner='replacement-worker',lease_expires_at=$1", [Date.now() + 60000]);
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const post = await (await POST(ordinaryRequest())).json();
    expect(post.status).toBe(scenario === 'cancel' ? 'cancelled' : 'processing');
    if (scenario === 'cancel') await CANCEL(ownedTaskRequest('cancel-task', post.taskId));
    const state = await canvasBilling(query);
    expect(submissions).toBe(1);
    expect(state.transactions.map(row => row.type).sort()).toEqual(scenario === 'cancel' ? ['consume', 'refund'] : ['consume']);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    expect(JSON.stringify(state.tasks[0].result)).not.toContain('persistedOutputs":{"');
  });
}, 60_000);

it('uses the frozen effective profile, base and model after settings and price change, with only a current key', async () => {
  await withIsolatedPostgres('ordinary-effective-profile', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true'; boundary.profile = 'apimart';
    const post = await (await POST(ordinaryRequest({ submitOnly: true }))).json();
    boundary.profile = 'openai'; boundary.baseUrl = 'https://changed.invalid'; boundary.apiKey = 'rotated-image-key'; boundary.models = [];
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 99 } })]);
    const observations: unknown[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      observations.push({ url: String(input), body: JSON.parse(String(options?.body)), auth: new Headers(options?.headers).get('authorization') });
      if (String(input) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const result = await (await POLL(ownedTaskRequest('poll-task', post.taskId))).json();
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ url: 'https://provider.invalid/images/generations', body: { model: 'gpt-image-1', size: '1:1' }, auth: 'Bearer rotated-image-key' });
    expect(result.status).toBe('completed'); expect((await canvasBilling(query)).transactions.map(row => row.amount)).toEqual([-7]);
    expect(JSON.stringify(result)).not.toMatch(/rotated-image-key|ordinaryGeneration|grantGeneration/);
    const replay = await (await POST(ordinaryRequest({ submitOnly: true }))).json();
    expect(replay.taskId).toBe(post.taskId); expect(observations).toHaveLength(1);
  });
}, 60_000);

it.each(['transparent', 'opaque'])('verifies actual output alpha without extra regeneration or billing: %s', async alpha => {
  await withIsolatedPostgres(`ordinary-alpha-${alpha}`, async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 100, b: 200, alpha: alpha === 'transparent' ? 0.5 : 1 } } }).png().toBuffer();
    let submits = 0;
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submits++; expect(JSON.parse(String(options.body))).toMatchObject({ background: 'transparent', output_format: 'png' });
      return Response.json({ data: [{ b64_json: png.toString('base64') }] });
    });
    const result = await (await POST(ordinaryRequest({ background: 'transparent', outputFormat: 'png' }))).json();
    expect(result.status).toBe('completed');
    expect(result.alphaVerification?.status).toBe(alpha === 'transparent' ? 'verified' : 'opaque');
    if (alpha === 'opaque') expect(result).toMatchObject({ warning: { code: 'TRANSPARENT_RESULT_NOT_ALPHA' }, nextAction: { requiresConfirmation: true, separatelyBilled: true } });
    expect(submits).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('repairs a definite invalid size in a new recorded attempt without recharging', async () => {
  await withIsolatedPostgres('ordinary-size-repair', async ({ query, databaseUrl, schemaName }) => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName); boundary.baseUrl = 'https://provider.invalid/v1';
    const sizes: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://provider.invalid/v1/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      sizes.push(JSON.parse(String(options.body)).size);
      if (sizes.length === 1) return Response.json({ error: { code: 'invalid_size', message: "Invalid size '1001x1001': size must be divisible by 16" } }, { status: 400 });
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const result = await (await POST(ordinaryRequest())).json();
    expect(result.status).toBe('completed'); expect(sizes).toEqual(['1024x1024', '1008x1008']);
    const task = (await canvasBilling(query)).tasks[0];
    expect((task.result as { ordinaryCheckpoint: { attempts: Array<{ status: string }> } }).ordinaryCheckpoint.attempts.map(attempt => attempt.status)).toEqual(['rejected', 'accepted']);
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it('ordinary CANCEL rolls back refund when its terminal transition fails in real PG', async (): Promise<void> => {
  await withIsolatedPostgres('ordinary-cancel-atomic', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared IO'); });
    const body = await (await POST(ordinaryRequest({ submitOnly: true }))).json();
    expect(body.taskIds).toHaveLength(1);
    await query(`CREATE FUNCTION reject_ordinary_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected terminal write failure'; END $$`);
    await query(`CREATE TRIGGER reject_ordinary_cancel BEFORE UPDATE ON cloud_tasks
      FOR EACH ROW WHEN (NEW.status='cancelled') EXECUTE FUNCTION reject_ordinary_cancel()`);
    expect((await CANCEL(ownedTaskRequest('cancel-task', body.taskId))).status).toBe(500);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='editor'")).rows[0].balance).toBe(93);
    expect((await query("SELECT status FROM cloud_tasks")).rows).toEqual([{ status: 'processing' }]);
    expect((await query("SELECT type FROM wujie_credit_transactions")).rows).toEqual([{ type: 'consume' }]);
  });
}, 60_000);

it('real wrapper POST binds all group slots and advances with SSE connected when after was lost', async (): Promise<void> => {
  await withIsolatedPostgres('ordinary-session-after-lost', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seedOrdinaryGeneration(query, databaseUrl, schemaName);
    process.env.WUJIE_ENABLE_LEGACY_SUBMIT_ONLY_WRAPPER = 'true';
    let submissions = 0;
    const observations: Array<{ tasks: number; consumes: number; publications: number }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://provider.invalid/images/generations' || options?.method !== 'POST') throw new Error('Undeclared IO');
      submissions++;
      const billing = await canvasBilling(query);
      observations.push({ tasks: billing.tasks.length, consumes: billing.transactions.filter(row => row.type === 'consume').length,
        publications: billing.publications.length });
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const scheduled: Array<() => void | Promise<void>> = [];
    let polls = 0;
    const session = createImageGenerationSession({
      submit: async request => (await POST(ordinaryRequest(request))).json(),
      subscribeTaskEvents: () => (): void => {}, isTaskEventsConnected: (): boolean => true,
      cancelTask: async taskId => (await CANCEL(ownedTaskRequest('cancel-task', taskId))).json(),
      restoreTasks: async () => [], extractAssetReferences: extractTaskAssetReferences,
      pollTask: async taskId => { polls++; return { ...(await (await POLL(ownedTaskRequest('poll-task', taskId))).json()), taskId }; },
      schedulePoll: callback => { scheduled.push(callback); return scheduled.length; }, clearScheduledPoll: (): void => {},
    });
    try {
      const slots = await session.submit({ projectId: 'shared', providerId: 'provider', model: 'gpt-image-1', prompt: '蓝色杯子', outputCount: 2 });
      expect(slots.map(slot => slot.status)).toEqual(['processing', 'processing']);
      expect(new Set(slots.map(slot => slot.taskId)).size).toBe(1);
      expect(scheduled).toHaveLength(1);
      expect(submissions).toBe(0);
      expect(boundary.callbacks).toHaveLength(1);
      await scheduled.shift()!();
      expect(polls).toBe(1);
      expect(submissions).toBe(2);
      expect(observations).toEqual([{ tasks: 1, consumes: 1, publications: 1 }, { tasks: 1, consumes: 1, publications: 1 }]);
      expect(session.snapshot().map(slot => slot.status)).toEqual(['completed', 'completed']);
      expect(scheduled).toHaveLength(0);
    } finally { session.dispose(); }
  });
}, 60_000);

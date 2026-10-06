import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
const boundary = vi.hoisted(() => ({ actor: 'editor', source: 'session', throwAfter: false, autoProvider: 'provider', llm: false, deniedNetworkCalls: 0, callbacks: [] as Array<() => Promise<void>> }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(),
  after: (callback: () => Promise<void>): void => { if (boundary.throwAfter) throw new Error('Fixture scheduler unavailable'); boundary.callbacks.push(callback); } }));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async (): Promise<unknown> => ({ userId: boundary.actor, userRole: 'user', source: boundary.source,
    user: { id: boundary.actor, name: boundary.actor, role: 'user', status: 'active', imageModels: ['provider::gpt-image-1'] } }),
  getInternalRequestHeaders: async (): Promise<Record<string, string>> => ({ 'x-test-auth': boundary.actor }),
  getRequestUser: async (): Promise<unknown> => ({ user: { id: boundary.actor, role: 'user', status: 'active' }, userId: boundary.actor, userRole: 'user', source: boundary.source }),
  getTrustedRequestAgentExecutionFence: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: async (): Promise<unknown> => ({ id: boundary.actor }) }));
vi.mock('@/lib/server-api-config', () => {
  const provider = { id: 'provider', name: 'Fixture', modelType: 'image', type: 'image', isEnabled: true, createdAt: 1, updatedAt: 1,
    baseUrl: 'https://provider.invalid', apiKey: 'test-only', selectedModels: ['gpt-image-1'], discoveredModels: [], compatProfile: 'openai' };
  return { findProviderById: async (id: string): Promise<unknown> => ({ ...provider, id }), findProviderForModel: async (): Promise<unknown> => ({ ...provider, id: boundary.autoProvider }),
    findAllProvidersForType: async (): Promise<unknown[]> => [provider], getApiProviders: async (): Promise<unknown[]> => boundary.llm ? [provider] : [],
    normalizeApiBaseUrl: (value: string): string => value };
});
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { seedCanvasEdit, editBody, gate, lockEditAdmission, editDatabaseSnapshot } from '../helpers/canvas-edit-fixture';
import { canvasBilling, moveCanvasSource, loseCanvasCommitReply } from '../helpers/canvas-generation-fixture';
import { POST } from '@/app/api/edit/route';
import { POST as executeAnnotations } from '@/app/api/annotations/execute/route';
import { GET } from '@/app/api/tasks/recover/route';
import { revokeDocumentEditor, grantDocumentEditor } from '@/lib/collaboration/document-access';
import { claimCloudTaskLease, completeCloudTask, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import * as cloudTaskStorage from '@/lib/cloud-task-storage';
import { deleteEditTask, getEditTask, setEditTask } from '@/lib/edit-task-store';
import { abortTaskExecution } from '@/lib/task-core/task-abort';
import { getTaskInfo } from '@/lib/task-registry';
import { getPool } from '@/lib/db-client';
import { assetBinaryFileOps } from '@/lib/asset-core/binary-file-ops';
import { buildNodeExecutionRequest, createWorkflowNode } from '@/lib/workflow-engine';

beforeEach((): void => { boundary.deniedNetworkCalls = 0; vi.stubGlobal('fetch', async (): Promise<never> => { boundary.deniedNetworkCalls++; throw new Error('Unconfigured provider boundary'); }); });

afterEach((): void => { boundary.callbacks = []; boundary.actor = 'editor'; boundary.source = 'session'; boundary.throwAfter = false; boundary.autoProvider = 'provider'; boundary.llm = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function request(body: Record<string, unknown> = editBody(), key: string = 'edit-once', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/edit', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key, ...headers }, body: JSON.stringify(body) });
}

const ANNOTATION_OVERLAY = `data:image/png;base64,${readFileSync('tests/fixtures/annotation-source.png').toString('base64')}`;

// The internal compiler/source tuple must not authorize a different primary image
// in a private project, where document publication's URL guard does not run.
it.each([
  { primary: '/api/serve-upload/second.png', status: 400, projectRow: true },
  { primary: '/api/serve-upload/shared.png', status: 200, projectRow: true },
  { primary: '/api/serve-upload/shared.png', status: 200, projectRow: false },
])('P: private compiled edit binds primary $primary (project row $projectRow) to original source before charging', async ({ primary, status, projectRow }) => {
  await withIsolatedPostgres('annotation_private_primary', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    if (projectRow) await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{
        id: 'private-image', url: '/api/serve-upload/shared.png', annotationVersionId: 'private-v1',
      }],
    }])]);
    const body = { projectId: 'private', image: primary, prompt: 'change cup to blue',
      model: 'gpt-image-1', providerId: 'provider', count: 1, referenceImages: [],
      _annotationReferenceImage: ANNOTATION_OVERLAY,
      _annotationSource: { actorUserId: 'editor', projectId: 'private', imageId: 'private-image',
        imageUrl: '/api/serve-upload/shared.png', versionId: 'private-v1',
        access: { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'private' } },
    };
    const before = await editDatabaseSnapshot(query);
    const response = await POST(request(body, 'annotation-private-primary'));
    expect(response.status).toBe(status);
    if (status === 400) {
      expect(await editDatabaseSnapshot(query)).toEqual(before);
      expect(boundary.callbacks).toHaveLength(0); expect(boundary.deniedNetworkCalls).toBe(0);
      return;
    }
    const { taskId } = await response.json();
    const savedIdentity = (await query('SELECT result FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].result.annotationSourceIdentity;
    expect(savedIdentity).toMatchObject({ version: 1, sourceDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(savedIdentity)).not.toContain('/api/serve-upload/');
    const beforeReplay = await editDatabaseSnapshot(query);
    const replay = await POST(request(body, 'annotation-private-primary'));
    expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ taskId, replayed: true });
    expect(await editDatabaseSnapshot(query)).toEqual(beforeReplay);
    let providerCalls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      const sent = JSON.parse(String(init?.body)) as { images: Array<{ image_url: { url: string } }> };
      expect(sent.images.map(item => item.image_url.url)).toContain(ANNOTATION_OVERLAY);
      providerCalls++;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    expect(boundary.callbacks).toHaveLength(1); await boundary.callbacks.shift()!();
    expect(providerCalls).toBe(1);
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', project_id: 'private', status: 'completed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect((await query('SELECT result FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].result.annotationSourceIdentity).toEqual(savedIdentity);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

function annotationEditBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return editBody({ count: 1, assetWorkspace: 'canvas', assetWorkspaceId: 'shared', referenceImages: [],
    assetSourcePlacementId: 'placement-shared', sourceEntityId: 'image-shared',
    _annotationReferenceImage: ANNOTATION_OVERLAY,
    _annotationSource: { actorUserId: 'editor', projectId: 'shared', imageId: 'image-shared',
      imageUrl: '/api/serve-upload/shared.png', versionId: 'image-shared:asset:version-shared',
      assetId: 'asset-shared', assetVersionId: 'version-shared', placementId: 'placement-shared',
      access: { kind: 'document', actorUserId: 'editor', ownerId: 'owner', projectId: 'shared', grantGeneration: '1' } },
    ...overrides });
}

// Real edit POST and PG admission/worker, with synthetic server-only annotation context.
it.each(['billing-wait', 'dispatch'].flatMap(phase => [
  { phase, change: 'url-and-version', status: 409 },
  { phase, change: 'url', status: 409 },
  { phase, change: 'version', status: 409 },
  { phase, change: 'project-trashed', status: 404 },
  { phase, change: 'actor-disabled', status: 404 },
]))('Q: private original source changed at $phase ($change) cannot be admitted or dispatched', async ({ phase, change, status }) => {
  await withIsolatedPostgres('annotation_private_atomic', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    const project = (url: string, version: string): string => JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image', url, annotationVersionId: version }],
    }]);
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [project('/api/serve-upload/shared.png', 'private-v1')]);
    const body = { projectId: 'private', image: '/api/serve-upload/shared.png', prompt: 'change cup to blue',
      model: 'gpt-image-1', providerId: 'provider', count: 1, referenceImages: [],
      _annotationReferenceImage: ANNOTATION_OVERLAY,
      _annotationSource: { actorUserId: 'editor', projectId: 'private', imageId: 'private-image',
        imageUrl: '/api/serve-upload/shared.png', versionId: 'private-v1',
        access: { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'private' } },
    };
    const changeSource = async (): Promise<void> => {
      if (change === 'project-trashed') {
        await query("UPDATE wujie_projects SET status='trashed' WHERE id='private'"); return;
      }
      if (change === 'actor-disabled') {
        await query("UPDATE wujie_users SET status='disabled' WHERE id='editor'"); return;
      }
      await query("UPDATE wujie_user_data SET data_value=$1::jsonb WHERE user_id='editor' AND data_key='projects'",
        [project(change === 'version' ? '/api/serve-upload/shared.png' : '/api/serve-upload/second.png',
          change === 'url' ? 'private-v1' : 'private-v2')]);
    };
    if (phase === 'billing-wait') {
      const hold = await lockEditAdmission('annotation-private-atomic');
      const pending = POST(request(body, 'annotation-private-atomic'));
      let before: Record<string, unknown> = {};
      try {
        await hold.wait(query); await changeSource(); before = await editDatabaseSnapshot(query);
      } finally { await hold.release(); }
      expect((await pending).status).toBe(status);
      expect(await editDatabaseSnapshot(query)).toEqual(before);
      expect(boundary.callbacks).toHaveLength(0); expect(boundary.deniedNetworkCalls).toBe(0);
      return;
    }
    const response = await POST(request(body, 'annotation-private-atomic'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    await changeSource(); const boundaryProvider = provider();
    await boundary.callbacks.shift()!();
    expect(boundaryProvider.calls()).toBe(0);
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1); expect(state.tasks[0]).toMatchObject({ id: taskId, status: 'failed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.transactions.filter(row => row.type === 'refund').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', 7]]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each(['missing', 'source-digest', 'request-digest'])('R: private persisted identity %s cannot dispatch or refund twice', async corruption => {
  await withIsolatedPostgres('annotation_private_identity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image',
        url: '/api/serve-upload/shared.png', annotationVersionId: 'private-v1' }],
    }])]);
    const body = { projectId: 'private', image: '/api/serve-upload/shared.png', prompt: 'change cup to blue',
      model: 'gpt-image-1', providerId: 'provider', count: 1, referenceImages: [],
      _annotationReferenceImage: ANNOTATION_OVERLAY,
      _annotationSource: { actorUserId: 'editor', projectId: 'private', imageId: 'private-image',
        imageUrl: '/api/serve-upload/shared.png', versionId: 'private-v1',
        access: { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'private' } },
    };
    const response = await POST(request(body, 'annotation-private-identity'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    const originalIdentity = (await query('SELECT result FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].result.annotationSourceIdentity;
    if (corruption === 'missing') {
      await query("UPDATE cloud_tasks SET result=result-'annotationSourceIdentity' WHERE id=$1", [taskId]);
    } else {
      await query(`UPDATE cloud_tasks SET result=result || jsonb_build_object('annotationSourceIdentity',
        jsonb_build_object('version',1,'sourceDigest',$2::text,'requestDigest',$3::text)) WHERE id=$1`,
      [taskId, 'wrong-source', 'wrong-request']);
      // Preserve the other real digest so each case catches only the named corruption.
      if (corruption === 'source-digest') await query(`UPDATE cloud_tasks SET result=jsonb_set(result,
        '{annotationSourceIdentity,requestDigest}',to_jsonb(request_digest)) WHERE id=$1`, [taskId]);
      if (corruption === 'request-digest' && originalIdentity) await query(`UPDATE cloud_tasks SET result=jsonb_set(result,
        '{annotationSourceIdentity,sourceDigest}',$2::jsonb) WHERE id=$1`, [taskId, JSON.stringify(originalIdentity.sourceDigest)]);
    }
    const beforeReplay = await editDatabaseSnapshot(query);
    const replay = await POST(request(body, 'annotation-private-identity'));
    expect(replay.status).toBe(409);
    expect(await editDatabaseSnapshot(query)).toEqual(beforeReplay);
    expect(boundary.callbacks).toHaveLength(1);
    const boundaryProvider = provider(); const worker = boundary.callbacks.shift()!;
    await worker(); await worker();
    expect(boundaryProvider.calls()).toBe(0);
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1); expect(state.tasks[0]).toMatchObject({ id: taskId, status: 'failed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.transactions.filter(row => row.type === 'refund').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', 7]]);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each(['read-fault', 'owner', 'charge-proof', 'task-digest'])('S: private replay/worker %s cannot leak SQL or settle another identity', async fault => {
  await withIsolatedPostgres('annotation_private_fault', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image',
        url: '/api/serve-upload/shared.png', annotationVersionId: 'private-v1' }],
    }])]);
    const body = { projectId: 'private', image: '/api/serve-upload/shared.png', prompt: 'change cup to blue',
      model: 'gpt-image-1', providerId: 'provider', count: 1, referenceImages: [],
      _annotationReferenceImage: ANNOTATION_OVERLAY,
      _annotationSource: { actorUserId: 'editor', projectId: 'private', imageId: 'private-image',
        imageUrl: '/api/serve-upload/shared.png', versionId: 'private-v1',
        access: { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'private' } },
    };
    const response = await POST(request(body, 'annotation-private-fault'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    if (fault === 'read-fault') {
      const before = await editDatabaseSnapshot(query);
      // Inject only the new identity-read boundary; real admission, task and billing stay PG-backed.
      const readFault = vi.spyOn(cloudTaskStorage, 'getCloudTaskById').mockRejectedValueOnce(new Error('SELECT fixture_secret FROM private_credentials'));
      let replay: Response;
      try { replay = await POST(request(body, 'annotation-private-fault')); } finally { readFault.mockRestore(); }
      expect(replay.status).toBe(503);
      expect(await replay.text()).not.toMatch(/SELECT|fixture_secret|private_credentials/);
      expect(await editDatabaseSnapshot(query)).toEqual(before);
      expect(boundary.callbacks).toHaveLength(1); expect(boundary.deniedNetworkCalls).toBe(0);
      return;
    }
    if (fault === 'owner') await query("UPDATE cloud_tasks SET user_id='owner' WHERE id=$1", [taskId]);
    if (fault === 'charge-proof') await query("UPDATE cloud_tasks SET charged_transaction_id='' WHERE id=$1", [taskId]);
    if (fault === 'task-digest') await query("UPDATE cloud_tasks SET request_digest='wrong-task' WHERE id=$1", [taskId]);
    const before = await canvasBilling(query); const boundaryProvider = provider();
    await boundary.callbacks.shift()!();
    expect(boundaryProvider.calls()).toBe(0);
    const state = await canvasBilling(query);
    expect(state.credits).toEqual(before.credits);
    expect(state.transactions).toEqual(before.transactions);
    expect(state.tasks[0]).toMatchObject({ id: taskId, status: 'processing', credit_status: 'pending' });
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each(['new-read-fault', 'zero-price', 'owner-changed-during-provider'])('T: private guarded task retains %s billing/settlement compatibility', async scenario => {
  await withIsolatedPostgres('annotation_private_guard_control', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image',
        url: '/api/serve-upload/shared.png', annotationVersionId: 'private-v1' }],
    }])]);
    if (scenario === 'zero-price') await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 0 } })]);
    const body = { projectId: 'private', image: '/api/serve-upload/shared.png', prompt: 'change cup to blue',
      model: 'gpt-image-1', providerId: 'provider', count: 1, referenceImages: [],
      _annotationReferenceImage: ANNOTATION_OVERLAY,
      _annotationSource: { actorUserId: 'editor', projectId: 'private', imageId: 'private-image',
        imageUrl: '/api/serve-upload/shared.png', versionId: 'private-v1',
        access: { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'private' } },
    };
    const newReadFault = scenario === 'new-read-fault'
      ? vi.spyOn(cloudTaskStorage, 'getCloudTaskById').mockRejectedValueOnce(new Error('SELECT new_task_read_secret')) : undefined;
    let response: Response;
    try { response = await POST(request(body, 'annotation-private-guard-control')); }
    finally { newReadFault?.mockRestore(); }
    expect(response.status).toBe(200); const { taskId } = await response.json();
    const before = await canvasBilling(query);
    let calls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid'); calls++;
      if (scenario === 'owner-changed-during-provider') {
        await query("UPDATE cloud_tasks SET user_id='owner' WHERE id=$1", [taskId]);
        return Response.json({ error: { message: 'Fixture denied edit' } }, { status: 401 });
      }
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    await boundary.callbacks.shift()!(); expect(calls).toBe(1);
    const state = await canvasBilling(query);
    if (scenario === 'owner-changed-during-provider') {
      expect(state.credits).toEqual(before.credits); expect(state.transactions).toEqual(before.transactions);
      expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'owner', status: 'processing', credit_status: 'pending' });
    } else {
      expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', status: 'completed' });
      expect(state.transactions.filter(row => row.type === 'consume')).toHaveLength(scenario === 'zero-price' ? 0 : 1);
      expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    }
  });
}, 60_000);

it('U: private normal v1 network failure still reaches the existing flattened retry', async () => {
  await withIsolatedPostgres('annotation_private_flat_retry', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image',
        url: '/api/serve-upload/shared.png', annotationVersionId: 'private-v1' }],
    }])]);
    const body = { projectId: 'private', image: '/api/serve-upload/shared.png', prompt: 'change cup to blue',
      model: 'gpt-image-1', providerId: 'provider', count: 1, referenceImages: [],
      _annotationReferenceImage: ANNOTATION_OVERLAY,
      _annotationSource: { actorUserId: 'editor', projectId: 'private', imageId: 'private-image',
        imageUrl: '/api/serve-upload/shared.png', versionId: 'private-v1',
        access: { kind: 'personal', actorUserId: 'editor', ownerId: 'editor', projectId: 'private' } },
    };
    const response = await POST(request(body, 'annotation-private-flat-retry'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    const calls: Array<{ path: string; flat: boolean }> = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      const payload: Record<string, unknown> = JSON.parse(String(init?.body || '{}'));
      calls.push({ path: target.pathname, flat: Array.isArray(payload.image_urls) });
      if (target.pathname === '/v1/images/generations') throw new TypeError('Fixture normal network failure');
      if (target.pathname === '/images/generations') {
        if (Array.isArray(payload.image_urls)) return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
        return Response.json({ error: { message: 'image_url required' } }, { status: 400 });
      }
      return Response.json({ error: { message: 'Fixture chat cannot edit this image' } }, { status: 401 });
    });
    await boundary.callbacks.shift()!();
    expect(calls).toEqual([
      { path: '/images/generations', flat: false },
      { path: '/v1/images/generations', flat: false },
      { path: '/images/generations', flat: true },
    ]);
    const state = await canvasBilling(query);
    expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', status: 'completed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

// Real upstream execution, with state changed only after outer source validation.
// Removing status propagation must fail while real admission still rejects with zero side effects.
it.each([
  { change: 'version', status: 409, code: 'ANNOTATION_SOURCE_STALE' },
  { change: 'project', status: 403, code: 'GENERATION_PROJECT_FORBIDDEN' },
  { change: 'source-missing', status: 404, code: 'ANNOTATION_PROJECT_NOT_FOUND' },
  { change: 'credits', status: 402, code: 'INSUFFICIENT_CREDITS' },
])('V: annotation downstream $change rejection retains $status through real upstream execution', async ({ change, status, code }) => {
  await withIsolatedPostgres('annotation_downstream_error', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_users SET image_models=ARRAY['provider::gpt-image-1'] WHERE id='editor'");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    const projects = [{ id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image',
      url: '/api/serve-upload/shared.png', annotationVersionId: 'private-v1' }] }];
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify(projects)]);
    let internalCalls = 0; let providerCalls = 0; let downstreamStatus = 0; let downstreamPayload: unknown;
    let beforeAdmission: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      if (target.pathname !== '/api/edit') { providerCalls++; throw new Error('Unexpected provider submission'); }
      internalCalls++; boundary.source = 'internal';
      if (change === 'version') {
        projects[0].canvasImages[0].annotationVersionId = 'private-v2';
        await query("UPDATE wujie_user_data SET data_value=$1::jsonb WHERE user_id='editor' AND data_key='projects'", [JSON.stringify(projects)]);
      } else if (change === 'project') {
        await query("UPDATE wujie_projects SET status='trashed' WHERE id='private'");
      } else if (change === 'source-missing') {
        projects[0].canvasImages.splice(0);
        await query("UPDATE wujie_user_data SET data_value=$1::jsonb WHERE user_id='editor' AND data_key='projects'", [JSON.stringify(projects)]);
      } else {
        await query("UPDATE wujie_credits SET balance=0 WHERE user_id='editor'");
      }
      beforeAdmission = await editDatabaseSnapshot(query);
      const downstream = await POST(new NextRequest('http://localhost/api/edit', { ...init, signal: init?.signal ?? undefined }));
      downstreamStatus = downstream.status;
      downstreamPayload = await downstream.clone().json();
      return downstream;
    });
    const annotation = { id: 'private-text', projectId: 'private', sourceImageId: 'private-image',
      sourceVersionId: 'private-v1', type: 'text', geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } },
      instruction: 'change cup to blue', status: 'ready', createdAt: 1, updatedAt: 1 };
    const response = await executeAnnotations(new NextRequest('http://localhost/api/annotations/execute', {
      method: 'POST', headers: { 'x-request-id': 'downstream-request' }, body: JSON.stringify({ bundle: {
        id: 'private-error-bundle', projectId: 'private', sourceImageId: 'private-image', sourceVersionId: 'private-v1',
        annotationIds: ['private-text'], annotations: [annotation], prompt: 'change cup to blue', modelId: 'gpt-image-1',
        providerId: 'provider', idempotencyKey: 'private-downstream-error', createdAt: 1,
      } }),
    }));
    expect(downstreamStatus).toBe(status);
    expect(downstreamPayload).toMatchObject({ success: false, code });
    // Check side effects before the upstream status assertion, including on the RED run.
    expect(beforeAdmission).toBeDefined();
    expect(await editDatabaseSnapshot(query)).toEqual(beforeAdmission);
    expect(internalCalls).toBe(1); expect(providerCalls).toBe(0); expect(boundary.callbacks).toHaveLength(0);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ success: false, code, requestId: 'downstream-request', retryable: false });
  });
}, 60_000);

// Actual execute->compiler->executor->edit, not a direct synthetic internal POST.
it.each(['', '?signature=fixture'])('P: private absolute source%s retains authority identity through real annotation execution', async suffix => {
  await withIsolatedPostgres('annotation_private_absolute', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_users SET image_models=ARRAY['provider::gpt-image-1'] WHERE id='editor'");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('private','editor','Private')");
    const originalUrl = `http://localhost/api/serve-upload/shared.png${suffix}`;
    await query(`INSERT INTO wujie_user_data(user_id,data_key,data_value,updated_at)
      VALUES ('editor','projects',$1::jsonb,1)`, [JSON.stringify([{
      id: 'private', userId: 'editor', canvasImages: [{ id: 'private-image', url: originalUrl, annotationVersionId: 'private-v1' }],
    }])]);
    let internalCalls = 0; let providerCalls = 0; let primary = ''; let overlay = '';
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      if (target.pathname === '/api/edit') {
        const forwarded = JSON.parse(String(init?.body)) as Record<string, unknown>;
        primary = String(forwarded.image); overlay = String(forwarded._annotationReferenceImage);
        internalCalls++; boundary.source = 'internal';
        return POST(new NextRequest('http://localhost/api/edit', { ...init, signal: init?.signal ?? undefined }));
      }
      expect(target.hostname).toBe('provider.invalid');
      expect(JSON.stringify(JSON.parse(String(init?.body)))).toContain(overlay);
      providerCalls++;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const annotation = { id: 'private-text', projectId: 'private', sourceImageId: 'private-image',
      sourceVersionId: 'private-v1', type: 'text', geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } },
      instruction: 'change cup to blue', status: 'ready', createdAt: 1, updatedAt: 1 };
    const response = await executeAnnotations(new NextRequest('http://localhost/api/annotations/execute', {
      method: 'POST', body: JSON.stringify({ bundle: {
        id: 'private-absolute-bundle', projectId: 'private', sourceImageId: 'private-image', sourceVersionId: 'private-v1',
        annotationIds: ['private-text'], annotations: [annotation], prompt: 'change cup to blue', modelId: 'gpt-image-1',
        providerId: 'provider', idempotencyKey: 'private-absolute-execute', createdAt: 1,
      } }),
    }));
    expect(response.status).toBe(202);
    expect(primary).toBe(originalUrl);
    const { taskId } = await response.json();
    expect(internalCalls).toBe(1); expect(boundary.callbacks).toHaveLength(1);
    await boundary.callbacks.shift()!(); expect(providerCalls).toBe(1);
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', project_id: 'private', status: 'completed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it('N: real annotation POST and compiler flow through real executor/edit/task/billing/canonical publication', async () => {
  await withIsolatedPostgres('annotation_edit_full_handoff', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_users SET image_models=ARRAY['provider::gpt-image-1'] WHERE id='editor'");
    let compiledOverlay = ''; let internalCalls = 0; let providerCalls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      if (target.pathname === '/api/edit') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        compiledOverlay = String(body._annotationReferenceImage);
        expect(body).toMatchObject({ projectId: 'shared', assetParentVersionIds: ['version-shared'],
          referenceImages: [], _annotationSource: { actorUserId: 'editor', placementId: 'placement-shared',
            access: { ownerId: 'owner', grantGeneration: '1' } } });
        expect(compiledOverlay).toMatch(/^data:image\/png;base64,/);
        internalCalls++; boundary.source = 'internal';
        return POST(new NextRequest('http://localhost/api/edit', { ...init, signal: init?.signal ?? undefined }));
      }
      expect(target.hostname).toBe('provider.invalid');
      const body = JSON.parse(String(init?.body)) as { images: Array<{ image_url: { url: string } }> };
      expect(body.images.map(item => item.image_url.url)).toContain(compiledOverlay);
      providerCalls++;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const annotation = { id: 'text-a', projectId: 'shared', sourceImageId: 'image-shared',
      sourceVersionId: 'image-shared:asset:version-shared', type: 'text', geometry: { kind: 'text', point: { x: 0.5, y: 0.5 } },
      instruction: 'change cup to blue', status: 'ready', createdAt: 1, updatedAt: 1 };
    const response = await executeAnnotations(new NextRequest('http://localhost/api/annotations/execute', {
      method: 'POST', body: JSON.stringify({ sourceImageUrl: '/api/serve-upload/client-forgery.png', bundle: {
        id: 'bundle-a', projectId: 'shared', sourceImageId: 'image-shared', sourceVersionId: annotation.sourceVersionId,
        annotationIds: ['text-a'], annotations: [annotation], prompt: 'change cup to blue', modelId: 'gpt-image-1',
        providerId: 'provider', idempotencyKey: 'annotation-full-handoff', createdAt: 1 } }),
    }));
    expect(response.status).toBe(202); const { taskId } = await response.json();
    expect(internalCalls).toBe(1); await boundary.callbacks.shift()!(); expect(providerCalls).toBe(1);
    const state = await canvasBilling(query);
    expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', project_id: 'shared', status: 'completed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);

// Removing the internal-only admission must expose a real task/charge; no billing or authorization doubles.
it.each(['both', 'overlay-only', 'source-only'])('N: external %s compiled-field spoof rejects with whole schema unchanged', async field => {
  await withIsolatedPostgres('annotation_edit_external', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const body = annotationEditBody();
    if (field === 'overlay-only') delete body._annotationSource;
    if (field === 'source-only') delete body._annotationReferenceImage;
    const before = await editDatabaseSnapshot(query);
    const response = await POST(request(body, `annotation-external-${field}`));
    expect(response.status).toBe(400);
    expect(boundary.callbacks).toHaveLength(0); expect(boundary.deniedNetworkCalls).toBe(0);
    expect(await editDatabaseSnapshot(query)).toEqual(before);
  });
}, 60_000);

it('N: internal invalid compiled PNG rejects before a personal charge or worker', async () => {
  await withIsolatedPostgres('annotation_edit_bad_png', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const before = await canvasBilling(query);
    expect((await POST(request(annotationEditBody({ _annotationReferenceImage: 'data:image/png;base64,AAAA' })))).status).toBe(400);
    expect(await canvasBilling(query)).toEqual(before); expect(boundary.callbacks).toHaveLength(0);
    expect(boundary.deniedNetworkCalls).toBe(0);
  });
}, 60_000);

it('N: regranted editor cannot charge using an old compiled source grant', async () => {
  await withIsolatedPostgres('annotation_edit_old_grant', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor');
    const before = await canvasBilling(query);
    expect((await POST(request(annotationEditBody()))).status).toBe(409);
    expect(await canvasBilling(query)).toEqual(before); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it('N: registered legacy image without MIME still supports the compiled annotation edit', async () => {
  await withIsolatedPostgres('annotation_edit_null_mime', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    const response = await POST(request(annotationEditBody(), 'annotation-null-mime'));
    expect(response.status).toBe(200);
    const { taskId } = await response.json(); provider(); await boundary.callbacks.shift()!();
    expect((await canvasBilling(query)).tasks[0]).toMatchObject({ id: taskId, status: 'completed' });
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);

// NULL MIME alone is compatible after a real, read-only byte proof. Invalid
// registered metadata must still reject before any task, charge or dispatch.
it.each(['checksum', 'dimensions', 'byte-size'] as const)(
  'N: missing-MIME annotation source with invalid $0 rejects before billing', async invalid => {
  await withIsolatedPostgres('annotation_edit_missing_mime_gate', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    await query("UPDATE wujie_asset_versions SET mime_type=NULL WHERE id='version-shared'");
    if (invalid === 'checksum') await query("UPDATE wujie_asset_versions SET checksum=$1 WHERE id='version-shared'", ['0'.repeat(64)]);
    if (invalid === 'dimensions') await query("UPDATE wujie_asset_versions SET width=3 WHERE id='version-shared'");
    if (invalid === 'byte-size') await query("UPDATE wujie_asset_versions SET byte_size=NULL WHERE id='version-shared'");
    const before = await editDatabaseSnapshot(query);
    const response = await POST(request(annotationEditBody(), `annotation-missing-mime-${invalid}`));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'ANNOTATION_SOURCE_STALE' });
    expect(await editDatabaseSnapshot(query)).toEqual(before);
    expect(boundary.callbacks).toHaveLength(0); expect(boundary.deniedNetworkCalls).toBe(0);
  });
}, 60_000);

it.each([200, 400])('N: annotation fallback after chat HTTP %s must not submit a text-only generation', async chatStatus => {
  await withIsolatedPostgres('annotation_edit_reference_fallback', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const response = await POST(request(annotationEditBody(), 'annotation-reference-fallback'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    let textOnlyCalls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (target.pathname.endsWith('/chat/completions')) {
        expect(JSON.stringify(sent.messages)).toContain(ANNOTATION_OVERLAY);
        return chatStatus === 200
          ? Response.json({ choices: [{ message: { content: 'No edited image available' } }] })
          : Response.json({ error: { message: 'Fixture bad image request' } }, { status: 400 });
      }
      if (!sent.images && !sent.image_urls && !sent.image) {
        textOnlyCalls++;
        return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
      }
      expect(JSON.stringify(sent)).toContain(ANNOTATION_OVERLAY);
      return Response.json({ error: { message: 'Fixture visual generation unavailable' } }, { status: 503 });
    });
    await boundary.callbacks.shift()!();
    expect(textOnlyCalls).toBe(0);
    const state = await canvasBilling(query);
    expect(state.tasks[0]).toMatchObject({ id: taskId, status: 'failed' });
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it('N: changing the source entity during annotation model I/O cannot publish a stale canonical result', async () => {
  await withIsolatedPostgres('annotation_edit_late_entity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const response = await POST(request(annotationEditBody(), 'annotation-late-entity'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    const providerGate = gate();
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      providerGate.enter(); await providerGate.released;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const worker = boundary.callbacks.shift()!();
    try {
      await providerGate.reached;
      await query("UPDATE wujie_workspace_placements SET entity_id='changed-source-entity' WHERE id='placement-shared'");
    } finally { providerGate.release(); }
    await worker;
    expect((await canvasBilling(query)).tasks[0]).toMatchObject({ id: taskId, status: 'completed' });
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

// The same version ID may acquire repaired media metadata. Admission identity must
// survive model I/O in SQL, rather than being recaptured from that newer version.
it.each(['file_url', 'checksum'])('N: changed admitted annotation %s during model I/O cannot publish, including durable recovery', async field => {
  await withIsolatedPostgres('annotation_edit_late_media', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const response = await POST(request(annotationEditBody(), `annotation-late-${field}`));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    const original = (await query("SELECT file_url,checksum FROM wujie_asset_versions WHERE id='version-shared'")).rows[0];
    const providerGate = gate();
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      providerGate.enter(); await providerGate.released;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    const worker = boundary.callbacks.shift()!();
    try {
      await providerGate.reached;
      if (field === 'file_url') await query("UPDATE wujie_asset_versions SET file_url='/api/serve-upload/second.png' WHERE id='version-shared'");
      else await query("UPDATE wujie_asset_versions SET checksum=$1 WHERE id='version-shared'", ['a'.repeat(64)]);
    } finally { providerGate.release(); }
    await worker;
    expect((await canvasBilling(query)).tasks[0]).toMatchObject({ id: taskId, status: 'completed' });
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    const changedBilling = await canvasBilling(query);
    // Lose process-local task state, then exercise the existing owned recovery API.
    deleteEditTask(taskId);
    expect((await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).status).toBe(200);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    const retryBilling = await canvasBilling(query);
    expect(retryBilling.transactions).toEqual(changedBilling.transactions);
    expect(retryBilling.credits).toEqual(changedBilling.credits);
    expect(retryBilling.publications).toEqual(changedBilling.publications);
    expect(retryBilling.tasks[0]).toMatchObject({ id: taskId, status: 'completed',
      result: { image: { url: '/api/serve-upload/second.png' }, assetProjection: { status: 'projection_pending' } } });
    // Restoring the exact admitted metadata permits original recovery once, not a
    // new task/charge or a fresh snapshot accepting the changed source.
    await query("UPDATE wujie_asset_versions SET file_url=$1,checksum=$2 WHERE id='version-shared'", [original.file_url, original.checksum]);
    expect((await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).status).toBe(200);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    const recoveredBilling = await canvasBilling(query);
    expect(recoveredBilling.transactions).toEqual(changedBilling.transactions);
    expect(recoveredBilling.credits).toEqual(changedBilling.credits);
    expect(recoveredBilling.publications).toEqual(changedBilling.publications);
    expect(recoveredBilling.tasks.map(task => task.id)).toEqual([taskId]);
    expect((await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).status).toBe(200);
    expect(await canvasBilling(query)).toEqual(recoveredBilling);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);

it('N: changed admitted annotation checksum before dispatch rejects without a provider call', async () => {
  await withIsolatedPostgres('annotation_edit_dispatch_media', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const response = await POST(request(annotationEditBody(), 'annotation-dispatch-checksum'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    await query("UPDATE wujie_asset_versions SET checksum=$1 WHERE id='version-shared'", ['b'.repeat(64)]);
    const beforeReplay = await editDatabaseSnapshot(query);
    expect((await POST(request(annotationEditBody(), 'annotation-dispatch-checksum'))).status).toBe(409);
    expect(await editDatabaseSnapshot(query)).toEqual(beforeReplay);
    expect(boundary.callbacks).toHaveLength(1);
    expect(boundary.deniedNetworkCalls).toBe(0);
    const network = provider();
    await boundary.callbacks.shift()!();
    expect(network.calls()).toBe(0);
    const state = await canvasBilling(query);
    expect(state.tasks[0]).toMatchObject({ id: taskId, status: 'failed' });
    expect(state.transactions.filter(row => row.type === 'consume')).toHaveLength(1);
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

// Cover the independent post-publication-preflight I/O window, including an
// unchanged positive control. Actual staging bytes and final SQL stay real.
it.each([{ change: false }, { change: true }])('N: source checksum changed=$change during publication media staging respects final import', async ({ change }) => {
  await withIsolatedPostgres('annotation_edit_final_media', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const response = await POST(request(annotationEditBody(), 'annotation-final-media'));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    provider();
    const staging = gate(); const write = assetBinaryFileOps.writeFile; let held = false;
    vi.spyOn(assetBinaryFileOps, 'writeFile').mockImplementation(async (...args: Parameters<typeof write>): Promise<void> => {
      await write(...args);
      if (!held) { held = true; staging.enter(); await staging.released; }
    });
    const worker = boundary.callbacks.shift()!();
    try {
      await staging.reached;
      expect((await canvasBilling(query)).tasks[0]).toMatchObject({ id: taskId, status: 'completed' });
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
      if (change) await query("UPDATE wujie_asset_versions SET checksum=$1 WHERE id='version-shared'", ['c'.repeat(64)]);
    } finally { staging.release(); }
    await worker;
    const state = await canvasBilling(query);
    expect(state.tasks.map(task => [task.id, task.status])).toEqual([[taskId, 'completed']]);
    expect(state.transactions.filter(row => row.type === 'consume')).toHaveLength(1);
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(change ? 0 : 1);
    expect((await query('SELECT * FROM wujie_asset_versions')).rows).toHaveLength(change ? 2 : 3);
  });
}, 60_000);

it.each([{ mask: false }, { mask: true }])('N: mask=$mask compiled overlay reaches actual provider, bills editor once and publishes one canonical result', async ({ mask }) => {
  await withIsolatedPostgres('annotation_edit_finish', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const maskPng = `data:image/png;base64,${readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')).toString('base64')}`;
    const body = annotationEditBody(mask ? { mask: maskPng } : {});
    const first = await POST(request(body, 'annotation-finish')); expect(first.status).toBe(200);
    const { taskId } = await first.json();
    let calls = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid'); expect(target.pathname).toMatch(/\/images\/generations$/);
      const sent = JSON.parse(String(init?.body)) as { model: string; images: Array<{ image_url: { url: string } }> };
      expect(sent.model).toBe('gpt-image-1'); expect(sent.images.map(item => item.image_url.url)).toContain(ANNOTATION_OVERLAY);
      calls++;
      return Response.json({ data: [{ url: '/api/serve-upload/second.png' }] });
    });
    await boundary.callbacks.shift()!();
    expect(calls).toBe(1);
    const state = await canvasBilling(query);
    expect(state.tasks[0]).toMatchObject({ id: taskId, user_id: 'editor', project_id: 'shared', status: 'completed' });
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    expect(state.publications[0]).toMatchObject({ actor_id: 'editor', owner_id: 'owner', grant_generation: '1' });
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
    const replay = await POST(request(body, 'annotation-finish')); expect(replay.status).toBe(200);
    expect((await replay.json()).taskId).toBe(taskId); expect(await canvasBilling(query)).toEqual(state);
    const changed = annotationEditBody({ _annotationReferenceImage: `data:image/png;base64,${readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png')).toString('base64')}` });
    expect((await POST(request(changed, 'annotation-finish'))).status).toBe(409);
    expect(await canvasBilling(query)).toEqual(state); expect(calls).toBe(1);
  });
}, 60_000);

it.each(['regrant', 'entity-change'])('N: %s while atomic billing waits cannot admit the compiled old source', async change => {
  await withIsolatedPostgres('annotation_edit_atomic_fence', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    const lock = await lockEditAdmission('annotation-atomic'); const running = POST(request(annotationEditBody(), 'annotation-atomic'));
    let before: Awaited<ReturnType<typeof canvasBilling>>;
    try {
      await lock.wait(query);
      if (change === 'regrant') {
        await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor');
      } else await query("UPDATE wujie_workspace_placements SET entity_id='replacement-entity' WHERE id='placement-shared'");
      before = await canvasBilling(query);
    } finally { await lock.release(); }
    expect([403, 409]).toContain((await running).status);
    expect(await canvasBilling(query)).toEqual(before!); expect(boundary.callbacks).toHaveLength(0);
    expect(boundary.deniedNetworkCalls).toBe(0);
  });
}, 60_000);

// Catches missing atomic publication: real task and charge must already exist before the intent assertion.
it('A: POST atomically freezes editor intent alongside exactly one personal charge', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_post_first', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: result.taskId, type: 'edit', user_id: 'editor' });
    expect(state.credits.map(row => [row.user_id, Number(row.balance)])).toEqual([['editor', 93], ['owner', 100]]);
    expect(state.transactions.filter(row => row.type === 'consume').map(row => [row.user_id, Number(row.amount)])).toEqual([['editor', -7]]);
    console.info('BUSINESS RED checkpoint: real task=1; editor=93; owner=100; consumes=1; publication=', state.publications.length);
    expect(state.publications).toHaveLength(1);
    expect(state.publications[0]).toMatchObject({ actor_id: 'editor', owner_id: 'owner', grant_generation: '1',
      publication_intent: { placement: { transform: { x: 132 } } } });
  });
}, 60_000);

it.each([{ mode: 'derived', count: 1 }, { mode: 'revision', count: 1 }, { mode: 'derived', count: 2 }])('A: real $mode $count output finish and GET append canonical results without replacing source', async ({ mode, count }) => {
  await withIsolatedPostgres('task8cb3g_finish', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const source = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'));
    const placement = (await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-shared'")).rows;
    const response = await POST(request(editBody({ assetProjectionMode: mode, count })));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    const network = provider(undefined, count);
    for (const callback of boundary.callbacks.splice(0)) await callback();
    expect(network.calls()).toBe(1);
    const commands = (await query('SELECT * FROM wujie_canvas_asset_commands ORDER BY document_sequence')).rows;
    expect(commands).toHaveLength(count);
    const versions = (await query('SELECT v.* FROM wujie_asset_versions v JOIN wujie_canvas_media_lineage i ON i.target_version_id=v.id WHERE v.task_id=$1 ORDER BY i.output_index', [taskId])).rows;
    expect(versions).toHaveLength(count); expect(versions.map(value => value.owner_id)).toEqual(Array(count).fill('owner'));
    if (mode === 'revision') expect(versions[0].asset_id).toBe('asset-shared');
    else expect(versions.every(value => value.asset_id !== 'asset-shared')).toBe(true);
    const projection = (await query('SELECT projection FROM wujie_project_canvas_documents')).rows[0].projection;
    expect(commands.map(value => projection.placements[value.placement_id].x)).toEqual(count === 1 ? [132] : [132, 264]);
    expect(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png'))).toEqual(source);
    expect((await query("SELECT * FROM wujie_workspace_placements WHERE id='placement-shared'")).rows).toEqual(placement);
    const before = await canvasBilling(query);
    for (let index = 0; index < 2; index++) {
      const recovered = await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
      expect(recovered.status).toBe(200);
      expect((await recovered.json()).tasks[0].result.assetProjection.references).toHaveLength(count);
    }
    expect(await canvasBilling(query)).toEqual(before);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(count);
  });
}, 60_000);

it.each([
  { label: 'no parents', changes: { assetParentVersionIds: undefined }, status: 400 },
  { label: 'duplicate parents', changes: { assetParentVersionIds: ['version-shared', 'version-shared'] }, status: 400 },
  { label: 'wrong primary', changes: { image: '/api/serve-upload/second.png' }, status: 403 },
  { label: 'missing reference', changes: { assetParentVersionIds: ['version-shared', 'version-second'] }, status: 403 },
  { label: 'blank reference', changes: { assetParentVersionIds: ['version-shared', 'version-second'], referenceImages: [''] }, status: 400 },
  { label: 'external primary', changes: { image: 'https://elsewhere.invalid/shared.png' }, status: 400 },
  { label: 'protocol relative', changes: { image: '//localhost/api/serve-upload/shared.png' }, status: 400 },
  { label: 'backslash', changes: { image: '/api\\serve-upload/shared.png' }, status: 400 },
  { label: 'fragment', changes: { image: '/api/serve-upload/shared.png#x' }, status: 400 },
  { label: 'credentials', changes: { image: 'http://user:pass@localhost/api/serve-upload/shared.png' }, status: 400 },
  { label: 'data', changes: { image: 'data:image/png;base64,AAAA' }, status: 400 },
  { label: 'workspace mismatch', changes: { assetWorkspaceId: 'other' }, status: 400 },
  { label: 'null workspace', changes: { assetWorkspaceId: null }, status: 400 },
  { label: 'null mode', changes: { assetProjectionMode: null }, status: 400 },
  { label: 'null selection', changes: { assetSelectedEntityIds: null }, status: 400 },
  { label: 'invalid URL', changes: { image: 'http://[' }, status: 400 },
  { label: 'invalid mode', changes: { assetProjectionMode: 'replace' }, status: 400 },
  { label: 'skip credits', changes: { _skipCredits: true }, status: 400 },
  { label: 'skip persistence', changes: { _skipCloudTaskPersistence: true }, status: 400 },
])('B: invalid $label rejects before task charge media or scheduling', async ({ changes, status }) => {
  await withIsolatedPostgres('task8cb3g_sources', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const before = await canvasBilling(query); let io = 0;
    const reads = vi.spyOn(fsPromises, 'readFile'); // observation only; original filesystem reads remain real
    vi.stubGlobal('fetch', async (): Promise<never> => { io++; throw new Error('Forbidden boundary reached'); });
    expect((await POST(request(editBody(changes)))).status).toBe(status);
    expect(io).toBe(0); expect(reads.mock.calls).toHaveLength(0); expect(boundary.callbacks).toHaveLength(0); expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

it.each(['ai-edit', 'ai-color-adjust'] as const)('B: %s workflow request without a parent version cannot charge a document project', async type => {
  await withIsolatedPostgres('task8cb3g_workflow_edit', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const node = createWorkflowNode(type, 0, 0);
    node.config.imageUrl = '/api/serve-upload/shared.png';
    node.config.prompt = 'Make the sky blue';
    node.config.model = 'provider::gpt-image-1';
    const built = buildNodeExecutionRequest(node, {});
    expect(built?.endpoint).toBe('/api/edit');
    const before = await canvasBilling(query);
    const response = await POST(request({
      ...built!.body,
      projectId: 'shared',
      sessionId: 'workflow:shared',
      messageId: `workflow-test:${node.id}`,
    }, `workflow-edit-${type}`));
    expect(response.status).toBe(400);
    expect(boundary.callbacks).toHaveLength(0);
    expect(boundary.deniedNetworkCalls).toBe(0);
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

it.each(['presence', 'owner', 'actor', 'archive', 'disable', 'global', 'nonimage', 'unavailable', 'foreign', 'cross-project', 'cross-owner'])('B: real %s denial has no task or charge', async scenario => {
  await withIsolatedPostgres('task8cb3g_forbidden', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    if (scenario === 'presence') await revokeDocumentEditor('owner', 'shared', 'editor');
    if (scenario === 'owner' || scenario === 'actor') await query("UPDATE wujie_users SET status='disabled' WHERE id=$1", [scenario === 'actor' ? 'editor' : 'owner']);
    if (scenario === 'archive') await query("UPDATE wujie_projects SET status='trashed'");
    if (scenario === 'disable') await query('UPDATE wujie_project_document_settings SET enabled=false');
    if (scenario === 'global') process.env.WUJIE_YJS_ENABLED = 'false';
    if (scenario === 'nonimage') await query("UPDATE wujie_assets SET kind='video'");
    if (scenario === 'unavailable') await query("UPDATE wujie_asset_versions SET availability='missing'");
    if (['foreign', 'cross-project', 'cross-owner'].includes(scenario)) {
      const owner = scenario === 'cross-owner' ? 'editor' : 'owner';
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('foreign',$1,'Other real project')", [owner]);
      await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-foreign',$1,'foreign','image')", [owner]);
      await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size,checksum,width,height)
        SELECT 'version-foreign','asset-foreign',$1,'foreign',file_url,mime_type,byte_size,checksum,width,height
        FROM wujie_asset_versions WHERE id='version-shared'`, [owner]);
      await query("UPDATE wujie_assets SET current_version_id='version-foreign' WHERE id='asset-foreign'");
      await query(`INSERT INTO wujie_workspace_placements
        (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
        VALUES ('placement-foreign',$1,'foreign','asset-foreign','version-foreign','canvas','foreign','canvas-image','image-foreign')`, [owner]);
    }
    const before = await canvasBilling(query);
    const reads = vi.spyOn(fsPromises, 'readFile');
    const response = await POST(request(editBody({ ...(scenario === 'foreign' ? { projectId: 'foreign' } : {}),
      ...(scenario.startsWith('cross-') ? { assetParentVersionIds: ['version-foreign'] } : {}), ownerId: 'editor', grantGeneration: '999' })));
    expect(response.status).toBe(403); expect(boundary.callbacks).toHaveLength(0); expect(await canvasBilling(query)).toEqual(before);
    expect(reads.mock.calls).toHaveLength(0); expect(boundary.deniedNetworkCalls).toBe(0);
  });
}, 60_000);

it('D: POST recovers real lost COMMIT ACK using original key and exactly one worker', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_post_ack', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    // Front-door read commits, source-context read commits, then the real billing transaction commits.
    const proxy = await loseCanvasCommitReply(databaseUrl, 3);
    try { expect((await POST(request())).status).toBe(503); expect(proxy.dropped()).toBe(true); }
    finally { await proxy.close(); }
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(1); expect(state.tasks[0].status).toBe('processing');
    expect(state.transactions).toHaveLength(1); expect(state.publications).toHaveLength(1); expect(boundary.callbacks).toHaveLength(0);
    const retry = await POST(request()); expect(retry.status).toBe(200); expect((await retry.json()).taskId).toBe(state.tasks[0].id);
    const network = provider(); await Promise.all(boundary.callbacks.splice(0).map(callback => callback()));
    expect(network.calls()).toBe(1); expect((await canvasBilling(query)).transactions).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);

it.each(['failed', 'cancelled', 'timeout'])('E: %s and late success settle at most once without shared output', async terminal => {
  await withIsolatedPostgres('task8cb3g_terminal_race', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const { taskId } = await (await POST(request())).json();
    const hold = gate(); provider(hold, 1, terminal === 'failed');
    const running = boundary.callbacks.shift()!(); await hold.reached;
    try {
      if (terminal === 'cancelled') await terminateCloudTaskAndRefund(taskId, 'cancelled', 'Explicit user cancellation');
      if (terminal === 'timeout') { const error = new Error('Execution deadline elapsed'); error.name = 'TimeoutError'; abortTaskExecution(taskId, error); }
      hold.release(); await running;
      const state = await canvasBilling(query);
      expect(state.tasks[0].status).toBe(terminal);
      expect(state.transactions.filter(value => value.type === 'refund')).toHaveLength(1);
      expect(state.credits.map(value => Number(value.balance))).toEqual([100, 100]);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
      expect(getEditTask(taskId)?.status).not.toBe('completed');
      if (terminal === 'timeout') expect(getEditTask(taskId)?.status).toBe('timeout');
      const replay = await POST(request()); expect(replay.status).toBe(200); expect((await replay.json()).taskId).toBe(taskId);
      expect(await canvasBilling(query)).toEqual(state);
    } finally { hold.release(); await running; }
  });
}, 60_000);

it('E: revocation during provider execution retains personal result and GET never shares or charges again', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_revoke_running', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const { taskId } = await (await POST(request())).json();
    const hold = gate(); provider(hold); const running = boundary.callbacks.shift()!(); await hold.reached;
    try { await revokeDocumentEditor('owner', 'shared', 'editor'); }
    finally { hold.release(); await running; }
    const state = await canvasBilling(query);
    expect(state.tasks[0].status).toBe('completed'); expect(state.tasks[0].result).toHaveProperty('image');
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    expect((await POST(request())).status).toBe(403);
    expect((await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'))).status).toBe(200);
    expect((await canvasBilling(query)).transactions).toEqual(state.transactions);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM cloud_tasks')).rows).toEqual([{ id: taskId }]);
  });
}, 60_000);

it.each(['private', 'personal', 'chat', 'workflow', 'document-chat', 'internal-chat', 'fake-internal'])('E: %s compatibility retains one task charge and correct dispatch scope', async scenario => {
  await withIsolatedPostgres('task8cb3g_compat', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','editor','Personal')");
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')).toString('base64');
    boundary.source = scenario === 'internal-chat' ? 'internal' : 'session';
    const body = scenario === 'fake-internal' ? editBody() : editBody({ projectId: scenario === 'personal' ? 'personal' : scenario.startsWith('document-') ? 'shared' : undefined,
      image: `data:image/png;base64,${png}`, assetParentVersionIds: undefined, assetSelectedEntityIds: undefined,
      ...(['chat', 'workflow', 'document-chat', 'document-workflow'].includes(scenario) ? { assetWorkspace: scenario.replace('document-', '') } : {}) });
    const headers = { 'x-wujie-agent-defer-execution': 'true', 'x-wujie-agent-resume-execution': 'true' };
    const response = await POST(request(body, 'compat', scenario === 'fake-internal' ? headers : scenario === 'internal-chat' ? { 'x-wujie-agent-defer-execution': 'true' } : {}));
    expect(response.status, await response.clone().text()).toBe(200); const { taskId } = await response.json();
    if (scenario === 'internal-chat') {
      expect(boundary.callbacks).toHaveLength(0); const network = provider();
      expect((await POST(request(body, 'compat', { 'x-wujie-agent-resume-execution': 'true' }))).status).toBe(200); expect(network.calls()).toBe(1);
    } else { expect(boundary.callbacks).toHaveLength(1); provider(); await boundary.callbacks.shift()!(); }
    expect((await canvasBilling(query)).transactions.filter(value => value.type === 'consume')).toHaveLength(1);
    expect((await canvasBilling(query)).publications).toHaveLength(scenario === 'fake-internal' ? 1 : 0);
    expect((await query('SELECT status FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].status).toBe('completed');
  });
}, 60_000);

it('E: document workflow rejects an unbound data image before charging', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_workflow_unbound', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const png = readFileSync(join(process.env.WUJIE_DATA_DIR!, 'shared.png')).toString('base64');
    const response = await POST(request(editBody({ projectId: 'shared', assetWorkspace: 'workflow',
      image: `data:image/png;base64,${png}`, assetParentVersionIds: undefined,
      assetSelectedEntityIds: undefined }), 'workflow-unbound'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'WORKFLOW_EDIT_SOURCE_INVALID' });
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(0);
    expect(state.transactions).toHaveLength(0);
    expect(state.credits.map(row => [row.user_id, Number(row.balance)])).toEqual([['editor', 100], ['owner', 100]]);
    expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it('E: document workflow rejects a valid source when acceptance storage is unavailable', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_workflow_storage', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-workflow-shared','owner','shared','asset-shared','version-shared',
        'workflow','workflow-a','workflow-input','input-shared')`);
    const response = await POST(request(editBody({ projectId: 'shared', assetWorkspace: 'workflow',
      image: '/api/serve-upload/shared.png', assetParentVersionIds: undefined,
      assetSelectedEntityIds: undefined }), 'workflow-storage-unavailable'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'WORKFLOW_EDIT_ACCEPTANCE_STORAGE_UNAVAILABLE' });
    const state = await canvasBilling(query);
    expect(state.tasks).toHaveLength(0);
    expect(state.transactions).toHaveLength(0);
    expect(state.credits.map(row => [row.user_id, Number(row.balance)])).toEqual([['editor', 100], ['owner', 100]]);
    expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

function provider(gated?: ReturnType<typeof gate>, count: number = 1, fail: boolean = false): { calls: () => number } {
  expect(readFileSync(join(process.env.WUJIE_DATA_DIR!, 'second.png')).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let calls = 0;
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
    expect(target.hostname).toBe('provider.invalid');
    init?.signal?.throwIfAborted();
    calls++;
    gated?.enter();
    if (gated && calls === 1) await gated.released;
    // Deliberately allow a late successful reply; persistence must enforce the fence.
    if (fail) return Response.json({ error: { message: 'Fixture provider failure' } }, { status: 503 });
    if (boundary.llm && target.pathname.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: '{"editInstruction":"Change the subject to blue and retain composition"}' } }] });
    return Response.json({ data: Array.from({ length: count }, () => ({ url: '/api/serve-upload/second.png' })) });
  });
  return { calls: (): number => calls };
}

it('B/D: twenty POST replays and two internal resumes share one lease and provider execution', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_concurrent', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const responses = await Promise.all(Array.from({ length: 20 }, () => POST(request())));
    expect(responses.map(value => value.status)).toEqual(Array(20).fill(200));
    const bodies = await Promise.all(responses.map(value => value.json()));
    const taskId = bodies[0].taskId;
    expect(new Set(bodies.map(value => value.taskId)).size).toBe(1);
    const hold = gate(); const network = provider(hold);
    const queued = boundary.callbacks.splice(0);
    expect(queued.length).toBeGreaterThan(0);
    const first = queued[0]();
    await hold.reached;
    const before = getEditTask(taskId);
    boundary.source = 'internal';
    try {
      await Promise.all([
        ...queued.slice(1).map(callback => callback()),
        POST(request(editBody(), 'edit-once', { 'x-wujie-agent-resume-execution': 'true' })),
        POST(request(editBody(), 'edit-once', { 'x-wujie-agent-resume-execution': 'true' })),
      ]);
      expect(network.calls()).toBe(1);
      expect(getEditTask(taskId)).toEqual(before);
    } finally { hold.release(); await first; }
    expect((await query('SELECT status,attempt_count FROM cloud_tasks')).rows).toEqual([{ status: 'completed', attempt_count: 1 }]);
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);

it.each(['completed', 'failed', 'cancelled', 'timeout'].flatMap(status => [false, true].map(legacy => ({ status, legacy }))))('C: $status legacy=$legacy replay precedes removed sources and leaves whole schema unchanged', async ({ status, legacy }) => {
  await withIsolatedPostgres(`task8cb3g_terminal_${status}`, async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const first = await (await POST(request())).json(); boundary.callbacks = [];
    await query('UPDATE cloud_tasks SET status=$1', [status]);
    if (legacy) await query('DELETE FROM wujie_canvas_task_publications');
    await query("UPDATE wujie_asset_versions SET availability='missing'");
    await query('DELETE FROM wujie_workspace_placements');
    const before = await editDatabaseSnapshot(query);
    const replay = await POST(request());
    expect(replay.status).toBe(200); expect((await replay.json()).taskId).toBe(first.taskId);
    expect(boundary.callbacks).toHaveLength(0);
    expect(await editDatabaseSnapshot(query)).toEqual(before);
  });
}, 60_000);

it('C: actual core terminal result wins after preflight and does not dispatch or rewrite it', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_core_terminal_race', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const first = await (await POST(request())).json(); boundary.callbacks = [];
    const lock = await lockEditAdmission('edit-once'); const running = POST(request());
    let before: Record<string, unknown>;
    try {
      await lock.wait(query);
      await query("UPDATE cloud_tasks SET status='completed'");
      await query("UPDATE wujie_asset_versions SET availability='missing'");
      before = await editDatabaseSnapshot(query);
    } finally { await lock.release(); }
    const response = await running; expect(response.status).toBe(200); expect((await response.json()).taskId).toBe(first.taskId);
    expect(boundary.callbacks).toHaveLength(0); expect(await editDatabaseSnapshot(query)).toEqual(before!);
  });
}, 60_000);

it('C: current price and auto-provider changes cannot change a frozen pending task', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_provider_price', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const body = editBody({ providerId: undefined });
    const first = await (await POST(request(body))).json(); boundary.callbacks = [];
    const before = await canvasBilling(query);
    boundary.autoProvider = 'other';
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'gpt-image-1': 80, 'provider::gpt-image-1': 80 } })]);
    const retry = await POST(request(body)); expect(retry.status).toBe(200); expect((await retry.json()).taskId).toBe(first.taskId);
    expect(await canvasBilling(query)).toEqual(before);
    const network = provider(); await boundary.callbacks.shift()!(); expect(network.calls()).toBe(1);
    expect((await query('SELECT provider_id,credit_cost FROM cloud_tasks')).rows[0]).toEqual({ provider_id: 'provider', credit_cost: before.tasks[0].credit_cost });
  });
}, 60_000);

it('B: same-origin primary and ordered canonical reference are accepted without re-encoding', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_reference', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const response = await POST(request(editBody({ image: 'http://localhost/api/serve-upload/shared.png',
      assetParentVersionIds: ['version-shared', 'version-second'], referenceImages: [{ url: '/api/serve-upload/second.png' }] })));
    expect(response.status).toBe(200);
    const state = await canvasBilling(query); expect(state.publications[0].publication_intent).toMatchObject({ parentVersionIds: ['version-shared', 'version-second'] });
    expect(boundary.deniedNetworkCalls).toBe(0);
    provider(); await boundary.callbacks.shift()!();
    expect((await query('SELECT status FROM cloud_tasks')).rows[0].status).toBe('completed');
  });
}, 60_000);

it('D: cancellation queued behind replay locks makes initialization return false before media or local registration', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_init_false', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const { taskId } = await (await POST(request())).json();
    const locker = await getPool().connect(); await locker.query('BEGIN');
    await locker.query("SELECT 1 FROM wujie_users WHERE id='owner' FOR UPDATE");
    const pid = (await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const worker = boundary.callbacks.shift()!();
    let cancel: Promise<unknown> | undefined;
    try {
      const deadline = Date.now() + 15000;
      let waiting = false;
      while (Date.now() < deadline) {
        if ((await query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount) { waiting = true; break; }
      }
      expect(waiting).toBe(true);
      cancel = terminateCloudTaskAndRefund(taskId, 'cancelled', 'Queued cancellation');
      let cancelWaiting = false;
      while (Date.now() < deadline) {
        if ((await query("SELECT 1 FROM pg_stat_activity WHERE query LIKE '%WITH candidate AS (%' AND cardinality(pg_blocking_pids(pid))>0")).rowCount) { cancelWaiting = true; break; }
      }
      expect(cancelWaiting).toBe(true);
    } finally { await locker.query('COMMIT'); locker.release(); await cancel; await worker; }
    expect(boundary.deniedNetworkCalls).toBe(0); expect(getEditTask(taskId)).toBeUndefined();
    expect((await query('SELECT status FROM cloud_tasks')).rows[0].status).toBe('cancelled');
    expect((await canvasBilling(query)).transactions.filter(row => row.type === 'refund')).toHaveLength(1);
  });
}, 60_000);

it.each(['revoked', 'source-missing'])('D: worker rechecks original %s before media and settles only its own lease', async reason => {
  await withIsolatedPostgres('task8cb3g_worker_recheck', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); await POST(request());
    if (reason === 'revoked') await revokeDocumentEditor('owner', 'shared', 'editor');
    else await query("UPDATE wujie_asset_versions SET availability='missing'");
    const reads = vi.spyOn(fsPromises, 'readFile');
    await boundary.callbacks.shift()!();
    expect(boundary.deniedNetworkCalls).toBe(0); expect(reads.mock.calls).toHaveLength(0);
    const state = await canvasBilling(query); expect(state.tasks[0].status).toBe('failed');
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it('D: POST failure before COMMIT returns a safe 503 with no task charge or intent', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_post_rollback', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("CREATE FUNCTION reject_edit_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL connection detail'; END $$");
    await query('CREATE TRIGGER reject_edit_intent BEFORE INSERT ON wujie_canvas_task_publications FOR EACH ROW EXECUTE FUNCTION reject_edit_intent()');
    const before = await canvasBilling(query); const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/private SQL|connection detail|postgres/i);
    expect(await canvasBilling(query)).toEqual(before); expect(boundary.callbacks).toHaveLength(0);
  });
}, 60_000);

it('A: zero-price POST still freezes intent and completes canonical publication', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_post_zero', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'", [JSON.stringify({ modelCredits: { 'provider::gpt-image-1': 0 } })]);
    expect((await POST(request())).status).toBe(200);
    const state = await canvasBilling(query); expect(state.publications).toHaveLength(1); expect(state.transactions).toHaveLength(0);
    expect(state.credits.map(row => Number(row.balance))).toEqual([100, 100]);
    provider(); await boundary.callbacks.shift()!(); expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(1);
  });
}, 60_000);

it.each([
  { label: 'prompt', changes: { prompt: '改为红色' } }, { label: 'primary', changes: { image: '/api/serve-upload/second.png' } },
  { label: 'reference', changes: { referenceImages: ['/api/serve-upload/second.png'] } },
  { label: 'parents', changes: { assetParentVersionIds: ['version-second'] } },
  { label: 'selection', changes: { assetSelectedEntityIds: ['image-second'] } },
  { label: 'mode', changes: { assetProjectionMode: 'revision' } }, { label: 'count', changes: { count: 2 } },
  { label: 'provider', changes: { providerId: 'other' } }, { label: 'model', changes: { model: 'gpt-image-2' } },
  { label: 'workspaceId', changes: { assetWorkspaceId: 'canvas:shared' } },
  { label: 'project', changes: { projectId: 'personal' } },
  { label: 'workspace', changes: { assetWorkspace: 'chat' } },
  { label: 'same-origin identity', changes: { image: 'http://localhost/api/serve-upload/shared.png' } },
])('B: same key changing $label conflicts without further writes', async ({ changes }) => {
  await withIsolatedPostgres('task8cb3g_identity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); await POST(request());
    if ('projectId' in changes) await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('personal','editor','Personal')");
    const before = await canvasBilling(query);
    expect((await POST(request(editBody(changes)))).status).toBe(409);
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

it.each(['intent', 'snapshot', 'digest', 'project', 'type', 'grant', 'source', 'selection'])('C: nonterminal replay rejects corrupted/stale %s without writes', async field => {
  await withIsolatedPostgres('task8cb3g_pending', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); await POST(request());
    if (field === 'intent') await query('DELETE FROM wujie_canvas_task_publications');
    if (field === 'snapshot') await query("UPDATE wujie_canvas_task_publications SET publication_intent=publication_intent-'selectionSnapshot'");
    if (field === 'digest') await query("UPDATE cloud_tasks SET request_digest='' ");
    if (field === 'project') await query("UPDATE cloud_tasks SET project_id='other'");
    if (field === 'type') await query("UPDATE cloud_tasks SET type='generate'");
    if (field === 'grant') { await revokeDocumentEditor('owner', 'shared', 'editor'); await grantDocumentEditor('owner', 'shared', 'editor'); }
    if (field === 'source') await query("UPDATE wujie_asset_versions SET availability='missing'");
    if (field === 'selection') await query("UPDATE wujie_workspace_placements SET entity_id='replaced' WHERE id='placement-shared'");
    const before = await canvasBilling(query);
    expect([403, 409]).toContain((await POST(request())).status);
    expect(await canvasBilling(query)).toEqual(before);
  });
}, 60_000);

it('C: nonterminal movement preserves frozen x132 and revision without billing writes', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_move', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const first = await (await POST(request())).json();
    await moveCanvasSource(900, 200); const before = await canvasBilling(query);
    const replay = await POST(request()); expect(replay.status).toBe(200); expect((await replay.json()).taskId).toBe(first.taskId);
    expect(await canvasBilling(query)).toEqual(before);
    expect(boundary.callbacks.length).toBe(2);
  });
}, 60_000);

it('D: defer creates no local worker and resume requires an original task', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_defer', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.source = 'internal';
    expect((await POST(request(editBody(), 'missing', { 'x-wujie-agent-resume-execution': 'true' }))).status).toBe(409);
    expect((await canvasBilling(query)).tasks).toHaveLength(0);
    const response = await POST(request(editBody(), 'edit-once', { 'x-wujie-agent-defer-execution': 'true' }));
    expect(response.status).toBe(200); const body = await response.json();
    expect(getEditTask(body.taskId)).toBeUndefined(); expect(boundary.callbacks).toHaveLength(0);
    expect((await query('SELECT attempt_count FROM cloud_tasks')).rows[0].attempt_count).toBe(0);
    const network = provider();
    const resumed = await POST(request(editBody(), 'edit-once', { 'x-wujie-agent-resume-execution': 'true' }));
    expect(resumed.status).toBe(200); expect(network.calls()).toBe(1);
    expect((await query('SELECT status FROM cloud_tasks')).rows[0].status).toBe('completed');
  });
}, 60_000);

it('D: failed after scheduling preserves the paid task for ordinary replay', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_schedule', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); boundary.throwAfter = true;
    expect((await POST(request())).status).toBe(503);
    const state = await canvasBilling(query);
    expect(state.tasks[0].status).toBe('processing'); expect(state.transactions).toHaveLength(1);
    boundary.throwAfter = false; const retry = await POST(request());
    expect(retry.status).toBe(200); expect((await retry.json()).taskId).toBe(state.tasks[0].id);
    const network = provider(); for (const callback of boundary.callbacks.splice(0)) await callback();
    expect(network.calls()).toBe(1); expect((await query('SELECT status FROM cloud_tasks')).rows[0].status).toBe('completed');
  });
}, 60_000);

// A durable provider checkpoint must not be turned into a second paid provider submission by replay.
it('D: queued retries and internal resume retain the original remote provider checkpoint', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_remote_checkpoint', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const { taskId } = await (await POST(request())).json();
    expect((await POST(request())).status).toBe(200);
    let submissions = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      if (target.pathname.endsWith('/images/edits')) return Response.json({ data: [] });
      expect(target.pathname.endsWith('/images/generations')).toBe(true);
      submissions++;
      return Response.json({ task_id: `remote-${submissions}` });
    });
    const callbacks = boundary.callbacks.splice(0);
    await callbacks[0]();
    expect((await query('SELECT remote_task_id FROM cloud_tasks')).rows[0].remote_task_id).toBe('remote-1');
    const local = getEditTask(taskId);
    await callbacks[1]();
    expect((await POST(request())).status).toBe(200);
    for (const callback of boundary.callbacks.splice(0)) await callback();
    boundary.source = 'internal';
    expect((await POST(request(editBody(), 'edit-once', { 'x-wujie-agent-resume-execution': 'true' }))).status).toBe(200);
    expect(submissions).toBe(1);
    expect(getEditTask(taskId)).toEqual(local);
    expect((await query('SELECT status,remote_task_id FROM cloud_tasks')).rows).toEqual([{ status: 'processing', remote_task_id: 'remote-1' }]);
    expect((await canvasBilling(query)).transactions).toHaveLength(1);
  });
}, 60_000);

it.each(['revoked', 'source-deleted'])('I1: delayed callback after remote handoff preserves personal completion when %s', async reason => {
  await withIsolatedPostgres('task8cb3g_fix1_handoff', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const first = await POST(request()); const second = await POST(request());
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    const { taskId } = await first.json(); expect((await second.json()).taskId).toBe(taskId);
    const callbacks = boundary.callbacks.splice(0); expect(callbacks).toHaveLength(2);
    const hold = gate(); let submissions = 0;
    const network = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      if (target.pathname.endsWith('/images/edits')) return Response.json({ data: [] });
      expect(target.pathname.endsWith('/images/generations')).toBe(true);
      submissions++; hold.enter(); await hold.released;
      return Response.json({ task_id: 'remote-fix1' });
    });
    vi.stubGlobal('fetch', network);
    const running = callbacks[0](); await hold.reached;
    try {
      const active = (await canvasBilling(query)).tasks[0];
      expect(active.lease_owner).not.toBe(''); expect(active.remote_task_id).toBeFalsy();
    } finally { hold.release(); await running; }
    const handedOff = await canvasBilling(query);
    expect(handedOff.tasks[0]).toMatchObject({ id: taskId, status: 'processing', remote_task_id: 'remote-fix1', lease_owner: '', attempt_count: 1 });
    expect(Number(handedOff.tasks[0].lease_expires_at)).toBe(0);
    expect(handedOff.transactions).toHaveLength(1); expect(handedOff.transactions[0].type).toBe('consume');
    expect(handedOff.credits.map(row => [row.user_id, Number(row.balance)])).toEqual([['editor', 93], ['owner', 100]]);
    if (reason === 'revoked') await revokeDocumentEditor('owner', 'shared', 'editor');
    else await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
    const local = structuredClone(getEditTask(taskId)); const registry = structuredClone(getTaskInfo(taskId));
    const reads = vi.spyOn(fsPromises, 'readFile');
    const networkCalls = network.mock.calls.length;
    expect((await POST(request())).status).toBe(reason === 'revoked' ? 403 : 409);
    expect(boundary.callbacks).toHaveLength(0);
    await callbacks[1]();
    const delayed = await canvasBilling(query);
    console.info('I1 real handoff state', reason, delayed.tasks[0].status, delayed.transactions.map(row => row.type));
    expect(delayed.tasks[0]).toMatchObject({ id: taskId, status: 'processing', remote_task_id: 'remote-fix1', lease_owner: '', attempt_count: 2 });
    expect(Number(delayed.tasks[0].lease_expires_at)).toBe(0);
    expect(delayed.transactions).toEqual(handedOff.transactions); expect(delayed.credits).toEqual(handedOff.credits);
    expect(delayed.publications).toEqual(handedOff.publications);
    expect(getEditTask(taskId)).toEqual(local); expect(getTaskInfo(taskId)).toEqual(registry);
    expect(abortTaskExecution(taskId)).toBe(false);
    expect(reads.mock.calls).toHaveLength(0); expect(network.mock.calls).toHaveLength(networkCalls);
    expect(submissions).toBe(1); expect(boundary.deniedNetworkCalls).toBe(0);
    expect(await completeCloudTask(taskId, { success: true, imageUrl: '/api/serve-upload/second.png' })).toBe(true);
    for (let index = 0; index < 2; index++) {
      const response = await GET(new NextRequest('http://localhost/api/tasks/recover?projectId=shared'));
      expect(response.status).toBe(200);
      expect((await response.json()).tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: taskId, status: 'completed', result: expect.objectContaining({ imageUrl: '/api/serve-upload/second.png' }) })]));
    }
    const completed = await canvasBilling(query);
    expect(completed.tasks[0]).toMatchObject({ status: 'completed', credit_status: 'charged' });
    expect(completed.transactions).toEqual(handedOff.transactions); expect(completed.credits).toEqual(handedOff.credits);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each(['revoked', 'source-deleted'])('I1: forged client checkpoint cannot skip undispatched %s validation', async reason => {
  await withIsolatedPostgres('task8cb3g_fix1_forged', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const response = await POST(request(editBody({ remoteTaskId: 'forged', remote_task_id: 'forged', result: { remotePollInfo: { taskId: 'forged' } } })));
    expect(response.status).toBe(200); const { taskId } = await response.json();
    expect((await canvasBilling(query)).tasks[0].remote_task_id).toBeFalsy();
    if (reason === 'revoked') await revokeDocumentEditor('owner', 'shared', 'editor');
    else await query("DELETE FROM wujie_workspace_placements WHERE id='placement-shared'");
    const reads = vi.spyOn(fsPromises, 'readFile');
    await boundary.callbacks.shift()!();
    const state = await canvasBilling(query);
    expect(state.tasks[0]).toMatchObject({ id: taskId, status: 'failed', lease_owner: '', attempt_count: 1 });
    expect(state.transactions.filter(row => row.type === 'refund')).toHaveLength(1);
    expect(boundary.deniedNetworkCalls).toBe(0); expect(reads.mock.calls).toHaveLength(0);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it('I1: another real task checkpoint cannot stand in for the queued task identity', async (): Promise<void> => {
  await withIsolatedPostgres('task8cb3g_fix1_identity', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName);
    const first = await POST(request()); expect(first.status).toBe(200); const original = await first.json();
    const oldCallback = boundary.callbacks.shift()!;
    // Simulate persisted identity corruption, not a client-supplied checkpoint or a mocked lookup.
    await query("UPDATE cloud_tasks SET idempotency_key='displaced-key' WHERE id=$1", [original.taskId]);
    const second = await POST(request()); expect(second.status).toBe(200); const replacement = await second.json();
    expect(replacement.taskId).not.toBe(original.taskId);
    let submissions = 0;
    vi.stubGlobal('fetch', async (url: string | URL | Request): Promise<Response> => {
      const target = new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      expect(target.hostname).toBe('provider.invalid');
      if (target.pathname.endsWith('/images/edits')) return Response.json({ data: [] });
      expect(target.pathname.endsWith('/images/generations')).toBe(true);
      submissions++; return Response.json({ task_id: 'remote-replacement' });
    });
    await boundary.callbacks.shift()!();
    const checkpoint = (await canvasBilling(query)).tasks.find(row => row.id === replacement.taskId);
    expect(checkpoint).toMatchObject({ status: 'processing', remote_task_id: 'remote-replacement', lease_owner: '' });
    const local = structuredClone(getEditTask(replacement.taskId));
    const reads = vi.spyOn(fsPromises, 'readFile');
    await oldCallback();
    const state = await canvasBilling(query);
    expect(state.tasks.find(row => row.id === original.taskId)).toMatchObject({ status: 'failed', lease_owner: '', attempt_count: 1 });
    expect(state.tasks.find(row => row.id === replacement.taskId)).toEqual(checkpoint);
    expect(state.transactions.filter(row => row.type === 'consume')).toHaveLength(2);
    expect(state.transactions.filter(row => row.type === 'refund').map(row => row.task_id)).toEqual([original.taskId]);
    expect(submissions).toBe(1); expect(reads.mock.calls).toHaveLength(0); expect(boundary.deniedNetworkCalls).toBe(0);
    expect(getEditTask(replacement.taskId)).toEqual(local);
    expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
  });
}, 60_000);

it.each(['success', 'failure', 'llm-progress'])('D: lease takeover fences late old worker %s and preserves successor state', async ending => {
  await withIsolatedPostgres('task8cb3g_takeover', async ({ query, databaseUrl, schemaName }) => {
    await seedCanvasEdit(query, databaseUrl, schemaName); const { taskId } = await (await POST(request())).json();
    boundary.llm = ending === 'llm-progress';
    const hold = gate(); const network = provider(hold, 1, ending === 'failure');
    const running = boundary.callbacks.shift()!(); await hold.reached;
    try {
      await query('UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1', [taskId]);
      expect(await claimCloudTaskLease(taskId, 'successor', 360000)).not.toBeNull();
      setEditTask(taskId, { id: taskId, status: 'processing', progress: 77, stage: 'successor', createdAt: 1 });
      const before = await canvasBilling(query); const local = getEditTask(taskId);
      hold.release(); await running;
      expect(await canvasBilling(query)).toEqual(before); expect(getEditTask(taskId)).toEqual(local);
      expect((await query('SELECT * FROM wujie_canvas_asset_commands')).rows).toHaveLength(0);
      if (ending !== 'failure') expect(network.calls()).toBe(1);
      else expect(network.calls()).toBeGreaterThanOrEqual(1);
    } finally { hold.release(); await running; }
  });
}, 60_000);

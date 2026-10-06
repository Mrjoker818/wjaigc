import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { requireApiAuthOrReject } from '@/lib/api-auth';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { PrepareAdmittedAgentTaskExecutionInput } from '@/lib/agent-runtime/surface-dispatch';
import type { SubmitAgentImageProviderRequestInput } from '@/lib/agent-runtime/provider-submission';
import { withIsolatedPostgres, type QueryFn } from '../../../tests/helpers/postgres-test-database';

vi.hoisted(async () => {
  const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL || 'http://invalid');
  if (!['127.0.0.1', '[::1]'].includes(url.hostname) || !['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Explicit loopback POSTGRES_TEST_DATABASE_URL required');
  }
  process.env.WUJIE_ADMIN_USERNAME = 'Owner';
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  if (!process.env.WUJIE_DATA_DIR) throw new Error('Isolated media root required');
  process.env.WUJIE_DATA_DIR = mkdtempSync(join(process.env.WUJIE_DATA_DIR, 'task8cb3j3-'));
});
const state = vi.hoisted((): { source: 'cookie' | 'desktop-token' | 'internal'; cookie: string | null; cost: number;
  modelDenied: boolean; dispatchFailure: boolean; afterCalls: number; fetchCalls: number;
  deniedProvider?: string; providerDrift: boolean; providerReads: number;
  expectedChatModel: string;
  authorizedPairs: string[][]; submittedPairs: string[][]; execute?: () => Promise<void>;
} => ({ source: 'desktop-token', cookie: 'editor', cost: 7,
  modelDenied: false, dispatchFailure: false, afterCalls: 0, fetchCalls: 0,
  providerDrift: false, providerReads: 0, authorizedPairs: [], submittedPairs: [], expectedChatModel: 'chat-model' }));
const providers = vi.hoisted(() => {
  const make = (kind: 'chat' | 'image'): ApiProvider => ({ id: `${kind}-provider`, name: kind,
    baseUrl: `https://${kind}.invalid`, apiKey: 'offline-fixture', type: kind, modelType: kind,
    isEnabled: true, selectedModels: [`${kind}-model`], createdAt: 1, updatedAt: 1 });
  return { chat: make('chat'), image: make('image') };
});
vi.mock('@/lib/server-api-config', () => {
  const read = (provider: ApiProvider | null): ApiProvider | null => {
    state.providerReads++;
    return state.providerDrift ? null : provider;
  };
  return {
    findProviderById: async (id: string) => read(id === providers.chat.id ? providers.chat : id === providers.image.id ? providers.image : null),
    findProviderForFeature: async (feature: string) => read(feature === 'chat' ? providers.chat : providers.image),
    findProviderForModel: async () => read(providers.image),
  };
});
// Explicit offline execution probe; after never starts the executor and global fetch stays forbidden.
vi.mock('@/lib/api-helpers', async original => ({ ...await original<typeof import('@/lib/api-helpers')>(),
  fetchWithV1Retry: async (baseUrl: string, _path: string, options: RequestInit) => {
    const body: { model: string } = JSON.parse(String(options.body));
    state.submittedPairs.push([baseUrl, body.model]);
    return Response.json({ choices: [{ message: { content: 'offline plan' }, finish_reason: 'stop' }] });
  } }));
vi.mock('@/lib/agent-runtime/provider-submission', () => ({
  submitAgentImageProviderRequest: async (input: SubmitAgentImageProviderRequestInput) => {
    state.submittedPairs.push([input.baseUrl, input.exactModel]);
    return Response.json({ data: [{ url: '/offline-result.png' }] });
  },
}));
vi.mock('@/lib/agent-engine', async original => {
  const actual = await original<typeof import('@/lib/agent-engine')>();
  return { ...actual, executeAgentLoop: async (...[context, llmCall]: Parameters<typeof actual.executeAgentLoop>) => {
    expect(context.model).toBe(state.expectedChatModel);
    await llmCall([{ role: 'user', content: 'offline probe' }], []);
    return { success: true, finalResponse: 'offline', steps: [
      { round: 1, toolName: 'image_edit', params: { prompt: 'blue' }, result: 'planned', success: true },
    ] };
  } };
});
const actor = vi.hoisted(() => ({ id: 'editor', name: 'Editor', role: 'user' as const,
  status: 'active' as const, productType: 'canvas,chat', createdAt: 1, updatedAt: 1 }));
vi.mock('server-only', () => ({}));
// Error auditing is fire-and-forget in production; keep it outside schema lifecycle tests.
vi.mock('@/lib/op-log', async original => ({ ...await original<typeof import('@/lib/op-log')>(), logError: () => undefined }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async (): ReturnType<typeof requireApiAuthOrReject> => ({ authenticated: true,
  userId: actor.id, userRole: actor.role, source: state.source, user: actor }) }));
vi.mock('@/lib/server-auth', async original => ({ ...await original<typeof import('@/lib/server-auth')>(),
  getSessionUser: async () => state.cookie ? { ...actor, id: state.cookie } : null }));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: async (providerId: string, modelId: string, userId: string) => {
  state.authorizedPairs.push([providerId, modelId, userId]);
  if (state.modelDenied || state.deniedProvider === providerId || userId !== 'editor') throw new Error('Model access denied');
  const provider = providerId === providers.chat.id ? providers.chat : providers.image;
  if (provider.id !== providerId || !provider.selectedModels?.includes(modelId)) throw new Error('Model is not configured');
  return { providerId, modelId, kind: providerId === 'chat-provider' ? 'chat' : 'image', sourceType: 'chat',
    protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
    maxOutputs: 1, supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: {} };
} }));
vi.mock('@/lib/credits', async original => ({ ...await original<typeof import('@/lib/credits')>(),
  calculateConfiguredCreditCost: async (feature: string, model?: string, options?: { providerId?: string }) => {
    if (feature !== 'image_retouch' || model !== state.expectedChatModel || options?.providerId !== 'chat-provider') {
      throw new Error('Fee lookup must use the exact admitted model and provider');
    }
    return state.cost;
  } }));
vi.mock('@/lib/agent-runtime/surface-dispatch', () => ({ prepareAdmittedAgentTaskExecution: async (input: PrepareAdmittedAgentTaskExecutionInput<void>) => {
  if (state.dispatchFailure) throw new Error('isolated dispatch failure');
  state.execute = input.execute;
  return { execute: async () => { throw new Error('Executor must not run'); } };
} }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(),
  after: () => { state.afterCalls++; } }));

import { POST, GET } from '@/lib/agent-runtime/agent-edit-execution-service';
import { ensureCoreTables } from '@/lib/db-storage';
import { createBillableTask, type CreateBillableTaskInput } from '@/lib/task-core/billing-service';
import { createAgentEditExecutionDescriptorV1, digestAgentEditExecutionDescriptor } from '@/lib/agent-runtime/agent-edit-execution-descriptor';

beforeEach(() => {
  Object.assign(state, { source: 'desktop-token', cookie: null, cost: 7, modelDenied: false,
    dispatchFailure: false, afterCalls: 0, fetchCalls: 0, deniedProvider: undefined,
    providerDrift: false, providerReads: 0, authorizedPairs: [], submittedPairs: [], execute: undefined, expectedChatModel: 'chat-model' });
  providers.chat.selectedModels = ['chat-model'];
  providers.image.selectedModels = ['image-model'];
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', 'agent-v2');
  vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
  vi.stubGlobal('fetch', async () => { state.fetchCalls++; throw new Error('Offline fixture forbids fetch'); });
});
afterEach(() => { expect(state.fetchCalls).toBe(0); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function fixture(run: (query: QueryFn) => Promise<void>): Promise<void> {
  await withIsolatedPostgres('task8cb3j3', async ({ query, databaseUrl, schemaName }) => {
    console.log('j3 isolation', schemaName, process.env.WUJIE_DATA_DIR);
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    console.log('migrations', migration.status, migration.stdout, migration.stderr);
    expect(migration.status).toBe(0);
    await ensureCoreTables();
    await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,product_type,created_at,updated_at)
      VALUES ('owner','Owner','test','active','user','canvas,chat',1,1),('editor','Editor','test','active','user','canvas,chat',1,1)`);
    await query(`INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared')`);
    await query(`INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)`);
    await query(`INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')`);
    await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
      SELECT 'credits_'||id,id,100,100,0,1,1 FROM wujie_users`);
    await query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('asset-shared','owner','shared','image')`);
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('version-shared','asset-shared','owner','shared','/api/serve-upload/shared.png','image/png')`);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('placement-shared','owner','shared','asset-shared','version-shared','canvas','shared','canvas-image','image-shared')`);
    await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection) VALUES ('shared','owner',$1)`,
      [{ placements: { 'placement-shared': { assetVersionId: 'version-shared', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 } } }]);
    await run(query);
  });
}

function post(key = 'admission', changes: Record<string, unknown> = {}): ReturnType<typeof POST> {
  return POST(new NextRequest('http://127.0.0.1/api/agent-edit', { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ projectId: 'shared', image: '/api/serve-upload/shared.png', prompt: 'Make it blue',
      providerId: 'chat-provider', model: 'chat-model', imageProviderId: 'image-provider', imageModel: 'image-model',
      selectedEntityId: 'image-shared', assetParentVersionIds: ['version-shared'], assetProjectionMode: 'revision', ...changes }),
  }));
}

async function assertLedger(query: QueryFn, taskId: string, runtime = 'agent-v2', cost = 7): Promise<void> {
  const tasks = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [taskId])).rows;
  expect(tasks).toHaveLength(1);
  expect(tasks[0].user_id).toBe('editor');
  expect(Number(tasks[0].credit_cost)).toBe(cost);
  expect(Boolean(tasks[0].charged_transaction_id)).toBe(cost > 0);
  const charges = (await query('SELECT user_id,task_id,type,amount,id FROM wujie_credit_transactions')).rows;
  expect(charges).toEqual(cost ? [{ user_id: 'editor', task_id: taskId, type: 'consume', amount: -cost,
    id: tasks[0].charged_transaction_id }] : []);
  expect((await query('SELECT user_id,balance,total_used FROM wujie_credits ORDER BY user_id')).rows)
    .toEqual([{ user_id: 'editor', balance: 100 - cost, total_used: cost }, { user_id: 'owner', balance: 100, total_used: 0 }]);
  if (runtime === 'agent-v2') expect(tasks[0].agent_execution_descriptor.descriptor.sourceVersionId).toBe('version-shared');
  else expect(tasks[0].agent_execution_descriptor).toBeNull();
  expect(JSON.stringify(tasks[0].result)).not.toContain('descriptor');
}
async function assertEmpty(query: QueryFn): Promise<void> {
  expect((await query('SELECT * FROM cloud_tasks')).rows).toEqual([]);
  expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toEqual([]);
  expect((await query('SELECT balance,total_used FROM wujie_credits')).rows)
    .toEqual([{ balance: 100, total_used: 0 }, { balance: 100, total_used: 0 }]);
}

describe('Agent parent atomic admission on real isolated PostgreSQL', () => {
  for (const runtime of ['legacy', 'shadow']) {
    for (const spelling of ['native', 'provider-prefix', 'prefix-is-native', 'configured-suffix', 'alias']) {
      it(`fix1 exact-ID ${runtime} preserves ${spelling} through authorization, price, audit and execution`, async () => {
        vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', runtime);
        const chatModel = spelling === 'alias' ? 'chat-model' : spelling === 'configured-suffix' ? 'Chat::Exact-2k'
          : spelling === 'prefix-is-native' ? 'chat-provider::Chat::Exact' : 'Chat::Exact';
        const imageModel = spelling === 'alias' ? 'image-model' : spelling === 'configured-suffix' ? 'Exact::Model-2k'
          : spelling === 'prefix-is-native' ? 'image-provider::Exact::Model' : 'Exact::Model';
        providers.chat.selectedModels = [chatModel]; providers.image.selectedModels = [imageModel];
        state.expectedChatModel = chatModel;
        const requested = (providerId: string, model: string): string => spelling === 'provider-prefix'
          ? `${providerId}::${model}` : spelling === 'alias' ? `${providerId}::${model}-2k` : model;
        await fixture(async query => {
          const changes = { projectId: undefined, image: 'data:image/png;base64,aGVsbG8=', selectedEntityId: '', assetParentVersionIds: [],
            model: requested('chat-provider', chatModel), imageModel: requested('image-provider', imageModel) };
          const response = await post('legacy-exact', changes); const body = await response.json();
          expect(response.status, JSON.stringify(body)).toBe(200);
          await assertLedger(query, body.taskId, runtime);
          expect(state.authorizedPairs).toEqual([['chat-provider', chatModel, 'editor'], ['image-provider', imageModel, 'editor']]);
          const task = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0];
          expect(task).toMatchObject({ provider_id: 'chat-provider', model: chatModel });
          expect(task.result.taskEntryAudit).toMatchObject({ requestedModelId: changes.model, actualModelId: chatModel, creditCost: 7 });
          const providerReads = state.providerReads;
          state.providerDrift = true;
          await state.execute?.();
          expect(state.submittedPairs).toEqual([['https://chat.invalid', chatModel], ['https://image.invalid', imageModel]]);
          expect(state.providerReads).toBe(providerReads);
          state.modelDenied = true;
          expect((await post('legacy-exact', changes)).status).toBe(200);
          await assertLedger(query, body.taskId, runtime);
        });
      }, 60_000);
    }
    it(`fix1 exact-ID ${runtime} rejects an unverified provider prefix without charging`, async () => {
      vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', runtime);
      await fixture(async query => {
        const response = await post('foreign-prefix', { projectId: '', model: 'other-provider::chat-model' });
        await assertEmpty(query);
        expect(response.status).toBe(409);
      });
    }, 60_000);
  }
  for (const mode of ['legacy', 'shadow', 'core-v2']) {
    for (const projectId of [undefined, '']) for (const deniedProvider of ['chat-provider', 'image-provider']) {
      it(`fix1 legacy ${mode} project=${JSON.stringify(projectId)} rejects actor-denied ${deniedProvider} before billing`, async () => {
        vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', 'legacy');
        vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
        state.deniedProvider = deniedProvider;
        await fixture(async query => {
          const response = await post('legacy-denied', { projectId });
          await assertEmpty(query);
          expect(response.status).toBe(409);
          expect(state.afterCalls).toBe(0);
        });
      }, 60_000);
    }
    const selections = [
      { name: 'explicit', providerId: 'chat-provider', model: 'chat-model', imageProviderId: 'image-provider', imageModel: 'image-model' },
      { name: 'defaults', providerId: undefined, model: undefined, imageProviderId: undefined, imageModel: undefined },
      { name: 'provider-defaults', providerId: 'chat-provider', model: undefined, imageProviderId: 'image-provider', imageModel: undefined },
      { name: 'unavailable', providerId: 'removed-chat', model: 'stale-chat', imageProviderId: 'removed-image', imageModel: 'stale-image' },
    ];
    for (const { name, ...selection } of selections) it(`fix1 legacy ${mode} ${name} resolves authorized execution pair before charging`, async () => {
      vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', 'legacy');
      vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
      await fixture(async query => {
        const changes = { ...selection, projectId: '', image: 'data:image/png;base64,aGVsbG8=', selectedEntityId: '', assetParentVersionIds: [] };
        const response = await post('legacy-resolved', changes);
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(state.authorizedPairs).toEqual([
          ['chat-provider', 'chat-model', 'editor'], ['image-provider', 'image-model', 'editor'],
        ]);
        await assertLedger(query, body.taskId, 'legacy');
        const task = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0];
        expect(task).toMatchObject({ provider_id: 'chat-provider', model: 'chat-model' });
        expect(task.result.taskEntryAudit).toMatchObject({ mode, actualProviderId: 'chat-provider', actualModelId: 'chat-model', creditCost: 7 });
        expect(task.result.taskEntryAudit.requestedProviderId).toBe(selection.providerId);
        expect(task.result.taskEntryAudit.requestedModelId).toBe(selection.model);
        // Configuration disappearing after admission cannot select a different execution pair.
        const readsBeforeExecution = state.providerReads;
        state.providerDrift = true;
        expect(state.execute).toBeTypeOf('function');
        await state.execute?.();
        expect(state.submittedPairs).toEqual([['https://chat.invalid', 'chat-model'], ['https://image.invalid', 'image-model']]);
        expect(state.providerReads).toBe(readsBeforeExecution);
        state.modelDenied = true;
        expect((await post('legacy-resolved', changes)).status).toBe(200);
        await assertLedger(query, body.taskId, 'legacy');
        expect(state.afterCalls).toBe(1);
      });
    }, 60_000);
  }
  for (const cost of [0, 7]) it(`atomic admission marker distinguishes configured cost ${cost}`, async () => {
    state.cost = cost;
    await fixture(async query => {
      const response = await post(); const body = await response.json(); expect(response.status).toBe(200);
      const stored = (await query('SELECT agent_execution_descriptor FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0].agent_execution_descriptor;
      expect(stored.admissionVersion).toBe(2);
      expect(stored.descriptor.version).toBe(1);
      await assertLedger(query, body.taskId, 'agent-v2', cost);
      const { getPrivateAgentExecutionDescriptor } = await import('@/lib/cloud-task-storage');
      expect(await getPrivateAgentExecutionDescriptor(body.taskId, 'editor')).toEqual(stored.descriptor);
    });
  }, 60_000);
  it('atomic admission marker never upgrades or reuses an old zero-fee wrapper with the same digest', async () => {
    state.cost = 0;
    await fixture(async query => {
      const response = await post(); const body = await response.json(); expect(response.status).toBe(200);
      await query("UPDATE cloud_tasks SET agent_execution_descriptor=agent_execution_descriptor-'admissionVersion' WHERE id=$1", [body.taskId]);
      const before = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0];
      const { persistPrivateAgentExecutionDescriptor, getPrivateAgentExecutionDescriptor } = await import('@/lib/cloud-task-storage');
      await persistPrivateAgentExecutionDescriptor({ taskId: body.taskId, userId: 'editor', ...before.agent_execution_descriptor });
      const snapshot = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0];
      expect(snapshot.agent_execution_descriptor).not.toHaveProperty('admissionVersion');
      expect((await post()).status).toBe(409);
      expect((await query('SELECT * FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0]).toEqual(snapshot);
      await assertLedger(query, body.taskId, 'agent-v2', 0);
      expect(await getPrivateAgentExecutionDescriptor(body.taskId, 'editor')).toEqual(before.agent_execution_descriptor.descriptor);
      expect((await GET(new NextRequest(`http://127.0.0.1/api/agent-edit?taskId=${body.taskId}`))).status).toBe(200);
    });
  }, 60_000);
  it('rejects an unauthorized mask version before charge', async () => {
    await fixture(async query => {
      expect((await post('mask-source', { maskVersionId: 'foreign-mask' })).status).toBeGreaterThanOrEqual(400);
      await assertEmpty(query);
    });
  }, 60_000);
  it('binds ordered parents and every execution field for active and terminal same-key requests', async () => {
    await fixture(async query => {
      const first = await post(); const body = await first.json(); expect(first.status).toBe(200);
      const variations: Record<string, unknown>[] = [
        { image: '/api/serve-upload/other.png' }, { prompt: 'Make it green' }, { maskDataUrl: 'changed-mask' },
        { providerId: 'other' }, { model: 'other' }, { imageProviderId: 'other' }, { imageModel: 'other' },
        { imagePrompt: 'other' }, { quality: 'high' }, { aspectRatio: '16:9' }, { maxRounds: 3 },
        { projectId: 'other' }, { sessionId: 'other' }, { messageId: 'other' }, { selectedEntityId: 'other' },
        { maskVersionId: 'other' }, { assetProjectionMode: 'derived' },
        { assetParentVersionIds: ['version-shared', 'other'] }, { assetParentVersionIds: ['other', 'version-shared'] },
      ];
      for (const status of ['processing', 'completed']) {
        await query('UPDATE cloud_tasks SET status=$1 WHERE id=$2', [status, body.taskId]);
        for (const variation of variations) expect((await post('admission', variation)).status, JSON.stringify(variation)).toBe(409);
      }
      expect((await post('admission', { requestId: 'random' })).status).toBe(200);
      expect((await post('admission', { apiKey: 'client-unused', userId: 'owner' })).status).toBe(400);
      await assertLedger(query, body.taskId);
      const { digestAgentEditAdmissionRequest } = await import('@/lib/agent-runtime/agent-edit-admission-identity');
      expect(digestAgentEditAdmissionRequest({ requestId: 'random', apiKey: 'unused', userId: 'owner' }))
        .toBe(digestAgentEditAdmissionRequest({}));
      expect(digestAgentEditAdmissionRequest({ assetParentVersionIds: ['a', 'b'] }))
        .not.toBe(digestAgentEditAdmissionRequest({ assetParentVersionIds: ['b', 'a'] }));
      expect(digestAgentEditAdmissionRequest({ assetProjectionMode: 'invalid' }))
        .toBe(digestAgentEditAdmissionRequest({ assetProjectionMode: 'derived' }));
    });
  }, 60_000);
  for (const runtime of ['legacy', 'agent-v2']) {
    for (const changes of [{ projectId: 'forbidden' }, { selectedEntityId: 'missing' }, { assetParentVersionIds: [] as string[], selectedEntityId: '' }]) {
      it(`${runtime}: project/source gate rejects ${JSON.stringify(changes)} before billing`, async () => {
        vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', runtime);
        await fixture(async query => {
          expect((await post('unauthorized', changes)).status).toBeGreaterThanOrEqual(400);
          await assertEmpty(query);
        });
      }, 60_000);
    }
  }
  it('zero configured fee is genuinely free while retaining the private descriptor', async () => {
    state.cost = 0;
    await fixture(async query => {
      const response = await post(); const body = await response.json(); expect(response.status).toBe(200);
      await assertLedger(query, body.taskId, 'agent-v2', 0);
    });
  }, 60_000);
  it('insufficient credits return 402 with no task, descriptor or ledger row', async () => {
    state.cost = 101;
    await fixture(async query => { expect((await post()).status).toBe(402); await assertEmpty(query); });
  }, 60_000);
  for (const missing of [false, true]) it(`internal managed user ${missing ? 'missing' : 'disabled'} is rejected`, async () => {
    state.source = 'internal';
    await fixture(async query => {
      await query(missing ? "DELETE FROM wujie_users WHERE id='editor'" : "UPDATE wujie_users SET status='disabled' WHERE id='editor'");
      expect((await post()).status).toBe(403); await assertEmpty(query);
    });
  }, 60_000);
  it('same-key concurrent POSTs create one task, one private descriptor and one charge', async () => {
    await fixture(async query => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => post()));
      for (const response of responses) expect(response.status).toBe(200);
      const bodies = await Promise.all(responses.map(response => response.json()));
      expect(new Set(bodies.map(body => body.taskId)).size).toBe(1);
      await assertLedger(query, bodies[0].taskId);
    });
  }, 60_000);
  for (const mutation of ["type='generate'", "request_digest=''", "request_digest='old-digest'"]) {
    it(`terminal POST rejects incompatible existing identity ${mutation} and GET stays readable`, async () => {
      await fixture(async query => {
        const first = await post(); const body = await first.json(); expect(first.status).toBe(200);
        await query(`UPDATE cloud_tasks SET status='completed', ${mutation} WHERE id=$1`, [body.taskId]);
        expect((await post()).status).toBe(409);
        await assertLedger(query, body.taskId);
      });
    }, 60_000);
  }
  it('reused task dispatch failure never settles or refunds the existing parent', async () => {
    await fixture(async query => {
      const response = await post(); const body = await response.json(); expect(response.status).toBe(200);
      state.dispatchFailure = true;
      expect((await post()).status).toBe(500);
      await assertLedger(query, body.taskId);
      expect((await query('SELECT status FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0].status).toBe('processing');
    });
  }, 60_000);
  for (const target of ['descriptor', 'task', 'consume']) {
    it(`real SQL ${target} failure rolls back task, consumption, balance and total_used`, async () => {
      await fixture(async query => {
        // Ensure the private-column migration has run before installing a SQL fault.
        const { ensureCloudTaskTables } = await import('@/lib/cloud-task-storage');
        await ensureCloudTaskTables();
        if (target === 'descriptor') await query(`ALTER TABLE cloud_tasks ADD CONSTRAINT reject_descriptor CHECK (agent_execution_descriptor IS NULL)`);
        else if (target === 'task') await query(`ALTER TABLE cloud_tasks ADD CONSTRAINT reject_agent CHECK (type <> 'agent-edit')`);
        else await query(`ALTER TABLE wujie_credit_transactions ADD CONSTRAINT reject_consume CHECK (type <> 'consume')`);
        expect((await post()).status).toBeGreaterThanOrEqual(500); await assertEmpty(query);
        expect((await query('SELECT * FROM wujie_canvas_task_publications')).rows).toEqual([]);
      });
    }, 60_000);
  }
  it('transaction validates descriptor shape, type, size and digest without charging', async () => {
    await fixture(async query => {
      const descriptor = createAgentEditExecutionDescriptorV1({ sourceVersionId: 'version-shared', prompt: 'Make it blue',
        providerId: 'chat-provider', modelId: 'chat-model', imageProviderId: 'image-provider', imageModelId: 'image-model', maxRounds: 5 });
      const base: CreateBillableTaskInput = { userId: 'editor', idempotencyKey: 'direct', requestDigest: 'digest', creditCost: 7,
        task: { id: 'direct-task', projectId: 'shared', type: 'agent-edit', status: 'processing', progress: 0, createdAt: 1, updatedAt: 1 },
        agentExecutionDescriptor: { descriptor, descriptorDigest: digestAgentEditExecutionDescriptor(descriptor) } };
      const wrongVersion = structuredClone(base);
      Object.assign(wrongVersion.agentExecutionDescriptor!.descriptor, { version: 2 });
      for (const invalid of [
        wrongVersion,
        { ...base, task: { ...base.task, type: 'generate' } },
        { ...base, agentExecutionDescriptor: { descriptor, descriptorDigest: '0'.repeat(64) } },
        { ...base, agentExecutionDescriptor: { descriptor: { ...descriptor, apiKey: 'secret' }, descriptorDigest: '0'.repeat(64) } },
        { ...base, agentExecutionDescriptor: { descriptor: { ...descriptor, prompt: '文'.repeat(16_384), imagePrompt: '文'.repeat(16_384) }, descriptorDigest: '0'.repeat(64) } },
      ]) {
        await expect(createBillableTask(invalid)).rejects.toThrow(); await assertEmpty(query);
      }
      await createBillableTask(base);
      const different = { ...descriptor, prompt: 'Different' };
      await expect(createBillableTask({ ...base, agentExecutionDescriptor: {
        descriptor: different, descriptorDigest: digestAgentEditExecutionDescriptor(different),
      } })).rejects.toThrow();
      await assertLedger(query, 'direct-task');
      await query('UPDATE cloud_tasks SET agent_execution_descriptor=NULL WHERE id=$1', ['direct-task']);
      await expect(createBillableTask(base)).rejects.toThrow();
      expect((await query('SELECT agent_execution_descriptor FROM cloud_tasks')).rows[0].agent_execution_descriptor).toBeNull();
      expect((await query('SELECT * FROM wujie_credit_transactions')).rows).toHaveLength(1);
    });
  }, 60_000);
  for (const runtime of ['agent-v2', 'legacy']) for (const mode of ['legacy', 'shadow', 'core-v2'])
    for (const source of ['cookie', 'desktop-token', 'internal'] as const) {
      it(`${runtime}/${mode}/${source}: charges authenticated editor with linked consume`, async () => {
        vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', runtime); vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
        state.source = source; state.cookie = source === 'cookie' ? 'editor' : null;
        await fixture(async query => {
          const response = await post(); const body = await response.json();
          expect(response.status, JSON.stringify(body)).toBe(200);
          await assertLedger(query, body.taskId, runtime);
          expect((await query('SELECT result FROM cloud_tasks WHERE id=$1', [body.taskId])).rows[0].result.taskEntryAudit.mode).toBe(mode);
          expect(JSON.stringify(body)).not.toContain('descriptor');
          expect(state.afterCalls).toBe(1);
        });
      }, 60_000);
    }
  it('internal actor overrides a conflicting Cookie without model or billing identity drift', async () => {
    state.source = 'internal'; state.cookie = 'owner';
    await fixture(async query => {
      const response = await post(); const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200); await assertLedger(query, body.taskId);
    });
  }, 60_000);
  it('rejects invalid descriptor before any consume or refund', async () => {
    state.cookie = 'editor';
    await fixture(async query => {
      expect((await post('bad', { imagePrompt: 'data:image/png;base64,c2VjcmV0' })).status).toBeGreaterThanOrEqual(400);
      await assertEmpty(query);
    });
  }, 60_000);
  for (const changes of [{ projectId: 'other' }, { assetParentVersionIds: ['other'] }, { selectedEntityId: 'other' },
    { maskVersionId: 'other' }, { assetProjectionMode: 'derived' }, { sessionId: 'other' }, { messageId: 'other' }]) {
    it(`terminal replay rejects changed context ${JSON.stringify(changes)}`, async () => {
      state.cookie = 'editor';
      await fixture(async query => {
        const first = await post(); const body = await first.json(); expect(first.status).toBe(200);
        await query("UPDATE cloud_tasks SET status='completed' WHERE id=$1", [body.taskId]);
        expect((await post('admission', changes)).status).toBe(409);
        await assertLedger(query, body.taskId);
      });
    }, 60_000);
  }
  it('completed same-context replay and old taskId GET survive revoked model access', async () => {
    await fixture(async query => {
      const first = await post(); const body = await first.json(); expect(first.status).toBe(200);
      await query("UPDATE cloud_tasks SET status='completed' WHERE id=$1", [body.taskId]);
      state.modelDenied = true;
      const replay = await post(); expect(replay.status).toBe(200);
      expect((await replay.json()).taskId).toBe(body.taskId);
      expect((await GET(new NextRequest(`http://127.0.0.1/api/agent-edit?taskId=${body.taskId}`))).status).toBe(200);
      await assertLedger(query, body.taskId);
    });
  }, 60_000);
});

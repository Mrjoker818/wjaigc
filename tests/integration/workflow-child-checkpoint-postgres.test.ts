import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

import { ensureCoreTables } from '@/lib/db-storage';
import { claimCloudTaskLease, createCloudTask, ensureCloudTaskTables, getCloudTaskForUser, updateCloudTask } from '@/lib/cloud-task-storage';
import { CANVAS_PRESET_SKILLS } from '@/lib/skill-runtime/catalog';
import { createWorkflowNode } from '@/lib/workflow-engine';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';
import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireApiAuthOrReject: async () => ({
    userId: 'editor', userRole: 'user', source: 'session',
    user: { id: 'editor', name: 'Editor', role: 'user', status: 'active', productType: 'all' },
  }),
  getInternalRequestHeaders: async () => ({}),
}));
const providerLookup = vi.hoisted(() => ({
  forModel: vi.fn(async () => null as null | Record<string, unknown>),
  forFeature: vi.fn(async () => null as null | Record<string, unknown>),
  byId: vi.fn(async () => null as null | Record<string, unknown>),
}));
const skillModelLookup = vi.hoisted(() => ({
  resolveTaskModel: vi.fn(async (providerId: string, modelId: string, userId: string) => {
    if (userId !== 'editor' || providerId !== 'provider-a'
      || (modelId !== 'chat-v1' && modelId !== 'image-v1')) {
      throw new Error('MODEL_NOT_AUTHORIZED');
    }
    const kind = modelId === 'chat-v1' ? 'chat' : 'image';
    return {
      providerId, modelId, kind, sourceType: kind,
      protocol: kind === 'chat' ? 'chat-completions' : 'images',
      executionMode: kind === 'chat' ? 'sync' : 'async',
      allowedRatios: [], allowedSizes: [], qualityOptions: [], maxOutputs: 1,
      supportsReferenceImages: false, supportsMask: false,
      outputKinds: kind === 'chat' ? ['text'] : ['png'], capabilitySources: {},
    };
  }),
}));
vi.mock('@/lib/task-core/model-catalog', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/task-core/model-catalog')>(),
  resolveTaskModel: skillModelLookup.resolveTaskModel,
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: providerLookup.forModel,
  findProviderForFeature: providerLookup.forFeature,
  findProviderById: providerLookup.byId,
}));
vi.mock('@/lib/op-log', () => ({ logError: vi.fn(), OP_ACTIONS: { WORKFLOW_EXECUTE: 'workflow' } }));

import { POST } from '@/app/api/workflow/execute/route';
import { POST as cancelChildTask } from '@/app/api/cancel-task/route';

afterEach(() => {
  vi.unstubAllGlobals();
  skillModelLookup.resolveTaskModel.mockClear();
  providerLookup.forModel.mockReset().mockResolvedValue(null);
  providerLookup.forFeature.mockReset().mockResolvedValue(null);
  providerLookup.byId.mockReset().mockResolvedValue(null);
});

const configuredTestDatabase = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
if (configuredTestDatabase) {
  requireOfflineBridgeTestDatabaseUrl(process.env);
}
const postgresIt = configuredTestDatabase ? it : it.skip;

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/workflow/execute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

postgresIt('freezes and submits the same provider-model pair inside a root subgraph', async () => {
  await withIsolatedPostgres('workflow-nested-model-pair', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    const provider = {
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    };
    providerLookup.byId.mockResolvedValue(provider);
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    const root = createWorkflowNode('subgraph', 0, 0);
    root.config.subgraph = JSON.stringify({ nodes: [child], connections: [] });
    const submissions: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ success: false, error: 'test stop' });
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [root], connections: [] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(() => expect(submissions).toHaveLength(1));
    const parent = await getCloudTaskForUser(executionId, 'editor');
    const graph = parent?.result?.executionGraph as { nodes: Array<{ config: { subgraph: { nodes: Array<{ config: Record<string, unknown> }> } } }> };
    expect(graph.nodes[0].config.subgraph.nodes[0].config).toMatchObject({ model: 'image-v1', providerId: 'provider-a' });
    expect(submissions[0]).toMatchObject({ model: 'image-v1', providerId: 'provider-a' });
  });
}, 60_000);

for (const [name, mutateChild] of [
  ['unknown nested metadata', (child: ReturnType<typeof createWorkflowNode>): void => {
    child.config.clientMetadata = { memo: 'test-only-secret-canary' };
  }],
  ['missing nested provider', (child: ReturnType<typeof createWorkflowNode>): void => {
    child.config.model = 'missing-provider::image-v1';
  }],
] as const) {
  postgresIt(`rejects ${name} before creating a parent workflow or sending`, async () => {
    await withIsolatedPostgres(`workflow-nested-reject-${name}`, async ({ databaseUrl, query }) => {
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      await ensureCoreTables();
      await ensureCloudTaskTables();
      await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
      const child = createWorkflowNode('ai-generate', 0, 0);
      child.config.model = 'provider-a::image-v1';
      child.config.prompt = 'A product photo';
      mutateChild(child);
      const root = createWorkflowNode('subgraph', 0, 0);
      root.config.subgraph = JSON.stringify({ nodes: [child], connections: [] });
      const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
      vi.stubGlobal('fetch', send);

      const started = await post({ action: 'start', projectId: 'project-1', nodes: [root], connections: [] });
      expect(started.status).toBe(422);
      expect((await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'")).rows[0].count).toBe(0);
      expect(send).not.toHaveBeenCalled();
    });
  }, 60_000);
}

postgresIt('stores the provider-model pair actually submitted by a configured image node', async () => {
  await withIsolatedPostgres('workflow-model-pair-snapshot', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    const configuredProvider = {
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    };
    providerLookup.forModel.mockResolvedValue(configuredProvider);
    providerLookup.byId.mockResolvedValue(configuredProvider);
    const node = createWorkflowNode('ai-generate', 0, 0);
    node.config.model = 'image-v1';
    node.config.prompt = 'A studio photograph of a speaker';
    const submissions: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      submissions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ success: false, error: 'test stop' });
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(() => expect(submissions).toHaveLength(1));
    const parent = await getCloudTaskForUser(executionId, 'editor');
    const graph = parent?.result?.executionGraph as { nodes: Array<{ config: Record<string, unknown> }> };
    expect(graph.nodes[0].config).toMatchObject({ model: 'image-v1', providerId: 'provider-a' });
    expect(submissions[0]).toMatchObject({ model: 'image-v1', providerId: 'provider-a' });
  });
}, 60_000);

postgresIt('rejects an unavailable explicit provider before persisting or submitting an image workflow', async () => {
  await withIsolatedPostgres('workflow-explicit-provider-unavailable', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    const node = createWorkflowNode('ai-generate', 0, 0);
    node.config.model = 'missing-provider::image-v1';
    node.config.prompt = 'A studio photograph of a speaker';
    const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
    vi.stubGlobal('fetch', send);

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    expect(started.status).toBe(422);
    expect((await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'")).rows[0].count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
}, 60_000);

postgresIt('does not switch providers when the frozen provider disappears before dispatch', async () => {
  await withIsolatedPostgres('workflow-provider-disabled-after-start', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValueOnce({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    providerLookup.forModel.mockResolvedValue({
      id: 'provider-b', name: 'Provider B', isEnabled: true,
      baseUrl: 'https://provider-b.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const node = createWorkflowNode('ai-generate', 0, 0);
    node.config.model = 'provider-a::image-v1';
    node.config.prompt = 'A studio photograph of a speaker';
    const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
    vi.stubGlobal('fetch', send);

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('failed');
    });
    expect(send).not.toHaveBeenCalled();
  });
}, 60_000);

postgresIt('does not switch providers or report success when a frozen loop provider disappears', async () => {
  await withIsolatedPostgres('workflow-loop-provider-disappears', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    const providerA = {
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    };
    const providerB = {
      id: 'provider-b', name: 'Provider B', isEnabled: true,
      baseUrl: 'https://provider-b.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    };
    providerLookup.byId.mockResolvedValueOnce(providerA).mockResolvedValue(null);
    providerLookup.forModel.mockResolvedValue(providerB);
    providerLookup.forFeature.mockResolvedValue(providerB);
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
    vi.stubGlobal('fetch', send);

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, child], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' },
    ] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('failed');
      const results = parent?.result?.results as Record<string, unknown> | undefined;
      expect(results?.[child.id]).toMatchObject({ status: 'failed', error: 'WORKFLOW_PROVIDER_UNAVAILABLE' });
    });
    expect(send).not.toHaveBeenCalled();
  });
}, 60_000);

postgresIt('rejects a loop-variable model before a billable workflow is admitted', async () => {
  await withIsolatedPostgres('workflow-loop-dynamic-model', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-{{index}}';
    child.config.prompt = 'A product photo at frame {{index}}';
    const send = vi.fn(async () => Response.json({ success: false, error: 'test stop' }));
    vi.stubGlobal('fetch', send);

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, child], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' },
    ] });
    expect(started.status).toBe(422);
    expect((await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'")).rows[0].count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
}, 60_000);

postgresIt('marks a loop child failed when its API returns a failed response', async () => {
  await withIsolatedPostgres('workflow-loop-provider-failure', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'provider failed' })));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, child], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' },
    ] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('failed');
      const results = parent?.result?.results as Record<string, unknown> | undefined;
      expect(results?.[child.id]).toMatchObject({ status: 'failed', error: 'provider failed' });
    });
  });
}, 60_000);

postgresIt('keeps a loop generation pending until its accepted child completes', async () => {
  await withIsolatedPostgres('workflow-loop-generate-child', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    let submissions = 0;
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/generate')) {
        submissions++;
        return Response.json({ success: true, taskId: 'loop-generate-child-1' });
      }
      if (url.includes('/api/poll-task')) {
        polls++;
        await pollHeld;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/generated.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, child], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' },
    ] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    try {
      await vi.waitFor(async () => {
        const parent = await getCloudTaskForUser(executionId, 'editor');
        expect(parent?.result?.activeChildTasks).toMatchObject({
          [`${executionId}:${child.id}:loop:1`]: 'loop-generate-child-1',
        });
        expect(parent?.result?.loopResume).toMatchObject({
          loopNodeId: loop.id, iterationIndex: 1, nextNodeIndex: 0,
        });
        expect(parent?.status).toBe('processing');
      });
    } finally {
      releasePoll();
    }
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }> | undefined;
      expect(results?.[child.id]?.output).toMatchObject({ imageUrl: '/api/serve-upload/generated.png', _loopIteration: 1 });
    }, { timeout: 8_000 });
    expect(submissions).toBe(1);
    expect(polls).toBeGreaterThan(0);
  });
}, 60_000);

postgresIt('checkpoints every loop generation slot before publishing their combined result', async () => {
  await withIsolatedPostgres('workflow-loop-generate-multi', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    child.config.n = 2;
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    let submissions = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/generate')) {
        submissions++;
        expect(JSON.parse(String(init?.body)).outputCount).toBe(2);
        return Response.json({ success: true, taskIds: ['loop-image-1', 'loop-image-2'] });
      }
      if (url.includes('/api/poll-task')) {
        await pollHeld;
        const { taskId } = JSON.parse(String(init?.body)) as { taskId: string };
        return Response.json({ status: 'completed', result: {
          imageUrl: `/api/serve-upload/${taskId}.png`,
        } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, child], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' },
    ] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    try {
      await vi.waitFor(async () => {
        const parent = await getCloudTaskForUser(executionId, 'editor');
        expect(parent?.result?.activeChildTasks).toMatchObject({
          [`${executionId}:${child.id}:loop:1`]: 'loop-image-1',
          [`${executionId}:${child.id}:loop:1:slot:1`]: 'loop-image-2',
        });
        expect(parent?.status).toBe('processing');
      });
    } finally {
      releasePoll();
    }
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }> | undefined;
      expect(results?.[child.id]?.output?.imageUrls).toEqual([
        '/api/serve-upload/loop-image-1.png', '/api/serve-upload/loop-image-2.png',
      ]);
    }, { timeout: 8_000 });
    expect(submissions).toBe(1);
  });
}, 60_000);

postgresIt('fails a loop generation when one of its accepted image slots fails', async () => {
  await withIsolatedPostgres('workflow-loop-generate-partial-failure', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    child.config.n = 2;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/generate')) {
        return Response.json({ success: true, taskIds: ['loop-image-good', 'loop-image-bad'] });
      }
      if (url.includes('/api/poll-task')) {
        const { taskId } = JSON.parse(String(init?.body)) as { taskId: string };
        return taskId === 'loop-image-good'
          ? Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/good.png' } })
          : Response.json({ status: 'failed', error: 'slot 2 failed' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [loop, child], connections: [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' },
    ] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('failed');
      const results = parent?.result?.results as Record<string, { status?: string; error?: string }> | undefined;
      expect(results?.[child.id]).toMatchObject({ status: 'failed', error: 'slot 2 failed' });
    }, { timeout: 8_000 });
  });
}, 60_000);

for (const [name, configUpdates, shouldPersistGraph] of [
  ['a valid partial Skill input', { inputValues: { product: 'Speaker' }, modelBindings: {
    orchestrator: { providerId: 'provider-a', modelId: 'chat-v1' },
    image: { providerId: 'provider-a', modelId: 'image-v1' },
  } }, true],
  ['an unknown nested Skill input', { inputValues: { product: 'Speaker', hiddenPayload: { memo: 'test-only-secret-canary' } } }, false],
  ['an unknown model binding', { inputValues: { product: 'Speaker' }, modelBindings: { hiddenPayload: { memo: 'test-only-secret-canary' } } }, false],
  ['a missing required image model binding', { inputValues: { product: 'Speaker' }, modelBindings: {
    orchestrator: { providerId: 'provider-a', modelId: 'chat-v1' },
  } }, false],
  ['an unauthorized image model binding', { inputValues: { product: 'Speaker' }, modelBindings: {
    orchestrator: { providerId: 'provider-a', modelId: 'chat-v1' },
    image: { providerId: 'provider-b', modelId: 'image-v1' },
  } }, false],
] as const) {
  postgresIt(`freezes ${name} only when the catalog schema accepts it`, async () => {
    await withIsolatedPostgres(`workflow-skill-graph-${name}`, async ({ databaseUrl, query }) => {
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      await ensureCoreTables();
      await ensureCloudTaskTables();
      await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
      const skill = CANVAS_PRESET_SKILLS[0];
      const node = createWorkflowNode('ai-skill', 0, 0);
      node.config = { ...node.config, skillId: skill.id, version: skill.version, ...configUpdates };
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'test stop' })));

      const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
      if (shouldPersistGraph) {
        expect(started.status).toBe(200);
        const { executionId } = await started.json();
        const parent = await getCloudTaskForUser(executionId, 'editor');
        expect(parent?.result?.executionGraph).toBeDefined();
        expect(parent?.result?.executionGraph).toMatchObject({ nodes: [{ config: {
          modelBindings: {
            orchestrator: { providerId: 'provider-a', modelId: 'chat-v1' },
            image: { providerId: 'provider-a', modelId: 'image-v1' },
          },
        } }] });
      } else {
        expect(started.status).toBe(422);
        const rows = await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'");
        expect(rows.rows[0].count).toBe(0);
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      }
    });
  }, 60_000);
}

for (const [nodeType, shouldStart] of [
  ['ai-generate', true],
  ['ai-generate', false],
  ['ai-video-generate', false],
  ['agent-auto', false],
  ['storyboard-sequence', false],
] as const) {
  postgresIt(`${shouldStart ? 'freezes' : 'rejects'} a ${nodeType} graph before billable dispatch`, async () => {
    await withIsolatedPostgres(`workflow-billable-graph-${nodeType}-${shouldStart}`, async ({ databaseUrl, query }) => {
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      await ensureCoreTables();
      await ensureCloudTaskTables();
      await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
      const node = createWorkflowNode(nodeType, 0, 0);
      if (shouldStart) node.config.prompt = 'A studio photograph of a speaker';
      else node.config.clientMetadata = { memo: 'test-only-secret-canary' };
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'test stop' })));

      const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
      if (shouldStart) {
        expect(started.status).toBe(200);
        const { executionId } = await started.json();
        const parent = await getCloudTaskForUser(executionId, 'editor');
        expect(parent?.result?.executionGraph).toMatchObject({ nodes: [{ id: node.id, type: nodeType }] });
      } else {
        expect(started.status).toBe(422);
        const rows = await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'");
        expect(rows.rows[0].count).toBe(0);
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
        expect(await started.text()).not.toContain('test-only-secret-canary');
      }
    });
  }, 60_000);
}

postgresIt('commits an accepted edit child id to the parent before polling finishes', async () => {
  await withIsolatedPostgres('workflow-child-checkpoint', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    let submitted = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) {
        submitted++;
        return Response.json({ success: true, taskId: 'edit-child-pg-1' });
      }
      if (url.includes('/api/poll-task')) {
        await pollHeld;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/result.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    expect(started.status).toBe(200);
    const { executionId } = await started.json();
    try {
      await vi.waitFor(async () => {
        expect(submitted).toBe(1);
        const parent = await getCloudTaskForUser(executionId, 'editor');
        expect(parent?.result?.activeChildTasks).toMatchObject({ [`${executionId}:${node.id}`]: 'edit-child-pg-1' });
        expect(parent?.result?.executionGraph).toMatchObject({
          nodes: [{ id: node.id, type: 'ai-edit' }],
          connections: [],
        });
        expect(parent?.status).toBe('processing');
      }, { timeout: 10_000 });
    } finally { releasePoll(); }

    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }> | undefined;
      expect(results?.[node.id]?.output).toMatchObject({ taskId: 'edit-child-pg-1' });
    }, { timeout: 10_000 });
    expect(submitted).toBe(1);
  });
}, 60_000);

postgresIt('does not persist credentials or inline image bytes in an edit execution graph', async () => {
  await withIsolatedPostgres('workflow-edit-snapshot-secrets', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = 'data:image/png;base64,c2Vuc2l0aXZlLWltYWdl';
    node.config.apiKey = 'test-only-secret-canary';
    node.config.prompt = 'Make the sky blue';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'test stop' })));

    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    expect(started.status).toBe(422);
    const rows = await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'");
    expect(rows.rows[0].count).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const responseBody = await started.text();
    expect(responseBody).not.toContain('test-only-secret-canary');
    expect(responseBody).not.toContain('c2Vuc2l0aXZlLWltYWdl');
  });
}, 60_000);

for (const [name, configUpdates, forbidden, nodeUpdates] of [
  ['embedded inline image in a prompt', { prompt: 'Paint this data:image/png;base64,c2Vuc2l0aXZlLWltYWdl' }, 'c2Vuc2l0aXZlLWltYWdl', {}],
  ['credential in generic headers', { headers: { 'x-auth': 'test-only-secret-canary' } }, 'test-only-secret-canary', {}],
  ['unrecognized client metadata', { clientMetadata: { memo: 'test-only-secret-canary' } }, 'test-only-secret-canary', {}],
  ['unrecognized node metadata', {}, 'test-only-secret-canary', { clientMetadata: { memo: 'test-only-secret-canary' } }],
] as const) {
  postgresIt(`does not persist ${name} in a recoverable graph`, async () => {
    await withIsolatedPostgres(`workflow-edit-hidden-secret-${name}`, async ({ databaseUrl, query }) => {
      const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      expect(migration.status, migration.stderr || migration.stdout).toBe(0);
      await ensureCoreTables();
      await ensureCloudTaskTables();
      await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
      const node = createWorkflowNode('ai-edit', 0, 0);
      node.config = { ...node.config, imageUrl: '/api/serve-upload/source.png', ...configUpdates };
      if (!node.config.prompt) node.config.prompt = 'Make the sky blue';
      Object.assign(node, nodeUpdates);
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, error: 'test stop' })));
      const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
      expect(started.status).toBe(422);
      const rows = await query("SELECT COUNT(*)::int AS count FROM cloud_tasks WHERE type = 'workflow'");
      expect(rows.rows[0].count).toBe(0);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
      expect(JSON.stringify(await started.json())).not.toContain(forbidden);
    });
  }, 60_000);
}

postgresIt('resumes an accepted edit child from the persisted parent without submitting it again', async () => {
  await withIsolatedPostgres('workflow-edit-child-restart', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    const executionId = `restart-parent-${crypto.randomUUID()}`;
    const childId = `restart-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${node.id}`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}`,
      type: 'edit', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 1,
        currentNodeId: node.id, startedAt: now, completedAt: null, results: {},
        executionGraph: { nodes: [node], connections: [] },
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);

    let submitted = 0;
    let polled = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) { submitted++; throw new Error('accepted child must not be resubmitted'); }
      if (url.includes('/api/poll-task')) {
        polled++;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/recovered.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    expect((await (await post({ action: 'status', executionId })).json()).status).toBe('running');
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }>;
      expect(results[node.id]?.output).toMatchObject({ taskId: childId,
        imageUrl: '/api/serve-upload/recovered.png' });
    }, { timeout: 8_000 });
    expect(submitted).toBe(0);
    expect(polled).toBeGreaterThan(0);
  });
}, 60_000);

postgresIt('keeps a completed edit child pending until its workflow output is published', async () => {
  await withIsolatedPostgres('workflow-edit-publication-wait', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    const executionId = `publication-parent-${crypto.randomUUID()}`;
    const childId = `publication-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${node.id}`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}`,
      type: 'edit', status: 'completed', progress: 100, creditStatus: 'not-applicable',
      result: { imageUrl: '/api/serve-upload/provider-raw.png' },
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 1,
        currentNodeId: node.id, startedAt: now, completedAt: null, results: {},
        executionGraph: { nodes: [node], connections: [] },
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);

    let published = false;
    let submitted = 0;
    let polled = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) { submitted++; throw new Error('accepted child must not be resubmitted'); }
      if (url.includes('/api/poll-task')) {
        polled++;
        return published
          ? Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/exports/managed.png' } })
          : Response.json({ success: true, taskId: childId, status: 'publication-pending',
            recoveryPending: true, retryAfterMs: 1500 }, { status: 202 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    expect((await (await post({ action: 'status', executionId })).json()).status).toBe('running');
    let pendingError: unknown;
    try {
      await vi.waitFor(async () => {
        const parent = await getCloudTaskForUser(executionId, 'editor');
        const results = parent?.result?.results as Record<string, { status?: string; output?: Record<string, unknown> }> | undefined;
        expect(parent?.status).toBe('processing');
        expect(results?.[node.id]).toMatchObject({ status: 'running',
          output: { taskId: childId, status: 'publication-pending' } });
      }, { timeout: 6_000 });
    } catch (error) { pendingError = error; }
    published = true;
    await vi.waitFor(async () => {
      await post({ action: 'status', executionId });
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }>;
      expect(results[node.id]?.output).toMatchObject({ taskId: childId,
        imageUrl: '/api/serve-upload/exports/managed.png' });
    }, { timeout: 12_000 });
    if (pendingError) throw pendingError;
    expect(submitted).toBe(0);
    expect(polled).toBeGreaterThanOrEqual(2);
  });
}, 35_000);

for (const { caseName, fromPortId, loopCount, resumeIteration } of [
  { caseName: 'standard first iteration', fromPortId: 'out-loop', loopCount: 1, resumeIteration: 1 },
  { caseName: 'legacy later iteration', fromPortId: 'out-item', loopCount: 2, resumeIteration: 2 },
]) {
postgresIt(`resumes every accepted loop generation slot without resubmitting the loop body (${caseName})`, async () => {
  await withIsolatedPostgres(`workflow-loop-generation-restart-${resumeIteration}`, async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = loopCount;
    loop.loopCount = loopCount;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    child.config.n = 2;
    const connections = [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId, toNodeId: child.id, toPortId: 'in-image', type: 'image' as const },
    ];
    const executionId = `loop-restart-parent-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${child.id}:loop:${resumeIteration}`;
    const taskIds = [`loop-restart-child-${crypto.randomUUID()}`, `loop-restart-child-${crypto.randomUUID()}`];
    const now = Date.now();
    for (const [index, taskId] of taskIds.entries()) {
      expect(await createCloudTask({ id: taskId, userId: 'editor', projectId: 'project-1',
        messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}:${index}`,
        type: 'generate-async', status: 'processing', progress: 0, creditStatus: 'not-applicable',
        createdAt: now, updatedAt: now })).toBe(true);
    }
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 2,
        currentNodeId: loop.id, startedAt: now, completedAt: null,
        results: { [loop.id]: { nodeId: loop.id, status: 'success',
          output: { loopCount, _loopNodeId: loop.id, activePorts: ['out-done'] }, durationMs: 0 } },
        executionGraph: { nodes: [loop, child], connections },
        loopResume: { loopNodeId: loop.id, iterationIndex: resumeIteration, nextNodeIndex: 0 },
        activeChildTasks: { [sourceEntityId]: taskIds[0], [`${sourceEntityId}:slot:1`]: taskIds[1] } },
      createdAt: now, updatedAt: now })).toBe(true);

    let submissions = 0;
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/generate')) {
        submissions++;
        throw new Error('accepted loop child must not be resubmitted');
      }
      if (url.includes('/api/poll-task')) {
        polls++;
        const { taskId } = JSON.parse(String(init?.body)) as { taskId: string };
        const imageUrl = `/api/serve-upload/${taskId}.png`;
        expect(await updateCloudTask(taskId, { status: 'completed', result: { imageUrl } })).toBe(true);
        return Response.json({ status: 'completed', result: { imageUrl } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const response = await post({ action: 'status', executionId });
    expect(response.status).toBe(200);
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('completed');
      const results = parent?.result?.results as Record<string, { output?: Record<string, unknown> }>;
      expect(results[child.id]?.output?.imageUrls).toEqual(taskIds.map(taskId => `/api/serve-upload/${taskId}.png`));
      expect(results[child.id]?.output?._loopIteration).toBe(resumeIteration);
    }, { timeout: 8_000 });
    expect(submissions).toBe(0);
    expect(polls).toBe(2);
  });
}, 60_000);
}

postgresIt('rejects a recovered loop generation child owned by another workflow', async () => {
  await withIsolatedPostgres('workflow-loop-generation-wrong-identity', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    providerLookup.byId.mockResolvedValue({
      id: 'provider-a', name: 'Provider A', isEnabled: true,
      baseUrl: 'https://provider-a.example.test', apiKey: 'test-key', selectedModels: ['image-v1'],
    });
    const loop = createWorkflowNode('loop-for', 0, 0);
    loop.config.loopCount = 1;
    loop.loopCount = 1;
    const child = createWorkflowNode('ai-generate', 0, 0);
    child.config.model = 'provider-a::image-v1';
    child.config.prompt = 'A product photo';
    const connections = [
      { id: 'loop-body', fromNodeId: loop.id, fromPortId: 'out-loop', toNodeId: child.id, toPortId: 'in-image', type: 'image' as const },
    ];
    const executionId = `loop-wrong-parent-${crypto.randomUUID()}`;
    const childId = `loop-wrong-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${child.id}:loop:1`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: 'another-workflow:node:loop:1',
      idempotencyKey: 'workflow:another-workflow:node:loop:1:0',
      type: 'generate-async', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 2,
        currentNodeId: loop.id, startedAt: now, completedAt: null,
        results: { [loop.id]: { nodeId: loop.id, status: 'success',
          output: { loopCount: 1, _loopNodeId: loop.id, activePorts: ['out-done'] }, durationMs: 0 } },
        executionGraph: { nodes: [loop, child], connections },
        loopResume: { loopNodeId: loop.id, iterationIndex: 1, nextNodeIndex: 0 },
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);

    const provider = vi.fn(async () => Response.json({ status: 'completed' }));
    vi.stubGlobal('fetch', provider);
    expect((await (await post({ action: 'status', executionId })).json()).status).toBe('running');
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('failed');
      const results = parent?.result?.results as Record<string, { status?: string; error?: string }>;
      expect(results[child.id]).toMatchObject({
        status: 'failed', error: 'WORKFLOW_CHILD_IDENTITY_MISMATCH',
      });
    }, { timeout: 8_000 });
    expect(provider).not.toHaveBeenCalled();
  });
}, 60_000);

postgresIt('does not poll or resubmit a recovered child whose workflow identity differs', async () => {
  await withIsolatedPostgres('workflow-edit-child-wrong-identity', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    const executionId = `wrong-parent-${crypto.randomUUID()}`;
    const childId = `wrong-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${node.id}`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: 'another-workflow:node', idempotencyKey: 'workflow:another-workflow:node',
      type: 'edit', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 1,
        currentNodeId: node.id, startedAt: now, completedAt: null, results: {},
        executionGraph: { nodes: [node], connections: [] },
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);

    const provider = vi.fn(async () => Response.json({ status: 'completed' }));
    vi.stubGlobal('fetch', provider);
    expect((await (await post({ action: 'status', executionId })).json()).status).toBe('running');
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('failed');
      const results = parent?.result?.results as Record<string, { status?: string; error?: string }>;
      expect(results[node.id]).toMatchObject({
        status: 'failed', error: 'WORKFLOW_CHILD_IDENTITY_MISMATCH',
      });
    }, { timeout: 8_000 });
    expect(provider).not.toHaveBeenCalled();
  });
}, 60_000);

postgresIt('does not commit a recovered edit result after another worker takes its lease', async () => {
  await withIsolatedPostgres('workflow-edit-lost-lease', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    const executionId = `lease-parent-${crypto.randomUUID()}`;
    const childId = `lease-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${node.id}`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}`,
      type: 'edit', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 1,
        currentNodeId: node.id, startedAt: now, completedAt: null, results: {},
        executionGraph: { nodes: [node], connections: [] },
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);

    let releasePoll!: () => void;
    let markPollStarted!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    const pollStarted = new Promise<void>(resolve => { markPollStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes('/api/poll-task')) throw new Error(`unexpected fetch: ${url}`);
      markPollStarted();
      await pollHeld;
      return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/late.png' } });
    }));

    expect((await (await post({ action: 'status', executionId })).json()).status).toBe('running');
    try {
      await pollStarted;
      await query('UPDATE cloud_tasks SET lease_expires_at = 0 WHERE id = $1', [executionId]);
      expect(await claimCloudTaskLease(executionId, 'new-worker', 120_000)).not.toBeNull();
    } finally { releasePoll(); }
    await new Promise(resolve => setTimeout(resolve, 1700));
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.status).toBe('processing');
      const results = parent?.result?.results as Record<string, { status?: string }>;
      expect(results[node.id]?.status).not.toBe('success');
    }, { timeout: 8_000 });
  });
}, 60_000);

postgresIt('keeps an accepted child recoverable when the parent graph was unsafe to persist', async () => {
  await withIsolatedPostgres('workflow-edit-no-graph', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const executionId = `no-graph-parent-${crypto.randomUUID()}`;
    const nodeId = 'edit-node';
    const childId = `no-graph-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${nodeId}`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: sourceEntityId, idempotencyKey: `workflow:${sourceEntityId}`,
      type: 'edit', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 1,
        currentNodeId: nodeId, startedAt: now, completedAt: null, results: {},
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);

    const provider = vi.fn(async (input: string | URL | Request) => {
      if (!String(input).includes('/api/poll-task')) throw new Error(`unexpected fetch: ${input}`);
      expect(await updateCloudTask(childId, {
        status: 'completed', result: { imageUrl: '/api/serve-upload/private-result.png' },
      })).toBe(true);
      return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/private-result.png' } });
    });
    vi.stubGlobal('fetch', provider);

    const response = await post({ action: 'status', executionId });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('paused');
    expect(provider).toHaveBeenCalledTimes(1);
    const parent = await getCloudTaskForUser(executionId, 'editor');
    expect(parent?.result?.workflowStatus).toBe('paused');
    expect(parent?.result?.activeChildTasks).toMatchObject({ [sourceEntityId]: childId });
    expect(parent?.result?.results).toMatchObject({
      [nodeId]: { status: 'running', output: { taskId: childId, status: 'publication-pending' } },
    });
    expect(JSON.stringify(parent?.result)).not.toContain('private-result.png');
  });
}, 60_000);

postgresIt('pauses a graphless parent without polling a child from another workflow', async () => {
  await withIsolatedPostgres('workflow-edit-no-graph-wrong-child', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");

    const executionId = `no-graph-parent-${crypto.randomUUID()}`;
    const nodeId = 'edit-node';
    const childId = `no-graph-child-${crypto.randomUUID()}`;
    const sourceEntityId = `${executionId}:${nodeId}`;
    const now = Date.now();
    expect(await createCloudTask({ id: childId, userId: 'editor', projectId: 'project-1',
      messageId: 'a-different-workflow:edit-node', idempotencyKey: 'workflow:a-different-workflow:edit-node',
      type: 'edit', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      createdAt: now, updatedAt: now })).toBe(true);
    expect(await createCloudTask({ id: executionId, userId: 'editor', projectId: 'project-1',
      type: 'workflow', status: 'processing', progress: 0, creditStatus: 'not-applicable',
      result: { workflowStatus: 'running', projectId: 'project-1', totalNodes: 1,
        currentNodeId: nodeId, startedAt: now, completedAt: null, results: {},
        activeChildTasks: { [sourceEntityId]: childId } },
      createdAt: now, updatedAt: now })).toBe(true);
    const provider = vi.fn(async () => { throw new Error('foreign child must not be polled'); });
    vi.stubGlobal('fetch', provider);

    const response = await post({ action: 'status', executionId });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('paused');
    expect(provider).not.toHaveBeenCalled();
    const parent = await getCloudTaskForUser(executionId, 'editor');
    expect(parent?.result?.workflowStatus).toBe('paused');
    expect(parent?.result?.activeChildTasks).toMatchObject({ [sourceEntityId]: childId });
    expect(parent?.error).toContain('WORKFLOW_CHILD_IDENTITY_MISMATCH');
  });
}, 60_000);

postgresIt('cancels a persisted edit child before finalizing the parent and rejects late output', async () => {
  await withIsolatedPostgres('workflow-child-cancel', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    const childId = 'edit-child-pg-cancel';

    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let releasePoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/edit')) {
        const submitted = JSON.parse(String(init?.body)) as { messageId: string; projectId: string };
        const now = Date.now();
        expect(await createCloudTask({ id: childId, userId: 'editor', projectId: submitted.projectId,
          messageId: submitted.messageId,
          idempotencyKey: new Headers(init?.headers).get('idempotency-key') || undefined,
          type: 'edit', status: 'processing', progress: 0, creditStatus: 'not-applicable',
          createdAt: now, updatedAt: now })).toBe(true);
        return Response.json({ success: true, taskId: childId });
      }
      if (url.includes('/api/cancel-task')) return cancelChildTask(new NextRequest(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body),
      }));
      if (url.includes('/api/poll-task')) {
        await pollHeld;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/late.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    await vi.waitFor(async () => {
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.result?.activeChildTasks).toMatchObject({ [`${executionId}:${node.id}`]: childId });
    }, { timeout: 10_000 });
    try {
      const response = await post({ action: 'cancel', executionId });
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe('cancelled');
      expect((await getCloudTaskForUser(childId, 'editor'))?.status).toBe('cancelled');
    } finally { releasePoll(); }
    await new Promise(resolve => setTimeout(resolve, 1700));
    const parent = await getCloudTaskForUser(executionId, 'editor');
    expect(parent?.result?.workflowStatus).toBe('cancelled');
    const results = parent?.result?.results as Record<string, { status?: string }> | undefined;
    expect(results?.[node.id]?.status).not.toBe('success');
  });
}, 60_000);

postgresIt('does not overwrite a paused parent written by another instance after a child poll returns', async () => {
  await withIsolatedPostgres('workflow-cross-instance-pause', async ({ databaseUrl, query }) => {
    const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
    });
    expect(migration.status, migration.stderr || migration.stdout).toBe(0);
    await ensureCoreTables();
    await ensureCloudTaskTables();
    await query("INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at) VALUES ('editor','Editor','test','active','user',1,1)");
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('project-1','editor','Project')");
    const node = createWorkflowNode('ai-edit', 0, 0);
    node.config.imageUrl = '/api/serve-upload/source.png';
    node.config.prompt = 'Make the sky blue';
    let releasePoll!: () => void;
    let markPollStarted!: () => void;
    const pollHeld = new Promise<void>(resolve => { releasePoll = resolve; });
    const pollStarted = new Promise<void>(resolve => { markPollStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/edit')) return Response.json({ success: true, taskId: 'edit-child-cross-instance' });
      if (url.includes('/api/poll-task')) {
        markPollStarted();
        await pollHeld;
        return Response.json({ status: 'completed', result: { imageUrl: '/api/serve-upload/late.png' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const started = await post({ action: 'start', projectId: 'project-1', nodes: [node], connections: [] });
    const { executionId } = await started.json();
    try {
      await pollStarted;
      const parent = await getCloudTaskForUser(executionId, 'editor');
      expect(parent?.result?.activeChildTasks).toMatchObject({ [`${executionId}:${node.id}`]: 'edit-child-cross-instance' });
      expect(await updateCloudTask(executionId, {
        status: 'processing', mergeResult: true,
        result: { workflowStatus: 'paused' }, error: 'Another instance paused this workflow',
      })).toBe(true);
    } finally { releasePoll(); }
    await new Promise(resolve => setTimeout(resolve, 1700));
    const parent = await getCloudTaskForUser(executionId, 'editor');
    expect(parent?.result?.workflowStatus).toBe('paused');
    const results = parent?.result?.results as Record<string, { status?: string }> | undefined;
    expect(results?.[node.id]?.status).not.toBe('success');
    const visible = await post({ action: 'status', executionId });
    expect((await visible.json()).status).toBe('paused');
  });
}, 60_000);

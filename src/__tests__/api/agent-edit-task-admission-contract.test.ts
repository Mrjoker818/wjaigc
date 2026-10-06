import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

vi.hoisted(async () => {
  if (process.env.POSTGRES_TEST_DATABASE_URL) {
    const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL);
    if (!['127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Explicit loopback test database required');
    const { mkdtempSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = process.env.WUJIE_DATA_DIR || tmpdir();
    mkdirSync(root, { recursive: true });
    process.env.WUJIE_DATA_DIR = mkdtempSync(join(root, 'intent-edit-'));
  }
});
vi.mock('server-only', () => ({}));
const admissionActor = vi.hoisted(() => ({ id: 'editor', name: 'Editor', role: 'user' as const,
  status: 'active' as const, productType: 'canvas,chat', createdAt: 1, updatedAt: 1 }));
vi.mock('@/lib/api-auth', () => ({ requireApiAuthOrReject: async () => ({
  authenticated: true, userId: admissionActor.id, userRole: 'user', source: 'internal', user: admissionActor,
}) }));
vi.mock('@/lib/server-auth', async original => ({
  ...await original<typeof import('@/lib/server-auth')>(), getSessionUser: async () => admissionActor,
}));
vi.mock('@/lib/task-core/model-catalog', () => ({ resolveTaskModel: async (providerId: string, modelId: string) => ({
  providerId, modelId, kind: providerId === 'chat-provider' ? 'chat' : 'image', sourceType: 'chat',
  protocol: 'chat-completions', executionMode: 'sync', allowedRatios: [], allowedSizes: [], qualityOptions: [],
  maxOutputs: 1, supportsReferenceImages: true, supportsMask: false, outputKinds: ['text'], capabilitySources: {},
}) }));
vi.mock('@/lib/credits', async original => ({
  ...await original<typeof import('@/lib/credits')>(), calculateConfiguredCreditCost: async () => 7,
}));
// Stop at the dispatch boundary: admission, private descriptor and billing remain real.
vi.mock('@/lib/agent-runtime/surface-dispatch', () => ({
  prepareAdmittedAgentTaskExecution: async () => ({ execute: async () => undefined }),
}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: () => undefined }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

import {
  AgentContextNotFoundError,
  resolveOptionalSelectedAgentMediaUrl,
} from '@/lib/agent-runtime/context-adapters';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-runtime/agent-edit-execution-service.ts'),
  'utf8',
);
const persistenceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-task-persistence.ts'),
  'utf8',
);
const chatRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/chat/route.ts'),
  'utf8',
);
const providerSubmissionSource = readFileSync(
  resolve(process.cwd(), 'src/lib/agent-runtime/provider-submission.ts'),
  'utf8',
);

describe.runIf(!!process.env.POSTGRES_TEST_DATABASE_URL)('real agent-edit publication admission', () => {
  it('persists revision with append and does not inject publication for a personal canvas', async () => {
    const { withIsolatedPostgres } = await import('../../../tests/helpers/postgres-test-database');
    const { ensureCoreTables } = await import('@/lib/db-storage');
    const { POST } = await import('@/lib/agent-runtime/agent-edit-execution-service');
    const { NextRequest } = await import('next/server');
    await withIsolatedPostgres('intent-agent-edit', async ({ query, databaseUrl, schemaName }) => {
      console.log('Agent-edit isolation:', schemaName, process.env.WUJIE_DATA_DIR);
      const migrated = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
        encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
      });
      console.log('Full migrations:', migrated.status, migrated.stdout, migrated.stderr);
      expect(migrated.status).toBe(0);
      await ensureCoreTables();
      await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,product_type,created_at,updated_at)
        VALUES ('owner','Owner','test','active','user','canvas,chat',1,1),('editor','Editor','test','active','user','canvas,chat',1,1),
        ('fixture-admin',$1,'test','active','admin','canvas,chat',1,1)`, [process.env.WUJIE_ADMIN_USERNAME || 'Mr.joker']);
      await query(`INSERT INTO wujie_projects(id,owner_id,name) VALUES ('shared','owner','Shared'),('personal','editor','Personal')`);
      await query(`INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('shared','owner',true)`);
      await query(`INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('shared','owner','editor')`);
      await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
        SELECT 'credits_'||id,id,100,100,0,1,1 FROM wujie_users`);
      for (const [projectId, ownerId] of [['shared', 'owner'], ['personal', 'editor']]) {
        await query(`INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ($1,$2,$3,'image')`, [`asset-${projectId}`, ownerId, projectId]);
        await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
          VALUES ($1,$2,$3,$4,'/api/serve-upload/shared.png','image/png')`, [`version-${projectId}`, `asset-${projectId}`, ownerId, projectId]);
        await query(`INSERT INTO wujie_workspace_placements
          (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
          VALUES ($1,$2,$3,$4,$5,'canvas',$3,'canvas-image',$6)`,
        [`placement-${projectId}`, ownerId, projectId, `asset-${projectId}`, `version-${projectId}`, `image-${projectId}`]);
      }
      await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection) VALUES ('shared','owner',$1)`,
      [{ placements: { 'placement-shared': { assetVersionId: 'version-shared', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0 } } }]);
      vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
      vi.stubEnv('WUJIE_AGENT_RUNTIME_MODE', 'agent-v2');
      vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
      for (const projectId of ['shared', 'personal']) {
        const response = await POST(new NextRequest('http://127.0.0.1/api/agent-edit', {
          method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `edit-${projectId}` },
          body: JSON.stringify({ projectId, image: '/api/serve-upload/shared.png', prompt: 'Make it blue',
            providerId: 'chat-provider', model: 'chat-model', imageProviderId: 'image-provider', imageModel: 'image-model',
            selectedEntityId: `image-${projectId}`, assetParentVersionIds: [`version-${projectId}`], assetProjectionMode: 'revision' }),
        }));
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        const publications = (await query(`SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1`, [body.taskId])).rows;
        if (projectId === 'shared') expect(publications).toEqual([{ publication_intent: {
          version: 1, parentVersionIds: ['version-shared'], projectionMode: 'revision',
          placement: { action: 'attach', transform: { x: 132, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }, strideX: 132 },
        } }]);
        else expect(publications).toEqual([]);
      }
      expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions ORDER BY created_at')).rows)
        .toEqual([{ user_id: 'editor', type: 'consume', amount: -7 }, { user_id: 'editor', type: 'consume', amount: -7 }]);
    });
  }, 60_000);
});

describe('agent edit task admission contract', () => {
  it('validates content safety before any credit admission', () => {
    const safety = routeSource.indexOf('checkPromptSafety(prompt)');
    const atomicAdmission = routeSource.indexOf('createBillableTask({');

    expect(safety).toBeGreaterThan(0);
    expect(routeSource).not.toContain('consumeCredits(');
    expect(atomicAdmission).toBeGreaterThan(safety);
  });

  it('uses guarded atomic admission and reuses duplicate requests', () => {
    expect(routeSource).toContain('executeTaskEntryMigration<AgentAdmission>({');
    expect(routeSource).toContain('createBillableTask({');
    expect(routeSource).toContain('admission.value.reused');
    expect(routeSource).toContain("code: 'AGENT_TASK_TERMINAL'");
  });

  it('does not expose terminal state before durable settlement', () => {
    expect(routeSource).not.toMatch(/void\s+recordAgentTaskTerminal/);
    expect(routeSource).toContain('await recordAgentTaskTerminal(taskId');
    expect(routeSource).not.toMatch(
      /localTaskStore\.set\(taskId,\s*\{[\s\S]{0,350}?status:\s*'failed'[\s\S]{0,350}?await recordAgentTaskTerminal\(taskId/,
    );
  });

  it('contains timeout persistence failures instead of creating an unhandled rejection', () => {
    expect(routeSource).toContain('[agent-edit] timeout persistence failed:');
  });

  it('settles failed agent tasks atomically and charges only completed tasks', () => {
    expect(persistenceSource).toContain('await settleFailedTask({');
    expect(persistenceSource).toContain("creditStatus: 'charged'");
  });

  it('uses the same atomic admission in legacy and core modes without a detached charge', () => {
    expect(routeSource).toContain('legacy: atomicAdmission');
    expect(routeSource).toContain('coreV2: atomicAdmission');
    expect(routeSource).not.toContain('recordAgentTaskSubmitted({');
    expect(routeSource).toContain('if (localTaskId && newlyAdmittedTask)');
  });

  it('returns completed replays before same-task adoption in every runtime mode', () => {
    const replay = routeSource.indexOf("admission.value.status === 'completed'");
    const adoption = routeSource.indexOf('prepareAdmittedAgentTaskExecution({');
    expect(replay).toBeGreaterThan(0);
    expect(replay).toBeLessThan(adoption);
  });

  it('bounds and replays an owned terminal task before current model or placement authorization', () => {
    const auth = routeSource.indexOf('requireApiAuthOrReject(request)');
    const bounds = routeSource.indexOf('parseBoundedAgentSurfaceBody', auth);
    const replayLookup = routeSource.indexOf('getCloudTaskForUserByIdempotencyKey', bounds);
    const modelAuthorization = routeSource.indexOf('resolveTaskModel(', replayLookup);
    const placementAuthorization = routeSource.indexOf('admitAuthorizedAgentExecution({', replayLookup);

    expect(bounds).toBeGreaterThan(auth);
    expect(replayLookup).toBeGreaterThan(bounds);
    expect(replayLookup).toBeLessThan(modelAuthorization);
    expect(replayLookup).toBeLessThan(placementAuthorization);
  });

  it('never normalizes exact agent-v2 chat or image model spelling', () => {
    expect(routeSource).toContain('strictProviderModel ? imageModel : normalizeModelForApi(imageModel)');
    expect(routeSource).toContain('pureImageModel,');
    expect(routeSource).toContain('strictProviderModel ? exactImageModel : stripProviderModelPrefix(exactImageModel)');
  });

  it('requires agent-edit media while canvas chat only binds an authorized single selection', () => {
    expect(routeSource).toContain('resolveSelectedAgentMediaUrl(authorizedContext, selectedEntityIds)');
    expect(chatRouteSource).toContain(
      'resolveOptionalSelectedAgentMediaUrl(authorizedContext, input.taskContext.selectedEntityIds || [])',
    );
    expect(chatRouteSource).not.toContain(
      'resolveSelectedAgentMediaUrl(authorizedContext, input.taskContext.selectedEntityIds || [])',
    );

    const authorized = {
      snapshot: { selectedEntityIds: ['entity-a'], visibleVersionIds: [], locale: 'zh-CN' as const },
      mediaByVersionId: { 'version-a': 'https://media.example.com/a.png' },
      selectedEntityVersionIds: { 'entity-a': 'version-a' },
    };

    expect(resolveOptionalSelectedAgentMediaUrl(authorized, [])).toBeUndefined();
    expect(resolveOptionalSelectedAgentMediaUrl(authorized, ['entity-a', 'entity-b'])).toBeUndefined();
    expect(resolveOptionalSelectedAgentMediaUrl(authorized, ['entity-a']))
      .toBe('https://media.example.com/a.png');
    expect(() => resolveOptionalSelectedAgentMediaUrl(authorized, ['missing-entity']))
      .toThrow(AgentContextNotFoundError);
  });

  it('never retries a strict provider submit at an alternate v1 endpoint', () => {
    expect(routeSource).toContain("skipV1Retry: agentRuntimeMode === 'agent-v2'");
    expect(routeSource.match(/submitAgentImageProviderRequest\(\{/g)).toHaveLength(3);
    expect(providerSubmissionSource).toContain('skipV1Retry: strictProviderModel');
  });

  it('carries stable idempotency on every Agent provider-facing submit', () => {
    expect(routeSource).toContain("headers['Idempotency-Key'] = stepContext.idempotencyKey");
    expect(routeSource).not.toContain("`${operationContext.idempotencyKey}:${stepKey}`");
    expect(routeSource).toContain('submitStrictAgentGeneration({');
    expect(routeSource).toContain('model: String(pureImageModel)');
    expect(routeSource).toContain('await stepContext.recordAccepted(genTaskId)');
    expect(routeSource).toContain('recovery: {');
    expect(routeSource).not.toContain('model: imageModel,\n                  providerId: imageProviderId');
    expect(routeSource).toContain("'Idempotency-Key': providerIdempotencyKey");
  });

  it('owns every provider-facing tool call with a durable child operation', () => {
    for (const toolId of [
      'upscale',
      'remove_background',
      'svg_trace',
      'generate_image',
      'generate_video',
      'extend_video',
    ]) {
      expect(routeSource).toContain(`toolId: '${toolId}'`);
    }
    expect(routeSource).not.toContain("getInternalApiUrl(`/api/poll-task?taskId=${vTaskId}`)");
    expect(routeSource).not.toContain("getInternalApiUrl(`/api/poll-task?taskId=${exTaskId}`)");
    expect(routeSource).toContain('await stepContext.recordAccepted(providerTaskId)');
  });

  it('propagates an Agent-v2 provider exception to the durable adapter for one terminal settlement', () => {
    expect(routeSource).toMatch(
      /console\.error\('\[agent-edit\] Error:'[\s\S]{0,200}?if \(agentRuntimeMode === 'agent-v2'\) throw err;[\s\S]{0,300}?await recordAgentTaskTerminal\(taskId/,
    );
  });
});

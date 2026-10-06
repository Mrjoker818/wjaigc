import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';
import { resolveComplianceRuleSet } from '@/lib/platform-compliance/rules';
import type { User } from '@/lib/user-types';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';

vi.mock('server-only', () => ({}));

interface RetryProducer {
  kind: 'start' | 'completion' | 'failure-record';
  settled: boolean;
  failed: boolean;
  error?: unknown;
  observation: Promise<void>;
}

interface RetryLifetimeScope {
  projectionEntered: boolean;
  gate: { promise: Promise<void>; release(): void };
  producers: RetryProducer[];
}

// Observe the singleton's real asynchronous producers before it captures its
// dependencies. All transport, SQL, results and original promises stay real.
const retryLifetime = vi.hoisted(() => ({
  scopes: new Map<string, RetryLifetimeScope>(),
  observe(scope: RetryLifetimeScope, kind: RetryProducer['kind'], promise: Promise<unknown>): void {
    const producer: RetryProducer = {
      kind, settled: false, failed: false, observation: Promise.resolve(),
    };
    producer.observation = promise.then(
      () => { producer.settled = true; },
      error => { producer.settled = true; producer.failed = true; producer.error = error; },
    );
    scope.producers.push(producer);
  },
}));

vi.mock('@/lib/agent-runtime/execution-dispatch', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/agent-runtime/execution-dispatch')>();
  return {
    ...real,
    async dispatchResumedAgentExecution(
      ...args: Parameters<typeof real.dispatchResumedAgentExecution>
    ): ReturnType<typeof real.dispatchResumedAgentExecution> {
      const scope = retryLifetime.scopes.get(args[0].runId);
      const start = real.dispatchResumedAgentExecution(...args);
      if (scope) retryLifetime.observe(scope, 'start', start);
      const result = await start;
      if (scope && result.completion) retryLifetime.observe(scope, 'completion', result.completion);
      return result;
    },
    recordResumedAgentExecutionCompletionFailure(
      ...args: Parameters<typeof real.recordResumedAgentExecutionCompletionFailure>
    ): ReturnType<typeof real.recordResumedAgentExecutionCompletionFailure> {
      const result = real.recordResumedAgentExecutionCompletionFailure(...args);
      const scope = retryLifetime.scopes.get(args[0].runId);
      if (scope) retryLifetime.observe(scope, 'failure-record', result);
      return result;
    },
  };
});

vi.mock('@/lib/cloud-task-persistence', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/cloud-task-persistence')>();
  return {
    ...real,
    async projectPersistedCompletedTask(
      ...args: Parameters<typeof real.projectPersistedCompletedTask>
    ): ReturnType<typeof real.projectPersistedCompletedTask> {
      const scope = retryLifetime.scopes.get(args[0]);
      if (scope) {
        scope.projectionEntered = true;
        await scope.gate.promise;
      }
      return real.projectPersistedCompletedTask(...args);
    },
  };
});

async function drainRetryProducers(scope: RetryLifetimeScope): Promise<void> {
  for (;;) {
    const count = scope.producers.length;
    await Promise.allSettled(scope.producers.map(producer => producer.observation));
    // A rejected completion can schedule a real failure-recorder in the
    // runtime's catch chain; observe that chain before declaring it drained.
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn));
    if (scope.producers.length === count && scope.producers.every(producer => producer.settled)) return;
  }
}

async function withComplianceRetryLifetime(runId: string, body: () => Promise<void>): Promise<void> {
  const scope: RetryLifetimeScope = {
    projectionEntered: false, gate: createGate(), producers: [],
  };
  expect(retryLifetime.scopes.has(runId)).toBe(false);
  retryLifetime.scopes.set(runId, scope);
  const errors: unknown[] = [];
  try {
    await body();
    await waitFor(async () => scope.projectionEntered, entered => entered);
    expect(scope.producers.filter(producer => producer.kind === 'completion')).toHaveLength(1);
    scope.gate.release();
    await drainRetryProducers(scope);
    expect(scope.producers.filter(producer => !producer.settled),
      'The retry fixture must own all real background execution before returning to schema cleanup',
    ).toHaveLength(0);
  } catch (error) {
    errors.push(error);
  } finally {
    scope.gate.release();
    await drainRetryProducers(scope);
    retryLifetime.scopes.delete(runId);
    errors.push(...scope.producers.filter(producer => producer.failed).map(producer => producer.error));
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Compliance retry body and background execution failed');
}

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

function migrate(databaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

interface ComplianceScenario {
  projectId: string;
  workspaceId: string;
  sourceVersionIds: [string, string, string];
}

function complianceInput(
  userId: string,
  idempotencyKey: string,
  scenario: ComplianceScenario = {
    projectId: 'project-compliance',
    workspaceId: 'canvas-compliance',
    sourceVersionIds: ['source-a', 'source-b', 'source-c'],
  },
): {
  actor: User;
  request: SkillRunRequest;
} {
  return {
    actor: {
      id: userId, name: 'Compliance PostgreSQL user', role: 'user', status: 'active',
      productType: 'canvas,chat', createdAt: 1, updatedAt: 1,
    },
    request: {
      skillId: 'preset-platform-compliance-audit', skillVersion: 1, surface: 'canvas',
      projectId: scenario.projectId, workspaceId: scenario.workspaceId,
      inputValues: {
        sourceImages: scenario.sourceVersionIds, platform: 'Amazon', region: 'US',
        assetType: 'main', productCategory: '', productFacts: '事实', claims: '声明',
        reportLanguage: '中文',
      },
      sourceVersionIds: scenario.sourceVersionIds,
      modelBindings: {
        orchestrator: { providerId: 'pear-vision', modelId: 'vision-model' },
        vision: { providerId: 'pear-vision', modelId: 'vision-model' },
      },
      idempotencyKey,
    },
  };
}

async function seedProductionComplianceInputs(
  query: (sql: string, values?: unknown[]) => Promise<unknown>,
  userId: string,
  providerBaseUrl = 'http://127.0.0.1:9/v1',
  namespace = '',
): Promise<{ imageDataBySource: Record<string, string>; scenario: ComplianceScenario }> {
  const now = Date.now();
  const prefix = namespace ? `${namespace}-` : '';
  const scenario: ComplianceScenario = {
    projectId: `${prefix}project-compliance`,
    workspaceId: `${prefix}canvas-compliance`,
    sourceVersionIds: [`${prefix}source-a`, `${prefix}source-b`, `${prefix}source-c`],
  };
  const fixtures: Record<string, string> = {
    [scenario.sourceVersionIds[0]]: 'amazon-main-pass.png',
    [scenario.sourceVersionIds[1]]: 'amazon-main-alpha.png',
    [scenario.sourceVersionIds[2]]: 'amazon-main-offwhite.png',
  };
  const imageDataBySource = Object.fromEntries(Object.entries(fixtures).map(([sourceId, file]) => {
    const bytes = readFileSync(resolve(
      process.cwd(), `src/__tests__/fixtures/platform-compliance/${file}`,
    ));
    return [sourceId, `data:image/png;base64,${bytes.toString('base64')}`];
  }));
  await query(
    `INSERT INTO wujie_users(
       id, name, password_hash, role, status, product_type, api_permissions,
       storage_folder, created_at, updated_at
     ) VALUES
       ('admin_mr_joker', 'Mr.joker', 'test-only', 'admin', 'active', 'canvas,chat',
        '{"image":true,"chat":true,"vlm":true}'::jsonb, 'data/users/admin_mr_joker', $4, $4),
       ($1, $2, 'test-only', 'user', 'active', 'canvas,chat',
        '{"image":true,"chat":true,"vlm":true}'::jsonb, $3, $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [userId, `Compliance ${userId}`, `data/users/${userId}`, now],
  );
  await query(
    `INSERT INTO wujie_api_providers(
       id, name, display_name, base_url, api_key, is_enabled, type, model_type,
       request_style, selected_models, advanced_params, is_default, created_at,
       updated_at, discovered_models, sort_order
     ) VALUES (
       'pear-vision', 'Task10 Vision', 'Task10 Vision', $4,
       'test-only', true, 'vlm', 'vlm', 'chat-completions', $1::text[], '{}'::jsonb,
       true, $2, $2, $3::jsonb, 0
     ) ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
    [['vision-model'], now, JSON.stringify([{
      id: 'vision-model', name: 'vision-model', displayName: 'Task10 Vision',
      providerId: 'pear-vision', type: 'vlm', maxImages: 1, maxReferenceImages: 20,
      outputKinds: ['text'],
    }]), providerBaseUrl],
  );
  await query(
    `INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, 'Task10 compliance')`,
    [scenario.projectId, userId],
  );
  for (const sourceId of Object.keys(fixtures)) {
    const assetId = `asset-${sourceId}`;
    await query(
      `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, current_version_id)
       VALUES ($1, $2, $3, 'image', 'active', NULL)`,
      [assetId, userId, scenario.projectId],
    );
    await query(
      `INSERT INTO wujie_asset_versions(
         id, asset_id, owner_id, project_id, file_url, availability, mime_type,
         byte_size, width, height, idempotency_key, metadata
       ) VALUES ($1, $2, $3, $4, $5, 'ready', 'image/png',
         $6, 1200, 1200, $7, jsonb_build_object('requestDigest', $7::text))`,
      [sourceId, assetId, userId, scenario.projectId, imageDataBySource[sourceId],
        Buffer.from(imageDataBySource[sourceId]!.split(',')[1]!, 'base64').byteLength,
        `seed-${sourceId}`],
    );
    await query('UPDATE wujie_assets SET current_version_id = $1 WHERE id = $2', [sourceId, assetId]);
    await query(
      `INSERT INTO wujie_workspace_placements(
         id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id, status, transform, metadata
       ) VALUES ($1, $2, $3, $4, $5, 'canvas',
         $6, 'canvas-image', $7, 'active', '{}'::jsonb, '{}'::jsonb)`,
      [`placement-${sourceId}`, userId, scenario.projectId, assetId, sourceId,
        scenario.workspaceId, `entity-${sourceId}`],
    );
  }
  return { imageDataBySource, scenario };
}

interface ProviderCall {
  sourceVersionId: string | null;
  requestId: string | null;
  attempt: number;
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function startControlledProvider(input: {
  imageDataBySource: Record<string, string>;
  respond?: (call: ProviderCall) => Promise<number> | number;
}) {
  const calls: ProviderCall[] = [];
  const attempts = new Map<string, number>();
  const rules = resolveComplianceRuleSet({
    platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
  }).rules.filter(rule => rule.evaluator === 'vision');
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const body = await readRequestJson(request);
      const serialized = JSON.stringify(body);
      const sourceVersionId = Object.entries(input.imageDataBySource)
        .find(([, dataUrl]) => serialized.includes(dataUrl))?.[0] ?? null;
      const attempt = sourceVersionId
        ? (attempts.get(sourceVersionId) || 0) + 1
        : 1;
      if (sourceVersionId) attempts.set(sourceVersionId, attempt);
      const call = {
        sourceVersionId,
        requestId: typeof request.headers['x-request-id'] === 'string'
          ? request.headers['x-request-id'] : null,
        attempt,
      };
      calls.push(call);
      const status = await input.respond?.(call) ?? 200;
      response.statusCode = status;
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-request-id', sourceVersionId
        ? `provider-${sourceVersionId}-${attempt}` : 'provider-orchestrator-1');
      if (status !== 200) {
        response.end(JSON.stringify({ error: { message: 'controlled provider failure' } }));
        return;
      }
      const content = sourceVersionId
        ? JSON.stringify({ checks: rules.map(rule => ({
            ruleId: rule.id, status: 'passed', evidence: [`observed=${sourceVersionId}`],
            measuredValue: 'compliant', confidence: 0.99, remediation: null,
          })) })
        : '合规检查计划';
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch {
      response.statusCode = 500;
      response.end('{}');
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close(error => (
      error ? rejectClose(error) : resolveClose()
    ))),
  };
}

async function seedCredits(
  query: (sql: string, values?: unknown[]) => Promise<unknown>,
  userId: string,
): Promise<void> {
  const now = Date.now();
  await query(
    `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
     VALUES ($1, $2, 100, 100, 0, $3, $3)`,
    [`credits-${randomUUID()}`, userId, now],
  );
}

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
    value = await read();
  }
  expect(accept(value)).toBe(true);
  return value;
}

function createBarrier(parties: number): { wait(): Promise<void> } {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolveReady => { release = resolveReady; });
  return {
    async wait() {
      arrived += 1;
      if (arrived === parties) release();
      await ready;
    },
  };
}

function createGate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>(resolveGate => { release = resolveGate; });
  return { promise, release };
}

async function createProductionAgentRuntime(
  options: {
    transitionTask?: typeof import('@/lib/task-core/task-service').transitionTask;
    recordDispatchCompletionFailure?: import('@/lib/agent-runtime/service').AgentRuntimeDependencies['recordDispatchCompletionFailure'];
  } = {},
) {
  const [agentService, eventStorage, taskStorage, billing, taskService, modelCatalog, contextAdapters, credits, taskAbort, runRequest, executionDispatch] = await Promise.all([
    import('@/lib/agent-runtime/service'),
    import('@/lib/agent-runtime/event-storage'),
    import('@/lib/cloud-task-storage'),
    import('@/lib/task-core/billing-service'),
    import('@/lib/task-core/task-service'),
    import('@/lib/task-core/model-catalog'),
    import('@/lib/agent-runtime/context-adapters'),
    import('@/lib/credits'),
    import('@/lib/task-core/task-abort'),
    import('@/lib/skill-runtime/run-request'),
    import('@/lib/agent-runtime/execution-dispatch'),
  ]);
  const runtime = agentService.createAgentRuntimeService({
    randomUUID,
    now: Date.now,
    resolveTaskModel: modelCatalog.resolveTaskModel,
    authorizeContext: contextAdapters.authorizeAgentContext,
    calculateCreditCost: credits.calculateConfiguredCreditCost,
    createBillableTask: billing.createBillableTask,
    appendEvent: eventStorage.appendAgentEvent,
    transitionControl: eventStorage.transitionAgentRunControl,
    listEvents: eventStorage.listAgentEventsForActor,
    observeAdoptedTerminal: eventStorage.observeAdoptedAgentTaskTerminal,
    listRunEventStreams: eventStorage.listAgentEventStreamsForActor,
    getTaskForUser: taskStorage.getCloudTaskForUser,
    transitionTask: options.transitionTask || taskService.transitionTask,
    settleFailedTask: billing.settleFailedTask,
    abortTaskExecution: taskAbort.abortTaskExecution,
    dispatchExecution: executionDispatch.dispatchResumedAgentExecution,
    recordDispatchCompletionFailure: options.recordDispatchCompletionFailure
      || executionDispatch.recordResumedAgentExecutionCompletionFailure,
  });
  return {
    runtime,
    createSkillRun(input: { actor: User; request: SkillRunRequest }) {
      return runRequest.createSkillRun(input, {
        resolveTaskModel: modelCatalog.resolveTaskModel,
        authorizeContext: contextAdapters.authorizeAgentContext,
        calculateCreditCost: credits.calculateConfiguredCreditCost,
        createAgentRun: runtime.createRun,
      });
    },
  };
}

async function dispatchComplianceWithRuntime(input: {
  actorUserId: string;
  runId: string;
  mediaByVersionId: Readonly<Record<string, string>>;
  runtime: Awaited<ReturnType<typeof createProductionAgentRuntime>>['runtime'];
}) {
  const [skillService, taskStorage, eventStorage, continuation, sameTask, stepRegistry] = await Promise.all([
    import('@/lib/skill-runtime/service'),
    import('@/lib/cloud-task-storage'),
    import('@/lib/agent-runtime/event-storage'),
    import('@/lib/skill-runtime/continuation'),
    import('@/lib/agent-runtime/same-task-adapter'),
    import('@/lib/skill-runtime/step-registry'),
  ]);
  return skillService.dispatchSkillRunExecution({
    actorUserId: input.actorUserId,
    runId: input.runId,
  }, {
    getTaskForUser: taskStorage.getCloudTaskForUser,
    getRecoverableDispatch: eventStorage.getRecoverableAgentExecutionDispatch,
    loadContinuation: async loadInput => {
      const loaded = await continuation.loadPersistedSkillContinuation(loadInput);
      const registry = stepRegistry.createProductionSkillStepRegistry({
        actor: loaded.actor,
        request: loaded.request,
        mediaByVersionId: input.mediaByVersionId,
      });
      return {
        ...loaded,
        execute: context => skillService.executeSkillRun({
          actor: loaded.actor,
          request: loaded.request,
          runId: loadInput.runId,
          operationContext: context,
          stepAdapters: registry.stepAdapters,
          stepRecoveries: registry.stepRecoveries,
          resumeFromStepId: loadInput.nextStepId,
          definition: loaded.definition,
          appendRunEvent: input.runtime.appendEvent,
        }).then(() => undefined),
      };
    },
    claimExecution: eventStorage.claimAdoptedAgentExecution,
    claimDispatch: eventStorage.claimResumedAgentExecutionDispatch,
    getProjection: input.runtime.getRun,
    executeAdopted: sameTask.executeAdoptedAgentTask,
    failDispatch: eventStorage.failResumedAgentExecutionDispatch,
  });
}

describe('platform compliance accounting on isolated PostgreSQL', () => {
  postgresIt('rejects compliance_audit from the real non-Skill service before task creation or charge', async () => {
    await withIsolatedPostgres('platform_compliance_non_skill_denied', async ({ databaseUrl, query }) => {
      const [core, taskStorage, agentService] = await Promise.all([
        import('@/lib/db-storage'),
        import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-denied-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);

      await expect(agentService.createAgentRun({
        actor: complianceInput(userId, 'unused', seeded.scenario).actor,
        request: {
          projectId: seeded.scenario.projectId,
          workspace: 'canvas',
          workspaceId: seeded.scenario.workspaceId,
          mode: 'agent',
          providerId: 'pear-vision',
          modelId: 'vision-model',
          prompt: 'Run a platform compliance audit',
          sourceVersionIds: seeded.scenario.sourceVersionIds,
          allowedToolIds: ['compliance_audit'],
          idempotencyKey: `plain-agent-denied-${randomUUID()}`,
          context: {
            selectedEntityIds: [],
            visibleVersionIds: seeded.scenario.sourceVersionIds,
            locale: 'zh-CN',
          },
        },
      })).rejects.toMatchObject({
        code: 'AGENT_TOOL_AUTHORIZATION_DENIED',
        status: 403,
        denials: [{ toolId: 'compliance_audit', code: 'SKILL_ADMISSION_REQUIRED' }],
      });
      const [tasks, consumes] = await Promise.all([
        query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM cloud_tasks WHERE user_id = $1',
          [userId],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
           WHERE user_id = $1 AND type = 'consume'`,
          [userId],
        ),
      ]);
      expect(tasks.rows[0]?.count).toBe('0');
      expect(consumes.rows[0]?.count).toBe('0');
    });
  }, 60_000);

  postgresIt('enters through production createSkillRun for same-user and cross-user idempotency', async () => {
    await withIsolatedPostgres('platform_compliance_create_idempotency', async ({ databaseUrl, query }) => {
      const [core, taskStorage, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const firstUser = `compliance-create-a-${randomUUID()}`;
      const secondUser = `compliance-create-b-${randomUUID()}`;
      const firstSeed = await seedProductionComplianceInputs(query, firstUser, undefined, 'create-a');
      const secondSeed = await seedProductionComplianceInputs(query, secondUser, undefined, 'create-b');
      await Promise.all([seedCredits(query, firstUser), seedCredits(query, secondUser)]);
      const key = `shared-key-${randomUUID()}`;
      const firstInput = complianceInput(firstUser, key, firstSeed.scenario);
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () => skillService.createSkillRun(firstInput)),
      );
      const runId = attempts[0]!.runId;
      expect(new Set(attempts.map(result => result.runId))).toHaveLength(1);
      expect(attempts.filter(result => result.charged)).toHaveLength(1);

      const [tasks, consumes] = await Promise.all([
        query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM cloud_tasks WHERE user_id = $1 AND idempotency_key = $2',
          [firstUser, key],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM wujie_credit_transactions
           WHERE user_id = $1 AND task_id = $2 AND type = 'consume'`,
          [firstUser, runId],
        ),
      ]);
      expect(tasks.rows[0]?.count).toBe('1');
      expect(consumes.rows[0]?.count).toBe('1');

      const crossUser = await skillService.createSkillRun(
        complianceInput(secondUser, key, secondSeed.scenario),
      );
      expect(crossUser.runId).not.toBe(runId);
      await expect(skillService.createSkillRun({
        ...firstInput,
        request: {
          ...firstInput.request,
          inputValues: { ...firstInput.request.inputValues, claims: 'different digest' },
        },
      })).rejects.toMatchObject({ status: 409 });

      const crossUserRows = await query<{ user_id: string; count: string }>(
        `SELECT user_id, COUNT(*)::text AS count FROM cloud_tasks
         WHERE idempotency_key = $1 GROUP BY user_id ORDER BY user_id`,
        [key],
      );
      expect(crossUserRows.rows).toEqual([
        { user_id: firstUser, count: '1' },
        { user_id: secondUser, count: '1' },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)));
    });
  }, 60_000);

  postgresIt('completes the full compliance dispatcher after a real PostgreSQL revision advance', async () => {
    await withIsolatedPostgres('platform_compliance_completion_revision', async ({ databaseUrl, query }) => {
      const [core, taskStorage, taskService] = await Promise.all([
        import('@/lib/db-storage'),
        import('@/lib/cloud-task-storage'),
        import('@/lib/task-core/task-service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-revision-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const provider = await startControlledProvider({ imageDataBySource: seeded.imageDataBySource });
      const transitionEntered = createGate();
      const releaseTransition = createGate();
      let completedAttempts = 0;
      const completedTransitions: boolean[] = [];
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        const production = await createProductionAgentRuntime({ transitionTask: async input => {
          if (input.to === 'completed') {
            completedAttempts += 1;
            if (completedAttempts === 1) {
              transitionEntered.release();
              await releaseTransition.promise;
            }
          }
          const result = await taskService.transitionTask(input);
          if (input.to === 'completed') completedTransitions.push(result.transitioned);
          return result;
        } });
        const created = await production.createSkillRun(
          complianceInput(userId, `completion-revision-${randomUUID()}`, seeded.scenario),
        );
        const dispatch = await dispatchComplianceWithRuntime({
          actorUserId: userId,
          runId: created.runId,
          mediaByVersionId: seeded.imageDataBySource,
          runtime: production.runtime,
        });
        expect(dispatch.started).toBe(true);
        await transitionEntered.promise;
        const advanced = await query<{ revision: number }>(
          `UPDATE cloud_tasks SET revision = revision + 1, updated_at = $2
           WHERE id = $1 RETURNING revision`,
          [created.runId, Date.now()],
        );
        expect(advanced.rows[0]?.revision).toBeGreaterThan(0);
        releaseTransition.release();
        await dispatch.completion;

        const [task, events, ledger, reports, operations] = await Promise.all([
          taskStorage.getCloudTaskForUser(created.runId, userId),
          query<{ event_id: string; event_type: string }>(
            `SELECT event_id, event_type FROM wujie_agent_events
             WHERE task_id = $1 AND event_type IN ('run.completed', 'run.failed', 'run.cancelled', 'run.timeout')`,
            [created.runId],
          ),
          query<{ type: string; amount: number }>(
            `SELECT type, amount::float8 AS amount FROM wujie_credit_transactions
             WHERE task_id = $1 ORDER BY created_at, id`, [created.runId],
          ),
          query<{ id: string; asset_id: string; mime_type: string; metadata: Record<string, unknown> }>(
            `SELECT version.id, version.asset_id, version.mime_type, version.metadata
             FROM wujie_asset_versions version JOIN wujie_assets asset ON asset.id = version.asset_id
             WHERE asset.owner_id = $1 AND asset.project_id = $2 AND asset.kind = 'document'
             ORDER BY version.created_at, version.id`, [userId, seeded.scenario.projectId],
          ),
          query<{ step_id: string; status: string; attempt_count: number }>(
            `SELECT step_id, status, attempt_count FROM wujie_agent_downstream_operations
             WHERE task_id = $1 AND tool_id = 'compliance_audit' ORDER BY step_id`, [created.runId],
          ),
        ]);
        expect(completedAttempts).toBe(2);
        expect(completedTransitions).toEqual([false, true]);
        expect(task).toMatchObject({ status: 'completed', creditStatus: 'charged', terminalEventType: 'run.completed' });
        expect(events.rows).toHaveLength(1);
        expect(events.rows[0]).toMatchObject({ event_id: task!.terminalEventId, event_type: 'run.completed' });
        expect(ledger.rows).toEqual([{ type: 'consume', amount: -(task!.creditCost || 0) }]);
        const visionCalls = provider.calls.filter(call => call.sourceVersionId !== null);
        expect(visionCalls).toHaveLength(3);
        for (const sourceVersionId of seeded.scenario.sourceVersionIds) {
          expect(visionCalls.filter(call => call.sourceVersionId === sourceVersionId)).toEqual([
            expect.objectContaining({
              sourceVersionId,
              attempt: 1,
              requestId: expect.stringMatching(/^agent-provider:[a-f0-9]{64}$/u),
            }),
          ]);
        }
        expect(operations.rows).toHaveLength(3);
        expect(operations.rows.every(row => row.status === 'completed' && row.attempt_count === 1)).toBe(true);
        expect(reports.rows).toHaveLength(3);
        expect(new Set(reports.rows.map(row => row.asset_id))).toHaveLength(3);
        for (const report of reports.rows) {
          expect(report.mime_type).toBe('application/json');
          expect(report.metadata).toMatchObject({
            schemaId: 'platform-compliance-report-v1',
            sourceTrace: { source: 'canvas-skill', runId: created.runId },
          });
          const content = JSON.parse(String(report.metadata.reportContent)) as Record<string, unknown>;
          expect(String(report.metadata.reportContent)).toBe(canonicalComplianceReportJson(content));
        }
      } finally {
        releaseTransition.release();
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('keeps cancellation authoritative when it wins the full dispatcher completion race', async () => {
    await withIsolatedPostgres('platform_compliance_cancel_wins_completion', async ({ databaseUrl, query }) => {
      const [core, taskStorage, taskService] = await Promise.all([
        import('@/lib/db-storage'),
        import('@/lib/cloud-task-storage'),
        import('@/lib/task-core/task-service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-cancel-wins-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const provider = await startControlledProvider({ imageDataBySource: seeded.imageDataBySource });
      const transitionEntered = createGate();
      const releaseTransition = createGate();
      let completedAttempts = 0;
      const completedTransitions: boolean[] = [];
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        const production = await createProductionAgentRuntime({ transitionTask: async input => {
          if (input.to === 'completed') {
            completedAttempts += 1;
            transitionEntered.release();
            await releaseTransition.promise;
          }
          const result = await taskService.transitionTask(input);
          if (input.to === 'completed') completedTransitions.push(result.transitioned);
          return result;
        } });
        const created = await production.createSkillRun(
          complianceInput(userId, `cancel-wins-${randomUUID()}`, seeded.scenario),
        );
        const dispatch = await dispatchComplianceWithRuntime({
          actorUserId: userId,
          runId: created.runId,
          mediaByVersionId: seeded.imageDataBySource,
          runtime: production.runtime,
        });
        await transitionEntered.promise;
        const beforeCancel = await query<{ id: string; metadata: Record<string, unknown> }>(
          `SELECT version.id, version.metadata FROM wujie_asset_versions version
           JOIN wujie_assets asset ON asset.id = version.asset_id
           WHERE asset.owner_id = $1 AND asset.project_id = $2 AND asset.kind = 'document'
           ORDER BY version.id`, [userId, seeded.scenario.projectId],
        );
        const providerCallsBeforeCancel = provider.calls.length;
        const cancelled = await production.runtime.cancelRun({ actorUserId: userId, runId: created.runId });
        expect(cancelled).toMatchObject({ accepted: true, projection: { status: 'cancelled' } });
        releaseTransition.release();
        await dispatch.completion;

        const [task, events, ledger, reports, operations] = await Promise.all([
          taskStorage.getCloudTaskForUser(created.runId, userId),
          query<{ event_id: string; event_type: string }>(
            `SELECT event_id, event_type FROM wujie_agent_events
             WHERE task_id = $1 AND event_type IN ('run.completed', 'run.failed', 'run.cancelled', 'run.timeout')`,
            [created.runId],
          ),
          query<{ type: string; amount: number }>(
            `SELECT type, amount::float8 AS amount FROM wujie_credit_transactions
             WHERE task_id = $1 ORDER BY created_at, id`, [created.runId],
          ),
          query<{ id: string; metadata: Record<string, unknown> }>(
            `SELECT version.id, version.metadata FROM wujie_asset_versions version
             JOIN wujie_assets asset ON asset.id = version.asset_id
             WHERE asset.owner_id = $1 AND asset.project_id = $2 AND asset.kind = 'document'
             ORDER BY version.id`, [userId, seeded.scenario.projectId],
          ),
          query<{ step_id: string; status: string; attempt_count: number }>(
            `SELECT step_id, status, attempt_count FROM wujie_agent_downstream_operations
             WHERE task_id = $1 AND tool_id = 'compliance_audit' ORDER BY step_id`, [created.runId],
          ),
        ]);
        expect(completedAttempts).toBe(1);
        expect(completedTransitions).toEqual([false]);
        expect(task).toMatchObject({ status: 'cancelled', terminalEventType: 'run.cancelled' });
        expect(events.rows).toEqual([{
          event_id: `agent:${created.runId}:cancelled`, event_type: 'run.cancelled',
        }]);
        const runEvents = await query<{ event_type: string; payload: Record<string, unknown> }>(
          `SELECT event_type, payload FROM wujie_agent_events
           WHERE task_id = $1 AND event_type IN ('run.created', 'tool.completed')`,
          [created.runId],
        );
        const createdPayload = runEvents.rows.find(row => row.event_type === 'run.created')?.payload;
        const completedStepIds = new Set(runEvents.rows
          .filter(row => row.event_type === 'tool.completed' && typeof row.payload.stepId === 'string')
          .map(row => String(row.payload.stepId)));
        const snapshot = createdPayload?.skillSnapshot as {
          steps: Array<{ id: string; cost?: number }>;
        };
        const expectedRefund = snapshot.steps.reduce((sum, step) => (
          completedStepIds.has(step.id) ? sum : sum + Number(step.cost || 0)
        ), 0);
        expect(ledger.rows[0]).toEqual({ type: 'consume', amount: -(task!.creditCost || 0) });
        expect(ledger.rows.filter(row => row.type === 'refund')).toEqual(
          expectedRefund > 0 ? [{ type: 'refund', amount: expectedRefund }] : [],
        );
        expect(provider.calls).toHaveLength(providerCallsBeforeCancel);
        expect(reports.rows).toEqual(beforeCancel.rows);
        expect(reports.rows).toHaveLength(3);
        for (const report of reports.rows) {
          expect(report.metadata).toMatchObject({
            schemaId: 'platform-compliance-report-v1',
            sourceTrace: { source: 'canvas-skill', runId: created.runId },
          });
          const content = JSON.parse(String(report.metadata.reportContent)) as Record<string, unknown>;
          expect(String(report.metadata.reportContent)).toBe(canonicalComplianceReportJson(content));
        }
        expect(operations.rows).toHaveLength(3);
        expect(operations.rows.every(row => row.status === 'completed' && row.attempt_count === 1)).toBe(true);
      } finally {
        releaseTransition.release();
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('uses the production registry, HTTP vision transport, and real report AssetVersions', async () => {
    await withIsolatedPostgres('platform_compliance_real_assets', async ({ databaseUrl, query }) => {
      const [core, taskStorage, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-real-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const provider = await startControlledProvider({ imageDataBySource: seeded.imageDataBySource });
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        const input = complianceInput(userId, `compliance-real-${randomUUID()}`, seeded.scenario);
        const created = await skillService.createSkillRun(input);
        const dispatch = await skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: created.runId });
        expect(dispatch.started).toBe(true);
        await dispatch.completion;

        const [history, task, reports, operations] = await Promise.all([
          skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
          taskStorage.getCloudTaskForUser(created.runId, userId),
          query<{
            id: string; asset_id: string; mime_type: string; metadata: Record<string, unknown>;
          }>(
            `SELECT version.id, version.asset_id, version.mime_type, version.metadata
             FROM wujie_asset_versions version
             JOIN wujie_assets asset ON asset.id = version.asset_id
             WHERE asset.owner_id = $1 AND asset.project_id = 'project-compliance'
               AND asset.kind = 'document'
             ORDER BY version.created_at, version.id`,
            [userId],
          ),
          query<{ operation_key: string; step_id: string }>(
            `SELECT operation_key, step_id FROM wujie_agent_downstream_operations
             WHERE task_id = $1 AND tool_id = 'compliance_audit' ORDER BY step_id`,
            [created.runId],
          ),
        ]);
        expect(history.status).toBe('completed');
        expect(task).toMatchObject({ status: 'completed', creditStatus: 'charged' });
        expect(reports.rows).toHaveLength(3);
        expect(operations.rows).toHaveLength(3);
        expect(new Set(operations.rows.map(row => row.operation_key))).toHaveLength(3);
        expect(new Set(reports.rows.map(row => row.asset_id))).toHaveLength(3);
        expect(reports.rows.every(row => row.mime_type === 'application/json')).toBe(true);
        const reportSources = reports.rows.map(row => {
          expect(row.metadata).toMatchObject({
            schemaId: 'platform-compliance-report-v1',
            sourceTrace: {
              source: 'canvas-skill', runId: created.runId,
              skillId: 'preset-platform-compliance-audit', skillVersion: 1,
            },
          });
          const content = JSON.parse(String(row.metadata.reportContent)) as Record<string, unknown>;
          expect(String(row.metadata.reportContent)).toBe(canonicalComplianceReportJson(content));
          const vision = content.visionModel as Record<string, unknown>;
          expect(vision.providerId).toBe('pear-vision');
          expect(vision.modelId).toBe('vision-model');
          return String(content.sourceVersionId);
        });
        expect(reportSources.sort()).toEqual(['source-a', 'source-b', 'source-c']);
        expect(provider.calls.filter(call => call.sourceVersionId !== null)).toEqual(expect.arrayContaining(
          ['source-a', 'source-b', 'source-c'].map(sourceVersionId => expect.objectContaining({
            sourceVersionId, attempt: 1, requestId: expect.stringMatching(/^agent-provider:[a-f0-9]{64}$/u),
          })),
        ));
        expect(provider.calls.filter(call => call.sourceVersionId !== null)).toHaveLength(3);
      } finally {
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('retries only the failed HTTP vision image and preserves real report versions', async () => {
    await withIsolatedPostgres('platform_compliance_retry_partial', async ({ databaseUrl, query }) => {
      const [core, taskStorage, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-retry-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const failedSource = seeded.scenario.sourceVersionIds[1];
      const provider = await startControlledProvider({
        imageDataBySource: seeded.imageDataBySource,
        respond: call => call.sourceVersionId === failedSource && call.attempt === 1 ? 500 : 200,
      });
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        const created = await skillService.createSkillRun(
          complianceInput(userId, `retry-${randomUUID()}`, seeded.scenario),
        );
        const first = await skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: created.runId });
        await first.completion;
        const paused = await waitFor(
          () => skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
          history => history.status === 'paused',
        );
        expect(paused.resumeFromStepId).toBeTruthy();
        const before = await query<{ id: string; metadata: Record<string, unknown> }>(
          `SELECT version.id, version.metadata FROM wujie_asset_versions version
           JOIN wujie_assets asset ON asset.id = version.asset_id
           WHERE asset.owner_id = $1 AND asset.kind = 'document' ORDER BY version.created_at, version.id`,
          [userId],
        );
        expect(before.rows).toHaveLength(3);
        const failedReport = before.rows.find(row => {
          const report = JSON.parse(String(row.metadata.reportContent)) as { sourceVersionId: string; technicalErrors: unknown[] };
          return report.sourceVersionId === failedSource && report.technicalErrors.length > 0;
        });
        expect(failedReport).toBeDefined();

        await withComplianceRetryLifetime(created.runId, async () => {
          const retried = await skillService.retrySkillStep({
            actorUserId: userId, runId: created.runId, stepId: paused.resumeFromStepId!,
          });
          expect(retried.accepted).toBe(true);
          const completed = await waitFor(
            () => skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
            history => history.status === 'completed',
          );
          expect(completed.assetVersionIds).toHaveLength(3);
          const after = await query<{ id: string; metadata: Record<string, unknown> }>(
            `SELECT version.id, version.metadata FROM wujie_asset_versions version
             JOIN wujie_assets asset ON asset.id = version.asset_id
             WHERE asset.owner_id = $1 AND asset.kind = 'document' ORDER BY version.created_at, version.id`,
            [userId],
          );
          expect(after.rows).toHaveLength(4);
          expect(after.rows.map(row => row.id)).toEqual(expect.arrayContaining(before.rows.map(row => row.id)));
          expect(provider.calls.filter(call => call.sourceVersionId === failedSource)).toHaveLength(2);
          for (const source of seeded.scenario.sourceVersionIds.filter(value => value !== failedSource)) {
            expect(provider.calls.filter(call => call.sourceVersionId === source)).toHaveLength(1);
          }
          const ledger = await query<{ type: string }>(
            'SELECT type FROM wujie_credit_transactions WHERE task_id = $1 ORDER BY created_at, id',
            [created.runId],
          );
          expect(ledger.rows).toEqual([{ type: 'consume' }]);
          });
      } finally {
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('recovers a report persistence failure without repeating completed vision calls', async () => {
    await withIsolatedPostgres('platform_compliance_report_persistence', async ({ databaseUrl, query }) => {
      const [core, taskStorage, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-persist-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const failedSource = seeded.scenario.sourceVersionIds[1];
      const provider = await startControlledProvider({ imageDataBySource: seeded.imageDataBySource });
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        await query(`CREATE FUNCTION reject_task10_report() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.metadata->>'schemaId' = 'platform-compliance-report-v1'
              AND (NEW.metadata->>'reportContent')::jsonb->>'sourceVersionId' = '${failedSource}' THEN
              RAISE EXCEPTION 'controlled report persistence failure';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER reject_task10_report_before_insert BEFORE INSERT ON wujie_asset_versions
          FOR EACH ROW EXECUTE FUNCTION reject_task10_report()`);
        const created = await skillService.createSkillRun(
          complianceInput(userId, `persist-${randomUUID()}`, seeded.scenario),
        );
        const first = await skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: created.runId });
        await first.completion;
        const paused = await waitFor(
          () => skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
          history => history.status === 'paused',
        );
        const before = await query<{ id: string }>(
          `SELECT version.id FROM wujie_asset_versions version JOIN wujie_assets asset ON asset.id = version.asset_id
           WHERE asset.owner_id = $1 AND asset.kind = 'document' ORDER BY version.created_at, version.id`,
          [userId],
        );
        expect(before.rows).toHaveLength(2);
        expect(provider.calls.filter(call => call.sourceVersionId === failedSource)).toHaveLength(1);
        await query('DROP TRIGGER reject_task10_report_before_insert ON wujie_asset_versions; DROP FUNCTION reject_task10_report()');

        await withComplianceRetryLifetime(created.runId, async () => {
          await skillService.retrySkillStep({
            actorUserId: userId, runId: created.runId, stepId: paused.resumeFromStepId!,
          });
          const completed = await waitFor(
            () => skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
            history => history.status === 'completed',
          );
          expect(completed.assetVersionIds).toEqual(expect.arrayContaining(before.rows.map(row => row.id)));
          expect(provider.calls.filter(call => call.sourceVersionId === failedSource)).toHaveLength(1);
          const reports = await query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM wujie_asset_versions version
             JOIN wujie_assets asset ON asset.id = version.asset_id
             WHERE asset.owner_id = $1 AND asset.kind = 'document'`,
            [userId],
          );
          expect(reports.rows[0]?.count).toBe('3');
          });
      } finally {
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('races a real paused-step retry with duplicate cancel and settles once', async () => {
    await withIsolatedPostgres('platform_compliance_cancel_race', async ({ databaseUrl, query }) => {
      const [core, taskStorage, agentService, skillService, continuation, prepaid, taskAbort, executionDispatch] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'), import('@/lib/skill-runtime/service'),
        import('@/lib/skill-runtime/continuation'), import('@/lib/skill-runtime/prepaid-generation'),
        import('@/lib/task-core/task-abort'), import('@/lib/agent-runtime/execution-dispatch'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-cancel-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const failedSource = seeded.scenario.sourceVersionIds[1];
      let releaseRetryProvider!: () => void;
      const retryProviderGate = new Promise<void>(resolveGate => { releaseRetryProvider = resolveGate; });
      const provider = await startControlledProvider({
        imageDataBySource: seeded.imageDataBySource,
        respond: async call => {
          if (call.sourceVersionId === failedSource && call.attempt === 1) return 500;
          if (call.sourceVersionId === failedSource && call.attempt === 2) await retryProviderGate;
          return 200;
        },
      });
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        let dispatchCompletionSettled = false;
        const production = await createProductionAgentRuntime({
          recordDispatchCompletionFailure: async input => {
            try {
              await executionDispatch.recordResumedAgentExecutionCompletionFailure(input);
            } finally {
              dispatchCompletionSettled = true;
            }
          },
        });
        const racedSkillService = skillService.createSkillRuntimeService({
          createAuthorizedSkillRun: production.createSkillRun,
          getTaskForUser: taskStorage.getCloudTaskForUser,
          listTasks: taskStorage.listCloudTasks,
          listEvents: production.runtime.listEvents,
          getProjection: production.runtime.getRun,
          pauseRun: production.runtime.pauseRun,
          resumeRun: production.runtime.resumeRun,
          cancelRun: production.runtime.cancelRun,
          cancelPrepaidChildren: prepaid.cancelSkillPrepaidChildren,
          abortTaskExecution: taskAbort.abortTaskExecution,
          prepareResume: input => continuation.loadPersistedSkillContinuation(input),
        });
        const created = await racedSkillService.create(
          complianceInput(userId, `cancel-${randomUUID()}`, seeded.scenario),
        );
        const first = await skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: created.runId });
        await first.completion;
        const paused = await waitFor(
          () => racedSkillService.get({ actorUserId: userId, runId: created.runId }),
          history => history.status === 'paused',
        );
        expect(paused.resumeFromStepId).toBeTruthy();
        expect(paused.steps.find(step => step.id === paused.resumeFromStepId)?.status).toBe('failed');

        const race = createBarrier(3);
        const retry = (async () => {
          await race.wait();
          return racedSkillService.retry({
            actorUserId: userId, runId: created.runId, stepId: paused.resumeFromStepId!,
          });
        })();
        const cancelDuringRetry = async () => {
          await race.wait();
          await waitFor(
            async () => provider.calls.filter(call => (
              call.sourceVersionId === failedSource && call.attempt === 2
            )).length,
            count => count === 1,
          );
          return racedSkillService.cancel({ actorUserId: userId, runId: created.runId });
        };
        const outcomes = await Promise.allSettled([
          retry,
          cancelDuringRetry(),
          cancelDuringRetry(),
        ]);
        expect(outcomes[0]).toMatchObject({
          status: 'fulfilled',
          value: { accepted: true },
        });
        expect(outcomes.slice(1).every(result => result.status === 'fulfilled')).toBe(true);
        releaseRetryProvider();
        const terminal = await waitFor(
          () => racedSkillService.get({ actorUserId: userId, runId: created.runId }),
          history => history.status === 'cancelled',
        );
        expect(terminal.status).toBe('cancelled');
        await waitFor(
          async () => dispatchCompletionSettled,
          settled => settled,
        );

        const [task, events, ledger, operations] = await Promise.all([
          taskStorage.getCloudTaskForUser(created.runId, userId),
          agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
          query<{ type: string; amount: number }>(
            `SELECT type, amount::float8 AS amount FROM wujie_credit_transactions
             WHERE task_id = $1 ORDER BY created_at, id`, [created.runId],
          ),
          query<{ step_id: string; status: string; attempt_count: number }>(
            `SELECT step_id, status, attempt_count FROM wujie_agent_downstream_operations
             WHERE task_id = $1 AND tool_id = 'compliance_audit' ORDER BY step_id, operation_key`,
            [created.runId],
          ),
        ]);
        const createdEvent = events.find(event => event.type === 'run.created')!;
        const snapshot = createdEvent.payload.skillSnapshot as {
          steps: Array<{ id: string; cost?: number }>;
        };
        const completedIds = new Set(events.filter(event => event.type === 'tool.completed')
          .map(event => String(event.payload.stepId)));
        const expectedRefund = snapshot.steps.reduce((sum, step) => (
          completedIds.has(step.id) ? sum : sum + Number(step.cost || 0)
        ), 0);
        expect(task).toMatchObject({ status: 'cancelled', creditStatus: 'charged' });
        expect(ledger.rows).toEqual([
          { type: 'consume', amount: -(task!.creditCost || 0) },
          { type: 'refund', amount: expectedRefund },
        ]);
        expect(events.filter(event => (
          event.type === 'run.completed'
          || event.type === 'run.failed'
          || event.type === 'run.cancelled'
          || event.type === 'run.timeout'
        ))).toHaveLength(1);
        expect(events.filter(event => event.type === 'run.cancelled')).toHaveLength(1);
        expect(events.filter(event => event.type === 'run.completed')).toHaveLength(0);
        expect(provider.calls.filter(call => call.sourceVersionId === failedSource)).toHaveLength(2);
        for (const source of seeded.scenario.sourceVersionIds.filter(value => value !== failedSource)) {
          expect(provider.calls.filter(call => call.sourceVersionId === source)).toHaveLength(1);
        }
        expect(operations.rows).toHaveLength(3);
        expect(new Set(operations.rows.map(operation => operation.step_id))).toHaveLength(3);
        expect(operations.rows.map(operation => ({
          status: operation.status,
          attempts: operation.attempt_count,
        })).sort((left, right) => left.attempts - right.attempts)).toEqual([
          { status: 'completed', attempts: 1 },
          { status: 'completed', attempts: 1 },
          { status: 'prepared', attempts: 2 },
        ]);
      } finally {
        releaseRetryProvider?.();
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('refunds the exact unfinished cost once after a real vision failure is cancelled', async () => {
    await withIsolatedPostgres('platform_compliance_vision_failure_refund', async ({ databaseUrl, query }) => {
      const [core, taskStorage, agentService, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'), import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-failure-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const failedSource = seeded.scenario.sourceVersionIds[1];
      const provider = await startControlledProvider({
        imageDataBySource: seeded.imageDataBySource,
        respond: call => call.sourceVersionId === failedSource ? 500 : 200,
      });
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        const created = await skillService.createSkillRun(
          complianceInput(userId, `failure-refund-${randomUUID()}`, seeded.scenario),
        );
        const dispatch = await skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: created.runId });
        await dispatch.completion;
        await waitFor(
          () => skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
          history => history.status === 'paused',
        );
        await Promise.all([
          skillService.cancelSkillRun({ actorUserId: userId, runId: created.runId }),
          skillService.cancelSkillRun({ actorUserId: userId, runId: created.runId }),
        ]);
        const [task, events, ledger] = await Promise.all([
          taskStorage.getCloudTaskForUser(created.runId, userId),
          agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
          query<{ type: string; amount: number }>(
            `SELECT type, amount::float8 AS amount FROM wujie_credit_transactions
             WHERE task_id = $1 ORDER BY created_at, id`, [created.runId],
          ),
        ]);
        const snapshot = events.find(event => event.type === 'run.created')!.payload.skillSnapshot as {
          steps: Array<{ id: string; cost?: number }>;
        };
        const completedIds = new Set(events.filter(event => event.type === 'tool.completed')
          .map(event => String(event.payload.stepId)));
        const expectedRefund = snapshot.steps.reduce((sum, step) => (
          completedIds.has(step.id) ? sum : sum + Number(step.cost || 0)
        ), 0);
        expect(task?.status).toBe('cancelled');
        expect(ledger.rows).toEqual([
          { type: 'consume', amount: -(task!.creditCost || 0) },
          { type: 'refund', amount: expectedRefund },
        ]);
        expect(provider.calls.filter(call => call.sourceVersionId === failedSource)).toHaveLength(1);
      } finally {
        await provider.close();
      }
    });
  }, 60_000);
});

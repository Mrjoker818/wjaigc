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

describe('platform compliance accounting on isolated PostgreSQL', () => {
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
      } finally {
        await provider.close();
      }
    });
  }, 60_000);

  postgresIt('settles duplicate cancel and retry races once and rejects late completion', async () => {
    await withIsolatedPostgres('platform_compliance_cancel_race', async ({ databaseUrl, query }) => {
      const [core, taskStorage, agentService, skillService] = await Promise.all([
        import('@/lib/db-storage'), import('@/lib/cloud-task-storage'),
        import('@/lib/agent-runtime/service'), import('@/lib/skill-runtime/service'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);
      migrate(databaseUrl);
      const userId = `compliance-cancel-${randomUUID()}`;
      const seeded = await seedProductionComplianceInputs(query, userId);
      await seedCredits(query, userId);
      const immediateSource = seeded.scenario.sourceVersionIds[0];
      let release!: () => void;
      const gate = new Promise<void>(resolveGate => { release = resolveGate; });
      const provider = await startControlledProvider({
        imageDataBySource: seeded.imageDataBySource,
        respond: async call => {
          if (call.sourceVersionId && call.sourceVersionId !== immediateSource) await gate;
          return 200;
        },
      });
      try {
        await query("UPDATE wujie_api_providers SET base_url = $1 WHERE id = 'pear-vision'", [provider.baseUrl]);
        const created = await skillService.createSkillRun(
          complianceInput(userId, `cancel-${randomUUID()}`, seeded.scenario),
        );
        const dispatch = await skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: created.runId });
        await waitFor(async () => {
          const result = await query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM wujie_asset_versions version
             JOIN wujie_assets asset ON asset.id = version.asset_id
             WHERE asset.owner_id = $1 AND asset.kind = 'document'`,
            [userId],
          );
          return Number(result.rows[0]?.count || 0);
        }, count => count === 1);
        const live = await skillService.getSkillRun({ actorUserId: userId, runId: created.runId });
        const retry = skillService.retrySkillStep({
          actorUserId: userId, runId: created.runId,
          stepId: live.steps.find(step => step.status !== 'completed')!.id,
        });
        const cancellations = await Promise.allSettled([
          skillService.cancelSkillRun({ actorUserId: userId, runId: created.runId }),
          skillService.cancelSkillRun({ actorUserId: userId, runId: created.runId }),
          retry,
        ]);
        expect(cancellations.filter(result => result.status === 'fulfilled')).toHaveLength(2);
        release();
        await dispatch.completion;
        const terminal = await waitFor(
          () => skillService.getSkillRun({ actorUserId: userId, runId: created.runId }),
          history => history.status === 'cancelled',
        );
        expect(terminal.status).toBe('cancelled');

        const [task, events, ledger] = await Promise.all([
          taskStorage.getCloudTaskForUser(created.runId, userId),
          agentService.listAgentRunEvents({ actorUserId: userId, runId: created.runId }),
          query<{ type: string; amount: number }>(
            `SELECT type, amount::float8 AS amount FROM wujie_credit_transactions
             WHERE task_id = $1 ORDER BY created_at, id`, [created.runId],
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
        expect(events.filter(event => event.type === 'run.completed')).toHaveLength(0);
        expect(provider.calls.filter(call => call.sourceVersionId === immediateSource)).toHaveLength(1);
      } finally {
        release?.();
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

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { describe, expect, it, vi } from 'vitest';

import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import type { SkillRunRequest } from '@/lib/skill-runtime/run-request';
import type { User } from '@/lib/user-types';

vi.mock('server-only', () => ({}));

function migrate(databaseUrl: string): void {
  const migration = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(migration.status, migration.stderr || migration.stdout).toBe(0);
}

describe('multi-platform export PostgreSQL concurrency', () => {
  it('runs the local Skill, recovers only missing work, retries partial output idempotently, and never writes credit ledger rows', async () => {
    const databaseUrl = process.env.TEST_PGDATABASE_URL?.trim();
    expect(databaseUrl, [
      'TEST_PGDATABASE_URL is required for this dedicated Task 6 integration test.',
      'Do not point it at PGDATABASE_URL or a production database.',
    ].join(' ')).toBeTruthy();
    expect(databaseUrl).not.toBe(process.env.PGDATABASE_URL);
    process.env.POSTGRES_TEST_DATABASE_URL = databaseUrl;
    process.env.MULTI_PLATFORM_EXPORT_ENABLED = 'true';

    await withIsolatedPostgres('mpe_task_6_runtime', async ({ databaseUrl: isolatedUrl, query }) => {
      migrate(isolatedUrl);
      const [
        core, taskStorage, skillService, agentService, eventStorage, sameTask,
        artifacts, presetModule,
      ] = await Promise.all([
        import('@/lib/db-storage'),
        import('@/lib/cloud-task-storage'),
        import('@/lib/skill-runtime/service'),
        import('@/lib/agent-runtime/service'),
        import('@/lib/agent-runtime/event-storage'),
        import('@/lib/agent-runtime/same-task-adapter'),
        import('@/lib/multi-platform-export/artifacts'),
        import('@/lib/skill-runtime/multi-platform-export-preset'),
      ]);
      await Promise.all([core.ensureCoreTables(), taskStorage.ensureCloudTaskTables()]);

      const userId = `mpe-user-${randomUUID()}`;
      const projectId = `mpe-project-${randomUUID()}`;
      const sourceId = `version-${randomUUID().replaceAll('-', '')}`;
      const sourceAssetId = `asset-${randomUUID().replaceAll('-', '')}`;
      const now = Date.now();
      const actor: User = {
        id: userId,
        name: 'MPE PostgreSQL user',
        role: 'user',
        status: 'active',
        productType: 'canvas',
        createdAt: now,
        updatedAt: now,
      };
      await query(
        `INSERT INTO wujie_users(id, name, password_hash, role, status, product_type, storage_folder, created_at, updated_at)
         VALUES ($1, $2, 'test-only', 'user', 'active', 'canvas', $3, $4, $4)`,
        [userId, actor.name, `data/users/${userId}`, now],
      );
      await query(
        'INSERT INTO wujie_projects(id, owner_id, name) VALUES ($1, $2, $3)',
        [projectId, userId, 'MPE project'],
      );
      const sourceBytes = readFileSync(resolve(
        process.cwd(),
        'src/__tests__/fixtures/multi-platform-export/transparent.png',
      ));
      const sourceChecksum = createHash('sha256').update(sourceBytes).digest('hex');
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status, current_version_id)
         VALUES ($1, $2, $3, 'image', 'active', NULL)`,
        [sourceAssetId, userId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(id, asset_id, owner_id, project_id, file_url, availability,
           mime_type, byte_size, checksum, idempotency_key, request_digest, metadata)
         VALUES ($1, $2, $3, $4, $5, 'ready', 'image/png', $6, $7, $8, $9, '{}'::jsonb)`,
        [
          sourceId,
          sourceAssetId,
          userId,
          projectId,
          `data:image/png;base64,${sourceBytes.toString('base64')}`,
          sourceBytes.length,
          sourceChecksum,
          `seed-${sourceId}`,
          'e'.repeat(64),
        ],
      );
      await query('UPDATE wujie_assets SET current_version_id = $1 WHERE id = $2', [sourceId, sourceAssetId]);

      const request = (idempotencyKey: string, targetPresetIds = ['instagram-post-v1']): SkillRunRequest => ({
        skillId: 'preset-multi-platform-export',
        skillVersion: 1,
        surface: 'canvas',
        projectId,
        workspaceId: 'canvas-mpe',
        inputValues: {
          sourceAssetVersionIds: [sourceId],
          targetPresetIds,
          fit: 'cover',
          background: '#ffffffff',
          namingTemplate: 'export-{usage}-{size}-{index}',
        },
        sourceVersionIds: [sourceId],
        modelBindings: {},
        idempotencyKey,
      });

      const input = { actor, request: request(`mpe-complete-${randomUUID()}`) };
      const creates = await Promise.all(
        Array.from({ length: 12 }, () => skillService.createSkillRun(input)),
      );
      expect(new Set(creates.map(item => item.runId)).size).toBe(1);
      expect(creates.filter(item => !item.reused)).toHaveLength(1);
      const completedRunId = creates[0]!.runId;
      const dispatches = await Promise.all(Array.from({ length: 12 }, () => (
        skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: completedRunId })
      )));
      expect(dispatches.filter(item => item.started)).toHaveLength(1);
      await Promise.all(dispatches.map(item => item.completion));
      await expect(skillService.getSkillRun({
        actorUserId: userId,
        runId: completedRunId,
      })).resolves.toMatchObject({ status: 'completed' });

      const versionsBeforeRecovery = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2',
        [userId, projectId],
      );
      const recoveries = await Promise.all(Array.from({ length: 4 }, () => (
        skillService.dispatchSkillRunExecution({
          actorUserId: userId,
          runId: completedRunId,
          recoveryOnly: true,
        })
      )));
      expect(recoveries.every(item => !item.started)).toBe(true);
      const versionsAfterRecovery = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM wujie_asset_versions WHERE owner_id = $1 AND project_id = $2',
        [userId, projectId],
      );
      expect(versionsAfterRecovery.rows).toEqual(versionsBeforeRecovery.rows);

      const partialInput = {
        actor,
        request: request(`mpe-partial-${randomUUID()}`, [
          'instagram-post-v1',
          'instagram-story-v1',
        ]),
      };
      const partialCreated = await skillService.createSkillRun(partialInput);
      const partialDefinition = presetModule.createMultiPlatformExportSkill(true);
      const partialDispatch = await skillService.dispatchSkillRunExecution({
        actorUserId: userId,
        runId: partialCreated.runId,
      }, {
        getTaskForUser: taskStorage.getCloudTaskForUser,
        getRecoverableDispatch: eventStorage.getRecoverableAgentExecutionDispatch,
        claimExecution: eventStorage.claimAdoptedAgentExecution,
        claimDispatch: eventStorage.claimResumedAgentExecutionDispatch,
        getProjection: agentService.getAgentRunProjection,
        executeAdopted: sameTask.executeAdoptedAgentTask,
        failDispatch: eventStorage.failResumedAgentExecutionDispatch,
        loadContinuation: async () => ({
          actor,
          request: partialInput.request,
          definition: partialDefinition,
          workspace: 'canvas',
          requestDigest: String(partialCreated.event.payload.requestDigest),
          toolId: 'export',
          execute: async operationContext => {
            await skillService.executeSkillRun({
              actor,
              request: partialInput.request,
              runId: partialCreated.runId,
              operationContext,
              definition: partialDefinition,
              stepAdapters: {
                multi_platform_export: async () => {
                  const jpegBytes = await sharp(sourceBytes).jpeg().toBuffer();
                  const jpegChecksum = createHash('sha256').update(jpegBytes).digest('hex');
                  const persisted = await artifacts.persistExportImageVersion({
                    actorUserId: userId,
                    projectId,
                    runId: partialCreated.runId,
                    sourceAssetVersionId: sourceId,
                    presetId: 'instagram-post',
                    presetVersion: 1,
                    platform: 'instagram',
                    usage: 'post',
                    width: 1080,
                    height: 1080,
                    fit: 'cover',
                    outputFormat: 'jpeg',
                    outputFilename: 'export-post-1080x1080-1.jpeg',
                    requestDigest: 'a'.repeat(64),
                    transformed: {
                      bytes: jpegBytes,
                      mimeType: 'image/jpeg',
                      sha256: jpegChecksum,
                    },
                  });
                  throw new (await import('@/lib/multi-platform-export/executor')).SkillPartialSuccessError({
                    assetVersionIds: [persisted.version.id],
                    media: [{ width: 1080, height: 1080 }],
                    structured: {
                      schemaId: 'multi-platform-export-result-v1',
                      value: {
                        schemaVersion: 1,
                        runId: partialCreated.runId,
                        outcome: 'partial_success',
                        imageAssetVersionIds: [persisted.version.id],
                        failures: [{
                          sourceAssetVersionId: sourceId,
                          presetId: 'instagram-story',
                          presetVersion: 1,
                          outputFilename: 'export-story-1080x1920-1.jpeg',
                          code: 'EXPORT_IMAGE_TRANSFORM_FAILED',
                          retryable: true,
                        }],
                      },
                    },
                  });
                },
              },
            });
          },
        }),
      });
      expect(partialDispatch.started).toBe(true);
      await partialDispatch.completion;
      await expect(skillService.getSkillRun({
        actorUserId: userId,
        runId: partialCreated.runId,
      })).resolves.toMatchObject({ status: 'failed' });

      const retries = await Promise.all(Array.from({ length: 8 }, () => (
        skillService.retrySkillStep({
          actorUserId: userId,
          runId: partialCreated.runId,
          stepId: 'export',
        })
      )));
      const retryRunIds = retries.map(item => 'runId' in item ? item.runId : '');
      expect(new Set(retryRunIds).size).toBe(1);
      expect(retryRunIds[0]).not.toBe(partialCreated.runId);

      const retryDispatches = await Promise.all(Array.from({ length: 8 }, () => (
        skillService.dispatchSkillRunExecution({ actorUserId: userId, runId: retryRunIds[0]! })
      )));
      expect(retryDispatches.filter(item => item.started)).toHaveLength(1);
      await Promise.all(retryDispatches.map(item => item.completion));
      await expect(skillService.getSkillRun({
        actorUserId: userId,
        runId: retryRunIds[0]!,
      })).resolves.toMatchObject({ status: 'completed' });

      const derived = await query<{ kind: string; count: string }>(
        `SELECT asset.kind, COUNT(*)::text AS count
         FROM wujie_asset_versions version
         JOIN wujie_assets asset ON asset.id = version.asset_id
         WHERE version.owner_id = $1 AND version.project_id = $2
           AND version.metadata->>'schemaId' LIKE 'multi-platform-export-%'
           AND version.metadata->>'runId' IN ($3, $4)
         GROUP BY asset.kind ORDER BY asset.kind`,
        [userId, projectId, partialCreated.runId, retryRunIds[0]],
      );
      expect(derived.rows).toEqual([
        { kind: 'document', count: '2' },
        { kind: 'image', count: '2' },
      ]);

      const ledger = await query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM wujie_credit_transactions WHERE user_id = $1',
        [userId],
      );
      expect(ledger.rows[0]?.count).toBe('0');
    });
  }, 90_000);
});

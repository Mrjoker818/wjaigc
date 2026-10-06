import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

if (!databaseUrl) {
  console.warn(
    'BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured; Stage 2 task projection PostgreSQL tests skipped.',
  );
}

function migrate(isolatedDatabaseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    [resolve(process.cwd(), 'scripts/run-migrations.mjs')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: isolatedDatabaseUrl,
        PGDATABASE_URL: isolatedDatabaseUrl,
      },
    },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe('Stage 2 authoritative task projection PostgreSQL', () => {
  postgresIt('projects one version and placement for concurrent completed replays', async () => {
    await withIsolatedPostgres('stage-2-task-projection', async ({ databaseUrl: url, query }) => {
      migrate(url);
      const { createCloudTask } = await import('@/lib/cloud-task-storage');
      const { recordImageTaskTerminal } = await import('@/lib/cloud-task-persistence');
      const imageUrl = `data:image/png;base64,${(
        await sharp({
          create: {
            width: 1254,
            height: 1254,
            channels: 4,
            background: { r: 34, g: 197, b: 94, alpha: 1 },
          },
        }).png().toBuffer()
      ).toString('base64')}`;

      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, $3, 'active')`,
        ['project-task-projection', 'user-task-projection', 'Task projection'],
      );
      const now = Date.now();
      await createCloudTask({
        id: 'task-projection-concurrent',
        userId: 'user-task-projection',
        projectId: 'project-task-projection',
        type: 'generate',
        status: 'processing',
        providerId: 'provider-a',
        model: 'model-a',
        progress: 50,
        result: { submissionPayload: { prompt: 'immutable projection' } },
        creditStatus: 'charged',
        createdAt: now,
        updatedAt: now,
      });

      const outcomes = await Promise.all([
        recordImageTaskTerminal('task-projection-concurrent', {
          status: 'completed',
          imageUrl,
          creditStatus: 'charged',
        }),
        recordImageTaskTerminal('task-projection-concurrent', {
          status: 'completed',
          imageUrl,
          creditStatus: 'charged',
        }),
      ]);

      expect(outcomes.filter(outcome => outcome?.transitioned)).toHaveLength(1);
      const counts = await query<{
        task_status: string;
        version_count: number;
        placement_count: number;
        width: number;
        height: number;
        mime_type: string;
      }>(
        `SELECT task.status AS task_status,
                (SELECT COUNT(*)::int FROM wujie_asset_versions
                 WHERE task_id = task.id) AS version_count,
                (SELECT COUNT(*)::int FROM wujie_workspace_placements placement
                 JOIN wujie_asset_versions version ON version.id = placement.asset_version_id
                 WHERE version.task_id = task.id AND placement.status = 'active') AS placement_count,
                version.width,
                version.height,
                version.mime_type
         FROM cloud_tasks task
         JOIN wujie_asset_versions version ON version.task_id = task.id
         WHERE task.id = $1`,
        ['task-projection-concurrent'],
      );
      expect(counts.rows[0]).toEqual({
        task_status: 'completed',
        version_count: 1,
        placement_count: 1,
        width: 1254,
        height: 1254,
        mime_type: 'image/png',
      });
    });
  });

  postgresIt('keeps reference assets immutable and reuses one result version across workspaces', async () => {
    await withIsolatedPostgres('stage-2-task-derived-projection', async ({ databaseUrl: url, query }) => {
      migrate(url);
      const { createCloudTask } = await import('@/lib/cloud-task-storage');
      const { recordImageTaskTerminal } = await import('@/lib/cloud-task-persistence');
      const { projectCompletedTaskToAssets } = await import('@/lib/asset-core/task-projector');

      const ownerId = 'user-derived-projection';
      const projectId = 'project-derived-projection';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, $3, 'active')`,
        [projectId, ownerId, 'Derived projection'],
      );
      await query(
        `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
         VALUES ('source-asset', $1, $2, 'image', 'active')`,
        [ownerId, projectId],
      );
      await query(
        `INSERT INTO wujie_asset_versions(
           id, asset_id, owner_id, project_id, file_url, availability
         ) VALUES ('source-version', 'source-asset', $1, $2, '/uploads/source.png', 'ready')`,
        [ownerId, projectId],
      );
      await query(
        `UPDATE wujie_assets SET current_version_id = 'source-version'
         WHERE id = 'source-asset' AND owner_id = $1 AND project_id = $2`,
        [ownerId, projectId],
      );

      const now = Date.now();
      await createCloudTask({
        id: 'task-derived-result',
        userId: ownerId,
        projectId,
        type: 'generate',
        status: 'processing',
        providerId: 'provider-a',
        model: 'model-a',
        progress: 50,
        result: {
          submissionPayload: {
            prompt: 'derive a new image',
            assetParentVersionIds: ['source-version'],
          },
        },
        creditStatus: 'charged',
        createdAt: now,
        updatedAt: now,
      });
      await recordImageTaskTerminal('task-derived-result', {
        status: 'completed',
        imageUrl: '/uploads/derived.png',
        creditStatus: 'charged',
      });

      await Promise.all([
        projectCompletedTaskToAssets({
          actorUserId: ownerId,
          taskId: 'task-derived-result',
          targetProjectId: projectId,
          workspace: 'canvas',
          parentVersionIds: ['source-version'],
        }),
        projectCompletedTaskToAssets({
          actorUserId: ownerId,
          taskId: 'task-derived-result',
          targetProjectId: projectId,
          workspace: 'chat',
          workspaceId: 'standalone-chat:conversation-1',
          sourceEntityId: 'message-1',
          parentVersionIds: ['source-version'],
        }),
      ]);

      const facts = await query<{
        source_current: string;
        result_asset: string;
        source_versions: string[];
        version_count: number;
        placement_count: number;
        credit_status: string;
      }>(
        `SELECT source.current_version_id AS source_current,
                result.asset_id AS result_asset,
                ARRAY(
                  SELECT jsonb_array_elements_text(result.metadata->'sourceVersionIds')
                ) AS source_versions,
                (SELECT COUNT(*)::int FROM wujie_asset_versions WHERE task_id = task.id) AS version_count,
                (SELECT COUNT(*)::int FROM wujie_workspace_placements placement
                  JOIN wujie_asset_versions version ON version.id = placement.asset_version_id
                  WHERE version.task_id = task.id AND placement.status = 'active') AS placement_count,
                task.credit_status
         FROM cloud_tasks task
         JOIN wujie_asset_versions result ON result.task_id = task.id
         JOIN wujie_assets source ON source.id = 'source-asset'
         WHERE task.id = 'task-derived-result'`,
      );
      expect(facts.rows[0]).toEqual({
        source_current: 'source-version',
        result_asset: expect.not.stringMatching(/^source-asset$/),
        source_versions: ['source-version'],
        version_count: 1,
        placement_count: 2,
        credit_status: 'charged',
      });

      const resultVersion = await query<{ id: string }>(
        `SELECT id FROM wujie_asset_versions WHERE task_id = 'task-derived-result'`,
      );
      const { createPostgresAssetStorage } = await import('@/lib/asset-core/storage');
      const storedVersion = await createPostgresAssetStorage().transaction(transaction => (
        transaction.findVersion(ownerId, projectId, resultVersion.rows[0].id)
      ));
      expect(storedVersion?.parentVersionIds).toEqual(['source-version']);
    });
  });
});

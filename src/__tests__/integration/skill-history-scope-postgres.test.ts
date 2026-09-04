import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import { listCloudTasks } from '@/lib/cloud-task-storage';

vi.mock('server-only', () => ({}));
const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL ? it : it.skip;

describe('Skill history scoped database window', () => {
  postgresIt('filters project, owner, Skill and workspace before limiting a history window', async () => {
    await withIsolatedPostgres('skill_history_scope', async ({ query }) => {
      await listCloudTasks({ userId: 'owner' });
      await query(readFileSync(resolve('migrations/20260816_wj_stable_s4_agent_events.sql'), 'utf8'));
      await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,created_at,updated_at)
        SELECT 'noise-' || n, 'owner', CASE WHEN n <= 500 THEN 'other-project' ELSE 'project-1' END,
          CASE WHEN n > 1500 THEN 'generate' ELSE 'agent-run' END, 'processing', 10, 10
        FROM generate_series(1,2000) n`);
      await query(`INSERT INTO cloud_tasks(id,user_id,project_id,type,status,created_at,updated_at)
        VALUES ('target','owner','project-1','agent-run','processing',1,1),
          ('foreign','other-owner','project-1','agent-run','processing',20,20)`);
      await query(`INSERT INTO wujie_agent_events(event_id,task_id,owner_id,project_id,workspace,sequence,event_type,request_digest,payload,created_at)
        SELECT 'created-' || id, id, user_id, project_id, 'canvas', 1, 'run.created', 'digest',
          jsonb_build_object('workspace','canvas','workspaceId',
            CASE WHEN id LIKE 'noise-%' AND split_part(id,'-',2)::int BETWEEN 1001 AND 1500 THEN 'other-workspace' ELSE 'w1' END,
            'skill', jsonb_build_object('skillId',
              CASE WHEN id LIKE 'noise-%' AND split_part(id,'-',2)::int BETWEEN 501 AND 1000 THEN 'other-skill' ELSE 'food' END,
              'skillVersion',1)), 1
        FROM cloud_tasks WHERE type='agent-run'`);
      const runs = await listCloudTasks({ userId: 'owner', projectId: 'project-1', limit: 20,
        skillRun: { surface: 'canvas', workspaceId: 'w1', skillId: 'food' } });
      expect(runs.map(run => run.id)).toEqual(['target']);
      const none = await listCloudTasks({ userId: 'owner', projectId: 'project-1', limit: 20,
        skillRun: { surface: 'simple-chat', workspaceId: 'w1', skillId: 'food' } });
      expect(none).toEqual([]);
      const injection = await listCloudTasks({ userId: 'owner', projectId: 'project-1', limit: 20,
        skillRun: { surface: 'canvas', skillId: "food' OR TRUE --" } });
      expect(injection).toEqual([]);
      await query(`UPDATE wujie_agent_events SET workspace='chat', payload=jsonb_set(payload,'{workspace}','"chat"'::jsonb)
        WHERE task_id='target'`);
      const chat = await listCloudTasks({ userId: 'owner', projectId: 'project-1', limit: 20,
        skillRun: { surface: 'simple-chat', workspaceId: 'w1', skillId: 'food' } });
      expect(chat.map(run => run.id)).toEqual(['target']);
    });
  });
});

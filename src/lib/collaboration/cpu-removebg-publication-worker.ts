import 'server-only';

import { getAdvisoryLockPool, getPool } from '@/lib/db-client';
import { getCloudTaskForUser } from '@/lib/cloud-task-storage';
import { recordTaskProjectionPending } from '@/lib/asset-core/task-projector';
import { projectCanvasTaskResult } from './task-result-publication';

interface DrainOptions {
  limit?: number;
  now?: number;
}

interface DrainResult {
  selected: number;
  attempted: number;
}

interface CandidateRow {
  task_id: string;
  user_id: string;
  project_id: string;
}

const RETRY_INTERVAL_MS = 60_000;

export async function drainPendingCpuRemoveBgPublications(
  options: DrainOptions = {},
): Promise<DrainResult> {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 10), 50));
  const now = options.now ?? Date.now();
  const retryBefore = new Date(now - RETRY_INTERVAL_MS).toISOString();
  const candidates = await getPool().query<CandidateRow>(`
    SELECT t.id AS task_id, t.user_id, t.project_id
    FROM cloud_tasks t
    JOIN wujie_canvas_task_publications p
      ON p.task_id=t.id AND p.actor_id=t.user_id AND p.project_id=t.project_id
    WHERE t.status='completed' AND t.provider_id='local-rembg'
      AND t.result #>> '{imageEditAdmission,kind}' = 'document-cpu-removebg'
      AND p.publication_intent IS NOT NULL
      AND COALESCE(t.result #>> '{assetProjection,status}', '') <> 'completed'
      AND COALESCE(t.result #>> '{assetProjection,lastAttemptAt}', '') < $1
    ORDER BY COALESCE(t.result #>> '{assetProjection,lastAttemptAt}', '') ASC,
      t.updated_at ASC, t.id ASC
    LIMIT $2
  `, [retryBefore, limit]);

  let attempted = 0;
  for (const candidate of candidates.rows) {
    const client = await getAdvisoryLockPool().connect();
    const lockKey = `cpu-removebg-publication:${candidate.task_id}`;
    let locked = false;
    let discard = false;
    try {
      locked = (await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [lockKey],
      )).rows[0]?.acquired === true;
      if (!locked) continue;
      const task = await getCloudTaskForUser(candidate.task_id, candidate.user_id);
      const projection = task?.result?.assetProjection as {
        status?: unknown; lastAttemptAt?: unknown;
      } | undefined;
      const lastAttemptAt = typeof projection?.lastAttemptAt === 'string'
        ? Date.parse(projection.lastAttemptAt) : NaN;
      if (!task || task.status !== 'completed' || task.providerId !== 'local-rembg'
        || task.projectId !== candidate.project_id
        || (task.result?.imageEditAdmission as { kind?: unknown } | undefined)?.kind !== 'document-cpu-removebg'
        || projection?.status === 'completed'
        || (Number.isFinite(lastAttemptAt) && lastAttemptAt > now - RETRY_INTERVAL_MS)) continue;
      attempted++;
      try {
        const references = await projectCanvasTaskResult({
          actorUserId: task.userId,
          taskId: task.id,
          targetProjectId: candidate.project_id,
          workspace: 'canvas',
          parentVersionIds: [],
        });
        if (references && references.length !== 2) {
          throw new Error('CPU remove-background publication requires two outputs');
        }
      } catch (error) {
        try {
          await recordTaskProjectionPending({ actorUserId: task.userId, taskId: task.id,
            reason: error instanceof Error ? error.message : String(error) });
        } catch {
          console.warn({ code: 'CPU_REMOVEBG_PUBLICATION_PENDING_AUDIT_FAILED' });
        }
      }
    } catch {
      console.warn({ code: 'CPU_REMOVEBG_PUBLICATION_ATTEMPT_FAILED' });
    } finally {
      if (locked) {
        try {
          const released = (await client.query<{ released: boolean }>(
            'SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released', [lockKey],
          )).rows[0]?.released === true;
          if (!released) discard = true;
        } catch { discard = true; }
      }
      client.release(discard);
    }
  }
  return { selected: candidates.rows.length, attempted };
}

const WORKER_STATE = Symbol.for('wujie.cpuRemoveBgPublicationWorker');

interface WorkerHandle {
  stop(): void;
}

interface WorkerState {
  handle: WorkerHandle;
  timer: ReturnType<typeof setInterval>;
  running: boolean;
  stopped: boolean;
}

type WorkerGlobal = typeof globalThis & { [WORKER_STATE]?: WorkerState };

export function startCpuRemoveBgPublicationWorker(options: {
  drain?: typeof drainPendingCpuRemoveBgPublications;
  intervalMs?: number;
} = {}): WorkerHandle {
  const scope = globalThis as WorkerGlobal;
  const existing = scope[WORKER_STATE];
  if (existing && !existing.stopped) return existing.handle;

  const drain = options.drain ?? drainPendingCpuRemoveBgPublications;
  const intervalMs = Math.max(1_000, Math.min(options.intervalMs ?? RETRY_INTERVAL_MS, 60 * 60_000));
  const run = (): void => {
    const state = scope[WORKER_STATE];
    if (!state || state.stopped || state.running) return;
    state.running = true;
    void drain({ limit: 10 }).catch(() => {
      console.warn({ code: 'CPU_REMOVEBG_PUBLICATION_WORKER_DRAIN_FAILED' });
    }).finally(() => {
      if (scope[WORKER_STATE] === state) state.running = false;
    });
  };
  const handle: WorkerHandle = {
    stop(): void {
      const state = scope[WORKER_STATE];
      if (!state || state.handle !== handle) return;
      state.stopped = true;
      clearInterval(state.timer);
      delete scope[WORKER_STATE];
    },
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  scope[WORKER_STATE] = { handle, timer, running: false, stopped: false };
  run();
  return handle;
}

export function stopCpuRemoveBgPublicationWorker(): void {
  (globalThis as WorkerGlobal)[WORKER_STATE]?.handle.stop();
}

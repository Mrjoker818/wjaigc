import 'server-only';

import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/db-client';
import {
  claimCloudTaskLease,
  getCloudTaskForUser,
  releaseCloudTaskLease,
  terminateCloudTaskAndRefund,
  type CloudTask,
} from '@/lib/cloud-task-storage';

const MINIMUM_TASK_AGE_MS = 10 * 60_000;
const RECOVERY_LEASE_MS = 30_000;
const SCAN_INTERVAL_MS = 60_000;

interface CandidateRow {
  task_id: string;
  user_id: string;
}

interface DrainOptions {
  limit?: number;
  now?: number;
}

interface DrainResult {
  selected: number;
  transitioned: number;
}

export function getCpuRemoveBgStaleAt(task: Pick<CloudTask, 'createdAt' | 'leaseExpiresAt'>): number {
  return Math.max(task.createdAt + MINIMUM_TASK_AGE_MS, (task.leaseExpiresAt || 0) + 1);
}

function hasCpuRemoveBgRecoveryIdentity(task: CloudTask): boolean {
  const admission = task.result?.imageEditAdmission as {
    kind?: unknown;
    requestDigest?: unknown;
  } | undefined;
  return task.type === 'image-edit' && task.status === 'processing'
    && task.providerId === 'local-rembg'
    && (task.id.startsWith('removebg-cpu-') || task.id.startsWith('image_edit_removebg_cpu_'))
    && admission?.kind === 'document-cpu-removebg'
    && typeof task.requestDigest === 'string' && task.requestDigest.length > 0
    && admission.requestDigest === task.requestDigest;
}

function isRecoverableCpuRemoveBgTask(task: CloudTask, now: number): boolean {
  return hasCpuRemoveBgRecoveryIdentity(task) && now >= getCpuRemoveBgStaleAt(task);
}

export async function recoverAbandonedCpuRemoveBgTask(
  taskId: string,
  userId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const before = await getCloudTaskForUser(taskId, userId);
  if (!before || !before.requestDigest || !isRecoverableCpuRemoveBgTask(before, now)) return false;

  const owner = `removebg-recovery:${randomUUID()}`;
  const lease = await claimCloudTaskLease(taskId, owner, RECOVERY_LEASE_MS, now);
  if (!lease) return false;
  try {
    const current = await getCloudTaskForUser(taskId, userId);
    if (!current || !hasCpuRemoveBgRecoveryIdentity(current)
      || current.leaseOwner !== owner || current.createdAt + MINIMUM_TASK_AGE_MS > now) return false;
    const settled = await terminateCloudTaskAndRefund(taskId, 'timeout',
      'CPU 去背景执行中断，积分已退回', owner, { requireActive: true,
        expectedCpuRemoveBg: { userId, requestDigest: before.requestDigest,
          createdBefore: now - MINIMUM_TASK_AGE_MS } });
    return settled.transitioned;
  } finally {
    await releaseCloudTaskLease(taskId, owner);
  }
}

export async function drainAbandonedCpuRemoveBgTasks(options: DrainOptions = {}): Promise<DrainResult> {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 10), 50));
  const candidates = await getPool().query<CandidateRow>(`
    SELECT t.id AS task_id, t.user_id
    FROM cloud_tasks t
    WHERE t.type='image-edit' AND t.status='processing' AND t.provider_id='local-rembg'
      AND (starts_with(t.id, 'removebg-cpu-') OR starts_with(t.id, 'image_edit_removebg_cpu_'))
      AND t.result #>> '{imageEditAdmission,kind}' = 'document-cpu-removebg'
      AND t.result #>> '{imageEditAdmission,requestDigest}' = t.request_digest
      AND t.request_digest <> ''
      AND t.created_at <= $1 AND COALESCE(t.lease_expires_at,0) < $2
    ORDER BY t.updated_at ASC, t.id ASC
    LIMIT $3
  `, [now - MINIMUM_TASK_AGE_MS, now, limit]);

  let transitioned = 0;
  for (const candidate of candidates.rows) {
    try {
      if (await recoverAbandonedCpuRemoveBgTask(candidate.task_id, candidate.user_id, now)) {
        transitioned++;
      }
    } catch {
      console.warn({ code: 'CPU_REMOVEBG_TIMEOUT_RECOVERY_FAILED' });
    }
  }
  return { selected: candidates.rows.length, transitioned };
}

const WORKER_STATE = Symbol.for('wujie.cpuRemoveBgTimeoutWorker');

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

export function startCpuRemoveBgTimeoutWorker(options: {
  drain?: typeof drainAbandonedCpuRemoveBgTasks;
  intervalMs?: number;
} = {}): WorkerHandle {
  const scope = globalThis as WorkerGlobal;
  const existing = scope[WORKER_STATE];
  if (existing && !existing.stopped) return existing.handle;

  const drain = options.drain ?? drainAbandonedCpuRemoveBgTasks;
  const intervalMs = Math.max(1_000, Math.min(options.intervalMs ?? SCAN_INTERVAL_MS, 60 * 60_000));
  const run = (): void => {
    const state = scope[WORKER_STATE];
    if (!state || state.stopped || state.running) return;
    state.running = true;
    void drain({ limit: 10 }).catch(() => {
      console.warn({ code: 'CPU_REMOVEBG_TIMEOUT_DRAIN_FAILED' });
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

export function stopCpuRemoveBgTimeoutWorker(): void {
  (globalThis as WorkerGlobal)[WORKER_STATE]?.handle.stop();
}

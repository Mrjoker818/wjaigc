import { vi } from 'vitest';
import type { CloudTask, CompleteCloudTaskOptions, CreateCloudTaskInput, UpdateCloudTaskInput } from '@/lib/cloud-task-storage';

export function createDisplay3DCloudTaskStore() {
  const rows = new Map<string, CloudTask>();
  const live = (row: CloudTask) => !['completed', 'failed', 'cancelled', 'timeout'].includes(row.status);
  return {
    createCloudTask: vi.fn(async (input: CreateCloudTaskInput) => {
      if (rows.has(input.id)) return false;
      rows.set(input.id, { ...structuredClone(input), creditStatus: input.creditStatus ?? 'pending' });
      return true;
    }),
    getCloudTaskForUser: vi.fn(async (id: string, actor: string) => {
      const row = rows.get(id);
      return row?.userId === actor ? structuredClone(row) : null;
    }),
    getCloudTaskById: vi.fn(async (id: string) => structuredClone(rows.get(id) ?? null)),
    claimCloudTaskLease: vi.fn(async (id: string, owner: string, ttl: number) => {
      const row = rows.get(id);
      if (!row || !live(row) || (row.leaseExpiresAt ?? 0) > Date.now()) return null;
      row.leaseOwner = owner;
      row.leaseExpiresAt = Date.now() + ttl;
      row.attemptCount = (row.attemptCount ?? 0) + 1;
      return { taskId: id, owner, expiresAt: row.leaseExpiresAt, attemptCount: row.attemptCount };
    }),
    releaseCloudTaskLease: vi.fn(async (id: string, owner: string) => {
      const row = rows.get(id);
      if (row?.leaseOwner !== owner) return false;
      row.leaseOwner = undefined;
      row.leaseExpiresAt = 0;
      return true;
    }),
    deferCloudTaskRecovery: vi.fn(async (id: string, owner: string, delay: number, label: string) => {
      const row = rows.get(id);
      if (!row || row.leaseOwner !== owner || !live(row)) return false;
      row.leaseOwner = undefined;
      row.leaseExpiresAt = Date.now() + delay;
      row.label = label;
      return true;
    }),
    updateCloudTask: vi.fn(async (id: string, input: UpdateCloudTaskInput) => {
      const row = rows.get(id);
      if (!row || !live(row) || (input.expectedStatuses && !input.expectedStatuses.includes(row.status))
        || (input.leaseOwner && row.leaseOwner !== input.leaseOwner)
        || (input.expectedLeaseAttemptCount !== undefined && (row.attemptCount !== input.expectedLeaseAttemptCount
          || (row.leaseExpiresAt ?? 0) <= Date.now()))) return false;
      for (const key of ['status', 'progress', 'label', 'error', 'remoteTaskId'] as const) {
        if (input[key] !== undefined) Object.assign(row, { [key]: input[key] });
      }
      if (input.result) row.result = { ...(input.mergeResult ? row.result : {}), ...structuredClone(input.result) };
      return true;
    }),
    completeCloudTask: vi.fn(async (id: string, result: Record<string, unknown>, options: CompleteCloudTaskOptions) => {
      const row = rows.get(id);
      if (row?.status !== 'processing' || row.leaseOwner !== options.leaseOwner
        || row.attemptCount !== options.leaseAttemptCount || (row.leaseExpiresAt ?? 0) <= Date.now()) return false;
      Object.assign(row, { status: 'completed', progress: 100, result: { ...row.result, ...structuredClone(result) } });
      return true;
    }),
    CloudTaskAdmissionError: class CloudTaskAdmissionError extends Error {},
  };
}

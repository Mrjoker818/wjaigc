import { randomUUID } from 'node:crypto';
import { parseResponseForProfile, resolveProfileForModel, type ApiCompatProfile } from '@/lib/api-compatibility';
import { fetchWithV1Retry } from '@/lib/api-helpers';
import { claimCloudTaskLease, completeCloudTask, deferCloudTaskRecovery, getCloudTaskForUser, releaseCloudTaskLease, updateCloudTask,
  type CloudTask, type CloudTaskLease } from '@/lib/cloud-task-storage';
import { configuredPaidProviderBaseUrl } from '@/lib/paid-provider-submit';
import { findProviderById } from '@/lib/server-api-config';
import { isTaskCancelled, updateTaskProgress } from '@/lib/task-registry';

export const DISPLAY3D_QUEUE_WAIT_MS = 300_000;
export const DISPLAY3D_POLL_WINDOW_MS = 305_000;
export const DISPLAY3D_QUEUE_EXPIRED = '排队已结束，任务未向供应商提交';
export const DISPLAY3D_UNCONFIRMED = '展陈任务结果待核实，请保留任务编号并核实供应商状态和费用';
export const DISPLAY3D_IMAGE_PATH = '/images/generations';

interface RemoteReceipt {
  state: 'remote';
  configuredBase: string;
  pollBase: string;
  pollPath: string;
  acceptedAt: number;
}

type DisplayReceipt = { state: 'queued' | 'started' } | { state: 'direct' } | RemoteReceipt;

export function display3DRemoteReceipt(baseUrl: string, responseUrl: string, remoteId: string, profile: ApiCompatProfile): RemoteReceipt | undefined {
  if (!remoteId.trim() || remoteId === '.' || remoteId === '..') return undefined;
  const encodedId = encodeURIComponent(remoteId);
  let pollBase = baseUrl;
  try {
    const submitted = new URL(responseUrl);
    if (submitted.origin === new URL(baseUrl).origin && !submitted.username && !submitted.password
      && !submitted.search && !submitted.hash && submitted.pathname.endsWith(DISPLAY3D_IMAGE_PATH)) {
      pollBase = configuredPaidProviderBaseUrl(submitted.href.slice(0, -DISPLAY3D_IMAGE_PATH.length));
    }
  } catch { /* The configured base is authoritative when the transport supplies no usable URL. */ }
  const template = profile.pollPathTemplate;
  const pollPath = template?.startsWith('/') && template.includes('{taskId}')
    ? template.replace('{taskId}', encodedId) : `/tasks/${encodedId}`;
  return { state: 'remote', configuredBase: baseUrl, pollBase, pollPath, acceptedAt: Date.now() };
}

export function display3DProviderTerminal(data: Record<string, unknown>): 'failed' | 'cancelled' | undefined {
  const nested = (Array.isArray(data.data) ? data.data[0] : data.data) as Record<string, unknown> | undefined;
  const status = [nested?.status, nested?.task_status, data.status, data.task_status]
    .find((value): value is string => typeof value === 'string')?.trim().toLowerCase();
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status && ['failed', 'failure', 'fail'].includes(status)) return 'failed';
  return undefined;
}

export function display3DLeaseFence(lease: CloudTaskLease) {
  return { leaseOwner: lease.owner, expectedLeaseAttemptCount: lease.attemptCount };
}

function resultWithImages(imageUrls: string[], prompt: unknown) {
  return { imageUrls, prompt, type: 'display3d' };
}

function imageUrlsFrom(result: Record<string, unknown> | undefined): string[] {
  return Array.isArray(result?.imageUrls)
    ? result.imageUrls.filter((url): url is string => typeof url === 'string' && Boolean(url.trim())) : [];
}

export async function completeDisplay3DTask(taskId: string, lease: CloudTaskLease, imageUrls: string[], prompt: unknown): Promise<boolean> {
  const result = resultWithImages(imageUrls, prompt);
  const completed = await completeCloudTask(taskId, result, {
    leaseOwner: lease.owner, leaseAttemptCount: lease.attemptCount, deadlineAt: lease.expiresAt,
  });
  if (completed) updateTaskProgress(taskId, { status: 'completed', progress: 100, result });
  return completed;
}

export async function failDisplay3DTask(taskId: string, lease: CloudTaskLease, status: 'failed' | 'cancelled', error?: string): Promise<boolean> {
  const message = error ?? (status === 'cancelled' ? '供应商已确认任务取消' : '供应商已确认展陈生成失败');
  const transitioned = await updateCloudTask(taskId, {
    ...display3DLeaseFence(lease), expectedStatuses: ['processing'], status, error: message,
  });
  if (transitioned) updateTaskProgress(taskId, { status, error: message });
  return transitioned;
}

/** Recover an accepted display receipt by reading its result or querying the provider. */
export async function pollDisplay3DTask(taskId: string, userId: string, cancellation?: AbortSignal): Promise<CloudTask | null> {
  const task = await getCloudTaskForUser(taskId, userId);
  if (!task || task.type !== 'display3d') return null;
  if (task.status === 'queued' && Date.now() - task.createdAt > DISPLAY3D_QUEUE_WAIT_MS) {
    if (await updateCloudTask(task.id, { status: 'failed', expectedStatuses: ['queued'], error: DISPLAY3D_QUEUE_EXPIRED })) {
      updateTaskProgress(task.id, { status: 'failed', error: DISPLAY3D_QUEUE_EXPIRED });
    }
    return getCloudTaskForUser(task.id, userId);
  }
  const receipt = task.result?.display3dReceipt as DisplayReceipt | undefined;
  if (task.status !== 'processing' || (receipt?.state !== 'remote' && receipt?.state !== 'direct')
    || cancellation?.aborted || isTaskCancelled(taskId)) return task;

  const lease = await claimCloudTaskLease(taskId, `display3d-poll-${randomUUID()}`, 40_000);
  if (!lease) return task;
  let polled = false;
  let settled = false;
  try {
    if (receipt.state === 'direct') {
      const imageUrls = imageUrlsFrom(task.result);
      if (imageUrls.length) settled = await completeDisplay3DTask(taskId, lease, imageUrls, task.result?.prompt);
    } else if (task.providerId && task.remoteTaskId) {
      const provider = await findProviderById(task.providerId);
      const remainingLeaseMs = lease.expiresAt - Date.now();
      const timeout = AbortSignal.timeout(Math.max(0, Math.min(30_000, remainingLeaseMs)));
      const signal = cancellation ? AbortSignal.any([cancellation, timeout]) : timeout;
      if (provider?.apiKey && configuredPaidProviderBaseUrl(provider.baseUrl) === receipt.configuredBase
        && new URL(configuredPaidProviderBaseUrl(receipt.pollBase)).origin === new URL(receipt.configuredBase).origin
        && receipt.pollPath.startsWith('/') && remainingLeaseMs > 0 && !signal.aborted && !isTaskCancelled(taskId)) {
        polled = true;
        const response = await fetchWithV1Retry(receipt.pollBase, receipt.pollPath, {
          method: 'GET', redirect: 'manual', signal, headers: { Authorization: `Bearer ${provider.apiKey}` },
        });
        if (response.ok && !signal.aborted && !isTaskCancelled(taskId)) {
          const data: unknown = await response.json();
          if (data && typeof data === 'object' && !Array.isArray(data) && !signal.aborted && !isTaskCancelled(taskId)) {
            const record = data as Record<string, unknown>;
            const terminal = display3DProviderTerminal(record);
            if (terminal) settled = await failDisplay3DTask(taskId, lease, terminal);
            else {
              const parsed = parseResponseForProfile(record, resolveProfileForModel(task.model || '', provider));
              if (parsed.directImageUrls.length) settled = await completeDisplay3DTask(taskId, lease, parsed.directImageUrls, task.result?.prompt);
            }
          }
        }
      }
    }
  } catch {
    // The accepted receipt remains available for the next read after a transport or storage interruption.
  } finally {
    const deferred = polled && !settled && !cancellation?.aborted && !isTaskCancelled(taskId)
      && await deferCloudTaskRecovery(taskId, lease.owner, 4_000, '正在查询展陈结果...').catch(() => false);
    if (!deferred) await releaseCloudTaskLease(taskId, lease.owner).catch(() => false);
  }
  return getCloudTaskForUser(task.id, userId);
}

export function display3DTaskResponse(task: CloudTask): Record<string, unknown> {
  const { id: taskId, status, progress, label } = task;
  const imageUrls = imageUrlsFrom(task.result);
  if (status === 'completed' && imageUrls.length) {
    return { success: true, taskId, status, progress, imageUrls, result: resultWithImages(imageUrls, task.result?.prompt) };
  }
  if (status === 'failed' || status === 'cancelled' || status === 'timeout') {
    return { success: false, taskId, status, progress, error: task.error || '展陈任务未完成', retryable: false };
  }
  const receipt = task.result?.display3dReceipt as DisplayReceipt | undefined;
  const unconfirmed = (receipt?.state === 'started' && (!task.leaseOwner || (task.leaseExpiresAt ?? 0) <= Date.now()))
    || (receipt?.state === 'remote' && Date.now() - receipt.acceptedAt >= DISPLAY3D_POLL_WINDOW_MS)
    || (receipt?.state === 'direct' && !imageUrls.length) || !receipt || status === 'completed';
  return unconfirmed ? { success: true, taskId, status: 'processing', progress, label: DISPLAY3D_UNCONFIRMED,
    code: 'DISPLAY3D_OUTCOME_UNCONFIRMED', retryable: false, requiresReconciliation: true }
    : { success: true, taskId, status, progress, label };
}

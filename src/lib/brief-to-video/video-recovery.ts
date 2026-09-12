import 'server-only';

import { getInternalRequestHeaders } from '@/lib/api-auth';
import { getInternalApiUrl } from '@/lib/api-helpers';
import {
  AgentDownstreamProviderRejectedError,
  AgentDownstreamSubmissionUnknownError,
} from '@/lib/agent-runtime/downstream-operations';
import { getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';
import type {
  BriefVideoSubmission,
  ExecuteBriefToVideoStepDependencies,
  ExecuteBriefToVideoStepInput,
} from './video-adapter';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'timeout']);

function projectionVersionIds(task: CloudTask): string[] {
  const projection = task.result?.assetProjection;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return [];
  const versionIds = (projection as Record<string, unknown>).versionIds;
  return Array.isArray(versionIds)
    ? versionIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];
}

function optionalResultString(task: CloudTask, key: string): string | undefined {
  const value = task.result?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function assertKnownBriefVideoState(task: CloudTask | null): void {
  const taskError = task?.result?.taskError;
  if (task?.status === 'processing' && taskError && typeof taskError === 'object'
    && !Array.isArray(taskError) && (taskError as Record<string, unknown>).code === 'SKILL_SUBMISSION_UNKNOWN') {
    throw new AgentDownstreamSubmissionUnknownError();
  }
}

async function waitForNextStatus(signal: AbortSignal, delayMs: number): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function submitBriefVideoInternal(
  submission: BriefVideoSubmission,
  input: ExecuteBriefToVideoStepInput,
): Promise<Response> {
  const internalHeaders = await getInternalRequestHeaders(input.actorUserId, input.actorRole);
  return fetch(getInternalApiUrl(submission.endpoint), {
    method: 'POST',
    headers: { ...submission.headers, ...internalHeaders },
    body: JSON.stringify(submission.body),
    signal: input.signal,
  });
}

export async function recoverBriefToVideoOperation(
  taskId: string,
  input: ExecuteBriefToVideoStepInput,
  options: { maxPolls?: number; pollIntervalMs?: number } = {},
): Promise<{
  assetVersionIds: readonly string[];
  remoteTaskId?: string;
  thumbnailUrl?: string;
}> {
  const maxPolls = options.maxPolls ?? 360;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const headers = await getInternalRequestHeaders(input.actorUserId, input.actorRole);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    input.signal.throwIfAborted();
    const current = await getCloudTaskForUser(taskId, input.actorUserId);
    assertKnownBriefVideoState(current);
    if (!current || current.projectId !== input.projectId || current.type !== 'video') {
      throw new AgentDownstreamProviderRejectedError(undefined, {
        message: 'Accepted Brief video task is unavailable',
      });
    }
    if (current.status === 'completed') {
      const assetVersionIds = projectionVersionIds(current);
      if (assetVersionIds.length === 1) {
        return {
          assetVersionIds,
          ...(current.remoteTaskId ? { remoteTaskId: current.remoteTaskId } : {}),
          ...(optionalResultString(current, 'videoThumbnailUrl')
            ? { thumbnailUrl: optionalResultString(current, 'videoThumbnailUrl') }
            : {}),
        };
      }
      if (assetVersionIds.length > 1) {
        throw new AgentDownstreamProviderRejectedError(undefined, {
          message: 'Brief video task produced multiple AssetVersions',
        });
      }
    }
    if (TERMINAL_FAILURES.has(current.status)) {
      throw new AgentDownstreamProviderRejectedError(undefined, {
        message: current.error || `Brief video task ended as ${current.status}`,
      });
    }

    const response = await fetch(getInternalApiUrl('/api/poll-task'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        taskId,
        providerId: input.modelBinding.providerId,
        model: input.modelBinding.modelId,
      }),
      signal: input.signal,
    });
    if (response.status === 401 || response.status === 403 || response.status >= 500) {
      throw new AgentDownstreamProviderRejectedError(response.status, {
        message: 'Brief video task recovery request was rejected',
      });
    }
    if (attempt + 1 < maxPolls) await waitForNextStatus(input.signal, pollIntervalMs);
  }
  throw new AgentDownstreamSubmissionUnknownError(
    new Error('Brief video task did not reach a terminal state within the recovery window'),
  );
}

export const productionBriefVideoExecution: ExecuteBriefToVideoStepDependencies = {
  submit: submitBriefVideoInternal,
  monitor: recoverBriefToVideoOperation,
};

import {
  getCloudTaskById,
  transitionCloudTaskStatus,
  type CloudTaskCreditStatus,
  type PersistedCloudTask,
} from '@/lib/cloud-task-storage';
import { updateTaskProgress } from '@/lib/task-registry';
import {
  canTransitionTaskStatus,
  normalizeDurableTaskStatus,
  type DurableTask,
  type DurableTaskStatus,
  type TaskErrorInput,
} from '@/lib/task-core/task-state';

export interface TransitionTaskInput {
  taskId: string;
  from: DurableTaskStatus[];
  to: DurableTaskStatus;
  revision?: number;
  result?: Record<string, unknown>;
  error?: TaskErrorInput;
  creditStatus?: CloudTaskCreditStatus;
}

export interface TransitionTaskResult {
  transitioned: boolean;
  task: DurableTask;
}

export interface PublishDurableDirectTaskInput {
  taskId: string;
  createTask: () => Promise<boolean>;
  prepareCompletion: () => Promise<Record<string, unknown>>;
  completeTask: (
    prepared: Record<string, unknown>,
  ) => Promise<TransitionTaskResult | undefined>;
}

export interface ExposeDurableDirectTaskInput {
  taskId: string;
  task: DurableTask;
  taskIds: string[];
  directImageUrls: string[];
  publishRegistry: (task: DurableTask) => void;
  onPublishError?: (error: unknown) => void;
}

export interface PublishGenerateTaskCandidatesInput {
  candidateTaskIds: readonly string[];
  authoritativeDirectTaskIds: ReadonlySet<string>;
  prepublishedTaskIds?: ReadonlySet<string>;
  skipCloudTaskPersistence: boolean;
  createDurableTask: (taskId: string) => Promise<boolean>;
  publishProcessing: (taskId: string) => void;
  onPersistenceError?: (taskId: string, error: unknown) => void;
  onProjectionError?: (taskId: string, error: unknown) => void;
}

export interface GenerateTaskPublicationFailure {
  taskId: string;
  reason: 'create-rejected' | 'create-error';
  error?: unknown;
}

export interface PublishGenerateTaskCandidatesResult {
  publishedTaskIds: string[];
  failures: GenerateTaskPublicationFailure[];
}

export type PublishDurableDirectTaskResult =
  | {
      published: true;
      taskId: string;
      transitioned: boolean;
      task: DurableTask;
    }
  | {
      published: false;
      taskId: string;
      reason: 'create-rejected' | 'terminal-missing' | 'terminal-not-completed';
      task?: DurableTask;
    };

export class TaskNotFoundError extends Error {
  readonly code = 'TASK_NOT_FOUND';

  constructor(readonly taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export function getTaskResultImageUrls(
  task: Pick<DurableTask, 'result'>,
): string[] {
  const result = task.result;
  if (!result || typeof result !== 'object') return [];

  const urls: string[] = [];
  if (Array.isArray(result.imageUrls)) {
    urls.push(...result.imageUrls.filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    ));
  }
  if (typeof result.imageUrl === 'string' && result.imageUrl.length > 0) {
    urls.push(result.imageUrl);
  }
  return Array.from(new Set(urls));
}

export function exposeDurableDirectTask(
  input: ExposeDurableDirectTaskInput,
): void {
  input.taskIds.push(input.taskId);
  const firstImageUrl = getTaskResultImageUrls(input.task)[0];
  if (firstImageUrl) {
    input.directImageUrls.push(firstImageUrl);
  }

  try {
    input.publishRegistry(input.task);
  } catch (error) {
    try {
      input.onPublishError?.(error);
    } catch {
      // The durable task is already reachable by taskId.
    }
  }
}

export async function publishGenerateTaskCandidates(
  input: PublishGenerateTaskCandidatesInput,
): Promise<PublishGenerateTaskCandidatesResult> {
  const publishedTaskIds: string[] = [];
  const failures: GenerateTaskPublicationFailure[] = [];
  const seen = new Set<string>();

  for (const taskId of input.candidateTaskIds) {
    if (seen.has(taskId)) continue;
    seen.add(taskId);

    if (
      input.authoritativeDirectTaskIds.has(taskId)
      || input.prepublishedTaskIds?.has(taskId)
    ) {
      publishedTaskIds.push(taskId);
      continue;
    }

    if (!input.skipCloudTaskPersistence) {
      let created: boolean;
      try {
        created = await input.createDurableTask(taskId);
      } catch (error) {
        failures.push({ taskId, reason: 'create-error', error });
        try {
          input.onPersistenceError?.(taskId, error);
        } catch {
          // The failed candidate remains excluded from the response.
        }
        continue;
      }
      if (!created) {
        const error = new Error(`Durable task creation rejected: ${taskId}`);
        failures.push({ taskId, reason: 'create-rejected' });
        try {
          input.onPersistenceError?.(taskId, error);
        } catch {
          // The failed candidate remains excluded from the response.
        }
        continue;
      }
    }

    try {
      input.publishProcessing(taskId);
    } catch (error) {
      try {
        input.onProjectionError?.(taskId, error);
      } catch {
        // PostgreSQL is authoritative once durable creation succeeds.
      }
    }
    publishedTaskIds.push(taskId);
  }

  return { publishedTaskIds, failures };
}

export async function publishDurableDirectTask(
  input: PublishDurableDirectTaskInput,
): Promise<PublishDurableDirectTaskResult> {
  const created = await input.createTask();
  if (!created) {
    return {
      published: false,
      taskId: input.taskId,
      reason: 'create-rejected',
    };
  }

  const prepared = await input.prepareCompletion();
  const terminal = await input.completeTask(prepared);
  if (!terminal) {
    return {
      published: false,
      taskId: input.taskId,
      reason: 'terminal-missing',
    };
  }
  if (terminal.task.status !== 'completed') {
    return {
      published: false,
      taskId: input.taskId,
      reason: 'terminal-not-completed',
      task: terminal.task,
    };
  }

  return {
    published: true,
    taskId: input.taskId,
    transitioned: terminal.transitioned,
    task: terminal.task,
  };
}

export async function transitionTask(
  input: TransitionTaskInput,
): Promise<TransitionTaskResult> {
  if (input.from.length === 0) {
    throw new Error('Task transition requires at least one source status');
  }

  const current = await getCloudTaskById(input.taskId);
  if (!current) {
    throw new TaskNotFoundError(input.taskId);
  }

  const durableCurrent = toDurableTask(current);
  if (
    !input.from.includes(durableCurrent.status)
    || !canTransitionTaskStatus(durableCurrent.status, input.to)
    || (
      input.revision !== undefined
      && input.revision !== durableCurrent.revision
    )
  ) {
    return { transitioned: false, task: durableCurrent };
  }

  const outcome = await transitionCloudTaskStatus({
    taskId: input.taskId,
    from: input.from,
    to: input.to,
    revision: input.revision ?? durableCurrent.revision,
    result: input.result,
    error: input.error,
    creditStatus: input.creditStatus,
  });
  if (!outcome.task) {
    throw new TaskNotFoundError(input.taskId);
  }

  const task = toDurableTask(outcome.task);
  if (outcome.transitioned) {
    updateTaskProgress(task.id, {
      status: toProjectionStatus(task.status),
      progress: task.progress,
      result: task.result,
      error: task.error,
    });
  }

  return { transitioned: outcome.transitioned, task };
}

function toDurableTask(task: PersistedCloudTask): DurableTask {
  return {
    ...task,
    status: normalizeDurableTaskStatus(task.status),
    legacyStatus: task.status === 'pending' ? 'pending' : undefined,
    revision: task.revision ?? 0,
  };
}

function toProjectionStatus(
  status: DurableTaskStatus,
): 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout' {
  switch (status) {
    case 'created':
    case 'queued':
      return 'queued';
    case 'submitting':
      return 'pending';
    case 'processing':
    case 'uploading':
      return 'processing';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'timeout':
      return 'timeout';
  }
}

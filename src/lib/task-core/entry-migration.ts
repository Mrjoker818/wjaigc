import type {
  CloudTaskCreditStatus,
  CloudTaskStatus,
} from '@/lib/cloud-task-storage';

export type TaskCoreMode = 'legacy' | 'shadow' | 'core-v2';
export type TaskEntryKind = 'image' | 'video' | 'edit' | '3d' | 'layer' | 'agent';

export interface TaskEntryFacts {
  providerId?: string;
  modelId?: string;
  creditCost?: number;
  status?: CloudTaskStatus;
}

export interface TaskEntryComparison {
  matches: boolean;
  mismatches: Array<keyof TaskEntryFacts>;
}

export interface TaskEntryMigrationInput<T> {
  mode: TaskCoreMode;
  legacy: () => Promise<T>;
  coreV2: () => Promise<T>;
  factsFromResult: (value: T) => TaskEntryFacts;
  previewCoreFacts?: () => Promise<TaskEntryFacts>;
}

export interface TaskEntryMigrationResult<T> {
  value: T;
  mode: TaskCoreMode;
  comparison?: TaskEntryComparison;
}

export interface TaskEntryAuditInput {
  entry: TaskEntryKind;
  mode: TaskCoreMode;
  requestId: string;
  requestedProviderId?: string;
  requestedModelId?: string;
  actualProviderId?: string;
  actualModelId?: string;
  startedAt: number;
  updatedAt?: number;
  creditCost?: number;
  creditStatus?: CloudTaskCreditStatus;
  comparison?: TaskEntryComparison;
}

export interface TaskEntryAudit {
  entry: TaskEntryKind;
  mode: TaskCoreMode;
  handlerVersion: 'legacy' | 'task-core-v2-shadow' | 'task-core-v2';
  requestId: string;
  requestedProviderId?: string;
  requestedModelId?: string;
  actualProviderId?: string;
  actualModelId?: string;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
  creditCost: number;
  creditStatus: CloudTaskCreditStatus;
  comparison?: TaskEntryComparison;
}

export function resolveTaskCoreMode(value: string | undefined): TaskCoreMode {
  if (value === 'shadow' || value === 'core-v2') return value;
  return 'legacy';
}

export function createTaskEntryAudit(input: TaskEntryAuditInput): TaskEntryAudit {
  const updatedAt = Math.max(input.startedAt, input.updatedAt ?? Date.now());
  return {
    entry: input.entry,
    mode: input.mode,
    handlerVersion: input.mode === 'core-v2'
      ? 'task-core-v2'
      : input.mode === 'shadow'
        ? 'task-core-v2-shadow'
        : 'legacy',
    requestId: input.requestId,
    ...(input.requestedProviderId ? { requestedProviderId: input.requestedProviderId } : {}),
    ...(input.requestedModelId ? { requestedModelId: input.requestedModelId } : {}),
    ...(input.actualProviderId ? { actualProviderId: input.actualProviderId } : {}),
    ...(input.actualModelId ? { actualModelId: input.actualModelId } : {}),
    startedAt: input.startedAt,
    updatedAt,
    durationMs: updatedAt - input.startedAt,
    creditCost: Math.max(0, input.creditCost || 0),
    creditStatus: input.creditStatus || 'not-applicable',
    ...(input.comparison ? { comparison: input.comparison } : {}),
  };
}

export function compareTaskEntryFacts(
  legacy: TaskEntryFacts,
  core: TaskEntryFacts,
): TaskEntryComparison {
  const keys: Array<keyof TaskEntryFacts> = [
    'providerId',
    'modelId',
    'creditCost',
    'status',
  ];
  const mismatches = keys.filter(key => legacy[key] !== core[key]);
  return { matches: mismatches.length === 0, mismatches };
}

export async function executeTaskEntryMigration<T>(
  input: TaskEntryMigrationInput<T>,
): Promise<TaskEntryMigrationResult<T>> {
  if (input.mode === 'core-v2') {
    return { value: await input.coreV2(), mode: input.mode };
  }

  const value = await input.legacy();
  if (input.mode !== 'shadow' || !input.previewCoreFacts) {
    return { value, mode: input.mode };
  }

  const previewFacts = await input.previewCoreFacts();
  return {
    value,
    mode: input.mode,
    comparison: compareTaskEntryFacts(input.factsFromResult(value), previewFacts),
  };
}

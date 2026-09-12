export interface NestedWorkflowExecutionContext {
  userId?: string;
  projectId?: string;
  workflowId?: string;
  userRole?: 'user' | 'admin';
  userProductType?: string;
  activeLayerTasks?: Record<string, string>;
  activeSkillRuns?: Record<string, string>;
  pendingSkillSubmissions?: Record<string, Promise<void>>;
  cancellationState?: { cancelled: boolean };
  persistActiveSkillRuns?: () => Promise<void>;
  recoveryLeaseOwner?: string;
  recoveryLeaseTaskId?: string;
  recoveryLeaseLost?: boolean;
  recoveryLeaseState?: { lost: boolean };
}

export function inheritNestedWorkflowExecutionContext<T extends NestedWorkflowExecutionContext>(
  parent: T,
): Required<Pick<T, 'activeLayerTasks' | 'activeSkillRuns'>> & NestedWorkflowExecutionContext {
  const activeLayerTasks = parent.activeLayerTasks ?? {};
  const activeSkillRuns = parent.activeSkillRuns ?? {};
  const pendingSkillSubmissions = parent.pendingSkillSubmissions ?? {};
  const cancellationState = parent.cancellationState ?? { cancelled: false };
  parent.activeLayerTasks = activeLayerTasks;
  parent.activeSkillRuns = activeSkillRuns;
  parent.pendingSkillSubmissions = pendingSkillSubmissions;
  parent.cancellationState = cancellationState;
  return {
    userId: parent.userId,
    projectId: parent.projectId,
    workflowId: parent.workflowId,
    userRole: parent.userRole,
    userProductType: parent.userProductType,
    activeLayerTasks,
    activeSkillRuns,
    pendingSkillSubmissions,
    cancellationState,
    persistActiveSkillRuns: parent.persistActiveSkillRuns,
    recoveryLeaseOwner: parent.recoveryLeaseOwner,
    recoveryLeaseTaskId: parent.recoveryLeaseTaskId,
    recoveryLeaseLost: parent.recoveryLeaseLost,
    recoveryLeaseState: parent.recoveryLeaseState,
  };
}

export function registerWorkflowSkillSubmission(
  context: { pendingSkillSubmissions?: Record<string, Promise<void>> },
  key: string,
): () => void {
  context.pendingSkillSubmissions ||= {};
  let resolveSubmission!: () => void;
  const pending = new Promise<void>(resolve => {
    resolveSubmission = resolve;
  });
  context.pendingSkillSubmissions[key] = pending;
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    if (context.pendingSkillSubmissions?.[key] === pending) {
      delete context.pendingSkillSubmissions[key];
    }
    resolveSubmission();
  };
}

export async function waitForWorkflowSkillSubmissions(
  context: { pendingSkillSubmissions?: Record<string, Promise<void>> },
): Promise<void> {
  await Promise.allSettled(Object.values(context.pendingSkillSubmissions || {}));
}

export function workflowSkillRunRegistryKey(executionId: string, nodeId: string): string {
  return `${executionId}:${nodeId}`;
}

export function collectPersistedWorkflowSkillRunIds(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const projection = value as Record<string, unknown>;
  const ids = new Set<string>();
  const activeRuns = projection.activeSkillRuns;
  if (activeRuns && typeof activeRuns === 'object' && !Array.isArray(activeRuns)) {
    for (const runId of Object.values(activeRuns as Record<string, unknown>)) {
      if (typeof runId === 'string' && runId) ids.add(runId);
    }
  }

  const results = projection.results;
  if (results && typeof results === 'object' && !Array.isArray(results)) {
    for (const result of Object.values(results as Record<string, unknown>)) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
      const record = result as Record<string, unknown>;
      if (record.status !== 'running') continue;
      const output = record.output;
      if (!output || typeof output !== 'object' || Array.isArray(output)) continue;
      const runId = (output as Record<string, unknown>).runId;
      if (typeof runId === 'string' && runId) ids.add(runId);
    }
  }
  return [...ids];
}

export async function registerWorkflowSkillRunOrCancel(
  context: {
    status: string;
    activeSkillRuns?: Record<string, string>;
    cancellationState?: { cancelled: boolean };
  },
  nodeId: string,
  runId: string,
  cancel: (runId: string) => Promise<unknown>,
): Promise<boolean> {
  context.activeSkillRuns ||= {};
  context.activeSkillRuns[nodeId] = runId;
  if (context.status !== 'cancelled' && !context.cancellationState?.cancelled) return true;
  await cancel(runId);
  delete context.activeSkillRuns[nodeId];
  return false;
}

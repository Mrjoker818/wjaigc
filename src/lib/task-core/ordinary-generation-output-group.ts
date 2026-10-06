export interface OrdinaryGenerationOutputGroup {
  version: 1;
  kind: 'ordinary-generation';
  taskId: string;
  requestedCount: number;
}

export function parseOrdinaryGenerationOutputGroup(value: unknown, taskId: string): OrdinaryGenerationOutputGroup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const group = value as Record<string, unknown>;
  if (Object.keys(group).sort().join(',') !== 'kind,requestedCount,taskId,version'
    || group.version !== 1 || group.kind !== 'ordinary-generation'
    || typeof group.taskId !== 'string' || !group.taskId.trim() || group.taskId !== taskId
    || typeof group.requestedCount !== 'number' || !Number.isInteger(group.requestedCount)
    || group.requestedCount < 1 || group.requestedCount > 10) return null;
  return { version: 1, kind: 'ordinary-generation', taskId, requestedCount: group.requestedCount };
}

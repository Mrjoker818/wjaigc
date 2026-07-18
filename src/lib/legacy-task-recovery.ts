export interface LegacyTaskPlaceholder {
  id: string;
  isProcessingPlaceholder?: boolean;
  prompt?: string;
  model?: string;
  processing?: { taskId?: string; status?: string };
}

export interface RecoverableLegacyTask {
  id: string;
  status: string;
  prompt?: string;
  model?: string;
  providerId?: string;
  progress?: number;
  label?: string;
}

function normalizedModel(model: string | undefined): string {
  const value = (model || '').trim();
  const suffix = value.includes('::') ? value.split('::').at(-1) : value;
  return (suffix || '').trim().toLowerCase();
}

function isActive(status: string): boolean {
  return ['queued', 'pending', 'processing'].includes(status);
}

/**
 * Pre-taskId canvas records are recoverable only when one active cloud task
 * matches exactly. Ambiguous records remain untouched instead of guessing.
 */
export function findUniqueLegacyTaskMatch(
  placeholder: LegacyTaskPlaceholder,
  tasks: readonly RecoverableLegacyTask[],
): RecoverableLegacyTask | undefined {
  if (!placeholder.isProcessingPlaceholder || placeholder.processing?.taskId) return undefined;

  const prompt = placeholder.prompt?.trim();
  const model = normalizedModel(placeholder.model);
  if (!prompt || !model) return undefined;

  const matches = tasks.filter((task) => (
    isActive(task.status)
    && task.prompt?.trim() === prompt
    && normalizedModel(task.model) === model
  ));

  return matches.length === 1 ? matches[0] : undefined;
}

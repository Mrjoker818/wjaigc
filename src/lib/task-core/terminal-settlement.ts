export interface AtomicTerminalTaskCandidate {
  type?: string;
  result?: unknown;
}

const ATOMIC_TERMINAL_TASK_TYPES = new Set([
  'video',
  'video-extend',
  'edit',
  'annotation-edit',
  'refine-engine',
  'brand-ecommerce',
  'font-design',
]);

export function hasDurableGenerationSlotIdentity(
  task: AtomicTerminalTaskCandidate | null | undefined,
): boolean {
  const result = task?.result;
  if (!result || typeof result !== 'object') return false;
  const submissionPayload = (result as Record<string, unknown>).submissionPayload;
  if (!submissionPayload || typeof submissionPayload !== 'object') return false;

  const payload = submissionPayload as Record<string, unknown>;
  return typeof payload.batchId === 'string'
    && typeof payload.slotId === 'string'
    && typeof payload.slotIndex === 'number';
}

export function requiresAtomicTerminalSettlement(
  task: AtomicTerminalTaskCandidate | null | undefined,
): boolean {
  return Boolean(
    (task?.type && ATOMIC_TERMINAL_TASK_TYPES.has(task.type))
    || hasDurableGenerationSlotIdentity(task),
  );
}

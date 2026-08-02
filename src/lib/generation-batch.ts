export type GenerationSlotStatus =
  | 'created'
  | 'submitting'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface GenerationSlot {
  slotId: string;
  index: number;
  status: GenerationSlotStatus;
  childTaskId?: string;
  providerTaskId?: string;
}

export interface GenerationBatch {
  batchId: string;
  slots: GenerationSlot[];
}

const terminalStatuses = new Set<GenerationSlotStatus>([
  'completed',
  'failed',
  'cancelled',
  'timeout',
]);

export function buildGenerationBatch(batchId: string, count: number): GenerationBatch {
  const safeCount = Math.min(Math.max(Math.trunc(count), 1), 4);

  return {
    batchId,
    slots: Array.from({ length: safeCount }, (_, index) => ({
      slotId: `${batchId}:${index}`,
      index,
      status: 'created',
    })),
  };
}

export function isTerminalGenerationStatus(status: string | undefined): boolean {
  return terminalStatuses.has(status as GenerationSlotStatus);
}

export function canTransitionGenerationStatus(
  from: GenerationSlotStatus,
  to: GenerationSlotStatus,
): boolean {
  if (isTerminalGenerationStatus(from)) return false;

  if (from === 'created') {
    return to === 'submitting' || to === 'failed' || to === 'cancelled';
  }

  if (from === 'submitting') {
    return to !== 'created';
  }

  return to !== 'created' && to !== 'submitting';
}

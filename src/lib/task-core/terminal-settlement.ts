export interface AtomicTerminalTaskCandidate {
  type?: string;
  requestDigest?: string;
  result?: unknown;
}

const ATOMIC_TERMINAL_TASK_TYPES = new Set([
  'video',
  'video-extend',
  'edit',
  'universal-generate',
  'annotation-edit',
  'refine-engine',
  'brand-ecommerce',
  'font-design',
  'sketch-to-code',
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
    || hasOrdinaryGenerationIdentity(task)
    || hasOrdinaryInpaintIdentity(task)
    || hasRequested302ImageEditIdentity(task)
    || hasDurableGenerationSlotIdentity(task),
  );
}

function hasOrdinaryInpaintIdentity(task: AtomicTerminalTaskCandidate | null | undefined): boolean {
  if (task?.type !== 'image-edit' || !task.result || typeof task.result !== 'object' || Array.isArray(task.result)) return false;
  const admission = (task.result as Record<string, unknown>).imageEditAdmission;
  if (!admission || typeof admission !== 'object' || Array.isArray(admission)) return false;
  const value = admission as Record<string, unknown>;
  return value.version === 1 && value.route === '/api/image-edit' && value.kind === 'ordinary-inpaint'
    && (value.editMode === 'erase' || value.editMode === 'mask')
    && typeof value.requestDigest === 'string' && /^[a-f0-9]{64}$/.test(value.requestDigest)
    && task.requestDigest === value.requestDigest;
}

export function hasRequested302ImageEditIdentity(task: AtomicTerminalTaskCandidate | null | undefined): boolean {
  if (task?.type !== 'upscale' || !task.result || typeof task.result !== 'object' || Array.isArray(task.result)) return false;
  const admission = (task.result as Record<string, unknown>).imageEditAdmission;
  if (!admission || typeof admission !== 'object' || Array.isArray(admission)) return false;
  const value = admission as Record<string, unknown>;
  return value.version === 1 && value.route === '/api/image-edit' && value.kind === 'requested-302-upscale'
    && typeof value.requestDigest === 'string' && /^[a-f0-9]{64}$/.test(value.requestDigest)
    && task.requestDigest === value.requestDigest;
}

function hasOrdinaryGenerationIdentity(task: AtomicTerminalTaskCandidate | null | undefined): boolean {
  if (task?.type !== 'generate' || !task.result || typeof task.result !== 'object' || Array.isArray(task.result)) return false;
  const descriptor = (task.result as Record<string, unknown>).ordinaryGeneration;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return false;
  const value = descriptor as Record<string, unknown>;
  return value.version === 1 && value.route === '/api/generate'
    && typeof value.requestDigest === 'string' && /^[a-f0-9]{64}$/.test(value.requestDigest)
    && task.requestDigest === value.requestDigest;
}

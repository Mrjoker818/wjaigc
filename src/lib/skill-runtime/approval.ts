const CHECKSUM = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const SKILL_APPROVAL_STATE_SCHEMA_ID = 'skill-approval-state-v1' as const;

export interface SkillApprovalStateV1 {
  schemaId: typeof SKILL_APPROVAL_STATE_SCHEMA_ID;
  status: 'pending';
  stepId: string;
  nextStepId: string;
  outputSchemaId: string;
  planChecksum: string;
  revision: number;
  generation: number;
  allowRevision: boolean;
}

export interface SkillApprovalIdentity {
  revision: number;
  generation: number;
  planChecksum: string;
}

export class SkillApprovalConflictError extends Error {
  readonly code = 'SKILL_APPROVAL_CONFLICT';
  readonly status = 409;

  constructor() {
    super('Skill approval state no longer matches the requested plan');
    this.name = 'SkillApprovalConflictError';
  }
}

function invalidState(): never {
  throw new Error('SKILL_APPROVAL_STATE_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalidState();
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidState();
  return Number(value);
}

export function parseSkillApprovalState(value: unknown): SkillApprovalStateV1 {
  if (!isRecord(value) || Object.keys(value).some(key => ![
    'schemaId', 'status', 'stepId', 'nextStepId', 'outputSchemaId', 'planChecksum',
    'revision', 'generation', 'allowRevision',
  ].includes(key))) invalidState();
  if (value.schemaId !== SKILL_APPROVAL_STATE_SCHEMA_ID || value.status !== 'pending'
    || typeof value.planChecksum !== 'string' || !CHECKSUM.test(value.planChecksum)
    || typeof value.allowRevision !== 'boolean') invalidState();
  const generation = nonNegativeInteger(value.generation);
  return {
    schemaId: SKILL_APPROVAL_STATE_SCHEMA_ID,
    status: 'pending',
    stepId: identifier(value.stepId),
    nextStepId: identifier(value.nextStepId),
    outputSchemaId: identifier(value.outputSchemaId),
    planChecksum: value.planChecksum,
    revision: nonNegativeInteger(value.revision),
    generation,
    allowRevision: value.allowRevision,
  };
}

export function createSkillApprovalState(
  input: Omit<SkillApprovalStateV1, 'schemaId' | 'status'>,
): SkillApprovalStateV1 {
  return parseSkillApprovalState({
    schemaId: SKILL_APPROVAL_STATE_SCHEMA_ID,
    status: 'pending',
    ...input,
  });
}

export function assertSkillApprovalIdentity(
  state: SkillApprovalStateV1,
  identity: SkillApprovalIdentity,
): void {
  if (state.revision !== identity.revision || state.generation !== identity.generation
    || state.planChecksum !== identity.planChecksum) {
    throw new SkillApprovalConflictError();
  }
}

export function parseSkillApprovalIdentity(value: Record<string, unknown>): SkillApprovalIdentity {
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || !Number.isSafeInteger(value.generation) || Number(value.generation) < 0
    || typeof value.planChecksum !== 'string' || !CHECKSUM.test(value.planChecksum)) {
    throw new TypeError('SKILL_APPROVAL_REQUEST_INVALID');
  }
  return {
    revision: Number(value.revision),
    generation: Number(value.generation),
    planChecksum: value.planChecksum,
  };
}

export function parseSkillRevisionInstruction(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('SKILL_APPROVAL_REQUEST_INVALID');
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError('SKILL_APPROVAL_REQUEST_INVALID');
  }
  return normalized;
}

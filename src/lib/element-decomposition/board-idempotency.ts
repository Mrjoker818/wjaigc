import { createHash, randomUUID } from 'node:crypto';

import {
  createCloudTask,
  getCloudTaskForUserByIdempotencyKey,
} from '@/lib/cloud-task-storage';

export class ElementBoardIdempotencyConflictError extends Error {
  readonly code = 'ELEMENT_BOARD_IDEMPOTENCY_CONFLICT';
  readonly status = 409;

  constructor() {
    super('The idempotency key is already bound to another element board request');
    this.name = 'ElementBoardIdempotencyConflictError';
  }
}

export interface ClaimElementBoardTaskInput {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  providerId?: string;
  modelId?: string;
  request: Record<string, unknown>;
}

export interface ElementBoardTaskClaim {
  owner: boolean;
  taskId: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function createElementBoardRequestHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export async function claimElementBoardTask(
  input: ClaimElementBoardTaskInput,
): Promise<ElementBoardTaskClaim> {
  const now = Date.now();
  const taskId = `board_${randomUUID()}`;
  const inserted = await createCloudTask({
    id: taskId,
    userId: input.userId,
    type: 'element-board',
    status: 'pending',
    providerId: input.providerId,
    model: input.modelId,
    progress: 0,
    result: {
      requestHash: input.requestHash,
      request: input.request,
    },
    creditStatus: 'not-applicable',
    creditCost: 0,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  });
  if (inserted) return { owner: true, taskId };

  const existing = await getCloudTaskForUserByIdempotencyKey(
    input.userId,
    input.idempotencyKey,
  );
  if (!existing || existing.result?.requestHash !== input.requestHash) {
    throw new ElementBoardIdempotencyConflictError();
  }
  return { owner: false, taskId: existing.id };
}

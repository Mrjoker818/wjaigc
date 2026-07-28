import { createHash, randomUUID } from 'node:crypto';
import {
  createCloudTask,
  getCloudTaskForUserByIdempotencyKey,
} from '@/lib/cloud-task-storage';

export class VectorDesignIdempotencyConflictError extends Error {
  readonly code = 'VECTOR_DESIGN_IDEMPOTENCY_CONFLICT';

  constructor() {
    super('幂等键已绑定到不同的矢量设计请求');
    this.name = 'VectorDesignIdempotencyConflictError';
  }
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

export function createVectorDesignRequestHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export async function claimVectorDesignTask(input: {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  providerId: string;
  model: string;
}): Promise<{ owner: boolean; taskId: string }> {
  const now = Date.now();
  const taskId = `vector_${randomUUID()}`;
  const inserted = await createCloudTask({
    id: taskId,
    userId: input.userId,
    type: 'vector-design',
    status: 'pending',
    providerId: input.providerId,
    model: input.model,
    progress: 0,
    result: { requestHash: input.requestHash },
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
    throw new VectorDesignIdempotencyConflictError();
  }
  return { owner: false, taskId: existing.id };
}

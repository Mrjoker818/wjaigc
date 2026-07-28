import { createHash, randomUUID } from 'node:crypto';

import {
  createCloudTask,
  getCloudTaskForUserByIdempotencyKey,
} from '@/lib/cloud-task-storage';
import type { LayerDecompositionRequest } from '@/lib/layer-decomposition/types';

export class LayerIdempotencyConflictError extends Error {
  readonly code = 'LAYER_IDEMPOTENCY_CONFLICT';

  constructor() {
    super('The idempotency key is already bound to another layer request');
    this.name = 'LayerIdempotencyConflictError';
  }
}

export interface ClaimLayerTaskInput {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  providerId?: string;
  modelId?: string;
  request: LayerDecompositionRequest;
}

export interface LayerTaskClaim {
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

export function createLayerRequestHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export async function claimLayerTask(
  input: ClaimLayerTaskInput,
): Promise<LayerTaskClaim> {
  const now = Date.now();
  const taskId = `layer_${randomUUID()}`;
  const inserted = await createCloudTask({
    id: taskId,
    userId: input.userId,
    type: 'layer-decomposition',
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
    throw new LayerIdempotencyConflictError();
  }
  return { owner: false, taskId: existing.id };
}

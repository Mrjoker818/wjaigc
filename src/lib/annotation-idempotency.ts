import { createHash, randomUUID } from 'node:crypto';

import {
  createCloudTask,
  getCloudTaskForUserByIdempotencyKey,
} from '@/lib/cloud-task-storage';

export class AnnotationIdempotencyConflictError extends Error {
  readonly code = 'ANNOTATION_IDEMPOTENCY_CONFLICT';

  constructor() {
    super('The idempotency key is already bound to a different annotation request');
    this.name = 'AnnotationIdempotencyConflictError';
  }
}

interface ClaimAnnotationEditTaskInput {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  providerId: string;
  model: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  submissionPayload?: Record<string, unknown>;
}

export interface AnnotationEditTaskClaim {
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

export function createAnnotationRequestHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export async function claimAnnotationEditTask({
  userId,
  idempotencyKey,
  requestHash,
  providerId,
  model,
  projectId,
  sessionId,
  messageId,
  submissionPayload,
}: ClaimAnnotationEditTaskInput): Promise<AnnotationEditTaskClaim> {
  const now = Date.now();
  const taskId = `edit_${randomUUID()}`;
  const inserted = await createCloudTask({
    id: taskId,
    userId,
    projectId,
    sessionId,
    messageId,
    type: 'annotation-edit',
    status: 'pending',
    providerId,
    model,
    progress: 0,
    result: {
      requestHash,
      ...(submissionPayload ? { submissionPayload } : {}),
    },
    creditStatus: 'not-applicable',
    creditCost: 0,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
  });
  if (inserted) return { owner: true, taskId };

  const existing = await getCloudTaskForUserByIdempotencyKey(userId, idempotencyKey);
  if (!existing || existing.result?.requestHash !== requestHash) {
    throw new AnnotationIdempotencyConflictError();
  }
  return { owner: false, taskId: existing.id };
}

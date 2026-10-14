import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import type { PersistedCloudTask, CloudTaskLease } from '@/lib/cloud-task-storage';
import type { SketchImageInput } from './image-contract';
import { parseStoredSketchImageInput } from './image-contract';
import type { SketchImagePreparation } from './image-generation';
import type { SketchImagePricing } from './image-pricing';
import { parseSketchImagePricing } from './image-pricing';
import { sketchFields, sketchHttpId } from './http';
import { sketchImageRequestDigest } from './image-admission';
export interface SketchImageTaskIdentity {
  readonly taskId: string; readonly actorUserId: string; readonly projectId: string; readonly requestDigest: string;
  readonly input: Readonly<SketchImageInput>; readonly access: SketchImagePreparation['access']; readonly pricing: Readonly<SketchImagePricing>;
}
export interface SketchImageTaskRow {
  id: string; user_id: string; project_id: string; type: string; status: string; provider_id: string; model: string;
  request_digest: string; idempotency_key: string; result: Record<string, unknown>; credit_cost: unknown; credit_status: string;
  charged_transaction_id: string | null; refunded_transaction_id: string | null;
  lease_owner: string; attempt_count: number; lease_expires_at: string | number;
}
function access(value: unknown, actorUserId: string, projectId: string): SketchImagePreparation['access'] {
  const raw = sketchFields(value, ['kind', 'actorUserId', 'projectId', 'ownerId', 'grantGeneration']);
  const ownerId = sketchHttpId(raw.ownerId);
  if (raw.actorUserId !== actorUserId || raw.projectId !== projectId) throw new Error();
  if (raw.kind === 'personal' && ownerId === actorUserId && Object.keys(raw).length === 4) {
    return Object.freeze({ kind: 'personal', actorUserId, projectId, ownerId });
  }
  if (raw.kind === 'document' && Object.keys(raw).length === 5 && typeof raw.grantGeneration === 'string'
    && /^(0|[1-9]\d*)$/.test(raw.grantGeneration)) {
    return Object.freeze({ kind: 'document', actorUserId, projectId, ownerId, grantGeneration: sketchHttpId(raw.grantGeneration) });
  }
  throw new Error();
}
/** Strict private data identity; it grants neither current access nor a new provider attempt. */
export function readSketchImageTaskIdentity(task: PersistedCloudTask, expectedActorUserId?: string): Readonly<SketchImageTaskIdentity> {
  try {
    const t = sketchFields(task), actorUserId = sketchHttpId(t.userId), projectId = sketchHttpId(t.projectId), taskId = sketchHttpId(t.id);
    const meta = sketchFields(sketchFields(t.result).sketchImageAdmission, ['version', 'route', 'requestDigest', 'access', 'input', 'pricing']);
    const input = parseStoredSketchImageInput(meta.input), pricing = parseSketchImagePricing(meta.pricing), a = access(meta.access, actorUserId, projectId);
    const requestDigest = sketchImageRequestDigest(input);
    if (expectedActorUserId !== undefined && expectedActorUserId !== actorUserId || t.type !== 'sketch-to-image'
      || meta.version !== 1 || meta.route !== '/api/sketch-to-image' || Object.keys(meta).length !== 6
      || meta.requestDigest !== requestDigest || t.requestDigest !== requestDigest || t.projectId !== input.projectId
      || t.idempotencyKey !== input.idempotencyKey || t.providerId !== input.imageProviderId || t.model !== input.imageModelId
      || t.creditCost !== pricing.totalReserveCredits || pricing.vision.providerId !== input.visionProviderId || pricing.vision.modelId !== input.visionModelId
      || pricing.image.providerId !== input.imageProviderId || pricing.image.modelId !== input.imageModelId
      || typeof t.status !== 'string' || !['pending', 'processing', 'completed', 'failed', 'cancelled', 'timeout'].includes(t.status)
      || typeof t.creditStatus !== 'string' || !['pending', 'charged', 'refunded', 'not-applicable'].includes(t.creditStatus)) throw new Error();
    return Object.freeze({ taskId, actorUserId, projectId, requestDigest, input, access: a, pricing });
  } catch { throw new Error('SKETCH_IMAGE_TASK_UNAVAILABLE'); }
}
function dbInteger(value: unknown): number {
  const n = typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new Error();
  return n;
}
/** Adapt only canonical PostgreSQL NUMERIC text at the SQL boundary. The
 * original private input/quote/role/digest checks still validate the entire row;
 * this supplies no permission, lease or financial authority. */
export function readSketchImageTaskRowIdentity(row: SketchImageTaskRow, expectedActorUserId?: string): Readonly<SketchImageTaskIdentity> {
  try {
    const r = sketchFields(row);
    return readSketchImageTaskIdentity({ id: r.id, userId: r.user_id, projectId: r.project_id, type: r.type, status: r.status,
      providerId: r.provider_id, model: r.model, requestDigest: r.request_digest, idempotencyKey: r.idempotency_key,
      result: r.result, creditStatus: r.credit_status, creditCost: dbInteger(r.credit_cost) } as PersistedCloudTask, expectedActorUserId);
  } catch { throw new Error('SKETCH_IMAGE_TASK_UNAVAILABLE'); }
}
/** The caller owns the original task lock, current permission and ledger locks.
 * Supply clock_timestamp AFTER those locks; wall-clock time is never database authority. */
export function assertSketchImageTaskRow(row: SketchImageTaskRow | undefined, identity: Readonly<SketchImageTaskIdentity>,
  lease: Readonly<CloudTaskLease>, now: unknown, deadline: number, status = 'processing'): void {
  try {
    if (!row || !['processing', 'completed'].includes(status)) throw new Error();
    const r = sketchFields(row);
    const current = readSketchImageTaskRowIdentity(row, identity.actorUserId);
    const clock = dbInteger(now), expiry = dbInteger(r.lease_expires_at);
    if (!isDeepStrictEqual(current, identity) || r.status !== status || r.refunded_transaction_id || lease.taskId !== identity.taskId
      || r.lease_owner !== lease.owner || r.attempt_count !== lease.attemptCount || expiry !== lease.expiresAt
      || !Number.isSafeInteger(lease.attemptCount) || lease.attemptCount < 1 || !lease.owner || !Number.isSafeInteger(lease.expiresAt)
      || !Number.isSafeInteger(deadline) || deadline <= clock || lease.expiresAt <= clock
      || r.credit_status !== (identity.pricing.totalReserveCredits === 0 ? 'not-applicable' : status === 'completed' ? 'charged' : 'pending')) throw new Error();
  } catch { throw new Error('SKETCH_IMAGE_LEASE_LOST'); }
}

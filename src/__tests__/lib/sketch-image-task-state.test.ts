import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import type { PersistedCloudTask, CloudTaskLease } from '@/lib/cloud-task-storage';
import { readSketchImageTaskIdentity, assertSketchImageTaskRow, type SketchImageTaskRow } from '@/lib/sketch-to-code/image-task-state';
import { sketchImageRequestDigest } from '@/lib/sketch-to-code/image-admission';
vi.mock('server-only', () => ({}));
const input = { projectId: 'project-a', imageDataUrl: createCanvas(8, 8).toDataURL('image/png'), instruction: '海边木屋', visionProviderId: 'vision-p',
  visionModelId: 'vision-model', imageProviderId: 'image-p', imageModelId: 'image-model', idempotencyKey: 'nonce-a', aspectRatio: '4:3' };
const access = { kind: 'personal' as const, actorUserId: 'user-a', projectId: 'project-a', ownerId: 'user-a' };
const pricing = { version: 1 as const, vision: { providerId: 'vision-p', modelId: 'vision-model', calls: 1 as const, mode: 'flat' as const, reserveCredits: 7 },
  image: { providerId: 'image-p', modelId: 'image-model', calls: 1 as const, credits: 11 }, totalReserveCredits: 18 };
function task(): PersistedCloudTask { return { id: 'skimg_one', type: 'sketch-to-image', userId: 'user-a', projectId: 'project-a', providerId: 'image-p', model: 'image-model',
  status: 'processing', progress: 10, creditCost: 18, creditStatus: 'pending', idempotencyKey: 'nonce-a', requestDigest: sketchImageRequestDigest(input), revision: 1,
  createdAt: 1, updatedAt: 1, leaseOwner: 'lease-one', attemptCount: 1, leaseExpiresAt: 3000,
  result: { sketchImageAdmission: structuredClone({ version: 1, route: '/api/sketch-to-image', requestDigest: sketchImageRequestDigest(input), input, access, pricing }) } }; }
const lease: CloudTaskLease = { taskId: 'skimg_one', owner: 'lease-one', attemptCount: 1, expiresAt: 3000 };
function row(value = task()): SketchImageTaskRow { return { id: value.id, user_id: value.userId, project_id: value.projectId!, type: value.type, status: value.status,
  provider_id: value.providerId!, model: value.model!, request_digest: value.requestDigest!, idempotency_key: value.idempotencyKey!, result: value.result!,
  credit_cost: String(value.creditCost), credit_status: value.creditStatus, charged_transaction_id: 'charge-one', refunded_transaction_id: null,
  lease_owner: value.leaseOwner!, attempt_count: value.attemptCount!, lease_expires_at: String(value.leaseExpiresAt) }; }
describe('private sketch image identity and original database row fence (no DB permission)', () => {
  it('restores the exact frozen original private input, two prices and access without credentials or compute', () => {
    const source = task(), id = readSketchImageTaskIdentity(source, 'user-a');
    expect(id).toEqual({ taskId: 'skimg_one', actorUserId: 'user-a', projectId: 'project-a', requestDigest: source.requestDigest, input, access, pricing });
    expect([id, id.input, id.access, id.pricing, id.pricing.vision, id.pricing.image].every(Object.isFrozen)).toBe(true);
    (source.result!.sketchImageAdmission as { input: typeof input }).input.instruction = 'changed'; expect(id.input.instruction).toBe(input.instruction);
    expect(JSON.stringify(id)).not.toContain('apiKey');
  });
  it.each(['actor', 'type', 'project', 'image-provider', 'image-model', 'digest', 'nonce', 'cost', 'vision-price', 'access', 'input-key', 'route'] as const)
    ('refuses wrong original %s identity', kind => {
      const t = task(), meta = t.result!.sketchImageAdmission as { input: Record<string, unknown>; pricing: typeof pricing; access: typeof access; route: string };
      if (kind === 'actor') t.userId = 'other'; if (kind === 'type') t.type = 'sketch-to-code'; if (kind === 'project') t.projectId = 'other';
      if (kind === 'image-provider') t.providerId = 'other'; if (kind === 'image-model') t.model = 'other'; if (kind === 'digest') t.requestDigest = 'f'.repeat(64);
      if (kind === 'nonce') t.idempotencyKey = 'other'; if (kind === 'cost') t.creditCost = 99; if (kind === 'vision-price') meta.pricing.vision.providerId = 'other';
      if (kind === 'access') meta.access.ownerId = 'other'; if (kind === 'input-key') meta.input.apiKey = 'secret'; if (kind === 'route') meta.route = '/api/sketch-to-code';
      expect(() => readSketchImageTaskIdentity(t, 'user-a')).toThrow('SKETCH_IMAGE_TASK_UNAVAILABLE');
    });
  it.each(['input', 'access', 'task'] as const)('does not invoke %s accessors', key => {
    const t = task(); let reads = 0;
    const target = key === 'task' ? t : (t.result!.sketchImageAdmission as Record<string, object>)[key];
    Object.defineProperty(target, key === 'task' ? 'requestDigest' : key === 'input' ? 'instruction' : 'ownerId', { enumerable: true, get: () => { reads++; return 'secret'; } });
    expect(() => readSketchImageTaskIdentity(t, 'user-a')).toThrow('SKETCH_IMAGE_TASK_UNAVAILABLE'); expect(reads).toBe(0);
  });
  it('document access preserves exact grant generation, never downgrades to personal', () => {
    const t = task(), meta = t.result!.sketchImageAdmission as Record<string, unknown>;
    meta.access = { kind: 'document', actorUserId: 'user-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '12' };
    expect(readSketchImageTaskIdentity(t, 'user-a').access).toEqual(meta.access);
    (meta.access as { grantGeneration: string }).grantGeneration = '12oops'; expect(() => readSketchImageTaskIdentity(t)).toThrow('SKETCH_IMAGE_TASK_UNAVAILABLE');
  });
  it('accepts original row only at a live exact DB timestamp after locks', () => {
    const identity = readSketchImageTaskIdentity(task()); expect(() => assertSketchImageTaskRow(row(), identity, lease, '1999', 2000)).not.toThrow();
    const completed = row(); completed.status = 'completed'; completed.credit_status = 'charged';
    expect(() => assertSketchImageTaskRow(completed, identity, lease, '1999', 2000, 'completed')).not.toThrow();
  });
  it.each(['id', 'actor', 'digest', 'nonce', 'type', 'binding', 'owner', 'attempt', 'expiry', 'terminal', 'refund', 'cost', 'quote'] as const)
    ('rejects a mutated locked row %s without authority', kind => {
      const r = row(), identity = readSketchImageTaskIdentity(task());
      if (kind === 'id') r.id = 'other'; if (kind === 'actor') r.user_id = 'other'; if (kind === 'digest') r.request_digest = 'f'.repeat(64);
      if (kind === 'nonce') r.idempotency_key = 'other'; if (kind === 'type') r.type = 'sketch-to-code'; if (kind === 'binding') r.provider_id = 'other';
      if (kind === 'owner') r.lease_owner = 'other'; if (kind === 'attempt') r.attempt_count = 2; if (kind === 'expiry') r.lease_expires_at = '3001';
      if (kind === 'terminal') r.status = 'cancelled'; if (kind === 'refund') r.refunded_transaction_id = 'refund-one'; if (kind === 'cost') r.credit_cost = 19;
      if (kind === 'quote') (r.result.sketchImageAdmission as { pricing: typeof pricing }).pricing.vision.reserveCredits = 6;
      expect(() => assertSketchImageTaskRow(r, identity, lease, '1999', 2000)).toThrow('SKETCH_IMAGE_LEASE_LOST');
    });
  it.each([2000, '2000', 3000, undefined, NaN, '1.5', '-1', '1e3', 'Infinity'])('refuses expired or noninteger database timestamp %s', now => {
    expect(() => assertSketchImageTaskRow(row(), readSketchImageTaskIdentity(task()), lease, now, 2000)).toThrow('SKETCH_IMAGE_LEASE_LOST');
  });
  it('nonce and key order do not change the same semantic digest; mode and all model roles remain distinct', () => {
    expect(sketchImageRequestDigest({ ...input, idempotencyKey: 'next' })).toBe(sketchImageRequestDigest(input));
    expect(sketchImageRequestDigest(Object.fromEntries(Object.entries(input).reverse()) as typeof input)).toBe(sketchImageRequestDigest(input));
    expect(sketchImageRequestDigest(input)).not.toBe(createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', ...input })).digest('hex'));
  });
});

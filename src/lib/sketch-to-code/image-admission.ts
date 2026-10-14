import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SketchImageGenerationDependencies, SketchImagePreparation } from './image-generation';
import { prepareSketchImage } from './image-generation';
import type { SketchImageInput } from './image-contract';
import type { SketchGenerationContext } from './generation';
import { createBillableTask, type CreateBillableTaskInput, type CreateBillableTaskResult } from '@/lib/task-core/billing-service';
import { getCloudTaskForUserByIdempotencyKey, type CloudTask } from '@/lib/cloud-task-storage';
import { CREDIT_PRICING_CONFIG_KEY, type CreditPricingConfig } from '@/lib/credit-pricing';
import { readSystemSettingStrict } from '@/lib/auth/auth-repository';
import { InsufficientCreditsError } from '@/lib/credits';
import { getPool } from '@/lib/db-client';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { normalizeDurableTaskStatus } from '@/lib/task-core/task-state';
import { SketchAdmissionError, assertSketchProjectFence } from './admission';
import { sketchFields } from './http';
import { copySketchPricingConfig } from './token-billing';
import { parseSketchImagePricing, quoteSketchImagePricing } from './image-pricing';
import type { PoolClient } from 'pg';

export interface SketchImageAdmissionDependencies {
  generation: SketchImageGenerationDependencies;
  loadPricingConfig?: () => Promise<CreditPricingConfig>;
  createBillableTask?: (input: CreateBillableTaskInput) => Promise<CreateBillableTaskResult>;
  assertProjectFence?: (client: PoolClient, access: SketchImagePreparation['access']) => Promise<void>;
  revalidateAccess?: (access: SketchImagePreparation['access']) => Promise<void>;
  readExistingTask?: (actorUserId: string, nonce: string) => Promise<CloudTask | null>;
}
export interface SketchImageTaskAdmission extends CreateBillableTaskResult { prepared?: SketchImagePreparation }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Frozen, validated preparation only. Nonce is separate original idempotency authority. */
export function sketchImageRequestDigest(input: Readonly<SketchImageInput>): string {
  return createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-image', projectId: input.projectId,
    imageDataUrl: input.imageDataUrl, instruction: input.instruction, visionProviderId: input.visionProviderId, visionModelId: input.visionModelId,
    imageProviderId: input.imageProviderId, imageModelId: input.imageModelId, aspectRatio: input.aspectRatio,
    ...(input.size !== undefined ? { size: input.size } : {}), ...(input.quality !== undefined ? { quality: input.quality } : {}) })).digest('hex');
}
async function loadPricing(): Promise<CreditPricingConfig> {
  const row = await readSystemSettingStrict(CREDIT_PRICING_CONFIG_KEY);
  return row.found ? copySketchPricingConfig(row.value) : { modelCredits: {} };
}
async function revalidate(access: SketchImagePreparation['access']): Promise<void> {
  let client: PoolClient | undefined, committing = false, discard = false;
  try {
    client = await getPool().connect(); await client.query('BEGIN');
    await assertSketchProjectFence(client, access); committing = true; await client.query('COMMIT');
  } catch (error) {
    if (committing) discard = true;
    else if (client) try { await client.query('ROLLBACK'); } catch { discard = true; }
    if (error instanceof SketchAdmissionError) throw error;
    throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503);
  } finally { client?.release(discard); }
}
function validateTask(task: CreateBillableTaskResult['task'] | CloudTask, prepared: SketchImagePreparation, digest: string): void {
  const storedDigest = sketchFields(task).requestDigest;
  if (storedDigest !== digest) throw new IdempotencyConflictError({ userId: prepared.access.actorUserId,
    idempotencyKey: prepared.input.idempotencyKey, requestDigest: digest, existingDigest: typeof storedDigest === 'string' ? storedDigest : 'legacy-unknown' });
  try {
    const meta = sketchFields(sketchFields(task.result).sketchImageAdmission, ['version', 'route', 'requestDigest', 'access', 'input', 'pricing']);
    const pricing = parseSketchImagePricing(meta.pricing);
    const storedInput = { ...sketchFields(meta.input, ['projectId', 'imageDataUrl', 'instruction', 'visionProviderId', 'visionModelId',
      'imageProviderId', 'imageModelId', 'idempotencyKey', 'aspectRatio', 'size', 'quality']) };
    const storedAccess = { ...sketchFields(meta.access, ['kind', 'actorUserId', 'projectId', 'ownerId', 'grantGeneration']) };
    if (Object.keys(meta).length !== 6 || meta.version !== 1 || meta.route !== '/api/sketch-to-image' || meta.requestDigest !== digest
      || task.type !== 'sketch-to-image' || task.userId !== prepared.access.actorUserId || task.projectId !== prepared.input.projectId
      || task.providerId !== prepared.imageBinding.providerId || task.model !== prepared.imageBinding.modelId
      || task.idempotencyKey !== prepared.input.idempotencyKey || !isDeepStrictEqual(storedAccess, prepared.access)
      || !isDeepStrictEqual(storedInput, prepared.input) || task.creditCost !== pricing.totalReserveCredits
      || pricing.vision.providerId !== prepared.visionBinding.providerId || pricing.vision.modelId !== prepared.visionBinding.modelId
      || pricing.image.providerId !== prepared.imageBinding.providerId || pricing.image.modelId !== prepared.imageBinding.modelId) throw new Error();
  } catch { throw new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403); }
}
/** No public route may admit until the guarded worker and publisher are connected. */
export async function admitSketchImageTask(value: unknown, context: SketchGenerationContext,
  dependencies: SketchImageAdmissionDependencies): Promise<SketchImageTaskAdmission> {
  const prepared = await prepareSketchImage(value, dependencies.generation, context);
  const { input, access } = prepared, requestDigest = sketchImageRequestDigest(input);
  let existing: CloudTask | null;
  try { existing = await (dependencies.readExistingTask || getCloudTaskForUserByIdempotencyKey)(access.actorUserId, input.idempotencyKey); }
  catch { throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503); }
  context.signal.throwIfAborted();
  if (existing) {
    validateTask(existing, prepared, requestDigest); await (dependencies.revalidateAccess || revalidate)(access); context.signal.throwIfAborted();
    return { task: { ...existing, status: normalizeDurableTaskStatus(existing.status), revision: existing.revision ?? 0 }, reused: true, charged: false };
  }
  let pricing: ReturnType<typeof parseSketchImagePricing>;
  try {
    pricing = await quoteSketchImagePricing({ visionProviderId: input.visionProviderId, visionModelId: input.visionModelId,
      imageProviderId: input.imageProviderId, imageModelId: input.imageModelId,
      ...(input.size !== undefined ? { size: input.size } : {}), ...(input.quality !== undefined ? { quality: input.quality } : {}) },
    await (dependencies.loadPricingConfig || loadPricing)());
  } catch (error) {
    if (context.signal.aborted && error === context.signal.reason) throw error;
    throw new SketchAdmissionError('SKETCH_IMAGE_PRICING_INVALID', 503);
  }
  context.signal.throwIfAborted();
  const metadata = freeze({ version: 1, route: '/api/sketch-to-image', requestDigest, input, access, pricing });
  const now = Date.now();
  let result: CreateBillableTaskResult;
  try {
    result = await (dependencies.createBillableTask || createBillableTask)({ userId: access.actorUserId, idempotencyKey: input.idempotencyKey,
      requestDigest, creditCost: pricing.totalReserveCredits, beforeCharge: async client => {
        context.signal.throwIfAborted(); await (dependencies.assertProjectFence || assertSketchProjectFence)(client, access); context.signal.throwIfAborted();
      }, task: { id: `skimg_${randomUUID()}`, type: 'sketch-to-image', projectId: input.projectId, providerId: input.imageProviderId,
        model: input.imageModelId, status: 'processing', progress: 0, label: '草图生图：等待执行', createdAt: now, updatedAt: now,
        result: Object.freeze({ sketchImageAdmission: metadata }) } });
  } catch (error) {
    if (context.signal.aborted && error === context.signal.reason) throw error;
    if (error instanceof SketchAdmissionError || error instanceof InsufficientCreditsError || error instanceof IdempotencyConflictError) throw error;
    // No automatic refund/re-admission on an unknown original transaction outcome.
    throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503);
  }
  validateTask(result.task, prepared, requestDigest);
  if (result.reused) {
    await (dependencies.revalidateAccess || revalidate)(access); context.signal.throwIfAborted();
    return { task: result.task, reused: true, charged: false };
  }
  return { ...result, prepared };
}

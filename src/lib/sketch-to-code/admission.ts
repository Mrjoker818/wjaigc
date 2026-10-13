import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { CREDIT_PRICING_CONFIG_KEY, resolveTokenPricingFromConfig, type CreditPricingConfig } from '@/lib/credit-pricing';
import { readSystemSettingStrict } from '@/lib/auth/auth-repository';
import { calculateConfiguredCreditCost, InsufficientCreditsError } from '@/lib/credits';
import { createBillableTask, type CreateBillableTaskInput, type CreateBillableTaskResult } from '@/lib/task-core/billing-service';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { CloudTaskAdmissionError, getCloudTaskForUserByIdempotencyKey, type CloudTask } from '@/lib/cloud-task-storage';
import { normalizeDurableTaskStatus } from '@/lib/task-core/task-state';
import { readGenerationProjectAccess, GenerationProjectAccessError } from '@/lib/collaboration/generation-project-access';
import { assertDocumentEditor, assertDocumentProjectEnabled, DocumentAccessError, DocumentFeatureDisabledError, DocumentProjectNotEnabledError } from '@/lib/collaboration/document-access';
import { lockAssetGraphWriteGate } from '@/lib/asset-core/storage';
import { PROJECT_REVISION_DATA_KEY } from '@/lib/asset-core/canvas-project-sync';
import { prepareSketchCode, type SketchCodePreparation, type SketchGenerationContext, type SketchGenerationDependencies } from './generation';
import { createConfiguredSketchDependencies } from './configured-dependencies';
import { copySketchPricingConfig, parseSketchAdmissionPricing, type SketchAdmissionPricing } from './token-billing';

export interface SketchAdmissionDependencies {
  generation?: SketchGenerationDependencies;
  loadPricingConfig?: () => Promise<CreditPricingConfig>;
  createBillableTask?: (input: CreateBillableTaskInput) => Promise<CreateBillableTaskResult>;
  assertProjectFence?: (client: PoolClient, access: SketchCodePreparation['access']) => Promise<void>;
  revalidateAccess?: (access: SketchCodePreparation['access']) => Promise<void>;
  readExistingTask?: (actorUserId: string, idempotencyKey: string) => Promise<CloudTask | null>;
}
export interface SketchTaskAdmission extends CreateBillableTaskResult { prepared?: SketchCodePreparation }
export class SketchAdmissionError extends CloudTaskAdmissionError {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'SketchAdmissionError'; }
}
function sameAccess(left: SketchCodePreparation['access'], right: SketchCodePreparation['access']): boolean {
  return left.kind === right.kind && left.actorUserId === right.actorUserId && left.projectId === right.projectId
    && left.ownerId === right.ownerId && (left.kind !== 'document'
      || (right.kind === 'document' && left.grantGeneration === right.grantGeneration));
}
/** Caller owns BEGIN/COMMIT. Retain the original graph/revision/row locks through the charge or publication. */
export async function assertSketchProjectFence(client: PoolClient, access: SketchCodePreparation['access']): Promise<void> {
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await lockAssetGraphWriteGate(client, 'shared');
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1), hashtext($2))', [access.ownerId, PROJECT_REVISION_DATA_KEY]);
    await client.query('SELECT id FROM wujie_users WHERE id = ANY($1::text[]) ORDER BY id FOR SHARE', [[access.actorUserId, access.ownerId]]);
    await client.query('SELECT id FROM wujie_projects WHERE id = $1 FOR SHARE', [access.projectId]);
    if (access.kind === 'document') {
      const current = await assertDocumentEditor(access.actorUserId, access.projectId, client, access.grantGeneration);
      if (current.ownerId !== access.ownerId) throw new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403);
      await assertDocumentProjectEnabled(client, access.ownerId, access.projectId);
      await client.query('SELECT project_id FROM wujie_project_canvas_documents WHERE project_id = $1 AND owner_id = $2 FOR SHARE', [access.projectId, access.ownerId]);
    } else {
      // Serialize a legacy snapshot edit too, including projects not yet materialized in the graph.
      await client.query("SELECT user_id FROM wujie_user_data WHERE user_id = $1 AND data_key = 'projects' FOR SHARE", [access.actorUserId]);
      await client.query('SELECT project_id FROM wujie_project_document_settings WHERE project_id = $1 FOR SHARE', [access.projectId]);
      await client.query('SELECT project_id FROM wujie_project_canvas_documents WHERE project_id = $1 FOR SHARE', [access.projectId]);
    }
    const current = await readGenerationProjectAccess(client, access.actorUserId, access.projectId);
    if (current.kind === 'unscoped' || !sameAccess(current, access)) throw new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403);
  } catch (error) {
    if (error instanceof SketchAdmissionError) throw error;
    if (error instanceof GenerationProjectAccessError || error instanceof DocumentAccessError
      || error instanceof DocumentFeatureDisabledError || error instanceof DocumentProjectNotEnabledError) {
      throw new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403);
    }
    throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503);
  }
}
async function revalidateAccess(access: SketchCodePreparation['access']): Promise<void> {
  const client = await getPool().connect().catch((): never => { throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503); });
  let discard = false;
  try {
    await client.query('BEGIN'); await assertSketchProjectFence(client, access); await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    if (error instanceof SketchAdmissionError) throw error;
    throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503);
  } finally { client.release(discard); }
}

async function loadStrictPricing(): Promise<CreditPricingConfig> {
  const setting = await readSystemSettingStrict(CREDIT_PRICING_CONFIG_KEY);
  return setting.found ? copySketchPricingConfig(setting.value) : { modelCredits: {} };
}
function validateReplay(task: CreateBillableTaskResult['task'] | CloudTask, prepared: SketchCodePreparation, requestDigest: string): void {
  const { access, binding, input } = prepared;
  const stored = task.result?.sketchAdmission as { version?: unknown; route?: unknown; requestDigest?: unknown; access?: SketchCodePreparation['access'] } | undefined;
  if ('requestDigest' in task && task.requestDigest !== requestDigest) throw new IdempotencyConflictError({
    userId: access.actorUserId, idempotencyKey: input.idempotencyKey, requestDigest, existingDigest: String(task.requestDigest || 'legacy-unknown'),
  });
  if (task.type !== 'sketch-to-code' || task.userId !== access.actorUserId || task.projectId !== input.projectId
    || task.providerId !== binding.providerId || task.model !== binding.modelId
    || !stored || stored.version !== 1 || stored.route !== '/api/sketch-to-code' || stored.requestDigest !== requestDigest
    || !stored.access || !sameAccess(stored.access, access)) throw new SketchAdmissionError('SKETCH_PROJECT_CHANGED', 403);
}

/** Internal admission only. No route can charge until the guarded worker/publication is connected. */
export async function admitSketchTask(value: unknown, context: SketchGenerationContext, dependencies: SketchAdmissionDependencies = {}): Promise<SketchTaskAdmission> {
  const prepared = await prepareSketchCode(value, dependencies.generation || createConfiguredSketchDependencies(), context);
  const { input, access, binding } = prepared;
  const requestDigest = createHash('sha256').update(JSON.stringify({ version: 1, type: 'sketch-to-code', projectId: input.projectId,
    imageDataUrl: input.imageDataUrl, instruction: input.instruction, providerId: binding.providerId, modelId: binding.modelId })).digest('hex');
  let existing: CloudTask | null;
  try { existing = await (dependencies.readExistingTask || getCloudTaskForUserByIdempotencyKey)(access.actorUserId, input.idempotencyKey); }
  catch { throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503); }
  context.signal.throwIfAborted();
  if (existing) {
    validateReplay(existing, prepared, requestDigest);
    await (dependencies.revalidateAccess || revalidateAccess)(access);
    return { task: { ...existing, status: normalizeDurableTaskStatus(existing.status), revision: existing.revision ?? 0 }, reused: true, charged: false };
  }
  let frozenPricing: Readonly<SketchAdmissionPricing>;
  try {
    const pricing = copySketchPricingConfig(await (dependencies.loadPricingConfig || loadStrictPricing)());
    const tokenPricing = resolveTokenPricingFromConfig(pricing, binding.modelId, binding.providerId);
    const perCallCredits = await calculateConfiguredCreditCost('chat', binding.modelId, { providerId: binding.providerId, pricingConfig: pricing });
    if (!Number.isSafeInteger(perCallCredits) || perCallCredits < 0 || perCallCredits > 100_000) throw new SketchAdmissionError('SKETCH_PRICING_INVALID', 503);
    frozenPricing = parseSketchAdmissionPricing(tokenPricing
      ? { mode: 'token', calls: 2, perCallCredits, totalCredits: Math.max(1, 2 * perCallCredits), tokenPricing }
      : { calls: 2, perCallCredits, totalCredits: 2 * perCallCredits });
  } catch (error) {
    if (error instanceof SketchAdmissionError) throw error;
    throw new SketchAdmissionError('SKETCH_PRICING_INVALID', 503);
  }
  context.signal.throwIfAborted();
  const now = Date.now();
  let result: CreateBillableTaskResult;
  try {
    result = await (dependencies.createBillableTask || createBillableTask)({ userId: access.actorUserId, idempotencyKey: input.idempotencyKey,
      requestDigest, creditCost: frozenPricing.totalCredits,
      beforeCharge: async client => {
        context.signal.throwIfAborted(); await (dependencies.assertProjectFence || assertSketchProjectFence)(client, access); context.signal.throwIfAborted();
      },
      // The existing atomic cancellation contract uses processing/pending as its live states.
      // Waiting for our worker is a label, not a new durable state that could strand a charge.
      task: { id: `sketch_${randomUUID()}`, projectId: input.projectId, type: 'sketch-to-code', status: 'processing', progress: 0,
        providerId: binding.providerId, model: binding.modelId, label: '草图转代码：等待执行', createdAt: now, updatedAt: now,
        result: { sketchAdmission: { version: 1, route: '/api/sketch-to-code', requestDigest, access,
          pricing: frozenPricing } } },
    });
  } catch (error) {
    // Never refund or resubmit an admission whose COMMIT acknowledgement may be lost.
    if (context.signal.aborted && error === context.signal.reason) throw error;
    if (error instanceof SketchAdmissionError || error instanceof InsufficientCreditsError || error instanceof IdempotencyConflictError) throw error;
    throw new SketchAdmissionError('SKETCH_TASK_UNAVAILABLE', 503);
  }
  if (result.reused) {
    validateReplay(result.task, prepared, requestDigest);
    await (dependencies.revalidateAccess || revalidateAccess)(access);
    return { task: result.task, reused: true, charged: false };
  }
  return { ...result, prepared };
}

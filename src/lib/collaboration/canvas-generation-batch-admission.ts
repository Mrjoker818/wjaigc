import 'server-only';
import { createHash } from 'node:crypto';
import { authorizeAgentContext, resolveAgentMediaUrls, AgentContextNotFoundError } from '@/lib/agent-runtime/context-adapters';
import { createBillableTask, settleFailedTask } from '@/lib/task-core/billing-service';
import { CanvasBatchCommitUnknownError, getCloudTaskForUserByIdempotencyKey, type CloudTask } from '@/lib/cloud-task-storage';
import { getPool } from '@/lib/db-client';
import { projectCanonicalGenerationSlot, type CanonicalGenerationSlot, type DurableGenerationBatch } from '@/lib/task-core/generation-batch';
import { InsufficientCreditsError } from '@/lib/credits';
import { IdempotencyConflictError } from '@/lib/task-core/idempotency';
import { GenerationProjectAccessError, type GenerationProjectAccess } from './generation-project-access';
import { CanvasTaskPublicationError, prepareCanvasTaskPublicationInTransaction, type CanvasTaskPublicationInput } from './task-publication';
import { CanvasPublicationIntentError, parseCanvasPublicationIntentProposal } from './task-publication-intent';

export class CanvasGenerationAdmissionError extends Error {
  constructor(readonly status: 400 | 402 | 403 | 409 | 503, readonly code: string,
    readonly partialTaskIds: readonly string[] = []) {
    super(status === 503 ? '画布批次准入暂不可用，请核对任务记录后重试' : '画布批次未获准提交，请检查参数、权限及积分');
    this.name = 'CanvasGenerationAdmissionError';
  }
}

function classify(error: unknown, partialTaskIds: readonly string[] = []): CanvasGenerationAdmissionError {
  if (error instanceof CanvasGenerationAdmissionError) return new CanvasGenerationAdmissionError(error.status, error.code, partialTaskIds);
  if (error instanceof CanvasPublicationIntentError) return new CanvasGenerationAdmissionError(400, 'CANVAS_GENERATION_INVALID_INTENT', partialTaskIds);
  if (error instanceof AgentContextNotFoundError) return new CanvasGenerationAdmissionError(403, 'CANVAS_GENERATION_SOURCE_FORBIDDEN', partialTaskIds);
  if (error instanceof InsufficientCreditsError) return new CanvasGenerationAdmissionError(402, error.code, partialTaskIds);
  if (error instanceof IdempotencyConflictError) return new CanvasGenerationAdmissionError(409, 'IDEMPOTENCY_CONFLICT', partialTaskIds);
  if (error instanceof CanvasTaskPublicationError || error instanceof GenerationProjectAccessError) {
    return new CanvasGenerationAdmissionError(error.status as 400 | 403 | 409 | 503, error.code, partialTaskIds);
  }
  return new CanvasGenerationAdmissionError(503, 'CANVAS_GENERATION_UNAVAILABLE', partialTaskIds);
}

function mediaIdentity(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('//')) throw new CanvasPublicationIntentError();
  const url = new URL(value, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new CanvasPublicationIntentError();
  return url.href;
}

/** Pure proposal parsing: no current source or media reads, also used for terminal replay. */
export function parseCanvasGenerationPublication(input: {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  body: Record<string, unknown>;
}): CanvasTaskPublicationInput {
  try {
    const { body, access } = input;
    if (body._skipCredits || body._skipCloudTaskPersistence) throw new CanvasGenerationAdmissionError(400, 'CANVAS_GENERATION_INVALID_FLAGS');
    const workspaceId = body.assetWorkspaceId === undefined ? access.projectId : body.assetWorkspaceId;
    if (workspaceId !== access.projectId && workspaceId !== `canvas:${access.projectId}`) throw new CanvasPublicationIntentError();
    const proposal = parseCanvasPublicationIntentProposal({ parentVersionIds: body.assetParentVersionIds === undefined ? [] : body.assetParentVersionIds,
      projectionMode: body.assetProjectionMode === undefined ? 'derived' : body.assetProjectionMode,
      placement: { action: 'append', selectedEntityIds: body.assetSelectedEntityIds === undefined ? [] : body.assetSelectedEntityIds } });
    return { access, workspace: 'canvas', workspaceId: access.projectId, intent: proposal, batchAdmission: true };
  } catch (error) { throw classify(error); }
}

/** Validate raw URLs before any conversion/download. Layout selection is independent of ancestry. */
export async function prepareCanvasGenerationPublication(input: {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  body: Record<string, unknown>; origin: string;
}): Promise<CanvasTaskPublicationInput> {
  try {
    const { body, access } = input;
    const publication = parseCanvasGenerationPublication(input);
    const proposal = parseCanvasPublicationIntentProposal(publication.intent);
    if (proposal.parentVersionIds.length) {
      const context = await authorizeAgentContext({ actorUserId: access.actorUserId, request: {
        projectId: access.projectId, workspace: 'canvas', workspaceId: access.projectId,
        mode: 'agent', executionRuntime: 'local', prompt: '', allowedToolIds: [], idempotencyKey: 'source-read',
        sourceVersionIds: proposal.parentVersionIds,
        context: { selectedEntityIds: [], visibleVersionIds: [], locale: 'zh-CN' },
      } });
      if (context.projectAccess?.grantGeneration !== access.grantGeneration
        || context.projectAccess.ownerId !== access.ownerId || context.projectAccess.actorUserId !== access.actorUserId) {
        throw new CanvasGenerationAdmissionError(403, 'CANVAS_GENERATION_SOURCE_FORBIDDEN');
      }
      const urls = resolveAgentMediaUrls(context, proposal.parentVersionIds);
      if (body.referenceImages !== undefined) {
        if (!Array.isArray(body.referenceImages)) throw new CanvasPublicationIntentError();
        const refs = body.referenceImages.map(value => mediaIdentity(
          typeof value === 'object' && value !== null ? value.url : value, input.origin));
        const expected = urls.map(value => mediaIdentity(value, input.origin));
        if (refs.length && (refs.length !== expected.length || refs.some((value, index) => value !== expected[index]))) {
          throw new CanvasGenerationAdmissionError(403, 'CANVAS_GENERATION_SOURCE_MISMATCH');
        }
      }
    }
    return publication;
  } catch (error) { throw classify(error); }
}

/** Only unbound blank string slots are absent references; keep all other values for strict validation. */
export function normalizeCanvasGenerationReferences(
  rawReferences: unknown, publication: CanvasTaskPublicationInput,
): unknown[] {
  if (rawReferences === undefined) return [];
  if (!Array.isArray(rawReferences)) throw new CanvasGenerationAdmissionError(400, 'CANVAS_GENERATION_INVALID_INTENT');
  return publication.intent?.parentVersionIds.length === 0
    ? rawReferences.filter(value => typeof value !== 'string' || value.trim() !== '')
    : rawReferences;
}

/** One stable identity for first admission and replay; never derived from downloaded bytes or stored payloads. */
export function canvasGenerationRequestDigest(input: {
  fields: Record<string, unknown>; rawReferences: unknown; origin: string;
  requestedCount: number; publication: CanvasTaskPublicationInput;
}): string {
  try {
    if (!Number.isSafeInteger(input.requestedCount) || input.requestedCount < 1 || input.requestedCount > 4) throw new CanvasPublicationIntentError();
    const refs = normalizeCanvasGenerationReferences(input.rawReferences, input.publication).map(value => {
      const url = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).url : value;
      // Undeclared external/data upload references keep the existing input contract.
      if (typeof url === 'string' && url.startsWith('data:')) return url;
      return mediaIdentity(url, input.origin);
    });
    return createHash('sha256').update(JSON.stringify({ ...input.fields, referenceImages: refs,
      outputCount: input.requestedCount, canvasTarget: input.publication.workspaceId,
      canvasIntent: input.publication.intent })).digest('hex');
  } catch (error) { throw classify(error); }
}

/** A complete historical batch is a read, not a fresh source admission. */
export async function readTerminalCanvasGenerationBatch(input: {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>; rootIdempotencyKey: string;
  requestedCount: number; requestDigest: string; publication: CanvasTaskPublicationInput;
}): Promise<CanonicalGenerationSlot[] | undefined> {
  try {
    const batchId = `batch-${createHash('sha256').update(input.rootIdempotencyKey).digest('hex').slice(0, 24)}`;
    const slots: CanonicalGenerationSlot[] = [];
    const existing: Array<{ task: CloudTask; index: number }> = [];
    for (let index = 0; index < input.requestedCount; index++) {
      const key = `${input.rootIdempotencyKey}:${index}`;
      const task = await getCloudTaskForUserByIdempotencyKey(input.access.actorUserId, key);
      if (!task) continue;
      existing.push({ task, index });
      const payload = task.result?.submissionPayload as Record<string, unknown> | undefined;
      if (task.userId !== input.access.actorUserId || task.projectId !== input.access.projectId
        || task.type !== 'generate-async' || task.idempotencyKey !== key || task.requestDigest !== input.requestDigest
        || payload?.batchId !== batchId || payload.slotId !== `${batchId}:${index}`
        || payload.slotIndex !== index || payload.slotCount !== input.requestedCount) {
        throw new CanvasGenerationAdmissionError(409, 'IDEMPOTENCY_CONFLICT');
      }
      if (!['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) continue;
      const slot = projectCanonicalGenerationSlot({ taskId: task.id, status: task.status, result: task.result,
        ...(task.error ? { error: { code: 'TASK_FAILED', message: task.error } } : {}) });
      if (!slot) throw new CanvasGenerationAdmissionError(409, 'IDEMPOTENCY_CONFLICT');
      slots.push(slot);
    }
    if (slots.length === input.requestedCount) return slots;
    if (existing.length) {
      const client = await getPool().connect();
      let discard = false;
      let failure: unknown;
      try {
        // Read-only preflight of the original grant/intent before media IO.
        // Core repeats this validation under its own admission lock and alone advances revision.
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        for (const { task, index } of existing) {
          await prepareCanvasTaskPublicationInTransaction(client, { actorUserId: input.access.actorUserId,
            projectId: input.access.projectId, publication: input.publication, replayTaskId: task.id,
            taskIdentity: { idempotencyKey: `${input.rootIdempotencyKey}:${index}`, requestDigest: input.requestDigest,
              batchId, slotId: `${batchId}:${index}`, slotIndex: index, slotCount: input.requestedCount } });
        }
      } catch (error) { failure = error; }
      try { await client.query('ROLLBACK'); }
      catch { discard = true; failure = new CanvasGenerationAdmissionError(503, 'CANVAS_GENERATION_UNAVAILABLE'); }
      finally { client.release(discard); }
      if (failure) throw failure;
    }
    return undefined;
  } catch (error) { throw classify(error); }
}

export interface AdmitCanvasGenerationBatchInput {
  access: Extract<GenerationProjectAccess, { kind: 'document' }>;
  batch: DurableGenerationBatch;
  rootIdempotencyKey: string;
  requestDigest: string;
  creditCost: number;
  publication: CanvasTaskPublicationInput;
  submissionPayload: Record<string, unknown>;
  providerId: string;
  model: string;
  sessionId?: string;
  messageId?: string;
}

export async function admitCanvasGenerationBatch(input: AdmitCanvasGenerationBatchInput): Promise<CanonicalGenerationSlot[]> {
  const slots: CanonicalGenerationSlot[] = [];
  const createdTasks: Array<{ taskId: string; revision: number }> = [];
  try {
    const batch = input.batch;
    if (!input.rootIdempotencyKey || batch.batchId !== `batch-${createHash('sha256').update(input.rootIdempotencyKey).digest('hex').slice(0, 24)}`
      || !Number.isSafeInteger(batch.requestedCount) || batch.requestedCount < 1 || batch.requestedCount > 4
      || batch.slots.length !== batch.requestedCount || new Set(batch.slots.map(slot => slot.taskId)).size !== batch.slots.length
      || batch.slots.some((slot, index) => slot.slotIndex !== index || slot.slotId !== `${batch.batchId}:${index}` || slot.batchId !== batch.batchId)
      || input.publication.access.actorUserId !== input.access.actorUserId
      || input.publication.access.projectId !== input.access.projectId
      || input.publication.access.ownerId !== input.access.ownerId
      || input.publication.access.grantGeneration !== input.access.grantGeneration) throw new CanvasPublicationIntentError();
    for (const slot of batch.slots) {
      const now = Date.now();
      const outcome = await createBillableTask({ userId: input.access.actorUserId,
        idempotencyKey: `${input.rootIdempotencyKey}:${slot.slotIndex}`, requestDigest: input.requestDigest, creditCost: input.creditCost,
        canvasPublication: { ...input.publication, batchAdmission: true,
          ...(slot.slotIndex > 0 ? { batchPlacement: { anchorTaskId: slots[0].taskId,
            slotIndex: slot.slotIndex, slotCount: batch.requestedCount, requestDigest: input.requestDigest } } : {}) },
        task: { id: slot.taskId, projectId: input.access.projectId, sessionId: input.sessionId, messageId: input.messageId,
          type: 'generate-async', status: 'processing', providerId: input.providerId, model: input.model,
          progress: 0, label: `生成图片 ${slot.slotIndex + 1}/${batch.requestedCount}`, createdAt: now, updatedAt: now,
          result: { submissionPayload: { ...input.submissionPayload, batchId: batch.batchId, slotId: slot.slotId,
            slotIndex: slot.slotIndex, slotCount: batch.requestedCount } } } });
      if (!outcome.reused) createdTasks.push({ taskId: outcome.task.id, revision: outcome.task.revision });
      slots.push(projectCanonicalGenerationSlot({ taskId: outcome.task.id, status: outcome.task.status, result: outcome.task.result })
        ?? { ...slot, taskId: outcome.task.id, status: outcome.task.status });
    }
    return slots;
  } catch (error) {
    // An unknown later COMMIT may have completed the batch. Preserve even known new slots.
    if (error instanceof CanvasBatchCommitUnknownError) {
      throw new CanvasGenerationAdmissionError(503, error.code, slots.map(slot => slot.taskId));
    }
    // Keep the original creation revision: authorized reuse invalidates compensation.
    const settled = await Promise.allSettled(createdTasks.map(({ taskId, revision }) => settleFailedTask({ taskId, expectedRevision: revision, status: 'cancelled',
      error: { code: 'CANVAS_BATCH_ADMISSION_FAILED', message: '批次准入未完成，取消本次未启动任务' } })));
    if (settled.some(result => result.status === 'rejected')) throw new CanvasGenerationAdmissionError(503, 'CANVAS_BATCH_SETTLEMENT_UNAVAILABLE', slots.map(slot => slot.taskId));
    throw classify(error, slots.map(slot => slot.taskId));
  }
}

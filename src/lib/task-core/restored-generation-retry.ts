import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import type { User } from '@/lib/user-types';
import { getPool } from '@/lib/db-client';
import { getCloudTaskForUser, type CloudTask } from '@/lib/cloud-task-storage';
import { readGenerationProjectAccess, type GenerationProjectAccess } from '@/lib/collaboration/generation-project-access';
import { CanvasTaskPublicationError, prepareCanvasTaskPublicationInTransaction, type CanvasTaskPublicationInput } from '@/lib/collaboration/task-publication';
import { readTaskPublicationAccess, readTaskPublicationIntent } from '@/lib/collaboration/task-publication-access';
import { validateCanvasBatchSources, type CanvasTaskPublicationIntent } from '@/lib/collaboration/task-publication-intent';
import { CanvasOrdinaryAdmissionError, canvasOrdinaryRequestDigest, validateCanvasOrdinarySources } from '@/lib/collaboration/canvas-ordinary-generation-admission';
import { validateImageUrl } from '@/lib/input-validation';
import { createBillableTask } from './billing-service';
import { prepareOrdinaryGenerationRequest } from './ordinary-generation-request';
import { executeOrdinaryGenerationTask, ordinaryTaskResponse, readOrdinaryDescriptor, type OrdinaryGenerationDescriptor } from './ordinary-generation-task';
import { kickoffDurableGenerationTasks } from './durable-generation-kickoff';
import { registerTask, updateTaskProgress } from '@/lib/task-registry';
import { projectCanonicalGenerationSlot } from './generation-batch';

const publicFields = [
  'projectId', 'prompt', 'providerId', 'model', 'aspectRatio', 'size', 'quality', 'resolution',
  'referenceImages', 'referenceMode', 'referenceCategories', 'referenceStrengths', 'referenceCategoryStrengths',
  'referenceDescriptions', 'imageCategory', 'productCategory', 'stylePreset', 'strength',
  'background', 'backgroundMode', 'output_format', 'outputFormat', 'sessionId', 'messageId',
  'assetWorkspace', 'assetWorkspaceId', 'assetSourceEntityId', 'assetParentVersionIds',
  'assetSelectedEntityIds', 'assetProjectionMode',
] as const;

function reject(status = 409, code = 'GENERATION_RETRY_UNAVAILABLE', message = '原任务缺少可安全重试的完整信息，请核对原任务后重新提交'): never {
  throw new CanvasOrdinaryAdmissionError(status, code, message);
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function retryableOriginal(task: CloudTask): void {
  const result = task.result ?? {};
  if (!['failed', 'timeout'].includes(task.status) || !['generate', 'generate-async'].includes(task.type)
    || result.requiresReconciliation === true || result.retryable === false
    || object(result.taskError).retryable === false || object(result.error).retryable === false
    || result.ordinaryDiagnostic === 'ORDINARY_SUBMISSION_UNCERTAIN'
    || result.skillBillingProvenance || result.skillProviderDispatch || result.skillDeferredCompletion) reject();
}
function frozenBody(task: CloudTask): Record<string, unknown> {
  retryableOriginal(task);
  const raw = task.type === 'generate' ? readOrdinaryDescriptor(task).plan.body : object(task.result?.submissionPayload);
  if (!Object.keys(raw).length || typeof raw.prompt !== 'string' || !raw.prompt.trim()
    || !task.providerId || !task.model || raw.providerId !== task.providerId || raw.model !== task.model
    || (raw.projectId ?? '') !== (task.projectId ?? '')
    || Object.entries(raw).some(([key, value]) => value !== undefined && value !== false
      && (/^_|^skill(?:Billing|Prepaid)|^gateway/i.test(key) || /apiKey|apiBaseUrl|authorization|password|credential/i.test(key)))) reject();
  // Supported legacy writers always materialize ratio and the full reference array.
  // V1 descriptors retain the established optional-size protocol (including '').
  if (task.type === 'generate-async') {
    if (!Object.hasOwn(raw, 'aspectRatio') || !Array.isArray(raw.referenceImages)
      || typeof raw.aspectRatio !== 'string' || !/^(?:auto|[1-9]\d*:[1-9]\d*)$/.test(raw.aspectRatio)) reject();
    if (raw.size !== undefined && (typeof raw.size !== 'string'
      || !/^(?:auto|[1-9]\d*(?:x|:)[1-9]\d*)$/.test(raw.size))) reject();
    if (['quality', 'resolution'].some(key => raw[key] !== undefined
      && (typeof raw[key] !== 'string' || !(raw[key] as string).trim()))) reject();
  }
  if (raw.agentStrictRouting === true || raw.agentProviderIdempotencyKey !== undefined) reject();
  const body: Record<string, unknown> = Object.fromEntries(publicFields.flatMap(key => raw[key] === undefined ? [] : [[key, structuredClone(raw[key])]]));
  if (body.referenceImages !== undefined) {
    if (!Array.isArray(body.referenceImages) || body.referenceImages.some(ref => {
      const url = typeof ref === 'string' ? ref : object(ref).url;
      return typeof url !== 'string' || Boolean(validateImageUrl(url));
    })) reject();
  }
  return { ...body, outputCount: 1, n: 1, submitOnly: true };
}

/** Legacy document tasks may have a frozen publication even without an ordinary descriptor.
 * Missing historical source proofs fail closed; never substitute today's selection/grant. */
async function legacyPublication(task: CloudTask): Promise<{ publication: CanvasTaskPublicationInput; intent: CanvasTaskPublicationIntent }> {
  const client = await getPool().connect();
  let discard = false;
  try {
    // The historical readers take FOR SHARE locks. No data is written here;
    // authoritative access/source checks repeat inside atomic create/charge.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const access = await readTaskPublicationAccess(client, task.userId, task.id);
    const intent = await readTaskPublicationIntent(client, task.userId, task.id);
    if (!access || !intent || intent.placement.action !== 'attach' || !intent.selectionSnapshot
      || intent.parentVersionIds.length) reject();
    await client.query('COMMIT');
    return { intent, publication: { access: { kind: 'document', actorUserId: access.actorId, ownerId: access.ownerId,
      projectId: access.projectId, grantGeneration: access.grantGeneration }, workspace: 'canvas', workspaceId: access.workspaceId,
    singleAdmission: 'generate', ordinarySourceSnapshot: [], intent: { parentVersionIds: [], projectionMode: intent.projectionMode,
      placement: { action: 'append', selectedEntityIds: intent.selectionSnapshot.map(source => source.entityId) } } } };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally { client.release(discard); }
}

async function assertOriginalLocked(client: PoolClient, original: CloudTask, access: GenerationProjectAccess,
  legacyIntent?: CanvasTaskPublicationIntent): Promise<void> {
  const row = (await client.query('SELECT user_id,project_id,type,status,provider_id,model,request_digest,result FROM cloud_tasks WHERE id=$1 FOR SHARE', [original.id])).rows[0];
  if (!row || row.user_id !== original.userId || row.project_id !== (original.projectId ?? '')
    || row.type !== original.type || row.status !== original.status || row.provider_id !== original.providerId
    || row.model !== original.model || (row.request_digest || undefined) !== original.requestDigest
    || !isDeepStrictEqual(row.result, original.result ?? {})) reject();
  if (original.projectId) {
    const current = await readGenerationProjectAccess(client, original.userId, original.projectId);
    if (!isDeepStrictEqual(current, access)) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_FORBIDDEN');
  }
  if (original.type === 'generate') {
    const descriptor = readOrdinaryDescriptor(original);
    await prepareCanvasTaskPublicationInTransaction(client, { actorUserId: original.userId, projectId: original.projectId!,
      publication: descriptor.publication, replayTaskId: original.id,
      singleTaskIdentity: { type: 'generate', idempotencyKey: original.idempotencyKey!, requestDigest: original.requestDigest! } });
  } else if (access.kind === 'document') {
    const frozenAccess = await readTaskPublicationAccess(client, original.userId, original.id);
    const frozenIntent = await readTaskPublicationIntent(client, original.userId, original.id);
    if (!legacyIntent || !frozenAccess || frozenAccess.ownerId !== access.ownerId
      || frozenAccess.grantGeneration !== access.grantGeneration || !isDeepStrictEqual(frozenIntent, legacyIntent)) reject();
    await validateCanvasBatchSources(client, access.ownerId, access.projectId, legacyIntent);
  }
}

/** A retry is a new billable attempt; same-ancestor receipt retries share one atomic admission.
 * No public request/descriptor expansion and no legacy pre-charge wrapper. */
export async function submitRestoredGenerationRetry(input: {
  body: Record<string, unknown>; user: User; access: GenerationProjectAccess; origin: string;
  schedule: (execute: () => Promise<void>) => void;
}): Promise<Record<string, unknown>> {
  const { body, user, access, origin } = input;
  if (Object.keys(body).some(key => !['retryTaskId', 'projectId', 'submitOnly', 'outputCount', 'n'].includes(key))
    || typeof body.retryTaskId !== 'string' || !body.retryTaskId.trim() || body.retryTaskId.trim() !== body.retryTaskId
    || body.retryTaskId.length > 256 || body.submitOnly !== true || body.outputCount !== 1 || body.n !== 1) {
    reject(400, 'GENERATION_RETRY_INVALID', '重试只接受原任务标识，不能覆盖原供应商、模型或提示词');
  }
  const original = await getCloudTaskForUser(body.retryTaskId, user.id);
  if (!original) reject(404, 'GENERATION_RETRY_NOT_FOUND', '原任务不存在或无权访问');
  if ((body.projectId ?? '') !== (original.projectId ?? '')) reject();
  const replay = frozenBody(original);
  let publication: CanvasTaskPublicationInput | undefined;
  let legacyIntent: CanvasTaskPublicationIntent | undefined;
  if (access.kind === 'document') {
    if (original.type === 'generate') publication = structuredClone(readOrdinaryDescriptor(original).publication);
    else ({ publication, intent: legacyIntent } = await legacyPublication(original));
    if (!isDeepStrictEqual(publication.access, access)) throw new CanvasTaskPublicationError('CANVAS_TASK_PUBLICATION_FORBIDDEN');
    if (!publication.ordinarySourceSnapshot) reject();
    const intent = publication.intent;
    if (!intent || intent.placement.action !== 'append') reject();
    replay.assetParentVersionIds = [...intent.parentVersionIds];
    replay.assetSelectedEntityIds = [...intent.placement.selectedEntityIds];
    replay.assetProjectionMode = intent.projectionMode;
    await validateCanvasOrdinarySources(publication, replay, origin);
  } else if (original.type === 'generate') reject();
  const plan = await prepareOrdinaryGenerationRequest(replay, user);
  const idempotencyKey = 'restored-generation-retry:' + createHash('sha256')
    .update(JSON.stringify([user.id, original.projectId ?? '', original.id])).digest('hex');
  const requestDigest = canvasOrdinaryRequestDigest({ retryOf: original.id, body: plan.body });
  const now = Date.now();
  const taskId = `${publication ? 'ordinary_' : 'generate-retry-'}${randomUUID()}`;
  const batchId = `batch-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
  const descriptor: OrdinaryGenerationDescriptor | undefined = publication
    ? { version: 1, route: '/api/generate', requestDigest, plan, publication } : undefined;
  const admitted = await createBillableTask({ userId: user.id, idempotencyKey, requestDigest, creditCost: plan.creditCost,
    ...(publication ? { canvasPublication: publication } : {}),
    beforeCharge: client => assertOriginalLocked(client, original, access, legacyIntent),
    task: { id: taskId, type: publication ? 'generate' : 'generate-async', status: 'processing', projectId: original.projectId,
      sessionId: original.sessionId, messageId: original.messageId, providerId: original.providerId, model: original.model,
      progress: 0, createdAt: now, updatedAt: now, label: '重新生成',
      result: descriptor ? { ordinaryGeneration: descriptor, outputGroup: { version: 1, kind: 'ordinary-generation', taskId, requestedCount: 1 } }
        : { submissionPayload: { ...plan.body, workerMode: 'recovery', outputCount: 1, n: 1, requestDigest,
          batchId, slotId: `${batchId}:0`, slotIndex: 0, slotCount: 1 } } } });
  const task = await getCloudTaskForUser(admitted.task.id, user.id);
  if (!task) reject(503, 'GENERATION_RETRY_UNAVAILABLE', '重试回执待确认，请再次点击原任务重试');
  if (!admitted.reused) {
    registerTask(task.id, publication ? 'generate' : 'generate-async', '重新生成', user.id);
    updateTaskProgress(task.id, { status: 'processing', progress: 0, result: task.result });
  }
  if (!['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) input.schedule(async () => {
    if (publication) await executeOrdinaryGenerationTask({ taskId: task.id, actorUserId: user.id, origin, phase: 'submit' });
    else await kickoffDurableGenerationTasks({ taskIds: [task.id], userId: user.id, userRole: user.role === 'admin' ? 'admin' : 'user', waitForTerminal: false });
  });
  if (publication) return ordinaryTaskResponse(task);
  const slot = projectCanonicalGenerationSlot({ taskId: task.id, status: task.status, result: task.result,
    ...(task.error ? { error: { code: 'TASK_FAILED', message: task.error, retryable: true } } : {}) });
  if (!slot) reject(503, 'GENERATION_RETRY_UNAVAILABLE', '重试回执待确认，请再次点击原任务重试');
  return { success: !['failed', 'cancelled', 'timeout'].includes(task.status), mode: 'polling', taskId: task.id,
    taskIds: [task.id], status: task.status, progress: task.progress, slots: [{ ...slot, slotIndex: 0 }],
    ...(slot.result ? { result: slot.result } : {}), ...(slot.error ? { error: slot.error } : {}) };
}

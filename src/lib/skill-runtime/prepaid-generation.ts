import 'server-only';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { getRecoverySubmissionDeadline, type RecoverySubmissionDeadline } from '@/lib/task-core/recovery-submission';
import { createCloudTask, ensureCloudTaskTables, getCloudTaskForUser, type CloudTask, type CreateCloudTaskInput } from '@/lib/cloud-task-storage';
import {
  assertSkillBillingAuthorization,
  type SkillBillingAuthorizationInput,
  type SkillBillingContext,
} from './billing-authorization';

export class SkillBillingAuthorizationError extends Error {
  readonly code = 'SKILL_BILLING_NOT_AUTHORIZED';
  constructor() {
    super('SKILL_BILLING_NOT_AUTHORIZED');
  }
}

export interface SkillPrepaidProviderRequest {
  taskId: string;
  userId: string;
  workerId: string;
  attemptCount: number;
  parentGeneration: number;
  providerId: string;
  modelId: string;
  requestBody: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SkillPrepaidExecutionReference {
  taskId: string;
  workerId: string;
  attemptCount: number;
  parentGeneration: number;
}

export function parseSkillPrepaidExecutionReference(value: unknown): SkillPrepaidExecutionReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SkillBillingAuthorizationError();
  const reference = value as Record<string, unknown>;
  if ([reference.taskId, reference.workerId].some(item => typeof item !== 'string' || !item || item.length > 256)
    || !Number.isSafeInteger(reference.attemptCount) || Number(reference.attemptCount) < 1
    || !Number.isSafeInteger(reference.parentGeneration) || Number(reference.parentGeneration) < 0) {
    throw new SkillBillingAuthorizationError();
  }
  return { taskId: reference.taskId as string, workerId: reference.workerId as string,
    attemptCount: reference.attemptCount as number, parentGeneration: reference.parentGeneration as number };
}

export async function readSkillPrepaidExecutionReference(
  child: CloudTask, workerId: string, attemptCount: number,
): Promise<SkillPrepaidExecutionReference> {
  const provenance = child.result?.skillBillingProvenance as Record<string, unknown> | undefined;
  const result = await getPool().query(`SELECT generation FROM wujie_agent_execution_leases
    WHERE task_id=$1 AND owner_id=$2 AND project_id=$3`, [provenance?.runId, child.userId, child.projectId]);
  return parseSkillPrepaidExecutionReference({ taskId: child.id, workerId, attemptCount,
    parentGeneration: result.rows[0]?.generation });
}

export async function getSkillPrepaidSubmissionDeadline(
  child: CloudTask, now: number = Date.now(),
): Promise<RecoverySubmissionDeadline> {
  const provenance = child.result?.skillBillingProvenance as Record<string, unknown> | undefined;
  if (!provenance) return getRecoverySubmissionDeadline({ createdAt: child.createdAt, now });
  if (typeof provenance.runId !== 'string' || !child.projectId) throw new SkillBillingAuthorizationError();
  const events = await getPool().query<{ event_type: string; created_at: string | number }>(
    `SELECT event_type, created_at FROM wujie_agent_events
      WHERE task_id=$1 AND owner_id=$2 AND project_id=$3
        AND event_type IN ('run.paused', 'run.resumed') ORDER BY sequence`,
    [provenance.runId, child.userId, child.projectId],
  );
  let pausedAt: number | undefined;
  let pausedMs = 0;
  for (const event of events.rows) {
    const time = Math.min(now, Number(event.created_at));
    if (!Number.isFinite(time)) throw new SkillBillingAuthorizationError();
    if (event.event_type === 'run.paused') pausedAt ??= Math.max(child.createdAt, time);
    else if (pausedAt !== undefined) {
      pausedMs += Math.max(0, time - pausedAt);
      pausedAt = undefined;
    }
  }
  if (pausedAt !== undefined) pausedMs += Math.max(0, now - pausedAt);
  return getRecoverySubmissionDeadline({ createdAt: child.createdAt + pausedMs, now });
}

export async function reconcileSkillPrepaidDispatch(child: CloudTask, requestId: string): Promise<boolean> {
  const dispatch = child.result?.skillProviderDispatch as Record<string, unknown> | undefined;
  const provenance = child.result?.skillBillingProvenance as Record<string, unknown> | undefined;
  if (typeof dispatch?.token !== 'string' || typeof provenance?.runId !== 'string') throw new SkillBillingAuthorizationError();
  const result = await getPool().query(`UPDATE cloud_tasks SET
      result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('taskError', $6::jsonb),
      label='供应商提交结果尚未确认，请核对原任务，勿重复生成', revision=revision+1
    WHERE id=$1 AND user_id=$2 AND project_id=$3 AND status='processing'
      AND type='generate-async' AND COALESCE(remote_task_id,'')=''
      AND result #>> '{skillProviderDispatch,token}'=$4
      AND result #>> '{skillBillingProvenance,runId}'=$5
      AND NOT COALESCE(result ? 'skillDeferredCompletion', false)
      AND lease_expires_at <= EXTRACT(EPOCH FROM clock_timestamp()) * 1000
    RETURNING id`, [child.id, child.userId, child.projectId, dispatch.token, provenance.runId,
    JSON.stringify({ code: 'SKILL_SUBMISSION_UNKNOWN', message: '供应商提交结果尚未确认，请核对原任务，勿重复生成',
      source: 'wujie', retryable: false, requestId })]);
  return result.rows.length > 0;
}

function executionError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

async function isConfirmedRateLimitRejection(response: Response): Promise<boolean> {
  if (response.status !== 429 || !response.headers.get('content-type')?.includes('application/json')) return false;
  const reader = response.clone().body?.getReader();
  if (!reader) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Rate-limit response inspection timed out')), 2_000);
  });
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) return false;
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const payload = body as Record<string, unknown>;
    // An unfamiliar envelope may contain an accepted task. Never infer safe retry from HTTP alone.
    if (Object.keys(payload).some(key => !['error', 'request_id'].includes(key))) return false;
    if (!payload.error || typeof payload.error !== 'object' || Array.isArray(payload.error)) return false;
    const error = payload.error as Record<string, unknown>;
    if (Object.entries(error).some(([key, value]) => !['type', 'code', 'message', 'param'].includes(key)
      || (value !== null && typeof value !== 'string'))) return false;
    return error.type === 'rate_limit_error' || error.code === 'rate_limit_exceeded';
  } catch {
    // Unreadable or incomplete responses are submission-unknown, not permission to resubmit.
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

async function lockPrepaidDispatch(
  client: PoolClient, input: SkillPrepaidProviderRequest, reservation?: string,
): Promise<void> {
  const parent = await client.query(`SELECT parent.* FROM cloud_tasks parent
    JOIN cloud_tasks child ON child.id=$1 AND child.user_id=$2
      AND parent.id=child.result #>> '{skillBillingProvenance,runId}'
      AND parent.user_id=child.user_id AND parent.project_id=child.project_id
    FOR UPDATE OF parent`, [input.taskId, input.userId]);
  const owner = parent.rows[0];
  if (owner?.status === 'cancelled') throw executionError('SKILL_PARENT_CANCELLED');
  if (!owner || owner.type !== 'agent-run' || owner.status !== 'processing'
    || owner.credit_status === 'refunded' || owner.refunded_transaction_id) throw executionError('SKILL_BILLING_NOT_AUTHORIZED');
  const lease = await client.query(`SELECT * FROM wujie_agent_execution_leases
    WHERE task_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE`, [owner.id, input.userId, owner.project_id]);
  const fence = lease.rows[0];
  if (!fence || Number(fence.paused_at) !== 0 || Number(fence.completed_at) !== 0
    || !fence.lease_owner || Number(fence.generation) !== input.parentGeneration) throw executionError('SKILL_EXECUTION_SUSPENDED');
  const operation = await client.query(`SELECT operation.* FROM wujie_agent_downstream_operations operation
    JOIN cloud_tasks child ON child.id=$1
      AND operation.operation_key=child.result #>> '{skillBillingProvenance,operationKey}'
      AND operation.step_id=child.result #>> '{skillBillingProvenance,stepId}'
    WHERE operation.task_id=$2 AND operation.owner_id=$3 AND operation.project_id=$4
      AND operation.status='accepted' AND operation.provider_task_id=child.id
    FOR UPDATE OF operation`, [input.taskId, owner.id, input.userId, owner.project_id]);
  if (!operation.rows[0]) throw executionError('SKILL_BILLING_NOT_AUTHORIZED');
  const childResult = await client.query(`SELECT *,
      lease_expires_at > EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS lease_live
    FROM cloud_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE`, [input.taskId, input.userId]);
  const child = childResult.rows[0];
  if (!child || child.status !== 'processing' || child.lease_owner !== input.workerId || !child.lease_live
    || Number(child.attempt_count) !== input.attemptCount || Number(child.credit_cost) !== 0
    || child.credit_status !== 'not-applicable' || child.model !== input.modelId || child.provider_id !== input.providerId
    || child.idempotency_key !== `${operation.rows[0].idempotency_key}:0`) throw executionError('SKILL_BILLING_NOT_AUTHORIZED');
  const payload = child.result?.submissionPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.entries(payload).some(([key, value]) => !isDeepStrictEqual(value, input.requestBody[key]))) {
    throw executionError('SKILL_BILLING_NOT_AUTHORIZED');
  }
  const prior = child.result?.skillProviderDispatch;
  if (reservation ? prior?.token !== reservation : Boolean(prior)) {
    throw executionError('SKILL_SUBMISSION_ALREADY_CLAIMED');
  }
}

export async function startSkillPrepaidProviderRequest(
  input: SkillPrepaidProviderRequest,
  startRequest: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  if ([input.taskId, input.userId, input.workerId, input.providerId, input.modelId]
    .some(value => typeof value !== 'string' || !value || value.length > 256)
    || !Number.isSafeInteger(input.attemptCount) || input.attemptCount < 1
    || !Number.isSafeInteger(input.parentGeneration) || input.parentGeneration < 0) {
    throw executionError('SKILL_BILLING_NOT_AUTHORIZED');
  }
  const token = randomUUID();
  const abort = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, abort.signal]) : abort.signal;
  const client = await getPool().connect();
  let started = false;
  let outcome: Promise<{ response: Response } | { error: unknown }> | undefined;
  try {
    await client.query('BEGIN');
    await lockPrepaidDispatch(client, input);
    await client.query(`UPDATE cloud_tasks SET result=jsonb_set(COALESCE(result,'{}'::jsonb),
      '{skillProviderDispatch}', $2::jsonb) WHERE id=$1`,
    [input.taskId, JSON.stringify({ token, workerId: input.workerId, attemptCount: input.attemptCount,
      parentGeneration: input.parentGeneration, reservedAt: Date.now() })]);
    // Reserve durably before any network effect; a lost process cannot silently resubmit.
    await client.query('COMMIT');
    await client.query('BEGIN');
    await lockPrepaidDispatch(client, input, token);
    signal.throwIfAborted();
    // The callback must start fetch synchronously. Release locks before awaiting its response.
    started = true;
    outcome = startRequest(signal).then(response => ({ response }), error => ({ error }));
    await client.query('COMMIT');
  } catch (error) {
    abort.abort(error);
    await client.query('ROLLBACK');
    if (!started) {
      await client.query(`UPDATE cloud_tasks SET result=result - 'skillProviderDispatch'
        WHERE id=$1 AND result #>> '{skillProviderDispatch,token}'=$2`, [input.taskId, token]);
    }
    throw error;
  } finally {
    client.release();
  }
  const settled = await outcome!;
  if ('error' in settled) throw settled.error;
  if (await isConfirmedRateLimitRejection(settled.response)) {
    await getPool().query(`UPDATE cloud_tasks SET result=result - 'skillProviderDispatch'
      WHERE id=$1 AND user_id=$2 AND status='processing'
        AND result #>> '{skillProviderDispatch,token}'=$3`, [input.taskId, input.userId, token]);
  }
  return settled.response;
}

export async function inspectSkillPrepaidPoll(child: CloudTask): Promise<
  { action: 'allow' } | { action: 'wait'; message: string }
  | { action: 'stop'; status: 'failed' | 'cancelled' | 'timeout'; message: string }
> {
  const provenance = child.result?.skillBillingProvenance;
  if (!provenance || ['completed', 'failed', 'cancelled', 'timeout'].includes(child.status)) return { action: 'allow' };
  const invalid = { action: 'stop' as const, status: 'failed' as const, message: 'Skill 父任务关联无效，已停止图像子任务' };
  if (typeof provenance !== 'object' || Array.isArray(provenance)) return invalid;
  const reference = provenance as Record<string, unknown>;
  if (typeof reference.runId !== 'string' || typeof reference.operationKey !== 'string'
    || typeof reference.stepId !== 'string') return invalid;
  const parent = await getCloudTaskForUser(reference.runId, child.userId);
  if (!parent || parent.type !== 'agent-run' || parent.projectId !== child.projectId) return invalid;
  if (parent.status === 'cancelled' || parent.status === 'failed' || parent.status === 'timeout') {
    return { action: 'stop', status: parent.status, message: '父 Skill 已结束，图像子任务不再执行' };
  }
  if (parent.status !== 'processing' || parent.creditStatus === 'refunded' || parent.refundedTransactionId) return invalid;
  const operation = await getPool().query(`SELECT lease.paused_at, lease.completed_at,
    operation.status, operation.provider_task_id
    FROM wujie_agent_execution_leases lease
    JOIN wujie_agent_downstream_operations operation ON operation.task_id=lease.task_id
      AND operation.owner_id=lease.owner_id AND operation.project_id=lease.project_id
    WHERE lease.task_id=$1 AND lease.owner_id=$2 AND lease.project_id=$3
      AND operation.operation_key=$4 AND operation.step_id=$5`,
  [reference.runId, child.userId, child.projectId, reference.operationKey, reference.stepId]);
  const state = operation.rows[0];
  if (!state || Number(state.completed_at) !== 0) return invalid;
  if (Number(state.paused_at) > 0) return { action: 'wait', message: '父 Skill 已暂停，等待恢复' };
  if (state.status !== 'accepted' || state.provider_task_id !== child.id) {
    return { action: 'wait', message: '等待父 Skill 确认图像子任务' };
  }
  return { action: 'allow' };
}

export function parseSkillBillingContext(value: unknown): SkillBillingContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SkillBillingAuthorizationError();
  const raw = value as Record<string, unknown>;
  const fence = raw.executionFence as Record<string, unknown> | undefined;
  if (!fence || typeof fence !== 'object' || Array.isArray(fence)
    || [raw.runId, raw.stepId, raw.requestDigest, raw.operationKey, fence.runId, fence.leaseOwner]
      .some(part => typeof part !== 'string' || !part.trim() || part.length > 256)
    || fence.runId !== raw.runId || !Number.isSafeInteger(fence.generation)
    || Number(fence.generation) < 0) throw new SkillBillingAuthorizationError();
  return {
    runId: raw.runId as string, stepId: raw.stepId as string,
    requestDigest: raw.requestDigest as string, operationKey: raw.operationKey as string,
    executionFence: { runId: fence.runId as string, leaseOwner: fence.leaseOwner as string,
      generation: fence.generation as number },
  };
}

export async function createSkillPrepaidGeneration(
  task: CreateCloudTaskInput,
  context: SkillBillingContext,
  idempotencyKey: string,
): Promise<boolean> {
  if (!task.projectId || !task.providerId || !task.model || task.type !== 'generate-async'
    || task.idempotencyKey !== `${idempotencyKey}:0`) throw new SkillBillingAuthorizationError();
  await ensureCloudTaskTables();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Lock in the same parent -> execution lease -> operation order as the Agent runtime.
    const parent = await client.query(`SELECT id, user_id AS "userId", project_id AS "projectId",
      type, status, credit_status AS "creditStatus", credit_cost::float8 AS "creditCost",
      charged_transaction_id AS "chargedTransactionId", refunded_transaction_id AS "refundedTransactionId"
      FROM cloud_tasks WHERE id=$1 AND user_id=$2 AND project_id=$3 FOR UPDATE`,
    [context.runId, task.userId, task.projectId]);
    const lease = await client.query(`SELECT task_id AS "runId", owner_id AS "actorUserId",
      project_id AS "projectId", lease_owner AS "leaseOwner", generation,
      paused_at::float8 AS "pausedAt", completed_at::float8 AS "completedAt"
      FROM wujie_agent_execution_leases WHERE task_id=$1 FOR UPDATE`, [context.runId]);
    const operation = await client.query(`SELECT operation_key AS "operationKey", owner_id AS "actorUserId",
      project_id AS "projectId", task_id AS "runId", step_id AS "stepId", tool_id AS "toolId",
      request_digest AS "requestDigest", idempotency_key AS "idempotencyKey", status
      FROM wujie_agent_downstream_operations WHERE operation_key=$1 FOR UPDATE`, [context.operationKey]);
    const created = await client.query(`SELECT payload FROM wujie_agent_events
      WHERE task_id=$1 AND owner_id=$2 AND project_id=$3 AND event_type='run.created'
      ORDER BY sequence LIMIT 1`, [context.runId, task.userId, task.projectId]);
    const charge = await client.query(`SELECT id, user_id AS "userId", task_id AS "taskId",
      type, amount::float8 AS amount FROM wujie_credit_transactions
      WHERE id=$1 AND user_id=$2 AND task_id=$3`,
    [parent.rows[0]?.chargedTransactionId || '', task.userId, context.runId]);
    if (!parent.rows[0] || !lease.rows[0] || !operation.rows[0] || !created.rows[0]
      || created.rows[0].payload?.workspaceId !== task.sessionId) throw new SkillBillingAuthorizationError();
    let provenance;
    try {
      provenance = assertSkillBillingAuthorization({
        source: 'internal', actorUserId: task.userId, projectId: task.projectId,
        providerId: task.providerId, modelId: task.model, outputCount: 1, idempotencyKey, context,
        task: parent.rows[0], lease: lease.rows[0], operation: operation.rows[0],
        charge: charge.rows[0] || null, frozen: created.rows[0].payload,
      } as SkillBillingAuthorizationInput);
    } catch {
      throw new SkillBillingAuthorizationError();
    }
    const inserted = await createCloudTask({
      ...task, creditStatus: 'not-applicable', creditCost: 0,
      result: { ...task.result, skillBillingProvenance: provenance },
    }, client);
    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

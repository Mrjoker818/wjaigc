import { execSql, getPool } from '@/lib/db-client';
import {
  createTaskBillingTransactionId,
  InsufficientCreditsError,
  normalizeBillableCreditCost,
} from '@/lib/credits';
import { ensureCoreTables } from '@/lib/db-storage';
import { markTaskDurable } from '@/lib/task-registry';
import {
  createIdempotencyLockKey,
  IdempotencyConflictError,
  LEGACY_UNKNOWN_REQUEST_DIGEST,
} from '@/lib/task-core/idempotency';
import {
  canTransitionTaskStatus,
  isTerminalTaskStatus,
  normalizeDurableTaskStatus,
  type DurableTaskStatus,
  type TaskErrorInput,
} from '@/lib/task-core/task-state';
import { getAgentExecutionFence, type AgentExecutionFence } from '@/lib/agent-runtime/execution-fence';

interface AgentSqlFence {
  condition: string;
  params: unknown[];
  nextIndex: number;
}

function buildAgentSqlFence(
  taskExpression: string,
  startIndex: number,
  fence: AgentExecutionFence | undefined = getAgentExecutionFence(),
): AgentSqlFence {
  let nextIndex = startIndex;
  const params: unknown[] = [];
  if (!fence) {
    return {
      condition: `AND NOT EXISTS (
        SELECT 1 FROM wujie_agent_execution_leases bound_agent
        WHERE bound_agent.task_id = ${taskExpression}
          AND bound_agent.completed_at = 0
          AND (bound_agent.paused_at = 0 OR bound_agent.paused_at > 0)
      )`,
      params,
      nextIndex,
    };
  }
  const activeGeneration = `AND (
        NOT EXISTS (
          SELECT 1 FROM wujie_agent_execution_leases bound_agent
          WHERE bound_agent.task_id = ${taskExpression}
            AND bound_agent.completed_at = 0
        )
        OR EXISTS (
          SELECT 1 FROM wujie_agent_execution_leases agent_lease
          WHERE agent_lease.task_id = ${taskExpression}
            AND agent_lease.task_id = $${nextIndex++}
            AND agent_lease.lease_owner = $${nextIndex++}
            AND agent_lease.generation = $${nextIndex++}
            AND agent_lease.paused_at = 0
            AND agent_lease.completed_at = 0
        )
      )`;
  params.push(fence.runId, fence.leaseOwner, fence.generation);
  return {
    condition: activeGeneration,
    params,
    nextIndex,
  };
}

export type CloudTaskStatus = 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type CloudTaskCreditStatus = 'pending' | 'charged' | 'refunded' | 'not-applicable';

export interface TaskTerminalIdentity {
  eventId: string;
  requestDigest: string;
  eventType: string;
}

export interface CloudTask {
  id: string;
  userId: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  type: string;
  status: CloudTaskStatus;
  providerId?: string;
  model?: string;
  remoteTaskId?: string;
  progress: number;
  label?: string;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus: CloudTaskCreditStatus;
  creditCost?: number;
  createdAt: number;
  updatedAt: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  attemptCount?: number;
  idempotencyKey?: string;
  requestDigest?: string;
  chargedTransactionId?: string;
  refundedTransactionId?: string;
  terminalEventId?: string;
  terminalEventDigest?: string;
  terminalEventType?: string;
  revision?: number;
}

export type PersistedCloudTaskStatus = DurableTaskStatus | 'pending';

export interface PersistedCloudTask extends Omit<CloudTask, 'status' | 'revision'> {
  status: PersistedCloudTaskStatus;
  revision: number;
}

export interface CloudTaskLease {
  taskId: string;
  owner: string;
  expiresAt: number;
  attemptCount: number;
}

export interface CreateCloudTaskInput extends Omit<CloudTask, 'label' | 'result' | 'error' | 'creditStatus' | 'creditCost'> {
  label?: string;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  creditCost?: number;
}

export interface UpdateCloudTaskInput {
  status?: CloudTaskStatus;
  progress?: number;
  label?: string;
  result?: Record<string, unknown>;
  mergeResult?: boolean;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  creditCost?: number;
  remoteTaskId?: string;
  expectedStatuses?: PersistedCloudTaskStatus[];
  leaseOwner?: string;
  expectedRevision?: number;
  agentExecutionFence?: AgentExecutionFence;
}

export interface TransitionCloudTaskStatusInput {
  taskId: string;
  from: DurableTaskStatus[];
  to: DurableTaskStatus;
  revision: number;
  result?: Record<string, unknown>;
  error?: TaskErrorInput;
  creditStatus?: CloudTaskCreditStatus;
  terminalIdentity?: TaskTerminalIdentity;
  agentExecutionFence?: AgentExecutionFence;
}

export interface TransitionCloudTaskStatusResult {
  transitioned: boolean;
  task: PersistedCloudTask | null;
}

export interface CloudTaskListFilters {
  userId?: string;
  projectId?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  model?: string;
  status?: CloudTaskStatus;
  limit?: number;
}

export interface CloudTaskProviderSummary {
  providerId: string;
  total: number;
  processing: number;
  failed: number;
  completed: number;
  lastUpdatedAt: number;
}

export interface CloudTaskCreditRefundResult {
  refunded: boolean;
  creditCost: number;
  balance?: number;
  userId?: string;
}

export interface CloudTaskCreditChargeResult {
  charged: boolean;
  creditCost: number;
  balance?: number;
  userId?: string;
}

export type CloudTaskFailureStatus = Extract<CloudTaskStatus, 'failed' | 'timeout' | 'cancelled'>;

export interface CloudTaskTerminationResult extends CloudTaskCreditRefundResult {
  status?: CloudTaskFailureStatus;
  transitioned: boolean;
}

export interface CloudTaskFallbackTransitionResult extends CloudTaskCreditRefundResult {
  transitioned: boolean;
}

export interface CreateBillableCloudTaskInput {
  userId: string;
  idempotencyKey: string;
  requestDigest: string;
  creditCost: number;
  task: Omit<CreateCloudTaskInput, 'status'> & {
    status: PersistedCloudTaskStatus;
  };
}

export interface CreateBillableCloudTaskResult {
  task: PersistedCloudTask;
  reused: boolean;
  charged: boolean;
}

export interface SettleFailedCloudTaskInput {
  taskId: string;
  status: CloudTaskFailureStatus;
  error: TaskErrorInput;
  result?: Record<string, unknown>;
  expectedRevision?: number;
  terminalIdentity?: TaskTerminalIdentity;
  leaseOwner?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  agentExecutionFence?: AgentExecutionFence;
  allowPausedAgentSettlement?: boolean;
}

export interface CompleteCloudTaskOptions {
  leaseOwner?: string;
  deadlineAt?: number;
  agentExecutionFence?: AgentExecutionFence;
}

export interface SettleFailedCloudTaskResult {
  task: PersistedCloudTask;
  transitioned: boolean;
  refunded: boolean;
}

let cloudTaskTablesInitialization: {
  databaseKey: string;
  promise: Promise<void>;
} | null = null;

const TERMINAL_STATUS_GUARD =
  "status NOT IN ('completed', 'failed', 'cancelled', 'timeout')";

export function ensureCloudTaskTables(): Promise<void> {
  const databaseKey = process.env.DATABASE_URL || process.env.PGDATABASE_URL || '';
  if (cloudTaskTablesInitialization?.databaseKey !== databaseKey) {
    const promise = initializeCloudTaskTables().catch((error) => {
      if (cloudTaskTablesInitialization?.promise === promise) {
        cloudTaskTablesInitialization = null;
      }
      throw error;
    });
    cloudTaskTablesInitialization = { databaseKey, promise };
    return promise;
  }
  return cloudTaskTablesInitialization.promise;
}

async function initializeCloudTaskTables(): Promise<void> {
  await execSql(`
    CREATE TABLE IF NOT EXISTS cloud_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT DEFAULT '',
      session_id TEXT DEFAULT '',
      message_id TEXT DEFAULT '',
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_id TEXT DEFAULT '',
      model TEXT DEFAULT '',
      remote_task_id TEXT DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0,
      label TEXT DEFAULT '',
      result JSONB DEFAULT '{}'::jsonb,
      error TEXT DEFAULT '',
      credit_status TEXT NOT NULL DEFAULT 'pending',
      credit_cost NUMERIC NOT NULL DEFAULT 0,
      lease_owner TEXT DEFAULT '',
      lease_expires_at BIGINT DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT DEFAULT '',
      request_digest TEXT DEFAULT '',
      charged_transaction_id TEXT DEFAULT '',
      refunded_transaction_id TEXT DEFAULT '',
      terminal_event_id TEXT NOT NULL DEFAULT '',
      terminal_event_digest TEXT NOT NULL DEFAULT '',
      terminal_event_type TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  // Existing installations created this table before chat-task recovery existed.
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS message_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS lease_owner TEXT DEFAULT ''");
  await execSql('ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS lease_expires_at BIGINT DEFAULT 0');
  await execSql('ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0');
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS idempotency_key TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS request_digest TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS charged_transaction_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS refunded_transaction_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS terminal_event_id TEXT NOT NULL DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS terminal_event_digest TEXT NOT NULL DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS terminal_event_type TEXT NOT NULL DEFAULT ''");
  await execSql('ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS credit_cost NUMERIC NOT NULL DEFAULT 0');
  await execSql('ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0');
  await execSql('ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS agent_execution_descriptor JSONB');
  await execSql(`
    CREATE TABLE IF NOT EXISTS wujie_agent_execution_leases (
      task_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at BIGINT NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      completed_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      paused_at BIGINT NOT NULL DEFAULT 0,
      next_step_id TEXT NOT NULL DEFAULT '',
      dispatch_started_at BIGINT NOT NULL DEFAULT 0,
      dispatch_lease_owner TEXT NOT NULL DEFAULT '',
      dispatch_lease_expires_at BIGINT NOT NULL DEFAULT 0,
      dispatch_attempt_count INTEGER NOT NULL DEFAULT 0,
      dispatch_error TEXT NOT NULL DEFAULT '',
      CONSTRAINT wujie_agent_execution_lease_identity_nonempty CHECK (
        task_id <> '' AND owner_id <> '' AND project_id <> '' AND tool_id <> ''
      )
    )
  `);
  await execSql(`
    CREATE INDEX IF NOT EXISTS idx_agent_execution_leases_owner_project
    ON wujie_agent_execution_leases(owner_id, project_id, task_id)
  `);
  await execSql('ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0');
  await execSql('ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS paused_at BIGINT NOT NULL DEFAULT 0');
  await execSql("ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS next_step_id TEXT NOT NULL DEFAULT ''");
  await execSql('ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS dispatch_started_at BIGINT NOT NULL DEFAULT 0');
  await execSql("ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS dispatch_lease_owner TEXT NOT NULL DEFAULT ''");
  await execSql('ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at BIGINT NOT NULL DEFAULT 0');
  await execSql('ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS dispatch_attempt_count INTEGER NOT NULL DEFAULT 0');
  await execSql("ALTER TABLE wujie_agent_execution_leases ADD COLUMN IF NOT EXISTS dispatch_error TEXT NOT NULL DEFAULT ''");
  await execSql("CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_tasks_user_idempotency ON cloud_tasks(user_id, idempotency_key) WHERE idempotency_key <> ''");
  await execSql("CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_tasks_charged_transaction ON cloud_tasks(charged_transaction_id) WHERE charged_transaction_id <> ''");
  await execSql("CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_tasks_refunded_transaction ON cloud_tasks(refunded_transaction_id) WHERE refunded_transaction_id <> ''");
  await execSql('CREATE INDEX IF NOT EXISTS idx_cloud_tasks_user_created ON cloud_tasks(user_id, created_at DESC)');
  await execSql('CREATE INDEX IF NOT EXISTS idx_cloud_tasks_status_updated ON cloud_tasks(status, updated_at DESC)');
  await execSql('CREATE INDEX IF NOT EXISTS idx_cloud_tasks_chat_recovery ON cloud_tasks(user_id, project_id, session_id, updated_at DESC)');
}

export async function createCloudTask(input: CreateCloudTaskInput): Promise<boolean> {
  await ensureCloudTaskTables();
  const result = await execSql(`
    INSERT INTO cloud_tasks (
      id, user_id, project_id, session_id, message_id, type, status, provider_id, model, remote_task_id,
      progress, label, result, error, credit_status, credit_cost, lease_owner, lease_expires_at,
      attempt_count, idempotency_key, request_digest, charged_transaction_id,
      refunded_transaction_id, revision, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26
    ) ON CONFLICT DO NOTHING
  `, [
    input.id,
    input.userId,
    input.projectId || '',
    input.sessionId || '',
    input.messageId || '',
    input.type,
    input.status,
    input.providerId || '',
    input.model || '',
    input.remoteTaskId || '',
    input.progress,
    input.label || '',
    JSON.stringify(input.result || {}),
    input.error || '',
    input.creditStatus || 'pending',
    input.creditCost || 0,
    input.leaseOwner || '',
    input.leaseExpiresAt || 0,
    input.attemptCount || 0,
    input.idempotencyKey || '',
    input.requestDigest || '',
    input.chargedTransactionId || '',
    input.refundedTransactionId || '',
    input.revision || 0,
    input.createdAt,
    input.updatedAt,
  ]);
  const created = (result.rowCount ?? 0) > 0;
  if (created) {
    markTaskDurable(input.id);
  }
  return created;
}

export async function createBillableCloudTask(
  input: CreateBillableCloudTaskInput,
): Promise<CreateBillableCloudTaskResult> {
  await ensureCoreTables();
  await ensureCloudTaskTables();

  const creditCost = normalizeBillableCreditCost(input.creditCost);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [createIdempotencyLockKey(input.userId, input.idempotencyKey)],
    );

    const existingResult = await client.query(
      `SELECT * FROM cloud_tasks
       WHERE user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.userId, input.idempotencyKey],
    );
    const existingRow = existingResult.rows[0] as
      | Record<string, unknown>
      | undefined;
    if (existingRow) {
      const existingDigest = getPersistedRequestDigest(existingRow);
      if (!existingDigest) {
        throw new IdempotencyConflictError({
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          existingDigest: LEGACY_UNKNOWN_REQUEST_DIGEST,
          requestDigest: input.requestDigest,
        });
      }
      if (existingDigest !== input.requestDigest) {
        throw new IdempotencyConflictError({
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          existingDigest,
          requestDigest: input.requestDigest,
        });
      }

      await client.query('COMMIT');
      return {
        task: rowToPersistedCloudTask(existingRow),
        reused: true,
        charged: false,
      };
    }

    const now = Date.now();
    const chargedTransactionId = creditCost > 0
      ? createTaskBillingTransactionId('charge', input.task.id)
      : '';
    let balanceAfter = 0;

    if (creditCost > 0) {
      await client.query(
        `INSERT INTO wujie_credits (
          id, user_id, balance, total_recharged, total_used, created_at, updated_at
        ) VALUES ($1, $2, 0, 0, 0, $3, $3)
        ON CONFLICT (user_id) DO NOTHING`,
        [`credits_${input.userId}`, input.userId, now],
      );
      const lockedCredits = await client.query(
        'SELECT balance FROM wujie_credits WHERE user_id = $1 FOR UPDATE',
        [input.userId],
      );
      const currentBalance = Number(lockedCredits.rows[0]?.balance ?? 0);
      if (currentBalance < creditCost) {
        throw new InsufficientCreditsError(
          input.userId,
          creditCost,
          currentBalance,
        );
      }

      const deducted = await client.query(
        `UPDATE wujie_credits
         SET balance = balance - $1,
             total_used = total_used + $1,
             updated_at = $2
         WHERE user_id = $3
         RETURNING balance`,
        [creditCost, now, input.userId],
      );
      balanceAfter = Number(deducted.rows[0]?.balance ?? 0);
    }

    const task = input.task;
    const insertedTask = await client.query(
      `INSERT INTO cloud_tasks (
        id, user_id, project_id, session_id, message_id, type, status,
        provider_id, model, remote_task_id, progress, label, result, error,
        credit_status, credit_cost, lease_owner, lease_expires_at,
        attempt_count, idempotency_key, request_digest,
        charged_transaction_id, refunded_transaction_id, revision,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, '', $23, $24, $25
      )
      RETURNING *`,
      [
        task.id,
        input.userId,
        task.projectId || '',
        task.sessionId || '',
        task.messageId || '',
        task.type,
        task.status,
        task.providerId || '',
        task.model || '',
        task.remoteTaskId || '',
        task.progress,
        task.label || '',
        JSON.stringify(task.result || {}),
        task.error || '',
        creditCost > 0 ? 'pending' : 'not-applicable',
        creditCost,
        task.leaseOwner || '',
        task.leaseExpiresAt || 0,
        task.attemptCount || 0,
        input.idempotencyKey,
        input.requestDigest,
        chargedTransactionId,
        task.revision || 0,
        task.createdAt,
        task.updatedAt,
      ],
    );

    if (creditCost > 0) {
      await client.query(
        `INSERT INTO wujie_credit_transactions (
          id, user_id, type, amount, balance_after, description, model,
          task_id, reference_id, created_at
        ) VALUES ($1, $2, 'consume', $3, $4, $5, $6, $7, $7, $8)`,
        [
          chargedTransactionId,
          input.userId,
          -creditCost,
          balanceAfter,
          task.label || task.type,
          task.model || '',
          task.id,
          now,
        ],
      );
    }

    await client.query('COMMIT');
    return {
      task: rowToPersistedCloudTask(
        insertedTask.rows[0] as Record<string, unknown>,
      ),
      reused: false,
      charged: creditCost > 0,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function settleFailedCloudTask(
  input: SettleFailedCloudTaskInput,
): Promise<SettleFailedCloudTaskResult> {
  await ensureCoreTables();
  await ensureCloudTaskTables();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.lockTimeoutMs !== undefined) {
      const timeoutMs = Math.max(1, Math.min(60_000, Math.floor(input.lockTimeoutMs)));
      await client.query(
        "SELECT set_config('lock_timeout', $1, true)",
        [`${timeoutMs}ms`],
      );
    }
    if (input.statementTimeoutMs !== undefined) {
      const timeoutMs = Math.max(1, Math.min(60_000, Math.floor(input.statementTimeoutMs)));
      await client.query(
        "SELECT set_config('statement_timeout', $1, true)",
        [`${timeoutMs}ms`],
      );
    }
    const selected = await client.query(
      'SELECT * FROM cloud_tasks WHERE id = $1 FOR UPDATE',
      [input.taskId],
    );
    const row = selected.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Task not found: ${input.taskId}`);
    }

    const currentStatus = normalizeDurableTaskStatus(String(row.status));
    const agentFence = input.agentExecutionFence || getAgentExecutionFence();
    const controlFence = await client.query<{
      lease_owner: string; generation: number; paused_at: string | number; completed_at: string | number;
    }>(
      `SELECT lease_owner, generation, paused_at, completed_at
       FROM wujie_agent_execution_leases WHERE task_id = $1`,
      [input.taskId],
    );
    const control = controlFence.rows[0];
    const activeControl = Boolean(control && Number(control.completed_at) === 0);
    if (
      (!input.allowPausedAgentSettlement && activeControl && !agentFence)
      || (!input.allowPausedAgentSettlement && Number(control?.paused_at || 0) > 0)
      || (agentFence && (
        agentFence.runId !== input.taskId
        || !control
        || control.lease_owner !== agentFence.leaseOwner
        || Number(control.generation) !== agentFence.generation
        || Number(control.completed_at) !== 0
      ))
    ) {
      await client.query('COMMIT');
      return { task: rowToPersistedCloudTask(row), transitioned: false, refunded: false };
    }
    if (input.leaseOwner && String(row.lease_owner || '') !== input.leaseOwner) {
      await client.query('COMMIT');
      return {
        task: rowToPersistedCloudTask(row),
        transitioned: false,
        refunded: false,
      };
    }
    if (
      input.expectedRevision !== undefined
      && Number(row.revision || 0) !== input.expectedRevision
    ) {
      await client.query('COMMIT');
      return {
        task: rowToPersistedCloudTask(row),
        transitioned: false,
        refunded: false,
      };
    }
    if (!canTransitionTaskStatus(currentStatus, input.status)) {
      await client.query('COMMIT');
      return {
        task: rowToPersistedCloudTask(row),
        transitioned: false,
        refunded: false,
      };
    }

    const creditCost = Number(row.credit_cost || 0);
    const shouldRefund = row.credit_status === 'pending' && creditCost > 0;
    const refundedTransactionId = shouldRefund
      ? createTaskBillingTransactionId('refund', input.taskId)
      : '';

    if (shouldRefund) {
      const lockedCredits = await client.query(
        'SELECT balance FROM wujie_credits WHERE user_id = $1 FOR UPDATE',
        [row.user_id],
      );
      if (lockedCredits.rows.length === 0) {
        throw new Error(`Credit account not found for task: ${input.taskId}`);
      }
      const refunded = await client.query(
        `UPDATE wujie_credits
         SET balance = balance + $1,
             total_used = GREATEST(total_used - $1, 0),
             updated_at = $2
         WHERE user_id = $3
         RETURNING balance`,
        [creditCost, Date.now(), row.user_id],
      );
      const balanceAfter = Number(refunded.rows[0]?.balance ?? 0);
      await client.query(
        `INSERT INTO wujie_credit_transactions (
          id, user_id, type, amount, balance_after, description, model,
          task_id, reference_id, created_at
        ) VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $7, $8)`,
        [
          refundedTransactionId,
          row.user_id,
          creditCost,
          balanceAfter,
          input.error.message,
          row.model || '',
          input.taskId,
          Date.now(),
        ],
      );
    }

    const updated = await client.query(
      `UPDATE cloud_tasks
       SET status = $2,
           progress = 0,
           error = $3,
           result = COALESCE(result, '{}'::jsonb) || $10::jsonb,
           credit_status = CASE
             WHEN $4::boolean THEN 'refunded'
             WHEN credit_cost <= 0 THEN 'not-applicable'
             ELSE credit_status
           END,
            refunded_transaction_id = CASE
             WHEN $4::boolean THEN $5
             ELSE refunded_transaction_id
            END,
            terminal_event_id = CASE WHEN $7 <> '' THEN $7 ELSE terminal_event_id END,
            terminal_event_digest = CASE WHEN $7 <> '' THEN $8 ELSE terminal_event_digest END,
            terminal_event_type = CASE WHEN $7 <> '' THEN $9 ELSE terminal_event_type END,
            revision = revision + 1,
           updated_at = $6
       WHERE id = $1
       RETURNING *`,
      [
         input.taskId,
        input.status,
        input.error.message,
        shouldRefund,
        refundedTransactionId,
         Date.now(),
         input.terminalIdentity?.eventId || '',
         input.terminalIdentity?.requestDigest || '',
         input.terminalIdentity?.eventType || '',
         JSON.stringify({ ...(input.result || {}), taskError: input.error }),
       ],
    );
    await client.query('COMMIT');
    return {
      task: rowToPersistedCloudTask(
        updated.rows[0] as Record<string, unknown>,
      ),
      transitioned: true,
      refunded: shouldRefund,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCloudTask(taskId: string, input: UpdateCloudTaskInput): Promise<boolean> {
  await ensureCloudTaskTables();

  let expectedStatuses = input.expectedStatuses;
  let expectedRevision = input.expectedRevision;
  if (input.status !== undefined) {
    const current = await getCloudTaskById(taskId);
    if (!current) return false;

    const currentStatus = normalizeDurableTaskStatus(current.status);
    const targetStatus = normalizeDurableTaskStatus(input.status);
    const sourceStatuses = expectedStatuses?.length
      ? expectedStatuses
      : [current.status];
    const allowedSourceStatuses = sourceStatuses.filter((status) => {
      const normalizedStatus = normalizeDurableTaskStatus(status);
      return canTransitionTaskStatus(normalizedStatus, targetStatus)
        || (
          normalizedStatus === targetStatus
          && !isTerminalTaskStatus(targetStatus)
        );
    });
    if (
      expectedRevision !== undefined
      && expectedRevision !== current.revision
    ) {
      return false;
    }
    if (
      !allowedSourceStatuses.some((status) =>
        normalizeDurableTaskStatus(status) === currentStatus
      )
    ) {
      return false;
    }

    expectedStatuses = expandPersistedStatuses(allowedSourceStatuses);
    expectedRevision = current.revision;
  }

  const sets: string[] = ['updated_at = $2', 'revision = revision + 1'];
  const params: unknown[] = [taskId, Date.now()];
  let index = 3;

  if (input.status !== undefined) { sets.push(`status = $${index++}`); params.push(input.status); }
  if (input.progress !== undefined) { sets.push(`progress = $${index++}`); params.push(input.progress); }
  if (input.label !== undefined) { sets.push(`label = $${index++}`); params.push(input.label); }
  if (input.result !== undefined) {
    sets.push(input.mergeResult
      ? `result = COALESCE(result, '{}'::jsonb) || $${index++}::jsonb`
      : `result = $${index++}`);
    params.push(JSON.stringify(input.result));
  }
  if (input.error !== undefined) { sets.push(`error = $${index++}`); params.push(input.error); }
  if (input.creditStatus !== undefined) { sets.push(`credit_status = $${index++}`); params.push(input.creditStatus); }
  if (input.creditCost !== undefined) { sets.push(`credit_cost = $${index++}`); params.push(input.creditCost); }
  if (input.remoteTaskId !== undefined) { sets.push(`remote_task_id = $${index++}`); params.push(input.remoteTaskId); }

  const conditions = ['id = $1'];
  const agentFence = input.agentExecutionFence || getAgentExecutionFence();
  const hasBusinessFieldUpdate = input.progress !== undefined
    || input.result !== undefined
    || input.error !== undefined
    || input.creditStatus !== undefined
    || input.creditCost !== undefined
    || input.remoteTaskId !== undefined;
  if (input.status === undefined && hasBusinessFieldUpdate) {
    conditions.push(TERMINAL_STATUS_GUARD);
  }
  if (expectedStatuses?.length) {
    conditions.push(`status = ANY($${index++}::text[])`);
    params.push(expectedStatuses);
  }
  if (input.leaseOwner) {
    conditions.push(`lease_owner = $${index++}`);
    params.push(input.leaseOwner);
  }
  if (expectedRevision !== undefined) {
    conditions.push(`revision = $${index++}`);
    params.push(expectedRevision);
  }
  if (input.status !== undefined || hasBusinessFieldUpdate) {
    const executionFence = buildAgentSqlFence('$1', index, agentFence);
    conditions.push(executionFence.condition.replace(/^AND\s+/, ''));
    params.push(...executionFence.params);
    index = executionFence.nextIndex;
  }
  const result = await execSql(`UPDATE cloud_tasks SET ${sets.join(', ')}
    WHERE ${conditions.join(' AND ')}
    RETURNING id
  `, params);
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function transitionCloudTaskStatus(
  input: TransitionCloudTaskStatusInput,
): Promise<TransitionCloudTaskStatusResult> {
  await ensureCloudTaskTables();

  const allowedFrom = input.from.filter((status) =>
    canTransitionTaskStatus(status, input.to)
  );
  const from = Array.from(new Set([
    ...allowedFrom,
    ...(allowedFrom.includes('submitting') ? ['pending' as const] : []),
  ]));
  if (from.length === 0) {
    return {
      transitioned: false,
      task: await getCloudTaskById(input.taskId),
    };
  }
  const sets = [
    'status = $4',
    `progress = CASE
      WHEN $4 = 'completed' THEN 100
      WHEN $4 IN ('failed', 'cancelled', 'timeout') THEN 0
      ELSE progress
    END`,
    'updated_at = $5',
    'revision = revision + 1',
  ];
  const params: unknown[] = [
    input.taskId,
    from,
    input.revision,
    input.to,
    Date.now(),
  ];
  let index = 6;

  if (input.result !== undefined) {
    sets.push(`result = $${index++}`);
    params.push(JSON.stringify(input.result));
  }
  if (input.error !== undefined) {
    sets.push(`error = $${index++}`);
    params.push(input.error.message);
  } else if (input.to === 'completed') {
    sets.push("error = ''");
  }
  if (input.creditStatus !== undefined) {
    sets.push(`credit_status = $${index++}`);
    params.push(input.creditStatus);
  }
  if (input.terminalIdentity !== undefined) {
    sets.push(`terminal_event_id = $${index++}`);
    params.push(input.terminalIdentity.eventId);
    sets.push(`terminal_event_digest = $${index++}`);
    params.push(input.terminalIdentity.requestDigest);
    sets.push(`terminal_event_type = $${index++}`);
    params.push(input.terminalIdentity.eventType);
  }

  const agentFence = input.agentExecutionFence || getAgentExecutionFence();
  const executionFence = buildAgentSqlFence('$1', index, agentFence);
  params.push(...executionFence.params);
  index = executionFence.nextIndex;

  const result = await execSql(`
    UPDATE cloud_tasks
    SET ${sets.join(', ')}
    WHERE id = $1
      AND status = ANY($2::text[])
      AND revision = $3
      ${executionFence.condition}
    RETURNING *
  `, params);
  if (result.rows.length > 0) {
    return {
      transitioned: true,
      task: rowToPersistedCloudTask(result.rows[0]),
    };
  }

  return {
    transitioned: false,
    task: await getCloudTaskById(input.taskId),
  };
}

/**
 * Commits a successful result only while the persisted task is processing.
 * A cancellation, timeout, or failure that wins first is therefore terminal.
 */
export async function completeCloudTask(
  taskId: string,
  result: Record<string, unknown>,
  leaseOwnerOrOptions?: string | CompleteCloudTaskOptions,
): Promise<boolean> {
  await ensureCloudTaskTables();
  const options = typeof leaseOwnerOrOptions === 'string'
    ? { leaseOwner: leaseOwnerOrOptions }
    : leaseOwnerOrOptions ?? {};
  const agentFence = options.agentExecutionFence || getAgentExecutionFence();
  const executionFence = buildAgentSqlFence('$1', 6, agentFence);
  const completed = await execSql(`
    UPDATE cloud_tasks
    SET status = 'completed',
        progress = 100,
        result = COALESCE(result, '{}'::jsonb) || $2::jsonb,
        error = '',
        credit_status = CASE
          WHEN credit_status = 'pending' THEN 'charged'
          ELSE credit_status
        END,
        updated_at = $3
    WHERE id = $1 AND status = 'processing'
      AND ($4::text IS NULL OR lease_owner = $4)
      AND (
        $5::bigint IS NULL
        OR (
          (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint <= $5
          AND lease_expires_at >= (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
        )
      )
      ${executionFence.condition}
    RETURNING id
  `, [
    taskId,
    JSON.stringify(result),
    Date.now(),
    options.leaseOwner || null,
    options.deadlineAt ?? null,
    ...executionFence.params,
  ]);
  return (completed.rowCount ?? completed.rows.length) > 0;
}

/**
 * Moves a live task to a failure terminal state and claims any refund in the
 * same database statement. Repeated or concurrent calls cannot claim twice.
 */
export async function terminateCloudTaskAndRefund(
  taskId: string,
  status: CloudTaskFailureStatus,
  reason: string,
  leaseOwner?: string,
): Promise<CloudTaskTerminationResult> {
  await ensureCloudTaskTables();
  const now = Date.now();
  const transactionId = `ctx_${now}_${Math.random().toString(36).slice(2, 10)}`;
  const agentFence = getAgentExecutionFence();
  const executionFence = buildAgentSqlFence('task.id', 7, agentFence);
  const result = await execSql(`
    WITH candidate AS (
      SELECT task.id,
             task.user_id,
             task.status AS previous_status,
             task.credit_status AS previous_credit_status,
             task.credit_cost
      FROM cloud_tasks task
      WHERE task.id = $1
        ${executionFence.condition}
        AND ($6::text IS NULL OR task.lease_owner = $6)
        AND (
          task.status IN ('pending', 'processing')
          OR task.status IN ('failed', 'timeout', 'cancelled')
        )
      FOR UPDATE
    ), locked_credit AS (
      SELECT credit.user_id
      FROM wujie_credits credit
      JOIN candidate ON credit.user_id = candidate.user_id
      WHERE candidate.previous_credit_status = 'pending'
        AND candidate.credit_cost > 0
      FOR UPDATE OF credit
    ), settled_task AS (
      UPDATE cloud_tasks task
      SET status = CASE
            WHEN candidate.previous_status IN ('pending', 'processing') THEN $2
            ELSE candidate.previous_status
          END,
          error = CASE
            WHEN candidate.previous_status IN ('pending', 'processing') THEN $3
            ELSE task.error
          END,
          credit_status = CASE
            WHEN candidate.previous_credit_status = 'pending'
              AND candidate.credit_cost > 0
              AND EXISTS (
                SELECT 1
                FROM locked_credit credit
                WHERE credit.user_id = candidate.user_id
              )
            THEN 'refunded'
            ELSE candidate.previous_credit_status
          END,
          refunded_transaction_id = CASE
            WHEN candidate.previous_credit_status = 'pending'
              AND candidate.credit_cost > 0
              AND EXISTS (
                SELECT 1
                FROM locked_credit credit
                WHERE credit.user_id = candidate.user_id
              )
            THEN $5
            ELSE task.refunded_transaction_id
          END,
          updated_at = $4
      FROM candidate
      WHERE task.id = candidate.id
      RETURNING task.id,
                task.user_id,
                task.status,
                task.credit_status,
                task.credit_cost,
                candidate.previous_status IN ('pending', 'processing') AS transitioned,
                candidate.previous_credit_status = 'pending'
                  AND task.credit_status = 'refunded' AS refund_claimed
    ), refunded_balance AS (
      UPDATE wujie_credits credit
      SET balance = credit.balance + settled.credit_cost,
          total_used = GREATEST(credit.total_used - settled.credit_cost, 0),
          updated_at = $4
      FROM settled_task settled
      WHERE settled.refund_claimed
        AND credit.user_id = settled.user_id
      RETURNING settled.id AS task_id, settled.user_id, settled.credit_cost, credit.balance
    ), recorded_refund AS (
      INSERT INTO wujie_credit_transactions (
        id, user_id, amount, type, balance_after, description, task_id, reference_id, created_at
      )
      SELECT $5, user_id, credit_cost, 'refund', balance, $3, task_id, task_id, $4
      FROM refunded_balance
      RETURNING reference_id
    )
    SELECT settled.status,
           settled.user_id,
           settled.credit_cost,
           settled.transitioned,
           EXISTS (
             SELECT 1 FROM refunded_balance refunded WHERE refunded.task_id = settled.id
           ) AS refunded,
           (
             SELECT refunded.balance
             FROM refunded_balance refunded
             WHERE refunded.task_id = settled.id
           ) AS balance
    FROM settled_task settled
    LIMIT 1
  `, [
    taskId, status, reason, now, transactionId, leaseOwner || null,
    ...executionFence.params,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { status: undefined, transitioned: false, refunded: false, creditCost: 0 };
  }
  return {
    status: row.status as CloudTaskFailureStatus,
    transitioned: row.transitioned === true,
    refunded: row.refunded === true,
    creditCost: Number(row.credit_cost || 0),
    balance: row.balance === null || row.balance === undefined
      ? undefined
      : Number(row.balance),
    userId: String(row.user_id || '') || undefined,
  };
}

/**
 * Settles a task refund exactly once. The task state, credit balance, and
 * transaction record are updated in one database statement guarded by the
 * task's pending credit status.
 */
export async function refundCloudTaskCredits(
  taskId: string,
  reason: string,
  options: { leaseOwner?: string } = {},
): Promise<CloudTaskCreditRefundResult> {
  await ensureCloudTaskTables();
  const now = Date.now();
  const transactionId = `ctx_${now}_${Math.random().toString(36).slice(2, 10)}`;
  const agentFence = buildAgentSqlFence('task.id', 6);
  const result = await execSql(`
    WITH refundable AS (
      SELECT task.id, task.user_id, task.credit_cost
      FROM cloud_tasks task
      JOIN wujie_credits credit ON credit.user_id = task.user_id
      WHERE task.id = $1
        AND task.credit_status = 'pending'
        AND task.credit_cost > 0
        ${agentFence.condition}
        AND ($5::text IS NULL OR (
          task.status = 'processing'
          AND task.lease_owner = $5
        ))
      FOR UPDATE OF task, credit
    ), refunded_balance AS (
      UPDATE wujie_credits credit
      SET balance = credit.balance + refundable.credit_cost,
          total_used = GREATEST(credit.total_used - refundable.credit_cost, 0),
          updated_at = $2
      FROM refundable
      WHERE credit.user_id = refundable.user_id
      RETURNING refundable.id AS task_id, refundable.user_id, refundable.credit_cost, credit.balance
    ), settled_task AS (
      UPDATE cloud_tasks task
      SET credit_status = 'refunded',
          refunded_transaction_id = $3,
          updated_at = $2
      FROM refunded_balance
      WHERE task.id = refunded_balance.task_id
      RETURNING refunded_balance.task_id, refunded_balance.user_id, refunded_balance.credit_cost, refunded_balance.balance
    ), recorded_refund AS (
      INSERT INTO wujie_credit_transactions (
        id, user_id, amount, type, balance_after, description, task_id, reference_id, created_at
      )
      SELECT $3, user_id, credit_cost, 'refund', balance, $4, task_id, task_id, $2
      FROM settled_task
      RETURNING user_id
    )
    SELECT user_id, credit_cost, balance FROM settled_task
  `, [taskId, now, transactionId, reason, options.leaseOwner || null,
    ...agentFence.params]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { refunded: false, creditCost: 0 };
  return {
    refunded: true,
    creditCost: Number(row.credit_cost || 0),
    balance: Number(row.balance || 0),
    userId: String(row.user_id || '') || undefined,
  };
}

/**
 * Atomically leaves the Pear path, claims its refund, and persists the local
 * fallback phase. A replacement worker can therefore never resume Pear after
 * the refund has committed.
 */
export async function transitionCloudTaskToLocalFallbackAndRefund(
  taskId: string,
  result: Record<string, unknown>,
  reason: string,
  leaseOwner: string,
): Promise<CloudTaskFallbackTransitionResult> {
  await ensureCloudTaskTables();
  const now = Date.now();
  const transactionId = `ctx_${now}_${Math.random().toString(36).slice(2, 10)}`;
  const agentFence = buildAgentSqlFence('task.id', 7);
  const transition = await execSql(`
    WITH candidate AS (
      SELECT task.id,
             task.user_id,
             task.credit_status AS previous_credit_status,
             task.credit_cost
      FROM cloud_tasks task
      WHERE task.id = $1
        AND task.status = 'processing'
        AND task.lease_owner = $6
        ${agentFence.condition}
      FOR UPDATE
    ), locked_credit AS (
      SELECT credit.user_id
      FROM wujie_credits credit
      JOIN candidate ON credit.user_id = candidate.user_id
      WHERE candidate.previous_credit_status = 'pending'
        AND candidate.credit_cost > 0
      FOR UPDATE OF credit
    ), settled_task AS (
      UPDATE cloud_tasks task
      SET result = $2,
          progress = 65,
          credit_status = CASE
            WHEN candidate.previous_credit_status = 'pending'
              AND candidate.credit_cost > 0
            THEN 'refunded'
            ELSE candidate.previous_credit_status
          END,
          refunded_transaction_id = CASE
            WHEN candidate.previous_credit_status = 'pending'
              AND candidate.credit_cost > 0
            THEN $4
            ELSE task.refunded_transaction_id
          END,
          updated_at = $3
      FROM candidate
      WHERE task.id = candidate.id
        AND (
          candidate.previous_credit_status <> 'pending'
          OR candidate.credit_cost <= 0
          OR EXISTS (
            SELECT 1
            FROM locked_credit credit
            WHERE credit.user_id = candidate.user_id
          )
        )
      RETURNING task.id,
                task.user_id,
                task.credit_cost,
                candidate.previous_credit_status = 'pending'
                  AND candidate.credit_cost > 0 AS refund_claimed
    ), refunded_balance AS (
      UPDATE wujie_credits credit
      SET balance = credit.balance + settled.credit_cost,
          total_used = GREATEST(credit.total_used - settled.credit_cost, 0),
          updated_at = $3
      FROM settled_task settled
      WHERE settled.refund_claimed
        AND credit.user_id = settled.user_id
      RETURNING settled.id AS task_id,
                settled.user_id,
                settled.credit_cost,
                credit.balance
    ), recorded_refund AS (
      INSERT INTO wujie_credit_transactions (
        id, user_id, amount, type, balance_after, description, task_id, reference_id, created_at
      )
      SELECT $4, user_id, credit_cost, 'refund', balance, $5, task_id, task_id, $3
      FROM refunded_balance
      RETURNING reference_id
    )
    SELECT TRUE AS transitioned,
           settled.user_id,
           settled.credit_cost,
           EXISTS (
             SELECT 1
             FROM refunded_balance refunded
             WHERE refunded.task_id = settled.id
           ) AS refunded,
           (
             SELECT refunded.balance
             FROM refunded_balance refunded
             WHERE refunded.task_id = settled.id
           ) AS balance
    FROM settled_task settled
    LIMIT 1
  `, [
    taskId,
    JSON.stringify(result),
    now,
    transactionId,
    reason,
    leaseOwner,
    ...agentFence.params,
  ]);
  const row = transition.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { transitioned: false, refunded: false, creditCost: 0 };
  }
  return {
    transitioned: row.transitioned === true,
    refunded: row.refunded === true,
    creditCost: Number(row.credit_cost || 0),
    balance: row.balance === null || row.balance === undefined
      ? undefined
      : Number(row.balance),
    userId: String(row.user_id || '') || undefined,
  };
}

/**
 * Charges a claimed idempotent task exactly once. The balance deduction,
 * task credit state, and transaction history are committed atomically.
 */
export async function chargeCloudTaskCredits(
  taskId: string,
  userId: string,
  creditCost: number,
  description: string,
  leaseOwner?: string,
): Promise<CloudTaskCreditChargeResult> {
  await ensureCloudTaskTables();
  const normalizedCost = Math.max(0, Math.ceil(creditCost));
  if (normalizedCost === 0) {
    const updated = await updateCloudTask(taskId, {
      status: 'processing',
      creditStatus: 'not-applicable',
      creditCost: 0,
      expectedStatuses: ['pending'],
      ...(leaseOwner ? { leaseOwner } : {}),
    });
    if (!updated) return { charged: false, creditCost: 0 };
    return { charged: true, creditCost: 0, userId };
  }

  const now = Date.now();
  const transactionId = `ctx_${now}_${Math.random().toString(36).slice(2, 10)}`;
  const agentFence = buildAgentSqlFence('task.id', 8);
  const result = await execSql(`
    WITH chargeable AS (
      SELECT task.id, task.user_id, $3::numeric AS credit_cost
      FROM cloud_tasks task
      WHERE task.id = $1
        AND task.user_id = $2
        AND task.status = 'pending'
        AND task.credit_status = 'not-applicable'
        AND ($7::text IS NULL OR task.lease_owner = $7)
        ${agentFence.condition}
      FOR UPDATE
    ), deducted AS (
      UPDATE wujie_credits credit
      SET balance = credit.balance - chargeable.credit_cost,
          total_used = credit.total_used + chargeable.credit_cost,
          updated_at = $4
      FROM chargeable
      WHERE credit.user_id = chargeable.user_id
        AND credit.balance >= chargeable.credit_cost
      RETURNING chargeable.id AS task_id, chargeable.user_id,
        chargeable.credit_cost, credit.balance
    ), marked_task AS (
      UPDATE cloud_tasks task
      SET status = 'processing',
          credit_status = 'pending',
          credit_cost = deducted.credit_cost,
          charged_transaction_id = $5,
          updated_at = $4
      FROM deducted
      WHERE task.id = deducted.task_id
      RETURNING task.id AS task_id, deducted.user_id,
        deducted.credit_cost, deducted.balance
    ), recorded_charge AS (
      INSERT INTO wujie_credit_transactions (
        id, user_id, amount, type, balance_after, description, task_id, reference_id, created_at
      )
      SELECT $5, user_id, -credit_cost, 'consume', balance, $6, task_id, task_id, $4
      FROM marked_task
      RETURNING user_id
    )
    SELECT user_id, credit_cost, balance FROM marked_task
  `, [
    taskId,
    userId,
    normalizedCost,
    now,
    transactionId,
    description,
    leaseOwner || null,
    ...agentFence.params,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { charged: false, creditCost: normalizedCost };
  return {
    charged: true,
    creditCost: Number(row.credit_cost || normalizedCost),
    balance: Number(row.balance || 0),
    userId: String(row.user_id || '') || undefined,
  };
}

/** Atomically claim a recoverable task so only one application instance polls it. */
export async function claimCloudTaskLease(
  taskId: string,
  owner: string,
  ttlMs: number,
  now: number = Date.now(),
): Promise<CloudTaskLease | null> {
  await ensureCloudTaskTables();
  const expiresAt = now + Math.max(1_000, ttlMs);
  const agentFence = buildAgentSqlFence('$1', 5);
  const result = await execSql(`
    UPDATE cloud_tasks
    SET lease_owner = $2,
        lease_expires_at = $3,
        attempt_count = attempt_count + 1,
        updated_at = $4
    WHERE id = $1
      AND status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')
      ${agentFence.condition}
      -- No same-owner bypass: an unexpired lease blocks everyone, including the
      -- current owner. Otherwise every poll re-claims and re-submits the task,
      -- billing the provider once per poll tick.
      AND (lease_expires_at = 0 OR lease_expires_at < $4)
    RETURNING id, lease_owner, lease_expires_at, attempt_count
  `, [taskId, owner, expiresAt, now, ...agentFence.params]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    taskId: String(row.id),
    owner: String(row.lease_owner),
    expiresAt: Number(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
  };
}

/** Extends a live lease only while the same worker still owns it. */
export async function renewCloudTaskLease(
  taskId: string,
  owner: string,
  ttlMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  await ensureCloudTaskTables();
  const agentFence = buildAgentSqlFence('$1', 5);
  const result = await execSql(`
    UPDATE cloud_tasks
    SET lease_expires_at = $3,
        updated_at = $4
    WHERE id = $1
      AND lease_owner = $2
      AND status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')
      ${agentFence.condition}
    RETURNING id
  `, [taskId, owner, now + Math.max(1_000, ttlMs), now, ...agentFence.params]);
  return (result.rowCount ?? result.rows.length) > 0;
}

/** Releases a lease only when it is still owned by the calling worker. */
export async function releaseCloudTaskLease(
  taskId: string,
  owner: string,
): Promise<boolean> {
  await ensureCloudTaskTables();
  const agentFence = buildAgentSqlFence('$1', 4);
  const result = await execSql(`
    UPDATE cloud_tasks
    SET lease_owner = '',
        lease_expires_at = 0,
        updated_at = $3
    WHERE id = $1
      AND lease_owner = $2
      ${agentFence.condition}
    RETURNING id
  `, [taskId, owner, Date.now(), ...agentFence.params]);
  return (result.rowCount ?? result.rows.length) > 0;
}

/**
 * Releases the current worker while keeping a short database-backed retry
 * barrier. This prevents every browser poll from immediately re-submitting a
 * provider request after a transient 429/5xx/transport failure.
 */
export async function deferCloudTaskRecovery(
  taskId: string,
  owner: string,
  delayMs: number,
  label: string,
  now: number = Date.now(),
): Promise<boolean> {
  await ensureCloudTaskTables();
  const retryAt = now + Math.max(1_000, delayMs);
  const agentFence = buildAgentSqlFence('$1', 6);
  const result = await execSql(`
    UPDATE cloud_tasks
    SET lease_owner = '',
        lease_expires_at = $3,
        updated_at = $4,
        label = $5
    WHERE id = $1
      AND lease_owner = $2
      AND status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')
      ${agentFence.condition}
    RETURNING id
  `, [taskId, owner, retryAt, now, label, ...agentFence.params]);
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function getCloudTaskForUser(taskId: string, userId: string): Promise<CloudTask | null> {
  await ensureCloudTaskTables();
  const result = await execSql('SELECT * FROM cloud_tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (result.rows.length === 0) return null;
  return rowToCloudTask(result.rows[0]);
}

export async function getCloudTaskById(taskId: string): Promise<PersistedCloudTask | null> {
  await ensureCloudTaskTables();
  const result = await execSql('SELECT * FROM cloud_tasks WHERE id = $1', [taskId]);
  return result.rows.length > 0 ? rowToPersistedCloudTask(result.rows[0]) : null;
}

export async function getCloudTaskForUserByIdempotencyKey(userId: string, idempotencyKey: string): Promise<CloudTask | null> {
  if (!idempotencyKey) return null;
  await ensureCloudTaskTables();
  const result = await execSql('SELECT * FROM cloud_tasks WHERE user_id = $1 AND idempotency_key = $2', [userId, idempotencyKey]);
  return result.rows.length > 0 ? rowToCloudTask(result.rows[0]) : null;
}

export interface PersistPrivateAgentExecutionDescriptorInput {
  taskId: string;
  userId: string;
  descriptor: Record<string, unknown>;
  descriptorDigest: string;
}

export interface PersistPrivateAgentExecutionDescriptorResult {
  persisted: boolean;
  reused: boolean;
}

export async function persistPrivateAgentExecutionDescriptor(
  input: PersistPrivateAgentExecutionDescriptorInput,
): Promise<PersistPrivateAgentExecutionDescriptorResult> {
  await ensureCloudTaskTables();
  if (!/^[a-f0-9]{64}$/.test(input.descriptorDigest)) {
    throw new TypeError('descriptorDigest must be a SHA-256 digest');
  }
  const privateRecord = {
    descriptorDigest: input.descriptorDigest,
    descriptor: input.descriptor,
  };
  const serialized = JSON.stringify(privateRecord);
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
    throw new TypeError('Agent execution descriptor exceeds 64 KiB');
  }
  const result = await execSql(`
    WITH candidate AS (
      SELECT id, agent_execution_descriptor IS NULL AS inserted
      FROM cloud_tasks
      WHERE id = $1 AND user_id = $2 AND type = 'agent-edit'
        AND (
          agent_execution_descriptor IS NULL
          OR agent_execution_descriptor->>'descriptorDigest' = $3
        )
      FOR UPDATE
    ), persisted AS (
      UPDATE cloud_tasks task
      SET agent_execution_descriptor = CASE
            WHEN task.agent_execution_descriptor IS NULL THEN $4::jsonb
            ELSE task.agent_execution_descriptor
          END,
          updated_at = GREATEST(task.updated_at, $5)
      FROM candidate
      WHERE task.id = candidate.id
      RETURNING candidate.inserted
    )
    SELECT inserted FROM persisted
  `, [input.taskId, input.userId, input.descriptorDigest, serialized, Date.now()]);
  const row = result.rows[0] as { inserted?: boolean } | undefined;
  return {
    persisted: Boolean(row),
    reused: Boolean(row && !row.inserted),
  };
}

export async function getPrivateAgentExecutionDescriptor(
  taskId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  await ensureCloudTaskTables();
  const result = await execSql(
    `SELECT agent_execution_descriptor
     FROM cloud_tasks
     WHERE id = $1 AND user_id = $2 AND type = 'agent-edit'`,
    [taskId, userId],
  );
  const privateRecord = result.rows[0]?.agent_execution_descriptor as
    | { descriptor?: unknown }
    | undefined;
  if (!privateRecord || !privateRecord.descriptor || typeof privateRecord.descriptor !== 'object') {
    return null;
  }
  return privateRecord.descriptor as Record<string, unknown>;
}

export async function getLatestElementDecomposeParentForProject(
  userId: string,
  projectId: string,
): Promise<CloudTask | null> {
  await ensureCloudTaskTables();
  const result = await execSql(`
    SELECT * FROM cloud_tasks
    WHERE user_id = $1
      AND type = 'element-decompose-parent'
      AND (
        project_id = $2
        OR (
          (project_id IS NULL OR project_id = '')
          AND result->'request'->>'projectId' = $2
        )
      )
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT 1
  `, [userId, projectId]);
  return result.rows.length > 0 ? rowToCloudTask(result.rows[0]) : null;
}

export async function listCloudTasks(filters: CloudTaskListFilters = {}): Promise<CloudTask[]> {
  await ensureCloudTaskTables();
  const clauses: string[] = [];
  const params: unknown[] = [];
  const addFilter = (column: string, value: string | undefined) => {
    if (!value) return;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  };

  addFilter('user_id', filters.userId);
  addFilter('project_id', filters.projectId);
  addFilter('session_id', filters.sessionId);
  addFilter('message_id', filters.messageId);
  addFilter('provider_id', filters.providerId);
  addFilter('model', filters.model);
  if (filters.status) {
    const persistedStatuses = legacyFilterStatuses(filters.status);
    if (persistedStatuses.length === 1) {
      addFilter('status', persistedStatuses[0]);
    } else {
      params.push(persistedStatuses);
      clauses.push(`status = ANY($${params.length}::text[])`);
    }
  }
  params.push(Math.min(Math.max(filters.limit || 100, 1), 500));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execSql(`SELECT * FROM cloud_tasks ${where} ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT $${params.length}`, params);
  return result.rows.map(rowToCloudTask);
}

export async function getCloudTaskProviderSummary(): Promise<CloudTaskProviderSummary[]> {
  await ensureCloudTaskTables();
  const result = await execSql(`
    SELECT
      provider_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE status IN ('created', 'queued', 'submitting', 'pending', 'processing', 'uploading')
      )::int AS processing,
      COUNT(*) FILTER (WHERE status IN ('failed', 'timeout', 'cancelled'))::int AS failed,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
      MAX(updated_at) AS last_updated_at
    FROM cloud_tasks
    WHERE provider_id <> ''
    GROUP BY provider_id
    ORDER BY last_updated_at DESC
  `);
  return result.rows.map(row => ({
    providerId: String(row.provider_id),
    total: Number(row.total || 0),
    processing: Number(row.processing || 0),
    failed: Number(row.failed || 0),
    completed: Number(row.completed || 0),
    lastUpdatedAt: Number(row.last_updated_at || 0),
  }));
}

function rowToCloudTask(row: Record<string, unknown>): CloudTask {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id || '') || undefined,
    sessionId: String(row.session_id || '') || undefined,
    messageId: String(row.message_id || '') || undefined,
    type: String(row.type),
    status: projectPersistedStatusToLegacy(
      row.status as PersistedCloudTaskStatus,
    ),
    providerId: String(row.provider_id || '') || undefined,
    model: String(row.model || '') || undefined,
    remoteTaskId: String(row.remote_task_id || '') || undefined,
    progress: Number(row.progress || 0),
    label: String(row.label || '') || undefined,
    result: parseJsonObject(row.result),
    error: String(row.error || '') || undefined,
    creditStatus: (row.credit_status as CloudTaskCreditStatus) || 'pending',
    creditCost: Number(row.credit_cost || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    leaseOwner: String(row.lease_owner || '') || undefined,
    leaseExpiresAt: Number(row.lease_expires_at || 0) || undefined,
    attemptCount: Number(row.attempt_count || 0) || undefined,
    idempotencyKey: String(row.idempotency_key || '') || undefined,
    requestDigest: String(row.request_digest || '') || undefined,
    chargedTransactionId:
      String(row.charged_transaction_id || '') || undefined,
    refundedTransactionId:
      String(row.refunded_transaction_id || '') || undefined,
    terminalEventId: String(row.terminal_event_id || '') || undefined,
    terminalEventDigest: String(row.terminal_event_digest || '') || undefined,
    terminalEventType: String(row.terminal_event_type || '') || undefined,
    revision: Number(row.revision || 0),
  };
}

function rowToPersistedCloudTask(
  row: Record<string, unknown>,
): PersistedCloudTask {
  return {
    ...rowToCloudTask(row),
    status: row.status as PersistedCloudTaskStatus,
    revision: Number(row.revision || 0),
  };
}

function projectPersistedStatusToLegacy(
  status: PersistedCloudTaskStatus,
): CloudTaskStatus {
  switch (status) {
    case 'created':
    case 'queued':
      return 'queued';
    case 'submitting':
    case 'pending':
      return 'pending';
    case 'processing':
    case 'uploading':
      return 'processing';
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'timeout':
      return status;
  }
}

function legacyFilterStatuses(
  status: CloudTaskStatus,
): PersistedCloudTaskStatus[] {
  switch (status) {
    case 'queued':
      return ['created', 'queued'];
    case 'pending':
      return ['submitting', 'pending'];
    case 'processing':
      return ['processing', 'uploading'];
    default:
      return [status];
  }
}

function expandPersistedStatuses(
  statuses: PersistedCloudTaskStatus[],
): PersistedCloudTaskStatus[] {
  const expanded = statuses.flatMap((status) => {
    if (status === 'submitting' || status === 'pending') {
      return ['submitting', 'pending'] as const;
    }
    return [status];
  });
  return Array.from(new Set(expanded));
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function getPersistedRequestDigest(row: Record<string, unknown>): string {
  const explicitDigest = String(row.request_digest || '').trim();
  if (explicitDigest) return explicitDigest;
  const legacyResult = parseJsonObject(row.result);
  return typeof legacyResult?.requestHash === 'string'
    ? legacyResult.requestHash.trim()
    : '';
}

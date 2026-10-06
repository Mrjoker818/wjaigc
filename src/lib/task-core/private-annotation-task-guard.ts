import 'server-only';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db-client';
import { AnnotationSourceAdmissionError } from '@/lib/annotation-authorized-source';
import {
  completeCloudTask,
  getCloudTaskById,
  terminateCloudTaskAndRefund,
  type CloudTaskFailureStatus,
  type CloudTaskTerminationResult,
  type PersistedCloudTask,
} from '@/lib/cloud-task-storage';

export interface PrivateAnnotationTaskIdentity {
  taskId: string;
  actorUserId: string;
  projectId: string;
  requestDigest: string;
  creditCost: number;
}

/** A replay read failure is unavailable, never evidence that the original task failed. */
export async function readPrivateAnnotationTask(taskId: string): Promise<PersistedCloudTask | null> {
  try { return await getCloudTaskById(taskId); }
  catch { throw new AnnotationSourceAdmissionError(503); }
}

/** Only database work belongs in this transaction; source/provider I/O stays outside it. */
async function withPrivateAnnotationTaskGuard<T>(identity: PrivateAnnotationTaskIdentity,
  operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect().catch((): never => { throw new AnnotationSourceAdmissionError(503); });
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const task = await client.query<Record<string, unknown>>(`SELECT user_id, project_id, type,
      request_digest, credit_cost, credit_status, charged_transaction_id FROM cloud_tasks
      WHERE id=$1 FOR UPDATE`, [identity.taskId]);
    const row = task.rows[0];
    if (!row || row.user_id !== identity.actorUserId || row.project_id !== identity.projectId
      || row.type !== 'edit' || !identity.requestDigest || row.request_digest !== identity.requestDigest
      || !Number.isFinite(identity.creditCost) || identity.creditCost < 0
      || Number(row.credit_cost) !== identity.creditCost) throw new AnnotationSourceAdmissionError(409);
    if (identity.creditCost > 0) {
      const charge = await client.query(`SELECT id FROM wujie_credit_transactions
        WHERE id=$1 AND type='consume' AND user_id=$2 AND amount=$3
          AND task_id=$4 AND reference_id=$4 FOR SHARE`,
      [row.charged_transaction_id, identity.actorUserId, -identity.creditCost, identity.taskId]);
      if (charge.rowCount !== 1 || !['pending', 'charged', 'refunded'].includes(String(row.credit_status))) {
        throw new AnnotationSourceAdmissionError(409);
      }
    } else {
      const charge = await client.query(`SELECT id FROM wujie_credit_transactions WHERE type='consume'
        AND (task_id=$1 OR reference_id=$1) FOR SHARE`, [identity.taskId]);
      if (row.credit_status !== 'not-applicable' || row.charged_transaction_id || charge.rowCount !== 0) {
        throw new AnnotationSourceAdmissionError(409);
      }
    }
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((): void => {});
    if (error instanceof AnnotationSourceAdmissionError) throw error;
    throw new AnnotationSourceAdmissionError(503);
  } finally { client.release(); }
}

export async function assertPrivateAnnotationTaskBilling(identity: PrivateAnnotationTaskIdentity): Promise<void> {
  await withPrivateAnnotationTaskGuard(identity, async (): Promise<void> => {});
}

/** Source context corruption can refund its proven payer; billing identity corruption cannot. */
export async function terminatePrivateAnnotationTask(identity: PrivateAnnotationTaskIdentity,
  status: CloudTaskFailureStatus, reason: string, leaseOwner?: string): Promise<CloudTaskTerminationResult> {
  return withPrivateAnnotationTaskGuard(identity, (client): Promise<CloudTaskTerminationResult> =>
    terminateCloudTaskAndRefund(identity.taskId, status, reason, leaseOwner, { client }));
}

export async function completePrivateAnnotationTask(identity: PrivateAnnotationTaskIdentity,
  result: Record<string, unknown>, leaseOwner: string, deadlineAt: number): Promise<boolean> {
  return withPrivateAnnotationTaskGuard(identity, (client): Promise<boolean> =>
    completeCloudTask(identity.taskId, result, { leaseOwner, deadlineAt, client }));
}

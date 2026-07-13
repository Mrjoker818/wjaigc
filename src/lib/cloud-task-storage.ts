import { execSql } from '@/lib/db-client';

export type CloudTaskStatus = 'queued' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
export type CloudTaskCreditStatus = 'pending' | 'charged' | 'refunded' | 'not-applicable';

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
  createdAt: number;
  updatedAt: number;
}

export interface CreateCloudTaskInput extends Omit<CloudTask, 'label' | 'result' | 'error' | 'creditStatus'> {
  label?: string;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
}

export interface UpdateCloudTaskInput {
  status?: CloudTaskStatus;
  progress?: number;
  label?: string;
  result?: Record<string, unknown>;
  error?: string;
  creditStatus?: CloudTaskCreditStatus;
  remoteTaskId?: string;
  providerId?: string;
  model?: string;
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

let tablesEnsured = false;

export async function ensureCloudTaskTables(): Promise<void> {
  if (tablesEnsured) return;

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
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  // Existing installations created this table before chat-task recovery existed.
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS session_id TEXT DEFAULT ''");
  await execSql("ALTER TABLE cloud_tasks ADD COLUMN IF NOT EXISTS message_id TEXT DEFAULT ''");
  await execSql('CREATE INDEX IF NOT EXISTS idx_cloud_tasks_user_created ON cloud_tasks(user_id, created_at DESC)');
  await execSql('CREATE INDEX IF NOT EXISTS idx_cloud_tasks_status_updated ON cloud_tasks(status, updated_at DESC)');
  await execSql('CREATE INDEX IF NOT EXISTS idx_cloud_tasks_chat_recovery ON cloud_tasks(user_id, project_id, session_id, updated_at DESC)');
  tablesEnsured = true;
}

export async function createCloudTask(input: CreateCloudTaskInput): Promise<void> {
  await ensureCloudTaskTables();
  await execSql(`
    INSERT INTO cloud_tasks (
      id, user_id, project_id, session_id, message_id, type, status, provider_id, model, remote_task_id,
      progress, label, result, error, credit_status, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17
    ) ON CONFLICT (id) DO NOTHING
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
    input.createdAt,
    input.updatedAt,
  ]);
}

export async function updateCloudTask(taskId: string, input: UpdateCloudTaskInput): Promise<void> {
  await ensureCloudTaskTables();

  const sets: string[] = ['updated_at = $2'];
  const params: unknown[] = [taskId, Date.now()];
  let index = 3;

  if (input.status !== undefined) { sets.push(`status = $${index++}`); params.push(input.status); }
  if (input.progress !== undefined) { sets.push(`progress = $${index++}`); params.push(input.progress); }
  if (input.label !== undefined) { sets.push(`label = $${index++}`); params.push(input.label); }
  if (input.result !== undefined) { sets.push(`result = $${index++}`); params.push(JSON.stringify(input.result)); }
  if (input.error !== undefined) { sets.push(`error = $${index++}`); params.push(input.error); }
  if (input.creditStatus !== undefined) { sets.push(`credit_status = $${index++}`); params.push(input.creditStatus); }
  if (input.remoteTaskId !== undefined) { sets.push(`remote_task_id = $${index++}`); params.push(input.remoteTaskId); }
  if (input.providerId !== undefined) { sets.push(`provider_id = $${index++}`); params.push(input.providerId); }
  if (input.model !== undefined) { sets.push(`model = $${index++}`); params.push(input.model); }

  await execSql(`UPDATE cloud_tasks SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function getCloudTaskForUser(taskId: string, userId: string): Promise<CloudTask | null> {
  await ensureCloudTaskTables();
  const result = await execSql('SELECT * FROM cloud_tasks WHERE id = $1 AND user_id = $2', [taskId, userId]);
  if (result.rows.length === 0) return null;
  return rowToCloudTask(result.rows[0]);
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
  addFilter('status', filters.status);
  params.push(Math.min(Math.max(filters.limit || 100, 1), 500));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await execSql(`SELECT * FROM cloud_tasks ${where} ORDER BY updated_at DESC LIMIT $${params.length}`, params);
  return result.rows.map(rowToCloudTask);
}

export async function getCloudTaskProviderSummary(): Promise<CloudTaskProviderSummary[]> {
  await ensureCloudTaskTables();
  const result = await execSql(`
    SELECT
      provider_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status IN ('queued', 'pending', 'processing'))::int AS processing,
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
    status: row.status as CloudTaskStatus,
    providerId: String(row.provider_id || '') || undefined,
    model: String(row.model || '') || undefined,
    remoteTaskId: String(row.remote_task_id || '') || undefined,
    progress: Number(row.progress || 0),
    label: String(row.label || '') || undefined,
    result: parseJsonObject(row.result),
    error: String(row.error || '') || undefined,
    creditStatus: (row.credit_status as CloudTaskCreditStatus) || 'pending',
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
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

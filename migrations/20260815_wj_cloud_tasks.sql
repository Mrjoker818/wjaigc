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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_tasks_user_idempotency
  ON cloud_tasks(user_id, idempotency_key) WHERE idempotency_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_tasks_charged_transaction
  ON cloud_tasks(charged_transaction_id) WHERE charged_transaction_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_tasks_refunded_transaction
  ON cloud_tasks(refunded_transaction_id) WHERE refunded_transaction_id <> '';

CREATE INDEX IF NOT EXISTS idx_cloud_tasks_user_created
  ON cloud_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cloud_tasks_status_updated
  ON cloud_tasks(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cloud_tasks_chat_recovery
  ON cloud_tasks(user_id, project_id, session_id, updated_at DESC);

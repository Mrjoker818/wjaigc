CREATE TABLE IF NOT EXISTS wujie_agent_downstream_operations (
  operation_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'completed')),
  response JSONB,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_expires_at BIGINT NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wujie_agent_downstream_task
  ON wujie_agent_downstream_operations(task_id, tool_id);

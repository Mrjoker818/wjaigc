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
  CONSTRAINT wujie_agent_execution_lease_identity_nonempty CHECK (
    task_id <> '' AND owner_id <> '' AND project_id <> '' AND tool_id <> ''
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_execution_leases_owner_project
  ON wujie_agent_execution_leases(owner_id, project_id, task_id);

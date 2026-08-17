ALTER TABLE wujie_agent_downstream_operations
  ADD COLUMN IF NOT EXISTS step_id TEXT NOT NULL DEFAULT 'root';

CREATE INDEX IF NOT EXISTS idx_wujie_agent_downstream_step
  ON wujie_agent_downstream_operations(task_id, step_id);

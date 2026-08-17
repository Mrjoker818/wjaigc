ALTER TABLE wujie_agent_downstream_operations
  DROP CONSTRAINT IF EXISTS wujie_agent_downstream_operations_status_check;

ALTER TABLE wujie_agent_downstream_operations
  ADD COLUMN IF NOT EXISTS provider_task_id TEXT,
  ADD COLUMN IF NOT EXISTS submission_error TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at BIGINT,
  ADD COLUMN IF NOT EXISTS accepted_at BIGINT,
  ADD COLUMN IF NOT EXISTS submission_unknown_at BIGINT;

ALTER TABLE wujie_agent_downstream_operations
  ADD CONSTRAINT wujie_agent_downstream_operations_status_check
  CHECK (status IN ('prepared', 'submitted', 'accepted', 'submission_unknown', 'completed'));

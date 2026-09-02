ALTER TABLE wujie_agent_execution_leases
  ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE wujie_agent_execution_leases
  ADD COLUMN IF NOT EXISTS paused_at BIGINT NOT NULL DEFAULT 0;

ALTER TABLE wujie_agent_execution_leases
  ADD COLUMN IF NOT EXISTS next_step_id TEXT NOT NULL DEFAULT '';

ALTER TABLE wujie_agent_execution_leases
  ADD COLUMN IF NOT EXISTS dispatch_started_at BIGINT NOT NULL DEFAULT 0;

ALTER TABLE wujie_agent_execution_leases
  DROP CONSTRAINT IF EXISTS wujie_agent_execution_generation_nonnegative;

ALTER TABLE wujie_agent_execution_leases
  ADD CONSTRAINT wujie_agent_execution_generation_nonnegative
  CHECK (generation >= 0);

ALTER TABLE wujie_agent_execution_leases
  ADD COLUMN IF NOT EXISTS dispatch_lease_owner TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_error TEXT NOT NULL DEFAULT '';

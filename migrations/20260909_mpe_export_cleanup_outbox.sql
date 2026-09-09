CREATE TABLE IF NOT EXISTS wujie_asset_cleanup_outbox (
  id UUID PRIMARY KEY,
  target_hash CHAR(64) NOT NULL UNIQUE,
  root_id TEXT NOT NULL,
  local_path TEXT,
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT wujie_asset_cleanup_outbox_root_check CHECK (root_id = 'server-data'),
  CONSTRAINT wujie_asset_cleanup_outbox_target_check CHECK (local_path IS NOT NULL OR storage_key IS NOT NULL),
  CONSTRAINT wujie_asset_cleanup_outbox_status_check CHECK (status IN ('pending', 'processing', 'completed'))
);

CREATE INDEX IF NOT EXISTS wujie_asset_cleanup_outbox_pending_idx
  ON wujie_asset_cleanup_outbox(next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

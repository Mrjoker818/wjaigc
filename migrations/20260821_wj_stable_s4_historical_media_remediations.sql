CREATE TABLE IF NOT EXISTS wujie_asset_media_remediations (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (action = 'archive-unrecoverable'),
  reason TEXT NOT NULL,
  before_state JSONB NOT NULL,
  result JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status = 'completed'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_asset_media_remediations_created
  ON wujie_asset_media_remediations(created_at DESC);

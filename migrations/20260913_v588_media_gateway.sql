CREATE TABLE IF NOT EXISTS wujie_gateway_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  requests_per_minute INTEGER NOT NULL CHECK (requests_per_minute BETWEEN 1 AND 600),
  daily_quota INTEGER NOT NULL CHECK (daily_quota BETWEEN 0 AND 100000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wujie_gateway_rate_windows (
  gateway_key_id TEXT NOT NULL REFERENCES wujie_gateway_keys(id),
  window_start TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  PRIMARY KEY (gateway_key_id, window_start)
);

CREATE TABLE IF NOT EXISTS wujie_gateway_requests (
  id TEXT PRIMARY KEY,
  gateway_key_id TEXT NOT NULL REFERENCES wujie_gateway_keys(id),
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  request_digest TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  admission_status TEXT NOT NULL CHECK (admission_status IN ('reserved', 'admitted', 'rejected')),
  task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway_key_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wujie_gateway_keys_user_id
  ON wujie_gateway_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_wujie_gateway_keys_created_at
  ON wujie_gateway_keys (created_at);
CREATE INDEX IF NOT EXISTS idx_wujie_gateway_requests_user_id
  ON wujie_gateway_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_wujie_gateway_requests_created_at
  ON wujie_gateway_requests (created_at);
CREATE INDEX IF NOT EXISTS idx_wujie_gateway_requests_admission_status
  ON wujie_gateway_requests (admission_status);

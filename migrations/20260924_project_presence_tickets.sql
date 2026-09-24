CREATE TABLE IF NOT EXISTS wujie_presence_tickets (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id TEXT NOT NULL REFERENCES wujie_users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES wujie_projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS wujie_presence_tickets_expiry_idx
  ON wujie_presence_tickets (expires_at)
  WHERE consumed_at IS NULL;

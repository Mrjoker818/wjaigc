CREATE TABLE IF NOT EXISTS wujie_presence_project_sequences (
  project_id TEXT PRIMARY KEY REFERENCES wujie_projects(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);

CREATE TABLE IF NOT EXISTS wujie_presence_leases (
  connection_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES wujie_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES wujie_users(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS wujie_presence_leases_project_expiry_idx
  ON wujie_presence_leases (project_id, expires_at);

CREATE INDEX IF NOT EXISTS wujie_presence_leases_expiry_idx
  ON wujie_presence_leases (expires_at);

CREATE INDEX IF NOT EXISTS wujie_presence_tickets_all_expiry_idx
  ON wujie_presence_tickets (expires_at);

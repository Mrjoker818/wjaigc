CREATE TABLE IF NOT EXISTS wujie_document_tickets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wujie_users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  document_kind TEXT NOT NULL DEFAULT 'canvas' CHECK (document_kind = 'canvas'),
  purpose TEXT NOT NULL DEFAULT 'edit' CHECK (purpose = 'edit'),
  grant_generation BIGINT NOT NULL CHECK (grant_generation >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS wujie_document_tickets_expiry_idx
  ON wujie_document_tickets (expires_at);

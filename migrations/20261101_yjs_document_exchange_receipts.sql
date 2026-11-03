-- Isolated candidate: transport identity/confirmation only. No parallel document,
-- task, asset or billing state. Not applied to any database in this work unit.
CREATE TABLE wujie_document_exchange_sessions (
  session_hash TEXT PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  actor_id TEXT NOT NULL REFERENCES wujie_users(id) ON DELETE CASCADE,
  auth_session_hash TEXT NOT NULL CHECK (auth_session_hash ~ '^[0-9a-f]{64}$'),
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  grant_generation BIGINT NOT NULL CHECK (grant_generation >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  retain_until TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  UNIQUE (session_hash, actor_id, project_id, owner_id, grant_generation),
  FOREIGN KEY (project_id, owner_id) REFERENCES wujie_project_canvas_documents(project_id, owner_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (retain_until >= expires_at AND retain_until <= created_at + interval '604800 seconds'),
  CHECK ((actor_id=owner_id AND grant_generation=0) OR (actor_id<>owner_id AND grant_generation>0))
);

CREATE INDEX wujie_document_exchange_sessions_scope_idx
  ON wujie_document_exchange_sessions(actor_id, project_id, expires_at);

CREATE TABLE wujie_document_update_receipts (
  session_hash TEXT NOT NULL,
  operation_id TEXT NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  actor_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  grant_generation BIGINT NOT NULL CHECK (grant_generation >= 0),
  update_digest TEXT NOT NULL CHECK (update_digest ~ '^[0-9a-f]{64}$'),
  document_sequence BIGINT NOT NULL CHECK (document_sequence >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(session_hash, operation_id),
  FOREIGN KEY(session_hash, actor_id, project_id, owner_id, grant_generation)
    REFERENCES wujie_document_exchange_sessions(session_hash, actor_id, project_id, owner_id, grant_generation) ON DELETE CASCADE,
  FOREIGN KEY(project_id, owner_id)
    REFERENCES wujie_project_canvas_documents(project_id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wujie_project_canvas_documents (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  sequence BIGINT NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  snapshot_sequence BIGINT NOT NULL DEFAULT 0 CHECK (snapshot_sequence >= 0),
  snapshot_bytes BYTEA NOT NULL DEFAULT decode('', 'hex'),
  projection JSONB NOT NULL DEFAULT '{"placements":{}}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, owner_id),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id) ON DELETE CASCADE,
  CHECK (snapshot_sequence <= sequence),
  CHECK (jsonb_typeof(projection) = 'object')
);

CREATE TABLE IF NOT EXISTS wujie_project_canvas_updates (
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  update_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sequence),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_project_canvas_documents(project_id, owner_id) ON DELETE CASCADE,
  CHECK (octet_length(update_bytes) > 0)
);

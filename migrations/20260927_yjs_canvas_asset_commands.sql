CREATE TABLE IF NOT EXISTS wujie_canvas_asset_commands (
  actor_id TEXT NOT NULL REFERENCES wujie_users(id),
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  owner_id TEXT NOT NULL,
  placement_id TEXT NOT NULL REFERENCES wujie_workspace_placements(id),
  asset_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  document_sequence BIGINT NOT NULL CHECK (document_sequence >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, project_id, idempotency_key),
  FOREIGN KEY (project_id, owner_id) REFERENCES wujie_project_canvas_documents(project_id, owner_id),
  FOREIGN KEY (asset_version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
);

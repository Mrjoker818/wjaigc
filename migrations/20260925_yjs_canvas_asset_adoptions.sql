-- Cross-owner collaboration lineage is intentionally separate from the
-- same-owner/project wujie_asset_version_parents graph.
CREATE TABLE IF NOT EXISTS wujie_canvas_asset_adoptions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES wujie_users(id),
  target_owner_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES cloud_tasks(id),
  source_owner_id TEXT NOT NULL,
  source_project_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  target_version_id TEXT NOT NULL,
  placement_id TEXT NOT NULL UNIQUE REFERENCES wujie_workspace_placements(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source_owner_id = actor_id),
  UNIQUE (actor_id, target_project_id, task_id, source_version_id),
  UNIQUE (actor_id, target_project_id, idempotency_key),
  UNIQUE (target_version_id),
  FOREIGN KEY (target_project_id, target_owner_id)
    REFERENCES wujie_projects(id, owner_id),
  FOREIGN KEY (source_version_id, source_owner_id, source_project_id)
    REFERENCES wujie_asset_versions(id, owner_id, project_id),
  FOREIGN KEY (target_version_id, target_owner_id, target_project_id)
    REFERENCES wujie_asset_versions(id, owner_id, project_id)
);

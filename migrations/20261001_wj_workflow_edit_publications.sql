CREATE TABLE IF NOT EXISTS wujie_workflow_edit_publications (
  task_id TEXT PRIMARY KEY REFERENCES cloud_tasks(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES wujie_users(id),
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  grant_generation BIGINT NOT NULL CHECK (grant_generation >= 0),
  source_asset_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  source_placement_id TEXT NOT NULL REFERENCES wujie_workspace_placements(id),
  canonical_url TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, owner_id) REFERENCES wujie_projects(id, owner_id),
  FOREIGN KEY (source_version_id, source_asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id),
  CHECK ((owner_id = actor_id AND grant_generation = 0)
      OR (owner_id <> actor_id AND grant_generation >= 1))
);

CREATE INDEX IF NOT EXISTS wujie_workflow_edit_publications_project_idx
  ON wujie_workflow_edit_publications(owner_id, project_id, workflow_id, node_id);

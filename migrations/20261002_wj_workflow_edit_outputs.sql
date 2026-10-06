CREATE TABLE IF NOT EXISTS wujie_workflow_edit_outputs (
  task_id TEXT NOT NULL REFERENCES wujie_workflow_edit_publications(task_id) ON DELETE CASCADE,
  output_index INTEGER NOT NULL CHECK (output_index >= 0),
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  placement_id TEXT NOT NULL REFERENCES wujie_workspace_placements(id),
  source_url TEXT NOT NULL,
  checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, output_index),
  UNIQUE (version_id),
  UNIQUE (placement_id),
  FOREIGN KEY (version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
);

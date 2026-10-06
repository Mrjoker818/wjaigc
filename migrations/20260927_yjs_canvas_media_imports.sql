ALTER TABLE wujie_canvas_asset_commands
  ADD COLUMN IF NOT EXISTS source_request_digest TEXT CHECK (source_request_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS source_kind TEXT CHECK (source_kind IN ('upload','task'));

CREATE TABLE IF NOT EXISTS wujie_canvas_media_lineage (
  target_version_id TEXT PRIMARY KEY,
  target_asset_id TEXT NOT NULL,
  target_owner_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES wujie_users(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload','task')),
  task_id TEXT REFERENCES cloud_tasks(id),
  output_index INTEGER CHECK (output_index >= 0),
  source_project_id TEXT REFERENCES wujie_projects(id),
  source_version_id TEXT REFERENCES wujie_asset_versions(id),
  source_request_digest TEXT NOT NULL CHECK (source_request_digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source_kind='upload' AND task_id IS NULL AND output_index IS NULL AND source_project_id IS NULL AND source_version_id IS NULL)
    OR (source_kind='task' AND task_id IS NOT NULL AND output_index IS NOT NULL AND source_project_id IS NOT NULL)),
  FOREIGN KEY (target_version_id,target_asset_id,target_owner_id,target_project_id)
    REFERENCES wujie_asset_versions(id,asset_id,owner_id,project_id)
);

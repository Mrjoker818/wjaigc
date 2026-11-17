CREATE TABLE IF NOT EXISTS wujie_drama_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  doc JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS wujie_drama_projects_user_updated_idx
  ON wujie_drama_projects (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS wujie_drama_projects_project_idx
  ON wujie_drama_projects (user_id, project_id)
  WHERE project_id IS NOT NULL;

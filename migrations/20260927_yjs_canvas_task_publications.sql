CREATE TABLE IF NOT EXISTS wujie_canvas_task_publications (
  task_id TEXT PRIMARY KEY REFERENCES cloud_tasks(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES wujie_users(id),
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL CHECK (workspace_id = project_id),
  grant_generation BIGINT NOT NULL CHECK (grant_generation >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, owner_id) REFERENCES wujie_projects(id, owner_id),
  CHECK ((owner_id = actor_id AND grant_generation = 0)
      OR (owner_id <> actor_id AND grant_generation >= 1))
);

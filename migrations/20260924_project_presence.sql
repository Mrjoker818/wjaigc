CREATE TABLE IF NOT EXISTS wujie_project_presence_members (
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  member_user_id TEXT NOT NULL REFERENCES wujie_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, owner_id, member_user_id),
  FOREIGN KEY (project_id, owner_id) REFERENCES wujie_projects(id, owner_id) ON DELETE CASCADE,
  CHECK (owner_id <> member_user_id)
);

CREATE INDEX IF NOT EXISTS wujie_project_presence_members_member_idx
  ON wujie_project_presence_members (member_user_id, project_id)
  WHERE status = 'active';

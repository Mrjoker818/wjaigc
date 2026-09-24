CREATE TABLE IF NOT EXISTS wujie_project_document_settings (
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  authority_revision BIGINT NOT NULL DEFAULT 0 CHECK (authority_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, owner_id),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wujie_project_document_editors (
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  member_user_id TEXT NOT NULL REFERENCES wujie_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  grant_generation BIGINT NOT NULL DEFAULT 1 CHECK (grant_generation >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, owner_id, member_user_id),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id) ON DELETE CASCADE,
  CHECK (owner_id <> member_user_id)
);

CREATE INDEX IF NOT EXISTS wujie_project_document_editors_member_idx
  ON wujie_project_document_editors (member_user_id, project_id)
  WHERE status = 'active';

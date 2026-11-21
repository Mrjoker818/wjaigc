CREATE TABLE "__PROJECT_SCHEMA__".wujie_project_document_settings (
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  authority_revision BIGINT NOT NULL DEFAULT 0 CHECK (authority_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, owner_id),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES "__PROJECT_SCHEMA__".wujie_projects(id, owner_id) ON DELETE CASCADE
);

-- The caller must prove absence and create this table in its current transaction.
-- These are the exact inherited roles observed in the aborted first attempt.
-- Existing tables, global defaults, roles, grants and RLS are not changed.
REVOKE ALL PRIVILEGES ON TABLE "__PROJECT_SCHEMA__".wujie_project_document_settings
  FROM PUBLIC, "anon", "authenticated", "service_role";

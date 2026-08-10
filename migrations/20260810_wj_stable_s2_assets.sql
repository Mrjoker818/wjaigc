CREATE TABLE IF NOT EXISTS wujie_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trashed')),
  schema_version INTEGER NOT NULL DEFAULT 3 CHECK (schema_version >= 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);

CREATE TABLE IF NOT EXISTS wujie_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'image', 'video', 'model-3d', 'psd', 'svg', 'document', 'audio'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
  current_version_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id, project_id),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id)
);

CREATE TABLE IF NOT EXISTS wujie_asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  file_url TEXT NOT NULL,
  storage_key TEXT,
  checksum TEXT,
  mime_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width >= 0),
  height INTEGER CHECK (height IS NULL OR height >= 0),
  availability TEXT NOT NULL DEFAULT 'ready' CHECK (availability IN (
    'ready', 'pending-persist', 'missing', 'recovering', 'unrecoverable'
  )),
  recovery_source_url TEXT,
  task_id TEXT,
  provider_id TEXT,
  model_id TEXT,
  idempotency_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, asset_id, owner_id, project_id),
  FOREIGN KEY (asset_id, owner_id, project_id)
    REFERENCES wujie_assets(id, owner_id, project_id)
);

ALTER TABLE wujie_assets
  ADD CONSTRAINT wujie_assets_current_version_scope_fk
  FOREIGN KEY (current_version_id, id, owner_id, project_id)
  REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS wujie_asset_version_parents (
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  parent_version_id TEXT NOT NULL,
  parent_order INTEGER NOT NULL CHECK (parent_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, parent_version_id),
  UNIQUE (version_id, parent_order),
  CHECK (version_id <> parent_version_id),
  FOREIGN KEY (version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id),
  FOREIGN KEY (parent_version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
);

CREATE TABLE IF NOT EXISTS wujie_workspace_placements (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  workspace_kind TEXT NOT NULL CHECK (workspace_kind IN ('canvas', 'workflow', 'chat')),
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'canvas-image', 'workflow-input', 'workflow-output', 'chat-attachment', 'chat-result'
  )),
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
  deleted_at TIMESTAMPTZ,
  transform JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND deleted_at IS NULL)
    OR (status = 'trashed' AND deleted_at IS NOT NULL)
  ),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id),
  FOREIGN KEY (asset_version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
);

CREATE TABLE IF NOT EXISTS wujie_asset_migration_checkpoints (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  legacy_project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, project_id, legacy_project_id),
  FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id)
);

CREATE TABLE IF NOT EXISTS wujie_media_gc_candidates (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deferred', 'purged')),
  reason TEXT NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, owner_id, project_id),
  FOREIGN KEY (asset_id, owner_id, project_id)
    REFERENCES wujie_assets(id, owner_id, project_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS wujie_asset_versions_owner_project_idempotency_key_unique
  ON wujie_asset_versions(owner_id, project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wujie_workspace_placements_active_entity_unique
  ON wujie_workspace_placements(owner_id, project_id, workspace_kind, workspace_id, entity_type, entity_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS wujie_assets_owner_project_status_idx
  ON wujie_assets(owner_id, project_id, status);
CREATE INDEX IF NOT EXISTS wujie_assets_current_version_idx
  ON wujie_assets(current_version_id);
CREATE INDEX IF NOT EXISTS wujie_asset_versions_asset_created_idx
  ON wujie_asset_versions(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wujie_asset_versions_task_idx
  ON wujie_asset_versions(task_id)
  WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wujie_workspace_placements_workspace_idx
  ON wujie_workspace_placements(owner_id, project_id, workspace_kind, workspace_id);

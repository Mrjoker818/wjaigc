CREATE TABLE IF NOT EXISTS wujie_canvas_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_revision INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  allow_download BOOLEAN NOT NULL DEFAULT FALSE,
  viewport JSONB NOT NULL,
  snapshot_digest TEXT NOT NULL,
  view_count BIGINT NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT wujie_canvas_shares_project_scope_fk
    FOREIGN KEY (project_id, owner_id)
    REFERENCES wujie_projects(id, owner_id),
  CONSTRAINT wujie_canvas_shares_revision_check
    CHECK (project_revision >= 0),
  CONSTRAINT wujie_canvas_shares_token_hash_check
    CHECK (
      char_length(token_hash) = 64
      AND token_hash ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT wujie_canvas_shares_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT wujie_canvas_shares_status_check
    CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT wujie_canvas_shares_viewport_check
    CHECK (jsonb_typeof(viewport) = 'object'),
  CONSTRAINT wujie_canvas_shares_snapshot_digest_check
    CHECK (char_length(snapshot_digest) BETWEEN 1 AND 128),
  CONSTRAINT wujie_canvas_shares_view_count_check
    CHECK (view_count >= 0),
  CONSTRAINT wujie_canvas_shares_lifecycle_check
    CHECK (
      (status = 'active' AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
      OR (status = 'expired' AND revoked_at IS NULL AND expires_at IS NOT NULL)
    ),
  CONSTRAINT wujie_canvas_shares_expiry_check
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS wujie_workspace_placements_share_source_unique
  ON wujie_workspace_placements (id, asset_id, asset_version_id, entity_type);
CREATE UNIQUE INDEX IF NOT EXISTS wujie_assets_share_kind_unique
  ON wujie_assets (id, kind);

CREATE TABLE IF NOT EXISTS wujie_canvas_share_items (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  asset_kind TEXT NOT NULL,
  transform JSONB NOT NULL,
  display_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  byte_size BIGINT,
  checksum TEXT,
  availability TEXT NOT NULL DEFAULT 'ready',
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wujie_canvas_share_items_share_fk
    FOREIGN KEY (share_id)
    REFERENCES wujie_canvas_shares(id)
    ON DELETE CASCADE,
  CONSTRAINT wujie_canvas_share_items_source_fk
    FOREIGN KEY (placement_id, asset_id, asset_version_id, entity_type)
    REFERENCES wujie_workspace_placements(id, asset_id, asset_version_id, entity_type),
  CONSTRAINT wujie_canvas_share_items_asset_kind_fk
    FOREIGN KEY (asset_id, asset_kind)
    REFERENCES wujie_assets(id, kind),
  CONSTRAINT wujie_canvas_share_items_entity_type_check
    CHECK (entity_type IN ('canvas-image', 'canvas-video')),
  CONSTRAINT wujie_canvas_share_items_asset_kind_check
    CHECK (asset_kind IN ('image', 'video')),
  CONSTRAINT wujie_canvas_share_items_entity_asset_pair_check
    CHECK (
      (entity_type = 'canvas-image' AND asset_kind = 'image')
      OR (entity_type = 'canvas-video' AND asset_kind = 'video')
    ),
  CONSTRAINT wujie_canvas_share_items_transform_check
    CHECK (jsonb_typeof(transform) = 'object'),
  CONSTRAINT wujie_canvas_share_items_display_metadata_check
    CHECK (jsonb_typeof(display_metadata) = 'object'),
  CONSTRAINT wujie_canvas_share_items_mime_type_check
    CHECK (char_length(btrim(mime_type)) BETWEEN 1 AND 255),
  CONSTRAINT wujie_canvas_share_items_dimensions_check
    CHECK (
      (width IS NULL OR width >= 0)
      AND (height IS NULL OR height >= 0)
      AND (byte_size IS NULL OR byte_size >= 0)
      AND sort_order >= 0
    ),
  CONSTRAINT wujie_canvas_share_items_checksum_check
    CHECK (checksum IS NULL OR char_length(checksum) BETWEEN 1 AND 256),
  CONSTRAINT wujie_canvas_share_items_availability_check
    CHECK (availability = 'ready')
);

CREATE TABLE IF NOT EXISTS wujie_canvas_share_rate_windows (
  scope_digest TEXT NOT NULL,
  route_bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempt_count BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT wujie_canvas_share_rate_windows_scope_digest_check
    CHECK (
      char_length(scope_digest) = 64
      AND scope_digest ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT wujie_canvas_share_rate_windows_route_bucket_check
    CHECK (char_length(route_bucket) BETWEEN 1 AND 100),
  CONSTRAINT wujie_canvas_share_rate_windows_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT wujie_canvas_share_rate_windows_pkey
    PRIMARY KEY (scope_digest, route_bucket, window_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS wujie_canvas_shares_token_hash_unique
  ON wujie_canvas_shares (token_hash);
CREATE INDEX IF NOT EXISTS wujie_canvas_shares_owner_project_status_created_idx
  ON wujie_canvas_shares (owner_id, project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS wujie_canvas_shares_expires_at_idx
  ON wujie_canvas_shares (expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS wujie_canvas_share_items_share_id_id_idx
  ON wujie_canvas_share_items (share_id, id);
CREATE INDEX IF NOT EXISTS wujie_canvas_share_items_share_id_sort_order_idx
  ON wujie_canvas_share_items (share_id, sort_order);
CREATE INDEX IF NOT EXISTS wujie_canvas_share_items_asset_version_id_idx
  ON wujie_canvas_share_items (asset_version_id);
CREATE INDEX IF NOT EXISTS wujie_canvas_share_rate_windows_window_start_idx
  ON wujie_canvas_share_rate_windows (window_start);

CREATE TABLE IF NOT EXISTS wujie_asset_thumbnail_variants (
  asset_version_id TEXT NOT NULL,
  size SMALLINT NOT NULL CHECK (size IN (256, 512)),
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  file_url TEXT,
  storage_key TEXT,
  checksum TEXT,
  mime_type TEXT,
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width >= 0),
  height INTEGER CHECK (height IS NULL OR height >= 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_version_id, size),
  FOREIGN KEY (asset_version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
    ON DELETE CASCADE,
  CHECK (
    (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status <> 'processing'
  ),
  CHECK (
    (status = 'ready' AND file_url IS NOT NULL AND mime_type = 'image/webp')
    OR status <> 'ready'
  )
);

CREATE INDEX IF NOT EXISTS wujie_asset_thumbnail_variants_status_lease_idx
  ON wujie_asset_thumbnail_variants(status, lease_expires_at, updated_at);

CREATE INDEX IF NOT EXISTS wujie_asset_thumbnail_variants_asset_idx
  ON wujie_asset_thumbnail_variants(asset_id, asset_version_id);

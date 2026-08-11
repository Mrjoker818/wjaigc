ALTER TABLE wujie_media_gc_candidates
  ADD COLUMN IF NOT EXISTS confirmation_digest TEXT NOT NULL DEFAULT '';

ALTER TABLE wujie_media_gc_candidates
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

ALTER TABLE wujie_media_gc_candidates
  ADD COLUMN IF NOT EXISTS physical_purge_status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (physical_purge_status IN ('disabled', 'deferred', 'failed'));

CREATE TABLE IF NOT EXISTS wujie_asset_media_recovery_attempts (
  id TEXT PRIMARY KEY,
  asset_version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('deferred', 'succeeded', 'failed', 'unrecoverable')),
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (asset_version_id, asset_id, owner_id, project_id)
    REFERENCES wujie_asset_versions(id, asset_id, owner_id, project_id)
);

ALTER TABLE wujie_asset_media_recovery_attempts
  DROP CONSTRAINT IF EXISTS wujie_asset_media_recovery_attempts_status_check;

ALTER TABLE wujie_asset_media_recovery_attempts
  ADD CONSTRAINT wujie_asset_media_recovery_attempts_status_check
  CHECK (status IN ('deferred', 'succeeded', 'failed', 'unrecoverable'));

CREATE INDEX IF NOT EXISTS wujie_asset_media_recovery_attempts_version_idx
  ON wujie_asset_media_recovery_attempts(asset_version_id, created_at DESC);

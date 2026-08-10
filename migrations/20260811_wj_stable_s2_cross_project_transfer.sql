ALTER TABLE wujie_workspace_placements
  ADD COLUMN IF NOT EXISTS source_version_id TEXT;

UPDATE wujie_workspace_placements
SET source_version_id = asset_version_id
WHERE idempotency_key IS NOT NULL
  AND source_version_id IS NULL;

ALTER TABLE wujie_workspace_placements
  ADD CONSTRAINT wujie_workspace_placements_source_version_fk
  FOREIGN KEY (source_version_id)
  REFERENCES wujie_asset_versions(id)
  NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS wujie_workspace_placements_transfer_source_idempotency_unique
  ON wujie_workspace_placements(
    owner_id,
    source_version_id,
    project_id,
    workspace_id,
    entity_type,
    entity_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL
    AND source_version_id IS NOT NULL;

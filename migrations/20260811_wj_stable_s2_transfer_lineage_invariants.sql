UPDATE wujie_workspace_placements
SET source_version_id = asset_version_id
WHERE idempotency_key IS NOT NULL
  AND source_version_id IS NULL;

UPDATE wujie_workspace_placements
SET request_digest = 'legacy-transfer:' || id
WHERE idempotency_key IS NOT NULL
  AND request_digest IS NULL;

ALTER TABLE wujie_asset_versions
  ADD CONSTRAINT wujie_asset_versions_id_owner_unique
  UNIQUE (id, owner_id);

ALTER TABLE wujie_workspace_placements
  DROP CONSTRAINT IF EXISTS wujie_workspace_placements_source_version_fk;

ALTER TABLE wujie_workspace_placements
  ADD CONSTRAINT wujie_workspace_placements_source_version_owner_fk
  FOREIGN KEY (source_version_id, owner_id)
  REFERENCES wujie_asset_versions(id, owner_id)
  NOT VALID;

ALTER TABLE wujie_workspace_placements
  ADD CONSTRAINT wujie_workspace_placements_transfer_lineage_check
  CHECK (
    idempotency_key IS NULL
    OR (source_version_id IS NOT NULL AND request_digest IS NOT NULL)
  ) NOT VALID;

ALTER TABLE wujie_workspace_placements
  VALIDATE CONSTRAINT wujie_workspace_placements_source_version_owner_fk;

ALTER TABLE wujie_workspace_placements
  VALIDATE CONSTRAINT wujie_workspace_placements_transfer_lineage_check;

DROP INDEX IF EXISTS wujie_workspace_placements_transfer_idempotency_unique;
DROP INDEX IF EXISTS wujie_workspace_placements_transfer_source_idempotency_unique;

CREATE UNIQUE INDEX wujie_workspace_placements_transfer_source_idempotency_unique
  ON wujie_workspace_placements(
    owner_id,
    source_version_id,
    project_id,
    workspace_id,
    entity_type,
    entity_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

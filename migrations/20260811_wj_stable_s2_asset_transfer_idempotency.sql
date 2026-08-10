ALTER TABLE wujie_workspace_placements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_digest TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS wujie_workspace_placements_transfer_idempotency_unique
  ON wujie_workspace_placements(
    owner_id,
    asset_version_id,
    project_id,
    workspace_kind,
    workspace_id,
    entity_type,
    entity_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

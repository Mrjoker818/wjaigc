ALTER TABLE wujie_asset_cleanup_outbox
  ADD COLUMN IF NOT EXISTS lease_token UUID;

CREATE INDEX IF NOT EXISTS wujie_asset_cleanup_outbox_lease_idx
  ON wujie_asset_cleanup_outbox(lease_token)
  WHERE status = 'processing';

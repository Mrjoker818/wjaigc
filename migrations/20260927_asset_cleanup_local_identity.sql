-- Ownership is supplied by the creator; never infer it for existing path-only records.
-- Rollout gate: stop old cleanup workers, apply this migration, then start ownership-aware workers.
ALTER TABLE wujie_asset_cleanup_outbox
  ADD COLUMN IF NOT EXISTS local_identity JSONB;

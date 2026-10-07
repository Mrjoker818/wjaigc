-- A root is a receipt anchored to its first actual canonical item, not an attach.
ALTER TABLE wujie_canvas_asset_commands
  ADD COLUMN IF NOT EXISTS batch_manifest JSONB NULL;
ALTER TABLE wujie_canvas_asset_commands
  ADD CONSTRAINT wujie_canvas_asset_commands_batch_manifest_check CHECK (
    batch_manifest IS NULL OR COALESCE((
      jsonb_typeof(batch_manifest) = 'object' AND batch_manifest->'version' = '1'::jsonb
      AND source_kind IS NULL AND source_request_digest IS NOT NULL
      AND source_request_digest = request_digest
      AND idempotency_key LIKE 'batch-root:%'
      AND jsonb_typeof(batch_manifest->'items') = 'array'
      AND jsonb_array_length(batch_manifest->'items') BETWEEN 1 AND 100
    ),false)
  );

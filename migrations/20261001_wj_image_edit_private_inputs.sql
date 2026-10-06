-- Private recovery input for a billable inpaint task. The deferred FK lets the
-- admission transaction snapshot inputs before it inserts and charges the task.
-- This table is never exposed through serve-upload or task result JSON.
CREATE TABLE IF NOT EXISTS wujie_image_edit_private_inputs (
  task_id TEXT PRIMARY KEY REFERENCES cloud_tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_digest CHAR(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  source_bytes BYTEA NOT NULL CHECK (octet_length(source_bytes) BETWEEN 1 AND 20971520),
  mask_bytes BYTEA NOT NULL CHECK (octet_length(mask_bytes) BETWEEN 1 AND 20971520),
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  mask_sha256 CHAR(64) NOT NULL CHECK (mask_sha256 ~ '^[a-f0-9]{64}$'),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 2048),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 2048),
  document_owner_id TEXT,
  document_grant_generation TEXT,
  document_source_version_id TEXT,
  document_source_placement_id TEXT,
  document_canonical_url TEXT,
  document_origin TEXT,
  CONSTRAINT wujie_inpaint_document_source_complete CHECK (
    num_nonnulls(document_owner_id, document_grant_generation, document_source_version_id,
      document_source_placement_id, document_canonical_url, document_origin) = 0
    OR (num_nonnulls(document_owner_id, document_grant_generation, document_source_version_id,
      document_source_placement_id, document_canonical_url, document_origin) = 6
      AND document_owner_id <> '' AND document_grant_generation <> ''
      AND document_source_version_id <> '' AND document_source_placement_id <> ''
      AND document_canonical_url <> '' AND document_origin <> '')
  ),
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS wujie_image_edit_private_inputs_created_idx
  ON wujie_image_edit_private_inputs(created_at);

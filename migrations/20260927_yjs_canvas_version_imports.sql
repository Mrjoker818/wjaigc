-- Extend the existing combinations without changing or deleting historical rows.
ALTER TABLE wujie_canvas_asset_commands
  DROP CONSTRAINT IF EXISTS wujie_canvas_asset_commands_source_kind_check;
ALTER TABLE wujie_canvas_asset_commands
  ADD CONSTRAINT wujie_canvas_asset_commands_source_kind_check CHECK (source_kind IN ('upload','task','version'));

ALTER TABLE wujie_canvas_media_lineage
  DROP CONSTRAINT IF EXISTS wujie_canvas_media_lineage_source_kind_check,
  DROP CONSTRAINT IF EXISTS wujie_canvas_media_lineage_check;
ALTER TABLE wujie_canvas_media_lineage
  ADD CONSTRAINT wujie_canvas_media_lineage_source_kind_check CHECK (source_kind IN ('upload','task','version')),
  ADD CONSTRAINT wujie_canvas_media_lineage_check CHECK (
    (source_kind='upload' AND task_id IS NULL AND output_index IS NULL AND source_project_id IS NULL AND source_version_id IS NULL)
    OR (source_kind='task' AND task_id IS NOT NULL AND output_index IS NOT NULL AND source_project_id IS NOT NULL)
    OR (source_kind='version' AND task_id IS NULL AND output_index IS NULL AND source_project_id IS NOT NULL AND source_version_id IS NOT NULL)
  );

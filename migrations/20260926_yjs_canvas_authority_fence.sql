-- The legacy project snapshot is shared by several write paths. Install the
-- authority fence on the table itself so an old asset action cannot bypass it.
CREATE TABLE IF NOT EXISTS wujie_user_data (
  user_id TEXT NOT NULL,
  data_key TEXT NOT NULL,
  data_value JSONB,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, data_key)
);

CREATE FUNCTION wujie_guard_document_project_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  enabled_project RECORD;
  prior_project JSONB;
  next_project JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.data_key = 'projects' AND EXISTS (
      SELECT 1 FROM wujie_project_document_settings
      WHERE owner_id = OLD.user_id AND enabled = true
    ) THEN
      RAISE EXCEPTION 'DOCUMENT_AUTHORITY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.data_key = 'projects'
     AND (NEW.data_key <> 'projects' OR NEW.user_id <> OLD.user_id)
     AND EXISTS (
       SELECT 1 FROM wujie_project_document_settings
       WHERE owner_id = OLD.user_id AND enabled = true
     ) THEN
    RAISE EXCEPTION 'DOCUMENT_AUTHORITY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.data_key <> 'projects' THEN RETURN NEW; END IF;

  FOR enabled_project IN
    SELECT project_id FROM wujie_project_document_settings
    WHERE owner_id = NEW.user_id AND enabled = true
    ORDER BY project_id FOR SHARE
  LOOP
    IF TG_OP = 'INSERT' OR OLD.user_id <> NEW.user_id OR OLD.data_key <> 'projects' THEN
      RAISE EXCEPTION 'DOCUMENT_AUTHORITY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    SELECT jsonb_agg(item.value) INTO prior_project
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(OLD.data_value) = 'array' THEN OLD.data_value ELSE '[]'::jsonb END
    ) item(value)
    WHERE item.value->>'id' = enabled_project.project_id;
    SELECT jsonb_agg(item.value) INTO next_project
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(NEW.data_value) = 'array' THEN NEW.data_value ELSE '[]'::jsonb END
    ) item(value)
    WHERE item.value->>'id' = enabled_project.project_id;
    IF prior_project IS NULL OR next_project IS NULL
       OR jsonb_array_length(prior_project) <> 1 OR jsonb_array_length(next_project) <> 1
       OR (prior_project->0->'userId') IS DISTINCT FROM (next_project->0->'userId')
       OR (prior_project->0->'createdAt') IS DISTINCT FROM (next_project->0->'createdAt')
       OR (prior_project->0->'schemaVersion') IS DISTINCT FROM (next_project->0->'schemaVersion')
       OR (prior_project->0->'canvasImages') IS DISTINCT FROM (next_project->0->'canvasImages')
       OR (prior_project->0->'images') IS DISTINCT FROM (next_project->0->'images')
       OR (prior_project->0->'metadata'->'groups') IS DISTINCT FROM (next_project->0->'metadata'->'groups')
       OR (prior_project->0->'metadata'->'annotationsV2') IS DISTINCT FROM (next_project->0->'metadata'->'annotationsV2') THEN
      RAISE EXCEPTION 'DOCUMENT_AUTHORITY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    IF (prior_project->0->'name') IS DISTINCT FROM (next_project->0->'name') THEN
      IF jsonb_typeof(next_project->0->'name') IS DISTINCT FROM 'string'
         OR btrim(next_project->0->>'name') = '' THEN
        RAISE EXCEPTION 'DOCUMENT_AUTHORITY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;
      UPDATE wujie_projects SET name = next_project->0->>'name', updated_at = now()
       WHERE id = enabled_project.project_id AND owner_id = NEW.user_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wujie_document_project_snapshot_fence
AFTER INSERT OR UPDATE OR DELETE ON wujie_user_data
FOR EACH ROW EXECUTE FUNCTION wujie_guard_document_project_snapshot();

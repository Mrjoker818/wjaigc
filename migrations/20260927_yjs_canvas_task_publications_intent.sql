ALTER TABLE wujie_canvas_task_publications
  ADD COLUMN IF NOT EXISTS publication_intent JSONB;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='wujie_canvas_task_publications'::regclass
      AND conname='wujie_canvas_task_publications_intent_object') THEN
    ALTER TABLE wujie_canvas_task_publications
      ADD CONSTRAINT wujie_canvas_task_publications_intent_object
      CHECK (publication_intent IS NULL OR jsonb_typeof(publication_intent)='object');
  END IF;
END $$;

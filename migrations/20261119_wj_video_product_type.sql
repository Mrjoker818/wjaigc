-- Video (the drama workbench) gets its own grant. A canvas grant used to open it as well,
-- so every user and group that has canvas keeps video. NULL or empty productType already means all.
-- The column and the groups table are created at app start, so a fresh database may not have them yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'wujie_users' AND column_name = 'product_type'
  ) THEN
    UPDATE wujie_users
       SET product_type = product_type || ',video'
     WHERE ',' || replace(product_type, ' ', '') || ',' LIKE '%,canvas,%'
       AND ',' || replace(product_type, ' ', '') || ',' NOT LIKE '%,video,%';
  END IF;
  IF to_regclass('wujie_user_groups') IS NOT NULL THEN
    UPDATE wujie_user_groups
       SET product_types = product_types || '["video"]'::jsonb
     WHERE jsonb_typeof(product_types) = 'array'
       AND product_types ? 'canvas'
       AND NOT product_types ? 'video';
  END IF;
END
$$;

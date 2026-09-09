ALTER TABLE wujie_asset_versions
  ADD CONSTRAINT wujie_asset_versions_id_owner_project_unique
  UNIQUE (id, owner_id, project_id);

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'wujie_asset_version_parents'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (parent_version_id, asset_id, owner_id, project_id)%'
  LOOP
    EXECUTE format('ALTER TABLE wujie_asset_version_parents DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE wujie_asset_version_parents
  DROP CONSTRAINT IF EXISTS wujie_asset_version_parents_parent_version_id_asset_id_owner_id_project_id_fkey;

ALTER TABLE wujie_asset_version_parents
  ADD CONSTRAINT wujie_asset_version_parents_parent_scope_fk
  FOREIGN KEY (parent_version_id, owner_id, project_id)
  REFERENCES wujie_asset_versions(id, owner_id, project_id);

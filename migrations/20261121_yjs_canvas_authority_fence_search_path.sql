-- Keep application relations ahead of temporary tables, including in sessions
-- that create temporary objects after this migration has completed.
-- Preserve the existing trigger body, invoker permissions and authority checks.
DO $fence_path$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.wujie_guard_document_project_snapshot() SET search_path = pg_catalog, %I, pg_temp',
    target_schema, target_schema
  );
END;
$fence_path$;

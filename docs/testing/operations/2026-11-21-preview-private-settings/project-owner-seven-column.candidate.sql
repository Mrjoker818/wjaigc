-- REVIEW CANDIDATE ONLY, 2026-11-21. Not registered or executed.
-- Caller owns explicit BEGIN/COMMIT/ROLLBACK, verified target and controlled write window.
-- Replace BOTH placeholders only from the parent's verified catalog (never a business DB in tests).
-- NONEMPTY exact-7-column branch: 280 rows, all retained, including 225 JSON-absent rows.
-- Parent summary: RLS ON, FORCE false, zero policies, owner postgres; existing app role BYPASS.
-- Existing defaults ONLY status='active'::text and revision=1. Ordinary updated_at index below.
-- Full metadata/dependency extraction and owner-mapping decision still belong to parent.
-- user_id is the sole historical owner candidate (55 JSON matches); zero policies do not prove it.
-- No current-repo bigint time writer found; external old consumers must be accounted for.
-- This repairs structure only. No settings/ledger/history body/presence/completed markers.
-- Existing 280 rows remain ordinary historical rows; legacy migration is NOT restored by this SQL.
SELECT pg_catalog.set_config('lock_timeout', '2000', true);
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wujie-schema-migrations', 0));
SELECT pg_catalog.set_config('TimeZone', 'UTC', true);
LOCK TABLE ONLY "__PROJECT_SCHEMA__".wujie_projects IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  target regclass := '"__PROJECT_SCHEMA__".wujie_projects'::regclass;
  actual text[];
  relation record;
  actor record;
BEGIN
  IF target::oid::text <> '__PROJECT_TABLE_OID__' THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_TARGET_CHANGED';
  END IF;
  SELECT relkind, relrowsecurity, relforcerowsecurity, relowner INTO relation
    FROM pg_catalog.pg_class WHERE oid = target;
  SELECT oid, rolsuper, rolbypassrls INTO actor FROM pg_catalog.pg_roles WHERE rolname=current_user;
  IF relation.relkind <> 'r' THEN RAISE EXCEPTION 'PROJECT_COMPAT_RELATION_REQUIRES_REVIEW'; END IF;
  -- Verify the reported state; do not manufacture visibility or alter security policy.
  IF relation.relrowsecurity IS DISTINCT FROM true
     OR relation.relforcerowsecurity IS DISTINCT FROM false
     OR relation.relowner IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=target) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_RLS_BASELINE_CHANGED';
  END IF;
  IF actor.rolbypassrls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_EXISTING_BYPASS_ROLE_REQUIRED';
  END IF;
  SELECT array_agg(a.attname::text || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod)
                   || ':' || a.attnotnull::text ORDER BY a.attnum)
    INTO actual FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = target AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM ARRAY[
    'id:text:true','user_id:text:true','name:text:true','status:text:true',
    'revision:integer:true','created_at:bigint:true','updated_at:bigint:true'
  ] THEN RAISE EXCEPTION 'PROJECT_COMPAT_UNEXPECTED_COLUMNS'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid=target AND attnum>0 AND NOT attisdropped
                AND (attgenerated<>'' OR attidentity<>'')) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_GENERATED_COLUMNS_REQUIRE_REVIEW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid=target AND contype='p' AND conkey=ARRAY[1]::smallint[]
                    AND NOT condeferrable AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                     WHERE conrelid=target AND contype='u' AND conkey=ARRAY[1,2]::smallint[]
                       AND NOT condeferrable AND convalidated) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_UNEXPECTED_KEYS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=target AND contype IN ('c','f')) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_OLD_CONSTRAINT_REQUIRES_REVIEW';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=target AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_EXISTING_TRIGGER_REQUIRES_REVIEW';
  END IF;
  SELECT array_agg(a.attname::text || ':' || pg_catalog.pg_get_expr(d.adbin,d.adrelid)
                   ORDER BY a.attnum)
    INTO actual FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
      ON a.attrelid=d.adrelid AND a.attnum=d.adnum
   WHERE d.adrelid=target;
  IF actual IS DISTINCT FROM ARRAY['status:''active''::text','revision:1'] THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_DEFAULT_BASELINE_CHANGED';
  END IF;
  -- Only the dependency class/name is in the parent's summary. Do not guess its
  -- order/opclass or promise index OID/relfilenode stability across ALTER TYPE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
     WHERE i.indrelid=target AND c.relname='idx_wujie_projects_user_updated'
       AND c.relkind='i' AND i.indisvalid AND i.indisready AND NOT i.indisunique
       AND i.indexprs IS NULL AND i.indpred IS NULL AND 7=ANY(i.indkey::smallint[])
  ) THEN RAISE EXCEPTION 'PROJECT_COMPAT_EXPECTED_PLAIN_INDEX_CHANGED'; END IF;
  IF (SELECT count(*) FROM "__PROJECT_SCHEMA__".wujie_projects) <> 280 THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_280_ROW_BASELINE_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM "__PROJECT_SCHEMA__".wujie_projects
              WHERE btrim(user_id)='' OR status NOT IN ('active','trashed')) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_OWNER_OR_STATUS_REQUIRES_REVIEW';
  END IF;
  -- A range check/round trip does NOT prove units; epoch-ms needs external evidence.
  IF EXISTS (SELECT 1 FROM "__PROJECT_SCHEMA__".wujie_projects
              WHERE created_at NOT BETWEEN -62135596800000 AND 253402300799999
                 OR updated_at NOT BETWEEN -62135596800000 AND 253402300799999) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_EPOCH_RANGE_REQUIRES_REVIEW';
  END IF;
END;
$preflight$;

ALTER TABLE "__PROJECT_SCHEMA__".wujie_projects
  ADD COLUMN owner_id text,
  ADD COLUMN schema_version integer,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN compat_created_at_epoch_ms_original bigint,
  ADD COLUMN compat_updated_at_epoch_ms_original bigint;

-- Original seven values are retained; revision is NOT a schema version.
UPDATE "__PROJECT_SCHEMA__".wujie_projects
   SET owner_id=user_id, schema_version=1,
       compat_created_at_epoch_ms_original=created_at,
       compat_updated_at_epoch_ms_original=updated_at;

-- Required localized type changes. Break into days/seconds/ms to avoid a large
-- floating-point epoch conversion. UTC removes day-interval/DST ambiguity.
ALTER TABLE "__PROJECT_SCHEMA__".wujie_projects
  ALTER COLUMN created_at TYPE timestamptz USING (
    TIMESTAMPTZ '1970-01-01 00:00:00+00'
      + (created_at / 86400000)::integer * INTERVAL '1 day'
      + ((created_at % 86400000) / 1000)::integer * INTERVAL '1 second'
      + (created_at % 1000)::integer * INTERVAL '1 millisecond'),
  ALTER COLUMN updated_at TYPE timestamptz USING (
    TIMESTAMPTZ '1970-01-01 00:00:00+00'
      + (updated_at / 86400000)::integer * INTERVAL '1 day'
      + ((updated_at % 86400000) / 1000)::integer * INTERVAL '1 second'
      + (updated_at % 1000)::integer * INTERVAL '1 millisecond'),
  -- Original time defaults are proven absent. Add current S2 defaults for new rows;
  -- existing converted timestamps and revision DEFAULT 1 are untouched.
  ALTER COLUMN created_at SET DEFAULT pg_catalog.now(),
  ALTER COLUMN updated_at SET DEFAULT pg_catalog.now(),
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN schema_version SET NOT NULL,
  ALTER COLUMN schema_version SET DEFAULT 3,
  ADD CONSTRAINT wujie_projects_compat_owner_alias CHECK (owner_id=user_id),
  ADD CONSTRAINT wujie_projects_compat_id_owner_key UNIQUE (id,owner_id);

DO $roundtrip$
BEGIN
  IF EXISTS (SELECT 1 FROM "__PROJECT_SCHEMA__".wujie_projects
    WHERE extract(epoch FROM created_at)*1000 IS DISTINCT FROM compat_created_at_epoch_ms_original::numeric
       OR extract(epoch FROM updated_at)*1000 IS DISTINCT FROM compat_updated_at_epoch_ms_original::numeric) THEN
    RAISE EXCEPTION 'PROJECT_COMPAT_TIMESTAMP_ROUNDTRIP_FAILED';
  END IF;
END;
$roundtrip$;

CREATE FUNCTION "__PROJECT_SCHEMA__".wujie_project_owner_compat_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $bridge$
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Preserve existing policy/FK authority over explicit ownership changes.
    -- Never infer a transfer or silently rewrite the other identity column.
    IF NEW.owner_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'PROJECT_COMPAT_OWNER_MISMATCH';
    END IF;
    IF NEW.compat_created_at_epoch_ms_original IS DISTINCT FROM OLD.compat_created_at_epoch_ms_original
       OR NEW.compat_updated_at_epoch_ms_original IS DISTINCT FROM OLD.compat_updated_at_epoch_ms_original THEN
      RAISE EXCEPTION 'PROJECT_COMPAT_ORIGINAL_VALUES_IMMUTABLE';
    END IF;
  ELSE
    IF NEW.compat_created_at_epoch_ms_original IS NOT NULL
       OR NEW.compat_updated_at_epoch_ms_original IS NOT NULL THEN
      RAISE EXCEPTION 'PROJECT_COMPAT_ORIGINAL_VALUES_RESERVED';
    END IF;
    IF NEW.owner_id IS NULL THEN NEW.owner_id:=NEW.user_id; END IF;
    IF NEW.user_id IS NULL THEN NEW.user_id:=NEW.owner_id; END IF;
    IF NEW.owner_id IS NULL OR btrim(NEW.owner_id)=''
       OR NEW.owner_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'PROJECT_COMPAT_OWNER_MISMATCH';
    END IF;
    -- Omitted time fields use added column defaults; revision uses its original 1.
    -- No revision/time NULL repair here: explicit NULL retains NOT NULL rejection.
  END IF;
  RETURN NEW;
END;
$bridge$;

CREATE TRIGGER wujie_project_owner_compat_before_write
BEFORE INSERT OR UPDATE ON "__PROJECT_SCHEMA__".wujie_projects
FOR EACH ROW EXECUTE FUNCTION "__PROJECT_SCHEMA__".wujie_project_owner_compat_before_write();

-- No settings creation, no migration ledger INSERT, no presence/checkpoint markers,
-- no historical migration body, no grant/policy changes. Caller validates then
-- COMMITs in its approved window, or ROLLBACKs the entire candidate transaction.

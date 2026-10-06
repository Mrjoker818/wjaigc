import { getPool } from '@/lib/db-client';

const CLAIM_FUNCTION_BODY = `
      DECLARE
        new_identity TEXT;
        old_identity TEXT;
      BEGIN
        IF NEW.type <> 'refund' THEN
          RETURN NEW;
        END IF;
        new_identity := COALESCE(NULLIF(NEW.task_id, ''), NULLIF(NEW.reference_id, ''));
        IF new_identity IS NULL THEN
          RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          old_identity := CASE WHEN OLD.type = 'refund'
            THEN COALESCE(NULLIF(OLD.task_id, ''), NULLIF(OLD.reference_id, ''))
            ELSE NULL END;
          IF new_identity IS NOT DISTINCT FROM old_identity THEN
            RETURN NEW;
          END IF;
        END IF;
        INSERT INTO wujie_refund_identity_claims(identity) VALUES (new_identity);
        RETURN NEW;
      END
      `;

const CLAIM_READY_SQL = `SELECT
  to_regclass('wujie_refund_identity_claims') IS NOT NULL AS table_present,
  EXISTS (
    SELECT 1 FROM pg_constraint claim_key
    JOIN pg_attribute identity_column
      ON identity_column.attrelid = claim_key.conrelid
     AND identity_column.attnum = claim_key.conkey[1]
    WHERE claim_key.conrelid = to_regclass('wujie_refund_identity_claims')
      AND claim_key.contype = 'p'
      AND claim_key.conname = 'wujie_refund_identity_claims_pkey'
      AND cardinality(claim_key.conkey) = 1
      AND identity_column.attname = 'identity'
  ) AS primary_key,
  EXISTS (
    SELECT 1 FROM pg_trigger claim_trigger
    JOIN pg_proc claim_function ON claim_function.oid = claim_trigger.tgfoid
    WHERE claim_trigger.tgrelid = to_regclass('wujie_credit_transactions')
      AND claim_trigger.tgname = 'trg_wujie_claim_refund_identity'
      AND claim_trigger.tgenabled IN ('O', 'A')
      AND claim_trigger.tgtype = 23
      AND cardinality(claim_trigger.tgattr) = 0
      AND claim_trigger.tgfoid = to_regprocedure('wujie_claim_refund_identity()')
      AND claim_function.prosrc = $1
  ) AS trigger_enabled`;

interface ClaimReadiness {
  table_present: boolean;
  primary_key: boolean;
  trigger_enabled: boolean;
}

function isReady(row: ClaimReadiness | undefined): boolean {
  return row?.table_present === true && row.primary_key === true && row.trigger_enabled === true;
}

/** Preserve historical refund rows while atomically claiming every task identity for future writes. */
export async function ensureRefundIdentityClaims(): Promise<void> {
  const current = await getPool().query(CLAIM_READY_SQL, [CLAIM_FUNCTION_BODY]);
  if (isReady(current.rows[0] as ClaimReadiness | undefined)) return;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Writers cannot slip between backfilling old identities and installing the trigger.
    await client.query('LOCK TABLE wujie_credit_transactions IN SHARE ROW EXCLUSIVE MODE');
    const locked = await client.query(CLAIM_READY_SQL, [CLAIM_FUNCTION_BODY]);
    if (isReady(locked.rows[0] as ClaimReadiness | undefined)) {
      await client.query('COMMIT');
      return;
    }
    await client.query(`CREATE TABLE IF NOT EXISTS wujie_refund_identity_claims (
      identity TEXT PRIMARY KEY
    )`);
    await client.query(`INSERT INTO wujie_refund_identity_claims(identity)
      SELECT DISTINCT COALESCE(NULLIF(task_id, ''), NULLIF(reference_id, ''))
      FROM wujie_credit_transactions
      WHERE type = 'refund'
        AND COALESCE(NULLIF(task_id, ''), NULLIF(reference_id, '')) IS NOT NULL
      ON CONFLICT (identity) DO NOTHING`);
    await client.query(`CREATE OR REPLACE FUNCTION wujie_claim_refund_identity()
      RETURNS trigger LANGUAGE plpgsql AS $claim$${CLAIM_FUNCTION_BODY}$claim$`);
    await client.query(`DO $install$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'wujie_credit_transactions'::regclass
            AND tgname = 'trg_wujie_claim_refund_identity'
        ) THEN
          CREATE TRIGGER trg_wujie_claim_refund_identity
          BEFORE INSERT OR UPDATE
          ON wujie_credit_transactions
          FOR EACH ROW EXECUTE FUNCTION wujie_claim_refund_identity();
        END IF;
      END
      $install$`);
    const installed = await client.query(CLAIM_READY_SQL, [CLAIM_FUNCTION_BODY]);
    if (!isReady(installed.rows[0] as ClaimReadiness | undefined)) {
      throw new Error('Refund identity claim table, primary key, or trigger is not active');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch((): void => {});
    throw error;
  } finally {
    client.release();
  }
}

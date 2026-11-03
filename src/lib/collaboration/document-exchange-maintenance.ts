import 'server-only';
import { getPool } from '@/lib/db-client';

export interface DocumentExchangeMaintenanceOptions {
  sessionBatchSize?: number;
  receiptBatchSize?: number;
}
export interface DocumentExchangeMaintenanceResult {
  deletedSessions: number;
  deletedReceipts: number;
}
function boundedLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid document exchange maintenance limit');
  return value;
}

/** Delete only expired, row-locked sessions, with a single bounded receipt budget. */
export async function pruneExpiredDocumentExchangeSessions(
  options: DocumentExchangeMaintenanceOptions = {},
): Promise<DocumentExchangeMaintenanceResult> {
  const sessionLimit = boundedLimit(options.sessionBatchSize, 8);
  const receiptLimit = boundedLimit(options.receiptBatchSize, 500);
  const client = await getPool().connect();
  let discard = false, committing = false, failure: unknown, failed = false;
  let result: DocumentExchangeMaintenanceResult | undefined;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const selected = await client.query<{ session_hash: string }>(`SELECT session_hash
      FROM wujie_document_exchange_sessions
      WHERE retain_until < statement_timestamp()
      ORDER BY retain_until, session_hash
      LIMIT $1 FOR UPDATE SKIP LOCKED`, [sessionLimit]);
    const hashes = selected.rows.map(row => row.session_hash);
    let deletedReceipts = 0, deletedSessions = 0;
    if (hashes.length) {
      const receipts = await client.query(`DELETE FROM wujie_document_update_receipts
        WHERE (session_hash, operation_id) IN (
          SELECT session_hash, operation_id FROM wujie_document_update_receipts
          WHERE session_hash = ANY($1::text[])
          ORDER BY session_hash, operation_id LIMIT $2
        )`, [hashes, receiptLimit]);
      deletedReceipts = receipts.rowCount ?? 0;
      // A separate statement sees this transaction's preceding receipt deletion.
      const sessions = await client.query(`DELETE FROM wujie_document_exchange_sessions session
        WHERE session.session_hash = ANY($1::text[])
          AND session.retain_until < clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM wujie_document_update_receipts receipt
                          WHERE receipt.session_hash = session.session_hash)`, [hashes]);
      deletedSessions = sessions.rowCount ?? 0;
    }
    const candidate = { deletedSessions, deletedReceipts };
    committing = true;
    await client.query('COMMIT');
    result = candidate;
  } catch (error) {
    failed = true; failure = error;
    if (committing) discard = true;
    try { await client.query('ROLLBACK'); }
    catch (rollbackError) {
      discard = true;
      failure = new AggregateError([error, rollbackError], 'Document exchange maintenance rollback failed');
    }
  }
  try { client.release(discard); }
  catch (releaseError) {
    failure = failed ? new AggregateError([failure, releaseError], 'Document exchange maintenance release failed') : releaseError;
    failed = true;
  }
  if (failed) throw failure;
  return result!;
}

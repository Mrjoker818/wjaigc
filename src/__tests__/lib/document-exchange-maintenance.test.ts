import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db-client', () => ({ getPool: () => boundary.pool }));
import { startDocumentTicketMaintenance } from '@/lib/collaboration/document-tickets';
import { pruneExpiredDocumentExchangeSessions } from '@/lib/collaboration/document-exchange-maintenance';

interface Session { hash: string; expired: boolean; locked: boolean }
interface Receipt { session: string; operation: string }
class ControlledSql {
  sessions: Session[];
  receipts: Receipt[];
  commands: string[] = [];
  releases: boolean[] = [];
  ticketCalls = 0;
  ticketFails = false;
  failAt = '';
  rollbackFails = false;
  commitGate: Promise<void> | null = null;
  rollbackGate: Promise<void> | null = null;
  private originalSessions: Session[] = [];
  private originalReceipts: Receipt[] = [];
  constructor(sessions: Session[], receipts: Receipt[]) { this.sessions = structuredClone(sessions); this.receipts = structuredClone(receipts); }
  readonly queryTicket = vi.fn(async () => { this.ticketCalls++; if (this.ticketFails) throw new Error('ticket error'); return { rowCount: 0, rows: [] }; });
  readonly release = vi.fn((discard?: boolean) => { this.releases.push(discard === true); });
  readonly query = vi.fn(async (sql: string, values: unknown[] = []) => {
    this.commands.push(sql);
    if (this.failAt && (this.failAt === 'COMMIT' ? sql === 'COMMIT' : sql.includes(this.failAt))) throw new Error('controlled SQL failure');
    if (sql === 'ROLLBACK' && this.rollbackGate) await this.rollbackGate;
    if (sql === 'ROLLBACK' && this.rollbackFails) throw new Error('controlled rollback failure');
    if (/^BEGIN\b/u.test(sql)) { this.originalSessions = structuredClone(this.sessions); this.originalReceipts = structuredClone(this.receipts); }
    if (sql === 'ROLLBACK') { this.sessions = this.originalSessions; this.receipts = this.originalReceipts; }
    if (/SELECT[\s\S]*FROM wujie_document_exchange_sessions[\s\S]*FOR UPDATE SKIP LOCKED/iu.test(sql)) {
      expect(sql).toMatch(/retain_until\s*<\s*statement_timestamp\(\)/iu);
      const count = Number(values[0]);
      const rows = this.sessions.filter(item => item.expired && !item.locked).slice(0, count).map(item => ({ session_hash: item.hash }));
      return { rows, rowCount: rows.length };
    }
    if (/DELETE FROM wujie_document_update_receipts/iu.test(sql)) {
      const selected = values[0] as string[], limit = Number(values[1]);
      expect(sql).toMatch(/LIMIT\s+\$2/iu);
      const candidates = this.receipts.filter(item => selected.includes(item.session)).sort((a,b) => a.session.localeCompare(b.session) || a.operation.localeCompare(b.operation)).slice(0, limit);
      const keys = new Set(candidates.map(item => `${item.session}:${item.operation}`));
      this.receipts = this.receipts.filter(item => !keys.has(`${item.session}:${item.operation}`));
      return { rows: [], rowCount: candidates.length };
    }
    if (/DELETE FROM wujie_document_exchange_sessions/iu.test(sql)) {
      const selected = values[0] as string[];
      expect(sql).toMatch(/NOT EXISTS/iu);
      const before = this.sessions.length;
      this.sessions = this.sessions.filter(item => !selected.includes(item.hash) || !item.expired || this.receipts.some(receipt => receipt.session === item.hash));
      return { rows: [], rowCount: before - this.sessions.length };
    }
    if (sql === 'COMMIT' && this.commitGate) await this.commitGate;
    return { rows: [], rowCount: 0 };
  });
  readonly connect = vi.fn(async () => ({ query: this.query, release: this.release }));
  pool() { return { query: this.queryTicket, connect: this.connect }; }
}
const s = (hash: string, expired = true, locked = false): Session => ({ hash, expired, locked });
const r = (session: string, count: number): Receipt[] => Array.from({ length: count }, (_, index) => ({ session, operation: String(index).padStart(4, '0') }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
let stop: (() => Promise<void>) | undefined;
beforeEach(() => { vi.useFakeTimers(); stop = undefined; });
afterEach(async () => { if (stop) await stop(); vi.useRealTimers(); });

describe('ticket maintenance integration with retained exchange cleanup (controlled SQL, no PG)', () => {
  it('actually removes an expired empty session and retains an unexpired one', async () => {
    const db = new ControlledSql([s('expired'), s('active', false)], []); boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50);
    await vi.advanceTimersByTimeAsync(50);
    expect(db.ticketCalls).toBe(1);
    expect(db.sessions.map(item => item.hash)).toEqual(['active']);
    expect(db.commands.slice(0, 3)).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', "SET LOCAL lock_timeout = '1000ms'", "SET LOCAL statement_timeout = '5000ms'"]);
    expect(db.commands.join('\n')).not.toMatch(/wujie_projects/iu);
  });
  it('bounds a cycle to eight unlocked sessions and 500 receipts in total', async () => {
    const db = new ControlledSql([s('locked', true, true), ...Array.from({ length: 10 }, (_, n) => s(`s${n}`))], [...r('s0', 300), ...r('s1', 300)]); boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50);
    await vi.advanceTimersByTimeAsync(50);
    expect(db.receipts).toHaveLength(100);
    expect(db.sessions.map(item => item.hash)).toEqual(['locked', 's1', 's8', 's9']);
    expect(db.commands.find(sql => /FOR UPDATE SKIP LOCKED/iu.test(sql))).toMatch(/ORDER BY[\s\S]*retain_until[\s\S]*session_hash/iu);
    expect(db.query.mock.calls.find(([sql]) => /FOR UPDATE SKIP LOCKED/iu.test(sql))?.[1]).toEqual([8]);
    expect(db.query.mock.calls.find(([sql]) => /DELETE FROM wujie_document_update_receipts/iu.test(sql))?.[1]).toEqual([['s0','s1','s2','s3','s4','s5','s6','s7'], 500]);
  });
  it('still runs exchange cleanup when ticket pruning fails', async () => {
    const db = new ControlledSql([s('expired')], []); db.ticketFails = true; boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50); await vi.advanceTimersByTimeAsync(50);
    expect(db.ticketCalls).toBe(1); expect(db.sessions).toEqual([]);
  });
  it('retries a previously locked session in a later cycle', async () => {
    const db = new ControlledSql([s('locked', true, true), s('active', false)], []); boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50); await vi.advanceTimersByTimeAsync(50);
    expect(db.sessions.map(item => item.hash)).toEqual(['locked', 'active']);
    db.sessions[0].locked = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(db.sessions.map(item => item.hash)).toEqual(['active']);
  });
  it('retains a session until bounded receipt batches have all completed', async () => {
    const db = new ControlledSql([s('expired')], r('expired', 3)); boundary.pool = db.pool();
    const first = await pruneExpiredDocumentExchangeSessions({ sessionBatchSize: 1, receiptBatchSize: 2 });
    expect(first).toEqual({ deletedSessions: 0, deletedReceipts: 2 });
    expect(db.sessions).toHaveLength(1); expect(db.receipts).toHaveLength(1);
    const second = await pruneExpiredDocumentExchangeSessions({ sessionBatchSize: 1, receiptBatchSize: 2 });
    expect(second).toEqual({ deletedSessions: 1, deletedReceipts: 1 });
    expect(db.sessions).toEqual([]); expect(db.receipts).toEqual([]);
    const statements = db.commands;
    expect(statements.findIndex(sql => /DELETE FROM wujie_document_update_receipts/iu.test(sql))).toBeLessThan(
      statements.findIndex(sql => /DELETE FROM wujie_document_exchange_sessions/iu.test(sql)));
  });
  it('rejects invalid maintenance budgets before acquiring a database client', async () => {
    const db = new ControlledSql([], []); boundary.pool = db.pool();
    for (const options of [{ sessionBatchSize: 9 }, { sessionBatchSize: 0 }, { receiptBatchSize: 501 }, { receiptBatchSize: 1.5 }]) {
      await expect(pruneExpiredDocumentExchangeSessions(options)).rejects.toThrow();
    }
    expect(db.connect).not.toHaveBeenCalled();
  });
  it('rolls back an exchange deletion failure and releases the client', async () => {
    const db = new ControlledSql([s('expired')], r('expired', 1)); db.failAt = 'DELETE FROM wujie_document_update_receipts'; boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50); await vi.advanceTimersByTimeAsync(50);
    expect(db.sessions).toHaveLength(1); expect(db.receipts).toHaveLength(1);
    expect(db.commands).toContain('ROLLBACK'); expect(db.releases).toEqual([false]);
  });
  it('discards the client if rollback fails', async () => {
    const db = new ControlledSql([s('expired')], r('expired', 1)); db.failAt = 'DELETE FROM wujie_document_update_receipts'; db.rollbackFails = true; boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50); await vi.advanceTimersByTimeAsync(50);
    expect(db.releases).toEqual([true]);
  });
  it.each([false, true])('discards after an unknown COMMIT even if rollback failure is %s', async rollbackFails => {
    const db = new ControlledSql([s('expired')], r('expired', 1)); db.failAt = 'COMMIT'; db.rollbackFails = rollbackFails; boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50); await vi.advanceTimersByTimeAsync(50);
    expect(db.commands).toContain('COMMIT'); expect(db.commands).toContain('ROLLBACK');
    expect(db.releases).toEqual([true]);
  });
  it('does not return deletion counts after an unknown COMMIT even if rollback succeeds', async () => {
    const db = new ControlledSql([s('expired')], r('expired', 1)); db.failAt = 'COMMIT'; boundary.pool = db.pool();
    await expect(pruneExpiredDocumentExchangeSessions()).rejects.toThrow('controlled SQL failure');
    expect(db.commands).toContain('COMMIT'); expect(db.commands).toContain('ROLLBACK');
    expect(db.releases).toEqual([true]);
  });
  it('stop awaits the actual rollback operation before releasing the client', async () => {
    const gate = deferred(); const db = new ControlledSql([s('expired')], r('expired', 1));
    db.failAt = 'DELETE FROM wujie_document_update_receipts'; db.rollbackGate = gate.promise; boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50); await vi.advanceTimersByTimeAsync(50);
    expect(db.commands).toContain('ROLLBACK');
    let done = false; const closing = stop().then(() => { done = true; }); stop = undefined;
    await Promise.resolve(); expect(done).toBe(false); expect(db.releases).toHaveLength(0);
    gate.resolve(); await closing; expect(done).toBe(true); expect(db.releases).toEqual([false]);
  });
  it('does not overlap cycles and stop waits for the original pending commit', async () => {
    const gate = deferred(); const db = new ControlledSql([s('expired')], []); db.commitGate = gate.promise; boundary.pool = db.pool();
    stop = startDocumentTicketMaintenance(50);
    await vi.advanceTimersByTimeAsync(50); await vi.advanceTimersByTimeAsync(150);
    expect(db.ticketCalls).toBe(1); expect(db.connect).toHaveBeenCalledTimes(1);
    let done = false; const closing = stop().then(() => { done = true; }); stop = undefined;
    await Promise.resolve(); expect(done).toBe(false); expect(db.releases).toHaveLength(0);
    gate.resolve(); await closing; expect(done).toBe(true); expect(db.releases).toEqual([false]);
  });
});

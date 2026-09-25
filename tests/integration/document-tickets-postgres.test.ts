import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { QueryFn } from '../helpers/postgres-test-database';

vi.mock('server-only', () => ({}));

const postgresIt = process.env.POSTGRES_TEST_DATABASE_URL?.trim() ? it : it.skip;

async function setupTicketDatabase(query: QueryFn): Promise<void> {
  for (const file of [
    '20260809_wj_core_users.sql',
    '20260810_wj_stable_s2_assets.sql',
    '20260925_yjs_canvas_editors.sql',
    '20260925_yjs_canvas_tickets.sql',
    '20260925_yjs_canvas_tickets_limits.sql',
  ]) {
    await query(await readFile(`migrations/${file}`, 'utf8'));
  }
  await query(`
    INSERT INTO wujie_users (id, name, password_hash, status, created_at, updated_at)
    VALUES ('owner-a', 'Owner A', 'test', 'active', 1, 1),
           ('editor-a', 'Editor A', 'test', 'active', 1, 1),
           ('presence-only', 'Presence', 'test', 'active', 1, 1)
  `);
  await query("INSERT INTO wujie_projects (id, owner_id, name) VALUES ('project-a', 'owner-a', 'A')");
  await query(`
    INSERT INTO wujie_project_document_editors
      (project_id, owner_id, member_user_id, status)
    VALUES ('project-a', 'owner-a', 'editor-a', 'active')
  `);
}

describe('independent canvas document tickets on isolated PostgreSQL', () => {
  postgresIt('caps concurrent outstanding tickets per editor and deletes consumed hashes', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-ticket-issuance-cap', async ({ query }) => {
      await setupTicketDatabase(query);
      const { issueDocumentTicket, consumeDocumentTicket } =
        await import('../../src/lib/collaboration/document-tickets');
      const attempts = await Promise.allSettled(Array.from({ length: 12 }, () =>
        issueDocumentTicket('editor-a', 'project-a')));
      const issued = attempts.filter((result): result is PromiseFulfilledResult<string> =>
        result.status === 'fulfilled').map(result => result.value);
      const refused = attempts.filter((result): result is PromiseRejectedResult =>
        result.status === 'rejected');
      expect(issued).toHaveLength(4);
      expect(refused).toHaveLength(8);
      expect(refused.map(result => (result.reason as { code?: string }).code))
        .toEqual(Array(8).fill('DOCUMENT_TICKET_LIMIT'));
      await expect(consumeDocumentTicket(issued[0])).resolves.toMatchObject({ userId: 'editor-a' });
      const consumedHash = createHash('sha256').update(issued[0]).digest('hex');
      expect((await query('SELECT 1 FROM wujie_document_tickets WHERE token_hash = $1', [consumedHash])).rowCount)
        .toBe(0);
      await expect(issueDocumentTicket('editor-a', 'project-a'))
        .resolves.toMatch(/^[A-Za-z0-9_-]{43}$/u);
      await query(
        `WITH sampled AS MATERIALIZED
           (SELECT clock_timestamp() - interval '1 minute' AS issued_at)
         UPDATE wujie_document_tickets ticket
            SET created_at = sampled.issued_at,
                expires_at = sampled.issued_at + interval '30 seconds'
           FROM sampled WHERE ticket.user_id = 'editor-a' AND ticket.project_id = 'project-a'`,
      );
      await expect(issueDocumentTicket('editor-a', 'project-a'))
        .resolves.toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect((await query(
        "SELECT 1 FROM wujie_document_tickets WHERE user_id = 'editor-a' AND project_id = 'project-a'",
      )).rowCount).toBe(1);
    });
  });

  postgresIt('prunes expired tickets in bounded batches while retaining live tickets', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-ticket-pruning', async ({ query }) => {
      await setupTicketDatabase(query);
      const { issueDocumentTicket, pruneExpiredDocumentTickets } =
        await import('../../src/lib/collaboration/document-tickets');
      const expired = await Promise.all([
        issueDocumentTicket('editor-a', 'project-a'),
        issueDocumentTicket('editor-a', 'project-a'),
      ]);
      const live = await issueDocumentTicket('owner-a', 'project-a');
      await query(
        `WITH sampled AS MATERIALIZED
           (SELECT clock_timestamp() - interval '6 minutes' AS issued_at)
         UPDATE wujie_document_tickets ticket
            SET created_at = sampled.issued_at,
                expires_at = sampled.issued_at + interval '30 seconds'
           FROM sampled WHERE ticket.token_hash = ANY($1::text[])`,
        [expired.map(value => createHash('sha256').update(value).digest('hex'))],
      );
      expect(await pruneExpiredDocumentTickets(1)).toBe(1);
      expect(await pruneExpiredDocumentTickets(1)).toBe(1);
      expect(await pruneExpiredDocumentTickets(1)).toBe(0);
      const remaining = await query<{ token_hash: string }>('SELECT token_hash FROM wujie_document_tickets');
      expect(remaining.rows.map(row => row.token_hash)).toEqual([
        createHash('sha256').update(live).digest('hex'),
      ]);
    });
  });

  postgresIt('refuses presence-only participants and expired document tickets', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-ticket-denials', async ({ query }) => {
      await setupTicketDatabase(query);
      const { issueDocumentTicket, consumeDocumentTicket } =
        await import('../../src/lib/collaboration/document-tickets');
      const { DocumentAccessError } = await import('../../src/lib/collaboration/document-access');
      await expect(issueDocumentTicket('presence-only', 'project-a'))
        .rejects.toBeInstanceOf(DocumentAccessError);
      const ticket = await issueDocumentTicket('editor-a', 'project-a');
      await query(
        `WITH sampled AS MATERIALIZED
           (SELECT clock_timestamp() - interval '31 seconds' AS issued_at)
         UPDATE wujie_document_tickets ticket
            SET created_at = sampled.issued_at,
                expires_at = sampled.issued_at + interval '30 seconds'
           FROM sampled WHERE ticket.token_hash = $1`,
        [createHash('sha256').update(ticket).digest('hex')],
      );
      await expect(consumeDocumentTicket(ticket)).resolves.toBeNull();
    });
  });

  postgresIt('stores only a 30-second hash-bound ticket and consumes it exactly once', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-ticket-once', async ({ query }) => {
      await setupTicketDatabase(query);
      const { issueDocumentTicket, consumeDocumentTicket } =
        await import('../../src/lib/collaboration/document-tickets');
      const ticket = await issueDocumentTicket('editor-a', 'project-a');
      expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      const hash = createHash('sha256').update(ticket).digest('hex');
      const stored = await query<{
        token_hash: string; user_id: string; project_id: string;
        grant_generation: string; lifetime_seconds: number; consumed_at: Date | null;
      }>(`
        SELECT token_hash, user_id, project_id, grant_generation::text,
               EXTRACT(EPOCH FROM expires_at - created_at)::float8 AS lifetime_seconds,
               consumed_at
          FROM wujie_document_tickets WHERE token_hash = $1
      `, [hash]);
      expect(stored.rows).toEqual([{
        token_hash: hash,
        user_id: 'editor-a',
        project_id: 'project-a',
        grant_generation: '1',
        lifetime_seconds: 30,
        consumed_at: null,
      }]);
      expect(JSON.stringify(stored.rows)).not.toContain(ticket);
      await expect(consumeDocumentTicket(ticket))
        .resolves.toEqual({
          userId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '1',
        });
      await expect(consumeDocumentTicket(ticket)).resolves.toBeNull();
    });
  });

  postgresIt('rejects an old ticket after revoke and regrant, even though the editor is active again', async () => {
    const { withIsolatedPostgres } = await import('../helpers/postgres-test-database');
    await withIsolatedPostgres('document-ticket-regrant', async ({ query }) => {
      await setupTicketDatabase(query);
      const { issueDocumentTicket, consumeDocumentTicket } =
        await import('../../src/lib/collaboration/document-tickets');
      const { grantDocumentEditor, revokeDocumentEditor } =
        await import('../../src/lib/collaboration/document-access');
      const oldTicket = await issueDocumentTicket('editor-a', 'project-a');
      await revokeDocumentEditor('owner-a', 'project-a', 'editor-a');
      await grantDocumentEditor('owner-a', 'project-a', 'editor-a');
      await expect(consumeDocumentTicket(oldTicket)).resolves.toBeNull();
      const newTicket = await issueDocumentTicket('editor-a', 'project-a');
      await expect(consumeDocumentTicket(newTicket))
        .resolves.toEqual({
          userId: 'editor-a', projectId: 'project-a', ownerId: 'owner-a', grantGeneration: '3',
        });
    });
  });
});

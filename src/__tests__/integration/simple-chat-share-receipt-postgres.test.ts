import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import { POST } from '@/app/api/simple-chat/share/route';

vi.mock('@/lib/server-auth', () => ({ getSessionUser: async () => ({ id: 'fixture-owner' }) }));

const testDatabase = process.env.SIMPLE_CHAT_SHARE_TEST_DATABASE_URL;
const postgresIt = testDatabase ? it : it.skip;

postgresIt('replays a committed share in PostgreSQL without adding rows or rewriting its snapshot', async () => {
  const url = new URL(testDatabase!);
  expect(url.protocol).toBe('postgresql:');
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.pathname).toMatch(/^\/simple_chat_share_test_[a-f0-9]+$/);
  vi.stubEnv('POSTGRES_TEST_DATABASE_URL', testDatabase);
  try {
    await withIsolatedPostgres('simple-chat-share-receipt', async ({ query }) => {
      const operation = randomUUID();
      const create = (title: string) => POST(new NextRequest('http://localhost/api/simple-chat/share', {
        method: 'POST',
        headers: { 'x-wujie-expected-actor-id': 'fixture-owner', 'idempotency-key': operation },
        body: JSON.stringify({ conversationId: 'fixture-task', title, messages: [{ role: 'user', content: 'Synthetic message' }] }),
      }));
      const lost = await create('Original title');
      expect(lost.status).toBe(200);
      const replays = await Promise.all(Array.from({ length: 5 }, () => create('Changed title')));
      const receipt = await lost.json();
      for (const replay of replays) {
        expect(replay.status).toBe(200);
        expect(await replay.json()).toEqual(receipt);
      }
      const rows = await query('SELECT id, user_id, title, messages FROM wujie_shared_conversations');
      expect(rows.rows).toEqual([{
        id: receipt.shareId, user_id: 'fixture-owner', title: 'Original title',
        messages: [{ role: 'user', content: 'Synthetic message' }],
      }]);
      await query('UPDATE wujie_shared_conversations SET expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [receipt.shareId]);
      expect((await create('Changed title')).status).toBe(410);
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

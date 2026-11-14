import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { withIsolatedPostgres } from '../../../tests/helpers/postgres-test-database';
import { POST } from '@/app/api/simple-chat/share/route';
import { DELETE, GET } from '@/app/api/simple-chat/share/[shareId]/route';

const auth = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock('@/lib/server-auth', () => auth);

const database = process.env.SIMPLE_CHAT_SHARE_TEST_DATABASE_URL;
const postgresIt = database ? it : it.skip;

postgresIt('preserves the public snapshot until its owner revokes it', async () => {
  const url = new URL(database!);
  expect(url.protocol).toBe('postgresql:');
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.port).toMatch(/^\d+$/u);
  expect(url.search).toBe('');
  expect(url.pathname).toMatch(/^\/simple_chat_share_test_[a-f0-9]+$/u);
  vi.stubEnv('POSTGRES_TEST_DATABASE_URL', database);
  try {
    await withIsolatedPostgres('simple-chat-share-revocation', async () => {
      const owner = { id: 'fixture-owner' };
      auth.getSessionUser.mockResolvedValue(owner);
      const created = await POST(new NextRequest('http://localhost/', {
        method: 'POST', headers: { 'x-wujie-expected-actor-id': owner.id, 'idempotency-key': randomUUID() },
        body: JSON.stringify({ conversationId: 'fixture', title: 'Local share', messages: [{ role: 'user', content: 'Synthetic text' }] }),
      }));
      expect(created.status).toBe(200);
      const { shareId } = await created.json() as { shareId: string };
      const params = { params: Promise.resolve({ shareId }) };
      const read = () => GET(new NextRequest('http://localhost/'), params);

      auth.getSessionUser.mockResolvedValue(null);
      expect(await (await read()).json()).toMatchObject({ title: 'Local share', messages: [{ role: 'user', content: 'Synthetic text' }] });
      auth.getSessionUser.mockResolvedValue(owner);
      expect((await DELETE(new NextRequest('http://localhost/', { method: 'DELETE' }), params)).status).toBe(200);
      expect((await read()).status).toBe(404);
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

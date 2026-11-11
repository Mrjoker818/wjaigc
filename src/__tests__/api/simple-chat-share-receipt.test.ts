import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execSql: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/db-client', () => ({ execSql: mocks.execSql, isDatabaseConfigured: () => true }));
vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.session }));

import { POST } from '@/app/api/simple-chat/share/route';
import { GET as readPublicShare } from '@/app/api/simple-chat/share/[shareId]/route';

const operation = '1f9e2e88-1a48-4f50-96ae-052f37ade134';
function request(actor = 'actor-a', title = 'First snapshot') {
  return new NextRequest('http://localhost/api/simple-chat/share', {
    method: 'POST',
    headers: { 'x-wujie-expected-actor-id': actor, 'idempotency-key': operation },
    body: JSON.stringify({ conversationId: 'task', title, messages: [{ role: 'user', content: 'test' }] }),
  });
}

const rows = new Map<unknown, unknown[]>();
let active = true;
beforeEach(() => {
  rows.clear();
  active = true;
  mocks.session.mockReset().mockResolvedValue({ id: 'actor-a' });
  mocks.execSql.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    const [id, conversationId, userId] = params;
    if (sql.includes('INSERT INTO')) {
      if (!rows.has(id) || !sql.includes('ON CONFLICT')) rows.set(id, params);
    }
    if (sql.includes('SELECT')) {
      const stored = rows.get(id);
      if (sql.includes('SELECT id, title, messages')) {
        return { rows: stored && active ? [{
          title: stored[3], messages: JSON.parse(String(stored[4])), created_at: '2026-11-11', view_count: 0,
        }] : [] };
      }
      return { rows: stored?.[1] === conversationId && stored?.[2] === userId ? [{ available: active }] : [] };
    }
    return { rows: [] };
  });
});

it('recovers a lost receipt across concurrent retries without replacing the published snapshot', async () => {
  const original = await POST(request()); // The browser never gets this receipt.
  expect(original.status).toBe(200);
  const [left, right] = await Promise.all([POST(request()), POST(request('actor-a', 'Edited title'))]);
  const receipt = await left.json();
  expect(receipt.shareUrl).toBe('/shared/' + receipt.shareId);
  expect(receipt).toEqual(await original.json());
  expect(await right.json()).toEqual(receipt);
  expect(rows.size).toBe(1);
  expect(rows.get(receipt.shareId)?.[3]).toBe('First snapshot');
});

it('scopes the same operation identifier to the authenticated owner', async () => {
  const first = await (await POST(request())).json();
  mocks.session.mockResolvedValue({ id: 'actor-b' });
  const second = await (await POST(request('actor-b'))).json();
  expect(second.shareId).not.toBe(first.shareId);
  expect(rows.get(first.shareId)?.[2]).toBe('actor-a');
  expect(rows.get(second.shareId)?.[2]).toBe('actor-b');
});

it('checks the authenticated actor before accessing share storage', async () => {
  expect((await POST(request('actor-b'))).status).toBe(409);
  mocks.session.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.execSql).not.toHaveBeenCalled();
});

it('never reactivates a revoked or expired share on replay', async () => {
  await POST(request());
  active = false;
  expect((await POST(request())).status).toBe(410);
  expect(rows.size).toBe(1);
});

it('keeps a recovered public link readable without a session and excludes owner metadata', async () => {
  await POST(request());
  const receipt = await (await POST(request())).json();
  mocks.session.mockClear().mockResolvedValue(null);
  const response = await readPublicShare(new NextRequest('http://localhost/api/simple-chat/share/' + receipt.shareId), {
    params: Promise.resolve({ shareId: receipt.shareId }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    title: 'First snapshot', messages: [{ role: 'user', content: 'test' }], createdAt: '2026-11-11', viewCount: 1,
  });
  expect(mocks.session).not.toHaveBeenCalled();
});

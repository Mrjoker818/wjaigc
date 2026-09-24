import { once } from 'node:events';

import { expect, test } from '@playwright/test';
import WebSocket from 'ws';

// A public share URL is a bearer token; never write it to browser artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function rejectedUpgradeStatus(client: WebSocket): Promise<number> {
  client.on('error', () => {});
  const [, response] = await once(client, 'unexpected-response');
  const rejected = response as { statusCode?: number; destroy(): void };
  rejected.destroy();
  return rejected.statusCode ?? 0;
}

function requireLocalGate(): { baseURL: string; ownerName: string; ownerPassword: string } {
  const baseURL = process.env.E2E_BASE_URL ?? '';
  const databaseURL = process.env.PGDATABASE_URL ?? '';
  const dataRoot = process.env.WUJIE_DATA_DIR ?? '';
  const ownerName = process.env.E2E_PRESENCE_OWNER_NAME ?? '';
  const ownerPassword = process.env.E2E_PRESENCE_OWNER_PASSWORD ?? '';
  const base = new URL(baseURL);
  const database = new URL(databaseURL);
  if (base.hostname !== '127.0.0.1' || database.hostname !== '127.0.0.1'
    || !database.pathname.startsWith('/wujie_presence_task6_')
    || !dataRoot.includes('_tmp_e2e') || !ownerName || !ownerPassword) {
    throw new Error('Anonymous-share presence gate requires isolated localhost settings');
  }
  return { baseURL, ownerName, ownerPassword };
}

test('a valid public share cannot obtain a presence ticket while ordinary HTTP still works', async ({ browser }) => {
  test.skip(process.env.E2E_PRESENCE_SHARE_GATE !== '1', 'Requires an isolated share-enabled presence server');
  test.setTimeout(90_000);
  const gate = requireLocalGate();
  const ownerContext = await browser.newContext({ baseURL: gate.baseURL });
  const anonymousContext = await browser.newContext({ baseURL: gate.baseURL });
  let shareId = '';
  let pageErrorCount = 0;
  let ownerSocket: WebSocket | null = null;

  try {
    const login = await ownerContext.request.post('/api/auth/login', {
      data: { name: gate.ownerName, password: gate.ownerPassword, productType: 'canvas' },
    });
    expect(login.status()).toBe(200);

    const ownerPage = await ownerContext.newPage();
    ownerPage.on('pageerror', () => { pageErrorCount += 1; });
    await ownerPage.goto('/?view=dashboard');
    await ownerPage.getByRole('button', { name: '新建项目' }).click();
    const projectId = await ownerPage.locator('[data-canvas-viewport]').getAttribute('data-project-id') ?? '';
    expect(projectId).toBeTruthy();
    await expect.poll(async () => {
      const response = await ownerContext.request.get('/api/user-data/sync?key=projects');
      if (!response.ok()) return [];
      const body = await response.json() as { value?: Array<{ id: string }> };
      return body.value?.map(project => project.id) ?? [];
    }).toContain(projectId);

    const preflight = await ownerContext.request.post('/api/canvas-shares/preflight', {
      headers: { origin: gate.baseURL }, data: { projectId },
    });
    const preflightBody = await preflight.json() as { readiness?: { ready: boolean } };
    expect(preflight.status(), JSON.stringify(preflightBody)).toBe(200);
    expect(preflightBody.readiness?.ready).toBe(true);

    const created = await ownerContext.request.post('/api/canvas-shares', {
      headers: { origin: gate.baseURL }, data: { projectId, title: 'Presence isolation gate' },
    });
    expect(created.status()).toBe(201);
    const share = await created.json() as { shareId: string; shareUrl: string };
    shareId = share.shareId;
    const token = new URL(share.shareUrl).pathname.split('/').at(-1) ?? '';
    expect(/^[A-Za-z0-9_-]{43,128}$/u.test(token)).toBe(true);

    const ownerTicket = await ownerContext.request.post('/api/collaboration/presence-ticket', {
      headers: { origin: gate.baseURL }, data: { projectId },
    });
    expect(ownerTicket.status()).toBe(200);
    const { ticket: validTicket } = await ownerTicket.json() as { ticket: string };
    const socketURL = new URL('/api/collaboration/presence', gate.baseURL);
    socketURL.protocol = 'ws:';
    ownerSocket = new WebSocket(socketURL, ['wujie-presence-v1', `wujie-ticket.${validTicket}`], {
      origin: gate.baseURL,
    });
    ownerSocket.on('error', () => {});
    const [ownerFrame] = await once(ownerSocket, 'message');
    expect((JSON.parse(String(ownerFrame)) as { projectId: string }).projectId).toBe(projectId);
    ownerSocket.close();

    const anonymousUpgrade = new WebSocket(socketURL, ['wujie-presence-v1', `wujie-ticket.${token}`], {
      origin: gate.baseURL,
    });
    expect(await rejectedUpgradeStatus(anonymousUpgrade)).toBe(401);

    const anonymousPage = await anonymousContext.newPage();
    anonymousPage.on('pageerror', () => { pageErrorCount += 1; });
    const anonymousSockets: string[] = [];
    anonymousPage.on('websocket', socket => anonymousSockets.push(socket.url()));
    let sharePageStage = 'navigation';
    let presenceStatusCount = -1;
    try {
      await anonymousPage.goto(share.shareUrl);
      sharePageStage = 'heading';
      await anonymousPage.getByRole('heading', { name: 'Presence isolation gate' }).waitFor({ state: 'visible' });
      sharePageStage = 'presence-status';
      presenceStatusCount = await anonymousPage.getByRole('status', { name: '在线状态' }).count();
      sharePageStage = 'complete';
    } catch {
      // Report only the failed stage; Playwright navigation errors may contain the bearer URL.
    } finally {
      await anonymousPage.close().catch(() => {});
    }
    expect(sharePageStage).toBe('complete');
    expect(presenceStatusCount).toBe(0);
    expect(anonymousSockets).toEqual([]);

    let publicStatus = 0;
    try {
      publicStatus = (await anonymousContext.request.get(`/api/public/canvas-shares/${token}`)).status();
    } catch {
      // Do not surface a token-bearing request URL in the reporter.
    }
    expect(publicStatus).toBe(200);

    const ticket = await anonymousContext.request.post('/api/collaboration/presence-ticket', {
      headers: { origin: gate.baseURL }, data: { projectId },
    });
    expect(ticket.status()).toBe(401);
    expect(await ticket.json()).toEqual({ success: false, code: 'AUTHENTICATION_REQUIRED' });
    expect((await ownerContext.request.get('/')).status()).toBe(200);
    expect((await ownerContext.request.get('/api/session')).status()).toBe(200);
    const staticScript = await ownerPage.locator('script[src^="/_next/static/"]').first().getAttribute('src');
    expect(staticScript).toBeTruthy();
    expect((await ownerContext.request.get(staticScript!)).status()).toBe(200);
    expect(pageErrorCount).toBe(0);
    const revoked = await ownerContext.request.post(`/api/canvas-shares/${shareId}/revoke`, {
      headers: { origin: gate.baseURL }, data: {},
    });
    expect(revoked.status()).toBe(200);
    shareId = '';
  } finally {
    ownerSocket?.terminate();
    try {
      if (shareId) {
        const cleanup = await ownerContext.request.post(`/api/canvas-shares/${shareId}/revoke`, {
          headers: { origin: gate.baseURL }, data: {},
        });
        if (cleanup.status() !== 200) throw new Error('Disposable canvas share revocation failed');
      }
    } finally {
      await Promise.all([anonymousContext.close(), ownerContext.close()]);
    }
  }
});

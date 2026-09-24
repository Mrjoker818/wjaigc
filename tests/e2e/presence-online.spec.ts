import { expect, test, type Page } from '@playwright/test';

const localGate = process.env.E2E_PRESENCE_LOCAL_GATE === '1';

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
    throw new Error('Presence browser gate requires explicit isolated localhost settings');
  }
  return { baseURL, ownerName, ownerPassword };
}

async function connectGuestPresence(page: Page, projectId: string): Promise<{
  projectId: string;
  participants: Array<{ userId: string }>;
}> {
  return page.evaluate(async targetProjectId => {
    const response = await fetch('/api/collaboration/presence-ticket', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: targetProjectId }),
    });
    if (!response.ok) throw new Error(`ticket status ${response.status}`);
    const { ticket } = await response.json() as { ticket: string };
    const url = new URL('/api/collaboration/presence', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new Promise<{ projectId: string; participants: Array<{ userId: string }> }>((resolve, reject) => {
      const socket = new WebSocket(url.href, ['wujie-presence-v1', `wujie-ticket.${ticket}`]);
      const probe = window as typeof window & {
        __presenceTestSocket?: WebSocket;
        __presenceTestClosed?: boolean;
        __presenceTestLatest?: { projectId: string; participants: Array<{ userId: string }> };
      };
      probe.__presenceTestSocket = socket;
      probe.__presenceTestClosed = false;
      socket.onmessage = event => {
        const snapshot = JSON.parse(String(event.data)) as {
          projectId: string;
          participants: Array<{ userId: string }>;
        };
        probe.__presenceTestLatest = snapshot;
        resolve(snapshot);
      };
      socket.onerror = () => reject(new Error('guest socket failed'));
      socket.onclose = () => { probe.__presenceTestClosed = true; };
    });
  }, projectId);
}

test('two browser accounts converge on one project presence roster and revocation', async ({ browser }) => {
  test.skip(!localGate, 'Only run with an explicit isolated PostgreSQL presence gate');
  test.setTimeout(150_000);
  const gate = requireLocalGate();
  const ownerContext = await browser.newContext({ baseURL: gate.baseURL, viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ baseURL: gate.baseURL, viewport: { width: 375, height: 667 } });
  const ownerPage = await ownerContext.newPage();
  const guestPage = await guestContext.newPage();
  const pageErrors: string[] = [];
  const socketURLs: string[] = [];
  for (const page of [ownerPage, guestPage]) {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('websocket', socket => socketURLs.push(socket.url()));
  }
  const runTag = Date.now().toString(36);
  const guestName = `presence-guest-${runTag}`;
  const guestPassword = `Presence-${runTag}-test-only`;
  let projectId = '';
  let guestId = '';

  try {
    const ownerLogin = await ownerContext.request.post('/api/auth/login', {
      data: { name: gate.ownerName, password: gate.ownerPassword, productType: 'canvas' },
    });
    expect(ownerLogin.status()).toBe(200);
    const createdUser = await ownerContext.request.post('/api/admin/users', {
      data: { action: 'create', name: guestName, password: guestPassword },
    });
    expect(createdUser.status()).toBe(200);
    guestId = ((await createdUser.json()) as { user?: { id?: string } }).user?.id ?? '';
    expect(guestId).toBeTruthy();

    await ownerPage.goto('/?view=dashboard');
    await ownerPage.getByRole('button', { name: '新建项目' }).click();
    const viewport = ownerPage.locator('[data-canvas-viewport]');
    await expect(viewport).toBeVisible();
    projectId = await viewport.getAttribute('data-project-id') ?? '';
    expect(projectId).toBeTruthy();
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('1 人在线');

    await ownerPage.getByRole('button', { name: '管理在线成员' }).click();
    await ownerPage.getByLabel('成员用户 ID').fill(guestId);
    await ownerPage.getByRole('button', { name: '邀请成员' }).click();
    await expect(ownerPage.getByText(guestName, { exact: true })).toBeVisible();
    await ownerPage.getByRole('button', { name: '关闭在线成员面板' }).click();

    const guestLogin = await guestContext.request.post('/api/auth/login', {
      data: { name: guestName, password: guestPassword, productType: 'canvas' },
    });
    expect(guestLogin.status()).toBe(200);
    await guestPage.goto('/');
    const guestSnapshot = await connectGuestPresence(guestPage, projectId);
    expect(guestSnapshot.projectId).toBe(projectId);
    expect(guestSnapshot.participants.some(person => person.userId === guestId)).toBe(true);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('2 人在线');

    await guestPage.evaluate(() => {
      (window as typeof window & { __presenceTestSocket?: WebSocket }).__presenceTestSocket?.close();
    });
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('1 人在线');
    await connectGuestPresence(guestPage, projectId);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('2 人在线');

    // A project switch must leave the old room before joining the next one.
    await ownerPage.locator('button[title="工作台"]').click();
    await expect(ownerPage.getByRole('button', { name: '新建项目' })).toBeVisible();
    await expect.poll(() => guestPage.evaluate(() => (
      window as typeof window & { __presenceTestLatest?: { participants: unknown[] } }
    ).__presenceTestLatest?.participants.length)).toBe(1);
    await ownerPage.getByRole('button', { name: '新建项目' }).click();
    const secondProjectId = await viewport.getAttribute('data-project-id') ?? '';
    expect(secondProjectId).toBeTruthy();
    expect(secondProjectId).not.toBe(projectId);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('1 人在线');
    const crossProjectTicketStatus = await guestPage.evaluate(async targetProjectId => {
      const response = await fetch('/api/collaboration/presence-ticket', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: targetProjectId }),
      });
      return response.status;
    }, secondProjectId);
    expect(crossProjectTicketStatus).toBe(403);
    await expect.poll(() => guestPage.evaluate(() => (
      window as typeof window & { __presenceTestLatest?: { projectId: string; participants: unknown[] } }
    ).__presenceTestLatest)).toMatchObject({ projectId, participants: [{ userId: guestId }] });

    await ownerPage.goto(`/?projectId=${encodeURIComponent(projectId)}`);
    await expect(viewport).toHaveAttribute('data-project-id', projectId);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('2 人在线');
    await expect.poll(async () => {
      const response = await ownerContext.request.get('/api/user-data/sync?key=projects');
      if (!response.ok()) return [];
      const body = await response.json() as { value?: Array<{ id: string }> };
      return body.value?.map(project => project.id) ?? [];
    }).toEqual(expect.arrayContaining([projectId, secondProjectId]));
    await ownerPage.reload();
    await expect(viewport).toHaveAttribute('data-project-id', projectId);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('2 人在线');
    const reloadedProjects = await ownerContext.request.get('/api/user-data/sync?key=projects');
    expect(reloadedProjects.status()).toBe(200);
    const reloadedBody = await reloadedProjects.json() as { value?: Array<{ id: string }> };
    expect(reloadedBody.value?.map(project => project.id)).toEqual(expect.arrayContaining([projectId, secondProjectId]));

    await ownerPage.goto(`/?projectId=${encodeURIComponent(secondProjectId)}`);
    await expect(viewport).toHaveAttribute('data-project-id', secondProjectId);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('1 人在线');
    await ownerPage.goto(`/?projectId=${encodeURIComponent(projectId)}`);
    await expect(viewport).toHaveAttribute('data-project-id', projectId);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('2 人在线');

    await ownerPage.getByRole('button', { name: '管理在线成员' }).click();
    await ownerPage.getByRole('button', { name: `撤销${guestName}的在线资格` }).click();
    await guestPage.waitForFunction(() => (window as typeof window & { __presenceTestClosed?: boolean }).__presenceTestClosed === true);
    await expect(ownerPage.getByRole('status', { name: '在线状态' })).toContainText('1 人在线');

    for (const width of [320, 375, 393]) {
      await ownerPage.setViewportSize({ width, height: 667 });
      const menuBounds = await ownerPage.locator('[data-canvas-project-menu]').boundingBox();
      expect(menuBounds).not.toBeNull();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
      const statusSnapshot = await ownerPage.getByRole('status', { name: '在线状态' }).ariaSnapshot();
      expect(statusSnapshot).toContain('1 人在线');
      const dialogBounds = await ownerPage.getByRole('dialog', { name: '项目在线成员' }).boundingBox();
      expect(dialogBounds).not.toBeNull();
      expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(width);
    }
    expect(socketURLs.length).toBeGreaterThanOrEqual(3);
    expect(socketURLs.every(url => new URL(url).pathname === '/api/collaboration/presence'
      && !new URL(url).search)).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await guestContext.close();
    await ownerContext.close();
  }
});

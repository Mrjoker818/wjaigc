import { expect, test } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';
import { waitForAuthenticatedSessionForAction, type ExpectedPrincipal } from '../helpers/v588-auth-task-9';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const userId = process.env.E2E_TEST_ID;
const userRole = process.env.E2E_TEST_ROLE;

function requireTestAccount(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
    ['E2E_TEST_ID', userId],
    ['E2E_TEST_ROLE', userRole],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`A real test account is required. Missing: ${missing.join(', ')}`);
  if (userRole !== 'admin' && userRole !== 'user') {
    throw new Error('E2E_TEST_ROLE must be admin or user');
  }
}

function expectedPrincipal(): ExpectedPrincipal {
  return { id: userId!, name: username!, role: userRole as 'admin' | 'user' };
}

test.describe('P0 authenticated session', () => {
  test('a user can log in, refresh the session, and log out without an audit 401', async ({ page }, testInfo) => {
    requireTestAccount();
    const evidence = collectBrowserEvidence(page);
    try {
      const context = page.context();
      await context.clearCookies();
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.removeItem('unbounded_ai_current_user');
        localStorage.removeItem('unbounded_ai_user_data');
      });
      await page.getByRole('button', { name: /无限画布/ }).first().click();
      await page.getByPlaceholder('请输入用户名').fill(username!);
      await page.getByPlaceholder('请输入密码').fill(password!);
      const loginResponse = page.waitForResponse((response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
      const [response] = await Promise.all([
        loginResponse,
        waitForAuthenticatedSessionForAction(
          page,
          expectedPrincipal(),
          'p0-correct-login',
          () => page.getByRole('button', { name: '登录' }).click(),
        ),
      ]);
      expect(response.ok(), `Login request failed with ${response.status()}`).toBeTruthy();
      await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 15_000 });

      await waitForAuthenticatedSessionForAction(
        page,
        expectedPrincipal(),
        'p0-dashboard-refresh',
        () => page.reload({ waitUntil: 'domcontentloaded' }),
      );
      await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });

      await page.getByTitle('查看用户信息').click();
      const logoutResponse = page.waitForResponse(response => (
        new URL(response.url()).pathname === '/api/auth/logout'
        && response.request().method() === 'POST'
      ));
      const [logout] = await Promise.all([
        logoutResponse,
        page.getByRole('button', { name: '退出登录' }).click(),
      ]);
      expect(logout.status()).toBe(200);
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      await expect.poll(
        () => evidence.network.some((entry) => entry.url.includes('/api/activity') && (entry.status || 0) >= 400),
        { timeout: 5_000 },
      ).toBe(false);
      // Filter out browser-level resource loading errors and WebKit keepalive limits
      // which are expected during session teardown and SSE connection cleanup.
      const tolerable = [
        /^Failed to load resource/,
        /Reached maximum amount of queued data/, // WebKit keepalive limit for SSE
        /task-events/i, // SSE connection interrupted on page unload
        /connection.*interrupted/i,
      ];
      expect(evidence.console.filter((entry) =>
        entry.type === 'error' && !tolerable.some((p) => p.test(entry.text)),
      )).toEqual([]);
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-auth-session');
    }
  });
});

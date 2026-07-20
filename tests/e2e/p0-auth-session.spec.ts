import { expect, test } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;

function requireTestAccount(): void {
  const missing = [
    ['E2E_TEST_USERNAME', username],
    ['E2E_TEST_PASSWORD', password],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new Error(`A real test account is required. Missing: ${missing.join(', ')}`);
}

test.describe('P0 authenticated session', () => {
  test('a user can log in, refresh the session, and log out without an audit 401', async ({ page }, testInfo) => {
    requireTestAccount();
    const evidence = collectBrowserEvidence(page);
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /无限画布/ }).first().click();
      await page.getByPlaceholder('请输入用户名').fill(username!);
      await page.getByPlaceholder('请输入密码').fill(password!);
      const loginResponse = page.waitForResponse((response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '登录' }).click();
      const response = await loginResponse;
      expect(response.ok(), `Login request failed with ${response.status()}`).toBeTruthy();
      const payload = await response.json() as { success?: boolean; user?: { id?: string } };
      expect(payload.success && payload.user?.id, 'Login response did not contain an authenticated user').toBeTruthy();
      await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();

      await page.getByTitle('查看用户信息').click();
      await page.getByRole('button', { name: '退出登录' }).click();
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      await expect.poll(
        () => evidence.network.some((entry) => entry.url.includes('/api/activity') && (entry.status || 0) >= 400),
        { timeout: 5_000 },
      ).toBe(false);
      // Filter out browser-level resource loading errors (e.g. "Failed to load resource: 401")
      // which are expected when the session cookie is cleared during logout.
      // We only care about application-level console.error() calls.
      expect(evidence.console.filter((entry) =>
        entry.type === 'error' && !entry.text.startsWith('Failed to load resource'),
      )).toEqual([]);
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-auth-session');
    }
  });
});

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
      await page.getByRole('button', { name: '登录' }).click();
      const response = await loginResponse;
      expect(response.ok(), `Login request failed with ${response.status()}`).toBeTruthy();
      // WebKit may discard response body after navigation; parse defensively
      let payload: { success?: boolean; user?: { id?: string } } = {};
      try {
        payload = await response.json() as { success?: boolean; user?: { id?: string } };
      } catch {
        // Body was discarded by browser — verify via UI state instead
      }
      const loginVerified = payload.success && payload.user?.id;
      if (!loginVerified) {
        // Fallback: verify login succeeded by checking if dashboard appears
        await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 15_000 });
      }

      // Use domcontentloaded (not networkidle — SSE connections prevent networkidle)
      await page.reload({ waitUntil: 'domcontentloaded' });
      // Wait for the app to either show dashboard (session restored) or entry selection
      await page.waitForTimeout(3000);
      // If the app shows the entry-selection page, click "无限画布" to proceed to dashboard
      const entryBtn = page.getByRole('button', { name: /无限画布/ }).first();
      if (await entryBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await entryBtn.click();
      }
      await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });

      await page.getByTitle('查看用户信息').click();
      await page.getByRole('button', { name: '退出登录' }).click();
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

import { expect, test } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

test.describe('P0 login entry contract', () => {
  test('an anonymous visitor can choose the canvas entrance and toggle password visibility', async ({ context, page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    try {
      await context.clearCookies();
      await page.route('**/api/session', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, user: null }),
        });
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      await expect(page.getByRole('button', { name: '图像生成器' })).toHaveCount(0);
      const canvasEntry = page.getByRole('button', { name: /无限画布/ });
      await expect(canvasEntry).toHaveAttribute('type', 'button');
      const entryUrl = page.url();
      await canvasEntry.click();

      await expect(page).toHaveURL(entryUrl);
      await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
      await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
      const passwordInput = page.getByPlaceholder('请输入密码');
      const showPasswordButton = page.getByRole('button', { name: '显示密码' });
      await passwordInput.fill('regression-secret');
      await expect(passwordInput).toHaveAttribute('type', 'password');
      await expect(showPasswordButton).toHaveAttribute('type', 'button');

      await showPasswordButton.click();
      await expect(passwordInput).toHaveAttribute('type', 'text');
      await expect(passwordInput).toHaveValue('regression-secret');

      await page.getByRole('button', { name: '隐藏密码' }).click();
      await expect(passwordInput).toHaveAttribute('type', 'password');
      await expect(passwordInput).toHaveValue('regression-secret');
      await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();

      await page.getByTitle('返回选择模式').click();
      await expect(page).toHaveURL(entryUrl);
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-login-ui-contract');
    }
  });

  test('an anonymous visitor can choose the chat entrance', async ({ context, page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    try {
      await context.clearCookies();
      await page.route('**/api/session', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, user: null }),
        });
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      const chatEntry = page.getByRole('button', { name: /智能对话/ });
      await expect(chatEntry).toHaveAttribute('type', 'button');
      const entryUrl = page.url();
      await chatEntry.click();

      await expect(page).toHaveURL(entryUrl);
      await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
      await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
      await expect(page.getByPlaceholder('请输入密码')).toBeVisible();
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-login-chat-entry');
    }
  });
});

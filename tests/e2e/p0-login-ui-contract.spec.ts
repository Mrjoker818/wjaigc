import { expect, test } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

test.describe('P0 login entry contract', () => {
  test('an anonymous visitor can choose the canvas entrance and reach the login form', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
      await page.getByRole('button', { name: /无限画布/ }).first().click();
      await expect(page.getByRole('heading', { name: '登录' })).toBeVisible();
      await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
      await expect(page.getByPlaceholder('请输入密码')).toBeVisible();
    } finally {
      await saveBrowserEvidence(page, testInfo, evidence, 'p0-login-ui-contract');
    }
  });
});

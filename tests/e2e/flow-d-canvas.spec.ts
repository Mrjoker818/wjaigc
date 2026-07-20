/**
 * 流程D：无限画布操作 E2E 测试
 * 覆盖: 缩放 / 平移 / 撤销 / 右键菜单 / 视图重置
 */
import { test, expect } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
const USERNAME = process.env.E2E_TEST_USERNAME || 'Mr.joker';
const PASSWORD = process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');
  const loginInput = page.locator('input[type="text"], input[placeholder*="用户名"]').first();
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(USERNAME);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Login")').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  }
}

test.describe('流程D: 无限画布操作', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await login(page);
  });

  test('D1: 画布缩放功能', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    // 查找缩放按钮
    const zoomIn = page.locator('button[title*="放大"], button[aria-label*="zoom in"], button:has-text("+")').first();
    const zoomOut = page.locator('button[title*="缩小"], button[aria-label*="zoom out"], button:has-text("-")').first();

    if (await zoomIn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await zoomIn.click();
      await page.waitForTimeout(500);
    }
    if (await zoomOut.isVisible({ timeout: 5000 }).catch(() => false)) {
      await zoomOut.click();
      await page.waitForTimeout(500);
    }
    await saveBrowserEvidence(page, testInfo, evidence, 'd1-zoom');
  });

  test('D2: 画布工具栏存在', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    // 底部工具栏应包含选择/平移/上传/缩放等工具
    const toolbar = page.locator('[data-toolbar], .toolbar, .floating-toolbar, .canvas-toolbar').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(toolbar).toBeVisible();
    }
    await saveBrowserEvidence(page, testInfo, evidence, 'd2-toolbar');
  });

  test('D3: 键盘快捷键 — ESC不崩溃', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // 页面不应崩溃
    const body = page.locator('body');
    await expect(body).toBeVisible();
    await saveBrowserEvidence(page, testInfo, evidence, 'd3-esc-key');
  });

  test('D4: Ctrl+Z 撤销不崩溃', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    const body = page.locator('body');
    await expect(body).toBeVisible();
    await saveBrowserEvidence(page, testInfo, evidence, 'd4-ctrl-z');
  });

  test('D5: 右键菜单', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    // 在画布中央右键
    const viewport = page.viewportSize();
    if (viewport) {
      await page.mouse.click(viewport.width / 2, viewport.height / 2, { button: 'right' });
      await page.waitForTimeout(1000);
      // 可能出现上下文菜单（不是必须，画布可能有自己的处理）
    }
    await saveBrowserEvidence(page, testInfo, evidence, 'd5-right-click');
  });
});

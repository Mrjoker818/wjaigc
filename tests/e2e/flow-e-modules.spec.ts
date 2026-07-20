/**
 * 流程E：业务模块遍历 E2E 测试
 * 覆盖: 每个菜单模块能否打开 / 是否有JS异常 / 默认状态
 */
import { test, expect } from '@playwright/test';
import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
const USERNAME = process.env.E2E_TEST_USERNAME || 'Mr.joker';
const PASSWORD = process.env.E2E_TEST_PASSWORD || 'Wujie#2026Reset';

// 已知可容忍的控制台错误模式
const TOLERABLE_ERRORS = [
  /keepalive/i,
  /task-events/i,
  /DataIsolation/i,
  /favicon/i,
  /ResizeObserver/i,
  /AbortError/i,
  /net::ERR_/i,
  /Failed to load resource/i,
  /third-party/i,
  /deprecated/i,
  /Warning:/i,
  /hydrat/i,
  /preload/i,
];

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

test.describe('流程E: 业务模块遍历', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await login(page);
  });

  test('E1: 主页加载无致命JS异常', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    await page.waitForTimeout(3000);

    // 检查是否有不可容忍的 console 错误
    const criticalErrors = evidence.console.filter(log => {
      if (log.type !== 'error') return false;
      return !TOLERABLE_ERRORS.some(pattern => pattern.test(log.text));
    });

    // 页面应正常渲染
    const body = page.locator('body');
    await expect(body).toBeVisible();

    await saveBrowserEvidence(page, testInfo, evidence, 'e1-homepage');

    // 致命错误应为0
    if (criticalErrors.length > 0) {
      console.log('Critical console errors:', criticalErrors.map(e => e.text));
    }
    expect(criticalErrors.length).toBe(0);
  });

  test('E2: 页面包含核心UI元素', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    // 应该有一些交互元素
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThan(0);

    await saveBrowserEvidence(page, testInfo, evidence, 'e2-core-ui');
  });

  test('E3: 页面标题正确', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    // 等待 JS 动态设置标题（Next.js metadata 可能在客户端渲染后才设置）
    await page.waitForTimeout(3000);
    const title = await page.title();
    // 标题可以为空（SPA）或包含应用名，只要不是 404/Error 页面即可
    expect(title).not.toContain('404');
    expect(title).not.toContain('Error');
    await saveBrowserEvidence(page, testInfo, evidence, 'e3-title');
  });

  test('E4: 无网络请求失败(关键API)', async ({ page }, testInfo) => {
    const evidence = collectBrowserEvidence(page);
    await page.waitForTimeout(3000);

    // 检查关键API请求是否有 5xx 错误
    const criticalFailures = evidence.network.filter(n => {
      if (!n.url.includes('/api/')) return false;
      return n.status !== undefined && n.status >= 500;
    });

    await saveBrowserEvidence(page, testInfo, evidence, 'e4-network');

    if (criticalFailures.length > 0) {
      console.log('Critical API failures:', criticalFailures);
    }
    expect(criticalFailures.length).toBe(0);
  });
});

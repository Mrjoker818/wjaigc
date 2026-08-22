import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const username = process.env.E2E_TEST_USERNAME;
const password = process.env.E2E_TEST_PASSWORD;
const fixtureBuffer = readFileSync(resolve(process.cwd(), 'tests/fixtures/annotation-source.png'));

const viewports = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 900 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const;
const runtimeEvidence = new WeakMap<Page, { console: string[]; network: string[] }>();

test.use({ trace: 'on', video: 'on', screenshot: 'only-on-failure' });
test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  const evidence = { console: [] as string[], network: [] as string[] };
  runtimeEvidence.set(page, evidence);
  page.on('console', message => {
    evidence.console.push(`${new Date().toISOString()} ${message.type()} ${message.text()}`);
  });
  page.on('response', response => {
    evidence.network.push([
      new Date().toISOString(),
      response.status(),
      response.request().method(),
      response.url(),
    ].join(' '));
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const evidence = runtimeEvidence.get(page);
  if (!evidence) return;
  const evidenceName = testInfo.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-');
  const consolePath = resolve(process.cwd(), 'test-results', 'console', `v588-ui004-${evidenceName}.log`);
  const networkPath = resolve(process.cwd(), 'test-results', 'network', `v588-ui004-${evidenceName}.log`);
  mkdirSync(resolve(process.cwd(), 'test-results', 'console'), { recursive: true });
  mkdirSync(resolve(process.cwd(), 'test-results', 'network'), { recursive: true });
  writeFileSync(consolePath, evidence.console.join('\n') || 'NO_CONSOLE_MESSAGES', 'utf8');
  writeFileSync(networkPath, evidence.network.join('\n') || 'NO_NETWORK_RESPONSES', 'utf8');
  await testInfo.attach('console.log', {
    path: consolePath,
    contentType: 'text/plain',
  });
  await testInfo.attach('network.log', {
    path: networkPath,
    contentType: 'text/plain',
  });
});

async function loginAndCreateProject(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
  const canvasEntry = page.getByRole('button', { name: /^无限画布/ });
  const usernameInput = page.getByPlaceholder('请输入用户名');
  await expect(async () => {
    await canvasEntry.click();
    await expect(usernameInput).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000, intervals: [100, 250, 500] });
  await usernameInput.fill(username!);
  await page.getByPlaceholder('请输入密码').fill(password!);
  const loginResponse = page.waitForResponse(response => (
    response.url().includes('/api/auth/login') && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: /^登录$/ }).click();
  expect((await loginResponse).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const canvas = page.locator('[data-canvas-viewport]');
  const opened = await canvas.waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) await page.getByText('未命名项目', { exact: true }).last().click();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Compiling', { exact: true })).toBeHidden({ timeout: 120_000 });
  await setRightPanelCollapsed(page, true);
}

function canvasImages(page: Page): Locator {
  return page.locator('[data-canvas-viewport] [data-canvas-image-id]');
}

async function uploadAndSelectImage(page: Page): Promise<void> {
  const images = canvasImages(page);
  const before = await images.count();
  await expect(async () => {
    await page.getByTestId('canvas-image-upload-input').setInputFiles({
      name: 'v588-ui004-layout-source.png',
      mimeType: 'image/png',
      buffer: fixtureBuffer,
    });
    await expect.poll(() => images.count(), { timeout: 8_000 }).toBeGreaterThan(before);
  }).toPass({ timeout: 90_000, intervals: [250, 500, 1_000] });
  await images.last().click();
  await expect(page.locator('[data-toolbar="image-action-toolbar"]')).toBeVisible();
}

async function setRightPanelCollapsed(page: Page, collapsed: boolean): Promise<void> {
  const collapse = page.getByRole('button', { name: '收起面板', exact: true });
  const expand = page.getByRole('button', { name: '展开面板', exact: true });
  if (collapsed && await collapse.isVisible().catch(() => false)) await collapse.click();
  if (!collapsed && await expand.isVisible().catch(() => false)) await expand.click();
  await expect(collapsed ? expand : collapse).toBeVisible();
}

async function fitCanvasContent(page: Page): Promise<void> {
  await page.getByRole('button', { name: '重置视图', exact: true }).click();
  await expect(canvasImages(page).last()).toBeInViewport();
}

async function openToolbarAction(page: Page, label: string): Promise<void> {
  const toolbar = page.locator('[data-toolbar="image-action-toolbar"]');
  await expect(toolbar).toBeVisible();
  let action = toolbar.getByRole('button', { name: label, exact: true });
  if (await action.count() === 0 || !await action.isVisible().catch(() => false)) {
    const more = toolbar.getByRole('button', { name: /展开更多工具/ });
    if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
    action = toolbar.getByRole('button', { name: label, exact: true });
  }
  await expect(action).toBeVisible();
  await action.click();
}

async function expectWithinViewport(locator: Locator, page: Page, label: string): Promise<void> {
  await expect(locator, `${label} 应可见`).toBeVisible();
  const [box, viewport] = await Promise.all([locator.boundingBox(), page.viewportSize()]);
  expect(box, `${label} 应具有可测量边界`).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x, `${label} 左侧越界`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${label} 顶部越界`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label} 右侧越界`).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height, `${label} 底部越界`).toBeLessThanOrEqual(viewport!.height + 1);
}

async function closeEditSurface(page: Page, locator: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  if (await locator.isVisible().catch(() => false)) {
    const close = locator.getByRole('button').filter({ has: page.locator('svg') }).first();
    if (await close.isVisible().catch(() => false)) await close.click();
  }
  await expect(locator).toBeHidden({ timeout: 10_000 });
  const toolbar = page.locator('[data-toolbar="image-action-toolbar"]');
  if (!await toolbar.isVisible().catch(() => false)) await canvasImages(page).last().click();
  await expect(toolbar).toBeVisible();
}

async function attachViewportScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const screenshot = await page.screenshot({ fullPage: true });
  const screenshotPath = resolve(process.cwd(), 'test-results', 'screenshots', `v588-ui004-${name}.png`);
  mkdirSync(resolve(process.cwd(), 'test-results', 'screenshots'), { recursive: true });
  writeFileSync(screenshotPath, screenshot);
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

test.describe('V588-UI-004 画布展示层多视口门禁', () => {
  test.skip(!username || !password, 'UNVERIFIED: 需要 E2E_TEST_USERNAME 与 E2E_TEST_PASSWORD 执行真实登录布局测试。');

  test('底部抽屉和图片工具栏在三种视口中不裁切、不重叠', async ({ page }, testInfo) => {
    await loginAndCreateProject(page);
    await uploadAndSelectImage(page);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setRightPanelCollapsed(page, viewport.width < 900);
      await fitCanvasContent(page);
      const imageToolbar = page.locator('[data-toolbar="image-action-toolbar"]');
      await expectWithinViewport(imageToolbar, page, `${viewport.name} 图片工具栏`);

      const more = imageToolbar.getByRole('button', { name: /更多工具/ });
      if (await more.isVisible().catch(() => false)) {
        if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
        const overflow = imageToolbar.locator('[data-image-toolbar-overflow]');
        await expectWithinViewport(overflow, page, `${viewport.name} 图片 +N 弹层`);
        await more.click();
      }

      const allTools = page.getByRole('button', { name: '全部工具', exact: true });
      await allTools.click();
      const drawer = page.locator('[data-bottom-toolbar-drawer]');
      await expectWithinViewport(drawer, page, `${viewport.name} 底部工具抽屉`);
      await expect(drawer.locator('[data-toolbar-drawer-section]')).toHaveCount(4);
      await allTools.click();
      await attachViewportScreenshot(page, testInfo, `toolbar-${viewport.name}`);
    }
  });

  test('八个图片编辑入口在移动端和桌面端可达且面板不越界', async ({ page }, testInfo) => {
    await loginAndCreateProject(page);
    await uploadAndSelectImage(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const cases: ReadonlyArray<{ action: string; selector: string; text?: string }> = [
      { action: '放大', selector: '[data-toolbar="edit-mode"]', text: 'HD 高清放大' },
      { action: 'SVG智能描摹', selector: '[data-floating-panel="svg-trace"]' },
      { action: '擦除', selector: '[data-floating-panel="erase"]' },
      { action: '蒙版', selector: '[data-floating-panel="mask"]' },
      { action: '调色', selector: '[data-floating-panel="color-adjust"]' },
      { action: '移除背景', selector: '[data-floating-panel="remove-bg"] > div.relative' },
      { action: '扩展', selector: '[data-toolbar="edit-mode"]', text: '确认扩展' },
      { action: '裁切', selector: '[data-toolbar="edit-mode"]', text: '确认裁切' },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setRightPanelCollapsed(page, viewport.width < 900);
      await fitCanvasContent(page);
      for (const item of cases) {
        await openToolbarAction(page, item.action);
        const panel = item.text
          ? page.locator(item.selector).filter({ hasText: item.text }).last()
          : page.locator(item.selector).last();
        await expectWithinViewport(panel, page, `${viewport.name} ${item.action}`);
        const transition = await panel.evaluate(element => {
          const style = getComputedStyle(element);
          return { duration: style.transitionDuration, property: style.transitionProperty };
        });
        const transitionDurations = transition.duration
          .split(',')
          .map(value => Number.parseFloat(value.trim()) || 0);
        const transitionDisabled = transition.property === 'none'
          || transitionDurations.every(value => value === 0);
        expect(transitionDisabled, `${item.action} 应尊重 reduced-motion`).toBeTruthy();
        await closeEditSurface(page, panel);
      }
      await attachViewportScreenshot(page, testInfo, `edit-panels-${viewport.name}`);
    }

    await page.setViewportSize({ width: viewports[2].width, height: viewports[2].height });
    await setRightPanelCollapsed(page, false);
    await fitCanvasContent(page);
    await openToolbarAction(page, 'SVG智能描摹');
    const openSvgPanel = page.locator('[data-floating-panel="svg-trace"]');
    await expectWithinViewport(openSvgPanel, page, '桌面 SVG 面板');
    await page.setViewportSize({ width: viewports[0].width, height: viewports[0].height });
    await expectWithinViewport(openSvgPanel, page, '保持打开并缩至 375px 的 SVG 面板');
    await closeEditSurface(page, openSvgPanel);
  });
});

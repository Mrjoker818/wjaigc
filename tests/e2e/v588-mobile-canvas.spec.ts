import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';

const fixtureImage = readFileSync(resolve(process.cwd(), 'tests/fixtures/annotation-source.png'));
const user = {
  id: 'v588-mobile-user',
  name: 'V588 Mobile Fixture',
  role: 'admin',
  status: 'active',
  productType: 'canvas,chat',
  createdAt: 1,
  updatedAt: 1,
};
const project = {
  id: 'v588-mobile-project',
  userId: user.id,
  name: 'V588 Mobile Canvas',
  createdAt: 1,
  updatedAt: 1,
  settings: {},
  canvasImages: [{
    id: 'v588-mobile-image',
    url: '/v588-mobile-source.png',
    x: 120,
    y: 100,
    width: 240,
    height: 180,
    originalWidth: 800,
    originalHeight: 600,
    rotation: 0,
    zIndex: 1,
    createdAt: 1,
  }],
};

test.use({ trace: 'on', video: 'on', screenshot: 'only-on-failure' });

function attachRuntimeEvidence(page: Page, testInfo: TestInfo): () => Promise<void> {
  const consoleEntries: string[] = [];
  const networkEntries: string[] = [];
  page.on('console', message => consoleEntries.push(`${message.type()} ${message.text()}`));
  page.on('pageerror', error => consoleEntries.push(`pageerror ${error.message}`));
  page.on('response', response => networkEntries.push(`${response.status()} ${response.request().method()} ${response.url()}`));
  return async () => {
    const name = `${testInfo.project.name}-${testInfo.title.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
    const consolePath = resolve(process.cwd(), 'test-results', 'console', `v588-mobile-${name}.log`);
    const networkPath = resolve(process.cwd(), 'test-results', 'network', `v588-mobile-${name}.log`);
    mkdirSync(resolve(process.cwd(), 'test-results', 'console'), { recursive: true });
    mkdirSync(resolve(process.cwd(), 'test-results', 'network'), { recursive: true });
    writeFileSync(consolePath, consoleEntries.join('\n') || 'NO_CONSOLE_MESSAGES', 'utf8');
    writeFileSync(networkPath, networkEntries.join('\n') || 'NO_NETWORK_RESPONSES', 'utf8');
    await testInfo.attach('console.log', { path: consolePath, contentType: 'text/plain' });
    await testInfo.attach('network.log', { path: networkPath, contentType: 'text/plain' });
  };
}

async function installCanvasFixture(page: Page): Promise<void> {
  await page.route('**/v588-mobile-source.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: fixtureImage }));
  await page.route('**/api/session', route => route.fulfill({ json: { success: true, user } }));
  await page.route('**/api/user-data/sync**', route => route.fulfill({
    json: route.request().method() === 'GET'
      ? {
        success: true,
        value: [project],
        projectRevision: 1,
        deletedCanvasPlacements: [],
        assetGraphMode: 'legacy',
        canvasKernelMode: 'main',
        workflowRendererMode: 'legacy',
      }
      : { success: true, projectRevision: 2 },
  }));
  await page.route('**/api/models**', route => route.fulfill({ json: { success: true, providers: [], models: [], taskModelCatalog: [] } }));
  await page.route('**/api/tasks/recover**', route => route.fulfill({ json: { success: true, tasks: [] } }));
}

async function openSeededCanvas(page: Page): Promise<void> {
  await installCanvasFixture(page);
  await page.goto('/?projectId=v588-mobile-project', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-canvas-interaction-surface]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-canvas-image-id="v588-mobile-image"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Compiling', { exact: true })).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('[data-canvas-image-id="v588-mobile-image"]')).toHaveCount(1);
  await expect(page.locator('[data-canvas-history-pending="false"]')).toBeVisible();
}

async function dispatchChromiumTouch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Array<{ x: number; y: number; id: number }>,
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(point => ({ ...point, radiusX: 2, radiusY: 2, force: 1 })),
  });
}

async function readGridTransform(page: Page): Promise<string> {
  return page.locator('[data-canvas-interaction-surface] > div').first().evaluate(element => (
    (element as HTMLElement).style.transform
  ));
}

async function waitForStableBox(page: Page, selector: string): Promise<void> {
  await expect.poll(async () => {
    const element = page.locator(selector);
    const before = await element.boundingBox();
    await page.evaluate(() => new Promise<void>(resolve => (
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )));
    const after = await element.boundingBox();
    return before && after
      ? [before.x, before.y, before.width, before.height].every((value, index) => (
        Math.abs(value - [after.x, after.y, after.width, after.height][index]) < 0.5
      ))
      : false;
  }).toBe(true);
}

async function findBlankCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('[data-canvas-interaction-surface]');
    if (!surface) throw new Error('Canvas surface is unavailable');
    const blocked = '[data-canvas-image-id], [data-floating-panel], [data-popup], [data-modal], [data-toolbar], [role="dialog"]';
    for (let y = innerHeight - 100; y >= 100; y -= 24) {
      for (let x = innerWidth - 16; x >= 16; x -= 24) {
        const target = document.elementFromPoint(x, y);
        if (target && surface.contains(target) && !target.closest(blocked)) return { x, y };
      }
    }
    throw new Error('No reachable blank canvas point found');
  });
}

test.describe('V588 mobile canvas browser matrix', () => {
  test('canvas interactions and tools remain available at the configured viewport', async ({ page, browserName }, testInfo) => {
    const saveEvidence = attachRuntimeEvidence(page, testInfo);
    try {
      await openSeededCanvas(page);
      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();
      if (viewport!.width < 768) {
        if (browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        try {
          const initialImageBox = await page.locator('[data-canvas-image-id="v588-mobile-image"]').boundingBox();
          const start = await findBlankCanvasPoint(page);
          await dispatchChromiumTouch(cdp, 'touchStart', [{ id: 1, ...start }]);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
          await dispatchChromiumTouch(cdp, 'touchMove', [{ id: 1, x: start.x - 60, y: start.y - 32 }]);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
          await dispatchChromiumTouch(cdp, 'touchMove', [{ id: 1, x: start.x - 90, y: start.y - 50 }]);
          await expect.poll(async () => (await page.locator('[data-canvas-image-id="v588-mobile-image"]').boundingBox())?.x)
            .not.toBe(initialImageBox?.x);
          await dispatchChromiumTouch(cdp, 'touchEnd', []);

          const longPressPoint = await findBlankCanvasPoint(page);
          await dispatchChromiumTouch(cdp, 'touchStart', [{ id: 4, ...longPressPoint }]);
          await expect(page.getByText('粘贴', { exact: true })).toBeVisible({ timeout: 2_000 });
          await dispatchChromiumTouch(cdp, 'touchEnd', []);
          await page.keyboard.press('Escape');

          const zoomBefore = await page.getByRole('status', { name: /当前缩放/ }).getAttribute('aria-label');
          const pinchY = viewport!.height - 120;
          await dispatchChromiumTouch(cdp, 'touchStart', [
            { id: 2, x: viewport!.width * 0.35, y: pinchY },
            { id: 3, x: viewport!.width * 0.65, y: pinchY },
          ]);
          await dispatchChromiumTouch(cdp, 'touchMove', [
            { id: 2, x: viewport!.width * 0.2, y: pinchY },
            { id: 3, x: viewport!.width * 0.8, y: pinchY },
          ]);
          await dispatchChromiumTouch(cdp, 'touchEnd', []);
          await expect(page.getByRole('status', { name: /当前缩放/ })).not.toHaveAttribute('aria-label', zoomBefore || '');
        } finally {
          await cdp.detach();
        }
        }
        const allTools = page.getByRole('button', { name: '全部工具', exact: true });
        await expect(allTools).toBeVisible();
        await allTools.click();
        const drawer = page.getByRole('dialog', { name: '全部工具' });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole('button', { name: 'ChatCanvas' })).toBeVisible();
      } else {
        const surface = page.locator('[data-canvas-interaction-surface]');
        const image = page.locator('[data-canvas-image-id="v588-mobile-image"]');
        await waitForStableBox(page, '[data-canvas-image-id="v588-mobile-image"]');
        const box = await image.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.move(box!.x - 24, box!.y - 24);
        await page.mouse.down();
        await page.mouse.move(
          box!.x + box!.width + 24,
          box!.y + box!.height + 24,
          { steps: 12 },
        );
        await page.mouse.up();
        await expect(image).toHaveAttribute('data-canvas-selected', 'true');
        await expect(page.locator('[data-toolbar="image-action-toolbar"]')).toBeVisible();

        const transformBefore = await readGridTransform(page);
        await page.keyboard.down('Space');
        await page.mouse.move(600, 500);
        await page.mouse.down();
        await page.mouse.move(680, 550);
        await page.mouse.up();
        await page.keyboard.up('Space');
        await expect.poll(() => readGridTransform(page)).not.toBe(transformBefore);

        const zoomStatus = page.locator('[data-toolbar="bottom-toolbar"] span.font-mono');
        const zoomBefore = await zoomStatus.textContent();
        await surface.dispatchEvent('wheel', {
          deltaY: -300,
          ctrlKey: true,
          clientX: 500,
          clientY: 400,
          bubbles: true,
          cancelable: true,
        });
        await expect(zoomStatus).not.toHaveText(zoomBefore || '');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await saveEvidence();
    }
  });
});

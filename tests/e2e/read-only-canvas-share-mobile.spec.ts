import { expect, type CDPSession, type Page } from '@playwright/test';

import {
  configureShareEvidence,
  expectNoForbiddenRequests,
  fixtureToken,
  installReadOnlyShareFixture,
  publicShareFixture,
  test,
} from '../helpers/read-only-canvas-share-e2e';

const portraitProjects = new Set([
  'mobile-320-chromium',
  'mobile-375-chromium',
  'mobile-393-chromium',
]);

test.use({ trace: 'on', screenshot: 'on', serviceWorkers: 'block' });

async function dispatchTouch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Array<{ x: number; y: number; id: number }>,
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(point => ({ ...point, radiusX: 2, radiusY: 2, force: 1 })),
  });
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

async function waitForCanvasTransformToSettle(page: Page): Promise<void> {
  const content = page.getByTestId('shared-canvas-content');
  await expect.poll(async () => content.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    const expectedScale = Number(element.dataset.scale);
    const expectedOffsetX = Number(element.dataset.offsetX);
    const expectedOffsetY = Number(element.dataset.offsetY);
    return Math.abs(matrix.a - expectedScale) < 0.01
      && Math.abs(matrix.d - expectedScale) < 0.01
      && Math.abs(matrix.e - expectedOffsetX) < 0.5
      && Math.abs(matrix.f - expectedOffsetY) < 0.5;
  })).toBe(true);
}

async function mediaTouchPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.getByRole('button', { name: '预览夹具图片' }).evaluate(element => {
    const rect = element.getBoundingClientRect();
    const candidates = [
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: rect.left + rect.width / 3, y: rect.top + rect.height / 3 },
      { x: rect.right - rect.width / 3, y: rect.bottom - rect.height / 3 },
    ];
    const hit = candidates.find(point => {
      const target = document.elementFromPoint(point.x, point.y);
      return target instanceof Node && element.contains(target);
    });
    if (!hit) throw new Error('media has no unobscured touch point');
    return { x: Math.round(hit.x), y: Math.round(hit.y) };
  });
}

async function blankViewerPoints(page: Page, count: 1 | 2): Promise<Array<{ x: number; y: number }>> {
  return page.evaluate(required => {
    const viewport = document.querySelector<HTMLElement>('[aria-label="共享画布视口"]');
    if (!viewport) throw new Error('shared viewport unavailable');
    const rect = viewport.getBoundingClientRect();
    const blocked = '[data-shared-media], [data-toolbar], [role="dialog"]';
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = rect.top + 24; y < rect.bottom - 72; y += 24) {
      for (let x = rect.left + 16; x < rect.right - 16; x += 20) {
        const target = document.elementFromPoint(x, y);
        if (target && viewport.contains(target) && !target.closest(blocked)) candidates.push({ x, y });
      }
    }
    if (required === 1 && candidates[0]) return [candidates[0]];
    for (const first of candidates) {
      const second = candidates.find(candidate => Math.hypot(candidate.x - first.x, candidate.y - first.y) >= 96);
      if (second) return [first, second];
    }
    throw new Error(`unable to find ${required} blank viewer points`);
  }, count);
}

async function assertCompactToolbar(page: Page, expectedBasePadding: 8 | 16): Promise<void> {
  const viewportSize = page.viewportSize();
  expect(viewportSize).not.toBeNull();
  const toolbar = page.getByRole('navigation', { name: '只读画布工具栏' });
  const box = await toolbar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportSize!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportSize!.height + 0.5);

  const targetBoxes = await toolbar.locator('button, a').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(targetBoxes.length).toBeGreaterThanOrEqual(4);
  for (const target of targetBoxes) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }

  const safeAreaShell = page.locator('[data-shared-toolbar-shell]');
  await expect(safeAreaShell).toBeVisible();
  const shellContract = await safeAreaShell.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      className: element.className,
      paddingBottom: Number.parseFloat(style.paddingBottom),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
    };
  });
  expect(shellContract.paddingBottom).toBe(expectedBasePadding);
  expect(shellContract.paddingLeft).toBe(expectedBasePadding);
  expect(shellContract.paddingRight).toBe(expectedBasePadding);
  expect(shellContract.className).toContain('pb-[max(0.5rem,env(safe-area-inset-bottom))]');
  expect(shellContract.className).toContain('pl-[max(0.5rem,env(safe-area-inset-left))]');
  expect(shellContract.className).toContain('pr-[max(0.5rem,env(safe-area-inset-right))]');
  expect(shellContract.className).toContain('sm:pb-[max(1rem,env(safe-area-inset-bottom))]');
  expect(shellContract.className).toContain('sm:pl-[max(1rem,env(safe-area-inset-left))]');
  expect(shellContract.className).toContain('sm:pr-[max(1rem,env(safe-area-inset-right))]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.describe('只读画布分享移动端矩阵', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !portraitProjects.has(testInfo.project.name) && testInfo.project.name !== 'mobile-chromium',
      '移动分享矩阵只在既有 Chromium 移动项目运行',
    );
  });

  test('320/375/393：单指、双指、双击、底栏、视频和长按均只读', async ({ page, shareEvidence }, testInfo) => {
    test.skip(!portraitProjects.has(testInfo.project.name), '此用例只覆盖 320/375/393 竖屏项目');
    configureShareEvidence(shareEvidence, 'mobile-portrait', `mobile/${testInfo.project.name}/portrait`);
    await installReadOnlyShareFixture(page, { allowDownload: true });
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: publicShareFixture(true).title })).toBeVisible();
    await assertCompactToolbar(page, 8);

    const viewerStyles = await page.locator('[data-shared-canvas-viewer]').evaluate(element => {
      const root = getComputedStyle(element);
      const viewport = getComputedStyle(element.querySelector<HTMLElement>('[aria-label="共享画布视口"]')!);
      return { overscrollBehavior: root.overscrollBehavior, userSelect: root.userSelect, touchAction: viewport.touchAction };
    });
    expect(viewerStyles).toEqual({ overscrollBehavior: 'none', userSelect: 'none', touchAction: 'none' });

    const video = page.getByLabel('基础测试夹具视频');
    await expect(video).toHaveAttribute('playsinline', '');
    expect(await video.evaluate(element => ({
      muted: (element as HTMLVideoElement).muted,
      autoplay: (element as HTMLVideoElement).autoplay,
      draggable: (element as HTMLVideoElement).draggable,
    }))).toEqual({ muted: true, autoplay: false, draggable: false });
    await expect(page.getByText('此内容暂不可用')).toBeVisible();

    const content = page.getByTestId('shared-canvas-content');
    const imageSlot = page.locator('[data-testid^="shared-media-slot-"]').first();
    const mediaStyle = await imageSlot.getAttribute('style');
    const cdp = await page.context().newCDPSession(page);
    try {
      const [panStart] = await blankViewerPoints(page, 1);
      const panScale = await content.getAttribute('data-scale');
      const panOffset = await content.getAttribute('data-offset-x');
      await dispatchTouch(cdp, 'touchStart', [{ id: 1, ...panStart }]);
      await dispatchTouch(cdp, 'touchMove', [{ id: 1, x: panStart.x + 42, y: panStart.y + 28 }]);
      await dispatchTouch(cdp, 'touchEnd', []);
      await expect(content).not.toHaveAttribute('data-offset-x', panOffset ?? '');
      await expect(content).toHaveAttribute('data-scale', panScale ?? '');
      await expect(imageSlot).toHaveAttribute('style', mediaStyle ?? '');

      const [pinchLeft, pinchRight] = await blankViewerPoints(page, 2);
      const pinchScale = Number(await content.getAttribute('data-scale'));
      await dispatchTouch(cdp, 'touchStart', [{ id: 2, ...pinchLeft }, { id: 3, ...pinchRight }]);
      await dispatchTouch(cdp, 'touchMove', [
        { id: 2, x: pinchLeft.x - 24, y: pinchLeft.y },
        { id: 3, x: pinchRight.x + 24, y: pinchRight.y },
      ]);
      await dispatchTouch(cdp, 'touchEnd', []);
      await expect.poll(async () => Number(await content.getAttribute('data-scale'))).not.toBeCloseTo(pinchScale, 5);
      await expect(imageSlot).toHaveAttribute('style', mediaStyle ?? '');

      const [tapPoint] = await blankViewerPoints(page, 1);
      const tapScale = Number(await content.getAttribute('data-scale'));
      for (const id of [4, 5]) {
        await dispatchTouch(cdp, 'touchStart', [{ id, ...tapPoint }]);
        await dispatchTouch(cdp, 'touchEnd', []);
        await nextFrame(page);
      }
      await expect.poll(async () => Number(await content.getAttribute('data-scale'))).not.toBeCloseTo(tapScale, 5);
      await page.getByRole('button', { name: '适应画面' }).click();
      await expect.poll(async () => Number(await content.getAttribute('data-scale'))).not.toBeCloseTo(tapScale * 1.2, 5);

      await waitForCanvasTransformToSettle(page);

      const media = page.getByRole('button', { name: '预览夹具图片' });
      const mediaPoint = await mediaTouchPoint(page);
      await media.evaluate(element => {
        const state = {
          touchStarts: 0,
          contextMenus: 0,
          defaultPrevented: false,
          contextTargetWasMedia: false,
          suppressClick: true,
        };
        (window as typeof window & { __task7MediaProbe?: typeof state }).__task7MediaProbe = state;
        element.addEventListener('touchstart', () => { state.touchStarts += 1; });
        element.addEventListener('click', event => {
          if (!state.suppressClick) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        }, { capture: true });
        document.addEventListener('contextmenu', event => {
          if (!(event.target instanceof Node) || !element.contains(event.target)) return;
          queueMicrotask(() => {
            state.contextMenus += 1;
            state.defaultPrevented = event.defaultPrevented;
            state.contextTargetWasMedia = true;
          });
        });
      });
      const readMediaProbe = () => page.evaluate(() => (
        (window as typeof window & { __task7MediaProbe?: {
          touchStarts: number;
          contextMenus: number;
          defaultPrevented: boolean;
          contextTargetWasMedia: boolean;
          suppressClick: boolean;
        } }).__task7MediaProbe
      ));
      const beforeLongPressUrl = page.url();
      await dispatchTouch(cdp, 'touchStart', [{ id: 6, ...mediaPoint }]);
      await expect.poll(async () => (await readMediaProbe())?.touchStarts ?? 0).toBe(1);
      const nativeContextMenuSynthesized = await expect.poll(
        async () => (await readMediaProbe())?.contextMenus ?? 0,
        { timeout: 800, intervals: [50, 100, 200] },
      ).toBeGreaterThan(0).then(() => true, () => false);
      await dispatchTouch(cdp, 'touchEnd', []);
      if (!nativeContextMenuSynthesized) {
        await media.evaluate(element => {
          element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        });
      }
      await expect.poll(async () => (await readMediaProbe())?.contextMenus ?? 0).toBeGreaterThan(0);
      const mediaProbe = await readMediaProbe();
      expect(mediaProbe).toMatchObject({ defaultPrevented: true, contextTargetWasMedia: true });
      expect(page.url()).toBe(beforeLongPressUrl);
      await expect.poll(async () => page.locator('[role="menu"], [data-toolbar="image-actions"], [data-toolbar="bottom-toolbar"]').count()).toBe(0);
      shareEvidence.details.mediaLongPress = { nativeContextMenuSynthesized, mediaProbe };
      await testInfo.attach('media-long-press-event-chain', {
        body: JSON.stringify({ nativeContextMenuSynthesized, mediaProbe }, null, 2),
        contentType: 'application/json',
      });
      await media.evaluate(() => {
        const state = (window as typeof window & { __task7MediaProbe?: { suppressClick: boolean } }).__task7MediaProbe;
        if (state) state.suppressClick = false;
      });
    } finally {
      await cdp.detach();
    }

    await page.getByRole('button', { name: '预览夹具图片' }).click();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: publicShareFixture(true).title })).toBeVisible();
    expectNoForbiddenRequests(shareEvidence);
  });

  test('812×375 横屏：工具栏、安全区、无溢出和预览关闭可用', async ({ page, shareEvidence }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', '横屏只在既有 mobile-chromium 项目运行');
    configureShareEvidence(shareEvidence, 'mobile-landscape', `mobile/${testInfo.project.name}/landscape`);
    await page.setViewportSize({ width: 812, height: 375 });
    await installReadOnlyShareFixture(page, { allowDownload: true });
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: publicShareFixture(true).title })).toBeVisible();
    await assertCompactToolbar(page, 16);

    await page.getByRole('button', { name: '预览夹具图片' }).click();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await page.getByRole('button', { name: '关闭预览' }).click();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toHaveCount(0);
    expectNoForbiddenRequests(shareEvidence);
  });
});

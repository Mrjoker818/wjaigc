import { expect } from '@playwright/test';

import {
  downloadPath,
  expectNoForbiddenRequests,
  fixtureToken,
  imagePath,
  installReadOnlyShareFixture,
  metadataPath,
  publicShareFixture,
  test,
  videoPath,
} from '../helpers/read-only-canvas-share-e2e';

const desktopProjects = new Set(['chromium', 'firefox', 'webkit']);

test.use({ trace: 'on', screenshot: 'on' });

test.describe('只读画布分享桌面浏览器矩阵', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!desktopProjects.has(testInfo.project.name), '桌面分享矩阵只在既有 Chromium/Firefox/WebKit 项目运行');
  });

  test('有效分享：fit、zoom、pan、preview 均保持只读', async ({ page, shareEvidence }) => {
    await installReadOnlyShareFixture(page);
    await page.goto(`/shared/canvas/${fixtureToken}`);

    const fixture = publicShareFixture();
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
    await expect(page.getByText(fixture.revisionLabel, { exact: false })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '只读画布工具栏' })).toBeVisible();
    await expect(page.getByAltText('基础测试夹具图片')).toBeVisible();
    const video = page.getByLabel('基础测试夹具视频');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).not.toHaveAttribute('autoplay', '');
    await expect(page.getByText('此内容暂不可用')).toBeVisible();

    const content = page.getByTestId('shared-canvas-content');
    const initialScale = Number(await content.getAttribute('data-scale'));
    await page.getByRole('button', { name: '适应画面' }).click();
    const fittedScale = Number(await content.getAttribute('data-scale'));
    expect(fittedScale).not.toBe(initialScale);
    await page.getByRole('button', { name: '放大画布' }).click();
    await expect.poll(async () => Number(await content.getAttribute('data-scale'))).toBeCloseTo(fittedScale * 1.2, 5);

    const viewport = page.getByRole('region', { name: '共享画布视口' });
    const viewportBox = await viewport.boundingBox();
    expect(viewportBox).not.toBeNull();
    const offsetBefore = await content.getAttribute('data-offset-x');
    await page.mouse.move(viewportBox!.x + viewportBox!.width - 80, viewportBox!.y + 80);
    await page.mouse.down();
    await page.mouse.move(viewportBox!.x + viewportBox!.width - 32, viewportBox!.y + 112, { steps: 4 });
    await page.mouse.up();
    await expect(content).not.toHaveAttribute('data-offset-x', offsetBefore ?? '');

    const previewTrigger = page.getByRole('button', { name: '预览夹具图片' });
    await previewTrigger.click();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toHaveCount(0);
    await expect(previewTrigger).toBeFocused();

    expect(shareEvidence.apiRequests).toEqual(expect.arrayContaining([
      { method: 'GET', pathname: metadataPath },
      { method: 'GET', pathname: imagePath },
      { method: 'GET', pathname: videoPath },
    ]));
    expectNoForbiddenRequests(shareEvidence);
  });

  test('失效分享：统一错误且不触发写入或编辑请求', async ({ page, shareEvidence }) => {
    await installReadOnlyShareFixture(page, { invalid: true });
    await page.goto(`/shared/canvas/${fixtureToken}`);

    await expect(page.getByRole('heading', { name: '分享不存在或已失效' })).toBeVisible();
    await expect(page.getByText('已撤销')).toHaveCount(0);
    await expect(page.getByText('已过期')).toHaveCount(0);
    expectNoForbiddenRequests(shareEvidence);
  });

  test('下载关闭：按钮不存在且受控下载接口拒绝', async ({ page, shareEvidence }) => {
    await installReadOnlyShareFixture(page);
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: publicShareFixture().title })).toBeVisible();

    await expect(page.getByRole('link', { name: /下载/u })).toHaveCount(0);
    const responseStatus = await page.evaluate(async path => (await fetch(path)).status, downloadPath);
    expect(responseStatus).toBe(403);
    expect(shareEvidence.apiRequests.filter(request => request.pathname === downloadPath)).toEqual([
      { method: 'GET', pathname: downloadPath },
    ]);
    expectNoForbiddenRequests(shareEvidence);
  });

  test('下载开启：下载按钮只调用分享作用域受控路径', async ({ page, shareEvidence }) => {
    await installReadOnlyShareFixture(page, { allowDownload: true });
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: publicShareFixture(true).title })).toBeVisible();

    await page.getByRole('button', { name: '预览夹具图片' }).click();
    const downloadLink = page.getByRole('link', { name: '下载预览内容' });
    await expect(downloadLink).toHaveAttribute('href', downloadPath);
    const downloadEvent = page.waitForEvent('download');
    await downloadLink.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('share-image.png');
    await download.cancel();

    expect(shareEvidence.apiRequests.filter(request => request.pathname.endsWith('/download'))).toEqual([
      { method: 'GET', pathname: downloadPath },
    ]);
    expectNoForbiddenRequests(shareEvidence);
  });
});

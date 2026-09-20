import {
  expect,
  test as base,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';

import {
  downloadPath,
  fixtureToken,
  imagePath,
  installReadOnlyShareFixture,
  metadataPath,
  publicShareFixture,
  videoPath,
} from '../helpers/read-only-canvas-share-e2e';

interface RequestRecord {
  method: string;
  pathname: string;
}

interface ShareRequestAudit {
  apiRequests: RequestRecord[];
  forbiddenRequests: RequestRecord[];
}

interface CrossBrowserFixtures {
  shareRequestAudit: ShareRequestAudit;
}

const crossBrowserProjects = new Set(['firefox', 'webkit']);

function observeShareRequests(page: Page, audit: ShareRequestAudit): (request: Request) => void {
  return request => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/api/')) return;
    const record = { method: request.method(), pathname };
    audit.apiRequests.push(record);
    if (!['GET', 'HEAD'].includes(record.method) || !pathname.startsWith(metadataPath)) {
      audit.forbiddenRequests.push(record);
    }
  };
}

const test = base.extend<CrossBrowserFixtures>({
  shareRequestAudit: [async ({ page }, runTest, testInfo: TestInfo) => {
    const audit: ShareRequestAudit = { apiRequests: [], forbiddenRequests: [] };
    const observer = observeShareRequests(page, audit);
    page.on('request', observer);
    try {
      await runTest(audit);
    } finally {
      page.off('request', observer);
      await testInfo.attach('cross-browser-share-request-audit', {
        body: Buffer.from(JSON.stringify(audit, null, 2)),
        contentType: 'application/json',
      });
      expect(audit.forbiddenRequests).toEqual([]);
    }
  }, { auto: true }],
});

test.use({ trace: 'on', screenshot: 'on', serviceWorkers: 'block' });

test.describe('只读画布分享跨浏览器功能矩阵', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!crossBrowserProjects.has(testInfo.project.name), '跨浏览器规格只在 Firefox/WebKit 项目运行');
  });

  test('有效分享保持只读，并支持 fit、zoom、pan、preview', async ({ browserName, page, shareRequestAudit }) => {
    const videoFormat = browserName === 'webkit' ? 'mp4' : 'webm';
    await installReadOnlyShareFixture(page, { videoFormat });
    await page.goto(`/shared/canvas/${fixtureToken}`);

    const fixture = publicShareFixture(false, videoFormat);
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();
    await expect(page.getByText(fixture.revisionLabel, { exact: false })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '只读画布工具栏' })).toBeVisible();
    await expect(page.getByAltText('基础测试夹具图片')).toBeVisible();
    const video = page.getByLabel('基础测试夹具视频');
    await expect(video).toHaveAttribute('playsinline', '');
    await expect(video).not.toHaveAttribute('autoplay', '');
    await expect.poll(async () => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
    await expect(page.getByText('此内容暂不可用')).toHaveCount(1);

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

    expect(shareRequestAudit.apiRequests).toEqual(expect.arrayContaining([
      { method: 'GET', pathname: metadataPath },
      { method: 'GET', pathname: imagePath },
      { method: 'GET', pathname: videoPath },
    ]));
  });

  test('失效分享显示统一错误且不触发写入请求', async ({ browserName, page }) => {
    await installReadOnlyShareFixture(page, {
      invalid: true,
      videoFormat: browserName === 'webkit' ? 'mp4' : 'webm',
    });
    await page.goto(`/shared/canvas/${fixtureToken}`);

    await expect(page.getByRole('heading', { name: '分享不存在或已失效' })).toBeVisible();
    await expect(page.getByText('已撤销')).toHaveCount(0);
    await expect(page.getByText('已过期')).toHaveCount(0);
  });

  test('下载关闭时隐藏入口并拒绝受控下载', async ({ browserName, page, shareRequestAudit }) => {
    await installReadOnlyShareFixture(page, { videoFormat: browserName === 'webkit' ? 'mp4' : 'webm' });
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: publicShareFixture().title })).toBeVisible();

    await expect(page.getByRole('link', { name: /下载/u })).toHaveCount(0);
    const responseStatus = await page.evaluate(async path => (await fetch(path)).status, downloadPath);
    expect(responseStatus).toBe(403);
    expect(shareRequestAudit.apiRequests.filter(request => request.pathname === downloadPath)).toEqual([
      { method: 'GET', pathname: downloadPath },
    ]);
  });

  test('下载开启时只使用分享作用域受控路径', async ({ browserName, page, shareRequestAudit }) => {
    await installReadOnlyShareFixture(page, {
      allowDownload: true,
      videoFormat: browserName === 'webkit' ? 'mp4' : 'webm',
    });
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: publicShareFixture(true).title })).toBeVisible();

    await page.getByRole('button', { name: '预览夹具图片' }).click();
    const downloadLink = page.getByRole('link', { name: '下载预览内容' });
    await expect(downloadLink).toHaveAttribute('href', downloadPath);
    await expect(downloadLink).toHaveAttribute('download', '');
    const downloadResponse = page.waitForResponse(
      response => new URL(response.url()).pathname === downloadPath,
    );
    await downloadLink.click();
    const response = await downloadResponse;
    expect(response.status()).toBe(200);
    expect(await response.headerValue('content-disposition')).toBe('attachment; filename="share-image.png"');

    expect(shareRequestAudit.apiRequests.filter(request => request.pathname === downloadPath)).toEqual([
      { method: 'GET', pathname: downloadPath },
    ]);
  });
});

import { expect, test, type Page } from '@playwright/test';

const fixtureToken = 'T'.repeat(43);
const fixtureItemRef = `csr_${'I'.repeat(43)}`;
const metadataPath = `/api/public/canvas-shares/${fixtureToken}`;
const mediaPath = `${metadataPath}/media/${fixtureItemRef}`;
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const publicFixture = {
  title: '基础只读画布夹具',
  revisionLabel: '修订 3',
  createdAt: '2026-09-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 32, offsetY: 48, zoom: 1 },
  items: [{
    itemRef: fixtureItemRef,
    entityType: 'canvas-image',
    assetKind: 'image',
    transform: { x: 40, y: 60, width: 320, height: 240, rotation: 0, zIndex: 1 },
    display: { label: '夹具图片', altText: '基础测试夹具图片' },
    mimeType: 'image/png',
    width: 320,
    height: 240,
    mediaPath: `media/${fixtureItemRef}`,
  }],
};

async function installValidShareFixture(page: Page): Promise<void> {
  await page.route('**/api/public/canvas-shares/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === mediaPath) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: onePixelPng,
        headers: { 'Cache-Control': 'private, no-store' },
      });
      return;
    }
    if (url.pathname === metadataPath) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publicFixture),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
}

test.describe('只读画布分享基础夹具', () => {
  test('渲染公开快照并保持请求只读', async ({ page }) => {
    const requests: Array<{ method: string; pathname: string }> = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        requests.push({ method: request.method(), pathname: url.pathname });
      }
    });
    await installValidShareFixture(page);

    await page.goto(`/shared/canvas/${fixtureToken}`);

    await expect(page.getByRole('heading', { name: publicFixture.title })).toBeVisible();
    await expect(page.getByText(publicFixture.revisionLabel, { exact: false })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '只读画布工具栏' })).toBeVisible();
    await expect(page.getByAltText('基础测试夹具图片')).toBeVisible();
    await expect(page.getByRole('link', { name: '下载当前内容' })).toHaveCount(0);

    await page.getByRole('button', { name: '放大画布' }).click();
    await expect(page.getByLabel('当前比例')).toHaveText('120%');
    await page.getByRole('button', { name: '预览夹具图片' }).click();
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '媒体预览' })).toHaveCount(0);

    expect(requests).toEqual(expect.arrayContaining([
      { method: 'GET', pathname: metadataPath },
      { method: 'GET', pathname: mediaPath },
    ]));
    expect(requests.every(request => request.method === 'GET')).toBe(true);
    expect(requests.every(request => (
      request.pathname === metadataPath || request.pathname === mediaPath
    ))).toBe(true);
  });

  test('统一显示失效链接', async ({ page }) => {
    await page.route(`**${metadataPath}`, route => route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'CANVAS_SHARE_NOT_FOUND',
        message: '画布分享不存在或已失效',
        requestId: 'req_0123456789abcdef',
      }),
    }));

    await page.goto(`/shared/canvas/${fixtureToken}`);

    await expect(page.getByRole('heading', { name: '分享不存在或已失效' })).toBeVisible();
    await expect(page.getByText('已撤销')).toHaveCount(0);
    await expect(page.getByText('已过期')).toHaveCount(0);
  });
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test as base, type Page, type Route, type TestInfo } from '@playwright/test';

export const fixtureToken = 'T'.repeat(43);
export const imageItemRef = `csr_${'I'.repeat(43)}`;
export const videoItemRef = `csr_${'V'.repeat(43)}`;
export const unavailableItemRef = `csr_${'U'.repeat(43)}`;
export const metadataPath = `/api/public/canvas-shares/${fixtureToken}`;
export const imagePath = `${metadataPath}/media/${imageItemRef}`;
export const videoPath = `${metadataPath}/media/${videoItemRef}`;
export const unavailablePath = `${metadataPath}/media/${unavailableItemRef}`;
export const downloadPath = `${imagePath}/download`;

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const tinyMp4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMVbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAACABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADACg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAG6gAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALEAAAAAQAAABRzdGNvAAAAAAAAAAEAAANFAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDAAAAAIZnJlZQAAAsxtZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTUgc2NlbmVjdXQ9NDAgaW50cmFfcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEAD///vdonwKbXmG5',
  'base64',
);

const baseItems = [
  {
    itemRef: imageItemRef,
    entityType: 'canvas-image' as const,
    assetKind: 'image' as const,
    transform: { x: 40, y: 60, width: 320, height: 240, rotation: 0, zIndex: 1 },
    display: { label: '夹具图片', altText: '基础测试夹具图片' },
    mimeType: 'image/png',
    width: 320,
    height: 240,
    mediaPath: `media/${imageItemRef}`,
  },
  {
    itemRef: videoItemRef,
    entityType: 'canvas-video' as const,
    assetKind: 'video' as const,
    transform: { x: 400, y: 60, width: 240, height: 180, rotation: 0, zIndex: 2 },
    display: { label: '夹具视频', altText: '基础测试夹具视频' },
    mimeType: 'video/mp4',
    width: 16,
    height: 16,
    mediaPath: `media/${videoItemRef}`,
  },
  {
    itemRef: unavailableItemRef,
    entityType: 'canvas-image' as const,
    assetKind: 'image' as const,
    transform: { x: 40, y: 340, width: 180, height: 120, rotation: 0, zIndex: 3 },
    display: { label: '不可用夹具', altText: '不可用夹具图片' },
    mimeType: 'image/png',
    width: 180,
    height: 120,
    mediaPath: `media/${unavailableItemRef}`,
  },
];

export function publicShareFixture(allowDownload = false) {
  return {
    title: '跨浏览器只读画布夹具',
    revisionLabel: '修订 2026-09-19-超长移动端安全标签',
    createdAt: '2026-09-19T00:00:00.000Z',
    allowDownload,
    viewport: { offsetX: 32, offsetY: 48, zoom: 1 },
    items: baseItems.map(item => (
      item.itemRef === imageItemRef && allowDownload
        ? { ...item, downloadPath: `media/${imageItemRef}/download` }
        : item
    )),
  };
}

interface FixtureOptions {
  allowDownload?: boolean;
  invalid?: boolean;
}

async function fulfillMediaRoute(route: Route, pathname: string): Promise<void> {
  if (pathname === imagePath) {
    await route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng, headers: { 'Cache-Control': 'private, no-store' } });
    return;
  }
  if (pathname === videoPath) {
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      body: tinyMp4,
      headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'Content-Length': String(tinyMp4.length) },
    });
    return;
  }
  if (pathname === unavailablePath) {
    await route.fulfill({ status: 415, body: '' });
    return;
  }
  await route.fulfill({ status: 404, body: '' });
}

export async function installReadOnlyShareFixture(page: Page, options: FixtureOptions = {}): Promise<void> {
  const allowDownload = options.allowDownload ?? false;
  await page.route('**/api/public/canvas-shares/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === metadataPath) {
      if (options.invalid) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CANVAS_SHARE_NOT_FOUND', message: '画布分享不存在或已失效', requestId: 'req_0123456789abcdef' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publicShareFixture(allowDownload)),
        headers: { 'Cache-Control': 'private, no-store' },
      });
      return;
    }
    if (pathname === downloadPath) {
      if (!allowDownload) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'CANVAS_SHARE_DOWNLOAD_DISABLED' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: onePixelPng,
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Disposition': 'attachment; filename="share-image.png"',
          'X-Content-Type-Options': 'nosniff',
        },
      });
      return;
    }
    await fulfillMediaRoute(route, pathname);
  });
}

export interface ShareEvidence {
  apiRequests: Array<{ method: string; pathname: string }>;
  forbiddenRequests: Array<{ method: string; pathname: string }>;
  consoleErrors: string[];
}

function isForbiddenRequest(method: string, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return true;
  return [
    /^\/api\/generate(?:\/|$)/u,
    /^\/api\/(?:edit|image-edit)(?:\/|$)/u,
    /^\/api\/(?:delete|save|save-image)(?:\/|$)/u,
    /^\/api\/(?:credit|credits)(?:\/|$)/u,
    /^\/api\/(?:model|models)(?:\/|$)/u,
    /^\/api\/(?:provider|providers)(?:\/|$)/u,
    /^\/api\/canvas-shares(?:\/|$)/u,
  ].some(pattern => pattern.test(pathname));
}

function redactFixturePath(pathname: string): string {
  return pathname
    .replace(fixtureToken, ':share-token')
    .replace(imageItemRef, ':image-item')
    .replace(videoItemRef, ':video-item')
    .replace(unavailableItemRef, ':unavailable-item');
}

async function attachEvidence(page: Page, evidence: ShareEvidence, testInfo: TestInfo): Promise<void> {
  const body = JSON.stringify({
    testTitle: testInfo.titlePath,
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    apiRequests: evidence.apiRequests.map(request => ({ ...request, pathname: redactFixturePath(request.pathname) })),
    forbiddenRequestCount: evidence.forbiddenRequests.length,
    consoleErrors: evidence.consoleErrors,
  }, null, 2);
  const safeTitle = testInfo.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/gu, '-');
  const evidenceDirectory = resolve(
    process.cwd(),
    'output',
    'playwright',
    'read-only-canvas-share-evidence',
    testInfo.project.name,
  );
  const evidencePath = resolve(evidenceDirectory, `${safeTitle}.json`);
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(evidencePath, body, 'utf8');
  await testInfo.attach(`只读分享证据-${safeTitle}`, { path: evidencePath, contentType: 'application/json' });
}

export const test = base.extend<{ shareEvidence: ShareEvidence }>({
  shareEvidence: [async ({ page }, use, testInfo) => {
    const evidence: ShareEvidence = { apiRequests: [], forbiddenRequests: [], consoleErrors: [] };
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith('/api/')) return;
      const entry = { method: request.method(), pathname };
      evidence.apiRequests.push(entry);
      if (isForbiddenRequest(entry.method, entry.pathname)) evidence.forbiddenRequests.push(entry);
    });
    page.on('console', message => {
      if (message.type() === 'error') evidence.consoleErrors.push(redactFixturePath(message.text()).slice(0, 2_000));
    });
    page.on('pageerror', error => evidence.consoleErrors.push(redactFixturePath(error.message).slice(0, 2_000)));
    await use(evidence);
    await attachEvidence(page, evidence, testInfo);
  }, { auto: true }],
});

export function expectNoForbiddenRequests(evidence: ShareEvidence): void {
  expect(evidence.forbiddenRequests).toEqual([]);
}

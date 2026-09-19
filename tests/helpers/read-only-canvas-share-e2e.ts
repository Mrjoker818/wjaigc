import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from '@playwright/test';

export const fixtureToken = 'T'.repeat(43);
export const imageItemRef = `csr_${'I'.repeat(43)}`;
export const videoItemRef = `csr_${'V'.repeat(43)}`;
export const unavailableItemRef = `csr_${'U'.repeat(43)}`;
export const metadataPath = `/api/public/canvas-shares/${fixtureToken}`;
export const imagePath = `${metadataPath}/media/${imageItemRef}`;
export const videoPath = `${metadataPath}/media/${videoItemRef}`;
export const unavailablePath = `${metadataPath}/media/${unavailableItemRef}`;
export const downloadPath = `${imagePath}/download`;
export const evidenceRoot = resolve(
  process.cwd(),
  'output',
  'playwright',
  'task7-fix1-final-evidence',
);

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

function commonMediaHeaders(contentType: string, contentLength: number): Record<string, string> {
  return {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Length': String(contentLength),
    'Content-Type': contentType,
  };
}

async function fulfillBytes(
  route: Route,
  bytes: Buffer,
  contentType: string,
  acceptRanges = false,
): Promise<void> {
  const method = route.request().method();
  const baseHeaders = acceptRanges
    ? commonMediaHeaders(contentType, bytes.length)
    : {
        'Cache-Control': 'private, no-store',
        'Content-Length': String(bytes.length),
        'Content-Type': contentType,
      };
  if (method === 'HEAD') {
    await route.fulfill({ status: 200, headers: baseHeaders, body: '' });
    return;
  }
  const rangeHeader = route.request().headers().range;
  if (acceptRanges && rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(rangeHeader);
    const start = match ? Number(match[1]) : Number.NaN;
    const requestedEnd = match?.[2] ? Number(match[2]) : bytes.length - 1;
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
      || start < 0 || requestedEnd < start || start >= bytes.length || requestedEnd >= bytes.length) {
      await route.fulfill({
        status: 416,
        contentType: 'application/json',
        headers: {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-store',
          'Content-Range': `bytes */${bytes.length}`,
        },
        body: JSON.stringify({ code: 'CANVAS_SHARE_RANGE_NOT_SATISFIABLE' }),
      });
      return;
    }
    const slice = bytes.subarray(start, requestedEnd + 1);
    await route.fulfill({
      status: 206,
      body: slice,
      headers: {
        ...commonMediaHeaders(contentType, slice.length),
        'Content-Range': `bytes ${start}-${requestedEnd}/${bytes.length}`,
      },
    });
    return;
  }
  await route.fulfill({ status: 200, body: bytes, headers: baseHeaders });
}

async function fulfillMediaRoute(route: Route, pathname: string): Promise<boolean> {
  if (pathname === imagePath) {
    await fulfillBytes(route, onePixelPng, 'image/png');
    return true;
  }
  if (pathname === videoPath) {
    await fulfillBytes(route, tinyMp4, 'video/mp4', true);
    return true;
  }
  if (pathname === unavailablePath) {
    await route.fulfill({ status: 415, body: '' });
    return true;
  }
  return false;
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
      if (route.request().method() === 'HEAD') {
        await route.fulfill({
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Disposition': 'attachment; filename="share-image.png"',
            'Content-Length': String(onePixelPng.length),
            'Content-Type': 'image/png',
            'X-Content-Type-Options': 'nosniff',
          },
          body: '',
        });
      } else {
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
      }
      return;
    }
    if (await fulfillMediaRoute(route, pathname)) return;
    await route.fulfill({
      status: 418,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'private, no-store' },
      body: JSON.stringify({ code: 'TASK7_UNEXPECTED_PUBLIC_SHARE_PATH' }),
    });
  });
}

export type ForbiddenReason =
  | 'unsafe-method'
  | 'cross-origin'
  | 'unexpected-navigation'
  | 'unexpected-public-share-path'
  | 'unexpected-request';

export interface ShareRequestRecord {
  method: string;
  origin: string;
  pathname: string;
  resourceType: string;
  navigation: boolean;
  reason?: ForbiddenReason;
}

export interface ShareEvidence {
  startedAt: string;
  requests: ShareRequestRecord[];
  apiRequests: Array<{ method: string; pathname: string }>;
  forbiddenRequests: ShareRequestRecord[];
  consoleErrors: string[];
  details: Record<string, unknown>;
}

export function createShareEvidence(startedAt = new Date().toISOString()): ShareEvidence {
  return {
    startedAt,
    requests: [],
    apiRequests: [],
    forbiddenRequests: [],
    consoleErrors: [],
    details: {},
  };
}

function requestReason(request: Request, expectedOrigin: string): ForbiddenReason | null {
  const method = request.method();
  const url = new URL(request.url());
  if (method !== 'GET' && method !== 'HEAD') return 'unsafe-method';
  if (url.origin !== expectedOrigin) return 'cross-origin';
  if ([metadataPath, imagePath, videoPath, unavailablePath, downloadPath].includes(url.pathname)) return null;
  const expectedSharePath = `/shared/canvas/${fixtureToken}`;
  if (request.isNavigationRequest()) {
    return url.pathname === expectedSharePath && !url.search ? null : 'unexpected-navigation';
  }
  if (
    url.pathname.startsWith('/_next/static/')
    || url.pathname === '/_next/webpack-hmr'
    || url.pathname === '/favicon.ico'
  ) return null;
  if (url.pathname.startsWith('/api/public/canvas-shares/')) return 'unexpected-public-share-path';
  return 'unexpected-request';
}

export function observeReadOnlyShareRequests(
  context: BrowserContext,
  evidence: ShareEvidence,
  baseURL: string,
): () => void {
  const expectedOrigin = new URL(baseURL).origin;
  const onRequest = (request: Request): void => {
    const url = new URL(request.url());
    const reason = requestReason(request, expectedOrigin);
    const record: ShareRequestRecord = {
      method: request.method(),
      origin: url.origin,
      pathname: url.pathname,
      resourceType: request.resourceType(),
      navigation: request.isNavigationRequest(),
      ...(reason ? { reason } : {}),
    };
    evidence.requests.push(record);
    if (url.pathname.startsWith('/api/')) {
      evidence.apiRequests.push({ method: record.method, pathname: record.pathname });
    }
    if (reason) evidence.forbiddenRequests.push(record);
  };
  context.on('request', onRequest);
  return () => context.off('request', onRequest);
}

function redactFixturePath(pathname: string): string {
  return pathname
    .replace(fixtureToken, ':share-token')
    .replace(imageItemRef, ':image-item')
    .replace(videoItemRef, ':video-item')
    .replace(unavailableItemRef, ':unavailable-item');
}

type EvidenceStatus = 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'unexpected';

function evidenceStatus(testInfo: TestInfo, hasForbiddenRequests: boolean): EvidenceStatus {
  if (hasForbiddenRequests) return 'failed';
  if (testInfo.status === 'passed' && testInfo.expectedStatus === 'passed') return 'passed';
  if (testInfo.status === 'timedOut') return 'timedOut';
  if (testInfo.status === 'interrupted') return 'interrupted';
  if (testInfo.status === 'failed') return 'failed';
  return 'unexpected';
}

async function attachEvidence(
  page: Page,
  evidence: ShareEvidence,
  testInfo: TestInfo,
  status: EvidenceStatus,
): Promise<void> {
  const completedAt = new Date().toISOString();
  const body = JSON.stringify({
    status,
    startedAt: evidence.startedAt,
    completedAt,
    testTitle: testInfo.titlePath,
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    requests: evidence.requests.map(request => ({
      ...request,
      origin: request.origin === new URL(String(testInfo.project.use.baseURL)).origin ? ':same-origin' : request.origin,
      pathname: redactFixturePath(request.pathname),
    })),
    apiRequests: evidence.apiRequests.map(request => ({ ...request, pathname: redactFixturePath(request.pathname) })),
    forbiddenRequestCount: evidence.forbiddenRequests.length,
    forbiddenRequests: evidence.forbiddenRequests.map(request => ({
      ...request,
      origin: request.origin === new URL(String(testInfo.project.use.baseURL)).origin ? ':same-origin' : request.origin,
      pathname: redactFixturePath(request.pathname),
    })),
    consoleErrors: evidence.consoleErrors,
    details: evidence.details,
  }, null, 2);
  const safeTitle = testInfo.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/gu, '-');
  const evidenceDirectory = resolve(evidenceRoot, testInfo.project.name);
  const evidencePath = resolve(evidenceDirectory, `${safeTitle}--${status}.json`);
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(evidencePath, body, 'utf8');
  await testInfo.attach(`只读分享证据-${safeTitle}-${status}`, { path: evidencePath, contentType: 'application/json' });
}

export const test = base.extend<{ shareEvidence: ShareEvidence }>({
  shareEvidence: [async ({ context, page }, runTest, testInfo) => {
    const evidence = createShareEvidence();
    const stopObserving = observeReadOnlyShareRequests(
      context,
      evidence,
      String(testInfo.project.use.baseURL),
    );
    const attachConsole = (targetPage: Page): void => {
      targetPage.on('console', message => {
        if (message.type() === 'error') evidence.consoleErrors.push(redactFixturePath(message.text()).slice(0, 2_000));
      });
    };
    const attachPageError = (targetPage: Page): void => {
      targetPage.on('pageerror', error => {
        evidence.consoleErrors.push(redactFixturePath(error.message).slice(0, 2_000));
      });
    };
    const observePage = (targetPage: Page): void => {
      attachConsole(targetPage);
      attachPageError(targetPage);
    };
    context.pages().forEach(observePage);
    context.on('page', observePage);
    try {
      await runTest(evidence);
    } finally {
      stopObserving();
      context.off('page', observePage);
      const skipped = testInfo.status === 'skipped'
        || testInfo.expectedStatus === 'skipped'
        || testInfo.annotations.some(annotation => annotation.type === 'skip');
      if (!skipped) {
        const status = evidenceStatus(testInfo, evidence.forbiddenRequests.length > 0);
        await attachEvidence(page, evidence, testInfo, status);
        expect(
          evidence.forbiddenRequests,
          `只读分享出现未允许请求：${evidence.forbiddenRequests.map(request => `${request.method} ${request.origin}${request.pathname} (${request.reason})`).join(', ')}`,
        ).toEqual([]);
      }
    }
  }, { auto: true }],
});

export function expectNoForbiddenRequests(evidence: ShareEvidence): void {
  expect(evidence.forbiddenRequests).toEqual([]);
}

import { resolve } from 'node:path';

import {
  expect,
  test as base,
  type BrowserContext,
  type Frame,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from '@playwright/test';

import {
  writeTask7EvidenceRecord,
  type Task7EvidenceStatus,
} from './read-only-canvas-share-evidence';

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
  'read-only-canvas-share-evidence',
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
  const baseHeaders = commonMediaHeaders(contentType, bytes.length);
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
      || start < 0 || requestedEnd < start || start >= bytes.length) {
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
    const end = Math.min(requestedEnd, bytes.length - 1);
    const slice = bytes.subarray(start, end + 1);
    await route.fulfill({
      status: 206,
      body: slice,
      headers: {
        ...commonMediaHeaders(contentType, slice.length),
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
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
  | 'contract-not-configured'
  | 'unexpected-page'
  | 'unexpected-frame'
  | 'unexpected-search'
  | 'unexpected-navigation'
  | 'request-contract-mismatch'
  | 'scenario-forbidden-endpoint'
  | 'unexpected-public-share-path'
  | 'unexpected-request';

export type ShareScenario =
  | 'desktop-valid'
  | 'desktop-invalid'
  | 'desktop-download-off'
  | 'desktop-download-on'
  | 'mobile-portrait'
  | 'mobile-landscape';

type PageRole = 'primary' | 'secondary' | 'no-frame';
type FrameRole = 'main' | 'child' | 'none';

export interface ShareRequestRecord {
  method: string;
  origin: string;
  pathname: string;
  search: string;
  resourceType: string;
  navigation: boolean;
  pageRole: PageRole;
  frameRole: FrameRole;
  range: string | null;
  reason?: ForbiddenReason;
}

export interface ShareFrameNavigationRecord {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  pageRole: PageRole;
  frameRole: FrameRole;
  reason?: ForbiddenReason;
}

export interface ShareEvidence {
  startedAt: string;
  scenario: ShareScenario | null;
  identity: string | null;
  requests: ShareRequestRecord[];
  frameNavigations: ShareFrameNavigationRecord[];
  apiRequests: Array<{ method: string; pathname: string }>;
  forbiddenRequests: ShareRequestRecord[];
  forbiddenFrameNavigations: ShareFrameNavigationRecord[];
  consoleErrors: string[];
  details: Record<string, unknown>;
}

export function createShareEvidence(startedAt = new Date().toISOString()): ShareEvidence {
  return {
    startedAt,
    scenario: null,
    identity: null,
    requests: [],
    frameNavigations: [],
    apiRequests: [],
    forbiddenRequests: [],
    forbiddenFrameNavigations: [],
    consoleErrors: [],
    details: {},
  };
}

export function configureShareEvidence(
  evidence: ShareEvidence,
  scenario: ShareScenario,
  identity: string,
): void {
  if (evidence.requests.length > 0) throw new Error('Share evidence must be configured before the first request');
  if (!identity.trim()) throw new Error('Share evidence identity must not be empty');
  evidence.scenario = scenario;
  evidence.identity = identity;
}

interface ExpectedRequest {
  method: 'GET' | 'HEAD';
  pathname: string;
  search: string;
  resourceType: string;
  navigation: boolean;
  ranges: Array<string | null>;
  count: number;
  label: string;
}

const expectedSharePath = `/shared/canvas/${fixtureToken}`;
const publicEndpointPaths = new Set([metadataPath, imagePath, videoPath, unavailablePath, downloadPath]);

function expectedRequest(
  label: string,
  pathname: string,
  resourceType: string,
  count = 1,
  options: Partial<Omit<ExpectedRequest, 'label' | 'pathname' | 'resourceType' | 'count'>> = {},
): ExpectedRequest {
  return {
    label,
    pathname,
    resourceType,
    count,
    method: options.method ?? 'GET',
    search: options.search ?? '',
    navigation: options.navigation ?? false,
    ranges: options.ranges ?? [null],
  };
}

function expectedScenarioRequests(scenario: ShareScenario): ExpectedRequest[] {
  const base = [
    expectedRequest('share document', expectedSharePath, 'document', 1, { navigation: true }),
    expectedRequest('metadata', metadataPath, 'fetch'),
  ];
  if (scenario === 'desktop-invalid') return base;

  const media = [
    expectedRequest('initial image media', imagePath, 'image', scenario === 'desktop-download-off' ? 1 : 2),
    expectedRequest('unavailable image media', unavailablePath, 'image'),
    expectedRequest('browser video lifecycle', videoPath, 'media', 1, { ranges: [null, 'bytes=0-'] }),
  ];
  if (scenario === 'desktop-valid') {
    return [
      ...base,
      ...media,
      expectedRequest('video HEAD probe', videoPath, 'fetch', 1, { method: 'HEAD' }),
      expectedRequest('video partial probe', videoPath, 'fetch', 1, { ranges: ['bytes=2-5'] }),
      expectedRequest('video clamped probe', videoPath, 'fetch', 1, { ranges: ['bytes=1540-999999'] }),
      expectedRequest('video unsatisfiable probe', videoPath, 'fetch', 1, { ranges: ['bytes=999999-1000000'] }),
    ];
  }
  if (scenario === 'desktop-download-off') {
    return [...base, ...media, expectedRequest('disabled download probe', downloadPath, 'fetch')];
  }
  if (scenario === 'desktop-download-on') {
    return [...base, ...media, expectedRequest('controlled download', downloadPath, 'document', 1, { navigation: true })];
  }
  return [...base, ...media];
}

function isInfrastructureRequest(record: ShareRequestRecord): boolean {
  return record.pathname.startsWith('/_next/static/')
    || record.pathname === '/_next/webpack-hmr'
    || /^\/__nextjs_font\/geist(?:-mono)?-latin\.woff2$/u.test(record.pathname)
    || (record.pathname === expectedSharePath && record.search.startsWith('?_rsc='))
    || record.pathname === '/favicon.ico';
}

function hasApprovedInfrastructureSearch(record: ShareRequestRecord): boolean {
  if (record.search === '') return true;
  if (record.pathname.startsWith('/_next/static/')) return /^\?v=\d+$/u.test(record.search);
  if (record.pathname === expectedSharePath) return /^\?_rsc=[a-zA-Z0-9_-]+$/u.test(record.search);
  if (record.pathname === '/favicon.ico') return /^\?[a-f0-9]+$/u.test(record.search);
  return false;
}

function hasApprovedInfrastructureShape(record: ShareRequestRecord): boolean {
  if (record.navigation) return false;
  if (/^\/__nextjs_font\/geist(?:-mono)?-latin\.woff2$/u.test(record.pathname)) {
    return record.resourceType === 'font';
  }
  if (record.pathname === expectedSharePath && record.search.startsWith('?_rsc=')) {
    return record.resourceType === 'fetch';
  }
  if (/^\/_next\/static\/webpack\/[a-f0-9]+\.webpack\.hot-update\.json$/u.test(record.pathname)) {
    return record.resourceType === 'fetch';
  }
  return ['script', 'stylesheet', 'image', 'other'].includes(record.resourceType);
}

function matchesExpected(record: ShareRequestRecord, expected: ExpectedRequest): boolean {
  return record.method === expected.method
    && record.pathname === expected.pathname
    && record.search === expected.search
    && record.resourceType === expected.resourceType
    && record.navigation === expected.navigation
    && expected.ranges.includes(record.range);
}

function scenarioAllowsPath(scenario: ShareScenario, pathname: string): boolean {
  return expectedScenarioRequests(scenario).some(expected => expected.pathname === pathname);
}

function requestReason(
  record: ShareRequestRecord,
  expectedOrigin: string,
  scenario: ShareScenario | null,
): ForbiddenReason | null {
  if (record.method !== 'GET' && record.method !== 'HEAD') return 'unsafe-method';
  if (record.origin !== expectedOrigin) return 'cross-origin';
  if (!scenario) return 'contract-not-configured';
  if (record.pageRole !== 'primary') return 'unexpected-page';
  if (record.frameRole !== 'main') return 'unexpected-frame';
  if (isInfrastructureRequest(record)) {
    return !hasApprovedInfrastructureSearch(record)
      ? 'unexpected-search'
      : !hasApprovedInfrastructureShape(record)
      ? 'request-contract-mismatch'
      : null;
  }
  if (record.search !== '') return 'unexpected-search';
  if (record.navigation && record.pathname !== expectedSharePath && record.pathname !== downloadPath) {
    return 'unexpected-navigation';
  }
  if (publicEndpointPaths.has(record.pathname) && !scenarioAllowsPath(scenario, record.pathname)) {
    return 'scenario-forbidden-endpoint';
  }
  const expected = expectedScenarioRequests(scenario);
  if (expected.some(contract => matchesExpected(record, contract))) return null;
  if (record.pathname.startsWith('/api/public/canvas-shares/')) {
    return publicEndpointPaths.has(record.pathname) ? 'request-contract-mismatch' : 'unexpected-public-share-path';
  }
  if (record.pathname === expectedSharePath) return 'request-contract-mismatch';
  if (record.navigation) return 'unexpected-navigation';
  return 'unexpected-request';
}

export interface ShareRequestContractValidation {
  valid: boolean;
  errors: string[];
  expected: Array<{ label: string; count: number }>;
  actual: Array<{ label: string; count: number }>;
}

export function validateShareRequestContract(evidence: ShareEvidence): ShareRequestContractValidation {
  if (!evidence.scenario) {
    return { valid: false, errors: ['request contract is not configured'], expected: [], actual: [] };
  }
  const expected = expectedScenarioRequests(evidence.scenario);
  const relevant = evidence.requests.filter(record => !isInfrastructureRequest(record));
  const errors: string[] = [];
  const actual = expected.map(contract => {
    const count = relevant.filter(record => matchesExpected(record, contract)).length;
    if (count !== contract.count) errors.push(`${contract.label}: expected ${contract.count}, received ${count}`);
    return { label: contract.label, count };
  });
  const matched = relevant.filter(record => expected.some(contract => matchesExpected(record, contract))).length;
  if (matched !== relevant.length) errors.push(`unexpected scenario requests: ${relevant.length - matched}`);
  if (evidence.forbiddenRequests.length > 0) errors.push(`forbidden requests: ${evidence.forbiddenRequests.length}`);
  if (evidence.forbiddenFrameNavigations.length > 0) {
    errors.push(`forbidden frame navigations: ${evidence.forbiddenFrameNavigations.length}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    expected: expected.map(contract => ({ label: contract.label, count: contract.count })),
    actual,
  };
}

function requestFrameRoles(request: Request, primaryPage: Page): { pageRole: PageRole; frameRole: FrameRole } {
  try {
    const frame = request.frame();
    const page = frame.page();
    return {
      pageRole: page === primaryPage ? 'primary' : 'secondary',
      frameRole: frame === page.mainFrame() ? 'main' : 'child',
    };
  } catch {
    return { pageRole: 'no-frame', frameRole: 'none' };
  }
}

export function observeReadOnlyShareRequests(
  context: BrowserContext,
  evidence: ShareEvidence,
  baseURL: string,
  primaryPage: Page,
): { settleAndStop: () => Promise<void> } {
  const expectedOrigin = new URL(baseURL).origin;
  const pendingRequests = new Set<Request>();
  const pendingWaiters = new Set<() => void>();
  const frameUrls = new WeakMap<Frame, string>();
  const observedPages = new Set<Page>();

  const notifyIfSettled = (): void => {
    if (pendingRequests.size !== 0) return;
    for (const resolveWaiter of pendingWaiters) resolveWaiter();
    pendingWaiters.clear();
  };
  const onRequest = (request: Request): void => {
    pendingRequests.add(request);
    const url = new URL(request.url());
    const record: ShareRequestRecord = {
      method: request.method(),
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      resourceType: request.resourceType(),
      navigation: request.isNavigationRequest(),
      range: request.headers().range ?? null,
      ...requestFrameRoles(request, primaryPage),
    };
    const reason = requestReason(record, expectedOrigin, evidence.scenario);
    if (reason) record.reason = reason;
    evidence.requests.push(record);
    if (url.pathname.startsWith('/api/')) {
      evidence.apiRequests.push({ method: record.method, pathname: record.pathname });
    }
    if (reason) evidence.forbiddenRequests.push(record);
  };
  const onRequestSettled = (request: Request): void => {
    pendingRequests.delete(request);
    notifyIfSettled();
  };
  const reconcileClosedPageRequests = (): void => {
    for (const request of pendingRequests) {
      try {
        if (request.frame().page().isClosed()) pendingRequests.delete(request);
      } catch {
        if (context.pages().every(targetPage => targetPage.isClosed())) pendingRequests.delete(request);
      }
    }
    notifyIfSettled();
  };
  const observePage = (targetPage: Page): void => {
    if (observedPages.has(targetPage)) return;
    observedPages.add(targetPage);
    for (const frame of targetPage.frames()) frameUrls.set(frame, frame.url());
    targetPage.on('framenavigated', onFrameNavigated);
  };
  const onFrameNavigated = (frame: Frame): void => {
    const previous = frameUrls.get(frame);
    const current = frame.url();
    frameUrls.set(frame, current);
    if (!previous || previous === 'about:blank' || current === 'about:blank') return;
    const previousUrl = new URL(previous);
    const currentUrl = new URL(current);
    if (previousUrl.origin !== currentUrl.origin
      || previousUrl.pathname !== currentUrl.pathname
      || previousUrl.search !== currentUrl.search
      || previousUrl.hash === currentUrl.hash) return;
    const page = frame.page();
    const record: ShareFrameNavigationRecord = {
      origin: currentUrl.origin,
      pathname: currentUrl.pathname,
      search: currentUrl.search,
      hash: currentUrl.hash,
      pageRole: page === primaryPage ? 'primary' : 'secondary',
      frameRole: frame === page.mainFrame() ? 'main' : 'child',
      reason: 'unexpected-navigation',
    };
    evidence.frameNavigations.push(record);
    evidence.forbiddenFrameNavigations.push(record);
  };
  const waitForPendingRequests = async (): Promise<void> => {
    if (pendingRequests.size === 0) return;
    await new Promise<void>((resolveWaiter, reject) => {
      const complete = (): void => {
        clearTimeout(timeout);
        resolveWaiter();
      };
      const timeout = setTimeout(() => {
        pendingWaiters.delete(complete);
        const pending = [...pendingRequests].map(request => `${request.method()} ${request.url()}`).join(', ');
        reject(new Error(`Timed out waiting for ${pendingRequests.size} observed request(s) to settle: ${pending}`));
      }, 10_000);
      pendingWaiters.add(complete);
    });
  };
  context.on('request', onRequest);
  context.on('requestfinished', onRequestSettled);
  context.on('requestfailed', onRequestSettled);
  context.on('page', observePage);
  context.pages().forEach(observePage);
  return {
    settleAndStop: async (): Promise<void> => {
      const openPages = context.pages().filter(targetPage => !targetPage.isClosed());
      await Promise.all(openPages.map(targetPage => targetPage.evaluate(() => {
        for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
          media.pause();
          media.removeAttribute('src');
          media.load();
        }
      }).catch(error => {
        if (!targetPage.isClosed()) throw error;
      })));
      const pagesToClose = context.pages().filter(targetPage => !targetPage.isClosed());
      await Promise.all(pagesToClose.map(targetPage => targetPage.close({ runBeforeUnload: false })));
      reconcileClosedPageRequests();
      await waitForPendingRequests();
      context.off('request', onRequest);
      context.off('requestfinished', onRequestSettled);
      context.off('requestfailed', onRequestSettled);
      context.off('page', observePage);
      for (const targetPage of observedPages) targetPage.off('framenavigated', onFrameNavigated);
    },
  };
}

function redactFixturePath(pathname: string): string {
  return pathname
    .replace(fixtureToken, ':share-token')
    .replace(imageItemRef, ':image-item')
    .replace(videoItemRef, ':video-item')
    .replace(unavailableItemRef, ':unavailable-item');
}

function evidenceStatus(testInfo: TestInfo, contractValid: boolean): Task7EvidenceStatus {
  if (!contractValid) return 'failed';
  if (testInfo.status === 'passed' && testInfo.expectedStatus === 'passed') return 'passed';
  if (testInfo.status === 'timedOut') return 'timedOut';
  if (testInfo.status === 'interrupted') return 'interrupted';
  if (testInfo.status === 'failed') return 'failed';
  return 'unexpected';
}

function requiredEvidenceRunBinding(): {
  runId: string;
  candidateCommit: string;
  executionNonce: string;
} {
  const runId = process.env.TASK7_EVIDENCE_RUN_ID?.trim();
  const candidateCommit = process.env.TASK7_EVIDENCE_COMMIT?.trim().toLowerCase();
  const executionNonce = process.env.TASK7_EVIDENCE_NONCE?.trim().toLowerCase();
  if (!runId || !candidateCommit || !executionNonce) {
    throw new Error('Task 7 evidence run must be initialized; set TASK7_EVIDENCE_RUN_ID, TASK7_EVIDENCE_COMMIT, and TASK7_EVIDENCE_NONCE');
  }
  return { runId, candidateCommit, executionNonce };
}

async function attachEvidence(
  viewport: { width: number; height: number } | null,
  evidence: ShareEvidence,
  testInfo: TestInfo,
  status: Task7EvidenceStatus,
  validation: ShareRequestContractValidation,
): Promise<void> {
  const { runId, candidateCommit, executionNonce } = requiredEvidenceRunBinding();
  const completedAt = new Date().toISOString();
  const identity = evidence.identity ?? `${testInfo.project.name}/${testInfo.title}`;
  const record = {
    schemaVersion: 3 as const,
    runId,
    candidateCommit,
    executionNonce,
    identity,
    scenario: evidence.scenario ?? 'unconfigured',
    status,
    startedAt: evidence.startedAt,
    completedAt,
    testTitle: testInfo.titlePath,
    project: testInfo.project.name,
    viewport,
    requests: evidence.requests.map(request => ({
      ...request,
      origin: request.origin === new URL(String(testInfo.project.use.baseURL)).origin ? ':same-origin' : request.origin,
      pathname: redactFixturePath(request.pathname),
    })),
    frameNavigations: evidence.frameNavigations.map(navigation => ({
      ...navigation,
      origin: navigation.origin === new URL(String(testInfo.project.use.baseURL)).origin ? ':same-origin' : navigation.origin,
      pathname: redactFixturePath(navigation.pathname),
    })),
    apiRequests: evidence.apiRequests.map(request => ({ ...request, pathname: redactFixturePath(request.pathname) })),
    forbiddenRequestCount: evidence.forbiddenRequests.length,
    forbiddenRequests: evidence.forbiddenRequests.map(request => ({
      ...request,
      origin: request.origin === new URL(String(testInfo.project.use.baseURL)).origin ? ':same-origin' : request.origin,
      pathname: redactFixturePath(request.pathname),
    })),
    forbiddenFrameNavigationCount: evidence.forbiddenFrameNavigations.length,
    forbiddenFrameNavigations: evidence.forbiddenFrameNavigations.map(navigation => ({
      ...navigation,
      origin: navigation.origin === new URL(String(testInfo.project.use.baseURL)).origin ? ':same-origin' : navigation.origin,
      pathname: redactFixturePath(navigation.pathname),
    })),
    requestContractValid: validation.valid,
    requestContract: validation,
    consoleErrors: evidence.consoleErrors,
    details: evidence.details,
  };
  const safeTitle = identity.replace(/[^a-zA-Z0-9\u4e00-\u9fff_.-]+/gu, '-');
  const { recordPath } = await writeTask7EvidenceRecord({ rootDirectory: evidenceRoot, record });
  await testInfo.attach(`只读分享证据-${safeTitle}-${status}`, { path: recordPath, contentType: 'application/json' });
}

export const test = base.extend<{ shareEvidence: ShareEvidence }>({
  shareEvidence: [async ({ context, page }, runTest, testInfo) => {
    const evidence = createShareEvidence();
    const observer = observeReadOnlyShareRequests(
      context,
      evidence,
      String(testInfo.project.use.baseURL),
      page,
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
      const viewport = page.viewportSize();
      await observer.settleAndStop();
      context.off('page', observePage);
      const skipped = testInfo.status === 'skipped'
        || testInfo.expectedStatus === 'skipped'
        || testInfo.annotations.some(annotation => annotation.type === 'skip');
      if (!skipped) {
        const validation = validateShareRequestContract(evidence);
        const status = evidenceStatus(testInfo, validation.valid);
        await attachEvidence(viewport, evidence, testInfo, status, validation);
        if (!validation.valid) {
          throw new Error(`只读分享请求契约失败：${validation.errors.join('; ')}`);
        }
      }
    }
  }, { auto: true }],
});

export function expectNoForbiddenRequests(evidence: ShareEvidence): void {
  expect(evidence.forbiddenRequests).toEqual([]);
}

import { expect, test } from '@playwright/test';

import {
  configureShareEvidence,
  createShareEvidence,
  downloadPath,
  fixtureToken,
  imagePath,
  installReadOnlyShareFixture,
  metadataPath,
  observeReadOnlyShareRequests,
  videoPath,
  type ShareRequestRecord,
} from '../helpers/read-only-canvas-share-e2e';

test.use({ serviceWorkers: 'block', trace: 'on', screenshot: 'on' });

function signature(record: ShareRequestRecord): Record<string, unknown> {
  return {
    method: record.method,
    origin: record.origin,
    pathname: record.pathname,
    search: record.search,
    reason: record.reason,
    pageRole: record.pageRole,
    frameRole: record.frameRole,
    resourceType: record.resourceType,
    navigation: record.navigation,
    range: record.range,
  };
}

function sortSignatures(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return records.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

test('context gate records the exact negative request and frame-navigation multiset', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', '网络门禁负向自测仅在 Chromium 执行一次');
  const baseURL = String(testInfo.project.use.baseURL);
  const sameOrigin = new URL(baseURL).origin;
  const evidence = createShareEvidence();
  configureShareEvidence(evidence, 'desktop-invalid', 'network-gate/negative-self-test');
  const observer = observeReadOnlyShareRequests(context, evidence, baseURL, page);
  let stopped = false;
  await context.route('https://task7.invalid/**', route => route.abort('blockedbyclient'));
  await context.route('**/__task7-probe/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/__task7-probe/redirect') {
      await route.fulfill({ status: 302, headers: { Location: '/__task7-probe/redirect-target' }, body: '' });
      return;
    }
    await route.abort('blockedbyclient');
  });
  await installReadOnlyShareFixture(page, { invalid: true });

  try {
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: '分享不存在或已失效' })).toBeVisible();

    await page.evaluate(async () => {
      await fetch('/__task7-probe/non-api-write', { method: 'POST' }).catch(() => undefined);
      await fetch('https://task7.invalid/read').catch(() => undefined);
      await fetch('https://task7.invalid/write', { method: 'POST' }).catch(() => undefined);
    });
    expect(await page.evaluate(async path => {
      const response = await fetch(`${path}/unexpected`);
      await response.text();
      return response.status;
    }, metadataPath)).toBe(418);
    await page.evaluate(async ({ metadata, image }) => {
      await fetch(`${metadata}?probe=1`).then(response => response.text()).catch(() => undefined);
      await fetch(image).then(response => response.arrayBuffer()).catch(() => undefined);
    }, { metadata: metadataPath, image: imagePath });

    const navigateAndClose = async (url: string, routePattern?: string): Promise<void> => {
      const target = await context.newPage();
      if (routePattern) await target.route(routePattern, route => route.abort('blockedbyclient'));
      await target.goto(url, { waitUntil: 'commit' }).catch(() => undefined);
      await target.close();
    };
    await navigateAndClose(`${baseURL}/__task7-probe/extra-navigation`);
    for (const path of [metadataPath, imagePath, videoPath, downloadPath]) {
      await navigateAndClose(new URL(path, baseURL).toString());
    }
    await navigateAndClose(
      `${baseURL}/shared/canvas/${fixtureToken}`,
      `**/shared/canvas/${fixtureToken}`,
    );

    await page.evaluate(async () => {
      await new Promise<void>(resolveProbe => {
        setTimeout(() => {
          void fetch('/__task7-probe/delayed').catch(() => undefined).finally(resolveProbe);
        }, 0);
      });
      await fetch('/__task7-probe/redirect').catch(() => undefined);
    });
    await Promise.all([
      page.waitForEvent('framenavigated'),
      page.evaluate(() => { window.location.hash = 'task7-negative'; }),
    ]);

    await observer.settleAndStop();
    stopped = true;

    const expected = [
      { method: 'POST', origin: sameOrigin, pathname: '/__task7-probe/non-api-write', search: '', reason: 'unsafe-method', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: 'https://task7.invalid', pathname: '/read', search: '', reason: 'cross-origin', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'POST', origin: 'https://task7.invalid', pathname: '/write', search: '', reason: 'unsafe-method', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: sameOrigin, pathname: `${metadataPath}/unexpected`, search: '', reason: 'unexpected-public-share-path', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: sameOrigin, pathname: metadataPath, search: '?probe=1', reason: 'unexpected-search', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: sameOrigin, pathname: imagePath, search: '', reason: 'scenario-forbidden-endpoint', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: sameOrigin, pathname: '/__task7-probe/extra-navigation', search: '', reason: 'unexpected-page', pageRole: 'secondary', frameRole: 'main', resourceType: 'document', navigation: true, range: null },
      ...[metadataPath, imagePath, videoPath, downloadPath].map(pathname => ({
        method: 'GET', origin: sameOrigin, pathname, search: '', reason: 'unexpected-page',
        pageRole: 'secondary', frameRole: 'main', resourceType: 'document', navigation: true, range: null,
      })),
      { method: 'GET', origin: sameOrigin, pathname: `/shared/canvas/${fixtureToken}`, search: '', reason: 'unexpected-page', pageRole: 'secondary', frameRole: 'main', resourceType: 'document', navigation: true, range: null },
      { method: 'GET', origin: sameOrigin, pathname: '/__task7-probe/delayed', search: '', reason: 'unexpected-request', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: sameOrigin, pathname: '/__task7-probe/redirect', search: '', reason: 'unexpected-request', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
      { method: 'GET', origin: sameOrigin, pathname: '/__task7-probe/redirect-target', search: '', reason: 'unexpected-request', pageRole: 'primary', frameRole: 'main', resourceType: 'fetch', navigation: false, range: null },
    ];
    expect(sortSignatures(evidence.forbiddenRequests.map(signature))).toEqual(sortSignatures(expected));
    expect(evidence.forbiddenRequests).toHaveLength(15);
    expect(evidence.forbiddenFrameNavigations).toEqual([{
      origin: sameOrigin,
      pathname: `/shared/canvas/${fixtureToken}`,
      search: '',
      hash: '#task7-negative',
      pageRole: 'primary',
      frameRole: 'main',
      reason: 'unexpected-navigation',
    }]);
  } finally {
    if (!stopped) await observer.settleAndStop();
  }
});

import { expect, test } from '@playwright/test';

import {
  createShareEvidence,
  fixtureToken,
  installReadOnlyShareFixture,
  metadataPath,
  observeReadOnlyShareRequests,
} from '../helpers/read-only-canvas-share-e2e';

test.use({ serviceWorkers: 'block', trace: 'on', screenshot: 'on' });

test('context gate records non-API writes, cross-origin traffic, unknown public paths, and extra navigation', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', '网络门禁负向自测仅在 Chromium 执行一次');
  const baseURL = String(testInfo.project.use.baseURL);
  const evidence = createShareEvidence();
  const stopObserving = observeReadOnlyShareRequests(context, evidence, baseURL);
  await context.route('https://task7.invalid/**', route => route.abort('blockedbyclient'));
  await context.route('**/__task7-probe/**', route => route.abort('blockedbyclient'));
  await installReadOnlyShareFixture(page);

  try {
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: '跨浏览器只读画布夹具' })).toBeVisible();

    await page.evaluate(async () => {
      await fetch('/__task7-probe/non-api-write', { method: 'POST' }).catch(() => undefined);
      await fetch('https://task7.invalid/read').catch(() => undefined);
      await fetch('https://task7.invalid/write', { method: 'POST' }).catch(() => undefined);
    });
    const unknownStatus = await page.evaluate(async path => (await fetch(`${path}/unexpected`)).status, metadataPath);
    expect(unknownStatus).toBe(418);
    const extraPage = await context.newPage();
    await extraPage.goto(`${baseURL}/__task7-probe/extra-navigation`).catch(() => undefined);
    await extraPage.close();

    await expect.poll(() => evidence.forbiddenRequests.length).toBeGreaterThanOrEqual(5);
    expect(evidence.forbiddenRequests.map(request => ({ method: request.method, pathname: request.pathname, reason: request.reason }))).toEqual([
      { method: 'POST', pathname: '/__task7-probe/non-api-write', reason: 'unsafe-method' },
      { method: 'GET', pathname: '/read', reason: 'cross-origin' },
      { method: 'POST', pathname: '/write', reason: 'unsafe-method' },
      { method: 'GET', pathname: `${metadataPath}/unexpected`, reason: 'unexpected-public-share-path' },
      { method: 'GET', pathname: '/__task7-probe/extra-navigation', reason: 'unexpected-navigation' },
    ]);
  } finally {
    stopObserving();
  }
});

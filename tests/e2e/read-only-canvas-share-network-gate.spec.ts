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
} from '../helpers/read-only-canvas-share-e2e';

test.use({ serviceWorkers: 'block', trace: 'on', screenshot: 'on' });

test('context gate rejects every allowed-path bypass and scenario-forbidden endpoint', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', '网络门禁负向自测仅在 Chromium 执行一次');
  const baseURL = String(testInfo.project.use.baseURL);
  const evidence = createShareEvidence();
  configureShareEvidence(evidence, 'desktop-invalid', 'network-gate/negative-self-test');
  const stopObserving = observeReadOnlyShareRequests(context, evidence, baseURL, page);
  await context.route('https://task7.invalid/**', route => route.abort('blockedbyclient'));
  await context.route('**/__task7-probe/**', route => route.abort('blockedbyclient'));
  await installReadOnlyShareFixture(page, { invalid: true });

  try {
    await page.goto(`/shared/canvas/${fixtureToken}`);
    await expect(page.getByRole('heading', { name: '分享不存在或已失效' })).toBeVisible();

    await page.evaluate(async () => {
      await fetch('/__task7-probe/non-api-write', { method: 'POST' }).catch(() => undefined);
      await fetch('https://task7.invalid/read').catch(() => undefined);
      await fetch('https://task7.invalid/write', { method: 'POST' }).catch(() => undefined);
    });
    const unknownStatus = await page.evaluate(async path => (await fetch(`${path}/unexpected`)).status, metadataPath);
    expect(unknownStatus).toBe(418);
    await page.evaluate(async ({ metadata, image }) => {
      await fetch(`${metadata}?probe=1`).catch(() => undefined);
      await fetch(image).catch(() => undefined);
    }, { metadata: metadataPath, image: imagePath });
    const extraPage = await context.newPage();
    await extraPage.goto(`${baseURL}/__task7-probe/extra-navigation`).catch(() => undefined);
    await extraPage.close();

    for (const path of [metadataPath, imagePath, videoPath, downloadPath]) {
      const apiNavigationPage = await context.newPage();
      await apiNavigationPage.goto(new URL(path, baseURL).toString()).catch(() => undefined);
      await apiNavigationPage.close();
    }
    const secondSharePage = await context.newPage();
    await secondSharePage.goto(`${baseURL}/shared/canvas/${fixtureToken}`).catch(() => undefined);
    await secondSharePage.close();

    await expect.poll(() => evidence.forbiddenRequests.length).toBeGreaterThanOrEqual(11);
    expect(evidence.forbiddenRequests.map(request => request.pathname)).toEqual(expect.arrayContaining([
      '/__task7-probe/non-api-write',
      '/read',
      '/write',
      `${metadataPath}/unexpected`,
      metadataPath,
      imagePath,
      videoPath,
      downloadPath,
      `/shared/canvas/${fixtureToken}`,
    ]));
  } finally {
    stopObserving();
  }
});

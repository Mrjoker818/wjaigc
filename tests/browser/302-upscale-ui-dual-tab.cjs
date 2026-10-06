// CLI-only product UI gate. Prepare two tabs in the same Chromium context, both at
// the same source with a visible "确认 7 积分" button. All /api/image-edit traffic
// is intercepted in the browser; this script never permits a paid server request.
/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const context = page.context();
  const pages = context.pages();
  const origin = 'http://127.0.0.1:5000';
  if (pages.length !== 2 || pages.some(tab => !tab.url().startsWith(`${origin}/?projectId=demo-project`))) {
    throw new Error(`Expected two isolated local demo-project tabs: ${pages.map(tab => tab.url()).join(', ')}`);
  }
  for (const tab of pages) {
    await tab.getByRole('button', { name: '确认 7 积分' }).waitFor();
  }
  const initialMarkers = await page.evaluate(() =>
    Object.keys(localStorage).filter(key => key.startsWith('wujie:upscale302:attempt:')));
  if (initialMarkers.length !== 0) throw new Error(`Test source already has ${initialMarkers.length} pending markers`);

  const paid = [];
  let releasePaid;
  let firstPaid;
  const gate = new Promise(resolve => { releasePaid = resolve; });
  const firstPaidReached = new Promise(resolve => { firstPaid = resolve; });
  const handler = async route => {
    const request = route.request();
    const body = JSON.parse(request.postData() || '{}');
    if (body.quoteOnly === true) {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, quote: { token: 'local-test-quote', total: 7,
          components: { upscale: 7, enhance: 0 }, expiresAt: Date.now() + 300000 } }) });
      return;
    }
    paid.push({ key: request.headers()['idempotency-key'], model: body.upscaleModel,
      imageUrl: body.imageUrl, projectId: body.projectId });
    firstPaid();
    await gate;
    await route.fulfill({ status: 202, contentType: 'application/json',
      body: JSON.stringify({ success: true, action: 'upscale', status: 'submission-unknown',
        taskId: 'local-browser-task', message: 'Local test response; no paid provider contacted' }) });
  };
  await context.route('**/api/image-edit', handler);
  try {
    const clicks = pages.map(tab => tab.getByRole('button', { name: '确认 7 积分' }).click());
    await Promise.race([
      firstPaidReached,
      page.waitForTimeout(15_000).then(() => { throw new Error('No paid request reached the browser intercept'); }),
    ]);
    await page.waitForTimeout(1500);
    const inFlightCount = paid.length;
    releasePaid();
    const clickResults = await Promise.allSettled(clicks);
    await page.waitForTimeout(500);
    const markerKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter(key => key.startsWith('wujie:upscale302:attempt:')));
    if (clickResults.some(result => result.status === 'rejected')) {
      throw new Error(`A confirmation click failed: ${JSON.stringify(clickResults.map(result => result.status))}`);
    }
    if (inFlightCount !== 1 || paid.length !== 1 || markerKeys.length !== 1) {
      throw new Error(`Duplicate or missing submission: ${JSON.stringify({ inFlightCount, paid, markerKeys })}`);
    }
    if (paid[0].model !== '302-esrgan' || !String(paid[0].imageUrl).includes('/gallery/cat-0/g1.jpg')) {
      throw new Error(`Wrong request identity: ${JSON.stringify(paid[0])}`);
    }
    return { browser: 'Chromium', tabs: pages.length, quoteButtons: 2,
      paidPostsIntercepted: paid.length, inFlightPaidPosts: inFlightCount,
      pendingMarkers: markerKeys.length, providerContacted: false,
      model: paid[0].model, source: paid[0].imageUrl };
  } finally {
    releasePaid();
    await context.unroute('**/api/image-edit', handler);
  }
}

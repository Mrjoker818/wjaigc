// Run with playwright-cli run-code --filename against the current marker module bundled
// as marker.js and served from the dedicated 127.0.0.1:5017 static test origin.
/* eslint-disable @typescript-eslint/no-unused-expressions -- playwright-cli requires a bare function expression. */
async (page) => {
  const origin = 'http://127.0.0.1:5017';
  if (page.url() !== `${origin}/`) throw new Error(`Unexpected test page: ${page.url()}`);
  const other = await page.context().newPage();
  try {
    await other.goto(origin);
    await Promise.all([page, other].map(tab => tab.addScriptTag({ url: `${origin}/marker.js` })));
    const prerequisites = await Promise.all([page, other].map(tab => tab.evaluate(() => ({
      secure: window.isSecureContext,
      locks: typeof navigator.locks?.request === 'function',
      helper: typeof window.WujieUpscaleMarker?.claimUpscaleSubmissionMarker === 'function',
    }))));
    if (prerequisites.some(item => !item.secure || !item.locks || !item.helper)) {
      throw new Error(`Browser prerequisites unavailable: ${JSON.stringify(prerequisites)}`);
    }

    const rounds = 25;
    for (let index = 0; index < rounds; index += 1) {
      const marker = idempotencyKey => ({ version: 1, actorId: 'local-test-actor',
        projectId: 'local-test-project', imageId: `image-${index}`,
        sourceVersionId: 'v1', idempotencyKey, createdAt: Date.now() });
      const [first, second] = await Promise.all([
        page.evaluate(value => window.WujieUpscaleMarker.claimUpscaleSubmissionMarker(
          navigator.locks, localStorage, value), marker(`first-${index}`)),
        other.evaluate(value => window.WujieUpscaleMarker.claimUpscaleSubmissionMarker(
          navigator.locks, localStorage, value), marker(`second-${index}`)),
      ]);
      const outcomes = [first, second];
      if (outcomes.filter(item => item.claimed).length !== 1 ||
        outcomes.filter(item => !item.claimed).length !== 1) {
        throw new Error(`Round ${index} admitted ${JSON.stringify(outcomes)}`);
      }
      const winner = first.claimed ? `first-${index}` : `second-${index}`;
      const loser = first.claimed ? second : first;
      if (loser.existing.idempotencyKey !== winner) {
        throw new Error(`Round ${index} recovered the wrong original key`);
      }
      const stored = await page.evaluate(() => localStorage.length);
      if (stored !== 1) throw new Error(`Round ${index} left ${stored} markers`);
      await page.evaluate(value => window.WujieUpscaleMarker.clearUpscaleSubmissionMarker(
        localStorage, value.idempotencyKey, value, value.actorId), marker(winner));
    }

    const pending = { version: 1, actorId: 'local-test-actor', projectId: 'local-test-project',
      imageId: 'refresh-source', sourceVersionId: 'v2', idempotencyKey: 'refresh-original', createdAt: Date.now() };
    const claimed = await page.evaluate(value => window.WujieUpscaleMarker.claimUpscaleSubmissionMarker(
      navigator.locks, localStorage, value), pending);
    if (!claimed.claimed) throw new Error('Refresh setup was not claimed');
    await other.reload();
    await other.addScriptTag({ url: `${origin}/marker.js` });
    const afterRefresh = await other.evaluate(value => window.WujieUpscaleMarker.claimUpscaleSubmissionMarker(
      navigator.locks, localStorage, { ...value, idempotencyKey: 'refresh-second' }), pending);
    if (afterRefresh.claimed || afterRefresh.existing.idempotencyKey !== pending.idempotencyKey) {
      throw new Error(`Refresh did not recover the original: ${JSON.stringify(afterRefresh)}`);
    }

    const firstSource = { ...pending, imageId: 'canvas-entry-a', idempotencyKey: 'shared-original' };
    const secondSource = { ...pending, imageId: 'canvas-entry-b', idempotencyKey: 'rejected-second' };
    const initial = await page.evaluate(value => window.WujieUpscaleMarker.claimUpscaleSubmissionMarker(
      navigator.locks, localStorage, value), firstSource);
    const separate = await other.evaluate(value => window.WujieUpscaleMarker.claimUpscaleSubmissionMarker(
      navigator.locks, localStorage, value), secondSource);
    if (!initial.claimed || !separate.claimed) throw new Error('Distinct canvas sources did not claim separately');
    await other.evaluate(value => {
      window.WujieUpscaleMarker.writeUpscaleSubmissionMarker(localStorage,
        { ...value, idempotencyKey: 'shared-original' });
      window.WujieUpscaleMarker.clearUpscaleSubmissionMarker(localStorage,
        value.idempotencyKey, value, value.actorId);
    }, secondSource);
    await page.reload();
    await page.addScriptTag({ url: `${origin}/marker.js` });
    const retained = await page.evaluate(values => values.map(value =>
      window.WujieUpscaleMarker.findUpscaleSubmissionMarker(localStorage, value, value.actorId)?.idempotencyKey),
    [firstSource, secondSource]);
    if (JSON.stringify(retained) !== JSON.stringify(['shared-original', 'shared-original'])) {
      throw new Error(`Cross-source recovery marker was overwritten: ${JSON.stringify(retained)}`);
    }
    await page.evaluate(() => localStorage.clear());
    return { origin, rounds, result: 'one claim and one original-key recovery per round',
      refresh: 'original key retained; new claim denied',
      sharedSource: 'both canvas entries retain the original key after refresh' };
  } finally {
    await other.close();
  }
}

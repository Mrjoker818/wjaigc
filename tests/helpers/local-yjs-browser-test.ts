import { test as base, type Browser, type BrowserContext } from '@playwright/test';

const closeReason = 'Local Yjs collaboration test ended';
const closingContexts = new WeakMap<BrowserContext, Promise<void>>();

export function closeCollaborationContext(context: BrowserContext): Promise<void> {
  // Playwright ignores a second close on an already-closing context. Share the
  // first promise in case the test body and fixture both start teardown.
  let closing = closingContexts.get(context);
  if (!closing) {
    closing = context.close({ reason: closeReason });
    closingContexts.set(context, closing);
  }
  return closing;
}

export const test = base.extend<{ collaborationBrowser: Browser }>({
  collaborationBrowser: [async ({ browserName, playwright }, runWithBrowser) => {
    // The runner's default browser closes at worker shutdown, after the test
    // reports its result. This gate owns its browser and waits for shutdown as
    // part of test teardown so a close failure belongs to the test.
    const browser = await playwright[browserName].launch({ timeout: 30_000 });
    try {
      await runWithBrowser(browser);
    } finally {
      // On a timed-out test the test body may not reach its own finally block.
      // Close remaining contexts explicitly so their trace hooks can finish.
      const contextClosures = await Promise.allSettled(browser.contexts().map(closeCollaborationContext));
      await browser.close({ reason: closeReason });
      const failed = contextClosures.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
    // Playwright uses a 30s browser shutdown deadline. Allow the fixture to
    // finish reporting it without borrowing the business test's time budget.
  }, { timeout: 45_000 }],
});

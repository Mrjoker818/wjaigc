import { expect, type JSHandle, type Page, type Request } from '@playwright/test';

interface PollAbortObservation {
  documentTimeOrigin: number;
  pageHidden: boolean;
  aborts: Array<{ url: string; at: number }>;
}

type PollAbortObserver = JSHandle<() => PollAbortObservation>;

export async function observeFirefoxAgentPollAborts(page: Page): Promise<PollAbortObserver> {
  return page.evaluateHandle(() => {
    const documentTimeOrigin = performance.timeOrigin;
    const aborts: PollAbortObservation['aborts'] = [];
    let pageHidden = false;
    const onPageHide = (): void => { pageHidden = true; };
    window.addEventListener('pagehide', onPageHide);

    const originalFetch = window.fetch;
    const observedFetch: typeof fetch = (input, init) => {
      if (typeof input === 'string' && init?.signal && (!init.method || init.method === 'GET')
        && /^\/api\/agent-runs\/[^/]+\/events\?after=[1-9]\d*$/.test(input)) {
        const url = new URL(input, location.href).href;
        init.signal.addEventListener('abort', () => { aborts.push({ url, at: Date.now() }); }, { once: true });
      }
      return originalFetch.call(window, input, init);
    };
    window.fetch = observedFetch;

    return (): PollAbortObservation => {
      if (window.fetch === observedFetch) window.fetch = originalFetch;
      window.removeEventListener('pagehide', onPageHide);
      return { documentTimeOrigin, pageHidden, aborts };
    };
  });
}

interface VerifiedAgentCancellation {
  supersededPolls: Request[];
  documentTimeOrigin: number;
  terminalSequence: number;
  abortedCursors: number[];
}

export async function cancelFirefoxAgentRun(
  page: Page,
  runId: string,
  clickCancel: () => Promise<void>,
  observer: PollAbortObserver,
): Promise<VerifiedAgentCancellation> {
  const runUrl = new URL(`/api/agent-runs/${encodeURIComponent(runId)}`, page.url()).href;
  const cursorPrefix = `${runUrl}/events?after=`;
  const replayRequests = new Set<Request>();
  const failedPolls: Request[] = [];
  let cancelHeadersSeen = false;
  const onRequest = (request: Request): void => {
    if (cancelHeadersSeen && request.method() === 'GET' && request.url() === `${cursorPrefix}0`
      && request.frame() === page.mainFrame()) replayRequests.add(request);
  };
  const onFailed = (request: Request): void => {
    if (cancelHeadersSeen && replayRequests.size === 0 && request.method() === 'GET'
      && request.url().startsWith(cursorPrefix) && /^[1-9]\d*$/.test(request.url().slice(cursorPrefix.length))
      && request.failure()?.errorText === 'NS_BINDING_ABORTED' && request.frame() === page.mainFrame()) {
      failedPolls.push(request);
    }
  };
  page.on('request', onRequest);
  page.on('requestfailed', onFailed);
  const cancelStartedAt = Date.now();
  try {
    const [cancelResponse, replayResponse] = await Promise.all([
      page.waitForResponse(response => {
        const request = response.request();
        if (request.method() !== 'DELETE' || request.url() !== runUrl || request.frame() !== page.mainFrame()) return false;
        cancelHeadersSeen = true;
        return true;
      }),
      page.waitForResponse(response => replayRequests.has(response.request())),
      clickCancel(),
    ]);
    for (const response of [cancelResponse, replayResponse]) {
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toMatch(/^application\/json(?:;|$)/i);
    }
    const { projection } = await cancelResponse.json() as { projection: { runId: string; status: string; lastSequence: number } };
    expect(projection).toMatchObject({ runId, status: 'cancelled' });
    const { events } = await replayResponse.json() as { events: Array<{ runId: string; type: string; sequence: number }> };
    expect(events).toHaveLength(projection.lastSequence);
    expect(events.every((event, index) => event.runId === runId && event.sequence === index + 1)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run.cancelled', sequence: projection.lastSequence });

    // The handle belongs to the document that issued the poll. A reload invalidates it.
    const observed = await observer.evaluate(read => read());
    expect(observed.pageHidden).toBe(false);
    const supersededPolls: Request[] = [];
    for (const request of failedPolls) {
      const url = request.url();
      if (failedPolls.filter(poll => poll.url() === url).length === 1
        && observed.aborts.filter(abort => abort.url === url && abort.at >= cancelStartedAt).length === 1
        && await request.response() === null) {
        supersededPolls.push(request);
      }
    }
    return {
      supersededPolls,
      documentTimeOrigin: observed.documentTimeOrigin,
      terminalSequence: projection.lastSequence,
      abortedCursors: supersededPolls.map(request => Number(request.url().slice(cursorPrefix.length))),
    };
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onFailed);
    await observer.dispose();
  }
}

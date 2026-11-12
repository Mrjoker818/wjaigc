import type { Request } from '@playwright/test';

/**
 * Chromium can emit requestfailed after receiving a deliberate 204 or 503
 * for the fixture's EventSource. Count that HTTP response, but still reject
 * missing responses, interrupted live streams and other transport failures.
 */
export function isCompletedCanvasFixtureEventStream(
  request: Pick<Request, 'url' | 'method' | 'resourceType' | 'failure'>,
  responseStatus: number | undefined,
  origin: string,
): boolean {
  return (responseStatus === 204 || responseStatus === 503)
    && request.url() === origin + '/api/task-events'
    && request.method() === 'GET'
    && request.resourceType() === 'eventsource'
    && request.failure()?.errorText === 'net::ERR_ABORTED';
}

import { describe, expect, it } from 'vitest';
import { isCompletedCanvasFixtureEventStream } from './canvas-fixture-event-stream';

const origin = 'https://canvas-shell-mobile.invalid';
const request = {
  url: () => origin + '/api/task-events',
  method: () => 'GET',
  resourceType: () => 'eventsource',
  failure: () => ({ errorText: 'net::ERR_ABORTED' }),
};

describe('offline canvas EventSource completion', () => {
  it.each([204, 503])('counts a deliberately terminal %s response as received', (status) => {
    expect(isCompletedCanvasFixtureEventStream(request, status, origin)).toBe(true);
  });

  it('still reports transport failures, successful streams and unrelated requests', () => {
    for (const status of [undefined, 200, 401, 500]) {
      expect(isCompletedCanvasFixtureEventStream(request, status, origin)).toBe(false);
    }
    expect(isCompletedCanvasFixtureEventStream({
      ...request, failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }),
    }, 503, origin)).toBe(false);
    expect(isCompletedCanvasFixtureEventStream({
      ...request, url: () => origin + '/api/task-events?projectId=other',
    }, 204, origin)).toBe(false);
    expect(isCompletedCanvasFixtureEventStream({
      ...request, url: () => 'https://other.invalid/api/task-events',
    }, 503, origin)).toBe(false);
    expect(isCompletedCanvasFixtureEventStream({
      ...request, resourceType: () => 'fetch',
    }, 503, origin)).toBe(false);
  });
});

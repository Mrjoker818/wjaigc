import { describe, expect, it } from 'vitest';
import * as evidenceFilter from '../../../tests/helpers/stage-4-evidence-filter';
import type { Stage4RuntimeEvidenceEntry } from '../../../tests/helpers/stage-4-evidence-filter';

type Failures = ReturnType<typeof evidenceFilter.stage4RuntimeEvidenceFailures>;
const summarize = Reflect.get(evidenceFilter, 'summarizeStage4RuntimeFailures') as
  ((failures: Failures) => unknown) | undefined;

describe('Stage 4 safe CI runtime failure diagnostics', () => {
  // Dropping route/status loses the actionable cause when artifact upload is unavailable.
  it('identifies failed API routes and statuses without exposing request data or URL credentials', () => {
    const failures: Failures = {
      consoleFailures: [{ type: 'error', text: 'Failed to load resource: the server responded with a status of 403' }],
      networkFailures: [{
        method: 'POST', status: 403,
        url: 'https://fixture-user:fixture-password@fixture.invalid/api/collaboration/presence-ticket?ticket=do-not-log',
        text: 'Authorization: Bearer do-not-log', requestDigest: 'do-not-log',
      }],
    };
    expect(summarize?.(failures)).toEqual({
      console: [{ kind: 'error', status: 403, route: '[other-route]' }],
      network: [{ method: 'POST', status: 403, route: '/api/collaboration/presence-ticket' }],
      omitted: { console: 0, network: 0 },
    });
  });

  it('never prints arbitrary console text or credential-bearing dynamic paths', () => {
    const failures: Failures = {
      consoleFailures: [{ type: 'pageerror', text: 'cookie=do-not-log', url: 'https://fixture.invalid/s/do-not-log' }],
      networkFailures: [
        { method: 'GET', status: 404, url: 'https://fixture.invalid/api/serve-upload/do-not-log.png' },
        { method: 'GET', status: 500, url: 'malformed-do-not-log' },
        { method: 'do-not-log', status: 700, url: 'https://fixture.invalid/api/do-not-log' },
      ],
    };
    expect(summarize?.(failures)).toEqual({
      console: [{ kind: 'pageerror', route: '[other-route]' }],
      network: [
        { method: 'GET', status: 404, route: '/api/serve-upload/[file]' },
        { method: 'GET', status: 500, route: '[other-route]' },
        { method: 'OTHER', route: '[other-route]' },
      ],
      omitted: { console: 0, network: 0 },
    });
  });

  it('bounds output while reporting the exact number of omitted errors', () => {
    const entry: Stage4RuntimeEvidenceEntry = { method: 'GET', status: 409, url: 'http://127.0.0.1/api/collaboration/document-project' };
    const summary = summarize?.({ consoleFailures: [], networkFailures: Array(20).fill(entry) }) as {
      network?: unknown[]; omitted?: { console: number; network: number };
    } | undefined;
    expect(summary?.network).toHaveLength(16);
    expect(summary?.omitted).toEqual({ console: 0, network: 4 });
  });

  it('preserves failed evidence instead of turning diagnostics into an allowlist', () => {
    const denied = { method: 'GET', status: 503, url: 'http://127.0.0.1/api/collaboration/members' };
    const failures = evidenceFilter.stage4RuntimeEvidenceFailures([], [denied]);
    const before = JSON.stringify(failures);
    const summary = summarize?.(failures);
    expect(summary).toEqual({
      console: [], network: [{ method: 'GET', status: 503, route: '/api/collaboration/members' }],
      omitted: { console: 0, network: 0 },
    });
    expect(JSON.stringify(failures)).toBe(before);
    expect(failures.networkFailures).toEqual([denied]);
  });

  it.each([
    ['/api/collaboration/document-enable?projectId=do-not-log', '/api/collaboration/document-enable'],
    ['/?projectId=do-not-log', '/'],
    ['/simple-chat?projectId=do-not-log', '/simple-chat'],
  ])('identifies the fixed route %s without including its private query', (path, route) => {
    const entry: Stage4RuntimeEvidenceEntry = {
      method: 'GET', url: `https://fixture-user:fixture-password@fixture.invalid${path}`,
      text: 'net::ERR_ABORTED', requestDigest: 'do-not-log',
    };
    const failures = evidenceFilter.stage4RuntimeEvidenceFailures([], [entry]);
    expect(summarize?.(failures)).toEqual({
      console: [], network: [{ method: 'GET', route, failure: 'aborted' }],
      omitted: { console: 0, network: 0 },
    });
    expect(failures.networkFailures).toEqual([entry]);
  });

  it.each([
    ['NS_BINDING_ABORTED', 'aborted'],
    ['NS_ERROR_ABORT', 'aborted'],
    ['Load request cancelled', 'aborted'],
    ['net::ERR_CONNECTION_REFUSED', 'connection-refused'],
    ['net::ERR_CONNECTION_CLOSED', 'connection-closed'],
    ['net::ERR_TIMED_OUT', 'timeout'],
    ['net::ERR_NAME_NOT_RESOLVED', 'name-resolution'],
    ['net::ERR_FAILED', 'failed'],
  ])('classifies the standard browser failure %s without printing its text', (text, failure) => {
    const entry: Stage4RuntimeEvidenceEntry = {
      method: 'GET', url: 'https://fixture.invalid/do-not-log?ticket=do-not-log', text,
    };
    const failures = evidenceFilter.stage4RuntimeEvidenceFailures([], [entry]);
    expect(summarize?.(failures)).toEqual({
      console: [], network: [{ method: 'GET', route: '[other-route]', failure }],
      omitted: { console: 0, network: 0 },
    });
    expect(failures.networkFailures).toEqual([entry]);
  });

  it('leaves unknown failure text opaque, including text that contains a known code', () => {
    const entry: Stage4RuntimeEvidenceEntry = {
      method: 'GET', url: 'https://fixture.invalid/do-not-log',
      text: 'Authorization: Bearer do-not-log net::ERR_ABORTED',
    };
    expect(summarize?.(evidenceFilter.stage4RuntimeEvidenceFailures([], [entry]))).toEqual({
      console: [], network: [{ method: 'GET', route: '[other-route]' }],
      omitted: { console: 0, network: 0 },
    });
  });
});

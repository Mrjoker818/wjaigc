import { describe, expect, it } from 'vitest';
import * as diagnostics from '../../../tests/helpers/stage-3-runtime-failure-summary';
import type { Stage3EvidenceEntry } from '../../../tests/helpers/stage-3-evidence-filter';

const format = Reflect.get(diagnostics, 'stage3RuntimeFailureMessage') as
  ((consoleFailures: Stage3EvidenceEntry[], networkFailures: Stage3EvidenceEntry[]) => string) | undefined;

describe('Stage 3 safe CI failure log', () => {
  it('identifies an interrupted sync without exposing its payload, credentials, or fingerprint', () => {
    const entry: Stage3EvidenceEntry = {
      method: 'POST', text: 'NS_BINDING_ABORTED', requestDigest: 'do-not-log',
      url: 'https://fixture-user:fixture-password@fixture.invalid/api/user-data/sync?token=do-not-log',
    };
    expect(format?.([], [entry])).toBe('STAGE3_RUNTIME_FAILURES {"console":[],"network":[{"method":"POST","route":"/api/user-data/sync","failure":"aborted"}],"omitted":{"console":0,"network":0}}');
    expect(entry.requestDigest).toBe('do-not-log');
  });

  it('retains a failing status and keeps arbitrary error text and dynamic paths opaque', () => {
    expect(format?.([
      { type: 'pageerror', text: 'cookie=do-not-log', url: 'https://fixture.invalid/do-not-log' },
    ], [
      { method: 'GET', status: 503, text: 'Authorization: Bearer do-not-log', url: 'https://fixture.invalid/api/models?apiKey=do-not-log' },
      { method: 'GET', status: 404, url: 'https://fixture.invalid/api/serve-upload/do-not-log.png' },
    ])).toBe('STAGE3_RUNTIME_FAILURES {"console":[{"kind":"pageerror","route":"[other-route]"}],"network":[{"method":"GET","status":503,"route":"/api/models"},{"method":"GET","status":404,"route":"/api/serve-upload/[file]"}],"omitted":{"console":0,"network":0}}');
  });

  it('bounds diagnostics without suppressing the supplied failed evidence', () => {
    const entries: Stage3EvidenceEntry[] = Array.from({ length: 20 }, () => ({
      method: 'GET', status: 500, url: 'https://fixture.invalid/api/session',
    }));
    const before = JSON.stringify(entries);
    const message = format?.([], entries);
    expect(message).toBeDefined();
    const summary = JSON.parse(message!.slice('STAGE3_RUNTIME_FAILURES '.length)) as {
      network: unknown[]; omitted: { console: number; network: number };
    };
    expect(summary.network).toHaveLength(16);
    expect(summary.omitted).toEqual({ console: 0, network: 4 });
    expect(JSON.stringify(entries)).toBe(before);
    expect(entries).toHaveLength(20);
  });
});

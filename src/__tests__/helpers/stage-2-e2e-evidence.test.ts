import { describe, expect, it } from 'vitest';

import {
  redactStage2Evidence,
  redactStage2TraceText,
  sanitizeStage2Url,
  stage2ProjectMatrixValue,
} from '../../../tests/helpers/stage-2-e2e';
import { stage2RunStatus } from '../../../tests/helpers/stage-2-reporter';

describe('Stage 2 E2E evidence safety', () => {
  it('removes bearer tokens and credential values from captured text', () => {
    const input = 'Authorization: Bearer secret.jwt.value api_key=provider-secret password="plain-secret"';
    const output = redactStage2Evidence(input);
    expect(output).not.toContain('secret.jwt.value');
    expect(output).not.toContain('provider-secret');
    expect(output).not.toContain('plain-secret');
    expect(output).toContain('[REDACTED]');
  });

  it('requires a separate controlled project for each Playwright project', () => {
    expect(stage2ProjectMatrixValue('{"chromium":"legacy-chrome","firefox":"legacy-firefox"}', 'chromium')).toBe('legacy-chrome');
    expect(stage2ProjectMatrixValue('{"chromium":"legacy-chrome"}', 'firefox')).toBeNull();
    expect(stage2ProjectMatrixValue('not-json', 'chromium')).toBeNull();
    expect(stage2ProjectMatrixValue('{"chromium":"shared","firefox":"shared"}', 'chromium')).toBeNull();
  });

  it('redacts sensitive URL parameters beyond token and key aliases', () => {
    const url = sanitizeStage2Url('https://example.test/api?auth=a&session=b&signature=c&safe=visible');
    expect(url).not.toContain('auth=a');
    expect(url).not.toContain('session=b');
    expect(url).not.toContain('signature=c');
    expect(url).toContain('safe=visible');
  });

  it('removes cookie headers and signed URLs from Playwright trace text', () => {
    const trace = '{"headers":[{"name":"cookie","value":"session=secret"}],"url":"https://example.test/media?signature=abc&safe=yes"}';
    const output = redactStage2TraceText(trace);
    expect(output).not.toContain('session=secret');
    expect(output).not.toContain('signature=abc');
    expect(output).toContain('safe=yes');
  });

  it('fails the dedicated gate when any scenario is skipped', () => {
    expect(stage2RunStatus({ baseStatus: 'passed', failed: 0, skipped: 0 })).toBe('passed');
    expect(stage2RunStatus({ baseStatus: 'passed', failed: 0, skipped: 1 })).toBe('failed');
    expect(stage2RunStatus({ baseStatus: 'passed', failed: 1, skipped: 0 })).toBe('failed');
    expect(stage2RunStatus({ baseStatus: 'failed', failed: 0, skipped: 0 })).toBe('failed');
  });
});

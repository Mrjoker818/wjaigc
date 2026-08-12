import { describe, expect, it } from 'vitest';

import { redactStage2Evidence, stage2ProjectMatrixValue } from '../../../tests/helpers/stage-2-e2e';

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
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => {
  const absolute = resolve(process.cwd(), path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
};

describe('V588-MEDIA-001 Task 9 independent review contracts', () => {
  it('requires progressive n=2 visibility, authoritative cancellation, media bytes, ownership, limits, and legacy UI compatibility', () => {
    const source = read('tests/e2e/v588-media-gateway.spec.ts');

    expect(source).toContain('waitForProgressiveImageCompletion');
    expect(source).toContain('firstVisibleBeforeBatchTerminal');
    expect(source).not.toContain('Promise.all(submission.taskIds.map');
    expect(source).toContain('assertAuthoritativeCancellation');
    expect(source).toContain('lateCompletionRejected');
    expect(source).toContain('refundCount: 1');
    expect(source).toContain('assertMediaArtifact');
    expect(source).toContain('assetVersionOwnerVerified');
    expect(source).toContain('GATEWAY_RATE_LIMITED');
    expect(source).toContain('GATEWAY_DAILY_QUOTA_EXCEEDED');
    expect(source).toContain('GATEWAY_IDEMPOTENCY_CONFLICT');
    expect(source).toContain('assertLegacyUiCompatibility');
  });

  it('requires successful browser runs to retain screenshot, video, trace, console, network, ids, and redacted ledger evidence', () => {
    const source = read('tests/e2e/v588-media-gateway.spec.ts');
    const helper = read('tests/helpers/media-gateway-e2e-evidence.ts');

    expect(source).toContain("test.use({ trace: 'on', video: 'on', screenshot: 'on' })");
    expect(source).toMatch(/async \(\{[^}]*page[^}]*request[^}]*\}/);
    expect(source).toContain('createMediaGatewayEvidence');
    expect(helper).toContain('evidence-manifest.json');
    expect(helper).toContain('console.json');
    expect(helper).toContain('network.json');
    expect(helper).toContain('final.png');
    expect(helper).toContain('trace.zip');
    expect(helper).toContain('video.webm');
    expect(helper).toContain('requestIds');
    expect(helper).toContain('gatewayRequestIds');
    expect(helper).toContain('taskIds');
    expect(helper).toContain('redactedLedger');
    expect(helper).toContain("createHash('sha256')");
  });

  it('requires a reproducible gate recorder with command, commit, timestamps, exit code, raw streams, and SHA-256 manifest entries', () => {
    const runner = read('scripts/run-task9-gate-with-evidence.mjs');

    expect(runner).toContain('spawn');
    expect(runner).toContain('startedAt');
    expect(runner).toContain('finishedAt');
    expect(runner).toContain('commit');
    expect(runner).toContain('command');
    expect(runner).toContain('exitCode');
    expect(runner).toContain('stdout.log');
    expect(runner).toContain('stderr.log');
    expect(runner).toContain("createHash('sha256')");
    expect(runner).toContain('manifest.json');
  });
});

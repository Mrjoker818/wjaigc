import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

  it('records exact child output and independently verifiable hashes', () => {
    const output = mkdtempSync(resolve(tmpdir(), 'task9-gate-'));
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), 'scripts/run-task9-gate-with-evidence.mjs'),
      '--name', 'contract-probe', '--output', output, '--',
      process.execPath, '-e', "process.stdout.write('out\\n');process.stderr.write('err\\n')",
    ], { cwd: process.cwd(), encoding: 'utf8' });

    expect(result.status).toBe(0);
    const directory = resolve(output, 'contract-probe');
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as {
      exitCode: number;
      artifacts: Record<string, { sha256: string }>;
    };
    const stdout = readFileSync(resolve(directory, 'stdout.log'));
    const stderr = readFileSync(resolve(directory, 'stderr.log'));
    expect(manifest.exitCode).toBe(0);
    expect(stdout.toString('utf8')).toBe('out\n');
    expect(stderr.toString('utf8')).toBe('err\n');
    expect(manifest.artifacts.stdout.sha256).toBe(createHash('sha256').update(stdout).digest('hex'));
    expect(manifest.artifacts.stderr.sha256).toBe(createHash('sha256').update(stderr).digest('hex'));
  });
});

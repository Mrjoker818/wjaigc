import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('302 upscale failure contract', () => {
  it('uses the typed upstream-error parser for all native 302 endpoints', () => {
    expect(source).toContain("from '@/lib/upscale-provider-error'");
    expect((source.match(/parse302UpscaleProviderError\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('preserves upstream status and provider code instead of rewriting every failure to 502', () => {
    const settlementStart = source.indexOf('const settleRequested302Failure = async');
    const requestedModelStart = source.indexOf('if (requested302UpscaleModel && !aiResult)');
    const requestedModelEnd = source.indexOf('// Step A:', requestedModelStart);
    const settlementSource = source.slice(settlementStart, requestedModelEnd);
    const requestedModelSource = source.slice(requestedModelStart, requestedModelEnd);

    expect(settlementSource).toContain('providerStatus');
    expect(settlementSource).toContain('providerCode');
    expect(settlementSource).toContain('retryable');
    expect(requestedModelSource).toContain('failure.providerStatus');
    expect(requestedModelSource).not.toContain('}, { status: 502 });');
  });

  it('settles a requested 302 failure through the persistent task refund guard', () => {
    const settlementStart = source.indexOf('const settleRequested302Failure = async');
    const requestedModelStart = source.indexOf('if (requested302UpscaleModel && !aiResult)');
    const settlementSource = source.slice(settlementStart, requestedModelStart);

    expect(source).toContain("from '@/lib/cloud-task-storage'");
    expect(settlementSource).toContain('terminateCloudTaskAndRefund');
    expect(settlementSource).toContain('upscaleCreditTaskId');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);

describe('explicit image provider routing contract', () => {
  it('rejects an explicitly selected provider without usable credentials instead of falling back to another provider', () => {
    const credentialsGate = source.indexOf('if (!serverApiKey || !apiBaseUrl) {');
    const fallback = source.indexOf('const fallback = candidateModels.shift()!', credentialsGate);
    const explicitProviderGuard = source.indexOf('if (effectiveProviderId) {', credentialsGate);

    expect(credentialsGate).toBeGreaterThan(-1);
    expect(explicitProviderGuard).toBeGreaterThan(credentialsGate);
    expect(fallback).toBeGreaterThan(explicitProviderGuard);
    expect(source.slice(explicitProviderGuard, fallback)).toContain(
      '所选供应商或模型当前不可用',
    );
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('font design client idempotency contract', () => {
  it('attaches a distinct bounded idempotency key to every billable image submission path', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/font-design-panel.tsx'),
      'utf8',
    );

    expect(source).toContain('function fontDesignRequestHeaders(');
    const billableCalls = source.match(/fetch\('\/api\/font-design\/generate-image'/g) || [];
    const guardedCalls = source.match(
      /fetch\('\/api\/font-design\/generate-image',\s*\{[\s\S]{0,120}?headers: fontDesignRequestHeaders\(/g,
    ) || [];
    expect(guardedCalls).toHaveLength(billableCalls.length);
    expect(billableCalls.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps provider and model as one exact selection across every billable submission path', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/font-design-panel.tsx'),
      'utf8',
    );

    expect(source).toContain('selectedProviderId');
    expect(source).toContain('selectedProviderIdRef');
    expect(source).toContain('key={`${m.providerId}::${m.id}`}');
    const billableCalls = source.match(/fetch\('\/api\/font-design\/generate-image'/g) || [];
    const providerBoundBodies = source.match(
      /fetch\('\/api\/font-design\/generate-image',[\s\S]{0,700}?providerId: selectedProviderIdRef\.current/g,
    ) || [];
    expect(providerBoundBodies).toHaveLength(billableCalls.length);
  });
});

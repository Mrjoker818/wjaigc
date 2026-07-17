import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('infinite canvas provider capability wiring', () => {
  it('uses provider-aware aspect, quality, and resolution lookups in generation controls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');

    expect(source).toContain('getProviderAspectRatios');
    expect(source).toContain('getResolutionTierOptions(m.id, providerHint)');
    expect(source).toContain('getQualityLevelOptions(m.id, providerHint)');
    expect(source).toContain('getModelParamType(group.toolbar.model, groupProviderHint)');
  });
});

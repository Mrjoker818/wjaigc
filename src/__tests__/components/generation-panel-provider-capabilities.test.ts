import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/generation-panel.tsx'), 'utf8');

describe('generation panel provider capability wiring', () => {
  it('passes the selected provider to ratio, quality, and resolution capability lookups', () => {
    expect(source).toContain('getProviderAspectRatios(pureModelId, selectedProviderHint)');
    expect(source).toContain('getModelParamType(pureModelId, selectedProviderHint)');
    expect(source).toContain('getResolutionTierOptions(pureModelId, selectedProviderHint)');
    expect(source).toContain('getQualityLevelOptions(pureModelId, selectedProviderHint)');
  });
});

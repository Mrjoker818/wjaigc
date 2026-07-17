import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/node-editor.tsx'), 'utf8');

describe('node editor provider capability wiring', () => {
  it('resets image-node controls from the selected provider-aware capability resolver', () => {
    expect(source).toContain('getProviderAspectRatios(selectedModelId, providerHint)');
    expect(source).toContain('getQualityLevelOptions(selectedModelId, providerHint)');
    expect(source).toContain('getResolutionTierOptions(selectedModelId, providerHint)');
  });
});

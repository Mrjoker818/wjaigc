import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/generation-panel.tsx'), 'utf8');

describe('generation panel provider capability wiring', () => {
  it('reads ratio, quality, size, and output count from the exact catalog descriptor', () => {
    expect(source).toContain("useTaskModelCatalog('image')");
    expect(source).toContain('descriptorsByKey.get(model)');
    expect(source).toContain('selectedDescriptor?.allowedRatios ?? []');
    expect(source).toContain('selectedDescriptor?.qualityOptions ?? []');
    expect(source).toContain('selectedDescriptor?.allowedSizes ?? []');
    expect(source).toContain('selectedDescriptor.maxOutputs');
    expect(source).toContain('selectedDescriptor.maxReferenceImages');
    expect(source).toContain('setSelectedSize');
    expect(source).toContain("size: isResolutionTier(selectedSize) ? '' : selectedSize");
    expect(source).toContain('resolution: selectedResolution');
    expect(source).not.toContain('[1, 2, 3, 4].map');
    expect(source).not.toContain('const MAX_REF_IMAGES = 10');
  });

  it('blocks submission while the exact capability descriptor is unavailable', () => {
    expect(source).toContain('const capabilityReady =');
    expect(source).toContain("'模型能力尚未加载'");
    expect(source).toContain('if (!capabilityReady)');
  });

  it('does not infer selectable capabilities from provider or model names', () => {
    expect(source).not.toContain('getProviderAspectRatios(');
    expect(source).not.toContain('getResolutionTierOptions(');
    expect(source).not.toContain('getQualityLevelOptions(');
    expect(source).not.toContain('getModelParamType(');
  });
});

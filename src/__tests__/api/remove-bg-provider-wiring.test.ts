import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

describe('dedicated RemoveBG provider wiring', () => {
  it('routes both remove-background action aliases through the dedicated adapter', () => {
    expect(source).toContain("from '@/lib/remove-bg-provider'");
    expect(source).toContain(
      "const isRemoveBackgroundAction = action === 'removebg' || action === 'remove_background';",
    );
    expect(source).toContain('await submitDedicatedRemoveBg(');
  });

  it('keeps dedicated providers out of the generic image-generation fallback', () => {
    expect(source).toContain('const dedicatedRemoveBgProviders: ApiProvider[] = [];');
    expect(source).toContain('const genericRemoveBgCandidates = candidateModels.filter(');
    expect(source).toContain('candidate.providerType !== \'removebg\'');
    expect(source).toContain('autoTrySubmitImageTask(genericRemoveBgCandidates');
  });

  it('calls the dedicated adapter before generic image generation', () => {
    const removeBgBranch = source.slice(
      source.indexOf("if (isRemoveBackgroundAction)"),
      source.indexOf("if (action === 'inpaint')"),
    );

    expect(removeBgBranch.indexOf('submitDedicatedRemoveBg(')).toBeGreaterThan(-1);
    expect(removeBgBranch.indexOf('autoTrySubmitImageTask(genericRemoveBgCandidates')).toBeGreaterThan(
      removeBgBranch.indexOf('submitDedicatedRemoveBg('),
    );
  });

  it('returns actual provider and model metadata without serializing the API key', () => {
    const dedicatedStart = source.indexOf('submitDedicatedRemoveBg(');
    const dedicatedEnd = source.indexOf('autoTrySubmitImageTask(genericRemoveBgCandidates', dedicatedStart);
    const dedicatedPath = source.slice(dedicatedStart, dedicatedEnd);

    expect(dedicatedPath).toContain('providerId: dedicatedProvider.id');
    expect(dedicatedPath).toContain('usedModel: dedicatedModel');
    expect(dedicatedPath).not.toContain('apiKey:');
  });

  it('prioritizes an explicitly selected dedicated provider and model', () => {
    expect(source).toContain('dedicatedRemoveBgProviders.sort(');
    expect(source).toContain("provider.id === effectiveProviderId ? -1 : 1");
    expect(source).toContain('const configuredDedicatedModels =');
    expect(source).toContain('configuredDedicatedModels.includes(modelStr)');
    expect(source).toContain('{ ...dedicatedProvider, selectedModel: dedicatedModel }');
  });

  it('charges both remove-background aliases through the same credit operation', () => {
    expect(source).toContain("isRemoveBackgroundAction ? 'image_remove_bg'");
  });

  it('preserves strict AI-only failure semantics and local fallback for automatic mode', () => {
    expect(source).toContain("if ((engineMode === 'ai' || engineMode === 'ai-only') && !aiSuccess)");
    expect(source).toContain('createLocalBackgroundAlpha(sourceBuffer)');
  });
});

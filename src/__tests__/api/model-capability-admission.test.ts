import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);

describe('image model capability admission', () => {
  it('resolves and validates the exact provider/model before any task or billing side effect', () => {
    const referenceResolution = source.indexOf('const accessibleReferenceImages: string[] = []');
    const admissionGate = source.indexOf('const modelCapabilityAdmission =');
    const firstLegacyCharge = source.indexOf('consumeCredits(', admissionGate);
    const durableBatch = source.indexOf('const generationBatch = createDurableGenerationBatch');
    const firstTaskRegistration = source.indexOf('registerTask(', admissionGate);

    expect(source).toContain('resolveTaskModelForUser');
    expect(source).toContain('validateTaskModelSelection');
    expect(referenceResolution).toBeGreaterThan(-1);
    expect(admissionGate).toBeGreaterThan(referenceResolution);
    expect(firstLegacyCharge).toBeGreaterThan(admissionGate);
    expect(durableBatch).toBeGreaterThan(admissionGate);
    expect(firstTaskRegistration).toBeGreaterThan(admissionGate);
  });

  it('returns a stable non-retryable capability error without exposing a fallback provider', () => {
    expect(source).toContain("code: 'MODEL_CAPABILITY_MISMATCH'");
    expect(source).toContain("code: 'MODEL_NOT_CONFIGURED'");
    expect(source).toContain('retryable: false');
    expect(source).toContain('providerId: effectiveProviderId');
    expect(source).toContain('modelId: model');
    expect(source).not.toContain('actualProviderId: capabilityProvider.id');
  });

  it('validates the requested operation, ratio, quality, count, and reference count', () => {
    const admissionGate = source.indexOf('const modelCapabilityAdmission =');
    const submitOnly = source.indexOf('if (submitOnly)', admissionGate);
    const admissionBlock = source.slice(admissionGate, submitOnly);

    expect(admissionBlock).toContain(
      "operation: accessibleReferenceImages.length > 0 ? 'image-to-image' : 'text-to-image'",
    );
    expect(admissionBlock).toContain('aspectRatio');
    expect(admissionBlock).toContain('quality: requestedQuality');
    expect(admissionBlock).toContain('outputCount: normalizedRequestedOutputCount');
    expect(admissionBlock).toContain('referenceImageCount: accessibleReferenceImages.length');
  });
});

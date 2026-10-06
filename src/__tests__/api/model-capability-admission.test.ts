import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);
const videoGenerateSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/video/generate/route.ts'),
  'utf8',
);
const videoExtendSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/video/extend/route.ts'),
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
    expect(source).toContain('admitExactImageCandidate');
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
    expect(source).toContain('modelId: candidateModelId');
    expect(source).toContain('candidateAdmissionErrorResponse(implicitAdmission.error, provider.id, model)');
    expect(source).not.toContain('actualProviderId: capabilityProvider.id');
  });

  it('validates the requested operation, ratio, quality, count, and reference count', () => {
    const admissionGate = source.indexOf('const modelCapabilityAdmission =');
    const submitOnly = source.indexOf('if (submitOnly)', admissionGate);
    const admissionBlock = source.slice(
      source.indexOf('const requestedTaskModelSelection ='),
      submitOnly,
    );

    expect(admissionBlock).toContain(
      "operation: accessibleReferenceImages.length > 0 ? 'image-to-image' as const : 'text-to-image' as const",
    );
    expect(admissionBlock).toContain('aspectRatio');
    expect(admissionBlock).toContain('quality: requestedQuality');
    expect(admissionBlock).toContain('outputCount: normalizedRequestedOutputCount');
    expect(admissionBlock).toContain('referenceImageCount: accessibleReferenceImages.length');
  });

  it('normalizes a blank legacy size before exact-model capability admission', () => {
    const admissionGate = source.indexOf('const modelCapabilityAdmission =');
    const admissionBlock = source.slice(
      source.indexOf('const normalizedRequestedPixelSize ='),
      admissionGate,
    );

    expect(admissionBlock).toContain('normalizeRequestedPixelSize(requestedPixelSize)');
    expect(admissionBlock).toContain('size: normalizedRequestedPixelSize');
  });

  it('admits every implicit fallback candidate before charging credits', () => {
    const candidateAdmission = source.indexOf('const admittedCandidateModels = await admitImageFallbackCandidates(');
    const billing = source.indexOf('consumeCredits(', candidateAdmission);
    const retryBlockStart = source.indexOf('if (!strictAgentRouting && !effectiveProviderId && !submitted && isRetryable');
    const retryBlockEnd = source.indexOf('if (!submitted) {', retryBlockStart);
    const retryBlock = source.slice(retryBlockStart, retryBlockEnd);

    expect(candidateAdmission).toBeGreaterThan(-1);
    expect(billing).toBeGreaterThan(candidateAdmission);
    expect(retryBlock).not.toContain('admitImageCandidate(');
  });
});

describe('video model capability admission', () => {
  it('validates the exact provider/model before task creation, billing, or provider request construction', () => {
    const providerResolution = videoGenerateSource.indexOf('const descriptor = await resolveTaskModelForUser(');
    const admissionGate = videoGenerateSource.indexOf('const videoCapabilityAdmission =');
    const billing = videoGenerateSource.indexOf('calculateConfiguredCreditCost(', admissionGate);
    const taskCreation = videoGenerateSource.indexOf('createBillableTask(', admissionGate);
    const providerRequest = videoGenerateSource.indexOf('buildVideoSubmitRequest(', admissionGate);

    expect(videoGenerateSource).toContain('resolveTaskModelForUser(provider.id, pureModel, sessionUser)');
    expect(videoGenerateSource).toContain('validateTaskModelSelection(descriptor, {');
    expect(videoGenerateSource).toContain('operation: toSupportedVideoOperation(');
    expect(videoGenerateSource).toContain('durationSeconds: parsedDuration');
    expect(videoGenerateSource).toContain('referenceImageCount:');
    expect(providerResolution).toBeGreaterThan(-1);
    expect(admissionGate).toBeGreaterThan(providerResolution);
    expect(billing).toBeGreaterThan(admissionGate);
    expect(taskCreation).toBeGreaterThan(admissionGate);
    expect(providerRequest).toBeGreaterThan(admissionGate);
  });

  it('requires video-extend capability before the extend route creates or charges a task', () => {
    const admissionGate = videoExtendSource.indexOf('const videoCapabilityAdmission =');
    const billing = videoExtendSource.indexOf('calculateConfiguredCreditCost(', admissionGate);
    const taskRegistration = videoExtendSource.indexOf('registerTask(', admissionGate);
    const providerRequest = videoExtendSource.indexOf('buildVideoExtendRequest(', admissionGate);

    expect(videoExtendSource).toContain('resolveTaskModelForUser(provider.id, pureModel, sessionUser)');
    expect(videoExtendSource).toContain("operation: 'video-extend'");
    expect(videoExtendSource).toContain('durationSeconds: parsedExtendDuration');
    expect(admissionGate).toBeGreaterThan(-1);
    expect(billing).toBeGreaterThan(admissionGate);
    expect(taskRegistration).toBeGreaterThan(admissionGate);
    expect(providerRequest).toBeGreaterThan(admissionGate);
  });

  it('returns the stable non-retryable capability mismatch contract from both video routes', () => {
    for (const routeSource of [videoGenerateSource, videoExtendSource]) {
      expect(routeSource).toContain("code: 'MODEL_CAPABILITY_MISMATCH'");
      expect(routeSource).toContain('retryable: false');
      expect(routeSource).toContain('received: videoCapabilityAdmission.error.received');
      expect(routeSource).toContain('allowed: videoCapabilityAdmission.error.allowed');
    }
  });
});

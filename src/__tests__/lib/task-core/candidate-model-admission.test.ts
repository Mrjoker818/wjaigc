import { describe, expect, it, vi } from 'vitest';

import {
  admitExactImageCandidate,
  admitImageFallbackCandidates,
} from '@/lib/task-core/candidate-model-admission';
import { ModelCapabilityError, type TaskModelDescriptor } from '@/lib/task-core/model-capability-contract';

const descriptor: TaskModelDescriptor = {
  providerId: 'provider-image', modelId: 'model-image', kind: 'image', sourceType: 'image',
  protocol: 'images', executionMode: 'async', allowedRatios: ['1:1'], allowedSizes: [],
  qualityOptions: [], maxOutputs: 4, supportsReferenceImages: false, supportsMask: false,
  supportedOperations: ['text-to-image'], outputKinds: ['png'], capabilitySources: {},
};

describe('candidate model admission', () => {
  it('resolves and validates the exact candidate before it can be submitted', async () => {
    const resolveTaskModel = vi.fn().mockResolvedValue(descriptor);

    await expect(admitExactImageCandidate({
      providerId: 'provider-image',
      modelId: 'model-image',
      selection: { operation: 'text-to-image', aspectRatio: '1:1', outputCount: 4 },
      resolveTaskModel,
    })).resolves.toEqual({ ok: true, descriptor });
    expect(resolveTaskModel).toHaveBeenCalledWith('provider-image', 'model-image');
  });

  it('keeps MODEL_NOT_AUTHORIZED visible instead of treating it as a legacy fallback', async () => {
    const error = new ModelCapabilityError('MODEL_NOT_AUTHORIZED', 'not assigned');

    await expect(admitExactImageCandidate({
      providerId: 'provider-image',
      modelId: 'model-image',
      selection: { operation: 'text-to-image', aspectRatio: '1:1' },
      resolveTaskModel: vi.fn().mockRejectedValue(error),
    })).resolves.toEqual({ ok: false, error });
  });

  it('rejects a candidate that does not satisfy the requested total output count', async () => {
    await expect(admitExactImageCandidate({
      providerId: 'provider-image',
      modelId: 'model-image',
      selection: { operation: 'text-to-image', aspectRatio: '1:1', outputCount: 5 },
      resolveTaskModel: vi.fn().mockResolvedValue(descriptor),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'MODEL_CAPABILITY_MISMATCH', field: 'outputCount' },
    });
  });

  it('rejects four user-requested outputs when the descriptor allows only one total output', async () => {
    await expect(admitExactImageCandidate({
      providerId: 'provider-image',
      modelId: 'model-image',
      selection: { operation: 'text-to-image', aspectRatio: '1:1', outputCount: 4 },
      resolveTaskModel: vi.fn().mockResolvedValue({ ...descriptor, maxOutputs: 1 }),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'MODEL_CAPABILITY_MISMATCH', field: 'outputCount', received: 4 },
    });
  });

  it('pre-admits fallback candidates and retains the first rejection without submitting it', async () => {
    const unauthorized = new ModelCapabilityError('MODEL_NOT_AUTHORIZED', 'not assigned');
    const candidates = [
      { providerId: 'provider-denied', modelId: 'model-denied' },
      { providerId: 'provider-image', modelId: 'model-image' },
    ];

    const result = await admitImageFallbackCandidates({
      candidates,
      admit: vi.fn(async candidate => candidate.providerId === 'provider-denied'
        ? { ok: false as const, error: unauthorized }
        : { ok: true as const, descriptor }),
    });

    expect(result.candidates).toEqual([{ ...candidates[1], descriptor }]);
    expect(result.firstRejection).toEqual({ candidate: candidates[0], error: unauthorized });
  });
});

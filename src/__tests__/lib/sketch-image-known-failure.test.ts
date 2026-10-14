import { describe, expect, it, vi } from 'vitest';
import { markSketchImageKnownFailure, readSketchImageKnownFailure, type SketchImageKnownFailure } from '@/lib/sketch-to-code/image-known-failure';
vi.mock('server-only', () => ({}));
const evidence: SketchImageKnownFailure = { phase: 'generation', providerId: 'provider-a', modelId: 'model-a', kind: 'not-submitted' };
describe('server-only confirmed failure provenance (no permission or refund authority)', () => {
  it.each(['analysis', 'generation'] as const)('preserves the original %s error with private frozen evidence only', phase => {
    const error = new Error('safe-original'), supplied = { ...evidence, phase, kind: 'rejected' as const };
    expect(markSketchImageKnownFailure(error, supplied)).toBe(error);
    expect(readSketchImageKnownFailure(error)).toEqual(supplied); expect(Object.isFrozen(readSketchImageKnownFailure(error))).toBe(true);
    supplied.modelId = 'changed'; expect(readSketchImageKnownFailure(error)?.modelId).toBe('model-a');
    expect(JSON.stringify(error)).not.toContain('provider-a'); expect(error.message).toBe('safe-original');
  });
  it('binds a result failure to the original remote receipt identity', () => {
    const error = new Error('safe'), supplied = { ...evidence, phase: 'result' as const, kind: 'remote-failed' as const, remoteId: 'remote-a' };
    markSketchImageKnownFailure(error, supplied); expect(readSketchImageKnownFailure(error)).toEqual(supplied);
  });
  it('never treats a forged error/code/evidence, clone or serialized value as proof', () => {
    const error = markSketchImageKnownFailure(new Error('SKETCH_IMAGE_PROVIDER_REJECTED'), evidence);
    for (const forged of [new Error(error.message), { ...error, ...evidence }, structuredClone(error), JSON.parse(JSON.stringify(error)), null, undefined, 'SKETCH_IMAGE_PROVIDER_REJECTED']) {
      expect(readSketchImageKnownFailure(forged)).toBeUndefined();
    }
  });
  it('never reads a public error getter to find proof', () => {
    let reads = 0; const forged = Object.defineProperty({}, 'code', { get: () => { reads++; return 'SKETCH_IMAGE_PROVIDER_REJECTED'; } });
    expect(readSketchImageKnownFailure(forged)).toBeUndefined(); expect(reads).toBe(0);
  });
  it('refuses to replace evidence for an already marked original error', () => {
    const error = markSketchImageKnownFailure(new Error('safe'), evidence);
    expect(() => markSketchImageKnownFailure(error, { ...evidence, modelId: 'other' })).toThrow('SKETCH_IMAGE_FAILURE_EVIDENCE_INVALID');
    expect(readSketchImageKnownFailure(error)).toEqual(evidence);
  });
  it.each([{ ...evidence, phase: 'result' }, { ...evidence, kind: 'remote-failed' }, { ...evidence, remoteId: 'extra' },
    { ...evidence, phase: 'result', kind: 'remote-failed' }, { ...evidence, modelId: ' model-a' }, { ...evidence, providerId: 'bad\n' },
    { ...evidence, extra: 'unknown' }] as const)('refuses invalid internal evidence %# without registering it', bad => {
    const error = new Error('safe');
    expect(() => markSketchImageKnownFailure(error, bad as SketchImageKnownFailure)).toThrow('SKETCH_IMAGE_FAILURE_EVIDENCE_INVALID');
    expect(readSketchImageKnownFailure(error)).toBeUndefined();
  });
  it('rejects evidence accessors before running them', () => {
    const error = new Error('safe'); let reads = 0;
    const bad = Object.defineProperty({ ...evidence }, 'modelId', { enumerable: true, get: () => { reads++; return 'model-a'; } });
    expect(() => markSketchImageKnownFailure(error, bad)).toThrow('SKETCH_IMAGE_FAILURE_EVIDENCE_INVALID'); expect(reads).toBe(0);
    expect(readSketchImageKnownFailure(error)).toBeUndefined();
  });
});

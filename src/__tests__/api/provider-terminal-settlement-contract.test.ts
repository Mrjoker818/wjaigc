import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiresAtomicTerminalSettlement } from '@/lib/task-core/terminal-settlement';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('brand and font durable terminal settlement wiring', () => {
  const requestDigest = 'a'.repeat(64);
  const imageEditAdmission = { version: 1, route: '/api/image-edit', kind: 'requested-302-upscale', requestDigest };

  it('opts only the matching server requested-302 upscale identity into atomic cancellation', (): void => {
    expect(requiresAtomicTerminalSettlement({ type: 'upscale', requestDigest, result: { imageEditAdmission } })).toBe(true);
  });

  it.each([
    ['version missing', { version: undefined }], ['version string', { version: '1' }], ['version wrong', { version: 2 }],
    ['route missing', { route: undefined }], ['route wrong', { route: '/api/generate' }],
    ['kind missing', { kind: undefined }], ['kind wrong', { kind: 'upscale' }],
    ['digest missing', { requestDigest: undefined }], ['digest number', { requestDigest: 1 }],
    ['digest mismatched', { requestDigest: 'b'.repeat(64) }], ['digest short', { requestDigest: 'a'.repeat(63) }],
    ['digest long', { requestDigest: 'a'.repeat(65) }], ['digest uppercase', { requestDigest: 'A'.repeat(64) }],
    ['digest nonhex', { requestDigest: 'g'.repeat(64) }],
  ])('does not upgrade a 302 marker with %s', (_name, change): void => {
    expect(requiresAtomicTerminalSettlement({ type: 'upscale', requestDigest,
      result: { imageEditAdmission: { ...imageEditAdmission, ...change } } })).toBe(false);
  });

  it('rejects malformed containers, non-upscale types, and legacy tasks without changing existing policies', (): void => {
    for (const result of [undefined, null, 1, 'marker', [], Object.assign([], { imageEditAdmission })]) {
      expect(requiresAtomicTerminalSettlement({ type: 'upscale', requestDigest, result })).toBe(false);
    }
    for (const marker of [undefined, null, 1, 'marker', [], Object.assign([], imageEditAdmission)]) {
      expect(requiresAtomicTerminalSettlement({ type: 'upscale', requestDigest, result: { imageEditAdmission: marker } })).toBe(false);
    }
    for (const type of [undefined, 'image-edit', 'generate', 'removebg']) {
      expect(requiresAtomicTerminalSettlement({ type, requestDigest, result: { imageEditAdmission } })).toBe(false);
    }
    for (const digest of [undefined, '', 'b'.repeat(64)]) {
      expect(requiresAtomicTerminalSettlement({ type: 'upscale', requestDigest: digest, result: { imageEditAdmission } })).toBe(false);
    }
    // Even matching malformed digests cannot grant the new identity.
    for (const digest of ['A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      expect(requiresAtomicTerminalSettlement({ type: 'upscale', requestDigest: digest,
        result: { imageEditAdmission: { ...imageEditAdmission, requestDigest: digest } } })).toBe(false);
    }
    expect(requiresAtomicTerminalSettlement(null)).toBe(false);
    expect(requiresAtomicTerminalSettlement(undefined)).toBe(false);
    expect(requiresAtomicTerminalSettlement({ type: 'upscale' })).toBe(false);
    expect(requiresAtomicTerminalSettlement({ type: 'upscale', result: { submissionPayload: { requestedModel: '302-esrgan' } } })).toBe(false);
    for (const type of ['video', 'video-extend', 'edit', 'universal-generate', 'annotation-edit', 'refine-engine', 'brand-ecommerce', 'font-design']) {
      expect(requiresAtomicTerminalSettlement({ type })).toBe(true);
    }
    expect(requiresAtomicTerminalSettlement({ type: 'generate', result: {
      submissionPayload: { batchId: 'batch', slotId: 'slot', slotIndex: 0 },
    } })).toBe(true);
  });

  it('only a matching server ordinary descriptor opts legacy generate into atomic cancellation', () => {
    const requestDigest = 'a'.repeat(64);
    const ordinaryGeneration = { version: 1, route: '/api/generate', requestDigest };
    expect(requiresAtomicTerminalSettlement({ type: 'generate', requestDigest, result: { ordinaryGeneration } })).toBe(true);
    expect(requiresAtomicTerminalSettlement({ type: 'generate' })).toBe(false);
    for (const descriptor of [[], null, { ...ordinaryGeneration, version: 2 }, { ...ordinaryGeneration, route: '/api/edit' },
      { ...ordinaryGeneration, requestDigest: 'b'.repeat(64) }, { ...ordinaryGeneration, requestDigest: 'short' }]) {
      expect(requiresAtomicTerminalSettlement({ type: 'generate', requestDigest, result: { ordinaryGeneration: descriptor } })).toBe(false);
    }
    expect(requiresAtomicTerminalSettlement({ type: 'generate', result: { outputGroup: { version: 1, kind: 'ordinary-generation' } } })).toBe(false);
  });
  it('routes cancellation for both durable task types through atomic termination and refund', () => {
    const cancelSource = source('src/app/api/cancel-task/route.ts');
    expect(requiresAtomicTerminalSettlement({ type: 'brand-ecommerce' })).toBe(true);
    expect(requiresAtomicTerminalSettlement({ type: 'font-design' })).toBe(true);
    expect(cancelSource).toContain('requiresAtomicTerminalSettlement(persistedTask)');
    expect(cancelSource).toContain('terminateCloudTaskAndRefund(');
  });

  it('uses the same atomic terminal policy for remote polling failure, cancellation and completion', () => {
    const pollSource = source('src/app/api/poll-task/route.ts');
    expect(pollSource).toContain('const durableAtomicTask = requiresAtomicTerminalSettlement({');
    expect(pollSource).toMatch(/durableAtomicTask\s*\? await terminateCloudTaskAndRefund\(taskId, 'failed'/);
    expect(pollSource).toMatch(/durableAtomicTask\s*\? await terminateCloudTaskAndRefund\(taskId, 'cancelled'/);
    const durableCompletion = pollSource.indexOf('if (durableAtomicTask) {', pollSource.indexOf('const completedTaskResult'));
    const metadata = pollSource.indexOf('await enrichCompletedImageResult(completedTaskResult)', durableCompletion);
    const completion = pollSource.indexOf('const generationCompletion = await completeCloudTask', durableCompletion);
    expect(durableCompletion).toBeGreaterThan(-1);
    expect(metadata).toBeGreaterThan(durableCompletion);
    expect(completion).toBeGreaterThan(metadata);
  });
});

import { describe, expect, it } from 'vitest';
import { requiresAtomicTerminalSettlement } from '@/lib/task-core/terminal-settlement';

describe('ordinary inpaint terminal settlement', () => {
  const digest = 'a'.repeat(64);
  const admission = { version: 1, route: '/api/image-edit', kind: 'ordinary-inpaint',
    editMode: 'mask', requestDigest: digest };

  it('requires atomic cancellation for a matching durable inpaint task', () => {
    expect(requiresAtomicTerminalSettlement({ type: 'image-edit', requestDigest: digest,
      result: { imageEditAdmission: admission } })).toBe(true);
  });

  it.each([
    { name: 'another task type', type: 'removebg', marker: admission, requestDigest: digest },
    { name: 'another route', type: 'image-edit', marker: { ...admission, route: '/api/edit' }, requestDigest: digest },
    { name: 'another kind', type: 'image-edit', marker: { ...admission, kind: 'ordinary-outpaint' }, requestDigest: digest },
    { name: 'missing mode', type: 'image-edit', marker: { ...admission, editMode: undefined }, requestDigest: digest },
    { name: 'digest mismatch', type: 'image-edit', marker: admission, requestDigest: 'b'.repeat(64) },
    { name: 'missing marker digest', type: 'image-edit', marker: { ...admission, requestDigest: undefined }, requestDigest: digest },
  ])('does not upgrade $name to atomic settlement', ({ type, marker, requestDigest }) => {
    expect(requiresAtomicTerminalSettlement({ type, requestDigest,
      result: { imageEditAdmission: marker } })).toBe(false);
  });
});

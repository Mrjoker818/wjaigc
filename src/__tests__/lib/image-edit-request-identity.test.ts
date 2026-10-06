import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captureImageEditRequestIdentity, digestRequested302UpscaleIdentity } from '@/lib/task-core/image-edit-request-identity';

const server = { actorUserId: 'actor', providerId: 'native', modelId: '302-esrgan',
  sourceWidth: 32, sourceHeight: 24, targetWidth: 64, targetHeight: 48 };
// Hand-authored EditRequest coverage, independent of the production whitelist.
const supported: Record<string, unknown> = {
  projectId: 'project', sessionId: 'session', messageId: 'message', assetParentVersionIds: ['a', 'b'],
  assetProjectionMode: 'revision', action: 'upscale', imageUrl: 'https://media.invalid/source.png',
  maskImage: 'mask', prompt: 'restore', editMode: 'mask', expandRatio: '4:3', expandScale: 2,
  expandPadding: { top: 1, right: 2, bottom: 3, left: 4 }, targetWidth: 64, targetHeight: 48,
  targetPreset: 'custom', aspectRatio: '4:3', angleMode: 'camera', rotation: 30, tilt: 10, zoom: 2,
  originalWidth: 32, originalHeight: 24, scale: 2, model: 'esrgan', providerId: 'native',
  eraseModel: 'lama', removeBgModel: 'u2net', originalPrompt: 'source', upscaleMode: 'ai-only',
  upscaleModel: '302-esrgan', outputFormat: 'png', compression: 80, engine: 'ai-only', displayBackground: 'transparent',
};
function digest(body: Record<string, unknown>): string {
  return digestRequested302UpscaleIdentity({ ...server, request: captureImageEditRequestIdentity(body) });
}

describe('immutable image-edit request identity', (): void => {
  it.each(Object.keys(supported))('retains supported input %s so changing it cannot replay another request', (key): void => {
    const captured = captureImageEditRequestIdentity(supported);
    expect(captured[key]).toEqual(supported[key]);
    expect(digest({ ...supported, [key]: null })).not.toBe(digest(supported));
  });
  it('uses the specified versioned envelope with a hand-built independent digest', (): void => {
    const expected = createHash('sha256').update(JSON.stringify({
      version: 1, entry: '/api/image-edit/302', actorUserId: 'actor',
      request: { action: 'upscale', expandPadding: { bottom: 3, left: 4, right: 2, top: 1 }, imageUrl: 'source' },
      providerId: 'native', modelId: '302-esrgan', sourceWidth: 32, sourceHeight: 24, targetWidth: 64, targetHeight: 48,
    })).digest('hex');
    expect(digest({ imageUrl: 'source', expandPadding: { top: 1, right: 2, bottom: 3, left: 4 }, action: 'upscale' })).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });
  it('ignores key insertion order, but retains parent version order', (): void => {
    const reordered = Object.fromEntries(Object.entries(supported).reverse());
    reordered.expandPadding = { left: 4, bottom: 3, right: 2, top: 1 };
    expect(digest(reordered)).toBe(digest(supported));
    expect(digest({ ...supported, assetParentVersionIds: ['b', 'a'] })).not.toBe(digest(supported));
  });
  it('copies and recursively freezes supported nested values without mutating the execution body', (): void => {
    const body = { assetParentVersionIds: ['a', 'b'], expandPadding: { top: 1, right: 2, bottom: 3, left: 4 } };
    const snapshot = captureImageEditRequestIdentity(body);
    body.assetParentVersionIds.reverse(); body.expandPadding.top = 100;
    expect(snapshot).toEqual({ assetParentVersionIds: ['a', 'b'], expandPadding: { bottom: 3, left: 4, right: 2, top: 1 } });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.assetParentVersionIds)).toBe(true);
    expect(Object.isFrozen(snapshot.expandPadding)).toBe(true);
    expect(Object.isFrozen(body.expandPadding)).toBe(false);
  });
  it('excludes unknown credentials, role, audit and prepaid flags, including non-side padding keys', (): void => {
    const extra = { ...supported, apiKey: 'secret', authorization: 'secret', role: 'admin', prepaid: true,
      taskEntryAudit: { role: 'admin' }, custom: { token: 'secret' },
      expandPadding: { top: 1, right: 2, bottom: 3, left: 4, apiKey: 'secret', role: 'admin' } };
    expect(captureImageEditRequestIdentity(extra)).toEqual(captureImageEditRequestIdentity(supported));
    expect(digest(extra)).toBe(digest(supported));
    expect(JSON.stringify(captureImageEditRequestIdentity(extra))).not.toContain('secret');
  });
  it('preserves explicit values instead of normalizing absent fields into execution defaults', (): void => {
    expect(digest({ action: 'extend' })).not.toBe(digest({ action: 'outpaint' }));
    expect(digest({})).not.toBe(digest({ scale: 2 }));
    expect(digest({ prompt: '' })).not.toBe(digest({ prompt: null }));
    expect(digest({})).not.toBe(digest({ expandPadding: {} }));
  });
  it.each(['actorUserId', 'providerId', 'modelId', 'sourceWidth', 'sourceHeight', 'targetWidth', 'targetHeight'] as const)
    ('binds server-authoritative %s', (key): void => {
      const input = { ...server, request: captureImageEditRequestIdentity(supported) };
      const changed = { ...input, [key]: typeof input[key] === 'number' ? Number(input[key]) + 1 : `${input[key]}-other` };
      expect(digestRequested302UpscaleIdentity(changed)).not.toBe(digestRequested302UpscaleIdentity(input));
    });
});

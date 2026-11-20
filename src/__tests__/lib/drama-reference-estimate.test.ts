import { describe, expect, it } from 'vitest';
import { buildShotGenerateRequest, shotInputReferenceCount } from '@/lib/drama/shot-runner';
import { createEmptyDramaProject, type DramaShot } from '@/lib/drama/types';
describe('drama reference estimate uses generation inputs', () => {
  it('counts first/last frames and remaining character references exactly as submission does', () => {
    const doc = createEmptyDramaProject();
    doc.cast = [{ id: 'a', name: 'A', appearance: '', lockedImageUrl: '/a.png' }, { id: 'b', name: 'B', appearance: '', lockedImageUrl: '/b.png' }];
    const shot = { id: 's', title: '', prompt: 'x', duration: 5, durationSec: 5, characterIds: ['a', 'b'], firstFrameUrl: '/first.png', lastFrameUrl: '/last.png', references: [], continuityNotes: [], takes: [] } as unknown as DramaShot;
    const context = { doc, shot, modelId: 'm', providerId: 'p', capability: { imageToVideo: true, firstLastFrame: true, maxReferenceImages: 8 } };
    const request = buildShotGenerateRequest({ ...context, firstFrameUrl: shot.firstFrameUrl, lastFrameUrl: shot.lastFrameUrl });
    const actual = Number(Boolean(request.imageUrl)) + Number(Boolean(request.lastFrameImageUrl)) + (request.characterReferences as string[]).length;
    expect(actual).toBe(4); expect(shotInputReferenceCount(context)).toBe(actual);
  });
});

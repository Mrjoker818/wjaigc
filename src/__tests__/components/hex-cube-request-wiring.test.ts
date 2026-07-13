import { describe, it, expect } from 'vitest';
import { buildHexCubeGenerationInput } from '@/lib/hex-cube-generation';
import type { HexCubeFaceData } from '@/lib/canvas-generation-group';

describe('hex-cube-request-wiring', () => {
  const sixFaces: HexCubeFaceData[] = [
    { face: 'front', imageUrl: 'http://a.com/1.png', imageId: null },
    { face: 'right', imageUrl: 'http://a.com/2.png', imageId: null },
    { face: 'back', imageUrl: 'http://a.com/3.png', imageId: null },
    { face: 'left', imageUrl: 'http://a.com/4.png', imageId: null },
    { face: 'top', imageUrl: 'http://a.com/5.png', imageId: null },
    { face: 'bottom', imageUrl: 'http://a.com/6.png', imageId: null },
  ];

  it('produces spreadable fields for JSON.stringify body', () => {
    const input = buildHexCubeGenerationInput({
      faces: sixFaces,
      rotationY: 45,
      tiltX: -15,
      zoom: 'close-up',
      userPrompt: 'minimalist sneaker',
    });

    const body = {
      ...input,
      model: 'gpt-image-2',
      providerId: 'p1',
      aspectRatio: '1:1',
      resolution: '2K',
      quality: 'auto',
      n: 1,
      submitOnly: true,
    };

    expect(body.prompt).toContain('[PRODUCT SIX-VIEW CONTROL]');
    expect(body.referenceImages).toHaveLength(6);
    expect(body.referenceDescriptions).toHaveLength(6);
    expect(body.referenceMode).toBe('reference');
    expect(body.model).toBe('gpt-image-2');
    expect(body.aspectRatio).toBe('1:1');
    // Must NOT contain referenceImageUrls
    expect(body).not.toHaveProperty('referenceImageUrls');
  });

  it('does not leak referenceImageUrls when spread', () => {
    const input = buildHexCubeGenerationInput({
      faces: sixFaces,
      rotationY: 0,
      tiltX: 0,
      zoom: 'standard',
      userPrompt: 'test',
    });

    expect(input).not.toHaveProperty('referenceImageUrls');
    expect(input.referenceImages).toBeDefined();
  });
});

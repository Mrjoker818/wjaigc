import { describe, it, expect } from 'vitest';
import { buildHexCubeGenerationInput } from '@/lib/hex-cube-generation';
import type { HexCubeFaceData } from '@/lib/canvas-generation-group';

function makeFace(face: HexCubeFaceData['face'], imageUrl: string): HexCubeFaceData {
  return { face, imageUrl, imageId: null };
}

const ALL_SIX_FACES: HexCubeFaceData[] = [
  makeFace('front', 'http://example.com/front.png'),
  makeFace('right', 'http://example.com/right.png'),
  makeFace('back', 'http://example.com/back.png'),
  makeFace('left', 'http://example.com/left.png'),
  makeFace('top', 'http://example.com/top.png'),
  makeFace('bottom', 'http://example.com/bottom.png'),
];

describe('buildHexCubeGenerationInput', () => {
  it('builds correct input with all six faces', () => {
    const result = buildHexCubeGenerationInput({
      faces: ALL_SIX_FACES,
      rotationY: 90,
      tiltX: -20,
      zoom: 'close-up',
      userPrompt: 'luxury watch',
    });

    expect(result.referenceImages).toHaveLength(6);
    expect(result.referenceImages[0]).toBe('http://example.com/front.png');
    expect(result.referenceImages[1]).toBe('http://example.com/right.png');
    expect(result.referenceImages[2]).toBe('http://example.com/back.png');
    expect(result.referenceImages[3]).toBe('http://example.com/left.png');
    expect(result.referenceImages[4]).toBe('http://example.com/top.png');
    expect(result.referenceImages[5]).toBe('http://example.com/bottom.png');

    expect(result.referenceDescriptions).toEqual([
      'product front view',
      'product right view',
      'product back view',
      'product left view',
      'product top view',
      'product bottom view',
    ]);

    expect(result.referenceMode).toBe('reference');
    expect(result.prompt).toContain('[PRODUCT SIX-VIEW CONTROL]');
    expect(result.prompt).toContain('yaw 90 degrees');
    expect(result.prompt).toContain('pitch -20 degrees');
    expect(result.prompt).toContain('close-up product framing');
    expect(result.prompt).toContain('luxury watch');
  });

  it('throws when a face is missing', () => {
    const missingRight = ALL_SIX_FACES.filter(f => f.face !== 'right');
    expect(() => buildHexCubeGenerationInput({
      faces: missingRight,
      rotationY: 0,
      tiltX: 0,
      zoom: 'standard',
      userPrompt: 'test',
    })).toThrow('请先上传完整的六个产品面');
  });

  it('throws when a face imageUrl is empty', () => {
    const emptyFront = ALL_SIX_FACES.map(f => f.face === 'front' ? { ...f, imageUrl: '' } : f);
    expect(() => buildHexCubeGenerationInput({
      faces: emptyFront,
      rotationY: 0,
      tiltX: 0,
      zoom: 'standard',
      userPrompt: 'test',
    })).toThrow('请先上传完整的六个产品面');
  });

  it('clamps pitch to [-60, 60]', () => {
    const highPitch = buildHexCubeGenerationInput({
      faces: ALL_SIX_FACES,
      rotationY: 0,
      tiltX: 90,
      zoom: 'standard',
      userPrompt: 'test',
    });
    expect(highPitch.prompt).toContain('pitch 60 degrees');

    const lowPitch = buildHexCubeGenerationInput({
      faces: ALL_SIX_FACES,
      rotationY: 0,
      tiltX: -90,
      zoom: 'standard',
      userPrompt: 'test',
    });
    expect(lowPitch.prompt).toContain('pitch -60 degrees');
  });

  it('normalizes negative yaw to [0, 360)', () => {
    const result = buildHexCubeGenerationInput({
      faces: ALL_SIX_FACES,
      rotationY: -90,
      tiltX: 0,
      zoom: 'wide',
      userPrompt: 'test',
    });
    expect(result.prompt).toContain('yaw 270 degrees');
  });
});

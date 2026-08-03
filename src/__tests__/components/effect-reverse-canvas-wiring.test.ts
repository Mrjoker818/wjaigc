import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('effect reverse engineering canvas wiring', () => {
  it('registers Effect Reverse Engineering immediately after 3D Display Pro', () => {
    const displayIndex = source.indexOf('title="3D展陈系统 Pro"');
    const reverseIndex = source.indexOf('title="效果图反向拆图 Pro"');
    const psdIndex = source.indexOf('title="AI PSD');

    expect(displayIndex).toBeGreaterThan(-1);
    expect(reverseIndex).toBeGreaterThan(displayIndex);
    expect(psdIndex).toBeGreaterThan(reverseIndex);
  });

  it('freezes the active source before opening the isolated floating panel', () => {
    expect(source).toContain('setEffectReverseSource({');
    expect(source).toContain('sourceVersionId:');
    expect(source).toContain('<EffectReverseEngineeringPanel');
    expect(source).toContain('initialSource={effectReverseSource}');
    expect(source).toContain('onCanvasResult={handleEffectReverseResult}');
  });

  it('inserts a corrected result beside the frozen source without replacing it', () => {
    expect(source).toContain('const handleEffectReverseResult');
    expect(source).toContain('result.correctedImageUrl');
    expect(source).toContain('x: source.x + source.width + 48');
    expect(source).toContain('onImagesChange([...imagesRef.current, newImage]);');
  });

  it('preserves the existing adjacent toolbar actions', () => {
    for (const action of [
      'setShowDisplay3D(true)',
      'setShowAiPsd(true)',
      'setShowStickerAssistant(true)',
      'handleCreateHexCube',
    ]) {
      expect(source).toContain(action);
    }
  });
});

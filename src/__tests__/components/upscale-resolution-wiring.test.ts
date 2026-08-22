import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);
const upscalePanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas/CanvasEditUpscaleSvgPanel.tsx'),
  'utf8',
);
const source = `${canvasSource}\n${upscalePanelSource}`;

describe('4K and 8K upscale toolbar wiring', () => {
  it('uses the shared target-resolution presets instead of K-labelled multipliers', () => {
    expect(source).toContain('UPSCALE_TARGET_PRESETS');
    expect(source).toContain("useState<UpscaleTargetPreset>('2x')");
    expect(source).toContain('calculateUpscaleTargetDimensions(origW, origH, upscalePreset)');
    expect(source).toContain('UPSCALE_TARGET_PRESETS.map(preset =>');
    expect(source).not.toContain("useState<'2k' | '4k' | '8k'>");
    expect(source).not.toContain("preset === '2k' ? 2 : preset === '4k' ? 4 : 8");
    expect(source).not.toContain("setUpscalePreset('2k')");
  });

  it('submits exact target dimensions through a supported engine scale', () => {
    expect(source).toContain('targetWidth: targetDim.width');
    expect(source).toContain('targetHeight: targetDim.height');
    expect(source).toContain('scale: targetDim.engineScale');
    expect(source).toContain('targetPreset: upscalePreset');
    expect(source).not.toContain("fetch('/api/image/upscale'");
  });

  it('exposes auto, AI-only, and fidelity product modes without legacy aliases', () => {
    expect(source).toContain("useState<UpscaleProductMode>('auto')");
    expect(source).toContain("{ id: 'auto', label: '自动'");
    expect(source).toContain("{ id: 'ai-only', label: '仅 AI'");
    expect(source).toContain("{ id: 'fidelity', label: '保真'");
    expect(source).toContain('setUpscaleMode(mode.id)');
    expect(source).toContain('upscaleMode,');
    expect(source).not.toContain("useState<'lossless' | 'ai'>");
    expect(source).not.toContain("upscaleMode: actualEngine === 'ai'");
  });

  it('surfaces tiled execution and explainable fallback audit details', () => {
    expect(source).toContain('data.tiled === true');
    expect(source).toContain('data.tileCount as number');
    expect(source).toContain('data.fallbackAllowed === true');
    expect(source).toContain('data.fallbackReason as string');
    expect(source).toContain('分块');
  });

  it('accepts both synchronous URL response fields and retains task polling', () => {
    expect(source).toContain('(data.url as string) || (data.imageUrl as string)');
    expect(source).toContain('data.taskId');
    expect(source).toContain('pollForResult');
  });
});

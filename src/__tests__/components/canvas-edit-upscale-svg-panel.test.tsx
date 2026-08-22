import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const componentPath = resolve(root, 'src/components/canvas/CanvasEditUpscaleSvgPanel.tsx');

function readComponent(): string {
  expect(existsSync(componentPath), '缺少放大/SVG 展示叶').toBe(true);
  return existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : '';
}

describe('CanvasEditUpscaleSvgPanel', () => {
  it('按当前模式呈现放大与 SVG 两组控制，不建立业务请求', () => {
    const source = readComponent();

    expect(source).toContain("editMode === 'upscale'");
    expect(source).toContain('showSvgTracePanel');
    expect(source).toContain('HD 高清放大');
    expect(source).toContain('SVG智能描摹');
    expect(source).not.toContain('fetch(');
  });

  it('保留模型、分辨率、产品模式和 SVG 参数入口', () => {
    const source = readComponent();

    expect(source).toContain('aria-label="AI 放大模型"');
    expect(source).toContain("{ id: 'auto', label: '自动'");
    expect(source).toContain("{ id: 'ai-only', label: '仅 AI'");
    expect(source).toContain("{ id: 'fidelity', label: '保真'");
    expect(source).toContain('UPSCALE_TARGET_PRESETS.map');
    expect(source).toContain('setSvgTraceMode');
    expect(source).toContain('setSvgTraceEngine');
    expect(source).toContain('setSvgTraceQualityPreset');
  });

  it('将确认、取消和事件隔离交还父组件，并尊重 reduced-motion', () => {
    const source = readComponent();

    expect(source).toContain('handleUpscaleConfirm');
    expect(source).toContain('handleSvgTraceConfirm');
    expect(source).toContain('exitEditMode');
    expect(source).toContain('stopPropagation()');
    expect(source).toContain('motion-reduce:transition-none');
  });
});

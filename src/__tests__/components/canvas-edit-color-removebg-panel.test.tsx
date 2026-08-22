import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/components/canvas/CanvasEditColorRemoveBgPanel.tsx');

function readComponent(): string {
  expect(existsSync(componentPath), '缺少调色/去背景展示叶').toBe(true);
  return existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : '';
}

describe('CanvasEditColorRemoveBgPanel', () => {
  it('按模式呈现参数调色与专用去背景选择器', () => {
    const source = readComponent();

    expect(source).toContain("editMode === 'colorAdjust'");
    expect(source).toContain('参数调色');
    expect(source).toContain('showRemoveBgPicker');
    expect(source).toContain('选择去背景模型');
    expect(source).not.toContain('fetch(');
  });

  it('保留五项调色参数、引擎、模型和透明蒙版输出控制', () => {
    const source = readComponent();

    for (const name of ['colorBrightness', 'colorContrast', 'colorSaturation', 'colorHue', 'colorTemperature']) {
      expect(source).toContain(name);
    }
    expect(source).toContain("setEngineDialog('removebg')");
    expect(source).toContain('removeBgModelId');
    expect(source).toContain('addRemoveBgMaskToCanvas');
  });

  it('保留确认、取消、处理态与事件隔离，并尊重 reduced-motion', () => {
    const source = readComponent();

    expect(source).toContain('handleConfirmColorAdjust');
    expect(source).toContain('handleRemoveBackground');
    expect(source).toContain('exitEditMode');
    expect(source).toContain('stopPropagation()');
    expect(source).toContain('motion-reduce:transition-none');
  });

  it('调色预览使用同源安全读取地址，避免外部 CDN CORS 空图', () => {
    const source = readComponent();

    expect(source).toContain("getCanvasEditImageSource(editImg.url)");
    expect(source).not.toContain('src={editImg.url}');
  });
});

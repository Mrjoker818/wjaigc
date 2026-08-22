import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/components/canvas/CanvasEditExpandCropPanel.tsx');

function readComponent(): string {
  expect(existsSync(componentPath), '缺少扩展/裁切展示叶').toBe(true);
  return existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : '';
}

describe('CanvasEditExpandCropPanel', () => {
  it('仅为扩展与裁切模式呈现现有控制', () => {
    const source = readComponent();

    expect(source).toContain("editMode === 'expand'");
    expect(source).toContain("editMode === 'expand' || editMode === 'crop'");
    expect(source).toContain('确认扩展');
    expect(source).toContain('确认裁切');
    expect(source).not.toContain('fetch(');
  });

  it('保留四边扩展、比例、裁切矩形和快捷扩展参数', () => {
    const source = readComponent();

    expect(source).toContain('expandPadding');
    expect(source).toContain('expandPaddingRef');
    expect(source).toContain('handleExpandEqualPadding');
    expect(source).toContain('handleExpandToRatio');
    expect(source).toContain('cropRatio');
    expect(source).toContain('setCropRect');
  });

  it('保留确认、取消和事件隔离，并尊重 reduced-motion', () => {
    const source = readComponent();

    expect(source).toContain('handleEditConfirm');
    expect(source).toContain('exitEditMode');
    expect(source).toContain('stopPropagation()');
    expect(source).toContain('motion-reduce:transition-none');
  });
});

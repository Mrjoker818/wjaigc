import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const componentPath = resolve(root, 'src/components/canvas/CanvasEditEraseMaskPanel.tsx');

function readComponent(): string {
  expect(existsSync(componentPath), '缺少擦除/蒙版展示叶').toBe(true);
  return existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : '';
}

describe('CanvasEditEraseMaskPanel', () => {
  it('仅在擦除或蒙版模式渲染当前编辑窗口', () => {
    const source = readComponent();

    expect(source).toContain("editMode === 'erase' || editMode === 'mask'");
    expect(source).toContain("isErase ? '擦除' : '蒙版修图'");
    expect(source).not.toContain('fetch(');
  });

  it('保留画笔、橡皮擦、引擎和提示词参数', () => {
    const source = readComponent();

    expect(source).toContain('brushSize');
    expect(source).toContain('setEditBrushMode');
    expect(source).toContain('eraseModelId');
    expect(source).toContain('setEraseModelId');
    expect(source).toContain('maskKeyword');
    expect(source).toContain('setMaskKeyword');
  });

  it('保留确认、取消、处理态和事件隔离，并尊重 reduced-motion', () => {
    const source = readComponent();

    expect(source).toContain('handleEditConfirm');
    expect(source).toContain('exitEditMode');
    expect(source).toContain("isEditProcessing ? '处理中...'");
    expect(source).toContain('stopPropagation()');
    expect(source).toContain('motion-reduce:transition-none');
  });

  it('远程图片经同源安全读取地址进入像素编辑器', () => {
    const source = readComponent();

    expect(source).toContain("getCanvasEditImageSource(editImg.url)");
    expect(source).not.toContain('src={editImg.url}');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const canvasPath = resolve(root, 'src/components/infinite-canvas.tsx');
const canvasSource = readFileSync(canvasPath, 'utf8').replace(/\r\n/g, '\n');

const presentationLeaves = [
  'CanvasEmptyState',
  'CanvasImageActionToolbar',
  'CanvasEditUpscaleSvgPanel',
  'CanvasEditEraseMaskPanel',
  'CanvasEditColorRemoveBgPanel',
  'CanvasEditExpandCropPanel',
] as const;

describe('V588-UI-004 画布展示边界', () => {
  it.each(presentationLeaves)('将 %s 作为独立展示叶接入 InfiniteCanvas', (name) => {
    const componentPath = resolve(root, `src/components/canvas/${name}.tsx`);

    expect(existsSync(componentPath), `缺少展示叶：${name}`).toBe(true);
    if (!existsSync(componentPath)) return;

    const source = readFileSync(componentPath, 'utf8').replace(/\r\n/g, '\n');
    expect(source).toMatch(new RegExp(`export (?:default )?function ${name}|export const ${name}`));
    expect(canvasSource).toContain(`@/components/canvas/${name}`);
    expect(canvasSource).toContain(`<${name}`);
  });

  it('让父画布继续拥有业务副作用，展示叶不得建立平行任务链路', () => {
    expect(canvasSource).toContain('activateCanvasToolSession');
    expect(canvasSource).toContain('requestDeleteImages');
    expect(canvasSource).toContain('onForceSave');
    expect(canvasSource).toContain('fetch(');

    for (const name of presentationLeaves) {
      const componentPath = resolve(root, `src/components/canvas/${name}.tsx`);
      if (!existsSync(componentPath)) continue;
      const source = readFileSync(componentPath, 'utf8');
      expect(source, `${name} 不得直接调用 API`).not.toContain('fetch(');
      expect(source, `${name} 不得创建工具会话`).not.toContain('activateCanvasToolSession');
      expect(source, `${name} 不得删除或保存项目`).not.toContain('requestDeleteImages');
      expect(source, `${name} 不得持久化项目`).not.toContain('onForceSave');
    }
  });

  it('继续复用当前约束定位、底部 portal 和工具会话架构', () => {
    expect(canvasSource).toContain('getConstrainedImageToolbarPosition');
    expect(canvasSource).toContain('getBottomToolbarDrawerPlacement');
    expect(canvasSource).toContain("createPortal(");
    expect(canvasSource).toContain('document.body');
    expect(canvasSource).toContain('data-canvas-tool-host');
  });
});

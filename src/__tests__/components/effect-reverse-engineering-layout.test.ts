import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVERSE_COPY } from '@/components/effect-reverse-engineering/i18n';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

describe('effect reverse engineering Pro layout contract', () => {
  it('provides the Chinese three-column workbench components', () => {
    const panel = readSource('src/components/effect-reverse-engineering-panel.tsx');
    const source = readSource('src/components/effect-reverse-engineering/source-panel.tsx');
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    const layers = readSource('src/components/effect-reverse-engineering/layer-panel.tsx');
    expect(REVERSE_COPY.title).toBe('效果图反向拆图 Pro');
    expect(panel).toContain('EffectReverseSourcePanel');
    expect(panel).toContain('EffectReverseWorkspace');
    expect(panel).toContain('EffectReverseLayerPanel');
    expect(source).toContain('REVERSE_COPY.source');
    expect(REVERSE_COPY.calibration).toBe('尺寸校准');
    expect(workspace).toContain('REVERSE_COPY.width');
    expect(workspace).toContain('REVERSE_COPY.progress');
    expect(layers).toContain('REVERSE_COPY.layers');
    expect(layers).toContain('REVERSE_COPY.manualMode');
  });

  it('provides the prototype workbench tabs and manual-analysis state', () => {
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    const layers = readSource('src/components/effect-reverse-engineering/layer-panel.tsx');
    expect(REVERSE_COPY.original).toBe('原图');
    expect(REVERSE_COPY.perspective).toBe('透视校正');
    expect(REVERSE_COPY.flat).toBe('平面拆图');
    expect(REVERSE_COPY.vector).toBe('矢量结果');
    expect(workspace).toContain('REVERSE_COPY.original');
    expect(workspace).toContain('REVERSE_COPY.perspective');
    expect(workspace).toContain('REVERSE_COPY.flat');
    expect(workspace).toContain("task?.status === 'completed' && task.result");
    expect(workspace).toContain('REVERSE_COPY.result');
    expect(layers).toContain('REVERSE_COPY.manualMode');
    expect(layers).toContain('REVERSE_COPY.notAnalyzed');
    expect(workspace).not.toContain('Effect Reverse Engineering Pro');
    expect(layers).not.toContain('Run AI analysis');
  });

  it('only exposes a result workspace after a real completed task result exists', () => {
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(workspace).not.toContain("['vector', REVERSE_COPY.vector]");
    expect(workspace).toContain("...(hasRealResult ? [['result', REVERSE_COPY.result] as const] : [])");
    expect(workspace).toContain("tab === 'result'");
  });

  it('keeps visible copy encoded as readable Chinese', () => {
    const sources = [
      readSource('src/components/effect-reverse-engineering/i18n.ts'),
      readSource('src/components/effect-reverse-engineering/source-panel.tsx'),
      readSource('src/components/effect-reverse-engineering/workspace.tsx'),
      readSource('src/components/effect-reverse-engineering/layer-panel.tsx'),
    ].join('\n');
    expect(sources).not.toMatch(/[閺佸牊鐏夐崶鎯у冀閸氭垶濯堕柅蹇氼潒]/);
    expect(sources).toContain('效果图反向拆图 Pro');
    expect(sources).toContain('手动模式');
    expect(sources).toContain("project: '项目'");
    expect(sources).toContain("version: '版本'");
    expect(sources).toContain('downloadFormat');
  });

  it('keeps task feedback visible and makes the feature drawer vertically bounded', () => {
    const panel = readSource('src/components/effect-reverse-engineering-panel.tsx');
    const canvas = readSource('src/components/infinite-canvas.tsx');
    expect(panel).toContain('data-testid="effect-reverse-message"');
    expect(panel).toContain('task.result.exportUrl');
    expect(canvas).toContain('data-bottom-toolbar-drawer');
    expect(canvas).toContain('max-h-[min(60vh,520px)]');
    expect(canvas).toContain('overflow-y-auto');
  });
});

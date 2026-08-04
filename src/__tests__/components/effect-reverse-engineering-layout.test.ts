import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVERSE_COPY } from '@/components/effect-reverse-engineering/i18n';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

describe('effect reverse engineering Pro layout contract', () => {
  it('uses readable Chinese copy and keeps preview concepts distinct', () => {
    const copySource = readSource('src/components/effect-reverse-engineering/i18n.ts');
    expect(REVERSE_COPY.title).toBe('效果图反向拆图 Pro');
    expect(REVERSE_COPY.previewTab).toBe('效果预览');
    expect(REVERSE_COPY.original).toBe('原图');
    expect(REVERSE_COPY.structureLayer).toBe('结构层');
    expect(REVERSE_COPY.compare).toBe('对比');
    expect(REVERSE_COPY.calibration).toBe('尺寸基准');
    expect(REVERSE_COPY.subtitle).toBe('3D效果图 / AI效果图 / 美陈展台 / 平面恢复与矢量化');
    expect(copySource).not.toMatch(/[鏁鍥鍚媶棰灞瀵绾]/);
  });

  it('restores the prototype title identity and minimized recovery chip', () => {
    const panel = readSource('src/components/effect-reverse-engineering-panel.tsx');
    expect(panel).toContain('data-testid="effect-reverse-title-grip"');
    expect(panel).toContain('data-testid="effect-reverse-skill-badge"');
    expect(panel).toContain('>拆<');
    expect(panel).toContain('data-testid="effect-reverse-minimized-chip"');
    expect(panel).toContain('REVERSE_COPY.minimizedLabel');
    expect(panel).toContain('focus-visible:ring-2');
  });

  it('faithfully uses the prototype two-column workbench and status bar', () => {
    const panel = readSource('src/components/effect-reverse-engineering-panel.tsx');
    expect(panel).toContain('EffectReverseSourcePanel');
    expect(panel).toContain('EffectReverseWorkspace');
    expect(panel).toContain('data-testid="effect-reverse-status-bar"');
    expect(panel).toContain('grid-cols-[380px_minmax(0,1fr)]');
    expect(panel).not.toContain('grid-cols-[380px_minmax(0,1fr)_300px]');
    expect(panel).toContain('h-[84px]');
    expect(panel).toContain('REVERSE_COPY.modeStatus');
    expect(panel).toContain('REVERSE_COPY.structureStatus');
    expect(panel).toContain('REVERSE_COPY.correctionStatus');
    expect(REVERSE_COPY.modeStatus).toBe('模式：');
    expect(REVERSE_COPY.structureStatus).toBe('结构识别：');
    expect(REVERSE_COPY.correctionStatus).toBe('几何纠错：');
  });

  it('provides all five prototype workbench tabs without claiming fake results', () => {
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    for (const key of ['previewTab', 'analysisTab', 'flat', 'vector', 'history'] as const) {
      expect(workspace).toContain(`REVERSE_COPY.${key}`);
    }
    expect(REVERSE_COPY.flat).toBe('平面拆图');
    expect(REVERSE_COPY.perspectiveCorrection).toBe('四点透视校正');
    expect(workspace).toContain("task?.status === 'completed' && task.result");
    expect(workspace).toContain("disabled={resultRequired && !hasRealResult}");
    expect(workspace).toContain('REVERSE_COPY.unavailableUntilResult');
  });

  it('does not ship mojibake in panel and workspace status text', () => {
    const panel = readSource('src/components/effect-reverse-engineering-panel.tsx');
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(panel).toContain('图片已载入，等待结构分析');
    expect(panel).toContain('等待上传效果图');
    expect(workspace).toContain('预览工具');
    expect(workspace).toContain('REVERSE_COPY.selectTool');
    expect(workspace).toContain('REVERSE_COPY.panTool');
    expect(workspace).toContain('REVERSE_COPY.zoomIn');
    expect(workspace).toContain('REVERSE_COPY.zoomOut');
    expect(workspace).toContain('REVERSE_COPY.annotateTool');
    expect(workspace).toContain('预览模式');
    expect(workspace).not.toMatch(/[棰勮绉诲姩鏀惧ぇ缂╁皬]/);
  });

  it('provides source, mode, analysis, perspective, dimension and export controls', () => {
    const source = readSource('src/components/effect-reverse-engineering/source-panel.tsx');
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(source).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(source).toContain('REVERSE_COPY.restoreMode');
    expect(source).toContain('REVERSE_COPY.productionMode');
    expect(source).toContain('REVERSE_COPY.constructionMode');
    expect(source).toContain('REVERSE_COPY.analyze');
    expect(source).toContain('EffectReverseLayerPanel');
    expect(source).toContain('REVERSE_COPY.horizontalCorrection');
    expect(source).toContain('REVERSE_COPY.verticalCorrection');
    expect(source).toContain('REVERSE_COPY.perspectiveStrength');
    expect(source).toContain('REVERSE_COPY.basePart');
    expect(source).toContain('REVERSE_COPY.baseDimension');
    expect(source).toContain('REVERSE_COPY.resetPoints');
    expect(source).toContain("onSubmit('correct')");
    expect(source).toContain("'export-svg'");
    expect(source).toContain("'export-pdf'");
    expect(source).toContain("'export-zip'");
    expect(source).toContain('REVERSE_COPY.dxfUnavailable');
    expect(workspace).not.toContain('REVERSE_COPY.baseDimension');
  });

  it('uses the prototype sidebar information hierarchy instead of one undifferentiated stack', () => {
    const source = readSource('src/components/effect-reverse-engineering/source-panel.tsx');
    for (const section of [
      'uploadSection',
      'modeSection',
      'analysisSection',
      'structuresSection',
      'perspectiveSection',
      'dimensionSection',
      'advancedSection',
      'exportSection',
    ] as const) {
      expect(source).toContain(`REVERSE_COPY.${section}`);
    }
    expect(source).toContain('data-testid="effect-reverse-analysis-state"');
    expect(source).toContain('REVERSE_COPY.analysisUnavailable');
    expect(source).toContain('REVERSE_COPY.analysisReady');
    expect(source).toContain('REVERSE_COPY.analysisSubmitted');
  });

  it('supports validated click and drag uploads with an accessible error state', () => {
    const source = readSource('src/components/effect-reverse-engineering/source-panel.tsx');
    const panel = readSource('src/components/effect-reverse-engineering-panel.tsx');
    const canvas = readSource('src/components/infinite-canvas.tsx');
    const workspace = readSource('src/components/canvas-workspace.tsx');
    expect(source).toContain("const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])");
    expect(source).toContain('const MAX_UPLOAD_BYTES = 20 * 1024 * 1024');
    expect(source).toContain('onDragEnter=');
    expect(source).toContain('onDragOver=');
    expect(source).toContain('onDragLeave=');
    expect(source).toContain('onDrop=');
    expect(source).toContain('REVERSE_COPY.uploadInvalidType');
    expect(source).toContain('REVERSE_COPY.uploadTooLarge');
    expect(source).toContain('role="alert"');
    expect(source).toContain('await onUploadSource(file)');
    expect(source).not.toContain('URL.createObjectURL');
    expect(panel).toContain('onUploadSource?: (file: File) => Promise<EffectReverseSource>');
    expect(canvas).toContain('onUploadEffectReverseSource');
    expect(workspace).toContain('onUploadEffectReverseSource={handleUploadEffectReverseSource}');
    expect(workspace).toContain('await UserManagerCore.getInstance().flushProjectsToServer()');
  });

  it('makes the preview toolbar interactive instead of decorative', () => {
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(workspace).toContain("type PreviewTool = 'select' | 'pan' | 'annotate'");
    expect(workspace).toContain('const [previewTool, setPreviewTool]');
    expect(workspace).toContain('const [previewZoom, setPreviewZoom]');
    expect(workspace).toContain('const [previewOffset, setPreviewOffset]');
    expect(workspace).toContain('data-active={previewTool === tool}');
    expect(workspace).toContain('onPreviewPointerMove');
    expect(workspace).toContain('transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})`');
    expect(workspace).toContain('setPointerCapture');
    expect(workspace).toContain('releasePointerCapture');
  });

  it('maps annotations and perspective points to the rendered image bounds', () => {
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(workspace).toContain("from '@/lib/effect-reverse-engineering/preview-geometry'");
    expect(workspace).toContain('clientPointToImagePoint');
    expect(workspace).toContain('getContainedImageRect');
    expect(workspace).toContain('naturalWidth');
    expect(workspace).toContain('naturalHeight');
    expect(workspace).toContain('data-preview-image-frame');
    expect(workspace).not.toContain('(event.clientX - rect.left) / rect.width');
    expect(workspace).not.toContain('(event.clientY - rect.top) / rect.height');
  });

  it('marks inferred regions and unsupported capabilities truthfully', () => {
    const layers = readSource('src/components/effect-reverse-engineering/layer-panel.tsx');
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(layers).toContain('REVERSE_COPY.inferred');
    expect(layers).toContain('REVERSE_COPY.manualMode');
    expect(workspace).toContain('REVERSE_COPY.capabilityBoundary');
    expect(workspace).toContain('REVERSE_COPY.historyUnavailable');
  });

  it('provides prototype workbench result views without inventing unavailable metadata', () => {
    const workspace = readSource('src/components/effect-reverse-engineering/workspace.tsx');
    expect(workspace).toContain('data-testid="effect-reverse-analysis-overlay"');
    expect(workspace).toContain('REVERSE_COPY.spatialPlanes');
    expect(workspace).toContain('REVERSE_COPY.perspectiveConsistency');
    expect(workspace).toContain('REVERSE_COPY.geometryAnomalies');
    expect(workspace).toContain('data-testid="effect-reverse-analysis-grid"');
    expect(workspace).toContain('REVERSE_COPY.metadataPending');
    expect(workspace).toContain('data-testid="effect-reverse-flat-grid"');
    expect(workspace).toContain('task?.result?.correctedImageUrl');
    expect(workspace).toContain('data-testid="effect-reverse-vector-result"');
    expect(workspace).toContain('REVERSE_COPY.vectorStatsUnavailable');
    expect(workspace).not.toMatch(/confidence:\s*0\.\d+/);
    expect(workspace).not.toMatch(/96%|91%|88%|326条路径/);
  });
});

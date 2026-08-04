import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

const canvasSource = readSource('src/components/infinite-canvas.tsx');
const canvasWorkspaceSource = readSource('src/components/canvas-workspace.tsx');
const humanRepairSource = readSource('src/components/human-repair-panel.tsx');
const layerPanelSource = readSource('src/components/layer-panel.tsx');
const versionHistorySource = readSource('src/components/version-history-panel.tsx');
const imageEditorSource = readSource('src/components/image-editor.tsx');
const videoPanelSource = readSource('src/components/video-generation-panel.tsx');

describe('canvas toolbar floating windows', () => {
  it('centers the canvas generator and video utility panels when opened', () => {
    expect(canvasSource).toContain('getCenteredFloatingPanelPosition');
    expect(canvasSource).toContain('data-popup="video-extract"');
    expect(canvasSource).toContain('fixed left-1/2 top-1/2');
    expect(canvasSource).toContain('-translate-x-1/2 -translate-y-1/2');
    expect(canvasSource).not.toContain('fixed top-24 right-4 z-[65] w-80');
    expect(canvasSource).not.toContain('fixed top-20 right-4 z-[85] w-[420px]');
  });

  it('uses a centered floating presentation for the repair and history tools', () => {
    expect(humanRepairSource).toContain('fixed left-1/2 top-1/2');
    expect(humanRepairSource).toContain('-translate-x-1/2 -translate-y-1/2');
    expect(humanRepairSource).not.toContain('fixed inset-y-8 right-8');
    expect(layerPanelSource).toContain('floating?: boolean');
    expect(layerPanelSource).toContain('fixed left-1/2 top-1/2');
    expect(layerPanelSource).toContain('-translate-x-1/2 -translate-y-1/2');
    expect(versionHistorySource).toContain('floating?: boolean');
    expect(versionHistorySource).toContain('fixed left-1/2 top-1/2');
    expect(versionHistorySource).toContain('-translate-x-1/2 -translate-y-1/2');
    expect(canvasSource).toMatch(/<LayerPanel\s+floating/);
    expect(canvasSource).toMatch(/<VersionHistoryPanel\s+floating/);
  });

  it('keeps core canvas controls visible while the extended bottom-toolbar tools can collapse', () => {
    expect(canvasSource).toContain('max-w-[calc(100%-2rem)]');
    expect(canvasSource).toContain('overflow-x-auto');
    expect(canvasSource).toContain('[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden');
    expect(canvasSource).toContain('data-bottom-toolbar-drawer');
    expect(canvasSource).toContain('getBottomToolbarDrawerPlacement');
    expect(canvasSource).toContain('max-h-[min(60vh,520px)]');
    expect(canvasSource).toContain("bottomBarHovered && bottomToolbarDrawerPlacement ? 'grid grid-cols-6 gap-1 opacity-100 pointer-events-auto' : 'hidden opacity-0 pointer-events-none'");
  });

  it('isolates bottom-toolbar pointer input from canvas interactions', () => {
    expect(canvasSource).toContain('data-toolbar="bottom-toolbar"');
    expect(canvasSource).toContain('onMouseDown={(event) => event.stopPropagation()}');
  });

  it('uses a bounded +N popover instead of expanding the selected-image toolbar', () => {
    expect(canvasSource).toContain('data-image-toolbar-overflow');
    expect(canvasSource).toContain('max-h-[min(50vh,420px)]');
    expect(canvasSource).toContain('visibleImageActions.slice(5)');
    expect(canvasSource).toContain("toolbarExpanded ? 'block' : 'hidden'");
    expect(canvasSource).toContain('onWheel={(e) => e.stopPropagation()}');
  });

  it('keeps the selected-image delete action reachable without colliding with hover actions', () => {
    expect(canvasSource).toContain('absolute -top-9 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-0.5');
    expect(canvasSource).toContain("className={`absolute group z-10 ${isSelected ? 'z-[60]' : ''}");
    expect(canvasSource).toContain("hoverToolbarImageId === image.id && editMode === 'none' && !isSelected &&");
    expect(canvasSource).toContain('data-testid="selected-image-delete"');
    expect(canvasSource).toContain('const deletingIds = new Set(selectedIds);');
    expect(canvasSource).toContain('applyImageChanges(images.filter(i => !deletingIds.has(i.id)));');
    expect(canvasSource).toContain('title="删除"');
  });

  it('force-saves the post-delete snapshot so removed images cannot be restored', () => {
    expect(canvasSource).toContain('onForceSave?: (images: CanvasImage[]) => void;');
    expect(canvasSource).toContain('onForceSave?.(newImages);');
    expect(canvasWorkspaceSource).toContain('onForceSave={(nextImages) => {');
    expect(canvasWorkspaceSource).toContain('const persistable = nextImages.map(img => ({');
    expect(canvasWorkspaceSource).not.toContain('if (currentProject?.id && images.length > 0)');
  });

  it('keeps selected-image actions above the open right workspace panel', () => {
    expect(canvasWorkspaceSource).toContain('z-[70] flex transition-all');
    expect(canvasSource).toContain('className="absolute z-[80] pointer-events-auto"');
  });

  it('keeps the right panel collapse control inside a narrow viewport', () => {
    expect(canvasWorkspaceSource).toContain("panelCollapsed ? '20px' : 'min(480px, 100vw)'");
  });

  it('opens one bottom-toolbar tool at a time and allows Escape to close external editors', () => {
    expect(canvasSource).toContain('const closeCanvasToolPanels = useCallback');
    expect(canvasSource).toContain('onClickCapture={closeCanvasToolPanels}');
    expect(canvasSource).toContain("new Event('wujie:canvas-tool-opened')");
    expect(canvasSource).toContain("window.addEventListener('wujie:close-canvas-tool-panels'");
    expect(canvasWorkspaceSource).toContain("window.addEventListener('wujie:canvas-tool-opened'");
    expect(canvasWorkspaceSource).toContain("new Event('wujie:close-canvas-tool-panels')");
    expect(imageEditorSource).toContain("if (event.key === 'Escape' && !event.defaultPrevented)");
    expect(videoPanelSource).toContain('fixed z-[210]');
  });

  it('treats reverse engineering as an isolated floating canvas tool', () => {
    expect(canvasSource).toContain('showEffectReverse');
    expect(canvasSource).toContain('setShowEffectReverse(false)');
    expect(canvasSource).toContain('<EffectReverseEngineeringPanel');
    expect(canvasSource).toContain('data-popup="effect-reverse-engineering"');
  });
});

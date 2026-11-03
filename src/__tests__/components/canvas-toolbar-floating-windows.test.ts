import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { observeWorkspaceBindings } from '../helpers/workspace-annotation-bindings';
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
const globalsSource = readSource('src/app/globals.css');
const imageToolbarSource = readSource('src/components/canvas/CanvasImageActionToolbar.tsx');
const upscaleSvgPanelSource = readSource('src/components/canvas/CanvasEditUpscaleSvgPanel.tsx');

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
    const bottomToolbarStart = canvasSource.indexOf('<div\n        ref={bottomToolbarRef}\n        data-toolbar="bottom-toolbar"');
    const bottomToolbarSource = canvasSource.slice(bottomToolbarStart, canvasSource.indexOf('data-bottom-toolbar-drawer', bottomToolbarStart));
    expect(bottomToolbarSource).toContain('overflow-visible');
    expect(bottomToolbarSource).not.toContain('overflow-x-auto');
    expect(bottomToolbarSource).not.toContain('[scrollbar-width:none]');
    expect(canvasSource).toContain('data-bottom-toolbar-drawer');
    expect(canvasSource).toContain('getBottomToolbarDrawerPlacement');
    expect(canvasSource).toContain('max-h-[min(60vh,520px)]');
    expect(canvasSource).toContain("'flex flex-col gap-2 opacity-100 pointer-events-auto'");
  });

  it('portals the fixed bottom-toolbar drawer outside the translated toolbar containing block', () => {
    expect(canvasSource).toContain("import { createPortal } from 'react-dom';");
    expect(canvasSource).toContain('createPortal(');
    expect(canvasSource).toContain('document.body');
    expect(canvasSource).toMatch(/createPortal\(\s*\(\s*<div[\s\S]*?data-bottom-toolbar-drawer/);
    expect(canvasSource).toContain('bottomToolbarDrawerOpen');
    expect(canvasSource).toContain('aria-label="全部工具"');
    expect(canvasSource).toContain('aria-expanded={bottomToolbarDrawerOpen}');
    expect(canvasSource).toContain('aria-controls="canvas-bottom-toolbar-drawer"');
    expect(canvasSource).toMatch(/aria-controls="canvas-bottom-toolbar-drawer"[\s\S]*?onClick=\{\(\) => \{[\s\S]*?setBottomToolbarDrawerOpen\(\(open\) => !open\);[\s\S]*?\}\}/);
    expect(canvasSource).not.toContain('onMouseEnter={() => setBottomToolbarDrawerOpen(true)}');
    expect(canvasSource).toContain('id="canvas-bottom-toolbar-drawer"');
    expect(canvasSource).toContain('data-toolbar-drawer-section="ai-creation"');
    expect(canvasSource).not.toContain("bottomToolbarDrawerOpen && bottomToolbarDrawerPlacement ? 'grid grid-cols-6");
    expect(canvasSource).toContain("event.key === 'Escape'");
    expect(canvasSource).toContain("closest('[data-toolbar=\"bottom-toolbar\"], [data-bottom-toolbar-drawer]')");
  });

  it('groups the bottom-toolbar drawer into labeled sections with a close action', () => {
    expect(canvasSource).toContain('data-toolbar-drawer-section="ai-creation"');
    expect(canvasSource).toContain('data-toolbar-drawer-section="brand-design"');
    expect(canvasSource).toContain('data-toolbar-drawer-section="pro-tools"');
    expect(canvasSource).toContain('data-toolbar-drawer-section="canvas-tools"');
    expect(canvasSource).toContain('>全部工具</span>');
    expect(canvasSource).toContain('aria-label="关闭工具抽屉"');
    expect(canvasSource).not.toContain('grid-cols-[repeat(auto-fit,minmax(44px,1fr))]');
  });

  it('centers drawer tile icons and labels without inherited tooltip offsets', () => {
    expect(globalsSource).toContain('#canvas-bottom-toolbar-drawer section button');
    expect(globalsSource).toContain('justify-items: center');
    expect(globalsSource).toContain('all: initial');
    expect(globalsSource).toContain('width: max-content');
  });

  it('isolates bottom-toolbar pointer input from canvas interactions', () => {
    expect(canvasSource).toContain('data-toolbar="bottom-toolbar"');
    expect(canvasSource).toContain('onMouseDown={(event) => event.stopPropagation()}');
  });

  it('publishes the measured bottom toolbar offset for external skill drawers', () => {
    expect(canvasSource).toContain("setProperty('--canvas-bottom-toolbar-offset'");
    expect(canvasSource).toContain("removeProperty('--canvas-bottom-toolbar-offset'");
    expect(canvasSource).toContain('data-canvas-bottom-toolbar-anchor');
    expect(canvasSource).toContain('ResizeObserver');
  });

  it('uses a bounded +N popover instead of expanding the selected-image toolbar', () => {
    expect(canvasSource).toContain('<CanvasImageActionToolbar');
    expect(canvasSource).toContain('overflowActions={overflowImageActions}');
    expect(imageToolbarSource).toContain('data-image-toolbar-overflow');
    expect(imageToolbarSource).toContain('max-h-[min(50vh,420px)]');
    expect(imageToolbarSource).toContain('overflowActions.map');
    expect(imageToolbarSource).toContain("expanded ? 'block' : 'hidden'");
    expect(imageToolbarSource).toContain('onWheel={(event) => event.stopPropagation()}');
  });

  it('keeps bottom and selected-image tool menus mutually exclusive', () => {
    expect(canvasSource).toContain('setToolbarExpanded(false);');
    expect(canvasSource).toContain('setShowToolbarCustomize(false);');
    expect(canvasSource).toContain('setBottomToolbarDrawerOpen(false);');
    expect(canvasSource).toMatch(/aria-controls="canvas-bottom-toolbar-drawer"[\s\S]*?setToolbarExpanded\(false\);[\s\S]*?setShowToolbarCustomize\(false\);[\s\S]*?setBottomToolbarDrawerOpen\(\(open\) => !open\)/);
    expect(imageToolbarSource).toContain('aria-controls="selected-image-toolbar-overflow"');
    expect(imageToolbarSource).toContain("onBeforeOpenOverlay('overflow')");
    expect(imageToolbarSource).toContain("onBeforeOpenOverlay('customize')");
    expect(canvasSource).toMatch(/onBeforeOpenOverlay=\{\(overlay\) => \{[\s\S]*?setBottomToolbarDrawerOpen\(false\);[\s\S]*?setShowToolbarCustomize\(false\);[\s\S]*?setToolbarExpanded\(false\);/);
    expect(canvasSource).toMatch(/event\.key === 'Escape'[\s\S]*?setBottomToolbarDrawerOpen\(false\);[\s\S]*?setToolbarExpanded\(false\);[\s\S]*?setShowToolbarCustomize\(false\);/);
  });

  it('keeps the selected-image delete action reachable without colliding with hover actions', () => {
    expect(canvasSource).toContain('absolute -top-9 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-0.5');
    expect(canvasSource).toContain('data-toolbar="image-hover-toolbar"');
    expect(canvasSource).toContain("className={`absolute group z-10 ${isSelected ? 'z-[60]' : ''}");
    expect(canvasSource).toContain("hoverToolbarImageId === image.id && editMode === 'none' && !isSelected &&");
    expect(imageToolbarSource).toContain('data-testid="selected-image-delete"');
    expect(canvasSource).toContain('onDelete={deleteSelectedImages}');
    expect(canvasSource).toContain('const requestDeleteImages = useCallback');
    expect(canvasSource).toContain('void requestDeleteImages([...selectedIds]);');
    expect(canvasSource).toContain('title="删除"');
  });

  it('force-saves the post-delete snapshot so removed images cannot be restored', () => {
    expect(canvasSource).toContain('onForceSave?: (images: CanvasImage[]) => void;');
    expect(canvasSource).toContain('onForceSave?.(newImages);');
    expect(canvasWorkspaceSource).toContain('onForceSave={(nextImages) => {');
    expect(canvasWorkspaceSource).toContain('const persistCanvasImagesNow = useCallback');
    expect(canvasWorkspaceSource).toContain('const persistableCanvasImages = serializeCanvasWorkspacePlacements(nextImages)');
    expect(canvasWorkspaceSource).toContain('canvasImages: persistableCanvasImages');
    expect(canvasWorkspaceSource).toContain('persistCanvasImagesNow(nextImages);');
    expect(canvasWorkspaceSource).not.toContain('if (currentProject?.id && images.length > 0)');
  });

  it('keeps image edit controls above the open right workspace panel', () => {
    expect(canvasWorkspaceSource).toContain('z-[70] flex transition-all');
    expect(upscaleSvgPanelSource).toContain('absolute z-[80] pointer-events-auto');
  });

  it('keeps the right panel collapse control inside a narrow viewport', () => {
    // Executable binding and SSR declaration proof only; computed viewport geometry remains separately unverified.
    const scenarios = [
      { width: 320, states: [true, false, true] },
      { width: 375, states: [true, false, true] },
      { width: 767, states: [true, false, true] },
      { width: 768, states: [false, true, false] },
      { width: 1440, states: [false, true, false] },
      { width: undefined, states: [false, true, false] },
    ];
    for (const scenario of scenarios) {
      const controller = observeWorkspaceBindings({ workspace: canvasWorkspaceSource, canvas: canvasSource }, scenario.width);
      for (const [index, collapsed] of scenario.states.entries()) {
        const state = controller.read();
        expect(state.collapsed).toBe(collapsed);
        expect(state.canvasCollapsed).toBe(collapsed);
        expect(state.panelStyle.width).toBe(collapsed ? 44 : 'min(480px, 100vw)');
        expect(state.buttonProps.style).toMatchObject({ width: 44, minHeight: 44 });
        expect(state.buttonProps['aria-label']).toBe(collapsed ? '展开面板' : '收起面板');
        expect(state.buttonProps['aria-expanded']).toBe(!collapsed);
        expect(state.contentVisible).toBe(!collapsed);
        expect(state.contentContainer !== null).toBe(index > 0 || !collapsed);
        const markup = renderToStaticMarkup(createElement('div', { style: state.panelStyle },
          createElement('button', state.buttonProps), state.contentContainer));
        expect(markup).toContain(collapsed ? 'width:44px' : 'width:min(480px, 100vw)');
        expect(markup).toContain(collapsed ? 'aria-label="展开面板"' : 'aria-label="收起面板"');
        expect(markup).toContain(collapsed ? 'aria-expanded="false"' : 'aria-expanded="true"');
        if (index < scenario.states.length - 1) controller.clickToggle();
      }
    }
  });

  it('opens one bottom-toolbar tool at a time and allows Escape to close external editors', () => {
    expect(canvasSource).toContain('canvasToolSession');
    expect(canvasSource).toContain('activateCanvasToolSession');
    expect(canvasSource).toContain('reconcileCanvasToolSession');
    expect(canvasSource).toContain('data-canvas-tool-host');
    expect(canvasSource).toContain('const closeCanvasToolPanels = useCallback');
    expect(canvasSource).not.toContain('onClickCapture={closeCanvasToolPanels}');
    expect(canvasSource).not.toContain('onPointerDownCapture={closeCanvasToolPanels}');
    expect(canvasSource).toContain('closeBottomToolbarDrawerAfterAction');
    expect(canvasSource).toContain("target.closest('button')");
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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
}

const boundaries = {
  infiniteCanvas: source('src/components/infinite-canvas.tsx'),
  workspace: source('src/components/canvas-workspace.tsx'),
  surface: source('src/components/canvas/CanvasSurface.tsx'),
  toolHost: source('src/components/canvas/CanvasToolHost.tsx'),
};

describe('canvas kernel component boundaries', () => {
  it('keeps history ownership and remote task polling outside InfiniteCanvas', () => {
    expect(boundaries.infiniteCanvas).not.toContain('new IncrementalHistoryManager');
    expect(boundaries.infiniteCanvas).not.toContain("fetch('/api/poll-task'");
    expect(boundaries.workspace).toContain('new IncrementalHistoryManager<CanvasImage>(50)');
    expect(boundaries.workspace).toContain("fetch('/api/poll-task'");
  });

  it('keeps CanvasSurface rendering-only and CanvasToolHost session-only', () => {
    expect(boundaries.surface).not.toContain('/api/');
    expect(boundaries.surface).not.toContain('UserManagerCore');
    expect(boundaries.toolHost).not.toContain('/api/');
    expect(boundaries.toolHost).not.toContain('UserManagerCore');
  });

  it('keeps protected business tool panels reachable through the canvas facade', () => {
    const protectedPanels = [
      'EffectReverseEngineeringPanel',
      'HumanRepairPanel',
      'AgentEditor',
      'LayerPanel',
      'VersionHistoryPanel',
      'ModelViewer3D',
      'BrandEcommercePanel',
      'BrandFactoryPanel',
      'LogoSkillPanel',
      'BrandPackagingPanel',
      'Display3DPanel',
      'FontDesignPanel',
      'StickerAssistantPanel',
      'RefineEnginePanel',
    ];

    for (const panel of protectedPanels) {
      expect(boundaries.infiniteCanvas, `${panel} must remain reachable`).toContain(panel);
    }

    expect(boundaries.infiniteCanvas).toContain('<CanvasSurface');
    expect(boundaries.infiniteCanvas).toContain('<CanvasToolHost');
    expect(boundaries.workspace).toContain('VideoGenerationPanel');
    expect(boundaries.workspace).toContain('VectorDesignPanel');
  });

  it('cleans transient canvas listeners, requests, timers and animation frames', () => {
    expect(boundaries.infiniteCanvas).not.toContain("el.addEventListener('wheel', (e: WheelEvent)");
    expect(boundaries.infiniteCanvas).toContain("removeEventListener('wheel', editCanvasWheelHandler)");
    expect(boundaries.infiniteCanvas).toContain('annotationTaskAbortRef.current?.abort()');
    expect(boundaries.infiniteCanvas).toContain('touchGestureController.dispose()');
    expect(boundaries.infiniteCanvas).toContain('touchGestureControllerRef.current = null!');
    expect(boundaries.infiniteCanvas).toContain('cancelAnimationFrame(brushRafRef.current)');
    expect(boundaries.infiniteCanvas).toContain('cancelAnimationFrame(groupDragRafRef.current)');
    expect(boundaries.infiniteCanvas).toContain('cancelAnimationFrame(genGroupDragRafRef.current)');
    expect(boundaries.infiniteCanvas).toContain('cancelAnimationFrame(hexCubeDragRafRef.current)');
  });
});

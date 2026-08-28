import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const componentsDir = path.join(process.cwd(), 'src', 'components');
const canvasSource = fs.readFileSync(path.join(componentsDir, 'infinite-canvas.tsx'), 'utf8');
const workspaceSource = fs.readFileSync(path.join(componentsDir, 'canvas-workspace.tsx'), 'utf8');
const previewPath = path.join(componentsDir, 'canvas', 'MultiAngleSpherePreview.tsx');
const zoomClusterPath = path.join(componentsDir, 'canvas', 'CanvasZoomCluster.tsx');

describe('infinite canvas component boundaries', () => {
  it('loads the multi-angle preview from its own component module', () => {
    expect(canvasSource).toContain("dynamic(() => import('@/components/canvas/MultiAngleSpherePreview').then(m => ({ default: m.MultiAngleSpherePreview }))");
    expect(canvasSource).not.toContain('function MultiAngleSpherePreview');
    expect(fs.existsSync(previewPath)).toBe(true);
    expect(fs.readFileSync(previewPath, 'utf8')).toContain('export function MultiAngleSpherePreview');
  });

  it('delegates task polling side effects to CanvasWorkspace', () => {
    expect(workspaceSource).toContain('requestCanvasTaskPoll');
    expect(workspaceSource).toContain('onRequestTaskPoll={requestCanvasTaskPoll}');
    expect(canvasSource).toContain('onRequestTaskPoll');
    expect(canvasSource).not.toContain("fetch('/api/poll-task'");
  });

  it('delegates the bottom-toolbar auxiliary controls to a presentation-only leaf', () => {
    expect(fs.existsSync(zoomClusterPath)).toBe(true);
    const zoomClusterSource = fs.readFileSync(zoomClusterPath, 'utf8');

    expect(canvasSource).toContain("import { CanvasZoomCluster } from '@/components/canvas/CanvasZoomCluster';");
    expect(canvasSource).toContain('<CanvasZoomCluster');
    expect(canvasSource).not.toContain('Far-right: Auxiliary controls (always visible)');
    expect(zoomClusterSource).toContain('export function CanvasZoomCluster');
    expect(zoomClusterSource).toContain('onToggleLayerPanel');
    expect(zoomClusterSource).toContain('onToggleVersionHistory');
    expect(zoomClusterSource).not.toContain('activateCanvasToolSession');
    expect(zoomClusterSource).not.toContain('closeCanvasToolPanels');
  });

  it('opens the workspace image preview when a canvas image is double-clicked', () => {
    expect(canvasSource).toContain('onPreviewImage,');
    expect(canvasSource).toContain('resolveImageClickSequence(lastImageClickRef.current');
    expect(canvasSource).toContain('suppressSelectionClickRef.current = true;');
    expect(canvasSource).toContain('onPreviewImage(previewImage);');
    expect(canvasSource).not.toContain('if (e.detail >= 2)');
  });
});

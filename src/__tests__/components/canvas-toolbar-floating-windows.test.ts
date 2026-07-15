import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const canvasSource = readSource('src/components/infinite-canvas.tsx');
const appPageSource = readSource('src/app/page.tsx');
const humanRepairSource = readSource('src/components/human-repair-panel.tsx');
const layerPanelSource = readSource('src/components/layer-panel.tsx');
const versionHistorySource = readSource('src/components/version-history-panel.tsx');

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
    expect(canvasSource).toContain('<LayerPanel\n            floating');
    expect(canvasSource).toContain('<VersionHistoryPanel\n            floating');
  });

  it('keeps every bottom-toolbar action in a stable, horizontally reachable layout', () => {
    expect(canvasSource).toContain('max-w-[calc(100%-2rem)]');
    expect(canvasSource).toContain('overflow-x-auto');
    expect(canvasSource).toContain('flex items-center ml-1.5 shrink-0');
    expect(canvasSource).not.toContain("bottomBarHovered ? 'max-w-[900px] opacity-100 ml-1.5 overflow-visible' : 'max-w-0 opacity-0 ml-0 overflow-hidden'");
  });

  it('keeps the right panel collapse control inside a narrow viewport', () => {
    expect(appPageSource).toContain("panelCollapsed ? '20px' : 'min(480px, 100vw)'");
  });
});

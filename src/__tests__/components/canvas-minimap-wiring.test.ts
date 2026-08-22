import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(process.cwd(), 'src/components/canvas/CanvasMinimap.tsx');
const clusterPath = resolve(process.cwd(), 'src/components/canvas/CanvasZoomCluster.tsx');
const canvasPath = resolve(process.cwd(), 'src/components/infinite-canvas.tsx');

const getExportedInterfaceBody = (source: string, name: string): string => {
  const declaration = new RegExp(`export\\s+interface\\s+${name}\\s*\\{`).exec(source);
  expect(declaration).not.toBeNull();

  const openingBraceIndex = (declaration?.index ?? 0) + (declaration?.[0].length ?? 1) - 1;
  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }

  throw new Error(`Unclosed ${name} interface`);
};

const expectRequiredField = (body: string, name: string, type: string, optional = false): void => {
  const optionalMarker = optional ? '\\?' : '';
  const fieldStart = '(?:^|[;,{]|\\r?\\n)';
  const fieldEnd = '(?=[;,\\r\\n}]|$)';
  const fieldPattern = new RegExp(`${fieldStart}\\s*${name}${optionalMarker}\\s*:\\s*${type}\\s*${fieldEnd}`);

  expect(body).toMatch(fieldPattern);
  expect(body).not.toMatch(new RegExp(`${fieldStart}\\s*${name}\\??\\s*:\\s*any\\s*${fieldEnd}`));
};

const expectPublicInterfaceContract = (component: string): void => {
  const item = getExportedInterfaceBody(component, 'CanvasMinimapItem');
  expectRequiredField(item, 'id', 'string');
  expectRequiredField(item, 'x', 'number');
  expectRequiredField(item, 'y', 'number');
  expectRequiredField(item, 'width', 'number');
  expectRequiredField(item, 'height', 'number');

  const viewport = getExportedInterfaceBody(component, 'CanvasMinimapViewport');
  for (const field of ['width', 'height', 'zoom', 'offsetX', 'offsetY']) {
    expectRequiredField(viewport, field, 'number');
  }

  const bounds = getExportedInterfaceBody(component, 'CanvasMinimapBounds');
  for (const field of ['minX', 'minY', 'maxX', 'maxY']) {
    expectRequiredField(bounds, field, 'number');
  }

  const projection = getExportedInterfaceBody(component, 'CanvasMinimapProjection');
  for (const field of ['scale', 'offsetX', 'offsetY']) {
    expectRequiredField(projection, field, 'number');
  }

  const rect = getExportedInterfaceBody(component, 'CanvasMinimapRect');
  expectRequiredField(rect, 'id', 'string', true);
  for (const field of ['x', 'y', 'width', 'height']) {
    expectRequiredField(rect, field, 'number');
  }

  const scene = getExportedInterfaceBody(component, 'CanvasMinimapScene');
  expectRequiredField(scene, 'items', 'CanvasMinimapRect\\[\\]');
  expectRequiredField(scene, 'viewport', 'CanvasMinimapRect');
  expectRequiredField(scene, 'bounds', 'CanvasMinimapBounds');
  expectRequiredField(scene, 'projection', 'CanvasMinimapProjection');

  const props = getExportedInterfaceBody(component, 'CanvasMinimapProps');
  expectRequiredField(props, 'items', 'CanvasMinimapItem\\[\\]');
  expectRequiredField(props, 'viewport', 'CanvasMinimapViewport');
  expectRequiredField(props, 'theme', "'dark'\\s*\\|\\s*'mono'", true);
  expectRequiredField(props, 'rightOffset', 'number');
  expect(props).toMatch(/(?:^|[;,{]|\r?\n)\s*onNavigate\s*\(\s*point\s*:\s*\{\s*x\s*:\s*number\s*[;,\r\n]\s*y\s*:\s*number\s*(?:[;,\r\n])?\s*\}\s*\)\s*:\s*void\s*(?=[;,\r\n}]|$)/);
  expect(props).not.toMatch(/(?:^|[;,{]|\r?\n)\s*onNavigate\s*(?:\([^)]*\bany\b|:\s*any\s*(?=[;,\r\n}]|$))/);
  expect(props).toMatch(/(?:^|[;,{]|\r?\n)\s*onClose\s*\(\s*\)\s*:\s*void\s*(?=[;,\r\n}]|$)/);
  expect(props).not.toMatch(/(?:^|[;,{]|\r?\n)\s*onClose\s*(?:\([^)]*\bany\b|:\s*any\s*(?=[;,\r\n}]|$))/);
};

describe('V588-UI-003 canvas minimap wiring', () => {
  it('requires the fixed leaf API and parent-owned minimap visibility contract', () => {
    expect(existsSync(componentPath)).toBe(true);

    const component = readFileSync(componentPath, 'utf8');
    const cluster = readFileSync(clusterPath, 'utf8');
    const canvas = readFileSync(canvasPath, 'utf8');

    expect(component).toContain('export function CanvasMinimap');
    expect(component).toContain('export const CANVAS_MINIMAP_PREFERENCE_KEY');
    expect(component).toContain('export const CANVAS_MINIMAP_WIDTH');
    expect(component).toContain('export const CANVAS_MINIMAP_HEIGHT');
    expect(component).toContain('export const CANVAS_MINIMAP_PADDING');
    expect(component).toContain('export interface CanvasMinimapItem');
    expect(component).toContain('export interface CanvasMinimapViewport');
    expect(component).toContain('export interface CanvasMinimapBounds');
    expect(component).toContain('export interface CanvasMinimapProjection');
    expect(component).toContain('export interface CanvasMinimapRect');
    expect(component).toContain('export interface CanvasMinimapScene');
    expect(component).toContain('export interface CanvasMinimapProps');
    expectPublicInterfaceContract(component);
    expect(component).toContain('export function computeCanvasMinimapBounds');
    expect(component).toContain('export function computeCanvasMinimapProjection');
    expect(component).toContain('export function projectCanvasMinimapScene');
    expect(component).toContain('data-canvas-minimap');
    expect(cluster).toContain('minimapOpen: boolean;');
    expect(cluster).toContain('minimapAvailable: boolean;');
    expect(cluster).toContain('onToggleMinimap: () => void;');
    expect(cluster).toContain("title={minimapOpen ? '关闭小地图' : '打开小地图'}");
    expect(canvas).toContain("from '@/components/canvas/CanvasMinimap';");
    expect(canvas).toContain('const [minimapOpen, setMinimapOpen] = useState(false);');
    expect(canvas).toContain('const minimapAvailable = isCanvasMinimapAvailable(');
    expect(canvas).toMatch(/const minimapItems = useMemo(?:<CanvasMinimapItem\[\]>)?\(\(\) => \{\s*if \(!minimapOpen \|\| !minimapAvailable\) return \[\];/);
    expect(canvas).toMatch(/\.\.\.\s*\(\s*minimapAvailable\s*\?\s*\[\{\s*id:\s*['"]toggle-minimap['"]\s*,/);
    expect(canvas).toMatch(/\{minimapOpen && minimapAvailable && \(\s*<CanvasMinimap/);
    expect(canvas).toContain('onNavigate={handleMinimapNavigate}');
    expect(canvas).toContain('onClose={toggleCanvasMinimap}');
    expect(canvas).toContain('setViewOffset({');
  });
});

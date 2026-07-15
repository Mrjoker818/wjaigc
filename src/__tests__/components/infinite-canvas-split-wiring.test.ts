import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const componentsDir = path.join(process.cwd(), 'src', 'components');
const canvasSource = fs.readFileSync(path.join(componentsDir, 'infinite-canvas.tsx'), 'utf8');
const previewPath = path.join(componentsDir, 'canvas', 'MultiAngleSpherePreview.tsx');

describe('infinite canvas component boundaries', () => {
  it('loads the multi-angle preview from its own component module', () => {
    expect(canvasSource).toContain("dynamic(() => import('@/components/canvas/MultiAngleSpherePreview').then(m => ({ default: m.MultiAngleSpherePreview }))");
    expect(canvasSource).not.toContain('function MultiAngleSpherePreview');
    expect(fs.existsSync(previewPath)).toBe(true);
    expect(fs.readFileSync(previewPath, 'utf8')).toContain('export function MultiAngleSpherePreview');
  });
});

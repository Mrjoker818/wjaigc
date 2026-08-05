import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/image-edit/route.ts'), 'utf8');
const scriptSource = readFileSync(resolve(process.cwd(), 'scripts/rembg_remove_background.py'), 'utf8');
const canvasSource = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');
const healthSource = readFileSync(resolve(process.cwd(), 'src/app/api/image/health/route.ts'), 'utf8');

describe('CPU rembg remove-background wiring', () => {
  it('uses the standalone rembg mask generator instead of IOPaint for remove-background', () => {
    expect(routeSource).toContain("from '@/lib/image-tools/rembg-client'");
    expect(routeSource).toContain('generateRembgMask');
    expect(routeSource).not.toContain('generateRemoveBgMask');
    expect(routeSource).not.toContain('local IOPaint RemoveBG');
  });

  it('uses the JSON stdin/stdout protocol required by the Node child process', () => {
    expect(scriptSource).toContain('json.load(sys.stdin)');
    expect(scriptSource).toContain("new_session(model_name)");
    expect(scriptSource).toContain("'rgbaBase64'");
    expect(scriptSource).toContain("'maskBase64'");
    expect(scriptSource).toContain("'birefnet-general-lite'");
    expect(scriptSource).toContain('OMP_NUM_THREADS');
  });

  it('offers the lite default and full CPU BiRefNet choices in the image toolbar', () => {
    expect(canvasSource).toContain("useState<string>('birefnet-general-lite')");
    expect(canvasSource).toContain("id: 'birefnet-general-lite'");
    expect(canvasSource).toContain("id: 'birefnet-general'");
    expect(canvasSource).toContain("id: 'birefnet-portrait'");
    expect(canvasSource).not.toContain("id: 'u2net'");
  });

  it('reports local erase engines that do not require a downloadable model file', () => {
    expect(healthSource).toContain('if (!primaryFile)');
  });
});

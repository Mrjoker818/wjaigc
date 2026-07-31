import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/image-edit/route.ts'), 'utf8');
const canvasSource = readFileSync(resolve(process.cwd(), 'src/components/infinite-canvas.tsx'), 'utf8');
const registrySource = readFileSync(resolve(process.cwd(), 'src/lib/task-registry.ts'), 'utf8');

describe('display-decompose feature wiring', () => {
  it('registers and persists asynchronous display-decompose tasks', () => {
    expect(registrySource).toContain("'display-decompose'");
    expect(routeSource).toContain("action === 'display_decompose'");
    expect(routeSource).toContain("registerTask(result.taskId, 'display-decompose', '元素拆解', sessionUser?.id)");
    expect(routeSource).toContain("type: 'display-decompose'");
    expect(routeSource).toContain("engine: 'ai-display-decompose'");
  });

  it('hashes the safely resolved source and keeps internal metadata out of the provider payload', () => {
    expect(routeSource).toContain("resolveLayerSourceImage(imageUrl)");
    expect(routeSource).toContain("createHash('sha256').update(decomposeSource.buffer).digest('hex')");
    expect(routeSource).toContain("const displayBackground = body.displayBackground === 'transparent' ? 'transparent' : 'light-gray'");
    expect(routeSource).toContain('sourceHash: decomposeSourceHash');
    expect(routeSource).toContain('background: displayBackground');
    expect(routeSource).toContain('const { source_hash: _internalSourceHash, ...providerRequest } = requestBody');
    expect(routeSource).toContain('sourceHash: decomposeSourceHash');
  });

  it('exposes the image toolbar and image context-menu entry', () => {
    expect(canvasSource).toContain("label: '元素拆解'");
    expect(canvasSource).toContain("action: 'display_decompose'");
    expect(canvasSource).toContain('handleDisplayDecomposeConfirm');
    expect(canvasSource).toContain('DISPLAY_DECOMPOSE_SUPPORTED_RATIOS');
  });
});

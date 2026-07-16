import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const canvasSource = readSource('src/components/infinite-canvas.tsx');
const imageEditSource = readSource('src/app/api/image-edit/route.ts');
const agentEditSource = readSource('src/app/api/agent-edit/route.ts');
const imageTo3DSource = readSource('src/app/api/image-to-3d/route.ts');
const refinePanelSource = readSource('src/components/refine-engine-panel.tsx');

describe('image tool request integrity', () => {
  it('keeps outpaint geometry rules when the user supplies an expansion instruction', () => {
    expect(canvasSource).toContain('prompt: editPrompt.trim(),');
    expect(imageEditSource).toContain("const userExpansionIntent = typeof prompt === 'string'");
    expect(imageEditSource).toContain('OUTPAINT INVARIANTS');
    expect(imageEditSource).not.toContain('const outpaintPrompt = prompt || (');
  });

  it('does not let caller supplied multi-angle text bypass camera constraints', () => {
    expect(imageEditSource).toContain("const callerViewIntent = typeof prompt === 'string'");
    expect(imageEditSource).toContain('USER VIEW INTENT');
    expect(imageEditSource).not.toContain('const multiAnglePrompt = prompt || (');
  });

  it('forwards the selected image provider to Agent background removal', () => {
    expect(agentEditSource).toContain("action: 'removebg', model: imageModel, providerId: imageProviderId");
    expect(agentEditSource).toContain("engine: imageModel ? 'ai' : 'auto'");
  });

  it('uses requested face limits for Tripo and does not expose unsupported 302 Tripo controls', () => {
    expect(imageTo3DSource).toContain('function resolveTripoFaceLimit(request: ImageTo3DRequest): number');
    expect(imageTo3DSource).toContain('face_limit: resolveTripoFaceLimit(request)');
    expect(canvasSource).toContain('is302TripoProvider');
    expect(canvasSource).toContain('supportsThreeDFaceCount');
    expect(canvasSource).toContain('supportsThreeDPose');
  });

  it('preserves a selected low-angle sign while the refine angle pad is dragged', () => {
    expect(refinePanelSource).toContain('const elevationSign = customElevation < 0 ? -1 : 1;');
    expect(refinePanelSource).toContain('setCustomElevation(Math.round(el) * elevationSign);');
  });

  it('normalizes the legacy extend action to the implemented outpaint handler', () => {
    expect(imageEditSource).toContain("const action = rawAction === 'extend' ? 'outpaint' : rawAction;");
  });
});

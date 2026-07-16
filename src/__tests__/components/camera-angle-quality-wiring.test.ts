import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const refinePanelSource = readSource('src/components/refine-engine-panel.tsx');
const refineRouteSource = readSource('src/app/api/refine-engine/route.ts');
const canvasSource = readSource('src/components/infinite-canvas.tsx');
const imageEditRouteSource = readSource('src/app/api/image-edit/route.ts');
const spherePreviewSource = readSource('src/components/canvas/MultiAngleSpherePreview.tsx');

describe('camera angle quality wiring', () => {
  it('uses a zero-centered -90 to 90 degree elevation control in the refine engine', () => {
    expect(refinePanelSource).toContain('const [customElevation, setCustomElevation] = useState(0);');
    expect(refinePanelSource).toContain('type="range" min={-90} max={90} step={5}');
    expect(refinePanelSource).toContain('(customElevation + 90) / 180 * 100');
    expect(refineRouteSource).toContain('camera is BELOW the product looking UP');
    expect(refineRouteSource).toContain('camera is ABOVE the product looking DOWN');
  });

  it('aligns multi-angle elevation semantics and the full vertical range with the refine engine', () => {
    expect(canvasSource).toContain('clampMultiAngleValue(drag.startTilt - dy * 0.55, -90, 90)');
    expect(canvasSource).toContain("min: -90, max: 90, step: 1, onChange: setMultiAngleTilt");
    expect(canvasSource).toContain("multiAngleTilt > 0 ? `俯视${Math.abs(multiAngleTilt)}°` : `仰视${Math.abs(multiAngleTilt)}°`");
    expect(spherePreviewSource).toContain('(tilt / 90)');
  });

  it('locks the physical camera height and preserves reference fidelity for large angle changes', () => {
    expect(imageEditRouteSource).toContain('CAMERA HEIGHT LOCK:');
    expect(imageEditRouteSource).toContain('camera is ABOVE the subject looking DOWN');
    expect(imageEditRouteSource).toContain('camera is BELOW the subject looking UP');
    expect(imageEditRouteSource).toContain('// Large angles: medium fidelity preserves scene identity while allowing a real viewpoint change');
  });

  it('uses the originating image prompt as scene context without replacing camera constraints', () => {
    expect(imageEditRouteSource).toContain("const originalSceneContext = typeof body.originalPrompt === 'string'");
    expect(imageEditRouteSource).toContain('SOURCE SCENE CONTEXT');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const canvasSource = readSource('src/components/infinite-canvas.tsx');
const thirdPartyDialogSource = readSource('src/components/third-party-model-dialog.tsx');

describe('modal keyboard dismissal wiring', () => {
  it('closes the image-to-3D factory with Escape when no conversion is running', () => {
    expect(canvasSource).toContain('const close3DModal = useCallback(() => {');
    expect(canvasSource).toContain("if (event.key === 'Escape' && show3DModal && !threeDProgress)");
    expect(canvasSource).toContain("window.addEventListener('keydown', handle3DModalKeyDown);");
    expect(canvasSource).toContain('close3DModal();');
  });

  it('closes the third-party model dialog with Escape', () => {
    expect(thirdPartyDialogSource).toContain("if (event.key === 'Escape') {");
    expect(thirdPartyDialogSource).toContain("window.addEventListener('keydown', handleEscapeKey);");
    expect(thirdPartyDialogSource).toContain('return () => window.removeEventListener(\'keydown\', handleEscapeKey);');
  });
});

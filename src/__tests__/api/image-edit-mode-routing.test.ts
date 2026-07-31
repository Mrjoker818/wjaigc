import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/image-edit/route.ts'),
  'utf8',
);

const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/infinite-canvas.tsx'),
  'utf8',
);

describe('image edit mode routing', () => {
  it('routes erase and mask from explicit editMode rather than prompt contents', () => {
    expect(routeSource).toContain("const isErase = editMode === 'erase';");
    expect(routeSource).not.toContain('const isErase = !prompt || !prompt.trim();');
  });

  it('rejects an inpaint request without a supported explicit editMode', () => {
    expect(routeSource).toContain(
      "if (editMode !== 'erase' && editMode !== 'mask')",
    );
  });

  it('sends the current canvas mode in every inpaint request', () => {
    expect(canvasSource).toContain(
      "editMode: currentEditMode as 'erase' | 'mask'",
    );
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/display3d-panel.tsx'), 'utf8');

describe('Display3D request wiring', () => {
  it('persists uploaded files instead of passing browser blob URLs to the API route', () => {
    expect(source).not.toContain('URL.createObjectURL(file)');
    expect(source).toContain("fetch('/api/upload'");
  });

  it('does not let malformed saved model preferences block automatic model selection', () => {
    expect(source).toMatch(/try\s*\{[\s\S]*const parsed = JSON\.parse\(saved\)/);
    expect(source).toMatch(/catch\s*\{\s*\}/);
  });

  it('polls generated renders with the selected image model rather than the chat model', () => {
    const generateHandler = source.slice(
      source.indexOf('const handleGenerate'),
      source.indexOf('// === Decompose handler ==='),
    );

    expect(generateHandler).toContain('body: JSON.stringify({ taskId, model: selectedModel, providerId: selectedProviderId })');
  });
});

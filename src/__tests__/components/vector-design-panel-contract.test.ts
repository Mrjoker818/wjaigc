import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelFile = resolve(
  process.cwd(),
  'src/components/vector-design/vector-design-panel.tsx',
);

describe('AI vector design panel contract', () => {
  const source = readFileSync(panelFile, 'utf8');

  it('offers distinct generate, reference-create, vectorize and explore modes', () => {
    expect(source).toContain("'generate'");
    expect(source).toContain("'image-to-image'");
    expect(source).toContain("'vectorize'");
    expect(source).toContain("'explore'");
    expect(source).toContain('supportsImageToImage');
    expect(source).toContain('supportsExplore');
  });

  it('uses normalized grouped presets rather than a contradictory flat multi-select', () => {
    expect(source).toContain('normalizeVectorSelection');
    expect(source).toContain('quickIds');
    expect(source).toContain('categoryId');
    expect(source).toContain('designId');
    expect(source).toContain('styleId');
  });

  it('submits one native batch request and reads all returned assets', () => {
    expect(source).toContain('n: count');
    expect(source).toContain('data.assets');
    expect(source).not.toContain('Array.from({ length: count }');
    expect(source).not.toContain('Promise.all(requests)');
  });

  it('exposes official ratios and capability-gated Recraft controls', () => {
    expect(source).toContain('VECTOR_ASPECT_RATIOS');
    expect(source).toContain('supportsStyles');
    expect(source).toContain('supportsNegativePrompt');
    expect(source).toContain('artisticLevel');
    expect(source).toContain('backgroundColor');
    expect(source).toContain('randomSeed');
    expect(source).toContain("'enhance-prompt'");
    expect(source).toContain('10 * 1024 * 1024');
    expect(source).toContain("'explore-similar'");
    expect(source).toContain("'create-style'");
    expect(source).toContain('sourceImageId');
  });

  it('protects billable actions with request idempotency and preserves Explore result ownership', () => {
    const editorSource = readFileSync(
      resolve(process.cwd(), 'src/components/vector-design/vector-editor-dialog.tsx'),
      'utf8',
    );
    expect(source.match(/'Idempotency-Key': crypto\.randomUUID\(\)/g)).toHaveLength(4);
    expect(editorSource).toContain("'Idempotency-Key': crypto.randomUUID()");
    expect(source).toContain('providerId: asset.providerId');
    expect(source).toContain('model: asset.model');
    expect(source).toMatch(/useEffect\(\(\) => \{\s*setCustomStyleId\(''\);\s*setResults\(\[\]\);/);
  });
});

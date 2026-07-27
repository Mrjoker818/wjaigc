import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeFile = resolve(process.cwd(), 'src/app/api/vector-design/route.ts');

describe('vector design API contract', () => {
  const source = readFileSync(routeFile, 'utf8');

  it('requires authentication and exact provider/model authorization', () => {
    expect(source).toContain('requireApiAuthOrReject(request)');
    expect(source).toContain('findProviderById(providerId)');
    expect(source).toContain('provider.selectedModels');
    expect(source).toContain("selectedModels.includes(model)");
  });

  it('uses dedicated Recraft vector endpoints and never returns a raster SVG wrapper', () => {
    expect(source).toContain("'/images/generations/vector'");
    expect(source).toContain("'/images/vectorize'");
    expect(source).not.toContain('raster-svg-wrapper');
  });
});

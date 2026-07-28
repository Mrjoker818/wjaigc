import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeFile = resolve(process.cwd(), 'src/app/api/vector-design/route.ts');
const previewFile = resolve(process.cwd(), 'src/lib/vector-svg-preview.ts');
const modelsRouteFile = resolve(process.cwd(), 'src/app/api/models/route.ts');

describe('vector design API contract', () => {
  const source = readFileSync(routeFile, 'utf8');
  const previewSource = readFileSync(previewFile, 'utf8');
  const modelsSource = readFileSync(modelsRouteFile, 'utf8');

  it('requires authentication and exact provider/model authorization', () => {
    expect(source).toContain('requireApiAuthOrReject(request)');
    expect(source).toContain('findProviderById(providerId)');
    expect(source).toContain('provider.selectedModels');
    expect(source).toContain("selectedModels.includes(model)");
    expect(source).toContain('sessionUser.apiPermissions?.vectorize === false');
    expect(source).toContain('isModelAssignedToUser(');
  });

  it('uses dedicated Recraft vector endpoints and never returns a raster SVG wrapper', () => {
    expect(source).toContain("'/images/generations/vector'");
    expect(source).toContain("'/images/vectorize'");
    expect(source).toContain("'/images/imageToImage'");
    expect(source).toContain("'/images/explore'");
    expect(source).toContain("'/images/explore/similar'");
    expect(source).toContain("'/styles'");
    expect(source).toContain("'/prompts/enhance'");
    expect(source).not.toContain('raster-svg-wrapper');
  });

  it('uses one native batch request, persists every SVG and keeps first-asset compatibility', () => {
    expect(source).toContain('buildRecraftGenerationPayload');
    expect(source).toContain('extractRecraftVectorSources');
    expect(source).toContain('const assets =');
    expect(source).toContain('assets,');
    expect(source).toContain('asset: assets[0]');
    expect(source).not.toContain('n: 1');
    expect(source).toMatch(/action === 'explore'\s*\|\|\s*action === 'explore-similar'/);
    expect(source).toContain('validateRecraftVectorSourceCount');
    expect(source).toContain('persistSvgBatch');
  });

  it('downloads remote SVG results through the SSRF-protected downloader', () => {
    expect(source).toContain('downloadPublicImage(source.url');
    expect(source).toContain("'image/svg+xml'");
    expect(source).not.toContain('const response = await fetch(url');
  });

  it('limits provider responses, retries only unsupported paths and renders 4MP previews safely', () => {
    expect(source).toContain('MAX_PROVIDER_RESPONSE_BYTES');
    expect(source).toMatch(/\[404,\s*405\]\.includes\(providerResponse\.status\)/);
    expect(previewSource).toContain("density: 96");
    expect(previewSource).toContain('limitInputPixels: 20_000_000');
    expect(source).toContain('MAX_REQUEST_BODY_BYTES');
    expect(source).toContain("'image/svg+xml'");
    expect(source).toContain('10 * 1024 * 1024');
    expect(source).toContain('5 * 1024 * 1024');
    expect(source).toContain("'Idempotency-Key'");
  });

  it('filters vector models through the normal user image-model allowlist', () => {
    expect(modelsSource).toContain("type === 'vectorize'");
    expect(modelsSource).toContain(
      'isModelAssignedToUser(user.imageModels, model.providerId, model.id)',
    );
  });
});

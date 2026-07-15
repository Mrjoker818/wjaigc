import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/image-edit/route.ts'), 'utf8');
const providerSource = readFileSync(resolve(process.cwd(), 'src/lib/server-api-config.ts'), 'utf8');

describe('302.AI upscale wiring', () => {
  it('uses only the two documented native endpoints', () => {
    expect(routeSource).toContain("'/302/submit/super-upscale-v2'");
    expect(routeSource).toContain("'/302/submit/upscale-v6'");
    expect(routeSource).not.toContain('upscale-v5');
  });

  it('requires both an exact 302 model id and a 302.AI base URL for native routing', () => {
    expect(routeSource).toContain('resolve302UpscaleModelId(c.model)');
    expect(routeSource).toContain('is302AiUpscaleBaseUrl(c.apiBaseUrl)');
    expect(routeSource).not.toContain('is302aiUpscaleModel(c.model) || is302aiBaseUrl(c.apiBaseUrl)');
  });

  it('returns the two known models during 302 upscaler discovery', () => {
    expect(providerSource).toContain('get302UpscaleModelsForProvider');
    expect(providerSource).not.toContain("mid.includes('upscale-v5')");
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/image-edit/route.ts'), 'utf8');

describe('configured upscale provider routing', () => {
  it('treats any configured upscaler selection as an explicit AI-only choice', () => {
    expect(routeSource).toContain("const requestedUpscaleModel = body.upscaleModel?.trim() || null");
    expect(routeSource).toContain('Boolean(requestedUpscaleModel)');
  });

  it('routes the verified Pear Real-ESRGAN model instead of filtering every Pear provider out', () => {
    expect(routeSource).toContain("isPearRealEsrganUpscaleCandidate");
    expect(routeSource).toContain("candidate.model === 'Real-ESRGAN'");
    expect(routeSource).not.toContain("skipping ${c.model} from PearAPI (does not support /images/edits endpoint)");
  });

  it('rejects unsupported Pear SeedVR2 requests before a charge or provider request', () => {
    expect(routeSource).toContain("SeedVR2-Upscaler 尚未完成当前 Pear 接口协议验证");
  });
});

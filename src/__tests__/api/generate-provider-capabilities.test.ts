import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

describe('generate provider capability wiring', () => {
  it('derives server-side parameter and ratio validation from the exact task model descriptor', () => {
    expect(source).toContain('modelParamTypeFromDescriptor');
    expect(source).toContain('supportedSizes: descriptor?.allowedRatios || []');
    expect(source).toContain('resolveTaskModelForUser');
    expect(source).toContain('buildDescriptorImageRequestFields');
    expect(source).toContain('applyDescriptorApprovedImageFields');
    expect(source).not.toContain('getProviderAspectRatios');
    expect(source).not.toContain('getModelParamType');
  });

  it('passes the model-filtered request through the provider compatibility layer', () => {
    expect(source).toContain('adjustRequestForProfile(filteredBody, profile');
  });
});

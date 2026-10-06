import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = ['src/app/api/generate/route.ts', 'src/lib/task-core/ordinary-generation-request.ts',
  'src/lib/task-core/ordinary-generation-provider.ts'].map(path => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

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

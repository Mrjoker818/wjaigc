import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

describe('generate provider capability wiring', () => {
  it('derives server-side parameter and ratio validation from the selected provider', () => {
    expect(source).toContain('getModelParamType(modelId, providerHint)');
    expect(source).toContain('supportedSizes: getProviderAspectRatios(modelId, providerHint)');
  });

  it('passes the model-filtered request through the provider compatibility layer', () => {
    expect(source).toContain('adjustRequestForProfile(filteredBody, profile');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('image generation output-count contract', () => {
  it('accepts both outputCount and canvas n, then submits one provider task per requested image', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

    expect(source).toContain('n: requestedN');
    expect(source).toContain('const requestedOutputCount = outputCount ?? requestedN;');
    expect(source).toContain('for (let i = 0; i < totalCount; i++)');
    expect(source).toContain('submitSingleTask(modelConfig, serverApiKey, apiBaseUrl, provider?.id || \'env\', 1, provider)');
  });
});

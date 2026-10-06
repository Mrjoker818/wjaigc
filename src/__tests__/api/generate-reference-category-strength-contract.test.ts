import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = ['src/app/api/generate/route.ts', 'src/lib/task-core/ordinary-generation-provider.ts']
  .map(path => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

describe('generate reference category strength contract', () => {
  it('accepts per-image per-category strengths before falling back to the legacy image-wide strengths', () => {
    expect(source).toContain('referenceCategoryStrengths');
    expect(source).toContain('categoryStrengthsByImage');
    expect(source).toContain('perCategoryStrength');
  });

  it('adds the required reference image payload before capability filtering creates the submitted body', () => {
    const firstReferenceImage = source.indexOf('requestBody.image = firstRefBase64');
    const filteredBody = source.indexOf(
      'filterRequestForModel(currentModelConfig.modelId, requestBody),',
    );
    const profileAdjustment = source.indexOf(
      'adjustRequestForProfile(filteredBody, profile',
    );

    expect(firstReferenceImage).toBeGreaterThan(-1);
    expect(filteredBody).toBeGreaterThan(firstReferenceImage);
    expect(profileAdjustment).toBeGreaterThan(filteredBody);
  });
});

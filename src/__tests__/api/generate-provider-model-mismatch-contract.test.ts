import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/generate/route.ts'),
  'utf8',
);

describe('image generation provider-model mismatch contract', () => {
  it('rejects an explicit provider/model mismatch before durable task creation or credit charging', () => {
    const userResolution = source.indexOf('const userId = sessionUser?.id');
    const firstBatchPersistence = source.indexOf('const generationBatch = createDurableGenerationBatch');
    const mismatchGate = source.indexOf("code: 'MODEL_PROVIDER_MISMATCH'", userResolution);
    const earlyRequestBlock = source.slice(userResolution, firstBatchPersistence);

    expect(userResolution).toBeGreaterThan(-1);
    expect(firstBatchPersistence).toBeGreaterThan(userResolution);
    expect(mismatchGate).toBeGreaterThan(userResolution);
    expect(mismatchGate).toBeLessThan(firstBatchPersistence);
    expect(earlyRequestBlock).toContain('findProviderById(effectiveProviderId)');
    expect(earlyRequestBlock).toContain('requestedProvider.selectedModels');
    expect(earlyRequestBlock).toContain(
      'normalizeModelForApi(rawModelId, { providerModels: requestedProviderModels })',
    );
  });
});

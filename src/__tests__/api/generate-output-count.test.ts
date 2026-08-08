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

  it('returns one durable submitOnly child task for each requested output slot', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/generate/route.ts'), 'utf8');

    expect(source).toContain('const generationBatch = createDurableGenerationBatch');
    expect(source).toContain('createTaskId: (slotIndex)');
    expect(source).toContain('for (const slot of generationBatch.slots)');
    expect(source).toContain('const asyncTaskId = slot.taskId');
    expect(source).toContain('slotId: slot.slotId');
    expect(source).toContain('slotIndex: slot.slotIndex');
    expect(source).toContain('slots: submittedSlots');
  });
});

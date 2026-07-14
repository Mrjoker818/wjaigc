import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(resolve(process.cwd(), 'src/components/ai-psd/ai-psd-panel.tsx'), 'utf8');
const route = readFileSync(resolve(process.cwd(), 'src/app/api/ai-psd/create/route.ts'), 'utf8');
const worker = readFileSync(resolve(process.cwd(), 'src/lib/ai-psd/task-worker.ts'), 'utf8');

describe('AI PSD provider routing', () => {
  it('persists the chosen image and chat provider through the asynchronous task worker', () => {
    expect(panel).toContain('imageProviderId: imageModels.find');
    expect(panel).toContain('llmProviderId: llmModels.find');
    expect(route).toContain('imageProviderId');
    expect(route).toContain('llmProviderId');
    expect(route).toContain('imageProviderId: imageProviderId || undefined');
    expect(route).toContain('llmProviderId: llmProviderId || undefined');
    expect(worker).toContain('t.llmProviderId');
    expect(worker).toContain('t.imageProviderId');
  });
});

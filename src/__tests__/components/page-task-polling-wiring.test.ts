import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');

describe('image generation polling wiring', () => {
  it('uses the guarded wait helper before both image-generation poll loops', () => {
    expect(pageSource).toContain("import { waitForTaskPollInterval } from '@/lib/task-polling-wait';");
    expect((pageSource.match(/await waitForTaskPollInterval\(/g) || [])).toHaveLength(2);
  });
});

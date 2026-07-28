import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');

describe('image generation polling wiring', () => {
  it('uses the guarded wait helper before both image-generation poll loops', () => {
    expect(workspaceSource).toContain("import { waitForTaskPollInterval } from '@/lib/task-polling-wait';");
    expect((workspaceSource.match(/await waitForTaskPollInterval\(/g) || [])).toHaveLength(2);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('page task placeholder persistence contract', () => {
  it('stores submitOnly task IDs before starting the browser polling loop', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
    const persistIndex = source.indexOf('applyTaskIdsToProcessingPlaceholders(previous, placeholderIds, taskIds)');
    const pollLoopIndex = source.indexOf('for (let taskIdx = 0; taskIdx < taskIds.length; taskIdx++)');

    expect(persistIndex).toBeGreaterThan(-1);
    expect(pollLoopIndex).toBeGreaterThan(persistIndex);
    expect(source).toContain('projectId: currentProject?.id');
    expect(source).toContain('includeLegacyUnassigned=1');
  });
});

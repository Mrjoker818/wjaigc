import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('quick create project scope contract', () => {
  it('cancels and clears compiler state before loading another project', () => {
    const loadStart = source.indexOf('const loadProjectById = useCallback');
    const loadEnd = source.indexOf('const [appMode', loadStart);
    const loadProject = source.slice(loadStart, loadEnd);

    expect(loadProject).toContain('quickCreateCompileControllerRef.current?.abort();');
    expect(loadProject).toContain('setQuickCreateCompileState(EMPTY_QUICK_CREATE_COMPILE_STATE);');
  });
});

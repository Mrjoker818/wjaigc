import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('CanvasWorkspace session revalidation', () => {
  it('keeps the authenticated workspace mounted when a redundant session probe is indeterminate', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/canvas-workspace.tsx'), 'utf8');
    const authInitializer = source.indexOf('const initCurrentUser = async () => {');
    const authEffectEnd = source.indexOf('const [currentUser, setCurrentUser]', authInitializer);
    const authEffect = source.slice(authInitializer, authEffectEnd);

    expect(authEffect).toContain('resolveSessionUser(initialUser, data)');
    expect(authEffect).toContain("sessionResolution.status === 'indeterminate'");
    expect(authEffect).not.toContain('setCurrentUser(null)');
  });
});

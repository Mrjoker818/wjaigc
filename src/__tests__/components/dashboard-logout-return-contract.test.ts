import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const homeSource = readFileSync(resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
const canvasSource = readFileSync(
  resolve(process.cwd(), 'src/components/canvas-workspace.tsx'),
  'utf8',
);

describe('dashboard logout return contract', () => {
  it('hands logout back to the root auth owner instead of switching to canvas', () => {
    expect(homeSource).toContain('const handleWorkspaceLogout = useCallback');
    expect(homeSource).toContain("window.history.replaceState(null, '', '/')");
    expect(homeSource).toContain('onLoggedOut={handleWorkspaceLogout}');

    expect(canvasSource).toContain('onLoggedOut: () => void');
    const logoutStart = canvasSource.indexOf('await userMgr.logout();');
    const logoutEnd = canvasSource.indexOf('/>', logoutStart);
    const logoutFlow = canvasSource.slice(logoutStart, logoutEnd);
    expect(logoutFlow).toContain('onLoggedOut();');
    expect(logoutFlow).not.toContain("setAppMode('canvas')");
  });
});

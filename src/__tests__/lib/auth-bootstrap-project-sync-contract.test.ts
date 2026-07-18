import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('authentication bootstrap project sync', () => {
  it('bounds project sync requests so authentication cannot wait indefinitely', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/user-manager.ts'), 'utf8');

    expect(source).toContain('const PROJECT_SYNC_TIMEOUT_MS = 8_000;');
    expect(source).toContain('async loadProjectsFromServer(');
    expect(source).toContain('signal: AbortSignal.timeout(PROJECT_SYNC_TIMEOUT_MS)');
  });

  it('does not perform a second blocking project sync during the same authentication bootstrap', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const hydratedUser = source.indexOf('const hydratedUser = await userMgr.upsertUserFromServer(data.user);');
    const projectId = source.indexOf('const projectId = searchParams.get(\'projectId\');', hydratedUser);

    expect(hydratedUser).toBeGreaterThan(-1);
    expect(projectId).toBeGreaterThan(hydratedUser);
    expect(source.slice(hydratedUser, projectId)).not.toContain('await userMgr.loadProjectsFromServer()');
  });

  it('starts project sync in the background after the local user session is ready', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/user-manager.ts'), 'utf8');
    const start = source.indexOf('async upsertUserFromServer(');
    const end = source.indexOf('  private getCurrentUserData()', start);
    const method = source.slice(start, end);

    expect(method).toContain('void this.loadProjectsFromServer(1, syncUserId).then(');
    expect(method).not.toContain('await this.loadProjectsFromServer()');
  });
});

import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('authentication bootstrap project sync', () => {
  it('uses a neutral session endpoint so browser client filters cannot block authentication bootstrap', () => {
    const pageSource = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const taskEventsSource = readFileSync(path.resolve(process.cwd(), 'src/lib/task-events-client.ts'), 'utf8');
    const simpleChatSource = readFileSync(path.resolve(process.cwd(), 'src/app/simple-chat/page.tsx'), 'utf8');
    const sessionRouteSource = readFileSync(path.resolve(process.cwd(), 'src/app/api/session/route.ts'), 'utf8');

    expect(pageSource).toContain('fetchSessionPayload()');
    expect(taskEventsSource).toContain('fetchSessionPayload(fetch, undefined');
    expect(simpleChatSource).toContain('fetchSessionPayload()');
    expect(sessionRouteSource).toContain("export { GET } from '@/app/api/auth/me/route';");
    expect(sessionRouteSource).toContain("export const dynamic = 'force-dynamic';");
  });

  it('bounds the authenticated-session probe so a hung response cannot keep the UI blocked', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');

    expect(source).toContain('fetchSessionPayload()');
    const authSessionSource = readFileSync(path.resolve(process.cwd(), 'src/lib/auth-session.ts'), 'utf8');
    expect(authSessionSource).toContain('const AUTH_SESSION_TIMEOUT_MS = 8_000;');
    expect(authSessionSource).toContain('Promise.race([requestPromise, timeoutPromise])');
  });

  it('bounds project sync requests so authentication cannot wait indefinitely', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/user-manager.ts'), 'utf8');

    expect(source).toContain('const PROJECT_SYNC_TIMEOUT_MS = 8_000;');
    expect(source).toContain('async loadProjectsFromServer(');
    expect(source).toContain('signal: AbortSignal.timeout(PROJECT_SYNC_TIMEOUT_MS)');
  });

  it('makes a no-project authenticated session interactive before client cache hydration', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const projectId = source.indexOf('const projectId = searchParams.get(\'projectId\');');
    const noProjectBranch = source.indexOf('if (!projectId) {', projectId);
    const setSessionUser = source.indexOf('setCurrentUser(data.user);', noProjectBranch);
    const setChecked = source.indexOf('setAuthChecked(true);', setSessionUser);
    const backgroundHydration = source.indexOf('void userMgr.upsertUserFromServer(data.user)', setChecked);

    expect(projectId).toBeGreaterThan(-1);
    expect(noProjectBranch).toBeGreaterThan(projectId);
    expect(setSessionUser).toBeGreaterThan(noProjectBranch);
    expect(setChecked).toBeGreaterThan(setSessionUser);
    expect(backgroundHydration).toBeGreaterThan(setChecked);
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

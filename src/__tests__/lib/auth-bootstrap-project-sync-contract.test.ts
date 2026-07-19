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

  it('does not restart authentication bootstrap when the search parameter object identity changes', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const authInitializer = source.indexOf('const initCurrentUser = async () => {');
    const authEffectEnd = source.indexOf('const [currentUser, setCurrentUser]', authInitializer);
    const authEffect = source.slice(authInitializer, authEffectEnd);

    expect(source).toContain("const initialProjectIdRef = useRef(searchParams.get('projectId'));");
    expect(authEffect).toContain('const projectId = initialProjectIdRef.current;');
    expect(authEffect).toContain('}, [setImages]);');
    expect(authEffect).not.toContain('}, [searchParams, setImages]);');
  });

  it('makes a no-project authenticated session interactive before client cache hydration', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const authInitializer = source.indexOf('const initCurrentUser = async () => {');
    const projectId = source.indexOf('const projectId = initialProjectIdRef.current;');
    const noProjectBranch = source.indexOf('if (!projectId) {', projectId);
    const setSessionUser = source.indexOf('setCurrentUser(sessionUser);', noProjectBranch);
    const setChecked = source.indexOf('setAuthChecked(true);', setSessionUser);
    const noProjectReturn = source.indexOf('return;', setChecked);
    const managerInitialization = source.indexOf('const userMgr = UserManagerCore.getInstance();', authInitializer);
    const postAuthHydration = source.indexOf('Hydrate the local project cache only after the authenticated workspace has rendered.');
    const postAuthManagerHydration = source.indexOf('UserManagerCore.getInstance().upsertUserFromServer(currentUser)', postAuthHydration);

    expect(projectId).toBeGreaterThan(-1);
    expect(noProjectBranch).toBeGreaterThan(projectId);
    expect(setSessionUser).toBeGreaterThan(noProjectBranch);
    expect(setChecked).toBeGreaterThan(setSessionUser);
    expect(noProjectReturn).toBeGreaterThan(setChecked);
    expect(managerInitialization).toBeGreaterThan(noProjectReturn);
    expect(postAuthHydration).toBeGreaterThan(managerInitialization);
    expect(postAuthManagerHydration).toBeGreaterThan(postAuthHydration);
  });

  it('does not synchronously construct the local cache manager when session bootstrap fails', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const authInitializer = source.indexOf('const initCurrentUser = async () => {');
    const failureMarker = source.indexOf('shouldClearLocalSessionRef.current = true;', authInitializer);
    const failureAuthChecked = source.indexOf('setAuthChecked(true);', failureMarker);
    const localCacheClear = source.indexOf('Clear the local auth cache only after the unauthenticated UI has rendered.');
    const deferredLogout = source.indexOf('then(() => UserManagerCore.getInstance().logout())', localCacheClear);

    expect(failureMarker).toBeGreaterThan(authInitializer);
    expect(failureAuthChecked).toBeGreaterThan(failureMarker);
    expect(localCacheClear).toBeGreaterThan(failureAuthChecked);
    expect(deferredLogout).toBeGreaterThan(localCacheClear);
  });

  it('starts project sync in the background after the local user session is ready', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/lib/user-manager.ts'), 'utf8');
    const start = source.indexOf('async upsertUserFromServer(');
    const end = source.indexOf('  private getCurrentUserData()', start);
    const method = source.slice(start, end);

    expect(method).toContain('void this.loadProjectsFromServer(1, syncUserId).then(');
    expect(method).not.toContain('await this.loadProjectsFromServer()');
  });

  it('keeps the authenticated workspace out of the initial loading render', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/page.tsx'), 'utf8');
    const workflowState = source.indexOf('const [nodeWorkflow, setNodeWorkflow] = useState<Workflow | null>(null);');
    const authGate = source.indexOf('if (!authChecked) {', workflowState);
    const workspaceReturn = source.indexOf('h-screen w-screen relative overflow-hidden', authGate);

    expect(authGate).toBeGreaterThan(workflowState);
    expect(workspaceReturn).toBeGreaterThan(authGate);
    expect(source).toContain('data-testid="auth-loading-shell"');
    expect(source).not.toContain('{!authChecked && (');
  });
});

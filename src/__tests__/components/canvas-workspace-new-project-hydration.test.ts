// @vitest-environment jsdom
// Execute the real dashboard callback, with the real UserManager. Only HTTP is delayed.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';

const user: User = { id: 'user-a', name: 'A', role: 'user', status: 'active', createdAt: 1, updatedAt: 1 };
let releaseRead: (response: Response) => void;
let pendingRead: Promise<Response>;
let persistedProjects: Array<{ id: string; name: string }>;
let hydrationOperations: Promise<boolean>[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules(); localStorage.clear(); persistedProjects = []; hydrationOperations = [];
  localStorage.setItem('unbounded_ai_current_user', user.id);
  localStorage.setItem('unbounded_ai_user_data', JSON.stringify({ users: [user], userData: {
    [user.id]: { user, projects: [], apiKeys: [], usageStats: [] },
  } }));
  pendingRead = new Promise<Response>(resolve => { releaseRead = resolve; });
  vi.stubGlobal('fetch', async (_input: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { value: Array<{ id: string; name: string }> };
      persistedProjects = payload.value;
      return Response.json({ success: true, projectRevision: 1 });
    }
    return (await pendingRead).clone();
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  releaseRead(Response.json({ success: false }));
  await vi.advanceTimersByTimeAsync(1000);
  await Promise.allSettled(hydrationOperations);
  vi.clearAllTimers(); vi.useRealTimers();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear();
});

function loadActualCallback(dependencies: Record<string, unknown>): () => Promise<void> {
  dependencies.newProjectPendingRef ??= { current: null };
  const source = fs.readFileSync(path.resolve(
    process.env.E2E_NEW_PROJECT_CALLBACK_SOURCE || 'src/components/canvas-workspace.tsx',
  ), 'utf8');
  const file = ts.createSourceFile('canvas-workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onNewProject'
      && node.initializer && ts.isJsxExpression(node.initializer)) callback = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!callback) throw new Error('Dashboard new-project callback missing');
  const compiled = ts.transpileModule('const callback = ' + callback.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), compiled + '\nreturn callback;')(...Object.values(dependencies)) as () => Promise<void>;
}

describe('dashboard new project waits for current-account hydration', () => {
  it('does not let a new project invalidate the first server read and remains persistable', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer(user);
    hydrationOperations.push(manager.waitForProjectHydration(user.id));
    const opened: string[] = []; const modes: string[] = [];
    const create = loadActualCallback({ UserManagerCore: UserManager, currentUser: user,
      loadProjectById: (id: string): void => { opened.push(id); },
      setAppMode: (mode: string): void => { modes.push(mode); } });
    const operation = create();
    await Promise.resolve(); await Promise.resolve();
    expect(manager.getProjects().filter(project => project.name === '未命名项目')).toEqual([]);
    expect(opened).toEqual([]); expect(modes).toEqual([]);
    releaseRead(Response.json({ success: true, value: [], projectRevision: 0 }));
    await operation;
    expect(manager.getProjects()).toHaveLength(1);
    expect(manager.getProjects()[0].name).toBe('未命名项目');
    expect(opened).toEqual([manager.getProjects()[0].id]); expect(modes).toEqual(['canvas']);
    await manager.flushProjectsToServer();
    expect(persistedProjects.map(project => project.name)).toEqual(['未命名项目']);
  });

  it('does not create an unsaved project when the initial read fails', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer(user);
    hydrationOperations.push(manager.waitForProjectHydration(user.id));
    const opened: string[] = [];
    const create = loadActualCallback({ UserManagerCore: UserManager, currentUser: user,
      loadProjectById: (id: string): void => { opened.push(id); }, setAppMode: (): void => undefined });
    const operation = create();
    releaseRead(Response.json({ success: false }));
    await vi.advanceTimersByTimeAsync(1000);
    await operation;
    expect(manager.getProjects().filter(project => project.name === '未命名项目')).toEqual([]);
    expect(opened).toEqual([]); expect(persistedProjects).toEqual([]);
  });

  it('does not create in a different account after a delayed read', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer(user);
    hydrationOperations.push(manager.waitForProjectHydration(user.id));
    const opened: string[] = [];
    const create = loadActualCallback({ UserManagerCore: UserManager, currentUser: user,
      loadProjectById: (id: string): void => { opened.push(id); }, setAppMode: (): void => undefined });
    const operation = create();
    await manager.upsertUserFromServer({ ...user, id: 'user-b', name: 'B' });
    hydrationOperations.push(manager.waitForProjectHydration('user-b'));
    releaseRead(Response.json({ success: true, value: [], projectRevision: 0 }));
    await operation;
    expect(manager.getCurrentUserId()).toBe('user-b');
    expect(manager.getProjects().filter(project => project.name === '未命名项目')).toEqual([]);
    expect(opened).toEqual([]); expect(persistedProjects).toEqual([]);
  });

  it('coalesces repeated clicks while the initial project read is pending', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer(user);
    hydrationOperations.push(manager.waitForProjectHydration(user.id));
    const opened: string[] = [];
    const create = loadActualCallback({ UserManagerCore: UserManager, currentUser: user,
      loadProjectById: (id: string): void => { opened.push(id); }, setAppMode: (): void => undefined });
    const first = create(); const second = create();
    releaseRead(Response.json({ success: true, value: [], projectRevision: 0 }));
    await Promise.all([first, second]);
    expect(manager.getProjects().filter(project => project.name === '未命名项目')).toHaveLength(1);
    expect(opened).toHaveLength(1);
  });

  it('allows a fresh click after a failed first read and a successful later refresh', async () => {
    const { UserManager } = await import('@/lib/user-manager');
    const manager = UserManager.getInstance();
    await manager.upsertUserFromServer(user);
    hydrationOperations.push(manager.waitForProjectHydration(user.id));
    const opened: string[] = [];
    const create = loadActualCallback({ UserManagerCore: UserManager, currentUser: user,
      loadProjectById: (id: string): void => { opened.push(id); }, setAppMode: (): void => undefined });
    const first = create();
    releaseRead(Response.json({ success: false }));
    await vi.advanceTimersByTimeAsync(1000); await first;
    expect(opened).toEqual([]);
    pendingRead = Promise.resolve(Response.json({ success: true, value: [], projectRevision: 0 }));
    await expect(manager.loadProjectsFromServer(0, user.id)).resolves.toBe(true);
    await create();
    expect(manager.getProjects().filter(project => project.name === '未命名项目')).toHaveLength(1);
    expect(opened).toHaveLength(1);
    await manager.flushProjectsToServer();
    expect(persistedProjects.map(project => project.name)).toEqual(['未命名项目']);
  });
});

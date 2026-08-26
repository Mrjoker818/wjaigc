// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SimpleChatProject } from '@/components/simple-chat/simple-chat-types';
import * as syncClient from '@/lib/simple-chat-sync-client';
import type { SimpleChatEnvelopeStore } from '@/lib/simple-chat-sync-storage';
import type { User } from '@/lib/user-types';

const dashboardSource = readFileSync(resolve(process.cwd(), 'src/components/dashboard/dashboard-view.tsx'), 'utf8');

function project(id: string): SimpleChatProject {
  return {
    id, name: id, emoji: 'C', description: '', tasks: [], agents: [], knowledgeItems: [],
    createdAt: 1, updatedAt: 1,
  };
}

function storeWith(projects: SimpleChatProject[], owner = 'user-a'): SimpleChatEnvelopeStore {
  return {
    get: vi.fn(async userId => userId === owner ? {
      schemaVersion: 1 as const, userId: owner, baseRevision: 0, baseProjects: [],
      currentProjects: projects, pendingOperations: [], updatedAt: 1,
    } : null),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

describe('simple chat dashboard synchronization contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('prefers a validated server projection and returns a clone without reading or writing IDB', async () => {
    const remote = [project('remote')];
    const store = storeWith([project('local')]);
    const fetchImpl = vi.fn(async () => Response.json({ success: true, value: remote, syncRevision: 4 }));

    const loaded = await syncClient.loadSimpleChatDashboardProjects({ userId: 'user-a', store, fetchImpl });
    loaded[0].name = 'mutated';

    expect(remote[0].name).toBe('remote');
    expect(loaded.map(item => item.id)).toEqual(['remote']);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/user-data/sync?key=chat_simple_projects',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['server failure', () => Promise.resolve(new Response('{}', { status: 503 }))],
    ['invalid response', () => Promise.resolve(Response.json({ success: true, value: 'bad' }))],
  ])('falls back to only the current user IDB envelope after %s', async (_name, response) => {
    const local = [project('local')];
    const store = storeWith(local);

    const loaded = await syncClient.loadSimpleChatDashboardProjects({
      userId: 'user-a', store, fetchImpl: vi.fn(response) as typeof fetch,
    });
    loaded[0].name = 'mutated';

    expect(local[0].name).toBe('local');
    expect(store.get).toHaveBeenCalledWith('user-a');
    expect(store.put).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it.each([401, 403])('does not read IDB after an authorization response (%s)', async status => {
    const store = storeWith([project('other-user')], 'user-b');

    await expect(syncClient.loadSimpleChatDashboardProjects({
      userId: 'user-a', store,
      fetchImpl: vi.fn(async () => new Response('{}', { status })),
    })).resolves.toEqual([]);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('rejects invalid local projects and never consults legacy storage', async () => {
    const store = storeWith([{ id: 'invalid' } as SimpleChatProject]);

    await expect(syncClient.loadSimpleChatDashboardProjects({
      userId: 'user-a', store,
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
    })).resolves.toEqual([]);

    expect(dashboardSource).toContain('loadSimpleChatDashboardProjects({');
    expect(dashboardSource).toContain('userId: user.id');
    expect(dashboardSource).not.toContain('loadSimpleChatProjects()');
    expect(dashboardSource).not.toContain("localStorage.getItem('simpleChatProjects')");
    expect(dashboardSource).not.toContain('legacy-backup');
  });

  it('ignores a late dashboard projection after the account changes', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    });
    let resolveA!: (projects: SimpleChatProject[]) => void;
    let resolveB!: (projects: SimpleChatProject[]) => void;
    const deferredA = new Promise<SimpleChatProject[]>(resolve => { resolveA = resolve; });
    const deferredB = new Promise<SimpleChatProject[]>(resolve => { resolveB = resolve; });
    vi.spyOn(syncClient, 'loadSimpleChatDashboardProjects').mockImplementation(({ userId }) => (
      userId === 'user-a' ? deferredA : deferredB
    ));
    const { default: DashboardView } = await import('@/components/dashboard/dashboard-view');
    const user = (id: string): User => ({
      id, name: id, productType: 'chat', createdAt: 1, updatedAt: 1,
    });
    const rendered = render(createElement(DashboardView, {
      user: user('user-a'), onOpenProject: vi.fn(), onNewProject: vi.fn(),
    }));
    rendered.rerender(createElement(DashboardView, {
      user: user('user-b'), onOpenProject: vi.fn(), onNewProject: vi.fn(),
    }));

    await act(async () => { resolveB([project('user-b-project')]); });
    expect(await screen.findByText('user-b-project')).toBeTruthy();
    await act(async () => { resolveA([project('user-a-project')]); });

    expect(screen.queryByText('user-a-project')).toBeNull();
    expect(screen.getByText('1 个对话项目')).toBeTruthy();
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('UserManager default administrator projects', () => {
  it('creates fresh demo projects under the administrator owner without isolation warnings', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { UserManager } = await import('@/lib/user-manager');

    UserManager.getInstance();

    const persisted = JSON.parse(storage.get('unbounded_ai_user_data') ?? '{}') as {
      userData?: Record<string, { projects?: Array<{ userId?: string }> }>;
    };
    const projects = persisted.userData?.admin_mr_joker?.projects ?? [];
    expect(projects).toHaveLength(2);
    expect(projects.every(project => project.userId === 'admin_mr_joker')).toBe(true);
    expect(warning.mock.calls.flat().join(' ')).not.toContain('[DataIsolation] loadData');
  });

  it('keeps existing administrator projects when the server administrator name is customized', async () => {
    storage.set('unbounded_ai_current_user', 'admin_mr_joker');
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users: [{ id: 'admin_mr_joker', name: 'custom-admin', role: 'admin', status: 'active' }],
      userData: {
        admin_mr_joker: {
          user: { id: 'admin_mr_joker', name: 'custom-admin', role: 'admin', status: 'active' },
          projects: [{
            id: 'existing-project', userId: 'admin_mr_joker', name: 'Existing',
            canvasImages: [], createdAt: 1, updatedAt: 1, settings: {},
          }],
          apiKeys: [], usageStats: [],
        },
      },
    }));

    const { UserManager } = await import('@/lib/user-manager');
    UserManager.getInstance();

    const persisted = JSON.parse(storage.get('unbounded_ai_user_data') ?? '{}') as {
      users: Array<{ id: string; name: string }>;
      userData: Record<string, { projects: Array<{ id: string }> }>;
    };
    expect(persisted.users.filter(user => user.id === 'admin_mr_joker')).toHaveLength(1);
    expect(persisted.users[0].name).toBe('custom-admin');
    expect(persisted.userData.admin_mr_joker.projects.map(project => project.id)).toEqual(['existing-project']);
  });

  it('does not promote an ordinary user named like the default administrator', async () => {
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users: [{ id: 'ordinary-user', name: 'Mr.joker', role: 'user', status: 'active' }],
      userData: {
        'ordinary-user': {
          user: { id: 'ordinary-user', name: 'Mr.joker', role: 'user', status: 'active' },
          projects: [], apiKeys: [], usageStats: [],
        },
      },
    }));

    const { UserManager } = await import('@/lib/user-manager');
    UserManager.getInstance();

    const persisted = JSON.parse(storage.get('unbounded_ai_user_data') ?? '{}') as {
      users: Array<{ id: string; role: string }>;
    };
    expect(persisted.users.find(user => user.id === 'ordinary-user')?.role).toBe('user');
    expect(persisted.users.find(user => user.id === 'admin_mr_joker')?.role).toBe('admin');
  });

  it('does not replace administrator projects when only the cached user list entry is missing', async () => {
    storage.set('unbounded_ai_current_user', 'admin_mr_joker');
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users: [],
      userData: {
        admin_mr_joker: {
          user: { id: 'admin_mr_joker', name: 'custom-admin', role: 'admin', status: 'active' },
          projects: [{
            id: 'retained-project', userId: 'admin_mr_joker', name: 'Retained',
            canvasImages: [], createdAt: 1, updatedAt: 1, settings: {},
          }],
          apiKeys: [], usageStats: [],
        },
      },
    }));

    const { UserManager } = await import('@/lib/user-manager');
    UserManager.getInstance();

    const persisted = JSON.parse(storage.get('unbounded_ai_user_data') ?? '{}') as {
      users: Array<{ id: string; name: string }>;
      userData: Record<string, { projects: Array<{ id: string }> }>;
    };
    expect(persisted.users.filter(user => user.id === 'admin_mr_joker')).toHaveLength(1);
    expect(persisted.users[0].name).toBe('custom-admin');
    expect(persisted.userData.admin_mr_joker.projects.map(project => project.id)).toEqual(['retained-project']);
  });

  it('coalesces duplicate administrator records without losing the customized name or projects', async () => {
    storage.set('unbounded_ai_current_user', 'admin_mr_joker');
    storage.set('unbounded_ai_user_data', JSON.stringify({
      users: [
        { id: 'admin_mr_joker', name: 'Mr.joker', role: 'admin', status: 'active' },
        { id: 'admin_mr_joker', name: 'custom-admin', role: 'admin', status: 'active' },
      ],
      userData: {
        admin_mr_joker: {
          user: { id: 'admin_mr_joker', name: 'custom-admin', role: 'admin', status: 'active' },
          projects: [{
            id: 'surviving-project', userId: 'admin_mr_joker', name: 'Surviving',
            canvasImages: [], createdAt: 1, updatedAt: 1, settings: {},
          }],
          apiKeys: [], usageStats: [],
        },
      },
    }));

    const { UserManager } = await import('@/lib/user-manager');
    UserManager.getInstance();

    const persisted = JSON.parse(storage.get('unbounded_ai_user_data') ?? '{}') as {
      users: Array<{ id: string; name: string }>;
      userData: Record<string, { projects: Array<{ id: string }> }>;
    };
    expect(persisted.users.filter(user => user.id === 'admin_mr_joker')).toHaveLength(1);
    expect(persisted.users[0].name).toBe('custom-admin');
    expect(persisted.userData.admin_mr_joker.projects.map(project => project.id)).toEqual(['surviving-project']);
  });
});

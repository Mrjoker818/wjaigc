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
});

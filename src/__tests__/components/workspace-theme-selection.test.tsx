// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://workspace-theme.invalid/?view=dashboard"}
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/user-types';
import { CAPABILITY_CATALOG_VERSION } from '@/lib/task-core/model-capability-contract';

// Real Workspace -> real Dashboard -> real settings. Only the local cache and
// HTTP boundary are synthetic; no real session, DB, model or browser profile.
const fixture = vi.hoisted(() => {
  const user: User = { id: 'aj-theme-user', name: 'Theme User', role: 'user',
    status: 'active', productType: 'canvas', createdAt: 1, updatedAt: 1 };
  return { user, manager: {
    getUser: (): User => user,
    getCurrentUserId: (): string => user.id,
    getProjects: (): [] => [],
    getUsageStats: (): [] => [],
    getProjectSyncRevision: (): number => 0,
    upsertUserFromServer: async (value: User): Promise<User> => value,
    loadProjectsFromServer: async (): Promise<boolean> => true,
    onProjectsChanged: (): (() => void) => (): void => undefined,
  } };
});
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => fixture.manager } }));
// Toast rendering owns a separate media-query subscription (sonner). Exclude
// that unrelated sink, not the theme owner or any component in the theme chain.
vi.mock('@/components/ui/sonner', () => ({ Toaster: (): null => null }));
import { CanvasWorkspace } from '@/components/canvas-workspace';
import { useWorkspaceTheme } from '@/hooks/use-workspace-theme';

let osDark: boolean;
let listeners: Set<EventListenerOrEventListenerObject>;
let unexpected: string[];
function media(query: string): MediaQueryList {
  return {
    media: query, get matches(): boolean { return query === '(prefers-color-scheme: dark)' && osDark; },
    onchange: null,
    addEventListener: (_name: string, listener: EventListenerOrEventListenerObject | null): void => {
      if (query === '(prefers-color-scheme: dark)' && listener) listeners.add(listener);
    },
    removeEventListener: (_name: string, listener: EventListenerOrEventListenerObject | null): void => {
      if (listener) listeners.delete(listener);
    },
    addListener: (): void => undefined, removeListener: (): void => undefined,
    dispatchEvent: (): boolean => true,
  };
}
function changeSystem(dark: boolean): void {
  osDark = dark;
  act(() => {
    const event = new Event('change');
    Object.defineProperty(event, 'matches', { value: dark });
    for (const listener of [...listeners]) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  });
}
async function settings(): Promise<ReturnType<typeof render>> {
  const view = render(<CanvasWorkspace initialUser={fixture.user} onLoggedOut={() => undefined} />);
  const open = await screen.findByRole('button', { name: '展开导航' });
  fireEvent.click(open);
  fireEvent.click(within(screen.getByRole('navigation', { hidden: true })).getByRole('button', { name: '设置' }));
  await screen.findByRole('heading', { name: '外观主题' });
  return view;
}
function select(name: string): void { fireEvent.click(screen.getByRole('button', { name })); }
async function resolved(style: 'theme-gold' | 'theme-monochrome'): Promise<void> {
  await waitFor(() => expect(document.documentElement.classList.contains(style)).toBe(true));
  expect(document.documentElement.classList.contains(style === 'theme-gold' ? 'theme-monochrome' : 'theme-gold')).toBe(false);
}

beforeAll(async (): Promise<void> => { await import('@/components/dashboard/dashboard-view'); });
beforeEach((): void => {
  osDark = true; listeners = new Set(); unexpected = [];
  localStorage.clear(); sessionStorage.clear();
  document.documentElement.className = ''; document.documentElement.style.cssText = '';
  window.history.replaceState(null, '', '/?view=dashboard');
  vi.stubGlobal('matchMedia', media);
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = new URL(String(input), 'https://workspace-theme.invalid');
    if (target.origin !== 'https://workspace-theme.invalid') throw Error('AJ_DISALLOWED_ORIGIN');
    const url = target.pathname + target.search;
    if (init?.method && init.method !== 'GET') {
      unexpected.push(`${init.method} ${url}`); throw Error('AJ_DISALLOWED_WRITE');
    }
    if (url === '/api/session') return Response.json({ success: true, user: fixture.user });
    if (['/api/models?type=all', '/api/models?type=image', '/api/models?type=chat'].includes(url)) return Response.json({ success: true,
      capabilityCatalogVersion: CAPABILITY_CATALOG_VERSION, providers: [], models: [], taskModelCatalog: [] });
    if (url === '/api/announcement') return Response.json({ success: true, announcement: null });
    if (url === '/api/credits/payment-status') return Response.json({ success: false });
    unexpected.push(url); throw Error(`AJ_UNEXPECTED_GET ${url}`);
  });
});

describe('AJ existing manual canvas theme toggle', () => {
  it('two queued toggles preserve the original functional-update parity', () => {
    const { result } = renderHook(() => useWorkspaceTheme());
    act(() => { result.current.toggleTheme(); result.current.toggleTheme(); });
    expect(result.current.themeStyle).toBe('gold');
    expect(result.current.themePreference).toBe('dark');
  });
  it('manual toggle leaves system mode using its currently resolved style', () => {
    osDark = false;
    const { result } = renderHook(() => useWorkspaceTheme());
    act(() => result.current.setThemePreference('system'));
    expect(result.current.themeStyle).toBe('monochrome');
    act(() => result.current.toggleTheme());
    expect(result.current.themeStyle).toBe('gold');
    expect(result.current.themePreference).toBe('dark');
    changeSystem(true); changeSystem(false);
    expect(result.current.themeStyle).toBe('gold');
  });
});
afterEach((): void => { cleanup(); vi.unstubAllGlobals(); expect(unexpected).toEqual([]); });

describe('AJ actual workspace theme selection', () => {
  it('light changes the actual root style, not just a settings callback', async () => {
    await settings(); select('浅色'); await resolved('theme-monochrome');
    expect(screen.getByRole('button', { name: '浅色' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#ffffff');
  });
  it('dark restores the existing gold style after choosing light', async () => {
    await settings(); select('浅色'); await resolved('theme-monochrome');
    select('深色'); await resolved('theme-gold');
    expect(screen.getByRole('button', { name: '深色' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#d4af37');
  });
  it('system remains selected while actual OS changes resolve both styles', async () => {
    osDark = false; await settings(); select('跟随系统'); await resolved('theme-monochrome');
    changeSystem(true); await resolved('theme-gold');
    changeSystem(false); await resolved('theme-monochrome');
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '浅色' }).getAttribute('aria-pressed')).toBe('false');
  });
  it('an explicit selection stops following later OS changes', async () => {
    await settings(); select('跟随系统'); changeSystem(false); await resolved('theme-monochrome');
    select('深色'); await resolved('theme-gold');
    changeSystem(true); changeSystem(false); await resolved('theme-gold');
    select('浅色'); await resolved('theme-monochrome'); changeSystem(true); await resolved('theme-monochrome');
  });
  it('unmount releases system subscriptions after following the OS', async () => {
    const view = await settings(); select('跟随系统');
    expect(listeners.size).toBeGreaterThan(0);
    view.unmount(); expect(listeners.size).toBe(0);
    const previous = document.documentElement.className;
    changeSystem(false); expect(document.documentElement.className).toBe(previous);
  });
  it('missing matchMedia keeps manual selection usable and system safely dark', async () => {
    vi.stubGlobal('matchMedia', undefined);
    await settings(); select('浅色'); await resolved('theme-monochrome');
    select('跟随系统'); await resolved('theme-gold');
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('wujie_user_settings')).toBeNull();
    expect(localStorage.getItem('simple-chat-theme')).toBeNull();
  });
});

// @vitest-environment jsdom
// Regression: authenticated user hydration must invalidate the dashboard's
// cached pre-login demo project, without removing the owner permission guard.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, User } from '@/lib/user-types';

const manager = vi.hoisted(() => ({
  getProjects: vi.fn(), getUsageStats: vi.fn(() => []),
  getCurrentUserId: vi.fn(() => 'owner-a'),
}));
vi.mock('@/lib/user-manager', () => ({ UserManager: { getInstance: () => manager } }));
import DashboardView from '@/components/dashboard/dashboard-view';

const owner: User = {
  id: 'owner-a', name: 'Owner A', password: '', role: 'user', status: 'active',
  createdAt: 1, updatedAt: 1, productType: 'canvas',
};
const demo: Project = {
  id: 'empty-canvas', userId: 'demo', name: '空画布', createdAt: 1, updatedAt: 1,
  canvasImages: [], settings: {},
};
beforeEach(() => {
  manager.getProjects.mockReturnValue([demo]);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('document-enable')) return Response.json({
      success: true, projectId: 'empty-canvas', featureEnabled: true,
      enabled: false, currentRevision: 0,
    });
    return Response.json({ success: false });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dashboard authenticated project hydration', () => {
  it('keeps the ownership guard when a cached project belongs to another user', async () => {
    render(<DashboardView user={owner} onOpenProject={vi.fn()} onNewProject={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '空画布 项目操作菜单' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理协作' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens collaboration for the refreshed owner project after pre-login demo hydration', async () => {
    const props = { user: owner, onOpenProject: vi.fn(), onNewProject: vi.fn() };
    const view = render(<DashboardView {...props} />);
    // Mirrors upsertUserFromServer: same authenticated id, a new user object,
    // and the manager now returns projects bound to that owner.
    manager.getProjects.mockReturnValue([{ ...demo, userId: 'owner-a' }]);
    view.rerender(<DashboardView {...props} user={{ ...owner, updatedAt: 2 }} />);
    const trigger = screen.getByRole('button', { name: '空画布 项目操作菜单' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理协作' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '启用协作' })).toBeTruthy();
  });
});

/** The three products: image canvas, video (the drama workbench) and chat. */
export type Platform = 'canvas' | 'video' | 'chat';

export const PLATFORMS: ReadonlyArray<{ id: Platform; label: string; path: string }> = [
  { id: 'canvas', label: '画布', path: '/canvas' },
  { id: 'video', label: '视频', path: '/video' },
  { id: 'chat', label: '对话', path: '/chat' },
];

const ALL: Platform[] = ['canvas', 'video', 'chat'];
const DRAMA_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Platforms a user may open. An empty productType has always meant "everything", and admins see everything. */
export function platformsForUser(user: { productType?: string | null; role?: string } | null | undefined): Platform[] {
  if (!user) return [];
  if (user.role === 'admin') return [...ALL];
  const types = (user.productType ?? '').split(',').map(type => type.trim()).filter(Boolean);
  if (types.length === 0) return [...ALL];
  return ALL.filter(platform => types.includes(platform));
}

/** A submitted productType reduced to known platforms in a fixed order; '' when none are known. */
export function normalizeProductType(value: unknown): string {
  const types = typeof value === 'string' ? value.split(',').map(type => type.trim()) : [];
  return ALL.filter(platform => types.includes(platform)).join(',');
}

/** Platform a path belongs to; `/` and `/simple-chat` are the older entries. */
export function platformForPath(pathname: string): Platform | null {
  if (pathname === '/canvas') return 'canvas';
  if (pathname === '/video') return 'video';
  if (pathname === '/chat' || pathname === '/simple-chat') return 'chat';
  return null;
}

/** Address of a platform. Canvas and video share the canvas project; video can also point at one drama. */
export function platformHref(platform: Platform, state: { projectId?: string | null; dramaId?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (platform !== 'chat' && state.projectId) params.set('projectId', state.projectId);
  if (platform === 'video' && state.dramaId) params.set('dramaId', state.dramaId);
  const query = params.toString();
  return `${PLATFORMS.find(item => item.id === platform)!.path}${query ? `?${query}` : ''}`;
}

/** Drama the address asks for, if it looks like a drama id. */
export function dramaIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('dramaId');
  return value && DRAMA_ID.test(value) ? value : null;
}

/** Paths served by the canvas workspace page: the old `/` entry plus the canvas and video addresses. */
export function isWorkspacePath(pathname: string): boolean {
  return pathname === '/' || pathname === '/canvas' || pathname === '/video';
}

/**
 * Mode the workspace opens in for a platform address; null for `/`, whose query decides.
 * `/canvas` without a project shows the project list, because a canvas needs a project to save into.
 */
export function workspaceModeForPath(pathname: string, search: string): 'canvas' | 'drama' | 'dashboard' | null {
  if (pathname === '/video') return 'drama';
  if (pathname !== '/canvas') return null;
  const params = new URLSearchParams(search);
  return params.has('projectId') || params.get('loginMode') === 'canvas' ? 'canvas' : 'dashboard';
}

export interface WorkspaceAddressState {
  mode: 'canvas' | 'drama' | 'dashboard';
  projectId: string | null;
  dramaId: string | null;
}

/**
 * The address the workspace should show for its current state, so a refresh reopens the same place.
 * Only the platform's own parameters change; handoff and test parameters stay. While a project is still
 * loading (`projectId` null) the address keeps the one it already names.
 */
export function workspaceAddress(state: WorkspaceAddressState, location: { pathname: string; search: string; hash: string }): string {
  const params = new URLSearchParams(location.search);
  params.delete('mode');
  params.delete('view');
  params.delete('dramaId');
  let pathname: string;
  if (state.mode === 'dashboard') {
    pathname = '/';
    params.delete('projectId');
    params.set('view', 'dashboard');
  } else {
    pathname = state.mode === 'drama' ? '/video' : '/canvas';
    if (state.projectId) params.set('projectId', state.projectId);
    if (state.mode === 'drama' && state.dramaId) params.set('dramaId', state.dramaId);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${location.hash}`;
}

/**
 * Where a signed-in user who opened `pathname` should go instead, or null to stay.
 * A user with a single platform is sent to it; everyone else stays where they asked to be.
 */
export function platformRedirect(platforms: Platform[], pathname: string): string | null {
  if (platforms.length !== 1) return null;
  const only = platforms[0];
  const current = platformForPath(pathname);
  if (current === only) return null;
  return platformHref(only);
}

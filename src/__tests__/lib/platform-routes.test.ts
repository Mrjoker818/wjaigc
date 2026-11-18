import { describe, expect, it } from 'vitest';
import {
  dramaIdFromSearch, isWorkspacePath, platformForPath, platformHref, platformRedirect, platformsForUser,
  workspaceAddress, workspaceModeForPath,
} from '@/lib/platform-routes';

const at = (href: string) => {
  const url = new URL(href, 'http://local');
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

describe('platform routes', () => {
  it('opens every platform for admins and empty grants, and video with a canvas grant', () => {
    expect(platformsForUser(null)).toEqual([]);
    expect(platformsForUser({ role: 'admin', productType: 'chat' })).toEqual(['canvas', 'video', 'chat']);
    expect(platformsForUser({ productType: '' })).toEqual(['canvas', 'video', 'chat']);
    expect(platformsForUser({ productType: 'chat' })).toEqual(['chat']);
    expect(platformsForUser({ productType: 'canvas' })).toEqual(['canvas', 'video']);
    expect(platformsForUser({ productType: ' canvas , chat ' })).toEqual(['canvas', 'video', 'chat']);
  });

  it('maps paths to platforms and builds platform links', () => {
    expect(platformForPath('/simple-chat')).toBe('chat');
    expect(platformForPath('/')).toBeNull();
    expect(platformHref('video', { projectId: 'p1', dramaId: 'd1' })).toBe('/video?projectId=p1&dramaId=d1');
    expect(platformHref('canvas', { projectId: 'p1', dramaId: 'd1' })).toBe('/canvas?projectId=p1');
    expect(platformHref('chat', { projectId: 'p1' })).toBe('/chat');
  });

  it('reads a drama id only when it looks like one', () => {
    expect(dramaIdFromSearch('?dramaId=drama_1-a')).toBe('drama_1-a');
    expect(dramaIdFromSearch('?dramaId=../x')).toBeNull();
    expect(dramaIdFromSearch('')).toBeNull();
  });

  it('picks the workspace mode from the address', () => {
    expect(isWorkspacePath('/video')).toBe(true);
    expect(isWorkspacePath('/chat')).toBe(false);
    expect(workspaceModeForPath('/video', '')).toBe('drama');
    expect(workspaceModeForPath('/canvas', '?projectId=p1')).toBe('canvas');
    expect(workspaceModeForPath('/canvas', '?loginMode=canvas')).toBe('canvas');
    expect(workspaceModeForPath('/canvas', '')).toBe('dashboard');
    expect(workspaceModeForPath('/', '?projectId=p1')).toBeNull();
  });

  it('moves old drama links to /video and keeps unrelated parameters', () => {
    expect(workspaceAddress({ mode: 'drama', projectId: null, dramaId: 'd1' }, at('/?projectId=p1&mode=drama&chatTaskId=t1#x')))
      .toBe('/video?projectId=p1&chatTaskId=t1&dramaId=d1#x');
    expect(workspaceAddress({ mode: 'canvas', projectId: 'p2', dramaId: 'd1' }, at('/video?projectId=p1&dramaId=d1')))
      .toBe('/canvas?projectId=p2');
    expect(workspaceAddress({ mode: 'dashboard', projectId: 'p2', dramaId: null }, at('/canvas?projectId=p2&e2e=keep')))
      .toBe('/?e2e=keep&view=dashboard');
  });

  it('sends single-platform users to their platform only', () => {
    expect(platformRedirect(['chat'], '/')).toBe('/chat');
    expect(platformRedirect(['chat'], '/simple-chat')).toBeNull();
    expect(platformRedirect(['canvas', 'video'], '/')).toBeNull();
  });
});

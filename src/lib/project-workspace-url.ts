export interface BrowserLocationLike {
  pathname: string;
  search: string;
  hash: string;
}

export type InitialWorkspaceMode = 'canvas' | 'node' | 'workflow-hub' | 'dashboard';

export function getInitialWorkspaceModeFromSearch(search: string): InitialWorkspaceMode {
  const params = new URLSearchParams(search);
  if (params.has('projectId') && params.get('mode') === 'node') return 'node';
  if (params.get('view') === 'dashboard') return 'dashboard';
  if (params.has('projectId')) return 'canvas';
  if (params.get('loginMode') === 'canvas' && !params.has('error')) return 'canvas';
  return 'dashboard';
}

export function clearSimpleChatWorkspaceHandoffParams(value: string): string {
  const url = new URL(value, 'http://workspace.local');
  url.searchParams.delete('chatProjectId');
  url.searchParams.delete('chatTaskId');
  url.searchParams.delete('chatMessageId');
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

export function buildProjectWorkspaceUrl(
  location: BrowserLocationLike,
  projectId: string,
): string {
  const params = new URLSearchParams(location.search);
  params.delete('view');
  params.set('projectId', projectId);

  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

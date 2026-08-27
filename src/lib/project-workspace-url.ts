import { useSyncExternalStore } from 'react';

export interface BrowserLocationLike {
  pathname: string;
  search: string;
  hash: string;
}

export const WORKSPACE_LOCATION_CHANGE_EVENT = 'workspace-location-change';

export interface WorkspaceHistoryWindow extends EventTarget {
  history: {
    replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
  };
  location: BrowserLocationLike;
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

export function replaceWorkspaceHistoryState(
  target: WorkspaceHistoryWindow,
  url: string,
): void {
  target.history.replaceState(null, '', url);
  target.dispatchEvent(new Event(WORKSPACE_LOCATION_CHANGE_EVENT));
}

function subscribeWorkspaceLocationChange(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('popstate', onStoreChange);
  window.addEventListener(WORKSPACE_LOCATION_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener(WORKSPACE_LOCATION_CHANGE_EVENT, onStoreChange);
  };
}

function getWorkspaceLocationSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

export function useWorkspaceLocationSearch(): string {
  return useSyncExternalStore(
    subscribeWorkspaceLocationChange,
    getWorkspaceLocationSearch,
    () => '',
  );
}

export function buildProjectWorkspaceUrl(
  location: BrowserLocationLike,
  projectId: string,
): string {
  const params = new URLSearchParams(location.search);
  params.delete('view');
  params.delete('chatProjectId');
  params.delete('chatTaskId');
  params.delete('chatMessageId');
  params.set('projectId', projectId);

  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

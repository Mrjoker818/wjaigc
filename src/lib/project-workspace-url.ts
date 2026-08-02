export interface BrowserLocationLike {
  pathname: string;
  search: string;
  hash: string;
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

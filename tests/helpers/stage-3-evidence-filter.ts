export interface Stage3EvidenceEntry {
  method?: string;
  status?: number;
  text?: string;
  type?: string;
  url?: string;
}

export function isBenignStage3RequestAbort(entry: Stage3EvidenceEntry): boolean {
  const aborted = !entry.status
    && /ERR_ABORTED|NS_ERROR_ABORT|NS_BINDING_ABORTED|Load request cancelled/i.test(entry.text ?? '');
  if (!aborted || !entry.method || !entry.url) return false;

  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }

  return (
    entry.method === 'GET'
    && (
      pathname === '/api/task-events'
      || pathname === '/api/models'
      || pathname.startsWith('/api/serve-upload/')
    )
  ) || (
    entry.method === 'POST'
    && (pathname === '/api/activity' || pathname === '/api/user-data/record')
  );
}

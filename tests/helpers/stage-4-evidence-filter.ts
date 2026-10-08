import {
  isBenignStage3RequestAbort,
  isRecoveredStage3RequestAbort,
  type Stage3EvidenceEntry,
} from './stage-3-evidence-filter';

export type Stage4RuntimeEvidenceEntry = Stage3EvidenceEntry;

interface Stage4RuntimeFailureSummary {
  console: Array<{ kind: string; status?: number; route: string }>;
  network: Array<{ method: string; status?: number; route: string }>;
  omitted: { console: number; network: number };
}

const SUMMARY_ROUTES = new Set([
  '/api/session', '/api/auth/login', '/api/auth/register',
  '/api/collaboration/presence-ticket', '/api/collaboration/document-project',
  '/api/collaboration/members', '/api/user-data/sync', '/api/models', '/api/skills',
  '/api/chat', '/api/agent-edit', '/api/workflow/execute', '/api/workflow/models',
  '/api/workflow/save', '/api/task-events', '/api/poll-task', '/api/save-image',
]);
const SUMMARY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function summaryRoute(url: string | undefined): string {
  if (!url) return '[other-route]';
  try {
    const pathname = new URL(url).pathname;
    if (SUMMARY_ROUTES.has(pathname)) return pathname;
    if (pathname.startsWith('/api/serve-upload/')) return '/api/serve-upload/[file]';
    if (pathname.startsWith('/_next/static/')) return '/_next/static/[file]';
  } catch {
    // Invalid URLs stay opaque; never fall back to printing the original value.
  }
  return '[other-route]';
}

function summaryStatus(status: number | undefined): { status?: number } {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? { status } : {};
}

export function summarizeStage4RuntimeFailures(
  failures: ReturnType<typeof stage4RuntimeEvidenceFailures>,
): Stage4RuntimeFailureSummary {
  // CI logs remain useful without artifacts, but must not disclose text, URL
  // credentials, query tickets, dynamic path identifiers, or request fingerprints.
  const limit = 16;
  return {
    console: failures.consoleFailures.slice(0, limit).map(entry => {
      const statusMatch = /server responded with a status of ([0-9]{3})\b/i.exec(entry.text ?? '');
      return {
        kind: ['error', 'warning', 'pageerror'].includes(entry.type ?? '') ? entry.type! : 'other',
        ...summaryStatus(statusMatch ? Number(statusMatch[1]) : undefined),
        route: summaryRoute(entry.url),
      };
    }),
    network: failures.networkFailures.slice(0, limit).map(entry => ({
      method: SUMMARY_METHODS.has(entry.method ?? '') ? entry.method! : 'OTHER',
      ...summaryStatus(entry.status),
      route: summaryRoute(entry.url),
    })),
    omitted: {
      console: Math.max(0, failures.consoleFailures.length - limit),
      network: Math.max(0, failures.networkFailures.length - limit),
    },
  };
}

function isRecoveredIdempotentGetAbort(
  entry: Stage4RuntimeEvidenceEntry,
  evidence: Stage4RuntimeEvidenceEntry[],
): boolean {
  if (
    entry.method !== 'GET'
    || !entry.url
    || !/ERR_ABORTED|NS_ERROR_ABORT|NS_BINDING_ABORTED|Load request cancelled/i.test(entry.text ?? '')
  ) return false;
  return evidence.some(candidate => (
    candidate.method === 'GET'
    && candidate.url === entry.url
    && typeof candidate.status === 'number'
    && candidate.status >= 200
    && candidate.status < 300
  ));
}

function isRecoveredWorkflowStatusAbort(
  entry: Stage4RuntimeEvidenceEntry,
  evidence: Stage4RuntimeEvidenceEntry[],
): boolean {
  if (
    entry.method !== 'POST'
    || !entry.url
    || !entry.requestDigest
    || !/ERR_ABORTED|NS_ERROR_ABORT|NS_BINDING_ABORTED|Load request cancelled/i.test(entry.text ?? '')
  ) return false;
  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }
  if (pathname !== '/api/workflow/execute') return false;
  return evidence.some(candidate => (
    candidate.method === 'POST'
    && candidate.url === entry.url
    && candidate.requestDigest === entry.requestDigest
    && typeof candidate.status === 'number'
    && candidate.status >= 200
    && candidate.status < 300
  ));
}

function isRecoveredProjectSyncConflict(
  entry: Stage4RuntimeEvidenceEntry,
  evidence: Stage4RuntimeEvidenceEntry[],
): boolean {
  if (
    entry.method !== 'POST'
    || entry.status !== 409
    || !entry.url
    || !entry.requestDigest
  ) return false;
  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }
  if (pathname !== '/api/user-data/sync') return false;
  return evidence.some(candidate => (
    candidate.method === 'POST'
    && candidate.url === entry.url
    && candidate.requestDigest === entry.requestDigest
    && typeof candidate.status === 'number'
    && candidate.status >= 200
    && candidate.status < 300
    && (candidate.occurredAt ?? 0) >= (entry.occurredAt ?? Number.POSITIVE_INFINITY)
  ));
}

function isRecoveredProjectSyncConflictConsole(
  entry: Stage4RuntimeEvidenceEntry,
  evidence: Stage4RuntimeEvidenceEntry[],
): boolean {
  if (
    entry.type !== 'error'
    || !entry.url
    || !/Failed to load resource: the server responded with a status of 409/i.test(entry.text ?? '')
  ) return false;
  let pathname: string;
  try {
    pathname = new URL(entry.url).pathname;
  } catch {
    return false;
  }
  if (pathname !== '/api/user-data/sync') return false;
  return evidence.some(candidate => (
    isRecoveredProjectSyncConflict(candidate, evidence)
    && candidate.url === entry.url
    && Math.abs((candidate.occurredAt ?? 0) - (entry.occurredAt ?? Number.POSITIVE_INFINITY)) <= 1_000
  ));
}

export function stage4RuntimeEvidenceFailures(
  consoleEntries: Stage4RuntimeEvidenceEntry[],
  networkEntries: Stage4RuntimeEvidenceEntry[],
): {
  consoleFailures: Stage4RuntimeEvidenceEntry[];
  networkFailures: Stage4RuntimeEvidenceEntry[];
} {
  return {
    consoleFailures: consoleEntries.filter(entry => (
      (entry.type === 'error' || entry.type === 'warning' || entry.type === 'pageerror')
      && !isRecoveredProjectSyncConflictConsole(entry, networkEntries)
    )),
    networkFailures: networkEntries.filter(entry => (
      (typeof entry.status === 'number'
        && entry.status >= 400
        && !isRecoveredProjectSyncConflict(entry, networkEntries))
      || (Boolean(entry.text)
        && !isBenignStage3RequestAbort(entry)
        && !isRecoveredStage3RequestAbort(entry, networkEntries)
        && !isRecoveredWorkflowStatusAbort(entry, networkEntries)
        && !isRecoveredIdempotentGetAbort(entry, networkEntries))
    )),
  };
}

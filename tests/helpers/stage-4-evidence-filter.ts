import {
  isBenignStage3RequestAbort,
  isRecoveredStage3RequestAbort,
  type Stage3EvidenceEntry,
} from './stage-3-evidence-filter';

export type Stage4RuntimeEvidenceEntry = Stage3EvidenceEntry;

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

export function stage4RuntimeEvidenceFailures(
  consoleEntries: Stage4RuntimeEvidenceEntry[],
  networkEntries: Stage4RuntimeEvidenceEntry[],
): {
  consoleFailures: Stage4RuntimeEvidenceEntry[];
  networkFailures: Stage4RuntimeEvidenceEntry[];
} {
  return {
    consoleFailures: consoleEntries.filter(entry => (
      entry.type === 'error' || entry.type === 'warning' || entry.type === 'pageerror'
    )),
    networkFailures: networkEntries.filter(entry => (
      (typeof entry.status === 'number' && entry.status >= 400)
      || (Boolean(entry.text)
        && !isBenignStage3RequestAbort(entry)
        && !isRecoveredStage3RequestAbort(entry, networkEntries)
        && !isRecoveredWorkflowStatusAbort(entry, networkEntries)
        && !isRecoveredIdempotentGetAbort(entry, networkEntries))
    )),
  };
}

import {
  isBenignStage3RequestAbort,
  isRecoveredStage3RequestAbort,
  type Stage3EvidenceEntry,
} from './stage-3-evidence-filter';

export type Stage4RuntimeEvidenceEntry = Stage3EvidenceEntry;

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
        && !isRecoveredStage3RequestAbort(entry, networkEntries))
    )),
  };
}

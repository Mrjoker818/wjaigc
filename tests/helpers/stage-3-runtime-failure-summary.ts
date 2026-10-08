import type { Stage3EvidenceEntry } from './stage-3-evidence-filter';
import { summarizeStage4RuntimeFailures } from './stage-4-evidence-filter';

export function stage3RuntimeFailureMessage(
  consoleFailures: Stage3EvidenceEntry[],
  networkFailures: Stage3EvidenceEntry[],
): string {
  // Format already-classified failures only. Do not apply Stage 4's filters
  // or print raw entries when artifact upload is unavailable.
  const summary = summarizeStage4RuntimeFailures({ consoleFailures, networkFailures });
  return `STAGE3_RUNTIME_FAILURES ${JSON.stringify(summary)}`;
}

export function findNewBriefVideoRunId(
  beforeRunIds: readonly string[],
  currentRunIds: readonly string[],
): string | undefined {
  const previous = new Set(beforeRunIds.filter(Boolean));
  return currentRunIds.find(runId => Boolean(runId) && !previous.has(runId));
}

export interface Stage4SelectionDiagnostic {
  collect: () => Promise<void>;
  dispose: () => Promise<void>;
}

export type Stage4SelectionDiagnosticFailure = 'collect' | 'dispose';

export async function finalizeStage4SelectionDiagnostic(
  diagnostic: Stage4SelectionDiagnostic,
): Promise<Stage4SelectionDiagnosticFailure[]> {
  const failures: Stage4SelectionDiagnosticFailure[] = [];
  try {
    await diagnostic.collect();
  } catch {
    failures.push('collect');
  }
  try {
    await diagnostic.dispose();
  } catch {
    failures.push('dispose');
  }
  return failures;
}

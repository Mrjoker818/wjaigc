import { resolve } from 'node:path';

import {
  initializeTask7EvidenceRun,
  task7ChromiumMatrixIdentities,
} from '../tests/helpers/read-only-canvas-share-evidence';

function argument(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing required argument: ${name}`);
  return value;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const runId = argument(argv, '--run-id');
  const candidateCommit = argument(argv, '--commit');
  const rootArgument = argv.includes('--root') ? argument(argv, '--root') : undefined;
  const rootDirectory = resolve(
    rootArgument ?? resolve(process.cwd(), 'output', 'playwright', 'read-only-canvas-share-evidence'),
  );
  const result = await initializeTask7EvidenceRun({
    rootDirectory,
    runId,
    candidateCommit,
    expectedIdentities: [...task7ChromiumMatrixIdentities],
  });
  process.stdout.write(`${JSON.stringify({
    status: 'initialized',
    runId,
    candidateCommit: candidateCommit.toLowerCase(),
    executionNonce: result.executionNonce,
    expectedCount: task7ChromiumMatrixIdentities.length,
    stagingDirectory: result.stagingDirectory,
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

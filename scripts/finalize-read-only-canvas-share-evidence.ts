import { resolve } from 'node:path';

import {
  finalizeTask7Evidence,
  task7ChromiumMatrixIdentities,
} from '../tests/helpers/read-only-canvas-share-evidence';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing required argument: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const runId = argument('--run-id');
  const candidateCommit = argument('--commit');
  const rootArgument = process.argv.includes('--root') ? argument('--root') : undefined;
  const rootDirectory = resolve(
    rootArgument ?? resolve(process.cwd(), 'output', 'playwright', 'read-only-canvas-share-evidence'),
  );
  const result = await finalizeTask7Evidence({
    rootDirectory,
    runId,
    candidateCommit,
    expectedIdentities: [...task7ChromiumMatrixIdentities],
  });

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    runId,
    candidateCommit,
    expectedCount: task7ChromiumMatrixIdentities.length,
    finalDirectory: result.finalDirectory,
    manifestPath: result.manifestPath,
  }, null, 2)}\n`);
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

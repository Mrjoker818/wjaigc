import { resolve } from 'node:path';

import {
  discoverGitRepositoryRoot,
  initializeTask7EvidenceRun,
} from '../tests/helpers/read-only-canvas-share-evidence';
import { parseStrictCliOptions } from './read-only-canvas-share-evidence-cli';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseStrictCliOptions(argv, ['--run-id', '--commit'] as const);
  const runId = options['--run-id'];
  const candidateCommit = options['--commit'];
  const repositoryRoot = await discoverGitRepositoryRoot(process.cwd());
  const rootDirectory = resolve(repositoryRoot, 'output', 'playwright', 'read-only-canvas-share-evidence');
  const result = await initializeTask7EvidenceRun({
    rootDirectory,
    repositoryRoot,
    runId,
    candidateCommit,
  });
  process.stdout.write(`${JSON.stringify({
    status: 'initialized',
    runId,
    candidateCommit: candidateCommit.toLowerCase(),
    executionNonce: result.executionNonce,
    expectedCount: 8,
    stagingDirectory: result.stagingDirectory,
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

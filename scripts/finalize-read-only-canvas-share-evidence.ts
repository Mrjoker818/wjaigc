import { resolve } from 'node:path';

import {
  discoverGitRepositoryRoot,
  finalizeTask7Evidence,
} from '../tests/helpers/read-only-canvas-share-evidence';
import { parseStrictCliOptions } from './read-only-canvas-share-evidence-cli';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseStrictCliOptions(argv, ['--run-id', '--commit', '--nonce'] as const);
  const runId = options['--run-id'];
  const candidateCommit = options['--commit'];
  const executionNonce = options['--nonce'];
  const repositoryRoot = await discoverGitRepositoryRoot(process.cwd());
  const rootDirectory = resolve(repositoryRoot, 'output', 'playwright', 'read-only-canvas-share-evidence');
  const result = await finalizeTask7Evidence({
    rootDirectory,
    repositoryRoot,
    runId,
    candidateCommit,
    executionNonce,
  });

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    runId,
    candidateCommit: candidateCommit.toLowerCase(),
    expectedCount: 8,
    finalDirectory: result.finalDirectory,
    manifestPath: result.manifestPath,
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

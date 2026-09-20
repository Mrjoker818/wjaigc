import { resolve } from 'node:path';

import {
  discoverGitRepositoryRoot,
  invalidateTask7EvidencePromotionLock,
} from '../tests/helpers/read-only-canvas-share-evidence';
import { parseStrictCliOptions } from './read-only-canvas-share-evidence-cli';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseStrictCliOptions(argv, ['--run-id', '--commit', '--owner'] as const);
  const repositoryRoot = await discoverGitRepositoryRoot(process.cwd());
  const result = await invalidateTask7EvidencePromotionLock({
    rootDirectory: resolve(repositoryRoot, 'output', 'playwright', 'read-only-canvas-share-evidence'),
    runId: options['--run-id'],
    candidateCommit: options['--commit'],
    expectedOwnerId: options['--owner'],
  });
  process.stdout.write(`${JSON.stringify({
    status: 'quarantined',
    runId: options['--run-id'],
    candidateCommit: options['--commit'].toLowerCase(),
    quarantinedLockPath: result.quarantinedLockPath,
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

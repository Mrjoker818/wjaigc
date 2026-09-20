import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deriveTask7CanonicalSummary,
  task7EvidenceDescriptors,
  type Task7EvidenceIdentity,
  type Task7ExpectedRequest,
} from '../helpers/read-only-canvas-share-contract';
import {
  finalizeTask7Evidence,
  initializeTask7EvidenceRun,
  task7EvidenceFilename,
  task7StagingRecordsDirectory,
  verifyCompletedTask7EvidenceRun,
  writeTask7EvidenceRecord,
  type Task7EvidenceRecord,
} from '../helpers/read-only-canvas-share-evidence';

const temporaryRoots: string[] = [];
const runId = 'round5-run';

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

async function createRepository() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'task7-round5-'));
  temporaryRoots.push(repositoryRoot);
  git(repositoryRoot, ['init', '-q']);
  git(repositoryRoot, ['config', 'user.email', 'task7@example.invalid']);
  git(repositoryRoot, ['config', 'user.name', 'Task 7 Test']);
  await writeFile(join(repositoryRoot, '.gitignore'), 'output/\n', 'utf8');
  await writeFile(join(repositoryRoot, 'tracked.txt'), 'clean\n', 'utf8');
  git(repositoryRoot, ['add', '.gitignore', 'tracked.txt']);
  git(repositoryRoot, ['commit', '-qm', 'fixture']);
  return {
    repositoryRoot,
    rootDirectory: join(repositoryRoot, 'output', 'playwright', 'read-only-canvas-share-evidence'),
    head: git(repositoryRoot, ['rev-parse', 'HEAD']).toLowerCase(),
  };
}

function materializeRequest(expected: Task7ExpectedRequest): Task7EvidenceRecord['requests'][number] {
  return {
    method: expected.method,
    origin: ':same-origin',
    pathname: expected.pathname,
    search: expected.search === 'next-build-query'
      ? '?v=1234567890'
      : expected.search === 'favicon-hash-query'
        ? '?603d046c9a6fdfbb'
        : expected.search,
    resourceType: expected.resourceType,
    navigation: expected.navigation,
    pageRole: 'primary',
    frameRole: 'main',
    range: expected.ranges[0] ?? null,
  };
}

function completeRecord(
  identity: Task7EvidenceIdentity,
  candidateCommit: string,
  executionNonce: string,
): Task7EvidenceRecord {
  const descriptor = task7EvidenceDescriptors[identity];
  const requests = descriptor.requestContract.flatMap(expected => (
    Array.from({ length: expected.count }, () => materializeRequest(expected))
  ));
  return {
    schemaVersion: 4,
    runId,
    candidateCommit,
    executionNonce,
    identity,
    scenario: descriptor.scenario,
    status: 'passed',
    startedAt: '2026-09-20T00:00:00.000Z',
    completedAt: '2026-09-20T00:00:01.000Z',
    durationMs: 1_000,
    testTitle: ['read-only canvas', identity],
    project: descriptor.project,
    viewport: { ...descriptor.viewport },
    requests,
    frameNavigations: [],
    forbiddenRequestCount: 0,
    forbiddenRequests: [],
    forbiddenFrameNavigationCount: 0,
    forbiddenFrameNavigations: [],
    consoleErrors: [],
    details: descriptor.longPress === 'required'
      ? {
          mediaLongPress: {
            nativeContextMenuSynthesized: false,
            mediaProbe: {
              touchStarts: 1,
              contextMenus: 1,
              defaultPrevented: true,
              contextTargetWasMedia: true,
              suppressClick: true,
            },
          },
        }
      : {},
  };
}

async function initializedMatrix(repository: Awaited<ReturnType<typeof createRepository>>) {
  const initialized = await initializeTask7EvidenceRun({
    ...repository,
    candidateCommit: repository.head,
    runId,
  });
  for (const identity of Object.keys(task7EvidenceDescriptors) as Task7EvidenceIdentity[]) {
    await writeTask7EvidenceRecord({
      rootDirectory: repository.rootDirectory,
      record: completeRecord(identity, repository.head, initialized.executionNonce),
    });
  }
  return initialized;
}

function options(repository: Awaited<ReturnType<typeof createRepository>>, executionNonce: string) {
  return {
    rootDirectory: repository.rootDirectory,
    repositoryRoot: repository.repositoryRoot,
    candidateCommit: repository.head,
    runId,
    executionNonce,
  };
}

async function overwriteRecord(
  repository: Awaited<ReturnType<typeof createRepository>>,
  record: Task7EvidenceRecord | Record<string, unknown>,
): Promise<void> {
  const identity = String(record.identity);
  await writeFile(
    join(task7StagingRecordsDirectory(repository.rootDirectory, repository.head, runId), task7EvidenceFilename(identity)),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );
}

describe('Task 7 canonical Round 5 semantics', () => {
  it('derives portrait native synthesis as an observation, not a pass requirement', () => {
    const record = completeRecord('mobile/mobile-320-chromium/portrait', 'a'.repeat(40), 'b'.repeat(64));
    const summary = deriveTask7CanonicalSummary(record);
    expect(summary.longPressObservation).toMatchObject({
      required: true,
      nativeContextMenuSynthesized: false,
      defaultPrevented: true,
      contextTargetWasMedia: true,
    });
  });

  it('rejects caller-supplied forged summaries and native/event-chain mismatch', async () => {
    const forgedRepository = await createRepository();
    const forgedRun = await initializedMatrix(forgedRepository);
    const identity = 'desktop/chromium/valid' as const;
    await overwriteRecord(forgedRepository, {
      ...completeRecord(identity, forgedRepository.head, forgedRun.executionNonce),
      requestContractValid: true,
      requestContract: { valid: true, errors: [], expected: [], actual: [] },
    });
    await expect(finalizeTask7Evidence(options(forgedRepository, forgedRun.executionNonce)))
      .rejects.toThrow(/schema|unrecognized|requestContract/iu);

    const nativeRepository = await createRepository();
    const nativeRun = await initializedMatrix(nativeRepository);
    const nativeIdentity = 'mobile/mobile-320-chromium/portrait' as const;
    const nativeMismatch = completeRecord(nativeIdentity, nativeRepository.head, nativeRun.executionNonce);
    nativeMismatch.details.mediaLongPress = {
      nativeContextMenuSynthesized: true,
      mediaProbe: {
        touchStarts: 1,
        contextMenus: 0,
        defaultPrevented: false,
        contextTargetWasMedia: true,
        suppressClick: true,
      },
    };
    await overwriteRecord(nativeRepository, nativeMismatch);
    await expect(finalizeTask7Evidence(options(nativeRepository, nativeRun.executionNonce)))
      .rejects.toThrow(/long.?press|event chain|context/iu);
  });
});

describe('Task 7 append-only completion-marker publication', () => {
  it('publishes exact bytes, a digest manifest, a permanent owner, and a verified completion marker', async () => {
    const repository = await createRepository();
    const initialized = await initializedMatrix(repository);
    const sourcePath = join(
      task7StagingRecordsDirectory(repository.rootDirectory, repository.head, runId),
      task7EvidenceFilename('desktop/chromium/valid'),
    );
    const sourceBytes = await readFile(sourcePath);
    const result = await finalizeTask7Evidence({
      ...options(repository, initialized.executionNonce),
      hooks: {
        afterSourceValidation: async () => writeFile(sourcePath, '{"replaced":true}\n', 'utf8'),
      },
    });
    expect(await readdir(result.finalDirectory)).toEqual(['complete.json', 'manifest.json', 'owner.json', 'records']);
    const promotedBytes = await readFile(join(result.finalDirectory, 'records', task7EvidenceFilename('desktop/chromium/valid')));
    expect(promotedBytes.equals(sourceBytes)).toBe(true);
    const marker = JSON.parse(await readFile(result.completionMarkerPath, 'utf8')) as { manifestSha256: string };
    expect(marker.manifestSha256).toBe(createHash('sha256').update(await readFile(result.manifestPath)).digest('hex'));
    const verified = await verifyCompletedTask7EvidenceRun(options(repository, initialized.executionNonce));
    expect(verified.completionMarkerPath).toBe(result.completionMarkerPath);
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      nativeContextMenuSynthesis: { observedTrue: number; observedFalse: number; portraitTotal: number };
    };
    expect(manifest.nativeContextMenuSynthesis).toEqual({ observedTrue: 0, observedFalse: 3, portraitTotal: 3 });
  });

  it('leaves an immutable incomplete run when owner or tree is replaced before completion', async () => {
    const ownerRepository = await createRepository();
    const ownerRun = await initializedMatrix(ownerRepository);
    let ownerFinal = '';
    await expect(finalizeTask7Evidence({
      ...options(ownerRepository, ownerRun.executionNonce),
      hooks: {
        afterClaimCreated: async ({ finalDirectory, ownerMarkerPath }) => {
          ownerFinal = finalDirectory;
          await unlink(ownerMarkerPath);
          await writeFile(ownerMarkerPath, '{"ownerId":"foreign"}\n', 'utf8');
        },
      },
    })).rejects.toThrow(/owner|claim/iu);
    await expect(readFile(join(ownerFinal, 'complete.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(finalizeTask7Evidence(options(ownerRepository, ownerRun.executionNonce))).rejects.toThrow(/exist|claimed|consumed/iu);

    const treeRepository = await createRepository();
    const treeRun = await initializedMatrix(treeRepository);
    let treeFinal = '';
    await expect(finalizeTask7Evidence({
      ...options(treeRepository, treeRun.executionNonce),
      hooks: {
        beforeCompletionMarker: async ({ finalDirectory }) => {
          treeFinal = finalDirectory;
          await writeFile(join(finalDirectory, 'unexpected.txt'), 'mutated\n', 'utf8');
        },
      },
    })).rejects.toThrow(/unexpected|tree|entry/iu);
    await expect(readFile(join(treeFinal, 'complete.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows exactly one publisher and rejects a destination created by a competitor', async () => {
    const repository = await createRepository();
    const initialized = await initializedMatrix(repository);
    const finalizers = await Promise.allSettled([
      finalizeTask7Evidence(options(repository, initialized.executionNonce)),
      finalizeTask7Evidence(options(repository, initialized.executionNonce)),
    ]);
    expect(finalizers.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(finalizers.filter(result => result.status === 'rejected')).toHaveLength(1);

    const competitorRepository = await createRepository();
    const competitorRun = await initializedMatrix(competitorRepository);
    const finalDirectory = join(competitorRepository.rootDirectory, 'promoted', competitorRepository.head, runId);
    await mkdir(finalDirectory, { recursive: true });
    await expect(finalizeTask7Evidence(options(competitorRepository, competitorRun.executionNonce)))
      .rejects.toThrow(/exist|claimed|consumed/iu);
    expect(await readdir(finalDirectory)).toEqual([]);
  }, 20_000);

  it('detects final-tree mutation immediately after completion marker', async () => {
    const repository = await createRepository();
    const initialized = await initializedMatrix(repository);
    let finalDirectory = '';
    await expect(finalizeTask7Evidence({
      ...options(repository, initialized.executionNonce),
      hooks: {
        afterCompletionMarker: async paths => {
          finalDirectory = paths.finalDirectory;
          await writeFile(paths.manifestPath, '{"mutated":true}\n', 'utf8');
        },
      },
    })).rejects.toThrow(/manifest|digest|schema/iu);
    await expect(verifyCompletedTask7EvidenceRun(options(repository, initialized.executionNonce)))
      .rejects.toThrow(/manifest|digest|schema/iu);
    expect(await readdir(finalDirectory)).toContain('complete.json');
  });
});

describe('Task 7 Git state gates', () => {
  it('rejects non-ignored untracked files and permits ignored evidence artifacts', async () => {
    const repository = await createRepository();
    await writeFile(join(repository.repositoryRoot, 'untracked.config'), 'unsafe\n', 'utf8');
    await expect(initializeTask7EvidenceRun({
      ...repository,
      candidateCommit: repository.head,
      runId,
    })).rejects.toThrow(/untracked|dirty/iu);
    await unlink(join(repository.repositoryRoot, 'untracked.config'));
    await mkdir(repository.rootDirectory, { recursive: true });
    await writeFile(join(repository.rootDirectory, 'ignored.json'), '{}\n', 'utf8');
    await expect(initializeTask7EvidenceRun({
      ...repository,
      candidateCommit: repository.head,
      runId,
    })).resolves.toMatchObject({ executionNonce: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  });

  it.each(['dirty', 'head'] as const)('rechecks %s immediately before completion', async mutation => {
    const repository = await createRepository();
    const initialized = await initializedMatrix(repository);
    let finalDirectory = '';
    await expect(finalizeTask7Evidence({
      ...options(repository, initialized.executionNonce),
      hooks: {
        beforeCompletionMarker: async paths => {
          finalDirectory = paths.finalDirectory;
          if (mutation === 'dirty') {
            await writeFile(join(repository.repositoryRoot, 'tracked.txt'), 'dirty\n', 'utf8');
          } else {
            git(repository.repositoryRoot, ['commit', '--allow-empty', '-qm', 'move HEAD']);
          }
        },
      },
    })).rejects.toThrow(/dirty|HEAD|candidate commit/iu);
    await expect(readFile(join(finalDirectory, 'complete.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

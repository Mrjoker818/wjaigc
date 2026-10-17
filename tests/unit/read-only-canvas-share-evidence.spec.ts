import { mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTask7EvidenceRepositoryFixture,
  type Task7EvidenceRepository,
  type Task7EvidenceRepositoryFixture,
} from '../helpers/task7-evidence-repository-fixture';

import {
  finalizeTask7Evidence,
  initializeTask7EvidenceRun,
  task7EvidenceDescriptors,
  task7EvidenceFilename,
  task7StagingRecordsDirectory,
  writeTask7EvidenceRecord,
  type Task7EvidenceRecord,
  type Task7ExpectedRequest,
} from '../helpers/read-only-canvas-share-evidence';

let repositoryFixture: Promise<Task7EvidenceRepositoryFixture> | undefined;
const runId = 'run-001';

beforeAll(async (): Promise<void> => {
  // Retain ownership before awaiting: a timed-out hook does not cancel initialization.
  repositoryFixture = createTask7EvidenceRepositoryFixture();
  await repositoryFixture;
});
afterAll(async (): Promise<void> => {
  const settled = await repositoryFixture;
  await settled?.dispose();
});

async function createRepository(): Promise<Task7EvidenceRepository> {
  if (!repositoryFixture) throw new Error('TASK7_REPOSITORY_FIXTURE_NOT_STARTED');
  return (await repositoryFixture).createRepository();
}

function materializeRequest(expected: Task7ExpectedRequest): Task7EvidenceRecord['requests'][number] {
  const search = expected.search === 'next-build-query'
    ? '?v=1234567890'
    : expected.search === 'favicon-hash-query'
      ? '?603d046c9a6fdfbb'
      : expected.search;
  return {
    method: expected.method,
    origin: ':same-origin',
    pathname: expected.pathname,
    search,
    resourceType: expected.resourceType,
    navigation: expected.navigation,
    pageRole: 'primary',
    frameRole: 'main',
    range: expected.ranges[0] ?? null,
  };
}

function completeRecord(
  identity: keyof typeof task7EvidenceDescriptors,
  executionNonce: string,
  candidateCommit: string,
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

async function initialize(repository: Awaited<ReturnType<typeof createRepository>>) {
  return initializeTask7EvidenceRun({
    rootDirectory: repository.rootDirectory,
    repositoryRoot: repository.repositoryRoot,
    candidateCommit: repository.head,
    runId,
  });
}

async function writeMatrix(
  repository: Awaited<ReturnType<typeof createRepository>>,
  executionNonce: string,
): Promise<void> {
  for (const identity of Object.keys(task7EvidenceDescriptors) as Array<keyof typeof task7EvidenceDescriptors>) {
    await writeTask7EvidenceRecord({
      rootDirectory: repository.rootDirectory,
      record: completeRecord(identity, executionNonce, repository.head),
    });
  }
}

function finalizeOptions(repository: Awaited<ReturnType<typeof createRepository>>, executionNonce: string) {
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
  identity: keyof typeof task7EvidenceDescriptors,
  record: Task7EvidenceRecord,
): Promise<void> {
  const recordPath = join(
    task7StagingRecordsDirectory(repository.rootDirectory, repository.head, runId),
    task7EvidenceFilename(identity),
  );
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

describe('Task 7 trusted semantic evidence validation', () => {
  it.each(['.', '..', 'a/b', 'a\\b', 'C:\\absolute', '\\\\server\\share', 'line\nbreak', 'CON', '/absolute'])(
    'rejects unsafe run id %j',
    unsafeRunId => {
      expect(() => task7StagingRecordsDirectory('C:/evidence', 'a'.repeat(40), unsafeRunId)).toThrow(/run id/iu);
    },
  );

  it.each([
    ['scenario', (record: Task7EvidenceRecord) => ({ ...record, scenario: 'desktop-invalid' as const })],
    ['project', (record: Task7EvidenceRecord) => ({ ...record, project: 'forged-project' })],
    ['viewport', (record: Task7EvidenceRecord) => ({ ...record, viewport: { width: 1, height: 1 } })],
    ['zero requests', (record: Task7EvidenceRecord) => ({ ...record, requests: [] })],
  ])('rejects a valid identity with forged %s despite passing summaries', async (_label, mutate) => {
    const repository = await createRepository();
    const initialized = await initialize(repository);
    await writeMatrix(repository, initialized.executionNonce);
    const identity = 'desktop/chromium/valid' as const;
    await overwriteRecord(repository, identity, mutate(completeRecord(identity, initialized.executionNonce, repository.head)));
    await expect(finalizeTask7Evidence(finalizeOptions(repository, initialized.executionNonce)))
      .rejects.toThrow(/semantic|descriptor|request contract/iu);
  });

  it.each([
    ['invalid timestamp', { startedAt: 'not-a-date' }],
    ['reverse timestamps', { startedAt: '2026-09-20T00:00:02.000Z', completedAt: '2026-09-20T00:00:01.000Z' }],
    ['insane duration', { durationMs: 99_999_999 }],
  ])('rejects %s', async (_label, override) => {
    const repository = await createRepository();
    const initialized = await initialize(repository);
    await writeMatrix(repository, initialized.executionNonce);
    const identity = 'desktop/chromium/valid' as const;
    await overwriteRecord(repository, identity, { ...completeRecord(identity, initialized.executionNonce, repository.head), ...override });
    await expect(finalizeTask7Evidence(finalizeOptions(repository, initialized.executionNonce))).rejects.toThrow();
  });

  it.each([
    ['portrait missing probe', 'mobile/mobile-320-chromium/portrait', {}],
    ['portrait target mismatch', 'mobile/mobile-375-chromium/portrait', {
      mediaLongPress: {
        nativeContextMenuSynthesized: false,
        mediaProbe: { touchStarts: 1, contextMenus: 1, defaultPrevented: true, contextTargetWasMedia: false, suppressClick: true },
      },
    }],
    ['desktop unexpected probe', 'desktop/chromium/valid', {
      mediaLongPress: {
        nativeContextMenuSynthesized: false,
        mediaProbe: { touchStarts: 1, contextMenus: 1, defaultPrevented: true, contextTargetWasMedia: true, suppressClick: true },
      },
    }],
  ])('rejects %s', async (_label, identityValue, details) => {
    const repository = await createRepository();
    const initialized = await initialize(repository);
    await writeMatrix(repository, initialized.executionNonce);
    const identity = identityValue as keyof typeof task7EvidenceDescriptors;
    await overwriteRecord(repository, identity, { ...completeRecord(identity, initialized.executionNonce, repository.head), details });
    await expect(finalizeTask7Evidence(finalizeOptions(repository, initialized.executionNonce)))
      .rejects.toThrow(/long.?press|media probe/iu);
  });

  it('rejects an arbitrary 40-hex commit and dirty tracked/index state while permitting ignored artifacts', async () => {
    const repository = await createRepository();
    await expect(initializeTask7EvidenceRun({
      rootDirectory: repository.rootDirectory,
      repositoryRoot: repository.repositoryRoot,
      candidateCommit: 'a'.repeat(40),
      runId,
    })).rejects.toThrow(/HEAD|candidate commit/iu);

    await writeFile(join(repository.repositoryRoot, 'tracked.txt'), 'dirty\n', 'utf8');
    await expect(initialize(repository)).rejects.toThrow(/dirty/iu);
    await writeFile(join(repository.repositoryRoot, 'tracked.txt'), 'clean\n', 'utf8');
    await mkdir(repository.rootDirectory, { recursive: true });
    await writeFile(join(repository.rootDirectory, 'ignored.txt'), 'allowed\n', 'utf8');
    await expect(initialize(repository)).resolves.toMatchObject({ executionNonce: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  });

  it('rejects unexpected entries, malformed nested records, duplicate identities, and record symlinks', async () => {
    const extraRepository = await createRepository();
    const extraRun = await initialize(extraRepository);
    await writeMatrix(extraRepository, extraRun.executionNonce);
    await writeFile(join(
      task7StagingRecordsDirectory(extraRepository.rootDirectory, extraRepository.head, runId),
      'unexpected.txt',
    ), 'unexpected\n', 'utf8');
    await expect(finalizeTask7Evidence(finalizeOptions(extraRepository, extraRun.executionNonce)))
      .rejects.toThrow(/unexpected directory entry/iu);

    const malformedRepository = await createRepository();
    const malformedRun = await initialize(malformedRepository);
    await writeMatrix(malformedRepository, malformedRun.executionNonce);
    const malformedIdentity = 'desktop/chromium/valid' as const;
    await overwriteRecord(malformedRepository, malformedIdentity, {
      ...completeRecord(malformedIdentity, malformedRun.executionNonce, malformedRepository.head),
      requests: [{ method: 7 }],
    } as unknown as Task7EvidenceRecord);
    await expect(finalizeTask7Evidence(finalizeOptions(malformedRepository, malformedRun.executionNonce)))
      .rejects.toThrow(/invalid evidence record schema/iu);

    const duplicateRepository = await createRepository();
    const duplicateRun = await initialize(duplicateRepository);
    await writeMatrix(duplicateRepository, duplicateRun.executionNonce);
    const sourceIdentity = 'desktop/chromium/invalid' as const;
    const targetIdentity = 'desktop/chromium/valid' as const;
    await overwriteRecord(
      duplicateRepository,
      targetIdentity,
      completeRecord(sourceIdentity, duplicateRun.executionNonce, duplicateRepository.head),
    );
    await expect(finalizeTask7Evidence(finalizeOptions(duplicateRepository, duplicateRun.executionNonce)))
      .rejects.toThrow(/duplicate evidence identity/iu);

    const symlinkRepository = await createRepository();
    const symlinkRun = await initialize(symlinkRepository);
    await writeMatrix(symlinkRepository, symlinkRun.executionNonce);
    const symlinkIdentity = 'desktop/chromium/valid' as const;
    const recordPath = join(
      task7StagingRecordsDirectory(symlinkRepository.rootDirectory, symlinkRepository.head, runId),
      task7EvidenceFilename(symlinkIdentity),
    );
    const external = join(symlinkRepository.rootDirectory, 'external.json');
    await writeFile(external, await readFile(recordPath));
    await unlink(recordPath);
    await symlink(external, recordPath, 'file');
    await expect(finalizeTask7Evidence(finalizeOptions(symlinkRepository, symlinkRun.executionNonce)))
      .rejects.toThrow(/regular file|link|reparse/iu);
  }, 20_000);
});

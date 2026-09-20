import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  finalizeTask7Evidence,
  initializeTask7EvidenceRun,
  task7EvidenceFilename,
  task7StagingRecordsDirectory,
  writeTask7EvidenceRecord,
  type Task7EvidenceRecord,
} from '../helpers/read-only-canvas-share-evidence';

const temporaryRoots: string[] = [];
const validCommit = 'a'.repeat(40);
const runId = 'run-001';

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'task7-evidence-'));
  temporaryRoots.push(root);
  return root;
}

function completeRecord(identity: string, executionNonce: string): Task7EvidenceRecord {
  return {
    schemaVersion: 3,
    runId,
    candidateCommit: validCommit,
    executionNonce,
    identity,
    scenario: 'desktop-invalid',
    status: 'passed',
    startedAt: '2026-09-20T00:00:00.000Z',
    completedAt: '2026-09-20T00:00:01.000Z',
    testTitle: ['read-only canvas', identity],
    project: 'chromium',
    viewport: { width: 1280, height: 720 },
    requests: [],
    frameNavigations: [],
    apiRequests: [],
    forbiddenRequestCount: 0,
    forbiddenRequests: [],
    forbiddenFrameNavigationCount: 0,
    forbiddenFrameNavigations: [],
    requestContractValid: true,
    requestContract: { valid: true, errors: [], expected: [], actual: [] },
    consoleErrors: [],
    details: {},
  };
}

async function initialize(rootDirectory: string, expectedIdentities = ['desktop/valid']) {
  return initializeTask7EvidenceRun({
    rootDirectory,
    candidateCommit: validCommit,
    runId,
    expectedIdentities,
  });
}

async function writeValidRecord(rootDirectory: string, identity: string, nonce: string): Promise<void> {
  await writeTask7EvidenceRecord({ rootDirectory, record: completeRecord(identity, nonce) });
}

async function manualRecordPath(rootDirectory: string, identity: string): Promise<string> {
  return join(task7StagingRecordsDirectory(rootDirectory, validCommit, runId), task7EvidenceFilename(identity));
}

describe('Task 7 evidence path hardening', () => {
  it.each(['abc12345', 'g'.repeat(40), `${'a'.repeat(39)}/`, 'a'.repeat(41), ` ${'a'.repeat(40)}`])(
    'rejects non-40-hex candidate commit %j',
    candidateCommit => {
      expect(() => task7StagingRecordsDirectory('C:/evidence', candidateCommit, runId)).toThrow(/40.*hex/iu);
    },
  );

  it('normalizes a valid uppercase candidate commit', () => {
    expect(task7StagingRecordsDirectory('C:/evidence', validCommit.toUpperCase(), runId))
      .toContain(join('staging', validCommit, runId, 'records'));
  });

  it.each([
    '.', '..', 'segment..segment', 'a/b', 'a\\b', 'C:\\absolute', '\\\\server\\share',
    'line\nbreak', ' CON', 'CON', 'nul.txt', '/absolute',
  ])('rejects unsafe run id %j', unsafeRunId => {
    expect(() => task7StagingRecordsDirectory('C:/evidence', validCommit, unsafeRunId)).toThrow(/run id/iu);
  });

  it('encodes an identity with traversal text into one contained regular filename', async () => {
    const rootDirectory = await createRoot();
    const identity = '../../outside';
    const initialized = await initialize(rootDirectory, [identity]);
    const { recordPath } = await writeTask7EvidenceRecord({
      rootDirectory,
      record: completeRecord(identity, initialized.executionNonce),
    });
    const records = await realpath(task7StagingRecordsDirectory(rootDirectory, validCommit, runId));
    expect(relative(records, recordPath)).not.toMatch(/^\.\./u);
    expect(task7EvidenceFilename(identity)).not.toMatch(/[\\/]/u);
  });
});

describe('Task 7 exclusive evidence lifecycle', () => {
  it('exclusively initializes a fresh run with a cryptographic nonce', async () => {
    const rootDirectory = await createRoot();
    const options = { rootDirectory, candidateCommit: validCommit.toUpperCase(), runId, expectedIdentities: ['desktop/valid'] };
    const initialized = await initializeTask7EvidenceRun(options);
    expect(initialized.executionNonce).toMatch(/^[a-f0-9]{64}$/u);
    await expect(initializeTask7EvidenceRun(options)).rejects.toThrow(/already initialized/iu);
  });

  it('binds writes and finalization to commit, run id, nonce, and expected identities', async () => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    await expect(writeTask7EvidenceRecord({
      rootDirectory,
      record: completeRecord('desktop/valid', 'b'.repeat(64)),
    })).rejects.toThrow(/nonce/iu);
    await writeValidRecord(rootDirectory, 'desktop/valid', initialized.executionNonce);
    await expect(finalizeTask7Evidence({
      rootDirectory,
      candidateCommit: validCommit,
      runId,
      executionNonce: 'b'.repeat(64),
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/nonce/iu);
  });

  it('prevents a partial retry from overwriting an existing identity', async () => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    await writeValidRecord(rootDirectory, 'desktop/valid', initialized.executionNonce);
    await expect(writeValidRecord(rootDirectory, 'desktop/valid', initialized.executionNonce))
      .rejects.toThrow(/already written/iu);
  });

  it('promotes only a complete exact passing run with root-relative metadata', async () => {
    const rootDirectory = await createRoot();
    const identities = ['desktop/valid', 'mobile/portrait'];
    const initialized = await initialize(rootDirectory, identities);
    await writeValidRecord(rootDirectory, identities[0], initialized.executionNonce);
    await writeValidRecord(rootDirectory, identities[1], initialized.executionNonce);
    const result = await finalizeTask7Evidence({
      rootDirectory,
      candidateCommit: validCommit,
      runId,
      executionNonce: initialized.executionNonce,
      expectedIdentities: identities,
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      stagingRecords: string;
      expectedCount: number;
      executedCount: number;
      records: Array<{ identity: string; status: string }>;
    };
    expect(manifest).toMatchObject({ expectedCount: 2, executedCount: 2 });
    expect(manifest.records).toEqual([
      { identity: 'desktop/valid', status: 'passed' },
      { identity: 'mobile/portrait', status: 'passed' },
    ]);
    expect(isAbsolute(manifest.stagingRecords)).toBe(false);
    expect(manifest.stagingRecords).toBe(`staging/${validCommit}/${runId}/records`);
  });

  it('serializes concurrent promotion and rejects a later double promotion', async () => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    await writeValidRecord(rootDirectory, 'desktop/valid', initialized.executionNonce);
    const options = {
      rootDirectory,
      candidateCommit: validCommit,
      runId,
      executionNonce: initialized.executionNonce,
      expectedIdentities: ['desktop/valid'],
    };
    const results = await Promise.allSettled([finalizeTask7Evidence(options), finalizeTask7Evidence(options)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(finalizeTask7Evidence(options)).rejects.toThrow(/already exists/iu);
    expect(await readdir(join(rootDirectory, 'promoted', validCommit))).toEqual([runId]);
  });

  it('never removes a promotion lock owned by another finalizer', async () => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    await writeValidRecord(rootDirectory, 'desktop/valid', initialized.executionNonce);
    const promotedParent = join(rootDirectory, 'promoted', validCommit);
    await mkdir(promotedParent, { recursive: true });
    const lockPath = join(promotedParent, `${runId}.lock`);
    await writeFile(lockPath, 'other-finalizer\n', 'utf8');

    await expect(finalizeTask7Evidence({
      rootDirectory,
      candidateCommit: validCommit,
      runId,
      executionNonce: initialized.executionNonce,
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/already in progress/iu);
    expect(await readFile(lockPath, 'utf8')).toBe('other-finalizer\n');
  });
});

describe('Task 7 complete runtime record validation', () => {
  it.each([
    ['null scenario', { scenario: null }],
    ['numeric project', { project: 7 }],
    ['string requestContractValid', { requestContractValid: 'true' }],
    ['malformed nested request', { requests: [{ method: 7 }] }],
    ['malformed nested contract', { requestContract: { valid: true, errors: [], expected: [{ label: 7, count: 1 }], actual: [] } }],
    ['forbidden count mismatch', { forbiddenRequestCount: 1 }],
  ])('rejects %s', async (_label, override) => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    const recordPath = await manualRecordPath(rootDirectory, 'desktop/valid');
    await writeFile(recordPath, JSON.stringify({
      ...completeRecord('desktop/valid', initialized.executionNonce),
      ...override,
    }), 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory,
      candidateCommit: validCommit,
      runId,
      executionNonce: initialized.executionNonce,
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/invalid evidence record schema/iu);
  });

  it.each([
    ['failed', { status: 'failed' }],
    ['stale run', { runId: 'stale-run' }],
    ['stale commit', { candidateCommit: 'b'.repeat(40) }],
    ['stale nonce', { executionNonce: 'b'.repeat(64) }],
    ['invalid contract', { requestContractValid: false, requestContract: { valid: false, errors: ['bad'], expected: [], actual: [] } }],
  ])('refuses a fully formed but non-promotable %s record', async (_label, override) => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    await writeFile(await manualRecordPath(rootDirectory, 'desktop/valid'), JSON.stringify({
      ...completeRecord('desktop/valid', initialized.executionNonce),
      ...override,
    }), 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory,
      candidateCommit: validCommit,
      runId,
      executionNonce: initialized.executionNonce,
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow();
  });
});

describe('Task 7 staging directory audit', () => {
  it('rejects missing and unexpected records', async () => {
    const missingRoot = await createRoot();
    const missing = await initialize(missingRoot, ['desktop/valid', 'mobile/portrait']);
    await writeValidRecord(missingRoot, 'desktop/valid', missing.executionNonce);
    await expect(finalizeTask7Evidence({
      rootDirectory: missingRoot,
      candidateCommit: validCommit,
      runId,
      executionNonce: missing.executionNonce,
      expectedIdentities: ['desktop/valid', 'mobile/portrait'],
    })).rejects.toThrow(/missing.*mobile\/portrait/iu);

    const extraRoot = await createRoot();
    const extra = await initialize(extraRoot);
    await writeValidRecord(extraRoot, 'desktop/valid', extra.executionNonce);
    await writeFile(join(task7StagingRecordsDirectory(extraRoot, validCommit, runId), 'stale.txt'), 'stale', 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory: extraRoot,
      candidateCommit: validCommit,
      runId,
      executionNonce: extra.executionNonce,
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/unexpected directory entry.*stale\.txt/iu);
  });

  it('rejects a wrong filename, malformed JSON, and duplicate identity', async () => {
    const wrongRoot = await createRoot();
    const wrong = await initialize(wrongRoot);
    await writeFile(join(task7StagingRecordsDirectory(wrongRoot, validCommit, runId), 'wrong-name.json'), '{}', 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory: wrongRoot, candidateCommit: validCommit, runId,
      executionNonce: wrong.executionNonce, expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/unexpected directory entry.*wrong-name/iu);

    const malformedRoot = await createRoot();
    const malformed = await initialize(malformedRoot);
    await writeFile(await manualRecordPath(malformedRoot, 'desktop/valid'), '{', 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory: malformedRoot, candidateCommit: validCommit, runId,
      executionNonce: malformed.executionNonce, expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/malformed JSON/iu);

    const duplicateRoot = await createRoot();
    const duplicate = await initialize(duplicateRoot, ['desktop/valid', 'mobile/portrait']);
    const duplicateRecord = completeRecord('desktop/valid', duplicate.executionNonce);
    await writeFile(await manualRecordPath(duplicateRoot, 'desktop/valid'), JSON.stringify(duplicateRecord), 'utf8');
    await writeFile(await manualRecordPath(duplicateRoot, 'mobile/portrait'), JSON.stringify(duplicateRecord), 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory: duplicateRoot, candidateCommit: validCommit, runId,
      executionNonce: duplicate.executionNonce, expectedIdentities: ['desktop/valid', 'mobile/portrait'],
    })).rejects.toThrow(/duplicate evidence identity/iu);
  });

  it('rejects symlinks and directories where regular records are required', async () => {
    const symlinkRoot = await createRoot();
    const linked = await initialize(symlinkRoot);
    const externalRecord = join(symlinkRoot, 'external.json');
    await writeFile(externalRecord, JSON.stringify(completeRecord('desktop/valid', linked.executionNonce)), 'utf8');
    await symlink(externalRecord, await manualRecordPath(symlinkRoot, 'desktop/valid'), 'file');
    await expect(finalizeTask7Evidence({
      rootDirectory: symlinkRoot, candidateCommit: validCommit, runId,
      executionNonce: linked.executionNonce, expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/symbolic link|reparse/iu);

    const directoryRoot = await createRoot();
    const directory = await initialize(directoryRoot);
    await mkdir(await manualRecordPath(directoryRoot, 'desktop/valid'));
    await expect(finalizeTask7Evidence({
      rootDirectory: directoryRoot, candidateCommit: validCommit, runId,
      executionNonce: directory.executionNonce, expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/regular file/iu);
  });

  it('leaves no final-looking temp or lock entry after promotion validation failure', async () => {
    const rootDirectory = await createRoot();
    const initialized = await initialize(rootDirectory);
    await writeFile(await manualRecordPath(rootDirectory, 'desktop/valid'), JSON.stringify({
      ...completeRecord('desktop/valid', initialized.executionNonce),
      status: 'failed',
    }), 'utf8');
    await expect(finalizeTask7Evidence({
      rootDirectory, candidateCommit: validCommit, runId,
      executionNonce: initialized.executionNonce, expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/status.*failed/iu);
    const promoted = join(rootDirectory, 'promoted', validCommit);
    expect(await readdir(promoted).catch(() => [])).toEqual([]);
  });
});

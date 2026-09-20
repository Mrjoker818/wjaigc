import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  finalizeTask7Evidence,
  task7StagingRecordsDirectory,
  type Task7EvidenceRecord,
} from '../helpers/read-only-canvas-share-evidence';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'task7-evidence-'));
  temporaryRoots.push(root);
  return root;
}

async function writeRecord(
  rootDirectory: string,
  identity: string,
  overrides: Partial<Task7EvidenceRecord> = {},
): Promise<void> {
  const record: Task7EvidenceRecord = {
    schemaVersion: 2,
    runId: 'run-001',
    candidateCommit: 'abc12345',
    identity,
    scenario: identity,
    status: 'passed',
    project: 'chromium',
    forbiddenRequestCount: 0,
    requestContractValid: true,
    ...overrides,
  };
  const recordsDirectory = task7StagingRecordsDirectory(rootDirectory, 'abc12345', 'run-001');
  await mkdir(recordsDirectory, { recursive: true });
  await writeFile(join(recordsDirectory, `${identity.replaceAll('/', '-')}.json`), JSON.stringify(record), 'utf8');
}

describe('Task 7 evidence promotion', () => {
  it('atomically promotes only a complete, exact, passing run', async () => {
    const rootDirectory = await createRoot();
    await writeRecord(rootDirectory, 'desktop/valid');
    await writeRecord(rootDirectory, 'mobile/portrait');

    const result = await finalizeTask7Evidence({
      rootDirectory,
      runId: 'run-001',
      candidateCommit: 'abc12345',
      expectedIdentities: ['desktop/valid', 'mobile/portrait'],
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
      status: string;
      runId: string;
      candidateCommit: string;
      expectedCount: number;
      executedCount: number;
      records: Array<{ identity: string; status: string }>;
    };

    expect(result.finalDirectory).toContain(join('promoted', 'abc12345', 'run-001'));
    expect(manifest).toMatchObject({
      status: 'passed',
      runId: 'run-001',
      candidateCommit: 'abc12345',
      expectedCount: 2,
      executedCount: 2,
    });
    expect(manifest.records).toEqual([
      { identity: 'desktop/valid', status: 'passed' },
      { identity: 'mobile/portrait', status: 'passed' },
    ]);
  });

  it.each([
    ['missing record', ['desktop/valid', 'mobile/portrait'], /missing.*mobile\/portrait/iu],
    ['extra record', ['desktop/valid'], /extra.*mobile\/portrait/iu],
  ])('refuses %s without publishing a final directory', async (_label, expectedIdentities, error) => {
    const rootDirectory = await createRoot();
    await writeRecord(rootDirectory, 'desktop/valid');
    if (String(_label).startsWith('extra')) await writeRecord(rootDirectory, 'mobile/portrait');

    await expect(finalizeTask7Evidence({
      rootDirectory,
      runId: 'run-001',
      candidateCommit: 'abc12345',
      expectedIdentities,
    })).rejects.toThrow(error as RegExp);
    await expect(readFile(join(rootDirectory, 'promoted', 'abc12345', 'run-001', 'manifest.json'), 'utf8')).rejects.toThrow();
  });

  it.each([
    ['failed status', { status: 'failed' as const }, /status.*failed/iu],
    ['wrong run id', { runId: 'stale-run' }, /run id/iu],
    ['wrong candidate commit', { candidateCommit: 'stale-commit' }, /candidate commit/iu],
    ['invalid schema', { schemaVersion: 1 as 2 }, /invalid evidence record schema/iu],
    ['request contract failure', { requestContractValid: false }, /request contract/iu],
    ['forbidden request', { forbiddenRequestCount: 1 }, /forbidden request/iu],
  ])('refuses %s', async (_label, overrides, error) => {
    const rootDirectory = await createRoot();
    await writeRecord(rootDirectory, 'desktop/valid', overrides);

    await expect(finalizeTask7Evidence({
      rootDirectory,
      runId: 'run-001',
      candidateCommit: 'abc12345',
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(error as RegExp);
  });

  it('isolates stale records from another run and never overwrites an existing promotion', async () => {
    const rootDirectory = await createRoot();
    await writeRecord(rootDirectory, 'desktop/valid');
    const staleDirectory = task7StagingRecordsDirectory(rootDirectory, 'abc12345', 'old-run');
    await mkdir(staleDirectory, { recursive: true });
    await writeFile(join(staleDirectory, 'stale.json'), JSON.stringify({ status: 'passed' }), 'utf8');

    await finalizeTask7Evidence({
      rootDirectory,
      runId: 'run-001',
      candidateCommit: 'abc12345',
      expectedIdentities: ['desktop/valid'],
    });
    await expect(finalizeTask7Evidence({
      rootDirectory,
      runId: 'run-001',
      candidateCommit: 'abc12345',
      expectedIdentities: ['desktop/valid'],
    })).rejects.toThrow(/already exists/iu);
  });
});

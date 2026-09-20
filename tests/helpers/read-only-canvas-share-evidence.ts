export type Task7EvidenceStatus = 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'unexpected';

export interface Task7EvidenceRecord {
  schemaVersion: 2;
  runId: string;
  candidateCommit: string;
  identity: string;
  scenario: string;
  status: Task7EvidenceStatus;
  project: string;
  forbiddenRequestCount: number;
  requestContractValid: boolean;
}

export interface FinalizeTask7EvidenceOptions {
  rootDirectory: string;
  runId: string;
  candidateCommit: string;
  expectedIdentities: string[];
}

export interface FinalizedTask7Evidence {
  finalDirectory: string;
  manifestPath: string;
}

export const task7ChromiumMatrixIdentities = [
  'desktop/chromium/valid',
  'desktop/chromium/invalid',
  'desktop/chromium/download-off',
  'desktop/chromium/download-on',
  'mobile/mobile-320-chromium/portrait',
  'mobile/mobile-375-chromium/portrait',
  'mobile/mobile-393-chromium/portrait',
  'mobile/mobile-chromium/landscape',
] as const;

interface Task7EvidenceManifest {
  schemaVersion: 1;
  kind: 'read-only-canvas-share-matrix';
  status: 'passed';
  runId: string;
  candidateCommit: string;
  expectedCount: number;
  executedCount: number;
  expectedIdentities: string[];
  records: Array<{ identity: string; status: 'passed' }>;
  stagingDirectory: string;
  promotedAt: string;
}

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^[a-zA-Z0-9._-]+$/u.test(trimmed)) {
    throw new Error(`${label} must contain only letters, digits, dot, underscore, or hyphen`);
  }
  return trimmed;
}

export function task7StagingRecordsDirectory(
  rootDirectory: string,
  candidateCommit: string,
  runId: string,
): string {
  return resolve(
    rootDirectory,
    'staging',
    safeSegment(candidateCommit, 'candidate commit'),
    safeSegment(runId, 'run id'),
    'records',
  );
}

export async function finalizeTask7Evidence(
  options: FinalizeTask7EvidenceOptions,
): Promise<FinalizedTask7Evidence> {
  const candidateCommit = safeSegment(options.candidateCommit, 'candidate commit');
  const runId = safeSegment(options.runId, 'run id');
  const expectedIdentities = [...options.expectedIdentities].sort();
  if (expectedIdentities.length === 0 || new Set(expectedIdentities).size !== expectedIdentities.length) {
    throw new Error('expected identities must be non-empty and unique');
  }

  const stagingDirectory = task7StagingRecordsDirectory(
    options.rootDirectory,
    candidateCommit,
    runId,
  );
  let filenames: string[];
  try {
    filenames = (await readdir(stagingDirectory)).filter(filename => filename.endsWith('.json')).sort();
  } catch (error) {
    throw new Error(`missing staging directory for run id ${runId}`, { cause: error });
  }

  const records = await Promise.all(filenames.map(async filename => {
    const raw = await readFile(join(stagingDirectory, filename), 'utf8');
    return { filename, record: JSON.parse(raw) as Task7EvidenceRecord };
  }));
  const identityCounts = new Map<string, number>();
  for (const { filename, record } of records) {
    if (record.schemaVersion !== 2 || typeof record.identity !== 'string' || record.identity.length === 0) {
      throw new Error(`invalid evidence record schema: ${filename}`);
    }
    identityCounts.set(record.identity, (identityCounts.get(record.identity) ?? 0) + 1);
  }
  const duplicates = [...identityCounts].filter(([, count]) => count !== 1).map(([identity]) => identity);
  if (duplicates.length > 0) throw new Error(`duplicate evidence identities: ${duplicates.join(', ')}`);

  const actualIdentities = [...identityCounts.keys()].sort();
  const expectedSet = new Set(expectedIdentities);
  const actualSet = new Set(actualIdentities);
  const missing = expectedIdentities.filter(identity => !actualSet.has(identity));
  const extra = actualIdentities.filter(identity => !expectedSet.has(identity));
  if (missing.length > 0) throw new Error(`missing evidence records: ${missing.join(', ')}`);
  if (extra.length > 0) throw new Error(`extra evidence records: ${extra.join(', ')}`);

  for (const { record } of records) {
    if (record.runId !== runId) {
      throw new Error(`record ${record.identity} has stale run id ${record.runId}; expected ${runId}`);
    }
    if (record.candidateCommit !== candidateCommit) {
      throw new Error(`record ${record.identity} has stale candidate commit ${record.candidateCommit}; expected ${candidateCommit}`);
    }
    if (record.status !== 'passed') {
      throw new Error(`record ${record.identity} has status ${record.status}; expected passed`);
    }
    if (!record.requestContractValid) {
      throw new Error(`record ${record.identity} has an invalid request contract`);
    }
    if (record.forbiddenRequestCount !== 0) {
      throw new Error(`record ${record.identity} contains ${record.forbiddenRequestCount} forbidden request(s)`);
    }
  }

  const finalDirectory = resolve(options.rootDirectory, 'promoted', candidateCommit, runId);
  try {
    await readdir(finalDirectory);
    throw new Error(`promoted evidence directory already exists: ${finalDirectory}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('promoted evidence directory already exists:')) throw error;
  }

  const temporaryDirectory = `${finalDirectory}.tmp-${randomUUID()}`;
  const finalRecordsDirectory = join(temporaryDirectory, 'records');
  const manifestPath = join(finalDirectory, 'manifest.json');
  try {
    await mkdir(finalRecordsDirectory, { recursive: true });
    for (const { filename } of records) {
      await copyFile(join(stagingDirectory, filename), join(finalRecordsDirectory, basename(filename)));
    }
    const manifest: Task7EvidenceManifest = {
      schemaVersion: 1,
      kind: 'read-only-canvas-share-matrix',
      status: 'passed',
      runId,
      candidateCommit,
      expectedCount: expectedIdentities.length,
      executedCount: records.length,
      expectedIdentities,
      records: records
        .map(({ record }) => ({ identity: record.identity, status: record.status as 'passed' }))
        .sort((left, right) => left.identity.localeCompare(right.identity)),
      stagingDirectory,
      promotedAt: new Date().toISOString(),
    };
    await writeFile(join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await mkdir(resolve(options.rootDirectory, 'promoted', candidateCommit), { recursive: true });
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return { finalDirectory, manifestPath };
}
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

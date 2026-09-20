import { randomBytes, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

const commitPattern = /^[a-f0-9]{40}$/iu;
const noncePattern = /^[a-f0-9]{64}$/iu;
const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/iu;
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const safeRunIdSchema = z.string().regex(runIdPattern).refine(
  value => !value.includes('.') && !windowsReservedName.test(value),
  { message: 'unsafe run id' },
);

const task7StatusSchema = z.enum(['passed', 'failed', 'timedOut', 'interrupted', 'unexpected']);
const scenarioSchema = z.enum([
  'desktop-valid',
  'desktop-invalid',
  'desktop-download-off',
  'desktop-download-on',
  'mobile-portrait',
  'mobile-landscape',
]);
const pageRoleSchema = z.enum(['primary', 'secondary', 'no-frame']);
const frameRoleSchema = z.enum(['main', 'child', 'none']);
const forbiddenReasonSchema = z.enum([
  'unsafe-method',
  'cross-origin',
  'contract-not-configured',
  'unexpected-page',
  'unexpected-frame',
  'unexpected-search',
  'unexpected-navigation',
  'request-contract-mismatch',
  'scenario-forbidden-endpoint',
  'unexpected-public-share-path',
  'unexpected-request',
]);

const requestSchema = z.object({
  method: z.string().min(1),
  origin: z.string().min(1),
  pathname: z.string().startsWith('/'),
  search: z.string(),
  resourceType: z.string().min(1),
  navigation: z.boolean(),
  pageRole: pageRoleSchema,
  frameRole: frameRoleSchema,
  range: z.string().nullable(),
  reason: forbiddenReasonSchema.optional(),
}).strict();

const frameNavigationSchema = z.object({
  origin: z.string().min(1),
  pathname: z.string().startsWith('/'),
  search: z.string(),
  hash: z.string(),
  pageRole: pageRoleSchema,
  frameRole: frameRoleSchema,
  reason: forbiddenReasonSchema.optional(),
}).strict();

const requestContractSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  expected: z.array(z.object({ label: z.string().min(1), count: z.number().int().nonnegative() }).strict()),
  actual: z.array(z.object({ label: z.string().min(1), count: z.number().int().nonnegative() }).strict()),
}).strict();

const mediaProbeSchema = z.object({
  touchStarts: z.number().int().nonnegative(),
  contextMenus: z.number().int().nonnegative(),
  defaultPrevented: z.boolean(),
  contextTargetWasMedia: z.boolean(),
  suppressClick: z.boolean(),
}).strict();

const evidenceDetailsSchema = z.object({
  mediaLongPress: z.object({
    nativeContextMenuSynthesized: z.boolean(),
    mediaProbe: mediaProbeSchema,
  }).strict().optional(),
}).strict();

export const task7EvidenceRecordSchema = z.object({
  schemaVersion: z.literal(3),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  identity: z.string().min(1),
  scenario: scenarioSchema,
  status: task7StatusSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  testTitle: z.array(z.string()).min(1),
  project: z.string().min(1),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable(),
  requests: z.array(requestSchema),
  frameNavigations: z.array(frameNavigationSchema),
  apiRequests: z.array(z.object({ method: z.string().min(1), pathname: z.string().startsWith('/') }).strict()),
  forbiddenRequestCount: z.number().int().nonnegative(),
  forbiddenRequests: z.array(requestSchema.extend({ reason: forbiddenReasonSchema }).strict()),
  forbiddenFrameNavigationCount: z.number().int().nonnegative(),
  forbiddenFrameNavigations: z.array(frameNavigationSchema.extend({ reason: forbiddenReasonSchema }).strict()),
  requestContractValid: z.boolean(),
  requestContract: requestContractSchema,
  consoleErrors: z.array(z.string()),
  details: evidenceDetailsSchema,
}).strict().superRefine((record, context) => {
  if (record.forbiddenRequestCount !== record.forbiddenRequests.length) {
    context.addIssue({ code: 'custom', message: 'forbiddenRequestCount does not match forbiddenRequests' });
  }
  if (record.forbiddenFrameNavigationCount !== record.forbiddenFrameNavigations.length) {
    context.addIssue({ code: 'custom', message: 'forbiddenFrameNavigationCount does not match forbiddenFrameNavigations' });
  }
  if (record.requestContractValid !== record.requestContract.valid) {
    context.addIssue({ code: 'custom', message: 'requestContractValid does not match requestContract.valid' });
  }
});

export type Task7EvidenceStatus = z.infer<typeof task7StatusSchema>;
export type Task7EvidenceRecord = z.infer<typeof task7EvidenceRecordSchema>;

const runMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('read-only-canvas-share-run'),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  expectedIdentities: z.array(z.string().min(1)).min(1),
  initializedAt: z.iso.datetime(),
}).strict();

interface FinalizeTask7EvidenceOptions {
  rootDirectory: string;
  runId: string;
  candidateCommit: string;
  executionNonce: string;
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

function normalizeCandidateCommit(value: string): string {
  if (value !== value.trim()) throw new Error('candidate commit must be exactly 40 hexadecimal characters');
  const normalized = value.toLowerCase();
  if (!commitPattern.test(normalized)) throw new Error('candidate commit must be exactly 40 hexadecimal characters');
  return normalized;
}

function normalizeNonce(value: string): string {
  if (value !== value.trim()) throw new Error('execution nonce must be exactly 64 hexadecimal characters');
  const normalized = value.toLowerCase();
  if (!noncePattern.test(normalized)) throw new Error('execution nonce must be exactly 64 hexadecimal characters');
  return normalized;
}

function normalizeRunId(value: string): string {
  if (value !== value.trim()
    || !runIdPattern.test(value)
    || value.includes('.')
    || value.includes('/')
    || value.includes('\\')
    || isAbsolute(value)
    || /^[a-z]:/iu.test(value)
    || windowsReservedName.test(value)) {
    throw new Error('run id contains an unsafe name or path segment');
  }
  return value;
}

function normalizeIdentities(values: readonly string[]): string[] {
  const normalized = [...values].sort();
  if (normalized.length === 0 || normalized.some(identity => identity.length === 0 || identity !== identity.trim())) {
    throw new Error('expected identities must be non-empty strings');
  }
  if (new Set(normalized).size !== normalized.length) throw new Error('expected identities must be unique');
  return normalized;
}

export function task7EvidenceFilename(identity: string): string {
  if (!identity || identity !== identity.trim()) throw new Error('evidence identity must be a non-empty trimmed string');
  return `${Buffer.from(identity, 'utf8').toString('base64url')}.json`;
}

export function task7StagingRecordsDirectory(rootDirectory: string, candidateCommit: string, runId: string): string {
  const root = resolve(rootDirectory);
  const candidate = normalizeCandidateCommit(candidateCommit);
  const run = normalizeRunId(runId);
  const result = resolve(root, 'staging', candidate, run, 'records');
  assertLexicallyContained(root, result, 'staging records directory');
  return result;
}

function assertLexicallyContained(root: string, target: string, label: string): void {
  const child = relative(root, target);
  if (child === '' || child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} escapes evidence root`);
}

async function secureRoot(rootDirectory: string): Promise<string> {
  const root = resolve(rootDirectory);
  await mkdir(root, { recursive: true });
  const stats = await lstat(root);
  if (stats.isSymbolicLink()) throw new Error('evidence root must not be a symbolic link, junction, or reparse point');
  if (!stats.isDirectory()) throw new Error('evidence root must be a directory');
  return realpath(root);
}

async function verifyContainedDirectory(rootReal: string, directory: string, label: string): Promise<string> {
  assertLexicallyContained(rootReal, resolve(directory), label);
  const stats = await lstat(directory);
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link, junction, or reparse point`);
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory`);
  const real = await realpath(directory);
  assertLexicallyContained(rootReal, real, label);
  return real;
}

async function ensureContainedDirectory(rootReal: string, segments: string[]): Promise<string> {
  let current = rootReal;
  for (const segment of segments) {
    const next = resolve(current, segment);
    assertLexicallyContained(rootReal, next, `directory ${segment}`);
    try {
      await mkdir(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    current = await verifyContainedDirectory(rootReal, next, `directory ${segment}`);
  }
  return current;
}

async function verifyContainedRegularFile(rootReal: string, filePath: string, label: string): Promise<string> {
  assertLexicallyContained(rootReal, resolve(filePath), label);
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link, junction, or reparse point`);
  if (!stats.isFile()) throw new Error(`${label} must be a regular file`);
  const real = await realpath(filePath);
  assertLexicallyContained(rootReal, real, label);
  return real;
}

async function readJsonFile(rootReal: string, filePath: string, label: string): Promise<unknown> {
  const safePath = await verifyContainedRegularFile(rootReal, filePath, label);
  const raw = await readFile(safePath, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`malformed JSON in ${label}`, { cause: error });
  }
}

function parseRunMetadata(value: unknown, label: string) {
  const parsed = runMetadataSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid run metadata schema: ${label}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function parseEvidenceRecord(value: unknown, label: string): Task7EvidenceRecord {
  const parsed = task7EvidenceRecordSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid evidence record schema: ${label}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

async function readRunMetadata(rootReal: string, candidateCommit: string, runId: string) {
  const runDirectory = join(rootReal, 'staging', candidateCommit, runId);
  await verifyContainedDirectory(rootReal, runDirectory, 'staging run directory');
  return parseRunMetadata(await readJsonFile(rootReal, join(runDirectory, 'run.json'), 'run metadata'), 'run.json');
}

function assertRunBinding(
  metadata: z.infer<typeof runMetadataSchema>,
  candidateCommit: string,
  runId: string,
  executionNonce: string,
  expectedIdentities: string[],
): void {
  if (metadata.candidateCommit !== candidateCommit) throw new Error('run metadata candidate commit mismatch');
  if (metadata.runId !== runId) throw new Error('run metadata run id mismatch');
  if (metadata.executionNonce !== executionNonce) throw new Error('run metadata execution nonce mismatch');
  if (JSON.stringify([...metadata.expectedIdentities].sort()) !== JSON.stringify(expectedIdentities)) {
    throw new Error('run metadata expected identities mismatch');
  }
}

export async function initializeTask7EvidenceRun(options: {
  rootDirectory: string;
  candidateCommit: string;
  runId: string;
  expectedIdentities: string[];
}): Promise<{ executionNonce: string; stagingDirectory: string; metadataPath: string }> {
  const candidateCommit = normalizeCandidateCommit(options.candidateCommit);
  const runId = normalizeRunId(options.runId);
  const expectedIdentities = normalizeIdentities(options.expectedIdentities);
  const rootReal = await secureRoot(options.rootDirectory);
  const commitDirectory = await ensureContainedDirectory(rootReal, ['staging', candidateCommit]);
  const runDirectory = join(commitDirectory, runId);
  assertLexicallyContained(rootReal, runDirectory, 'staging run directory');
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence run already initialized: ${runId}`);
    throw error;
  }
  try {
    await verifyContainedDirectory(rootReal, runDirectory, 'staging run directory');
    const recordsDirectory = await ensureContainedDirectory(rootReal, ['staging', candidateCommit, runId, 'records']);
    const executionNonce = randomBytes(32).toString('hex');
    const metadataPath = join(runDirectory, 'run.json');
    const metadata = {
      schemaVersion: 1 as const,
      kind: 'read-only-canvas-share-run' as const,
      runId,
      candidateCommit,
      executionNonce,
      expectedIdentities,
      initializedAt: new Date().toISOString(),
    };
    const handle = await open(metadataPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { executionNonce, stagingDirectory: recordsDirectory, metadataPath };
  } catch (error) {
    await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function assertExactRecordEntries(
  rootReal: string,
  recordsDirectory: string,
  expectedIdentities: string[],
  allowMissing: boolean,
): Promise<Map<string, string>> {
  const safeDirectory = await verifyContainedDirectory(rootReal, recordsDirectory, 'staging records directory');
  const expectedByFilename = new Map(expectedIdentities.map(identity => [task7EvidenceFilename(identity), identity]));
  const entries: Dirent[] = await readdir(safeDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const expectedIdentity = expectedByFilename.get(entry.name);
    if (!expectedIdentity) throw new Error(`unexpected directory entry: ${entry.name}`);
    const entryPath = join(safeDirectory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`evidence record ${entry.name} must not be a symbolic link, junction, or reparse point`);
    if (!entry.isFile()) throw new Error(`evidence record ${entry.name} must be a regular file`);
    await verifyContainedRegularFile(rootReal, entryPath, `evidence record ${entry.name}`);
  }
  if (!allowMissing) {
    const present = new Set(entries.map(entry => entry.name));
    const missing = [...expectedByFilename].filter(([filename]) => !present.has(filename)).map(([, identity]) => identity);
    if (missing.length > 0) throw new Error(`missing evidence records: ${missing.join(', ')}`);
  }
  return expectedByFilename;
}

export async function writeTask7EvidenceRecord(options: {
  rootDirectory: string;
  record: unknown;
}): Promise<{ recordPath: string }> {
  const record = parseEvidenceRecord(options.record, 'record write');
  const candidateCommit = normalizeCandidateCommit(record.candidateCommit);
  const runId = normalizeRunId(record.runId);
  const executionNonce = normalizeNonce(record.executionNonce);
  const normalizedRecord: Task7EvidenceRecord = { ...record, candidateCommit, executionNonce };
  const rootReal = await secureRoot(options.rootDirectory);
  const metadata = await readRunMetadata(rootReal, candidateCommit, runId);
  const expectedIdentities = normalizeIdentities(metadata.expectedIdentities);
  assertRunBinding(metadata, candidateCommit, runId, executionNonce, expectedIdentities);
  if (!expectedIdentities.includes(record.identity)) throw new Error(`unexpected evidence identity: ${record.identity}`);
  const recordsDirectory = join(rootReal, 'staging', candidateCommit, runId, 'records');
  await assertExactRecordEntries(rootReal, recordsDirectory, expectedIdentities, true);
  const recordPath = join(recordsDirectory, task7EvidenceFilename(record.identity));
  assertLexicallyContained(rootReal, recordPath, 'evidence record path');
  let handle: FileHandle | undefined;
  try {
    handle = await open(recordPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(normalizedRecord, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence identity already written: ${record.identity}`);
    throw error;
  } finally {
    await handle?.close();
  }
  await verifyContainedRegularFile(rootReal, recordPath, `evidence record ${record.identity}`);
  return { recordPath };
}

export async function finalizeTask7Evidence(options: FinalizeTask7EvidenceOptions): Promise<FinalizedTask7Evidence> {
  const candidateCommit = normalizeCandidateCommit(options.candidateCommit);
  const runId = normalizeRunId(options.runId);
  const executionNonce = normalizeNonce(options.executionNonce);
  const expectedIdentities = normalizeIdentities(options.expectedIdentities);
  const rootReal = await secureRoot(options.rootDirectory);
  const metadata = await readRunMetadata(rootReal, candidateCommit, runId);
  assertRunBinding(metadata, candidateCommit, runId, executionNonce, expectedIdentities);

  const recordsDirectory = join(rootReal, 'staging', candidateCommit, runId, 'records');
  const expectedByFilename = await assertExactRecordEntries(rootReal, recordsDirectory, expectedIdentities, false);
  const records: Array<{ filename: string; record: Task7EvidenceRecord }> = [];
  const identities = new Set<string>();
  for (const [filename, expectedIdentity] of expectedByFilename) {
    const record = parseEvidenceRecord(
      await readJsonFile(rootReal, join(recordsDirectory, filename), `evidence record ${filename}`),
      filename,
    );
    if (identities.has(record.identity)) throw new Error(`duplicate evidence identity: ${record.identity}`);
    identities.add(record.identity);
    if (record.identity !== expectedIdentity) throw new Error(`record filename identity mismatch: ${filename}`);
    if (record.runId !== runId) throw new Error(`record ${record.identity} has stale run id ${record.runId}`);
    if (record.candidateCommit !== candidateCommit) throw new Error(`record ${record.identity} has stale candidate commit ${record.candidateCommit}`);
    if (record.executionNonce !== executionNonce) throw new Error(`record ${record.identity} has stale execution nonce`);
    if (record.status !== 'passed') throw new Error(`record ${record.identity} has status ${record.status}; expected passed`);
    if (!record.requestContractValid) throw new Error(`record ${record.identity} has an invalid request contract`);
    if (record.forbiddenRequestCount !== 0) throw new Error(`record ${record.identity} contains ${record.forbiddenRequestCount} forbidden request(s)`);
    if (record.forbiddenFrameNavigationCount !== 0) throw new Error(`record ${record.identity} contains ${record.forbiddenFrameNavigationCount} forbidden frame navigation(s)`);
    records.push({ filename, record });
  }

  const promotedCommitDirectory = await ensureContainedDirectory(rootReal, ['promoted', candidateCommit]);
  const finalDirectory = join(promotedCommitDirectory, runId);
  const lockPath = join(promotedCommitDirectory, `${runId}.lock`);
  const temporaryDirectory = join(promotedCommitDirectory, `.${runId}.tmp-${randomUUID()}`);
  assertLexicallyContained(rootReal, finalDirectory, 'final evidence directory');
  assertLexicallyContained(rootReal, lockPath, 'promotion lock');
  assertLexicallyContained(rootReal, temporaryDirectory, 'promotion temporary directory');
  let lockHandle: FileHandle | undefined;
  let promoted = false;
  try {
    try {
      lockHandle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence promotion already in progress or completed: ${runId}`);
      throw error;
    }
    await lockHandle.writeFile(`${executionNonce}\n`, 'utf8');
    await lockHandle.sync();
    try {
      await lstat(finalDirectory);
      throw new Error(`promoted evidence directory already exists: ${finalDirectory}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(temporaryDirectory);
    await verifyContainedDirectory(rootReal, temporaryDirectory, 'promotion temporary directory');
    const finalRecordsDirectory = join(temporaryDirectory, 'records');
    await mkdir(finalRecordsDirectory);
    await verifyContainedDirectory(rootReal, finalRecordsDirectory, 'promotion temporary records directory');
    for (const { filename } of records) {
      await copyFile(join(recordsDirectory, filename), join(finalRecordsDirectory, filename), 1);
      await verifyContainedRegularFile(rootReal, join(finalRecordsDirectory, filename), `promoted record ${filename}`);
    }
    const manifest = {
      schemaVersion: 2,
      kind: 'read-only-canvas-share-matrix',
      status: 'passed',
      runId,
      candidateCommit,
      executionNonce,
      expectedCount: expectedIdentities.length,
      executedCount: records.length,
      expectedIdentities,
      records: records
        .map(({ record }) => ({ identity: record.identity, status: 'passed' as const }))
        .sort((left, right) => left.identity.localeCompare(right.identity)),
      stagingRecords: `staging/${candidateCommit}/${runId}/records`,
      promotedAt: new Date().toISOString(),
    };
    const temporaryManifestPath = join(temporaryDirectory, 'manifest.json');
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await verifyContainedRegularFile(rootReal, temporaryManifestPath, 'temporary manifest');
    await rename(temporaryDirectory, finalDirectory);
    promoted = true;
  } finally {
    const ownsLock = lockHandle !== undefined;
    await lockHandle?.close();
    if (!promoted) await rm(temporaryDirectory, { recursive: true, force: true });
    if (ownsLock) {
      await unlink(lockPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }

  const manifestPath = join(finalDirectory, 'manifest.json');
  await verifyContainedDirectory(rootReal, finalDirectory, 'final evidence directory');
  await verifyContainedRegularFile(rootReal, manifestPath, 'final evidence manifest');
  return { finalDirectory, manifestPath };
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, type Dirent, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import {
  deriveTask7CanonicalSummary,
  task7ChromiumMatrixIdentities,
  type Task7EvidenceIdentity,
} from './read-only-canvas-share-contract';

export {
  task7ChromiumMatrixIdentities,
  task7EvidenceDescriptors,
  type Task7EvidenceIdentity,
  type Task7ExpectedRequest,
} from './read-only-canvas-share-contract';

const execFileAsync = promisify(execFile);
const commitPattern = /^[a-f0-9]{40}$/iu;
const noncePattern = /^[a-f0-9]{64}$/iu;
const digestPattern = /^[a-f0-9]{64}$/u;
const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/iu;
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const maxEvidenceDurationMs = 60 * 60 * 1_000;

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
  schemaVersion: z.literal(4),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  identity: z.string().min(1),
  scenario: scenarioSchema,
  status: task7StatusSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  durationMs: z.number().finite().nonnegative().optional(),
  testTitle: z.array(z.string()).min(1),
  project: z.string().min(1),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().nullable(),
  requests: z.array(requestSchema),
  frameNavigations: z.array(frameNavigationSchema),
  forbiddenRequestCount: z.number().int().nonnegative(),
  forbiddenRequests: z.array(requestSchema.extend({ reason: forbiddenReasonSchema }).strict()),
  forbiddenFrameNavigationCount: z.number().int().nonnegative(),
  forbiddenFrameNavigations: z.array(frameNavigationSchema.extend({ reason: forbiddenReasonSchema }).strict()),
  consoleErrors: z.array(z.string()),
  details: evidenceDetailsSchema,
}).strict().superRefine((record, context) => {
  if (record.forbiddenRequestCount !== record.forbiddenRequests.length) {
    context.addIssue({ code: 'custom', message: 'forbiddenRequestCount does not match forbiddenRequests' });
  }
  if (record.forbiddenFrameNavigationCount !== record.forbiddenFrameNavigations.length) {
    context.addIssue({ code: 'custom', message: 'forbiddenFrameNavigationCount does not match forbiddenFrameNavigations' });
  }
});

export type Task7EvidenceStatus = z.infer<typeof task7StatusSchema>;
export type Task7EvidenceRecord = z.infer<typeof task7EvidenceRecordSchema>;

const runMetadataSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal('read-only-canvas-share-run'),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  expectedIdentities: z.array(z.string().min(1)).length(task7ChromiumMatrixIdentities.length),
  initializedAt: z.iso.datetime(),
}).strict();
const ownerMarkerSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('read-only-canvas-share-publication-owner'),
  ownerId: z.string().uuid(),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  claimedAt: z.iso.datetime(),
}).strict();
const manifestRecordSchema = z.object({
  identity: z.string().min(1),
  filename: z.string().endsWith('.json'),
  status: z.literal('passed'),
  sha256: z.string().regex(digestPattern),
  semantic: z.unknown(),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(4),
  kind: z.literal('read-only-canvas-share-matrix'),
  status: z.literal('passed'),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  expectedCount: z.literal(task7ChromiumMatrixIdentities.length),
  executedCount: z.literal(task7ChromiumMatrixIdentities.length),
  expectedIdentities: z.array(z.string()).length(task7ChromiumMatrixIdentities.length),
  records: z.array(manifestRecordSchema).length(task7ChromiumMatrixIdentities.length),
  nativeContextMenuSynthesis: z.object({
    observedTrue: z.number().int().nonnegative(),
    observedFalse: z.number().int().nonnegative(),
    portraitTotal: z.number().int().nonnegative(),
  }).strict(),
  promotedAt: z.iso.datetime(),
}).strict();
const completionMarkerSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('read-only-canvas-share-publication-complete'),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  ownerId: z.string().uuid(),
  ownerSha256: z.string().regex(digestPattern),
  manifestSha256: z.string().regex(digestPattern),
  completedAt: z.iso.datetime(),
}).strict();

interface FileIdentity {
  dev: number;
  ino: number;
  birthtimeMs: number;
  ctimeMs: number;
}
interface RecordSnapshot {
  filename: string;
  bytes: Buffer;
  sha256: string;
  record: Task7EvidenceRecord;
  semantic: ReturnType<typeof deriveTask7CanonicalSummary>;
}

export interface FinalizeTask7EvidenceHooks {
  afterSourceValidation?: (snapshots: ReadonlyArray<Readonly<RecordSnapshot>>) => Promise<void> | void;
  afterClaimCreated?: (paths: { finalDirectory: string; ownerMarkerPath: string; ownerId: string }) => Promise<void> | void;
  beforeCompletionMarker?: (paths: PublicationPaths) => Promise<void> | void;
  afterCompletionMarker?: (paths: PublicationPaths) => Promise<void> | void;
}
interface PublicationPaths {
  finalDirectory: string;
  ownerMarkerPath: string;
  manifestPath: string;
  completionMarkerPath: string;
}
export interface FinalizeTask7EvidenceOptions {
  rootDirectory: string;
  repositoryRoot: string;
  runId: string;
  candidateCommit: string;
  executionNonce: string;
  hooks?: FinalizeTask7EvidenceHooks;
}
export interface FinalizedTask7Evidence {
  finalDirectory: string;
  manifestPath: string;
  completionMarkerPath: string;
}

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
  if (value !== value.trim() || !runIdPattern.test(value) || value.includes('.') || value.includes('/')
    || value.includes('\\') || isAbsolute(value) || /^[a-z]:/iu.test(value) || windowsReservedName.test(value)) {
    throw new Error('run id contains an unsafe name or path segment');
  }
  return value;
}
function exactExpectedIdentities(): string[] {
  return [...task7ChromiumMatrixIdentities].sort();
}
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function task7EvidenceFilename(identity: string): string {
  if (!identity || identity !== identity.trim()) throw new Error('evidence identity must be a non-empty trimmed string');
  return `${Buffer.from(identity, 'utf8').toString('base64url')}.json`;
}
export function task7StagingRecordsDirectory(rootDirectory: string, candidateCommit: string, runId: string): string {
  const root = resolve(rootDirectory);
  const result = resolve(root, 'staging', normalizeCandidateCommit(candidateCommit), normalizeRunId(runId), 'records');
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
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('evidence root must be a real directory, not a link or reparse point');
  return realpath(root);
}
async function verifyContainedDirectory(rootReal: string, directory: string, label: string): Promise<string> {
  assertLexicallyContained(rootReal, resolve(directory), label);
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} must be a real directory, not a link or reparse point`);
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
function fileIdentity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino, birthtimeMs: stats.birthtimeMs, ctimeMs: stats.ctimeMs };
}
function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs;
}
async function readRegularFileOnce(rootReal: string, filePath: string, label: string): Promise<{ bytes: Buffer; identity: FileIdentity }> {
  assertLexicallyContained(rootReal, resolve(filePath), label);
  const pathStats = await lstat(filePath);
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) throw new Error(`${label} must be a regular file, not a link or reparse point`);
  const real = await realpath(filePath);
  assertLexicallyContained(rootReal, real, label);
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle = await open(real, constants.O_RDONLY | noFollow);
  try {
    const handleStats = await handle.stat();
    if (!handleStats.isFile() || !sameFileIdentity(fileIdentity(pathStats), fileIdentity(handleStats))) {
      throw new Error(`${label} changed while being opened`);
    }
    const bytes = await handle.readFile();
    const finalPathStats = await lstat(filePath);
    if (!sameFileIdentity(fileIdentity(handleStats), fileIdentity(finalPathStats))) throw new Error(`${label} changed while being read`);
    return { bytes, identity: fileIdentity(handleStats) };
  } finally {
    await handle.close();
  }
}
function parseJsonBytes(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`malformed JSON in ${label}`, { cause: error });
  }
}
function parseEvidenceRecord(value: unknown, label: string): Task7EvidenceRecord {
  const parsed = task7EvidenceRecordSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid evidence record schema: ${label}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export async function discoverGitRepositoryRoot(startDirectory: string): Promise<string> {
  const start = await realpath(resolve(startDirectory));
  const { stdout } = await execFileAsync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const discovered = await realpath(stdout.trim());
  const relation = relative(discovered, start);
  if (relation.startsWith('..') || isAbsolute(relation)) throw new Error('discovered Git repository does not contain the working directory');
  return discovered;
}
async function verifyRepositoryState(repositoryRoot: string, candidateCommit: string): Promise<string> {
  const explicitRoot = await realpath(resolve(repositoryRoot));
  const discoveredRoot = await discoverGitRepositoryRoot(explicitRoot);
  if (explicitRoot.toLowerCase() !== discoveredRoot.toLowerCase()) throw new Error('repository root must be the explicit Git top-level directory');
  const { stdout: headOutput } = await execFileAsync('git', ['-C', explicitRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const head = normalizeCandidateCommit(headOutput.trim());
  if (head !== candidateCommit) throw new Error(`candidate commit does not match git HEAD (${head})`);
  const { stdout: status } = await execFileAsync('git', ['-C', explicitRoot, 'status', '--porcelain=v1', '--untracked-files=no'], { encoding: 'utf8' });
  if (status.trim()) throw new Error('Git tracked/index worktree is dirty; commit or restore tracked changes before evidence lifecycle operations');
  const { stdout: untracked } = await execFileAsync('git', ['-C', explicitRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  if (untracked.trim()) throw new Error(`Git worktree contains non-ignored untracked files: ${untracked.trim().split(/\r?\n/u).join(', ')}`);
  return explicitRoot;
}
async function writeExclusiveFile(filePath: string, bytes: string | Buffer): Promise<FileIdentity> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    return fileIdentity(await handle.stat());
  } finally {
    await handle?.close();
  }
}
async function readRunMetadata(rootReal: string, candidateCommit: string, runId: string) {
  const runDirectory = join(rootReal, 'staging', candidateCommit, runId);
  await verifyContainedDirectory(rootReal, runDirectory, 'staging run directory');
  const snapshot = await readRegularFileOnce(rootReal, join(runDirectory, 'run.json'), 'run metadata');
  const parsed = runMetadataSchema.safeParse(parseJsonBytes(snapshot.bytes, 'run metadata'));
  if (!parsed.success) throw new Error(`invalid run metadata schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
function assertRunBinding(metadata: z.infer<typeof runMetadataSchema>, candidateCommit: string, runId: string, executionNonce: string): void {
  if (metadata.candidateCommit !== candidateCommit) throw new Error('run metadata candidate commit mismatch');
  if (metadata.runId !== runId) throw new Error('run metadata run id mismatch');
  if (metadata.executionNonce !== executionNonce) throw new Error('run metadata execution nonce mismatch');
  if (JSON.stringify([...metadata.expectedIdentities].sort()) !== JSON.stringify(exactExpectedIdentities())) {
    throw new Error('run metadata expected identities mismatch');
  }
}

export async function initializeTask7EvidenceRun(options: {
  rootDirectory: string;
  repositoryRoot: string;
  candidateCommit: string;
  runId: string;
}): Promise<{ executionNonce: string; stagingDirectory: string; metadataPath: string }> {
  const candidateCommit = normalizeCandidateCommit(options.candidateCommit);
  const runId = normalizeRunId(options.runId);
  await verifyRepositoryState(options.repositoryRoot, candidateCommit);
  const rootReal = await secureRoot(options.rootDirectory);
  const commitDirectory = await ensureContainedDirectory(rootReal, ['staging', candidateCommit]);
  const runDirectory = join(commitDirectory, runId);
  assertLexicallyContained(rootReal, runDirectory, 'staging run directory');
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence run already initialized or abandoned: ${runId}`);
    throw error;
  }
  await verifyContainedDirectory(rootReal, runDirectory, 'staging run directory');
  const recordsDirectory = join(runDirectory, 'records');
  await mkdir(recordsDirectory);
  const executionNonce = randomBytes(32).toString('hex');
  const metadataPath = join(runDirectory, 'run.json');
  await writeExclusiveFile(metadataPath, jsonBytes({
    schemaVersion: 2,
    kind: 'read-only-canvas-share-run',
    runId,
    candidateCommit,
    executionNonce,
    expectedIdentities: exactExpectedIdentities(),
    initializedAt: new Date().toISOString(),
  }));
  return { executionNonce, stagingDirectory: recordsDirectory, metadataPath };
}

async function assertExactRecordEntries(rootReal: string, recordsDirectory: string, allowMissing: boolean): Promise<Map<string, string>> {
  const safeDirectory = await verifyContainedDirectory(rootReal, recordsDirectory, 'evidence records directory');
  const expectedByFilename = new Map(exactExpectedIdentities().map(identity => [task7EvidenceFilename(identity), identity]));
  const entries: Dirent[] = await readdir(safeDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!expectedByFilename.has(entry.name)) throw new Error(`unexpected directory entry: ${entry.name}`);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`evidence record ${entry.name} must be a regular file, not a link or reparse point`);
  }
  if (!allowMissing) {
    const present = new Set(entries.map(entry => entry.name));
    const missing = [...expectedByFilename].filter(([filename]) => !present.has(filename)).map(([, identity]) => identity);
    if (missing.length) throw new Error(`missing evidence records: ${missing.join(', ')}`);
  }
  return expectedByFilename;
}
export async function writeTask7EvidenceRecord(options: { rootDirectory: string; record: unknown }): Promise<{ recordPath: string }> {
  const record = parseEvidenceRecord(options.record, 'record write');
  const candidateCommit = normalizeCandidateCommit(record.candidateCommit);
  const runId = normalizeRunId(record.runId);
  const executionNonce = normalizeNonce(record.executionNonce);
  const rootReal = await secureRoot(options.rootDirectory);
  const metadata = await readRunMetadata(rootReal, candidateCommit, runId);
  assertRunBinding(metadata, candidateCommit, runId, executionNonce);
  if (!task7ChromiumMatrixIdentities.includes(record.identity as Task7EvidenceIdentity)) throw new Error(`unexpected evidence identity: ${record.identity}`);
  const recordsDirectory = join(rootReal, 'staging', candidateCommit, runId, 'records');
  await assertExactRecordEntries(rootReal, recordsDirectory, true);
  const recordPath = join(recordsDirectory, task7EvidenceFilename(record.identity));
  assertLexicallyContained(rootReal, recordPath, 'evidence record path');
  try {
    await writeExclusiveFile(recordPath, jsonBytes({ ...record, candidateCommit, executionNonce }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence identity already written: ${record.identity}`);
    throw error;
  }
  return { recordPath };
}

function validateRecordSemantics(record: Task7EvidenceRecord) {
  if (record.status !== 'passed') throw new Error(`record ${record.identity} has status ${record.status}; expected passed`);
  const started = Date.parse(record.startedAt);
  const completed = Date.parse(record.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started > completed) throw new Error(`record ${record.identity} has invalid or reversed timestamps`);
  const elapsed = completed - started;
  if (elapsed > maxEvidenceDurationMs) throw new Error(`record ${record.identity} duration is not sane`);
  if (record.durationMs !== undefined && (record.durationMs > maxEvidenceDurationMs || Math.abs(record.durationMs - elapsed) > 1_000)) {
    throw new Error(`record ${record.identity} durationMs is not sane or does not match timestamps`);
  }
  return deriveTask7CanonicalSummary(record);
}
async function readRecordSnapshots(
  rootReal: string,
  recordsDirectory: string,
  expectedByFilename: Map<string, string>,
  binding: { runId: string; candidateCommit: string; executionNonce: string },
): Promise<RecordSnapshot[]> {
  const snapshots: RecordSnapshot[] = [];
  const identities = new Set<string>();
  for (const [filename, expectedIdentity] of expectedByFilename) {
    const source = await readRegularFileOnce(rootReal, join(recordsDirectory, filename), `evidence record ${filename}`);
    const record = parseEvidenceRecord(parseJsonBytes(source.bytes, `evidence record ${filename}`), filename);
    if (identities.has(record.identity)) throw new Error(`duplicate evidence identity: ${record.identity}`);
    identities.add(record.identity);
    if (record.identity !== expectedIdentity) throw new Error(`record filename identity mismatch: ${filename}`);
    if (record.runId !== binding.runId) throw new Error(`record ${record.identity} has stale run id`);
    if (record.candidateCommit !== binding.candidateCommit) throw new Error(`record ${record.identity} has stale candidate commit`);
    if (record.executionNonce !== binding.executionNonce) throw new Error(`record ${record.identity} has stale execution nonce`);
    snapshots.push({ filename, bytes: source.bytes, sha256: sha256(source.bytes), record, semantic: validateRecordSemantics(record) });
  }
  return snapshots;
}

async function verifyExactFile(rootReal: string, filePath: string, label: string, expectedBytes: Buffer, expectedIdentity?: FileIdentity): Promise<void> {
  const current = await readRegularFileOnce(rootReal, filePath, label);
  if (!current.bytes.equals(expectedBytes)) throw new Error(`${label} bytes or digest changed`);
  if (expectedIdentity && !sameFileIdentity(current.identity, expectedIdentity)) throw new Error(`${label} file identity changed`);
}
async function assertExactDirectoryEntries(
  rootReal: string,
  directory: string,
  expected: ReadonlyMap<string, 'file' | 'directory'>,
  label: string,
): Promise<void> {
  await verifyContainedDirectory(rootReal, directory, label);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== expected.size) throw new Error(`${label} tree entry count mismatch`);
  for (const entry of entries) {
    const kind = expected.get(entry.name);
    if (!kind) throw new Error(`${label} contains unexpected entry: ${entry.name}`);
    if (entry.isSymbolicLink() || (kind === 'file' && !entry.isFile()) || (kind === 'directory' && !entry.isDirectory())) {
      throw new Error(`${label} entry has unsafe type: ${entry.name}`);
    }
  }
}
async function auditOwnedPublication(options: {
  rootReal: string;
  paths: PublicationPaths;
  ownerBytes: Buffer;
  ownerIdentity: FileIdentity;
  manifestBytes: Buffer;
  completionBytes?: Buffer;
  completionIdentity?: FileIdentity;
  snapshots: RecordSnapshot[];
}): Promise<void> {
  const topEntries = new Map<string, 'file' | 'directory'>([
    ['owner.json', 'file'], ['manifest.json', 'file'], ['records', 'directory'],
  ]);
  if (options.completionBytes) topEntries.set('complete.json', 'file');
  await assertExactDirectoryEntries(options.rootReal, options.paths.finalDirectory, topEntries, 'publication directory');
  await verifyExactFile(options.rootReal, options.paths.ownerMarkerPath, 'publication owner marker', options.ownerBytes, options.ownerIdentity);
  await verifyExactFile(options.rootReal, options.paths.manifestPath, 'publication manifest', options.manifestBytes);
  if (options.completionBytes) {
    await verifyExactFile(options.rootReal, options.paths.completionMarkerPath, 'publication completion marker', options.completionBytes, options.completionIdentity);
  }
  const recordsDirectory = join(options.paths.finalDirectory, 'records');
  await assertExactDirectoryEntries(
    options.rootReal,
    recordsDirectory,
    new Map(options.snapshots.map(snapshot => [snapshot.filename, 'file' as const])),
    'publication records directory',
  );
  for (const snapshot of options.snapshots) {
    await verifyExactFile(options.rootReal, join(recordsDirectory, snapshot.filename), `published evidence record ${snapshot.filename}`, snapshot.bytes);
  }
}
function assertBinding(
  value: { runId: string; candidateCommit: string; executionNonce: string },
  binding: { runId: string; candidateCommit: string; executionNonce: string },
  label: string,
): void {
  if (value.runId !== binding.runId || value.candidateCommit !== binding.candidateCommit || value.executionNonce !== binding.executionNonce) {
    throw new Error(`${label} binding mismatch`);
  }
}
function nativeSynthesisAggregate(snapshots: readonly RecordSnapshot[]) {
  const observations = snapshots.map(snapshot => snapshot.semantic.longPressObservation)
    .filter((value): value is NonNullable<typeof value> => value !== null);
  return {
    observedTrue: observations.filter(value => value.nativeContextMenuSynthesized).length,
    observedFalse: observations.filter(value => !value.nativeContextMenuSynthesized).length,
    portraitTotal: observations.length,
  };
}

export async function finalizeTask7Evidence(options: FinalizeTask7EvidenceOptions): Promise<FinalizedTask7Evidence> {
  const candidateCommit = normalizeCandidateCommit(options.candidateCommit);
  const runId = normalizeRunId(options.runId);
  const executionNonce = normalizeNonce(options.executionNonce);
  await verifyRepositoryState(options.repositoryRoot, candidateCommit);
  const rootReal = await secureRoot(options.rootDirectory);
  const metadata = await readRunMetadata(rootReal, candidateCommit, runId);
  assertRunBinding(metadata, candidateCommit, runId, executionNonce);
  const recordsDirectory = join(rootReal, 'staging', candidateCommit, runId, 'records');
  const expectedByFilename = await assertExactRecordEntries(rootReal, recordsDirectory, false);
  const snapshots = await readRecordSnapshots(rootReal, recordsDirectory, expectedByFilename, { runId, candidateCommit, executionNonce });
  await options.hooks?.afterSourceValidation?.(snapshots);

  const promotedCommitDirectory = await ensureContainedDirectory(rootReal, ['promoted', candidateCommit]);
  const finalDirectory = join(promotedCommitDirectory, runId);
  assertLexicallyContained(rootReal, finalDirectory, 'final evidence directory');
  try {
    await mkdir(finalDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence publication run is already claimed or consumed: ${runId}`);
    throw error;
  }
  await verifyContainedDirectory(rootReal, finalDirectory, 'final evidence directory');
  const ownerId = randomUUID();
  const paths: PublicationPaths = {
    finalDirectory,
    ownerMarkerPath: join(finalDirectory, 'owner.json'),
    manifestPath: join(finalDirectory, 'manifest.json'),
    completionMarkerPath: join(finalDirectory, 'complete.json'),
  };
  const ownerBytes = jsonBytes({
    schemaVersion: 1,
    kind: 'read-only-canvas-share-publication-owner',
    ownerId,
    runId,
    candidateCommit,
    executionNonce,
    claimedAt: new Date().toISOString(),
  });
  const ownerIdentity = await writeExclusiveFile(paths.ownerMarkerPath, ownerBytes);
  await options.hooks?.afterClaimCreated?.({ finalDirectory, ownerMarkerPath: paths.ownerMarkerPath, ownerId });
  await verifyExactFile(rootReal, paths.ownerMarkerPath, 'publication owner claim', ownerBytes, ownerIdentity);

  const publishedRecordsDirectory = join(finalDirectory, 'records');
  await mkdir(publishedRecordsDirectory);
  for (const snapshot of snapshots) await writeExclusiveFile(join(publishedRecordsDirectory, snapshot.filename), snapshot.bytes);
  const manifest = {
    schemaVersion: 4 as const,
    kind: 'read-only-canvas-share-matrix' as const,
    status: 'passed' as const,
    runId,
    candidateCommit,
    executionNonce,
    expectedCount: task7ChromiumMatrixIdentities.length,
    executedCount: snapshots.length,
    expectedIdentities: exactExpectedIdentities(),
    records: snapshots.map(snapshot => ({
      identity: snapshot.record.identity,
      filename: snapshot.filename,
      status: 'passed' as const,
      sha256: snapshot.sha256,
      semantic: snapshot.semantic,
    })).sort((left, right) => left.identity.localeCompare(right.identity)),
    nativeContextMenuSynthesis: nativeSynthesisAggregate(snapshots),
    promotedAt: new Date().toISOString(),
  };
  const parsedManifest = manifestSchema.safeParse(manifest);
  if (!parsedManifest.success) throw new Error(`generated manifest is invalid: ${z.prettifyError(parsedManifest.error)}`);
  const manifestBytes = jsonBytes(parsedManifest.data);
  await writeExclusiveFile(paths.manifestPath, manifestBytes);
  await auditOwnedPublication({ rootReal, paths, ownerBytes, ownerIdentity, manifestBytes, snapshots });
  await options.hooks?.beforeCompletionMarker?.(paths);
  await verifyRepositoryState(options.repositoryRoot, candidateCommit);
  await auditOwnedPublication({ rootReal, paths, ownerBytes, ownerIdentity, manifestBytes, snapshots });

  const completionBytes = jsonBytes({
    schemaVersion: 1,
    kind: 'read-only-canvas-share-publication-complete',
    runId,
    candidateCommit,
    executionNonce,
    ownerId,
    ownerSha256: sha256(ownerBytes),
    manifestSha256: sha256(manifestBytes),
    completedAt: new Date().toISOString(),
  });
  const completionIdentity = await writeExclusiveFile(paths.completionMarkerPath, completionBytes);
  await options.hooks?.afterCompletionMarker?.(paths);
  await auditOwnedPublication({ rootReal, paths, ownerBytes, ownerIdentity, manifestBytes, completionBytes, completionIdentity, snapshots });
  return verifyCompletedTask7EvidenceRun({
    rootDirectory: options.rootDirectory,
    repositoryRoot: options.repositoryRoot,
    runId,
    candidateCommit,
    executionNonce,
  });
}

export async function verifyCompletedTask7EvidenceRun(options: Omit<FinalizeTask7EvidenceOptions, 'hooks'>): Promise<FinalizedTask7Evidence> {
  const candidateCommit = normalizeCandidateCommit(options.candidateCommit);
  const runId = normalizeRunId(options.runId);
  const executionNonce = normalizeNonce(options.executionNonce);
  await verifyRepositoryState(options.repositoryRoot, candidateCommit);
  const rootReal = await secureRoot(options.rootDirectory);
  const finalDirectory = join(rootReal, 'promoted', candidateCommit, runId);
  await assertExactDirectoryEntries(rootReal, finalDirectory, new Map([
    ['owner.json', 'file'], ['manifest.json', 'file'], ['complete.json', 'file'], ['records', 'directory'],
  ]), 'completed publication directory');
  const binding = { runId, candidateCommit, executionNonce };
  const ownerSnapshot = await readRegularFileOnce(rootReal, join(finalDirectory, 'owner.json'), 'publication owner marker');
  const owner = ownerMarkerSchema.safeParse(parseJsonBytes(ownerSnapshot.bytes, 'publication owner marker'));
  if (!owner.success) throw new Error(`invalid publication owner marker: ${z.prettifyError(owner.error)}`);
  assertBinding(owner.data, binding, 'publication owner marker');
  const manifestPath = join(finalDirectory, 'manifest.json');
  const manifestSnapshot = await readRegularFileOnce(rootReal, manifestPath, 'publication manifest');
  const manifest = manifestSchema.safeParse(parseJsonBytes(manifestSnapshot.bytes, 'publication manifest'));
  if (!manifest.success) throw new Error(`invalid publication manifest schema: ${z.prettifyError(manifest.error)}`);
  assertBinding(manifest.data, binding, 'publication manifest');
  if (JSON.stringify([...manifest.data.expectedIdentities].sort()) !== JSON.stringify(exactExpectedIdentities())) throw new Error('publication manifest expected identities mismatch');
  const completionMarkerPath = join(finalDirectory, 'complete.json');
  const completionSnapshot = await readRegularFileOnce(rootReal, completionMarkerPath, 'publication completion marker');
  const completion = completionMarkerSchema.safeParse(parseJsonBytes(completionSnapshot.bytes, 'publication completion marker'));
  if (!completion.success) throw new Error(`invalid publication completion marker: ${z.prettifyError(completion.error)}`);
  assertBinding(completion.data, binding, 'publication completion marker');
  if (completion.data.ownerId !== owner.data.ownerId) throw new Error('publication completion owner mismatch');
  if (completion.data.ownerSha256 !== sha256(ownerSnapshot.bytes)) throw new Error('publication owner digest mismatch');
  if (completion.data.manifestSha256 !== sha256(manifestSnapshot.bytes)) throw new Error('publication manifest digest mismatch');

  const recordsDirectory = join(finalDirectory, 'records');
  const expectedByFilename = await assertExactRecordEntries(rootReal, recordsDirectory, false);
  const manifestByIdentity = new Map(manifest.data.records.map(record => [record.identity, record]));
  if (manifestByIdentity.size !== task7ChromiumMatrixIdentities.length) throw new Error('publication manifest contains duplicate identities');
  const verifiedSnapshots: RecordSnapshot[] = [];
  for (const [filename, identity] of expectedByFilename) {
    const manifestRecord = manifestByIdentity.get(identity);
    if (!manifestRecord || manifestRecord.filename !== filename) throw new Error(`publication manifest record mismatch: ${identity}`);
    const snapshot = await readRegularFileOnce(rootReal, join(recordsDirectory, filename), `published evidence record ${filename}`);
    if (sha256(snapshot.bytes) !== manifestRecord.sha256) throw new Error(`published evidence record digest mismatch: ${identity}`);
    const record = parseEvidenceRecord(parseJsonBytes(snapshot.bytes, `published evidence record ${filename}`), filename);
    if (record.identity !== identity) throw new Error(`published evidence filename identity mismatch: ${filename}`);
    assertBinding(record, binding, `published evidence record ${identity}`);
    const semantic = validateRecordSemantics(record);
    if (JSON.stringify(semantic) !== JSON.stringify(manifestRecord.semantic)) throw new Error(`publication manifest semantic mismatch: ${identity}`);
    verifiedSnapshots.push({ filename, bytes: snapshot.bytes, sha256: manifestRecord.sha256, record, semantic });
  }
  if (JSON.stringify(nativeSynthesisAggregate(verifiedSnapshots)) !== JSON.stringify(manifest.data.nativeContextMenuSynthesis)) {
    throw new Error('publication manifest native context menu synthesis aggregate mismatch');
  }
  return { finalDirectory, manifestPath, completionMarkerPath };
}

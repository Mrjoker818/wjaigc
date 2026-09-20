import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, type Dirent, type Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

const execFileAsync = promisify(execFile);
const commitPattern = /^[a-f0-9]{40}$/iu;
const noncePattern = /^[a-f0-9]{64}$/iu;
const runIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/iu;
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const nextBuildQueryPattern = /^\?v=\d+$/u;
const faviconQueryPattern = /^\?[a-f0-9]+$/iu;
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
  durationMs: z.number().finite().nonnegative().optional(),
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
type Task7Request = Task7EvidenceRecord['requests'][number];

export interface Task7ExpectedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly search: '' | 'next-build-query' | 'favicon-hash-query';
  readonly resourceType: string;
  readonly navigation: boolean;
  readonly range: string | null;
  readonly count: number;
}

interface Task7EvidenceDescriptor {
  readonly scenario: z.infer<typeof scenarioSchema>;
  readonly project: string;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly longPress: 'required' | 'absent';
  readonly requestContract: readonly Task7ExpectedRequest[];
}

const request = (
  method: string,
  pathname: string,
  resourceType: string,
  options: Partial<Pick<Task7ExpectedRequest, 'search' | 'navigation' | 'range' | 'count'>> = {},
): Task7ExpectedRequest => Object.freeze({
  method,
  pathname,
  search: options.search ?? '',
  resourceType,
  navigation: options.navigation ?? false,
  range: options.range ?? null,
  count: options.count ?? 1,
});

const commonRequests = Object.freeze([
  request('GET', '/shared/canvas/:share-token', 'document', { navigation: true }),
  request('GET', '/_next/static/css/app/layout.css', 'stylesheet', { search: 'next-build-query' }),
  request('GET', '/_next/static/chunks/webpack.js', 'script', { search: 'next-build-query' }),
  request('GET', '/_next/static/chunks/main-app.js', 'script', { search: 'next-build-query' }),
  request('GET', '/_next/static/chunks/app-pages-internals.js', 'script'),
  request('GET', '/_next/static/chunks/app/layout.js', 'script'),
  request('GET', '/_next/static/chunks/app/shared/canvas/%5Btoken%5D/page.js', 'script'),
  request('GET', '/favicon.ico', 'other', { search: 'favicon-hash-query' }),
  request('GET', '/api/public/canvas-shares/:share-token', 'fetch'),
]);
const sharedMediaRequests = Object.freeze([
  request('GET', '/api/public/canvas-shares/:share-token/media/:image-item', 'image', { count: 2 }),
  request('GET', '/api/public/canvas-shares/:share-token/media/:unavailable-item', 'image'),
  request('GET', '/api/public/canvas-shares/:share-token/media/:video-item', 'media', { range: 'bytes=0-' }),
]);
const validVideoProbeRequests = Object.freeze([
  request('HEAD', '/api/public/canvas-shares/:share-token/media/:video-item', 'fetch'),
  request('GET', '/api/public/canvas-shares/:share-token/media/:video-item', 'fetch', { range: 'bytes=2-5' }),
  request('GET', '/api/public/canvas-shares/:share-token/media/:video-item', 'fetch', { range: 'bytes=1540-999999' }),
  request('GET', '/api/public/canvas-shares/:share-token/media/:video-item', 'fetch', { range: 'bytes=999999-1000000' }),
]);
const mobileContract = Object.freeze([...commonRequests, ...sharedMediaRequests]);

function descriptor(value: Task7EvidenceDescriptor): Task7EvidenceDescriptor {
  return Object.freeze({ ...value, viewport: Object.freeze({ ...value.viewport }), requestContract: Object.freeze([...value.requestContract]) });
}

export const task7EvidenceDescriptors = Object.freeze({
  'desktop/chromium/valid': descriptor({
    scenario: 'desktop-valid', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: [...commonRequests, ...sharedMediaRequests, ...validVideoProbeRequests],
  }),
  'desktop/chromium/invalid': descriptor({
    scenario: 'desktop-invalid', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: commonRequests,
  }),
  'desktop/chromium/download-off': descriptor({
    scenario: 'desktop-download-off', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: [
      ...commonRequests,
      request('GET', '/api/public/canvas-shares/:share-token/media/:image-item', 'image'),
      request('GET', '/api/public/canvas-shares/:share-token/media/:unavailable-item', 'image'),
      request('GET', '/api/public/canvas-shares/:share-token/media/:video-item', 'media', { range: 'bytes=0-' }),
      request('GET', '/api/public/canvas-shares/:share-token/media/:image-item/download', 'fetch'),
    ],
  }),
  'desktop/chromium/download-on': descriptor({
    scenario: 'desktop-download-on', project: 'chromium', viewport: { width: 1280, height: 720 }, longPress: 'absent',
    requestContract: [
      ...commonRequests,
      ...sharedMediaRequests,
      request('GET', '/api/public/canvas-shares/:share-token/media/:image-item/download', 'document', { navigation: true }),
    ],
  }),
  'mobile/mobile-320-chromium/portrait': descriptor({
    scenario: 'mobile-portrait', project: 'mobile-320-chromium', viewport: { width: 320, height: 568 }, longPress: 'required',
    requestContract: mobileContract,
  }),
  'mobile/mobile-375-chromium/portrait': descriptor({
    scenario: 'mobile-portrait', project: 'mobile-375-chromium', viewport: { width: 375, height: 667 }, longPress: 'required',
    requestContract: mobileContract,
  }),
  'mobile/mobile-393-chromium/portrait': descriptor({
    scenario: 'mobile-portrait', project: 'mobile-393-chromium', viewport: { width: 393, height: 852 }, longPress: 'required',
    requestContract: mobileContract,
  }),
  'mobile/mobile-chromium/landscape': descriptor({
    scenario: 'mobile-landscape', project: 'mobile-chromium', viewport: { width: 812, height: 375 }, longPress: 'absent',
    requestContract: mobileContract,
  }),
} as const);

export const task7ChromiumMatrixIdentities = Object.freeze(
  Object.keys(task7EvidenceDescriptors) as Array<keyof typeof task7EvidenceDescriptors>,
);

const runMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('read-only-canvas-share-run'),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  executionNonce: z.string().regex(noncePattern),
  expectedIdentities: z.array(z.string().min(1)).length(task7ChromiumMatrixIdentities.length),
  initializedAt: z.iso.datetime(),
}).strict();
const lockSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('read-only-canvas-share-promotion-lock'),
  ownerId: z.string().uuid(),
  runId: safeRunIdSchema,
  candidateCommit: z.string().regex(commitPattern),
  createdAt: z.iso.datetime(),
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
  semantic: ReturnType<typeof validateRecordSemantics>;
}

export interface FinalizeTask7EvidenceHooks {
  afterSourceValidation?: (snapshots: ReadonlyArray<Readonly<RecordSnapshot>>) => Promise<void> | void;
  afterLockAcquired?: (lock: { lockPath: string; ownerId: string }) => Promise<void> | void;
  beforePromotionRename?: (paths: { temporaryDirectory: string; finalDirectory: string }) => Promise<void> | void;
}

interface FinalizeTask7EvidenceOptions {
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

function exactExpectedIdentities(): string[] {
  return [...task7ChromiumMatrixIdentities].sort();
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
    await mkdir(next).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
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
    if (!sameFileIdentity(fileIdentity(handleStats), fileIdentity(finalPathStats))) {
      throw new Error(`${label} changed while being read`);
    }
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

function parseRunMetadata(value: unknown, label: string): z.infer<typeof runMetadataSchema> {
  const parsed = runMetadataSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid run metadata schema: ${label}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
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
  const { stdout: status } = await execFileAsync(
    'git', ['-C', explicitRoot, 'status', '--porcelain=v1', '--untracked-files=no'], { encoding: 'utf8' },
  );
  if (status.trim()) throw new Error('Git tracked/index worktree is dirty; commit or restore tracked changes before evidence lifecycle operations');
  return explicitRoot;
}

async function readRunMetadata(rootReal: string, candidateCommit: string, runId: string) {
  const runDirectory = join(rootReal, 'staging', candidateCommit, runId);
  await verifyContainedDirectory(rootReal, runDirectory, 'staging run directory');
  const snapshot = await readRegularFileOnce(rootReal, join(runDirectory, 'run.json'), 'run metadata');
  return parseRunMetadata(parseJsonBytes(snapshot.bytes, 'run metadata'), 'run.json');
}

function assertRunBinding(
  metadata: z.infer<typeof runMetadataSchema>,
  candidateCommit: string,
  runId: string,
  executionNonce: string,
): void {
  if (metadata.candidateCommit !== candidateCommit) throw new Error('run metadata candidate commit mismatch');
  if (metadata.runId !== runId) throw new Error('run metadata run id mismatch');
  if (metadata.executionNonce !== executionNonce) throw new Error('run metadata execution nonce mismatch');
  if (JSON.stringify([...metadata.expectedIdentities].sort()) !== JSON.stringify(exactExpectedIdentities())) {
    throw new Error('run metadata expected identities mismatch');
  }
}

async function writeExclusiveFile(filePath: string, bytes: string | Buffer): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
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
      expectedIdentities: exactExpectedIdentities(),
      initializedAt: new Date().toISOString(),
    };
    await writeExclusiveFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    return { executionNonce, stagingDirectory: recordsDirectory, metadataPath };
  } catch (error) {
    await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function assertExactRecordEntries(rootReal: string, recordsDirectory: string, allowMissing: boolean): Promise<Map<string, string>> {
  const safeDirectory = await verifyContainedDirectory(rootReal, recordsDirectory, 'staging records directory');
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
  if (!task7ChromiumMatrixIdentities.includes(record.identity as keyof typeof task7EvidenceDescriptors)) {
    throw new Error(`unexpected evidence identity: ${record.identity}`);
  }
  const recordsDirectory = join(rootReal, 'staging', candidateCommit, runId, 'records');
  await assertExactRecordEntries(rootReal, recordsDirectory, true);
  const recordPath = join(recordsDirectory, task7EvidenceFilename(record.identity));
  assertLexicallyContained(rootReal, recordPath, 'evidence record path');
  try {
    await writeExclusiveFile(recordPath, `${JSON.stringify({ ...record, candidateCommit, executionNonce }, null, 2)}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence identity already written: ${record.identity}`);
    throw error;
  }
  return { recordPath };
}

function matchesSearch(expected: Task7ExpectedRequest['search'], actual: string): boolean {
  if (expected === 'next-build-query') return nextBuildQueryPattern.test(actual);
  if (expected === 'favicon-hash-query') return faviconQueryPattern.test(actual);
  return actual === expected;
}

function requestMatches(expected: Task7ExpectedRequest, actual: Task7Request): boolean {
  return actual.reason === undefined
    && actual.method === expected.method
    && actual.origin === ':same-origin'
    && actual.pathname === expected.pathname
    && matchesSearch(expected.search, actual.search)
    && actual.resourceType === expected.resourceType
    && actual.navigation === expected.navigation
    && actual.pageRole === 'primary'
    && actual.frameRole === 'main'
    && actual.range === expected.range;
}

function validateExactRequestMultiset(record: Task7EvidenceRecord, descriptorValue: Task7EvidenceDescriptor): void {
  const counts = descriptorValue.requestContract.map(() => 0);
  for (const actual of record.requests) {
    const matchIndex = descriptorValue.requestContract.findIndex(expected => requestMatches(expected, actual));
    if (matchIndex < 0) throw new Error(`semantic request contract contains unexpected request: ${JSON.stringify(actual)}`);
    counts[matchIndex] += 1;
  }
  descriptorValue.requestContract.forEach((expected, index) => {
    if (counts[index] !== expected.count) {
      throw new Error(`semantic request contract count mismatch for ${expected.method} ${expected.pathname}: expected ${expected.count}, received ${counts[index]}`);
    }
  });
  const expectedApiRequests = record.requests
    .filter(item => item.pathname.startsWith('/api/public/'))
    .map(({ method, pathname }) => ({ method, pathname }));
  if (JSON.stringify(record.apiRequests) !== JSON.stringify(expectedApiRequests)) {
    throw new Error('semantic API request projection does not agree with raw requests');
  }
}

function validateRecordSemantics(record: Task7EvidenceRecord) {
  const descriptorValue = task7EvidenceDescriptors[record.identity as keyof typeof task7EvidenceDescriptors];
  if (!descriptorValue) throw new Error(`no immutable descriptor for evidence identity ${record.identity}`);
  if (record.scenario !== descriptorValue.scenario
    || record.project !== descriptorValue.project
    || record.viewport?.width !== descriptorValue.viewport.width
    || record.viewport?.height !== descriptorValue.viewport.height) {
    throw new Error(`semantic descriptor mismatch for ${record.identity}`);
  }
  if (record.status !== 'passed') throw new Error(`record ${record.identity} has status ${record.status}; expected passed`);
  const started = Date.parse(record.startedAt);
  const completed = Date.parse(record.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started > completed) {
    throw new Error(`record ${record.identity} has invalid or reversed timestamps`);
  }
  const elapsed = completed - started;
  if (elapsed > maxEvidenceDurationMs) throw new Error(`record ${record.identity} duration is not sane`);
  if (record.durationMs !== undefined
    && (record.durationMs > maxEvidenceDurationMs || Math.abs(record.durationMs - elapsed) > 1_000)) {
    throw new Error(`record ${record.identity} durationMs is not sane or does not match timestamps`);
  }
  if (record.forbiddenRequestCount !== record.forbiddenRequests.length || record.forbiddenRequestCount !== 0) {
    throw new Error(`record ${record.identity} contains forbidden requests`);
  }
  if (record.forbiddenFrameNavigationCount !== record.forbiddenFrameNavigations.length
    || record.forbiddenFrameNavigationCount !== 0
    || record.frameNavigations.length !== 0) {
    throw new Error(`record ${record.identity} contains unexpected frame navigations`);
  }
  validateExactRequestMultiset(record, descriptorValue);
  const longPress = record.details.mediaLongPress;
  if (descriptorValue.longPress === 'required') {
    if (!longPress
      || longPress.mediaProbe.touchStarts !== 1
      || longPress.mediaProbe.contextMenus !== 1
      || !longPress.mediaProbe.defaultPrevented
      || !longPress.mediaProbe.contextTargetWasMedia
      || !longPress.mediaProbe.suppressClick) {
      throw new Error(`record ${record.identity} does not satisfy the required media long-press probe`);
    }
  } else if (longPress !== undefined) {
    throw new Error(`record ${record.identity} must not contain a media long-press probe`);
  }
  return Object.freeze({
    scenario: descriptorValue.scenario,
    project: descriptorValue.project,
    viewport: { ...descriptorValue.viewport },
    longPress: descriptorValue.longPress,
    requestContract: descriptorValue.requestContract.map(expected => ({ ...expected })),
    requestCount: descriptorValue.requestContract.reduce((sum, expected) => sum + expected.count, 0),
    frameNavigationCount: 0,
  });
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
    snapshots.push({
      filename,
      bytes: source.bytes,
      sha256: createHash('sha256').update(source.bytes).digest('hex'),
      record,
      semantic: validateRecordSemantics(record),
    });
  }
  return snapshots;
}

async function assertPathAbsent(path: string, message: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(message);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function assertOwnedLock(lockPath: string, ownerId: string, identity: FileIdentity): Promise<boolean> {
  try {
    const currentStats = await lstat(lockPath);
    if (currentStats.isSymbolicLink() || !currentStats.isFile() || !sameFileIdentity(identity, fileIdentity(currentStats))) return false;
    const current = lockSchema.safeParse(parseJsonBytes(await readFile(lockPath), 'promotion lock'));
    return current.success && current.data.ownerId === ownerId;
  } catch {
    return false;
  }
}

async function verifyTemporaryPromotion(
  rootReal: string,
  temporaryDirectory: string,
  snapshots: RecordSnapshot[],
): Promise<void> {
  const recordsDirectory = await verifyContainedDirectory(rootReal, join(temporaryDirectory, 'records'), 'temporary records directory');
  const entries = await readdir(recordsDirectory, { withFileTypes: true });
  if (entries.length !== snapshots.length || entries.some(entry => !entry.isFile())) {
    throw new Error('temporary promotion record set mismatch');
  }
  for (const snapshot of snapshots) {
    const promoted = await readRegularFileOnce(rootReal, join(recordsDirectory, snapshot.filename), `temporary promoted record ${snapshot.filename}`);
    const digest = createHash('sha256').update(promoted.bytes).digest('hex');
    if (digest !== snapshot.sha256 || !promoted.bytes.equals(snapshot.bytes)) {
      throw new Error(`temporary promoted record digest mismatch: ${snapshot.filename}`);
    }
  }
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
  const lockPath = join(promotedCommitDirectory, `${runId}.lock`);
  const temporaryDirectory = join(promotedCommitDirectory, `.${runId}.tmp-${randomUUID()}`);
  assertLexicallyContained(rootReal, finalDirectory, 'final evidence directory');
  assertLexicallyContained(rootReal, lockPath, 'promotion lock');
  assertLexicallyContained(rootReal, temporaryDirectory, 'promotion temporary directory');
  const ownerId = randomUUID();
  let lockHandle: FileHandle | undefined;
  let lockIdentity: FileIdentity | undefined;
  let promoted = false;
  try {
    try {
      lockHandle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`evidence promotion already in progress or abandoned: ${runId}`);
      throw error;
    }
    const lock = {
      schemaVersion: 1 as const,
      kind: 'read-only-canvas-share-promotion-lock' as const,
      ownerId,
      runId,
      candidateCommit,
      createdAt: new Date().toISOString(),
    };
    await lockHandle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    await lockHandle.sync();
    lockIdentity = fileIdentity(await lockHandle.stat());
    await options.hooks?.afterLockAcquired?.({ lockPath, ownerId });
    if (!await assertOwnedLock(lockPath, ownerId, lockIdentity)) throw new Error('promotion lock ownership was lost after acquisition');
    await assertPathAbsent(finalDirectory, `promoted evidence directory already exists: ${finalDirectory}`);
    await mkdir(temporaryDirectory);
    await verifyContainedDirectory(rootReal, temporaryDirectory, 'promotion temporary directory');
    const finalRecordsDirectory = join(temporaryDirectory, 'records');
    await mkdir(finalRecordsDirectory);
    for (const snapshot of snapshots) {
      await writeExclusiveFile(join(finalRecordsDirectory, snapshot.filename), snapshot.bytes);
    }
    const manifest = {
      schemaVersion: 3,
      kind: 'read-only-canvas-share-matrix',
      status: 'passed',
      runId,
      candidateCommit,
      executionNonce,
      expectedCount: task7ChromiumMatrixIdentities.length,
      executedCount: snapshots.length,
      expectedIdentities: exactExpectedIdentities(),
      records: snapshots
        .map(snapshot => ({
          identity: snapshot.record.identity,
          filename: snapshot.filename,
          status: 'passed' as const,
          sha256: snapshot.sha256,
          semantic: snapshot.semantic,
        }))
        .sort((left, right) => left.identity.localeCompare(right.identity)),
      promotedAt: new Date().toISOString(),
    };
    await writeExclusiveFile(join(temporaryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyTemporaryPromotion(rootReal, temporaryDirectory, snapshots);
    await options.hooks?.beforePromotionRename?.({ temporaryDirectory, finalDirectory });
    if (!await assertOwnedLock(lockPath, ownerId, lockIdentity)) throw new Error('promotion lock ownership was lost before publication');
    await assertPathAbsent(finalDirectory, `promotion destination already exists: ${finalDirectory}`);
    await rename(temporaryDirectory, finalDirectory);
    promoted = true;
  } finally {
    await lockHandle?.close();
    if (!promoted) await rm(temporaryDirectory, { recursive: true, force: true });
    if (lockIdentity && await assertOwnedLock(lockPath, ownerId, lockIdentity)) {
      await unlink(lockPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }
  const manifestPath = join(finalDirectory, 'manifest.json');
  await verifyContainedDirectory(rootReal, finalDirectory, 'final evidence directory');
  await readRegularFileOnce(rootReal, manifestPath, 'final evidence manifest');
  return { finalDirectory, manifestPath };
}

export async function invalidateTask7EvidencePromotionLock(options: {
  rootDirectory: string;
  candidateCommit: string;
  runId: string;
  expectedOwnerId: string;
}): Promise<{ quarantinedLockPath: string }> {
  const candidateCommit = normalizeCandidateCommit(options.candidateCommit);
  const runId = normalizeRunId(options.runId);
  const rootReal = await secureRoot(options.rootDirectory);
  const lockPath = join(rootReal, 'promoted', candidateCommit, `${runId}.lock`);
  const snapshot = await readRegularFileOnce(rootReal, lockPath, 'abandoned promotion lock');
  const parsed = lockSchema.safeParse(parseJsonBytes(snapshot.bytes, 'abandoned promotion lock'));
  if (!parsed.success) throw new Error('abandoned promotion lock has invalid metadata');
  if (parsed.data.ownerId !== options.expectedOwnerId) throw new Error('abandoned promotion lock owner does not match the manually confirmed owner');
  const quarantineDirectory = await ensureContainedDirectory(rootReal, ['invalidated', 'locks', candidateCommit]);
  const quarantinedLockPath = join(quarantineDirectory, `${runId}-${randomUUID()}.lock`);
  const currentStats = await lstat(lockPath);
  if (!sameFileIdentity(snapshot.identity, fileIdentity(currentStats))) throw new Error('abandoned promotion lock changed during manual invalidation');
  await rename(lockPath, quarantinedLockPath);
  const quarantined = await readRegularFileOnce(rootReal, quarantinedLockPath, 'quarantined promotion lock');
  if (!quarantined.bytes.equals(snapshot.bytes)) throw new Error('quarantined promotion lock bytes changed during invalidation');
  return { quarantinedLockPath };
}

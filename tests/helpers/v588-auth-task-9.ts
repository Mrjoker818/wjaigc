import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';

import type { Page, Response } from '@playwright/test';
import JSZip from 'jszip';

export type AuthFixtureRole = 'admin' | 'user';

export interface ExpectedPrincipal {
  id: string;
  name: string;
  role: AuthFixtureRole;
}

export interface ExpectedResponseDetails {
  method: string;
  path: string;
  status: number;
  stage: string;
}

export interface ExpectedResponseRecord extends ExpectedResponseDetails {
  token: string;
}

export interface ConsoleHttpFailureEntry {
  type: string;
  text: string;
  locationPath: string | null;
}

export interface ArtifactManifestEntry {
  project: string;
  role: string;
  retry: number;
  path: string;
  size: number;
  mtime: string;
  checksum: string;
}

export interface RunArtifactManifest {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  artifacts: ArtifactManifestEntry[];
}

const AUTHENTICATION_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/session',
]);

const NAVIGATION_ABORT_ALLOWLIST = [
  /^\/_next\//,
  /^\/api\/task-events$/,
  /^\/api\/user-data\/sync$/,
];

const ABORT_FAILURE_PATTERN = /ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_ABORT|Load request cancelled/i;
const TRACE_TEXT_NAMES = /(?:^|\/)(?:trace\.trace|network|[^/]*snapshot[^/]*)$/i;
const TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.html',
  '.json',
  '.log',
  '.md',
  '.network',
  '.trace',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

function replaceBuffer(input: Buffer, search: Buffer, replacement: Buffer): Buffer {
  if (search.length === 0) return input;
  const chunks: Buffer[] = [];
  let cursor = 0;
  let index = input.indexOf(search, cursor);
  while (index !== -1) {
    chunks.push(input.subarray(cursor, index), replacement);
    cursor = index + search.length;
    index = input.indexOf(search, cursor);
  }
  if (cursor === 0) return input;
  chunks.push(input.subarray(cursor));
  return Buffer.concat(chunks);
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return nested.flat();
}

function parseArtifactIdentity(filePath: string, runId: string): Pick<ArtifactManifestEntry, 'project' | 'role' | 'retry'> {
  const name = basename(filePath);
  const prefix = `${runId}__`;
  const parts = name.startsWith(prefix) ? name.slice(prefix.length).split('__') : [];
  const retry = /^retry-(\d+)$/.exec(parts[2] || '')?.[1];
  return {
    project: parts[0] || 'run',
    role: parts[1] || 'run',
    retry: retry ? Number(retry) : 0,
  };
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function secretVariants(secrets: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
    variants.add(encodeURIComponent(secret).replaceAll('%20', '+'));
    variants.add(Buffer.from(secret, 'utf8').toString('base64'));
    variants.add(base64Url(secret));
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  return [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
}

export function redactCredentialMaterial(input: Buffer, secrets: readonly string[]): Buffer {
  const replacement = Buffer.from('[REDACTED]', 'utf8');
  return secretVariants(secrets).reduce((result, variant) => (
    replaceBuffer(result, Buffer.from(variant, 'utf8'), replacement)
  ), input);
}

export function validateAuthenticatedSessionPayload(
  payload: unknown,
  expected: ExpectedPrincipal,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (record.success !== true || !record.user || typeof record.user !== 'object') return false;
  const user = record.user as Record<string, unknown>;
  return user.id === expected.id
    && user.name === expected.name
    && user.role === expected.role;
}

export async function waitForAuthenticatedSessionForAction<T>(
  page: Page,
  expected: ExpectedPrincipal,
  stage: string,
  action: () => Promise<T>,
): Promise<{ actionResult: T; response: Response }> {
  let actionStartedAt = Number.POSITIVE_INFINITY;
  const responsePromise = page.waitForResponse(candidate => {
    const request = candidate.request();
    const url = new URL(candidate.url());
    return request.method() === 'GET'
      && url.pathname === '/api/session'
      && request.timing().startTime >= actionStartedAt;
  });
  const actionPromise = Promise.resolve().then(() => {
    actionStartedAt = Date.now();
    return action();
  });
  const [response, actionResult] = await Promise.all([responsePromise, actionPromise]);
  if (response.status() !== 200) {
    throw new Error(`${stage}: GET /api/session returned HTTP ${response.status()}`);
  }
  const payload = await response.json().catch(() => null) as unknown;
  if (!validateAuthenticatedSessionPayload(payload, expected)) {
    throw new Error(`${stage}: GET /api/session returned a mismatched fixture principal`);
  }
  return { actionResult, response };
}

export function createExpectedResponseRegistry<T extends object>(): {
  expect(request: T, details: ExpectedResponseDetails): string;
  consume(request: T): ExpectedResponseRecord | null;
  remaining(): ExpectedResponseRecord[];
} {
  const expected = new Map<T, ExpectedResponseRecord>();
  return {
    expect(request, details) {
      const token = `${details.stage}:${randomUUID()}`;
      expected.set(request, { ...details, token });
      return token;
    },
    consume(request) {
      const record = expected.get(request) || null;
      if (record) expected.delete(request);
      return record;
    },
    remaining() {
      return [...expected.values()];
    },
  };
}

export function createExpectedConsoleRegistry(expectedResponses: readonly ExpectedResponseRecord[]): {
  consume(entry: ConsoleHttpFailureEntry): string | null;
  remainingTokens(): string[];
} {
  const available = expectedResponses.filter(record => record.status === 401 || record.status === 429);
  return {
    consume(entry) {
      if (entry.type !== 'error' || !entry.locationPath || !/^Failed to load resource/.test(entry.text)) {
        return null;
      }
      const status = Number(/(?:^|\D)(401|429)(?:\D|$)/.exec(entry.text)?.[1]);
      const matchIndex = available.findIndex(record => (
        record.path === entry.locationPath && record.status === status
      ));
      if (matchIndex === -1) return null;
      return available.splice(matchIndex, 1)[0].token;
    },
    remainingTokens() {
      return available.map(record => record.token);
    },
  };
}

export function classifyFailedRequest(input: {
  path: string;
  failure: string;
  navigationStage: string | null;
}): 'navigation-abort' | 'unexpected' {
  if (AUTHENTICATION_PATHS.has(input.path)) return 'unexpected';
  if (!input.navigationStage || !ABORT_FAILURE_PATTERN.test(input.failure)) return 'unexpected';
  return NAVIGATION_ABORT_ALLOWLIST.some(pattern => pattern.test(input.path))
    ? 'navigation-abort'
    : 'unexpected';
}

export async function sanitizePlaywrightTrace(
  tracePath: string,
  secrets: readonly string[],
): Promise<void> {
  const archive = await JSZip.loadAsync(await readFile(tracePath));
  await Promise.all(Object.values(archive.files).map(async entry => {
    if (entry.dir) return;
    const bytes = await entry.async('nodebuffer');
    if (!TRACE_TEXT_NAMES.test(entry.name) && !secretVariants(secrets).some(variant => bytes.includes(Buffer.from(variant)))) {
      return;
    }
    archive.file(entry.name, redactCredentialMaterial(bytes, secrets));
  }));
  const temporaryPath = `${tracePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  await JSZip.loadAsync(await readFile(temporaryPath));
  await rename(temporaryPath, tracePath);
}

export async function sanitizeTextArtifact(
  artifactPath: string,
  secrets: readonly string[],
): Promise<void> {
  const bytes = await readFile(artifactPath);
  await writeFile(artifactPath, redactCredentialMaterial(bytes, secrets));
}

async function scanTrace(tracePath: string, variants: readonly string[]): Promise<string[]> {
  const archive = await JSZip.loadAsync(await readFile(tracePath));
  const hits: string[] = [];
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const bytes = await entry.async('nodebuffer');
    if (variants.some(variant => bytes.includes(Buffer.from(variant, 'utf8')))) hits.push(entry.name);
  }
  return hits;
}

export async function scanArtifactsForSecrets(
  root: string,
  secrets: readonly string[],
): Promise<void> {
  const variants = secretVariants(secrets);
  const hits: string[] = [];
  for (const filePath of await walkFiles(root)) {
    if (extname(filePath).toLowerCase() === '.zip') {
      const traceHits = await scanTrace(filePath, variants);
      hits.push(...traceHits.map(entry => `${relative(root, filePath)}!${entry}`));
      continue;
    }
    if (!TEXT_ARTIFACT_EXTENSIONS.has(extname(filePath).toLowerCase())) continue;
    const bytes = await readFile(filePath);
    if (variants.some(variant => bytes.includes(Buffer.from(variant, 'utf8')))) {
      hits.push(relative(root, filePath));
    }
  }
  if (hits.length > 0) {
    throw new Error(`Credential material remains in ${hits.length} current-run artifact location(s): ${hits.join(', ')}`);
  }
}

export async function createRunArtifactManifest(
  runRoot: string,
  runId: string,
): Promise<RunArtifactManifest> {
  const manifestPath = join(runRoot, 'manifests', `${runId}.json`);
  const files = (await walkFiles(runRoot)).filter(path => {
    if (path === manifestPath) return false;
    const normalized = relative(runRoot, path).replaceAll('\\', '/');
    return normalized.split('/').includes(runId) || basename(path).startsWith(`${runId}__`);
  });
  const artifacts = await Promise.all(files.map(async filePath => {
    const [metadata, bytes] = await Promise.all([stat(filePath), readFile(filePath)]);
    return {
      ...parseArtifactIdentity(filePath, runId),
      path: relative(runRoot, filePath).replaceAll('\\', '/'),
      size: metadata.size,
      mtime: metadata.mtime.toISOString(),
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  }));
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  const manifest: RunArtifactManifest = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    artifacts,
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export function runArtifactPath(
  category: 'console' | 'network' | 'screenshots' | 'videos' | 'traces',
  runId: string,
  project: string,
  role: string,
  retry: number,
  suffix: string,
): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const filename = [runId, project, role, `retry-${retry}`, suffix].map(safe).join('__');
  return join(process.cwd(), 'test-results', category, runId, filename);
}

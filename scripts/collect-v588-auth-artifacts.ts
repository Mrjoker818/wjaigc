import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

import {
  createRunArtifactManifest,
  runArtifactPath,
  sanitizePlaywrightTrace,
  sanitizeTextArtifact,
  scanArtifactsForSecrets,
  secretVariants,
} from '../tests/helpers/v588-auth-task-9';

interface ArtifactIdentity {
  runId: string;
  project: string;
  role: string;
  retry: number;
}

const root = process.cwd();
const outputRoot = join(root, '.playwright-output');
const resultsRoot = join(root, 'test-results');
const runId = required('E2E_AUTH_RUN_ID');
const textExtensions = new Set(['.csv', '.html', '.json', '.log', '.md', '.network', '.trace', '.txt', '.xml', '.yaml', '.yml']);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment input: ${name}`);
  return value;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

async function identityFor(filePath: string): Promise<ArtifactIdentity | null> {
  let current = dirname(filePath);
  while (resolve(current).startsWith(resolve(outputRoot))) {
    const identityPath = join(current, 'v588-artifact-identity.json');
    try {
      const parsed = JSON.parse(await readFile(identityPath, 'utf8')) as ArtifactIdentity;
      if (
        parsed.runId === runId
        && typeof parsed.project === 'string'
        && typeof parsed.role === 'string'
        && Number.isInteger(parsed.retry)
      ) return parsed;
    } catch {
      // Continue toward the Playwright output root.
    }
    if (resolve(current) === resolve(outputRoot)) break;
    current = dirname(current);
  }
  return null;
}

function categoryFor(filePath: string): 'screenshots' | 'videos' | 'traces' | null {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.png') return 'screenshots';
  if (extension === '.webm') return 'videos';
  if (extension === '.zip') return 'traces';
  return null;
}

function safeSourceName(filePath: string): string {
  return relative(outputRoot, filePath).replaceAll(/[^a-zA-Z0-9._-]+/g, '-');
}

const secrets = [
  required('E2E_ADMIN_USERNAME'),
  required('E2E_ADMIN_PASSWORD'),
  `${required('E2E_ADMIN_PASSWORD')}-incorrect`,
  required('E2E_USER_USERNAME'),
  required('E2E_USER_PASSWORD'),
  `${required('E2E_USER_PASSWORD')}-incorrect`,
  required('E2E_TEST_USERNAME'),
  required('E2E_TEST_PASSWORD'),
];

async function main(): Promise<void> {
  const files = await walk(outputRoot);
  for (const tracePath of files.filter(path => extname(path).toLowerCase() === '.zip')) {
    await sanitizePlaywrightTrace(tracePath, secrets);
  }
  for (const textPath of files.filter(path => textExtensions.has(extname(path).toLowerCase()))) {
    await sanitizeTextArtifact(textPath, secrets);
  }
  const reportRoot = join(root, 'playwright-report');
  const reportFiles = await walk(reportRoot);
  for (const reportPath of reportFiles) {
    const extension = extname(reportPath).toLowerCase();
    if (extension === '.zip') await sanitizePlaywrightTrace(reportPath, secrets);
    if (textExtensions.has(extension)) await sanitizeTextArtifact(reportPath, secrets);
  }
  const junitPath = join(resultsRoot, 'junit.xml');
  await sanitizeTextArtifact(junitPath, secrets);

  let copied = 0;
  for (const source of files) {
    const category = categoryFor(source);
    if (!category) continue;
    const identity = await identityFor(source);
    if (!identity) throw new Error(`Missing run artifact identity for ${relative(outputRoot, source)}`);
    const destination = runArtifactPath(
      category,
      runId,
      identity.project,
      identity.role,
      identity.retry,
      `playwright-${safeSourceName(source)}`,
    );
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    copied += 1;
  }

  await scanArtifactsForSecrets(outputRoot, secrets);
  for (const category of ['screenshots', 'videos', 'traces', 'network', 'console'] as const) {
    const directory = join(resultsRoot, category, runId);
    try {
      await scanArtifactsForSecrets(directory, secrets);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  await scanArtifactsForSecrets(reportRoot, secrets);
  const junitBytes = await readFile(junitPath);
  if (secretVariants(secrets).some(variant => junitBytes.includes(Buffer.from(variant, 'utf8')))) {
    throw new Error('Credential material remains in the current-run JUnit artifact');
  }
  const manifest = await createRunArtifactManifest(resultsRoot, runId);
  const counts = manifest.artifacts.reduce<Record<string, number>>((result, artifact) => {
    const category = artifact.path.split('/')[0] || 'unknown';
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {});
  process.stdout.write(`${JSON.stringify({
    result: 'PASS',
    runId,
    sanitizedTraceArchives: files.filter(path => extname(path).toLowerCase() === '.zip').length,
    copiedPlaywrightArtifacts: copied,
    credentialLeakScan: 'PASS',
    manifest: `test-results/manifests/${runId}.json`,
    counts,
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`V588 artifact collection failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';
import JSZip from 'jszip';

import { writeEvidenceManifest, type EvidenceManifestInput } from './evidence-manifest';

interface EvidenceEntry {
  method?: string;
  status?: number;
  type?: string;
  text?: string;
  url?: string;
}

interface Stage2Evidence {
  console: EvidenceEntry[];
  network: EvidenceEntry[];
  requestIds: Set<string>;
  taskIds: Set<string>;
  recordPayload(payload: unknown): void;
}

const SECRET_PATTERN = /(api[-_]?key|access[-_]?token|password)(["'=:\s]+)[^\s"'&,}]+/gi;

export function redactStage2Evidence(value: string): string {
  return value
    .replace(/("name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*")[^"]*/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(authorization)(["'=:\s]+)(?!Bearer\s)[^\s"'&,}]+/gi, '$1$2[REDACTED]')
    .replace(/(cookie|set-cookie)(["'=:\s]+)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi, '$1$2[REDACTED]')
    .replace(SECRET_PATTERN, '$1$2[REDACTED]');
}

export function sanitizeStage2Url(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|authorization|auth|session|signature|credential|cookie/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return redactStage2Evidence(rawUrl);
  }
}

export function redactStage2TraceText(value: string): string {
  return redactStage2Evidence(value).replace(/https?:\/\/[^\s"'<>]+/gi, rawUrl => {
    const suffix = /[),.;]$/.exec(rawUrl)?.[0] ?? '';
    const url = suffix ? rawUrl.slice(0, -1) : rawUrl;
    return `${sanitizeStage2Url(url)}${suffix}`;
  });
}

function isTraceText(bytes: Buffer): boolean {
  if (bytes.length === 0) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  }
  return controls / sample.length < 0.02;
}

async function sanitizePlaywrightTrace(sourcePath: string, destinationPath: string): Promise<void> {
  const archive = await JSZip.loadAsync(await readFile(sourcePath));
  await Promise.all(Object.values(archive.files).map(async entry => {
    if (entry.dir) return;
    const bytes = await entry.async('nodebuffer');
    if (isTraceText(bytes)) archive.file(entry.name, redactStage2TraceText(bytes.toString('utf8')));
  }));
  await writeFile(destinationPath, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function collectIds(value: unknown, evidence: Stage2Evidence): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(item => collectIds(item, evidence));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && /requestId/i.test(key)) evidence.requestIds.add(item);
    if (typeof item === 'string' && /taskId/i.test(key)) evidence.taskIds.add(item);
    if (item && typeof item === 'object') collectIds(item, evidence);
  }
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown-commit';
  }
}

function stage2EvidenceDirectory(commit: string, featureId: string, browser: string, capturedAt: string): string {
  const safe = (value: string) => value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return join(process.cwd(), 'test-results', 'evidence', safe(commit), safe(featureId), safe(browser), safe(capturedAt));
}

export const test = base.extend<{ stage2Evidence: Stage2Evidence }>({
  stage2Evidence: [async ({ page }, activateFixture, testInfo) => {
    const evidence: Stage2Evidence = {
      console: [],
      network: [],
      requestIds: new Set<string>(),
      taskIds: new Set<string>(),
      recordPayload(payload) { collectIds(payload, evidence); },
    };
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        evidence.console.push({ type: message.type(), text: redactStage2Evidence(message.text()), url: sanitizeStage2Url(message.location().url) });
      }
    });
    page.on('requestfailed', request => {
      evidence.network.push({ method: request.method(), url: sanitizeStage2Url(request.url()), text: redactStage2Evidence(request.failure()?.errorText ?? 'request failed') });
    });
    page.on('response', response => {
      if (response.url().includes('/api/') || response.status() >= 400) {
        evidence.network.push({ method: response.request().method(), status: response.status(), url: sanitizeStage2Url(response.url()) });
      }
      const headers = response.headers();
      const requestId = headers['x-request-id'] || headers['request-id'];
      if (requestId) evidence.requestIds.add(requestId);
    });

    const rawTracePath = testInfo.outputPath('stage-2-raw-trace.zip');
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    try {
      await activateFixture(evidence);
    } finally {
      const capturedAt = new Date().toISOString();
      const status = testInfo.status === 'passed' ? 'completed' : testInfo.status === 'skipped' ? 'blocked' : 'failed';
      const featureId = `stage-2-${testInfo.titlePath.slice(1).join('-')}`;
      const artifactPaths = {
        screenshot: 'screenshot.png',
        video: 'video.webm',
        trace: 'trace.zip',
        console: 'console.json',
        network: 'network.json',
        task: 'task.json',
      };
      const commit = gitCommit();
      const manifestInput: EvidenceManifestInput = {
        commit,
        deploymentUrl: String(testInfo.project.use.baseURL || process.env.E2E_BASE_URL || 'http://127.0.0.1:5000'),
        browser: testInfo.project.name,
        viewport: testInfo.project.use.viewport || { width: 1280, height: 720 },
        capturedAt,
        featureId,
        artifactPaths,
        requestIds: [...evidence.requestIds],
        status,
      };
      const directory = stage2EvidenceDirectory(commit, featureId, testInfo.project.name, capturedAt);
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, artifactPaths.screenshot), fullPage: true });
      await page.context().tracing.stop({ path: rawTracePath });
      await sanitizePlaywrightTrace(rawTracePath, join(directory, artifactPaths.trace));
      await unlink(rawTracePath);
      const video = page.video();
      await page.close();
      if (!video) throw new Error('Stage 2 evidence video was not created');
      await copyFile(await video.path(), join(directory, artifactPaths.video));
      await Promise.all([
        writeFile(join(directory, 'console.json'), JSON.stringify(evidence.console, null, 2)),
        writeFile(join(directory, 'network.json'), JSON.stringify(evidence.network, null, 2)),
        writeFile(join(directory, 'task.json'), JSON.stringify({ taskIds: [...evidence.taskIds] }, null, 2)),
      ]);
      const manifest = await writeEvidenceManifest(manifestInput);
      await testInfo.attach('stage-2-evidence-manifest', { path: manifest.manifestPath, contentType: 'application/json' });
    }
  }, { auto: true }],
});

export { expect };

export function requireStage2Env(...names: string[]): Record<string, string> {
  const missing = names.filter(name => !process.env[name]?.trim());
  test.skip(missing.length > 0, `BLOCKED: missing controlled Stage 2 inputs: ${missing.join(', ')}`);
  return Object.fromEntries(names.map(name => [name, process.env[name]!.trim()]));
}

export function stage2ProjectMatrixValue(raw: string | undefined, projectName: string): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.values(value as Record<string, unknown>)
      .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      .map(entry => entry.trim());
    if (new Set(entries).size !== entries.length) return null;
    const selected = (value as Record<string, unknown>)[projectName];
    return typeof selected === 'string' && selected.trim() ? selected.trim() : null;
  } catch {
    return null;
  }
}

export function requireStage2ProjectValue(testProjectName: string, envName: string): string {
  const value = stage2ProjectMatrixValue(process.env[envName], testProjectName);
  test.skip(!value, `BLOCKED: ${envName} must contain a unique value for ${testProjectName}`);
  return value!;
}

export async function loginRealUser(page: Page): Promise<void> {
  const env = requireStage2Env('E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD');
  await page.context().clearCookies();
  const loginResponse = await page.request.post('/api/auth/login', {
    data: { name: env.E2E_TEST_USERNAME, password: env.E2E_TEST_PASSWORD, productType: 'canvas' },
  });
  expect(loginResponse.ok()).toBeTruthy();
  await page.goto('/?loginMode=canvas', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible({ timeout: 20_000 });
}

export async function readProjects(page: Page): Promise<{ projects: Array<Record<string, unknown>>; revision: number }> {
  const response = await page.request.get('/api/user-data/sync?key=projects');
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { success?: boolean; value?: Array<Record<string, unknown>>; projectRevision?: number };
  expect(body.success).toBe(true);
  return { projects: body.value ?? [], revision: body.projectRevision ?? 0 };
}

export async function openCanvasProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 20_000 });
}

export async function postJson(page: Page, url: string, data: unknown): Promise<Record<string, unknown>> {
  const response = await page.request.post(url, { data });
  expect(response.ok(), `${url} returned HTTP ${response.status()}`).toBeTruthy();
  return await response.json() as Record<string, unknown>;
}

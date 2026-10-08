import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stage3SourceIdentity } from './stage-3-source-state';
import { stage3RuntimeFailureMessage } from './stage-3-runtime-failure-summary';
import {
  isBenignStage3RequestAbort,
  isRecoveredStage3RequestAbort,
  isRecoveredStage3SyncConflict,
  stage3RequestFingerprint,
  type Stage3EvidenceEntry,
} from './stage-3-evidence-filter';

export interface Stage3Evidence {
  directory: string;
  console: Stage3EvidenceEntry[];
  network: Stage3EvidenceEntry[];
}

const SECRET_PATTERN = /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|password|credential|secret))(["'=:\s]+)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi;

function safe(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(cookie|set-cookie|authorization)(["'=:\s]+)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi, '$1$2[REDACTED]')
    .replace(SECRET_PATTERN, '$1$2[REDACTED]');
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|authorization|session|signature|credential|cookie/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return redact(rawUrl);
  }
}

function evidenceDirectory(testInfo: TestInfo): string {
  return join(
    process.cwd(),
    'test-results',
    'stage-3-baseline',
    'evidence',
    safe(stage3SourceIdentity()),
    safe(process.env.E2E_STAGE3_EXPECTED_CANVAS_MODE || 'unknown-mode'),
    safe(process.env.E2E_STAGE3_RUN_ID || 'unknown-run'),
    safe(process.env.E2E_STAGE3_EVIDENCE_EXECUTION_ID || 'unknown-execution'),
    safe(testInfo.project.name),
    safe(testInfo.title),
    `retry-${testInfo.retry}`,
    `repeat-${testInfo.repeatEachIndex}`,
  );
}

export const test = base.extend<{ stage3Evidence: Stage3Evidence }>({
  stage3Evidence: [async ({ page }, useFixture, testInfo) => {
    const directory = evidenceDirectory(testInfo);
    const evidence: Stage3Evidence = { directory, console: [], network: [] };
    await mkdir(directory, { recursive: true });
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        evidence.console.push({
          type: message.type(),
          text: redact(message.text()),
          url: sanitizeUrl(message.location().url),
        });
      }
    });
    page.on('pageerror', error => {
      evidence.console.push({
        type: 'pageerror',
        text: redact(error.message),
        url: sanitizeUrl(page.url()),
      });
    });
    page.on('requestfailed', request => {
      evidence.network.push({
        method: request.method(),
        occurredAt: Date.now(),
        requestDigest: stage3RequestFingerprint(request.postData()),
        url: sanitizeUrl(request.url()),
        text: redact(request.failure()?.errorText ?? 'request failed'),
      });
    });
    page.on('response', response => {
      const request = response.request();
      const isSuccessfulProjectSync = response.status() >= 200
        && response.status() < 300
        && request.method() === 'POST'
        && new URL(response.url()).pathname === '/api/user-data/sync';
      if (response.status() >= 400 || isSuccessfulProjectSync) {
        evidence.network.push({
          method: request.method(),
          occurredAt: Date.now(),
          requestDigest: stage3RequestFingerprint(request.postData()),
          status: response.status(),
          url: sanitizeUrl(response.url()),
        });
      }
    });
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    try {
      await useFixture(evidence);
    } finally {
      const artifactErrors: string[] = [];
      try {
        await page.screenshot({ path: join(directory, 'final.png'), fullPage: true });
      } catch (error) {
        artifactErrors.push(`screenshot: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        await page.context().tracing.stop({ path: join(directory, 'trace.zip') });
      } catch (error) {
        artifactErrors.push(`trace: ${error instanceof Error ? error.message : String(error)}`);
      }
      const video = page.video();
      let contextClosed = false;
      try {
        await page.context().close();
        contextClosed = true;
      } catch (error) {
        artifactErrors.push(`video: context close failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (video && contextClosed) {
        try {
          await copyFile(await video.path(), join(directory, 'video.webm'));
        } catch (error) {
          artifactErrors.push(`video: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (video) {
        artifactErrors.push('video: browser context did not close, so the recording could not be finalized');
      } else {
        artifactErrors.push('video: Stage 3 evidence video was not created');
      }
      await writeFile(join(directory, 'console.json'), JSON.stringify(evidence.console, null, 2), 'utf8');
      await writeFile(join(directory, 'network.json'), JSON.stringify(evidence.network, null, 2), 'utf8');
      await testInfo.attach('stage-3-console.json', {
        body: Buffer.from(JSON.stringify(evidence.console, null, 2)),
        contentType: 'application/json',
      });
      await testInfo.attach('stage-3-network.json', {
        body: Buffer.from(JSON.stringify(evidence.network, null, 2)),
        contentType: 'application/json',
      });

      const hasRecoveredSyncConflict = evidence.network.some(entry => (
        isRecoveredStage3SyncConflict(entry, evidence.network)
      ));
      const consoleErrors = evidence.console.filter(entry => (
        (entry.type === 'error' || entry.type === 'pageerror')
        && !(hasRecoveredSyncConflict
          && /Failed to load resource: the server responded with a status of 409/i.test(entry.text ?? '')
          && new URL(entry.url ?? 'http://invalid.local').pathname === '/api/user-data/sync')
      ));
      const networkErrors = evidence.network.filter(entry => (
        (typeof entry.status === 'number'
          && entry.status >= 400
          && !isRecoveredStage3SyncConflict(entry, evidence.network))
        || (!entry.status
          && !isBenignStage3RequestAbort(entry)
          && !isRecoveredStage3RequestAbort(entry, evidence.network))
      ));
      if (consoleErrors.length > 0 || networkErrors.length > 0) {
        console.error(stage3RuntimeFailureMessage(consoleErrors, networkErrors));
      }
      if (
        testInfo.status === 'passed'
        && (artifactErrors.length > 0 || consoleErrors.length > 0 || networkErrors.length > 0)
      ) {
        throw new Error(
          `Stage 3 runtime evidence failed: ${artifactErrors.length} artifact error(s), ${consoleErrors.length} console error(s), ${networkErrors.length} network error(s)${artifactErrors.length > 0 ? ` (${artifactErrors.join('; ')})` : ''}`,
        );
      }
    }
  }, { auto: true }],
});

export { expect };

export function requireStage3Environment(): {
  runId: string;
  username: string;
  password: string;
  expectedCanvasMode: 'legacy' | 'shadow' | 'canvas-v2';
  projectMatrix: Record<string, Record<string, string>>;
} {
  const required = [
    'E2E_STAGE3_RUN_ID',
    'E2E_TEST_USERNAME',
    'E2E_TEST_PASSWORD',
    'E2E_STAGE3_PROJECT_IDS',
    'E2E_STAGE3_EXPECTED_CANVAS_MODE',
  ] as const;
  const missing = required.filter(name => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`BLOCKED: missing controlled Stage 3 inputs: ${missing.join(', ')}`);
  }
  let projectMatrix: Record<string, Record<string, string>>;
  try {
    projectMatrix = JSON.parse(process.env.E2E_STAGE3_PROJECT_IDS!) as Record<string, Record<string, string>>;
  } catch {
    throw new Error('E2E_STAGE3_PROJECT_IDS must be a JSON browser/node-count matrix');
  }
  const expectedCanvasMode = process.env.E2E_STAGE3_EXPECTED_CANVAS_MODE!.trim();
  if (!['legacy', 'shadow', 'canvas-v2'].includes(expectedCanvasMode)) {
    throw new Error('E2E_STAGE3_EXPECTED_CANVAS_MODE must be legacy, shadow or canvas-v2');
  }
  return {
    runId: process.env.E2E_STAGE3_RUN_ID!.trim(),
    username: process.env.E2E_TEST_USERNAME!.trim(),
    password: process.env.E2E_TEST_PASSWORD!.trim(),
    expectedCanvasMode: expectedCanvasMode as 'legacy' | 'shadow' | 'canvas-v2',
    projectMatrix,
  };
}

export function validateStage3ProjectIsolation(environment: Record<string, string | undefined>): void {
  const raw = environment.E2E_STAGE3_PROJECT_IDS;
  const runId = environment.E2E_STAGE3_RUN_ID?.trim();
  if (!raw || !runId) {
    throw new Error('Stage 3 project isolation requires E2E_STAGE3_PROJECT_IDS and E2E_STAGE3_RUN_ID');
  }
  const matrix = JSON.parse(raw) as Record<string, Record<string, string>>;
  const ids = Object.values(matrix).flatMap(counts => Object.values(counts));
  if (ids.length !== 15 || new Set(ids).size !== 15) {
    throw new Error('Stage 3 requires 15 unique browser/node-count projects');
  }
  if (ids.some(id => !id.includes(runId))) {
    throw new Error('Every Stage 3 project id must include the controlled run id');
  }
}

export function stage3ProjectId(projectName: string, nodeCount: 1 | 100 | 300): string {
  const environment = requireStage3Environment();
  const projectId = environment.projectMatrix[projectName]?.[String(nodeCount)]?.trim();
  if (!projectId) {
    throw new Error(`BLOCKED: no ${nodeCount}-node Stage 3 project for ${projectName}`);
  }
  return projectId;
}

export async function loginStage3User(page: Page): Promise<void> {
  const environment = requireStage3Environment();
  await page.context().clearCookies();
  const response = await page.request.post('/api/auth/login', {
    data: { name: environment.username, password: environment.password, productType: 'canvas' },
  });
  expect(response.ok(), `Stage 3 login returned HTTP ${response.status()}`).toBe(true);
  const session = await page.request.get('/api/session');
  const body = await session.json().catch(() => ({})) as Record<string, unknown>;
  expect(session.ok()).toBe(true);
  expect((body.user as Record<string, unknown> | undefined)?.name).toBe(environment.username);
  const sync = await page.request.get('/api/user-data/sync?key=projects');
  const syncBody = await sync.json().catch(() => ({})) as Record<string, unknown>;
  expect(sync.ok()).toBe(true);
  expect(syncBody.canvasKernelMode).toBe(environment.expectedCanvasMode);
}

export async function openStage3Project(page: Page, projectId: string): Promise<void> {
  await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('[data-canvas-viewport]');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
  await expect(canvas).toHaveAttribute(
    'data-canvas-kernel-mode',
    requireStage3Environment().expectedCanvasMode,
    { timeout: 30_000 },
  );
}

export async function readStage3Projects(page: Page): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get('/api/user-data/sync?key=projects');
  expect(response.ok()).toBe(true);
  const body = await response.json() as { success?: boolean; value?: Array<Record<string, unknown>> };
  expect(body.success).toBe(true);
  return body.value ?? [];
}

export function stage3CanvasMedia(page: Page, nodeId: string): Locator {
  return page.locator(`[data-canvas-media-node=${JSON.stringify(nodeId)}]`);
}

function stage3CanvasImage(page: Page, nodeId: string): Locator {
  return page.locator(`img[data-canvas-media-node=${JSON.stringify(nodeId)}]`);
}

export function stage3CanvasCard(page: Page, nodeId: string): Locator {
  return stage3CanvasMedia(page, nodeId)
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " absolute ") and contains(concat(" ", normalize-space(@class), " "), " group ")][1]');
}

export async function waitForStage3Node(page: Page, nodeId: string, timeout = 30_000): Promise<void> {
  const image = stage3CanvasImage(page, nodeId);
  await expect(image).toBeVisible({ timeout });
  await expect.poll(() => image.evaluate(element => {
    const candidate = element as HTMLImageElement;
    return candidate.complete && candidate.naturalWidth > 0;
  }), { timeout }).toBe(true);
}

export async function writeStage3Metrics(
  evidence: Stage3Evidence,
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const file = join(evidence.directory, `${safe(name)}.json`);
  const body = JSON.stringify(value, null, 2);
  await writeFile(file, body, 'utf8');
  await testInfo.attach(`${safe(name)}.json`, { body: Buffer.from(body), contentType: 'application/json' });
}

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { writeEvidenceManifest } from './evidence-manifest';

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

const SECRET_PATTERN = /(authorization|api[-_]?key|access[-_]?token|password)(["'=:\s]+)[^\s"'&,}]+/gi;

function redact(value: string): string {
  return value.replace(SECRET_PATTERN, '$1$2[REDACTED]');
}

function safeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|authorization/i.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return redact(rawUrl);
  }
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

export const test = base.extend<{ stage2Evidence: Stage2Evidence }>({
  stage2Evidence: async ({ page }, activateFixture, testInfo) => {
    const evidence: Stage2Evidence = {
      console: [],
      network: [],
      requestIds: new Set<string>(),
      taskIds: new Set<string>(),
      recordPayload(payload) { collectIds(payload, evidence); },
    };
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        evidence.console.push({ type: message.type(), text: redact(message.text()), url: safeUrl(message.location().url) });
      }
    });
    page.on('requestfailed', request => {
      evidence.network.push({ method: request.method(), url: safeUrl(request.url()), text: redact(request.failure()?.errorText ?? 'request failed') });
    });
    page.on('response', response => {
      if (response.url().includes('/api/') || response.status() >= 400) {
        evidence.network.push({ method: response.request().method(), status: response.status(), url: safeUrl(response.url()) });
      }
      const headers = response.headers();
      const requestId = headers['x-request-id'] || headers['request-id'];
      if (requestId) evidence.requestIds.add(requestId);
    });

    await activateFixture(evidence);

    const capturedAt = new Date().toISOString();
    const status = testInfo.status === 'passed' ? 'completed' : testInfo.status === 'skipped' ? 'blocked' : 'failed';
    const featureId = `stage-2-${testInfo.titlePath.slice(1).join('-')}`;
    const manifest = await writeEvidenceManifest({
      commit: gitCommit(),
      deploymentUrl: String(testInfo.project.use.baseURL || process.env.E2E_BASE_URL || 'http://127.0.0.1:5000'),
      browser: testInfo.project.name,
      viewport: testInfo.project.use.viewport || { width: 1280, height: 720 },
      capturedAt,
      featureId,
      artifactPaths: {
        screenshot: 'screenshot.png',
        console: 'console.json',
        network: 'network.json',
        task: 'task.json',
      },
      requestIds: [...evidence.requestIds],
      status,
    });
    await mkdir(manifest.directory, { recursive: true });
    await Promise.all([
      page.screenshot({ path: join(manifest.directory, 'screenshot.png'), fullPage: true }),
      writeFile(join(manifest.directory, 'console.json'), JSON.stringify(evidence.console, null, 2)),
      writeFile(join(manifest.directory, 'network.json'), JSON.stringify(evidence.network, null, 2)),
      writeFile(join(manifest.directory, 'task.json'), JSON.stringify({ taskIds: [...evidence.taskIds] }, null, 2)),
    ]);
    await testInfo.attach('stage-2-evidence-manifest', { path: manifest.manifestPath, contentType: 'application/json' });
  },
});

export { expect };

export function requireStage2Env(...names: string[]): Record<string, string> {
  const missing = names.filter(name => !process.env[name]?.trim());
  test.skip(missing.length > 0, `BLOCKED: missing controlled Stage 2 inputs: ${missing.join(', ')}`);
  return Object.fromEntries(names.map(name => [name, process.env[name]!.trim()]));
}

export async function loginRealUser(page: Page): Promise<void> {
  const env = requireStage2Env('E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD');
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const entry = page.getByRole('button', { name: /无限画布/ }).first();
  if (await entry.isVisible().catch(() => false)) await entry.click();
  await page.getByPlaceholder('请输入用户名').fill(env.E2E_TEST_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(env.E2E_TEST_PASSWORD);
  const loginResponse = page.waitForResponse(response => response.url().includes('/api/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await loginResponse).ok()).toBeTruthy();
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
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy();
  return await response.json() as Record<string, unknown>;
}

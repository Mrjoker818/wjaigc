import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Page, type TestInfo } from '@playwright/test';

interface Stage3EvidenceEntry {
  method?: string;
  status?: number;
  text?: string;
  type?: string;
  url?: string;
}

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

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown-commit';
  }
}

function evidenceDirectory(testInfo: TestInfo): string {
  return join(
    process.cwd(),
    'test-results',
    'stage-3-baseline',
    'evidence',
    safe(gitCommit()),
    safe(testInfo.project.name),
    safe(testInfo.title),
  );
}

export const test = base.extend<{ stage3Evidence: Stage3Evidence }>({
  stage3Evidence: [async ({ page }, use, testInfo) => {
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
    page.on('requestfailed', request => {
      evidence.network.push({
        method: request.method(),
        url: sanitizeUrl(request.url()),
        text: redact(request.failure()?.errorText ?? 'request failed'),
      });
    });
    page.on('response', response => {
      if (response.status() >= 400) {
        evidence.network.push({
          method: response.request().method(),
          status: response.status(),
          url: sanitizeUrl(response.url()),
        });
      }
    });
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    await use(evidence);
    await page.screenshot({ path: join(directory, 'final.png'), fullPage: true }).catch(() => undefined);
    await page.context().tracing.stop({ path: join(directory, 'trace.zip') }).catch(() => undefined);
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
  }, { auto: true }],
});

export { expect };

export function requireStage3Environment(): {
  runId: string;
  username: string;
  password: string;
  projectMatrix: Record<string, Record<string, string>>;
} {
  const required = ['E2E_STAGE3_RUN_ID', 'E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD', 'E2E_STAGE3_PROJECT_IDS'] as const;
  const missing = required.filter(name => !process.env[name]?.trim());
  test.skip(missing.length > 0, `BLOCKED: missing controlled Stage 3 inputs: ${missing.join(', ')}`);
  let projectMatrix: Record<string, Record<string, string>>;
  try {
    projectMatrix = JSON.parse(process.env.E2E_STAGE3_PROJECT_IDS!) as Record<string, Record<string, string>>;
  } catch {
    throw new Error('E2E_STAGE3_PROJECT_IDS must be a JSON browser/node-count matrix');
  }
  return {
    runId: process.env.E2E_STAGE3_RUN_ID!.trim(),
    username: process.env.E2E_TEST_USERNAME!.trim(),
    password: process.env.E2E_TEST_PASSWORD!.trim(),
    projectMatrix,
  };
}

export function validateStage3ProjectIsolation(environment: Record<string, string | undefined>): void {
  const raw = environment.E2E_STAGE3_PROJECT_IDS;
  const runId = environment.E2E_STAGE3_RUN_ID?.trim();
  if (!raw || !runId) return;
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
  test.skip(!projectId, `BLOCKED: no ${nodeCount}-node Stage 3 project for ${projectName}`);
  return projectId!;
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
}

export async function openStage3Project(page: Page, projectId: string): Promise<void> {
  await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('[data-canvas-viewport]');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
}

export async function readStage3Projects(page: Page): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get('/api/user-data/sync?key=projects');
  expect(response.ok()).toBe(true);
  const body = await response.json() as { success?: boolean; value?: Array<Record<string, unknown>> };
  expect(body.success).toBe(true);
  return body.value ?? [];
}

export function stage3CanvasCard(page: Page, nodeId: string) {
  return page.getByAltText(nodeId, { exact: true })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " absolute ") and contains(concat(" ", normalize-space(@class), " "), " group ")][1]');
}

export async function waitForStage3Node(page: Page, nodeId: string): Promise<void> {
  const image = page.getByAltText(nodeId, { exact: true });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => image.evaluate(element => {
    const candidate = element as HTMLImageElement;
    return candidate.complete && candidate.naturalWidth > 0;
  }), { timeout: 30_000 }).toBe(true);
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

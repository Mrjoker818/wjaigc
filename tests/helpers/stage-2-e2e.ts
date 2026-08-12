import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test as base, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { Client } from 'pg';

import { writeEvidenceManifest, type EvidenceManifestInput } from './evidence-manifest';
import { normalizePostgresConnectionString } from '../../src/lib/db-client';

interface EvidenceEntry {
  method?: string;
  status?: number;
  type?: string;
  text?: string;
  url?: string;
}

export interface Stage2Evidence {
  console: EvidenceEntry[];
  network: EvidenceEntry[];
  requestIds: Set<string>;
  taskIds: Set<string>;
  recordPayload(payload: unknown): void;
  recordApi(method: string, url: string, status: number, payload?: unknown, requestId?: string): void;
  startTrace(): Promise<void>;
}

const SECRET_PATTERN = /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|client[-_]?secret|password|credential|secret))(["'=:\s]+)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi;

export function redactStage2Evidence(value: string): string {
  return value
    .replace(/("[^"]*(?:token|secret|password|credential)[^"]*"\s*:\s*")[^"]*/gi, '$1[REDACTED]')
    .replace(/("name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*")[^"]*/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(authorization)(["'=:\s]+)(?!Bearer\s)[^\s"'&,}]+/gi, '$1$2[REDACTED]')
    .replace(/(cookie|set-cookie)(["'=:\s]+)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi, '$1$2[REDACTED]')
    .replace(SECRET_PATTERN, '$1$2[REDACTED]');
}

export function sanitizeStage2Url(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    if (url.hash) url.hash = '#[REDACTED]';
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

async function sanitizeAndRemovePlaywrightTrace(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await sanitizePlaywrightTrace(sourcePath, destinationPath);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
  }
}

function collectIds(value: unknown, evidence: Stage2Evidence): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(item => collectIds(item, evidence));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && /request_?id/i.test(key)) evidence.requestIds.add(item);
    if (typeof item === 'string' && /(?:task|execution)_?id/i.test(key)) evidence.taskIds.add(item);
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
    let traceStarted = false;
    const evidence: Stage2Evidence = {
      console: [],
      network: [],
      requestIds: new Set<string>(),
      taskIds: new Set<string>(),
      recordPayload(payload) { collectIds(payload, evidence); },
      recordApi(method, url, status, payload, requestId) {
        evidence.network.push({ method, status, url: sanitizeStage2Url(url) });
        if (payload !== undefined) collectIds(payload, evidence);
        if (requestId) evidence.requestIds.add(requestId);
      },
      async startTrace() {
        if (traceStarted) return;
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
        traceStarted = true;
      },
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

    const rawTracePath = join(tmpdir(), `wujie-stage-2-${randomUUID()}.zip`);
    try {
      await activateFixture(evidence);
    } finally {
      const capturedAt = new Date().toISOString();
      const missingRequestIds = testInfo.status === 'passed' && evidence.requestIds.size === 0;
      const status = missingRequestIds || testInfo.status !== 'passed'
        ? testInfo.status === 'skipped' ? 'blocked' : 'failed'
        : 'completed';
      const featureId = `stage-2-${testInfo.titlePath.slice(1).join('-')}`;
      const artifactPaths: EvidenceManifestInput['artifactPaths'] = {
        console: 'console.json',
        network: 'network.json',
        task: 'task.json',
      };
      const commit = gitCommit();
      const directory = stage2EvidenceDirectory(commit, featureId, testInfo.project.name, capturedAt);
      await mkdir(directory, { recursive: true });
      let artifactError: unknown;
      try {
        const screenshot = 'screenshot.png';
        await page.screenshot({ path: join(directory, screenshot), fullPage: true });
        artifactPaths.screenshot = screenshot;
      } catch (error) {
        artifactError ??= error;
      }
      try {
        if (!traceStarted) await evidence.startTrace();
        await page.context().tracing.stop({ path: rawTracePath });
        const trace = 'trace.zip';
        await sanitizeAndRemovePlaywrightTrace(rawTracePath, join(directory, trace));
        artifactPaths.trace = trace;
      } catch (error) {
        artifactError ??= error;
      } finally {
        await unlink(rawTracePath).catch(() => undefined);
      }
      const video = page.video();
      await page.close().catch(error => { artifactError ??= error; });
      if (video) {
        try {
          const videoName = 'video.webm';
          await copyFile(await video.path(), join(directory, videoName));
          artifactPaths.video = videoName;
        } catch (error) {
          artifactError ??= error;
        }
      } else {
        artifactError ??= new Error('Stage 2 evidence video was not created');
      }
      for (const [name, content] of [
        ['console.json', evidence.console],
        ['network.json', evidence.network],
        ['task.json', { taskIds: [...evidence.taskIds] }],
      ] as const) {
        try {
          await writeFile(join(directory, name), JSON.stringify(content, null, 2));
        } catch (error) {
          artifactError ??= error;
          delete artifactPaths[name.split('.')[0]];
        }
      }
      const manifestInput: EvidenceManifestInput = {
        commit,
        deploymentUrl: sanitizeStage2Url(String(testInfo.project.use.baseURL || process.env.E2E_BASE_URL || 'http://127.0.0.1:5000')),
        browser: testInfo.project.name,
        viewport: testInfo.project.use.viewport || { width: 1280, height: 720 },
        capturedAt,
        featureId,
        artifactPaths,
        requestIds: [...evidence.requestIds],
        status: artifactError ? 'failed' : status,
      };
      const manifest = await writeEvidenceManifest(manifestInput);
      await testInfo.attach('stage-2-evidence-manifest', { path: manifest.manifestPath, contentType: 'application/json' });
      if (artifactError) throw artifactError;
      if (missingRequestIds) throw new Error('Stage 2 evidence did not capture any requestId');
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

export function validateStage2ProjectIsolation(environment: Record<string, string | undefined>): void {
  const runId = environment.E2E_STAGE2_RUN_ID?.trim() ?? '';
  const owners = new Map<string, string>();
  for (const [envName, raw] of Object.entries(environment)) {
    if (!envName.endsWith('_PROJECT_IDS') || !raw) continue;
    let matrix: unknown;
    try {
      matrix = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) continue;
    for (const projectId of Object.values(matrix as Record<string, unknown>)) {
      if (typeof projectId !== 'string' || !projectId.trim()) continue;
      if (!runId || !projectId.includes(runId)) {
        throw new Error(`${envName} project ${projectId} must include Stage 2 run id ${runId || '<missing>'}`);
      }
      const key = projectId.trim();
      const previous = owners.get(key);
      if (previous) {
        throw new Error(`${envName} reuses controlled project ${projectId} already assigned to ${previous}`);
      }
      owners.set(key, envName);
    }
  }
}

export function requireStage2ProjectValue(testProjectName: string, envName: string): string {
  const value = stage2ProjectMatrixValue(process.env[envName], testProjectName);
  test.skip(!value, `BLOCKED: ${envName} must contain a unique value for ${testProjectName}`);
  return value!;
}

export function requireNonEmptyStage2Value(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must be non-empty`);
  return normalized;
}

export function validateStage2SessionPayload(payload: unknown, expectedUsername: string): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (record.success !== true || !record.user || typeof record.user !== 'object') return false;
  return (record.user as Record<string, unknown>).name === expectedUsername;
}

export async function loginRealUser(
  page: Page,
  evidence?: Stage2Evidence,
  options: { destination?: string } = {},
): Promise<void> {
  const env = requireStage2Env('E2E_TEST_USERNAME', 'E2E_TEST_PASSWORD');
  await page.context().clearCookies();
  const loginResponse = await page.request.post('/api/auth/login', {
    data: { name: env.E2E_TEST_USERNAME, password: env.E2E_TEST_PASSWORD, productType: 'canvas' },
  });
  if (evidence) {
    const payload = await loginResponse.json().catch(() => ({}));
    const headers = loginResponse.headers();
    evidence.recordApi('POST', '/api/auth/login', loginResponse.status(), payload, headers['x-request-id'] || headers['request-id']);
    await evidence.startTrace();
  }
  expect(loginResponse.ok()).toBeTruthy();
  await page.goto(options.destination || '/?loginMode=canvas', { waitUntil: 'domcontentloaded' });
  const sessionResponse = await page.request.get('/api/session');
  const sessionPayload = await sessionResponse.json().catch(() => ({}));
  if (evidence) {
    const headers = sessionResponse.headers();
    evidence.recordApi('GET', '/api/session', sessionResponse.status(), sessionPayload, headers['x-request-id'] || headers['request-id']);
  }
  expect(sessionResponse.ok()).toBeTruthy();
  expect(validateStage2SessionPayload(sessionPayload, env.E2E_TEST_USERNAME), 'Page session does not belong to the controlled Stage 2 user').toBe(true);
  await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 20_000 });
}

export async function apiJson(
  page: Page,
  evidence: Stage2Evidence,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  data?: unknown,
): Promise<Record<string, unknown>> {
  const response = method === 'GET'
    ? await page.request.get(url)
    : method === 'DELETE'
      ? await page.request.delete(url)
      : await page.request.post(url, { data });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const headers = response.headers();
  evidence.recordApi(method, url, response.status(), payload, headers['x-request-id'] || headers['request-id']);
  expect(response.ok(), `${url} returned HTTP ${response.status()}`).toBeTruthy();
  return payload;
}

export async function canvasImageByUrl(page: Page, expectedUrl: string): Promise<Locator> {
  return imageByUrl(page, '[data-canvas-viewport] img[src]', expectedUrl);
}

export function canvasImageCard(image: Locator): Locator {
  return image.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " absolute ") and contains(concat(" ", normalize-space(@class), " "), " group ")][1]');
}

export async function imageByUrl(page: Page, selector: string, expectedUrl: string): Promise<Locator> {
  const controlledUrl = requireNonEmptyStage2Value(expectedUrl, 'controlled image URL');
  const images = page.locator(selector);
  await expect.poll(async () => images.evaluateAll((nodes, url) => nodes.findIndex(node => {
    const element = node as HTMLImageElement;
    return element.getAttribute('src') === url || element.src === url || element.src.endsWith(url);
  }), controlledUrl), { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
  const index = await images.evaluateAll((nodes, url) => nodes.findIndex(node => {
    const element = node as HTMLImageElement;
    return element.getAttribute('src') === url || element.src === url || element.src.endsWith(url);
  }), controlledUrl);
  return images.nth(index);
}

export async function deleteCanvasPlacementFromUi(
  page: Page,
  evidence: Stage2Evidence,
  placementId: string,
  url: string,
): Promise<void> {
  const image = await canvasImageByUrl(page, url);
  await canvasImageCard(image).click();
  const deleted = page.waitForResponse(response => response.url().includes(`/api/assets/placements/${placementId}`) && response.request().method() === 'DELETE');
  const saved = page.waitForResponse(response => response.url().includes('/api/user-data/sync') && response.request().method() === 'POST');
  await page.getByTestId('selected-image-delete').click();
  const deleteResponse = await deleted;
  const deletePayload = await deleteResponse.json().catch(() => ({}));
  evidence.recordApi('DELETE', deleteResponse.url(), deleteResponse.status(), deletePayload);
  expect(deleteResponse.ok()).toBeTruthy();
  const saveResponse = await saved;
  const savePayload = await saveResponse.json().catch(() => ({}));
  evidence.recordApi('POST', saveResponse.url(), saveResponse.status(), savePayload);
  expect(saveResponse.ok()).toBeTruthy();
  const images = page.locator('[data-canvas-viewport] img[src]');
  await expect.poll(() => images.evaluateAll((nodes, expectedUrl) => nodes.some(node => {
    const element = node as HTMLImageElement;
    return element.getAttribute('src') === expectedUrl || element.src === expectedUrl || element.src.endsWith(expectedUrl);
  }), url)).toBe(false);
}

export async function restoreProjectSnapshot(
  page: Page,
  evidence: Stage2Evidence,
  originalProject: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readProjects(page, evidence);
    const projectId = String(originalProject.id || '');
    const exists = current.projects.some(project => project.id === projectId);
    const projects = exists
      ? current.projects.map(project => project.id === projectId ? originalProject : project)
      : [...current.projects, originalProject];
    const response = await page.request.post('/api/user-data/sync', {
      data: { key: 'projects', value: projects, projectRevision: current.revision },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const headers = response.headers();
    evidence.recordApi('POST', '/api/user-data/sync', response.status(), payload, headers['x-request-id'] || headers['request-id']);
    if (response.ok()) return;
    if (response.status() !== 409 || attempt === 1) {
      expect(response.ok(), `Project snapshot restore returned HTTP ${response.status()}`).toBeTruthy();
    }
  }
}

export async function removeControlledProject(
  page: Page,
  evidence: Stage2Evidence,
  projectId: string,
  databaseBaseline: Stage2PlacementBaseline,
): Promise<void> {
  try {
    let removed = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const current = await readProjects(page, evidence);
        if (!current.projects.some(project => project.id === projectId)) {
          removed = true;
          break;
        }
        const response = await page.request.post('/api/user-data/sync', {
          data: {
            key: 'projects',
            value: current.projects.filter(project => project.id !== projectId),
            projectRevision: current.revision,
          },
        });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        const headers = response.headers();
        evidence.recordApi('POST', '/api/user-data/sync', response.status(), payload, headers['x-request-id'] || headers['request-id']);
        if (!response.ok() && response.status() !== 409) {
          lastError = new Error(`Controlled project removal returned HTTP ${response.status()}`);
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (!removed) {
      const current = await readProjects(page, evidence);
      removed = !current.projects.some(project => project.id === projectId);
    }
    expect(removed, `Controlled COW project remained after compensated removal: ${lastError instanceof Error ? lastError.message : String(lastError || 'unknown error')}`).toBe(true);
  } finally {
    const created = stage2PlacementDiff(
      databaseBaseline.placementIds,
      await readStage2PlacementRows(databaseBaseline.ownerId, projectId, 'optional'),
    );
    for (const placementId of created) {
      const response = await page.request.delete(`/api/assets/placements/${encodeURIComponent(placementId)}?projectId=${encodeURIComponent(projectId)}`);
      const payload = await response.json().catch(() => ({}));
      const headers = response.headers();
      evidence.recordApi('DELETE', response.url(), response.status(), payload, headers['x-request-id'] || headers['request-id']);
      if (!response.ok() && response.status() !== 404) {
        expect(response.ok(), `COW cleanup placement ${placementId} returned HTTP ${response.status()}`).toBeTruthy();
      }
    }
    expect(stage2PlacementDiff(
      databaseBaseline.placementIds,
      await readStage2PlacementRows(databaseBaseline.ownerId, projectId, 'optional'),
    )).toEqual([]);
  }
}

export function canvasProjectPlacements(project: Record<string, unknown> | undefined): Array<{
  id: string;
  placementId: string;
  assetVersionId: string;
  url: string;
}> {
  if (!project || !Array.isArray(project.canvasImages)) return [];
  return project.canvasImages.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const image = value as Record<string, unknown>;
    const id = typeof image.id === 'string' ? image.id : '';
    const placementId = typeof image.placementId === 'string' ? image.placementId : '';
    const assetVersionId = typeof image.assetVersionId === 'string' ? image.assetVersionId : '';
    const url = typeof image.url === 'string' ? image.url : '';
    return id && placementId && assetVersionId && url ? [{ id, placementId, assetVersionId, url }] : [];
  });
}

interface Stage2PlacementRow {
  id: string;
  status: string;
  entityId?: string;
  assetVersionId?: string;
}

export interface Stage2PlacementBaseline {
  ownerId: string;
  placementIds: string[];
}

export function stage2PlacementDiff(before: string[], after: Stage2PlacementRow[]): string[] {
  const baseline = new Set(before);
  return after.filter(row => row.status === 'active' && !baseline.has(row.id)).map(row => row.id);
}

export function stage2SingleNewPlacementMatches(
  before: string[],
  after: Stage2PlacementRow[],
  expected: { placementId: string; entityId: string; assetVersionId: string },
): boolean {
  const baseline = new Set(before);
  const created = after.filter(row => row.status === 'active' && !baseline.has(row.id));
  return created.length === 1
    && created[0].id === expected.placementId
    && created[0].entityId === expected.entityId
    && created[0].assetVersionId === expected.assetVersionId;
}

export function stage2DatabaseConnectionString(environment: Record<string, string | undefined>): string {
  const connectionString = environment.E2E_STAGE2_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('BLOCKED: E2E_STAGE2_DATABASE_URL must target the same database as the Stage 2 E2E deployment');
  }
  return connectionString;
}

type Stage2ProjectPresence = false | 'must-be-missing' | 'optional';

export function stage2ProjectPresenceIsValid(
  rows: Array<{ id: string }>,
  expected: Stage2ProjectPresence,
): boolean {
  if (expected === 'must-be-missing') return rows.length === 0;
  if (expected === 'optional') return rows.length <= 1;
  return rows.length === 1;
}

async function readStage2PlacementRows(
  ownerId: string,
  projectId: string,
  expectedProjectPresence: Stage2ProjectPresence = false,
): Promise<Stage2PlacementRow[]> {
  const connectionString = stage2DatabaseConnectionString(process.env);
  const client = new Client({
    connectionString: normalizePostgresConnectionString(connectionString),
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    if (expectedProjectPresence === 'must-be-missing') {
      const legacyProject = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM wujie_user_data user_data
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(user_data.data_value) = 'array' THEN user_data.data_value ELSE '[]'::jsonb END
         ) legacy(value)
         WHERE user_data.user_id = $1
           AND user_data.data_key = 'projects'
           AND legacy.value->>'id' = $2
           AND (NOT legacy.value ? 'userId' OR legacy.value->>'userId' = $1)`,
        [ownerId, projectId],
      );
      expect(
        legacyProject.rows[0]?.count,
        'COW legacy project is not uniquely present for the authenticated owner in the deployment database',
      ).toBe(1);
    }
    const project = await client.query<{ id: string }>(
      `SELECT id FROM wujie_projects WHERE id = $1 AND owner_id = $2`,
      [projectId, ownerId],
    );
    expect(
      stage2ProjectPresenceIsValid(project.rows, expectedProjectPresence),
      expectedProjectPresence === 'must-be-missing'
        ? 'COW fixture was already consumed because its asset-graph project row already exists'
        : expectedProjectPresence === 'optional'
          ? 'COW cleanup found multiple asset-graph project rows'
          : 'Controlled project is missing from the deployment database or belongs to another owner',
    ).toBe(true);
    const result = await client.query<{ id: string; status: string; entityId: string; assetVersionId: string }>(
      `SELECT id, status, entity_id AS "entityId", asset_version_id AS "assetVersionId"
       FROM wujie_workspace_placements
       WHERE owner_id = $1 AND project_id = $2
       ORDER BY id ASC`,
      [ownerId, projectId],
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

export async function stage2PlacementBaseline(
  page: Page,
  evidence: Stage2Evidence,
  projectId: string,
  options: { requireMissingProject?: boolean } = {},
): Promise<Stage2PlacementBaseline> {
  const session = await apiJson(page, evidence, 'GET', '/api/auth/me');
  const user = session.user as Record<string, unknown> | undefined;
  const ownerId = requireNonEmptyStage2Value(typeof user?.id === 'string' ? user.id : '', 'authenticated Stage 2 owner id');
  return {
    ownerId,
    placementIds: (await readStage2PlacementRows(
      ownerId,
      projectId,
      options.requireMissingProject === true ? 'must-be-missing' : false,
    ))
      .filter(row => row.status === 'active')
      .map(row => row.id),
  };
}

export async function assertSingleNewProjectPlacement(
  databaseBaseline: Stage2PlacementBaseline,
  projectId: string,
  expected: { placementId: string; entityId: string; assetVersionId: string },
): Promise<void> {
  const rows = await readStage2PlacementRows(databaseBaseline.ownerId, projectId);
  expect(
    stage2SingleNewPlacementMatches(databaseBaseline.placementIds, rows, expected),
    `Expected exactly one new placement with identity ${JSON.stringify(expected)}, received ${JSON.stringify(rows)}`,
  ).toBe(true);
}

export async function cleanupNewProjectPlacements(
  page: Page,
  evidence: Stage2Evidence,
  originalProject: Record<string, unknown>,
  knownPlacementIds: Iterable<string> = [],
  databaseBaseline: Stage2PlacementBaseline,
): Promise<void> {
  const projectId = String(originalProject.id || '');
  const originalPlacementIds = new Set(canvasProjectPlacements(originalProject).map(image => image.placementId));
  const created = new Set(knownPlacementIds);
  let discoveryError: unknown;
  try {
    try {
      for (const placementId of stage2PlacementDiff(
        databaseBaseline.placementIds,
        await readStage2PlacementRows(databaseBaseline.ownerId, projectId),
      )) {
        created.add(placementId);
      }
    } catch (error) {
      discoveryError = error;
    }
    try {
      const current = await readProjects(page, evidence);
      const project = current.projects.find(candidate => candidate.id === projectId);
      for (const image of canvasProjectPlacements(project)) {
        if (!originalPlacementIds.has(image.placementId)) created.add(image.placementId);
      }
    } catch (error) {
      discoveryError ??= error;
    }
    for (const placementId of created) {
      if (!placementId || originalPlacementIds.has(placementId)) continue;
      const response = await page.request.delete(`/api/assets/placements/${encodeURIComponent(placementId)}?projectId=${encodeURIComponent(projectId)}`);
      const payload = await response.json().catch(() => ({}));
      const headers = response.headers();
      evidence.recordApi('DELETE', response.url(), response.status(), payload, headers['x-request-id'] || headers['request-id']);
      if (!response.ok() && response.status() !== 404) {
        expect(response.ok(), `Cleanup placement ${placementId} returned HTTP ${response.status()}`).toBeTruthy();
      }
    }
    if (!discoveryError) {
      expect(stage2PlacementDiff(
        databaseBaseline.placementIds,
        await readStage2PlacementRows(databaseBaseline.ownerId, projectId),
      )).toEqual([]);
    }
    if (discoveryError) throw discoveryError;
  } finally {
    await restoreProjectSnapshot(page, evidence, originalProject);
  }
}

export async function ensurePlacementRestored(
  page: Page,
  evidence: Stage2Evidence,
  input: { projectId: string; assetId: string; versionId: string; placementId: string; url: string },
): Promise<Record<string, unknown>> {
  const resolveUrl = `/api/assets?projectId=${encodeURIComponent(input.projectId)}&assetVersionId=${encodeURIComponent(input.versionId)}&placementId=${encodeURIComponent(input.placementId)}`;
  const current = await page.request.get(resolveUrl);
  const currentPayload = await current.json().catch(() => ({})) as Record<string, unknown>;
  evidence.recordApi('GET', current.url(), current.status(), currentPayload);
  if (current.status() === 404 && currentPayload.error === 'ASSET_NOT_FOUND') {
    const restored = await apiJson(page, evidence, 'POST', `/api/assets/${encodeURIComponent(input.assetId)}/restore`, {
      projectId: input.projectId,
      placementId: input.placementId,
    });
    const placement = restored.placement as Record<string, unknown> | undefined;
    expect(placement?.id).toBe(input.placementId);
    expect(placement?.assetVersionId).toBe(input.versionId);
    expect(placement?.status).toBe('active');
  } else {
    expect(current.status()).toBe(200);
  }
  const resolved = await apiJson(page, evidence, 'GET', resolveUrl);
  expect(resolved.assetId).toBe(input.assetId);
  expect(resolved.assetVersionId).toBe(input.versionId);
  expect(resolved.placementId).toBe(input.placementId);
  expect(resolved.url).toBe(input.url);
  return resolved;
}

export async function readProjects(page: Page, evidence?: Stage2Evidence): Promise<{ projects: Array<Record<string, unknown>>; revision: number }> {
  const body = evidence
    ? await apiJson(page, evidence, 'GET', '/api/user-data/sync?key=projects') as { success?: boolean; value?: Array<Record<string, unknown>>; projectRevision?: number }
    : await (async () => {
      const response = await page.request.get('/api/user-data/sync?key=projects');
      expect(response.ok()).toBeTruthy();
      return response.json() as Promise<{ success?: boolean; value?: Array<Record<string, unknown>>; projectRevision?: number }>;
    })();
  expect(body.success).toBe(true);
  return { projects: body.value ?? [], revision: body.projectRevision ?? 0 };
}

export async function openCanvasProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('[data-canvas-viewport]');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
}

export async function postJson(page: Page, url: string, data: unknown, evidence?: Stage2Evidence): Promise<Record<string, unknown>> {
  if (evidence) return apiJson(page, evidence, 'POST', url, data);
  const response = await page.request.post(url, { data });
  expect(response.ok(), `${url} returned HTTP ${response.status()}`).toBeTruthy();
  return await response.json() as Record<string, unknown>;
}

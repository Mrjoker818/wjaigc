import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test as base, type Page, type TestInfo } from '@playwright/test';

import { stage3SourceIdentity } from './stage-3-source-state';

interface Stage4EvidenceEntry {
  type?: string;
  method?: string;
  status?: number;
  text?: string;
  url?: string;
  occurredAt?: number;
}

export interface Stage4Evidence {
  directory: string;
  console: Stage4EvidenceEntry[];
  network: Stage4EvidenceEntry[];
}

interface Stage4FixtureUser {
  id: string;
  browserProfile: string;
  username: string;
  password: string;
}

interface Stage4SeedTarget {
  browserProfile: string;
  username: string;
  canvasProject: Record<string, unknown>;
  chatProject: Record<string, unknown>;
  nodeCount: number;
}

type Stage4AuthStrategy =
  | 'register'
  | 'register-existing-login'
  | 'env-login'
  | 'admin-provisioned-login'
  | 'admin-login';

export interface Stage4AuthContext {
  userId: string;
  username: string;
  strategy: Stage4AuthStrategy;
  disposable: boolean;
}

const SECRET_PATTERN = /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|password|credential|secret))(["'=:\s]+)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi;
let cachedStage4RunId: string | null = null;

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

function stage4RunId(): string {
  if (cachedStage4RunId) return cachedStage4RunId;
  const raw = process.env.E2E_STAGE4_RUN_ID?.trim();
  cachedStage4RunId = raw
    ? safe(raw)
    : safe(`stage4-${new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '')}`);
  return cachedStage4RunId;
}

async function buildStage4Plan(runId: string) {
  const module = await import('../../scripts/stage-4-e2e-fixtures.mjs');
  return module.buildStage4FixturePlan(runId) as {
    users: Stage4FixtureUser[];
    workflows: Array<{
      browserProfile: string;
      canvasProject: Record<string, unknown>;
      chatProject: Record<string, unknown>;
      nodeCount: number;
    }>;
  };
}

async function assertStage4IsolationDatabaseConfigured(): Promise<void> {
  const module = await import('../../scripts/stage-4-e2e-fixtures.mjs');
  module.assertStage4FixtureDatabaseEnvironment(process.env);
}

function evidenceDirectory(testInfo: TestInfo): string {
  return join(
    process.cwd(),
    'test-results',
    'stage-4-baseline',
    'evidence',
    safe(stage3SourceIdentity()),
    safe(stage4RunId()),
    safe(testInfo.project.name),
    safe(testInfo.title),
    `retry-${testInfo.retry}`,
    `repeat-${testInfo.repeatEachIndex}`,
  );
}

async function readJson(response: import('@playwright/test').APIResponse): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export const test = base.extend<{ stage4Evidence: Stage4Evidence }>({
  stage4Evidence: [async ({ page }, useFixture, testInfo) => {
    const directory = evidenceDirectory(testInfo);
    const evidence: Stage4Evidence = { directory, console: [], network: [] };
    await mkdir(directory, { recursive: true });
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        evidence.console.push({
          type: message.type(),
          text: redact(message.text()),
          url: sanitizeUrl(message.location().url),
          occurredAt: Date.now(),
        });
      }
    });
    page.on('pageerror', error => {
      evidence.console.push({
        type: 'pageerror',
        text: redact(error.message),
        url: sanitizeUrl(page.url()),
        occurredAt: Date.now(),
      });
    });
    page.on('requestfailed', request => {
      evidence.network.push({
        method: request.method(),
        text: redact(request.failure()?.errorText ?? 'request failed'),
        url: sanitizeUrl(request.url()),
        occurredAt: Date.now(),
      });
    });
    page.on('response', response => {
      if (response.status() >= 400 || response.url().includes('/api/')) {
        evidence.network.push({
          method: response.request().method(),
          status: response.status(),
          url: sanitizeUrl(response.url()),
          occurredAt: Date.now(),
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
        artifactErrors.push('video: Stage 4 evidence video was not created');
      }
      await writeFile(join(directory, 'console.json'), JSON.stringify(evidence.console, null, 2), 'utf8');
      await writeFile(join(directory, 'network.json'), JSON.stringify(evidence.network, null, 2), 'utf8');
      await testInfo.attach('stage-4-console.json', {
        body: Buffer.from(JSON.stringify(evidence.console, null, 2)),
        contentType: 'application/json',
      });
      await testInfo.attach('stage-4-network.json', {
        body: Buffer.from(JSON.stringify(evidence.network, null, 2)),
        contentType: 'application/json',
      });
      if (testInfo.status === 'passed' && artifactErrors.length > 0) {
        throw new Error(`Stage 4 evidence artifacts failed: ${artifactErrors.join('; ')}`);
      }
    }
  }, { auto: true }],
});

export { expect };

export async function stage4FixtureForProject(projectName: string): Promise<Stage4FixtureUser & Stage4SeedTarget> {
  const plan = await buildStage4Plan(stage4RunId());
  const user = plan.users.find(candidate => candidate.browserProfile === projectName);
  const workflow = plan.workflows.find(candidate => candidate.browserProfile === projectName);
  if (!user || !workflow) {
    throw new Error(`BLOCKED: missing Stage 4 fixture plan for Playwright project "${projectName}"`);
  }
  return {
    ...user,
    browserProfile: workflow.browserProfile,
    canvasProject: workflow.canvasProject,
    chatProject: workflow.chatProject,
    nodeCount: workflow.nodeCount,
  };
}

async function currentSessionUser(page: Page): Promise<{ id: string; name: string }> {
  const response = await page.request.get('/api/session');
  const payload = await readJson(response);
  const user = payload.user as Record<string, unknown> | undefined;
  if (!response.ok || !user || typeof user.id !== 'string' || typeof user.name !== 'string') {
    throw new Error(`BLOCKED: failed to resolve authenticated Stage 4 session via /api/session (HTTP ${response.status()})`);
  }
  return { id: user.id, name: user.name };
}

async function loginWithPassword(
  page: Page,
  username: string,
  password: string,
  productType: 'canvas' | 'chat' = 'canvas',
): Promise<{ ok: boolean; status: number }> {
  const response = await page.request.post('/api/auth/login', {
    data: { name: username, password, productType },
  });
  return { ok: response.ok(), status: response.status() };
}

function isRunScopedStage4FixtureUsername(username: string, runId = stage4RunId()): boolean {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedRunId = safe(runId).toLowerCase();
  return (
    normalizedUsername.startsWith('stage4_')
    && normalizedUsername.endsWith(`_${normalizedRunId}`)
    && normalizedUsername.length > `stage4__${normalizedRunId}`.length
  );
}

function resolveControlledStage4EnvLogin(
  fixture: Stage4FixtureUser,
  environment: NodeJS.ProcessEnv = process.env,
  runId = stage4RunId(),
): { username: string; password: string } | null {
  const username = environment.E2E_TEST_USERNAME?.trim();
  const password = environment.E2E_TEST_PASSWORD?.trim();
  if (!username && !password) return null;
  if (!username || !password) {
    throw new Error('BLOCKED: E2E_TEST_USERNAME and E2E_TEST_PASSWORD must both be provided for Stage 4');
  }
  if (!isRunScopedStage4FixtureUsername(fixture.username, runId) || username !== fixture.username) {
    throw new Error(`BLOCKED: E2E_TEST_USERNAME must exactly match the run-scoped Stage 4 fixture user (${fixture.username})`);
  }
  return { username, password };
}

async function provisionDisposableStage4User(
  page: Page,
  fixture: Stage4FixtureUser,
): Promise<Stage4AuthContext> {
  const adminPassword = process.env.WUJIE_ADMIN_PASSWORD?.trim();
  const adminUsername = process.env.WUJIE_ADMIN_USERNAME?.trim() || 'Mr.joker';
  if (!adminPassword) {
    throw new Error('BLOCKED: WUJIE_ADMIN_PASSWORD is required to provision a disposable Stage 4 fixture user');
  }
  if (!isRunScopedStage4FixtureUsername(fixture.username)) {
    throw new Error(`BLOCKED: fixture username ${fixture.username} is not a run-scoped Stage 4 disposable account`);
  }

  const adminLogin = await loginWithPassword(page, adminUsername, adminPassword);
  if (!adminLogin.ok) {
    throw new Error(`BLOCKED: administrator login failed with HTTP ${adminLogin.status}`);
  }

  const usersResponse = await page.request.get('/api/admin/users');
  const usersPayload = await readJson(usersResponse);
  if (!usersResponse.ok || !Array.isArray(usersPayload.users)) {
    throw new Error(`BLOCKED: failed to enumerate Stage 4 fixture users through /api/admin/users (HTTP ${usersResponse.status()})`);
  }
  const existingUser = usersPayload.users.find(candidate => (
    candidate
    && typeof candidate === 'object'
    && typeof (candidate as Record<string, unknown>).name === 'string'
    && (candidate as Record<string, unknown>).name === fixture.username
  )) as Record<string, unknown> | undefined;

  if (!existingUser) {
    const createResponse = await page.request.post('/api/admin/users', {
      data: {
        action: 'create',
        name: fixture.username,
        password: fixture.password,
      },
    });
    const createPayload = await readJson(createResponse);
    if (!createResponse.ok && String(createPayload.error ?? '').trim() !== 'User already exists') {
      throw new Error(`BLOCKED: failed to provision disposable Stage 4 user ${fixture.username} (HTTP ${createResponse.status()})`);
    }
  }

  await page.context().clearCookies();
  const fixtureLogin = await loginWithPassword(page, fixture.username, fixture.password);
  if (!fixtureLogin.ok) {
    throw new Error(`BLOCKED: disposable Stage 4 user ${fixture.username} login failed with HTTP ${fixtureLogin.status}`);
  }
  const session = await currentSessionUser(page);
  if (session.name !== fixture.username) {
    throw new Error(`BLOCKED: authenticated Stage 4 session user ${session.name} did not match fixture ${fixture.username}`);
  }
  return {
    userId: session.id,
    username: session.name,
    strategy: 'admin-provisioned-login',
    disposable: true,
  };
}

export function assertStage4SeedIsolation(
  fixture: Stage4FixtureUser,
  auth: Stage4AuthContext,
  runId = stage4RunId(),
): void {
  if (
    !auth.disposable
    || auth.strategy === 'admin-login'
    || !isRunScopedStage4FixtureUsername(fixture.username, runId)
    || !isRunScopedStage4FixtureUsername(auth.username, runId)
    || auth.username !== fixture.username
  ) {
    throw new Error('BLOCKED: Stage 4 baseline requires a disposable, run-scoped Stage 4 fixture user before any persisted data mutation');
  }
}

export async function ensureStage4Session(
  page: Page,
  fixture: Stage4FixtureUser,
): Promise<Stage4AuthContext> {
  await assertStage4IsolationDatabaseConfigured();
  await page.context().clearCookies();

  const registerCheck = await page.request.get('/api/auth/register');
  const registerPayload = await readJson(registerCheck);
  const registrationEnabled = registerCheck.ok() && registerPayload.registrationEnabled === true;

  if (registrationEnabled) {
    const created = await page.request.post('/api/auth/register', {
      data: {
        name: fixture.username,
        password: fixture.password,
        confirmPassword: fixture.password,
        productType: 'canvas,chat',
      },
    });
    if (created.ok()) {
      const session = await currentSessionUser(page);
      return { userId: session.id, username: session.name, strategy: 'register', disposable: true };
    }
    if (created.status() === 409) {
      const loggedIn = await loginWithPassword(page, fixture.username, fixture.password);
      if (loggedIn.ok) {
        const session = await currentSessionUser(page);
        return {
          userId: session.id,
          username: session.name,
          strategy: 'register-existing-login',
          disposable: true,
        };
      }
      throw new Error(`BLOCKED: Stage 4 fixture user exists but login failed with HTTP ${loggedIn.status}`);
    }
    const failurePayload = await readJson(created);
    throw new Error(`BLOCKED: Stage 4 registration failed with HTTP ${created.status()} (${String(failurePayload.error ?? 'unknown error')})`);
  }

  const envLogin = resolveControlledStage4EnvLogin(fixture);
  if (envLogin) {
    const loggedIn = await loginWithPassword(page, envLogin.username, envLogin.password);
    if (loggedIn.ok) {
      const session = await currentSessionUser(page);
      return { userId: session.id, username: session.name, strategy: 'env-login', disposable: true };
    }
    throw new Error(`BLOCKED: E2E_TEST_USERNAME login failed with HTTP ${loggedIn.status}`);
  }

  if (process.env.WUJIE_ADMIN_PASSWORD?.trim()) {
    return provisionDisposableStage4User(page, fixture);
  }

  throw new Error(
    'BLOCKED: Stage 4 baseline requires registration enabled, a run-scoped E2E_TEST_USERNAME/E2E_TEST_PASSWORD fixture pair, or WUJIE_ADMIN_PASSWORD for disposable fixture provisioning',
  );
}

function mergeById<T extends { id: string }>(existing: T[], next: T): T[] {
  const filtered = existing.filter(candidate => candidate.id !== next.id);
  return [...filtered, next];
}

export async function seedStage4Baseline(
  page: Page,
  fixture: Stage4SeedTarget,
  auth: Stage4AuthContext,
): Promise<{ canvasKernelMode: string | null; projectRevision: number | null }> {
  assertStage4SeedIsolation({
    id: auth.userId,
    browserProfile: fixture.browserProfile,
    username: fixture.username,
    password: '',
  }, auth);
  const readProjects = await page.request.get('/api/user-data/sync?key=projects');
  const projectPayload = await readJson(readProjects);
  expect(readProjects.ok(), `/api/user-data/sync?key=projects returned HTTP ${readProjects.status()}`).toBe(true);
  const existingProjects = Array.isArray(projectPayload.value)
    ? projectPayload.value as Array<Record<string, unknown>>
    : [];
  const canvasProject = {
    ...fixture.canvasProject,
    userId: auth.userId,
  } as Record<string, unknown> & { id: string };
  const saveProjects = await page.request.post('/api/user-data/sync', {
    data: {
      key: 'projects',
      value: mergeById(existingProjects, canvasProject),
      projectRevision: Number.isSafeInteger(projectPayload.projectRevision)
        ? Number(projectPayload.projectRevision)
        : 0,
    },
  });
  const saveProjectPayload = await readJson(saveProjects);
  expect(saveProjects.ok(), `/api/user-data/sync projects save returned HTTP ${saveProjects.status()}`).toBe(true);

  const readChatProjects = await page.request.get('/api/user-data/sync?key=chat_simple_projects');
  const chatPayload = await readJson(readChatProjects);
  expect(readChatProjects.ok(), `/api/user-data/sync?key=chat_simple_projects returned HTTP ${readChatProjects.status()}`).toBe(true);
  const existingChatProjects = Array.isArray(chatPayload.value)
    ? chatPayload.value as Array<Record<string, unknown>>
    : [];
  const chatProject = fixture.chatProject as Record<string, unknown> & { id: string };
  const saveChatProjects = await page.request.post('/api/user-data/sync', {
    data: {
      key: 'chat_simple_projects',
      value: mergeById(existingChatProjects, chatProject),
    },
  });
  expect(saveChatProjects.ok(), `/api/user-data/sync chat_simple_projects save returned HTTP ${saveChatProjects.status()}`).toBe(true);

  return {
    canvasKernelMode: typeof projectPayload.canvasKernelMode === 'string'
      ? projectPayload.canvasKernelMode
      : null,
    projectRevision: Number.isSafeInteger(saveProjectPayload.projectRevision)
      ? Number(saveProjectPayload.projectRevision)
      : null,
  };
}

export async function openStage4CanvasProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  const canvas = page.locator('[data-canvas-viewport]');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(canvas).toHaveAttribute('data-project-id', projectId, { timeout: 30_000 });
}

export async function openStage4ChatProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/simple-chat?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('combobox', { name: '目标画布项目' })).toBeVisible({ timeout: 20_000 });
}

export async function writeStage4Metrics(
  evidence: Stage4Evidence,
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const file = join(evidence.directory, `${safe(name)}.json`);
  const body = JSON.stringify(value, null, 2);
  await writeFile(file, body, 'utf8');
  await testInfo.attach(`${safe(name)}.json`, {
    body: Buffer.from(body),
    contentType: 'application/json',
  });
}

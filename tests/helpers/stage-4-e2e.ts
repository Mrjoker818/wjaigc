import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { expect, test as base, type Page, type TestInfo } from '@playwright/test';
import { Pool } from 'pg';

import type { Workflow } from '../../src/lib/workflow-engine';
import { stage3SourceIdentity, stage3SourceState } from './stage-3-source-state';
import { stage4RuntimeEvidenceFailures } from './stage-4-evidence-filter';

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
  const fixtureModule = await import('../../scripts/stage-4-e2e-fixtures.mjs');
  return fixtureModule.buildStage4FixturePlan(runId) as {
    users: Stage4FixtureUser[];
    workflows: Array<{
      browserProfile: string;
      canvasProject: Record<string, unknown>;
      chatProject: Record<string, unknown>;
      nodeCount: number;
      expectedNodeIds: string[];
      workflow: Workflow;
    }>;
  };
}

async function assertStage4IsolationDatabaseConfigured(): Promise<void> {
  const fixtureModule = await import('../../scripts/stage-4-e2e-fixtures.mjs');
  fixtureModule.assertStage4FixtureDatabaseEnvironment(process.env);
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
    await writeFile(
      join(directory, 'source-state.json'),
      JSON.stringify(stage3SourceState(), null, 2),
      'utf8',
    );
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
      const runtimeFailures = stage4RuntimeEvidenceFailures(evidence.console, evidence.network);
      if (testInfo.status === 'passed' && artifactErrors.length > 0) {
        throw new Error(`Stage 4 evidence artifacts failed: ${artifactErrors.join('; ')}`);
      }
      if (
        testInfo.status === 'passed'
        && (runtimeFailures.consoleFailures.length > 0 || runtimeFailures.networkFailures.length > 0)
      ) {
        throw new Error(
          'Stage 4 runtime evidence failed: '
          + `${runtimeFailures.consoleFailures.length} console failure(s), `
          + `${runtimeFailures.networkFailures.length} network failure(s)`,
        );
      }
    }
  }, { auto: true }],
});

export { expect };

export async function stage4FixtureForProject(
  projectName: string,
): Promise<Stage4FixtureUser & Stage4SeedTarget & { expectedNodeIds: string[]; workflow: Workflow }> {
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
    expectedNodeIds: workflow.expectedNodeIds,
    workflow: workflow.workflow,
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
  const fullRunId = safe(runId).toLowerCase().replaceAll('-', '_');
  const normalizedRunId = fullRunId.length <= 9
    ? fullRunId
    : createHash('sha256').update(fullRunId).digest('hex').slice(0, 9);
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
    ? projectPayload.value as Array<Record<string, unknown> & { id: string }>
    : [];
  const canvasProject = {
    ...fixture.canvasProject,
    userId: auth.userId,
  } as unknown as Record<string, unknown> & { id: string };
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
    ? chatPayload.value as Array<Record<string, unknown> & { id: string }>
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

export async function seedStage4RuntimeDependencies(input: {
  auth: Stage4AuthContext;
  fixture: Stage4SeedTarget;
  providerBaseUrl: string;
}): Promise<{ sourceVersionId: string; selectedEntityId: string; canonicalUrl: string }> {
  await assertStage4IsolationDatabaseConfigured();
  const connectionString = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (!connectionString) throw new Error('BLOCKED: Stage 4 runtime database is not configured');
  const pool = new Pool({ connectionString });
  const profile = input.fixture.browserProfile;
  const projectId = String(input.fixture.canvasProject.id);
  const selectedEntityId = `stage4-image-${profile}`;
  const assetId = `stage4-asset-${profile}`;
  const sourceVersionId = `stage4-version-${profile}`;
  const placementId = `stage4-placement-${profile}`;
  const canonicalUrl = '/logo.png';
  const now = Date.now();
  try {
    await pool.query(
      `INSERT INTO wujie_api_providers(
         id, name, display_name, base_url, api_key, is_enabled, type, model_type,
         request_style, selected_models, advanced_params, is_default, created_at, updated_at,
         connection_status, discovered_models, sort_order
       ) VALUES
         ('stage4-chat-provider', 'Stage 4 Chat Provider', 'Stage 4 Chat Provider', $1, 'controlled-key', true,
          'general', 'general', 'chat-completions', $2::text[], '{}'::jsonb, true, $3, $3, 'connected', '[]'::jsonb, 1),
         ('stage4-image-provider', 'Stage 4 Image Provider', 'Stage 4 Image Provider', $1, 'controlled-key', true,
          'image', 'image', 'images-generations', $4::text[], '{}'::jsonb, true, $3, $3, 'connected', '[]'::jsonb, 2)
       ON CONFLICT (id) DO UPDATE SET
         base_url = EXCLUDED.base_url, api_key = EXCLUDED.api_key,
         type = EXCLUDED.type, model_type = EXCLUDED.model_type,
         selected_models = EXCLUDED.selected_models,
         is_enabled = true, updated_at = EXCLUDED.updated_at`,
      [input.providerBaseUrl, ['stage4-chat-model', 'stage4-gemini-vision-model'], now, ['stage4-image-model']],
    );
    await pool.query(
      `INSERT INTO wujie_projects(id, owner_id, name, status)
       VALUES ($1, $2, $3, 'active') ON CONFLICT (id) DO NOTHING`,
      [projectId, input.auth.userId, `Stage 4 ${profile}`],
    );
    await pool.query(
      `INSERT INTO wujie_credits(
         id, user_id, balance, total_recharged, total_used, created_at, updated_at
       ) VALUES ($1, $2, 10000, 10000, 0, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         balance = GREATEST(wujie_credits.balance, 10000),
         total_recharged = GREATEST(wujie_credits.total_recharged, 10000),
         updated_at = EXCLUDED.updated_at`,
      [`stage4-credits-${profile}`, input.auth.userId, now],
    );
    await pool.query(
      `INSERT INTO wujie_assets(id, owner_id, project_id, kind, status)
       VALUES ($1, $2, $3, 'image', 'active') ON CONFLICT (id) DO NOTHING`,
      [assetId, input.auth.userId, projectId],
    );
    await pool.query(
      `INSERT INTO wujie_asset_versions(
         id, asset_id, owner_id, project_id, file_url, availability, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, 'ready', $6) ON CONFLICT (id) DO NOTHING`,
      [sourceVersionId, assetId, input.auth.userId, projectId, canonicalUrl, `stage4:${profile}:source`],
    );
    await pool.query('UPDATE wujie_assets SET current_version_id = $2 WHERE id = $1', [assetId, sourceVersionId]);
    await pool.query(
      `INSERT INTO wujie_workspace_placements(
         id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id, status
       ) VALUES ($1, $2, $3, $4, $5, 'canvas', $6, 'canvas-image', $7, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [placementId, input.auth.userId, projectId, assetId, sourceVersionId,
        `canvas:${projectId}`, selectedEntityId],
    );
    await pool.query(
      `INSERT INTO wujie_workspace_placements(
         id, owner_id, project_id, asset_id, asset_version_id, workspace_kind,
         workspace_id, entity_type, entity_id, status
       ) VALUES ($1, $2, $3, $4, $5, 'canvas', $6, 'canvas-image', $7, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [`${placementId}-chat`, input.auth.userId, projectId, assetId, sourceVersionId,
        `embedded-chat:stage4-session-${profile}`, selectedEntityId],
    );
  } finally {
    await pool.end();
  }
  return { sourceVersionId, selectedEntityId, canonicalUrl };
}

export async function readStage4PersistedWorkflowNodeCount(
  page: Page,
  projectId: string,
): Promise<number> {
  const response = await page.request.get('/api/user-data/sync?key=projects');
  const payload = await readJson(response);
  if (!response.ok() || !Array.isArray(payload.value)) {
    throw new Error(`BLOCKED: failed to re-read Stage 4 projects (HTTP ${response.status()})`);
  }
  const project = payload.value.find(candidate => (
    candidate
    && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).id === projectId
  )) as Record<string, unknown> | undefined;
  const metadata = project?.metadata as Record<string, unknown> | undefined;
  const workflow = metadata?.workflow as Record<string, unknown> | undefined;
  return Array.isArray(workflow?.nodes) ? workflow.nodes.length : 0;
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

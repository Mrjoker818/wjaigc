import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { expect, test, type Page, type Request, type Response, type TestInfo } from '@playwright/test';

import {
  classifyFailedRequest,
  createExpectedResponseRegistry,
  redactCredentialMaterial,
  runArtifactPath,
  waitForAuthenticatedSessionForAction,
  type AuthFixtureRole,
  type ExpectedPrincipal,
  type ExpectedResponseRecord,
} from '../helpers/v588-auth-task-9';

type TestRole = AuthFixtureRole;

interface TestAccount extends ExpectedPrincipal {
  password: string;
}

interface ConsoleEntry {
  type: 'error' | 'warning';
  text: string;
  location: string;
  locationPath: string | null;
  stage: string | null;
}

interface NetworkEntry {
  method: string;
  path: string;
  status?: number;
  failure?: string;
  stage?: string | null;
  expectedToken?: string;
}

interface CapturedHttpFailure {
  request: Request;
  entry: NetworkEntry;
}

interface NetworkPartition {
  expected: NetworkEntry[];
  navigationAborted: NetworkEntry[];
  unexpected: NetworkEntry[];
}

interface RuntimeEvidence {
  console: ConsoleEntry[];
  pageErrors: string[];
  unhandledRejections: string[];
  dialogs: Array<{ type: string; message: string }>;
  httpFailures: CapturedHttpFailure[];
  requestFailures: NetworkEntry[];
  navigationAborts: NetworkEntry[];
  expectedResponses: ReturnType<typeof createExpectedResponseRegistry<Request>>;
  currentStage: string | null;
  navigationStage: string | null;
  partition?: NetworkPartition;
}

const UNHANDLED_REJECTION_PREFIX = '[E2E_UNHANDLED_REJECTION]';

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required isolated E2E environment variable: ${name}`);
  return value;
}

function accountForRole(role: TestRole): TestAccount {
  const prefix = role === 'admin' ? 'E2E_ADMIN' : 'E2E_USER';
  return {
    id: requireEnvironment(`${prefix}_ID`),
    name: requireEnvironment(`${prefix}_USERNAME`),
    password: requireEnvironment(`${prefix}_PASSWORD`),
    role,
  };
}

function redact(value: string, secrets: readonly string[]): string {
  return redactCredentialMaterial(Buffer.from(value, 'utf8'), secrets).toString('utf8');
}

function urlPath(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

async function runStage<T>(evidence: RuntimeEvidence, stage: string, action: () => Promise<T>): Promise<T> {
  const previous = evidence.currentStage;
  evidence.currentStage = stage;
  try {
    return await action();
  } finally {
    evidence.currentStage = previous;
  }
}

async function runNavigationStage<T>(
  evidence: RuntimeEvidence,
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = evidence.navigationStage;
  evidence.navigationStage = stage;
  try {
    return await runStage(evidence, stage, action);
  } finally {
    evidence.navigationStage = previous;
  }
}

async function collectRuntimeEvidence(page: Page, secrets: readonly string[]): Promise<RuntimeEvidence> {
  const evidence: RuntimeEvidence = {
    console: [],
    pageErrors: [],
    unhandledRejections: [],
    dialogs: [],
    httpFailures: [],
    requestFailures: [],
    navigationAborts: [],
    expectedResponses: createExpectedResponseRegistry<Request>(),
    currentStage: null,
    navigationStage: null,
  };

  await page.addInitScript((prefix: string) => {
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      console.error(`${prefix}${reason}`);
    });
  }, UNHANDLED_REJECTION_PREFIX);

  page.on('console', message => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = redact(message.text(), secrets);
    if (text.startsWith(UNHANDLED_REJECTION_PREFIX)) {
      evidence.unhandledRejections.push(text.slice(UNHANDLED_REJECTION_PREFIX.length));
      return;
    }
    const location = message.location();
    evidence.console.push({
      type: message.type() as 'error' | 'warning',
      text,
      location: `${location.url}:${location.lineNumber}:${location.columnNumber}`,
      locationPath: urlPath(location.url),
      stage: evidence.currentStage,
    });
  });
  page.on('pageerror', error => {
    evidence.pageErrors.push(redact(error.message, secrets));
  });
  page.on('dialog', dialog => {
    evidence.dialogs.push({ type: dialog.type(), message: redact(dialog.message(), secrets) });
    void dialog.dismiss();
  });
  page.on('requestfailed', request => {
    const entry: NetworkEntry = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      failure: redact(request.failure()?.errorText || 'unknown failure', secrets),
      stage: evidence.currentStage,
    };
    const classification = classifyFailedRequest({
      path: entry.path,
      failure: entry.failure || '',
      navigationStage: evidence.navigationStage,
    });
    if (classification === 'navigation-abort') evidence.navigationAborts.push(entry);
    else evidence.requestFailures.push(entry);
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    evidence.httpFailures.push({
      request: response.request(),
      entry: {
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
        stage: evidence.currentStage,
      },
    });
  });
  return evidence;
}

function markExpectedResponse(evidence: RuntimeEvidence, response: Response, stage: string): string {
  return evidence.expectedResponses.expect(response.request(), {
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
    stage,
  });
}

function partitionNetwork(evidence: RuntimeEvidence): NetworkPartition {
  if (evidence.partition) return evidence.partition;
  const expected: NetworkEntry[] = [];
  const unexpected: NetworkEntry[] = [...evidence.requestFailures];
  for (const captured of evidence.httpFailures) {
    const match = evidence.expectedResponses.consume(captured.request);
    if (
      match
      && match.method === captured.entry.method
      && match.path === captured.entry.path
      && match.status === captured.entry.status
    ) {
      expected.push({ ...captured.entry, stage: match.stage, expectedToken: match.token });
    } else {
      unexpected.push(captured.entry);
    }
  }
  unexpected.push(...evidence.expectedResponses.remaining().map(record => ({
    method: record.method,
    path: record.path,
    status: record.status,
    stage: record.stage,
    failure: 'Expected response identity was not captured exactly once',
    expectedToken: record.token,
  })));
  evidence.partition = { expected, navigationAborted: evidence.navigationAborts, unexpected };
  return evidence.partition;
}

function unexpectedConsoleEntries(
  evidence: RuntimeEvidence,
  expectedNetwork: readonly ExpectedResponseRecord[],
): ConsoleEntry[] {
  const available = new Map<string, string[]>();
  for (const entry of expectedNetwork) {
    if (entry.status !== 401 && entry.status !== 429) continue;
    const key = `${entry.stage}|${entry.path}|${entry.status}`;
    available.set(key, [...(available.get(key) || []), entry.token]);
  }
  return evidence.console.filter(entry => {
    if (entry.type !== 'error' || !entry.stage || !entry.locationPath || !/^Failed to load resource/.test(entry.text)) {
      return true;
    }
    const status = /(?:^|\D)(401|429)(?:\D|$)/.exec(entry.text)?.[1];
    if (!status) return true;
    const key = `${entry.stage}|${entry.locationPath}|${status}`;
    const tokens = available.get(key);
    if (!tokens?.length) return true;
    tokens.shift();
    return false;
  });
}

async function saveEvidence(
  page: Page,
  testInfo: TestInfo,
  role: TestRole,
  evidence: RuntimeEvidence,
): Promise<void> {
  const runId = requireEnvironment('E2E_AUTH_RUN_ID');
  const consolePath = runArtifactPath('console', runId, testInfo.project.name, role, testInfo.retry, 'runtime.json');
  const networkPath = runArtifactPath('network', runId, testInfo.project.name, role, testInfo.retry, 'runtime.json');
  const screenshotPath = runArtifactPath('screenshots', runId, testInfo.project.name, role, testInfo.retry, 'logged-out-selection.png');
  const { expected, unexpected } = partitionNetwork(evidence);
  const consolePayload = {
    console: evidence.console,
    pageErrors: evidence.pageErrors,
    unhandledRejections: evidence.unhandledRejections,
    dialogs: evidence.dialogs,
  };
  const networkPayload = {
    expectedAuthentication: expected,
    navigationAborted: evidence.navigationAborts,
    unexpected,
  };
  const identityPath = testInfo.outputPath('v588-artifact-identity.json');

  await Promise.all([consolePath, networkPath, screenshotPath, identityPath].map(path => mkdir(dirname(path), { recursive: true })));
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await Promise.all([
    writeFile(consolePath, `${JSON.stringify(consolePayload, null, 2)}\n`, 'utf8'),
    writeFile(networkPath, `${JSON.stringify(networkPayload, null, 2)}\n`, 'utf8'),
    writeFile(identityPath, `${JSON.stringify({
      runId,
      project: testInfo.project.name,
      role,
      retry: testInfo.retry,
    }, null, 2)}\n`, 'utf8'),
  ]);
  await Promise.all([
    testInfo.attach('runtime-console.json', { path: consolePath, contentType: 'application/json' }),
    testInfo.attach('runtime-network.json', { path: networkPath, contentType: 'application/json' }),
    testInfo.attach('logged-out-selection.png', { path: screenshotPath, contentType: 'image/png' }),
  ]);
}

async function resetBrowserState(page: Page, evidence: RuntimeEvidence): Promise<void> {
  await page.context().clearCookies();
  await runNavigationStage(evidence, 'initial-entry-navigation', () => page.goto('/', { waitUntil: 'domcontentloaded' }));
  await page.evaluate(() => localStorage.clear());
  await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
}

async function openLoginForm(page: Page, mode: 'canvas' | 'chat'): Promise<void> {
  const name = mode === 'canvas' ? /无限画布/ : /智能对话/;
  await page.getByRole('button', { name }).first().click();
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
}

async function fillLogin(page: Page, account: TestAccount, password: string): Promise<void> {
  await page.getByPlaceholder('请输入用户名').fill(account.name);
  await page.getByPlaceholder('请输入密码').fill(password);
}

async function submitRejectedLogin(
  page: Page,
  evidence: RuntimeEvidence,
  account: TestAccount,
  stage: string,
): Promise<Response> {
  await fillLogin(page, account, `${account.password}-incorrect`);
  const response = await runStage(evidence, stage, async () => {
    const responsePromise = page.waitForResponse(candidate => (
      new URL(candidate.url()).pathname === '/api/auth/login'
      && candidate.request().method() === 'POST'
    ));
    const [result] = await Promise.all([
      responsePromise,
      page.getByRole('button', { name: '登录', exact: true }).click(),
    ]);
    return result;
  });
  markExpectedResponse(evidence, response, stage);
  return response;
}

async function submitAcceptedLogin(
  page: Page,
  evidence: RuntimeEvidence,
  account: TestAccount,
  stage: string,
): Promise<Response> {
  await fillLogin(page, account, account.password);
  return await runNavigationStage(evidence, stage, async () => {
    const loginResponse = page.waitForResponse(candidate => (
      new URL(candidate.url()).pathname === '/api/auth/login'
      && candidate.request().method() === 'POST'
    ));
    const [response] = await Promise.all([
      loginResponse,
      waitForAuthenticatedSessionForAction(
        page,
        account,
        stage,
        () => page.getByRole('button', { name: '登录', exact: true }).click(),
      ),
    ]);
    return response;
  });
}

async function reloadWithAuthenticatedSession(
  page: Page,
  evidence: RuntimeEvidence,
  account: TestAccount,
  stage: string,
): Promise<void> {
  await runNavigationStage(evidence, stage, () => waitForAuthenticatedSessionForAction(
    page,
    account,
    stage,
    () => page.reload({ waitUntil: 'domcontentloaded' }),
  )).then(() => undefined);
}

async function assertMigratedCredential(role: TestRole, account: TestAccount): Promise<void> {
  const usersPath = join(requireEnvironment('WUJIE_DATA_DIR'), 'system', 'users.json');
  const parsed = JSON.parse(await readFile(usersPath, 'utf8')) as {
    users?: Array<{ id?: string; name?: string; role?: string; passwordHash?: string; credentialHash?: string }>;
  };
  const user = parsed.users?.find(candidate => candidate.id === account.id);
  const secret = requireEnvironment('WUJIE_AUTH_SECRET');
  const legacyHash = createHash('sha256').update(`${secret}:${account.password}`).digest('hex');
  expect(Boolean(user), `${role} fixture must remain present after browser login`).toBe(true);
  expect(user?.name === account.name, `${role} fixture name must remain unchanged`).toBe(true);
  expect(user?.role, `${role} fixture must retain its role`).toBe(role);
  expect(user?.passwordHash === legacyHash, `${role} legacy password hash must remain byte-compatible`).toBe(true);
  expect(
    typeof user?.credentialHash === 'string' && /^scrypt-v1\$32768\$8\$1\$/.test(user.credentialHash),
    `${role} credential sidecar must exist after browser login`,
  ).toBe(true);
}

async function verifyPostLogoutIsolation(page: Page, evidence: RuntimeEvidence): Promise<void> {
  const stage = 'post-logout-isolation';
  const sessionPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/session'
    && response.request().method() === 'GET'
  ));
  const protectedPromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/user-data/sync'
    && response.request().method() === 'GET'
  ));
  const [session, protectedData] = await runStage(evidence, stage, async () => {
    const [sessionResponse, protectedResponse] = await Promise.all([
      sessionPromise,
      protectedPromise,
      page.evaluate(async () => {
        await Promise.all([
          fetch('/api/session', { credentials: 'include' }),
          fetch('/api/user-data/sync?key=projects', { credentials: 'include' }),
        ]);
      }),
    ]);
    return [sessionResponse, protectedResponse] as const;
  });
  markExpectedResponse(evidence, protectedData, stage);
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ success: true, user: null });
  expect(protectedData.status()).toBe(401);
}

function expectedConsoleRecords(entries: readonly NetworkEntry[]): ExpectedResponseRecord[] {
  return entries.flatMap(entry => (
    entry.expectedToken && entry.stage && entry.status !== undefined
      ? [{
        token: entry.expectedToken,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        stage: entry.stage,
      }]
      : []
  ));
}

async function exerciseRole(page: Page, testInfo: TestInfo, role: TestRole): Promise<void> {
  const account = accountForRole(role);
  const allAccounts = [accountForRole('admin'), accountForRole('user')];
  const evidence = await collectRuntimeEvidence(
    page,
    allAccounts.flatMap(candidate => [
      candidate.name,
      candidate.password,
      `${candidate.password}-incorrect`,
    ]),
  );

  try {
    await resetBrowserState(page, evidence);
    await openLoginForm(page, 'canvas');

    const rejected = await submitRejectedLogin(page, evidence, account, 'canvas-wrong-password');
    expect(rejected.status()).toBe(401);
    await expect(page.getByText('登录失败，请检查用户名、密码或授权')).toBeVisible();

    const accepted = await submitAcceptedLogin(page, evidence, account, 'canvas-correct-login');
    expect(accepted.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });
    await assertMigratedCredential(role, account);

    await reloadWithAuthenticatedSession(page, evidence, account, 'dashboard-refresh');
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });

    await runNavigationStage(evidence, 'canvas-navigation', () => page.goto('/?loginMode=canvas', { waitUntil: 'domcontentloaded' }));
    await expect(page.getByRole('group', { name: '空画布快捷操作' })).toBeVisible({ timeout: 30_000 });
    await reloadWithAuthenticatedSession(page, evidence, account, 'canvas-refresh');
    await expect(page.getByRole('group', { name: '空画布快捷操作' })).toBeVisible({ timeout: 30_000 });

    await runNavigationStage(evidence, 'dashboard-navigation', () => page.goto('/?view=dashboard', { waitUntil: 'domcontentloaded' }));
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });
    await page.getByTitle('查看用户信息').click();
    const logoutResponsePromise = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/auth/logout'
      && response.request().method() === 'POST'
    ));
    const [logoutResponse] = await Promise.all([
      logoutResponsePromise,
      page.getByRole('button', { name: '退出登录', exact: true }).click(),
    ]);
    expect(logoutResponse.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible({ timeout: 20_000 });
    await verifyPostLogoutIsolation(page, evidence);

    await openLoginForm(page, 'chat');
    const chatLogin = await submitAcceptedLogin(page, evidence, account, 'chat-correct-login');
    expect(chatLogin.status()).toBe(200);
    await expect(page).toHaveURL(/\/simple-chat/);
    await expect(page.getByRole('heading', { name: '智能对话', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder(/输入消息/)).toBeVisible({ timeout: 20_000 });
    await reloadWithAuthenticatedSession(page, evidence, account, 'chat-refresh');
    await expect(page.getByPlaceholder(/输入消息/)).toBeVisible({ timeout: 20_000 });

    const finalLogoutPromise = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/auth/logout'
      && response.request().method() === 'POST'
    ));
    const [finalLogout] = await Promise.all([
      finalLogoutPromise,
      page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })),
    ]);
    expect(finalLogout.status()).toBe(200);
    await runNavigationStage(evidence, 'final-entry-navigation', () => page.goto('/', { waitUntil: 'domcontentloaded' }));
    await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible({ timeout: 20_000 });

    const network = partitionNetwork(evidence);
    const unexpectedConsole = unexpectedConsoleEntries(evidence, expectedConsoleRecords(network.expected));
    expect(network.expected.filter(entry => entry.status === 401)).toHaveLength(2);
    expect({
      unexpectedNetwork: network.unexpected.length,
      unexpectedConsole: unexpectedConsole.length,
      pageErrors: evidence.pageErrors.length,
      unhandledRejections: evidence.unhandledRejections.length,
      dialogs: evidence.dialogs.length,
    }, 'browser runtime gate counts').toEqual({
      unexpectedNetwork: 0,
      unexpectedConsole: 0,
      pageErrors: 0,
      unhandledRejections: 0,
      dialogs: 0,
    });
  } finally {
    await saveEvidence(page, testInfo, role, evidence);
  }
}

test.describe('V588-AUTH-001 isolated production session gate', () => {
  for (const role of ['admin', 'user'] as const) {
    test(`${role} uses real forms across canvas, dashboard, chat, refresh, failure recovery, and logout`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await exerciseRole(page, testInfo, role);
    });
  }
});

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Page, type Response, type TestInfo } from '@playwright/test';

type TestRole = 'admin' | 'user';

interface TestAccount {
  name: string;
  password: string;
}

interface ConsoleEntry {
  type: 'error' | 'warning';
  text: string;
  location: string;
}

interface NetworkEntry {
  method: string;
  path: string;
  status?: number;
  failure?: string;
}

interface RuntimeEvidence {
  console: ConsoleEntry[];
  pageErrors: string[];
  unhandledRejections: string[];
  dialogs: Array<{ type: string; message: string }>;
  httpFailures: NetworkEntry[];
  requestFailures: NetworkEntry[];
  navigationAborts: NetworkEntry[];
  expectedNetworkSignatures: Set<string>;
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
    name: requireEnvironment(`${prefix}_USERNAME`),
    password: requireEnvironment(`${prefix}_PASSWORD`),
  };
}

function redact(value: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => (
    secret ? result.replaceAll(secret, '[REDACTED]') : result
  ), value);
}

function responseSignature(response: Response): string {
  return `${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`;
}

async function collectRuntimeEvidence(
  page: Page,
  secrets: readonly string[],
): Promise<RuntimeEvidence> {
  const evidence: RuntimeEvidence = {
    console: [],
    pageErrors: [],
    unhandledRejections: [],
    dialogs: [],
    httpFailures: [],
    requestFailures: [],
    navigationAborts: [],
    expectedNetworkSignatures: new Set<string>(),
  };

  await page.addInitScript((prefix: string) => {
    window.addEventListener('unhandledrejection', (event) => {
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
    const entry = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      failure: redact(request.failure()?.errorText || 'unknown failure', secrets),
    };
    if (/ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_ABORT|Load request cancelled/i.test(entry.failure)) {
      evidence.navigationAborts.push(entry);
    }
    else evidence.requestFailures.push(entry);
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    evidence.httpFailures.push({
      method: response.request().method(),
      path: new URL(response.url()).pathname,
      status: response.status(),
    });
  });
  return evidence;
}

function markExpectedNetwork(evidence: RuntimeEvidence, response: Response): void {
  evidence.expectedNetworkSignatures.add(responseSignature(response));
}

function partitionNetwork(evidence: RuntimeEvidence): {
  expected: NetworkEntry[];
  navigationAborted: NetworkEntry[];
  unexpected: NetworkEntry[];
} {
  const expected: NetworkEntry[] = [];
  const unexpected: NetworkEntry[] = [...evidence.requestFailures];
  for (const entry of evidence.httpFailures) {
    const signature = `${entry.method} ${entry.path} ${entry.status}`;
    if (evidence.expectedNetworkSignatures.has(signature)) expected.push(entry);
    else unexpected.push(entry);
  }
  return { expected, navigationAborted: evidence.navigationAborts, unexpected };
}

function unexpectedConsoleEntries(
  evidence: RuntimeEvidence,
  expectedNetwork: readonly NetworkEntry[],
): ConsoleEntry[] {
  const expectedAuthenticationStatus = expectedNetwork.some(entry => (
    entry.status === 401 || entry.status === 429
  ));
  return evidence.console.filter(entry => !(
    expectedAuthenticationStatus
    && entry.type === 'error'
    && /^Failed to load resource/.test(entry.text)
    && /(?:401|429)/.test(entry.text)
  ));
}

async function saveEvidence(
  page: Page,
  testInfo: TestInfo,
  role: TestRole,
  evidence: RuntimeEvidence,
): Promise<void> {
  const root = join(process.cwd(), 'test-results');
  const label = `v588-auth-001-${role}-${testInfo.project.name}`;
  const consolePath = join(root, 'console', `${label}.json`);
  const networkPath = join(root, 'network', `${label}.json`);
  const screenshotPath = join(root, 'screenshots', `${label}.png`);
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

  await Promise.all([
    mkdir(join(root, 'console'), { recursive: true }),
    mkdir(join(root, 'network'), { recursive: true }),
    mkdir(join(root, 'screenshots'), { recursive: true }),
    mkdir(join(root, 'videos'), { recursive: true }),
    mkdir(join(root, 'traces'), { recursive: true }),
  ]);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await Promise.all([
    writeFile(consolePath, `${JSON.stringify(consolePayload, null, 2)}\n`, 'utf8'),
    writeFile(networkPath, `${JSON.stringify(networkPayload, null, 2)}\n`, 'utf8'),
  ]);
  await Promise.all([
    testInfo.attach('runtime-console.json', { path: consolePath, contentType: 'application/json' }),
    testInfo.attach('runtime-network.json', { path: networkPath, contentType: 'application/json' }),
    testInfo.attach('logged-out-selection.png', { path: screenshotPath, contentType: 'image/png' }),
  ]);
}

async function resetBrowserState(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible();
}

async function openLoginForm(page: Page, mode: 'canvas' | 'chat'): Promise<void> {
  const name = mode === 'canvas' ? /无限画布/ : /智能对话/;
  await page.getByRole('button', { name }).first().click();
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
}

async function submitLogin(
  page: Page,
  account: TestAccount,
  password: string,
): Promise<Response> {
  await page.getByPlaceholder('请输入用户名').fill(account.name);
  await page.getByPlaceholder('请输入密码').fill(password);
  const responsePromise = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/auth/login'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  return await responsePromise;
}

async function assertMigratedCredential(role: TestRole, account: TestAccount): Promise<void> {
  const usersPath = join(requireEnvironment('WUJIE_DATA_DIR'), 'system', 'users.json');
  const parsed = JSON.parse(await readFile(usersPath, 'utf8')) as {
    users?: Array<{ name?: string; role?: string; passwordHash?: string; credentialHash?: string }>;
  };
  const user = parsed.users?.find(candidate => candidate.name === account.name);
  const secret = requireEnvironment('WUJIE_AUTH_SECRET');
  const legacyHash = createHash('sha256').update(`${secret}:${account.password}`).digest('hex');
  expect(Boolean(user), `${role} fixture must remain present after browser login`).toBe(true);
  expect(user?.role, `${role} fixture must retain its role`).toBe(role);
  expect(user?.passwordHash === legacyHash, `${role} legacy password hash must remain byte-compatible`).toBe(true);
  expect(
    typeof user?.credentialHash === 'string' && /^scrypt-v1\$32768\$8\$1\$/.test(user.credentialHash),
    `${role} credential sidecar must exist after browser login`,
  ).toBe(true);
}

async function verifyPostLogoutIsolation(page: Page, evidence: RuntimeEvidence): Promise<void> {
  const result = await page.evaluate(async () => {
    const [session, protectedData] = await Promise.all([
      fetch('/api/session', { credentials: 'include' }),
      fetch('/api/user-data/sync?key=projects', { credentials: 'include' }),
    ]);
    return {
      sessionStatus: session.status,
      sessionBody: await session.json() as { success?: boolean; user?: unknown },
      protectedStatus: protectedData.status,
    };
  });
  evidence.expectedNetworkSignatures.add('GET /api/user-data/sync 401');
  expect(result.sessionStatus).toBe(200);
  expect(result.sessionBody).toEqual({ success: true, user: null });
  expect(result.protectedStatus).toBe(401);
}

async function exerciseRole(
  page: Page,
  testInfo: TestInfo,
  role: TestRole,
): Promise<void> {
  const account = accountForRole(role);
  const allAccounts = [accountForRole('admin'), accountForRole('user')];
  const evidence = await collectRuntimeEvidence(
    page,
    allAccounts.flatMap(candidate => [candidate.name, candidate.password]),
  );

  try {
    await resetBrowserState(page);
    await openLoginForm(page, 'canvas');

    const rejected = await submitLogin(page, account, `${account.password}-incorrect`);
    expect(rejected.status()).toBe(401);
    markExpectedNetwork(evidence, rejected);
    await expect(page.getByText('登录失败，请检查用户名、密码或授权')).toBeVisible();

    const accepted = await submitLogin(page, account, account.password);
    expect(accepted.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });
    await assertMigratedCredential(role, account);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });

    await page.goto('/?loginMode=canvas', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('group', { name: '空画布快捷操作' })).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('group', { name: '空画布快捷操作' })).toBeVisible({ timeout: 30_000 });

    await page.goto('/?view=dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });
    await page.getByTitle('查看用户信息').click();
    const logoutResponsePromise = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/auth/logout'
      && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    expect((await logoutResponsePromise).status()).toBe(200);
    await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible({ timeout: 20_000 });
    await verifyPostLogoutIsolation(page, evidence);

    await openLoginForm(page, 'chat');
    const chatLogin = await submitLogin(page, account, account.password);
    expect(chatLogin.status()).toBe(200);
    await expect(page).toHaveURL(/\/simple-chat/);
    await expect(page.getByRole('heading', { name: '智能对话', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder(/输入消息/)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder(/输入消息/)).toBeVisible({ timeout: 20_000 });

    const finalLogoutStatus = await page.evaluate(async () => (
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    ).status);
    expect(finalLogoutStatus).toBe(200);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '选择入口' })).toBeVisible({ timeout: 20_000 });

    const network = partitionNetwork(evidence);
    const unexpectedConsole = unexpectedConsoleEntries(evidence, network.expected);
    expect(network.expected.some(entry => entry.status === 401)).toBe(true);
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

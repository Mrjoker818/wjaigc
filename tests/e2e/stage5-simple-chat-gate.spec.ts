/**
 * 阶段 5 外部验收门禁：智能对话独立页（simple-chat）。
 *
 * 真实账号登录、会话写入、100 条消息渲染与会话切换始终走真实应用路径。
 * 只有标有 DETERMINISTIC_BROWSER_* 的 route mock 用于浏览器协议/UI 回归；
 * 它们不代表真实供应商成功，也绝不能作为云端验收依据。
 */

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { collectBrowserEvidence, saveBrowserEvidence } from '../helpers/evidence';

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5000';
const CHAT_PROJECTS_SYNC_KEY = 'chat_simple_projects';

type RealCredentials = {
  username: string;
  password: string;
};

type ChatMessageFixture = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  createdAt: number;
};

type ChatTaskFixture = {
  id: string;
  projectId: string;
  name: string;
  messages: ChatMessageFixture[];
  model: string;
  providerId: string;
  imageModel?: string;
  imageProviderId?: string;
  createdAt: number;
  updatedAt: number;
};

type ChatProjectFixture = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  createdAt: number;
  updatedAt: number;
  tasks: ChatTaskFixture[];
  agents: [];
  knowledgeItems: [];
};

type ModelFixture = {
  id: string;
  name: string;
  providerId: string;
};

type ChatProjectsSnapshot = {
  value: unknown;
};

function credentialsFor(workerIndex: number): RealCredentials {
  const workerUsername = process.env[`E2E_TEST_USERNAME_${workerIndex}`]?.trim();
  const workerPassword = process.env[`E2E_TEST_PASSWORD_${workerIndex}`]?.trim();
  if (workerUsername || workerPassword) {
    if (!workerUsername || !workerPassword) {
      throw new Error(`E2E worker ${workerIndex} requires both E2E_TEST_USERNAME_${workerIndex} and E2E_TEST_PASSWORD_${workerIndex}.`);
    }
    return { username: workerUsername, password: workerPassword };
  }

  const username = process.env.E2E_TEST_USERNAME?.trim();
  const password = process.env.E2E_TEST_PASSWORD?.trim();
  if (username || password) {
    if (!username || !password) {
      throw new Error('E2E_TEST_USERNAME and E2E_TEST_PASSWORD must be provided together.');
    }
    return { username, password };
  }

  throw new Error(
    '此门禁为发布级外部验收，必须提供 E2E_TEST_USERNAME / E2E_TEST_PASSWORD（或 per-worker E2E_TEST_USERNAME_N / E2E_TEST_PASSWORD_N）真实账号，禁止在无账号环境降级运行。',
  );
}

/** 保持 donor 的硬门禁语义：没有真实账号时测试失败，绝不 skip。 */
function requireRealEnvironment(workerIndex: number): RealCredentials {
  return credentialsFor(workerIndex);
}

function createProject(
  runTag: string,
  suffix: string,
  name: string,
  tasks: Array<{ name: string; messages: ChatMessageFixture[]; model?: string; providerId?: string }>,
): ChatProjectFixture {
  const now = Date.now();
  const projectId = `e2e-stage5-${runTag}-${suffix}`;
  return {
    id: projectId,
    name,
    description: 'E2E stage5 simple-chat gate fixture',
    emoji: 'E2E',
    createdAt: now,
    updatedAt: now,
    tasks: tasks.map((task, index) => ({
      id: `${projectId}-task-${index}`,
      projectId,
      name: task.name,
      messages: task.messages,
      model: task.model || 'gemini-test',
      providerId: task.providerId || 'provider-a',
      createdAt: now,
      updatedAt: now,
    })),
    agents: [],
    knowledgeItems: [],
  };
}

function numberedMessages(runTag: string, count: number): ChatMessageFixture[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `e2e-stage5-message-${runTag}-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `消息 ${index + 1}：阶段5门禁载荷 ${runTag}`,
    createdAt: now - ((count - index) * 1_000),
  }));
}

function modelFixtures(kind: 'chat' | 'image', count: number): ModelFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-model-${String(index + 1).padStart(2, '0')}`,
    name: `${kind === 'chat' ? 'Chat' : 'Image'} Model ${index + 1}`,
    providerId: `${kind}-provider-${(index % 3) + 1}`,
  }));
}

async function login(page: Page, testInfo: TestInfo): Promise<void> {
  const credentials = requireRealEnvironment(testInfo.workerIndex);
  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('unbounded_ai_current_user');
    localStorage.removeItem('unbounded_ai_user_data');
    localStorage.removeItem('wujie_auth_token');
    localStorage.removeItem('wujie_chat_projects');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /无限画布/ }).first().click();
  await page.getByPlaceholder('请输入用户名').fill(credentials.username);
  await page.getByPlaceholder('请输入密码').fill(credentials.password);
  const loginResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/auth/login'
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: '登录' }).click();
  expect((await loginResponse).ok(), '真实 E2E 账号登录失败').toBe(true);
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible({ timeout: 20_000 });
}

async function readChatProjectsSnapshot(page: Page): Promise<ChatProjectsSnapshot> {
  const current = await page.request.get(`/api/user-data/sync?key=${CHAT_PROJECTS_SYNC_KEY}`);
  expect(current.ok(), `读取 chat fixture 返回 HTTP ${current.status()}`).toBe(true);
  const payload = await current.json() as { value?: unknown };
  return { value: structuredClone(payload.value ?? null) };
}

async function seedChatProjects(
  page: Page,
  testInfo: TestInfo,
  fixtures: ChatProjectFixture[],
): Promise<void> {
  if (chatProjectSnapshotsByTest.has(testInfo.testId)) {
    throw new Error('Each Stage 5 gate may seed chat projects only once so its exact original value can be restored.');
  }
  const snapshot = await readChatProjectsSnapshot(page);
  chatProjectSnapshotsByTest.set(testInfo.testId, snapshot);
  const existing = Array.isArray(snapshot.value) ? snapshot.value as Array<{ id?: unknown }> : [];
  const fixtureIds = new Set(fixtures.map(project => project.id));
  const merged = [...existing.filter(project => typeof project?.id !== 'string' || !fixtureIds.has(project.id)), ...fixtures];
  const persisted = await page.request.post('/api/user-data/sync', {
    data: { key: CHAT_PROJECTS_SYNC_KEY, value: merged },
  });
  expect(persisted.ok(), `写入 chat fixture 返回 HTTP ${persisted.status()}`).toBe(true);
}

async function restoreChatProjectsSnapshot(page: Page, snapshot: ChatProjectsSnapshot): Promise<void> {
  const restored = await page.request.post('/api/user-data/sync', {
    data: { key: CHAT_PROJECTS_SYNC_KEY, value: snapshot.value },
  });
  expect(restored.ok(), `恢复 chat fixture 返回 HTTP ${restored.status()}`).toBe(true);
  const verified = await readChatProjectsSnapshot(page);
  expect(verified.value, 'chat fixture cleanup must restore the exact original value and ordering').toEqual(snapshot.value);
}

async function openFixtureProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`${BASE_URL}/simple-chat?projectId=${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片')).toBeVisible({ timeout: 30_000 });
}

async function installDeterministicBrowserModelMocks(
  page: Page,
  chatModels: ModelFixture[],
  imageModels: ModelFixture[],
): Promise<void> {
  const providers = [...new Set([...chatModels, ...imageModels].map(model => model.providerId))].map(id => ({ id, name: `Provider ${id}` }));
  // DETERMINISTIC_BROWSER_UI_MOCK: model catalog only; no cloud supplier request is accepted here.
  await page.route('**/api/models?type=chat', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: chatModels, providers }),
  }));
  // DETERMINISTIC_BROWSER_UI_MOCK: model catalog only; no cloud supplier request is accepted here.
  await page.route('**/api/models?type=image', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ models: imageModels, providers }),
  }));
}

async function captureMenuEvidence(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const path = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(`${label}.png`, { path, contentType: 'image/png' });
}

async function visibleOptionIn(listbox: Locator): Promise<Locator> {
  const optionCount = await listbox.getByRole('option').count();
  for (let index = 0; index < optionCount; index += 1) {
    const option = listbox.getByRole('option').nth(index);
    const box = await option.boundingBox();
    if (box && box.width > 0 && box.height > 0 && box.x + box.width > 0 && box.y + box.height > 0) {
      return option;
    }
  }
  throw new Error('Open model listbox contains no visible option.');
}

async function assertMenuStacksAboveConversation(page: Page, listbox: Locator): Promise<void> {
  await expect(listbox).toBeVisible();
  const viewport = page.viewportSize();
  expect(viewport, 'Playwright viewport must be configured for menu geometry checks').not.toBeNull();
  const box = await listbox.boundingBox();
  expect(box, 'visible listbox must have a bounding box').not.toBeNull();
  const resolvedBox = box!;
  const resolvedViewport = viewport!;
  expect(resolvedBox.x).toBeGreaterThanOrEqual(0);
  expect(resolvedBox.y, 'menu must not clip above the viewport').toBeGreaterThanOrEqual(0);
  expect(resolvedBox.x + resolvedBox.width).toBeLessThanOrEqual(resolvedViewport.width);
  expect(resolvedBox.y + resolvedBox.height, 'menu must not clip below the viewport').toBeLessThanOrEqual(resolvedViewport.height);

  const option = await visibleOptionIn(listbox);
  const optionBox = await option.boundingBox();
  expect(optionBox, 'visible option must have a bounding box').not.toBeNull();
  const center = {
    x: optionBox!.x + (optionBox!.width / 2),
    y: optionBox!.y + (optionBox!.height / 2),
  };
  const optionReceivesHit = await option.evaluate((element, point) => (
    element.contains(document.elementFromPoint(point.x, point.y))
  ), center);
  expect(optionReceivesHit, 'menu option must receive hit-testing instead of a message bubble').toBe(true);

  const scrollState = await listbox.evaluate(element => {
    const before = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    return { before, after: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  });
  expect(scrollState.scrollHeight, 'model menu needs internal overflow for this regression').toBeGreaterThan(scrollState.clientHeight);
  expect(scrollState.after).toBeGreaterThan(scrollState.before);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth, 'simple-chat must not introduce horizontal document overflow').toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function exerciseLongConversationMenus(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const chatButton = page.getByRole('button', { name: 'Chat Model 1', exact: true });
  await expect(chatButton).toBeVisible();
  await chatButton.click();
  const chatListbox = page.locator('[role="listbox"]').nth(0);
  await assertMenuStacksAboveConversation(page, chatListbox);
  await captureMenuEvidence(page, testInfo, `${label}-chat-menu-open`);
  const chatOptions = chatListbox.getByRole('option');
  const lastChatOption = chatOptions.nth((await chatOptions.count()) - 1);
  await lastChatOption.scrollIntoViewIfNeeded();
  await lastChatOption.click();
  await expect(page.getByRole('button', { name: 'Chat Model 18', exact: true })).toBeVisible();

  const imageButton = page.getByRole('button', { name: 'Image Model 1', exact: true });
  await expect(imageButton).toBeVisible();
  await imageButton.click();
  const imageListbox = page.locator('[role="listbox"]').nth(1);
  await assertMenuStacksAboveConversation(page, imageListbox);
  await captureMenuEvidence(page, testInfo, `${label}-image-menu-open`);
  const imageOptions = imageListbox.getByRole('option');
  const lastImageOption = imageOptions.nth((await imageOptions.count()) - 1);
  await lastImageOption.scrollIntoViewIfNeeded();
  await lastImageOption.click();
  await expect(page.getByRole('button', { name: 'Image Model 18', exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
}

const evidenceByTest = new Map<string, ReturnType<typeof collectBrowserEvidence>>();
const chatProjectSnapshotsByTest = new Map<string, ChatProjectsSnapshot>();

test.describe.configure({ timeout: 120_000 });

test.beforeEach(({ page }, testInfo) => {
  evidenceByTest.set(testInfo.testId, collectBrowserEvidence(page));
  requireRealEnvironment(testInfo.workerIndex);
});

test.afterEach(async ({ page }, testInfo) => {
  const evidence = evidenceByTest.get(testInfo.testId);
  const snapshot = chatProjectSnapshotsByTest.get(testInfo.testId);
  const cleanupFailures: string[] = [];

  // Keep browser state intact until all evidence is captured, then unload the app before restoring.
  // This prevents the page's 800ms project-sync timer from writing fixtures after cleanup.
  try {
    if (evidence) {
      await saveBrowserEvidence(page, testInfo, evidence, `stage5-simple-chat-${testInfo.title}`);
    }
  } catch (error) {
    cleanupFailures.push(`evidence: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (snapshot) {
    try {
      if (!page.isClosed()) await page.goto('about:blank', { waitUntil: 'commit' });
    } catch (error) {
      cleanupFailures.push(`stop simple-chat sync: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await restoreChatProjectsSnapshot(page, snapshot);
    } catch (error) {
      cleanupFailures.push(`restore chat projects: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  evidenceByTest.delete(testInfo.testId);
  chatProjectSnapshotsByTest.delete(testInfo.testId);
  if (cleanupFailures.length > 0) {
    throw new Error(`Stage 5 cleanup failed: ${cleanupFailures.join('; ')}`);
  }
});

test.describe('阶段5外部门禁：智能对话独立页', () => {
  test('Gate A/B — renders 100 messages and switches conversation within the gate', async ({ page }, testInfo) => {
    await login(page, testInfo);
    const runTag = `${testInfo.workerIndex}-${Date.now()}`;
    const firstProject = createProject(runTag, 'render', `阶段5门禁-${runTag}`, [{
      name: '百条会话',
      messages: numberedMessages(runTag, 100),
    }]);
    const secondProject = createProject(runTag, 'switch', `切换项目-${runTag}`, [{
      name: '切换目标会话',
      messages: numberedMessages(`${runTag}-switch`, 3),
    }]);
    await seedChatProjects(page, testInfo, [firstProject, secondProject]);

    const renderStartedAt = Date.now();
    await openFixtureProject(page, firstProject.id);
    await expect(page.getByText(`消息 1：阶段5门禁载荷 ${runTag}`, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`消息 100：阶段5门禁载荷 ${runTag}`, { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - renderStartedAt, '100 消息渲染耗时超出 5000ms 门禁').toBeLessThan(5_000);

    const switchStartedAt = Date.now();
    await page.getByText(`切换项目-${runTag}`, { exact: true }).click();
    await expect(page.getByText(`消息 3：阶段5门禁载荷 ${runTag}-switch`, { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - switchStartedAt, '会话切换耗时超过 500ms 门禁').toBeLessThan(500);
  });

  test('Gate C — DETERMINISTIC_BROWSER_PROTOCOL_MOCK renders an SSE error and retry control', async ({ page }, testInfo) => {
    await login(page, testInfo);
    const runTag = `${testInfo.workerIndex}-${Date.now()}`;
    const project = createProject(runTag, 'sse-error', `SSE错误-${runTag}`, [{ name: 'SSE错误会话', messages: [] }]);
    await seedChatProjects(page, testInfo, [project]);
    await installDeterministicBrowserModelMocks(page, [{ id: 'gemini-test', name: 'Gemini Test', providerId: 'provider-a' }], []);
    // DETERMINISTIC_BROWSER_PROTOCOL_MOCK: supplies an SSE error envelope only, never a supplier success.
    await page.route('**/api/simple-chat/chat', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: 'data: {"type":"error","error":"E2E 模拟供应商断流"}\n\n',
    }));

    await openFixtureProject(page, project.id);
    const composer = page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片');
    await composer.fill('触发断流验证');
    await composer.press('Enter');
    await expect(page.getByText('E2E 模拟供应商断流', { exact: true })).toBeVisible({ timeout: 30_000 });
    const failedAssistantMessage = page.locator('[data-chat-message-id]').filter({
      hasText: 'E2E 模拟供应商断流',
    });
    await expect(failedAssistantMessage.getByTitle('重新生成')).toBeVisible({ timeout: 10_000 });
  });

  test('model click updates aria-selected and submits the matching model/provider pair', async ({ page }, testInfo) => {
    await login(page, testInfo);
    const runTag = `${testInfo.workerIndex}-${Date.now()}`;
    const project = createProject(runTag, 'model', `模型选择-${runTag}`, [{ name: '模型选择会话', messages: [] }]);
    await seedChatProjects(page, testInfo, [project]);
    await installDeterministicBrowserModelMocks(page, [
      { id: 'gemini-test', name: 'Gemini Test', providerId: 'provider-a' },
      { id: 'gpt-test', name: 'GPT Test', providerId: 'provider-b' },
    ], []);
    let submittedBody: Record<string, unknown> | null = null;
    // DETERMINISTIC_BROWSER_PROTOCOL_MOCK: verifies browser request shaping, not a real supplier response.
    await page.route('**/api/simple-chat/chat', async route => {
      const body = route.request().postDataJSON();
      submittedBody = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: 'data: {"type":"text","content":"OK"}\n\ndata: [DONE]\n\n',
      });
    });

    await openFixtureProject(page, project.id);
    await page.getByRole('button', { name: 'Gemini Test', exact: true }).click();
    await page.getByRole('option', { name: /GPT Test/ }).click();
    await expect(page.getByRole('button', { name: 'GPT Test', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'GPT Test', exact: true }).click();
    await expect(page.getByRole('option', { name: /GPT Test/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'GPT Test', exact: true }).click();

    const composer = page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片');
    await composer.fill('验证模型路由');
    await composer.press('Enter');
    await expect(page.getByText('OK', { exact: true })).toBeVisible({ timeout: 20_000 });
    const requestBody = submittedBody as Record<string, unknown> | null;
    expect(requestBody).not.toBeNull();
    expect(requestBody?.model).toBe('gpt-test');
    expect(requestBody?.providerId).toBe('provider-b');
  });

  test('invalid historical image is excluded while text continues to the request', async ({ page }, testInfo) => {
    await login(page, testInfo);
    const runTag = `${testInfo.workerIndex}-${Date.now()}`;
    const project = createProject(runTag, 'invalid-history', `失效图片-${runTag}`, [{
      name: '失效历史图片会话',
      messages: [{
        id: `e2e-stage5-invalid-history-${runTag}`,
        role: 'user',
        content: '历史文字仍应保留',
        images: ['data:image/png;base64,broken'],
        createdAt: Date.now() - 1_000,
      }],
    }]);
    await seedChatProjects(page, testInfo, [project]);
    await installDeterministicBrowserModelMocks(page, [{ id: 'gemini-test', name: 'Gemini Test', providerId: 'provider-a' }], []);
    let submittedBody: Record<string, unknown> | null = null;
    // DETERMINISTIC_BROWSER_PROTOCOL_MOCK: response isolates request filtering in the real browser client.
    await page.route('**/api/simple-chat/chat', async route => {
      const body = route.request().postDataJSON();
      submittedBody = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: 'data: {"type":"text","content":"历史图片过滤完成"}\n\ndata: [DONE]\n\n',
      });
    });

    await openFixtureProject(page, project.id);
    const composer = page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片');
    await composer.fill('新的纯文字消息');
    await composer.press('Enter');
    await expect(page.getByText('已忽略 1 张失效历史图片，本次请求继续发送。', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('历史图片过滤完成', { exact: true })).toBeVisible({ timeout: 20_000 });

    const requestBody = submittedBody as Record<string, unknown> | null;
    const messages = requestBody?.messages;
    expect(Array.isArray(messages), 'simple-chat request must contain messages').toBe(true);
    const serializedMessages = JSON.stringify(messages);
    expect(serializedMessages).toContain('历史文字仍应保留');
    expect(serializedMessages).toContain('新的纯文字消息');
    expect(serializedMessages).not.toContain('data:image/png;base64,broken');
  });

  test('desktop long conversation keeps chat and image menus interactive above bubbles', async ({ page }, testInfo) => {
    await login(page, testInfo);
    const runTag = `${testInfo.workerIndex}-${Date.now()}`;
    const project = createProject(runTag, 'desktop-stack', `桌面堆叠-${runTag}`, [{
      name: '长会话',
      messages: numberedMessages(runTag, 100),
      model: 'chat-model-01',
      providerId: 'chat-provider-1',
    }]);
    await seedChatProjects(page, testInfo, [project]);
    await installDeterministicBrowserModelMocks(page, modelFixtures('chat', 18), modelFixtures('image', 18));
    await openFixtureProject(page, project.id);
    await expect(page.getByText(`消息 100：阶段5门禁载荷 ${runTag}`, { exact: true })).toBeVisible();
    await exerciseLongConversationMenus(page, testInfo, 'desktop');
  });

  test.describe('configured mobile viewport', () => {
    test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

    test('long conversation keeps chat and image menus interactive without horizontal overflow', async ({ page }, testInfo) => {
      await login(page, testInfo);
      const runTag = `${testInfo.workerIndex}-${Date.now()}`;
      const project = createProject(runTag, 'mobile-stack', `移动堆叠-${runTag}`, [{
        name: '移动长会话',
        messages: numberedMessages(runTag, 100),
        model: 'chat-model-01',
        providerId: 'chat-provider-1',
      }]);
      await seedChatProjects(page, testInfo, [project]);
      await installDeterministicBrowserModelMocks(page, modelFixtures('chat', 18), modelFixtures('image', 18));
      await openFixtureProject(page, project.id);
      await expect(page.getByText(`消息 100：阶段5门禁载荷 ${runTag}`, { exact: true })).toBeVisible();
      await exerciseLongConversationMenus(page, testInfo, 'mobile');
    });
  });
});

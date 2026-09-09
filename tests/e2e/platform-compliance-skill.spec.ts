import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';
import { Pool } from 'pg';
import sharp from 'sharp';

import {
  createEmptyWorkflow,
  createWorkflowNode,
  type Workflow,
  type WorkflowConnection,
  type WorkflowNode,
} from '../../src/lib/workflow-engine';
import type { PlatformComplianceReportV1 } from '../../src/lib/platform-compliance/types';
import {
  expect,
  openStage4CanvasProject,
  openStage4ChatProject,
  readStage4PersistedWorkflowNodeCount,
  seedStage4Baseline,
  stage4FixtureForProject,
  test,
  writeStage4Metrics,
  type Stage4AuthContext,
} from '../helpers/stage-4-e2e';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ trace: 'off', video: 'on' });

const SKILL_ID = 'preset-platform-compliance-audit';
const PROVIDER_ID = 'task11-vision-provider';
const MODEL_ID = 'task11-gemini-vision-model';

interface ManagedSource {
  assetId: string;
  assetVersionId: string;
  placementId: string;
  entityId: string;
  url: string;
}

interface SkillRunEvidence {
  runId: string;
  projectId: string;
  surface: 'canvas' | 'workflow';
  workspaceId: string;
  skillId: string;
  skillVersion: number;
  status: string;
  sourceVersionIds: string[];
  assetVersionIds: string[];
  outputs: Array<{ stepId: string; kind: string; schemaId?: string; content: string }>;
  steps: Array<{ id: string; label: string; status: string }>;
}

interface ProviderEvidence {
  requestId: string | null;
  pathname: string;
  model: string | null;
  imageInput: string | null;
}

let providerServer: Server | undefined;
let providerBaseUrl = '';
const providerSockets = new Set<Socket>();
const providerCalls: ProviderEvidence[] = [];

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function visionResponse(body: Record<string, unknown>): { content: string; imageInput: string | null } {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const first = messages[0];
  const content = first && typeof first === 'object' && !Array.isArray(first)
    ? (first as Record<string, unknown>).content
    : null;
  const parts = Array.isArray(content) ? content : [];
  const textPart = parts.find(part => (
    part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text'
  )) as Record<string, unknown> | undefined;
  const imagePart = parts.find(part => (
    part && typeof part === 'object' && (part as Record<string, unknown>).type === 'image_url'
  )) as Record<string, unknown> | undefined;
  const imageUrl = imagePart?.image_url;
  const imageInput = imageUrl && typeof imageUrl === 'object' && !Array.isArray(imageUrl)
    && typeof (imageUrl as Record<string, unknown>).url === 'string'
    ? String((imageUrl as Record<string, unknown>).url)
    : null;
  const prompt = typeof textPart?.text === 'string'
    ? JSON.parse(textPart.text) as { rules?: Array<{ id?: string; severity?: string }> }
    : {};
  const checks = (prompt.rules ?? []).map(rule => ({
    ruleId: rule.id,
    status: 'passed',
    evidence: ['受控视觉服务确认素材符合该项要求'],
    measuredValue: 'compliant',
    confidence: 0.99,
    remediation: null,
  }));
  return { content: JSON.stringify({ checks }), imageInput };
}

test.beforeAll(async () => {
  providerServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const body = await readRequestJson(request);
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      const vision = visionResponse(body);
      providerCalls.push({
        requestId: typeof request.headers['x-request-id'] === 'string'
          ? request.headers['x-request-id']
          : null,
        pathname,
        model: typeof body.model === 'string' ? body.model : null,
        imageInput: vision.imageInput,
      });
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'X-Request-Id': `task11-provider-${providerCalls.length}`,
      });
      response.end(JSON.stringify({ choices: [{ message: { content: vision.content } }] }));
    } catch {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'controlled provider fixture failed' } }));
    }
  });
  providerServer.on('connection', socket => {
    providerSockets.add(socket);
    socket.on('close', () => providerSockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    providerServer!.once('error', reject);
    providerServer!.listen(0, '127.0.0.1', resolve);
  });
  providerBaseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  providerSockets.forEach(socket => socket.destroy());
  if (providerServer) {
    await new Promise<void>(resolve => providerServer!.close(() => resolve()));
  }
});

async function readJson(response: import('@playwright/test').APIResponse): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function loginThroughProductionUi(page: Page, username: string, password: string): Promise<Stage4AuthContext> {
  const adminUsername = process.env.WUJIE_ADMIN_USERNAME?.trim();
  const adminPassword = process.env.WUJIE_ADMIN_PASSWORD?.trim();
  if (!adminUsername || !adminPassword) {
    throw new Error('BLOCKED: WUJIE_ADMIN_USERNAME and WUJIE_ADMIN_PASSWORD are required');
  }

  await page.context().clearCookies();
  const adminLogin = await page.request.post('/api/auth/login', {
    data: { name: adminUsername, password: adminPassword },
  });
  expect(adminLogin.ok(), `管理员引导登录返回 HTTP ${adminLogin.status()}`).toBe(true);
  const usersResponse = await page.request.get('/api/admin/users');
  expect(usersResponse.ok(), `管理员用户列表返回 HTTP ${usersResponse.status()}`).toBe(true);
  const usersPayload = await readJson(usersResponse);
  const users = Array.isArray(usersPayload.users) ? usersPayload.users : [];
  const existing = users.some(value => (
    value && typeof value === 'object' && (value as Record<string, unknown>).name === username
  ));
  if (!existing) {
    const createResponse = await page.request.post('/api/admin/users', {
      data: { action: 'create', name: username, password },
    });
    expect(createResponse.ok(), `一次性用户创建返回 HTTP ${createResponse.status()}`).toBe(true);
  }

  await page.context().clearCookies();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /无限画布/ }).first().click();
  await page.getByPlaceholder('请输入用户名').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  const loginResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/auth/login'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  expect((await loginResponse).ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible({ timeout: 20_000 });

  const sessionResponse = await page.request.get('/api/session');
  expect(sessionResponse.ok()).toBe(true);
  const session = await readJson(sessionResponse);
  const user = session.user as Record<string, unknown> | undefined;
  expect(user?.name).toBe(username);
  expect(typeof user?.id).toBe('string');
  return {
    userId: String(user!.id),
    username,
    strategy: 'admin-provisioned-login',
    disposable: true,
  };
}

async function persistSourceImage(page: Page, index: number): Promise<string> {
  const rgba = { r: 245 - index * 20, g: 245, b: 245 - index * 10, alpha: 1 };
  const buffer = await sharp({
    create: { width: 1600, height: 1600, channels: 4, background: rgba },
  }).png().toBuffer();
  const response = await page.request.post('/api/save-image', {
    data: { imageUrl: `data:image/png;base64,${buffer.toString('base64')}` },
  });
  const payload = await readJson(response);
  expect(response.ok(), `第 ${index + 1} 张受管图片保存返回 HTTP ${response.status()}`).toBe(true);
  expect(String(payload.url || '')).toMatch(/^\/api\/serve-upload\/uploads\//u);
  return String(payload.url);
}

async function seedTask11Runtime(input: {
  auth: Stage4AuthContext;
  page: Page;
  projectId: string;
  profile: string;
}): Promise<ManagedSource[]> {
  const connectionString = process.env.DATABASE_URL || process.env.PGDATABASE_URL;
  if (!connectionString) throw new Error('BLOCKED: disposable PostgreSQL is not configured');
  const pool = new Pool({ connectionString });
  const sources: ManagedSource[] = [];
  const now = Date.now();
  try {
    await pool.query(
      `INSERT INTO wujie_api_providers(
         id, name, display_name, base_url, api_key, is_enabled, type, model_type,
         request_style, selected_models, advanced_params, is_default, created_at, updated_at,
         connection_status, discovered_models, sort_order
       ) VALUES ($1, 'Task 11 Vision Provider', 'Task 11 Vision Provider', $2, 'controlled-key', true,
         'general', 'general', 'chat-completions', $3::text[], '{}'::jsonb, true, $4, $4,
         'connected', $5::jsonb, 1)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, api_key = EXCLUDED.api_key,
         selected_models = EXCLUDED.selected_models, discovered_models = EXCLUDED.discovered_models,
         is_enabled = true, updated_at = EXCLUDED.updated_at`,
      [PROVIDER_ID, providerBaseUrl, [MODEL_ID], now, JSON.stringify([{
        id: MODEL_ID,
        name: 'Task 11 Vision Model',
        type: 'chat',
        capabilities: ['chat', 'vision'],
        supportedOperations: ['chat-completions', 'image-understanding'],
      }])],
    );
    await pool.query(
      `INSERT INTO wujie_credits(id, user_id, balance, total_recharged, total_used, created_at, updated_at)
       VALUES ($1, $2, 1000, 1000, 0, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET balance = GREATEST(wujie_credits.balance, 1000),
         total_recharged = GREATEST(wujie_credits.total_recharged, 1000), updated_at = EXCLUDED.updated_at`,
      [`task11-credits-${input.profile}`, input.auth.userId, now],
    );

    for (let index = 0; index < 3; index += 1) {
      const url = await persistSourceImage(input.page, index);
      const source: ManagedSource = {
        assetId: `task11-asset-${input.profile}-${index + 1}`,
        assetVersionId: `task11-version-${input.profile}-${index + 1}`,
        placementId: `task11-placement-${input.profile}-${index + 1}`,
        entityId: `task11-image-${input.profile}-${index + 1}`,
        url,
      };
      sources.push(source);
    }
  } finally {
    await pool.end();
  }
  return sources;
}

async function buildWorkflow(page: Page, sources: ManagedSource[], projectId: string, profile: string): Promise<Workflow & {
  skillNode: WorkflowNode;
  downstreamNode: WorkflowNode;
}> {
  const workflowId = `task11-workflow-${profile}`;
  const imageNodes: WorkflowNode[] = [];
  for (const [index, source] of sources.entries()) {
    const node = createWorkflowNode('input-image', 80, 80 + index * 240, `来源图 ${index + 1}`);
    const transferResponse = await page.request.post('/api/assets/transfer', {
      data: {
        sourceVersion: source.assetVersionId,
        targetProject: projectId,
        targetWorkspace: workflowId,
        entityType: 'workflow-input',
        entityId: node.id,
        idempotencyKey: `task11:${profile}:workflow-input:${index + 1}`,
        metadata: { source: 'task11-e2e', sourceImageId: source.entityId },
      },
    });
    expect(transferResponse.ok(), `第 ${index + 1} 张图片转入 Workflow 返回 HTTP ${transferResponse.status()}`)
      .toBe(true);
    const transferred = await transferResponse.json() as {
      assetId: string;
      assetVersionId: string;
      placementId: string;
      url: string;
    };
    expect(transferred.assetVersionId).toBe(source.assetVersionId);
    node.config = {
      ...node.config,
      projectId,
      imageUrl: transferred.url,
      assetId: transferred.assetId,
      assetVersionId: transferred.assetVersionId,
      placementId: transferred.placementId,
    };
    imageNodes.push(node);
  }
  const skillNode = createWorkflowNode('ai-skill', 480, 240, '平台素材合规检查');
  skillNode.config = {
    ...skillNode.config,
    skillId: SKILL_ID,
    version: 1,
    inputValues: {
      platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
      productFacts: '商品为无文字、无边框的方形耳机主图。', claims: '', reportLanguage: '中文',
    },
    modelBindings: {
      orchestrator: { providerId: PROVIDER_ID, modelId: MODEL_ID },
      vision: { providerId: PROVIDER_ID, modelId: MODEL_ID },
    },
  };
  const downstreamNode = createWorkflowNode('condition-if', 840, 240, '合规报告下游消费');
  downstreamNode.condition = 'result.status == "completed"';
  const connections: WorkflowConnection[] = imageNodes.map((node, index) => ({
    id: `task11-source-${profile}-${index + 1}`,
    fromNodeId: node.id,
    fromPortId: 'out-image',
    toNodeId: skillNode.id,
    toPortId: 'in-image',
    type: 'image' as const,
  }));
  connections.push({
    id: `task11-report-consumer-${profile}`,
    fromNodeId: skillNode.id,
    fromPortId: 'out-task',
    toNodeId: downstreamNode.id,
    toPortId: 'in-data',
    type: 'data',
  });
  return {
    ...createEmptyWorkflow('Task 11 平台合规工作流'),
    id: workflowId,
    nodes: [...imageNodes, skillNode, downstreamNode],
    connections,
    skillNode,
    downstreamNode,
  };
}

async function readRun(page: Page, runId: string): Promise<SkillRunEvidence> {
  const response = await page.request.get(`/api/skill-runs/${encodeURIComponent(runId)}?observeOnly=true`);
  expect(response.ok(), `Skill Run ${runId} 返回 HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as { run?: SkillRunEvidence };
  expect(payload.run?.runId).toBe(runId);
  return payload.run!;
}

async function waitForCompletedRun(page: Page, runId: string): Promise<SkillRunEvidence> {
  await expect.poll(
    async () => (await readRun(page, runId)).status,
    { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
  ).toBe('completed');
  return readRun(page, runId);
}

function parseReports(run: SkillRunEvidence): PlatformComplianceReportV1[] {
  return run.outputs
    .filter(output => output.kind === 'json' && output.schemaId === 'platform-compliance-report-v1')
    .map(output => JSON.parse(output.content) as PlatformComplianceReportV1);
}

function reportDigestsBySource(reports: readonly PlatformComplianceReportV1[]): Record<string, string> {
  return Object.fromEntries(reports
    .map(report => [report.sourceVersionId, report.ruleSetDigest] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

async function assertReportDocuments(page: Page, projectId: string, run: SkillRunEvidence) {
  const reports = parseReports(run);
  expect(reports).toHaveLength(3);
  expect(new Set(reports.map(report => report.sourceVersionId))).toEqual(new Set(run.sourceVersionIds));
  expect(reports.every(report => report.summary.unknown === 0)).toBe(true);
  expect(run.assetVersionIds).toHaveLength(3);
  const documents = [];
  for (const assetVersionId of run.assetVersionIds) {
    const query = new URLSearchParams({ projectId, assetVersionId });
    const response = await page.request.get(`/api/assets?${query.toString()}`);
    expect(response.ok(), `报告资产 ${assetVersionId} 返回 HTTP ${response.status()}`).toBe(true);
    const asset = await response.json() as { kind?: string; url?: string; assetVersionId?: string };
    expect(asset).toMatchObject({ kind: 'document', assetVersionId });
    expect(asset.url).toMatch(/^\/api\/skill-reports\//u);
    const documentResponse = await page.request.get(String(asset.url));
    expect(documentResponse.ok(), `报告文档 ${assetVersionId} 无法下载`).toBe(true);
    expect(documentResponse.headers()['content-type']).toContain('application/json');
    documents.push(asset);
  }
  return { documents, reports };
}

async function readManagedSources(
  page: Page,
  projectId: string,
  expectedSources: readonly ManagedSource[],
): Promise<ManagedSource[]> {
  const response = await page.request.get('/api/user-data/sync?key=projects');
  expect(response.ok(), `同步后的项目快照返回 HTTP ${response.status()}`).toBe(true);
  const payload = await readJson(response);
  const projects = Array.isArray(payload.value) ? payload.value : [];
  const project = projects.find(value => (
    value && typeof value === 'object' && (value as Record<string, unknown>).id === projectId
  )) as Record<string, unknown> | undefined;
  const images = Array.isArray(project?.canvasImages) ? project.canvasImages : [];
  return expectedSources.map(source => {
    const image = images.find(value => (
      value && typeof value === 'object' && (value as Record<string, unknown>).id === source.entityId
    )) as Record<string, unknown> | undefined;
    expect(image, `同步后缺少画布图片 ${source.entityId}`).toBeTruthy();
    expect(typeof image?.assetId).toBe('string');
    expect(typeof image?.assetVersionId).toBe('string');
    expect(typeof image?.placementId).toBe('string');
    expect(typeof image?.url).toBe('string');
    return {
      entityId: source.entityId,
      assetId: String(image!.assetId),
      assetVersionId: String(image!.assetVersionId),
      placementId: String(image!.placementId),
      url: String(image!.url),
    };
  });
}

test('Canvas 与 Workflow 交付同一版本的逐图平台合规报告并隔离 Simple Chat', async ({
  page,
  stage4Evidence,
}, testInfo) => {
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  const auth = await loginThroughProductionUi(page, fixture.username, fixture.password);
  const projectId = String(fixture.canvasProject.id);
  fixture.canvasProject = {
    ...fixture.canvasProject,
    canvasImages: [],
    metadata: Object.fromEntries(Object.entries(
      fixture.canvasProject.metadata as Record<string, unknown>,
    ).filter(([key]) => key !== 'workflow')),
  };
  await seedStage4Baseline(page, fixture, auth);

  let sources = await seedTask11Runtime({
    auth, page, projectId, profile: fixture.browserProfile,
  });
  const canvasImages = sources.map((source, index) => ({
    id: source.entityId,
    url: source.url,
    x: 96 + index * 220,
    y: 96,
    width: 180,
    height: 180,
    originalWidth: 1600,
    originalHeight: 1600,
    rotation: 0,
    zIndex: index + 1,
    createdAt: Date.now() + index,
    prompt: `Task 11 Amazon 主图 ${index + 1}`,
  }));
  fixture.canvasProject = {
    ...fixture.canvasProject,
    canvasImages,
    metadata: Object.fromEntries(Object.entries(
      fixture.canvasProject.metadata as Record<string, unknown>,
    ).filter(([key]) => key !== 'workflow')),
  };
  await seedStage4Baseline(page, fixture, auth);
  sources = await readManagedSources(page, projectId, sources);
  const managedCanvasImages = sources.map((source, index) => ({
    ...canvasImages[index],
    url: source.url,
    assetId: source.assetId,
    assetVersionId: source.assetVersionId,
    placementId: source.placementId,
  }));

  const workflow = await buildWorkflow(page, sources, projectId, fixture.browserProfile);
  fixture.canvasProject = {
    ...fixture.canvasProject,
    canvasImages: managedCanvasImages,
    metadata: {
      ...(fixture.canvasProject.metadata as Record<string, unknown>),
      workflow: { ...workflow, name: 'Task 11 平台合规工作流' },
    },
  };
  fixture.nodeCount = workflow.nodes.length;
  await seedStage4Baseline(page, fixture, auth);
  await expect.poll(() => readStage4PersistedWorkflowNodeCount(page, projectId))
    .toBe(workflow.nodes.length);
  await openStage4CanvasProject(page, projectId);

  const canvasCatalogResponse = await page.request.get('/api/skills?surface=canvas');
  const workflowCatalogResponse = await page.request.get('/api/skills?surface=workflow');
  const canvasCatalog = await canvasCatalogResponse.json() as { skills: Array<{ id: string; version: number }> };
  const workflowCatalog = await workflowCatalogResponse.json() as { skills: Array<{ id: string; version: number }> };
  expect(canvasCatalog.skills).toHaveLength(28);
  expect(workflowCatalog.skills).toHaveLength(28);
  expect(workflowCatalog.skills.map(skill => `${skill.id}@${skill.version}`).sort())
    .toEqual(canvasCatalog.skills.map(skill => `${skill.id}@${skill.version}`).sort());

  await page.locator('[data-canvas-image-id]').first().click();
  const expandPanel = page.getByRole('button', { name: '展开面板', exact: true });
  if (await expandPanel.isVisible().catch(() => false)) await expandPanel.click();
  await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
  await page.getByTitle('添加图片引用').click();
  for (let index = 0; index < 3; index += 1) {
    await page.getByText(`Task 11 Amazon 主图 ${index + 1}`, { exact: true }).click();
    await expect(page.getByText(`${index + 1}张图片引用`, { exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Skills技能库' }).click();
  await page.getByPlaceholder('搜索 Skills...').fill('平台素材合规');
  await page.getByText('平台素材合规检查', { exact: true }).last().click();
  await expect(page.getByRole('status', { name: '来源图片' })).toHaveText('已选择 3 张来源图片');
  await page.getByLabel('平台').selectOption('Amazon');
  await page.getByLabel('地区').selectOption('US');
  await page.getByLabel('素材类型').selectOption('main');
  await page.getByLabel('商品事实').fill('商品为无文字、无边框的方形耳机主图。');
  await page.getByLabel('报告语言').selectOption('中文');

  const canvasSubmission = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/skill-runs'
    && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: '运行 Skill', exact: true }).click();
  const canvasSubmissionResponse = await canvasSubmission;
  expect(canvasSubmissionResponse.status()).toBe(201);
  const canvasRequest = canvasSubmissionResponse.request().postDataJSON() as {
    skillId?: string; sourceVersionIds?: string[];
    modelBindings?: Record<string, { providerId?: string; modelId?: string }>;
  };
  expect(canvasRequest.skillId).toBe(SKILL_ID);
  expect(canvasRequest.sourceVersionIds).toEqual(sources.map(source => source.assetVersionId));
  expect(canvasRequest.modelBindings?.vision).toEqual({ providerId: PROVIDER_ID, modelId: MODEL_ID });
  const canvasSubmissionPayload = await canvasSubmissionResponse.json() as { runId: string };
  const canvasRun = await waitForCompletedRun(page, canvasSubmissionPayload.runId);
  const canvasDocuments = await assertReportDocuments(page, projectId, canvasRun);
  await expect(page.getByRole('region', { name: '平台素材合规报告' })).toHaveCount(3);

  const collapsePanel = page.getByRole('button', { name: '收起面板', exact: true });
  if (await collapsePanel.isVisible().catch(() => false)) await collapsePanel.click();
  await page.getByTitle('节点模式').first().click();
  await page.getByLabel('平台素材合规检查').last().click();
  const skillSelect = page.getByRole('combobox', { name: 'Skill' });
  await expect(skillSelect).toHaveValue(SKILL_ID, { timeout: 20_000 });
  await expect(page.getByRole('status', { name: '来源图片' })).toHaveText('已选择 3 张来源图片');
  await expect(page.getByRole('combobox', { name: 'vision 模型' })).toHaveValue(`${PROVIDER_ID}::${MODEL_ID}`);

  const workflowSubmission = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/workflow/execute'
    && response.request().method() === 'POST'
    && Boolean(response.request().postData()?.includes('"action":"start"'))
  ));
  await page.getByRole('button', { name: '执行工作流', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skill 费用预估', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  const workflowSubmissionResponse = await workflowSubmission;
  expect(workflowSubmissionResponse.ok()).toBe(true);
  const workflowSubmissionPayload = await workflowSubmissionResponse.json() as { executionId: string };
  await expect(page.getByText('执行完成', { exact: true })).toBeVisible({ timeout: 120_000 });
  const workflowStatusResponse = await page.request.post('/api/workflow/execute', {
    data: { action: 'status', executionId: workflowSubmissionPayload.executionId },
  });
  expect(workflowStatusResponse.ok()).toBe(true);
  const workflowStatus = await workflowStatusResponse.json() as {
    status: string;
    results: Record<string, {
      status?: string;
      output?: {
        runId?: string;
        documentAssetVersionIds?: string[];
        complianceReports?: PlatformComplianceReportV1[];
        result?: {
          status?: string;
          documentAssetVersionIds?: string[];
          complianceReports?: PlatformComplianceReportV1[];
        };
      };
    }>;
  };
  expect(workflowStatus.status).toBe('completed');
  const workflowOutput = workflowStatus.results[workflow.skillNode.id]?.output;
  expect(workflowOutput?.documentAssetVersionIds).toHaveLength(3);
  const workflowRun = await waitForCompletedRun(page, String(workflowOutput?.runId));
  const workflowDocuments = await assertReportDocuments(page, projectId, workflowRun);
  expect(workflowRun.skillId).toBe(canvasRun.skillId);
  expect(workflowRun.skillVersion).toBe(canvasRun.skillVersion);
  expect(workflowRun.sourceVersionIds).toEqual(canvasRun.sourceVersionIds);
  expect(reportDigestsBySource(workflowDocuments.reports))
    .toEqual(reportDigestsBySource(canvasDocuments.reports));

  const downstreamResult = workflowStatus.results[workflow.downstreamNode.id];
  expect(downstreamResult?.status).toBe('success');
  expect(downstreamResult?.output?.result?.status).toBe('completed');
  expect(downstreamResult?.output?.result?.documentAssetVersionIds)
    .toEqual(workflowOutput?.documentAssetVersionIds);
  expect(reportDigestsBySource(downstreamResult?.output?.result?.complianceReports ?? []))
    .toEqual(reportDigestsBySource(workflowDocuments.reports));
  await expect(page.locator('[data-workflow-compliance-summary]')).toContainText('3 份报告');

  const simpleCatalogResponse = await page.request.get('/api/skills?surface=simple-chat');
  expect(simpleCatalogResponse.ok()).toBe(true);
  const simpleCatalog = await simpleCatalogResponse.json() as { skills: Array<{ id: string }> };
  expect(simpleCatalog.skills).toHaveLength(16);
  expect(simpleCatalog.skills.some(skill => skill.id === SKILL_ID)).toBe(false);
  await openStage4ChatProject(page, String(fixture.chatProject.id));
  await page.getByTitle('Skill').click();
  await expect(page.locator('[data-simple-chat-skill-id]')).toHaveCount(16);
  await expect(page.getByText('平台素材合规检查', { exact: true })).toHaveCount(0);

  const visionProviderCalls = providerCalls.filter(call => call.imageInput?.startsWith('data:image/png;base64,'));
  const orchestratorProviderCalls = providerCalls.filter(call => call.imageInput === null);
  expect(providerCalls).toHaveLength(8);
  expect(visionProviderCalls).toHaveLength(6);
  expect(orchestratorProviderCalls).toHaveLength(2);
  expect(providerCalls.every(call => call.pathname.endsWith('/chat/completions'))).toBe(true);
  expect(providerCalls.every(call => call.model === MODEL_ID)).toBe(true);
  expect(visionProviderCalls.every(call => typeof call.requestId === 'string')).toBe(true);
  expect(new Set(visionProviderCalls.map(call => call.requestId)).size).toBe(6);

  await writeStage4Metrics(stage4Evidence, testInfo, 'platform-compliance-local-production', {
    gitCommit: process.env.E2E_GIT_COMMIT || 'unknown',
    projectId,
    sourceVersionIds: sources.map(source => source.assetVersionId),
    canvas: {
      runId: canvasRun.runId,
      reportAssetVersionIds: canvasRun.assetVersionIds,
      reports: canvasDocuments.reports.map(report => ({
        reportId: report.reportId,
        sourceVersionId: report.sourceVersionId,
        verdict: report.verdict,
        unknown: report.summary.unknown,
        ruleSetDigest: report.ruleSetDigest,
      })),
    },
    workflow: {
      runId: workflowRun.runId,
      reportAssetVersionIds: workflowRun.assetVersionIds,
      reports: workflowDocuments.reports.map(report => ({
        reportId: report.reportId,
        sourceVersionId: report.sourceVersionId,
        verdict: report.verdict,
        unknown: report.summary.unknown,
        ruleSetDigest: report.ruleSetDigest,
      })),
    },
    simpleChatSkillCount: simpleCatalog.skills.length,
    provider: {
      id: PROVIDER_ID,
      modelId: MODEL_ID,
      callCount: providerCalls.length,
      requestIdDigests: providerCalls.map(call => createHash('sha256')
        .update(String(call.requestId)).digest('hex')),
    },
  });
});

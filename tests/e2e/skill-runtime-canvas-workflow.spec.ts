import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Page } from '@playwright/test';

import {
  ensureStage4Session,
  expect,
  openStage4CanvasProject,
  seedStage4Baseline,
  seedStage4RuntimeDependencies,
  stage4FixtureForProject,
  test,
  writeStage4Metrics,
} from '../helpers/stage-4-e2e';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
// The Stage 4 fixture owns a sanitized trace so Playwright must not start a second trace.
test.use({ trace: 'off', video: 'on' });

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let providerServer: Server | undefined;
let providerBaseUrl = '';
const providerSockets = new Set<Socket>();

test.beforeAll(async () => {
  providerServer = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (pathname.endsWith('/images/generations')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: `Controlled Skill plan: ${raw.length}` } }],
      }));
    });
  });
  providerServer.on('connection', socket => {
    providerSockets.add(socket);
    socket.on('close', () => providerSockets.delete(socket));
  });
  await new Promise<void>(resolve => providerServer!.listen(0, '127.0.0.1', resolve));
  providerBaseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  providerSockets.forEach(socket => socket.destroy());
  if (providerServer) {
    await new Promise<void>(resolve => providerServer!.close(() => resolve()));
  }
});

interface CatalogSkill {
  id: string;
  version: number;
  name: string;
}

interface SkillRunEvidence {
  runId: string;
  skillId: string;
  skillVersion: number;
  status: string;
  assetVersionIds: string[];
}

async function readSkillRun(page: Page, runId: string): Promise<SkillRunEvidence> {
  const response = await page.request.get(`/api/skill-runs/${encodeURIComponent(runId)}`);
  expect(response.ok(), `Skill Run ${runId} returned HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as { run?: SkillRunEvidence };
  expect(payload.run?.runId).toBe(runId);
  return payload.run!;
}

async function readCatalog(page: Page, surface: 'canvas' | 'workflow'): Promise<CatalogSkill[]> {
  const response = await page.request.get(`/api/skills?surface=${surface}`);
  expect(response.ok(), `${surface} Skill catalog returned HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as { skills?: CatalogSkill[] };
  expect(Array.isArray(payload.skills)).toBe(true);
  return payload.skills ?? [];
}

test('画布与节点模式使用同一套 21 项 Skill 定义和版本', async ({ page, stage4Evidence }, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  const auth = await ensureStage4Session(page, fixture);
  const skillFixture = structuredClone(fixture);
  const metadata = skillFixture.canvasProject.metadata as Record<string, unknown>;
  skillFixture.canvasProject.metadata = {
    ...metadata,
    workflow: {
      ...skillFixture.workflow,
      nodes: [],
      connections: [],
      name: `Skill runtime ${fixture.browserProfile}`,
    },
  };
  await seedStage4Baseline(page, skillFixture, auth);
  await seedStage4RuntimeDependencies({
    auth,
    fixture: skillFixture,
    providerBaseUrl: `${providerBaseUrl}/v1`,
  });
  await page.addInitScript(() => {
    localStorage.setItem('wujie_selected_model', JSON.stringify({
      model: 'stage4-image-model',
      providerId: 'stage4-image-provider',
      compositeKey: 'stage4-image-provider::stage4-image-model',
    }));
  });
  await openStage4CanvasProject(page, String(fixture.canvasProject.id));

  const [canvasSkills, workflowSkills] = await Promise.all([
    readCatalog(page, 'canvas'),
    readCatalog(page, 'workflow'),
  ]);
  const identity = (skills: CatalogSkill[]) => skills
    .map(skill => `${skill.id}@${skill.version}`)
    .sort();
  expect(canvasSkills).toHaveLength(21);
  expect(identity(workflowSkills)).toEqual(identity(canvasSkills));
  await writeStage4Metrics(stage4Evidence, testInfo, 'skill-catalog-identity', {
    canvas: identity(canvasSkills),
    workflow: identity(workflowSkills),
  });

  const expandPanel = page.getByRole('button', { name: '展开面板', exact: true });
  if (await expandPanel.isVisible().catch(() => false)) await expandPanel.click();
  await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
  await page.getByRole('button', { name: 'Skills技能库' }).click();
  const canvasSkill = page.getByText('电商商品套图', { exact: true }).last();
  await expect(canvasSkill).toBeVisible();
  await canvasSkill.click();
  await page.getByLabel('产品名称').fill('测试耳机');
  await page.getByLabel('核心卖点').fill('主动降噪');
  const canvasSubmission = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/skill-runs'
  ));
  await page.getByRole('button', { name: '运行 Skill', exact: true }).click();
  const canvasSubmissionResponse = await canvasSubmission;
  expect(canvasSubmissionResponse.ok()).toBe(true);
  const canvasRequest = canvasSubmissionResponse.request().postDataJSON() as {
    skillId?: string;
    skillVersion?: number;
    modelBindings?: Record<string, { providerId?: string; modelId?: string }>;
  };
  const canvasSubmissionPayload = await canvasSubmissionResponse.json() as { runId?: string };
  expect(canvasRequest.skillId).toBe('preset-ecommerce-listing');
  expect(canvasRequest.skillVersion).toBe(1);
  expect(canvasRequest.modelBindings?.orchestrator).toEqual({
    providerId: 'stage4-chat-provider',
    modelId: 'stage4-chat-model',
  });
  expect(canvasRequest.modelBindings?.image).toEqual({
    providerId: 'stage4-image-provider',
    modelId: 'stage4-image-model',
  });
  expect(typeof canvasSubmissionPayload.runId).toBe('string');
  const canvasAssetLoaded = page.waitForResponse(response => (
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/assets'
    && response.ok()
  ));
  await expect(page.getByText('已完成', { exact: true })).toBeVisible({ timeout: 90_000 });
  const canvasRun = await readSkillRun(page, canvasSubmissionPayload.runId!);
  expect(canvasRun.status).toBe('completed');
  expect(canvasRun.skillId).toBe(canvasRequest.skillId);
  expect(canvasRun.skillVersion).toBe(canvasRequest.skillVersion);
  expect(canvasRun.assetVersionIds.length).toBeGreaterThan(0);
  await canvasAssetLoaded;

  const collapsePanel = page.getByRole('button', { name: '收起面板', exact: true });
  if (await collapsePanel.isVisible().catch(() => false)) await collapsePanel.click();
  await page.getByTitle('节点模式').first().click();
  const skillNodeButton = page.locator('[data-node-type="ai-skill"]');
  const nodeLibraryToggle = page.getByRole('button', { name: '切换节点库面板', exact: true });
  if (await nodeLibraryToggle.getAttribute('aria-pressed') !== 'true') {
    await nodeLibraryToggle.click();
  }
  await expect(skillNodeButton).toBeVisible({ timeout: 20_000 });
  await skillNodeButton.click();

  const skillSelect = page.getByRole('combobox', { name: 'Skill' });
  if (!await skillSelect.isVisible().catch(() => false)) {
    await page.getByLabel('Skill 执行').last().click();
  }
  await expect(skillSelect).toBeVisible({ timeout: 20_000 });
  await expect(skillSelect.locator('option')).toHaveCount(22);
  await skillSelect.selectOption('preset-ecommerce-listing');
  await expect(skillSelect).toHaveValue('preset-ecommerce-listing');
  await page.getByLabel('产品名称').last().fill('测试耳机');
  await page.getByLabel('核心卖点').last().fill('主动降噪');
  await page.getByRole('combobox', { name: 'orchestrator 模型' }).selectOption(
    'stage4-chat-provider::stage4-chat-model',
  );
  await page.getByRole('combobox', { name: 'image 模型' }).selectOption(
    'stage4-image-provider::stage4-image-model',
  );
  const workflowSubmission = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/workflow/execute'
    && Boolean(response.request().postData()?.includes('"action":"start"'))
  ), { timeout: 90_000 });
  await page.getByRole('button', { name: '执行工作流', exact: true }).click();
  const workflowSubmissionResponse = await workflowSubmission;
  expect(workflowSubmissionResponse.ok()).toBe(true);
  const workflowSubmissionPayload = await workflowSubmissionResponse.json() as { executionId?: string };
  expect(typeof workflowSubmissionPayload.executionId).toBe('string');
  const workflowRequest = workflowSubmissionResponse.request().postDataJSON() as {
    nodes?: Array<{
      id?: string;
      type?: string;
      config?: { skillId?: string; version?: number };
    }>;
  };
  const workflowSkillNode = workflowRequest.nodes?.find(node => node.type === 'ai-skill');
  expect(workflowSkillNode?.config?.skillId).toBe(canvasRequest.skillId);
  expect(workflowSkillNode?.config?.version).toBe(canvasRequest.skillVersion);
  await expect(page.getByText('执行完成', { exact: true })).toBeVisible({ timeout: 90_000 });
  const workflowStatusResponse = await page.request.post('/api/workflow/execute', {
    data: { action: 'status', executionId: workflowSubmissionPayload.executionId },
  });
  expect(workflowStatusResponse.ok()).toBe(true);
  const workflowStatus = await workflowStatusResponse.json() as {
    status?: string;
    results?: Record<string, { output?: { runId?: string; assetVersionIds?: string[] } }>;
  };
  expect(workflowStatus.status).toBe('completed');
  const workflowOutput = workflowStatus.results?.[workflowSkillNode?.id || '']?.output;
  expect(typeof workflowOutput?.runId).toBe('string');
  expect(workflowOutput?.assetVersionIds?.length).toBeGreaterThan(0);
  const workflowRun = await readSkillRun(page, workflowOutput!.runId!);
  expect(workflowRun.status).toBe('completed');
  expect(workflowRun.skillId).toBe(canvasRun.skillId);
  expect(workflowRun.skillVersion).toBe(canvasRun.skillVersion);
  expect(workflowOutput?.assetVersionIds).toEqual(workflowRun.assetVersionIds);
  await writeStage4Metrics(stage4Evidence, testInfo, 'skill-run-surface-identity', {
    canvas: {
      runId: canvasRun.runId,
      skillId: canvasRun.skillId,
      skillVersion: canvasRun.skillVersion,
      assetVersionIds: canvasRun.assetVersionIds,
    },
    workflow: {
      runId: workflowRun.runId,
      skillId: workflowRun.skillId,
      skillVersion: workflowRun.skillVersion,
      assetVersionIds: workflowRun.assetVersionIds,
    },
  });
});

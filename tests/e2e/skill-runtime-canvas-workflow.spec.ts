import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

import { createWorkflowNode } from '../../src/lib/workflow-engine';

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
const providerImageRequests: string[] = [];

test.beforeAll(async () => {
  providerServer = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (pathname.endsWith('/images/generations') || pathname.endsWith('/images/edits')) {
        providerImageRequests.push(pathname);
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
  steps: Array<{ id: string; label: string; status: string }>;
  creditCost: number;
}

interface AssetReferenceEvidence {
  assetVersionId: string;
  url: string;
  width?: number;
  height?: number;
}

async function readSkillRun(page: Page, runId: string): Promise<SkillRunEvidence> {
  const response = await page.request.get(`/api/skill-runs/${encodeURIComponent(runId)}`);
  expect(response.ok(), `Skill Run ${runId} returned HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as { run?: SkillRunEvidence };
  expect(payload.run?.runId).toBe(runId);
  return payload.run!;
}

async function readAssetReference(
  page: Page,
  projectId: string,
  assetVersionId: string,
): Promise<AssetReferenceEvidence> {
  const query = new URLSearchParams({ projectId, assetVersionId });
  const response = await page.request.get(`/api/assets?${query.toString()}`);
  expect(response.ok(), `Asset ${assetVersionId} returned HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as AssetReferenceEvidence;
  expect(payload.assetVersionId).toBe(assetVersionId);
  expect(typeof payload.url).toBe('string');
  return payload;
}

async function readCatalog(page: Page, surface: 'canvas' | 'workflow'): Promise<CatalogSkill[]> {
  const response = await page.request.get(`/api/skills?surface=${surface}`);
  expect(response.ok(), `${surface} Skill catalog returned HTTP ${response.status()}`).toBe(true);
  const payload = await response.json() as { skills?: CatalogSkill[] };
  expect(Array.isArray(payload.skills)).toBe(true);
  return payload.skills ?? [];
}

test('画布与节点模式使用同一套 27 项 Skill 并逐项恢复结果', async ({ page, stage4Evidence }, testInfo) => {
  test.skip(
    !process.env.DATABASE_URL && !process.env.PGDATABASE_URL,
    'BLOCKED: DATABASE_URL or PGDATABASE_URL is required for the isolated Stage 4 Skill fixture',
  );
  test.setTimeout(180_000);
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  const auth = await ensureStage4Session(page, fixture);
  const skillFixture = structuredClone(fixture);
  const sourceAsset = await seedStage4RuntimeDependencies({
    auth,
    fixture: skillFixture,
    page,
    providerBaseUrl: `${providerBaseUrl}/v1`,
  });
  const metadata = skillFixture.canvasProject.metadata as Record<string, unknown>;
  const sourceNode = createWorkflowNode('input-image', 80, 120, '营销来源图');
  sourceNode.config = {
    ...sourceNode.config,
    projectId: String(fixture.canvasProject.id),
    assetVersionId: `stage4-version-${fixture.browserProfile}`,
    placementId: `stage4-placement-${fixture.browserProfile}`,
    imageUrl: sourceAsset.canonicalUrl,
  };
  const marketingNode = createWorkflowNode('ai-skill', 420, 120);
  skillFixture.canvasProject.metadata = {
    ...metadata,
    workflow: {
      ...skillFixture.workflow,
      nodes: [sourceNode, marketingNode],
      connections: [{
        id: `stage4-marketing-source-${fixture.browserProfile}`,
        fromNodeId: sourceNode.id,
        fromPortId: 'out-image',
        toNodeId: marketingNode.id,
        toPortId: 'in-image',
        type: 'image',
      }],
      name: `Skill runtime ${fixture.browserProfile}`,
    },
  };
  await seedStage4Baseline(page, skillFixture, auth);
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
  expect(canvasSkills).toHaveLength(27);
  expect(identity(workflowSkills)).toEqual(identity(canvasSkills));
  expect(canvasSkills.map(skill => skill.id)).toEqual(expect.arrayContaining([
    'preset-ad-ab-variants',
    'preset-retargeting-creative',
    'preset-omnichannel-campaign',
    'preset-video-platform-thumbnails',
    'preset-pinterest-pins',
    'preset-batch-sku-assets',
  ]));
  await writeStage4Metrics(stage4Evidence, testInfo, 'skill-catalog-identity', {
    canvas: identity(canvasSkills),
    workflow: identity(workflowSkills),
  });

  await page.locator('[data-canvas-image-id]').first().click();
  const expandPanel = page.getByRole('button', { name: '展开面板', exact: true });
  if (await expandPanel.isVisible().catch(() => false)) await expandPanel.click();
  await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
  await page.getByRole('button', { name: 'Skills技能库' }).click();
  await expect(page.getByText('YouTube/B站缩略图', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Pinterest 图钉', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('批量 SKU 商品素材', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('再营销素材', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('全渠道活动素材包', { exact: true }).last()).toBeVisible();
  const canvasSkill = page.getByText('YouTube/B站缩略图', { exact: true }).last();
  await expect(canvasSkill).toBeVisible();
  await canvasSkill.click();
  await page.getByLabel('视频标题').fill('一分钟看懂主动降噪');
  await page.getByLabel('主体').fill('无线降噪耳机');
  await page.getByLabel('目标观众').fill('通勤用户');
  await page.getByLabel('点击动机').fill('对比降噪前后的体验差异');
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
  expect(canvasRequest.skillId).toBe('preset-video-platform-thumbnails');
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
  await expect.poll(
    async () => (await readSkillRun(page, canvasSubmissionPayload.runId!)).status,
    { timeout: 90_000, intervals: [250, 500, 1_000, 2_000] },
  ).toBe('completed');
  expect(providerImageRequests.length).toBeGreaterThanOrEqual(2);
  const canvasRun = await readSkillRun(page, canvasSubmissionPayload.runId!);
  expect(canvasRun.status).toBe('completed');
  expect(canvasRun.skillId).toBe(canvasRequest.skillId);
  expect(canvasRun.skillVersion).toBe(canvasRequest.skillVersion);
  expect(canvasRun.assetVersionIds).toHaveLength(2);
  expect(canvasRun.steps.map(step => step.label)).toEqual([
    '制定缩略图方案', 'YouTube 缩略图', 'B站缩略图',
  ]);

  await readAssetReference(
    page,
    String(fixture.canvasProject.id),
    canvasRun.assetVersionIds[0],
  );
  const canvasImages = page.locator('[data-canvas-image-id]');
  await expect(canvasImages).toHaveCount(3, { timeout: 20_000 });
  const canvasPreview = canvasImages.last().getByRole('img', { name: 'canvas image', exact: true });
  await expect(canvasPreview).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => canvasPreview.evaluate(image => ({
    width: (image as HTMLImageElement).naturalWidth,
    height: (image as HTMLImageElement).naturalHeight,
  }))).toEqual({ width: 1, height: 1 });
  await canvasImages.last().click();
  await page.getByRole('button', { name: '展开更多工具', exact: true }).click();
  await page.locator('[data-image-toolbar-overflow]').getByRole('button', { name: '下载', exact: true }).click();
  await expect(page.getByText('PNG 格式', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '确认下载', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const downloadedMetadata = await sharp(downloadPath!).metadata();
  expect(downloadedMetadata.format).toBe('png');
  expect(downloadedMetadata.width).toBe(1);
  expect(downloadedMetadata.height).toBe(1);

  await page.getByTitle('关闭 Skill').click();
  await page.getByPlaceholder('搜索 Skills...').fill('批量 SKU');
  await page.getByText('批量 SKU 商品素材', { exact: true }).last().click();
  const skuCsv = [
    'sku,name,sellingPoints,variant,headline',
    'SKU-A,黑色耳机,主动降噪,黑色,安静通勤',
    'SKU-B,白色耳机,长续航,白色,全天陪伴',
    'SKU-C,蓝色耳机,低延迟,蓝色,游戏音画同步',
  ].join('\n');
  await page.getByLabel('导入 SKU 数据').setInputFiles({
    name: 'sku-batch.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(skuCsv, 'utf8'),
  });
  await expect(page.getByText('共 3 行，预览前 3 行', { exact: true })).toBeVisible();
  const batchSubmission = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/skill-runs'
  ));
  await page.getByRole('button', { name: '运行 Skill', exact: true }).click();
  const batchSubmissionResponse = await batchSubmission;
  expect(batchSubmissionResponse.ok()).toBe(true);
  const batchRequest = batchSubmissionResponse.request().postDataJSON() as {
    skillId?: string;
    inputValues?: { rows?: Array<{ sku?: string }> };
  };
  expect(batchRequest.skillId).toBe('preset-batch-sku-assets');
  expect(batchRequest.inputValues?.rows?.map(row => row.sku)).toEqual(['SKU-A', 'SKU-B', 'SKU-C']);
  const batchPayload = await batchSubmissionResponse.json() as { runId?: string };
  expect(typeof batchPayload.runId).toBe('string');
  await expect.poll(
    async () => (await readSkillRun(page, batchPayload.runId!)).status,
    { timeout: 90_000, intervals: [250, 500, 1_000, 2_000] },
  ).toBe('completed');
  const batchRun = await readSkillRun(page, batchPayload.runId!);
  expect(batchRun.assetVersionIds).toHaveLength(3);
  expect(batchRun.steps.map(step => step.label)).toEqual([
    '检查批次规则', 'SKU 商品素材 1', 'SKU 商品素材 2', 'SKU 商品素材 3',
  ]);
  const batchAssetOrder = [...batchRun.assetVersionIds];
  await expect(page.locator('[data-canvas-image-id]')).toHaveCount(6, { timeout: 20_000 });
  await expect.poll(async () => {
    const response = await page.request.get('/api/user-data/sync?key=projects');
    if (!response.ok()) return 0;
    const payload = await response.json() as {
      value?: Array<{ id?: string; canvasImages?: unknown[] }>;
    };
    return payload.value?.find(project => project.id === fixture.canvasProject.id)?.canvasImages?.length ?? 0;
  }, { timeout: 20_000, intervals: [250, 500, 1_000] }).toBeGreaterThanOrEqual(6);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-canvas-viewport]')).toBeVisible({ timeout: 20_000 });
  const restoredBatchRun = await readSkillRun(page, batchPayload.runId!);
  expect(restoredBatchRun.status).toBe('completed');
  expect(restoredBatchRun.assetVersionIds).toEqual(batchAssetOrder);
  expect(restoredBatchRun.steps.map(step => step.label)).toEqual(batchRun.steps.map(step => step.label));

  await page.locator('[data-canvas-image-id]').first().click();
  const reopenedExpandPanel = page.getByRole('button', { name: '展开面板', exact: true });
  if (await reopenedExpandPanel.isVisible().catch(() => false)) await reopenedExpandPanel.click();
  await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
  await page.getByRole('button', { name: 'Skills技能库' }).click();
  await page.getByPlaceholder('搜索 Skills...').fill('批量 SKU');
  await page.getByText('批量 SKU 商品素材', { exact: true }).last().click();
  await page.getByRole('button', { name: `查看任务 ${batchPayload.runId}` }).click();
  const restoredStepLabels = page.locator('ol li > span:first-child');
  await expect(restoredStepLabels).toHaveText([
    '检查批次规则', 'SKU 商品素材 1', 'SKU 商品素材 2', 'SKU 商品素材 3',
  ]);

  const collapsePanel = page.getByRole('button', { name: '收起面板', exact: true });
  if (await collapsePanel.isVisible().catch(() => false)) await collapsePanel.click();
  await page.getByTitle('节点模式').first().click();
  await page.getByLabel('Skill 执行').last().click();

  const skillSelect = page.getByRole('combobox', { name: 'Skill' });
  if (!await skillSelect.isVisible().catch(() => false)) {
    await page.getByLabel('Skill 执行').last().click();
  }
  await expect(skillSelect).toBeVisible({ timeout: 20_000 });
  await expect(skillSelect.locator('option')).toHaveCount(28);
  await skillSelect.selectOption('preset-pinterest-pins');
  await expect(skillSelect).toHaveValue('preset-pinterest-pins');
  await expect(page.getByText('已选择 1 张来源图片', { exact: true }).last()).toBeVisible();
  await page.getByLabel('内容主题').last().fill('通勤降噪指南');
  await page.getByLabel('目标受众').last().fill('通勤用户');
  await page.getByLabel('目标').last().selectOption('收藏');
  await page.getByLabel('图钉数量').last().selectOption('3');
  await page.getByRole('combobox', { name: 'orchestrator 模型' }).selectOption(
    'stage4-chat-provider::stage4-chat-model',
  );
  await page.getByRole('combobox', { name: 'image 模型' }).selectOption(
    'stage4-image-provider::stage4-image-model',
  );
  const workflowEstimate = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/skill-runs/estimate'
  ), { timeout: 90_000 });
  const workflowSubmission = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/workflow/execute'
    && Boolean(response.request().postData()?.includes('"action":"start"'))
  ), { timeout: 90_000 });
  await page.getByRole('button', { name: '执行工作流', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skill 费用预估', exact: true })).toBeVisible({ timeout: 20_000 });
  const workflowEstimateResponse = await workflowEstimate;
  expect(workflowEstimateResponse.ok()).toBe(true);
  const workflowEstimatePayload = await workflowEstimateResponse.json() as { minimum?: number; maximum?: number };
  expect(workflowEstimatePayload.minimum).toBe(workflowEstimatePayload.maximum);
  expect(workflowEstimatePayload.maximum).toBeGreaterThan(0);
  await expect(page.getByText(`${workflowEstimatePayload.maximum} 积分`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
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
  expect(workflowSkillNode?.config?.skillId).toBe('preset-pinterest-pins');
  expect(workflowSkillNode?.config?.version).toBe(1);
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
  expect(workflowOutput?.assetVersionIds).toHaveLength(3);
  const workflowRun = await readSkillRun(page, workflowOutput!.runId!);
  expect(workflowRun.status).toBe('completed');
  expect(workflowRun.skillId).toBe('preset-pinterest-pins');
  expect(workflowRun.skillVersion).toBe(1);
  expect(workflowRun.assetVersionIds).toHaveLength(3);
  expect(workflowRun.steps.map(step => step.label)).toEqual([
    '制定图钉系列方案', '主图钉', '细节图钉', '转化图钉',
  ]);
  expect(workflowRun.creditCost).toBe(workflowEstimatePayload.maximum);
  expect(workflowOutput?.assetVersionIds).toEqual(workflowRun.assetVersionIds);
  await writeStage4Metrics(stage4Evidence, testInfo, 'skill-run-surface-identity', {
    canvas: {
      runId: canvasRun.runId,
      skillId: canvasRun.skillId,
      skillVersion: canvasRun.skillVersion,
      assetVersionIds: canvasRun.assetVersionIds,
    },
    batch: {
      runId: batchRun.runId,
      skillId: batchRun.skillId,
      skillVersion: batchRun.skillVersion,
      assetVersionIds: batchRun.assetVersionIds,
    },
    workflow: {
      runId: workflowRun.runId,
      skillId: workflowRun.skillId,
      skillVersion: workflowRun.skillVersion,
      assetVersionIds: workflowRun.assetVersionIds,
    },
  });
});

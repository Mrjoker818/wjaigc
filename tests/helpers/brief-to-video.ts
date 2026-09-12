import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';

import { expect, test as base, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { Pool } from 'pg';
import {
  configureWorkflowSkillNodePorts,
  createEmptyWorkflow,
  createWorkflowNode,
  type WorkflowConnection,
} from '../../src/lib/workflow-engine';
import { createBriefToVideoSkill } from '../../src/lib/skill-runtime/brief-to-video-preset';

import {
  ensureStage4Session,
  openStage4CanvasProject,
  seedStage4Baseline,
  seedStage4RuntimeDependencies,
  stage4FixtureForProject,
} from './stage-4-e2e';
import { findNewBriefVideoRunId } from './brief-to-video-card-selection';

const SKILL_ID = 'preset-brief-to-video-film';
const VIDEO_PROVIDER_ID = 'brief-video-e2e-provider';
const VIDEO_MODEL_ID = 'brief-video-e2e-model';
const ORCHESTRATOR_PROVIDER_ID = 'stage4-chat-provider';
const ORCHESTRATOR_MODEL_ID = 'stage4-chat-model';

type VideoMode = 'text-to-video' | 'image-to-video' | 'first-last-frame';

interface ApprovalIdentity {
  runId: string;
  revision: number;
  generation: number;
  planChecksum: string;
}

interface RunProjection {
  runId: string;
  status: string;
  approval?: {
    revision?: number;
    generation?: number;
    planChecksum?: string;
  };
  assetVersionIds?: string[];
  outputs?: Array<{ schemaId?: string; content?: string }>;
}

interface ProviderSubmission {
  providerId: string;
  modelId: string;
  mode: VideoMode;
  durationSeconds: number;
  aspectRatio: string;
  requestSha256: string;
}

interface EvidenceEntry {
  at: string;
  type: string;
  method?: string;
  status?: number;
  url?: string;
  text?: string;
}

export interface BriefToVideoFixture {
  projectId: string;
  videoProviderId: string;
  videoModelId: string;
  openCanvas(): Promise<void>;
  assertCanvasSkillCatalogCount(expected: number): Promise<void>;
  createCanvasRunFromUi(mode: VideoMode): Promise<ApprovalIdentity>;
  readRunStatus(runId: string): Promise<string>;
  reviseFromUi(runId: string): Promise<ApprovalIdentity>;
  approveFromUi(identity: ApprovalIdentity): Promise<void>;
  cancelFromUi(runId: string): Promise<void>;
  assertNoVideoChildInDatabase(runId: string): Promise<void>;
  videoSubmissions(): ProviderSubmission[];
  runWorkflowThroughUi(): Promise<{
    runId: string;
    catalogCount: number;
    outputNodeType: 'output-video';
    videoAssetVersionId: string;
  }>;
  runSimpleChatThroughUi(): Promise<{
    catalogCount: number;
    catalogContainsBriefToVideo: boolean;
    cancelledRunId: string;
    completedRunId: string;
    videoAssetVersionId: string;
  }>;
  assertMobileApprovalExperience(): Promise<void>;
  writeMachineEvidence(ids: Record<string, string>): Promise<void>;
  dispose(): Promise<void>;
}

function safe(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

function candidateProvenance(): Record<string, unknown> {
  const supplied = process.env.BRIEF_TO_VIDEO_CANDIDATE_PROVENANCE?.trim();
  if (supplied) return JSON.parse(supplied) as Record<string, unknown>;
  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
  }).trim();
  return {
    scheme: 'git-parent-subtrees-v1',
    expectedParentCommit: git('rev-parse', 'HEAD^'),
    candidateTrees: {
      src: git('rev-parse', 'HEAD:src'),
      tests: git('rev-parse', 'HEAD:tests'),
      scripts: git('rev-parse', 'HEAD:scripts'),
    },
  };
}

function candidateSha(): string {
  return createHash('sha256').update(JSON.stringify(candidateProvenance())).digest('hex');
}

function commitIdentity(): string {
  return safe(process.env.BRIEF_TO_VIDEO_EVIDENCE_COMMIT || candidateSha());
}

function evidenceDirectory(testInfo: TestInfo): string {
  return join(
    process.cwd(),
    'test-results',
    'brief-to-video',
    commitIdentity(),
    safe(testInfo.project.name),
    safe(testInfo.title),
    `retry-${testInfo.retry}`,
  );
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|password|signature|credential)=)[^&]+/giu, '$1[REDACTED]');
}

async function json(response: Pick<APIResponse, 'json'>): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function plan(revised: boolean): Record<string, unknown> {
  return {
    schemaId: 'brief-to-video-plan-v1',
    title: revised ? '通勤防晒成片（加快节奏）' : '通勤防晒成片',
    logline: '用通勤场景说明轻薄防晒的产品价值。',
      durationSeconds: 5,
    aspectRatio: '9:16',
    scenes: [{
      order: 1,
      timeRange: '0-5s',
      visual: '清晨通勤者使用轻薄防晒霜',
      camera: revised ? '快速推进' : '平稳推进',
      action: '产品与人物交替出现',
      textOverlay: '轻薄通勤防晒',
    }],
    finalVideoPrompt: revised ? '快速节奏的竖屏通勤防晒产品成片' : '竖屏通勤防晒产品成片',
    negativePrompt: '闪烁、形变、错误文字',
    factualConstraints: ['不虚构防晒等级'],
  };
}

async function startControlledProvider(submissions: ProviderSubmission[]): Promise<{
  server: Server;
  sockets: Set<Socket>;
  baseUrl: string;
}> {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (request.method === 'POST' && pathname.endsWith('/chat/completions')) {
        const revised = raw.includes('加快节奏');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: JSON.stringify(plan(revised)) } }],
        }));
        return;
      }
      if (request.method === 'POST' && pathname.endsWith('/video/generations')) {
        const body = JSON.parse(raw || '{}') as Record<string, unknown>;
        const hasStart = typeof body.image_url === 'string';
        const hasEnd = typeof body.last_frame_image_url === 'string';
        submissions.push({
          providerId: VIDEO_PROVIDER_ID,
          modelId: String(body.model || ''),
          mode: hasEnd ? 'first-last-frame' : hasStart ? 'image-to-video' : 'text-to-video',
          durationSeconds: Number(body.duration),
          aspectRatio: String(body.aspect_ratio || ''),
          requestSha256: createHash('sha256').update(raw).digest('hex'),
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(submissions.length === 1
          ? { task_id: 'local-video-cancel', status: 'processing' }
          : { data: [{ url: `http://${request.headers.host}/fixture.mp4` }] }));
        return;
      }
      if (request.method === 'GET' && pathname === '/fixture.mp4') {
        const bytes = Buffer.from('000000206674797069736f6d0000020069736f6d69736f32', 'hex');
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) });
        response.end(bytes);
        return;
      }
      if (request.method === 'GET' && pathname.includes('/tasks/')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'processing', progress: 25 }));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'controlled route not found' }));
    });
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    sockets,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

async function readRun(page: Page, runId: string): Promise<RunProjection> {
  const response = await page.request.get(`/api/skill-runs/${encodeURIComponent(runId)}?observeOnly=true`);
  const payload = await json(response);
  expect(response.ok(), `Skill Run ${runId} returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
  return payload.run as RunProjection;
}

async function waitForApproval(page: Page, runId: string): Promise<ApprovalIdentity> {
  let projection: RunProjection | undefined;
  await expect.poll(async () => {
    projection = await readRun(page, runId);
    const approval = projection.approval;
    return projection.status === 'paused'
      && typeof approval?.revision === 'number'
      && typeof approval.generation === 'number'
      && typeof approval.planChecksum === 'string';
  }, { timeout: 60_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  const approval = projection?.approval;
  expect(approval?.revision).toEqual(expect.any(Number));
  expect(approval?.generation).toEqual(expect.any(Number));
  expect(approval?.planChecksum).toMatch(/^[a-f0-9]{64}$/u);
  return {
    runId,
    revision: approval!.revision!,
    generation: approval!.generation!,
    planChecksum: approval!.planChecksum!,
  };
}

async function setupFixture(page: Page, testInfo: TestInfo, directory: string): Promise<BriefToVideoFixture> {
  const connectionString = process.env.DATABASE_URL?.trim() || process.env.PGDATABASE_URL?.trim();
  if (!connectionString) throw new Error('BLOCKED: isolated PostgreSQL is required for Brief-to-video E2E');
  const submissions: ProviderSubmission[] = [];
  const provider = await startControlledProvider(submissions);
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  const workflowSkill = configureWorkflowSkillNodePorts(
    createWorkflowNode('ai-skill', 360, 180, 'Brief 视频 Skill'),
    createBriefToVideoSkill(true),
  );
  workflowSkill.config = {
    ...workflowSkill.config,
    skillId: SKILL_ID,
    version: 1,
    inputValues: {
      brief: '节点模式生成通勤防晒最终成片', goal: '产品转化', audience: '都市通勤人群',
      platform: '抖音', style: '电影感、主体清晰、运动自然', durationSeconds: '5',
      aspectRatio: '9:16', resolution: '1080p', generateAudio: false,
    },
    modelBindings: {
      orchestrator: { providerId: ORCHESTRATOR_PROVIDER_ID, modelId: ORCHESTRATOR_MODEL_ID },
      video: { providerId: VIDEO_PROVIDER_ID, modelId: VIDEO_MODEL_ID },
    },
  };
  const workflowOutput = createWorkflowNode('output-video', 760, 180, '最终视频输出');
  const workflowConnection: WorkflowConnection = {
    id: `brief-video-output-${testInfo.project.name}`,
    fromNodeId: workflowSkill.id,
    fromPortId: 'out-video',
    toNodeId: workflowOutput.id,
    toPortId: 'in-video',
    type: 'video',
  };
  fixture.canvasProject.workflow = {
    ...createEmptyWorkflow('Brief 视频 E2E'),
    id: `brief-video-workflow-${testInfo.project.name}`,
    nodes: [workflowSkill, workflowOutput],
    connections: [workflowConnection],
  };
  await page.request.get('/api/auth/register', { timeout: 60_000 });
  const auth = await ensureStage4Session(page, fixture);
  await seedStage4RuntimeDependencies({
    auth,
    fixture,
    page,
    providerBaseUrl: provider.baseUrl,
  });
  await page.request.get('/api/user-data/sync?key=projects', { timeout: 60_000 });
  await seedStage4Baseline(page, fixture, auth);

  const pool = new Pool({ connectionString });
  const now = Date.now();
  await pool.query(
    `INSERT INTO wujie_api_providers(
       id, name, display_name, base_url, api_key, is_enabled, type, model_type,
       request_style, selected_models, advanced_params, is_default, created_at, updated_at,
       connection_status, discovered_models, sort_order
     ) VALUES ($1, $2, $2, $3, 'controlled-local-key', true, 'video', 'video',
       'custom', $4::text[], '{}'::jsonb, false, $5, $5, 'connected', $6::jsonb, 3)
     ON CONFLICT (id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       selected_models = EXCLUDED.selected_models,
       discovered_models = EXCLUDED.discovered_models,
       is_enabled = true,
       updated_at = EXCLUDED.updated_at`,
    [
      VIDEO_PROVIDER_ID,
      'Brief Video E2E Provider',
      provider.baseUrl,
      [VIDEO_MODEL_ID],
      now,
      JSON.stringify([{
        id: VIDEO_MODEL_ID,
        name: 'Brief Video E2E Model',
        type: 'video',
        supportedAspectRatios: ['9:16'],
        supportedQualities: ['1080p'],
        allowedDurationsSeconds: [5],
        maxDurationSeconds: 5,
        maxReferenceImages: 2,
        capabilities: ['video', 'reference-images'],
        supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
        outputKinds: ['mp4'],
      }]),
    ],
  );

  const projectId = String(fixture.canvasProject.id);
  const sourceVersionId = `stage4-version-${fixture.browserProfile}`;
  const openCanvas = async (): Promise<void> => {
    await page.request.get(`/?projectId=${encodeURIComponent(projectId)}`, { timeout: 120_000 });
    await page.request.get('/api/session', { timeout: 60_000 });
    try {
      await openStage4CanvasProject(page, projectId);
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-canvas-viewport]')).toHaveAttribute(
        'data-project-id',
        projectId,
        { timeout: 30_000 },
      );
    }
    const expand = page.getByRole('button', { name: '展开面板', exact: true });
    if (await expand.isVisible().catch(() => false)) await expand.click();
    const skillSearch = page.getByPlaceholder('搜索 Skills...');
    if (!await skillSearch.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
    }
    if (!await skillSearch.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Skills技能库' }).click();
    }
    await expect(skillSearch).toBeVisible({ timeout: 30_000 });
    await skillSearch.fill('Brief 到视频');
  };

  const openCanvasSkill = async (): Promise<void> => {
    await openCanvas();
    const close = page.getByTitle('关闭 Skill');
    if (await close.isVisible().catch(() => false)) await close.click();
    await page.getByPlaceholder('搜索 Skills...').fill('Brief 到视频');
    await page.getByText('Brief 到视频成片', { exact: true }).last().click();
    await expect(page.getByLabel('video 模型', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('video 模型', { exact: true }).selectOption(`${VIDEO_PROVIDER_ID}::${VIDEO_MODEL_ID}`);
  };

  const createCanvasRunFromUi = async (mode: VideoMode): Promise<ApprovalIdentity> => {
    await page.keyboard.press('Escape');
    if (mode !== 'text-to-video') await page.locator('[data-canvas-image-id]').first().click();
    await openCanvasSkill();
    await page.getByLabel('创作 Brief', { exact: true }).fill(`${mode} 通勤防晒产品短片`);
    await page.getByLabel('目标受众', { exact: true }).fill('都市通勤人群');
    await page.getByLabel('传播目标', { exact: true }).selectOption('产品转化');
    await page.getByLabel('发布平台', { exact: true }).selectOption('抖音');
    await page.getByLabel('视频时长', { exact: true }).selectOption('5');
    await page.getByLabel('画面比例', { exact: true }).selectOption('9:16');
    await page.getByLabel('分辨率', { exact: true }).selectOption('1080p');
    if (mode === 'first-last-frame') await page.getByLabel('尾帧', { exact: true }).fill(sourceVersionId);
    const submission = page.waitForResponse(response => (
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/skill-runs'
    ));
    await page.getByRole('button', { name: '运行 Skill', exact: true }).click();
    const response = await submission;
    const payload = await json(response);
    expect(response.ok(), `Canvas UI Skill Run returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
    return waitForApproval(page, String(payload.runId));
  };

  const assertNoVideoChildInDatabase = async (runId: string): Promise<void> => {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM cloud_tasks
       WHERE type='video' AND result #>> '{skillBillingProvenance,runId}'=$1`,
      [runId],
    );
    expect(result.rows[0]?.count).toBe('0');
  };

  const reviseFromUi = async (runId: string): Promise<ApprovalIdentity> => {
    const current = await waitForApproval(page, runId);
    await page.getByRole('button', { name: '修改脚本' }).click();
    await page.getByLabel('脚本修改要求').fill('加快节奏');
    await page.getByRole('button', { name: '提交修改要求' }).click();
    await expect.poll(async () => (await readRun(page, runId)).approval?.planChecksum, {
      timeout: 60_000,
      intervals: [100, 250, 500, 1_000],
    }).not.toBe(current.planChecksum);
    return waitForApproval(page, runId);
  };

  const approveFromUi = async (identity: ApprovalIdentity): Promise<void> => {
    const approval = page.getByRole('button', { name: '批准生成' });
    await expect(approval).toBeVisible();
    await approval.click();
    await expect.poll(async () => (await readRun(page, identity.runId)).status, {
      timeout: 60_000, intervals: [100, 250, 500, 1_000],
    }).not.toBe('paused');
  };

  const cancelFromUi = async (runId: string): Promise<void> => {
    const cancel = page.getByRole('button', { name: '取消任务' });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect.poll(async () => (await readRun(page, runId)).status, {
      timeout: 60_000, intervals: [100, 250, 500, 1_000],
    }).toBe('cancelled');
  };

  return {
    projectId,
    videoProviderId: VIDEO_PROVIDER_ID,
    videoModelId: VIDEO_MODEL_ID,
    openCanvas,
    async assertCanvasSkillCatalogCount(expected) {
      await openCanvas();
      await page.getByPlaceholder('搜索 Skills...').fill('');
      await expect(page.locator('[data-canvas-skill-id]')).toHaveCount(expected);
    },
    createCanvasRunFromUi,
    async readRunStatus(runId) {
      return (await readRun(page, runId)).status;
    },
    reviseFromUi,
    approveFromUi,
    cancelFromUi,
    assertNoVideoChildInDatabase,
    videoSubmissions: () => structuredClone(submissions),
    async runWorkflowThroughUi() {
      await openCanvas();
      const collapse = page.getByRole('button', { name: '收起面板', exact: true });
      if (await collapse.isVisible().catch(() => false)) await collapse.click();
      await page.getByTitle('节点模式').first().click();
      await page.getByLabel(workflowSkill.label).click();
      const workflowCatalog = page.locator('[data-workflow-skill-id]');
      await expect(workflowCatalog).toHaveCount(30);
      const catalogCount = await workflowCatalog.count();
      await expect(page.getByRole('combobox', { name: 'Skill' })).toHaveValue(SKILL_ID);
      await page.getByRole('combobox', { name: 'video 模型' }).selectOption(
        `${VIDEO_PROVIDER_ID}::${VIDEO_MODEL_ID}`,
      );
      const started = page.waitForResponse(response => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/workflow/execute'
        && Boolean(response.request().postData()?.includes('"action":"start"'))
      ));
      await page.getByRole('button', { name: '执行工作流', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Skill 费用预估', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '确认执行', exact: true }).click();
      const startResponse = await started;
      expect(startResponse.ok()).toBe(true);
      const startPayload = await json(startResponse);
      const executionId = String(startPayload.executionId || '');
      await expect(page.getByRole('button', { name: '批准生成' })).toBeVisible({ timeout: 90_000 });
      const pausedResponse = await page.request.post('/api/workflow/execute', {
        data: { action: 'status', executionId },
      });
      const paused = await json(pausedResponse) as { results?: Record<string, { output?: { runId?: string } }> };
      const runId = String(paused.results?.[workflowSkill.id]?.output?.runId || '');
      expect(runId).not.toBe('');
      await assertNoVideoChildInDatabase(runId);
      await page.getByRole('button', { name: '批准生成' }).click();
      await expect(page.getByText('执行完成', { exact: true })).toBeVisible({ timeout: 120_000 });
      const completedResponse = await page.request.post('/api/workflow/execute', {
        data: { action: 'status', executionId },
      });
      const completed = await json(completedResponse) as {
        results?: Record<string, { output?: {
          structured?: { value?: { videoAssetVersionId?: string } };
          videoAssetVersionId?: string;
        } }>;
      };
      const skillOutput = completed.results?.[workflowSkill.id]?.output;
      const outputVideo = completed.results?.[workflowOutput.id]?.output;
      const videoAssetVersionId = String(
        outputVideo?.videoAssetVersionId
        || outputVideo?.structured?.value?.videoAssetVersionId
        || skillOutput?.videoAssetVersionId
        || skillOutput?.structured?.value?.videoAssetVersionId
        || '',
      );
      expect(videoAssetVersionId).not.toBe('');
      return {
        runId,
        catalogCount,
        outputNodeType: 'output-video' as const,
        videoAssetVersionId,
      };
    },
    async runSimpleChatThroughUi() {
      await page.goto(`/simple-chat?projectId=${encodeURIComponent(String(fixture.chatProject.id))}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByLabel('目标画布项目').selectOption(projectId);
      await page.getByTitle('Skill').click();
      const catalogItems = page.locator('[data-simple-chat-skill-id]');
      await expect(catalogItems).toHaveCount(16);
      const catalogContainsBriefToVideo = await catalogItems.evaluateAll(
        items => items.some(item => item.getAttribute('data-simple-chat-skill-id') === 'preset-brief-to-video-film'),
      );
      await page.getByTitle('Skill').click();
      const prompt = `根据 Brief：展示轻薄防晒霜通勤场景，生成最终成片。平台：抖音；时长：5秒；比例：9:16；视频模型：${VIDEO_MODEL_ID}；受众：都市通勤人群；目标：产品转化`;
      const sendIntent = async (): Promise<string> => {
        const cards = page.locator('[data-simple-chat-brief-video-run-id]');
        const beforeCount = await cards.count();
        const beforeRunIds = await cards.evaluateAll(items => items.map(
          item => item.getAttribute('data-simple-chat-brief-video-run-id') || '',
        ));
        const input = page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片');
        await input.fill(prompt);
        await input.press('Enter');
        let newRunId: string | undefined;
        await expect.poll(async () => {
          const currentRunIds = await cards.evaluateAll(items => items.map(
            item => item.getAttribute('data-simple-chat-brief-video-run-id') || '',
          ));
          newRunId = findNewBriefVideoRunId(beforeRunIds, currentRunIds);
          return { count: currentRunIds.length, newRunId };
        }, { timeout: 90_000, intervals: [100, 250, 500, 1_000] }).toMatchObject({
          count: expect.any(Number),
          newRunId: expect.any(String),
        });
        expect(await cards.count()).toBeGreaterThan(beforeCount);
        return newRunId!;
      };
      const cancelledRunId = await sendIntent();
      await reviseFromUi(cancelledRunId);
      await cancelFromUi(cancelledRunId);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`[data-simple-chat-brief-video-run-id="${cancelledRunId}"]`)).toBeVisible();

      const completedRunId = await sendIntent();
      await assertNoVideoChildInDatabase(completedRunId);
      await approveFromUi(await waitForApproval(page, completedRunId));
      await expect(page.getByRole('button', { name: '返回画布' })).toBeVisible({ timeout: 120_000 });
      const completedRun = await readRun(page, completedRunId);
      const resultOutput = completedRun.outputs?.find(output => output.schemaId === 'brief-to-video-result-v1');
      const result = JSON.parse(resultOutput?.content || '{}') as { videoAssetVersionId?: string };
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: '返回画布' })).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: '返回画布' }).click();
      await expect(page).toHaveURL(new RegExp(`projectId=${projectId}`), { timeout: 60_000 });
      return {
        catalogCount: 16,
        catalogContainsBriefToVideo,
        cancelledRunId,
        completedRunId,
        videoAssetVersionId: String(result.videoAssetVersionId || ''),
      };
    },
    async assertMobileApprovalExperience() {
      const viewportWidth = page.viewportSize()?.width ?? 0;
      expect(viewportWidth).toBe(375);
      const modelMenu = page.getByLabel('video 模型', { exact: true });
      await modelMenu.selectOption(`${VIDEO_PROVIDER_ID}::${VIDEO_MODEL_ID}`);
      const approve = page.getByRole('button', { name: '批准生成' });
      const revise = page.getByRole('button', { name: '修改脚本' });
      const cancel = page.getByRole('button', { name: '取消任务' });
      await expect(approve).toBeVisible({ timeout: 30_000 });
      await expect(revise).toBeVisible({ timeout: 30_000 });
      await expect(cancel).toBeVisible({ timeout: 30_000 });
      const controls = [modelMenu, approve, revise, cancel];
      for (const control of controls) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(40);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
      }
      const assertNoOverlap = async (): Promise<void> => {
        const boxes = await Promise.all([approve, revise, cancel].map(control => control.boundingBox()));
        for (let left = 0; left < boxes.length; left += 1) for (let right = left + 1; right < boxes.length; right += 1) {
          const a = boxes[left]!; const b = boxes[right]!;
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
        }
      };
      await assertNoOverlap();
      await revise.click();
      await expect(page.getByLabel('脚本修改要求')).toBeVisible();
      await revise.click();
      const vertical = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight }));
      expect(vertical.scrollHeight).toBeGreaterThanOrEqual(vertical.viewportHeight);
    },
    async writeMachineEvidence(ids) {
      const body = {
        schemaVersion: 2,
        evidenceKind: 'controlled-local-playwright',
        cloudVerified: false,
        supplierVerified: false,
        candidateSha: candidateSha(),
        candidateProvenance: candidateProvenance(),
        project: testInfo.project.name,
        generatedAt: new Date().toISOString(),
        identities: ids,
        provider: { providerId: VIDEO_PROVIDER_ID, modelId: VIDEO_MODEL_ID },
        submissions,
      };
      await writeFile(join(directory, 'machine-evidence.json'), JSON.stringify(body, null, 2), 'utf8');
    },
    async dispose() {
      await pool.end();
      provider.sockets.forEach(socket => socket.destroy());
      await new Promise<void>(resolve => provider.server.close(() => resolve()));
    },
  };
}

export const test = base.extend<{ briefToVideo: BriefToVideoFixture }>({
  briefToVideo: [async ({ page }, useFixture, testInfo) => {
    const directory = evidenceDirectory(testInfo);
    const consoleEntries: EvidenceEntry[] = [];
    const networkEntries: EvidenceEntry[] = [];
    await mkdir(directory, { recursive: true });
    page.on('console', message => {
      if (message.type() === 'warning' || message.type() === 'error') {
        consoleEntries.push({ at: new Date().toISOString(), type: message.type(), text: redact(message.text()) });
      }
    });
    page.on('pageerror', error => {
      consoleEntries.push({ at: new Date().toISOString(), type: 'pageerror', text: redact(error.message) });
    });
    page.on('requestfailed', request => {
      networkEntries.push({
        at: new Date().toISOString(),
        type: 'requestfailed',
        method: request.method(),
        url: redact(request.url()),
        text: redact(request.failure()?.errorText || 'request failed'),
      });
    });
    page.on('response', response => {
      if (response.status() >= 400 || response.url().includes('/api/skill-runs')) {
        networkEntries.push({
          at: new Date().toISOString(),
          type: 'response',
          method: response.request().method(),
          status: response.status(),
          url: redact(response.url()),
        });
      }
    });
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    let fixture: BriefToVideoFixture | undefined;
    let fixtureError: unknown;
    try {
      fixture = await setupFixture(page, testInfo, directory);
      await useFixture(fixture);
    } catch (error) {
      fixtureError = error;
      throw error;
    } finally {
      const artifactErrors: string[] = [];
      await writeFile(join(directory, 'console.json'), JSON.stringify(consoleEntries, null, 2), 'utf8');
      await writeFile(join(directory, 'network.json'), JSON.stringify(networkEntries, null, 2), 'utf8');
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
      try {
        await page.context().close();
        if (!video) throw new Error('Playwright video was not created');
        await copyFile(await video.path(), join(directory, 'video.webm'));
      } catch (error) {
        artifactErrors.push(`video: ${error instanceof Error ? error.message : String(error)}`);
      }
      const artifactNames = ['console.json', 'network.json', 'final.png', 'trace.zip', 'video.webm', 'machine-evidence.json'];
      const files = await Promise.all(artifactNames.map(async name => {
        const body = await readFile(join(directory, name)).catch(() => undefined);
        return body
          ? { name, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
          : { name, missing: true };
      }));
      await writeFile(join(directory, 'evidence-manifest.json'), JSON.stringify({
        schemaVersion: 2,
        evidenceKind: 'controlled-local-playwright',
        cloudVerified: false,
        supplierVerified: false,
        candidateSha: candidateSha(),
        candidateProvenance: candidateProvenance(),
        project: testInfo.project.name,
        status: fixtureError ? 'failed' : testInfo.status,
        artifactErrors,
        files,
      }, null, 2), 'utf8');
      if (fixture) await fixture.dispose().catch(() => undefined);
      if (!fixtureError && testInfo.status === 'passed' && artifactErrors.length > 0) {
        throw new Error(`Brief-to-video evidence artifacts are incomplete: ${artifactErrors.join('; ')}`);
      }
    }
  }, { auto: true }],
});

export { expect };

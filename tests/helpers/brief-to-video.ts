import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';

import { expect, test as base, type APIResponse, type Page, type TestInfo } from '@playwright/test';
import { Pool } from 'pg';

import {
  ensureStage4Session,
  openStage4CanvasProject,
  seedStage4Baseline,
  seedStage4RuntimeDependencies,
  stage4FixtureForProject,
} from './stage-4-e2e';

const SKILL_ID = 'preset-brief-to-video-film';
const VIDEO_PROVIDER_ID = 'brief-video-e2e-provider';
const VIDEO_MODEL_ID = 'brief-video-e2e-model';
const ORCHESTRATOR_PROVIDER_ID = 'stage4-chat-provider';
const ORCHESTRATOR_MODEL_ID = 'stage4-chat-model';

type Surface = 'canvas' | 'workflow' | 'simple-chat';
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
  createRun(surface: Surface, mode: VideoMode): Promise<ApprovalIdentity>;
  readRunStatus(runId: string): Promise<string>;
  revise(runId: string): Promise<ApprovalIdentity>;
  approve(identity: ApprovalIdentity): Promise<void>;
  cancel(runId: string): Promise<void>;
  videoSubmissions(): ProviderSubmission[];
  createWorkflowRun(): Promise<{ runId: string; status: string; downstreamDispatched: boolean }>;
  verifySimpleChatIntentAndCatalog(): Promise<{
    catalogCount: number;
    catalogContainsBriefToVideo: boolean;
    intentRunId: string;
  }>;
  assertMobileApprovalControls(): Promise<void>;
  writeMachineEvidence(ids: Record<string, string>): Promise<void>;
  dispose(): Promise<void>;
}

function safe(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

function commitIdentity(): string {
  return safe(process.env.BRIEF_TO_VIDEO_EVIDENCE_COMMIT || process.env.GITHUB_SHA || 'working-tree');
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
        response.end(JSON.stringify({ task_id: `local-video-${submissions.length}`, status: 'processing' }));
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
  const runRequest = async (surface: Surface, mode: VideoMode): Promise<ApprovalIdentity> => {
    const withStart = mode !== 'text-to-video';
    const withEnd = mode === 'first-last-frame';
    const response = await page.request.post('/api/skill-runs', {
      data: {
        skillId: SKILL_ID,
        skillVersion: 1,
        surface,
        projectId,
        workspaceId: `${surface}:${projectId}`,
        inputValues: {
          brief: `${mode} 通勤防晒产品短片`,
          goal: '产品转化',
          audience: '都市通勤人群',
          platform: '抖音',
          style: '电影感、主体清晰、运动自然',
          durationSeconds: '5',
          aspectRatio: '9:16',
          resolution: '1080p',
          ...(withStart ? { startFrame: sourceVersionId } : {}),
          ...(withEnd ? { endFrame: sourceVersionId } : {}),
          generateAudio: false,
        },
        sourceVersionIds: withStart ? [sourceVersionId] : [],
        modelBindings: {
          orchestrator: { providerId: ORCHESTRATOR_PROVIDER_ID, modelId: ORCHESTRATOR_MODEL_ID },
          video: { providerId: VIDEO_PROVIDER_ID, modelId: VIDEO_MODEL_ID },
        },
        idempotencyKey: `brief-video-e2e:${testInfo.project.name}:${surface}:${mode}:${randomUUID()}`,
      },
    });
    const payload = await json(response);
    expect(response.ok(), `create Skill Run returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
    expect(payload.runId).toEqual(expect.any(String));
    return waitForApproval(page, String(payload.runId));
  };

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
    await page.locator('[data-canvas-image-id]').first().click();
    const expand = page.getByRole('button', { name: '展开面板', exact: true });
    if (await expand.isVisible().catch(() => false)) await expand.click();
    await page.getByRole('button', { name: 'AI聊天', exact: true }).click();
    await page.getByRole('button', { name: 'Skills技能库' }).click();
    await page.getByPlaceholder('搜索 Skills...').fill('Brief 到视频');
  };

  return {
    projectId,
    videoProviderId: VIDEO_PROVIDER_ID,
    videoModelId: VIDEO_MODEL_ID,
    openCanvas,
    createRun: runRequest,
    async readRunStatus(runId) {
      return (await readRun(page, runId)).status;
    },
    async revise(runId) {
      const current = await waitForApproval(page, runId);
      const response = await page.request.patch(`/api/skill-runs/${encodeURIComponent(runId)}`, {
        data: {
          action: 'revise',
          revision: current.revision,
          generation: current.generation,
          planChecksum: current.planChecksum,
          revisionInstruction: '加快节奏',
        },
      });
      const payload = await json(response);
      expect(response.ok(), `revise returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
      await expect.poll(async () => (await readRun(page, runId)).approval?.planChecksum, {
        timeout: 60_000,
        intervals: [100, 250, 500, 1_000],
      }).not.toBe(current.planChecksum);
      return waitForApproval(page, runId);
    },
    async approve(identity) {
      const response = await page.request.patch(`/api/skill-runs/${encodeURIComponent(identity.runId)}`, {
        data: {
          action: 'approve',
          revision: identity.revision,
          generation: identity.generation,
          planChecksum: identity.planChecksum,
        },
      });
      const payload = await json(response);
      expect(response.ok(), `approve returned HTTP ${response.status()}: ${JSON.stringify(payload)}`).toBe(true);
    },
    async cancel(runId) {
      const response = await page.request.patch(`/api/skill-runs/${encodeURIComponent(runId)}`, {
        data: { action: 'cancel' },
      });
      expect(response.ok(), `cancel returned HTTP ${response.status()}`).toBe(true);
    },
    videoSubmissions: () => structuredClone(submissions),
    async createWorkflowRun() {
      const submissionCount = submissions.length;
      const run = await runRequest('workflow', 'text-to-video');
      return {
        runId: run.runId,
        status: (await readRun(page, run.runId)).status,
        downstreamDispatched: submissions.length > submissionCount,
      };
    },
    async verifySimpleChatIntentAndCatalog() {
      const catalogResponse = await page.request.get('/api/skills?surface=simple-chat');
      const catalogPayload = await json(catalogResponse) as { skills?: Array<{ id?: string }> };
      expect(catalogResponse.ok()).toBe(true);
      const skills = catalogPayload.skills ?? [];
      const intentResponse = await page.request.post('/api/simple-chat/chat', {
        headers: { 'idempotency-key': `brief-video-simple-chat:${randomUUID()}` },
        data: {
          messages: [{
            id: 'brief-video-message',
            role: 'user',
            content: `根据 Brief：展示轻薄防晒霜的通勤使用场景，生成最终成片。平台：抖音；时长：5秒；比例：9:16；视频模型：${VIDEO_MODEL_ID}；受众：都市通勤人群；目标：产品转化`,
          }],
          model: ORCHESTRATOR_MODEL_ID,
          providerId: ORCHESTRATOR_PROVIDER_ID,
          projectId: String(fixture.chatProject.id),
          assetProjectId: projectId,
          taskId: `brief-video-chat-${testInfo.project.name}`,
          responseMessageId: `brief-video-response-${testInfo.project.name}`,
          workspaceId: `standalone-chat:${fixture.chatProject.id}`,
          stream: true,
        },
      });
      const text = await intentResponse.text();
      expect(intentResponse.ok(), `Simple Chat intent returned HTTP ${intentResponse.status()}: ${text}`).toBe(true);
      const eventLine = text.split(/\r?\n/u).find(line => line.startsWith('data: '));
      const event = JSON.parse(eventLine?.slice(6) || '{}') as Record<string, unknown>;
      expect(event.type).toBe('brief_to_video');
      return {
        catalogCount: skills.length,
        catalogContainsBriefToVideo: skills.some(skill => skill.id === SKILL_ID),
        intentRunId: String(event.runId || ''),
      };
    },
    async assertMobileApprovalControls() {
      await openCanvas();
      const pendingRuns = await page.request.get(`/api/skill-runs?projectId=${encodeURIComponent(projectId)}&skillId=${SKILL_ID}&surface=canvas&observeOnly=true`);
      const pendingPayload = await json(pendingRuns) as { runs?: RunProjection[] };
      const pending = pendingPayload.runs?.find(run => run.status === 'paused');
      expect(pending?.runId).toEqual(expect.any(String));
      await page.getByText('Brief 到视频成片', { exact: true }).last().click();
      await page.getByRole('button', { name: `查看任务 ${pending!.runId}` }).click();
      const approve = page.getByRole('button', { name: '批准生成' });
      const revise = page.getByRole('button', { name: '修改脚本' });
      const cancel = page.getByRole('button', { name: '取消任务' });
      await expect(approve).toBeVisible({ timeout: 30_000 });
      await expect(revise).toBeVisible({ timeout: 30_000 });
      await expect(cancel).toBeVisible({ timeout: 30_000 });
      for (const control of [approve, revise, cancel]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(40);
        expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      }
    },
    async writeMachineEvidence(ids) {
      const body = {
        schemaVersion: 1,
        evidenceKind: 'controlled-local-playwright',
        cloudVerified: false,
        supplierVerified: false,
        commit: commitIdentity(),
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
        schemaVersion: 1,
        evidenceKind: 'controlled-local-playwright',
        cloudVerified: false,
        supplierVerified: false,
        commit: commitIdentity(),
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

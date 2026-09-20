import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';

import {
  ensureStage4Session,
  expect,
  openStage4CanvasProject,
  openStage4ChatProject,
  seedStage4Baseline,
  seedStage4RuntimeDependencies,
  stage4FixtureForProject,
  test,
  writeStage4Metrics,
} from '../helpers/stage-4-e2e';
import {
  assertWorkflowVirtualizationCoverage,
  assertWorkflowPerformanceThresholds,
  measureWorkflowInteraction,
  resolveExpectedMountedWorkflowNodeIds,
  selectWorkflowMonitorIds,
  shouldEnforceWorkflowFpsGate,
} from '../helpers/workflow-performance';
import { dragPointerAcrossFrames } from '../helpers/canvas-performance';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.use({ trace: 'off', video: 'on' });

let providerServer: Server | undefined;
let providerBaseUrl = '';
let evidencePool: Pool | undefined;
const providerSockets = new Set<Socket>();
const sourceImageUrls = new Map<string, string>();
const providerCounts = new Map<string, {
  ordinary: number;
  visionMain: number;
  visionProvider: number;
  agent: number;
  workspaceVision: number;
  imageGeneration: number;
}>();
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
type Stage4ExpectedAgentMode = 'legacy' | 'shadow' | 'agent-v2';
type Stage4ExpectedWorkflowRendererMode = 'legacy' | 'shadow' | 'react-flow-v2';

function requiredExpectedAgentMode(): Stage4ExpectedAgentMode {
  const mode = process.env.E2E_STAGE4_EXPECTED_AGENT_MODE?.trim();
  if (mode === 'legacy' || mode === 'shadow' || mode === 'agent-v2') return mode;
  throw new Error('BLOCKED: E2E_STAGE4_EXPECTED_AGENT_MODE must be legacy, shadow, or agent-v2');
}

const expectedAgentMode = requiredExpectedAgentMode();

function requiredExpectedWorkflowRendererMode(): Stage4ExpectedWorkflowRendererMode {
  const mode = process.env.E2E_STAGE4_EXPECTED_WORKFLOW_RENDERER_MODE?.trim();
  if (mode === 'legacy' || mode === 'shadow' || mode === 'react-flow-v2') return mode;
  throw new Error('BLOCKED: E2E_STAGE4_EXPECTED_WORKFLOW_RENDERER_MODE must be legacy, shadow, or react-flow-v2');
}

const expectedWorkflowRendererMode = requiredExpectedWorkflowRendererMode();

function counts(profile: string) {
  const existing = providerCounts.get(profile);
  if (existing) return existing;
  const created = {
    ordinary: 0,
    visionMain: 0,
    visionProvider: 0,
    agent: 0,
    workspaceVision: 0,
    imageGeneration: 0,
  };
  providerCounts.set(profile, created);
  return created;
}

function bindControlledSourceImage(
  fixture: Awaited<ReturnType<typeof stage4FixtureForProject>>,
  source: { selectedEntityId: string; canonicalUrl: string },
): void {
  const canvasProject = fixture.canvasProject as { canvasImages?: Array<{ id?: unknown; url?: unknown }> };
  const image = canvasProject.canvasImages?.find(candidate => candidate.id === source.selectedEntityId);
  if (!image) throw new Error(`Controlled Stage 4 source image ${source.selectedEntityId} is missing`);
  image.url = source.canonicalUrl;
}

function sse(response: import('node:http').ServerResponse, chunks: Record<string, unknown>[]): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  chunks.forEach(chunk => response.write(`data: ${JSON.stringify(chunk)}\n\n`));
  response.end('data: [DONE]\n\n');
}

test.beforeAll(async () => {
  const databaseUrl = process.env.E2E_STAGE4_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('BLOCKED: E2E_STAGE4_DATABASE_URL is required');
  evidencePool = new Pool({ connectionString: databaseUrl });
  const server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const serialized = JSON.stringify(body);
      const profile = serialized.match(/E2E_PROFILE:([a-z0-9-]+)/)?.[1] || 'unknown';
      const current = counts(profile);
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      if (pathname.endsWith('/images/generations')) {
        current.imageGeneration += 1;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_BASE64 }] }));
        return;
      }
      if (serialized.includes('WORKSPACE_CHAIN_E2E')) {
        const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
        const hasImageContent = messages.some(message => (
          Array.isArray(message.content)
          && message.content.some(part => (
            part && typeof part === 'object' && (part as Record<string, unknown>).type === 'image_url'
          ))
        ));
        if (!hasImageContent) {
          response.writeHead(422, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'workspace chain requires uploaded image context' }));
          return;
        }
        current.workspaceVision += 1;
        sse(response, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'workspace-chain-generate', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: `WORKSPACE_CHAIN_E2E E2E_PROFILE:${profile}`, size: '1024x1024' }) } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]);
        return;
      }
      if (serialized.includes('AGENT_CANCEL_E2E')) {
        current.agent += 1;
        setTimeout(() => {
          if (response.destroyed) return;
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'cancelled work returned late' }, finish_reason: 'stop' }],
          }));
        }, 60_000).unref();
        return;
      }
      if (serialized.includes('VISION_FAILURE_E2E')) {
        const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
        const hasImageContent = messages.some(message => (
          Array.isArray(message.content)
          && message.content.some(part => (
            part && typeof part === 'object' && (part as Record<string, unknown>).type === 'image_url'
          ))
        ));
        if (hasImageContent) {
          current.visionProvider += 1;
          response.writeHead(502, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'controlled vision failure' }));
          return;
        }
        current.visionMain += 1;
        if (current.visionMain > 1) {
          sse(response, [{ choices: [{ delta: { content: 'CONTROLLED_CONTINUATION_SHOULD_NOT_EXIST' }, finish_reason: 'stop' }] }]);
          return;
        }
        const sourceImageUrl = sourceImageUrls.get(profile);
        if (!sourceImageUrl) {
          response.writeHead(500, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: `missing controlled source image for ${profile}` }));
          return;
        }
        sse(response, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'vision-tool-1', type: 'function', function: { name: 'analyze_image', arguments: JSON.stringify({ image_url: sourceImageUrl, question: `VISION_FAILURE_E2E E2E_PROFILE:${profile}` }) } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]);
        return;
      }
      current.ordinary += 1;
      sse(response, [{ choices: [{ delta: { content: 'Controlled ordinary chat completion' }, finish_reason: 'stop' }] }]);
    });
  });
  providerServer = server;
  server.on('connection', socket => {
    providerSockets.add(socket);
    socket.on('close', () => providerSockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  providerBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  providerSockets.forEach(socket => socket.destroy());
  if (providerServer) {
    await new Promise<void>(resolve => providerServer?.close(() => resolve()));
  }
  if (evidencePool) await evidencePool.end();
});

async function sampleRawFps(page: Page, durationMs = 1_000): Promise<number> {
  return page.evaluate(ms => new Promise<number>(resolve => {
    const frames: number[] = [];
    const tick = (timestamp: number) => {
      frames.push(timestamp);
      if (frames.length > 1 && timestamp - frames[0] >= ms) {
        resolve(((frames.length - 1) * 1000) / (timestamp - frames[0]));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), durationMs);
}

test('executes ordinary chat, vision stop, agent cancel, and refresh recovery', async ({ page, stage4Evidence }, testInfo) => {
  await writeStage4Metrics(stage4Evidence, testInfo, 'agent-runtime-mode', {
    expectedAgentMode,
  });
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  providerCounts.delete(fixture.browserProfile);
  const auth = await ensureStage4Session(page, fixture);
  const asset = await seedStage4RuntimeDependencies({
    auth,
    fixture,
    page,
    providerBaseUrl: `${providerBaseUrl}/v1`,
  });
  bindControlledSourceImage(fixture, asset);
  await seedStage4Baseline(page, fixture, auth);
  sourceImageUrls.set(fixture.browserProfile, asset.canonicalUrl);

  await openStage4ChatProject(page, String(fixture.chatProject.id));
  const measuredCeilingFps = await sampleRawFps(page);
  const chatInput = page.getByPlaceholder(/输入消息/);
  await chatInput.fill(`ORDINARY_CHAT_E2E E2E_PROFILE:${fixture.browserProfile}`);
  await chatInput.press('Enter');
  await expect(page.getByText('Controlled ordinary chat completion', { exact: true }))
    .toBeVisible({ timeout: 20_000 });
  const rawAverageFps = await sampleRawFps(page);
  await writeStage4Metrics(stage4Evidence, testInfo, 'browser-frame-rate', {
    rawAverageFps: Number(rawAverageFps.toFixed(2)),
    measuredCeilingFps: Number(measuredCeilingFps.toFixed(2)),
    thresholdStatus: 'UNVERIFIED',
  });

  const vision = await page.evaluate(async input => {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    return { status: response.status, text: await response.text() };
  }, {
    model: 'stage4-gemini-vision-model', providerId: 'stage4-chat-provider',
    messages: [{ role: 'user', content: `VISION_FAILURE_E2E E2E_PROFILE:${fixture.browserProfile}` }],
    stream: true, enableTools: true, agentTools: ['analyze_image'], isAgentMode: true,
    projectId: String(fixture.canvasProject.id),
    sessionId: `stage4-session-${fixture.browserProfile}`,
    messageId: `stage4-vision-message-${fixture.browserProfile}`,
    sourceVersionIds: [asset.sourceVersionId], selectedEntityIds: [asset.selectedEntityId],
  });
  expect(vision.status).toBe(200);
  expect(vision.text).toContain('"success":false');
  expect(vision.text).not.toContain('CONTROLLED_CONTINUATION_SHOULD_NOT_EXIST');
  expect(counts(fixture.browserProfile), vision.text).toMatchObject({ ordinary: 1, visionMain: 1, visionProvider: 1 });

  await page.evaluate(() => localStorage.setItem('wujie_selected_model', JSON.stringify({
    model: 'stage4-image-model', providerId: 'stage4-image-provider',
  })));
  await openStage4CanvasProject(page, String(fixture.canvasProject.id));
  const runStorageKey = `wujie_agent_run:${fixture.canvasProject.id}:${asset.selectedEntityId}`;
  const openAgentEditor = async () => {
    const canvasImage = page.locator(`[data-canvas-image-id="${asset.selectedEntityId}"]`);
    await expect(canvasImage).toBeVisible({ timeout: 20_000 });
    await canvasImage.click({ force: true });
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      const mobileActions = page.locator('[data-mobile-image-actions]');
      await expect(mobileActions).toBeVisible({ timeout: 10_000 });
      await mobileActions.getByRole('button', { name: '更多', exact: true }).click();
      await page.getByRole('dialog', { name: '图片工具' })
        .getByRole('button', { name: 'Agent编排', exact: true }).click();
      await expect(page.getByText('Agent 编排', { exact: true })).toBeVisible({ timeout: 20_000 });
      return;
    }
    const imageToolbar = page.locator('[data-toolbar="image-action-toolbar"]');
    await expect(imageToolbar).toBeVisible({ timeout: 10_000 });
    await imageToolbar.getByTitle('展开更多工具').click();
    await page.locator('[data-image-toolbar-overflow]')
      .getByRole('button', { name: 'Agent编排', exact: true }).click();
    await expect(page.getByText('Agent 编排', { exact: true })).toBeVisible({ timeout: 20_000 });
  };
  await openAgentEditor();
  if (expectedAgentMode === 'shadow') {
    await page.evaluate(key => localStorage.setItem(key, 'stale-agent-v2-run-before-shadow-rollback'), runStorageKey);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), runStorageKey))
      .toBe('stale-agent-v2-run-before-shadow-rollback');
  }
  await page.getByPlaceholder(/描述你想要的编辑效果/)
    .fill(`AGENT_CANCEL_E2E E2E_PROFILE:${fixture.browserProfile}`);
  const agentSubmissionResponse = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/agent-edit'
  ));
  await page.getByRole('button', { name: '执行', exact: true }).click();
  const submissionResponse = await agentSubmissionResponse;
  expect(submissionResponse.ok()).toBeTruthy();
  const submission = await submissionResponse.json() as { taskId?: unknown; runId?: unknown };
  expect(typeof submission.taskId).toBe('string');
  const taskId = String(submission.taskId);
  const legacyTaskStorageKey = `wujie_agent_legacy_task:${fixture.canvasProject.id}:${asset.selectedEntityId}`;

  if (expectedAgentMode !== 'agent-v2') {
    expect(submission).not.toHaveProperty('runId');
    await expect(page.getByText(/^Agent round 1:/))
      .toBeVisible({ timeout: 20_000 });
    const cancel = page.getByRole('button', { name: '取消', exact: true });
    await expect(cancel).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '取消任务', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), runStorageKey), { timeout: 20_000 })
      .toBeNull();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), legacyTaskStorageKey), { timeout: 20_000 })
      .toBe(taskId);

    const readShadowTask = () => page.evaluate(async id => {
      const taskResponse = await fetch(`/api/agent-edit?taskId=${encodeURIComponent(id)}`);
      return {
        taskStatus: taskResponse.status,
        task: await taskResponse.json(),
      };
    }, taskId);
    await expect.poll(readShadowTask, { timeout: 20_000 }).toMatchObject({
      taskStatus: 200,
      task: { status: 'processing' },
    });
    const readShadowEvents = async () => {
      const result = await evidencePool!.query<{
        event_id: string;
        event_type: string;
        observed: string | null;
        adopted: string | null;
      }>(
        `SELECT event_id, event_type,
                payload->>'observed' AS observed,
                payload->>'adopted' AS adopted
           FROM wujie_agent_events
          WHERE task_id = $1
          ORDER BY sequence ASC`,
        [taskId],
      );
      return result.rows;
    };
    const expectedShadowEvents = [
      {
        event_id: `legacy-observer:${taskId}:created`,
        event_type: 'run.created',
        observed: 'true',
        adopted: null,
      },
      {
        event_id: `legacy-observer:${taskId}:plan`,
        event_type: 'plan.updated',
        observed: 'true',
        adopted: null,
      },
    ];
    if (expectedAgentMode === 'shadow') {
      await expect.poll(readShadowEvents, { timeout: 20_000 }).toEqual(expectedShadowEvents);
    }

    const cancelResponse = page.waitForResponse(response => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/agent-edit'
      && new URL(response.url()).searchParams.get('taskId') === taskId
      && new URL(response.url()).searchParams.get('action') === 'cancel'
    ));
    await cancel.click();
    const cancelledResponse = await cancelResponse;
    expect(cancelledResponse.ok()).toBeTruthy();
    await expect(cancelledResponse.json()).resolves.toMatchObject({
      status: 'cancelled', durableTerminal: true,
    });
    await expect(page.getByText('任务已取消', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openAgentEditor();
    await expect(page.getByText('任务已取消', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: '取消任务', exact: true })).toHaveCount(0);
    if (expectedAgentMode === 'shadow') {
      await expect.poll(readShadowEvents, { timeout: 20_000 }).toEqual(expectedShadowEvents);
    }
  } else {
    expect(typeof submission.runId).toBe('string');
    const cancel = page.getByRole('button', { name: '取消任务', exact: true });
    await expect(page.getByText(/正在规划|正在执行|正在排队/)).toBeVisible({ timeout: 20_000 });
    await expect(cancel).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), runStorageKey), { timeout: 20_000 })
      .not.toBeNull();
    const runId = await page.evaluate(key => localStorage.getItem(key), runStorageKey);
    expect(runId).toBe(submission.runId);
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), legacyTaskStorageKey), { timeout: 20_000 })
      .toBeNull();
    await cancel.click();
    await expect(page.getByText('已取消', { exact: true })).toBeVisible({ timeout: 20_000 });
    const durable = await page.evaluate(async id => {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(id)}`);
      return response.json();
    }, runId!);
    expect(durable.projection).toMatchObject({ status: 'cancelled' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openAgentEditor();
    await expect(page.getByText('已取消', { exact: true })).toBeVisible({ timeout: 20_000 });
  }
  expect(counts(fixture.browserProfile).agent).toBe(1);
});

test('completes chat to canvas to workflow to chat with durable lineage and refresh recovery', async ({ page, stage4Evidence }, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  providerCounts.delete(fixture.browserProfile);
  const auth = await ensureStage4Session(page, fixture);
  const chainFixture = structuredClone(fixture);
  const chainMetadata = chainFixture.canvasProject.metadata as Record<string, unknown>;
  chainFixture.canvasProject.metadata = {
    ...chainMetadata,
    workflow: {
      ...chainFixture.workflow,
      nodes: [],
      connections: [],
      name: `Stage 4 UI chain ${fixture.browserProfile}`,
    },
  };
  const asset = await seedStage4RuntimeDependencies({
    auth,
    fixture: chainFixture,
    page,
    providerBaseUrl: `${providerBaseUrl}/v1`,
  });
  bindControlledSourceImage(chainFixture, asset);
  await seedStage4Baseline(page, chainFixture, auth);
  const canvasProjectId = String(fixture.canvasProject.id);
  const chatProjectId = String(fixture.chatProject.id);

  await openStage4ChatProject(page, chatProjectId);
  await page.getByRole('combobox', { name: '目标画布项目' }).selectOption(canvasProjectId);
  const upload = await page.request.get('/logo.png');
  expect(upload.ok()).toBe(true);
  await page.locator('#chat-file-upload').setInputFiles({
    name: 'stage-4-workspace-chain.png',
    mimeType: 'image/png',
    buffer: await upload.body(),
  });
  await expect(page.locator('img[alt=""]').last()).toBeVisible({ timeout: 20_000 });
  const chatInput = page.getByPlaceholder(/输入消息/);
  await chatInput.fill(`WORKSPACE_CHAIN_E2E E2E_PROFILE:${fixture.browserProfile}`);
  await chatInput.press('Enter');
  await expect.poll(() => counts(fixture.browserProfile).workspaceVision, { timeout: 20_000 }).toBe(1);
  await expect(page.getByText('图片已生成', { exact: true })).toBeVisible({ timeout: 90_000 });
  expect(counts(fixture.browserProfile).imageGeneration).toBe(1);
  const addToCanvas = page.getByTitle('添加到画布').last();
  await expect(addToCanvas).toBeAttached();
  await addToCanvas.click({ force: true });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wujie_canvas_bridge')), {
    timeout: 20_000,
  }).not.toBeNull();

  type GeneratedTask = {
    id: string;
    status: string;
    asset_version_id: string;
  };
  const readGeneratedTask = async (): Promise<GeneratedTask | null> => {
    const task = await evidencePool!.query<{
      id: string;
      status: string;
      asset_version_id: string | null;
    }>(
      `SELECT task.id, task.status, version.id AS asset_version_id
         FROM cloud_tasks task
         LEFT JOIN wujie_asset_versions version ON version.task_id = task.id
        WHERE task.user_id = $1 AND task.project_id = $2
          AND task.type IN ('generate', 'generate-async')
        ORDER BY task.created_at DESC
        LIMIT 1`,
      [auth.userId, canvasProjectId],
    );
    const row = task.rows[0];
    return row?.asset_version_id
      ? { ...row, asset_version_id: row.asset_version_id }
      : null;
  };
  await expect.poll(readGeneratedTask, { timeout: 30_000 })
    .toMatchObject({ status: 'completed', asset_version_id: expect.any(String) });
  const generatedTask = await readGeneratedTask();
  if (!generatedTask) throw new Error('Generated task did not expose a projected AssetVersion');

  type CanvasReference = {
    id: string;
    entity_id: string;
    asset_version_id: string;
  };
  const readCanvasReference = async (): Promise<CanvasReference | null> => {
    const result = await evidencePool!.query<{
      id: string;
      entity_id: string;
      asset_version_id: string;
    }>(
      `SELECT id, entity_id, asset_version_id
         FROM wujie_workspace_placements
        WHERE owner_id = $1 AND project_id = $2 AND workspace_kind = 'canvas'
          AND asset_version_id = $3 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1`,
      [auth.userId, canvasProjectId, generatedTask.asset_version_id],
    );
    return result.rows[0] || null;
  };
  await expect.poll(readCanvasReference, { timeout: 20_000 })
    .toMatchObject({ asset_version_id: generatedTask.asset_version_id });
  const canvasReference = await readCanvasReference();
  if (!canvasReference) throw new Error('Canvas transfer did not create a placement');

  await openStage4CanvasProject(page, canvasProjectId);
  const generatedCanvasImage = page.locator(`[data-canvas-image-id="${canvasReference.entity_id}"]`);
  await expect(generatedCanvasImage).toBeVisible({ timeout: 30_000 });
  const readPersistedPosition = async () => page.evaluate(async input => {
    const response = await fetch('/api/user-data/sync?key=projects');
    const payload = await response.json() as { value?: Array<Record<string, unknown>> };
    const project = payload.value?.find(item => item.id === input.projectId);
    const images = Array.isArray(project?.canvasImages) ? project.canvasImages as Array<Record<string, unknown>> : [];
    const image = images.find(item => item.id === input.entityId);
    return image && Number.isFinite(Number(image.x)) && Number.isFinite(Number(image.y))
      ? { x: Number(image.x), y: Number(image.y) }
      : null;
  }, { projectId: canvasProjectId, entityId: canvasReference.entity_id });
  await expect.poll(readPersistedPosition, { timeout: 30_000 }).not.toBeNull();
  const initialPosition = await readPersistedPosition();
  if (!initialPosition) throw new Error('Canvas placement position was not persisted');
  const beforeMove = await generatedCanvasImage.boundingBox();
  expect(beforeMove).not.toBeNull();
  await page.mouse.move(beforeMove!.x + beforeMove!.width / 2, beforeMove!.y + beforeMove!.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeMove!.x + beforeMove!.width / 2 + 48, beforeMove!.y + beforeMove!.height / 2 + 32, { steps: 8 });
  await page.mouse.up();
  await expect.poll(readPersistedPosition, { timeout: 30_000 }).not.toEqual(initialPosition);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(generatedCanvasImage).toBeVisible({ timeout: 30_000 });

  await page.getByTitle('节点模式').first().click();
  const expectedSurface = expectedWorkflowRendererMode === 'react-flow-v2'
    ? page.locator('[data-workflow-react-flow-surface]')
    : page.locator('[data-workflow-legacy-surface]');
  await expect(expectedSurface).toBeVisible({ timeout: 30_000 });
  const contentImage = page.locator(`[data-node-canvas-image="${canvasReference.entity_id}"]`);
  await expect(contentImage).toBeVisible({ timeout: 30_000 });
  const workflowTransferResponse = page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/assets/transfer') return false;
    const body = response.request().postDataJSON() as Record<string, unknown> | null;
    return body?.entityType === 'workflow-input' && body?.sourceVersion === generatedTask.asset_version_id;
  });
  const workflowSurfaceBox = await expectedSurface.boundingBox();
  expect(workflowSurfaceBox).not.toBeNull();
  const workflowDropPosition = {
    x: Math.max(24, Math.min(420, workflowSurfaceBox!.width * 0.55)),
    y: Math.max(24, Math.min(260, workflowSurfaceBox!.height * 0.35)),
  };
  if (testInfo.project.name === 'webkit') {
    await page.evaluate(({ imageId, surfaceSelector, dropPosition }) => {
      const source = Array.from(document.querySelectorAll<HTMLElement>('[data-node-canvas-image]'))
        .find(element => element.dataset.nodeCanvasImage === imageId);
      const target = document.querySelector<HTMLElement>(surfaceSelector);
      if (!source || !target) throw new Error('Workflow drag source or target is missing');
      const dataTransfer = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + dropPosition.x,
        clientY: rect.top + dropPosition.y,
      };
      source.dispatchEvent(new DragEvent('dragstart', eventInit));
      target.dispatchEvent(new DragEvent('dragover', eventInit));
      target.dispatchEvent(new DragEvent('drop', eventInit));
      source.dispatchEvent(new DragEvent('dragend', eventInit));
    }, {
      imageId: canvasReference.entity_id,
      surfaceSelector: expectedWorkflowRendererMode === 'react-flow-v2'
        ? '[data-workflow-react-flow-surface]'
        : '[data-workflow-legacy-surface]',
      dropPosition: workflowDropPosition,
    });
  } else {
    await contentImage.dragTo(expectedSurface, {
      sourcePosition: { x: 28, y: 28 },
      targetPosition: workflowDropPosition,
    });
  }
  const workflowTransfer = await workflowTransferResponse;
  expect(workflowTransfer.ok()).toBe(true);
  await expect(workflowTransfer.json()).resolves.toMatchObject({
    assetVersionId: generatedTask.asset_version_id,
    placementId: expect.any(String),
  });
  const isMobileViewport = (page.viewportSize()?.width ?? 1280) < 768;
  const inputNode = page.locator('[data-node-id]').filter({ hasText: '图片输入' }).last();
  await expect(inputNode).toBeVisible({ timeout: 20_000 });
  if (isMobileViewport) {
    await expect(inputNode).toHaveClass(/selected/);
  } else {
    await inputNode.click({ position: { x: 48, y: 20 } });
  }
  const outputNodeType = page.locator('[data-node-type="output-image"]');
  if (await outputNodeType.count() === 0) {
    await page.getByRole('button', { name: '切换节点库面板', exact: true }).click();
  }
  if (isMobileViewport) {
    await outputNodeType.click({ position: { x: 16, y: 20 } });
  } else {
    await outputNodeType.click();
  }
  const outputNode = page.locator('[data-node-id]').filter({ hasText: '图片输出' }).last();
  await expect(outputNode).toBeVisible({ timeout: 20_000 });

  const workflowStartedResponse = page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/workflow/execute') return false;
    const body = response.request().postDataJSON() as Record<string, unknown> | null;
    return body?.action === 'start';
  });
  await page.getByRole('button', { name: '执行工作流', exact: true }).click();
  const workflowStarted = await workflowStartedResponse;
  expect(workflowStarted.ok()).toBe(true);
  const workflowSubmission = await workflowStarted.json() as { executionId?: unknown };
  expect(typeof workflowSubmission.executionId).toBe('string');
  const workflowExecutionId = String(workflowSubmission.executionId);
  const sendToChat = outputNode.getByRole('button', { name: '发送到智能对话', exact: true });
  if (isMobileViewport) {
    const nodeLibraryToggle = page.getByRole('button', { name: '切换节点库面板', exact: true });
    if (await nodeLibraryToggle.getAttribute('aria-pressed') === 'true') {
      await nodeLibraryToggle.click();
    }
    await page.getByRole('button', { name: '关闭节点属性', exact: true }).click();
  }
  await expect(sendToChat).toBeVisible({ timeout: 60_000 });

  const returnedTransferResponse = page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/assets/transfer') return false;
    const body = response.request().postDataJSON() as Record<string, unknown> | null;
    return body?.entityType === 'chat-result'
      && body?.targetWorkspace === `standalone-chat:${chatProjectId}`;
  });
  await sendToChat.click();
  await expect(page).toHaveURL(new RegExp(`/simple-chat\\?`), { timeout: 30_000 });
  const returnedTransfer = await returnedTransferResponse;
  expect(returnedTransfer.ok()).toBe(true);
  const returnedChatReference = await returnedTransfer.json() as {
    assetVersionId?: unknown;
    placementId?: unknown;
  };
  expect(returnedChatReference).toMatchObject({
    assetVersionId: generatedTask.asset_version_id,
    placementId: expect.any(String),
  });
  const returnedPlacementId = String(returnedChatReference.placementId);
  const returnedMessage = page.locator(`[data-chat-asset-placement-ids~="${returnedPlacementId}"]`);
  await expect(returnedMessage).toContainText('工作流结果已返回：图片输出', { timeout: 30_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(returnedMessage).toContainText('工作流结果已返回：图片输出', { timeout: 30_000 });

  const lineage = await evidencePool!.query<{
    workspace_kind: string;
    workspace_id: string;
    entity_id: string;
    source_version_id: string | null;
  }>(
    `SELECT workspace_kind, workspace_id, entity_id, source_version_id
       FROM wujie_workspace_placements
      WHERE owner_id = $1 AND project_id = $2 AND asset_version_id = $3 AND status = 'active'
      ORDER BY created_at, id`,
    [auth.userId, canvasProjectId, generatedTask.asset_version_id],
  );
  expect(lineage.rows.map(row => row.workspace_kind)).toEqual(['chat', 'canvas', 'workflow', 'canvas', 'chat']);
  expect(lineage.rows.every(row => row.source_version_id === generatedTask.asset_version_id)).toBe(true);
  const workflowTask = await evidencePool!.query<{ status: string }>(
    'SELECT status FROM cloud_tasks WHERE id = $1 AND user_id = $2',
    [workflowExecutionId, auth.userId],
  );
  expect(generatedTask.status).toBe('completed');
  expect(workflowTask.rows[0]?.status).toBe('completed');
  expect(counts(fixture.browserProfile)).toMatchObject({ workspaceVision: 1, imageGeneration: 1 });
  await writeStage4Metrics(stage4Evidence, testInfo, 'workspace-lineage', {
    generatedTaskId: generatedTask.id,
    generatedAssetVersionId: generatedTask.asset_version_id,
    workflowExecutionId,
    placements: lineage.rows,
  });
});

test('keeps the selected workflow renderer server-authoritative at 100 nodes', async ({ page, stage4Evidence }, testInfo) => {
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  const auth = await ensureStage4Session(page, fixture);
  await seedStage4Baseline(page, fixture, auth);
  await openStage4CanvasProject(page, String(fixture.canvasProject.id));

  await page.getByTitle('节点模式').first().click();
  const legacySurface = page.locator('[data-workflow-legacy-surface]');
  const reactFlowSurface = page.locator('[data-workflow-react-flow-surface]');
  const authoritativeSurface = expectedWorkflowRendererMode === 'react-flow-v2'
    ? reactFlowSurface
    : legacySurface;
  await expect(authoritativeSurface).toBeVisible({ timeout: 20_000 });
  if (expectedWorkflowRendererMode === 'react-flow-v2') {
    await expect(legacySurface).toHaveCount(0);
    await expect(page.locator('[data-workflow-shadow-probe]')).toHaveCount(0);
    await expect(reactFlowSurface).toHaveAttribute('aria-hidden', 'false');
  } else {
    await expect(reactFlowSurface).toHaveCount(0);
  }
  if (expectedWorkflowRendererMode === 'shadow') {
    await expect(page.locator('[data-workflow-shadow-probe]')).toHaveAttribute('data-in-sync', 'true');
  } else if (expectedWorkflowRendererMode !== 'react-flow-v2') {
    await expect(page.locator('[data-workflow-shadow-probe]')).toHaveCount(0);
  }
  if (expectedWorkflowRendererMode !== 'react-flow-v2') {
    await expect(legacySurface).toHaveAttribute('data-domain-node-count', String(fixture.nodeCount));
  }
  const canvasBounds = await page.locator('.canvas-bg').boundingBox();
  expect(canvasBounds).not.toBeNull();
  const expectedMountedNodeIds = resolveExpectedMountedWorkflowNodeIds(
    fixture.workflow.nodes,
    { x: 0, y: 0, zoom: 0.8 },
    { width: canvasBounds!.width, height: canvasBounds!.height },
  );
  const domainNodeIds = expectedWorkflowRendererMode === 'react-flow-v2'
    ? selectWorkflowMonitorIds(fixture.expectedNodeIds)
    : selectWorkflowMonitorIds(
        ((await legacySurface.getAttribute('data-domain-node-ids')) ?? '').split(' '),
      );
  const mountedNodeIds = selectWorkflowMonitorIds(await page.locator('[data-node-id]').evaluateAll(nodes => (
    nodes.map(node => (node as HTMLElement).dataset.nodeId ?? null)
  )));
  assertWorkflowVirtualizationCoverage({
    domainNodeIds,
    expectedDomainNodeIds: fixture.expectedNodeIds,
    mountedNodeIds,
    expectedMountedNodeIds,
  });

  if (testInfo.project.name === 'chromium') {
    const faultNodeId = await page.evaluate(nodeIds => {
      const canvas = document.querySelector<HTMLElement>('.canvas-bg');
      if (!canvas) return null;
      const canvasBounds = canvas.getBoundingClientRect();
      return nodeIds.filter(id => {
        const node = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
        if (!node) return false;
        const bounds = node.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        if (
          centerX < canvasBounds.left
          || centerY < canvasBounds.top
          || centerX > canvasBounds.right
          || centerY > canvasBounds.bottom
        ) return false;
        const hit = document.elementFromPoint(centerX, centerY);
        return hit !== null && (hit === node || node.contains(hit));
      }).at(-1) ?? null;
    }, expectedMountedNodeIds);
    expect(faultNodeId).not.toBeNull();
    expect(expectedMountedNodeIds.indexOf(faultNodeId!)).toBeGreaterThan(8);
    const faultNode = page.locator(`[data-node-id="${faultNodeId}"]`);
    const faultBounds = await faultNode.boundingBox();
    const faultHeaderBounds = await faultNode.locator('.node-header').boundingBox();
    expect(faultBounds).not.toBeNull();
    expect(faultHeaderBounds).not.toBeNull();
    const faultMetrics = await measureWorkflowInteraction(
      page,
      expectedMountedNodeIds,
      async measuredPage => {
        await measuredPage.mouse.move(faultHeaderBounds!.x + 24, faultHeaderBounds!.y + 16);
        await measuredPage.mouse.down();
        const activePointerNodeId = await measuredPage.evaluate(() => (
          (window as typeof window & {
            __wujieStage4WorkflowPerformance?: { activePointerNodeId?: string | null };
          }).__wujieStage4WorkflowPerformance?.activePointerNodeId ?? null
        ));
        expect(activePointerNodeId).toBe(faultNodeId);
        const alternateNodeId = expectedMountedNodeIds.find(id => id !== faultNodeId)!;
        await measuredPage.locator(`[data-node-id="${alternateNodeId}"]`).dispatchEvent('pointermove', {
          bubbles: true,
          buttons: 1,
          pointerId: 1,
        });
        const latchedPointerNodeId = await measuredPage.evaluate(() => (
          (window as typeof window & {
            __wujieStage4WorkflowPerformance?: { activePointerNodeId?: string | null };
          }).__wujieStage4WorkflowPerformance?.activePointerNodeId ?? null
        ));
        expect(latchedPointerNodeId).toBe(faultNodeId);
        await measuredPage.evaluate(bounds => {
          const overlay = document.createElement('div');
          overlay.dataset.stage4TransientOcclusion = 'true';
          Object.assign(overlay.style, {
            position: 'fixed',
            left: `${bounds.x}px`,
            top: `${bounds.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            zIndex: '2147483647',
            pointerEvents: 'auto',
          });
          document.body.appendChild(overlay);
        }, faultBounds!);
        const hitTransientOcclusion = await measuredPage.evaluate(bounds => (
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            ?.closest('[data-stage4-transient-occlusion]') !== null
        ), faultBounds!);
        expect(hitTransientOcclusion).toBe(true);
        await measuredPage.evaluate(() => new Promise<void>(resolve => {
          requestAnimationFrame(() => resolve());
        }));
        await measuredPage.locator('[data-stage4-transient-occlusion]').evaluate(node => node.remove());
        await measuredPage.mouse.up();
      },
      raw => writeStage4Metrics(stage4Evidence, testInfo, 'workflow-monitor-transient-occlusion-raw', raw),
    );
    await writeStage4Metrics(
      stage4Evidence,
      testInfo,
      'workflow-monitor-transient-occlusion',
      faultMetrics,
    );
    expect(faultMetrics.unclickableDurationMs).toBeGreaterThan(0);
  }

  const firstNode = page.locator(`[data-node-id="${expectedMountedNodeIds[0]}"]`);
  const before = await firstNode.boundingBox();
  expect(before).not.toBeNull();
  const metrics = await measureWorkflowInteraction(
    page,
    expectedMountedNodeIds,
    async measuredPage => {
      const measuredNode = measuredPage.locator(`[data-node-id="${expectedMountedNodeIds[0]}"]`);
      const measuredHeader = measuredNode.locator('.node-header');
      const headerBounds = await measuredHeader.boundingBox();
      expect(headerBounds).not.toBeNull();
      const start = { x: headerBounds!.x + 24, y: headerBounds!.y + 16 };
      await dragPointerAcrossFrames(measuredPage, start, { x: start.x + 16, y: start.y }, 60);
    },
    raw => writeStage4Metrics(stage4Evidence, testInfo, `workflow-${expectedWorkflowRendererMode}-100-node-performance-raw`, raw),
  );
  const after = await firstNode.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).not.toBe(before!.x);
  await writeStage4Metrics(stage4Evidence, testInfo, `workflow-${expectedWorkflowRendererMode}-100-node-performance`, metrics);
  assertWorkflowPerformanceThresholds(metrics, {
    enforceFps: shouldEnforceWorkflowFpsGate(testInfo.project.name),
  });
  expect(metrics.monitoredNodeCount).toBe(expectedMountedNodeIds.length);
  expect(metrics.lostNodeCount).toBe(0);
  expect(metrics.unclickableDurationMs).toBe(0);
});

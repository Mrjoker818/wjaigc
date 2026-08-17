import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Page } from '@playwright/test';

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

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.use({ trace: 'off', video: 'on' });

let providerServer: Server;
let providerBaseUrl = '';
const providerSockets = new Set<Socket>();
const providerCounts = new Map<string, { ordinary: number; visionMain: number; visionProvider: number; agent: number }>();

function counts(profile: string) {
  const existing = providerCounts.get(profile);
  if (existing) return existing;
  const created = { ordinary: 0, visionMain: 0, visionProvider: 0, agent: 0 };
  providerCounts.set(profile, created);
  return created;
}

function sse(response: import('node:http').ServerResponse, chunks: Record<string, unknown>[]): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  chunks.forEach(chunk => response.write(`data: ${JSON.stringify(chunk)}\n\n`));
  response.end('data: [DONE]\n\n');
}

test.beforeAll(async () => {
  providerServer = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const serialized = JSON.stringify(body);
      const profile = serialized.match(/E2E_PROFILE:([a-z0-9-]+)/)?.[1] || 'unknown';
      const current = counts(profile);
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
        sse(response, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'vision-tool-1', type: 'function', function: { name: 'analyze_image', arguments: JSON.stringify({ image_url: '/logo.png', question: `VISION_FAILURE_E2E E2E_PROFILE:${profile}` }) } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ]);
        return;
      }
      current.ordinary += 1;
      sse(response, [{ choices: [{ delta: { content: 'Controlled ordinary chat completion' }, finish_reason: 'stop' }] }]);
    });
  });
  providerServer.on('connection', socket => {
    providerSockets.add(socket);
    socket.on('close', () => providerSockets.delete(socket));
  });
  await new Promise<void>(resolve => providerServer.listen(0, '127.0.0.1', resolve));
  providerBaseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  providerSockets.forEach(socket => socket.destroy());
  await new Promise<void>(resolve => providerServer.close(() => resolve()));
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
  const fixture = await stage4FixtureForProject(testInfo.project.name);
  providerCounts.delete(fixture.browserProfile);
  const auth = await ensureStage4Session(page, fixture);
  await seedStage4Baseline(page, fixture, auth);
  const asset = await seedStage4RuntimeDependencies({ auth, fixture, providerBaseUrl: `${providerBaseUrl}/v1` });

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

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('wujie_selected_model', JSON.stringify({
    model: 'stage4-image-model', providerId: 'stage4-image-provider',
  })));
  await openStage4CanvasProject(page, String(fixture.canvasProject.id));
  const openAgentEditor = async () => {
    const canvasImage = page.locator(`[data-canvas-image-id="${asset.selectedEntityId}"]`);
    await expect(canvasImage).toBeVisible({ timeout: 20_000 });
    await canvasImage.click({ force: true });
    const imageToolbar = page.locator('[data-toolbar="image-action-toolbar"]');
    await expect(imageToolbar).toBeVisible({ timeout: 10_000 });
    await imageToolbar.getByTitle('展开更多工具').click();
    await page.locator('[data-image-toolbar-overflow]')
      .getByRole('button', { name: 'Agent编排', exact: true }).click();
    await expect(page.getByText('Agent 编排', { exact: true })).toBeVisible({ timeout: 20_000 });
  };
  await openAgentEditor();
  await page.getByPlaceholder(/描述你想要的编辑效果/)
    .fill(`AGENT_CANCEL_E2E E2E_PROFILE:${fixture.browserProfile}`);
  await page.getByRole('button', { name: '执行', exact: true }).click();
  await expect(page.getByText(/正在规划|正在执行|正在排队/)).toBeVisible({ timeout: 20_000 });
  const cancel = page.getByRole('button', { name: '取消任务', exact: true });
  await expect(cancel).toBeVisible({ timeout: 20_000 });
  const runStorageKey = `wujie_agent_run:${fixture.canvasProject.id}:${asset.selectedEntityId}`;
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), runStorageKey), { timeout: 20_000 })
    .not.toBeNull();
  const runId = await page.evaluate(key => localStorage.getItem(key), runStorageKey);
  expect(runId).toBeTruthy();
  await cancel.click();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible({ timeout: 20_000 });
  const durable = await page.evaluate(async id => {
    const response = await fetch(`/api/agent-runs/${encodeURIComponent(id!)}`);
    return response.json();
  }, runId);
  expect(durable.projection).toMatchObject({ status: 'cancelled' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openAgentEditor();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(counts(fixture.browserProfile).agent).toBe(1);
});

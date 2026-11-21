import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Page } from '@playwright/test';
import { Pool } from 'pg';

import { SimpleChatSseDecoder } from '../../src/lib/simple-chat-sse';
import type { RegisteredWorkspaceAssetReference } from '../../src/lib/asset-core/types';
import type { CanvasBridgeJournal } from '../../src/lib/simple-chat-canvas-bridge';
import type { CanvasDocumentProjection } from '../../src/lib/collaboration/canvas-document';
import type { DocumentAssetCommandResult } from '../../src/lib/collaboration/canvas-asset-command';
import type { CanvasImage } from '../../src/lib/user-types';
import { buildSimpleChatCanvasTransferIdentity } from '../../src/lib/simple-chat-workspace-handoff-client';
import {
  ensureStage4Session,
  expect,
  loginExistingStage4Session,
  openStage4CanvasProject,
  openStage4ChatProject,
  seedStage4Baseline,
  seedStage4RuntimeDependencies,
  stage4FixtureForProject,
  test,
  writeStage4Metrics,
} from '../helpers/stage-4-e2e';
import { dragPointerAcrossFrames } from '../helpers/canvas-performance';
import { cancelFirefoxAgentRun, observeFirefoxAgentPollAborts } from '../helpers/stage-4-firefox-agent-cancel';
import { finalizeStage4SelectionDiagnostic } from '../helpers/stage-4-selection-diagnostics';

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

function requiredExpectedAgentMode(): Stage4ExpectedAgentMode {
  const mode = process.env.E2E_STAGE4_EXPECTED_AGENT_MODE?.trim();
  if (mode === 'legacy' || mode === 'shadow' || mode === 'agent-v2') return mode;
  throw new Error('BLOCKED: E2E_STAGE4_EXPECTED_AGENT_MODE must be legacy, shadow, or agent-v2');
}

const expectedAgentMode = requiredExpectedAgentMode();

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

function readCompleteSseFrames(body: Uint8Array): string[] {
  const decoder = new SimpleChatSseDecoder();
  const frames = decoder.push(body);
  expect(decoder.finish(), 'SSE response ended mid-frame').toEqual([]);
  return frames.map(frame => frame.data);
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
  const firefox = testInfo.project.name === 'firefox';
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
  if (firefox) {
    const [response] = await Promise.all([
      page.waitForResponse(candidate => candidate.request().method() === 'POST'
        && new URL(candidate.url()).pathname === '/api/simple-chat/chat'),
      chatInput.press('Enter'),
    ]);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/event-stream(?:;|$)/i);
    expect(await response.finished()).toBeNull();
    const events = readCompleteSseFrames(await response.body()).map(frame => JSON.parse(frame) as { type?: string });
    expect(events.at(-1), 'Ordinary chat must send its terminal SSE frame').toMatchObject({ type: 'done' });
    expect(events.some(event => event.type === 'error')).toBe(false);
  } else {
    await chatInput.press('Enter');
  }
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
    return { status: response.status, mediaType: response.headers.get('content-type'), text: await response.text() };
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
  if (firefox) {
    expect(vision.mediaType).toMatch(/^text\/event-stream(?:;|$)/i);
    const frames = readCompleteSseFrames(new TextEncoder().encode(vision.text));
    expect(frames.at(-1), 'Vision chat must send its terminal SSE marker').toBe('[DONE]');
    const events = frames.slice(0, -1).map(frame => JSON.parse(frame) as { type?: string; error?: string });
    expect(events.some(event => event.type === 'error' || (!event.type && event.error))).toBe(false);
  }
  expect(vision.text).toContain('"success":false');
  expect(vision.text).not.toContain('CONTROLLED_CONTINUATION_SHOULD_NOT_EXIST');
  expect(counts(fixture.browserProfile), vision.text).toMatchObject({ ordinary: 1, visionMain: 1, visionProvider: 1 });

  await page.evaluate(() => localStorage.setItem('wujie_selected_model', JSON.stringify({
    model: 'stage4-image-model', providerId: 'stage4-image-provider',
  })));
  await openStage4CanvasProject(page, String(fixture.canvasProject.id));
  const runStorageKey = `wujie_agent_run:${fixture.canvasProject.id}:${asset.selectedEntityId}`;
  let agentSelectionSequence = 0;
  const openAgentEditor = async () => {
    const selectionSequence = ++agentSelectionSequence;
    const canvasImage = page.locator(`[data-canvas-image-id="${asset.selectedEntityId}"]`);
    await expect(canvasImage).toBeVisible({ timeout: 20_000 });
    if (testInfo.project.name === 'webkit') {
      const beforeClick = await canvasImage.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const hit = document.elementFromPoint(x, y);
        const overlay = hit?.closest('[data-popup], [data-toolbar], [data-floating-panel]');
        return {
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          clickPoint: { x, y },
          hitTag: hit?.tagName ?? null,
          hitImageId: hit?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
          hitOverlay: overlay ? {
            popup: overlay.getAttribute('data-popup'),
            toolbar: overlay.getAttribute('data-toolbar'),
            floatingPanel: overlay.getAttribute('data-floating-panel'),
          } : null,
          hitBlockedByOverlay: Boolean(hit?.closest('[data-floating-panel], [data-popup], [data-modal], [data-toolbar], [data-compare-dialog], [role="dialog"], [role="tabpanel"]')),
          historyPending: element.closest('[data-canvas-history-pending]')?.getAttribute('data-canvas-history-pending') ?? null,
          selected: element.getAttribute('data-canvas-selected'),
        };
      });
      await writeStage4Metrics(stage4Evidence, testInfo, `agent-before-selection-${selectionSequence}`, beforeClick);
      console.info(`STAGE4_AGENT_SELECTION ${JSON.stringify({ phase: 'before', selectionSequence, ...beforeClick })}`);
    }
    // Observe native delivery, not just a pre-click elementFromPoint sample.
    // Keep the business assertions unchanged. Linux/WebKit native evidence
    // showed force-click delivering at the pre-fit point after the image moved;
    // normal actionability below must wait for the rendered image to be stable.
    // No URLs, content, or credentials enter this bounded, test-only recorder.
    const selectionRecorder = testInfo.project.name === 'webkit'
      ? await page.evaluateHandle(imageId => {
        const entries: Array<Record<string, unknown>> = [];
        const eventTypes = ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'mousedown', 'mouseup', 'click'];
        const overlaySelector = '[data-floating-panel], [data-popup], [data-modal], [data-toolbar], [data-compare-dialog], [role="dialog"], [role="tabpanel"]';
        let stopped = false;
        let droppedCount = 0;
        const snapshot = (event: Event, phase: 'capture' | 'capture-microtask'): void => {
          if (stopped) return;
          if (entries.length >= 32) { droppedCount += 1; return; }
          const sample = event instanceof MouseEvent ? event : null;
          const pointer = event instanceof PointerEvent ? event : null;
          const target = event.target instanceof Element ? event.target : null;
          const hit = sample ? document.elementFromPoint(sample.clientX, sample.clientY) : null;
          const image = document.querySelector<HTMLElement>(`[data-canvas-image-id="${CSS.escape(imageId)}"]`);
          const bounds = image?.getBoundingClientRect();
          entries.push({
            type: event.type, phase, timestamp: performance.now(), trusted: event.isTrusted,
            point: sample ? { x: sample.clientX, y: sample.clientY } : null,
            button: sample?.button ?? null, pointerId: pointer?.pointerId ?? null,
            pointerType: pointer?.pointerType ?? null,
            targetTag: target?.tagName ?? null,
            targetImageId: target?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
            hitImageId: hit?.closest<HTMLElement>('[data-canvas-image-id]')?.dataset.canvasImageId ?? null,
            targetBlockedByOverlay: Boolean(target?.closest(overlaySelector)),
            historyPending: image?.closest('[data-canvas-history-pending]')?.getAttribute('data-canvas-history-pending') ?? null,
            selected: image?.getAttribute('data-canvas-selected') ?? null,
            toolbarMounted: document.querySelector('[data-toolbar="image-action-toolbar"]') !== null,
            bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
          });
        };
        const capture = (event: Event): void => {
          snapshot(event, 'capture');
          // A browser may run a microtask checkpoint between event listeners;
          // this phase does not promise that React's bubbling handler ran.
          queueMicrotask(() => snapshot(event, 'capture-microtask'));
        };
        eventTypes.forEach(type => document.addEventListener(type, capture, true));
        return {
          finish: (): { entries: Array<Record<string, unknown>>; droppedCount: number } => {
            stopped = true;
            eventTypes.forEach(type => document.removeEventListener(type, capture, true));
            return { entries, droppedCount };
          },
        };
      }, asset.selectedEntityId).catch(() => {
        console.info(`STAGE4_AGENT_SELECTION_DIAGNOSTIC_FAILED ${JSON.stringify({ selectionSequence, phase: 'install' })}`);
        return null;
      })
      : null;
    try {
      await canvasImage.click();
    } finally {
      if (selectionRecorder) {
        const failures = await finalizeStage4SelectionDiagnostic({
          collect: async (): Promise<void> => {
            const timeline = await selectionRecorder.evaluate(recorder => recorder.finish());
            console.info(`STAGE4_AGENT_SELECTION_EVENTS ${JSON.stringify({ selectionSequence, ...timeline })}`);
            await writeStage4Metrics(stage4Evidence, testInfo, `agent-selection-events-${selectionSequence}`, timeline);
          },
          dispose: async (): Promise<void> => {
            try {
              await selectionRecorder.evaluate(recorder => { recorder.finish(); });
            } finally {
              await selectionRecorder.dispose();
            }
          },
        });
        for (const phase of failures) {
          console.info(`STAGE4_AGENT_SELECTION_DIAGNOSTIC_FAILED ${JSON.stringify({ selectionSequence, phase })}`);
        }
      }
    }
    if (testInfo.project.name === 'webkit') {
      const afterClick = await canvasImage.evaluate(element => ({
        selected: element.getAttribute('data-canvas-selected'),
        selectedImageIds: Array.from(document.querySelectorAll<HTMLElement>('[data-canvas-selected="true"]'))
          .map(image => image.dataset.canvasImageId),
        toolbarMounted: document.querySelector('[data-toolbar="image-action-toolbar"]') !== null,
        visibleDialogNames: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
          .filter(dialog => dialog.getBoundingClientRect().width > 0)
          .map(dialog => dialog.getAttribute('aria-label')),
      }));
      await writeStage4Metrics(stage4Evidence, testInfo, `agent-after-selection-${selectionSequence}`, afterClick);
      console.info(`STAGE4_AGENT_SELECTION ${JSON.stringify({ phase: 'after', selectionSequence, ...afterClick })}`);
    }
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
  const firefoxPollObserver = firefox && expectedAgentMode === 'agent-v2'
    ? await observeFirefoxAgentPollAborts(page)
    : null;
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
    if (firefoxPollObserver) {
      const { supersededPolls, ...proof } = await cancelFirefoxAgentRun(page, runId!, () => cancel.click(), firefoxPollObserver);
      for (const request of supersededPolls) stage4Evidence.confirmSupersededAgentPoll(request);
      await writeStage4Metrics(stage4Evidence, testInfo, 'firefox-agent-cancellation', proof);
    } else {
      await cancel.click();
    }
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

test('current chat-to-canvas lineage, placement, account scope and refresh @stage4-current-lineage', async ({ page, stage4Evidence }, testInfo) => {
  type StoredMessage = { id: string; imageRefs?: RegisteredWorkspaceAssetReference[] };
  type StoredProject = { id: string; tasks: Array<{ id: string; messages: StoredMessage[] }> };
  type Directory = {
    success: boolean; projectId: string; sequence: number; readOnly: boolean;
    projection: CanvasDocumentProjection; canvasImages: CanvasImage[];
  };
  const applicationUrl = new URL(testInfo.project.use.baseURL || '');
  expect(applicationUrl.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(applicationUrl.hostname);
  const fixture = structuredClone(await stage4FixtureForProject(testInfo.project.name));
  fixture.browserProfile += '-current-lineage-v10';
  fixture.canvasProject.id = `${String(fixture.canvasProject.id)}-current-lineage-v10`;
  fixture.canvasProject.canvasImages = [];
  const metadata = { ...(fixture.canvasProject.metadata as Record<string, unknown>) };
  delete metadata.workflow;
  fixture.canvasProject.metadata = metadata;
  fixture.chatProject.id = `${String(fixture.chatProject.id)}-current-lineage-v10`;
  fixture.chatProject.agents = [];
  const chatProjectId = String(fixture.chatProject.id);
  const chatTaskId = `stage4-chat-task-${fixture.browserProfile}`;
  fixture.chatProject.tasks = [{
    id: chatTaskId, projectId: chatProjectId, name: 'Current lineage', messages: [],
    model: 'stage4-chat-model', providerId: 'stage4-chat-provider',
    imageModel: 'stage4-image-model', imageProviderId: 'stage4-image-provider',
    createdAt: Date.now(), updatedAt: Date.now(),
  }];
  const targetProjectId = String(fixture.canvasProject.id);
  // Both accounts already exist; neither this case nor its login helper creates users.
  const fixtureB = structuredClone(fixture);
  fixtureB.username = fixture.username.replace(/^stage4_/, 'stage4_b_');
  fixtureB.canvasProject.id = `${targetProjectId}-b`;
  fixtureB.chatProject.id = `${chatProjectId}-b`;
  fixtureB.chatProject.tasks = [{
    ...structuredClone((fixture.chatProject.tasks as Array<Record<string, unknown>>)[0]),
    id: `${chatTaskId}-b`, projectId: String(fixtureB.chatProject.id), name: 'Account B scope check', messages: [],
  }];
  const authA = await loginExistingStage4Session(page, fixture);
  await seedStage4Baseline(page, fixture, authA);
  await seedStage4RuntimeDependencies({ auth: authA, fixture, page, providerBaseUrl });

  await openStage4ChatProject(page, chatProjectId);
  const origin = new URL(page.url()).origin;
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(origin).hostname);
  const ownerStatus = await page.request.get(`/api/collaboration/document-enable?projectId=${encodeURIComponent(targetProjectId)}`);
  expect(ownerStatus.ok()).toBe(true);
  const owner = await ownerStatus.json() as { featureEnabled: boolean; enabled: boolean; currentRevision: number };
  expect(owner.featureEnabled).toBe(true);
  expect(owner.enabled, 'Use a fresh Stage 4 run/project, not an already enabled document').toBe(false);
  const enabled = await page.request.post('/api/collaboration/document-enable', {
    headers: { Origin: origin },
    data: { projectId: targetProjectId, expectedRevision: owner.currentRevision },
  });
  expect(enabled.ok(), 'Current lineage requires real document authority and transport').toBe(true);

  const bridgeKey = (actorId: string) => 'wujie:canvas-bridge:v2:'
    + encodeURIComponent(JSON.stringify([actorId, targetProjectId]));
  const readJournal = async (actorId = authA.userId): Promise<CanvasBridgeJournal | null> => (
    page.evaluate(key => {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    }, bridgeKey(actorId))
  );
  const readStoredMessage = async (messageId: string): Promise<StoredMessage | undefined> => {
    const response = await page.request.get('/api/user-data/sync?key=chat_simple_projects');
    expect(response.ok()).toBe(true);
    const payload = await response.json() as { value?: StoredProject[] };
    return payload.value?.find(project => project.id === chatProjectId)?.tasks
      .find(task => task.id === chatTaskId)?.messages.find(message => message.id === messageId);
  };
  const readPlacement = async (reference: RegisteredWorkspaceAssetReference) => {
    if (!evidencePool) throw new Error('BLOCKED: Stage 4 evidence pool is not configured');
    const result = await evidencePool.query<{
      asset_id: string; owner_id: string; project_id: string; availability: string;
      task_id: string | null; provider_id: string | null; model_id: string | null;
      workspace_kind: string; workspace_id: string; entity_type: string; entity_id: string;
      source_trace: RegisteredWorkspaceAssetReference['sourceTrace'];
    }>(`SELECT v.asset_id, v.owner_id, v.project_id, v.availability,
        v.task_id, v.provider_id, v.model_id, p.workspace_kind, p.workspace_id,
        p.entity_type, p.entity_id, p.metadata->'sourceTrace' AS source_trace
      FROM wujie_asset_versions v JOIN wujie_workspace_placements p
        ON p.asset_version_id=v.id AND p.asset_id=v.asset_id
        AND p.owner_id=v.owner_id AND p.project_id=v.project_id
      WHERE v.id=$1 AND p.id=$2 AND p.status='active'`,
    [reference.assetVersionId, reference.placementId]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      asset_id: reference.assetId, owner_id: authA.userId, project_id: targetProjectId,
      availability: 'ready', entity_id: reference.entityId,
    });
    return result.rows[0];
  };
  const requestCounts = { registration: 0, chat: 0, transfer: 0, attach: 0 };
  const attachRequestBodies: unknown[] = [];
  const observeRequest = (request: import('@playwright/test').Request): void => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path === '/api/simple-chat/chat') {
      if (request.postDataJSON()?.assetAction === 'register') requestCounts.registration += 1;
      else requestCounts.chat += 1;
    }
    if (path === '/api/assets/batch-transfer') requestCounts.transfer += 1;
    if (path === '/api/collaboration/document-assets') {
      requestCounts.attach += 1;
      attachRequestBodies.push(request.postDataJSON());
    }
  };
  page.on('request', observeRequest);
  const providerBefore = { ...counts(fixture.browserProfile) };
  try {
    await page.getByRole('combobox', { name: '目标画布项目' }).selectOption(targetProjectId);
    await expect(page.getByRole('button', { name: '联网搜索', exact: true })).toHaveAttribute('aria-pressed', 'false');
    const uploadName = 'stage4-current-lineage.png';
    await page.locator('#chat-file-upload').setInputFiles({
      name: uploadName, mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    });
    await expect(page.getByRole('button', { name: `移除图片：${uploadName}`, exact: true })).toBeVisible();
    const registrationResponse = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/simple-chat/chat'
      && response.request().method() === 'POST' && response.request().postDataJSON()?.assetAction === 'register'
    ));
    const chatResponse = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/simple-chat/chat' && response.request().method() === 'POST'
      && response.request().postDataJSON()?.assetAction !== 'register'
    ));
    const prompt = `请参考上传图片生成1张图片。WORKSPACE_CHAIN_E2E E2E_PROFILE:${fixture.browserProfile}`;
    const input = page.getByPlaceholder('输入消息，Enter 发送，支持 Ctrl+V 粘贴图片');
    await input.fill(prompt);
    await input.press('Enter');
    const registration = await registrationResponse;
    expect(registration.ok(), `Attachment registration HTTP ${registration.status()}`).toBe(true);
    const response = await chatResponse;
    expect(response.ok()).toBe(true);
    const request = response.request().postDataJSON() as Record<string, unknown>;
    expect(request).toMatchObject({
      projectId: chatProjectId, taskId: chatTaskId, assetProjectId: targetProjectId,
      model: 'stage4-chat-model', providerId: 'stage4-chat-provider',
      imageModel: 'stage4-image-model', imageProviderId: 'stage4-image-provider', webSearch: false,
    });
    expect(request.responseMessageId).toEqual(expect.any(String));
    const messageId = String(request.responseMessageId);
    const events = readCompleteSseFrames(await response.body())
      .filter(frame => frame !== '[DONE]').map(frame => JSON.parse(frame) as Record<string, unknown>);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
    const images = events.filter(event => event.type === 'image');
    expect(images).toHaveLength(1);
    const generated = images[0].imageRef as RegisteredWorkspaceAssetReference;
    expect(generated).toMatchObject({
      assetId: expect.any(String), assetVersionId: expect.any(String),
      placementId: expect.any(String), entityId: expect.any(String), url: expect.any(String),
      sourceTrace: { source: 'simple-chat', chatProjectId, chatTaskId, messageId,
        providerId: 'stage4-image-provider', modelId: 'stage4-image-model' },
    });
    for (const id of [generated.assetId, generated.assetVersionId, generated.placementId]) {
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
      expect(id).not.toMatch(/^(?:data|blob|https?|processing)(?:[:_-]|$)/iu);
    }
    const sourcePlacement = await readPlacement(generated);
    expect(sourcePlacement).toMatchObject({
      workspace_kind: 'chat', workspace_id: `standalone-chat:${chatProjectId}`, entity_type: 'chat-result',
    });
    if (generated.sourceTrace?.source === 'simple-chat' && generated.sourceTrace.generationTaskIds) {
      expect(generated.sourceTrace.generationTaskIds).toEqual([sourcePlacement.task_id]);
      expect(sourcePlacement).toMatchObject({ provider_id: 'stage4-image-provider', model_id: 'stage4-image-model' });
    }
    const message = page.locator(`[data-chat-message-id="${messageId}"]`);
    await expect(message).toHaveAttribute('data-chat-asset-placement-ids', generated.placementId);
    // The chat snapshot owns per-message provenance; the task's shared asset
    // version is also used by other workspaces and retains its original digest.
    await expect.poll(async () => (await readStoredMessage(messageId))?.imageRefs, { timeout: 20_000 })
      .toContainEqual(generated);
    const transferResponse = page.waitForResponse(candidate => (
      new URL(candidate.url()).pathname === '/api/assets/batch-transfer' && candidate.request().method() === 'POST'
    ));
    await message.getByTitle('添加到画布', { exact: true }).click();
    const transfer = await transferResponse;
    expect(transfer.ok()).toBe(true);
    const identity = buildSimpleChatCanvasTransferIdentity({
      targetProjectId, chatTaskId, messageId, imageIndex: 0, sourceVersionId: generated.assetVersionId,
    });
    expect(transfer.request().postDataJSON()).toMatchObject({
      transfers: [{ sourceVersion: generated.assetVersionId, targetProject: targetProjectId,
        targetWorkspace: `canvas:${targetProjectId}`, entityType: 'canvas-image', ...identity,
        metadata: { source: 'standalone-chat', messageId, imageIndex: 0, sourceTrace: generated.sourceTrace } }],
      restoreDeletedPlacements: true,
    });
    const transferredPayload = await transfer.json() as { transfers: RegisteredWorkspaceAssetReference[] };
    expect(transferredPayload.transfers).toHaveLength(1);
    const transferred = transferredPayload.transfers[0];
    expect(transferred).toMatchObject({
      assetId: generated.assetId, assetVersionId: generated.assetVersionId, placementId: expect.any(String),
      entityId: identity.entityId,
    });
    const transferredPlacement = await readPlacement(transferred);
    expect(transferredPlacement).toMatchObject({
      workspace_kind: 'canvas', workspace_id: `canvas:${targetProjectId}`, entity_type: 'canvas-image',
      source_trace: generated.sourceTrace,
    });
    expect(transferredPlacement.source_trace).toEqual(generated.sourceTrace);
    await expect(page.locator('[data-canvas-bridge-notice="waiting"]')).toContainText('已发送 1 张图片，等待画布接收');
    expect((await readStoredMessage(messageId))?.imageRefs).toContainEqual(generated);
    const pending = await readJournal();
    expect(pending).toMatchObject({ actorId: authA.userId, projectId: targetProjectId });
    if (!pending) throw new Error('Current lineage did not enqueue its real transfer');
    expect(pending?.items).toHaveLength(1);
    expect(pending?.items[0]).toMatchObject({
      assetVersionId: transferred.assetVersionId, placementId: transferred.placementId, state: 'pending',
    });
    expect(requestCounts).toEqual({ registration: 1, chat: 1, transfer: 1, attach: 0 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('combobox', { name: '目标画布项目' })).toBeVisible();
    await expect(message).toHaveAttribute('data-chat-asset-placement-ids', generated.placementId);
    expect((await readStoredMessage(messageId))?.imageRefs).toContainEqual(generated);
    expect(await readJournal()).toEqual(pending);
    expect(requestCounts).toEqual({ registration: 1, chat: 1, transfer: 1, attach: 0 });

    const attachResponse = page.waitForResponse(candidate => (
      new URL(candidate.url()).pathname === '/api/collaboration/document-assets' && candidate.request().method() === 'POST'
    ));
    await openStage4CanvasProject(page, targetProjectId);
    const attach = await attachResponse;
    expect(attach.ok()).toBe(true);
    expect(attach.request().headers()['x-wujie-expected-actor-id']).toBe(authA.userId);
    expect(attach.request().postDataJSON()).toEqual({
      projectId: targetProjectId, idempotencyKey: pending.items[0].idempotencyKey, command: pending.items[0].command,
    });
    const receipt = await attach.json() as DocumentAssetCommandResult & { success: boolean };
    expect(receipt).toMatchObject({ success: true, assetVersionId: transferred.assetVersionId, placementId: expect.any(String) });
    expect(Number.isSafeInteger(receipt.documentSequence)).toBe(true);
    expect(receipt.documentSequence).toBeGreaterThanOrEqual(0);
    await expect(page.getByText('聊天素材接收已确认', { exact: true })).toBeVisible({ timeout: 30_000 });
    const confirmed = await readJournal();
    expect(confirmed?.items).toHaveLength(1);
    expect(confirmed?.items[0]).toEqual({ ...pending.items[0], state: 'confirmed', documentAttempted: true,
      receipt: { placementId: receipt.placementId, assetVersionId: receipt.assetVersionId, documentSequence: receipt.documentSequence } });
    const confirmedAttachCount = requestCounts.attach;
    expect(confirmedAttachCount).toBeGreaterThanOrEqual(1);
    const expectedAttach = { projectId: targetProjectId, idempotencyKey: pending.items[0].idempotencyKey,
      command: pending.items[0].command };
    expect(attachRequestBodies).toEqual(Array.from({ length: confirmedAttachCount }, () => expectedAttach));
    if (!evidencePool) throw new Error('BLOCKED: Stage 4 evidence pool is not configured');
    const commandRows = await evidencePool.query(`SELECT placement_id,asset_version_id,document_sequence
      FROM wujie_canvas_asset_commands WHERE actor_id=$1 AND project_id=$2 AND idempotency_key=$3`,
    [authA.userId, targetProjectId, pending.items[0].idempotencyKey]);
    expect(commandRows.rows).toHaveLength(1);
    expect(commandRows.rows[0]).toMatchObject({ placement_id: receipt.placementId, asset_version_id: receipt.assetVersionId });
    expect(Number(commandRows.rows[0].document_sequence)).toBe(receipt.documentSequence);
    const assertDestination = async (): Promise<Directory> => {
      const result = await page.request.get(`/api/collaboration/document-project?projectId=${encodeURIComponent(targetProjectId)}`, {
        headers: { 'x-wujie-expected-actor-id': authA.userId },
      });
      expect(result.ok()).toBe(true);
      const directory = await result.json() as Directory;
      expect(directory).toMatchObject({ success: true, projectId: targetProjectId, readOnly: false });
      expect(directory.sequence).toBeGreaterThanOrEqual(receipt.documentSequence);
      const placement = directory.projection.placements[receipt.placementId];
      expect(placement).toMatchObject({ assetVersionId: receipt.assetVersionId, ...pending.items[0].command.transform });
      expect(placement.deleted).not.toBe(true);
      const matches = directory.canvasImages.filter(image => image.placementId === receipt.placementId);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ assetVersionId: receipt.assetVersionId, ...pending.items[0].command.transform });
      await expect(page.locator(`[data-canvas-image-id="${matches[0].id}"]`)).toBeVisible();
      await expect(page.getByRole('status', { name: '在线状态', exact: true }))
        .toContainText(/\d+ 人在线/, { timeout: 20_000 });
      return directory;
    };
    const receivedDirectory = await assertDestination();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-canvas-viewport]')).toHaveAttribute('data-project-id', targetProjectId);
    await assertDestination();
    expect(await readJournal()).toEqual(confirmed);
    expect(requestCounts).toEqual({ registration: 1, chat: 1, transfer: 1, attach: confirmedAttachCount });

    const journalBeforeSwitch = await page.evaluate(key => localStorage.getItem(key), bridgeKey(authA.userId));
    const authB = await loginExistingStage4Session(page, fixtureB);
    expect(authB.userId).not.toBe(authA.userId);
    await seedStage4Baseline(page, fixtureB, authB);
    await openStage4ChatProject(page, String(fixtureB.chatProject.id));
    await expect(page.getByRole('combobox', { name: '目标画布项目' }).locator(`option[value="${targetProjectId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-chat-message-id="${messageId}"]`)).toHaveCount(0);
    const bChats = await page.request.get('/api/user-data/sync?key=chat_simple_projects');
    expect(bChats.ok()).toBe(true);
    const bChatPayload = await bChats.json() as { value?: StoredProject[] };
    expect(bChatPayload.value?.some(project => project.id === chatProjectId)).toBe(false);
    const deniedRead = await page.request.get(`/api/collaboration/document-project?projectId=${encodeURIComponent(targetProjectId)}`, {
      headers: { 'x-wujie-expected-actor-id': authB.userId },
    });
    expect(deniedRead.status()).toBe(403);
    expect(await deniedRead.json()).toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    const deniedAsset = await page.request.get(`/api/assets?${new URLSearchParams({
      projectId: targetProjectId, assetVersionId: receipt.assetVersionId, placementId: receipt.placementId,
    })}`, { headers: { 'x-wujie-expected-actor-id': authB.userId } });
    expect(deniedAsset.status()).toBe(403);
    expect(await deniedAsset.json()).toMatchObject({ error: 'DOCUMENT_FORBIDDEN' });
    const deniedWrite = await page.request.post('/api/collaboration/document-assets', {
      headers: { Origin: origin, 'x-wujie-expected-actor-id': authB.userId },
      data: { projectId: targetProjectId, idempotencyKey: pending.items[0].idempotencyKey, command: pending.items[0].command },
    });
    expect(deniedWrite.status()).toBe(403);
    expect(await deniedWrite.json()).toMatchObject({ code: 'DOCUMENT_FORBIDDEN' });
    await openStage4CanvasProject(page, String(fixtureB.canvasProject.id));
    await expect(page.locator('[data-canvas-image-id]')).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), bridgeKey(authA.userId))).toBe(journalBeforeSwitch);
    expect(await readJournal(authB.userId)).toBeNull();
    await expect(page.getByRole('status', { name: '在线状态', exact: true }))
      .toContainText(/\d+ 人在线/, { timeout: 20_000 });

    const returnedA = await loginExistingStage4Session(page, fixture);
    expect(returnedA.userId).toBe(authA.userId);
    await openStage4ChatProject(page, chatProjectId);
    await expect(message).toHaveAttribute('data-chat-asset-placement-ids', generated.placementId);
    expect((await readStoredMessage(messageId))?.imageRefs).toContainEqual(generated);
    await openStage4CanvasProject(page, targetProjectId);
    const returnedDirectory = await assertDestination();
    expect(returnedDirectory.sequence).toBe(receivedDirectory.sequence);
    expect(returnedDirectory.projection).toEqual(receivedDirectory.projection);
    expect(await readJournal()).toEqual(confirmed);
    expect(requestCounts).toEqual({ registration: 1, chat: 1, transfer: 1, attach: confirmedAttachCount });
    expect(counts(fixture.browserProfile).workspaceVision - providerBefore.workspaceVision).toBe(1);
    expect(counts(fixture.browserProfile).imageGeneration - providerBefore.imageGeneration).toBe(1);
    await writeStage4Metrics(stage4Evidence, testInfo, 'current-lineage', {
      actors: { a: authA.userId, b: authB.userId }, chatProjectId, chatTaskId, messageId, targetProjectId,
      generated, sourcePlacement, transferred, pending, confirmed, receipt,
      receivedDirectory, returnedDirectory, requestCounts, attachRequestBodies,
      providerCounts: counts(fixture.browserProfile), denied: { read: deniedRead.status(), asset: deniedAsset.status(), write: deniedWrite.status() },
    });
  } finally {
    page.off('request', observeRequest);
  }
});

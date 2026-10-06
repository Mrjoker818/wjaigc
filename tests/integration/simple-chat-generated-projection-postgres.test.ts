import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireOfflineBridgeTestDatabaseUrl } from '../helpers/offline-bridge-database-guard';
import { withIsolatedPostgres } from '../helpers/postgres-test-database';

const mocks = vi.hoisted(() => ({
  findProviderForModel: vi.fn(),
  getSessionUser: vi.fn(),
  getInternalRequestHeaders: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/collaboration/task-result-publication', () => ({
  projectCanvasTaskResult: vi.fn(async () => null),
}));
vi.mock('@/lib/server-api-config', () => ({
  findProviderForModel: mocks.findProviderForModel,
}));
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: mocks.getSessionUser,
}));
vi.mock('@/lib/api-auth', () => ({
  getInternalRequestHeaders: mocks.getInternalRequestHeaders,
}));
vi.mock('@/lib/api-helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-helpers')>();
  return { ...actual, getInternalApiUrl: (path: string) => `http://127.0.0.1:5000${path}` };
});
vi.mock('coze-coding-dev-sdk', () => ({
  SearchClient: class {},
  Config: class {},
  HeaderUtils: { extractForwardHeaders: vi.fn() },
}));

import { POST } from '@/app/api/simple-chat/chat/route';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
const postgresIt = databaseUrl ? it : it.skip;

function migrate(isolatedDatabaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl, PGDATABASE_URL: isolatedDatabaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

function toolCallResponse(): Response {
  const event = JSON.stringify({
    choices: [{ delta: { tool_calls: [{
      index: 0,
      id: 'tool-call-1',
      function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'A lighthouse at night', size: '1024x1024' }) },
    }] } }],
  });
  return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface ImageEvent {
  type: 'image';
  imageUrl: string;
  imageRef?: {
    assetId?: string;
    assetVersionId?: string;
    placementId?: string;
    entityId?: string;
    url?: string;
  };
}

function readImageEvent(stream: string): ImageEvent {
  const event = stream.split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)) as Record<string, unknown>)
    .find(candidate => candidate.type === 'image');
  expect(event, stream).toBeDefined();
  return event as unknown as ImageEvent;
}

describe('independent chat generated image projection with PostgreSQL', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  postgresIt('reuses the canvas result version and creates a distinct chat placement before SSE delivery', async () => {
    requireOfflineBridgeTestDatabaseUrl(process.env);
    await withIsolatedPostgres('simple-chat-generated-projection', async ({ databaseUrl: url, query }) => {
      migrate(url);
      const { createCloudTask } = await import('@/lib/cloud-task-storage');
      const { recordImageTaskTerminal } = await import('@/lib/cloud-task-persistence');
      const { projectCompletedTaskToAssets } = await import('@/lib/asset-core/task-projector');

      const ownerId = 'user-chat-projection';
      const projectId = 'canvas-project-chat-projection';
      const taskId = 'generation-task-chat-projection';
      const imageUrl = '/uploads/derived-chat-projection.png';
      await query(
        `INSERT INTO wujie_projects(id, owner_id, name, status)
         VALUES ($1, $2, $3, 'active')`,
        [projectId, ownerId, 'Chat projection'],
      );
      const now = Date.now();
      await createCloudTask({
        id: taskId,
        userId: ownerId,
        projectId,
        type: 'generate',
        status: 'processing',
        providerId: 'requested-image-provider',
        model: 'requested-image-model',
        progress: 50,
        result: { submissionPayload: { prompt: 'A lighthouse at night' } },
        creditStatus: 'charged',
        createdAt: now,
        updatedAt: now,
      });
      await recordImageTaskTerminal(taskId, { status: 'completed', imageUrl, creditStatus: 'charged' });
      const canvas = await projectCompletedTaskToAssets({
        actorUserId: ownerId,
        taskId,
        targetProjectId: projectId,
        workspace: 'canvas',
        parentVersionIds: [],
      });
      const originalVersionId = canvas.versions[0].id;
      const canvasPlacementId = canvas.placements[0].id;

      mocks.getSessionUser.mockResolvedValue({
        id: ownerId,
        role: 'user',
        productType: 'chat',
        apiPermissions: { chat: true },
      });
      mocks.getInternalRequestHeaders.mockResolvedValue({ Authorization: 'Bearer internal-test' });
      mocks.findProviderForModel.mockResolvedValue({
        id: 'chat-provider',
        apiKey: 'chat-key',
        baseUrl: 'https://chat.example/v1',
        advancedParams: {},
      });
      const requestedUrls: string[] = [];
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
        const requestedUrl = String(input);
        requestedUrls.push(requestedUrl);
        if (requestedUrl === 'https://chat.example/v1/chat/completions') return toolCallResponse();
        if (requestedUrl === 'http://127.0.0.1:5000/api/generate') {
          return jsonResponse({ success: true, taskIds: [taskId] });
        }
        if (requestedUrl === 'http://127.0.0.1:5000/api/poll-task') {
          return jsonResponse({
            status: 'completed',
            imageUrl,
            assetProjection: { status: 'completed', versionIds: [originalVersionId] },
          });
        }
        throw new Error(`Unexpected fetch URL: ${requestedUrl}`);
      }));

      const request = new NextRequest('http://localhost/api/simple-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Generate a lighthouse at night' }],
          model: 'chat-model',
          providerId: 'chat-provider',
          imageModel: 'requested-image-model',
          imageProviderId: 'requested-image-provider',
          projectId: 'chat-project',
          taskId: 'chat-task',
          responseMessageId: 'assistant-message',
          assetProjectId: projectId,
        }),
      });
      vi.useFakeTimers();
      const response = await POST(request);
      const streamPromise = response.text();
      await vi.runAllTimersAsync();
      const event = readImageEvent(await streamPromise);
      vi.useRealTimers();

      expect(response.status).toBe(200);
      expect(requestedUrls).toContain('http://127.0.0.1:5000/api/poll-task');
      expect(event.imageUrl).toBe(imageUrl);
      expect(event.imageRef).toEqual(expect.objectContaining({
        assetId: canvas.versions[0].assetId,
        assetVersionId: originalVersionId,
        placementId: expect.any(String),
        entityId: 'assistant-message:0',
        url: imageUrl,
      }));
      expect(event.imageRef?.placementId).not.toBe(canvasPlacementId);

      const facts = await query<{
        version_count: number;
        placement_count: number;
        chat_placement_count: number;
        credit_status: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM wujie_asset_versions WHERE task_id = $1) AS version_count,
           (SELECT COUNT(*)::int FROM wujie_workspace_placements p
             JOIN wujie_asset_versions v ON v.id = p.asset_version_id
             WHERE v.task_id = $1 AND p.status = 'active') AS placement_count,
           (SELECT COUNT(*)::int FROM wujie_workspace_placements p
             WHERE p.asset_version_id = $2 AND p.id = $3 AND p.workspace_kind = 'chat'
               AND p.workspace_id = 'standalone-chat:chat-project' AND p.status = 'active') AS chat_placement_count,
           (SELECT credit_status FROM cloud_tasks WHERE id = $1) AS credit_status`,
        [taskId, originalVersionId, event.imageRef?.placementId],
      );
      expect(facts.rows[0]).toEqual({
        version_count: 1,
        placement_count: 2,
        chat_placement_count: 1,
        credit_status: 'charged',
      });
    });
  });
});

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import sharp from 'sharp';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';
import { GET as recoverTaskGet } from '@/app/api/tasks/recover/route';
import { canvasTaskOutputCommandKey } from '@/lib/collaboration/task-result-publication';

await vi.hoisted(async (): Promise<void> => {
  const { requireOfflineBridgeTestDatabaseUrl } = await import('../helpers/offline-bridge-database-guard');
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = process.env.WUJIE_DATA_DIR?.replaceAll('\\', '/');
  if (!root || !/^J:\/无界本地版\/projects\/_tmp_e2e\/wujie-bridge-test-[a-z0-9-]+$/i.test(root)) {
    throw new Error('Expected a dedicated offline bridge media root');
  }
  process.env.WUJIE_DATA_DIR = fs.mkdtempSync(path.join(root, 'task-image-edit-source-'));
  process.env.COZE_PROJECT_ENV = 'PROD';
  process.env.LOCAL_AI_ENABLED = 'false';
  process.env.WUJIE_TASK_CORE_MODE = 'core-v2';
  process.env.WUJIE_YJS_ENABLED = 'true';
  process.env.COZE_PROJECT_DOMAIN_DEFAULT = 'https://preview.example.invalid';
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
});

const boundary = vi.hoisted(() => ({
  media: vi.fn<(url: string) => Promise<Buffer>>(),
  config: vi.fn<() => Promise<ApiProvider[]>>(),
  sends: [] as string[],
  mediaReads: [] as string[],
  safeDownload: vi.fn<(url: string) => Promise<{ buffer: Buffer; mimeType: string }>>(),
  rembg: vi.fn<(image: Buffer, model: string) => Promise<{
    success: boolean; rgbaBase64?: string; maskBase64?: string; model?: string; error?: string;
  }>>(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-auth', () => ({
  getAuthSecretForInternalRequests: (): string => 'offline-source-enhance-secret-at-least-32',
  listManagedUsers: async (): Promise<User[]> => {
    const { dbGetUserById } = await import('@/lib/db-storage');
    const actor = await dbGetUserById('source-editor');
    return actor ? [{ id: actor.id, name: actor.name, role: actor.role, status: actor.status,
      chatModels: Array.isArray(actor.chat_models) ? actor.chat_models : undefined,
      imageModels: Array.isArray(actor.image_models) ? actor.image_models : undefined,
      createdAt: 1, updatedAt: 1 } as User] : [];
  },
  getSessionUser: async (request?: Request): Promise<User | null> => {
    if (request?.headers.get('x-test-credential-kind') === 'desktop-token'
      || request?.headers.get('x-internal-request') === 'true') return null;
    const { dbGetUserById } = await import('@/lib/db-storage');
    const user = await dbGetUserById(request?.headers.get('x-test-actor') || 'source-owner');
    return user ? { id: user.id, name: user.name, role: user.role, status: user.status,
      chatModels: Array.isArray(user.chat_models) ? user.chat_models : undefined,
      imageModels: Array.isArray(user.image_models) ? user.image_models : undefined,
      createdAt: 1, updatedAt: 1 } as User : null;
  },
}));
vi.mock('@/lib/api-auth', async original => {
  const real = await original<typeof import('@/lib/api-auth')>();
  return { ...real, requireApiAuthOrReject: async (incoming: Request) => {
    if (incoming.headers.get('x-test-credential-kind') !== 'desktop-token') {
      return real.requireApiAuthOrReject(incoming);
    }
    const { dbGetUserById } = await import('@/lib/db-storage');
    const actor = await dbGetUserById(incoming.headers.get('x-test-actor') || '');
    if (!actor) throw new Error('Missing test desktop actor');
    return { authenticated: true as const, userId: actor.id, userRole: actor.role || 'user',
      user: { id: actor.id, name: actor.name, role: actor.role, status: actor.status,
        createdAt: 1, updatedAt: 1 } as User, source: 'desktop-token' as const };
  } };
});
vi.mock('@/lib/server-api-config', async original => ({
  ...await original<typeof import('@/lib/server-api-config')>(), getApiProviders: boundary.config,
  findProviderById: async (id: string): Promise<ApiProvider | null> =>
    (await boundary.config()).find(provider => provider.id === id && provider.isEnabled) || null,
}));
vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: boundary.media }));
vi.mock('@/lib/safe-image-download', async original => {
  const actual = await original<typeof import('@/lib/safe-image-download')>();
  return { ...actual, downloadPublicImage: async (input: string | URL,
    options?: Parameters<typeof actual.downloadPublicImage>[1]): Promise<{ buffer: Buffer; mimeType: string }> => {
    const url = String(input);
    if (url.includes('127.0.0.1')) return actual.downloadPublicImage(input, options);
    if (url === outputUrl || url.startsWith('https://preview.example.invalid/api/serve-upload/')) {
      options?.signal?.throwIfAborted();
      return { buffer: managedSourceBytes, mimeType: 'image/png' };
    }
    return boundary.safeDownload(url);
  } };
});
vi.mock('@/lib/s3-storage', () => ({ isS3Available: (): boolean => false,
  uploadBinaryToS3: async (): Promise<null> => null,
  readBinaryFromS3Exact: async (): Promise<null> => null,
  persistRemoteImage: async (): Promise<null> => null }));
vi.mock('@/lib/image-tools/upscayl', () => ({ performUpscaleAuto: async (): Promise<Record<string, unknown>> => ({
  success: true, imageUrl: outputUrl, model: 'offline-fidelity',
  originalSize: { width: 32, height: 32 }, outputSize: { width: 64, height: 64 },
}) }));
vi.mock('@/lib/image-tools/rembg-client', async original => ({
  ...await original<typeof import('@/lib/image-tools/rembg-client')>(),
  generateRembgMask: boundary.rembg,
}));

import { POST } from '@/app/api/image-edit/route';
import { GET as serveUploadGet } from '@/app/api/serve-upload/[...path]/route';
import { POST as upscaleCompatPost } from '@/app/api/image/upscale/route';
import { POST as upscaleProPost } from '@/app/api/image/upscale-pro/route';
import { POST as legacyUpscaylPost } from '@/app/api/upscayl/route';
import { POST as cancelTaskPost } from '@/app/api/cancel-task/route';
import { getInternalRequestHeaders } from '@/lib/api-auth';
import { ensureCoreTables } from '@/lib/db-storage';
import { claimCloudTaskLease, createCloudTask, releaseCloudTaskLease, terminateCloudTaskAndRefund } from '@/lib/cloud-task-storage';
import { getTaskInfo } from '@/lib/task-registry';
import { persistAssetBytes } from '@/lib/asset-core/binary-persistence';
import { createBillableTask } from '@/lib/task-core/billing-service';
import { applyCanvasImagePatch, createCanvasDocument, readCanvasDocument } from '@/lib/collaboration/canvas-document';

const canonicalUrl = '/api/serve-upload/source-shared.png';
const forgedUrl = 'https://media.invalid/forged.png';
const outputUrl = 'https://media.invalid/upscaled.png';
let managedSourceBytes: Buffer;

async function stubValidRembgOutput(): Promise<void> {
  const rgba = Buffer.alloc(32 * 32 * 4);
  const mask = Buffer.alloc(32 * 32);
  for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
    const foreground = pixel % 32 < 16;
    rgba.set([0x34, 0x56, 0x78, foreground ? 255 : 0], pixel * 4);
    mask[pixel] = foreground ? 255 : 0;
  }
  const rgbaPng = await sharp(rgba, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer();
  const maskPng = await sharp(mask, { raw: { width: 32, height: 32, channels: 1 } }).png().toBuffer();
  boundary.rembg.mockResolvedValue({ success: true, rgbaBase64: rgbaPng.toString('base64'),
    maskBase64: maskPng.toString('base64'), model: 'birefnet-general-lite' });
}

function stubProviderFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (input instanceof Request) {
      return implementation(input.url, { ...init, method: input.method,
        headers: input.headers, body: await input.clone().text() });
    }
    return implementation(input, init);
  });
}

function request(body: Record<string, unknown>, actor = 'source-owner', key?: string,
  credentialKind?: 'desktop-token'): NextRequest {
  return new NextRequest('http://localhost/api/image-edit', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-actor': actor,
      ...(key ? { 'idempotency-key': key } : {}),
      ...(credentialKind ? { 'x-test-credential-kind': credentialKind } : {}) },
    body: JSON.stringify(body) });
}

function pollRequest(taskId: string, actor = 'source-editor'): NextRequest {
  return new NextRequest('http://localhost/api/poll-task', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-actor': actor },
    body: JSON.stringify({ taskId, model: '302-esrgan' }) });
}

async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  if (!/^test_task_image_edit_source_/.test(schemaName)
    || !new URL(databaseUrl).searchParams.get('options')?.includes(`search_path=${schemaName}`)) {
    throw new Error('Isolated task schema required');
  }
  const migration = spawnSync(process.execPath, [resolve('scripts/run-migrations.mjs')], {
    encoding: 'utf8', timeout: 45_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(migration.status, `${migration.stdout}\n${migration.stderr}\n${migration.error || ''}`).toBe(0);
  await ensureCoreTables();
  await query(`INSERT INTO wujie_users(id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('source-owner','Owner','test','active','user',1,1),('source-editor','Editor','test','active','user',1,1)`);
  await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-shared','source-owner','Shared')");
  await query("INSERT INTO wujie_project_document_settings(project_id,owner_id,enabled) VALUES ('source-shared','source-owner',true)");
  await query("INSERT INTO wujie_project_document_editors(project_id,owner_id,member_user_id) VALUES ('source-shared','source-owner','source-editor')");
  await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source-asset','source-owner','source-shared','image')");
  await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
    VALUES ('source-version','source-asset','source-owner','source-shared',$1,'image/png')`, [canonicalUrl]);
  await query(`INSERT INTO wujie_workspace_placements
    (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
    VALUES ('source-placement','source-owner','source-shared','source-asset','source-version','canvas','source-shared','canvas-image','source-image')`);
  await query(`INSERT INTO wujie_project_canvas_documents(project_id,owner_id,projection)
    VALUES ('source-shared','source-owner',$1::jsonb)`, [JSON.stringify({ placements: { 'source-placement': {
    assetVersionId: 'source-version', x: 0, y: 0, width: 32, height: 32, rotation: 0, zIndex: 0,
  } } })]);
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('source-credit','source-owner',100,100,0,1,1),('source-editor-credit','source-editor',100,100,0,1,1)`);
  await query(`INSERT INTO wujie_system_settings(key,value,updated_at) VALUES ('credit_pricing_config',$1,1)`,
    [JSON.stringify({ modelCredits: { '302-esrgan': 7 } })]);
}

async function preparePublishableSource(query: QueryFn): Promise<Buffer> {
  const sourceBytes = await sharp({ create: { width: 32, height: 32, channels: 3,
    background: '#345678' } }).png().toBuffer();
  await writeFile(resolve(process.env.WUJIE_DATA_DIR!, 'source-shared.png'), sourceBytes);
  await query("UPDATE wujie_asset_versions SET byte_size=$1 WHERE id='source-version'", [sourceBytes.length]);
  const document = createCanvasDocument();
  applyCanvasImagePatch(document, { placementId: 'source-placement', assetVersionId: 'source-version',
    x: 0, y: 0, width: 32, height: 32, rotation: 0, zIndex: 0 }, 'fixture');
  await query('UPDATE wujie_project_canvas_documents SET projection=$1,snapshot_bytes=$2 WHERE project_id=$3',
    [readCanvasDocument(document), Buffer.from(Y.encodeStateAsUpdate(document)), 'source-shared']);
  document.destroy();
  return sourceBytes;
}

async function snapshot(query: QueryFn): Promise<Record<string, unknown>> {
  return {
    credits: (await query('SELECT balance,total_used FROM wujie_credits ORDER BY id')).rows,
    ledger: (await query('SELECT type,amount,balance_after FROM wujie_credit_transactions ORDER BY id')).rows,
    tasks: (await query('SELECT id,status,credit_status FROM cloud_tasks ORDER BY id')).rows,
  };
}

beforeEach(async (): Promise<void> => {
  boundary.sends.length = 0;
  boundary.mediaReads.length = 0;
  boundary.safeDownload.mockReset();
  boundary.rembg.mockReset();
  boundary.rembg.mockResolvedValue({ success: false, error: 'LOCAL_AI_ENABLED 未启用' });
  boundary.config.mockResolvedValue([{ id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
    isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source', selectedModels: ['302-esrgan'],
    createdAt: 1, updatedAt: 1 }]);
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#345678' } }).png().toBuffer();
  const upscaled = await sharp(png).resize(64, 64).png().toBuffer();
  managedSourceBytes = upscaled;
  boundary.safeDownload.mockImplementation(async (url: string): Promise<{ buffer: Buffer; mimeType: string }> => {
    if (url !== 'https://media.invalid/enhanced.png') throw new Error(`Undeclared public image download: ${url}`);
    return { buffer: upscaled, mimeType: 'image/png' };
  });
  boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
    boundary.mediaReads.push(url);
    if ([canonicalUrl, forgedUrl].includes(url)) return png;
    if (url === outputUrl || url === 'https://preview.example.invalid/api/serve-upload/enhanced-test.png') return upscaled;
    const managedPath = url.startsWith('/api/serve-upload/exports/') ? url
      : url.startsWith('https://preview.example.invalid/api/serve-upload/exports/') ? new URL(url).pathname : null;
    if (managedPath) {
      const { readFile } = await import('node:fs/promises');
      return readFile(resolve(process.env.WUJIE_DATA_DIR!, managedPath.slice('/api/serve-upload/'.length)));
    }
    throw new Error(`Undeclared image read: ${url}`);
  });
  stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
      throw new Error(`Undeclared network: ${url}`);
    }
    boundary.sends.push(String(init.body));
    return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
  });
});
afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('charges the signed workflow actor and persists the accepted outpaint child identity', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-internal-workflow', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request): Promise<Response> => {
      if (String(input) !== 'https://image-provider.invalid/v1/images/generations') {
        throw new Error(`Undeclared provider call: ${String(input)}`);
      }
      boundary.sends.push(String(input));
      return Response.json({ task_id: 'workflow-internal-outpaint-accepted' });
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const workflowRequest = (prompt?: string): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:execution-1:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'execution-1', messageId: 'execution-1:edit-node',
        imageUrl: canonicalUrl, model: 'source-image::gpt-image-1', expandScale: 2,
        ...(prompt ? { prompt } : {}) }),
    });
    const response = await POST(workflowRequest());
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, taskId: expect.stringMatching(/^image-edit-/) });
    const localTaskId = payload.taskId as string;
    expect(boundary.sends).toHaveLength(1);
    expect((await query('SELECT remote_task_id FROM cloud_tasks WHERE id=$1', [localTaskId])).rows)
      .toEqual([{ remote_task_id: 'workflow-internal-outpaint-accepted' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 85, total_used: 15 }]);
    const conflicting = await POST(workflowRequest('different scene'));
    expect(conflicting.status).toBe(409);
    expect(await conflicting.json()).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(boundary.sends).toHaveLength(1);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 85, total_used: 15 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
    expect((await query('SELECT user_id,project_id,message_id,idempotency_key,credit_cost FROM cloud_tasks WHERE id=$1', [localTaskId])).rows)
      .toEqual([{ user_id: 'source-editor', project_id: 'source-personal',
        message_id: 'execution-1:edit-node', idempotency_key: 'workflow:execution-1:edit-node', credit_cost: '15' }]);
    const replay = await POST(workflowRequest());
    expect(await replay.json()).toMatchObject({ success: true, taskId: localTaskId, reused: true });
    expect(boundary.sends).toHaveLength(1);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 85, total_used: 15 }]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cancelled = await cancelTaskPost(new NextRequest('http://localhost/api/cancel-task', {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ taskId: localTaskId }),
      }));
      expect(cancelled.status).toBe(200);
    }
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor' ORDER BY created_at")).rows)
      .toEqual([{ type: 'consume', amount: -15 }, { type: 'refund', amount: 15 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [localTaskId])).rows)
      .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
    expect(boundary.sends).toHaveLength(1);
  });
});

it('admits concurrent same-key outpaint only once before the provider accepts a task', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-concurrent-key', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    let firstProviderEntered!: () => void;
    const entered = new Promise<void>(resolve => { firstProviderEntered = resolve; });
    let releaseFirstProvider!: () => void;
    const released = new Promise<void>(resolve => { releaseFirstProvider = resolve; });
    let providerSends = 0;
    stubProviderFetch(async (input: string | URL | Request): Promise<Response> => {
      if (String(input) !== 'https://image-provider.invalid/v1/images/generations') {
        throw new Error(`Undeclared provider call: ${String(input)}`);
      }
      providerSends += 1;
      const sendNumber = providerSends;
      boundary.sends.push(String(input));
      if (sendNumber === 1) {
        firstProviderEntered();
        await released;
      }
      return Response.json({ task_id: `concurrent-outpaint-remote-${sendNumber}` });
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:concurrent-execution:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'concurrent-execution', messageId: 'concurrent-execution:edit-node',
        imageUrl: canonicalUrl, model: 'source-image::gpt-image-1', expandScale: 2 }),
    });
    const first = POST(makeRequest());
    await entered;
    const admissionBeforeReceipt = (await query(`SELECT
      (SELECT count(*)::int FROM cloud_tasks WHERE user_id='source-editor'
        AND idempotency_key='workflow:concurrent-execution:edit-node') AS tasks,
      (SELECT count(*)::int FROM wujie_credit_transactions WHERE user_id='source-editor'
        AND type='consume') AS charges`)).rows;
    let secondResponse: Response;
    try {
      secondResponse = await POST(makeRequest());
    } finally {
      releaseFirstProvider();
    }
    const firstResponse = await first;
    const firstBody = await firstResponse.json() as { taskId?: string };
    const secondBody = await secondResponse.json() as { taskId?: string };
    expect(admissionBeforeReceipt).toEqual([{ tasks: 1, charges: 1 }]);
    expect(boundary.sends).toHaveLength(1);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.taskId).toBeTruthy();
    expect(secondBody.taskId).toBe(firstBody.taskId);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 85, total_used: 15 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
    expect((await query("SELECT count(*)::int AS count FROM cloud_tasks WHERE user_id='source-editor' AND idempotency_key='workflow:concurrent-execution:edit-node'")).rows)
      .toEqual([{ count: 1 }]);
  });
});

it('keeps an uncertain outpaint provider send charged and never resubmits the same key', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-outpaint-unknown', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request): Promise<Response> => {
      if (String(input) !== 'https://image-provider.invalid/v1/images/generations') {
        throw new Error(`Undeclared provider call: ${String(input)}`);
      }
      boundary.sends.push(String(input));
      throw new Error('offline provider response lost after send');
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:outpaint-unknown:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'outpaint-unknown', messageId: 'outpaint-unknown:edit-node',
        imageUrl: canonicalUrl, model: 'source-image::gpt-image-1', expandScale: 2 }) });
    const first = await POST(makeRequest());
    const firstPayload = await first.json() as { taskId: string; status: string };
    expect(first.status).toBe(202);
    expect(firstPayload).toMatchObject({ success: true, taskId: expect.stringMatching(/^image-edit-/),
      status: 'submission-unknown' });
    const second = await POST(makeRequest());
    expect(await second.json()).toMatchObject({ success: true, taskId: firstPayload.taskId, reused: true });
    expect(boundary.sends).toHaveLength(1);
    expect((await query('SELECT status,remote_task_id,credit_status,result #>> $2 AS attempt FROM cloud_tasks WHERE id=$1',
      [firstPayload.taskId, '{imageEditExecution,phases,0,attempts,0,status}'])).rows)
      .toEqual([{ status: 'processing', remote_task_id: '', credit_status: 'pending', attempt: 'started' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
  });
});

it('recovers a direct outpaint result after the accepted response could not be persisted', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-direct-outpaint-restart', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') throw new Error(`Unexpected provider request: ${String(input)}`);
      boundary.sends.push(String(input));
      return Response.json({ data: [{ url: outputUrl }] });
    });
    const read = boundary.media.getMockImplementation();
    let outputReads = 0;
    let entered!: () => void;
    let release!: (value: Buffer) => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const heldImage = new Promise<Buffer>(resolve => { release = resolve; });
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url !== outputUrl) return read!(url);
      outputReads += 1;
      if (outputReads === 1) throw new Error('injected result download interruption');
      entered();
      return heldImage;
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submitted = await POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:direct-outpaint-restart:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'direct-restart', messageId: 'direct-restart:edit-node', imageUrl: canonicalUrl,
        model: 'source-image::gpt-image-1', expandScale: 3 }),
    }));
    const submission = await submitted.json();
    expect(submitted.status).toBe(202);
    expect(submission).toMatchObject({ success: true, status: 'submission-unknown',
      taskId: expect.stringMatching(/^image-edit-/) });
    const taskId = submission.taskId as string;
    expect((await query(`SELECT status,credit_status,remote_task_id,
      result #>> '{imageEditExecution,phases,0,attempts,0,result,directUrl}' AS accepted_url
      FROM cloud_tasks WHERE id=$1`, [taskId])).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending', remote_task_id: '', accepted_url: outputUrl }]);
    // Simulate a process death immediately after the accepted checkpoint.
    await query('UPDATE cloud_tasks SET lease_owner=$2,lease_expires_at=$3 WHERE id=$1',
      [taskId, 'dead-submitter', Date.now() + 90_000]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const pollRequest = (): NextRequest => new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1', providerId: 'source-image' }) });
    const stillOwned = await pollTask(pollRequest());
    expect(await stillOwned.json()).toMatchObject({ success: true, status: 'processing', recoveryPending: true });
    expect(outputReads).toBe(1);
    await query('UPDATE cloud_tasks SET lease_expires_at=1 WHERE id=$1', [taskId]);
    const resumedPromise = pollTask(pollRequest());
    let resumed: Response;
    try {
      await reading;
      const recovering = (await query('SELECT lease_owner,lease_expires_at FROM cloud_tasks WHERE id=$1', [taskId])).rows[0];
      expect(recovering.lease_owner).not.toBe('');
      expect(Number(recovering.lease_expires_at)).toBeLessThan(Date.now() + 120_000);
    } finally {
      release(managedSourceBytes);
      resumed = await resumedPromise;
    }
    const payload = await resumed.json();
    expect(resumed.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, status: 'completed' });
    expect(payload.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(await sharp(Buffer.from(payload.imageUrl.split(',')[1], 'base64')).metadata())
      .toMatchObject({ width: 96, height: 96 });
    expect(boundary.sends).toHaveLength(1);
    expect(outputReads).toBe(2);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
    const replay = await pollTask(pollRequest());
    expect(await replay.json()).toMatchObject({ success: true, status: 'completed' });
    expect(outputReads).toBe(2);
  });
});

it('keeps the submitting outpaint lease while a direct result is being saved', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-direct-outpaint-live-lease', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') throw new Error(`Unexpected provider request: ${String(input)}`);
      boundary.sends.push(String(input));
      return Response.json({ data: [{ url: outputUrl }] });
    });
    const read = boundary.media.getMockImplementation();
    let entered!: () => void;
    let release!: (value: Buffer) => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const heldImage = new Promise<Buffer>(resolve => { release = resolve; });
    let outputReads = 0;
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url !== outputUrl) return read!(url);
      outputReads += 1;
      entered();
      return heldImage;
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submissionPromise = POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:direct-outpaint-live-lease:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'direct-live', messageId: 'direct-live:edit-node', imageUrl: canonicalUrl,
        model: 'source-image::gpt-image-1', expandScale: 2 }),
    }));
    let submission: Response;
    try {
      await reading;
      // Observe one real heartbeat while provider output persistence is paused.
      await new Promise<void>(resolve => setTimeout(resolve, 31_000));
      const task = (await query(`SELECT id,status,credit_status,lease_owner,lease_expires_at,
        result #>> '{imageEditExecution,phases,0,attempts,0,result,directUrl}' AS accepted_url
        FROM cloud_tasks`)).rows[0];
      expect(task).toMatchObject({ status: 'processing', credit_status: 'pending', accepted_url: outputUrl });
      expect(task.lease_owner).not.toBe('');
      expect(Number(task.lease_expires_at)).toBeGreaterThan(Date.now() + 75_000);
      expect(Number(task.lease_expires_at)).toBeLessThan(Date.now() + 120_000);
      const { POST: pollTask } = await import('@/app/api/poll-task/route');
      const waiting = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
        body: JSON.stringify({ taskId: task.id, model: 'gpt-image-1', providerId: 'source-image' }) }));
      expect(await waiting.json()).toMatchObject({ success: true, status: 'processing', recoveryPending: true });
      expect(outputReads).toBe(1);
    } finally {
      release(managedSourceBytes);
      submission = await submissionPromise;
    }
    expect(submission.status).toBe(200);
    expect(await submission.json()).toMatchObject({ success: true, imageUrl: expect.any(String) });
    expect(boundary.sends).toHaveLength(1);
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
  });
}, 60_000);

it.each([
  { mode: 'unavailable', resultUrl: outputUrl },
  { mode: 'private', resultUrl: 'http://127.0.0.1/private.png' },
] as const)('backs off an accepted direct outpaint result when its URL is $mode', async ({ mode, resultUrl }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-direct-outpaint-backoff-${mode}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') throw new Error(`Unexpected provider request: ${String(input)}`);
      boundary.sends.push(String(input));
      return Response.json({ data: [{ url: resultUrl }] });
    });
    const read = boundary.media.getMockImplementation();
    let outputReads = 0;
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url !== resultUrl) return read!(url);
      outputReads += 1;
      throw new Error('result URL is unavailable');
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submitted = await POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:direct-outpaint-backoff:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'direct-backoff', messageId: 'direct-backoff:edit-node', imageUrl: canonicalUrl,
        model: 'source-image::gpt-image-1', expandScale: 2 }),
    }));
    const submission = await submitted.json();
    expect(submitted.status).toBe(202);
    const taskId = submission.taskId as string;
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const pollRequest = (): NextRequest => new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1', providerId: 'source-image' }) });
    expect(await (await pollTask(pollRequest())).json())
      .toMatchObject({ success: true, status: 'processing', recoveryPending: true });
    expect(outputReads).toBe(2);
    expect(await (await pollTask(pollRequest())).json())
      .toMatchObject({ success: true, status: 'processing', recoveryPending: true });
    expect(outputReads).toBe(2);
    expect(boundary.sends).toHaveLength(1);
    const delayed = (await query('SELECT status,credit_status,lease_owner,lease_expires_at FROM cloud_tasks WHERE id=$1', [taskId])).rows[0];
    expect(delayed).toMatchObject({ status: 'processing', credit_status: 'pending', lease_owner: '' });
    expect(Number(delayed.lease_expires_at)).toBeGreaterThan(Date.now());
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
  });
});

it('recovers a direct outpaint result even when its accepted fallback also has a remote task ID', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-direct-outpaint-dual-receipt', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    await query(`INSERT INTO wujie_api_providers
      (id,name,base_url,api_key,is_enabled,type,model_type,selected_models,created_at,updated_at)
      VALUES ('source-image','Offline Image','https://image-provider.invalid/v1','offline-image',true,
        'image','image',ARRAY['gpt-image-1'],1,1)`);
    const taskId = 'image-edit-local-dual-receipt';
    const digest = 'f'.repeat(64);
    const now = Date.now() - 60_000;
    await createBillableTask({ userId: 'source-editor', idempotencyKey: 'workflow:dual-receipt:edit-node',
      requestDigest: digest, creditCost: 15,
      task: { id: taskId, projectId: 'source-personal', type: 'image-edit', status: 'processing',
        providerId: 'source-image', model: 'gpt-image-1', remoteTaskId: 'remote-sidecar',
        progress: 10, label: '扩展画面',
        result: { imageEditAdmission: { version: 1, route: '/api/image-edit', kind: 'ordinary-outpaint' },
          outpaintInfo: { targetW: 96, targetH: 96, genW: 64, genH: 64 },
          imageEditExecution: { version: 1, requestDigest: digest, phases: [{
            phaseId: 'outpaint-submit', inputDigest: 'b'.repeat(64),
            targets: [{ providerId: 'source-image', modelId: 'gpt-image-1', kind: 'image' }],
            attempts: [{ attemptId: 'accepted-dual-receipt',
              identity: { providerId: 'source-image', modelId: 'gpt-image-1', kind: 'image' },
              endpoint: 'https://image-provider.invalid/v1/images/generations', method: 'POST',
              bodyDigest: 'c'.repeat(64), leaseOwner: 'previous-process', leaseAttempt: 1,
              status: 'accepted', result: { kind: 'image', taskId: 'remote-sidecar', directUrl: outputUrl } }],
          }] } },
        createdAt: now, updatedAt: now },
    });
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request): Promise<Response> => {
      boundary.sends.push(String(input));
      throw new Error(`Direct result must not poll the provider: ${String(input)}`);
    });
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const response = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1', providerId: 'source-image' }) }));
    const payload = await response.json();
    expect(payload).toMatchObject({ success: true, status: 'completed' });
    expect(payload.imageUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(await sharp(Buffer.from(payload.imageUrl.split(',')[1], 'base64')).metadata())
      .toMatchObject({ width: 96, height: 96 });
    expect(boundary.sends).toEqual([]);
    expect((await query('SELECT status,credit_status,remote_task_id FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged', remote_task_id: 'remote-sidecar' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
  });
});

it('rejects image-edit admission replay across task type or project even when the digest matches', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-atomic-scope', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const digest = 'd'.repeat(64);
    const key = 'workflow:scope-guard:edit-node';
    const now = Date.now();
    const task = { id: 'scope-guard-edit-task', projectId: 'source-shared', type: 'image-edit',
      status: 'processing' as const, progress: 0, createdAt: now, updatedAt: now };
    const admitted = await createBillableTask({ userId: 'source-editor', idempotencyKey: key,
      requestDigest: digest, creditCost: 15, task });
    expect(admitted).toMatchObject({ reused: false, charged: true });
    await expect(createBillableTask({ userId: 'source-editor', idempotencyKey: key,
      requestDigest: digest, creditCost: 15, task: { ...task, id: 'scope-guard-other-type', type: 'generate' } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(createBillableTask({ userId: 'source-editor', idempotencyKey: key,
      requestDigest: digest, creditCost: 15, task: { ...task, id: 'scope-guard-other-project', projectId: 'source-personal' } }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await query("SELECT id,type,project_id FROM cloud_tasks WHERE user_id='source-editor'")).rows)
      .toEqual([{ id: 'scope-guard-edit-task', type: 'image-edit', project_id: 'source-shared' }]);
    expect((await query("SELECT type,amount,task_id FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15, task_id: 'scope-guard-edit-task' }]);
  });
});

it('does not poll a local image-edit admission ID as a provider task before receipt', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-pre-receipt-poll', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    const now = Date.now() - 60_000;
    const taskId = 'image-edit-local-before-receipt';
    await createBillableTask({ userId: 'source-editor', idempotencyKey: 'workflow:pre-receipt:edit-node',
      requestDigest: 'e'.repeat(64), creditCost: 15,
      task: { id: taskId, projectId: 'source-personal', type: 'image-edit', status: 'processing',
        providerId: 'source-image', model: 'gpt-image-1', progress: 0, label: '扩展画面',
        result: { imageEditAdmission: { version: 1, route: '/api/image-edit', kind: 'ordinary-outpaint' } },
        createdAt: now, updatedAt: now },
    });
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request): Promise<Response> => {
      boundary.sends.push(String(input));
      throw new Error(`Premature provider poll: ${String(input)}`);
    });
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const response = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1' }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, taskId, status: 'processing', recoveryPending: true });
    expect(boundary.sends).toEqual([]);
    expect((await query("SELECT status,remote_task_id,credit_status FROM cloud_tasks WHERE id=$1", [taskId])).rows)
      .toEqual([{ status: 'processing', remote_task_id: '', credit_status: 'pending' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
  });
});

it('recovers an accepted outpaint receipt after remote ID writeback is lost', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-accepted-receipt-restart', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    await query(`INSERT INTO wujie_api_providers
      (id,name,base_url,api_key,is_enabled,type,model_type,selected_models,created_at,updated_at)
      VALUES ('source-image','Offline Image','https://image-provider.invalid/v1','offline-image',true,
        'image','image',ARRAY['gpt-image-1'],1,1)`);
    const taskId = 'image-edit-local-accepted-receipt';
    const digest = 'a'.repeat(64);
    const old = Date.now() - 60_000;
    await createBillableTask({ userId: 'source-editor', idempotencyKey: 'workflow:accepted-receipt:edit-node',
      requestDigest: digest, creditCost: 15,
      task: { id: taskId, projectId: 'source-personal', type: 'image-edit', status: 'processing',
        providerId: 'source-image', model: 'gpt-image-1', progress: 10, label: '扩展画面',
        result: { imageEditAdmission: { version: 1, route: '/api/image-edit', kind: 'ordinary-outpaint' },
          outpaintInfo: { targetW: 96, targetH: 96, genW: 64, genH: 64 },
          imageEditExecution: { version: 1, requestDigest: digest, phases: [{
            phaseId: 'outpaint-submit', inputDigest: 'b'.repeat(64),
            targets: [{ providerId: 'source-image', modelId: 'gpt-image-1', kind: 'image' }],
            attempts: [{ attemptId: 'accepted-outpaint-attempt',
              identity: { providerId: 'source-image', modelId: 'gpt-image-1', kind: 'image' },
              endpoint: 'https://image-provider.invalid/v1/images/edits', method: 'POST',
              bodyDigest: 'c'.repeat(64), leaseOwner: 'previous-process', leaseAttempt: 1,
              status: 'accepted', result: { kind: 'image', taskId: 'remote-accepted-outpaint' } }],
          }] } },
        createdAt: old, updatedAt: old },
    });
    expect(await claimCloudTaskLease(taskId, 'previous-process', 30 * 60_000)).not.toBeNull();
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      boundary.sends.push(String(input));
      if (init?.method === 'POST' || String(input) !== 'https://image-provider.invalid/v1/tasks/remote-accepted-outpaint') {
        throw new Error(`Unexpected provider request: ${String(input)}`);
      }
      return Response.json({ status: 'completed', imageUrl: outputUrl });
    });
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const first = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1', providerId: 'source-image' }) }));
    expect(await first.json()).toMatchObject({ success: true, status: 'processing', recoveryPending: true });
    expect(boundary.sends).toEqual([]);
    expect((await query('SELECT remote_task_id,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ remote_task_id: 'remote-accepted-outpaint', credit_status: 'pending' }]);
    await query('UPDATE cloud_tasks SET lease_expires_at=$2, updated_at=$2 WHERE id=$1',
      [taskId, Date.now() - 60_000]);
    const response = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1', providerId: 'source-image' }) }));
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, status: 'completed', targetWidth: 96, targetHeight: 96 });
    expect(boundary.sends).toEqual(['https://image-provider.invalid/v1/tasks/remote-accepted-outpaint']);
    expect((await query('SELECT status,remote_task_id,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'completed', remote_task_id: 'remote-accepted-outpaint', credit_status: 'charged' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
  });
});

it('recovers an accepted outpaint using the remote ID and persisted resize target', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-outpaint-restart', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    await query(`INSERT INTO wujie_api_providers
      (id,name,base_url,api_key,is_enabled,type,model_type,selected_models,created_at,updated_at)
      VALUES ('source-image','Offline Image','https://image-provider.invalid/v1','offline-image',true,
        'image','image',ARRAY['gpt-image-1'],1,1)`);
    const taskId = 'image-edit-local-restart';
    const old = Date.now() - 60_000;
    await createBillableTask({ userId: 'source-editor', idempotencyKey: 'workflow:outpaint-restart:edit-node',
      requestDigest: 'f'.repeat(64), creditCost: 15,
      task: { id: taskId, projectId: 'source-personal', type: 'image-edit', status: 'processing',
        providerId: 'source-image', model: 'gpt-image-1', remoteTaskId: 'remote-outpaint-restart',
        progress: 10, label: '扩展画面',
        result: { imageEditAdmission: { version: 1, route: '/api/image-edit', kind: 'ordinary-outpaint' },
          outpaintInfo: { targetW: 96, targetH: 96, genW: 64, genH: 64 } },
        createdAt: old, updatedAt: old },
    });
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      boundary.sends.push(String(input));
      if (init?.method === 'POST' || String(input) !== 'https://image-provider.invalid/v1/tasks/remote-outpaint-restart') {
        throw new Error(`Unexpected provider request: ${String(input)}`);
      }
      return Response.json({ status: 'completed', imageUrl: outputUrl });
    });
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const response = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId, model: 'gpt-image-1', providerId: 'source-image' }) }));
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, status: 'completed', targetWidth: 96, targetHeight: 96 });
    expect(boundary.sends).toEqual(['https://image-provider.invalid/v1/tasks/remote-outpaint-restart']);
    expect((await query('SELECT status,remote_task_id,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'completed', remote_task_id: 'remote-outpaint-restart', credit_status: 'charged' }]);
  });
});

it('refunds a charged workflow outpaint child once when provider polling fails in the submitting process', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-workflow-poll-failure', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        boundary.sends.push(String(input));
        return Response.json({ task_id: 'task_workflow_internal_outpaint_failed' });
      }
      if (String(input).includes('task_workflow_internal_outpaint_failed')) {
        return Response.json({ status: 'failed', fail_reason: 'offline provider rejected edit' });
      }
      throw new Error(`Undeclared provider call: ${String(input)}`);
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submitted = await POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:execution-2:edit-node' },
      body: JSON.stringify({ action: 'extend', projectId: 'source-personal',
        sessionId: 'execution-2', messageId: 'execution-2:edit-node',
        imageUrl: canonicalUrl, model: 'source-image::gpt-image-1', expandScale: 2 }),
    }));
    const submittedPayload = await submitted.json();
    expect(submittedPayload).toMatchObject({ success: true, taskId: expect.stringMatching(/^image-edit-/) });
    const localTaskId = submittedPayload.taskId as string;
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId: localTaskId, model: 'gpt-image-1', providerId: 'source-image' }),
    }));
    const pollPayload = await polled.json();
    expect(pollPayload, JSON.stringify(pollPayload)).toMatchObject({ success: false, status: 'failed' });
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [localTaskId])).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor' ORDER BY created_at")).rows)
      .toEqual([{ type: 'consume', amount: -15 }, { type: 'refund', amount: 15 }]);
    expect(boundary.sends).toHaveLength(1);
  });
});

it('keeps the charged erase child identity when server-side polling hands off to the client', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-erase-poll-handoff', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const maskUrl = '/api/serve-upload/erase-mask.png';
    const maskPixels = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskPixels.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const maskBytes = await sharp(maskPixels, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const sourceBytes = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return sourceBytes;
      if (url === maskUrl) return maskBytes;
      throw new Error(`Undeclared image read: ${url}`);
    });
    let providerPolls = 0;
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        boundary.sends.push(String(input));
        return Response.json({ task_id: 'task_workflow_erase_handoff' });
      }
      if (String(input).includes('task_workflow_erase_handoff')) {
        providerPolls += 1;
        return Response.json({ status: 'failed', fail_reason: 'offline erase rejected' });
      }
      throw new Error(`Undeclared provider call: ${String(input)}`);
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submitted = await POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:execution-erase:edit-node' },
      body: JSON.stringify({ action: 'erase', editMode: 'erase', projectId: 'source-personal',
        sessionId: 'execution-erase', messageId: 'execution-erase:edit-node',
        imageUrl: canonicalUrl, maskImage: maskUrl, model: 'source-image::gpt-image-1' }),
    }));
    const submittedPayload = await submitted.json() as { success: boolean; taskId: string };
    expect(submittedPayload).toMatchObject({ success: true });
    expect(submittedPayload.taskId).toMatch(/^image-edit-/);
    expect((await query('SELECT id,remote_task_id,credit_cost::int AS credit_cost FROM cloud_tasks')).rows)
      .toEqual([{ id: submittedPayload.taskId, remote_task_id: 'task_workflow_erase_handoff', credit_cost: 15 }]);
    expect(getTaskInfo(submittedPayload.taskId)?.creditCost).toBe(15);
    const beforePoll = (await query('SELECT request_digest,result,lease_owner,lease_expires_at,status,credit_status,project_id FROM cloud_tasks WHERE id=$1',
      [submittedPayload.taskId])).rows[0];
    const { readAcceptedImageEditPhaseResult } = await import('@/lib/task-core/image-edit-provider-checkpoint');
    expect(readAcceptedImageEditPhaseResult(beforePoll.result, beforePoll.request_digest,
      'inpaint-erase-submit'), JSON.stringify(beforePoll)).toMatchObject({
        identity: { kind: 'image', providerId: 'source-image', modelId: 'gpt-image-1' },
        result: { kind: 'image', taskId: 'task_workflow_erase_handoff' },
      });
    expect(beforePoll.lease_owner).toBe('');
    expect(beforePoll).toMatchObject({ status: 'processing', credit_status: 'pending', project_id: 'source-personal', lease_expires_at: '0' });
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId: submittedPayload.taskId, model: 'gpt-image-1', providerId: 'source-image' }),
    }));
    const pollPayload = await polled.json();
    expect(providerPolls, JSON.stringify(pollPayload)).toBe(1);
    expect(pollPayload, JSON.stringify(pollPayload)).toMatchObject({ success: false, status: 'failed' });
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [submittedPayload.taskId])).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor' ORDER BY created_at")).rows)
      .toEqual([{ type: 'consume', amount: -15 }, { type: 'refund', amount: 15 }]);
    expect(boundary.sends).toHaveLength(1);
    expect(providerPolls).toBe(1);
  });
});

it('completes a direct mask result on the admitted task with managed masked pixels', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-direct-managed', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const source = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const maskRaw = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const providerImage = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#ff0000' } }).png().toBuffer();
    const maskUrl = '/api/serve-upload/mask-direct.png';
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return source;
      if (url === maskUrl) return mask;
      if (url === outputUrl) return providerImage;
      throw new Error(`Undeclared image read: ${url}`);
    });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://image-provider.invalid/v1/images/generations' || init?.method !== 'POST') {
        throw new Error(`Undeclared provider call: ${String(input)}`);
      }
      boundary.sends.push(String(input));
      return Response.json({ data: [{ url: outputUrl }] });
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submitted = await POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:mask-direct:edit-node' },
      body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-personal',
        sessionId: 'mask-direct', messageId: 'mask-direct:edit-node', prompt: 'Make center red',
        imageUrl: canonicalUrl, maskImage: maskUrl, model: 'source-image::gpt-image-1' }),
    }));
    const payload = await submitted.json() as { success?: boolean; taskId?: string; imageUrl?: string };
    expect(submitted.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, taskId: expect.stringMatching(/^image-edit-/),
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\//) });
    expect(boundary.sends).toHaveLength(1);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query('SELECT count(*)::int AS total FROM cloud_tasks')).rows).toEqual([{ total: 1 }]);
    expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
      .toEqual([{ total: 0 }]);
    const output = await readFile(resolve(process.env.WUJIE_DATA_DIR!, payload.imageUrl!.slice('/api/serve-upload/'.length)));
    const pixels = await sharp(output).removeAlpha().raw().toBuffer();
    expect([...pixels.subarray(0, 3)]).toEqual([0x34, 0x56, 0x78]);
    const center = (16 * 32 + 16) * 3;
    expect([...pixels.subarray(center, center + 3)]).toEqual([255, 0, 0]);
  });
});

it.each(['editor', 'placement', 'selected-placement', 'project'] as const)(
  'does not complete an accepted document mask after %s access is withdrawn', async revoked => {
    await withIsolatedPostgres(`task-image-edit-source-mask-late-${revoked}`,
      async ({ query, databaseUrl, schemaName }): Promise<void> => {
        await seed(query, databaseUrl, schemaName);
        if (revoked === 'placement' || revoked === 'selected-placement') {
          await query(`INSERT INTO wujie_workspace_placements
            (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
            VALUES ('source-placement-z','source-owner','source-shared','source-asset','source-version',
              'canvas','source-shared','canvas-image','source-image-z')`);
          await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,
            '{placements,source-placement-z}',$1::jsonb) WHERE project_id='source-shared'`,
          [JSON.stringify({ assetVersionId: 'source-version', x: 100, y: 0,
            width: 32, height: 32, rotation: 0, zIndex: 1 })]);
        }
        await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
          [JSON.stringify({ modelCredits: { 'gpt-image-1': 7 } })]);
        boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image',
          modelType: 'image', isEnabled: true, baseUrl: 'https://image-provider.invalid/v1',
          apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
        const source = await sharp({ create: { width: 32, height: 32, channels: 3,
          background: '#345678' } }).png().toBuffer();
        const maskRaw = Buffer.alloc(32 * 32 * 3);
        for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
          maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
        }
        const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
        const edited = await sharp({ create: { width: 32, height: 32, channels: 3,
          background: '#ff0000' } }).png().toBuffer();
        const maskUrl = '/api/serve-upload/document-mask-late.png';
        boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
          if (url === canonicalUrl) return source;
          if (url === maskUrl) return mask;
          if (url === outputUrl) return edited;
          throw new Error(`Undeclared image read: ${url}`);
        });
        stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          if (String(input) !== 'https://image-provider.invalid/v1/images/generations'
            || init?.method !== 'POST') throw new Error(`Undeclared provider call: ${String(input)}`);
          boundary.sends.push(String(input));
          if (revoked === 'editor') {
            await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
          } else if (revoked === 'placement' || revoked === 'selected-placement') {
            await query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now() WHERE id=$1",
              [revoked === 'selected-placement' ? 'source-placement-z' : 'source-placement']);
          } else {
            await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='source-shared'");
          }
          return Response.json({ data: [{ url: outputUrl }] });
        });
        const headers = await getInternalRequestHeaders('source-editor');
        const response = await POST(new NextRequest('http://localhost/api/image-edit', { method: 'POST',
          headers: { 'content-type': 'application/json', ...headers,
            'idempotency-key': `workflow:document-mask-late-${revoked}:edit-node` },
          body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-shared',
            assetParentVersionIds: ['source-version'], sessionId: `document-mask-late-${revoked}`,
            ...(revoked === 'selected-placement' ? { assetSourcePlacementId: 'source-placement-z' } : {}),
            messageId: `document-mask-late-${revoked}:edit-node`, prompt: 'Make center red',
            imageUrl: canonicalUrl, maskImage: maskUrl, model: 'source-image::gpt-image-1' }),
        }));
        const payload = await response.json() as { imageUrl?: string; taskId?: string };
        expect(boundary.sends).toHaveLength(1);
        expect(payload.imageUrl).toBeUndefined();
        expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
          .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
        expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
          .toEqual([{ balance: 100, total_used: 0 }]);
        expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor' ORDER BY created_at,id")).rows)
          .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
      });
  }, 60_000);

async function prepareDocumentMaskMedia(): Promise<string> {
  boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image',
    modelType: 'image', isEnabled: true, baseUrl: 'https://image-provider.invalid/v1',
    apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
  const source = await sharp({ create: { width: 32, height: 32, channels: 3,
    background: '#345678' } }).png().toBuffer();
  const maskRaw = Buffer.alloc(32 * 32 * 3);
  for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
    maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
  }
  const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
  const edited = await sharp({ create: { width: 32, height: 32, channels: 3,
    background: '#ff0000' } }).png().toBuffer();
  const maskUrl = '/api/serve-upload/document-mask-recovery.png';
  boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
    if (url === canonicalUrl) return source;
    if (url === maskUrl) return mask;
    if (url === outputUrl) return edited;
    throw new Error(`Undeclared image read: ${url}`);
  });
  return maskUrl;
}

it('completes an authorized document mask with its frozen source placement', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-document-authorized',
    async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const maskUrl = await prepareDocumentMaskMedia();
      stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(input) !== 'https://image-provider.invalid/v1/images/generations'
          || init?.method !== 'POST') throw new Error(`Undeclared provider call: ${String(input)}`);
        boundary.sends.push(String(input));
        return Response.json({ data: [{ url: outputUrl }] });
      });
      const response = await POST(request({ action: 'mask', editMode: 'mask', projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, maskImage: maskUrl,
        prompt: 'Make center red', model: 'source-image::gpt-image-1' },
      'source-editor', 'document-mask-authorized'));
      const payload = await response.json() as { taskId?: string; imageUrl?: string };
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload).toMatchObject({ taskId: expect.stringMatching(/^image-edit-/),
        imageUrl: expect.stringMatching(/^\/api\/serve-upload\/exports\//) });
      expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
        .toEqual([{ status: 'completed', credit_status: 'charged' }]);
      expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
        .toEqual([{ total: 0 }]);
      expect(boundary.sends).toHaveLength(1);
      expect((await query(`SELECT result #>> '{imageEditAdmission,documentSourcePlacementId}' AS placement_id,
        result #>> '{imageEditAdmission,documentSourceVersionId}' AS version_id
        FROM cloud_tasks WHERE id=$1`, [payload.taskId])).rows)
        .toEqual([{ placement_id: 'source-placement', version_id: 'source-version' }]);
      const validReplay = await POST(request({ action: 'mask', editMode: 'mask',
        projectId: 'source-shared', assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
        maskImage: maskUrl, prompt: 'Make center red', model: 'source-image::gpt-image-1' },
      'source-editor', 'document-mask-authorized'));
      expect(validReplay.status).toBe(200);
      expect((await validReplay.json()).imageUrl).toBe(payload.imageUrl);
      expect(boundary.sends).toHaveLength(1);
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      const { POST: pollTask } = await import('@/app/api/poll-task/route');
      const afterRevocation = await pollTask(new NextRequest('http://localhost/api/poll-task', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
        body: JSON.stringify({ taskId: payload.taskId }),
      }));
      expect(afterRevocation.status).toBe(403);
      expect((await afterRevocation.json()).imageUrl).toBeUndefined();
      const recoverRevoked = await recoverTaskGet(new NextRequest(
        'http://localhost/api/tasks/recover?projectId=source-shared',
        { headers: { 'x-test-actor': 'source-editor' } }));
      expect(recoverRevoked.status).toBe(403);
      expect(JSON.stringify(await recoverRevoked.json())).not.toContain(payload.imageUrl!);
      await query(`UPDATE wujie_project_document_editors
        SET status='active',grant_generation=grant_generation+1 WHERE member_user_id='source-editor'`);
      const afterNewGrant = await pollTask(new NextRequest('http://localhost/api/poll-task', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
        body: JSON.stringify({ taskId: payload.taskId }),
      }));
      expect(afterNewGrant.status).toBe(403);
      expect((await afterNewGrant.json()).imageUrl).toBeUndefined();
      const recoverNewGrant = await recoverTaskGet(new NextRequest(
        'http://localhost/api/tasks/recover?projectId=source-shared',
        { headers: { 'x-test-actor': 'source-editor' } }));
      expect(recoverNewGrant.status).toBe(200);
      expect(JSON.stringify(await recoverNewGrant.json())).not.toContain(payload.imageUrl!);
      const replayNewGrant = await POST(request({ action: 'mask', editMode: 'mask',
        projectId: 'source-shared', assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
        maskImage: maskUrl, prompt: 'Make center red', model: 'source-image::gpt-image-1' },
      'source-editor', 'document-mask-authorized'));
      const replayPayload = await replayNewGrant.json() as { imageUrl?: string };
      expect(replayNewGrant.status).toBe(403);
      expect(replayPayload.imageUrl).toBeUndefined();
      expect(boundary.sends).toHaveLength(1);
    });
}, 60_000);

it.each(['before', 'after'] as const)(
  'keeps one charged document mask when its terminal COMMIT response is lost %s commit', async timing => {
    await withIsolatedPostgres(`task-image-edit-source-mask-commit-${timing}`,
      async ({ query, databaseUrl, schemaName }): Promise<void> => {
        await seed(query, databaseUrl, schemaName);
        await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
          [JSON.stringify({ modelCredits: { 'gpt-image-1': 7 } })]);
        const maskUrl = await prepareDocumentMaskMedia();
        stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          if (String(input) !== 'https://image-provider.invalid/v1/images/generations'
            || init?.method !== 'POST') throw new Error(`Undeclared provider call: ${String(input)}`);
          boundary.sends.push(String(input));
          return Response.json({ data: [{ url: outputUrl }] });
        });
        let lost = false;
        const completedClients = new WeakSet<Client>();
        const originalQuery = Client.prototype.query;
        const hook = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client,
          ...args: unknown[]) {
          const run = originalQuery as (this: Client, ...queryArgs: unknown[]) => unknown;
          if (args[0] === 'COMMIT' && completedClients.has(this) && !lost && timing === 'before') {
            lost = true;
            throw new Error('simulated COMMIT failure before durable commit');
          }
          const pending = run.apply(this, args);
          if (typeof args[0] !== 'string' || !pending
            || typeof (pending as Promise<unknown>).then !== 'function') return pending;
          const sql = args[0];
          return (pending as Promise<unknown>).then(value => {
            if (sql.includes('UPDATE cloud_tasks') && sql.includes("status = 'completed'")) {
              completedClients.add(this);
            }
            if (sql === 'COMMIT' && completedClients.has(this) && !lost && timing === 'after') {
              lost = true;
              throw new Error('simulated lost COMMIT response after durable commit');
            }
            return value;
          });
        } as typeof Client.prototype.query);
        try {
          const submitted = await POST(request({ action: 'mask', editMode: 'mask',
            projectId: 'source-shared', assetParentVersionIds: ['source-version'],
            imageUrl: canonicalUrl, maskImage: maskUrl, prompt: 'Make center red',
            model: 'source-image::gpt-image-1' }, 'source-editor', `document-mask-commit-${timing}`));
          const payload = await submitted.json() as { taskId?: string; imageUrl?: string; recoveryPending?: boolean };
          expect(lost).toBe(true);
          expect(submitted.status, JSON.stringify(payload)).toBe(timing === 'after' ? 200 : 202);
          expect(payload.taskId).toMatch(/^image-edit-/);
          expect(payload.imageUrl).toEqual(timing === 'after'
            ? expect.stringMatching(/^\/api\/serve-upload\/exports\//) : undefined);
          expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
            .toEqual([timing === 'after'
              ? { status: 'completed', credit_status: 'charged' }
              : { status: 'processing', credit_status: 'pending' }]);
          expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
            .toEqual([{ type: 'consume', amount: -7 }]);
          expect(boundary.sends).toHaveLength(1);
          if (timing === 'before') {
            const { POST: pollTask } = await import('@/app/api/poll-task/route');
            const recovered = await pollTask(new NextRequest('http://localhost/api/poll-task', {
              method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
              body: JSON.stringify({ taskId: payload.taskId }),
            }));
            expect(recovered.status, await recovered.clone().text()).toBe(200);
            expect((await recovered.json()).imageUrl).toMatch(/^\/api\/serve-upload\/exports\//);
            expect(boundary.sends).toHaveLength(1);
            expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
              .toEqual([{ status: 'completed', credit_status: 'charged' }]);
            expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
              .toEqual([{ type: 'consume', amount: -7 }]);
          }
        } finally { hook.mockRestore(); }
      });
  }, 60_000);

it('fences a stale document mask worker after lease takeover and resumes the accepted result once',
  async (): Promise<void> => {
    await withIsolatedPostgres('task-image-edit-source-mask-lease-takeover',
      async ({ query, databaseUrl, schemaName }): Promise<void> => {
        await seed(query, databaseUrl, schemaName);
        await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
          [JSON.stringify({ modelCredits: { 'gpt-image-1': 7 } })]);
        const maskUrl = await prepareDocumentMaskMedia();
        const readMedia = boundary.media.getMockImplementation();
        let stolenTaskId = '';
        boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
          if (url === outputUrl && !stolenTaskId) {
            stolenTaskId = String((await query('SELECT id FROM cloud_tasks')).rows[0]?.id || '');
            expect(stolenTaskId).toMatch(/^image-edit-/);
            await query('UPDATE cloud_tasks SET lease_expires_at=0 WHERE id=$1', [stolenTaskId]);
            const { claimCloudTaskLease } = await import('@/lib/cloud-task-storage');
            expect(await claimCloudTaskLease(stolenTaskId, 'takeover-worker', 60_000)).not.toBeNull();
          }
          if (!readMedia) throw new Error('Missing media test boundary');
          return readMedia(url);
        });
        stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          if (String(input) !== 'https://image-provider.invalid/v1/images/generations'
            || init?.method !== 'POST') throw new Error(`Undeclared provider call: ${String(input)}`);
          boundary.sends.push(String(input));
          return Response.json({ data: [{ url: outputUrl }] });
        });
        const submitted = await POST(request({ action: 'mask', editMode: 'mask',
          projectId: 'source-shared', assetParentVersionIds: ['source-version'],
          imageUrl: canonicalUrl, maskImage: maskUrl, prompt: 'Make center red',
          model: 'source-image::gpt-image-1' }, 'source-editor', 'document-mask-lease-takeover'));
        const payload = await submitted.json() as { taskId?: string; imageUrl?: string; recoveryPending?: boolean };
        expect(submitted.status, JSON.stringify(payload)).toBe(202);
        expect(payload).toMatchObject({ taskId: stolenTaskId, recoveryPending: true });
        expect(payload.imageUrl).toBeUndefined();
        expect((await query('SELECT status,credit_status,lease_owner FROM cloud_tasks WHERE id=$1',
          [stolenTaskId])).rows).toEqual([{ status: 'processing', credit_status: 'pending',
          lease_owner: 'takeover-worker' }]);
        const { POST: pollTask } = await import('@/app/api/poll-task/route');
        const poll = () => pollTask(new NextRequest('http://localhost/api/poll-task', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
          body: JSON.stringify({ taskId: stolenTaskId }),
        }));
        const stillLeased = await poll();
        expect((await stillLeased.json()).imageUrl).toBeUndefined();
        expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1',
          [stolenTaskId])).rows).toEqual([{ status: 'processing', credit_status: 'pending' }]);
        await query('UPDATE cloud_tasks SET lease_expires_at=0 WHERE id=$1', [stolenTaskId]);
        const recovered = await poll();
        const result = await recovered.json() as { imageUrl?: string; status?: string };
        expect(recovered.status, JSON.stringify(result)).toBe(200);
        expect(result).toMatchObject({ status: 'completed',
          imageUrl: expect.stringMatching(/^\/api\/serve-upload\/exports\//) });
        expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1',
          [stolenTaskId])).rows).toEqual([{ status: 'completed', credit_status: 'charged' }]);
        expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
          .toEqual([{ type: 'consume', amount: -7 }]);
        expect(boundary.sends).toHaveLength(1);
      });
  }, 60_000);

it('does not recover an accepted async document mask after the editor is revoked', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-document-async-revoked',
    async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
        [JSON.stringify({ modelCredits: { 'gpt-image-1': 7 } })]);
      const maskUrl = await prepareDocumentMaskMedia();
      let polls = 0;
      stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(input) === 'https://image-provider.invalid/v1/images/generations' && init?.method === 'POST') {
          boundary.sends.push(String(input));
          return Response.json({ task_id: 'remote-document-mask-revoked' });
        }
        if (String(input).includes('remote-document-mask-revoked') && init?.method === 'GET') {
          polls += 1;
          return Response.json({ status: 'completed', result: { image_url: outputUrl } });
        }
        throw new Error(`Undeclared provider call: ${String(input)}`);
      });
      const submitted = await POST(request({ action: 'mask', editMode: 'mask', projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, maskImage: maskUrl,
        prompt: 'Make center red', model: 'source-image::gpt-image-1' },
      'source-editor', 'document-mask-async-revoked'));
      const admission = await submitted.json() as { taskId?: string; imageUrl?: string };
      expect(admission.taskId).toMatch(/^image-edit-/);
      expect(admission.imageUrl).toBeUndefined();
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      const { POST: pollTask } = await import('@/app/api/poll-task/route');
      const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
        body: JSON.stringify({ taskId: admission.taskId, model: 'wrong-model', providerId: 'wrong-provider' }) }));
      const payload = await polled.json() as { imageUrl?: string; status?: string };
      expect(payload.imageUrl).toBeUndefined();
      expect(payload.status).toBe('failed');
      expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [admission.taskId])).rows)
        .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
        .toEqual([{ balance: 100, total_used: 0 }]);
      expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor' ORDER BY created_at,id")).rows)
        .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
      expect(boundary.sends).toHaveLength(1);
      expect(polls).toBe(1);
    });
}, 60_000);

it('keeps an accepted document mask pending when its frozen source snapshot is missing', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-document-snapshot-missing',
    async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const maskUrl = await prepareDocumentMaskMedia();
      stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (String(input) === 'https://image-provider.invalid/v1/images/generations' && init?.method === 'POST') {
          boundary.sends.push(String(input));
          return Response.json({ task_id: 'remote-document-mask-snapshot-missing' });
        }
        if (String(input).includes('remote-document-mask-snapshot-missing') && init?.method === 'GET') {
          return Response.json({ status: 'completed', result: { image_url: outputUrl } });
        }
        throw new Error(`Undeclared provider call: ${String(input)}`);
      });
      const submitted = await POST(request({ action: 'mask', editMode: 'mask', projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, maskImage: maskUrl,
        prompt: 'Make center red', model: 'source-image::gpt-image-1' },
      'source-editor', 'document-mask-snapshot-missing'));
      const admission = await submitted.json() as { taskId?: string };
      expect(admission.taskId).toMatch(/^image-edit-/);
      await query(`UPDATE wujie_image_edit_private_inputs SET
        document_owner_id=NULL,document_grant_generation=NULL,document_source_version_id=NULL,
        document_source_placement_id=NULL,document_canonical_url=NULL,document_origin=NULL
        WHERE task_id=$1`, [admission.taskId]);
      const { POST: pollTask } = await import('@/app/api/poll-task/route');
      const response = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
        body: JSON.stringify({ taskId: admission.taskId }),
      }));
      const result = await response.json() as { imageUrl?: string; recoveryPending?: boolean; status?: string };
      expect(result).toMatchObject({ status: 'processing', recoveryPending: true });
      expect(result.imageUrl).toBeUndefined();
      expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [admission.taskId])).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
      expect(boundary.sends).toHaveLength(1);
    });
}, 60_000);

it('does not deliver a direct document mask when its frozen source disappears after provider acceptance',
  async (): Promise<void> => {
    await withIsolatedPostgres('task-image-edit-source-mask-direct-snapshot-missing',
      async ({ query, databaseUrl, schemaName }): Promise<void> => {
        await seed(query, databaseUrl, schemaName);
        await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
          [JSON.stringify({ modelCredits: { 'gpt-image-1': 7 } })]);
        const maskUrl = await prepareDocumentMaskMedia();
        const readMedia = boundary.media.getMockImplementation();
        let removed = false;
        boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
          if (url === outputUrl && !removed) {
            removed = true;
            await query(`UPDATE wujie_image_edit_private_inputs SET
              document_owner_id=NULL,document_grant_generation=NULL,document_source_version_id=NULL,
              document_source_placement_id=NULL,document_canonical_url=NULL,document_origin=NULL`);
          }
          if (!readMedia) throw new Error('Missing media test boundary');
          return readMedia(url);
        });
        stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          if (String(input) !== 'https://image-provider.invalid/v1/images/generations'
            || init?.method !== 'POST') throw new Error(`Undeclared provider call: ${String(input)}`);
          boundary.sends.push(String(input));
          return Response.json({ data: [{ url: outputUrl }] });
        });
        const response = await POST(request({ action: 'mask', editMode: 'mask',
          projectId: 'source-shared', assetParentVersionIds: ['source-version'],
          imageUrl: canonicalUrl, maskImage: maskUrl, prompt: 'Make center red',
          model: 'source-image::gpt-image-1' }, 'source-editor', 'document-mask-direct-snapshot-missing'));
        const payload = await response.json() as { taskId?: string; imageUrl?: string; recoveryPending?: boolean };
        expect(removed).toBe(true);
        expect(response.status, JSON.stringify(payload)).toBe(202);
        expect(payload).toMatchObject({ taskId: expect.stringMatching(/^image-edit-/),
          recoveryPending: true });
        expect(payload.imageUrl).toBeUndefined();
        expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
          .toEqual([{ status: 'processing', credit_status: 'pending' }]);
        expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
          .toEqual([{ type: 'consume', amount: -7 }]);
        const { POST: pollTask } = await import('@/app/api/poll-task/route');
        const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
          body: JSON.stringify({ taskId: payload.taskId }),
        }));
        expect((await polled.json()).imageUrl).toBeUndefined();
        expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
          .toEqual([{ status: 'processing', credit_status: 'pending' }]);
        expect(boundary.sends).toHaveLength(1);
      });
  }, 60_000);

it('recovers an accepted direct mask result after the first image download fails without re-submitting', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-direct-recovery', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const source = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const maskRaw = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const edited = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#ff0000' } }).png().toBuffer();
    const maskUrl = '/api/serve-upload/mask-direct-recovery.png';
    let outputReads = 0;
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return source;
      if (url === maskUrl) return mask;
      if (url === outputUrl) {
        outputReads += 1;
        if (outputReads === 1) throw new Error('offline accepted-result download interruption');
        return edited;
      }
      throw new Error(`Undeclared image read: ${url}`);
    });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://image-provider.invalid/v1/images/generations' || init?.method !== 'POST') {
        throw new Error(`Undeclared provider call: ${String(input)}`);
      }
      boundary.sends.push(String(input));
      return Response.json({ data: [{ url: outputUrl }] });
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const request = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:mask-direct-recovery:edit-node' },
      body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-personal',
        sessionId: 'mask-direct-recovery', messageId: 'mask-direct-recovery:edit-node',
        prompt: 'Make center red', imageUrl: canonicalUrl, maskImage: maskUrl,
        model: 'source-image::gpt-image-1' }),
    });
    const submitted = await POST(request());
    const payload = await submitted.json() as { taskId?: string; recoveryPending?: boolean };
    expect(submitted.status, JSON.stringify(payload)).toBe(202);
    expect(payload).toMatchObject({ taskId: expect.stringMatching(/^image-edit-/), recoveryPending: true });
    expect((await query('SELECT status,credit_status,remote_task_id FROM cloud_tasks WHERE id=$1',
      [payload.taskId])).rows).toEqual([{ status: 'processing', credit_status: 'pending', remote_task_id: '' }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId: payload.taskId, model: 'wrong-client-model', providerId: 'wrong-client-provider' }),
    }));
    const recovered = await polled.json() as { status?: string; imageUrl?: string; taskId?: string };
    expect(recovered, JSON.stringify(recovered)).toMatchObject({ status: 'completed', taskId: payload.taskId,
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\//) });
    expect(outputReads).toBe(2);
    expect(boundary.sends).toHaveLength(1);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
      .toEqual([{ total: 0 }]);
    const replay = await POST(request());
    expect((await replay.json()).taskId).toBe(payload.taskId);
    expect(boundary.sends).toHaveLength(1);
  });
});

it('resumes an accepted async mask result on the same charged task', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-async-managed', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const source = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const maskRaw = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const providerImage = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#ff0000' } }).png().toBuffer();
    const maskUrl = '/api/serve-upload/mask-async.png';
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return source;
      if (url === maskUrl) return mask;
      if (url === outputUrl) return providerImage;
      throw new Error(`Undeclared image read: ${url}`);
    });
    let providerPolls = 0;
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        boundary.sends.push(String(input));
        return Response.json({ task_id: 'task_mask_async_managed' });
      }
      if (String(input).includes('task_mask_async_managed')) {
        providerPolls += 1;
        return Response.json({ status: 'completed', result: { image_url: outputUrl } });
      }
      throw new Error(`Undeclared provider call: ${String(input)}`);
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const request = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:mask-async:edit-node' },
      body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-personal',
        sessionId: 'mask-async', messageId: 'mask-async:edit-node', prompt: 'Make center red',
        imageUrl: canonicalUrl, maskImage: maskUrl, model: 'source-image::gpt-image-1' }),
    });
    const submitted = await POST(request());
    const payload = await submitted.json() as { taskId?: string };
    expect(payload.taskId).toMatch(/^image-edit-/);
    expect((await query('SELECT remote_task_id FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ remote_task_id: 'task_mask_async_managed' }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId: payload.taskId, model: 'wrong-client-model', providerId: 'wrong-client-provider' }),
    }));
    const result = await polled.json() as { status?: string; imageUrl?: string; taskId?: string };
    expect(result).toMatchObject({ status: 'completed', taskId: payload.taskId,
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\//) });
    expect(boundary.sends).toHaveLength(1);
    expect(providerPolls).toBe(1);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query('SELECT count(*)::int AS total FROM cloud_tasks')).rows).toEqual([{ total: 1 }]);
    expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
      .toEqual([{ total: 0 }]);
    const replay = await POST(request());
    expect((await replay.json()).taskId).toBe(payload.taskId);
    expect(boundary.sends).toHaveLength(1);
  });
});

it('keeps an explicitly selected mask provider exact and refunds once when it rejects', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-all-rejected', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 },
    { id: 'fallback-image', name: 'Forbidden fallback', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://fallback-provider.invalid/v1', apiKey: 'offline-fallback',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const source = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const maskRaw = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const maskUrl = '/api/serve-upload/mask-rejected.png';
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return source;
      if (url === maskUrl) return mask;
      throw new Error(`Undeclared image read: ${url}`);
    });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') throw new Error(`Undeclared provider call: ${String(input)}`);
      boundary.sends.push(String(input));
      if (new URL(String(input)).hostname === 'fallback-provider.invalid') {
        return Response.json({ task_id: 'forbidden-fallback-task' });
      }
      return Response.json({ error: 'endpoint not found' }, { status: 404 });
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const request = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:mask-all-rejected:edit-node' },
      body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-personal',
        sessionId: 'mask-all-rejected', messageId: 'mask-all-rejected:edit-node',
        prompt: 'Make center red', imageUrl: canonicalUrl, maskImage: maskUrl,
        model: 'source-image::gpt-image-1' }),
    });
    const response = await POST(request());
    const payload = await response.json() as { success?: boolean; taskId?: string };
    expect(response.status).toBe(500);
    expect(payload).toMatchObject({ success: false, taskId: expect.stringMatching(/^image-edit-/) });
    expect(boundary.sends.length).toBeGreaterThan(0);
    expect(boundary.sends.every(url => new URL(url).hostname === 'image-provider.invalid')).toBe(true);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor' ORDER BY created_at")).rows)
      .toEqual([{ type: 'consume', amount: -15 }, { type: 'refund', amount: 15 }]);
    expect((await query('SELECT count(*)::int AS total FROM cloud_tasks')).rows).toEqual([{ total: 1 }]);
    expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
      .toEqual([{ total: 0 }]);
    const sends = boundary.sends.length;
    const replay = await POST(request());
    expect(replay.status).toBe(409);
    expect(boundary.sends).toHaveLength(sends);
  });
});

it.each(['image editing unavailable', 'aspect ratio is not in the allowed'] as const)(
  'keeps automatic same-name provider B and one charge after A rejects %s', async (reason): Promise<void> => {
    await withIsolatedPostgres('task-image-edit-source-mask-auto-b', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
      boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline A', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
        selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 },
      { id: 'fallback-image', name: 'Offline B', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://fallback-provider.invalid/v1', apiKey: 'offline-fallback',
        selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
      const source = await sharp({ create: { width: 32, height: 32, channels: 3,
        background: '#345678' } }).png().toBuffer();
      const providerImage = await sharp({ create: { width: 32, height: 32, channels: 3,
        background: '#ff0000' } }).png().toBuffer();
      const maskRaw = Buffer.alloc(32 * 32 * 3);
      for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
        maskRaw.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
      }
      const mask = await sharp(maskRaw, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
      const maskUrl = '/api/serve-upload/mask-auto-b.png';
      boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
        if (url === canonicalUrl) return source;
        if (url === maskUrl) return mask;
        if (url === outputUrl) return providerImage;
        throw new Error(`Undeclared image read: ${url}`);
      });
      const providers: string[] = [];
      stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const host = new URL(String(input)).hostname;
        providers.push(host);
        if (init?.method !== 'POST') {
          if (host === 'fallback-provider.invalid' && String(input).includes('mask-auto-b-accepted')) {
            return Response.json({ status: 'completed', result: { image_url: outputUrl } });
          }
          throw new Error(`Undeclared provider call: ${String(input)}`);
        }
        if (host === 'image-provider.invalid') return Response.json({ error: { message: reason } }, { status: 400 });
        if (host === 'fallback-provider.invalid') {
          expect(new Headers(init.headers).get('authorization')).toBe('Bearer offline-fallback');
          return Response.json({ task_id: 'mask-auto-b-accepted' });
        }
        throw new Error(`Undeclared provider call: ${String(input)}`);
      });
      const headers = await getInternalRequestHeaders('source-editor');
      const submit = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
        headers: { 'content-type': 'application/json', ...headers, 'idempotency-key': 'workflow:mask-auto-b:edit-node' },
        body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-personal',
          sessionId: 'mask-auto-b', messageId: 'mask-auto-b:edit-node', prompt: 'Make center red',
          imageUrl: canonicalUrl, maskImage: maskUrl, model: 'gpt-image-1' }),
      });
      const response = await POST(submit());
      const payload = await response.json() as { success?: boolean; taskId?: string };
      expect(providers[0]).toBe('image-provider.invalid');
      expect(providers.at(-1)).toBe('fallback-provider.invalid');
      expect(providers.filter(host => host === 'fallback-provider.invalid')).toHaveLength(1);
      expect((await query(`SELECT provider_id,model,remote_task_id,status,credit_status,
        result #>> '{providerId}' AS actual_provider_id,
        result #>> '{imageEditExecution,phases,0,attempts,0,status}' AS first_attempt,
        result #>> '{imageEditExecution,phases,0,attempts,1,status}' AS second_attempt,
        result #>> '{imageEditExecution,phases,0,attempts,1,identity,providerId}' AS accepted_provider_id
        FROM cloud_tasks WHERE id=$1`, [payload.taskId])).rows)
        .toEqual([{ provider_id: 'source-image', model: 'gpt-image-1', remote_task_id: 'mask-auto-b-accepted',
          status: 'processing', credit_status: 'pending', actual_provider_id: 'fallback-image',
          first_attempt: 'rejected', second_attempt: 'accepted', accepted_provider_id: 'fallback-image' }]);
      expect(response.status, JSON.stringify(payload)).toBe(200);
      expect(payload).toMatchObject({ success: true, taskId: expect.stringMatching(/^image-edit-/) });
      expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
        .toEqual([{ type: 'consume', amount: -15 }]);
      expect((await query('SELECT count(*)::int AS total FROM cloud_tasks')).rows).toEqual([{ total: 1 }]);
      const { POST: pollTask } = await import('@/app/api/poll-task/route');
      const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
        body: JSON.stringify({ taskId: payload.taskId, model: 'wrong-model', providerId: 'source-image' }),
      }));
      expect((await polled.json())).toMatchObject({ status: 'completed', taskId: payload.taskId,
        imageUrl: expect.stringMatching(/^\/api\/serve-upload\//) });
      expect(providers).toEqual(['image-provider.invalid', 'fallback-provider.invalid', 'fallback-provider.invalid']);
      expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
        .toEqual([{ status: 'completed', credit_status: 'charged' }]);
      expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
        .toEqual([{ total: 0 }]);
      const sent = providers.length;
      expect((await (await POST(submit())).json()).taskId).toBe(payload.taskId);
      expect(providers).toHaveLength(sent);
    });
  },
);

it('uses only the authorized vision model after an explicit image editor is rejected', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-vision-grant', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    await query(`UPDATE wujie_users SET chat_models=ARRAY['vision-allowed::gpt-4o']::text[],
      image_models=ARRAY['source-image::gpt-image-1']::text[] WHERE id='source-editor'`);
    boundary.config.mockResolvedValue([
      { id: 'source-image', name: 'Image A', type: 'image', modelType: 'image', isEnabled: true,
        baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
        selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 },
      { id: 'vision-denied', name: 'Denied Vision', type: 'chat', modelType: 'chat', isEnabled: true,
        baseUrl: 'https://vision-denied.invalid/v1', apiKey: 'offline-vision-denied',
        selectedModels: ['gpt-4o'], createdAt: 1, updatedAt: 1 },
      { id: 'vision-allowed', name: 'Allowed Vision', type: 'chat', modelType: 'chat', isEnabled: true,
        baseUrl: 'https://vision-allowed.invalid/v1', apiKey: 'offline-vision-allowed',
        selectedModels: ['gpt-4o'], createdAt: 1, updatedAt: 1 },
    ]);
    const maskUrl = '/api/serve-upload/vision-grant-mask.png';
    const maskPixels = Buffer.alloc(32 * 32 * 3);
    for (let y = 12; y < 20; y += 1) for (let x = 12; x < 20; x += 1) {
      maskPixels.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const mask = await sharp(maskPixels, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const readMedia = boundary.media.getMockImplementation();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> =>
      url === maskUrl ? mask : readMedia!(url));
    const requests: string[] = [];
    let imageSends = 0;
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const model = JSON.parse(String(init?.body)) as { model?: string };
      requests.push(`${url.hostname}::${model.model}`);
      if (url.hostname === 'image-provider.invalid') {
        imageSends += 1;
        return imageSends === 1
          ? Response.json({ error: { message: 'image editing unavailable' } }, { status: 400 })
          : Response.json({ task_id: 'vision-grant-image-accepted' });
      }
      if (url.hostname === 'vision-allowed.invalid') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-vision-allowed');
        return Response.json({ choices: [{ message: {
          content: 'A textured blue background with a small central object and natural lighting.',
        } }] });
      }
      throw new Error(`Unauthorized or unexpected provider request: ${url.hostname}`);
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:vision-grant:edit-node' },
      body: JSON.stringify({ action: 'mask', editMode: 'mask', projectId: 'source-personal',
        sessionId: 'vision-grant', messageId: 'vision-grant:edit-node', prompt: 'Restore the center',
        imageUrl: canonicalUrl, maskImage: maskUrl, model: 'source-image::gpt-image-1' }),
    });
    const configCallsBeforeSubmit = boundary.config.mock.calls.length;
    const submitted = await POST(makeRequest());
    const payload = await submitted.json() as { taskId?: string };
    expect(submitted.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, taskId: expect.stringMatching(/^image-edit-/) });
    expect(requests).toEqual([
      'image-provider.invalid::gpt-image-1',
      'vision-allowed.invalid::gpt-4o',
      'image-provider.invalid::gpt-image-1',
    ]);
    expect((await query(`SELECT remote_task_id,status,credit_status,
      result #>> '{providerId}' AS actual_provider_id FROM cloud_tasks WHERE id=$1`, [payload.taskId])).rows)
      .toEqual([{ remote_task_id: 'vision-grant-image-accepted', status: 'processing', credit_status: 'pending',
        actual_provider_id: 'source-image' }]);
    expect(boundary.config.mock.calls.length - configCallsBeforeSubmit).toBe(1);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
    const sent = requests.length;
    expect((await (await POST(makeRequest())).json()).taskId).toBe(payload.taskId);
    expect(requests).toHaveLength(sent);
  });
});

it.each(['extend', 'outpaint'] as const)('polls async %s through accepted B after automatic A rejection', async (action): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-${action}-auto-b`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline A', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 },
    { id: 'fallback-image', name: 'Offline B', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://fallback-provider.invalid/v1', apiKey: 'offline-fallback',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const requests: string[] = [];
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requests.push(`${init?.method || 'GET'} ${url}`);
      if (init?.method === 'POST' && url === 'https://image-provider.invalid/v1/images/generations') {
        return Response.json({ error: { message: 'image editing unavailable' } }, { status: 400 });
      }
      if (init?.method === 'POST' && url === 'https://fallback-provider.invalid/v1/images/generations') {
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer offline-fallback');
        return Response.json({ task_id: 'outpaint-auto-b-accepted' });
      }
      if (init?.method !== 'POST' && url === 'https://fallback-provider.invalid/v1/tasks/outpaint-auto-b-accepted') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-fallback');
        return Response.json({ status: 'completed', result: { image_url: outputUrl } });
      }
      throw new Error(`Undeclared provider call: ${url}`);
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:outpaint-auto-b:edit-node' },
      body: JSON.stringify({ action, projectId: 'source-personal',
        sessionId: 'outpaint-auto-b', messageId: 'outpaint-auto-b:edit-node',
        imageUrl: canonicalUrl, model: 'gpt-image-1', expandScale: 2 }),
    });
    const submitted = await POST(makeRequest());
    const payload = await submitted.json() as { taskId?: string };
    expect(submitted.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ taskId: expect.stringMatching(/^image-edit-/) });
    expect((await query(`SELECT provider_id,remote_task_id,status,credit_status,
      result #>> '{imageEditExecution,phases,0,attempts,0,status}' AS first_attempt,
      result #>> '{imageEditExecution,phases,0,attempts,1,status}' AS second_attempt,
      result #>> '{imageEditExecution,phases,0,attempts,1,identity,providerId}' AS accepted_provider_id
      FROM cloud_tasks WHERE id=$1`, [payload.taskId])).rows)
      .toEqual([{ provider_id: 'source-image', remote_task_id: 'outpaint-auto-b-accepted',
        status: 'processing', credit_status: 'pending', first_attempt: 'rejected',
        second_attempt: 'accepted', accepted_provider_id: 'fallback-image' }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId: payload.taskId, model: 'wrong-model', providerId: 'source-image' }),
    }));
    expect((await polled.json())).toMatchObject({ status: 'completed',
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\//) });
    expect(requests).toEqual([
      'POST https://image-provider.invalid/v1/images/generations',
      'POST https://fallback-provider.invalid/v1/images/generations',
      'GET https://fallback-provider.invalid/v1/tasks/outpaint-auto-b-accepted',
    ]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
    const sent = requests.length;
    expect((await (await POST(makeRequest())).json()).taskId).toBe(payload.taskId);
    expect(requests).toHaveLength(sent);
  });
});

it('polls an async erase through the accepted B provider after automatic A rejection', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-erase-auto-b', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline A', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 },
    { id: 'fallback-image', name: 'Offline B', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://fallback-provider.invalid/v1', apiKey: 'offline-fallback',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const source = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const edited = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#ff0000' } }).png().toBuffer();
    const maskPixels = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskPixels.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const mask = await sharp(maskPixels, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const maskUrl = '/api/serve-upload/erase-auto-b-mask.png';
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return source;
      if (url === maskUrl) return mask;
      if (url === outputUrl) return edited;
      throw new Error(`Undeclared image read: ${url}`);
    });
    const requests: string[] = [];
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requests.push(`${init?.method || 'GET'} ${url}`);
      if (init?.method === 'POST' && url === 'https://image-provider.invalid/v1/images/generations') {
        return Response.json({ error: { message: 'image editing unavailable' } }, { status: 400 });
      }
      if (init?.method === 'POST' && url === 'https://fallback-provider.invalid/v1/images/generations') {
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer offline-fallback');
        return Response.json({ task_id: 'erase-auto-b-accepted' });
      }
      if (init?.method !== 'POST' && url === 'https://fallback-provider.invalid/v1/tasks/erase-auto-b-accepted') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer offline-fallback');
        return Response.json({ status: 'completed', result: { image_url: outputUrl } });
      }
      throw new Error(`Undeclared provider call: ${url}`);
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const submit = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:erase-auto-b:edit-node' },
      body: JSON.stringify({ action: 'erase', editMode: 'erase', projectId: 'source-personal',
        sessionId: 'erase-auto-b', messageId: 'erase-auto-b:edit-node',
        imageUrl: canonicalUrl, maskImage: maskUrl, model: 'gpt-image-1' }),
    });
    const submitted = await POST(submit());
    const payload = await submitted.json() as { taskId?: string; engine?: string };
    expect(submitted.status).toBe(200);
    expect(payload).toMatchObject({ taskId: expect.stringMatching(/^image-edit-/), engine: 'ai-erase-async' });
    expect((await query(`SELECT provider_id,remote_task_id,status,credit_status,
      result #>> '{imageEditExecution,phases,0,attempts,0,status}' AS first_attempt,
      result #>> '{imageEditExecution,phases,0,attempts,1,status}' AS second_attempt,
      result #>> '{imageEditExecution,phases,0,attempts,1,identity,providerId}' AS accepted_provider_id
      FROM cloud_tasks WHERE id=$1`, [payload.taskId])).rows)
      .toEqual([{ provider_id: 'source-image', remote_task_id: 'erase-auto-b-accepted',
        status: 'processing', credit_status: 'pending', first_attempt: 'rejected',
        second_attempt: 'accepted', accepted_provider_id: 'fallback-image' }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(new NextRequest('http://localhost/api/poll-task', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ taskId: payload.taskId, model: 'wrong-model', providerId: 'source-image' }),
    }));
    expect((await polled.json())).toMatchObject({ status: 'completed', taskId: payload.taskId,
      imageUrl: expect.stringMatching(/^\/api\/serve-upload\/exports\//) });
    expect(requests).toEqual([
      'POST https://image-provider.invalid/v1/images/generations',
      'POST https://fallback-provider.invalid/v1/images/generations',
      'GET https://fallback-provider.invalid/v1/tasks/erase-auto-b-accepted',
    ]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [payload.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -15 }]);
    expect((await query('SELECT count(*)::int AS total FROM wujie_image_edit_private_inputs')).rows)
      .toEqual([{ total: 0 }]);
    const sent = requests.length;
    expect((await (await POST(submit())).json()).taskId).toBe(payload.taskId);
    expect(requests).toHaveLength(sent);
  });
});

it('admits a charged AI erase task before provider receipt and reuses it for a concurrent same-key request', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-erase-concurrent-key', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline Image', type: 'image', modelType: 'image',
      isEnabled: true, baseUrl: 'https://image-provider.invalid/v1', apiKey: 'offline-image',
      selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const maskUrl = '/api/serve-upload/erase-concurrent-mask.png';
    const maskPixels = Buffer.alloc(32 * 32 * 3);
    for (let y = 8; y < 24; y += 1) for (let x = 8; x < 24; x += 1) {
      maskPixels.fill(255, (y * 32 + x) * 3, (y * 32 + x) * 3 + 3);
    }
    const maskBytes = await sharp(maskPixels, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    const sourceBytes = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) return sourceBytes;
      if (url === maskUrl) return maskBytes;
      if (url === outputUrl) return managedSourceBytes;
      throw new Error(`Undeclared image read: ${url}`);
    });
    let firstProviderEntered!: () => void;
    const entered = new Promise<void>(resolve => { firstProviderEntered = resolve; });
    let releaseFirstProvider!: () => void;
    const released = new Promise<void>(resolve => { releaseFirstProvider = resolve; });
    let providerSends = 0;
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://image-provider.invalid/v1/images/generations' || init?.method !== 'POST') {
        throw new Error(`Undeclared provider call: ${String(input)}`);
      }
      providerSends += 1;
      boundary.sends.push(String(input));
      if (providerSends === 1) {
        firstProviderEntered();
        await released;
      }
      return Response.json({ data: [{ url: outputUrl }] });
    });
    const headers = await getInternalRequestHeaders('source-editor');
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image-edit', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers,
        'idempotency-key': 'workflow:concurrent-erase:edit-node' },
      body: JSON.stringify({ action: 'erase', editMode: 'erase', projectId: 'source-personal',
        sessionId: 'concurrent-erase', messageId: 'concurrent-erase:edit-node',
        imageUrl: canonicalUrl, maskImage: maskUrl, model: 'source-image::gpt-image-1' }),
    });
    const first = POST(makeRequest());
    await Promise.race([entered, first.then(response => {
      throw new Error(`AI erase finished before provider entry: ${response.status}`);
    })]);
    let secondResponse: Response;
    let firstResponse: Response;
    try {
      const beforeReceipt = (await query(`SELECT
        (SELECT count(*)::int FROM cloud_tasks WHERE user_id='source-editor'
          AND idempotency_key='workflow:concurrent-erase:edit-node') AS tasks,
        (SELECT count(*)::int FROM wujie_credit_transactions WHERE user_id='source-editor'
          AND type='consume') AS charges`)).rows;
      expect(beforeReceipt).toEqual([{ tasks: 1, charges: 1 }]);
      secondResponse = await POST(makeRequest());
    } finally {
      releaseFirstProvider();
      firstResponse = await first;
    }
    const firstBody = await firstResponse.json() as { taskId?: string };
    const secondBody = await secondResponse!.json() as { taskId?: string };
    expect(boundary.sends).toHaveLength(1);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse!.status).toBe(200);
    expect(firstBody.taskId).toBeTruthy();
    expect(secondBody.taskId).toBe(firstBody.taskId);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 85, total_used: 15 }]);
  });
}, 30_000);

it('keeps admitted inpaint source and mask private, scoped and checksum-bound across a new reader', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-private-inpaint', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    const { insertPrivateInpaintInputs, readPrivateInpaintInputs, deleteTerminalPrivateInpaintInputs } =
      await import('@/lib/task-core/inpaint-private-inputs');
    const source = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 32, height: 32, channels: 3,
      background: '#ffffff' } }).png().toBuffer();
    const requestDigest = 'a'.repeat(64);
    const taskId = 'image-edit-private-input-test';
    const now = Date.now();
    await createBillableTask({
      userId: 'source-editor', idempotencyKey: 'private-input-test', requestDigest, creditCost: 15,
      beforeCharge: async client => insertPrivateInpaintInputs(client, {
        taskId, userId: 'source-editor', projectId: 'source-personal', requestDigest,
        source, mask, width: 32, height: 32,
      }),
      task: { id: taskId, type: 'image-edit', status: 'processing', progress: 0,
        projectId: 'source-personal', providerId: 'source-image', model: 'gpt-image-1',
        label: '擦除', result: { imageEditAdmission: { kind: 'ordinary-inpaint' } },
        createdAt: now, updatedAt: now },
    });
    const recovered = await readPrivateInpaintInputs({
      taskId, userId: 'source-editor', projectId: 'source-personal', requestDigest,
    });
    expect(recovered).toMatchObject({ width: 32, height: 32 });
    expect(recovered?.source.equals(source)).toBe(true);
    expect(recovered?.mask.equals(mask)).toBe(true);
    expect(await readPrivateInpaintInputs({ taskId, userId: 'source-owner',
      projectId: 'source-personal', requestDigest })).toBeNull();
    expect(await readPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-shared', requestDigest })).toBeNull();
    expect(await readPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-personal', requestDigest: 'b'.repeat(64) })).toBeNull();
    expect((await query('SELECT result::text AS result FROM cloud_tasks WHERE id=$1', [taskId])).rows[0].result)
      .not.toContain(source.toString('base64'));
    await query('UPDATE wujie_image_edit_private_inputs SET source_bytes=$1 WHERE task_id=$2',
      [mask, taskId]);
    await expect(readPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-personal', requestDigest })).rejects.toThrow('INPAINT_INPUT_CORRUPT');
    await query('UPDATE wujie_image_edit_private_inputs SET source_bytes=$1 WHERE task_id=$2',
      [source, taskId]);
    expect(await deleteTerminalPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-personal', requestDigest })).toBe(false);
    await query("UPDATE cloud_tasks SET status='completed' WHERE id=$1", [taskId]);
    expect(await deleteTerminalPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-personal', requestDigest })).toBe(false);
    await query("UPDATE cloud_tasks SET status='completed',credit_status='charged' WHERE id=$1", [taskId]);
    expect(await deleteTerminalPrivateInpaintInputs({ taskId, userId: 'source-owner',
      projectId: 'source-personal', requestDigest })).toBe(false);
    expect(await deleteTerminalPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-personal', requestDigest })).toBe(true);
    expect(await readPrivateInpaintInputs({ taskId, userId: 'source-editor',
      projectId: 'source-personal', requestDigest })).toBeNull();
  });
});

it('persists an accepted erase result while keeping unmasked source pixels unchanged', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-erase-output', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    const source = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const maskPixels = Buffer.alloc(4 * 4 * 3);
    for (let y = 1; y < 3; y += 1) for (let x = 1; x < 3; x += 1) {
      maskPixels.fill(255, (y * 4 + x) * 3, (y * 4 + x) * 3 + 3);
    }
    const mask = await sharp(maskPixels, { raw: { width: 4, height: 4, channels: 3 } }).png().toBuffer();
    const edited = await sharp({ create: { width: 2, height: 2, channels: 3,
      background: '#abcdef' } }).png().toBuffer();
    const identity = { taskId: 'image-edit-private-erase-output', userId: 'source-editor',
      projectId: 'source-personal', requestDigest: 'c'.repeat(64) };
    const { insertPrivateInpaintInputs } = await import('@/lib/task-core/inpaint-private-inputs');
    await createBillableTask({
      userId: identity.userId, idempotencyKey: 'private-erase-output',
      requestDigest: identity.requestDigest, creditCost: 15,
      beforeCharge: async client => insertPrivateInpaintInputs(client, {
        ...identity, source, mask, width: 4, height: 4,
      }),
      task: { id: identity.taskId, type: 'image-edit', status: 'processing', progress: 0,
        projectId: identity.projectId, providerId: 'source-image', model: 'gpt-image-1',
        label: '擦除', result: { imageEditAdmission: { kind: 'ordinary-inpaint' } },
        createdAt: Date.now(), updatedAt: Date.now() },
    });
    const { persistInpaintAcceptedResult } = await import('@/lib/task-core/inpaint-task');
    const persisted = await persistInpaintAcceptedResult({ identity, editMode: 'erase', edited });
    expect(persisted.url).toMatch(/^\/api\/serve-upload\/exports\/[^/]+\.png$/);
    expect(persisted.checksum).toMatch(/^[a-f0-9]{64}$/);
    const output = await readFile(resolve(process.env.WUJIE_DATA_DIR!, 'exports',
      persisted.url.slice('/api/serve-upload/exports/'.length)));
    expect(createHash('sha256').update(output).digest('hex')).toBe(persisted.checksum);
    const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgbAt = (x: number, y: number): number[] => [...data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)];
    expect(rgbAt(0, 0)).toEqual([0x34, 0x56, 0x78]);
    expect(rgbAt(3, 3)).toEqual([0x34, 0x56, 0x78]);
    expect(rgbAt(1, 1)).toEqual([0xab, 0xcd, 0xef]);
    expect(rgbAt(2, 2)).toEqual([0xab, 0xcd, 0xef]);
  });
});

it('centers a narrow accepted mask result without stretching it across the source crop', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-mask-output', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-editor','Personal')");
    const source = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: '#ffffff' } }).png().toBuffer();
    const edited = await sharp({ create: { width: 2, height: 4, channels: 3,
      background: '#abcdef' } }).png().toBuffer();
    const identity = { taskId: 'image-edit-private-mask-output', userId: 'source-editor',
      projectId: 'source-personal', requestDigest: 'd'.repeat(64) };
    const { insertPrivateInpaintInputs } = await import('@/lib/task-core/inpaint-private-inputs');
    await createBillableTask({
      userId: identity.userId, idempotencyKey: 'private-mask-output',
      requestDigest: identity.requestDigest, creditCost: 15,
      beforeCharge: async client => insertPrivateInpaintInputs(client, {
        ...identity, source, mask, width: 4, height: 4,
      }),
      task: { id: identity.taskId, type: 'image-edit', status: 'processing', progress: 0,
        projectId: identity.projectId, providerId: 'source-image', model: 'gpt-image-1',
        label: '蒙版修图', result: { imageEditAdmission: { kind: 'ordinary-inpaint' } },
        createdAt: Date.now(), updatedAt: Date.now() },
    });
    const { persistInpaintAcceptedResult } = await import('@/lib/task-core/inpaint-task');
    const persisted = await persistInpaintAcceptedResult({ identity, editMode: 'mask', edited,
      crop: { cropX: 0, cropY: 0, cropW: 4, cropH: 4 } });
    const output = await readFile(resolve(process.env.WUJIE_DATA_DIR!, 'exports',
      persisted.url.slice('/api/serve-upload/exports/'.length)));
    const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgbAt = (x: number, y: number): number[] => [...data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 3)];
    expect(rgbAt(0, 1)).toEqual([0x34, 0x56, 0x78]);
    expect(rgbAt(1, 1)).toEqual([0xab, 0xcd, 0xef]);
    expect(rgbAt(2, 1)).toEqual([0xab, 0xcd, 0xef]);
    expect(rgbAt(3, 1)).toEqual([0x34, 0x56, 0x78]);
  });
});

it('rejects a forged document source before task, charge or provider submission', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-forged', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const before = await snapshot(query);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: forgedUrl,
      upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_MISMATCH' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.sends).toEqual([]);
    expect(boundary.mediaReads).toEqual([]);
  });
}, 60_000);

it.each(['removebg', 'remove_background'])(
  'rejects a forged document source before %s can read media or charge',
  async (action): Promise<void> => {
    await withIsolatedPostgres(`task-image-edit-source-forged-${action}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
        modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
        apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
      const before = await snapshot(query);
      const response = await POST(request({ action, projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: forgedUrl, engine: 'cpu' }));
      const payload = await response.json();
      expect(await snapshot(query), JSON.stringify(payload)).toEqual(before);
      expect(boundary.mediaReads).toEqual([]);
      expect(response.status, JSON.stringify(payload)).toBe(403);
      expect(payload).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_MISMATCH' });
      expect(boundary.sends).toEqual([]);
    });
  }, 60_000,
);

it('records one task, one charge and one refund when the authorized local engine cannot run', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-failure', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const response = await POST(request({ action: 'remove_background', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, engine: 'cpu' }));
    expect(response.status).toBe(502);
    const state = await snapshot(query);
    expect(state.credits).toMatchObject([{ balance: 100, total_used: 0 }, { balance: 100, total_used: 0 }]);
    expect(state.ledger).toEqual(expect.arrayContaining([
      { type: 'consume', amount: -5, balance_after: 95 },
      { type: 'refund', amount: 5, balance_after: 100 },
    ]));
    expect(state.ledger).toHaveLength(2);
    expect(state.tasks).toMatchObject([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query('SELECT task_id FROM wujie_credit_transactions')).rows)
      .toEqual([{ task_id: (state.tasks as Array<{ id: string }>)[0].id },
        { task_id: (state.tasks as Array<{ id: string }>)[0].id }]);
    expect(boundary.mediaReads).toEqual([canonicalUrl]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('refunds the same removebg task and does not run it after editor revocation during source read', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-revoked', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const sourceRead = boundary.media.getMockImplementation()!;
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      return sourceRead(url);
    });
    const response = await POST(request({ action: 'removebg', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, engine: 'cpu' }, 'source-editor'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    const state = await snapshot(query);
    expect(state.credits).toMatchObject([{ balance: 100, total_used: 0 }, { balance: 100, total_used: 0 }]);
    expect(state.ledger).toEqual(expect.arrayContaining([
      { type: 'consume', amount: -5, balance_after: 95 },
      { type: 'refund', amount: 5, balance_after: 100 },
    ]));
    expect(state.ledger).toHaveLength(2);
    expect(state.tasks).toMatchObject([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query('SELECT task_id FROM wujie_credit_transactions')).rows)
      .toEqual([{ task_id: (state.tasks as Array<{ id: string }>)[0].id },
        { task_id: (state.tasks as Array<{ id: string }>)[0].id }]);
    expect(boundary.mediaReads).toEqual([canonicalUrl]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('rejects CPU removebg before charge when the editor is revoked during model planning', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-admission-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockImplementation(async (): Promise<ApiProvider[]> => {
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      return [{ id: 'source-image', name: 'Offline image', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://image.invalid/v1', apiKey: 'offline-image',
        selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }];
    });
    const before = await snapshot(query);
    const response = await POST(request({ action: 'removebg', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, engine: 'cpu' }, 'source-editor'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.mediaReads).toEqual([]);
    expect(boundary.rembg).not.toHaveBeenCalled();
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('completes one authorized CPU removebg task with distinct durable image and mask, then replays without rerunning', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-success', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    vi.stubEnv('WUJIE_DATA_DIR_DURABLE', 'true');
    await stubValidRembgOutput();
    const body = { action: 'removebg', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, engine: 'cpu' };
    const first = await POST(request(body, 'source-editor', 'cpu-removebg-success'));
    const firstPayload = await first.json();
    expect(first.status, JSON.stringify(firstPayload)).toBe(200);
    expect(firstPayload).toMatchObject({ success: true, action: 'removebg', engine: 'rembg-cpu' });
    expect(firstPayload.imageUrl).toMatch(/^\/api\/serve-upload\/exports\//);
    expect(firstPayload.maskUrl).toMatch(/^\/api\/serve-upload\/exports\//);
    expect(firstPayload.imageUrl).not.toBe(firstPayload.maskUrl);
    const servedBytes: Buffer[] = [];
    for (const url of [firstPayload.imageUrl, firstPayload.maskUrl] as string[]) {
      const served = await serveUploadGet(new NextRequest(`http://localhost${url}`),
        { params: Promise.resolve({ path: url.slice('/api/serve-upload/'.length).split('/') }) });
      expect(served.status).toBe(200);
      const bytes = Buffer.from(await served.arrayBuffer());
      servedBytes.push(bytes);
      expect((await sharp(bytes).metadata()).format).toBe('png');
      expect((await sharp(bytes).metadata()).width).toBe(32);
    }
    const subject = await sharp(servedBytes[0]).ensureAlpha().raw().toBuffer();
    const servedMask = await sharp(servedBytes[1]).greyscale().raw().toBuffer();
    expect(subject[3]).toBe(255);
    expect(subject[16 * 4 + 3]).toBe(0);
    expect(servedMask[0]).toBe(255);
    expect(servedMask[16]).toBe(0);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(pollRequest(firstPayload.taskId, 'source-editor'));
    expect(await polled.json()).toMatchObject({ success: true, taskId: firstPayload.taskId,
      status: 'completed', imageUrl: firstPayload.imageUrl, maskUrl: firstPayload.maskUrl });
    const replay = await POST(request(body, 'source-editor', 'cpu-removebg-success'));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, taskId: firstPayload.taskId,
      imageUrl: firstPayload.imageUrl, maskUrl: firstPayload.maskUrl, reused: true });
    expect(boundary.rembg).toHaveBeenCalledTimes(1);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 95, total_used: 5 }]);
    expect((await query("SELECT type,amount,task_id FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -5, task_id: firstPayload.taskId }]);
    expect((await query("SELECT status,credit_status,result->>'imageUrl' AS image_url,result->>'maskUrl' AS mask_url FROM cloud_tasks")).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged',
        image_url: firstPayload.imageUrl, mask_url: firstPayload.maskUrl }]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('previews the selected document CPU removebg service without charging or executing it', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-preview', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu' };
    const response = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-quote-preview'));
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({ success: true, quote: { total: 5,
      components: { removebg: 5 }, service: 'remove-background', token: expect.any(String) } });
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.rembg).not.toHaveBeenCalled();
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('refuses a document CPU removebg quote for an entity absent from the live canvas', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-missing-selection', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const response = await POST(request({ action: 'removebg', projectId: 'source-shared',
      imageUrl: canonicalUrl, assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['missing-image'], engine: 'cpu', quoteOnly: true },
    'source-editor', 'cpu-removebg-quote-missing-selection'));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.code).toBe('IMAGE_EDIT_PUBLICATION_INVALID');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.rembg).not.toHaveBeenCalled();
  });
}, 60_000);

it('refuses a document CPU removebg quote when the live selected entity points to another version', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-wrong-selection', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const sourceBytes = await preparePublishableSource(query);
    await writeFile(resolve(process.env.WUJIE_DATA_DIR!, 'source-other.png'), sourceBytes);
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('other-asset','source-owner','source-shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size)
      VALUES ('other-version','other-asset','source-owner','source-shared',$1,'image/png',$2)`,
    ['/api/serve-upload/source-other.png', sourceBytes.length]);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('other-placement','source-owner','source-shared','other-asset','other-version','canvas','source-shared','canvas-image','other-image')`);
    const document = createCanvasDocument();
    applyCanvasImagePatch(document, { placementId: 'source-placement', assetVersionId: 'source-version',
      x: 0, y: 0, width: 32, height: 32, rotation: 0, zIndex: 0 }, 'fixture');
    applyCanvasImagePatch(document, { placementId: 'other-placement', assetVersionId: 'other-version',
      x: 64, y: 0, width: 32, height: 32, rotation: 0, zIndex: 1 }, 'fixture');
    await query('UPDATE wujie_project_canvas_documents SET projection=$1,snapshot_bytes=$2 WHERE project_id=$3',
      [readCanvasDocument(document), Buffer.from(Y.encodeStateAsUpdate(document)), 'source-shared']);
    document.destroy();
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const response = await POST(request({ action: 'removebg', projectId: 'source-shared',
      imageUrl: canonicalUrl, assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['other-image'], engine: 'cpu', quoteOnly: true },
    'source-editor', 'cpu-removebg-quote-wrong-selection'));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.code).toBe('IMAGE_EDIT_PUBLICATION_INVALID');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.rembg).not.toHaveBeenCalled();
  });
}, 60_000);

it('does not charge a confirmed CPU removebg quote when its selected canvas entity changes source', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-selection-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const sourceBytes = await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu' };
    const preview = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-quote-selection-race'));
    expect(preview.status).toBe(200);
    const quote = (await preview.json()).quote as { token: string };
    await writeFile(resolve(process.env.WUJIE_DATA_DIR!, 'source-other-race.png'), sourceBytes);
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('other-asset','source-owner','source-shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type,byte_size)
      VALUES ('other-version','other-asset','source-owner','source-shared',$1,'image/png',$2)`,
    ['/api/serve-upload/source-other-race.png', sourceBytes.length]);
    await query("UPDATE wujie_workspace_placements SET entity_id='original-image' WHERE id='source-placement'");
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('other-placement','source-owner','source-shared','other-asset','other-version','canvas','source-shared','canvas-image','source-image')`);
    const document = createCanvasDocument();
    applyCanvasImagePatch(document, { placementId: 'source-placement', assetVersionId: 'source-version',
      x: 0, y: 0, width: 32, height: 32, rotation: 0, zIndex: 0 }, 'fixture');
    applyCanvasImagePatch(document, { placementId: 'other-placement', assetVersionId: 'other-version',
      x: 64, y: 0, width: 32, height: 32, rotation: 0, zIndex: 1 }, 'fixture');
    await query('UPDATE wujie_project_canvas_documents SET projection=$1,snapshot_bytes=$2 WHERE project_id=$3',
      [readCanvasDocument(document), Buffer.from(Y.encodeStateAsUpdate(document)), 'source-shared']);
    document.destroy();
    const response = await POST(request({ ...body, quoteToken: quote.token },
      'source-editor', 'cpu-removebg-quote-selection-race'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CANVAS_TASK_PUBLICATION_CONFLICT');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.rembg).not.toHaveBeenCalled();
  });
}, 60_000);

it('requires an accepted quote before charging a selected document CPU removebg request', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-required', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu' };
    const response = await POST(request(body, 'source-editor', 'cpu-removebg-quote-required'));
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(428);
    expect(payload.code).toBe('IMAGE_EDIT_QUOTE_REQUIRED');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.rembg).not.toHaveBeenCalled();
  });
}, 60_000);

it('rejects a stale document CPU removebg quote after administrator pricing changes', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-repriced', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu', model: 'gpt-image-1', providerId: 'source-image' };
    const preview = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-quote-repriced'));
    const quote = (await preview.json()).quote as { total: number; token: string };
    expect(preview.status).toBe(200);
    expect(quote.total).toBe(5);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'gpt-image-1': 9 } })]);
    const rejected = await POST(request({ ...body, quoteToken: quote.token }, 'source-editor', 'cpu-removebg-quote-repriced'));
    const result = await rejected.json();
    expect(rejected.status, JSON.stringify(result)).toBe(409);
    expect(result.code).toBe('IMAGE_EDIT_QUOTE_CHANGED');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.rembg).not.toHaveBeenCalled();
    const refreshed = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-quote-repriced'));
    expect((await refreshed.json()).quote.total).toBe(9);
  });
}, 60_000);

it('does not charge a document CPU removebg quote repriced after verification but before billable admission', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-quote-admission-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    vi.stubEnv('WUJIE_DATA_DIR_DURABLE', 'true');
    await stubValidRembgOutput();
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu', model: 'gpt-image-1', providerId: 'source-image' };
    const preview = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-quote-admission-race'));
    const quote = (await preview.json()).quote as { total: number; token: string };
    expect(preview.status).toBe(200);
    expect(quote.total).toBe(5);
    const originalQuery = Client.prototype.query;
    let repriced = false;
    const hook = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client,
      ...args: unknown[]) {
      const run = originalQuery as (this: Client, ...queryArgs: unknown[]) => unknown;
      if (!repriced && typeof args[0] === 'string'
        && args[0].includes('SELECT pg_advisory_xact_lock(hashtextextended')
        && Array.isArray(args[1])
        && String(args[1][0]).includes('cpu-removebg-quote-admission-race')) {
        repriced = true;
        return query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
          [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'gpt-image-1': 9 } })])
          .then(() => run.apply(this, args));
      }
      return run.apply(this, args);
    } as typeof Client.prototype.query);
    try {
      const response = await POST(request({ ...body, quoteToken: quote.token },
        'source-editor', 'cpu-removebg-quote-admission-race'));
      const result = await response.json();
      expect(repriced).toBe(true);
      expect(response.status, JSON.stringify(result)).toBe(409);
      expect(result.code).toBe('IMAGE_EDIT_QUOTE_CHANGED');
      expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
      expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
      expect(boundary.rembg).not.toHaveBeenCalled();
    } finally { hook.mockRestore(); }
  });
}, 60_000);

it.each(['browser', 'desktop-token'] as const)(
  'publishes an explicitly selected document CPU removebg image and mask as separate canvas assets exactly once for %s',
  async credentialKind => {
  await withIsolatedPostgres(`task-image-edit-source-local-rembg-publication-${credentialKind}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await preparePublishableSource(query);
    const offlineProviders: ApiProvider[] = [{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }];
    boundary.config.mockResolvedValue(offlineProviders);
    vi.stubEnv('WUJIE_DATA_DIR_DURABLE', 'true');
    await stubValidRembgOutput();
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu', model: 'gpt-image-1', providerId: 'source-image' };
    const preview = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-published',
      credentialKind === 'desktop-token' ? credentialKind : undefined));
    const quote = (await preview.json()).quote as { total: number; token: string };
    expect(preview.status).toBe(200);
    expect(quote.total).toBe(5);
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    const first = await POST(request({ ...body, quoteToken: quote.token }, 'source-editor', 'cpu-removebg-published',
      credentialKind === 'desktop-token' ? credentialKind : undefined));
    const payload = await first.json();
    expect(first.status, JSON.stringify(payload)).toBe(200);
    expect(payload.imageUrl).toMatch(/^\/api\/serve-upload\/exports\//);
    expect(payload.maskUrl).toMatch(/^\/api\/serve-upload\/exports\//);
    expect(payload.quote).toEqual({ total: 5, components: { removebg: 5 } });
    expect(payload.assetProjection?.status).toBe('completed');
    expect(payload.assetProjection?.references).toHaveLength(2);
    expect(payload.assetProjection.references).toEqual([
      expect.objectContaining({ url: expect.stringMatching(/^\/api\/serve-upload\/exports\//), assetVersionId: expect.any(String) }),
      expect.objectContaining({ url: expect.stringMatching(/^\/api\/serve-upload\/exports\//), assetVersionId: expect.any(String) }),
    ]);
    const recovered = await recoverTaskGet(new NextRequest(
      'http://localhost/api/tasks/recover?projectId=source-shared&idempotencyKey=cpu-removebg-published&sourceVersionId=source-version',
      { headers: { 'x-test-actor': 'source-editor',
        ...(credentialKind === 'desktop-token' ? { 'x-test-credential-kind': credentialKind } : {}) } }));
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ success: true, found: true,
      taskId: payload.taskId, status: 'completed',
      quote: { total: 5, components: { removebg: 5 } },
      assetProjectionStatus: 'completed',
      publication: { imageUrl: payload.assetProjection.references[0].url,
        maskUrl: payload.assetProjection.references[1].url,
        references: [
          expect.objectContaining({ url: payload.assetProjection.references[0].url, assetVersionId: expect.any(String) }),
          expect.objectContaining({ url: payload.assetProjection.references[1].url, assetVersionId: expect.any(String) }),
        ] } });
    const staleSource = await recoverTaskGet(new NextRequest(
      'http://localhost/api/tasks/recover?projectId=source-shared&idempotencyKey=cpu-removebg-published&sourceVersionId=other-version',
      { headers: { 'x-test-actor': 'source-editor' } }));
    expect(await staleSource.json()).toMatchObject({ success: true, found: false });
    const reusedTokenWithNewKey = await POST(request({ ...body, quoteToken: quote.token },
      'source-editor', 'cpu-removebg-published-second-key',
      credentialKind === 'desktop-token' ? credentialKind : undefined));
    const secondKeyResult = await reusedTokenWithNewKey.json();
    expect(reusedTokenWithNewKey.status, JSON.stringify(secondKeyResult)).toBe(409);
    expect(secondKeyResult.code).toBe('IMAGE_EDIT_QUOTE_CHANGED');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -5 }]);
    expect(boundary.rembg).toHaveBeenCalledTimes(1);
    const publication = await query('SELECT publication_intent FROM wujie_canvas_task_publications WHERE task_id=$1', [payload.taskId]);
    expect(publication.rows).toHaveLength(1);
    expect(publication.rows[0].publication_intent.imageEditOutputs.includeMask).toBe(true);
    const versions = (await query('SELECT id,task_id,metadata,file_url FROM wujie_asset_versions WHERE task_id=$1 ORDER BY (metadata->>\'outputIndex\')::int', [payload.taskId])).rows;
    expect(versions).toHaveLength(2);
    expect(versions.map(version => version.metadata.outputRole)).toEqual(['primary', 'mask']);
    const durable = (await query("SELECT result->'assetProjection'->>'status' AS projection_status FROM cloud_tasks WHERE id=$1", [payload.taskId])).rows[0];
    expect(durable.projection_status).toBe('completed');
    const canvas = (await query("SELECT projection FROM wujie_project_canvas_documents WHERE project_id='source-shared'")).rows[0].projection;
    expect(Object.values(canvas.placements).filter((placement): placement is { assetVersionId: string } =>
      Boolean(placement && typeof placement === 'object' && 'assetVersionId' in placement)
      && versions.some(version => version.id === (placement as { assetVersionId: string }).assetVersionId))).toHaveLength(2);
    for (const [index, version] of versions.entries()) {
      expect(version.file_url).toMatch(/^\/api\/serve-upload\/exports\//);
      const original = await serveUploadGet(new NextRequest(`http://localhost${index === 0 ? payload.imageUrl : payload.maskUrl}`),
        { params: Promise.resolve({ path: (index === 0 ? payload.imageUrl : payload.maskUrl).slice('/api/serve-upload/'.length).split('/') }) });
      const published = await serveUploadGet(new NextRequest(`http://localhost${version.file_url}`),
        { params: Promise.resolve({ path: version.file_url.slice('/api/serve-upload/'.length).split('/') }) });
      expect(original.status).toBe(200);
      expect(published.status).toBe(200);
      expect(Buffer.from(await published.arrayBuffer())).toEqual(Buffer.from(await original.arrayBuffer()));
    }
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'gpt-image-1': 9 } })]);
    boundary.config.mockResolvedValue([]);
    const replay = await POST(request(body, 'source-editor', 'cpu-removebg-published',
      credentialKind === 'desktop-token' ? credentialKind : undefined));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ taskId: payload.taskId,
      quote: { total: 5, components: { removebg: 5 } } });
    boundary.config.mockResolvedValue(offlineProviders);
    const changed = { ...body } as Record<string, unknown>;
    delete changed.assetSelectedEntityIds;
    const incompatibleReplay = await POST(request(changed, 'source-editor', 'cpu-removebg-published',
      credentialKind === 'desktop-token' ? credentialKind : undefined));
    expect(incompatibleReplay.status).toBe(409);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(pollRequest(payload.taskId, 'source-editor'));
    expect(await polled.json()).toMatchObject({ success: true, taskId: payload.taskId,
      status: 'completed', imageUrl: payload.imageUrl, maskUrl: payload.maskUrl,
      quote: { total: 5, components: { removebg: 5 } } });
    expect((await query('SELECT task_id FROM wujie_asset_versions WHERE task_id=$1', [payload.taskId])).rows).toHaveLength(2);
    expect(boundary.rembg).toHaveBeenCalledTimes(1);
  });
}, 60_000);

it('withholds completed CPU removebg media when the durable result disagrees with its published assets', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-publication-mismatch', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    vi.stubEnv('WUJIE_DATA_DIR_DURABLE', 'true');
    await stubValidRembgOutput();
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu' };
    const preview = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-publication-mismatch'));
    const quote = (await preview.json()).quote as { token: string };
    expect(preview.status).toBe(200);
    const first = await POST(request({ ...body, quoteToken: quote.token },
      'source-editor', 'cpu-removebg-publication-mismatch'));
    const firstPayload = await first.json() as { taskId: string; imageUrl: string };
    expect(first.status).toBe(200);
    await query("UPDATE cloud_tasks SET result=jsonb_set(result::jsonb,'{imageUrl}',to_jsonb($1::text),true) WHERE id=$2",
      ['/api/serve-upload/exports/unpublished.png', firstPayload.taskId]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(pollRequest(firstPayload.taskId, 'source-editor'));
    const polledPayload = await polled.json();
    expect(polled.status).toBe(202);
    expect(polledPayload).toMatchObject({ success: true, taskId: firstPayload.taskId, status: 'publication-pending' });
    expect(polledPayload).not.toHaveProperty('imageUrl');
    expect(polledPayload).not.toHaveProperty('maskUrl');
    const replay = await POST(request(body, 'source-editor', 'cpu-removebg-publication-mismatch'));
    const replayPayload = await replay.json();
    expect(replay.status).toBe(202);
    expect(replayPayload).toMatchObject({ success: true, taskId: firstPayload.taskId, status: 'publication-pending' });
    expect(replayPayload).not.toHaveProperty('imageUrl');
    expect(replayPayload).not.toHaveProperty('maskUrl');
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [firstPayload.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query("SELECT amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ amount: -5 }]);
    expect(boundary.rembg).toHaveBeenCalledTimes(1);
  });
}, 60_000);

it('keeps an explicitly published CPU removebg task pending until its document assets can be projected', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-publication-recovery', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const sourceBytes = await preparePublishableSource(query);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    vi.stubEnv('WUJIE_DATA_DIR_DURABLE', 'true');
    await stubValidRembgOutput();
    const validOutput = await boundary.rembg(Buffer.alloc(0), 'birefnet-general-lite');
    boundary.rembg.mockImplementation(async (): Promise<typeof validOutput> => {
      await unlink(resolve(process.env.WUJIE_DATA_DIR!, 'source-shared.png'));
      return validOutput;
    });
    boundary.rembg.mockClear();
    const body = { action: 'removebg', projectId: 'source-shared', imageUrl: canonicalUrl,
      assetParentVersionIds: ['source-version'], assetProjectionMode: 'derived',
      assetSelectedEntityIds: ['source-image'], engine: 'cpu' };
    const preview = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'cpu-removebg-pending-publication'));
    const quote = (await preview.json()).quote as { total: number; token: string };
    expect(preview.status).toBe(200);
    expect(quote.total).toBe(5);
    const submitted = await POST(request({ ...body, quoteToken: quote.token }, 'source-editor', 'cpu-removebg-pending-publication'));
    const pending = await submitted.json();
    expect(submitted.status, JSON.stringify(pending)).toBe(202);
    expect(pending).toMatchObject({ success: true, status: 'publication-pending' });
    expect(pending.imageUrl).toBeUndefined();
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [pending.taskId])).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged' }]);
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [pending.taskId])).rows).toHaveLength(0);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const stillPending = await pollTask(pollRequest(pending.taskId, 'source-editor'));
    const stillPendingResult = await stillPending.json();
    expect(stillPending.status, JSON.stringify(stillPendingResult)).toBe(202);
    expect(stillPendingResult).toMatchObject({ success: true, status: 'publication-pending', taskId: pending.taskId });
    expect(stillPendingResult.imageUrl).toBeUndefined();
    const replay = await POST(request(body, 'source-editor', 'cpu-removebg-pending-publication'));
    const replayResult = await replay.json();
    expect(replay.status, JSON.stringify(replayResult)).toBe(202);
    expect(replayResult).toMatchObject({ success: true, status: 'publication-pending', taskId: pending.taskId, reused: true });
    expect(replayResult.imageUrl).toBeUndefined();
    expect(boundary.rembg).toHaveBeenCalledTimes(1);
    const unattemptedTaskId = 'cpu-removebg-publication-unattempted';
    await createCloudTask({ id: unattemptedTaskId, userId: 'source-editor', projectId: 'source-shared',
      type: 'image-edit', status: 'completed', providerId: 'local-rembg', progress: 100,
      createdAt: Date.now(), updatedAt: Date.now(), result: {
        imageEditAdmission: { kind: 'document-cpu-removebg' },
        assetProjection: { status: 'projection_pending' },
      } });
    await query(`INSERT INTO wujie_canvas_task_publications
      (task_id,actor_id,owner_id,project_id,workspace_id,grant_generation,publication_intent)
      SELECT $1,actor_id,owner_id,project_id,workspace_id,grant_generation,publication_intent
      FROM wujie_canvas_task_publications WHERE task_id=$2`, [unattemptedTaskId, pending.taskId]);
    const { drainPendingCpuRemoveBgPublications } = await import('@/lib/collaboration/cpu-removebg-publication-worker');
    const fairness = await drainPendingCpuRemoveBgPublications({ limit: 1, now: Date.now() + 61_000 });
    expect(fairness).toEqual({ selected: 1, attempted: 1 });
    const unattempted = (await query(`SELECT result #>> '{assetProjection,lastAttemptAt}' AS last_attempt_at
      FROM cloud_tasks WHERE id=$1`, [unattemptedTaskId])).rows[0];
    expect(unattempted.last_attempt_at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    await query('DELETE FROM cloud_tasks WHERE id=$1', [unattemptedTaskId]);
    await writeFile(resolve(process.env.WUJIE_DATA_DIR!, 'source-shared.png'), sourceBytes);
    await createCloudTask({ id: 'unrelated-completed-without-publication-intent',
      userId: 'source-editor', projectId: 'source-shared', type: 'image-edit', status: 'completed',
      providerId: 'local-rembg', progress: 100, createdAt: Date.now(), updatedAt: Date.now(),
      result: { imageEditAdmission: { kind: 'document-cpu-removebg' },
        assetProjection: { status: 'projection_pending' } } });
    const publicationKey = canvasTaskOutputCommandKey({ actorId: 'source-editor',
      projectId: 'source-shared', taskId: pending.taskId, outputIndex: 0 });
    const innerLockKey = `document-media:${createHash('sha256').update(JSON.stringify([
      'source-editor', 'source-shared', publicationKey,
    ])).digest('hex')}`;
    const outerLockKey = `cpu-removebg-publication:${pending.taskId}`;
    const originalIntent = (await query(`SELECT publication_intent FROM wujie_canvas_task_publications
      WHERE task_id=$1`, [pending.taskId])).rows[0].publication_intent;
    const lockClient = new Client({ connectionString: databaseUrl });
    await lockClient.connect();
    let innerLocked = false;
    let firstDrain: ReturnType<typeof drainPendingCpuRemoveBgPublications> | undefined;
    try {
      await lockClient.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [innerLockKey]);
      innerLocked = true;
      firstDrain = drainPendingCpuRemoveBgPublications({ limit: 10, now: Date.now() + 61_000 });
      let workerOwnsOuterLock = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const probe = await lockClient.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired', [outerLockKey]);
        if (probe.rows[0].acquired !== true) { workerOwnsOuterLock = true; break; }
        await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [outerLockKey]);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(workerOwnsOuterLock).toBe(true);
      const secondDrain = await drainPendingCpuRemoveBgPublications({ limit: 10, now: Date.now() + 61_000 });
      expect(secondDrain).toEqual({ selected: 1, attempted: 0 });
      await query('UPDATE wujie_canvas_task_publications SET publication_intent=NULL WHERE task_id=$1', [pending.taskId]);
    } finally {
      if (innerLocked) await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [innerLockKey]);
      await lockClient.end();
    }
    expect(await firstDrain).toEqual({ selected: 1, attempted: 1 });
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [pending.taskId])).rows)
      .toHaveLength(0);
    expect((await query(`SELECT result->'assetProjection'->>'status' AS status FROM cloud_tasks
      WHERE id=$1`, [pending.taskId])).rows[0].status).not.toBe('completed');
    await query(`UPDATE wujie_canvas_task_publications SET publication_intent=$2::jsonb
      WHERE task_id=$1`, [pending.taskId, originalIntent]);
    const resumedDrain = await drainPendingCpuRemoveBgPublications({ limit: 10, now: Date.now() + 61_000 });
    expect(resumedDrain).toEqual({ selected: 1, attempted: 1 });
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [pending.taskId])).rows)
      .toHaveLength(2);
    const workerProjection = (await query(`SELECT result->'assetProjection' AS projection,
      status,credit_status FROM cloud_tasks WHERE id=$1`, [pending.taskId])).rows[0];
    expect(workerProjection).toMatchObject({ status: 'completed', credit_status: 'charged',
      projection: { status: 'completed', references: [expect.any(Object), expect.any(Object)] } });
    const canvas = (await query(`SELECT projection FROM wujie_project_canvas_documents
      WHERE project_id='source-shared'`)).rows[0].projection;
    const publishedVersionIds = (await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [pending.taskId]))
      .rows.map(row => row.id);
    expect(Object.values(canvas.placements).filter((placement): placement is { assetVersionId: string } =>
      Boolean(placement && typeof placement === 'object' && 'assetVersionId' in placement)
      && publishedVersionIds.includes((placement as { assetVersionId: string }).assetVersionId))).toHaveLength(2);
    expect(boundary.rembg).toHaveBeenCalledTimes(1);
    const recovered = await pollTask(pollRequest(pending.taskId, 'source-editor'));
    const result = await recovered.json();
    expect(recovered.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({ success: true, status: 'completed', taskId: pending.taskId });
    expect(result.assetProjection?.status).toBe('completed');
    expect((await query('SELECT id FROM wujie_asset_versions WHERE task_id=$1', [pending.taskId])).rows).toHaveLength(2);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual([{ type: 'consume', amount: -5 }]);
  });
}, 60_000);

it('does not complete or retain a charge when CPU outputs have only a non-durable local root', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-nondurable', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    vi.stubEnv('WUJIE_DATA_DIR_DURABLE', 'false');
    await stubValidRembgOutput();
    const response = await POST(request({ action: 'removebg', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, engine: 'cpu' }));
    expect(response.status).toBe(502);
    const task = (await query('SELECT status,credit_status FROM cloud_tasks')).rows;
    expect(task).toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
  });
}, 60_000);

it('times out and refunds an abandoned document CPU removebg task on authenticated poll without a provider send', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-recovery-timeout', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const taskId = 'removebg-cpu-offline-recovery';
    const createdAt = Date.now() - 31 * 60_000;
    await createBillableTask({ userId: 'source-owner', idempotencyKey: 'cpu-recovery',
      requestDigest: 'a'.repeat(64), creditCost: 5,
      task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
        providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
        result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
          requestDigest: 'a'.repeat(64), sourceUrl: canonicalUrl,
          parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
    const activeLease = await claimCloudTaskLease(taskId, 'offline-cpu-worker', 60_000);
    expect(activeLease).not.toBeNull();
    await query('UPDATE cloud_tasks SET created_at=$2, updated_at=$2 WHERE id=$1',
      [taskId, createdAt]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const active = await pollTask(pollRequest(taskId, 'source-owner'));
    expect(await active.json()).toMatchObject({ success: true, taskId, status: 'processing' });
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
      .toEqual([{ balance: 95, total_used: 5 }]);
    await releaseCloudTaskLease(taskId, 'offline-cpu-worker');
    await query('UPDATE cloud_tasks SET lease_expires_at=$2 WHERE id=$1', [taskId, createdAt]);
    const polled = await pollTask(pollRequest(taskId, 'source-owner'));
    expect(await polled.json()).toMatchObject({ success: false, taskId, status: 'timeout' });
    const repeated = await pollTask(pollRequest(taskId, 'source-owner'));
    expect(await repeated.json()).toMatchObject({ success: false, taskId, status: 'timeout' });
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'timeout', credit_status: 'refunded' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
      .toEqual(expect.arrayContaining([{ type: 'consume', amount: -5 }, { type: 'refund', amount: 5 }]));
    expect((await query("SELECT count(*)::int AS count FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
      .toEqual([{ count: 2 }]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('times out and refunds an abandoned document CPU removebg task without any client request', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-background-timeout', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const taskId = 'removebg-cpu-background-timeout';
    const createdAt = Date.now() - 31 * 60_000;
    await createBillableTask({ userId: 'source-owner', idempotencyKey: 'cpu-background-timeout',
      requestDigest: 'b'.repeat(64), creditCost: 5,
      task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
        providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
        result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
          requestDigest: 'b'.repeat(64), sourceUrl: canonicalUrl,
          parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
    const lease = await claimCloudTaskLease(taskId, 'offline-cpu-worker', 60_000);
    expect(lease).not.toBeNull();
    const { drainAbandonedCpuRemoveBgTasks } = await import('@/lib/collaboration/cpu-removebg-timeout-recovery');
    await query('UPDATE cloud_tasks SET created_at=$2,updated_at=$2 WHERE id=$1', [taskId, createdAt]);
    expect(await drainAbandonedCpuRemoveBgTasks()).toMatchObject({ selected: 0, transitioned: 0 });
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending' }]);
    await query('UPDATE cloud_tasks SET lease_expires_at=$2 WHERE id=$1', [taskId, createdAt]);
    const drained = await Promise.all([
      drainAbandonedCpuRemoveBgTasks(), drainAbandonedCpuRemoveBgTasks(),
    ]);

    expect(drained.reduce((total, result) => total + result.transitioned, 0)).toBe(1);
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'timeout', credit_status: 'refunded' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner' ORDER BY created_at")).rows)
      .toEqual([{ type: 'consume', amount: -5 }, { type: 'refund', amount: 5 }]);
    expect(await drainAbandonedCpuRemoveBgTasks()).toMatchObject({ selected: 0, transitioned: 0 });
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('does not refund a CPU task whose admission changes while its recovery lease is claimed', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-recovery-identity-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const taskId = 'removebg-cpu-identity-race';
    const createdAt = Date.now() - 31 * 60_000;
    await createBillableTask({ userId: 'source-owner', idempotencyKey: 'cpu-identity-race',
      requestDigest: 'c'.repeat(64), creditCost: 5,
      task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
        providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
        result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
          requestDigest: 'c'.repeat(64), sourceUrl: canonicalUrl,
          parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
    await query('UPDATE cloud_tasks SET created_at=$2,updated_at=$2,lease_expires_at=$2 WHERE id=$1',
      [taskId, createdAt]);
    await query(`CREATE FUNCTION invalidate_cpu_recovery_admission() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF starts_with(NEW.lease_owner, 'removebg-recovery:') THEN
          NEW.result = jsonb_set(NEW.result, '{imageEditAdmission,kind}', '"other-kind"'::jsonb);
        END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER invalidate_cpu_recovery_admission
      BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION invalidate_cpu_recovery_admission()`);

    const { drainAbandonedCpuRemoveBgTasks } = await import('@/lib/collaboration/cpu-removebg-timeout-recovery');
    expect(await drainAbandonedCpuRemoveBgTasks()).toMatchObject({ selected: 1, transitioned: 0 });
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
      .toEqual([{ balance: 95, total_used: 5 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
      .toEqual([{ type: 'consume', amount: -5 }]);
  });
}, 60_000);

it.each(['pending', 'queued'] as const)(
  'does not claim or refund a document CPU task still in %s on poll', async (status): Promise<void> => {
    await withIsolatedPostgres(`task-image-edit-source-local-rembg-poll-${status}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const taskId = `removebg-cpu-poll-${status}`;
      const createdAt = Date.now() - 31 * 60_000;
      await createBillableTask({ userId: 'source-owner', idempotencyKey: `cpu-poll-${status}`,
        requestDigest: 'd'.repeat(64), creditCost: 5,
        task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
          providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
          result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
            requestDigest: 'd'.repeat(64), sourceUrl: canonicalUrl,
            parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
      await query('UPDATE cloud_tasks SET status=$2,created_at=$3,updated_at=$3,lease_expires_at=$3 WHERE id=$1',
        [taskId, status, createdAt]);
      const { POST: pollTask } = await import('@/app/api/poll-task/route');

      const response = await pollTask(pollRequest(taskId, 'source-owner'));

      expect(await response.json()).toMatchObject({ success: true, taskId, status: 'processing',
        recoveryPending: true });
      expect((await query('SELECT status,credit_status,attempt_count FROM cloud_tasks WHERE id=$1', [taskId])).rows)
        .toEqual([{ status, credit_status: 'pending', attempt_count: 0 }]);
      expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
        .toEqual([{ type: 'consume', amount: -5 }]);
    });
  }, 60_000);

it('does not poll-refund a document CPU task with an empty request digest', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-empty-digest', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const taskId = 'removebg-cpu-empty-digest';
    const createdAt = Date.now() - 31 * 60_000;
    await createBillableTask({ userId: 'source-owner', idempotencyKey: 'cpu-empty-digest',
      requestDigest: 'e'.repeat(64), creditCost: 5,
      task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
        providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
        result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
          requestDigest: 'e'.repeat(64), sourceUrl: canonicalUrl,
          parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
    await query(`UPDATE cloud_tasks SET request_digest='',
      result=jsonb_set(result,'{imageEditAdmission,requestDigest}','""'::jsonb),
      created_at=$2,updated_at=$2,lease_expires_at=$2 WHERE id=$1`, [taskId, createdAt]);
    expect((await query(`SELECT request_digest,
      result #>> '{imageEditAdmission,requestDigest}' AS admission_digest
      FROM cloud_tasks WHERE id=$1`, [taskId])).rows)
      .toEqual([{ request_digest: '', admission_digest: '' }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');

    const response = await pollTask(pollRequest(taskId, 'source-owner'));

    expect(response.status).toBe(404);
    expect((await query('SELECT status,credit_status,attempt_count FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending', attempt_count: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
      .toEqual([{ type: 'consume', amount: -5 }]);
  });
}, 60_000);

it('rejects polling a document CPU task when both request digests are missing', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-missing-digests', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const taskId = 'removebg-cpu-missing-digests';
    const createdAt = Date.now() - 31 * 60_000;
    await createBillableTask({ userId: 'source-owner', idempotencyKey: 'cpu-missing-digests',
      requestDigest: 'g'.repeat(64), creditCost: 5,
      task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
        providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
        result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
          requestDigest: 'g'.repeat(64), sourceUrl: canonicalUrl,
          parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
    await query(`UPDATE cloud_tasks SET request_digest='',
      result=result #- '{imageEditAdmission,requestDigest}',
      created_at=$2,updated_at=$2,lease_expires_at=$2 WHERE id=$1`, [taskId, createdAt]);
    expect((await query(`SELECT request_digest,
      result #>> '{imageEditAdmission,requestDigest}' AS admission_digest
      FROM cloud_tasks WHERE id=$1`, [taskId])).rows)
      .toEqual([{ request_digest: '', admission_digest: null }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');

    const response = await pollTask(pollRequest(taskId, 'source-owner'));

    expect(response.status).toBe(404);
    expect((await query('SELECT status,credit_status,attempt_count FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending', attempt_count: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
      .toEqual([{ type: 'consume', amount: -5 }]);
  });
}, 60_000);

it('does not refund when CPU task identity changes after the recovery re-read but before settlement', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-settlement-identity-race', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const taskId = 'removebg-cpu-settlement-identity-race';
    const createdAt = Date.now() - 31 * 60_000;
    await createBillableTask({ userId: 'source-owner', idempotencyKey: 'cpu-settlement-identity-race',
      requestDigest: 'f'.repeat(64), creditCost: 5,
      task: { id: taskId, projectId: 'source-shared', type: 'image-edit', status: 'processing',
        providerId: 'local-rembg', model: 'birefnet-general-lite', progress: 0,
        result: { imageEditAdmission: { version: 1, kind: 'document-cpu-removebg',
          requestDigest: 'f'.repeat(64), sourceUrl: canonicalUrl,
          parentVersionIds: ['source-version'] } }, createdAt, updatedAt: createdAt } });
    await query('UPDATE cloud_tasks SET created_at=$2,updated_at=$2,lease_expires_at=$2 WHERE id=$1',
      [taskId, createdAt]);
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const originalQuery = Client.prototype.query;
    let heldOnce = false;
    const hook = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client,
      ...args: unknown[]) {
      const run = originalQuery as (this: Client, ...queryArgs: unknown[]) => unknown;
      if (!heldOnce && typeof args[0] === 'string' && args[0].includes('WITH candidate AS (')
        && args[0].includes('FROM cloud_tasks task') && args[0].includes('prior_refund')) {
        heldOnce = true;
        entered();
        return held.then(() => run.apply(this, args));
      }
      return run.apply(this, args);
    } as typeof Client.prototype.query);
    try {
      const { recoverAbandonedCpuRemoveBgTask } = await import('@/lib/collaboration/cpu-removebg-timeout-recovery');
      const recovery = recoverAbandonedCpuRemoveBgTask(taskId, 'source-owner');
      await waiting;
      await query(`UPDATE cloud_tasks SET result=jsonb_set(result,'{imageEditAdmission,kind}',
        '"other-kind"'::jsonb) WHERE id=$1`, [taskId]);
      release();
      expect(await recovery).toBe(false);
      expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
      expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
        .toEqual([{ balance: 95, total_used: 5 }]);
      expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-owner'")).rows)
        .toEqual([{ type: 'consume', amount: -5 }]);
    } finally { release(); hook.mockRestore(); }
  });
}, 60_000);

it('reports cancellation rather than CPU failure when the charged task is cancelled during inference', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local-rembg-cancelled', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    boundary.config.mockResolvedValue([{ id: 'source-image', name: 'Offline image', type: 'image',
      modelType: 'image', isEnabled: true, baseUrl: 'https://image.invalid/v1',
      apiKey: 'offline-image', selectedModels: ['gpt-image-1'], createdAt: 1, updatedAt: 1 }]);
    boundary.rembg.mockImplementation(async (): Promise<{ success: boolean; error: string }> => {
      const task = await query("SELECT id FROM cloud_tasks WHERE user_id='source-editor'");
      expect(task.rows).toHaveLength(1);
      await terminateCloudTaskAndRefund(String(task.rows[0].id), 'cancelled', 'offline cancellation');
      return { success: false, error: 'late CPU failure' };
    });
    const response = await POST(request({ action: 'removebg', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl, engine: 'cpu' }, 'source-editor'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, status: 'cancelled' });
    expect((await query("SELECT status,credit_status FROM cloud_tasks WHERE user_id='source-editor'")).rows)
      .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect((await query("SELECT type,amount FROM wujie_credit_transactions WHERE user_id='source-editor'")).rows)
      .toEqual(expect.arrayContaining([{ type: 'consume', amount: -5 }, { type: 'refund', amount: 5 }]));
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('submits an authorized document version using its server-canonical media path', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-valid', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: `http://localhost${canonicalUrl}`,
      upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(200);
    const completed = await response.json();
    expect(completed).toMatchObject({ success: true, action: 'upscale' });
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(pollRequest(completed.taskId, 'source-owner'));
    expect(await polled.json()).toMatchObject({ success: true, taskId: completed.taskId,
      status: 'completed', imageUrl: completed.imageUrl });
    expect(boundary.sends).toEqual([JSON.stringify({
      image_url: `https://preview.example.invalid${canonicalUrl}`, upscale_factor: 2,
    })]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-owner'")).rows)
      .toMatchObject([{ balance: 93, total_used: 7 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toMatchObject([{ type: 'consume', amount: -7 }]);
    expect((await query('SELECT status FROM cloud_tasks')).rows).toEqual([{ status: 'completed' }]);
  });
}, 60_000);

it.each([
  { name: 'image-upscale', route: '/api/image/upscale', post: upscaleCompatPost },
  { name: 'legacy-upscayl', route: '/api/upscayl', post: legacyUpscaylPost },
])('preserves the authenticated document task and one charge through $name AI compatibility', async ({ name, route, post }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-compat-${name}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url !== 'https://api.302.ai/302/submit/esrgan' || method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
      throw new Error('simulated response loss after provider POST');
    });
    const response = await post(new NextRequest(`http://localhost${route}`, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-test-actor': 'source-editor', 'idempotency-key': `compat-${name}`,
    }, body: JSON.stringify({ imageUrl: canonicalUrl,
      projectId: 'source-shared', assetParentVersionIds: ['source-version'],
      upscaleModel: '302-esrgan', upscaleMode: 'ai', scale: 2, targetWidth: 64, targetHeight: 64 }) }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(202);
    expect(body).toMatchObject({ success: true, status: 'submission-unknown', action: 'upscale' });
    expect((await query('SELECT id,user_id,status,credit_status,credit_cost FROM cloud_tasks')).rows)
      .toEqual([{ id: body.taskId, user_id: 'source-editor', status: 'processing',
        credit_status: 'pending', credit_cost: '7' }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -7 }]);
    expect((await query('SELECT user_id,balance,total_used FROM wujie_credits ORDER BY user_id')).rows)
      .toEqual([{ user_id: 'source-editor', balance: 93, total_used: 7 },
        { user_id: 'source-owner', balance: 100, total_used: 0 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('returns the durable accepted task through upscale-pro AI fallback without charging the owner', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-compat-upscale-pro', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('FAL_API_KEY', '');
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === `http://localhost:5000${canonicalUrl}` && (!method || method === 'GET')) {
        return new Response('', { status: 404 });
      }
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
        throw new Error('simulated response loss after provider POST');
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const requestBody = { imageUrl: canonicalUrl, projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], upscaleModel: '302-esrgan',
      model: 'SeedVR2-Upscaler', providerId: 'enhance-provider-only',
      scale: 2, fallbackToAi: true, skipAiEnhance: true };
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image/upscale-pro', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor',
        'idempotency-key': 'compat-upscale-pro' },
      body: JSON.stringify(requestBody),
    });
    const response = await upscaleProPost(makeRequest());
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(202);
    expect(body).toMatchObject({ success: true, status: 'submission-unknown', action: 'upscale' });
    expect((await query('SELECT id,user_id,status,credit_status,credit_cost FROM cloud_tasks')).rows)
      .toEqual([{ id: body.taskId, user_id: 'source-editor', status: 'processing',
        credit_status: 'pending', credit_cost: '7' }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -7 }]);
    expect((await query('SELECT user_id,balance,total_used FROM wujie_credits ORDER BY user_id')).rows)
      .toEqual([{ user_id: 'source-editor', balance: 93, total_used: 7 },
        { user_id: 'source-owner', balance: 100, total_used: 0 }]);
    expect(boundary.sends).toHaveLength(1);
    const replay = await upscaleProPost(makeRequest());
    const replayBody = await replay.json() as Record<string, unknown>;
    expect(replay.status, JSON.stringify(replayBody)).toBe(202);
    expect(replayBody.taskId).toBe(body.taskId);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('returns a completed upscale-pro fallback as a completed image, not a pending task', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-compat-upscale-pro-completed', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('FAL_API_KEY', '');
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === `http://localhost:5000${canonicalUrl}` && (!method || method === 'GET')) {
        return new Response('', { status: 404 });
      }
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
        return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const response = await upscaleProPost(new NextRequest('http://localhost/api/image/upscale-pro', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ imageUrl: canonicalUrl, projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], upscaleModel: '302-esrgan',
        model: 'SeedVR2-Upscaler', scale: 2, fallbackToAi: true, skipAiEnhance: true }),
    }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ success: true, url: expect.stringMatching(/^https:\/\/preview\.example\.invalid\/api\/serve-upload\//) });
    const tasks = (await query('SELECT id,user_id,status,credit_status FROM cloud_tasks')).rows;
    expect(tasks).toEqual([{ id: body.taskId, user_id: 'source-editor', status: 'completed', credit_status: 'charged' }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -7 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('records the enhanced final image and both provider costs under one completed upscale-pro task', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-compat-upscale-pro-enhanced', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    await query(`INSERT INTO wujie_api_providers
      (id,name,base_url,api_key,is_enabled,type,model_type,selected_models,created_at,updated_at)
      VALUES ('enhance-provider','Offline enhance','https://enhance.invalid/v1','offline-enhance',true,
        'image','image',ARRAY['enhance-image'],1,1)`);
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('FAL_API_KEY', '');
    const enlargedPng = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: '#567890' } }).png().toBuffer();
    let saveCount = 0;
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === `http://localhost:5000${canonicalUrl}` && (!method || method === 'GET')) {
        return new Response('', { status: 404 });
      }
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
      }
      if (url.startsWith('https://preview.example.invalid/api/serve-upload/') && (!method || method === 'GET')) {
        return new Response(new Uint8Array(enlargedPng), { status: 200,
          headers: { 'content-type': 'image/png' } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        return Response.json({ url: 'https://media.invalid/enhanced.png' });
      }
      if (url === 'http://localhost:5000/api/save-image' && method === 'POST') {
        saveCount += 1;
        return Response.json({ success: true, url: `https://preview.example.invalid/api/serve-upload/${saveCount === 1
          ? 'enhanced-test' : 'outer-resized-test'}.png` });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const response = await upscaleProPost(new NextRequest('http://localhost/api/image/upscale-pro', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ imageUrl: canonicalUrl, projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], upscaleModel: '302-esrgan',
        model: 'SeedVR2-Upscaler', scale: 2, fallbackToAi: true,
        originalWidth: 40, originalHeight: 40,
        enhanceModel: 'enhance-image', providerId: 'enhance-provider' }),
    }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ success: true, enhanced: true,
      url: expect.stringMatching(/\/api\/serve-upload\/exports\/.+\.png$/) });
    expect(saveCount).toBe(0);
    const tasks = (await query("SELECT id,user_id,status,credit_cost,result->>'imageUrl' AS image_url FROM cloud_tasks")).rows;
    expect(tasks).toEqual([{ id: body.taskId, user_id: 'source-editor', status: 'completed',
      credit_cost: '11', image_url: body.url }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -11 }]);
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
  });
}, 60_000);

it('confirms the 7+4 quote before delivering the enhanced image in one charged task', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-confirmed-enhance', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    await query(`INSERT INTO wujie_api_providers
      (id,name,base_url,api_key,is_enabled,type,model_type,selected_models,created_at,updated_at)
      VALUES ('enhance-provider','Offline enhance','https://enhance.invalid/v1','offline-enhance',true,
        'image','image',ARRAY['enhance-image'],1,1)`);
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('FAL_API_KEY', '');
    const enlargedPng = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: '#567890' } }).png().toBuffer();
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
      }
      if (url.startsWith('https://preview.example.invalid/api/serve-upload/') && (!method || method === 'GET')) {
        return new Response(new Uint8Array(enlargedPng), { status: 200,
          headers: { 'content-type': 'image/png' } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        return Response.json({ url: 'https://media.invalid/enhanced.png' });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const body = { action: 'upscale', imageUrl: canonicalUrl, projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], upscaleModel: '302-esrgan',
      model: '302-esrgan', providerId: 'source-302',
      upscaleMode: 'ai-only', engine: 'ai-only', scale: 2,
      targetWidth: 64, targetHeight: 64, originalWidth: 32, originalHeight: 32,
      targetPreset: '2x', aspectRatio: '1:1', localModel: 'realesrgan-x4plus', prompt: '',
      enableQualityEnhance: true,
      enhanceModel: 'enhance-provider::enhance-image' };
    const previewResponse = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'confirm-enhance'));
    const preview = await previewResponse.json() as { quote?: { token?: string; total?: number } };
    expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
    expect(preview.quote?.total).toBe(11);
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.sends).toEqual([]);

    const response = await POST(request({ ...body, quoteToken: preview.quote?.token },
      'source-editor', 'confirm-enhance'));
    const result = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({ success: true, enhanced: true,
      quote: { total: 11 }, imageUrl: expect.stringMatching(/\/api\/serve-upload\/exports\/.+\.png$/) });
    expect((await query("SELECT id,user_id,status,credit_cost,result->>'imageUrl' AS image_url FROM cloud_tasks")).rows)
      .toEqual([{ id: result.taskId, user_id: 'source-editor', status: 'completed',
        credit_cost: '11', image_url: result.imageUrl }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -11 }]);
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
    const replay = await POST(request(body, 'source-editor', 'confirm-enhance'));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, reused: true,
      taskId: result.taskId, imageUrl: result.imageUrl, quote: { total: 11 } });
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(1);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -11 }]);
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
  });
}, 60_000);

it('accepts the canvas 302-only quote and charges its documented editor once', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-canvas-quote', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const body = { action: 'upscale', imageUrl: canonicalUrl, projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], model: '302-esrgan', providerId: 'source-302',
      upscaleModel: '302-esrgan', upscaleMode: 'ai-only', engine: 'ai-only', scale: 2,
      targetWidth: 64, targetHeight: 64, originalWidth: 32, originalHeight: 32,
      targetPreset: '2x', aspectRatio: '1:1', localModel: 'realesrgan-x4plus', prompt: '' };
    const previewResponse = await POST(request({ ...body, quoteOnly: true }, 'source-editor', 'canvas-quote'));
    const preview = await previewResponse.json() as { quote?: { total?: number; token?: string } };
    expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
    expect(preview.quote?.total).toBe(7);
    expect((await query('SELECT id FROM cloud_tasks')).rows).toHaveLength(0);
    expect((await query('SELECT id FROM wujie_credit_transactions')).rows).toHaveLength(0);
    expect(boundary.sends).toHaveLength(0);

    const response = await POST(request({ ...body, quoteToken: preview.quote?.token }, 'source-editor', 'canvas-quote'));
    const result = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({ success: true, imageUrl: expect.any(String), quote: { total: 7 } });
    expect((await query('SELECT id,user_id,status,credit_cost FROM cloud_tasks')).rows)
      .toEqual([{ id: result.taskId, user_id: 'source-editor', status: 'completed', credit_cost: '7' }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -7 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('replays the same enhanced upscale-pro task without a second enhancement submission', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-compat-upscale-pro-enhance-replay', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    await query(`INSERT INTO wujie_api_providers
      (id,name,base_url,api_key,is_enabled,type,model_type,selected_models,created_at,updated_at)
      VALUES ('enhance-provider','Offline enhance','https://enhance.invalid/v1','offline-enhance',true,
        'image','image',ARRAY['enhance-image'],1,1)`);
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('FAL_API_KEY', '');
    const enlargedPng = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: '#567890' } }).png().toBuffer();
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === `http://localhost:5000${canonicalUrl}` && (!method || method === 'GET')) {
        return new Response('', { status: 404 });
      }
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
      }
      if (url.startsWith('https://preview.example.invalid/api/serve-upload/') && (!method || method === 'GET')) {
        return new Response(new Uint8Array(enlargedPng), { status: 200,
          headers: { 'content-type': 'image/png' } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        return Response.json({ url: 'https://media.invalid/enhanced.png' });
      }
      if (url === 'http://localhost:5000/api/save-image' && method === 'POST') {
        return Response.json({ success: true, url: 'https://preview.example.invalid/api/serve-upload/enhanced-test.png' });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const makeRequest = (): NextRequest => new NextRequest('http://localhost/api/image/upscale-pro', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor',
        'idempotency-key': 'enhance-replay' },
      body: JSON.stringify({ imageUrl: canonicalUrl, projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], upscaleModel: '302-esrgan',
        model: 'SeedVR2-Upscaler', scale: 2, fallbackToAi: true,
        enhanceModel: 'enhance-image', providerId: 'enhance-provider' }),
    });
    const first = await upscaleProPost(makeRequest());
    const firstBody = await first.json() as Record<string, unknown>;
    expect(first.status, JSON.stringify(firstBody)).toBe(200);
    const replay = await upscaleProPost(makeRequest());
    const replayBody = await replay.json() as Record<string, unknown>;
    expect(replay.status, JSON.stringify(replayBody)).toBe(200);
    expect(replayBody).toMatchObject({ taskId: firstBody.taskId, url: firstBody.url });
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
    expect((await query('SELECT id FROM cloud_tasks')).rows).toEqual([{ id: firstBody.taskId }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -11 }]);
    boundary.config.mockResolvedValue([{ id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
      isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
      selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 }]);
    const afterConfigChange = await upscaleProPost(makeRequest());
    const changedBody = await afterConfigChange.json() as Record<string, unknown>;
    expect(afterConfigChange.status, JSON.stringify(changedBody)).toBe(200);
    expect(changedBody).toMatchObject({ taskId: firstBody.taskId, url: firstBody.url });
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -11 }]);
  });
}, 60_000);

it('refunds the full frozen quote once when the enhancement provider explicitly rejects', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-enhance-rejected', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
      }
      if (url.startsWith('https://preview.example.invalid/api/serve-upload/') && (!method || method === 'GET')) {
        const png = await sharp({ create: { width: 64, height: 64, channels: 3,
          background: '#567890' } }).png().toBuffer();
        return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        return Response.json({ error: { message: 'invalid request: unsupported size' } }, { status: 422 });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const payload = { action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2, enableQualityEnhance: true,
      enhanceModel: 'enhance-image', enhanceProviderId: 'enhance-provider' };
    const first = await POST(request(payload, 'source-editor', 'enhance-rejected'));
    const body = await first.json() as Record<string, unknown>;
    expect(first.status, JSON.stringify(body)).toBe(502);
    expect(body).toMatchObject({ success: false, refunded: true });
    expect((await query('SELECT id,status,credit_status,credit_cost FROM cloud_tasks')).rows)
      .toEqual([{ id: body.taskId, status: 'failed', credit_status: 'refunded', credit_cost: '11' }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY created_at,id')).rows)
      .toEqual([{ type: 'consume', amount: -11 }, { type: 'refund', amount: 11 }]);
    const replay = await POST(request(payload, 'source-editor', 'enhance-rejected'));
    expect(replay.status).toBe(409);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toHaveLength(2);
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
  });
}, 60_000);

it.each([
  { name: 'recovers accepted enhancement on replay', outcome: 'recover' },
  { name: 'keeps cancellation terminal during enhancement recovery', outcome: 'cancel' },
  { name: 'does not complete enhancement after lease takeover', outcome: 'takeover' },
  { name: 'rejects private accepted URL in recovery', outcome: 'unsafe' },
  { name: 'recovers accepted managed enhancement without a provider resend', outcome: 'managed' },
  { name: 'does not trust a provider-spoofed managed export on replay', outcome: 'spoofed' },
])('$name', async ({ outcome }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-enhance-accepted-${outcome}`,
    async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    const enhancedPng = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: '#5a7890' } }).png().toBuffer();
    const foreignExport = outcome === 'spoofed'
      ? await persistAssetBytes({ bytes: enhancedPng, filename: 'foreign-enhancement.png', mimeType: 'image/png' })
      : null;
    if (outcome === 'managed') {
      const readMedia = boundary.media.getMockImplementation();
      let failAcceptedRead = true;
      boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
        if (url.includes('/api/serve-upload/exports/') && failAcceptedRead) {
          failAcceptedRead = false;
          throw new Error('transient accepted managed image read failure');
        }
        if (!readMedia) throw new Error('Missing media test boundary');
        return readMedia(url);
      });
    }
    let taskIdForCancellation = '';
    let safeAttempts = 0;
    boundary.safeDownload.mockImplementation(async (): Promise<{ buffer: Buffer; mimeType: string }> => {
      safeAttempts += 1;
      if (outcome === 'spoofed') throw new Error('Provider-controlled export path is not a public image URL');
      if (safeAttempts <= 2) throw new Error('transient public image download failure');
      if (outcome === 'cancel') {
        await terminateCloudTaskAndRefund(taskIdForCancellation, 'cancelled', 'cancelled during accepted-result recovery');
      } else if (outcome === 'takeover') {
        await query('UPDATE cloud_tasks SET lease_expires_at=0 WHERE id=$1', [taskIdForCancellation]);
        expect(await claimCloudTaskLease(taskIdForCancellation, 'takeover-worker', 60_000)).not.toBeNull();
      }
      return { buffer: enhancedPng, mimeType: 'image/png' };
    });
    let persistAttempts = 0;
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        return Response.json({ url: outcome === 'unsafe'
          ? 'http://127.0.0.1/private-image'
          : outcome === 'managed' ? `data:image/png;base64,${enhancedPng.toString('base64')}`
            : outcome === 'spoofed' ? foreignExport?.url
            : 'https://media.invalid/enhanced.png' });
      }
      if (url === 'http://localhost:5000/api/save-image' && method === 'POST') {
        persistAttempts += 1;
        return Response.json({ error: 'unexpected privileged save' }, { status: 503 });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const payload = { action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2, enableQualityEnhance: true,
      enhanceModel: 'enhance-image', enhanceProviderId: 'enhance-provider' };
    const first = await POST(request(payload, 'source-editor', 'enhance-accepted-recover'));
    const firstBody = await first.json() as Record<string, unknown>;
    taskIdForCancellation = String(firstBody.taskId);
    expect(first.status, JSON.stringify(firstBody)).toBe(202);
    expect((await query("SELECT status,credit_status,credit_cost,result->'imageEditExecution' AS execution FROM cloud_tasks")).rows)
      .toMatchObject([{ status: 'processing', credit_status: 'pending', credit_cost: '11',
        execution: { phases: expect.arrayContaining([expect.objectContaining({ phaseId: 'upscale-quality-enhance',
          attempts: [expect.objectContaining({ status: 'accepted',
            result: expect.objectContaining({ directUrl: outcome === 'unsafe'
              ? 'http://127.0.0.1/private-image'
              : outcome === 'managed' ? expect.stringMatching(/^\/api\/serve-upload\/exports\/.+\.png$/)
                : outcome === 'spoofed' ? foreignExport?.url
                : 'https://media.invalid/enhanced.png' }) })] })]) } }]);
    if (outcome === 'spoofed') {
      const replay = await POST(request(payload, 'source-editor', 'enhance-accepted-recover'));
      expect(await replay.json()).toMatchObject({ taskId: firstBody.taskId, status: 'processing' });
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
      expect(boundary.safeDownload).toHaveBeenCalledTimes(2);
      expect(boundary.sends).toEqual(['upscale', 'enhance']);
      return;
    }
    if (outcome === 'managed') {
      const replay = await POST(request(payload, 'source-editor', 'enhance-accepted-recover'));
      const replayBody = await replay.json() as Record<string, unknown>;
      expect(replay.status, JSON.stringify(replayBody)).toBe(200);
      expect(replayBody).toMatchObject({ success: true, taskId: firstBody.taskId,
        imageUrl: expect.stringMatching(/^\/api\/serve-upload\/uploads\/.+\.png$/),
        enhanced: true, reused: true });
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ status: 'completed', credit_status: 'charged' }]);
      expect(boundary.safeDownload).not.toHaveBeenCalled();
      expect(boundary.sends).toEqual(['upscale', 'enhance']);
      return;
    }
    const failedPersistReplay = await POST(request(payload, 'source-editor', 'enhance-accepted-recover'));
    expect(failedPersistReplay.status).toBe(200);
    expect(await failedPersistReplay.json()).toMatchObject({ taskId: firstBody.taskId, status: 'processing' });
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending' }]);
    const replay = await POST(request(payload, 'source-editor', 'enhance-accepted-recover'));
    const replayBody = await replay.json() as Record<string, unknown>;
    if (outcome === 'unsafe') {
      expect(replay.status).toBe(200);
      expect(replayBody).toMatchObject({ taskId: firstBody.taskId, status: 'processing' });
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending' }]);
      expect(boundary.safeDownload).not.toHaveBeenCalled();
      expect(persistAttempts).toBe(0);
      expect(boundary.sends).toEqual(['upscale', 'enhance']);
      return;
    }
    if (outcome === 'cancel') {
      expect(replay.status, JSON.stringify(replayBody)).toBe(409);
      expect(replayBody).toMatchObject({ taskId: firstBody.taskId, status: 'cancelled' });
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY created_at,id')).rows)
        .toEqual([{ type: 'consume', amount: -11 }, { type: 'refund', amount: 11 }]);
      expect(boundary.sends).toEqual(['upscale', 'enhance']);
      return;
    }
    if (outcome === 'takeover') {
      expect(replay.status, JSON.stringify(replayBody)).toBe(200);
      expect(replayBody).toMatchObject({ taskId: firstBody.taskId, status: 'processing' });
      expect((await query('SELECT status,credit_status,lease_owner FROM cloud_tasks')).rows)
        .toEqual([{ status: 'processing', credit_status: 'pending', lease_owner: 'takeover-worker' }]);
      expect(boundary.sends).toEqual(['upscale', 'enhance']);
      return;
    }
    expect(replay.status, JSON.stringify(replayBody)).toBe(200);
    expect(replayBody).toMatchObject({ success: true, taskId: firstBody.taskId,
      enhanced: true, reused: true });
    expect(typeof replayBody.imageUrl).toBe('string');
    expect((await query("SELECT status,credit_status,result->>'imageUrl' AS image_url FROM cloud_tasks")).rows)
      .toEqual([{ status: 'completed', credit_status: 'charged', image_url: replayBody.imageUrl }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -11 }]);
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
    expect(persistAttempts).toBe(0);
    expect(safeAttempts).toBe(3);
  });
}, 60_000);

it('does not launch a partial AI task for a chained upscale that cannot finish its second pass', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-compat-upscale-pro-chain', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('FAL_KEY', '');
    vi.stubEnv('FAL_API_KEY', '');
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === `http://localhost:5000${canonicalUrl}` && (!method || method === 'GET')) {
        return new Response('', { status: 404 });
      }
      if (url === 'http://localhost:5000/api/image-edit' && method === 'POST') {
        return POST(new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: String(init?.body) }));
      }
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push(String(init?.body));
        throw new Error('simulated response loss after provider POST');
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const response = await upscaleProPost(new NextRequest('http://localhost/api/image/upscale-pro', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'source-editor' },
      body: JSON.stringify({ imageUrl: canonicalUrl, projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], upscaleModel: '302-esrgan',
        model: 'SeedVR2-Upscaler', scale: 2, targetScale: 4,
        fallbackToAi: true, skipAiEnhance: true }),
    }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(502);
    expect(body.code).toBe('UPSCALE_CHAIN_ASYNC_FALLBACK_UNAVAILABLE');
    expect((await query('SELECT id FROM cloud_tasks')).rows).toEqual([]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([]);
    expect((await query('SELECT user_id,balance,total_used FROM wujie_credits ORDER BY user_id')).rows)
      .toEqual([{ user_id: 'source-editor', balance: 100, total_used: 0 },
        { user_id: 'source-owner', balance: 100, total_used: 0 }]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('rejects a document request without one authorized source version', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-missing', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const before = await snapshot(query);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      imageUrl: canonicalUrl, upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_INVALID' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.sends).toEqual([]);
    expect(boundary.mediaReads).toEqual([]);
  });
}, 60_000);

it('rejects versions that are not currently placed and ready in the document', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-placement', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const before = await snapshot(query);
    await query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now() WHERE id='source-placement'");
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.sends).toEqual([]);
    expect(boundary.mediaReads).toEqual([]);
  });
}, 60_000);

it('preserves the personal project upscale path without requiring document versions', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-personal', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-personal','source-owner','Personal')");
    const response = await POST(request({ action: 'upscale', projectId: 'source-personal',
      imageUrl: forgedUrl, upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, action: 'upscale' });
    expect(boundary.sends).toEqual([JSON.stringify({ image_url: forgedUrl, upscale_factor: 2 })]);
  });
}, 60_000);

it('charges an authorized document editor without charging the owner', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-editor', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, action: 'upscale' });
    expect((await query('SELECT user_id,balance,total_used FROM wujie_credits ORDER BY user_id')).rows)
      .toMatchObject([{ user_id: 'source-editor', balance: 93, total_used: 7 },
        { user_id: 'source-owner', balance: 100, total_used: 0 }]);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toMatchObject([{ user_id: 'source-editor', type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('charges the authenticated desktop actor even without a browser session', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-desktop-billing', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const browserless = new NextRequest('http://localhost/api/image-edit', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-test-actor': 'source-editor', 'x-test-credential-kind': 'desktop-token',
    }, body: JSON.stringify({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 64, targetHeight: 64 }) });
    const response = await POST(browserless);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ success: true, action: 'upscale' });
    const tasks = (await query('SELECT id,user_id,status,credit_cost,credit_status FROM cloud_tasks')).rows;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ user_id: 'source-editor', status: 'completed',
      credit_cost: '7', credit_status: 'charged' });
    expect(result.taskId).toBe(tasks[0].id);
    expect((await query('SELECT user_id,type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ user_id: 'source-editor', type: 'consume', amount: -7 }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 93 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('does not leave a legacy document charge when task insertion fails before dispatch', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-legacy-insert-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    await query(`CREATE FUNCTION reject_upscale_task_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'upscale' THEN RAISE EXCEPTION 'injected task insert failure'; END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER reject_upscale_task_insert BEFORE INSERT ON cloud_tasks
      FOR EACH ROW EXECUTE FUNCTION reject_upscale_task_insert()`);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 64, targetHeight: 64 }, 'source-editor'));
    expect(response.status).toBe(500);
    expect((await query('SELECT id FROM cloud_tasks')).rows).toEqual([]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows).toEqual([]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100, total_used: 0 }]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('rejects a version owned by another project before read or charge', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-cross', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_projects(id,owner_id,name) VALUES ('source-other','source-owner','Other')");
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('other-asset','source-owner','source-other','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('other-version','other-asset','source-owner','source-other',$1,'image/png')`, [canonicalUrl]);
    const before = await snapshot(query);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['other-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.mediaReads).toEqual([]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('rejects an unavailable public origin before charging a document 302 task', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-domain', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    const before = await snapshot(query);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_UNAVAILABLE' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.mediaReads).toEqual([]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('runs explicitly local document upscale without requiring a remote public origin', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-local', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', '');
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'local', targetWidth: 64, targetHeight: 64 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, engine: 'fidelity', action: 'upscale' });
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('preserves an authorized managed image query string for local reading and remote 302', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-query', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const versionUrl = `${canonicalUrl}?version=1`;
    await query("UPDATE wujie_asset_versions SET file_url=$1 WHERE id='source-version'", [versionUrl]);
    const read = boundary.media.getMockImplementation();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === versionUrl) return read!(canonicalUrl);
      return read!(url);
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: `http://localhost${versionUrl}`,
      upscaleModel: '302-esrgan', scale: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, action: 'upscale' });
    expect(boundary.sends).toEqual([JSON.stringify({
      image_url: `https://preview.example.invalid${versionUrl}`, upscale_factor: 2,
    })]);
  });
}, 60_000);

it('rejects a revoked document editor before media or ledger access', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-revoked', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
    const before = await snapshot(query);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
    expect(response.status).toBe(403);
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.mediaReads).toEqual([]);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it('does not reuse a charged task when its key is replayed with another authorized source version', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-replay', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("INSERT INTO wujie_assets(id,owner_id,project_id,kind) VALUES ('source-asset-second','source-owner','source-shared','image')");
    await query(`INSERT INTO wujie_asset_versions(id,asset_id,owner_id,project_id,file_url,mime_type)
      VALUES ('source-version-second','source-asset-second','source-owner','source-shared',$1,'image/png')`, [canonicalUrl]);
    await query(`INSERT INTO wujie_workspace_placements
      (id,owner_id,project_id,asset_id,asset_version_id,workspace_kind,workspace_id,entity_type,entity_id)
      VALUES ('source-placement-second','source-owner','source-shared','source-asset-second','source-version-second',
        'canvas','source-shared','canvas-image','source-image-second')`);
    await query(`UPDATE wujie_project_canvas_documents SET projection=jsonb_set(projection,
      '{placements,source-placement-second}',$1::jsonb)`, [JSON.stringify({ assetVersionId: 'source-version-second',
      x: 100, y: 0, width: 32, height: 32, rotation: 0, zIndex: 1 })]);
    const key = 'document-upscale-source-key';
    const body = { action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 };
    const first = await POST(request(body, 'source-owner', key));
    expect(first.status).toBe(200);
    const before = await snapshot(query);
    const sends = [...boundary.sends];
    const replay = await POST(request({ ...body, assetParentVersionIds: ['source-version-second'] }, 'source-owner', key));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ success: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.sends).toEqual(sends);
  });
}, 60_000);

it.each(['core-v2', 'legacy'] as const)('does not charge or send after an editor is revoked while source bytes are loading (%s)', async mode => {
  await withIsolatedPostgres(`task-image-edit-source-race-${mode}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
    const read = boundary.media.getMockImplementation();
    expect(read).toBeDefined();
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const reading = new Promise<void>(resolveReading => { entered = resolveReading; });
    const held = new Promise<void>(resolveHeld => { release = resolveHeld; });
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === canonicalUrl) { entered(); await held; }
      return read!(url);
    });
    const before = await snapshot(query);
    const pending = POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
    try {
      await Promise.race([reading, pending.then(async response => {
        throw new Error(`Request finished before source read: ${response.status}`);
      })]);
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
    } finally { release(); }
    const response = await pending;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect(await snapshot(query)).toEqual(before);
    expect(boundary.sends).toEqual([]);
  });
}, 60_000);

it.each(['core-v2', 'legacy'] as const)('does not send an admitted document task after editor access is revoked at task creation (%s)', async mode => {
  await withIsolatedPostgres(`task-image-edit-source-admission-race-${mode}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
    await query(`CREATE FUNCTION revoke_editor_on_upscale_task() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'upscale' THEN
          UPDATE wujie_project_document_editors SET status='revoked'
          WHERE project_id='source-shared' AND member_user_id='source-editor';
        END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER revoke_editor_on_upscale_task
      AFTER INSERT ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION revoke_editor_on_upscale_task()`);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect(boundary.sends).toEqual([]);
    expect((await query("SELECT status FROM wujie_project_document_editors WHERE member_user_id='source-editor'")).rows)
      .toEqual([{ status: 'revoked' }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY type')).rows)
      .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
  });
}, 60_000);

it('does not refund outside the durable task when revoked-source settlement fails', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-settle-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    await query(`CREATE FUNCTION revoke_editor_on_task_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE wujie_project_document_editors SET status='revoked'
        WHERE project_id='source-shared' AND member_user_id='source-editor';
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER revoke_editor_on_task_insert
      AFTER INSERT ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION revoke_editor_on_task_insert()`);
    await query(`CREATE FUNCTION reject_failed_task_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'failed' THEN RAISE EXCEPTION 'injected settlement failure'; END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER reject_failed_task_settlement
      BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION reject_failed_task_settlement()`);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
    expect(response.status).toBe(500);
    expect(boundary.sends).toEqual([]);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toMatchObject([{ balance: 93, total_used: 7 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending' }]);
  });
}, 60_000);

it.each(['editor', 'placement', 'settings'] as const)('does not complete a document upscale when %s revocation commits while final completion waits for its task row', async revoked => {
  await withIsolatedPostgres(`task-image-edit-source-final-${revoked}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const sent = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const read = boundary.media.getMockImplementation();
    expect(read).toBeDefined();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === outputUrl) { entered(); await held; }
      return read!(url);
    });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(input) !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${String(input)}`);
      }
      boundary.sends.push(String(init.body));
      return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
    });
    const pending = POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
    await sent;
    const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0]?.id as string;
    expect(taskId).toBeTruthy();
    await query('BEGIN');
    try {
      const blocker = (await query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await query('SELECT id FROM cloud_tasks WHERE id=$1 FOR UPDATE', [taskId]);
      release();
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = await query<{ blocked: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS blocked`, [blocker]);
        if (result.rows[0]?.blocked) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting, 'final completion must wait behind the task row lock').toBe(true);
      if (revoked === 'editor') {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      } else if (revoked === 'placement') {
        await query("UPDATE wujie_workspace_placements SET status='trashed',deleted_at=now() WHERE id='source-placement'");
      } else {
        await query("UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='source-shared'");
      }
      await query('COMMIT');
    } catch (error) {
      release();
      await query('ROLLBACK');
      throw error;
    }
    const response = await pending;
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN', taskId });
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('does not start or send a 302 document attempt when access is revoked after the point-in-time check', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-before-start', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const originalQuery = Client.prototype.query;
    let checkpointReads = 0;
    const hook = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client,
      ...args: unknown[]) {
      const run = originalQuery as (this: Client, ...queryArgs: unknown[]) => unknown;
      if (typeof args[0] === 'string' && args[0].includes('FROM cloud_tasks WHERE id=$1 FOR UPDATE')) {
        checkpointReads++;
        if (checkpointReads === 2) { entered(); return held.then(() => run.apply(this, args)); }
      }
      return run.apply(this, args);
    } as typeof Client.prototype.query);
    try {
      const pending = POST(request({ action: 'upscale', projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
        upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
      await waiting;
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      release();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
      expect(boundary.sends).toHaveLength(0);
      expect((await query(`SELECT result #> '{imageEditExecution,phases,0,attempts}' AS attempts,
        status,credit_status FROM cloud_tasks`)).rows)
        .toEqual([{ attempts: [], status: 'failed', credit_status: 'refunded' }]);
      expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
        .toEqual([{ balance: 100 }]);
    } finally { release(); hook.mockRestore(); }
  });
}, 60_000);

it.each(['before', 'after'] as const)('reconciles an upscale when the final COMMIT response is lost %s server commit', async timing => {
  await withIsolatedPostgres(`task-image-edit-source-commit-${timing}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    let lost = false;
    const completedClients = new WeakSet<Client>();
    const originalQuery = Client.prototype.query;
    const hook = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client,
      ...args: unknown[]) {
      const query = originalQuery as (this: Client, ...queryArgs: unknown[]) => unknown;
      if (args[0] === 'COMMIT' && completedClients.has(this) && !lost && timing === 'before') {
        lost = true;
        throw new Error('simulated COMMIT failure before durable commit');
      }
      const pending = query.apply(this, args);
      if (typeof args[0] !== 'string' || !pending || typeof (pending as Promise<unknown>).then !== 'function') {
        return pending;
      }
      const sql = args[0];
      return (pending as Promise<unknown>).then(result => {
        if (sql.includes('UPDATE cloud_tasks') && sql.includes("status = 'completed'")) completedClients.add(this);
        if (sql === 'COMMIT' && completedClients.has(this) && !lost && timing === 'after') {
          lost = true;
          throw new Error('simulated lost COMMIT response after durable commit');
        }
        return result;
      });
    } as typeof Client.prototype.query);
    try {
      const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
        upscaleModel: '302-esrgan', scale: 2 }, 'source-editor'));
      expect(lost).toBe(true);
      expect(response.status).toBe(timing === 'after' ? 200 : 202);
      const result = await response.json();
      expect(result).toMatchObject(timing === 'after'
        ? { success: true, action: 'upscale' }
        : { success: true, action: 'upscale', status: 'completion-unknown',
          code: 'IMAGE_EDIT_COMPLETION_UNKNOWN', requiresReconciliation: true });
      expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [result.taskId])).rows)
        .toEqual([timing === 'after'
          ? { status: 'completed', credit_status: 'charged' }
          : { status: 'processing', credit_status: 'pending' }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -7 }]);
      expect(boundary.sends).toHaveLength(1);
    } finally { hook.mockRestore(); }
  });
}, 60_000);

it('rechecks document access before each tiled provider send', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-tile-revoke', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const read = boundary.media.getMockImplementation();
    const firstPass = await sharp({ create: { width: 128, height: 128, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => (
      url === outputUrl ? firstPass : read!(url)
    ));
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      if (boundary.sends.length === 1) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return Response.json({ image: { url: outputUrl, width: 128, height: 128 } });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 256, targetHeight: 256 }, 'source-editor'));
    expect(boundary.sends).toHaveLength(1);
    expect(response.status).toBe(403);
    const result = await response.json();
    expect(result).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect(result.taskId).toBe((await query('SELECT id FROM cloud_tasks')).rows[0]?.id);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
  });
}, 60_000);

it('does not refund outside the tiled task when revoked-source settlement fails', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-tile-settle-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    const read = boundary.media.getMockImplementation();
    const firstPass = await sharp({ create: { width: 128, height: 128, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => (
      url === outputUrl ? firstPass : read!(url)
    ));
    await query(`CREATE FUNCTION reject_tile_failed_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'failed' THEN RAISE EXCEPTION 'injected tile settlement failure'; END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER reject_tile_failed_settlement
      BEFORE UPDATE ON cloud_tasks FOR EACH ROW EXECUTE FUNCTION reject_tile_failed_settlement()`);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      if (boundary.sends.length === 1) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return Response.json({ image: { url: outputUrl, width: 128, height: 128 } });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 256, targetHeight: 256 }, 'source-editor'));
    expect(response.status).toBe(500);
    expect(boundary.sends).toHaveLength(1);
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toMatchObject([{ balance: 93, total_used: 7 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending' }]);
  });
}, 60_000);

it.each(['legacy', 'core-v2'] as const)('does not treat revoked document access as an automatic upscale fallback (%s)', async mode => {
  await withIsolatedPostgres(`task-image-edit-source-auto-revoke-${mode}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', mode);
    const read = boundary.media.getMockImplementation();
    const firstPass = await sharp({ create: { width: 128, height: 128, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => (
      url === outputUrl ? firstPass : read!(url)
    ));
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      if (boundary.sends.length === 1) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return Response.json({ image: { url: outputUrl, width: 128, height: 128 } });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 256, targetHeight: 256 }, 'source-editor'));
    expect(boundary.sends).toHaveLength(1);
    expect(response.status).toBe(403);
    const result = await response.json();
    expect(result).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    const tasks = (await query('SELECT id,status,credit_status FROM cloud_tasks')).rows;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'failed', credit_status: 'refunded' });
    expect(result.taskId).toBe(tasks[0].id);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions ORDER BY type')).rows)
      .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
  });
}, 60_000);

it.each([
  { name: 'direct', targetWidth: 64, targetHeight: 64 },
  { name: 'tiled', targetWidth: 256, targetHeight: 256 },
])('retains the charged $name task after a 302 POST loses its response', async ({ name, targetWidth, targetHeight }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-unknown-${name}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url !== 'https://api.302.ai/302/submit/esrgan' || method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
      throw new Error('simulated response loss after POST');
    });
    const payload = { action: 'upscale', projectId: 'source-shared', assetParentVersionIds: ['source-version'],
      imageUrl: canonicalUrl, model: '302-esrgan', engine: 'auto', targetWidth, targetHeight };
    const response = await POST(request(payload, 'source-editor', `unknown-${name}`));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, status: 'submission-unknown', action: 'upscale' });
    const task = (await query("SELECT id,status,credit_status,result->'imageEditExecution' AS execution FROM cloud_tasks")).rows;
    expect(task).toHaveLength(1);
    expect(body.taskId).toBe(task[0].id);
    expect(task[0]).toMatchObject({ status: 'processing', credit_status: 'pending' });
    expect(task[0].execution.phases[0].attempts[0].status).toBe('started');
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 93 }]);
    const replay = await POST(request(payload, 'source-editor', `unknown-${name}`));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, taskId: task[0].id, reused: true });
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it.each([
  { name: 'direct', targetWidth: 64, targetHeight: 64 },
  { name: 'tiled', targetWidth: 256, targetHeight: 256 },
])('does not refund an uncertain $name submission after document access is revoked', async ({ name, targetWidth, targetHeight }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-unknown-revoked-${name}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const sent = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url !== 'https://api.302.ai/302/submit/esrgan' || method !== 'POST') throw new Error(`Undeclared network: ${url}`);
      boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
      entered();
      await held;
      throw new Error('simulated lost response after send');
    });
    const pending = POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth, targetHeight }, 'source-editor', `unknown-revoked-${name}`));
    try {
      await sent;
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      release();
      const response = await pending;
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toMatchObject({ success: true, status: 'submission-unknown', action: 'upscale' });
      expect((await query('SELECT id,status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ id: body.taskId, status: 'processing', credit_status: 'pending' }]);
      expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
        .toEqual([{ type: 'consume', amount: -7 }]);
      expect(boundary.sends).toHaveLength(1);
    } finally { release(); }
  });
}, 60_000);

it('does not mutate a cancelled task when a late 302 response and source revocation collide', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-cancel-revoked-late', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const sent = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url !== 'https://api.302.ai/302/submit/esrgan' || method !== 'POST') throw new Error(`Undeclared network: ${url}`);
      boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
      entered();
      await held;
      return Response.json({ image: { url: outputUrl, width: 64, height: 64 } });
    });
    const pending = POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 64, targetHeight: 64 }, 'source-editor', 'cancel-revoked-late'));
    try {
      await sent;
      const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
      const cancelled = await terminateCloudTaskAndRefund(taskId, 'cancelled', 'cancelled during provider send');
      expect(cancelled.transitioned).toBe(true);
      await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      const before = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [taskId])).rows;
      const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      release();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ success: false, code: 'TASK_TERMINAL_CONFLICT', taskId, status: 'cancelled' });
      expect((await query('SELECT * FROM cloud_tasks WHERE id=$1', [taskId])).rows).toEqual(before);
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
      expect(boundary.sends).toHaveLength(1);
    } finally { release(); }
  });
}, 60_000);

it('does not settle a cancelled 302 task when cancellation wins after the safety read', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-cancel-before-settle', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url !== 'https://api.302.ai/302/submit/esrgan' || method !== 'POST') throw new Error(`Undeclared network: ${url}`);
      boundary.sends.push(input instanceof Request ? await input.clone().text() : String(init?.body));
      return Response.json({ error: { message: 'invalid request: model not found' } }, { status: 422 });
    });
    let entered: () => void = (): void => {};
    let release: () => void = (): void => {};
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const originalQuery = Client.prototype.query;
    let heldOnce = false;
    const hook = vi.spyOn(Client.prototype, 'query').mockImplementation(function (this: Client,
      ...args: unknown[]) {
      const run = originalQuery as (this: Client, ...queryArgs: unknown[]) => unknown;
      if (!heldOnce && typeof args[0] === 'string' && args[0].includes('WITH candidate AS (')
        && args[0].includes('FROM cloud_tasks task')) {
        heldOnce = true;
        entered();
        return held.then(() => run.apply(this, args));
      }
      return run.apply(this, args);
    } as typeof Client.prototype.query);
    try {
      const pending = POST(request({ action: 'upscale', projectId: 'source-shared',
        assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
        upscaleModel: '302-esrgan', targetWidth: 64, targetHeight: 64 }, 'source-editor', 'cancel-before-settle'));
      await waiting;
      const taskId = (await query('SELECT id FROM cloud_tasks')).rows[0].id as string;
      const cancelled = await terminateCloudTaskAndRefund(taskId, 'cancelled', 'cancelled before failure settlement');
      expect(cancelled.transitioned).toBe(true);
      const before = (await query('SELECT * FROM cloud_tasks WHERE id=$1', [taskId])).rows;
      const ledger = (await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows;
      release();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ success: false, code: 'TASK_TERMINAL_CONFLICT', taskId, status: 'cancelled' });
      expect((await query('SELECT * FROM cloud_tasks WHERE id=$1', [taskId])).rows).toEqual(before);
      expect((await query('SELECT * FROM wujie_credit_transactions ORDER BY id')).rows).toEqual(ledger);
      expect(boundary.sends).toHaveLength(1);
    } finally { release(); hook.mockRestore(); }
  });
}, 60_000);

it.each([
  { name: 'current', stale: false },
  { name: 'after-generic-deadline', stale: true },
])('polls an uncertain 302 task safely $name', async ({ name, stale }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-poll-${name}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      throw new Error('response lost');
    });
    const submitted = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 64, targetHeight: 64 }, 'source-editor'));
    expect(submitted.status).toBe(202);
    const taskId = (await submitted.json()).taskId as string;
    if (stale) await query('UPDATE cloud_tasks SET created_at=$2,updated_at=$2 WHERE id=$1',
      [taskId, Date.now() - 11 * 60_000]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(pollRequest(taskId));
    expect(polled.status).toBe(200);
    expect(await polled.json()).toMatchObject({ success: true, taskId, status: 'processing',
      code: 'IMAGE_EDIT_SUBMISSION_UNKNOWN', requiresReconciliation: true });
    expect((await query('SELECT status,credit_status FROM cloud_tasks WHERE id=$1', [taskId])).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending' }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it.each([
  { name: 'server-error', response: (): Response => Response.json({ error: 'unavailable' }, { status: 503 }) },
  { name: 'malformed-success', response: (): Response => new Response('{', { status: 200 }) },
])('does not refund or retry an explicit 302 task after $name', async ({ name, response: providerResponse }): Promise<void> => {
  await withIsolatedPostgres(`task-image-edit-source-explicit-${name}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      return providerResponse();
    });
    const payload = { action: 'upscale', projectId: 'source-shared', assetParentVersionIds: ['source-version'],
      imageUrl: canonicalUrl, upscaleModel: '302-esrgan', targetWidth: 64, targetHeight: 64 };
    const first = await POST(request(payload, 'source-editor', `explicit-${name}`));
    expect(first.status).toBe(202);
    const task = (await query("SELECT id,status,credit_status,result->'imageEditExecution' AS execution FROM cloud_tasks")).rows;
    expect(task).toHaveLength(1);
    expect(task[0]).toMatchObject({ status: 'processing', credit_status: 'pending' });
    expect(task[0].execution.phases[0].attempts[0].status).toBe('started');
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    const replay = await POST(request(payload, 'source-editor', `explicit-${name}`));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ taskId: task[0].id, reused: true });
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('keeps an accepted 302 submission pending when result download fails', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-accepted-download', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const read = boundary.media.getMockImplementation();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === outputUrl) throw new Error('simulated result download failure');
      return read!(url);
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 64, targetHeight: 64 }, 'source-editor'));
    expect(response.status).toBe(202);
    const task = (await query("SELECT status,credit_status,result->'imageEditExecution' AS execution FROM cloud_tasks")).rows;
    expect(task).toHaveLength(1);
    expect(task[0]).toMatchObject({ status: 'processing', credit_status: 'pending' });
    expect(task[0].execution.phases[0].attempts[0].status).toBe('accepted');
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    const { POST: pollTask } = await import('@/app/api/poll-task/route');
    const polled = await pollTask(pollRequest((await response.json()).taskId));
    expect(await polled.json()).toMatchObject({ success: true, status: 'processing',
      code: 'IMAGE_EDIT_ACCEPTED_RESULT_PENDING', requiresReconciliation: true });
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('completes the same charged auto-selected task when rejected AI falls back to fidelity', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-auto-fidelity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      return Response.json({ error: { message: 'invalid request: offline model rejected' } }, { status: 422 });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 64, targetHeight: 64 }, 'source-editor'));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ success: true, engine: 'fidelity' });
    const tasks = (await query('SELECT id,status,credit_status FROM cloud_tasks')).rows;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'completed', credit_status: 'charged' });
    expect(result.taskId).toBe(tasks[0].id);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 93 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('keeps the frozen upscale and enhance quote when auto 302 rejects and fidelity supplies the intermediate image', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-auto-enhance-fidelity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    const png = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: '#567890' } }).png().toBuffer();
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ error: { message: 'invalid request: offline model rejected' } }, { status: 422 });
      }
      if (url === outputUrl && (!method || method === 'GET')) {
        return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        return Response.json({ url: 'https://media.invalid/enhanced.png' });
      }
      if (url === 'http://localhost:5000/api/save-image' && method === 'POST') {
        return Response.json({ success: true, url: 'https://preview.example.invalid/api/serve-upload/enhanced-test.png' });
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 64, targetHeight: 64,
      enableQualityEnhance: true, enhanceModel: 'enhance-image', enhanceProviderId: 'enhance-provider' },
    'source-editor'));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ success: true, enhanced: true,
      imageUrl: expect.stringMatching(/\/api\/serve-upload\/exports\/.+\.png$/) });
    expect((await query("SELECT status,credit_cost,result->>'imageUrl' AS image_url FROM cloud_tasks")).rows)
      .toEqual([{ status: 'completed', credit_cost: '11', image_url: body.imageUrl }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -11 }]);
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
  });
}, 60_000);

it('keeps the full quoted task pending when enhancement submission becomes unknown after fidelity fallback', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-auto-enhance-unknown', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    const png = await sharp({ create: { width: 64, height: 64, channels: 3,
      background: '#567890' } }).png().toBuffer();
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ error: { message: 'invalid request: offline model rejected' } }, { status: 422 });
      }
      if (url === outputUrl && (!method || method === 'GET')) {
        return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        throw new Error('enhance response lost');
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const payload = { action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 64, targetHeight: 64,
      enableQualityEnhance: true, enhanceModel: 'enhance-image', enhanceProviderId: 'enhance-provider' };
    const first = await POST(request(payload, 'source-editor', 'auto-enhance-unknown'));
    const firstBody = await first.json() as Record<string, unknown>;
    expect(first.status, JSON.stringify(firstBody)).toBe(202);
    expect(firstBody).toMatchObject({ success: true, status: 'submission-unknown' });
    expect((await query("SELECT status,credit_status,credit_cost,result->'imageEditExecution' AS execution FROM cloud_tasks")).rows)
      .toMatchObject([{ status: 'processing', credit_status: 'pending', credit_cost: '11',
        execution: { phases: expect.arrayContaining([expect.objectContaining({ phaseId: 'upscale-quality-enhance',
          attempts: [expect.objectContaining({ status: 'started' })] })]) } }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -11 }]);
    const replay = await POST(request(payload, 'source-editor', 'auto-enhance-unknown'));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ taskId: firstBody.taskId, status: 'processing' });
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
  });
}, 60_000);

it('completes the charged auto-selected tiled task after safe fidelity fallback', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-auto-tile-fidelity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      return Response.json({ error: { message: 'invalid request: offline tile rejected' } }, { status: 422 });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 256, targetHeight: 256 }, 'source-editor'));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ success: true, engine: 'fidelity' });
    const tasks = (await query('SELECT id,status,credit_status FROM cloud_tasks')).rows;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'completed', credit_status: 'charged' });
    expect(result.taskId).toBe(tasks[0].id);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('does not report a tiled fallback completed while enhancement submission is unknown', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-tile-enhance-unknown', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const read = boundary.media.getMockImplementation();
    const cpuResult = await sharp({ create: { width: 256, height: 256, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url.includes('/uploads/upscale_cpu_')) return cpuResult;
      return read!(url);
    });
    await query("UPDATE wujie_system_settings SET value=$1 WHERE key='credit_pricing_config'",
      [JSON.stringify({ modelCredits: { '302-esrgan': 7, 'enhance-image': 4 } })]);
    boundary.config.mockResolvedValue([
      { id: 'source-302', name: 'Offline 302', type: 'upscaler', modelType: 'upscaler',
        isEnabled: true, baseUrl: 'https://api.302.ai', apiKey: 'offline-source',
        selectedModels: ['302-esrgan'], createdAt: 1, updatedAt: 1 },
      { id: 'enhance-provider', name: 'Offline enhance', type: 'image', modelType: 'image',
        isEnabled: true, baseUrl: 'https://enhance.invalid/v1', apiKey: 'offline-enhance',
        selectedModels: ['enhance-image'], createdAt: 1, updatedAt: 1 },
    ]);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const method = input instanceof Request ? input.method : init?.method;
      if (url === 'https://api.302.ai/302/submit/esrgan' && method === 'POST') {
        boundary.sends.push('upscale');
        return Response.json({ error: { message: 'invalid request: offline tile rejected' } }, { status: 422 });
      }
      if (url.startsWith('https://enhance.invalid/') && url.endsWith('/images/generations') && method === 'POST') {
        boundary.sends.push('enhance');
        throw new Error('enhancement response lost');
      }
      throw new Error(`Undeclared network: ${url}`);
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 256, targetHeight: 256,
      enableQualityEnhance: true, enhanceModel: 'enhance-image', enhanceProviderId: 'enhance-provider' },
    'source-editor'));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(202);
    expect((await query('SELECT status,credit_status,credit_cost FROM cloud_tasks')).rows)
      .toEqual([{ status: 'processing', credit_status: 'pending', credit_cost: '11' }]);
    expect(getTaskInfo(String(body.taskId))?.status).toBe('processing');
    expect(boundary.sends).toEqual(['upscale', 'enhance']);
  });
}, 60_000);

it('does not complete a 302 document task when access is revoked while reading its result', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-result-revoke', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const read = boundary.media.getMockImplementation();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === outputUrl) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return read!(url);
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 64, targetHeight: 64 }, 'source-editor'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('rejects auto fidelity completion when document access disappears during CPU work', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-fidelity-revoke', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const read = boundary.media.getMockImplementation();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === outputUrl) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return read!(url);
    });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      return Response.json({ error: { message: 'invalid request: offline model rejected' } }, { status: 422 });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 128, targetHeight: 128 }, 'source-editor'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_SOURCE_FORBIDDEN' });
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
    expect(boundary.sends).toHaveLength(1);
  });
}, 60_000);

it('returns the durable task identity for a successful tiled document upscale', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-tile-identity', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    const read = boundary.media.getMockImplementation();
    const firstPass = await sharp({ create: { width: 128, height: 128, channels: 3,
      background: '#345678' } }).png().toBuffer();
    const finalPass = await sharp(firstPass).resize(256, 256).png().toBuffer();
    const finalUrl = 'https://media.invalid/upscaled-final.png';
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
      if (url === outputUrl) return firstPass;
      if (url === finalUrl) return finalPass;
      return read!(url);
    });
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      const resultUrl = boundary.sends.length === 1 ? outputUrl : finalUrl;
      return Response.json({ image: { url: resultUrl } });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      upscaleModel: '302-esrgan', targetWidth: 256, targetHeight: 256 }, 'source-owner'));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ success: true, tiled: true });
    expect(result.taskId).toBe((await query('SELECT id FROM cloud_tasks')).rows[0]?.id);
    expect((await query('SELECT status FROM cloud_tasks')).rows).toEqual([{ status: 'completed' }]);
    expect(boundary.sends).toHaveLength(2);
  });
}, 60_000);

it('retains a recoverable auto-selected task when its first refund transaction fails', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-auto-refund-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
    const read = boundary.media.getMockImplementation();
    const firstPass = await sharp({ create: { width: 128, height: 128, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => (
      url === outputUrl ? firstPass : read!(url)
    ));
    await query(`CREATE FUNCTION reject_auto_refund_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'refund' THEN RAISE EXCEPTION 'injected auto refund failure'; END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER reject_auto_refund_transaction
      BEFORE INSERT ON wujie_credit_transactions FOR EACH ROW EXECUTE FUNCTION reject_auto_refund_transaction()`);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      if (boundary.sends.length === 1) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return Response.json({ image: { url: outputUrl, width: 128, height: 128 } });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 256, targetHeight: 256 }, 'source-editor'));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toMatchObject({ refunded: true });
    expect((await query("SELECT balance,total_used FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toMatchObject([{ balance: 93, total_used: 7 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
    const pending = (await query('SELECT id,status,credit_status FROM cloud_tasks')).rows;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: 'processing', credit_status: 'pending' });
    await query('DROP TRIGGER reject_auto_refund_transaction ON wujie_credit_transactions');
    const recovered = await terminateCloudTaskAndRefund(pending[0].id, 'failed', 'document source revoked');
    expect(recovered).toMatchObject({ transitioned: true, refunded: true });
    expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
      .toEqual([{ status: 'failed', credit_status: 'refunded' }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 100 }]);
  });
}, 60_000);

it('keeps an ambiguous provider send pending despite concurrent source revocation', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-tile-error-priority', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
    const read = boundary.media.getMockImplementation();
    const wideSource = await sharp({ create: { width: 800, height: 32, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => (
      url === canonicalUrl ? wideSource : read!(url)
    ));
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      if (boundary.sends.length === 1) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      throw new Error('injected provider rejection');
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 4000, targetHeight: 160 }, 'source-editor'));
    expect(boundary.sends.length).toBeGreaterThanOrEqual(1);
    expect(response.status).toBe(202);
    const result = await response.json();
    expect(result).toMatchObject({ success: true, status: 'submission-unknown' });
    expect((await query("SELECT id,status,credit_status,result->'imageEditExecution' AS execution FROM cloud_tasks")).rows)
      .toMatchObject([{ id: result.taskId, status: 'processing', credit_status: 'pending',
        execution: { phases: [{ attempts: [{ status: 'started' }] }] } }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 93 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('does not claim a refund when automatic document access is revoked during task charge', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-charge-revoke-fault', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
    await query(`CREATE FUNCTION revoke_on_consume_reject_refund() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'consume' THEN
          UPDATE wujie_project_document_editors SET status='revoked'
          WHERE member_user_id='source-editor';
        ELSIF NEW.type = 'refund' THEN
          RAISE EXCEPTION 'injected early refund failure';
        END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER revoke_on_consume_reject_refund
      BEFORE INSERT ON wujie_credit_transactions FOR EACH ROW EXECUTE FUNCTION revoke_on_consume_reject_refund()`);
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 64, targetHeight: 64 }, 'source-editor'));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toMatchObject({ refunded: true });
    expect(boundary.sends).toEqual([]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 93 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
  });
}, 60_000);

it('does not retry an uncertain task refund in the same request', async (): Promise<void> => {
  await withIsolatedPostgres('task-image-edit-source-refund-retry', async ({ query, databaseUrl, schemaName }): Promise<void> => {
    await seed(query, databaseUrl, schemaName);
    vi.stubEnv('WUJIE_TASK_CORE_MODE', 'core-v2');
    const read = boundary.media.getMockImplementation();
    const firstPass = await sharp({ create: { width: 128, height: 128, channels: 3,
      background: '#345678' } }).png().toBuffer();
    boundary.media.mockImplementation(async (url: string): Promise<Buffer> => (
      url === outputUrl ? firstPass : read!(url)
    ));
    await query('CREATE SEQUENCE auto_refund_attempt_seq START 1');
    await query(`CREATE FUNCTION reject_first_auto_refund() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'refund' AND nextval('auto_refund_attempt_seq') = 1 THEN
          RAISE EXCEPTION 'injected uncertain refund result';
        END IF;
        RETURN NEW;
      END $$`);
    await query(`CREATE TRIGGER reject_first_auto_refund
      BEFORE INSERT ON wujie_credit_transactions FOR EACH ROW EXECUTE FUNCTION reject_first_auto_refund()`);
    stubProviderFetch(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url !== 'https://api.302.ai/302/submit/esrgan' || init?.method !== 'POST') {
        throw new Error(`Undeclared network: ${url}`);
      }
      boundary.sends.push(String(init.body));
      if (boundary.sends.length === 1) {
        await query("UPDATE wujie_project_document_editors SET status='revoked' WHERE member_user_id='source-editor'");
      }
      return Response.json({ image: { url: outputUrl, width: 128, height: 128 } });
    });
    const response = await POST(request({ action: 'upscale', projectId: 'source-shared',
      assetParentVersionIds: ['source-version'], imageUrl: canonicalUrl,
      model: '302-esrgan', engine: 'auto', targetWidth: 256, targetHeight: 256 }, 'source-editor'));
    expect(response.status).toBe(500);
    expect((await query('SELECT last_value FROM auto_refund_attempt_seq')).rows)
      .toEqual([{ last_value: '1' }]);
    expect((await query("SELECT balance FROM wujie_credits WHERE user_id='source-editor'")).rows)
      .toEqual([{ balance: 93 }]);
    expect((await query('SELECT type,amount FROM wujie_credit_transactions')).rows)
      .toEqual([{ type: 'consume', amount: -7 }]);
  });
}, 60_000);

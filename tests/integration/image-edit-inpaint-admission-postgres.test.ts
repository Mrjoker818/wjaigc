import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiProvider } from '@/lib/universal-api-types';
import type { User } from '@/lib/user-types';
import { withIsolatedPostgres, type QueryFn } from '../helpers/postgres-test-database';

const testEnvironment = await vi.hoisted(async (): Promise<{
  mediaRoot: string;
  previousDataDir: string | undefined;
  previousProjectEnv: string | undefined;
  previousLocalAiEnabled: string | undefined;
  previousTaskCoreMode: string | undefined;
}> => {
  const { requireOfflineBridgeTestDatabaseUrl } = await import('../helpers/offline-bridge-database-guard');
  requireOfflineBridgeTestDatabaseUrl(process.env);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const { requireOfflineBridgeTestMediaRoot } = await import('../helpers/offline-bridge-media-guard');
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wujie-bridge-test-'));
  requireOfflineBridgeTestMediaRoot(mediaRoot);
  const previousDataDir = process.env.WUJIE_DATA_DIR;
  const previousProjectEnv = process.env.COZE_PROJECT_ENV;
  const previousLocalAiEnabled = process.env.LOCAL_AI_ENABLED;
  const previousTaskCoreMode = process.env.WUJIE_TASK_CORE_MODE;
  process.env.WUJIE_DATA_DIR = mediaRoot;
  process.env.COZE_PROJECT_ENV = 'PROD';
  process.env.LOCAL_AI_ENABLED = 'false';
  process.env.WUJIE_TASK_CORE_MODE = 'core-v2';
  vi.stubGlobal('fetch', async (): Promise<never> => { throw new Error('Undeclared network'); });
  return { mediaRoot, previousDataDir, previousProjectEnv,
    previousLocalAiEnabled, previousTaskCoreMode };
});

afterAll(async (): Promise<void> => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const { requireOfflineBridgeTestMediaRoot } = await import('../helpers/offline-bridge-media-guard');
  const mediaRoot = requireOfflineBridgeTestMediaRoot(testEnvironment.mediaRoot);
  if (path.dirname(fs.realpathSync(mediaRoot)) !== fs.realpathSync(os.tmpdir())) {
    throw new Error('Unexpected media root parent; refusing cleanup');
  }
  fs.rmSync(mediaRoot, { recursive: true });
  for (const [key, previous] of [
    ['WUJIE_DATA_DIR', testEnvironment.previousDataDir],
    ['COZE_PROJECT_ENV', testEnvironment.previousProjectEnv],
    ['LOCAL_AI_ENABLED', testEnvironment.previousLocalAiEnabled],
    ['WUJIE_TASK_CORE_MODE', testEnvironment.previousTaskCoreMode],
  ] as const) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

const boundary = vi.hoisted(() => ({
  media: vi.fn<(url: string) => Promise<Buffer>>(),
  config: vi.fn<() => Promise<ApiProvider[]>>(),
  providerPosts: [] as string[],
  mediaReads: [] as string[],
  duringUpload: undefined as undefined | (() => Promise<void>),
}));
vi.mock('server-only', () => ({}));
// Authentication credentials are replaced; authorization still uses the real project and model policy.
vi.mock('@/lib/server-auth', () => ({
  getSessionUser: async (request?: Request): Promise<User | null> => {
    const { dbGetUserById } = await import('@/lib/db-storage');
    const id = request?.headers.get('x-test-actor') || 'inpaint-owner';
    const user = await dbGetUserById(id);
    return user ? { id: user.id, name: user.name, role: user.role, status: user.status,
      createdAt: 1, updatedAt: 1 } as User : null;
  },
}));
vi.mock('@/lib/server-api-config', async original => ({
  ...await original<typeof import('@/lib/server-api-config')>(), getApiProviders: boundary.config,
}));
vi.mock('@/lib/fetch-image-buffer', async original => ({
  ...await original<typeof import('@/lib/fetch-image-buffer')>(), fetchImageBuffer: boundary.media,
}));
vi.mock('@/lib/s3-storage', async original => ({
  ...await original<typeof import('@/lib/s3-storage')>(),
  isS3Available: (): boolean => false,
  uploadBinaryToS3: async (): Promise<null> => {
    await boundary.duringUpload?.();
    return null;
  },
}));

import { POST } from '@/app/api/image-edit/route';
import { POST as cancelTaskPost } from '@/app/api/cancel-task/route';
import { ensureCoreTables } from '@/lib/db-storage';

const sourceUrl = 'https://media.invalid/inpaint-source.png';
const maskUrl = 'https://media.invalid/inpaint-mask.png';
const resultUrl = 'https://media.invalid/inpaint-result.png';
const projectId = 'inpaint-project';
const model = 'gpt-image-1';
const providerId = 'inpaint-provider';
const defaultBody: Record<string, unknown> = {
  action: 'mask', editMode: 'mask', imageUrl: sourceUrl, maskImage: maskUrl,
  projectId, providerId, model, prompt: 'replace the center',
};
let source: Buffer;
let rgbMask: Buffer;
let rgbaSmallMask: Buffer;
let blackMask: Buffer;
let resultImage: Buffer;

function request(body: Record<string, unknown>, actor = 'inpaint-owner'): NextRequest {
  return new NextRequest('http://localhost/api/image-edit', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-actor': actor },
    body: JSON.stringify(body) });
}

async function seed(query: QueryFn, databaseUrl: string, schemaName: string): Promise<void> {
  if (!/^test_task_8cb3j4g_/.test(schemaName)
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
    VALUES ('inpaint-owner','Owner','test','active','user',1,1),
           ('inpaint-foreign','Foreign','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_projects(id,owner_id,name) VALUES
    ($1,'inpaint-owner','Owned'), ('foreign-project','inpaint-foreign','Foreign')`, [projectId]);
  await query(`INSERT INTO wujie_credits(id,user_id,balance,total_recharged,total_used,created_at,updated_at)
    VALUES ('inpaint-credit','inpaint-owner',100,100,0,1,1)`);
  await query(`INSERT INTO wujie_system_settings(key,value,updated_at) VALUES
    ('credit_pricing_config',$1,1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
  [JSON.stringify({ modelCredits: { [`${providerId}::${model}`]: 7 } })]);
}

async function snapshot(query: QueryFn): Promise<Record<string, unknown>> {
  return {
    credits: (await query('SELECT user_id,balance,total_used FROM wujie_credits ORDER BY user_id')).rows,
    transactions: (await query('SELECT type,amount,balance_after FROM wujie_credit_transactions ORDER BY created_at,id')).rows,
    tasks: (await query('SELECT id,status,credit_status FROM cloud_tasks ORDER BY id')).rows,
  };
}

beforeEach(async (): Promise<void> => {
  boundary.mediaReads.length = 0;
  boundary.providerPosts.length = 0;
  boundary.duringUpload = undefined;
  boundary.config.mockResolvedValue([{ id: providerId, name: 'Offline inpaint', type: 'image', modelType: 'image',
    isEnabled: true, baseUrl: 'https://provider.invalid/v1', apiKey: 'offline-inpaint',
    selectedModels: [model], advancedParams: { compatProfile: 'openai' }, createdAt: 1, updatedAt: 1 }]);
  const pixels = Buffer.alloc(8 * 8 * 3);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (y * 8 + x) * 3;
    pixels[i] = x * 20; pixels[i + 1] = y * 20; pixels[i + 2] = 70;
  }
  source = await sharp(pixels, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
  const rgb = Buffer.alloc(8 * 8 * 3);
  for (let y = 2; y <= 3; y++) for (let x = 2; x <= 3; x++) rgb.fill(255, (y * 8 + x) * 3, (y * 8 + x + 1) * 3);
  rgbMask = await sharp(rgb, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
  const rgba = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 16; i++) rgba[i * 4 + 3] = 255;
  rgba.fill(255, (1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4);
  rgbaSmallMask = await sharp(rgba, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
  blackMask = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000000' } }).png().toBuffer();
  resultImage = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer();
  boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
    boundary.mediaReads.push(url);
    if (url === sourceUrl) return source;
    if (url === maskUrl) return rgbMask;
    if (url === resultUrl) return resultImage;
    if (url === 'https://media.invalid/bad-source.png' || url === 'https://media.invalid/bad-mask.png') return Buffer.from('not an image');
    throw new Error(`Undeclared image read: ${url}`);
  });
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = input instanceof Request ? input.method : init?.method;
    if (url !== 'https://provider.invalid/v1/images/generations' || method !== 'POST') throw new Error(`Undeclared network: ${url}`);
    boundary.providerPosts.push(url);
    return Response.json({ data: [{ url: resultUrl }] });
  });
});
afterEach((): void => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('real POST + PostgreSQL inpaint input admission', (): void => {
  it.each(['mask', 'erase'] as const)(
    'atomically cancels one charged %s task while a late provider result is pending',
    async (editMode): Promise<void> => {
    await withIsolatedPostgres(`task-8cb3j4g-cancel-late-${editMode}`, async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      let releaseProvider!: () => void;
      const released = new Promise<void>(resolve => { releaseProvider = resolve; });
      let markEntered!: () => void;
      const entered = new Promise<void>(resolve => { markEntered = resolve; });
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        const method = input instanceof Request ? input.method : init?.method;
        if (url !== 'https://provider.invalid/v1/images/generations' || method !== 'POST') {
          throw new Error(`Undeclared network: ${url}`);
        }
        boundary.providerPosts.push(url);
        markEntered();
        await released;
        return Response.json({ data: [{ url: resultUrl }] });
      });
      const submitted = POST(request({ ...defaultBody, action: editMode, editMode,
        ...(editMode === 'erase' ? { prompt: undefined } : {}) }));
      await Promise.race([entered, submitted.then(response => {
        throw new Error(`Inpaint returned before provider entry: ${response.status}`);
      })]);
      try {
        const rows = (await query('SELECT id,status,credit_status FROM cloud_tasks')).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'processing', credit_status: 'pending' });
        const privateInputs = (await query<{
          task_id: string; source_bytes: Buffer; mask_bytes: Buffer; width: number; height: number;
        }>('SELECT task_id,source_bytes,mask_bytes,width,height FROM wujie_image_edit_private_inputs')).rows;
        expect(privateInputs).toHaveLength(1);
        expect(privateInputs[0]).toMatchObject({ task_id: rows[0].id, width: 8, height: 8 });
        expect(privateInputs[0].source_bytes).toEqual(source);
        expect((await sharp(privateInputs[0].mask_bytes).metadata()).format).toBe('png');
        const cancelled = await cancelTaskPost(new NextRequest('http://localhost/api/cancel-task', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'inpaint-owner' },
          body: JSON.stringify({ taskId: rows[0].id }),
        }));
        expect(cancelled.status, JSON.stringify(await cancelled.clone().json())).toBe(200);
        const repeated = await cancelTaskPost(new NextRequest('http://localhost/api/cancel-task', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-test-actor': 'inpaint-owner' },
          body: JSON.stringify({ taskId: rows[0].id }),
        }));
        expect(repeated.status).toBe(200);
      } finally { releaseProvider(); }
      const late = await submitted;
      expect(late.status).toBe(202);
      expect(await late.json()).toMatchObject({ success: true, recoveryPending: true,
        status: 'submission-unknown' });
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ status: 'cancelled', credit_status: 'refunded' }]);
      expect((await query('SELECT task_id FROM wujie_image_edit_private_inputs')).rows).toEqual([]);
      expect((await query('SELECT type,amount::int FROM wujie_credit_transactions ORDER BY created_at,id')).rows)
        .toEqual([{ type: 'consume', amount: -7 }, { type: 'refund', amount: 7 }]);
      expect(Number((await query("SELECT balance FROM wujie_credits WHERE user_id='inpaint-owner'")).rows[0].balance)).toBe(100);
      expect(boundary.providerPosts).toHaveLength(1);
    });
  }, 60_000);

  it('rejects oversized source, mask and data mask at zero balance before charge or provider work', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4g-input-budget', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      await query("UPDATE wujie_credits SET balance=0 WHERE user_id='inpaint-owner'");
      const overEdge = await sharp({ create: { width: 2049, height: 1, channels: 3,
        background: '#ffffff' } }).png().toBuffer();
      const originalMedia = boundary.media.getMockImplementation();
      const cases = [
        { name: 'source edge', body: defaultBody, read: async (url: string): Promise<Buffer> => {
          boundary.mediaReads.push(url);
          if (url === sourceUrl) return overEdge;
          if (url === maskUrl) return rgbMask;
          throw new Error(`Undeclared image read: ${url}`);
        }, expectedReads: [sourceUrl] },
        { name: 'mask edge', body: defaultBody, read: async (url: string): Promise<Buffer> => {
          boundary.mediaReads.push(url);
          if (url === sourceUrl) return source;
          if (url === maskUrl) return overEdge;
          throw new Error(`Undeclared image read: ${url}`);
        }, expectedReads: [sourceUrl, maskUrl] },
      ];
      for (const testCase of cases) {
        boundary.mediaReads.length = 0;
        boundary.media.mockImplementation(testCase.read);
        const before = await snapshot(query);
        const response = await POST(request(testCase.body));
        expect.soft(response.status, testCase.name).toBe(413);
        expect.soft(await response.json(), testCase.name).toMatchObject({ success: false, code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
        expect.soft(await snapshot(query), testCase.name).toEqual(before);
        expect.soft(boundary.mediaReads, testCase.name).toEqual(testCase.expectedReads);
        expect.soft(boundary.providerPosts, testCase.name).toEqual([]);
      }
      if (originalMedia) boundary.media.mockImplementation(originalMedia);
      boundary.mediaReads.length = 0;
      vi.stubEnv('IMAGE_MAX_SIZE_MB', '1');
      const oversizedBase64 = 'A'.repeat(Math.ceil(1024 * 1024 / 3) * 4 + 128);
      const beforeData = await snapshot(query);
      const eagerReplace = vi.spyOn(String.prototype, 'replace');
      let dataResponse: Response;
      try {
        dataResponse = await POST(request({ ...defaultBody,
          maskImage: `data:image/png;base64,${oversizedBase64}` }));
        expect(eagerReplace).not.toHaveBeenCalledWith(/^data:image\/\w+;base64,/, '');
      } finally {
        eagerReplace.mockRestore();
      }
      expect.soft(dataResponse.status).toBe(413);
      expect.soft(await dataResponse.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
      expect.soft(await snapshot(query)).toEqual(beforeData);
      expect.soft(boundary.mediaReads).toEqual([sourceUrl]);
      expect.soft(boundary.providerPosts).toEqual([]);
      vi.stubEnv('IMAGE_MAX_SIZE_MB', '20');
      vi.stubEnv('IMAGE_MAX_EDGE', '4');
      boundary.mediaReads.length = 0;
      const beforeLowerEdge = await snapshot(query);
      const lowerEdge = await POST(request(defaultBody));
      expect.soft(lowerEdge.status).toBe(413);
      expect.soft(await lowerEdge.json()).toMatchObject({ success: false, code: 'IMAGE_EDIT_INPUT_TOO_LARGE' });
      expect.soft(await snapshot(query)).toEqual(beforeLowerEdge);
      expect.soft(boundary.mediaReads).toEqual([sourceUrl]);
      vi.stubEnv('IMAGE_MAX_EDGE', '2048');
      boundary.mediaReads.length = 0;
      const valid = await POST(request(defaultBody));
      expect.soft(valid.status).toBe(402);
      expect.soft(await snapshot(query)).toEqual(beforeLowerEdge);
      expect.soft(boundary.mediaReads).toEqual([sourceUrl, maskUrl]);
      expect(boundary.providerPosts).toEqual([]);
    });
  }, 60_000);

  it('rejects invalid modes, media and empty masks before any charge or task', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4g-invalid', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const cases: Array<{ name: string; body: Record<string, unknown>; status: number }> = [
        ...(['erase', 'mask', 'inpaint'] as const).flatMap(action => [
          { name: `${action} missing mode`, body: { ...defaultBody, action, editMode: undefined }, status: 400 },
          { name: `${action} invalid mode`, body: { ...defaultBody, action, editMode: 'invalid' }, status: 400 },
        ]),
        { name: 'missing mask', body: { ...defaultBody, maskImage: undefined }, status: 400 },
        { name: 'source read failure', body: { ...defaultBody, imageUrl: 'https://media.invalid/missing-source.png' }, status: 500 },
        { name: 'source decode failure', body: { ...defaultBody, imageUrl: 'https://media.invalid/bad-source.png' }, status: 500 },
        { name: 'mask read failure', body: { ...defaultBody, maskImage: 'https://media.invalid/missing-mask.png' }, status: 500 },
        { name: 'mask decode failure', body: { ...defaultBody, maskImage: 'https://media.invalid/bad-mask.png' }, status: 500 },
        { name: 'empty mask', body: { ...defaultBody, prompt: undefined }, status: 400 },
      ];
      for (const testCase of cases) {
        boundary.mediaReads.length = 0;
        const before = await snapshot(query);
        if (testCase.name === 'empty mask') boundary.media.mockImplementationOnce(async (url: string): Promise<Buffer> => {
          boundary.mediaReads.push(url); return source;
        }).mockImplementationOnce(async (url: string): Promise<Buffer> => {
          boundary.mediaReads.push(url); return blackMask;
        });
        const response = await POST(request(testCase.body));
        expect.soft(response.status, testCase.name).toBe(testCase.status);
        expect.soft(await snapshot(query), testCase.name).toEqual(before);
        expect.soft(boundary.providerPosts, testCase.name).toHaveLength(0);
      }
    });
  }, 60_000);

  it('checks authentication, project and model before media, then checks balance after valid media', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4g-order', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      for (const [body, actor, status] of [
        [defaultBody, 'missing-actor', 401],
        [{ ...defaultBody, projectId: 'foreign-project' }, 'inpaint-owner', 403],
        [{ ...defaultBody, providerId: 'missing-provider' }, 'inpaint-owner', 400],
      ] as const) {
        const before = await snapshot(query);
        const response = await POST(request(body, actor));
        expect.soft(response.status).toBe(status);
        expect.soft(await snapshot(query)).toEqual(before);
        expect.soft(boundary.mediaReads).toEqual([]);
        expect.soft(boundary.providerPosts).toEqual([]);
      }
      await query("UPDATE wujie_credits SET balance=0 WHERE user_id='inpaint-owner'");
      const before = await snapshot(query);
      const invalid = await POST(request({ ...defaultBody, editMode: undefined }));
      expect.soft(invalid.status).toBe(400);
      expect.soft(await snapshot(query)).toEqual(before);
      const valid = await POST(request(defaultBody));
      expect.soft(valid.status).toBe(402);
      expect.soft(await snapshot(query)).toEqual(before);
      expect.soft(boundary.mediaReads).toEqual([sourceUrl, maskUrl]);
      expect(boundary.providerPosts).toEqual([]);
    });
  }, 60_000);

  it('persists composited RGB/RGBA mask results under one charged task each without duplicate preparation', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4g-valid', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      boundary.duringUpload = async (): Promise<void> => {
        const tasks = (await query("SELECT lease_owner FROM cloud_tasks WHERE status='processing'")).rows;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].lease_owner).not.toBe('');
      };
      for (const [name, mask] of [['RGB same size', rgbMask], ['RGBA nearest resize', rgbaSmallMask]] as const) {
        boundary.mediaReads.length = 0;
        boundary.media.mockImplementation(async (url: string): Promise<Buffer> => {
          boundary.mediaReads.push(url);
          if (url === sourceUrl) return source;
          if (url === maskUrl) return mask;
          if (url === resultUrl) return resultImage;
          throw new Error(`Undeclared image read: ${url}`);
        });
        const response = await POST(request({ ...defaultBody, prompt: name === 'RGB same size' ? undefined : 'replace center' }));
        expect(response.status, name).toBe(200);
        const payload = await response.json() as { imageUrl: string; cropInfo: Record<string, number> };
        expect(payload).toMatchObject({ success: true, engine: 'ai-crop-composite' });
        expect(payload.cropInfo).toMatchObject({ cropX: 0, cropY: 0, cropW: 8, cropH: 8 });
        expect(payload.imageUrl).toMatch(/^\/api\/serve-upload\/exports\/[a-f0-9]{16}-[A-Za-z0-9._-]+\.png$/);
        const filename = payload.imageUrl.slice('/api/serve-upload/exports/'.length);
        const output = await sharp(await readFile(resolve(process.env.WUJIE_DATA_DIR!, 'exports', filename)))
          .ensureAlpha().raw().toBuffer();
        const original = await sharp(source).ensureAlpha().raw().toBuffer();
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const i = (y * 8 + x) * 4;
          expect([...output.subarray(i, i + 4)], `${name} pixel ${x},${y}`)
            .toEqual(x >= 2 && x <= 3 && y >= 2 && y <= 3 ? [255, 0, 0, 255] : [...original.subarray(i, i + 4)]);
        }
        expect(boundary.mediaReads).toEqual([sourceUrl, maskUrl, resultUrl]);
        expect(boundary.providerPosts).toHaveLength(name === 'RGB same size' ? 1 : 2);
        expect((await query('SELECT type,amount::int FROM wujie_credit_transactions ORDER BY created_at,id')).rows)
          .toEqual(Array.from({ length: name === 'RGB same size' ? 1 : 2 }, () => ({ type: 'consume', amount: -7 })));
        expect((await query('SELECT type FROM wujie_credit_transactions WHERE type=$1', ['refund'])).rows).toEqual([]);
        expect((await query('SELECT status,credit_status FROM cloud_tasks ORDER BY id')).rows)
          .toEqual(Array.from({ length: name === 'RGB same size' ? 1 : 2 }, () => ({ status: 'completed', credit_status: 'charged' })));
      }
      expect(Number((await query("SELECT balance FROM wujie_credits WHERE user_id='inpaint-owner'")).rows[0].balance)).toBe(86);
    });
  }, 60_000);

  it('preserves every unmasked source pixel for a synchronous erase result', async (): Promise<void> => {
    await withIsolatedPostgres('task-8cb3j4g-erase-composite', async ({ query, databaseUrl, schemaName }): Promise<void> => {
      await seed(query, databaseUrl, schemaName);
      const response = await POST(request({ ...defaultBody, action: 'erase', editMode: 'erase', prompt: undefined }));
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
      const payload = await response.json() as { success: boolean; engine: string; imageUrl: string };
      expect(payload).toMatchObject({ success: true, engine: 'ai-erase' });
      expect(payload.imageUrl).toMatch(/^\/api\/serve-upload\/exports\/[a-f0-9]{16}-[A-Za-z0-9._-]+\.png$/);

      const filename = payload.imageUrl.slice('/api/serve-upload/exports/'.length);
      const output = await sharp(await readFile(resolve(process.env.WUJIE_DATA_DIR!, 'exports', filename)))
        .ensureAlpha().raw().toBuffer();
      const original = await sharp(source).ensureAlpha().raw().toBuffer();
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 4;
        expect([...output.subarray(i, i + 4)], `erase pixel ${x},${y}`)
          .toEqual(x >= 2 && x <= 3 && y >= 2 && y <= 3 ? [255, 0, 0, 255] : [...original.subarray(i, i + 4)]);
      }
      expect(boundary.providerPosts).toHaveLength(1);
      expect((await query('SELECT status,credit_status FROM cloud_tasks')).rows)
        .toEqual([{ status: 'completed', credit_status: 'charged' }]);
      expect((await query('SELECT type,amount::int FROM wujie_credit_transactions ORDER BY created_at,id')).rows)
        .toEqual([{ type: 'consume', amount: -7 }]);
    });
  }, 60_000);
});

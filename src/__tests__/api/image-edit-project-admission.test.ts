import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { withIsolatedPostgres, type QueryFn } from '../../../tests/helpers/postgres-test-database';
import { requireOfflineBridgeTestDatabaseUrl } from '../../../tests/helpers/offline-bridge-database-guard';
import { getPool } from '@/lib/db-client';
import type { User } from '@/lib/user-types';

// Refuse every connection except a newly assigned disposable loopback test database.
requireOfflineBridgeTestDatabaseUrl(process.env);

const boundary = vi.hoisted(() => {
  const reject = (): never => { throw new Error('Unexpected offline downstream boundary'); };
  const spies = {
    session: vi.fn(), desktop: vi.fn(), provider: vi.fn(), providers: vi.fn(), users: vi.fn(),
    consume: vi.fn(), cost: vi.fn(reject), refund: vi.fn(reject),
    mediaRead: vi.fn(reject), mediaWrite: vi.fn(reject), layer: vi.fn(reject),
    localModel: vi.fn(reject), sharp: vi.fn(reject), s3: vi.fn(reject),
    register: vi.fn(reject), update: vi.fn(reject), cancelled: vi.fn(reject),
    persist: vi.fn(reject), billing: vi.fn(reject), dispatch: vi.fn(reject),
    log: vi.fn(), network: vi.fn(reject),
  };
  // Installed before the real route's imports; no network fallthrough, including localhost.
  vi.stubGlobal('fetch', spies.network);
  return spies;
});
vi.mock('server-only', () => ({}));
// Only credential storage is replaced: api-auth, token parsing, secret verification,
// project policy and db-client/pg are real and are never mocked or wrapped.
vi.mock('@/lib/server-auth', () => ({ getSessionUser: boundary.session, listManagedUsers: boundary.users }));
vi.mock('@/lib/desktop-cloud', async original => ({
  ...await original<typeof import('@/lib/desktop-cloud')>(), getDesktopAuth: boundary.desktop,
}));
vi.mock('next/server', async original => ({
  ...await original<typeof import('next/server')>(), after: boundary.dispatch,
}));
vi.mock('@/lib/server-api-config', () => ({
  getApiProviders: boundary.providers,
  findProviderById: boundary.provider, findProviderForModel: boundary.provider,
  findAllProvidersForType: boundary.providers,
  normalizeApiBaseUrl: (value: string): string => value.replace(/\/$/, ''),
}));
vi.mock('@/lib/credits', async original => ({
  ...await original<typeof import('@/lib/credits')>(),
  consumeCredits: boundary.consume, calculateConfiguredCreditCost: boundary.cost, refundCredits: boundary.refund,
}));
vi.mock('@/lib/fetch-image-buffer', () => ({ fetchImageBuffer: boundary.mediaRead }));
vi.mock('@/lib/layer-decomposition/source-image', () => ({ resolveLayerSourceImage: boundary.layer }));
vi.mock('fs/promises', () => ({
  default: { readFile: boundary.mediaRead, writeFile: boundary.mediaWrite, mkdir: boundary.mediaWrite,
    copyFile: boundary.mediaWrite, stat: boundary.mediaRead, access: boundary.mediaRead,
    link: boundary.mediaWrite, rm: boundary.mediaWrite },
  readFile: boundary.mediaRead, writeFile: boundary.mediaWrite, mkdir: boundary.mediaWrite,
  copyFile: boundary.mediaWrite, stat: boundary.mediaRead, access: boundary.mediaRead,
  link: boundary.mediaWrite, rm: boundary.mediaWrite,
}));
vi.mock('sharp', () => ({ default: boundary.sharp }));
vi.mock('@/lib/server-data-root', () => ({ saveImageFile: boundary.mediaWrite, getServerDataRoot: boundary.mediaRead }));
vi.mock('@/lib/s3-storage', () => ({
  isS3Available: boundary.s3, uploadImageToS3: boundary.s3, persistRemoteImage: boundary.s3,
}));
vi.mock('@/lib/image-tools/config', () => ({ LOCAL_AI_ENABLED: false }));
vi.mock('@/lib/image-tools/local-erase-client', () => ({ eraseWithLama: boundary.localModel, VALID_ERASE_MODELS: ['lama'] }));
vi.mock('@/lib/image-tools/rembg-client', () => ({
  DEFAULT_REMBG_MODEL: 'birefnet-general-lite', generateRembgMask: boundary.localModel, isRembgCpuModel: boundary.localModel,
}));
vi.mock('@/lib/image-tools/upscayl', () => ({ performUpscaleAuto: boundary.localModel }));
vi.mock('@/lib/remove-bg-postprocess', () => ({
  postProcessAIRemoveBG: boundary.localModel, postProcessLocalRemoveBG: boundary.localModel,
}));
vi.mock('@/lib/quality-enhance', () => ({ enhanceViaAI: boundary.localModel }));
vi.mock('@/lib/upscale-tile-executor', () => ({ executeOverlapTileUpscale: boundary.localModel }));
vi.mock('@/lib/image-tools/masked-edit-composite', () => ({ compositeMaskedEdit: boundary.localModel }));
vi.mock('@/lib/task-registry', () => ({
  registerTask: boundary.register, updateTaskProgress: boundary.update, isTaskCancelled: boundary.cancelled,
}));
vi.mock('@/lib/cloud-task-persistence', () => ({
  projectPersistedCompletedTask: boundary.persist, recordImageTaskSubmitted: boundary.persist, recordImageTaskTerminal: boundary.persist,
}));
vi.mock('@/lib/cloud-task-storage', async original => ({
  ...await original<typeof import('@/lib/cloud-task-storage')>(),
  completeCloudTask: boundary.persist, terminateCloudTaskAndRefund: boundary.billing,
}));
vi.mock('@/lib/task-core/billing-service', () => ({ createBillableTask: boundary.billing, settleFailedTask: boundary.billing }));
vi.mock('@/lib/op-log', () => ({
  logError: boundary.log, logOperation: boundary.log, OP_ACTIONS: { IMAGE_EDIT: 'image_edit' },
  startTimer: (): { end: () => number } => ({ end: (): number => 0 }),
}));

import { POST } from '@/app/api/image-edit/route';

const secret = 'offline-image-edit-internal-secret-at-least-32';
function user(id = 'actor'): User {
  return { id, name: id, role: id === 'admin' ? 'admin' : 'user', status: 'active', createdAt: 1, updatedAt: 1 };
}
function request(body: unknown, headers: Record<string, string> = {}, raw = false): NextRequest {
  return new NextRequest('http://localhost/api/image-edit', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: raw ? String(body) : JSON.stringify(body),
  });
}
function edit(projectId: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { projectId, action: 'outpaint', editMode: 'erase', imageUrl: 'https://image.invalid/source.png', ...extra };
}
function expectNoEffects(): void {
  for (const [name, spy] of Object.entries(boundary)) {
    if (name !== 'session' && name !== 'desktop') expect(spy, name).not.toHaveBeenCalled();
  }
}
async function expectRejected(response: Response, status: number, code: string, error: string): Promise<void> {
  // Soft status/body assertions retain side-effect evidence in the original-route RED.
  expect.soft(response.status).toBe(status);
  expect.soft(await response.json()).toEqual({ success: false, code, error });
  expectNoEffects();
}
async function expectForbidden(response: Response): Promise<void> {
  await expectRejected(response, 403, 'GENERATION_PROJECT_FORBIDDEN', '无权在此项目中生成图片');
}
async function expectMissingDocumentSource(response: Response): Promise<void> {
  await expectRejected(response, 400, 'IMAGE_EDIT_SOURCE_INVALID', '图片来源与项目资产版本不匹配');
}
type AuthKind = 'cookie' | 'desktop-token' | 'internal';
function authenticate(kind: AuthKind, actor = 'actor'): Record<string, string> {
  boundary.session.mockResolvedValue(kind === 'cookie' ? user(actor) : null);
  boundary.desktop.mockImplementation(async (token: string): Promise<unknown> => (
    kind === 'desktop-token' && token === 'offline-desktop-token' ? { user: user(actor), token } : null
  ));
  return kind === 'internal' ? {
    'x-internal-request': 'true', 'x-internal-user-id': actor, 'x-wujie-internal-secret': secret,
  } : kind === 'desktop-token' ? { authorization: 'Bearer offline-desktop-token' } : {};
}
async function expectOldActionValidation(response: Response): Promise<void> {
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ success: false, error: '缺少或无效的 action 参数' });
  expectNoEffects();
}
async function expectOldCreditStop(response: Response, actor = 'actor'): Promise<void> {
  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({ success: false, error: 'offline-credit-stop' });
  expect(boundary.consume).toHaveBeenCalledWith(actor, 'image_upscale', undefined, undefined,
    'gemini-2.5-flash-image-preview', { providerId: undefined });
  expect(boundary.consume).toHaveBeenCalledTimes(1);
  expect(boundary.providers).toHaveBeenCalledExactlyOnceWith({ strict: true, migrateFileProviders: false });
  boundary.providers.mockClear();
  boundary.users.mockClear();
  boundary.consume.mockClear();
  expectNoEffects();
}
async function expectReleased(query: QueryFn): Promise<void> {
  expect(getPool().totalCount).toBeGreaterThan(0);
  expect(getPool().idleCount).toBe(getPool().totalCount);
  const activity = await query(`SELECT state FROM pg_stat_activity WHERE datname=current_database()
    AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
  expect(activity.rows).toEqual([]);
}

beforeEach((): void => {
  vi.clearAllMocks();
  boundary.session.mockResolvedValue(user());
  boundary.desktop.mockResolvedValue(null);
  boundary.provider.mockResolvedValue(null);
  boundary.providers.mockResolvedValue([{
    id: 'offline-provider', name: 'Offline', type: 'image', modelType: 'image', isEnabled: true,
    baseUrl: 'https://offline.invalid/v1', apiKey: 'offline-credential',
    selectedModels: ['gemini-2.5-flash-image-preview'], createdAt: 1, updatedAt: 1,
  }]);
  boundary.users.mockResolvedValue([user('actor'), user('owner')]);
  boundary.consume.mockResolvedValue({ success: false, cost: 0, message: 'offline-credit-stop' });
  vi.stubGlobal('fetch', boundary.network);
  vi.stubEnv('INTERNAL_API_SECRET', secret);
  vi.stubEnv('WUJIE_YJS_ENABLED', 'true');
  vi.stubEnv('WUJIE_TASK_CORE_MODE', 'legacy');
  vi.stubEnv('APIMART_API_KEY', '');
});
afterEach((): void => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function seed(query: QueryFn): Promise<void> {
  for (const migration of [
    '20260809_wj_core_users.sql', '20260810_wj_stable_s2_assets.sql', '20260924_project_presence.sql',
    '20260925_yjs_canvas_editors.sql', '20260925_yjs_canvas_documents.sql', '20260926_yjs_canvas_authority_fence.sql',
  ]) await query(readFileSync(`migrations/${migration}`, 'utf8'));
  await query(`INSERT INTO wujie_users (id,name,password_hash,status,role,created_at,updated_at)
    VALUES ('actor','Actor','test','active','user',1,1),('owner','Owner','test','active','user',1,1),
      ('admin','Admin','test','active','admin',1,1),('presence','Presence','test','active','user',1,1)`);
  await query(`INSERT INTO wujie_projects (id,owner_id,name,status)
    VALUES ('personal','actor','Personal','active'),('foreign','owner','Foreign','active'),
      ('shared','owner','Shared','active'),('trashed','actor','Trashed','trashed')`);
  await query(`INSERT INTO wujie_user_data (user_id,data_key,data_value,updated_at)
    VALUES ('actor','projects','[{"id":"legacy","userId":"actor"},{"id":"foreign","userId":"actor"},{"id":"trashed","userId":"actor"}]',1)`);
  await query(`INSERT INTO wujie_project_document_settings (project_id,owner_id,enabled) VALUES ('shared','owner',true)`);
  await query(`INSERT INTO wujie_project_canvas_documents (project_id,owner_id) VALUES ('shared','owner')`);
  await query(`INSERT INTO wujie_project_document_editors (project_id,owner_id,member_user_id) VALUES ('shared','owner','actor')`);
  await query(`INSERT INTO wujie_project_presence_members (project_id,owner_id,member_user_id) VALUES ('shared','owner','presence')`);
}

describe('real image-edit POST project admission', (): void => {
  // Missing admission must fail for a real foreign project, before the old credit boundary.
  it('rejects foreign ownership and forged body authority before all effects', async (): Promise<void> => {
    await withIsolatedPostgres('j1-foreign', async ({ query }): Promise<void> => {
      await seed(query);
      await expectForbidden(await POST(request(edit('foreign', { userId: 'owner', ownerId: 'owner' }))));
      expect(boundary.session).toHaveBeenCalledTimes(1);
    });
  });
  it('rejects an invalid project ID before old action validation or billing', async (): Promise<void> => {
    await withIsolatedPostgres('j1-invalid-id', async ({ query }): Promise<void> => {
      await seed(query);
      await expectRejected(await POST(request(edit(42))), 400, 'GENERATION_PROJECT_INVALID', '项目参数无效');
    });
  });
  it('rejects a non-object JSON body without entering the old error/refund catch', async (): Promise<void> => {
    await withIsolatedPostgres('j1-invalid-body', async ({ query }): Promise<void> => {
      await seed(query);
      await expectRejected(await POST(request([])), 400, 'IMAGE_EDIT_INVALID_REQUEST', '图片编辑请求必须是 JSON 对象');
    });
  });

  // Catches moving body parsing ahead of authentication (even for parser failures).
  it.each(['{', 'null', '[]'])('rejects anonymous %s before parsing JSON', async (raw): Promise<void> => {
    boundary.session.mockResolvedValue(null);
    const req = request(raw, {}, true);
    const parse = vi.spyOn(req, 'json');
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required' });
    expect(parse).not.toHaveBeenCalled();
    expect(boundary.session).toHaveBeenCalledTimes(1);
    expectNoEffects();
  });

  for (const kind of ['cookie', 'desktop-token', 'internal'] as const) {
    // Each action must be rejected before dispatch, irrespective of forged authority.
    it.each(['erase', 'mask', 'upscale', 'extend', 'removebg', 'inpaint', 'outpaint',
      'remove_background', 'multi_angle', 'display_decompose'])(`${kind} denies foreign %s with no effects`, async (action): Promise<void> => {
      await withIsolatedPostgres(`j1-${kind}-${action}`, async ({ query }): Promise<void> => {
        await seed(query);
        const headers = authenticate(kind);
        await expectForbidden(await POST(request(edit('foreign', {
          action, userId: 'owner', ownerId: 'owner', actorUserId: 'owner',
          projectAccess: { kind: 'document', ownerId: 'owner', actorUserId: 'owner', grantGeneration: '999' },
          skip: true, skipAuth: true, _skipProjectAuthorization: true, _skipCloudTaskPersistence: true,
          internal: true, prepaid: true, grant: 'editor', grantGeneration: '999',
          // Exercise pre-billing provider selection if admission is accidentally moved later.
          ...(action === 'upscale' ? { upscaleModel: '302-esrgan', providerId: 'offline-provider' } : {}),
        }), headers)));
        expect(boundary.session).toHaveBeenCalledTimes(kind === 'internal' ? 0 : 1);
        if (kind === 'desktop-token') expect(boundary.desktop).toHaveBeenCalledWith('offline-desktop-token');
        await expectReleased(query);
      });
    });

    it.each([
      ['personal', 'actor'], ['legacy', 'actor'], ['shared', 'actor'], ['shared', 'owner'],
      [undefined, 'actor'], [null, 'actor'], ['', 'actor'],
    ] as const)(`${kind} admits %s as %s to existing validation`, async (projectId, actor): Promise<void> => {
      await withIsolatedPostgres(`j1-allow-${kind}`, async ({ query }): Promise<void> => {
        await seed(query);
        const headers = authenticate(kind, actor);
        await expectOldActionValidation(await POST(request({ projectId }, headers)));
        expect(boundary.session).toHaveBeenCalledTimes(kind === 'internal' ? 0 : 1);
      });
    });
  }

  it.each(['personal', 'legacy', undefined, null, ''])('Cookie %s reaches the legacy upscale 402 boundary', async (projectId): Promise<void> => {
    await withIsolatedPostgres('j1-cookie-billing', async ({ query }): Promise<void> => {
      await seed(query);
      await expectOldCreditStop(await POST(request(edit(projectId, { action: 'upscale' }))));
      expect(boundary.session).toHaveBeenCalledTimes(1);
    });
  });
  it('Cookie shared requires a managed source after project authorization', async (): Promise<void> => {
    await withIsolatedPostgres('j1-shared-source', async ({ query }): Promise<void> => {
      await seed(query);
      await expectMissingDocumentSource(await POST(request(edit('shared', { action: 'upscale' }))));
      expect(boundary.session).toHaveBeenCalledTimes(1);
    });
  });

  it('uses internal actor ahead of an owner Cookie for a forbidden project', async (): Promise<void> => {
    await withIsolatedPostgres('j1-internal-first-deny', async ({ query }): Promise<void> => {
      await seed(query);
      const headers = authenticate('internal');
      boundary.session.mockResolvedValue(user('owner'));
      await expectForbidden(await POST(request(edit('foreign'), headers)));
      expect(boundary.session).not.toHaveBeenCalled();
    });
  });
  it('admits and bills the signed internal owner despite a foreign Cookie', async (): Promise<void> => {
    await withIsolatedPostgres('j1-internal-first-allow', async ({ query }): Promise<void> => {
      await seed(query);
      const headers = authenticate('internal', 'owner');
      boundary.session.mockResolvedValue(user('actor'));
      await expectOldCreditStop(await POST(request(edit('foreign', { action: 'upscale' }), headers)), 'owner');
      expect(boundary.session).not.toHaveBeenCalled();
    });
  });
  it('does not authenticate forged internal secret or body identity', async (): Promise<void> => {
    const headers = authenticate('internal', 'owner');
    headers['x-wujie-internal-secret'] = 'forged';
    const response = await POST(request(edit('foreign', { userId: 'owner', ownerId: 'owner' }), headers));
    expect(response.status).toBe(401);
    expectNoEffects();
  });

  it.each([false, 0, 42, {}, [], ['personal'], ' ', ' personal', 'personal ', 'a\nb',
    'a\u0000b', 'a\u007fb', 'a\u0085b', 'x'.repeat(257)].map(projectId => ({ projectId })))('rejects invalid project $projectId', async ({ projectId }): Promise<void> => {
    await expectRejected(await POST(request(edit(projectId))), 400, 'GENERATION_PROJECT_INVALID', '项目参数无效');
    expect(boundary.session).toHaveBeenCalledTimes(1);
  });
  it.each(['{', '', 'null', '[]', '[{}]', 'false', '0', '"owner"'])('rejects invalid JSON/object %s', async (raw): Promise<void> => {
    await expectRejected(await POST(request(raw, {}, true)), 400, 'IMAGE_EDIT_INVALID_REQUEST', '图片编辑请求必须是 JSON 对象');
    expect(boundary.session).toHaveBeenCalledTimes(1);
  });
  it('keeps valid one-character and 256-character project IDs', async (): Promise<void> => {
    await withIsolatedPostgres('j1-id-boundaries', async ({ query }): Promise<void> => {
      await seed(query);
      for (const id of ['x', 'x'.repeat(256)]) {
        await query("INSERT INTO wujie_projects (id,owner_id,name) VALUES ($1,'actor','Boundary')", [id]);
        await expectOldActionValidation(await POST(request({ projectId: id })));
      }
    });
  });

  it.each(['missing', 'trashed'])('denies %s project even with forged legacy authority', async (projectId): Promise<void> => {
    await withIsolatedPostgres('j1-project-state', async ({ query }): Promise<void> => {
      await seed(query);
      await expectForbidden(await POST(request(edit(projectId))));
    });
  });
  it.each(['presence', 'admin'])('does not promote %s to document editor', async (actor): Promise<void> => {
    await withIsolatedPostgres('j1-not-editor', async ({ query }): Promise<void> => {
      await seed(query);
      await expectForbidden(await POST(request(edit('shared'), authenticate('cookie', actor))));
    });
  });
  it.each([
    ['disabled actor', "UPDATE wujie_users SET status='disabled' WHERE id='actor'"],
    ['disabled owner', "UPDATE wujie_users SET status='disabled' WHERE id='owner'"],
    ['archived project', "UPDATE wujie_projects SET status='trashed' WHERE id='shared'"],
    ['disabled document setting', "UPDATE wujie_project_document_settings SET enabled=false WHERE project_id='shared'"],
    ['missing document', "DELETE FROM wujie_project_canvas_documents WHERE project_id='shared'"],
    ['missing setting', "DELETE FROM wujie_project_document_settings WHERE project_id='shared'"],
  ])('denies real PG %s', async (_name, sql): Promise<void> => {
    await withIsolatedPostgres('j1-state-change', async ({ query }): Promise<void> => {
      await seed(query);
      await query(sql);
      await expectForbidden(await POST(request(edit('shared'))));
      await expectReleased(query);
    });
  });
  it.each(['actor', 'owner'])('global switch denies shared %s but leaves personal admission', async (actor): Promise<void> => {
    await withIsolatedPostgres('j1-switch', async ({ query }): Promise<void> => {
      await seed(query);
      vi.stubEnv('WUJIE_YJS_ENABLED', 'false');
      await expectForbidden(await POST(request(edit('shared'), authenticate('cookie', actor))));
      await expectOldActionValidation(await POST(request({ projectId: 'personal' }, authenticate('cookie'))));
    });
  });
  it.each([
    { name: 'duplicate', entries: [{ id: 'legacy', userId: 'actor' }, { id: 'legacy', userId: 'actor' }] },
    { name: 'foreign', entries: [{ id: 'legacy', userId: 'owner' }] },
    { name: 'archived', entries: [{ id: 'legacy', userId: 'actor', status: 'trashed' }] },
  ])('rejects $name legacy fixture', async ({ entries }): Promise<void> => {
    await withIsolatedPostgres('j1-legacy-invalid', async ({ query }): Promise<void> => {
      await seed(query);
      await query("UPDATE wujie_user_data SET data_value=$1::jsonb WHERE user_id='actor' AND data_key='projects'", [JSON.stringify(entries)]);
      await expectForbidden(await POST(request(edit('legacy'))));
    });
  });

  it('reads real PG revocation and regrant on every POST', async (): Promise<void> => {
    await withIsolatedPostgres('j1-regrant', async ({ query }): Promise<void> => {
      await seed(query);
      await expectMissingDocumentSource(await POST(request(edit('shared', { action: 'upscale' }))));
      await query("UPDATE wujie_project_document_editors SET status='revoked', grant_generation=2 WHERE project_id='shared' AND member_user_id='actor'");
      vi.clearAllMocks();
      await expectForbidden(await POST(request(edit('shared'))));
      await query("UPDATE wujie_project_document_editors SET status='active', grant_generation=3 WHERE project_id='shared' AND member_user_id='actor'");
      vi.clearAllMocks();
      await expectMissingDocumentSource(await POST(request(edit('shared', { action: 'upscale' }))));
      await expectReleased(query);
    });
  });
  it('checks foreign project before even existing action validation', async (): Promise<void> => {
    await withIsolatedPostgres('j1-before-action', async ({ query }): Promise<void> => {
      await seed(query);
      await expectForbidden(await POST(request({ projectId: 'foreign', action: 'unknown' })));
      expect(boundary.session).toHaveBeenCalledTimes(1);
    });
  });
  it('returns sanitized 503 on a real missing table and releases its failed transaction', async (): Promise<void> => {
    await withIsolatedPostgres('j1-missing-table', async ({ query }): Promise<void> => {
      await seed(query);
      await query('ALTER TABLE wujie_project_document_editors RENAME TO j1_hidden_editors');
      await expectRejected(await POST(request(edit('shared'))), 503,
        'GENERATION_PROJECT_UNAVAILABLE', '项目权限服务暂不可用，请稍后重试');
      expect(boundary.session).toHaveBeenCalledTimes(1);
      await expectReleased(query);
      await query('ALTER TABLE j1_hidden_editors RENAME TO wujie_project_document_editors');
      await expectOldActionValidation(await POST(request({ projectId: 'shared' })));
    });
  });
  it('releases PG before downstream provider lookup and permits immediate revocation', async (): Promise<void> => {
    await withIsolatedPostgres('j1-provider-unlocked', async ({ query }): Promise<void> => {
      await seed(query);
      const headers = authenticate('desktop-token');
      boundary.providers.mockImplementationOnce(async (): Promise<never[]> => {
        await expectReleased(query);
        await query("SET lock_timeout='300ms'");
        // Exclusive table lock conflicts with an unfinished admission SELECT transaction.
        await query('BEGIN');
        try {
          await query('LOCK TABLE wujie_project_document_editors IN ACCESS EXCLUSIVE MODE');
          await query("UPDATE wujie_project_document_editors SET status='revoked', grant_generation=2 WHERE project_id='shared' AND member_user_id='actor'");
          await query('COMMIT');
        } catch (error) { await query('ROLLBACK'); throw error; }
        return [];
      });
      const response = await POST(request(edit('shared'), headers));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, code: 'IMAGE_EDIT_MODEL_UNAVAILABLE', error: 'IMAGE_EDIT_MODEL_UNAVAILABLE' });
      expect(boundary.providers).toHaveBeenCalledExactlyOnceWith({ strict: true, migrateFileProviders: false });
      expect(boundary.consume).not.toHaveBeenCalled();
      expect(boundary.network).not.toHaveBeenCalled();
      await expectReleased(query);
      vi.clearAllMocks();
      await expectForbidden(await POST(request(edit('shared'), headers)));
    });
  });
});

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasShareRecord } from '@/lib/canvas-share/types';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createCanvasShare: vi.fn(),
  listCanvasShares: vi.fn(),
  patchCanvasSharePolicy: vi.fn(),
  revokeCanvasShare: vi.fn(),
  preflightCanvasShare: vi.fn(),
  dbAddAuditLog: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/db-storage', () => ({ dbAddAuditLog: mocks.dbAddAuditLog }));
vi.mock('@/lib/canvas-share/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/canvas-share/service')>()),
  createCanvasShare: mocks.createCanvasShare,
  listCanvasShares: mocks.listCanvasShares,
  patchCanvasSharePolicy: mocks.patchCanvasSharePolicy,
  revokeCanvasShare: mocks.revokeCanvasShare,
  preflightCanvasShare: mocks.preflightCanvasShare,
}));

import { GET as listShares, POST as createShare } from '@/app/api/canvas-shares/route';
import { PATCH as patchShare } from '@/app/api/canvas-shares/[shareId]/route';
import { POST as revokeShare } from '@/app/api/canvas-shares/[shareId]/revoke/route';
import { POST as preflightShare } from '@/app/api/canvas-shares/preflight/route';
import { CanvasShareError } from '@/lib/canvas-share/errors';

const rawToken = 'raw-token-visible-once';
const activeShare: CanvasShareRecord = {
  id: 'share-1',
  ownerId: 'owner-1',
  projectId: 'project-1',
  projectRevision: 9,
  tokenHash: 'a'.repeat(64),
  title: '客户审阅版',
  status: 'active',
  expiresAt: '2026-10-19T00:00:00.000Z',
  allowDownload: false,
  viewport: { offsetX: 10, offsetY: 20, zoom: 1 },
  snapshotDigest: 'b'.repeat(64),
  viewCount: 3,
  lastViewedAt: '2026-09-19T03:00:00.000Z',
  createdAt: '2026-09-19T00:00:00.000Z',
  revokedAt: null,
};

function mutationRequest(
  path: string,
  body: unknown,
  init: {
    method?: string;
    origin?: string;
    contentType?: string;
    contentLength?: string;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': init.contentType ?? 'application/json',
  };
  if (init.origin !== '') headers.Origin = init.origin ?? 'http://localhost';
  if (init.contentLength !== undefined) headers['Content-Length'] = init.contentLength;
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function streamedMutationRequest(path: string, chunks: string[]): NextRequest {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(encoder.encode(chunk));
    },
  });
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
    },
    body,
    duplex: 'half',
  } as unknown as ConstructorParameters<typeof NextRequest>[1]);
}

function routeContext(shareId = activeShare.id) {
  return { params: Promise.resolve({ shareId }) };
}

async function expectPrivateJson(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  return response.json() as Promise<Record<string, unknown>>;
}

describe('canvas-share owner API', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
    vi.stubEnv('WUJIE_CANVAS_SHARE_ENABLED', 'true');
    mocks.getSessionUser.mockResolvedValue({ id: 'owner-1', name: '所有者', role: 'user' });
    mocks.dbAddAuditLog.mockResolvedValue('audit-1');
    mocks.createCanvasShare.mockResolvedValue({
      share: activeShare,
      token: rawToken,
      itemCount: 2,
    });
    mocks.listCanvasShares.mockResolvedValue([{ ...activeShare, itemCount: 2 }]);
    mocks.patchCanvasSharePolicy.mockResolvedValue({ ...activeShare, allowDownload: true });
    mocks.revokeCanvasShare.mockResolvedValue({
      ...activeShare,
      status: 'revoked',
      revokedAt: '2026-09-19T04:00:00.000Z',
    });
    mocks.preflightCanvasShare.mockResolvedValue({
      projectName: '服务端规范项目名',
      projectRevision: 9,
      itemCount: 2,
      viewport: { offsetX: 10, offsetY: 20, zoom: 1 },
      readiness: { ready: true, failures: [] },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['create', () => createShare(mutationRequest('/api/canvas-shares', {
      projectId: 'project-1', title: '客户审阅版',
    }))],
    ['preflight', () => preflightShare(mutationRequest('/api/canvas-shares/preflight', {
      projectId: 'project-1',
    }))],
  ])('rejects unauthenticated %s before invoking the service', async (_name, call) => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await call();
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(401);
    expect(body).toEqual(expect.objectContaining({
      success: false,
      code: 'AUTHENTICATION_REQUIRED',
      message: expect.stringMatching(/[\u4e00-\u9fff]/u),
    }));
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
    expect(mocks.preflightCanvasShare).not.toHaveBeenCalled();
  });

  it('keeps the feature default-off and returns the stable disabled error', async () => {
    vi.stubEnv('WUJIE_CANVAS_SHARE_ENABLED', 'false');

    const response = await listShares(new NextRequest(
      'http://localhost/api/canvas-shares?projectId=project-1',
    ));
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_DISABLED',
      message: '只读画布分享功能暂不可用',
    }));
    expect(mocks.listCanvasShares).not.toHaveBeenCalled();
  });

  it.each([
    ['missing projectId', { title: '客户审阅版' }],
    ['invalid expiresAt', { projectId: 'project-1', title: '客户审阅版', expiresAt: 'tomorrow' }],
    ['overlong title', { projectId: 'project-1', title: '长'.repeat(201) }],
  ])('rejects create with %s using a safe stable error', async (_name, body) => {
    const response = await createShare(mutationRequest('/api/canvas-shares', body));
    const responseBody = await expectPrivateJson(response);

    expect(response.status).toBe(400);
    expect(responseBody).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_REQUEST_INVALID',
      message: expect.stringMatching(/[\u4e00-\u9fff]/u),
    }));
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without exposing parser details', async () => {
    const response = await createShare(mutationRequest('/api/canvas-shares', '{not-json'));
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({ code: 'CANVAS_SHARE_REQUEST_INVALID' }));
    expect(JSON.stringify(body)).not.toMatch(/SyntaxError|JSON|position|not-json/iu);
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
  });

  it('rejects a declared request body larger than 64 KiB before reading it', async () => {
    const response = await preflightShare(mutationRequest(
      '/api/canvas-shares/preflight',
      { projectId: 'project-1' },
      { contentLength: String(64 * 1024 + 1) },
    ));

    expect(response.status).toBe(400);
    expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_REQUEST_INVALID',
    }));
    expect(mocks.preflightCanvasShare).not.toHaveBeenCalled();
  });

  it('rejects a streamed request body once it exceeds 64 KiB', async () => {
    const response = await preflightShare(streamedMutationRequest(
      '/api/canvas-shares/preflight',
      ['{"projectId":"project-1","padding":"', 'x'.repeat(64 * 1024), '"}'],
    ));

    expect(response.status).toBe(400);
    expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_REQUEST_INVALID',
    }));
    expect(mocks.preflightCanvasShare).not.toHaveBeenCalled();
  });

  it('rejects forged create authority and media relations before the service boundary', async () => {
    const forged = {
      projectId: 'project-1',
      title: '客户审阅版',
      ownerId: 'other-owner',
      projectRevision: 999,
      assetId: 'asset-forged',
      assetVersionId: 'version-forged',
      mediaUrl: 'https://attacker.example/private.png',
      items: [{ assetVersionId: 'version-forged' }],
    };

    const response = await createShare(mutationRequest('/api/canvas-shares', forged));
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({ code: 'CANVAS_SHARE_REQUEST_INVALID' }));
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('attacker.example');
  });

  it('creates only with the session owner and returns the raw token once inside the share URL', async () => {
    const response = await createShare(mutationRequest('/api/canvas-shares', {
      projectId: 'project-1',
      title: '  客户审阅版  ',
      requestedViewport: { offsetX: 10, offsetY: 20, zoom: 1 },
    }));
    const body = await expectPrivateJson(response);
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(mocks.createCanvasShare).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      projectId: 'project-1',
      title: '客户审阅版',
      requestedViewport: { offsetX: 10, offsetY: 20, zoom: 1 },
      allowDownload: false,
    });
    expect(body).toEqual(expect.objectContaining({
      success: true,
      shareUrl: `http://localhost/shared/canvas/${rawToken}`,
      shareId: 'share-1',
      expiresAt: activeShare.expiresAt,
      allowDownload: false,
      snapshot: {
        title: activeShare.title,
        status: 'active',
        projectRevision: 9,
        itemCount: 2,
        createdAt: activeShare.createdAt,
      },
    }));
    expect(serialized.match(new RegExp(rawToken, 'g'))).toHaveLength(1);
    expect(serialized).not.toContain(activeShare.tokenHash);
    expect(serialized).not.toContain(activeShare.ownerId);
    expect(serialized).not.toContain(activeShare.snapshotDigest);
  });

  it('lists only the session owners requested project through a token-free projection', async () => {
    const response = await listShares(new NextRequest(
      'http://localhost/api/canvas-shares?projectId=project-1&ownerId=other-owner',
    ));
    const body = await expectPrivateJson(response);
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(mocks.listCanvasShares).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      projectId: 'project-1',
    });
    expect(body).toEqual(expect.objectContaining({
      shares: [expect.objectContaining({
        shareId: 'share-1',
        title: activeShare.title,
        status: 'active',
        projectRevision: 9,
        itemCount: 2,
        expiresAt: activeShare.expiresAt,
        allowDownload: false,
        viewCount: 3,
      })],
    }));
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain(activeShare.tokenHash);
    expect(serialized).not.toContain(activeShare.ownerId);
    expect(serialized).not.toContain(activeShare.snapshotDigest);
  });

  it('requires a projectId to list owner shares', async () => {
    const response = await listShares(new NextRequest('http://localhost/api/canvas-shares'));

    expect(response.status).toBe(400);
    expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_REQUEST_INVALID',
    }));
    expect(mocks.listCanvasShares).not.toHaveBeenCalled();
  });

  it.each(['title', 'projectRevision', 'viewport', 'snapshotDigest', 'items'])(
    'rejects PATCH attempts to mutate immutable %s',
    async (field) => {
      const response = await patchShare(mutationRequest(
        `/api/canvas-shares/${activeShare.id}`,
        { allowDownload: true, [field]: field === 'items' ? [] : 'forged' },
        { method: 'PATCH' },
      ), routeContext());

      expect(response.status).toBe(400);
      expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({
        code: 'CANVAS_SHARE_REQUEST_INVALID',
      }));
      expect(mocks.patchCanvasSharePolicy).not.toHaveBeenCalled();
    },
  );

  it('patches only policy fields for the session owner', async () => {
    const response = await patchShare(mutationRequest(
      `/api/canvas-shares/${activeShare.id}`,
      { expiresAt: '2026-11-01T00:00:00.000Z', allowDownload: true },
      { method: 'PATCH' },
    ), routeContext());
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(200);
    expect(mocks.patchCanvasSharePolicy).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      shareId: activeShare.id,
      patch: { expiresAt: '2026-11-01T00:00:00.000Z', allowDownload: true },
    });
    expect(body).toEqual(expect.objectContaining({
      share: expect.objectContaining({ shareId: activeShare.id, allowDownload: true }),
    }));
    expect(JSON.stringify(body)).not.toContain(activeShare.tokenHash);
    expect(JSON.stringify(body)).not.toContain(activeShare.snapshotDigest);
  });

  it.each([
    ['missing or foreign', new CanvasShareError('CANVAS_SHARE_NOT_FOUND'), 404, 'CANVAS_SHARE_NOT_FOUND'],
    ['revoked or expired', new CanvasShareError('CANVAS_SHARE_POLICY_CONFLICT'), 409, 'CANVAS_SHARE_POLICY_CONFLICT'],
  ])('maps %s policy targets without disclosing ownership', async (_name, error, status, code) => {
    mocks.patchCanvasSharePolicy.mockRejectedValue(error);

    const response = await patchShare(mutationRequest(
      `/api/canvas-shares/${activeShare.id}`,
      { allowDownload: true },
      { method: 'PATCH' },
    ), routeContext());

    expect(response.status).toBe(status);
    expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({ code }));
  });

  it('revokes idempotently and writes only a redacted audit event', async () => {
    const request = () => mutationRequest(`/api/canvas-shares/${activeShare.id}/revoke`, {});

    const first = await revokeShare(request(), routeContext());
    const second = await revokeShare(request(), routeContext());
    const firstBody = await expectPrivateJson(first);
    const secondBody = await expectPrivateJson(second);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(firstBody.share).toEqual(secondBody.share);
    expect(mocks.revokeCanvasShare).toHaveBeenCalledTimes(2);
    expect(mocks.revokeCanvasShare).toHaveBeenNthCalledWith(1, {
      actorUserId: 'owner-1',
      shareId: activeShare.id,
    });
    expect(mocks.dbAddAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'owner-1',
      action: 'canvas_share_revoke',
      target_id: activeShare.id,
    }));
    const auditText = JSON.stringify(mocks.dbAddAuditLog.mock.calls);
    expect(auditText).not.toContain(rawToken);
    expect(auditText).not.toContain(activeShare.tokenHash);
    expect(auditText).not.toContain('attacker.example');
    expect(auditText).not.toContain(activeShare.snapshotDigest);
  });

  it('preflights authoritative state without creating and ignores forged authority/media fields', async () => {
    const response = await preflightShare(mutationRequest('/api/canvas-shares/preflight', {
      projectId: 'project-1',
      requestedViewport: { offsetX: 10, offsetY: 20, zoom: 1 },
      displayContext: { projectName: '当前项目' },
      ownerId: 'other-owner',
      projectRevision: 999,
      assetId: 'asset-forged',
      assetVersionId: 'version-forged',
      mediaUrl: 'https://attacker.example/private.png',
      items: [{ id: 'forged' }],
    }));
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(200);
    expect(mocks.preflightCanvasShare).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      projectId: 'project-1',
      requestedViewport: { offsetX: 10, offsetY: 20, zoom: 1 },
    });
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
    expect(body).toEqual(expect.objectContaining({
      projectName: '服务端规范项目名',
      projectRevision: 9,
      itemCount: 2,
      viewport: { offsetX: 10, offsetY: 20, zoom: 1 },
      readiness: { ready: true, failures: [] },
    }));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('attacker.example');
    expect(serialized).not.toContain('asset-forged');
    expect(serialized).not.toContain('version-forged');
  });

  it.each([
    ['unknown top-level field', { projectId: 'project-1', projectNmae: 'typo' }],
    ['unknown display field', {
      projectId: 'project-1',
      displayContext: { projectNmae: 'typo' },
    }],
  ])('rejects a preflight %s instead of silently stripping it', async (_name, requestBody) => {
    const response = await preflightShare(mutationRequest(
      '/api/canvas-shares/preflight',
      requestBody,
    ));

    expect(response.status).toBe(400);
    expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({
      code: 'CANVAS_SHARE_REQUEST_INVALID',
    }));
    expect(mocks.preflightCanvasShare).not.toHaveBeenCalled();
  });

  it('returns projected safe readiness failure details without creating a share', async () => {
    mocks.preflightCanvasShare.mockResolvedValue({
      projectName: '服务端规范项目名',
      projectRevision: 12,
      itemCount: 2,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      readiness: {
        ready: false,
        failures: [{
          itemIndex: 1,
          display: { label: '待处理图片' },
          code: 'CANVAS_SHARE_MEDIA_NOT_READY',
          message: '画布中有媒体尚未就绪',
          internalId: 'placement-private',
          mediaUrl: 'https://private.example/media.png',
        }],
      },
      snapshotDigest: 'private-digest',
    });

    const response = await preflightShare(mutationRequest('/api/canvas-shares/preflight', {
      projectId: 'project-1',
    }));
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      projectName: '服务端规范项目名',
      projectRevision: 12,
      itemCount: 2,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      readiness: {
        ready: false,
        failures: [{
          itemIndex: 1,
          display: { label: '待处理图片' },
          code: 'CANVAS_SHARE_MEDIA_NOT_READY',
          message: '画布中有媒体尚未就绪',
        }],
      },
    }));
    expect(JSON.stringify(body)).not.toContain('placement-private');
    expect(JSON.stringify(body)).not.toContain('private.example');
    expect(JSON.stringify(body)).not.toContain('private-digest');
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-origin', { origin: 'https://attacker.example' }, 403, 'CANVAS_SHARE_ORIGIN_INVALID'],
    ['non-JSON', { contentType: 'text/plain' }, 415, 'CANVAS_SHARE_CONTENT_TYPE_UNSUPPORTED'],
  ])('applies management-route protection to %s mutations', async (_name, init, status, code) => {
    const response = await createShare(mutationRequest('/api/canvas-shares', {
      projectId: 'project-1', title: '客户审阅版',
    }, init));

    expect(response.status).toBe(status);
    expect(await expectPrivateJson(response)).toEqual(expect.objectContaining({ code }));
    expect(mocks.createCanvasShare).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected failures and never reflects a token or private media URL', async () => {
    mocks.createCanvasShare.mockRejectedValue(new Error(
      `database failed token=${rawToken} url=https://private.example/media.png`,
    ));

    const response = await createShare(mutationRequest('/api/canvas-shares', {
      projectId: 'project-1', title: '客户审阅版',
    }));
    const body = await expectPrivateJson(response);

    expect(response.status).toBe(500);
    expect(body).toEqual(expect.objectContaining({ code: 'CANVAS_SHARE_REQUEST_FAILED' }));
    expect(JSON.stringify(body)).not.toContain(rawToken);
    expect(JSON.stringify(body)).not.toContain('private.example');
  });
});

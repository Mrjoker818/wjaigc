import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const MockHistoricalMediaRemediationError = vi.hoisted(() => (
  class HistoricalMediaRemediationError extends Error {
    constructor(readonly code: string) { super(code); }
  }
));

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  discover: vi.fn(),
  archive: vi.fn(),
  moduleLoadError: null as Error | null,
  moduleLoads: 0,
}));

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/historical-media-remediation', async (importOriginal) => {
  mocks.moduleLoads += 1;
  if (mocks.moduleLoadError) throw mocks.moduleLoadError;
  const actual = await importOriginal<typeof import('@/lib/asset-core/historical-media-remediation')>();
  return {
    ...actual,
    HistoricalMediaRemediationError: MockHistoricalMediaRemediationError,
    discoverHistoricalMediaArchiveCandidates: mocks.discover,
    archiveHistoricalMedia: mocks.archive,
  };
});

import {
  GET,
  POST,
} from '@/app/api/admin/assets/remediation/route';

const archiveRequest = {
  action: 'archive-unrecoverable' as const,
  idempotencyKey: 'archive-request-a',
  reason: 'Historical media bytes are unavailable',
  candidates: [{
    projectId: 'project-a',
    assetId: 'asset-a',
    assetVersionId: 'version-a',
    candidateDigest: 'a'.repeat(64),
  }],
};

const archiveResult = {
  remediationId: 'remediation-a',
  reused: false,
  archivedVersionCount: 1,
  archivedPlacementCount: 1,
  projectRevisions: {},
};

function adminAuth(source: 'cookie' | 'desktop-token' | 'internal' = 'internal') {
  return {
    user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    source,
  };
}

async function expectRequestId(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  expect(response.headers.get('x-request-id')).toMatch(/^req_[a-f0-9]{16}$/);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  return body;
}

function createArchiveRequest(
  body: string = JSON.stringify(archiveRequest),
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest('https://app.example/api/admin/assets/remediation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
}

describe('historical media remediation admin API', () => {
  beforeEach(() => {
    mocks.getRequestUser.mockReset();
    mocks.discover.mockReset();
    mocks.archive.mockReset();
    mocks.archive.mockResolvedValue(archiveResult);
    mocks.moduleLoadError = null;
    mocks.moduleLoads = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [null, 401, 'AUTHENTICATION_REQUIRED'],
    [{ user: { id: 'user-a', name: 'User', role: 'user' }, source: 'cookie' }, 403, 'ADMINISTRATOR_REQUIRED'],
  ])('rejects discovery before invoking the service', async (auth, status, code) => {
    mocks.getRequestUser.mockResolvedValue(auth);

    const response = await GET(new NextRequest('http://localhost/api/admin/assets/remediation'));

    expect(response.status).toBe(status);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({ code }));
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('sanitizes a GET remediation module-load failure after one import attempt', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());
    mocks.moduleLoadError = new Error('module init SELECT secret FROM production_table');

    const response = await GET(new NextRequest(
      'https://app.example/api/admin/assets/remediation',
      { headers: { 'x-request-id': 'req_module_get_01' } },
    ));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_module_get_01');
    expect(body).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REMEDIATION_FAILED',
      requestId: 'req_module_get_01',
    }));
    expect(JSON.stringify(body)).not.toMatch(/SELECT|production_table|module init/i);
    expect(mocks.moduleLoads).toBe(1);
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('sanitizes a POST remediation module-load failure after one import attempt', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());
    mocks.moduleLoadError = new Error('module init SELECT secret FROM production_table');

    const response = await POST(createArchiveRequest(undefined, {
      'x-request-id': 'req_module_post_01',
    }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_module_post_01');
    expect(body).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REMEDIATION_FAILED',
      requestId: 'req_module_post_01',
    }));
    expect(JSON.stringify(body)).not.toMatch(/SELECT|production_table|module init/i);
    expect(mocks.moduleLoads).toBe(1);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('returns bounded discovery to an administrator', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());
    mocks.discover.mockResolvedValue({
      candidates: [{ assetVersionId: 'version-a' }],
      counts: { versions: 1, activePlacements: 2 },
    });

    const response = await GET(new NextRequest(
      'http://localhost/api/admin/assets/remediation?limit=20',
    ));

    expect(response.status).toBe(200);
    expect(mocks.discover).toHaveBeenCalledWith({ limit: 20 });
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      success: true,
      counts: { versions: 1, activePlacements: 2 },
    }));
  });

  it.each(['0', '101', '1.5', 'not-a-number'])(
    'rejects an invalid discovery limit of %s',
    async (limit) => {
      mocks.getRequestUser.mockResolvedValue(adminAuth());

      const response = await GET(new NextRequest(
        `http://localhost/api/admin/assets/remediation?limit=${limit}`,
      ));

      expect(response.status).toBe(400);
      expect(await expectRequestId(response)).toEqual(expect.objectContaining({
        code: 'HISTORICAL_MEDIA_REQUEST_INVALID',
      }));
      expect(mocks.discover).not.toHaveBeenCalled();
    },
  );

  it.each([
    [null, 401, 'AUTHENTICATION_REQUIRED'],
    [{ user: { id: 'user-a', name: 'User', role: 'user' }, source: 'cookie' }, 403, 'ADMINISTRATOR_REQUIRED'],
  ])('rejects archive before reading the command or invoking the service', async (auth, status, code) => {
    mocks.getRequestUser.mockResolvedValue(auth);

    const response = await POST(createArchiveRequest('{not-json'));

    expect(response.status).toBe(status);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({ code }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('allows a cookie-authenticated archive from the configured same origin', async () => {
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://app.example');
    mocks.getRequestUser.mockResolvedValue(adminAuth('cookie'));

    const response = await POST(createArchiveRequest(undefined, {
      Origin: 'https://app.example',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledTimes(1);
    await expectRequestId(response);
  });

  it.each([
    ['missing', undefined],
    ['cross-origin', 'https://same-site-attacker.example'],
  ])('rejects a cookie-authenticated archive with %s Origin', async (_label, origin) => {
    vi.stubEnv('COZE_PROJECT_DOMAIN_DEFAULT', 'https://app.example');
    mocks.getRequestUser.mockResolvedValue(adminAuth('cookie'));
    const headers: Record<string, string> = {};
    if (origin) headers.Origin = origin;

    const response = await POST(createArchiveRequest(undefined, headers));

    expect(response.status).toBe(403);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'ADMINISTRATOR_ORIGIN_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each(['desktop-token', 'internal'] as const)(
    'allows an explicitly authenticated %s caller without a browser Origin',
    async (source) => {
      mocks.getRequestUser.mockResolvedValue(adminAuth(source));

      const response = await POST(createArchiveRequest());

      expect(response.status).toBe(200);
      expect(mocks.archive).toHaveBeenCalledTimes(1);
      await expectRequestId(response);
    },
  );

  it('rejects an authenticated mutation source outside the explicit policy', async () => {
    mocks.getRequestUser.mockResolvedValue({
      ...adminAuth(),
      source: 'unexpected-source',
    });

    const response = await POST(createArchiveRequest());

    expect(response.status).toBe(403);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'ADMINISTRATOR_AUTH_SOURCE_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects unsupported mutation content type %s',
    async (contentType) => {
      mocks.getRequestUser.mockResolvedValue(adminAuth());

      const response = await POST(createArchiveRequest(undefined, {
        'Content-Type': contentType,
      }));

      expect(response.status).toBe(415);
      expect(await expectRequestId(response)).toEqual(expect.objectContaining({
        code: 'HISTORICAL_MEDIA_CONTENT_TYPE_UNSUPPORTED',
      }));
      expect(mocks.archive).not.toHaveBeenCalled();
    },
  );

  it('accepts JSON with an explicit UTF-8 charset', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(undefined, {
      'Content-Type': 'application/json; charset=utf-8',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledTimes(1);
    await expectRequestId(response);
  });

  it('passes the authenticated actor, client address, and parser output to archive', async () => {
    vi.stubEnv('WUJIE_TRUSTED_PROXY_HOPS', '1');
    mocks.getRequestUser.mockResolvedValue(adminAuth());
    const rawBody = {
      ...archiveRequest,
      archiveAll: true,
      dryRun: false,
      replacementUrl: 'https://example.test/replacement.png',
      prompt: 'regenerate this image',
      billing: { credits: 1 },
      regeneration: true,
    };

    const response = await POST(createArchiveRequest(JSON.stringify(rawBody), {
      'Content-Length': '512',
      'x-forwarded-for': '198.51.100.200, 203.0.113.10',
      'x-real-ip': '198.51.100.20',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledWith({
      actorUserId: 'admin-a',
      actorUserName: 'Admin',
      ipAddress: '203.0.113.10',
      request: archiveRequest,
    });
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      success: true,
      remediationId: 'remediation-a',
    }));
  });

  it('falls back to x-real-ip for the archive audit address', async () => {
    vi.stubEnv('WUJIE_TRUSTED_PROXY_HOPS', '1');
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(undefined, {
      'x-real-ip': '2001:0db8:0:0:0:0:0:1',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({
      ipAddress: '2001:db8::1',
    }));
    await expectRequestId(response);
  });

  it('ignores forwarding headers when no trusted proxy hop count is configured', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(undefined, {
      'x-forwarded-for': '198.51.100.200, 203.0.113.10',
      'x-real-ip': '198.51.100.20',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: null }));
    await expectRequestId(response);
  });

  it.each([
    ['malformed', 'not-an-ip'],
    ['overlong', 'x'.repeat(4097)],
  ])('fails a %s forwarded address safely to a null audit IP', async (_label, forwardedFor) => {
    vi.stubEnv('WUJIE_TRUSTED_PROXY_HOPS', '1');
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(undefined, {
      'x-forwarded-for': forwardedFor,
      'x-real-ip': '198.51.100.20',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: null }));
    await expectRequestId(response);
  });

  it('rejects malformed JSON', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest('{not-json'));

    expect(response.status).toBe(400);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REQUEST_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('rejects a declared body larger than 65536 bytes', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(undefined, {
      'Content-Length': '65537',
    }));

    expect(response.status).toBe(400);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REQUEST_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('rejects an undeclared body larger than 65536 bytes', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(JSON.stringify({
      ...archiveRequest,
      padding: 'x'.repeat(65536),
    })));

    expect(response.status).toBe(400);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REQUEST_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('rejects an invalid candidate count through the canonical parser', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());

    const response = await POST(createArchiveRequest(JSON.stringify({
      ...archiveRequest,
      candidates: [],
    })));

    expect(response.status).toBe(400);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REQUEST_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each([
    ['HISTORICAL_MEDIA_NOT_FOUND', 404],
    ['HISTORICAL_MEDIA_CANDIDATE_STALE', 409],
    ['HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT', 409],
  ] as const)('maps %s to HTTP %i', async (code, status) => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());
    mocks.archive.mockRejectedValue(new MockHistoricalMediaRemediationError(code));

    const response = await POST(createArchiveRequest());

    expect(response.status).toBe(status);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({ code }));
  });

  it('returns a sanitized internal error with a request ID', async () => {
    mocks.getRequestUser.mockResolvedValue(adminAuth());
    mocks.archive.mockRejectedValue(new Error(
      'SELECT secret FROM production_table\n    at internal-stack.ts:42:7',
    ));

    const response = await POST(createArchiveRequest());
    const body = await expectRequestId(response);

    expect(response.status).toBe(500);
    expect(body).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REMEDIATION_FAILED',
    }));
    expect(JSON.stringify(body)).not.toMatch(/SELECT|production_table|internal-stack/i);
  });
});

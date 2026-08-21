import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  discover: vi.fn(),
  archive: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock('@/lib/asset-core/historical-media-remediation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asset-core/historical-media-remediation')>();
  return {
    ...actual,
    discoverHistoricalMediaArchiveCandidates: mocks.discover,
    archiveHistoricalMedia: mocks.archive,
  };
});

import {
  HistoricalMediaRemediationError,
} from '@/lib/asset-core/historical-media-remediation';
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
  return new NextRequest('http://localhost/api/admin/assets/remediation', {
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
  });

  it.each([
    [null, 401, 'AUTHENTICATION_REQUIRED'],
    [{ user: { id: 'user-a', name: 'User', role: 'user' } }, 403, 'ADMINISTRATOR_REQUIRED'],
  ])('rejects discovery before invoking the service', async (auth, status, code) => {
    mocks.getRequestUser.mockResolvedValue(auth);

    const response = await GET(new NextRequest('http://localhost/api/admin/assets/remediation'));

    expect(response.status).toBe(status);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({ code }));
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('returns bounded discovery to an administrator', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });
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
      mocks.getRequestUser.mockResolvedValue({
        user: { id: 'admin-a', name: 'Admin', role: 'admin' },
      });

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
    [{ user: { id: 'user-a', name: 'User', role: 'user' } }, 403, 'ADMINISTRATOR_REQUIRED'],
  ])('rejects archive before reading the command or invoking the service', async (auth, status, code) => {
    mocks.getRequestUser.mockResolvedValue(auth);

    const response = await POST(createArchiveRequest('{not-json'));

    expect(response.status).toBe(status);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({ code }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor, client address, and parser output to archive', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });
    mocks.archive.mockResolvedValue({
      remediationId: 'remediation-a',
      reused: false,
      archivedVersionCount: 1,
      archivedPlacementCount: 1,
      projectRevisions: {},
    });
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
      'x-forwarded-for': '203.0.113.10, 10.0.0.5',
      'x-real-ip': '198.51.100.20',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledWith({
      actorUserId: 'admin-a',
      actorUserName: 'Admin',
      ipAddress: '203.0.113.10, 10.0.0.5',
      request: archiveRequest,
    });
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      success: true,
      remediationId: 'remediation-a',
    }));
  });

  it('falls back to x-real-ip for the archive audit address', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });
    mocks.archive.mockResolvedValue({
      remediationId: 'remediation-a',
      reused: false,
      archivedVersionCount: 1,
      archivedPlacementCount: 1,
      projectRevisions: {},
    });

    const response = await POST(createArchiveRequest(undefined, {
      'x-real-ip': '198.51.100.20',
    }));

    expect(response.status).toBe(200);
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({
      ipAddress: '198.51.100.20',
    }));
    await expectRequestId(response);
  });

  it('rejects malformed JSON', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });

    const response = await POST(createArchiveRequest('{not-json'));

    expect(response.status).toBe(400);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({
      code: 'HISTORICAL_MEDIA_REQUEST_INVALID',
    }));
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('rejects a declared body larger than 65536 bytes', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });

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
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });

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
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });

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
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });
    mocks.archive.mockRejectedValue(new HistoricalMediaRemediationError(code));

    const response = await POST(createArchiveRequest());

    expect(response.status).toBe(status);
    expect(await expectRequestId(response)).toEqual(expect.objectContaining({ code }));
  });

  it('returns a sanitized internal error with a request ID', async () => {
    mocks.getRequestUser.mockResolvedValue({
      user: { id: 'admin-a', name: 'Admin', role: 'admin' },
    });
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

import { createHash } from 'node:crypto';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { validReport } from '@/__tests__/helpers/platform-compliance-fixtures';
import { canonicalComplianceReportJson } from '@/lib/platform-compliance/report-schema';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getCloudTaskForUser: vi.fn(),
  listAgentRunEvents: vi.fn(),
  read: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/cloud-task-storage', () => ({ getCloudTaskForUser: mocks.getCloudTaskForUser }));
vi.mock('@/lib/agent-runtime/service', () => ({ listAgentRunEvents: mocks.listAgentRunEvents }));
vi.mock('@/lib/asset-core/storage', () => ({
  createPostgresAssetStorage: () => ({ read: mocks.read }),
}));
vi.mock('@/lib/skill-runtime/document-assets', () => ({
  skillRunAssetReadStorage: () => ({read:mocks.read}),
}));

import { GET } from '@/app/api/skill-reports/[runId]/[stepId]/route';

const runId = 'run-1';
const stepId = 'audit:asset-version-1';
const projectId = 'project-1';
const versionId = 'report-version-1';

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/skill-reports/${runId}/${stepId}${query}`);
}

function context(run = runId, step = stepId) {
  return { params: Promise.resolve({ runId: run, stepId: step }) };
}

function reportFixture(title = '支持的图片格式') {
  const report = validReport({
    runId,
    checks: [{ ...validReport().checks[0], title }],
  });
  const content = canonicalComplianceReportJson(report);
  const checksum = createHash('sha256').update(content).digest('hex');
  return { report, content, checksum };
}

function arrangeOwnedReport(title?: string) {
  const fixture = reportFixture(title);
  mocks.getSessionUser.mockResolvedValue({ id: 'user-1', role: 'user' });
  mocks.getCloudTaskForUser.mockResolvedValue({
    id: runId, userId: 'user-1', projectId, type: 'agent-run', status: 'completed',
  });
  mocks.listAgentRunEvents.mockResolvedValue([
    {
      eventId: 'created', runId, sequence: 1, type: 'run.created', timestamp: '',
      payload: {
        sourceVersionIds: ['asset-version-1'],
        skillSnapshot: { id: 'preset-platform-compliance-audit', version: 1 },
      },
    },
    {
      eventId: 'asset', runId, sequence: 2, type: 'asset.created', timestamp: '',
      payload: { stepId, assetVersionId: versionId },
    },
  ]);
  const findVersion = vi.fn<() => Promise<Record<string, unknown> | null>>(async () => ({
    id: versionId, assetId: 'report-asset-1', ownerId: 'user-1', projectId,
    file: {
      url: `/api/skill-reports/${runId}/${encodeURIComponent(stepId)}?projectId=${projectId}&checksum=${fixture.checksum}`,
      availability: 'ready', mimeType: 'application/json',
      byteSize: Buffer.byteLength(fixture.content), checksum: fixture.checksum,
    },
    parentVersionIds: [],
    metadata: {
      schemaId: 'platform-compliance-report-v1', reportContent: fixture.content,
      sourceVersionIds: ['asset-version-1'],
      sourceTrace: {
        source: 'canvas-skill', runId,
        skillId: 'preset-platform-compliance-audit', skillVersion: 1,
        sourceVersionIds: ['asset-version-1'],
        createdAt: '2026-09-07T00:00:00.000Z',
      },
    },
    createdAt: '2026-09-07T00:00:01.000Z',
  }));
  const findAsset = vi.fn<() => Promise<Record<string, unknown> | null>>(async () => ({
    id: 'report-asset-1', ownerId: 'user-1', projectId, kind: 'document', status: 'active',
    currentVersionId: versionId, createdAt: '', updatedAt: '',
  }));
  const transaction = {
    findProject: vi.fn(async () => true),
    findVersion,
    findAsset,
  };
  mocks.read.mockImplementation(async callback => callback(transaction));
  return { ...fixture, transaction };
}

describe('skill compliance report downloads', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(mock => mock.mockReset());
  });

  it('requires authentication before reading the run or asset graph', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await GET(request(`?projectId=${projectId}&checksum=${'a'.repeat(64)}`), context());
    expect(response.status).toBe(401);
    expect(mocks.getCloudTaskForUser).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('returns the same non-enumerable 404 across foreign users, projects, runs, and steps', async () => {
    const { checksum } = arrangeOwnedReport();
    mocks.getCloudTaskForUser.mockResolvedValueOnce(null);
    const foreignUser = await GET(request(`?projectId=${projectId}&checksum=${checksum}`), context());

    arrangeOwnedReport();
    const foreignProject = await GET(request(`?projectId=project-2&checksum=${checksum}`), context());

    arrangeOwnedReport();
    mocks.listAgentRunEvents.mockResolvedValue([]);
    const foreignStep = await GET(request(`?projectId=${projectId}&checksum=${checksum}`), context());

    expect([foreignUser.status, foreignProject.status, foreignStep.status]).toEqual([404, 404, 404]);
    await expect(foreignUser.json()).resolves.toEqual({ error: 'REPORT_NOT_FOUND' });
    await expect(foreignProject.json()).resolves.toEqual({ error: 'REPORT_NOT_FOUND' });
    await expect(foreignStep.json()).resolves.toEqual({ error: 'REPORT_NOT_FOUND' });
  });

  it('returns canonical JSON only after run, event, document, checksum, schema, and lineage agree', async () => {
    const { content, checksum } = arrangeOwnedReport();
    const response = await GET(
      request(`?projectId=${projectId}&checksum=${checksum}&format=json`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(content);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/u);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.getCloudTaskForUser).toHaveBeenCalledWith(runId, 'user-1');
    expect(mocks.listAgentRunEvents).toHaveBeenCalledWith({ actorUserId: 'user-1', runId });
  });

  it('normalizes the encoded production route segment before matching the report step', async () => {
    const { content, checksum, transaction } = arrangeOwnedReport();
    const reportVersion = await transaction.findVersion();
    transaction.findVersion.mockImplementation(async (...args: unknown[]) => (
      args[2] === versionId
        ? { ...reportVersion, parentVersionIds: ['asset-version-1'] }
        : reportVersion
    ));
    const response = await GET(
      request(`?projectId=${projectId}&checksum=${checksum}&format=json`),
      context(runId, encodeURIComponent(stepId)),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(content);
  });

  it('renders deterministic sanitized HTML from canonical JSON with download protections', async () => {
    const malicious = '</h1><script>alert(1)</script><img src=x onerror=alert(2)>';
    const { checksum } = arrangeOwnedReport(malicious);
    const first = await GET(
      request(`?projectId=${projectId}&checksum=${checksum}&format=html`), context(),
    );
    const firstHtml = await first.text();

    const second = await GET(
      request(`?projectId=${projectId}&checksum=${checksum}&format=html`), context(),
    );
    const secondHtml = await second.text();

    expect(first.status).toBe(200);
    expect(firstHtml).toBe(secondHtml);
    expect(firstHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(firstHtml).not.toMatch(/<script|<img|<iframe|javascript:/iu);
    expect(first.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(first.headers.get('content-disposition')).toMatch(/^attachment;/u);
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.headers.get('cache-control')).toBe('private, no-store');
  });

  it('returns 404 when the metadata source version is no longer owned in the run project', async () => {
    const { checksum, transaction } = arrangeOwnedReport();
    const reportVersion = await transaction.findVersion();
    transaction.findVersion.mockImplementation(async (...args: unknown[]) => (
      args[2] === versionId ? reportVersion : null
    ));

    const response = await GET(
      request(`?projectId=${projectId}&checksum=${checksum}`), context(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'REPORT_NOT_FOUND' });
    expect(transaction.findVersion).toHaveBeenCalledWith('user-1', projectId, 'asset-version-1');
  });

  const mismatchCases: Array<[
    string,
    (version: Record<string, unknown>) => Record<string, unknown>,
    string | undefined,
    string | undefined,
  ]> = [
    ['query checksum', version => version, 'f'.repeat(64), undefined],
    ['stored checksum', version => ({
      ...version, file: { ...(version.file as object), checksum: 'e'.repeat(64) },
    }), undefined, undefined],
    ['document kind', version => version, undefined, 'image'],
    ['parent lineage', version => ({ ...version, parentVersionIds: ['foreign-version'] }), undefined, undefined],
    ['schema', version => ({
      ...version,
      metadata: { ...(version.metadata as object), schemaId: 'unknown-schema' },
    }), undefined, undefined],
    ['source lineage', version => ({
      ...version,
      metadata: { ...(version.metadata as object), sourceVersionIds: ['foreign-version'] },
    }), undefined, undefined],
  ];

  it.each(mismatchCases)('returns 404 for a mismatched %s', async (_name, mutate, queryChecksum, assetKind) => {
    const { checksum, transaction } = arrangeOwnedReport();
    const original = await transaction.findVersion();
    transaction.findVersion.mockResolvedValue(mutate(original as Record<string, unknown>));
    if (assetKind) transaction.findAsset.mockResolvedValue({ ...(await transaction.findAsset()), kind: assetKind });

    const response = await GET(request(
      `?projectId=${projectId}&checksum=${queryChecksum || checksum}`,
    ), context());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'REPORT_NOT_FOUND' });
  });
});

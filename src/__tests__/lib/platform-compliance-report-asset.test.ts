import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { validReport } from '@/__tests__/helpers/platform-compliance-fixtures';
import {
  AssetServiceError,
  type CreateAssetVersionInput,
} from '@/lib/asset-core/service';
import { parseWorkspaceSourceTrace } from '@/lib/asset-core/source-trace';
import type { Asset, AssetVersion } from '@/lib/asset-core/types';
import {
  persistComplianceReportAsset,
  reportDownloadUrl,
} from '@/lib/platform-compliance/report-asset';
import {
  canonicalComplianceReportJson,
  parsePlatformComplianceReport,
} from '@/lib/platform-compliance/report-schema';

function reportInput() {
  const report = parsePlatformComplianceReport(validReport());
  const sourceTrace = parseWorkspaceSourceTrace({
    source: 'canvas-skill',
    runId: 'run-1',
    skillId: 'preset-platform-compliance-audit',
    skillVersion: 1,
    sourceVersionIds: ['asset-version-1'],
    modelBindings: {
      vision: { providerId: 'vision-provider', modelId: 'vision-model' },
    },
    createdAt: '2026-09-07T00:00:00.000Z',
  });
  if (!sourceTrace) throw new Error('fixture source trace is invalid');
  return {
    actorUserId: 'user-1',
    projectId: 'project-1',
    runId: 'run-1',
    stepId: 'audit:asset-version-1',
    report,
    sourceVersionIds: ['asset-version-1'],
    sourceTrace,
    idempotencyKey: 'operation-1:report-asset',
    requestDigest: 'request-digest-1',
  } as const;
}

function reportAsset(input: ReturnType<typeof reportInput>): Asset {
  return {
    id: 'report-asset-1', ownerId: input.actorUserId, projectId: input.projectId,
    kind: 'document', status: 'active', currentVersionId: 'report-version-1',
    createdAt: '2026-09-07T00:00:01.000Z', updatedAt: '2026-09-07T00:00:01.000Z',
  };
}

describe('platform compliance report assets', () => {
  it('persists the completed compliance step and publishes its document version through Skill events', () => {
    const source = readFileSync(resolve(
      process.cwd(), 'src/lib/skill-runtime/step-registry.ts',
    ), 'utf8');

    expect(source).toContain("from '@/lib/platform-compliance/report-asset'");
    expect(source).toMatch(/const reportVersion = await persistComplianceReportAsset\(\{[\s\S]*actorUserId: step\.actorUserId,[\s\S]*projectId: step\.projectId,[\s\S]*runId: step\.runId,[\s\S]*stepId: step\.step\.id,[\s\S]*sourceVersionIds: \[sourceVersionId\],[\s\S]*requestDigest: step\.requestDigest,/u);
    expect(source).toContain('assetVersionIds: [reportVersion.id]');
    expect(source).toContain('const authoritativeReport = complianceReportFromAssetVersion(reportVersion)');
    expect(source).toContain("structured: { schemaId: 'platform-compliance-report-v1', value: authoritativeReport }");
  });

  it('creates an independent document version with canonical content and metadata-only lineage', async () => {
    const input = reportInput();
    const createAssetVersion = vi.fn(async (value: CreateAssetVersionInput) => ({
      asset: reportAsset(input),
      version: {
        id: 'report-version-1', assetId: 'report-asset-1', ownerId: input.actorUserId,
        projectId: input.projectId, file: value.file, parentVersionIds: [],
        idempotencyKey: input.idempotencyKey, createdAt: '2026-09-07T00:00:01.000Z',
      } as AssetVersion,
      reused: false,
    }));
    const resolveAssetReference = vi.fn(async () => ({
      assetId: 'source-asset-1', assetVersionId: 'asset-version-1', url: '/source.png',
    }));

    const version = await persistComplianceReportAsset({
      ...input,
      assetService: { createAssetVersion, resolveAssetReference },
    });

    const content = canonicalComplianceReportJson(input.report);
    const checksum = createHash('sha256').update(content).digest('hex');
    expect(resolveAssetReference).toHaveBeenCalledWith({
      actorUserId: 'user-1', projectId: 'project-1', assetVersionId: 'asset-version-1',
    });
    expect(createAssetVersion).toHaveBeenCalledWith({
      actorUserId: 'user-1', projectId: 'project-1', kind: 'document',
      parentVersionIds: [], idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      file: {
        url: reportDownloadUrl('run-1', 'audit:asset-version-1', checksum, 'project-1'),
        availability: 'ready', mimeType: 'application/json',
        byteSize: Buffer.byteLength(content), checksum,
      },
      metadata: {
        schemaId: 'platform-compliance-report-v1', reportContent: content,
        sourceVersionIds: ['asset-version-1'], sourceTrace: input.sourceTrace,
      },
    });
    expect(version).toMatchObject({
      id: 'report-version-1', parentVersionIds: [],
      metadata: {
        schemaId: 'platform-compliance-report-v1',
        sourceVersionIds: ['asset-version-1'],
        sourceTrace: input.sourceTrace,
      },
    });
  });

  it('passes stable idempotency identity through and preserves service reuse and conflicts', async () => {
    const input = reportInput();
    const versions = new Map<string, { digest: string; version: AssetVersion }>();
    const createAssetVersion = vi.fn(async (value: CreateAssetVersionInput) => {
      const key = String(value.idempotencyKey);
      const digest = String(value.requestDigest);
      const existing = versions.get(key);
      if (existing) {
        if (existing.digest !== digest) throw new AssetServiceError('ASSET_IDEMPOTENCY_CONFLICT');
        return { asset: reportAsset(input), version: existing.version, reused: true };
      }
      const version = {
        id: 'report-version-1', assetId: 'report-asset-1', ownerId: input.actorUserId,
        projectId: input.projectId, file: value.file, parentVersionIds: [],
        idempotencyKey: key, metadata: value.metadata,
        createdAt: '2026-09-07T00:00:01.000Z',
      } as AssetVersion;
      versions.set(key, { digest, version });
      return { asset: reportAsset(input), version, reused: false };
    });
    const assetService = {
      createAssetVersion,
      resolveAssetReference: vi.fn(async () => ({ url: '/source.png' })),
    };

    const first = await persistComplianceReportAsset({ ...input, assetService });
    const retry = await persistComplianceReportAsset({ ...input, assetService });
    await expect(persistComplianceReportAsset({
      ...input, requestDigest: 'different-request-digest', assetService,
    })).rejects.toMatchObject({ code: 'ASSET_IDEMPOTENCY_CONFLICT' });

    expect(retry.id).toBe(first.id);
    expect(createAssetVersion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest,
    }));
    expect(createAssetVersion).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest,
    }));
  });

  it('rejects unowned, mismatched, duplicate, or trace-inconsistent sources before creating an asset', async () => {
    const input = reportInput();
    const createAssetVersion = vi.fn();
    const denied = {
      createAssetVersion,
      resolveAssetReference: vi.fn(async () => { throw new AssetServiceError('ASSET_NOT_FOUND'); }),
    };
    await expect(persistComplianceReportAsset({ ...input, assetService: denied }))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(createAssetVersion).not.toHaveBeenCalled();

    const allowed = {
      createAssetVersion,
      resolveAssetReference: vi.fn(async () => ({ url: '/source.png' })),
    };
    await expect(persistComplianceReportAsset({
      ...input, sourceVersionIds: ['asset-version-1', 'asset-version-1'], assetService: allowed,
    })).rejects.toThrow(/source/iu);
    await expect(persistComplianceReportAsset({
      ...input, runId: 'another-run', assetService: allowed,
    })).rejects.toThrow(/run/iu);
    expect(createAssetVersion).not.toHaveBeenCalled();
  });
});

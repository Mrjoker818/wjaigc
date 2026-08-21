import { describe, expect, it } from 'vitest';

import {
  buildHistoricalMediaArchiveRequestDigest,
  buildHistoricalMediaCandidateDigest,
  classifyHistoricalMediaUrl,
  parseHistoricalMediaArchiveRequest,
} from '@/lib/asset-core/historical-media-remediation';

const candidate = {
  ownerId: 'owner-a',
  projectId: 'project-a',
  assetId: 'asset-a',
  assetVersionId: 'version-a',
  availability: 'missing' as const,
  urlClass: 'ephemeral-proxy' as const,
  placements: [
    { id: 'placement-b', workspace: 'chat' as const, workspaceId: 'chat-a', entityType: 'chat-result' as const, entityId: 'entity-b' },
    { id: 'placement-a', workspace: 'canvas' as const, workspaceId: 'project-a', entityType: 'canvas-image' as const, entityId: 'entity-a' },
  ],
  candidateDigest: '',
};

const request = {
  action: 'archive-unrecoverable' as const,
  idempotencyKey: 'archive-request-a',
  reason: 'Historical media bytes are unavailable',
  candidates: [
    { projectId: 'project-b', assetId: 'asset-b', assetVersionId: 'version-b', candidateDigest: 'b'.repeat(64) },
    { projectId: 'project-a', assetId: 'asset-a', assetVersionId: 'version-a', candidateDigest: 'a'.repeat(64) },
  ],
};

describe('historical media remediation domain', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['/v1/images/proxy/img_dead', 'ephemeral-proxy'],
    ['/api/serve-upload/uploads/a.png', 'durable-or-external'],
    ['https://cdn.example.test/a.png', 'durable-or-external'],
    ['https://cdn.example.test/v1/images/proxy/photo.png', 'durable-or-external'],
  ] as const)('classifies %j as %s', (url, expected) => {
    expect(classifyHistoricalMediaUrl(url)).toBe(expected);
  });

  it('creates the same digest for differently ordered placements', () => {
    expect(buildHistoricalMediaCandidateDigest(candidate)).toBe(
      buildHistoricalMediaCandidateDigest({ ...candidate, placements: [...candidate.placements].reverse() }),
    );
  });

  it('excludes candidateDigest from the candidate digest', () => {
    expect(buildHistoricalMediaCandidateDigest(candidate)).toBe(
      buildHistoricalMediaCandidateDigest({ ...candidate, candidateDigest: 'different-output' }),
    );
  });

  it('rejects candidate and placement strings outside the 1-256 bounds', () => {
    const candidateFields = [
      'ownerId', 'projectId', 'assetId', 'assetVersionId', 'availability', 'urlClass',
    ] as const;
    for (const field of candidateFields) {
      expect(() => buildHistoricalMediaCandidateDigest({ ...candidate, [field]: 'x' } as typeof candidate)).not.toThrow();
      expect(() => buildHistoricalMediaCandidateDigest({ ...candidate, [field]: 'x'.repeat(256) } as typeof candidate)).not.toThrow();
      expect(() => buildHistoricalMediaCandidateDigest({ ...candidate, [field]: '' } as typeof candidate)).toThrow(
        'HISTORICAL_MEDIA_REQUEST_INVALID',
      );
      expect(() => buildHistoricalMediaCandidateDigest({ ...candidate, [field]: 'x'.repeat(257) } as typeof candidate)).toThrow(
        'HISTORICAL_MEDIA_REQUEST_INVALID',
      );
    }

    const placementFields = ['id', 'workspace', 'workspaceId', 'entityType', 'entityId'] as const;
    for (const field of placementFields) {
      expect(() => buildHistoricalMediaCandidateDigest({
        ...candidate,
        placements: [{ ...candidate.placements[0], [field]: 'x' }],
      } as typeof candidate)).not.toThrow();
      expect(() => buildHistoricalMediaCandidateDigest({
        ...candidate,
        placements: [{ ...candidate.placements[0], [field]: 'x'.repeat(256) }],
      } as typeof candidate)).not.toThrow();
      expect(() => buildHistoricalMediaCandidateDigest({
        ...candidate,
        placements: [{ ...candidate.placements[0], [field]: '' }],
      } as typeof candidate)).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
      expect(() => buildHistoricalMediaCandidateDigest({
        ...candidate,
        placements: [{ ...candidate.placements[0], [field]: 'x'.repeat(257) }],
      } as typeof candidate)).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
    }
  });

  it('rejects candidate structures beyond the canonical JSON work budget', () => {
    expect(() => buildHistoricalMediaCandidateDigest({
      ...candidate,
      placements: Array.from({ length: 1025 }, (_, index) => ({
        ...candidate.placements[0],
        id: `placement-${index}`,
      })),
    } as typeof candidate)).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
  });

  it('preserves the 64 KiB canonical JSON guard', () => {
    expect(() => buildHistoricalMediaCandidateDigest({
      ...candidate,
      placements: Array.from({ length: 300 }, (_, index) => ({
        ...candidate.placements[0],
        id: `placement-${index}`,
        entityId: 'x'.repeat(256),
      })),
    } as typeof candidate)).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
  });

  it('rejects empty, duplicate and over-limit selections', () => {
    expect(() => parseHistoricalMediaArchiveRequest({
      action: 'archive-unrecoverable', idempotencyKey: 'key-a', reason: 'reviewed', candidates: [],
    })).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
    expect(() => parseHistoricalMediaArchiveRequest({
      ...request,
      candidates: [request.candidates[0], request.candidates[0]],
    })).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
    expect(() => parseHistoricalMediaArchiveRequest({
      ...request,
      candidates: Array.from({ length: 21 }, (_, index) => ({
        projectId: `project-${index}`,
        assetId: `asset-${index}`,
        assetVersionId: `version-${index}`,
        candidateDigest: index.toString(16).padStart(64, '0'),
      })),
    })).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
  });

  it('normalizes selection order before calculating the request digest', () => {
    expect(buildHistoricalMediaArchiveRequestDigest(request)).toBe(
      buildHistoricalMediaArchiveRequestDigest({ ...request, candidates: [...request.candidates].reverse() }),
    );
  });

  it('returns a trimmed archive request', () => {
    expect(parseHistoricalMediaArchiveRequest({
      action: '  archive-unrecoverable  ',
      idempotencyKey: '  archive-request-a  ',
      reason: '  Historical media bytes are unavailable  ',
      candidates: [{
        projectId: '  project-a  ',
        assetId: '  asset-a  ',
        assetVersionId: '  version-a  ',
        candidateDigest: `  ${'a'.repeat(64)}  `,
      }],
    })).toEqual({
      action: 'archive-unrecoverable',
      idempotencyKey: 'archive-request-a',
      reason: 'Historical media bytes are unavailable',
      candidates: [{
        projectId: 'project-a',
        assetId: 'asset-a',
        assetVersionId: 'version-a',
        candidateDigest: 'a'.repeat(64),
      }],
    });
  });

  it.each([
    ['idempotencyKey', 7, 8, 128, 129],
    ['reason', 7, 8, 512, 513],
  ] as const)('enforces %s lower and upper bounds', (field, below, lower, upper, above) => {
    const buildRequest = (value: string) => parseHistoricalMediaArchiveRequest({
      ...request,
      [field]: value,
    });
    expect(() => buildRequest('x'.repeat(below))).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
    expect(() => buildRequest('x'.repeat(lower))).not.toThrow();
    expect(() => buildRequest('x'.repeat(upper))).not.toThrow();
    expect(() => buildRequest('x'.repeat(above))).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
  });

  it('enforces archive-selection string bounds', () => {
    const selectionFields = ['projectId', 'assetId', 'assetVersionId', 'candidateDigest'] as const;
    for (const field of selectionFields) {
      expect(() => parseHistoricalMediaArchiveRequest({
        ...request,
        candidates: [{ ...request.candidates[0], [field]: 'x' }],
      })).not.toThrow();
      expect(() => parseHistoricalMediaArchiveRequest({
        ...request,
        candidates: [{ ...request.candidates[0], [field]: 'x'.repeat(256) }],
      })).not.toThrow();
      expect(() => parseHistoricalMediaArchiveRequest({
        ...request,
        candidates: [{ ...request.candidates[0], [field]: '' }],
      })).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
      expect(() => parseHistoricalMediaArchiveRequest({
        ...request,
        candidates: [{ ...request.candidates[0], [field]: 'x'.repeat(257) }],
      })).toThrow('HISTORICAL_MEDIA_REQUEST_INVALID');
    }
  });
});

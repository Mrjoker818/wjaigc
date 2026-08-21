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
  ] as const)('classifies %j as %s', (url, expected) => {
    expect(classifyHistoricalMediaUrl(url)).toBe(expected);
  });

  it('creates the same digest for differently ordered placements', () => {
    expect(buildHistoricalMediaCandidateDigest(candidate)).toBe(
      buildHistoricalMediaCandidateDigest({ ...candidate, placements: [...candidate.placements].reverse() }),
    );
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
});

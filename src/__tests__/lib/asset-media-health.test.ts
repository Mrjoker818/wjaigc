import { describe, expect, it } from 'vitest';

import {
  createConfirmationDigest,
  DEFAULT_TRASH_RETENTION_DAYS,
  evaluatePurgeEligibility,
  evaluateOrphanCandidate,
} from '@/lib/asset-core/media-health';

function digestFacts() {
  return {
    assetId: 'asset-a',
    assetStatus: 'trashed' as const,
    assetUpdatedAt: '2026-08-01T00:00:00.000Z',
    retention: {
      days: 30,
      trashedAt: '2026-07-01T00:00:00.000Z',
      notBefore: '2026-07-31T00:00:00.000Z',
    },
    versions: [
      { id: 'version-a', storageKey: 'images/a.png', fileUrl: '/api/serve-upload/a.png', availability: 'missing', byteSize: '64' },
      { id: 'version-b', storageKey: 'images/b.png', fileUrl: '/api/serve-upload/b.png', availability: 'ready', byteSize: '64' },
    ],
    placements: [
      { id: 'placement-a', status: 'trashed' as const, deletedAt: '2026-07-01T00:00:00.000Z' },
      { id: 'placement-b', status: 'trashed' as const, deletedAt: '2026-06-30T00:00:00.000Z' },
    ],
    migrationCheckpoints: [
      { id: 'checkpoint-a', legacyProjectId: 'project-a', status: 'completed', updatedAt: '2026-07-01T00:00:00.000Z' },
    ],
    legacyReferences: [
      { userId: 'user-b', dataKey: 'workflow', versionId: 'version-a', fileUrl: '/api/serve-upload/a.png' },
    ],
    sharedPhysicalReferences: [
      { versionId: 'version-b', peerAssetId: 'asset-z', peerVersionId: 'version-z', storageKey: 'images/b.png', fileUrl: '/api/serve-upload/b.png' },
    ],
    unknownLegacyOwnership: false,
  };
}

describe('asset media health policy', () => {
  it('uses an exact 30 day retention period', () => {
    expect(DEFAULT_TRASH_RETENTION_DAYS).toBe(30);
  });

  it('builds an order-independent digest from ordered lifecycle identities and exact facts', () => {
    const facts = digestFacts();
    const reordered = {
      ...facts,
      versions: [...facts.versions].reverse(),
      placements: [...facts.placements].reverse(),
    };

    expect(createConfirmationDigest(reordered)).toBe(createConfirmationDigest(facts));
  });

  it('invalidates equal-count and equal-byte replacements plus availability and placement changes', () => {
    const facts = digestFacts();
    const original = createConfirmationDigest(facts);

    expect(createConfirmationDigest({
      ...facts,
      versions: facts.versions.map((version, index) => index === 0 ? { ...version, id: 'version-replacement' } : version),
    })).not.toBe(original);
    expect(createConfirmationDigest({
      ...facts,
      versions: facts.versions.map((version, index) => index === 0 ? { ...version, availability: 'ready' } : version),
    })).not.toBe(original);
    expect(createConfirmationDigest({
      ...facts,
      placements: facts.placements.map((placement, index) => index === 0
        ? { ...placement, status: 'active' as const, deletedAt: null }
        : placement),
    })).not.toBe(original);
  });

  it('only permits managed, fully unreferenced and migration-confirmed media as orphan candidates', () => {
    expect(evaluateOrphanCandidate({
      managed: true,
      activePlacements: 0,
      legacyReferences: 0,
      migrationConfirmed: true,
      byteSize: 128,
    })).toEqual({ candidate: true, protectionReasons: [], estimatedBytes: 128 });

    expect(evaluateOrphanCandidate({
      managed: false,
      activePlacements: 0,
      legacyReferences: 1,
      migrationConfirmed: false,
    })).toEqual({
      candidate: false,
      protectionReasons: ['UNMANAGED_MEDIA', 'LEGACY_REFERENCE', 'MIGRATION_UNCONFIRMED'],
      estimatedBytes: 0,
    });
  });

  it('rejects purge before every terminal protection has elapsed or been confirmed', () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    expect(evaluatePurgeEligibility({
      assetStatus: 'trashed',
      trashedAt: '2026-07-20T00:00:00.000Z',
      activePlacements: 0,
      versionCount: 1,
      legacyReferences: 0,
      migrationConfirmed: true,
      candidateId: 'candidate-a',
      expectedCandidateId: 'candidate-a',
      confirmationDigest: 'digest-a',
      expectedConfirmationDigest: 'digest-a',
    }, now)).toEqual({ eligible: false, reasons: ['RETENTION_NOT_ELAPSED'] });

    expect(evaluatePurgeEligibility({
      assetStatus: 'trashed',
      trashedAt: '2026-06-01T00:00:00.000Z',
      activePlacements: 1,
      versionCount: 1,
      legacyReferences: 1,
      migrationConfirmed: false,
      candidateId: 'candidate-a',
      expectedCandidateId: 'candidate-b',
      confirmationDigest: 'digest-a',
      expectedConfirmationDigest: 'digest-b',
    }, now)).toEqual({
      eligible: false,
      reasons: [
        'ACTIVE_PLACEMENT',
        'LEGACY_REFERENCE',
        'MIGRATION_UNCONFIRMED',
        'CANDIDATE_ID_MISMATCH',
        'CONFIRMATION_DIGEST_MISMATCH',
      ],
    });
  });
});

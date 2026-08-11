import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRASH_RETENTION_DAYS,
  evaluatePurgeEligibility,
  evaluateOrphanCandidate,
} from '@/lib/asset-core/media-health';

describe('asset media health policy', () => {
  it('uses an exact 30 day retention period', () => {
    expect(DEFAULT_TRASH_RETENTION_DAYS).toBe(30);
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

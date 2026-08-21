import type { PoolClient } from 'pg';

import { getPool } from '@/lib/db-client';
import { resolveAssetGraphMode } from '@/lib/asset-core/mode';
import type { AssetGraphMode } from '@/lib/asset-core/types';
import {
  collectAssetGraphDoctorFacts,
  summarizeAssetGraphDoctor,
} from '../../../scripts/doctor-asset-status.mjs';

export interface AssetGraphReleaseReadiness {
  mode: AssetGraphMode;
  status: 'pass' | 'warn' | 'fail';
  releaseReady: boolean;
  switchAuthorized: boolean;
  blockingCurrentRelease: boolean;
  blockers: string[];
  migrations: {
    required: number;
    verified: number;
    missing: string[];
    checksumMismatches: string[];
  };
  shadowComparison: {
    legacyProjects: number;
    graphProjects: number;
    matchingProjects: number;
    mismatchedProjects: number;
    unmigratedProjects: number;
    orphanGraphProjects: number;
    nonV3GraphProjects: number;
    failedCheckpoints: number;
    missingCheckpoints: number;
    invalidLegacyRecords: number;
  };
  media: {
    ready: number;
    pendingPersist: number;
    missing: number;
    recovering: number;
    unrecoverable: number;
    activeAssetsMissingCurrentVersion: number;
    placementPendingPersist: number;
    placementMissing: number;
    placementRecovering: number;
    placementUnrecoverable: number;
  };
  assets: { active: number; trashed: number };
  gc: {
    pending: number;
    deferred: number;
    purged: number;
    due: number;
    physicalDeferred: number;
    physicalFailed: number;
    unregistered: number;
  };
  queryErrorCount: number;
  collectionUnavailable: boolean;
}

interface DoctorMigrationEntry {
  version: string;
  expectedChecksum: string;
  recordedChecksum: string | null;
}

type ReadinessSummary = Omit<
  AssetGraphReleaseReadiness,
  | 'status'
  | 'switchAuthorized'
  | 'blockingCurrentRelease'
  | 'blockers'
  | 'queryErrorCount'
  | 'collectionUnavailable'
>;

export type DoctorSummary = Omit<ReadinessSummary, 'migrations'> & {
  migrations: ReadinessSummary['migrations'] & { entries: DoctorMigrationEntry[] };
  assetV3Blockers: string[];
  queryErrors: string[];
};

export function projectAssetGraphReleaseReadiness(
  summary: DoctorSummary,
): AssetGraphReleaseReadiness {
  const mode = resolveAssetGraphMode(summary.mode);
  const releaseReady = summary.releaseReady === true;
  const collectionUnavailable = summary.assetV3Blockers.includes('asset-facts-unavailable');
  const blockingCurrentRelease = mode === 'asset-v3' && !releaseReady;

  return {
    mode,
    status: releaseReady ? 'pass' : collectionUnavailable || blockingCurrentRelease ? 'fail' : 'warn',
    releaseReady,
    switchAuthorized: releaseReady && !collectionUnavailable,
    blockingCurrentRelease,
    blockers: collectionUnavailable ? ['asset-facts-unavailable'] : [...summary.assetV3Blockers],
    migrations: {
      required: summary.migrations.required,
      verified: summary.migrations.verified,
      missing: [...summary.migrations.missing],
      checksumMismatches: [...summary.migrations.checksumMismatches],
    },
    shadowComparison: { ...summary.shadowComparison },
    media: { ...summary.media },
    assets: { ...summary.assets },
    gc: { ...summary.gc },
    queryErrorCount: summary.queryErrors.length,
    collectionUnavailable,
  };
}

export function createUnavailableAssetGraphReleaseReadiness(
  mode: AssetGraphMode,
): AssetGraphReleaseReadiness {
  return {
    mode,
    status: 'fail',
    releaseReady: false,
    switchAuthorized: false,
    blockingCurrentRelease: mode === 'asset-v3',
    blockers: ['asset-facts-unavailable'],
    migrations: {
      required: 0,
      verified: 0,
      missing: [],
      checksumMismatches: [],
    },
    shadowComparison: {
      legacyProjects: 0,
      graphProjects: 0,
      matchingProjects: 0,
      mismatchedProjects: 0,
      unmigratedProjects: 0,
      orphanGraphProjects: 0,
      nonV3GraphProjects: 0,
      failedCheckpoints: 0,
      missingCheckpoints: 0,
      invalidLegacyRecords: 0,
    },
    media: {
      ready: 0,
      pendingPersist: 0,
      missing: 0,
      recovering: 0,
      unrecoverable: 0,
      activeAssetsMissingCurrentVersion: 0,
      placementPendingPersist: 0,
      placementMissing: 0,
      placementRecovering: 0,
      placementUnrecoverable: 0,
    },
    assets: { active: 0, trashed: 0 },
    gc: {
      pending: 0,
      deferred: 0,
      purged: 0,
      due: 0,
      physicalDeferred: 0,
      physicalFailed: 0,
      unregistered: 0,
    },
    queryErrorCount: 1,
    collectionUnavailable: true,
  };
}

export async function collectAssetGraphReleaseReadiness(): Promise<AssetGraphReleaseReadiness> {
  const mode = resolveAssetGraphMode(process.env.WUJIE_ASSET_GRAPH_MODE);
  let client: PoolClient | undefined;

  try {
    client = await getPool().connect();
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 30000');
    const facts = await collectAssetGraphDoctorFacts(client, { mode });
    const summary = summarizeAssetGraphDoctor(facts) as DoctorSummary;
    await client.query('COMMIT');
    return projectAssetGraphReleaseReadiness(summary);
  } catch {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The collection result remains fail-closed even if rollback fails.
      }
    }
    return createUnavailableAssetGraphReleaseReadiness(mode);
  } finally {
    client?.release();
  }
}

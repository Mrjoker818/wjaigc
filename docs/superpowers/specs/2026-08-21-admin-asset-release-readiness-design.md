# Administrator Asset Release Readiness Design

## Status

Approved approach: A. Extend the existing administrator production-readiness response with a read-only asset-graph release gate. Do not add a second readiness route and do not add a runtime mode mutation endpoint.

## Context

`V588-ADMIN-003` has completed its durable thumbnail backfill implementation and cloud API verification. The deployed environment remains in `legacy` asset-graph mode, so those successful backfill batches do not prove that Canvas can safely read the asset-v3 projection. A controlled switch must not occur until the current asset, migration, shadow-comparison, media-recovery and garbage-collection facts prove that the asset-v3 read path is safe.

The repository already owns the authoritative assessment logic in `scripts/doctor-asset-status.mjs` through `collectAssetGraphDoctorFacts()` and `summarizeAssetGraphDoctor()`. The implementation must reuse that logic rather than create a second source of truth or import the V5.8.8 donor media subsystem.

## Goals

1. Allow an authenticated administrator to determine whether switching `WUJIE_ASSET_GRAPH_MODE` to `asset-v3` is authorized.
2. Reuse the exact doctor facts and blocker rules already exercised by the asset migration test suite.
3. Return only a sanitized operational summary; never expose database connection data, project payloads, user identifiers, media URLs or raw SQL errors.
4. Fail closed for the proposed asset-v3 switch when facts cannot be collected or any blocker exists.
5. Preserve the current `legacy` or `shadow` runtime while the gate is not ready.
6. Keep `stable` unchanged and implement only on `main` after RED evidence.

## Non-Goals

- No endpoint changes environment variables or restarts Coze.
- No automatic switch to `asset-v3`.
- No mutation, migration, thumbnail generation or repair work is performed by the readiness request.
- No donor route, media table or background worker is copied.
- No Canvas behavior changes are included in this item.
- No provider absorption begins until the controlled projection acceptance is closed.

## Architecture

### Readiness service

Create `src/lib/asset-core/asset-release-readiness.ts` as the only application-layer adapter around the existing doctor module. It will:

1. Resolve the current mode with `resolveAssetGraphMode(process.env.WUJIE_ASSET_GRAPH_MODE)`.
2. Acquire one PostgreSQL client from the existing `getPool()`.
3. Open a read-only transaction and apply a transaction-local 30-second statement timeout.
4. Call `collectAssetGraphDoctorFacts(client, { mode })` and pass the result to `summarizeAssetGraphDoctor()`.
5. Commit the read-only transaction and always release the client.
6. On failure, roll back where possible, release the client, and return a generic unavailable result without the underlying error text.
7. Project the full doctor summary into a typed, sanitized response.

The service does not duplicate blocker calculations. `releaseReady` comes only from `summarizeAssetGraphDoctor()`.

### Existing route integration

Extend `GET /api/admin/production-readiness` after `requireAdminUser()` succeeds. The route invokes the readiness service and adds an `assetGraph` property to its existing JSON response.

Unauthenticated and non-administrator requests continue to return `403` before provider, database or asset facts are read.

The route's existing `success` field retains its current meaning for `legacy` and `shadow`: provider/database/security readiness of the active runtime. An asset gate that is not switch-ready does not make the active legacy release fail. In `asset-v3`, an unavailable or blocked asset gate makes the route's overall `success` false because the active read path is no longer proven safe.

## Response Contract

`assetGraph` has the following public shape:

```ts
interface AssetGraphReleaseReadiness {
  mode: 'legacy' | 'shadow' | 'asset-v3';
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
```

Status rules are exact:

- `pass`: facts were collected and `releaseReady` is true.
- `warn`: facts were collected, `releaseReady` is false, and the current mode is `legacy` or `shadow`.
- `fail`: collection is unavailable, or the current mode is `asset-v3` while `releaseReady` is false.
- `switchAuthorized` equals `releaseReady` only when collection succeeded.
- `blockingCurrentRelease` is true when collection is unavailable in `asset-v3`, or when mode is `asset-v3` and blockers exist.

On collection failure, numeric sections are zeroed, `blockers` is exactly `['asset-facts-unavailable']`, `queryErrorCount` is `1`, `collectionUnavailable` is true, and no exception message is returned.

## Data Safety

The API omits these doctor fields even though the internal summary contains them:

- Migration ledger entries and checksums.
- Raw `queryErrors` strings.
- Legacy project rows and payloads.
- Graph project, placement and checkpoint records.
- Asset IDs, version IDs, owner IDs, file URLs and storage keys.
- Database connection strings and credentials.

Migration filenames and fixed blocker codes are allowed because they are operational contract identifiers already stored in the repository and contain no user data or secret.

## Failure Handling

- Authentication failure short-circuits all database work.
- Database client acquisition failure returns the sanitized unavailable asset gate.
- Any doctor query error already produces `asset-facts-unavailable`; the adapter exposes only its count.
- Transaction setup, collection or commit failure produces the same unavailable gate.
- Rollback failure is not returned to the caller.
- The client is released in all paths.
- The endpoint remains read-only and cannot change the current runtime mode.

## Test Design

Testing follows RED, minimal integration, full regression and cloud verification.

### Focused unit and route contracts

1. A ready doctor summary is projected without raw entries, checksums, query errors, identities or URLs.
2. A blocked `legacy` summary returns `warn`, `switchAuthorized=false`, `blockingCurrentRelease=false`, and does not change the route's existing `success` result.
3. A blocked `asset-v3` summary returns `fail`, `blockingCurrentRelease=true`, and makes route `success=false`.
4. Collection failure returns the generic unavailable shape and does not expose the thrown message.
5. A non-administrator request does not call the asset readiness service.
6. The service uses a read-only transaction, sets the 30-second local statement timeout, commits on success, rolls back on failure and always releases the client.

### Repository gates

- Focused production-readiness and asset-doctor tests.
- Related administrator, asset graph, media health and thumbnail tests.
- Full Vitest suite with the isolated PostgreSQL gates enabled because this item reads migration and persistence state.
- TypeScript, ESLint, protected-feature contracts and production build.
- Verify `stable` remains at its recorded commit and the V5.8.8 donor lock digest remains unchanged.

### Cloud acceptance

1. Coze pulls the exact verified `main` commit.
2. Credential-free production-readiness request is rejected.
3. Authenticated request returns the sanitized `assetGraph` gate.
4. Only `releaseReady=true` and `switchAuthorized=true` authorize a controlled `asset-v3` deployment.
5. In that deployment, verify project projection, thumbnail URL delivery, browser reload persistence, original-image fallback, S3 recovery and fresh Chrome Console/network evidence.
6. Restore the previously approved runtime mode and repeat the project-load regression.
7. Record request IDs, commit, mode, counts and evidence in the V5.8.8 inventory and testing reports before starting `V588-PROVIDER-001`.

## Release Decision

The readiness endpoint is evidence, not acceptance by itself. `V588-ADMIN-003` is absorbed only after the controlled cloud projection and rollback complete. A local green suite, successful thumbnail backfill or an HTTP 200 response alone is insufficient.

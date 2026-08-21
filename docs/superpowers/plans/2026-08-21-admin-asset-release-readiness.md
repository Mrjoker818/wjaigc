# Administrator Asset Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sanitized, read-only asset-v3 release gate to the existing administrator production-readiness API and use it to control the remaining V588-ADMIN-003 cloud projection acceptance.

**Architecture:** A focused application service adapts the existing `scripts/doctor-asset-status.mjs` collector and summarizer into a typed public result. The existing administrator readiness route consumes that service after authorization, while the current legacy release remains operational unless the active mode is already `asset-v3` and the gate fails.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, PostgreSQL `pg`, Vitest, existing asset-doctor module, pnpm.

## Global Constraints

- Reuse `collectAssetGraphDoctorFacts()` and `summarizeAssetGraphDoctor()`; do not duplicate blocker calculations.
- The endpoint is read-only and must not mutate `WUJIE_ASSET_GRAPH_MODE`, run migrations, create thumbnails or repair media.
- Never return connection strings, SQL errors, checksums, project rows, user identifiers, asset identifiers, URLs or storage keys.
- Collection failure must set `switchAuthorized=false` and expose only the fixed blocker `asset-facts-unavailable`.
- A blocked gate affects the existing top-level `success` only while the active mode is `asset-v3`.
- Use a read-only transaction with a transaction-local `30000` millisecond statement timeout.
- Follow RED -> minimal integration -> full regression -> cloud verification.
- Do not modify the V5.8.8 donor tree.
- Do not modify `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- Stage and push only files belonging to this item; preserve `.superpowers/sdd/task-1-brief.md` and `.superpowers/sdd/task-2-brief.md` as user-owned changes.

---

## File Map

- Create `src/lib/asset-core/asset-release-readiness.ts`: typed service, safe projection, transaction lifecycle and unavailable fallback.
- Create `src/__tests__/lib/asset-release-readiness.test.ts`: service projection, redaction and transaction lifecycle contracts.
- Modify `src/app/api/admin/production-readiness/route.ts`: call the service after administrator authorization and add `assetGraph` to the response.
- Modify `src/__tests__/api/production-readiness.test.ts`: route authorization, legacy warning, asset-v3 failure and sanitized response contracts.
- Modify `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`: record local and cloud ADMIN-003 evidence.
- Modify `docs/testing/BUG_REGISTER.md`: record any concrete failure discovered during implementation or cloud acceptance.
- Modify `docs/testing/REGRESSION_REPORT.md`: record exact local and cloud test results.
- Modify `docs/testing/RELEASE_READINESS_REPORT.md`: record the release decision.
- Modify `docs/testing/UNVERIFIED_ITEMS.md`: close only the evidence actually proven.
- Create `docs/testing/evidence/v588-admin-003-asset-gate-cloud-2026-08-21.json`: sanitized API and controlled-mode evidence.

---

### Task 1: Asset Release Readiness Service

**Files:**
- Create: `src/lib/asset-core/asset-release-readiness.ts`
- Create: `src/__tests__/lib/asset-release-readiness.test.ts`
- Read: `scripts/doctor-asset-status.mjs`
- Read: `src/lib/asset-core/mode.ts`
- Read: `src/lib/db-client.ts`

**Interfaces:**
- Consumes: `getPool()`, `resolveAssetGraphMode(raw)`, `collectAssetGraphDoctorFacts(client, { mode })`, `summarizeAssetGraphDoctor(facts)`.
- Produces: `AssetGraphReleaseReadiness`, `projectAssetGraphReleaseReadiness(summary)`, `collectAssetGraphReleaseReadiness()`.

- [ ] **Step 1: Write the failing projection and redaction tests**

Create `src/__tests__/lib/asset-release-readiness.test.ts` with a representative ready summary and assert the exact public shape:

```ts
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  collectFacts: vi.fn(),
  summarize: vi.fn(),
}));

vi.mock('@/lib/db-client', () => ({ getPool: mocks.getPool }));
vi.mock('../../../scripts/doctor-asset-status.mjs', () => ({
  collectAssetGraphDoctorFacts: mocks.collectFacts,
  summarizeAssetGraphDoctor: mocks.summarize,
}));

import {
  collectAssetGraphReleaseReadiness,
  projectAssetGraphReleaseReadiness,
} from '@/lib/asset-core/asset-release-readiness';

const readySummary = {
  mode: 'legacy',
  releaseReady: true,
  assetV3Blockers: [],
  migrations: {
    required: 6,
    verified: 6,
    missing: [],
    checksumMismatches: [],
    entries: [{ version: 'secret.sql', expectedChecksum: 'expected', recordedChecksum: 'recorded' }],
  },
  shadowComparison: {
    legacyProjects: 2,
    graphProjects: 2,
    matchingProjects: 2,
    mismatchedProjects: 0,
    unmigratedProjects: 0,
    orphanGraphProjects: 0,
    nonV3GraphProjects: 0,
    failedCheckpoints: 0,
    missingCheckpoints: 0,
    invalidLegacyRecords: 0,
  },
  media: {
    ready: 4,
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
  assets: { active: 4, trashed: 0 },
  gc: {
    pending: 0,
    deferred: 0,
    purged: 0,
    due: 0,
    physicalDeferred: 0,
    physicalFailed: 0,
    unregistered: 0,
  },
  queryErrors: ['must-not-leak: owner=user-1 url=https://private.example'],
};

describe('asset release readiness', () => {
  it('projects a ready doctor summary without raw operational data', () => {
    const result = projectAssetGraphReleaseReadiness({ ...readySummary, queryErrors: [] });

    expect(result).toMatchObject({
      mode: 'legacy',
      status: 'pass',
      releaseReady: true,
      switchAuthorized: true,
      blockingCurrentRelease: false,
      blockers: [],
      queryErrorCount: 0,
      collectionUnavailable: false,
    });
    expect(JSON.stringify(result)).not.toContain('entries');
    expect(JSON.stringify(result)).not.toContain('Checksum');
  });

  it('warns without blocking the active legacy release when blockers exist', () => {
    expect(projectAssetGraphReleaseReadiness({
      ...readySummary,
      releaseReady: false,
      assetV3Blockers: ['unmigrated-projects'],
      shadowComparison: { ...readySummary.shadowComparison, unmigratedProjects: 1 },
      queryErrors: [],
    })).toMatchObject({
      status: 'warn',
      switchAuthorized: false,
      blockingCurrentRelease: false,
      blockers: ['unmigrated-projects'],
    });
  });

  it('blocks the active asset-v3 release when blockers exist', () => {
    expect(projectAssetGraphReleaseReadiness({
      ...readySummary,
      mode: 'asset-v3',
      releaseReady: false,
      assetV3Blockers: ['non-ready-current-media'],
      queryErrors: [],
    })).toMatchObject({ status: 'fail', blockingCurrentRelease: true });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/asset-release-readiness.test.ts
```

Expected: FAIL because `@/lib/asset-core/asset-release-readiness` does not exist. Record this output before creating production code.

- [ ] **Step 3: Add failing transaction lifecycle and generic failure tests**

Append tests that inject a fake pool client and assert exact SQL lifecycle:

```ts
it('collects facts inside a bounded read-only transaction and releases the client', async () => {
  const client = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
  mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
  mocks.collectFacts.mockResolvedValue({ facts: true });
  mocks.summarize.mockReturnValue({ ...readySummary, queryErrors: [] });

  await expect(collectAssetGraphReleaseReadiness()).resolves.toMatchObject({ status: 'pass' });
  expect(client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN READ ONLY',
    'SET LOCAL statement_timeout = 30000',
    'COMMIT',
  ]);
  expect(client.release).toHaveBeenCalledOnce();
});

it('rolls back, releases and redacts collection failures', async () => {
  const client = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
  mocks.getPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(client) });
  mocks.collectFacts.mockRejectedValue(new Error('password=secret owner=user-1'));

  const result = await collectAssetGraphReleaseReadiness();

  expect(result).toMatchObject({
    releaseReady: false,
    switchAuthorized: false,
    blockers: ['asset-facts-unavailable'],
    collectionUnavailable: true,
  });
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('user-1');
});
```

- [ ] **Step 4: Implement the minimal typed service**

Create `src/lib/asset-core/asset-release-readiness.ts` with these public members and no additional behavior:

```ts
import { getPool } from '@/lib/db-client';
import { resolveAssetGraphMode, type AssetGraphMode } from '@/lib/asset-core/mode';
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

export function projectAssetGraphReleaseReadiness(summary: DoctorSummary): AssetGraphReleaseReadiness {
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
    blockers: [...summary.assetV3Blockers],
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
```

Define `DoctorSummary` as `Omit<AssetGraphReleaseReadiness, 'status' | 'switchAuthorized' | 'blockingCurrentRelease' | 'blockers' | 'queryErrorCount' | 'collectionUnavailable'>` with `assetV3Blockers: string[]`, `queryErrors: string[]`, and an internal `migrations.entries` array added to the migrations field. Implement `createUnavailableAssetGraphReleaseReadiness(mode)` with every numeric field set to zero, `status='fail'`, `releaseReady=false`, `switchAuthorized=false`, `blockingCurrentRelease=mode === 'asset-v3'`, `blockers=['asset-facts-unavailable']`, `queryErrorCount=1` and `collectionUnavailable=true`. Implement `collectAssetGraphReleaseReadiness()` with `BEGIN READ ONLY`, `SET LOCAL statement_timeout = 30000`, collector, summarizer, `COMMIT`, `ROLLBACK` on failure and `release()` in `finally`. Do not log the caught error.

- [ ] **Step 5: Run focused service tests and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/asset-release-readiness.test.ts src/__tests__/scripts/doctor-asset-status.test.ts
```

Expected: both files pass with zero failed tests and no leaked error text.

- [ ] **Step 6: Commit the service slice**

```powershell
git add -- src/lib/asset-core/asset-release-readiness.ts src/__tests__/lib/asset-release-readiness.test.ts
git commit -m "feat: expose asset release readiness service"
```

---

### Task 2: Administrator Production-Readiness Integration

**Files:**
- Modify: `src/app/api/admin/production-readiness/route.ts`
- Modify: `src/__tests__/api/production-readiness.test.ts`

**Interfaces:**
- Consumes: `collectAssetGraphReleaseReadiness(): Promise<AssetGraphReleaseReadiness>` from Task 1.
- Produces: `GET /api/admin/production-readiness` response containing `assetGraph`.

- [ ] **Step 1: Add the route mock and prove authorization short-circuit**

Add `collectAssetGraphReleaseReadiness: vi.fn()` to the hoisted mocks, mock `@/lib/asset-core/asset-release-readiness`, and extend the existing non-admin assertion:

```ts
expect(mocks.collectAssetGraphReleaseReadiness).not.toHaveBeenCalled();
```

Provide this default in `beforeEach` for authorized tests:

```ts
mocks.collectAssetGraphReleaseReadiness.mockResolvedValue({
  mode: 'legacy',
  status: 'pass',
  releaseReady: true,
  switchAuthorized: true,
  blockingCurrentRelease: false,
  blockers: [],
  migrations: { required: 6, verified: 6, missing: [], checksumMismatches: [] },
  shadowComparison: {},
  media: {},
  assets: {},
  gc: {},
  queryErrorCount: 0,
  collectionUnavailable: false,
});
```

- [ ] **Step 2: Add failing route response tests**

Add these behaviors:

```ts
it('includes the sanitized asset release gate for administrators', async () => {
  mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
  mocks.getApiProviders.mockResolvedValue([]);

  const data = await (await GET(request())).json();

  expect(data.assetGraph).toMatchObject({ releaseReady: true, switchAuthorized: true });
});

it('does not fail the active legacy release when asset-v3 switching is blocked', async () => {
  mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
  mocks.getApiProviders.mockResolvedValue([]);
  mocks.collectAssetGraphReleaseReadiness.mockResolvedValue({
    mode: 'legacy', status: 'warn', releaseReady: false, switchAuthorized: false,
    blockingCurrentRelease: false, blockers: ['unmigrated-projects'],
    migrations: {}, shadowComparison: {}, media: {}, assets: {}, gc: {},
    queryErrorCount: 0, collectionUnavailable: false,
  });

  const data = await (await GET(request())).json();
  expect(data.success).toBe(true);
  expect(data.assetGraph.status).toBe('warn');
});

it('fails readiness when the active asset-v3 path is blocked', async () => {
  mocks.requireAdminUser.mockResolvedValue({ id: 'admin-1', role: 'admin' });
  mocks.ensureCloudTaskTables.mockResolvedValue(undefined);
  mocks.getApiProviders.mockResolvedValue([]);
  mocks.collectAssetGraphReleaseReadiness.mockResolvedValue({
    mode: 'asset-v3', status: 'fail', releaseReady: false, switchAuthorized: false,
    blockingCurrentRelease: true, blockers: ['non-ready-current-media'],
    migrations: {}, shadowComparison: {}, media: {}, assets: {}, gc: {},
    queryErrorCount: 0, collectionUnavailable: false,
  });

  const data = await (await GET(request())).json();
  expect(data.success).toBe(false);
});
```

- [ ] **Step 3: Run the route test and verify RED**

Run:

```powershell
pnpm exec vitest run src/__tests__/api/production-readiness.test.ts
```

Expected: FAIL because the route neither calls the service nor returns `assetGraph`.

- [ ] **Step 4: Add the minimal route integration**

Import the service, collect it only after authorization, include it in the response and extend the top-level success expression:

```ts
const assetGraph = await collectAssetGraphReleaseReadiness();

return NextResponse.json({
  success: database.status !== 'fail'
    && security.status !== 'fail'
    && !assetGraph.blockingCurrentRelease,
  database,
  security,
  taskEvents,
  assetGraph,
  summary,
  providers: readiness,
});
```

- [ ] **Step 5: Run focused administrator regression and verify GREEN**

Run:

```powershell
pnpm exec vitest run src/__tests__/api/production-readiness.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts src/__tests__/api/admin-orphan-assets.test.ts
```

Expected: all tests pass and the exact 24-route authorization manifest remains unchanged.

- [ ] **Step 6: Commit the route slice**

```powershell
git add -- src/app/api/admin/production-readiness/route.ts src/__tests__/api/production-readiness.test.ts
git commit -m "feat: add asset gate to production readiness"
```

---

### Task 3: Full Local Verification and Candidate Publication

**Files:**
- Modify only if a concrete failure is reproduced: the file directly responsible for that failure and its failing test.
- Read: `package.json`, `docs/testing/PROTECTED_FEATURES.md`.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: one verified `main` candidate commit, with `stable` and donor hashes unchanged.

- [ ] **Step 1: Run focused asset and administrator suites**

```powershell
pnpm exec vitest run src/__tests__/lib/asset-release-readiness.test.ts src/__tests__/scripts/doctor-asset-status.test.ts src/__tests__/api/production-readiness.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts src/__tests__/api/admin-orphan-assets.test.ts src/__tests__/api/admin-thumbnail-backfill.test.ts src/__tests__/lib/asset-thumbnail-backfill.test.ts
```

Expected: zero failures. If a failure is concrete, add or refine the failing regression before changing production code.

- [ ] **Step 2: Run the isolated PostgreSQL suite**

Set `POSTGRES_TEST_DATABASE_URL` and `RUN_POSTGRES_INTEGRATION=1` to the existing isolated disposable database, then run:

```powershell
pnpm test
```

Expected: every PostgreSQL-gated asset, thumbnail, task and accounting test executes with zero skips and zero failures. Never point this command at the Coze production database.

- [ ] **Step 3: Run static and build gates**

```powershell
pnpm validate
pnpm build
```

Expected: TypeScript passes, ESLint exits zero with no errors, production build succeeds and `/api/admin/production-readiness` is present.

- [ ] **Step 4: Verify protected boundaries and repository identity**

```powershell
git diff --check
git status --short
git rev-parse origin/stable
(Get-FileHash -Algorithm SHA256 "J:\无界云端0820\pnpm-lock.yaml").Hash.ToLower()
```

Expected:

- `origin/stable` remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- V5.8.8 remains read-only and its captured SHA-256 remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`; use `Get-FileHash -Algorithm SHA256` for the SHA-256 assertion.
- Only the two user-owned brief files may remain dirty.

- [ ] **Step 5: Push the exact candidate to `main` only**

```powershell
git push origin HEAD:main
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: local `HEAD` equals `origin/main`; `origin/stable` remains unchanged.

---

### Task 4: Coze Gate Probe, Controlled Asset-v3 Acceptance and Rollback

**Files:**
- Create: `docs/testing/evidence/v588-admin-003-asset-gate-cloud-2026-08-21.json`
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

**Interfaces:**
- Consumes: exact candidate commit and authenticated Coze administrator session.
- Produces: request-ID evidence for the gate, controlled projection, media delivery and rollback; closes ADMIN-003 only when every required assertion passes.

- [ ] **Step 1: Pull and rebuild the exact candidate in Coze**

Use the existing Coze project tab. If the sandbox-disconnected dialog is visible, refresh that page, wait for the sandbox to recover, pull `origin/main`, verify the exact candidate SHA, rebuild/restart, then hard-refresh the existing preview tab. Do not create a new Chrome tab and do not use 360 Browser.

- [ ] **Step 2: Verify authorization and sanitized gate response**

From the authenticated administrator session, capture:

1. Credential-free GET returns `401` or `403` and does not read asset facts.
2. Authenticated GET returns `200` with `assetGraph`.
3. JSON does not contain `apiKey`, `password`, `connectionString`, `expectedChecksum`, `recordedChecksum`, `queryErrors`, `ownerId`, `assetId`, `fileUrl` or `storageKey`.
4. Record commit, current mode, request IDs, blockers, migration counts, shadow counts, media counts, GC counts and `switchAuthorized`.

- [ ] **Step 3: Enforce the pre-switch decision**

If `switchAuthorized=false`, do not switch modes. Record the exact fixed blocker codes, leave `V588-ADMIN-003` partial and create a separate RED repair item for the underlying blocker.

If `switchAuthorized=true`, deploy a controlled candidate with only `WUJIE_ASSET_GRAPH_MODE=asset-v3` changed. Do not change Canvas kernel, task core, Agent runtime, workflow renderer or provider settings in the same deployment.

- [ ] **Step 4: Verify asset-v3 Canvas projection in real Chrome**

Using the existing Chrome preview tab and an existing project containing ready images:

1. Open the project and confirm every expected image placement appears.
2. Capture `/api/user-data/sync?key=projects`; assert `assetGraphMode=asset-v3` and nonzero thumbnail projections for images that have ready variants.
3. Fetch representative 512 and 256 thumbnail URLs and assert image MIME, nonzero body and successful decode.
4. Reload the same project and assert image IDs, positions, dimensions, ordering and thumbnail URLs remain stable.
5. Select an image and open/download the original; assert the original URL and dimensions are preserved rather than replaced by the thumbnail.
6. Exercise one missing-ready-variant record and prove fallback to the original image.
7. Exercise one recoverable S3/media record and prove its state reaches ready without producing a blank frame.
8. Capture screenshot, Console and network evidence; fresh unhandled Console errors, failed project reads or blank image frames fail acceptance.

- [ ] **Step 5: Restore the approved runtime mode and regress project loading**

Restore `WUJIE_ASSET_GRAPH_MODE` to its previously recorded value (`legacy` unless the pre-switch evidence says otherwise), rebuild/restart, hard-refresh the existing preview tab and reopen the same project. Assert project count, image count, placement identity, original-image access and Console health remain unchanged.

- [ ] **Step 6: Write machine-readable evidence and update reports**

The evidence JSON must contain these exact top-level keys: `item`, `commit`, `stableCommit`, `preSwitch`, `assetV3`, `rollback`, and `verdict`. Set `item` to `V588-ADMIN-003` and `stableCommit` to `52f7c601ed150769e15d06fb435c6e360e28c9e7`. Populate `commit` and every request ID from captured command/browser output. `preSwitch` records mode, authorization, blockers and readiness counts. `assetV3` records pass/fail for project read, thumbnail delivery, reload, original fallback and S3 recovery plus the fresh Console error count. `rollback` records restored mode, project read and Console error count. Set `verdict` to `pass` only when every acceptance assertion passes; otherwise use `partial` or `fail`. Do not fabricate unavailable evidence. Update all four testing reports and the absorption inventory with exact counts and links. Mark remaining items unverified rather than passed.

- [ ] **Step 7: Commit and push evidence only after acceptance**

```powershell
git add -- docs/testing/evidence/v588-admin-003-asset-gate-cloud-2026-08-21.json docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: close asset projection cloud acceptance"
git push origin HEAD:main
```

Expected: ADMIN-003 is marked absorbed only if Steps 2 through 5 all passed. Otherwise commit an honest partial-evidence update and keep `V588-PROVIDER-001` unauthorized.

---

## Completion Gate

This plan is complete only when:

1. The service and route tests were observed RED before production implementation.
2. Focused, full PostgreSQL, TypeScript, ESLint and build gates pass.
3. `stable` and the V5.8.8 donor remain unchanged.
4. Coze runs the exact verified `main` candidate.
5. The authenticated gate authorizes the switch without exposing sensitive data.
6. Asset-v3 thumbnail delivery, reload, original fallback and S3 recovery pass in real Chrome.
7. The approved runtime mode is restored and regressed.
8. Reports and evidence are committed before `V588-PROVIDER-001` begins.

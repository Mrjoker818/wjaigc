# Historical Media Safe Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-explicit, atomic and auditable soft-archive path for irrecoverable historical media so Stage 4 can clear only the proven missing/false-ready references without regeneration or physical deletion.

**Architecture:** A pure domain module classifies candidates, canonicalizes requests and creates stale-data digests. A PostgreSQL service discovers and atomically archives explicitly selected candidates while reusing the current Canvas snapshot lifecycle helper; a checksum-managed ledger provides durable idempotency and audit. One guarded administrator route exposes read-only discovery and explicit archive commands, and existing restore behavior rejects unrecoverable media.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, PostgreSQL 18, `pg`, Vitest 3, Playwright 1.60, PowerShell, Google Chrome.

## Global Constraints

- Work only from `main@84d2a5cc7d07f34672bdd25a0abeb8074f356ca0` or a descendant on `codex/wj-stable-s4`; push only to `main`.
- Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged.
- Keep `J:\无界云端0820` read-only; do not copy V5.8.8 implementation code.
- Keep `WUJIE_ASSET_GRAPH_MODE=shadow` until the post-remediation doctor authorizes a controlled `asset-v3` verification.
- Never regenerate, replace, charge credits, physically delete, hide an error, or hardcode production asset IDs.
- Discovery is read-only and never performs remote network probes.
- Archive requires explicit candidate IDs and current `candidateDigest`; no archive-all operation exists.
- One request is one PostgreSQL transaction; any candidate, snapshot, ledger or audit failure rolls back all candidates.
- Every implementation task follows RED -> minimal GREEN -> focused regression -> commit.
- Do not stage or modify `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-1-brief.md`, or `.superpowers/sdd/task-2-brief.md`.

## File Map

- Create `src/lib/asset-core/historical-media-remediation.ts`: pure candidate types, URL classification, normalization, digesting, request validation, PostgreSQL discovery and atomic archive service.
- Create `src/lib/asset-core/canvas-placement-snapshot.ts`: the existing Canvas placement snapshot trash operation as a shared transaction helper.
- Modify `src/lib/asset-core/storage.ts`: delegate existing Canvas trash behavior to the shared helper; preserve public `AssetStorage` behavior.
- Modify `src/lib/asset-core/service.ts`: reject restore when the selected version is `unrecoverable`.
- Create `migrations/20260821_wj_stable_s4_historical_media_remediations.sql`: immutable remediation ledger and unique administrator idempotency key.
- Create `src/app/api/admin/assets/remediation/route.ts`: guarded GET candidate discovery and POST explicit archive.
- Create `src/__tests__/lib/historical-media-remediation.test.ts`: pure domain RED/GREEN tests.
- Create `src/__tests__/api/historical-media-remediation.test.ts`: route authorization, validation and error-shape tests.
- Modify `src/__tests__/api/admin-route-authorization-contract.test.ts`: add the new guarded route to the exact manifest.
- Modify `src/__tests__/lib/asset-service.test.ts`: permanent unrecoverable-restore regression.
- Modify `src/__tests__/scripts/run-migrations.test.ts`: migration inventory assertion.
- Create `tests/integration/stage-4-historical-media-remediation-postgres.test.ts`: schema, concurrency, rollback, Canvas snapshot and audit proof.
- Update `docs/testing/BUG_REGISTER.md`, `docs/testing/REGRESSION_REPORT.md`, `docs/testing/RELEASE_READINESS_REPORT.md`, `docs/testing/UNVERIFIED_ITEMS.md`, and `docs/plans/v588/V588_ABSORPTION_INVENTORY.md` only after fresh test evidence exists.

---

### Task 1: Pure Candidate and Request Contract

**Files:**
- Create: `src/lib/asset-core/historical-media-remediation.ts`
- Create: `src/__tests__/lib/historical-media-remediation.test.ts`

**Interfaces:**
- Produces: `HistoricalMediaCandidate`, `HistoricalMediaArchiveSelection`, `HistoricalMediaArchiveRequest`, `HistoricalMediaArchiveResult`.
- Produces: `classifyHistoricalMediaUrl(url: string): 'empty' | 'ephemeral-proxy' | 'durable-or-external'`.
- Produces: `buildHistoricalMediaCandidateDigest(candidate: HistoricalMediaCandidate): string`.
- Produces: `parseHistoricalMediaArchiveRequest(value: unknown): HistoricalMediaArchiveRequest`.
- Produces: `buildHistoricalMediaArchiveRequestDigest(input: HistoricalMediaArchiveRequest): string`.

- [ ] **Step 1: Write the failing domain tests**

```ts
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
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts
```

Expected: FAIL because `@/lib/asset-core/historical-media-remediation` does not exist.

- [ ] **Step 3: Add the minimal pure domain implementation**

Use these exact public shapes:

```ts
export interface HistoricalMediaPlacementFact {
  id: string;
  workspace: WorkspaceKind;
  workspaceId: string;
  entityType: WorkspaceEntityType;
  entityId: string;
}

export interface HistoricalMediaCandidate {
  ownerId: string;
  projectId: string;
  assetId: string;
  assetVersionId: string;
  availability: MediaAvailability;
  urlClass: 'empty' | 'ephemeral-proxy';
  placements: HistoricalMediaPlacementFact[];
  candidateDigest: string;
}

export interface HistoricalMediaArchiveSelection {
  projectId: string;
  assetId: string;
  assetVersionId: string;
  candidateDigest: string;
}

export interface HistoricalMediaArchiveRequest {
  action: 'archive-unrecoverable';
  idempotencyKey: string;
  reason: string;
  candidates: HistoricalMediaArchiveSelection[];
}

export interface HistoricalMediaArchiveResult {
  remediationId: string;
  reused: boolean;
  archivedVersionCount: number;
  archivedPlacementCount: number;
  projectRevisions: Record<string, number>;
}
```

Normalize all strings with `trim()`. Bound `idempotencyKey` to 8-128 characters, `reason` to 8-512, candidate strings to 1-256, candidate count to 1-20, and canonical JSON to 64 KiB. Use `createHash('sha256')` over stable JSON with selections and placements sorted by identity. Candidate canonical JSON includes normalized owner/project/asset/version/availability/URL class/sorted placement facts and explicitly excludes the output field `candidateDigest` itself.

- [ ] **Step 4: Run focused GREEN**

Run:

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts
```

Expected: all domain tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/lib/asset-core/historical-media-remediation.ts src/__tests__/lib/historical-media-remediation.test.ts
git diff --cached --check
git commit -m "test: define historical media archive contract"
```

---

### Task 2: Shared Canvas Snapshot Trash Helper

**Files:**
- Create: `src/lib/asset-core/canvas-placement-snapshot.ts`
- Modify: `src/lib/asset-core/storage.ts`
- Modify: `src/__tests__/lib/asset-service.test.ts`
- Test: `tests/integration/stage-2-asset-lifecycle-postgres.test.ts`

**Interfaces:**
- Consumes: `AssetCoreSqlTransaction`, `WorkspacePlacement`.
- Produces: `trashCanvasPlacementSnapshotInTransaction(client, ownerId, projectId, placement): Promise<number>`.
- Preserves: `AssetStorageTransaction.trashCanvasPlacementSnapshot(...)` behavior and revision metadata.

- [ ] **Step 1: Add a failing source-boundary and behavior test**

```ts
it('delegates Canvas snapshot trash to the shared transaction helper', () => {
  const storageSource = readFileSync('src/lib/asset-core/storage.ts', 'utf8');
  expect(storageSource).toContain('trashCanvasPlacementSnapshotInTransaction(');
  expect(storageSource).not.toContain("project.canvasImages = canvasImages.filter(candidate => candidate.id !== placement.entityId)");
});
```

Keep the existing PostgreSQL lifecycle assertion that deleting a placement removes exactly its legacy image and increments the project revision.

- [ ] **Step 2: Run RED**

```powershell
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-lifecycle-postgres.test.ts
```

Expected: the new delegation assertion FAILS; the existing lifecycle test remains a compatibility baseline.

- [ ] **Step 3: Extract without behavior change**

Create:

```ts
import type { AssetCoreSqlTransaction } from './storage';
import type { WorkspacePlacement } from './types';

export async function trashCanvasPlacementSnapshotInTransaction(
  client: AssetCoreSqlTransaction,
  ownerId: string,
  projectId: string,
  placement: WorkspacePlacement,
): Promise<number> {
  const snapshot = await client.query<{ data_value: unknown }>(
    `SELECT data_value FROM wujie_user_data
     WHERE user_id = $1 AND data_key = 'projects'
     FOR UPDATE`,
    [ownerId],
  );
  const projects = Array.isArray(snapshot.rows[0]?.data_value)
    ? snapshot.rows[0].data_value as Array<Record<string, unknown>>
    : null;
  if (!projects) throw new Error('Canvas project snapshot is unavailable');
  const project = projects.find(candidate => candidate.id === projectId);
  if (!project) throw new Error('Canvas project snapshot is unavailable');
  const canvasImages = Array.isArray(project.canvasImages)
    ? project.canvasImages as Array<Record<string, unknown>>
    : [];
  project.canvasImages = canvasImages.filter(candidate => candidate.id !== placement.entityId);
  project.updatedAt = Date.now();
  await client.query(
    `UPDATE wujie_user_data
     SET data_value = $2::jsonb, updated_at = $3
     WHERE user_id = $1 AND data_key = 'projects'`,
    [ownerId, JSON.stringify(projects), Date.now()],
  );
  const revision = await client.query<{ revision: string }>(
    `INSERT INTO wujie_user_data(user_id, data_key, data_value, updated_at)
     VALUES ($1, '__asset_graph_projects_revision', '1'::jsonb, $2)
     ON CONFLICT (user_id, data_key) DO UPDATE SET
       data_value = to_jsonb(COALESCE(
         CASE
           WHEN jsonb_typeof(wujie_user_data.data_value) = 'number'
             THEN (wujie_user_data.data_value #>> '{}')::bigint
           WHEN jsonb_typeof(wujie_user_data.data_value) = 'string'
                AND (wujie_user_data.data_value #>> '{}') ~ '^\\d+$'
             THEN (wujie_user_data.data_value #>> '{}')::bigint
           ELSE 0
         END,
         0
       ) + 1),
       updated_at = EXCLUDED.updated_at
     RETURNING data_value #>> '{}' AS revision`,
    [ownerId, Date.now()],
  );
  const nextRevision = Number(revision.rows[0]?.revision ?? 0);
  await client.query(
    `UPDATE wujie_workspace_placements
     SET metadata = metadata || jsonb_build_object('canvasTrashProjectRevision', $4::bigint),
         updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND project_id = $3 AND status = 'trashed'`,
    [placement.id, ownerId, projectId, nextRevision],
  );
  placement.metadata = {
    ...(placement.metadata ?? {}),
    canvasTrashProjectRevision: nextRevision,
  };
  return nextRevision;
}
```

This is the exact body currently at `src/lib/asset-core/storage.ts:557-617`, moved byte-for-byte except that `this.client` becomes the `client` argument. Replace `PostgresAssetStorageTransaction.trashCanvasPlacementSnapshot` with one call to the helper. Do not change `lockCanvasProjectSnapshot`, restore behavior or revision semantics.

- [ ] **Step 4: Run GREEN and the adjacent asset suite**

```powershell
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts src/__tests__/api/asset-trash-restore.test.ts tests/integration/stage-2-asset-lifecycle-postgres.test.ts
```

Expected: all selected tests PASS when PostgreSQL is configured; otherwise the existing PostgreSQL skip remains explicitly reported.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- src/lib/asset-core/canvas-placement-snapshot.ts src/lib/asset-core/storage.ts src/__tests__/lib/asset-service.test.ts
git diff --cached --check
git commit -m "refactor: share canvas placement archive transaction"
```

---

### Task 3: Checksum-Managed Remediation Ledger

**Files:**
- Create: `migrations/20260821_wj_stable_s4_historical_media_remediations.sql`
- Modify: `src/__tests__/scripts/run-migrations.test.ts`
- Create: `tests/integration/stage-4-historical-media-remediation-postgres.test.ts`

**Interfaces:**
- Produces PostgreSQL table `wujie_asset_media_remediations`.
- Unique identity: `(actor_user_id, idempotency_key)`.
- Stores: request digest, action, reason, before/result JSON, terminal status and timestamps.

- [ ] **Step 1: Write migration RED tests**

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationVersion = '20260821_wj_stable_s4_historical_media_remediations.sql';
const migrationPath = resolve(process.cwd(), 'migrations', migrationVersion);

function runMigrations(databaseUrl: string): void {
  const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/run-migrations.mjs')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, PGDATABASE_URL: databaseUrl },
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

postgresIt('applies the immutable remediation ledger once with an exact checksum', async () => {
  await withIsolatedPostgres('historical-media-ledger', async ({ databaseUrl, query }) => {
    runMigrations(databaseUrl);
    runMigrations(databaseUrl);
    const checksum = createHash('sha256').update(await readFile(migrationPath)).digest('hex');
    await expect(query(
      'SELECT checksum FROM wujie_schema_migrations WHERE version = $1',
      [migrationVersion],
    )).resolves.toMatchObject({ rows: [{ checksum }] });
  });
});
```

Add a duplicate insert assertion that `(actor_user_id, idempotency_key)` rejects the second row.

- [ ] **Step 2: Run RED**

```powershell
pnpm exec vitest run src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

Expected: migration inventory assertion and PostgreSQL schema test FAIL because the SQL file/table do not exist.

- [ ] **Step 3: Add the additive migration**

```sql
CREATE TABLE IF NOT EXISTS wujie_asset_media_remediations (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  action TEXT NOT NULL CHECK (action = 'archive-unrecoverable'),
  reason TEXT NOT NULL,
  before_state JSONB NOT NULL,
  result JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status = 'completed'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_asset_media_remediations_created
  ON wujie_asset_media_remediations(created_at DESC);
```

Add the exact filename to the migration-runner unit assertion. Do not add it to `STAGE_2_MIGRATIONS`; that list governs the Stage 2 graph schema only.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm exec vitest run src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

Expected: migration tests PASS with isolated PostgreSQL; if absent, the test must print its explicit BLOCKED message and remain unclaimed.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- migrations/20260821_wj_stable_s4_historical_media_remediations.sql src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
git diff --cached --check
git commit -m "feat: add historical media remediation ledger"
```

---

### Task 4: Atomic Discovery and Safe Archive Service

**Files:**
- Modify: `src/lib/asset-core/historical-media-remediation.ts`
- Modify: `tests/integration/stage-4-historical-media-remediation-postgres.test.ts`

**Interfaces:**
- Produces: `discoverHistoricalMediaArchiveCandidates(input?: { limit?: number }): Promise<{ candidates: HistoricalMediaCandidate[]; counts: { versions: number; activePlacements: number } }>`.
- Produces: `archiveHistoricalMedia(input: { actorUserId: string; actorUserName: string; ipAddress: string | null; request: HistoricalMediaArchiveRequest }): Promise<HistoricalMediaArchiveResult>`.
- Consumes: `withAssetCoreTransaction`, `trashCanvasPlacementSnapshotInTransaction`.

- [ ] **Step 1: Add PostgreSQL RED cases**

Seed four categories: empty chat placeholder, missing proxy Canvas bridge, false-ready proxy with two placements, and a managed `/api/serve-upload/...` control. Assert:

```ts
const discovery = await discoverHistoricalMediaArchiveCandidates({ limit: 20 });
expect(discovery.counts).toEqual({ versions: 3, activePlacements: 4 });
expect(discovery.candidates.flatMap(item => item.placements)).toHaveLength(4);
expect(discovery.candidates.some(item => item.assetId === 'asset-managed')).toBe(false);
```

Add RED cases for:

```ts
const concurrent = await Promise.all([
  archiveHistoricalMedia(command),
  archiveHistoricalMedia(command),
]);
expect(concurrent.map(result => result.reused).sort()).toEqual([false, true]);
expect(new Set(concurrent.map(result => result.remediationId)).size).toBe(1);
expect(concurrent[0].remediationId).toBeTruthy();

await expect(archiveHistoricalMedia({
  ...command,
  request: { ...command.request, reason: 'Different reviewed reason' },
})).rejects.toMatchObject({ code: 'HISTORICAL_MEDIA_IDEMPOTENCY_CONFLICT' });
```

Also assert: all four placements become `trashed`, all three versions become `unrecoverable`, managed media remains active, Canvas snapshots lose only selected entity IDs, audit and ledger each have one row, and exactly one request result exists.

- [ ] **Step 2: Run RED**

```powershell
pnpm exec vitest run tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

Expected: service exports are missing and archive assertions FAIL.

- [ ] **Step 3: Implement read-only discovery**

Use one bounded query joining current active Assets, current AssetVersions and active placements. Filter only:

```sql
version.storage_key IS NULL
AND version.recovery_source_url IS NULL
AND (btrim(version.file_url) = '' OR version.file_url LIKE '/v1/images/proxy/%')
AND version.availability IN ('ready', 'missing', 'unrecoverable')
```

Group in TypeScript by version, sort placement facts, and calculate the candidate digest with Task 1's pure function. Do not fetch `file_url` over the network.

- [ ] **Step 4: Implement one atomic archive transaction**

The transaction must execute this exact order:

```ts
await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
  `historical-media-remediation:${actorUserId}:${request.idempotencyKey}`,
]);
const existing = await loadRemediationByIdempotency(client, actorUserId, request.idempotencyKey);
if (existing) return resolveExistingOrConflict(existing, requestDigest);

for (const selection of sortedSelections) {
  const locked = await lockCandidateFacts(client, selection);
  assertCandidateDigest(locked, selection.candidateDigest);
  await markVersionUnrecoverable(client, locked);
  for (const placement of locked.placements) {
    await softTrashPlacement(client, placement);
    if (placement.workspace === 'canvas' && placement.entityType === 'canvas-image') {
      await trashCanvasPlacementSnapshotInTransaction(
        client, locked.ownerId, locked.projectId, placement,
      );
    }
  }
  await trashAssetWhenUnreferenced(client, locked);
}
await insertRemediationLedger(client, result);
await insertRedactedAdministratorAudit(client, result);
return result;
```

The locked candidate query must derive `ownerId` from the database, require exact project/asset/version/current-version identity, lock all active placements in ID order, and recompute the candidate digest. A newly present storage key/recovery source or changed placement set throws `HISTORICAL_MEDIA_CANDIDATE_STALE`.

The general audit detail contains remediation ID, candidate count and placement count only. It never contains prompt, key, bytes or complete URL.

- [ ] **Step 5: Add rollback and cross-boundary tests**

Within isolated PostgreSQL, temporarily make the audit insert fail and assert the version, placements, snapshot, revision and ledger remain unchanged. Add mismatched project/asset/version selection cases and assert `HISTORICAL_MEDIA_NOT_FOUND` without leaking the true owner.

- [ ] **Step 6: Run Task 4 GREEN**

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

Expected: all domain and real PostgreSQL remediation tests PASS with zero skips under the isolated database.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/lib/asset-core/historical-media-remediation.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
git diff --cached --check
git commit -m "feat: archive irrecoverable media atomically"
```

---

### Task 5: Administrator API and Restore Guard

**Files:**
- Create: `src/app/api/admin/assets/remediation/route.ts`
- Create: `src/__tests__/api/historical-media-remediation.test.ts`
- Modify: `src/__tests__/api/admin-route-authorization-contract.test.ts`
- Modify: `src/lib/asset-core/service.ts`
- Modify: `src/__tests__/lib/asset-service.test.ts`
- Modify: `src/app/api/assets/[assetId]/restore/route.ts`
- Modify: `src/__tests__/api/asset-trash-restore.test.ts`

**Interfaces:**
- GET `/api/admin/assets/remediation?limit=20` returns discovery.
- POST `/api/admin/assets/remediation` executes an explicit archive request.
- Restore returns HTTP 409 `{ error: 'ASSET_MEDIA_UNRECOVERABLE' }` for an unrecoverable version.

- [ ] **Step 1: Write route RED tests**

```ts
const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  discover: vi.fn(),
  archive: vi.fn(),
}));

it.each([
  [null, 401],
  [{ user: { id: 'user-a', name: 'User', role: 'user' } }, 403],
])('rejects discovery before invoking the service', async (auth, status) => {
  mocks.getRequestUser.mockResolvedValue(auth);
  const response = await GET(new NextRequest('http://localhost/api/admin/assets/remediation'));
  expect(response.status).toBe(status);
  expect(mocks.discover).not.toHaveBeenCalled();
});

it('passes the authenticated actor and validated request to archive', async () => {
  mocks.getRequestUser.mockResolvedValue({ user: { id: 'admin-a', name: 'Admin', role: 'admin' } });
  mocks.archive.mockResolvedValue({
    remediationId: 'remediation-a', reused: false,
    archivedVersionCount: 1, archivedPlacementCount: 1, projectRevisions: {},
  });
  const response = await POST(new NextRequest('http://localhost/api/admin/assets/remediation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '360' },
    body: JSON.stringify({
      action: 'archive-unrecoverable',
      idempotencyKey: 'archive-request-a',
      reason: 'Historical media bytes are unavailable',
      candidates: [{
        projectId: 'project-a', assetId: 'asset-a', assetVersionId: 'version-a',
        candidateDigest: 'a'.repeat(64),
      }],
    }),
  }));
  expect(response.status).toBe(200);
  expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({
    actorUserId: 'admin-a', actorUserName: 'Admin',
  }));
});
```

Add malformed JSON, `Content-Length > 65536`, invalid count, stale digest, idempotency conflict, not-found and generic 500 assertions. Generic 500 must include a request ID and no internal stack/SQL.

- [ ] **Step 2: Run route RED**

```powershell
pnpm exec vitest run src/__tests__/api/historical-media-remediation.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts
```

Expected: missing route and manifest mismatch FAIL.

- [ ] **Step 3: Implement guarded GET and POST**

Both handlers call `getRequestUser` and reject unauthenticated `401` and non-admin `403` before importing or invoking the remediation service. GET bounds `limit` to 1-100. POST validates content length and parsed JSON, forwards `x-forwarded-for`/`x-real-ip`, maps stable service codes to 404/409, and returns a generated request ID on every response.

Add `assets/remediation/route.ts` to the exact administrator route manifest and its reviewed manual guard map.

- [ ] **Step 4: Write restore RED**

```ts
it('rejects restore when the selected version is unrecoverable', async () => {
  storage.lockPlacement.mockResolvedValue({
    id: 'placement-a', ownerId: 'owner-a', projectId: 'project-a',
    assetId: 'asset-a', assetVersionId: 'version-a', workspace: 'chat',
    workspaceId: 'chat-a', entityType: 'chat-result', entityId: 'result-a',
    status: 'trashed', deletedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  storage.findVersion.mockResolvedValue({
    id: 'version-a', assetId: 'asset-a', ownerId: 'owner-a', projectId: 'project-a',
    file: { url: '', availability: 'unrecoverable' }, parentVersionIds: [],
    createdAt: new Date().toISOString(),
  });
  await expect(service.restorePlacement(command)).rejects.toMatchObject({
    code: 'ASSET_MEDIA_UNRECOVERABLE',
  });
  expect(storage.restorePlacement).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Implement restore guard**

Add `ASSET_MEDIA_UNRECOVERABLE` to `AssetServiceErrorCode`. Inside the existing restore transaction, after placement/version ownership locks and before Asset activation, load the selected version and reject when `version.file.availability === 'unrecoverable'`. Map the code to HTTP 409 in the restore route.

- [ ] **Step 6: Run Task 5 GREEN**

```powershell
pnpm exec vitest run src/__tests__/api/historical-media-remediation.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts src/__tests__/lib/asset-service.test.ts src/__tests__/api/asset-trash-restore.test.ts
```

Expected: all route, manifest, service and restore tests PASS.

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- src/app/api/admin/assets/remediation/route.ts src/__tests__/api/historical-media-remediation.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts src/lib/asset-core/service.ts src/__tests__/lib/asset-service.test.ts 'src/app/api/assets/[assetId]/restore/route.ts' src/__tests__/api/asset-trash-restore.test.ts
git diff --cached --check
git commit -m "feat: expose audited media archive command"
```

---

### Task 6: Local Completion Gates and Documentation

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Create: `docs/testing/evidence/v588-admin-003-safe-archive-local-2026-08-21.json`

**Interfaces:**
- Consumes all Task 1-5 tests and migration.
- Produces an exact local candidate SHA and machine-readable evidence.

- [ ] **Step 1: Run focused asset/remediation regression**

```powershell
pnpm exec vitest run src/__tests__/lib/historical-media-remediation.test.ts src/__tests__/api/historical-media-remediation.test.ts src/__tests__/api/admin-route-authorization-contract.test.ts src/__tests__/lib/asset-service.test.ts src/__tests__/api/asset-trash-restore.test.ts src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

Expected: all tests PASS; PostgreSQL remediation tests report zero skips with `POSTGRES_TEST_DATABASE_URL` configured.

- [ ] **Step 2: Run affected asset/media regression**

```powershell
pnpm exec vitest run src/__tests__/api/asset-media-recovery.test.ts src/__tests__/api/asset-orphan-scan.test.ts src/__tests__/api/assets-ownership.test.ts src/__tests__/lib/asset-media-health-service.test.ts src/__tests__/lib/asset-release-readiness.test.ts src/__tests__/scripts/doctor-asset-status.test.ts tests/integration/stage-2-asset-lifecycle-postgres.test.ts tests/integration/stage-2-doctor-asset-status-postgres.test.ts tests/integration/stage-4-historical-media-remediation-postgres.test.ts
```

Expected: all selected tests PASS with no PostgreSQL skips.

- [ ] **Step 3: Run full repository gates**

```powershell
pnpm test
pnpm validate
pnpm build
pnpm check:protected-baseline
git diff --check
```

Expected:

- Vitest: zero failures and zero skips with isolated PostgreSQL enabled.
- TypeScript: exit 0.
- ESLint: zero errors.
- Build: all routes compile, including `/api/admin/assets/remediation`.
- Protected baseline: existing authorized drift is reviewed; do not weaken or silently extend the allowlist inside this feature.
- `git diff --check`: exit 0.

- [ ] **Step 4: Write evidence and reports from actual output**

Record exact command results, database version, migration checksum, test counts, candidate commit, donor lock digest and `stable` SHA. Mark cloud archive, idempotent retry and `asset-v3` acceptance as `UNVERIFIED`; do not claim them from local tests.

- [ ] **Step 5: Commit and push the local candidate only to main**

```powershell
git add -- docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/evidence/v588-admin-003-safe-archive-local-2026-08-21.json
git diff --cached --check
git commit -m "docs: record safe archive local verification"
git push origin HEAD:main
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `HEAD == origin/main`, `origin/stable == 52f7c601ed150769e15d06fb435c6e360e28c9e7`.

---

### Task 7: Exact-SHA Coze Archive Acceptance

**Files:**
- Create after execution: `docs/testing/evidence/v588-admin-003-safe-archive-cloud-2026-08-21.json`
- Create after execution: `docs/testing/evidence/v588-admin-003-safe-archive-cloud-2026-08-21.png`
- Modify after execution: the five testing/inventory reports from Task 6.

**Interfaces:**
- Consumes authenticated Google Chrome and exact deployed `main` SHA.
- Produces one immutable remediation ID and before/after readiness evidence.

- [ ] **Step 1: Deploy exact candidate without touching stable**

In the existing Coze project tab, pull exact `origin/main`, verify a clean worktree, run checksum migrations, build, restart port 5000 and prove the running commit. Keep `WUJIE_ASSET_GRAPH_MODE=shadow`.

- [ ] **Step 2: Capture the read-only baseline**

In the existing authenticated Google Chrome preview tab, call:

```text
GET /api/admin/assets/remediation?limit=20
GET /api/admin/production-readiness
```

Expected candidate baseline from current evidence: three versions and four active placements. Compare exact candidate IDs and digests with the known diagnosis; abort without POST if any identity, count or digest is unexpected.

- [ ] **Step 3: Execute one explicit archive command**

Immediately before POST, request the user's action-time confirmation that the exact three versions/four active placements shown by Step 2 will be soft-archived in the Coze database. Only after that confirmation, generate a fresh idempotency key and POST only the reviewed candidate objects returned by Step 2. Preserve request ID, remediation ID, response counts and timestamp. No other candidate may be included.

Expected: HTTP 200, `reused=false`, three versions and four placements reported from transaction-derived counts.

- [ ] **Step 4: Prove durable idempotency**

Repeat the byte-identical POST once.

Expected: HTTP 200, same remediation ID and counts, `reused=true`, no second ledger row, no second audit event and no extra project revision change.

- [ ] **Step 5: Prove post-archive consistency**

Refresh the dashboard and affected project. Verify:

- the approved broken active frames are absent;
- unrelated project images remain;
- no permanent loading state appears;
- fresh application Console Error/Warning count is `0/0`;
- readiness no longer counts the archived missing/false-ready active references;
- shadow comparison remains `6/6` with zero drift;
- no credit transaction was created;
- physical purge remains disabled.

- [ ] **Step 6: Commit cloud evidence**

Update the five reports with exact facts, save JSON/PNG evidence, commit and push docs only. Do not label Stage 4 complete yet; controlled `asset-v3` projection and recovery remain.

---

### Task 8: Controlled Asset-v3 Projection, Recovery and Rollback

**Files:**
- Create after execution: `docs/testing/evidence/v588-admin-003-asset-v3-cloud-2026-08-21.json`
- Create after execution: `docs/testing/evidence/v588-admin-003-asset-v3-cloud-2026-08-21.png`
- Modify after execution: testing reports, V5.8.8 inventory and Obsidian Stage 4/V5.8.8 pages.

**Interfaces:**
- Consumes a doctor result with `switchAuthorized=true` after Task 7.
- Produces controlled thumbnail/original/S3 evidence and restores the approved runtime mode.

- [ ] **Step 1: Require doctor authorization before mode change**

Abort if `releaseReady` or `switchAuthorized` remains false or any asset blocker exists. Do not force environment variables around the gate.

- [ ] **Step 2: Switch only the isolated Coze preview to `asset-v3`**

Rebuild/restart and verify the running mode through `/api/admin/production-readiness` and project reads.

- [ ] **Step 3: Verify thumbnail projection and original fallback**

Open a project with durable images. Prove 512/256 thumbnail preference, reload stability, unchanged transforms/layers, and original-image fallback when no ready thumbnail variant exists.

- [ ] **Step 4: Verify S3 thumbnail recovery**

Use the existing controlled recovery test path to remove only a disposable local thumbnail copy, request the same public thumbnail URL, and prove the exact nested S3 object reconstructs it. Never delete the durable S3 object.

- [ ] **Step 5: Roll back to `shadow`**

Restore the approved mode, rebuild/restart, reload the project, and prove project/image counts, revision, Canvas positions and zero fresh application Console errors/warnings remain stable.

- [ ] **Step 6: Close Stage 4 and authorize only the next inventory item**

Update reports and Obsidian with exact evidence. Mark `V588-ADMIN-003` absorbed only when all Task 8 assertions pass. Then authorize `V588-PROVIDER-001`; do not start mobile, media-gateway or collaboration work early.

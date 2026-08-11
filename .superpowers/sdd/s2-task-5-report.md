# WJ-STABLE-001 Stage 2 Task 5 Report

## 5-A: Authorized Asset API And Server-Side Transfer

### Status

IMPLEMENTED. The two focused API suites are GREEN. Live PostgreSQL coverage is
UNVERIFIED because `POSTGRES_TEST_DATABASE_URL` is not configured. Repository
`ts-check` is blocked by the pre-existing Task 5-B draft in
`src/components/node-editor.tsx` and is not claimed as passing.

### TDD Evidence

The requested test files and ignored, untracked route drafts were already present
when this task started, so the first focused run passed 8/8 and was not treated as
valid RED evidence. The authentication tests were tightened to require a real
`getSessionUser()` result even when request-level internal identity is available.

RED command:

```powershell
pnpm exec vitest run src/__tests__/api/assets-ownership.test.ts src/__tests__/api/workspace-transfer.test.ts
```

RED result: 2 files failed; 3 assertions received 200 instead of 401 for asset
resolution, transfer, and placement deletion without a session.

GREEN command:

```powershell
pnpm exec vitest run src/__tests__/api/assets-ownership.test.ts src/__tests__/api/workspace-transfer.test.ts
```

GREEN result: 2/2 files and 9/9 tests passed. Coverage includes unauthenticated
401, strict request fields with no trusted owner or client digest, uniform 404
for unreadable source versions and unwritable target projects, canonical digest
reuse, digest conflict 409, session actor injection, and compatibility `url`.

### Implementation

- Added asset reference resolution by actor-owned project/version, with optional
  active placement validation and a URL-preserving compatibility response.
- Added transfer request validation for only the brief-approved fields. The route
  computes a canonical SHA-256 digest server-side and delegates authorization,
  idempotency, and atomic transfer to Task 2 `sendVersionToWorkspace()`.
- Added placement soft-delete through Task 2 `trashPlacement()`.
- All three routes derive actor identity only from `getSessionUser()`. A request
  body/query owner and request-level internal identity cannot widen access.
- No Task 2 service/storage business logic was copied or changed.

### Verification

```powershell
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

Result: 7/7 Task 2 unit tests passed. All 8 PostgreSQL integration tests were
skipped because `POSTGRES_TEST_DATABASE_URL` is missing; live PostgreSQL remains
UNVERIFIED.

```powershell
pnpm exec eslint "src/app/api/assets/route.ts" "src/app/api/assets/transfer/route.ts" "src/app/api/assets/placements/[placementId]/route.ts" "src/__tests__/api/assets-ownership.test.ts" "src/__tests__/api/workspace-transfer.test.ts"
```

Result: passed with no findings.

```powershell
pnpm ts-check
```

Result: failed after successful Next route type generation because the excluded
Task 5-B draft has `src/components/node-editor.tsx(4860,63): TS2552 Cannot find
name 'image'`. That file was not modified to resolve this out-of-scope failure.

Historical `.superpowers/sdd/task-4-report.md` remains byte-identical with
SHA-256 `943816946B0E33AC20443C1AECE527CA70186B869B7130F72573FF7D9143D69D`.

### Self Review

- Source read and target write authorization remain inside one Task 2 service
  transaction and use the session actor for every owner/project predicate.
- Missing and foreign resources share `ASSET_NOT_FOUND`; no URL is accepted as
  ownership proof.
- Idempotency digest input excludes the key itself, recursively canonicalizes
  object keys, and includes all semantic transfer fields.
- Responses retain `url`; transfer and deletion do not physically delete or
  re-upload media.
- Components, simple-chat, Task 6+, stable, and rollout mode were not changed.

### Excluded Task 5-B Drafts

The following pre-existing, uncommitted drafts were neither modified by 5-A nor
staged for its commit:

- `src/components/canvas-workspace.tsx`
- `src/components/chat-panel.tsx`
- `src/components/node-editor.tsx`
- `src/lib/workflow-engine.ts`
- `src/__tests__/lib/workflow-engine.test.ts`
- `src/__tests__/components/canvas-chat-asset-transfer.test.ts`
- `src/__tests__/components/node-editor-asset-reference.test.ts`

### 5-A Files

- `src/app/api/assets/route.ts`
- `src/app/api/assets/transfer/route.ts`
- `src/app/api/assets/placements/[placementId]/route.ts`
- `src/__tests__/api/assets-ownership.test.ts`
- `src/__tests__/api/workspace-transfer.test.ts`
- `.superpowers/sdd/s2-task-5-report.md`

## 5-B: Canvas, Embedded Chat, And Workflow Asset Transfer

### Status

IMPLEMENTED AND COMMITTED at
`bb1c5e9051854de89c5f96e56f4a6856b6d95567`. The inherited seven-file
Task 5-B draft was retained, reviewed, corrected, and committed without touching
standalone simple-chat, Task 6+, stable, or any Task 5-A route. Nothing was pushed.

### TDD Evidence

The required initial command was run before Task 5-B production changes:

```powershell
pnpm exec vitest run src/__tests__/components/canvas-chat-asset-transfer.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/lib/workflow-engine.test.ts
```

Initial RED: 1 assertion failed and 24 passed. The inherited draft did not create
the workflow-output `canvas-image` placement. Additional RED cases then exposed
the `node-editor.tsx` `image`/`img` TS2552 typo, primary-image asset identity
misalignment, ambiguous same-URL version guessing, unsafe positional reference
fallback, and failure paths that retained stale placement identity.

Final required three-file result: 3/3 files and 27/27 tests passed.

### Implementation

- Canvas -> embedded chat transfers a managed version through
  `POST /api/assets/transfer` into a `chat-attachment` placement and preserves
  canonical `url`, `assetId`, `assetVersionId`, and `placementId` on pending
  images, mentions, and message anchors. Transfer failure uses the unchanged
  URL-only compatibility path without carrying stale asset identity.
- Canvas -> workflow creates a `workflow-input` placement and stores the
  canonical URL plus asset identity in node configuration. Upload and transfer
  failure paths remain URL-only.
- Workflow output -> canvas traces an unambiguous upstream AssetVersion, creates
  a new `canvas-image` placement for that version, and passes the reference into
  canvas insertion so `/api/save-image` is not called for transferred media.
- `getNodeInputs()` aligns asset identity with the selected primary URL.
  `resolveWorkflowOutputAssetReference()` rejects ambiguous same-URL/different-
  version ancestry instead of guessing.
- Versioned input-image requests contain project/version/placement identity but
  never the client URL; URL-only nodes retain the legacy no-request behavior.
- Fixed `node-editor.tsx` TS2552 by passing `img` to
  `onCanvasImageSelect()` and narrowed completion-effect dependencies to prevent
  duplicate output projection on unrelated workflow state updates.

### Verification

- Task 5 focused gate: 6/6 files, 38/38 tests passed.
- Task 4 regression gate: 11/11 files, 108/108 tests passed.
- Exact historical seven-file login/session command passed. Its current files
  contain 29 tests (the older gate label was 25/25).
- `pnpm ts-check`: passed after final production edits.
- Targeted ESLint over the seven committed files: exit 0, 0 errors, 62 existing
  warnings in the large component files.
- Protected baseline from Task 5-B handoff commit `2d28516` using only the seven
  Task 5 production allow paths: all 38 feature IDs present, no unapproved source
  drift, all protected paths/evidence contracts/refs present, 0 warnings.
- The historical `3f2da81` lineage invocation preserved all 38 feature IDs but
  was blocked only by pre-existing governance drift in
  `.superpowers/sdd/progress.md` and this 5-A report; the production allowlist was
  not widened to hide those files.
- Full `pnpm test`: exit 0 in 174.1 seconds. PostgreSQL-backed integration files
  skipped because `POSTGRES_TEST_DATABASE_URL` is absent.
- `pnpm build`: exit 0; compile and TypeScript passed, 114/114 static pages were
  generated.
- `git diff --cached --check`: passed before commit.
- Review diff `.superpowers/sdd/review-2d28516..bb1c5e9-task5b.diff`
  SHA-256: `8011250C2574103E373071E2D95FC49842DB2BF39C8F041FA3738393D7D89109`.
- Historical `.superpowers/sdd/task-4-report.md` remains byte-identical at
  SHA-256 `943816946B0E33AC20443C1AECE527CA70186B869B7130F72573FF7D9143D69D`.

### Concern

Live PostgreSQL remains UNVERIFIED because `POSTGRES_TEST_DATABASE_URL`,
`PGDATABASE_URL`, and `DATABASE_URL` are absent.

There is also a scoped runtime integration concern: the existing workflow
executor calls internal API endpoints with signed internal headers, while the
5-A `/api/assets` resolver intentionally accepts only `getSessionUser()` and
rejects internal identity. Closing that end-to-end authorization mismatch would
require changing `src/app/api/workflow/execute/route.ts` or weakening the 5-A
session-only contract; the former is outside the brief's protected production
paths and the latter contradicts the approved ownership tests. Neither boundary
was changed in 5-B.

### 5-B Files

- `src/components/canvas-workspace.tsx`
- `src/components/chat-panel.tsx`
- `src/components/node-editor.tsx`
- `src/lib/workflow-engine.ts`
- `src/__tests__/components/canvas-chat-asset-transfer.test.ts`
- `src/__tests__/components/node-editor-asset-reference.test.ts`
- `src/__tests__/lib/workflow-engine.test.ts`
- `.superpowers/sdd/s2-task-5-report.md` (updated after the code/test-only commit)

## Independent Review Remediation: I1-I6

### Status

IMPLEMENTED AND COMMITTED in `d9d85ea`. The six Important findings from the
independent review are closed without changing standalone simple-chat, Task 6+,
stable, or the external session-only authorization boundary of `/api/assets`.
Nothing was pushed.

### TDD Evidence

Behavior-level regression tests were added before each implementation batch.
The new tests produced 11 RED cases in total: I1 and I6 each initially failed at
suite import because the required server/client transfer helpers did not exist;
I2 produced 2 failures, I3 produced 3 failures, I4 produced 4 failures, and I5
produced 2 failures. All are now GREEN.

Extended focused command:

```powershell
pnpm exec vitest run src/__tests__/components/canvas-chat-asset-transfer.test.ts src/__tests__/components/node-editor-asset-reference.test.ts src/__tests__/lib/workflow-engine.test.ts src/__tests__/lib/workflow-asset-resolution.test.ts src/__tests__/lib/workspace-asset-transfer.test.ts src/__tests__/lib/asset-service.test.ts src/__tests__/api/assets-ownership.test.ts src/__tests__/api/workspace-transfer.test.ts
```

Result: 8/8 files and 56/56 tests passed. The brief's exact six-file Task 5
command also passed 6/6 files and 43/43 tests.

### Finding Closure

- I1: extracted `resolveWorkflowInputImageForActor()`. The external route still
  obtains only a session actor; the workflow executor resolves with the already
  authenticated `execState.userId` directly through the asset service. Managed
  input-image URLs are canonicalized server-side and client URL substitutions
  are ignored.
- I2: every formal Canvas -> embedded chat entry goes through one transfer
  helper and creates/reuses a `chat-attachment`. Pending images, mentions, and
  message anchors carry canonical references. Transfer failure preserves only
  the legacy URL and removes stale asset/placement identity.
- I3: `mergeWorkflowNodeUpdate()` atomically clears `projectId`, `assetId`,
  `assetVersionId`, and `placementId` whenever `imageUrl` changes or is cleared.
- I4: canvas drag uses a structured MIME reference; URL-only drag remains
  URL-only. Workflow output identity is resolved only from the output node or an
  explicit output-node/source-node tuple, so equal URLs cannot relink versions.
- I5: transfer idempotency takes an actor-scoped transaction advisory lock and
  checks all records for actor + key. Equal complete semantics reuse the prior
  result; any changed semantic field, including target workspace/entity, yields
  409. The Task 2 PostgreSQL schema and existing unique constraint were left
  intact as a compatibility strategy.
- I6: a known managed workflow output is inserted only after transfer succeeds
  with the same `assetVersionId` and a new `canvas-image` placement. Failure is
  reported as retryable, does not insert into the canvas, and cannot fall back
  to `/api/save-image`. URL-only outputs retain the legacy save path.

### Verification

- Task 5 extended focused: 8/8 files, 56/56 tests passed.
- Task 5 exact six-file gate: 6/6 files, 43/43 tests passed.
- Task 4 regression gate: 11/11 files, 108/108 tests passed.
- Login/session gate: 7/7 files, 25/25 tests passed.
- Asset service unit tests: 9/9 passed.
- Asset storage PostgreSQL tests: 9/9 skipped with an explicit blocker because
  `POSTGRES_TEST_DATABASE_URL` is not configured.
- `pnpm ts-check`: passed.
- Targeted ESLint over the 19 changed code/test files: exit 0, 0 errors, 62
  existing warnings in the large component files.
- Protected baseline against `2d28516`, limited to the brief-approved Task 5
  production paths: 38/38 feature IDs present, no unapproved source drift, all
  evidence/path/ref checks passed, 0 warnings.
- Full `pnpm test`: exit 0 in 177.3 seconds. PostgreSQL integration groups
  explicitly skipped where their database environment was absent.
- `pnpm build`: exit 0 in 113.9 seconds; compile, TypeScript, and 114/114 static
  page generation completed.
- `git diff --cached --check`: passed before the implementation commit.
- Review diff `.superpowers/sdd/review-bb1c5e9..d9d85ea-task5-review.diff`
  SHA-256: `CA3F6B1A7686DE8193263840CDCB86BA128647982FB486ECFA2E58ACE08910A3`.
- Historical `.superpowers/sdd/task-4-report.md` remains byte-identical at
  SHA-256 `943816946B0E33AC20443C1AECE527CA70186B869B7130F72573FF7D9143D69D`.

### Remaining Concern

Live PostgreSQL behavior remains UNVERIFIED because
`POSTGRES_TEST_DATABASE_URL` is absent. The in-memory service coverage and the
PostgreSQL contract test are GREEN/skipped respectively; no database contract
was weakened and no migration was required.

### Review Files

- `src/app/api/assets/route.ts`
- `src/app/api/workflow/execute/route.ts`
- `src/components/canvas-workspace.tsx`
- `src/components/chat-panel.tsx`
- `src/components/node-editor.tsx`
- `src/lib/asset-core/service.ts`
- `src/lib/asset-core/storage.ts`
- `src/lib/asset-core/types.ts`
- `src/lib/asset-core/workflow-resolver.ts`
- `src/lib/asset-core/workspace-transfer.ts`
- `src/lib/workflow-engine.ts`
- `src/__tests__/api/assets-ownership.test.ts`
- `src/__tests__/components/canvas-chat-asset-transfer.test.ts`
- `src/__tests__/components/node-editor-asset-reference.test.ts`
- `src/__tests__/lib/asset-service.test.ts`
- `src/__tests__/lib/workflow-asset-resolution.test.ts`
- `src/__tests__/lib/workflow-engine.test.ts`
- `src/__tests__/lib/workspace-asset-transfer.test.ts`
- `tests/integration/stage-2-asset-storage-postgres.test.ts`
- `.superpowers/sdd/s2-task-5-report.md`

## R2 Independent Review Remediation

### Status

IMPLEMENTED AND COMMITTED in `1f4d3a328c8040a8d0c022bf08be73df54ec9e12`.
R2-I1 and R2-I2 are closed without changing standalone simple-chat, Task 6+,
stable, server authorization, or database contracts. Nothing was pushed.

### TDD Evidence

R2-I1 RED:

```powershell
pnpm exec vitest run src/__tests__/lib/workspace-asset-transfer.test.ts
```

Result before implementation: 3 failed, 2 passed. The insertion result had no
structured `items`, including the new same-canonical-URL test for output A /
version A and output B / version B.

R2-I2 RED:

```powershell
pnpm exec vitest run src/__tests__/lib/workflow-input-transfer-race.test.ts
```

Result before implementation: 2/2 failed because the pending-reference builder
and generation guard did not exist. A follow-up clear-operation regression was
also observed RED at 1 failed, 2 passed before adding the shared invalidation
predicate. The deferred promises prove that manual replacement/clear and a newer
selection prevent a late older success from mutating node state.

Final focused result: 9/9 files and 60/60 tests passed.

### Implementation

- Workflow completion now emits `WorkflowCanvasInsertionItem` values containing
  `outputNodeId`, canonical `url`, and the exact transferred
  `WorkspaceAssetReference` for managed outputs. NodeEditor passes the item list
  without a URL `Set`; CanvasWorkspace reads identity directly from each item,
  never from a URL lookup. Managed outputs sharing one URL therefore create two
  canvas items with their own version and placement.
- Canvas-to-workflow selection now starts with an explicit pending URL-only
  config. It does not copy the original canvas project/asset/version/placement.
  A per-node generation guard permits only the latest request to apply success
  or failure. Manual URL replacement, empty-string/undefined clear, node delete,
  and a newer selection synchronously invalidate older requests.
- Transfer success installs the workflow-input identity and clears pending.
  Current-request failure retains the URL-only compatibility path; stale success
  and stale failure perform no write.

### Verification

- R2 behavior helpers and component contract: 3/3 files, 10/10 tests passed.
- Task 5 extended focused: 9/9 files, 60/60 tests passed.
- Task 4 regression: 11/11 files, 108/108 tests passed.
- Login/session: 7/7 files, 25/25 tests passed.
- `pnpm ts-check`: passed.
- Targeted ESLint over the six R2 code/test files: exit 0, 0 errors, 8 existing
  warnings in the large component files. The one warning introduced during R2
  was removed before the final run.
- Protected baseline from `2d28516` to the R2 implementation commit using only
  the existing Task 5 allow paths: 38/38 feature IDs present, no unapproved
  source drift, all path/evidence/ref checks passed, 0 warnings.
- Full `pnpm test`: exit 0 in 172.9 seconds. PostgreSQL-backed integration groups
  explicitly skipped because their database environment is absent.
- `pnpm build`: exit 0 in 112.3 seconds; compile, TypeScript, and 114/114 static
  page generation completed.
- `git diff --cached --check`: passed before the implementation commit.
- Review diff `.superpowers/sdd/review-3ca3157..1f4d3a3-task5-r2.diff`
  SHA-256: `D19555B479EA61F438C6A827CDDD52178E7CD7EB418B87BA4D8A4FC6E0D39085`.
- Historical `.superpowers/sdd/task-4-report.md` remains byte-identical at
  SHA-256 `943816946B0E33AC20443C1AECE527CA70186B869B7130F72573FF7D9143D69D`.

### Remaining Concern

Live PostgreSQL remains unverified because `POSTGRES_TEST_DATABASE_URL` is not
configured. R2 made no service, storage, schema, migration, route, or database
contract changes.

### R2 Files

- `src/components/canvas-workspace.tsx`
- `src/components/node-editor.tsx`
- `src/lib/asset-core/workspace-transfer.ts`
- `src/__tests__/components/node-editor-asset-reference.test.ts`
- `src/__tests__/lib/workspace-asset-transfer.test.ts`
- `src/__tests__/lib/workflow-input-transfer-race.test.ts`
- `.superpowers/sdd/s2-task-5-report.md`

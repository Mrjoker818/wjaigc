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

# WJ-STABLE-001 Stage 2 Task 6 Report

## Status

Task 6 and its R1 remediation are implemented and committed on
`codex/wj-stable-s2`. Nothing was pushed and `stable` was not modified. Task 7
projection work was not started and cloud `asset-v3` was not enabled.

## TDD Evidence

The original Task 6 RED was committed as `4934ee9` and failed in the three
brief-required files with 7 failed and 4 passed tests. The original GREEN
implementation was committed as `15a856c`; its first report was `59179fe`.

R1 tests were added before the remediation implementation:

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/components/simple-chat-canvas-bridge-behavior.test.ts src/__tests__/api/simple-chat-auth.test.ts src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

Observed R1 RED: 4 files failed and the PostgreSQL file skipped; 31 tests
failed, 16 passed, and 10 skipped. Failures were behavioral: the pure
alignment/transfer/bridge helpers and atomic service did not exist, route
validation accepted unsafe inputs, save-image trusted the request origin, and
the old transfer/Canvas behavior violated the reviewed contracts. These RED
tests were committed as `f7f0703`.

A final I1 UI-state test was then run alone and failed because
`canTransferSimpleChatMedia` did not exist. It was made GREEN with the related
implementation and is included in the focused result below.

Final Task 6 focused command included the required dashboard sync contract:

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/components/simple-chat-canvas-bridge-behavior.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/simple-chat-auth.test.ts src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts src/__tests__/lib/asset-service.test.ts
```

GREEN result: 6/6 files and 51/51 tests passed.

## R1 Implementation

- I1: failed or incomplete registration keeps an index-aligned URL-only
  placeholder and disables transfer. A bridge is written only after every
  requested transfer returns a complete managed reference. Historical URL-only
  images remain visible and are explicitly non-transferable.
- I2: `images`, `imageRefs`, and `attachments` remain equal length and bind by
  index. The transfer path no longer uses URL lookup, so equal URLs backed by
  different versions do not cross-bind.
- I3: the selected target project is sent directly to Task 5
  `/api/assets/transfer`. Same-project reuse and cross-project canonical copy
  are both accepted; the returned version is not required to equal the source
  version.
- I4: `AssetService.createVersionWithPlacement` performs project authorization,
  DB-backed idempotency locking, media resolution, version creation, and
  required placement creation in one storage transaction. Successful retries
  reuse the committed graph without saving media again; placement conflicts
  are rejected before media persistence, and insertion failures roll back the
  graph. Data URL request/checksum digests use decoded original bytes, not the
  generated persisted URL.
- I5: Canvas waits for matching `currentProject` hydration, merges into the
  existing image state, and removes localStorage only after a successful
  merge. Failed or cancelled consumption retains the bridge for retry.
- I6: managed bridge refs are re-resolved through `/api/assets` with the
  hydrated target project, version, and placement. Foreign, missing, or partial
  identities are omitted without exposing client-provided URLs. Legacy URLs
  remain unmanaged legacy imports.
- I7: data URL persistence uses `getInternalApiUrl('/api/save-image')` and
  internal request headers; hostile request origins are ignored.
- M1: registration fields are length-bounded. Media accepts controlled local
  upload paths, HTTP(S), and signature-validated base64 `data:image`; it rejects
  blob/file/javascript URLs, arbitrary relative paths, traversal, credentials,
  malformed data images, and oversized values.

`SimpleChatMessage.images`, `ChatAttachment.url`, and legacy bridge readers are
retained. Managed identity is additive through `imageRefs` and optional asset,
version, and placement fields. Existing project/task persistence continues to
serialize `imageRefs`, and workspace return remains the direct
`/?view=dashboard` path.

## Scope Justification

R1 I4 required one production file outside the original five-path brief:
`src/lib/asset-core/service.ts`. The failing unit and PostgreSQL contracts
proved that composing `createAssetVersion` and `createWorkspacePlacement` at
the route could save media twice and commit a version without its required
placement. The asset service is the existing owner of storage transactions and
DB advisory idempotency locks, so the minimal fix belongs there.

No storage interface, schema, migration, or save-image production file changed.
The existing transaction and lock contracts were sufficient; no process-local
cache was introduced or represented as cross-instance idempotency.

## Task 6 / Task 7 Boundary

There is no implementation conflict. Task 6 handles immediate standalone-chat
attachment/result registration and explicit user-initiated transfer. It does
not inspect authoritative completed task state, project late results, billing
or model lineage, `projection_pending`, or a generic task projector. Those
remain Task 7 work.

## Verification

The requested gates were run in order. TypeScript and build were serial.

- Task 6 focused plus dashboard sync: 6 files, 51/51 passed.
- Task 5 regression: 10 files, 64/64 passed. The original 62 remained green;
  two new shared-service I4 tests increased the group count.
- Task 4 regression: 11 files, 108/108 passed.
- Login/session regression: 7 files, 22/22 passed.
- Asset unit tests: 2 files, 15/15 passed.
- PostgreSQL asset integration: 3 files and 20 tests explicitly skipped because
  `POSTGRES_TEST_DATABASE_URL`, `PGDATABASE_URL`, and `DATABASE_URL` were absent.
- `pnpm ts-check`: passed, including Next route type generation.
- Targeted ESLint: exit 0, 0 errors, 48 existing large-component warnings.
- `pnpm lint`: exit 0, 0 errors, 958 repository warnings.
- Protected baseline from `e1e1dfd`: 38/38 feature IDs present, no unapproved
  source drift, all protected paths/evidence/refs passed, 0 warnings. The allow
  list was the five Task 6 paths, the justified asset service path, and this
  required report path.
- Full `pnpm test`: the first run exposed four unrelated 5-second production
  doctor timeouts caused by a residual same-worktree Next dev server on port
  5000. After stopping that server, the failed group passed 10 tests with one
  PostgreSQL skip, and the fresh full run passed with exit 0 in 176.2 seconds.
- `pnpm build`: exit 0 in 117.1 seconds; compile and TypeScript passed and
  114/114 static pages were generated.
- `git diff --check` and `git diff --cached --check`: passed before the
  implementation commit.

## Unverified

Live PostgreSQL atomic registration, concurrent cross-instance idempotency, and
rollback behavior remain UNVERIFIED because no PostgreSQL test URL is
configured. The R1 protected post-login browser workflow was not exercised in
an authenticated runtime. These are not represented as live GREEN results.

## Commits

- `4934ee9` - original Task 6 RED tests.
- `15a856c` - original Task 6 implementation.
- `59179fe` - original Task 6 report.
- `f7f0703` - R1 RED contracts for I1-I7 and M1.
- `581634e` - R1 implementation and final I1 behavior test.
- The report commit is the commit containing this file.

## Files

Production:

- `src/components/simple-chat/simple-chat-types.ts`
- `src/components/simple-chat/chat-area.tsx`
- `src/app/api/simple-chat/chat/route.ts`
- `src/components/canvas-workspace.tsx`
- `src/lib/asset-core/service.ts` (I4 justified scope extension)

Tests and report:

- `src/__tests__/components/simple-chat-asset-transfer.test.ts`
- `src/__tests__/components/simple-chat-canvas-bridge-behavior.test.ts`
- `src/__tests__/components/simple-chat-workspace-return-contract.test.ts`
- `src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts`
- `src/__tests__/api/simple-chat-auth.test.ts`
- `src/__tests__/lib/asset-service.test.ts`
- `tests/integration/stage-2-asset-storage-postgres.test.ts`
- `.superpowers/sdd/s2-task-6-report.md`

# WJ-STABLE-001 Stage 2 Task 2 Report

## Status

DONE

## TDD Evidence

### RED

Command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

Actual result: 2 files / 7 tests failed as intended. The new service module did
not exist, and the real isolated PostgreSQL assertion reported `[]` instead of
the required `idempotency_key` and `request_digest` placement columns. This
proved an additive migration was necessary without altering Task 1 migration
bytes.

Additional real PostgreSQL RED after the first implementation:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run tests/integration/stage-2-asset-storage-postgres.test.ts
```

Actual result: concurrent deletion of two placements returned zero
`assetTrashed` results. The asset-level lifecycle decision was not serialized.

### GREEN

Command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

Actual result: 2 files / 7 tests passed. The real PostgreSQL suite used the
required loopback database and verified the additive migration, 20 concurrent
transfers producing one target placement, exact key/digest reuse and conflict,
owner/project fail-closed behavior, workflow placement derivation, and
serialized trash/restore lifecycle behavior.

## Modified Files

- `migrations/20260811_wj_stable_s2_asset_transfer_idempotency.sql`
- `src/lib/asset-core/storage.ts`
- `src/lib/asset-core/service.ts`
- `src/__tests__/lib/asset-service.test.ts`
- `tests/integration/stage-2-asset-storage-postgres.test.ts`
- `.superpowers/sdd/task-2-report.md`

## Self Review

- Each mutating public service operation enters exactly one PostgreSQL
  transaction. The storage transaction rolls back on any error.
- Actor identity is only `actorUserId`; caller-supplied owner fields are ignored.
  Owner/project scoped lookups return `ASSET_NOT_FOUND` for absent and foreign
  resources. A supplied foreign `assetId` was regression-tested to avoid a
  duplicate-key IDOR signal.
- The new partial unique index implements actor + sourceVersion + targetProject
  + targetWorkspace + entityType + entityId + idempotencyKey uniqueness. Digest
  mismatch returns `ASSET_IDEMPOTENCY_CONFLICT`.
- Parent rows are inserted in request order. Placement deletion is soft-only;
  a common asset row lock serializes final-active-placement checks. Restore
  reactivates asset and placement atomically. No file deletion is implemented.
- Transfers remain within the source version's project. Cross-project
  copy-on-write is intentionally deferred to Task 3. No API, graph-mode,
  canvas, node, Agent, or other UI code changed.

## Verification

```powershell
pnpm ts-check
pnpm exec eslint src/lib/asset-core/storage.ts src/lib/asset-core/service.ts src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
git diff --check -- migrations/20260811_wj_stable_s2_asset_transfer_idempotency.sql src/lib/asset-core/storage.ts src/lib/asset-core/service.ts src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts .superpowers/sdd/task-2-report.md
```

Actual result: all commands passed. The full repository test suite and build
were intentionally not run, per Task 2 scope.

## Commit

`feat: add transactional asset graph service` (this report is included in that
commit; the final commit SHA is reported from `HEAD`).

## Concerns

- `.superpowers/sdd/progress.md` has an externally introduced, uncommitted
  stable-branch-drift note. It was not modified, staged, or committed by this
  task. Its pre-existing trailing whitespace makes an unrestricted repository
  `git diff --check` fail; the task-owned path-scoped check passed.
- The required focused unit and real PostgreSQL integration coverage passed;
  full-suite and production-build evidence is deliberately deferred to the
  controller review gate.

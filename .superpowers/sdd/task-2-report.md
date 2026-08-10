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

## Review Remediation - 2026-08-11

### RED Evidence

Command used for both RED runs:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

First RED result: 2 files failed; 11 tests failed and 2 passed out of 13.
The failures proved the missing `source_version_id` and exact index, dropped
caller metadata, rejected cross-project send, uncoordinated placement creation
versus final trash, raw restore `23505`, project-unscoped version interface, and
healthy release after rollback failure.

The first run did not deterministically cross the old create-version
check-then-insert window. An isolated-schema trigger delayed only the target
version INSERT, forcing concurrent callers past the non-locking lookup. The
second RED result was again 11 failed / 2 passed and now failed with the raw
`wujie_asset_versions_owner_project_idempotency_key_unique` `23505`, directly
proving I3.

### GREEN Evidence

The same focused command completed with 2 files passed and 13/13 tests passed:
7 unit tests and 6 real PostgreSQL integration tests. PostgreSQL coverage used
the required loopback database and asserted the physical rows, index definition,
transaction races, and public error codes.

Additional verification:

```powershell
pnpm ts-check
pnpm exec eslint src/lib/asset-core/storage.ts src/lib/asset-core/service.ts src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
git diff --check -- migrations/20260811_wj_stable_s2_cross_project_transfer.sql src/lib/asset-core/storage.ts src/lib/asset-core/service.ts src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts .superpowers/sdd/task-2-report.md
```

Actual result: all three commands passed.

### Review Findings Closed

- **C1:** `sendVersionToWorkspace` now authorizes the target project and resolves
  the actor-owned source project separately. Cross-project sends create a new
  target `Asset`, `AssetVersion`, and `WorkspacePlacement`; the source graph is
  unchanged. `source_version_id` and protected target-version provenance retain
  the source identity. Twenty concurrent sends produce one physical target graph.
- **I1:** direct placement creation, same-project send, restore, and final trash
  coordinate through the same `wujie_assets ... FOR UPDATE` lifecycle lock.
  Locked create/send versus final-trash tests assert an active placement can no
  longer commit with a trashed asset.
- **I2:** full version retrieval now requires explicit owner, project, and version
  predicates. Transfer performs a minimal actor-owned project resolution before
  the scoped read. Foreign, absent, and same-owner/wrong-project resources all
  return `ASSET_NOT_FOUND`.
- **I3:** create-version idempotency uses a transaction-scoped advisory lock on
  actor + project + key before lookup/insert. Forced concurrent same-digest calls
  reuse one row; different digests return `ASSET_IDEMPOTENCY_CONFLICT`; no `23505`
  reaches the service caller.
- **I4:** restore preflights the active entity and maps a concurrent partial-index
  `23505` to `ASSET_PLACEMENT_CONFLICT`. The transaction rollback preserves the
  losing placement and asset as trashed.
- **I5:** rollback failure releases the `pg` client with the rollback error, which
  destroys the suspect pooled connection, while rethrowing the original callback
  error. The client is released exactly once.
- **I6:** real PostgreSQL tests read and assert the ordered unique-index columns and
  predicate, query physical placement/version rows, cover concurrent different
  digests, same-user cross-project copy, create/send versus final trash, sequential
  and concurrent restore collisions, and all required stable error codes.
- **M1:** caller metadata is persisted as JSONB and merged before the internal
  `requestDigest`, so a caller-supplied `requestDigest` cannot replace the trusted
  digest. Unit and PostgreSQL assertions cover the stored value.

### Remediation Files

- `migrations/20260811_wj_stable_s2_cross_project_transfer.sql`
- `src/lib/asset-core/storage.ts`
- `src/lib/asset-core/service.ts`
- `src/__tests__/lib/asset-service.test.ts`
- `tests/integration/stage-2-asset-storage-postgres.test.ts`
- `.superpowers/sdd/task-2-report.md`

### Remediation Self-Review And Risks

- The already-applied Task 1 and first Task 2 migration bytes are unchanged. The
  new migration is additive and retains old data while backfilling prior transfer
  placements to `source_version_id = asset_version_id`.
- The exact transfer uniqueness columns are actor/owner, source version, target
  project, target workspace, entity type, entity id, and idempotency key. Workspace
  kind remains derived from entity type and is intentionally not part of the new
  index.
- Cross-project copies intentionally do not create cross-asset parent edges because
  Task 1 parent constraints require one asset. Auditable lineage is retained in the
  source-version FK plus protected version metadata.
- Source-version and version-idempotency locking serializes work for one source or
  one actor/project/key. This is conservative correctness behavior; unrelated
  sources and keys remain concurrent.
- No legacy reader, rollout mode, product UI, canvas, node editor, Agent, Task 3+
  path, Obsidian file, or `.superpowers/sdd/progress.md` was modified. Full-suite
  and production-build verification remain outside this focused Task 2 repair run.

## Review R2 Remediation - 2026-08-11

### R2 RED Evidence

Command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

The first draft RED run reported 3 failed / 11 passed out of 14. Two failures
were the intended schema RED: the exact index still had the extra
`source_version_id IS NOT NULL` predicate and the follow-up lineage migration did
not exist. The third was a test-infrastructure timeout because the lock observer
reused the connection holding the asset lock. Moving observation to an independent
PostgreSQL client made the lifecycle test deterministically observe the blocked
`wujie_assets ... FOR UPDATE` query and pass in isolation.

The corrected, stable RED run reported 2 failed / 12 passed out of 14. Only the
two intended R2-I1 failures remained: the superseded index/schema semantics were
still installed, and
`20260811_wj_stable_s2_transfer_lineage_invariants.sql` was absent.

### R2 GREEN Evidence

The same focused command passed 2 files and 14/14 tests: 7 unit tests and 7 real
PostgreSQL integration tests. This preserves all previous 13 tests and adds one
migration-upgrade test.

Additional verification:

```powershell
pnpm ts-check
pnpm exec eslint src/lib/asset-core/storage.ts src/lib/asset-core/service.ts src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
git diff --check -- migrations/20260811_wj_stable_s2_transfer_lineage_invariants.sql tests/integration/stage-2-asset-storage-postgres.test.ts .superpowers/sdd/task-2-report.md
```

Actual result: all commands passed.

### R2 Findings Closed

- **R2-I1:** the new additive migration backfills transfer-shaped rows missing
  source lineage to their existing target version and assigns a deterministic
  `legacy-transfer:<placement-id>` digest only when an old transfer digest is
  absent. A validated conditional CHECK requires every non-null idempotency key
  to have both `source_version_id` and `request_digest`, while ordinary placements
  retain nullable transfer fields. A validated composite FK now binds
  `(source_version_id, owner_id)` to `(version.id, version.owner_id)`. The old
  single-column FK and both superseded transfer indexes are removed; the only
  transfer-idempotency index is unique on the exact ordered brief scope with only
  `idempotency_key IS NOT NULL` as its predicate.
- **R2-I2:** PostgreSQL tests inspect conditional nullability behavior, CHECK and
  composite FK definitions, legacy-row backfill, old-index absence, `indisunique`,
  exact ordered index columns, and the exact predicate. The 20-call cross-project
  test independently counts target `wujie_assets`, `wujie_asset_versions`, and
  `wujie_workspace_placements` and requires each count to equal one. Lifecycle
  coverage uses a separate observer connection plus `pg_blocking_pids` and
  `pg_stat_activity` to prove create and send wait on the held asset lock before
  release, then verifies the final active-placement/active-asset invariant.

### R2 Files And Self-Review

- Added `migrations/20260811_wj_stable_s2_transfer_lineage_invariants.sql`.
- Modified `tests/integration/stage-2-asset-storage-postgres.test.ts`.
- Appended `.superpowers/sdd/task-2-report.md`.
- No previously applied migration bytes changed, and dropping the obsolete index
  deletes no business rows. Existing owner-consistent rows are validated in place.
- A pre-existing non-null lineage value pointing to another owner causes migration
  validation to fail rather than being silently rewritten. Missing legacy lineage
  and digest values are backfilled before validation.
- A synthetic legacy digest intentionally conflicts with a later request carrying
  a different digest; this is fail-closed and avoids treating unverifiable legacy
  input as an idempotent replay.
- Review reports/packages remain untracked and excluded. Stable, main, Obsidian,
  progress, product UI, Task 3+, and all previously closed service behavior are
  unchanged.

## Review R3 Evidence Hardening - 2026-08-11

### R3 Test-First Evidence

R3-I1, R3-I2, and R3-I3 were independent-review coverage gaps against production
service, storage, and migration behavior already confirmed correct. The new
assertions therefore passed on their first real PostgreSQL run; no RED result is
claimed or fabricated.

Command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

Actual result: 2 test files passed, 15/15 tests passed: 7 unit tests and 8 real
PostgreSQL integration tests. The previous 14 tests remain GREEN and the added
staged-migration test passed by observing the expected `23503` rejection for a
pre-existing cross-owner source lineage row.

Final verification:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
pnpm ts-check
pnpm exec eslint tests/integration/stage-2-asset-storage-postgres.test.ts
git diff --check -- tests/integration/stage-2-asset-storage-postgres.test.ts .superpowers/sdd/task-2-report.md
```

Actual result: all four checks passed. The final focused Vitest run completed in
8.95 seconds with 2/2 files and 15/15 tests passing.

The staged migration scenario is the controlled negative evidence: it constructs
the schema through the pre-lineage migration phase, inserts a row accepted by the
old single-column source-version FK, and proves the additive lineage migration
fails closed when its composite owner-consistent FK is validated. No production
migration was mutated for this proof.

### R3 Findings Closed

- **R3-I1:** catalog evidence now reads `pg_constraint.convalidated` and requires
  both `wujie_workspace_placements_transfer_lineage_check` and
  `wujie_workspace_placements_source_version_owner_fk` to be validated. The
  transfer index assertion still requires `indisunique`, its exact ordered seven
  columns, and absence of the superseded index; its normalized predicate must now
  equal only `idempotency_key IS NOT NULL`. A separate staged-schema test proves
  migration validation rejects pre-existing cross-owner lineage rather than only
  rejecting new writes after migration.
- **R3-I2:** the foreign-source authorization request now uses the foreign actor's
  own authorized target project while retaining another user's source version, so
  it reaches source resolution and returns `ASSET_NOT_FOUND`. A second runtime
  request adds a forged `ownerId` equal to the source owner and still returns
  `ASSET_NOT_FOUND`, proving `actorUserId` remains the sole identity authority and
  extra caller fields do not widen access.
- **R3-I3:** the asset-lock barrier now owns independent helper and observer clients
  plus a dedicated, application-named service pool. Its `try/finally` rolls back
  any open helper transaction, bounded-waits for started service promises, and
  terminates dedicated service backends if settlement stalls. It then releases
  helper and observer clients before the caller can close the service pool. Thus
  observer, commit, assertion, or service failures cannot leave a blocked promise
  ahead of isolated-schema cleanup. The successful path still requires
  `pg_stat_activity`, `wait_event_type = 'Lock'`, and `pg_blocking_pids` to identify
  create/send waiting on the held `wujie_assets ... FOR UPDATE` lock before release.

### R3 Files, Self-Review, And Risk

- Modified `tests/integration/stage-2-asset-storage-postgres.test.ts`.
- Appended `.superpowers/sdd/task-2-report.md`.
- Production service, storage, schema, and every applied migration byte are
  unchanged. All behavior closed in Task 2 and R2 remains covered and GREEN.
- Lock-helper connection, query, operation-settlement, backend-termination, client
  release, and pool-cleanup waits are bounded at five seconds. Cleanup failures are
  retained alongside the originating barrier failure with `AggregateError`.
- Review files/packages remain untracked and excluded. Stable, main, Obsidian,
  `.superpowers/sdd/progress.md`, product UI, and Task 3+ were not touched; no push
  was performed.

## Review R4 Timing-Independence Repair - 2026-08-11

### R4 Test Evidence

R4-I1 was an independent-review finding about test orchestration, not a production
service, storage, or migration defect. Replacing the fixed delay with the database
barrier passed on its first real PostgreSQL run, so no RED result is claimed or
fabricated. The historical fixed-delay evidence above records the earlier test
state; this R4 section supersedes that orchestration.

Targeted command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run tests/integration/stage-2-asset-storage-postgres.test.ts -t "serializes createAssetVersion idempotency"
```

Actual result: 1/1 selected real PostgreSQL test passed in 4.57 seconds. The test
contains no `pg_sleep` or fixed wall-clock delay for race amplification.

Focused command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-service.test.ts tests/integration/stage-2-asset-storage-postgres.test.ts
```

Actual result: 2/2 files and 15/15 tests passed in 11.12 seconds: 7 unit tests and
8 real PostgreSQL integration tests. All R3 assertions remain GREEN.

### R4-I1 Closed

- The version-insert trigger now waits on a schema-specific advisory transaction
  lock instead of calling `pg_sleep(0.15)`. An independent helper connection holds
  the matching session lock before all 20 service operations start.
- The service uses a dedicated 20-connection pool with a unique
  `application_name`. A bounded catalog poll requires all 20 sessions to expose an
  ungranted advisory lock in `pg_locks` and `wait_event_type = 'Lock'` in
  `pg_stat_activity`. It additionally requires at least one
  `INSERT INTO wujie_asset_versions` waiter whose `pg_blocking_pids` contains the
  helper PID. Only then does the test release the barrier.
- This condition deterministically places the target insert behind the barrier and
  proves every concurrent call has reached a database lock. With the reviewed
  advisory idempotency serialization, one call reaches the trigger and the others
  wait on that call's idempotency lock; after release all 20 reuse one version row.
  A check-then-insert implementation would instead let multiple calls pass the
  lookup and wait in the trigger, then expose raw `23505` conflicts after release.
- The barrier helper uses `try/finally`, bounded connection/query/observation and
  settlement waits, unconditional advisory unlock, service-backend termination if
  settlement stalls, and bounded helper/observer release. The dedicated service
  pool is closed only after the barrier has settled or aborted every started
  promise, preventing failure paths from hanging `Pool.end()`.

### R4 Scope And Verification

- Modified `tests/integration/stage-2-asset-storage-postgres.test.ts`.
- Appended `.superpowers/sdd/task-2-report.md`.
- Production service, storage, migrations, prior tests, and all R3 evidence are
  unchanged. The focused total remains 15 tests.
- `pnpm ts-check` and target ESLint passed. Task 2 path `git diff --check` is part
  of the final pre-commit gate.
- Final pre-commit verification passed all four gates. The repeated focused run
  completed in 10.51 seconds with 2/2 files and 15/15 tests passing; `pnpm
  ts-check`, target ESLint, and the Task 2 path `git diff --check` also exited 0.
- Review files/packages remain untracked and excluded. Stable, main, Obsidian,
  `.superpowers/sdd/progress.md`, product UI, and Task 3+ were not touched; no push
  was performed.

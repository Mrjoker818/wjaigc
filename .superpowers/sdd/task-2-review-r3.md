Verdict=CHANGES_REQUESTED

## Critical

None.

## Important

### R3-I1. The migration test still permits unvalidated legacy constraints and a non-exact index predicate

- File: `tests/integration/stage-2-asset-storage-postgres.test.ts:204-239`; `tests/integration/stage-2-asset-storage-postgres.test.ts:297-386`; `migrations/20260811_wj_stable_s2_transfer_lineage_invariants.sql:31-50`
- Impact: The focused PostgreSQL suite can remain GREEN if the two `VALIDATE CONSTRAINT` statements are removed, or if another partial condition such as `status = 'active'` is added to the transfer index. It therefore does not fully close R2-I2's requirement to prove validation of legacy rows and the brief's exact predicate, despite the current migration text being correct.
- Evidence: The constraint queries do not read `pg_constraint.convalidated`, and the cross-owner rejection is attempted only after the migration, when a `NOT VALID` FK already rejects new rows. No pre-existing cross-owner lineage row is migrated and required to fail. The predicate assertions use `toContain('idempotency_key IS NOT NULL')` plus one excluded substring, so additional predicates still pass. The report's exact/validated proof claim at `.superpowers/sdd/task-2-report.md:249-258` is stronger than these assertions.

### R3-I2. The required foreign-source authorization case short-circuits on target authorization

- File: `tests/integration/stage-2-asset-storage-postgres.test.ts:465-475`; `tests/integration/stage-2-asset-storage-postgres.test.ts:567-572`; `src/lib/asset-core/service.ts:250-262`
- Impact: The suite can pass even if source-version ownership filtering regresses, leaving the brief's cross-user `sourceVersion` security boundary without an effective PostgreSQL regression test. The current implementation is owner-scoped, but R2-I2's claimed authorization evidence remains incomplete.
- Evidence: The foreign-actor call changes only `actorUserId`, while retaining a target project owned by the original actor. `sendVersionToWorkspace()` rejects at the target-project check on line 251 before executing the source resolver. The target-project case is covered separately, but there is no call where the foreign actor uses the foreign actor's authorized target project with the original actor's source version. There is also no forged extra `ownerId` regression assertion from the Task 2 TDD requirement.

### R3-I3. The lifecycle lock test can deadlock its cleanup when an observed operation remains blocked

- File: `tests/integration/stage-2-asset-storage-postgres.test.ts:642-665`; `tests/integration/stage-2-asset-storage-postgres.test.ts:688-712`; `tests/helpers/postgres-test-database.ts:124-151`; `src/lib/db-client.ts:104-107`
- Impact: If lock observation throws, the helper `COMMIT` fails, or the query shape changes while the service call is still waiting on the held row lock, the test can hang instead of producing a bounded RED result and can retain checked-out pool connections.
- Evidence: Both sections start a transaction, hold the Asset row lock, and create an unawaited blocked service promise before the observer/commit sequence, without a `finally` that releases the helper transaction and settles the promise. On callback failure, isolation cleanup calls `closePool()` before rolling back the helper client. `Pool.end()` waits for the checked-out service client, while that client waits for the helper lock that is released only by the later rollback step, forming a cleanup wait cycle. The success path does use an independent observer and genuinely verifies PostgreSQL blocking rather than a timer; this finding concerns failure cleanup.

## Minor

None.

## Previous Findings Closure

1. **R2-I1 - CLOSED in implementation.** `migrations/20260811_wj_stable_s2_transfer_lineage_invariants.sql:1-35` backfills missing transfer lineage and digest before adding and validating the conditional CHECK and owner-consistent composite FK. Lines 37-50 remove both superseded indexes and create the sole exact ordered unique index with only `idempotency_key IS NOT NULL`. Ordinary placements remain nullable, while bad pre-existing non-null cross-owner lineage makes FK validation fail closed.
2. **R2-I2 - PARTIALLY CLOSED.** The R3 test now checks `indisunique`, ordered columns, old-index absence, ordinary-placement compatibility, legacy backfill, physical target Asset/Version/Placement counts, and real `pg_blocking_pids` evidence. R3-I1 through R3-I3 leave schema-proof, source-authorization, and failure-cleanup gaps.
3. **C1, I1-I5, and M1 - REMAIN CLOSED.** The R3 implementation commit changes no service or storage code. Static inspection still confirms authorized cross-project copy, shared Asset lifecycle locking, owner/project-scoped reads, version idempotency serialization, stable restore conflicts, poisoned-client destruction on rollback failure, and trusted-digest metadata precedence.
4. **I6 - PARTIALLY CLOSED with R2-I2.** The former join-only physical count and timer-only lock false positives are fixed. The remaining false-positive paths are recorded in R3-I1 and R3-I2.

## Spec Compliance

- The migration's implementation order is correct: missing lineage and digest are backfilled first; the old single-column FK is dropped and immediately replaced by the owner-consistent FK before validation; old indexes are dropped before the exact replacement is created. Migration-runner transactions make both replacements atomic.
- The conditional CHECK leaves non-transfer placements unaffected. Existing missing transfer fields are deterministically backfilled; unrecoverable cross-owner lineage and exact-scope duplicates fail migration validation/index creation rather than being silently accepted.
- The exact implemented uniqueness scope is owner/actor + source version + target project + target workspace + entity type + entity ID + idempotency key. `workspace_kind` and target `asset_version_id` are absent, and the predicate is exactly `idempotency_key IS NOT NULL`.
- Static service inspection confirms 20 same-scope sends serialize on the source Asset and create one target graph; the test independently counts one target Asset, Version, and Placement. Same/different digest conflict behavior and same-user cross-project authorization remain implemented.
- Lifecycle coverage now observes a real PostgreSQL waiter via `pg_stat_activity` and `pg_blocking_pids`; it is not timer evidence. R3-I3 prevents treating the test harness as robust on failure.

## Code Quality

- The R3 migration is narrowly scoped and readable. It does not rewrite unverifiable non-null lineage, and its validations make corrupted ownership fail closed.
- SQL remains parameterized, transaction ownership remains centralized, parent ordering remains explicit, and service error codes remain stable.
- Test diagnostics are materially stronger than R2, but exact catalog-state assertions and failure-safe lock orchestration need the corrections in R3-I1 through R3-I3.

## Global Constraints Audit

- `ffe810939a446bbf7288d177b95040b36a05484c` is an ancestor of `c3861af16e56f061c4d97e7e43e8d896b2d552fc`, and the active branch is `codex/wj-stable-s2` in the requested worktree.
- The R3 package blob hashes match the eight reviewed HEAD files. The three Task 2 commits touch only the Task 2 report, three additive migrations, storage/service modules, and focused tests. The interleaved controller commit `f4eba3f` is not part of the package.
- Diff checks confirm the Task 1 migrations and the first two already-applied Task 2 migration files are byte-unchanged after their respective commits. R3 adds a new migration instead of editing migration history.
- No Task 3+ reader/migration, legacy reader, product UI, canvas, node editor, Agent, protected entry, URL ownership rule, physical deletion behavior, or rollout configuration is changed. `resolveAssetGraphMode()` still defaults to `legacy`.
- No local or remote `stable` ref is available, so the external permanent-read-only SHA remains UNVERIFIED. The reviewed commits contain no stable-targeted operation.

## Verification Boundaries

- This was a static third-round review of the brief, report, both prior reviews, the complete R3 package, Global Constraints, Task 1 schema/types, current migrations, implementation, and test source.
- Per instruction, the implementer's focused 14-test PostgreSQL command, full suite, build, lint, and typecheck were not rerun. Their reported GREEN results are supplied evidence, not fresh reviewer execution.
- Static verification included package-to-HEAD blob matching, baseline ancestry, per-commit changed-file scope, applied-migration drift checks, and a path-scoped `git diff --check`; those checks completed cleanly.
- No implementation, migration, test, legacy/UI/stable file, or controller progress file was modified by this review. Only this requested review report was added.

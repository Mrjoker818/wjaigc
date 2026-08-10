Verdict=CHANGES_REQUESTED

## Critical

None.

## Important

### R4-I1. The focused concurrency suite still uses a fixed database sleep

- File: `tests/integration/stage-2-asset-storage-postgres.test.ts:596-611`; `.superpowers/sdd/task-2-report.md:119-124`
- Impact: The requested 15-test gate cannot be confirmed as free of fixed sleeps or wall-clock timing dependencies. The create-version concurrency proof still widens the race with an arbitrary 150 ms delay, so the Task 2 evidence remains coupled to elapsed time rather than a condition-based PostgreSQL barrier.
- Evidence: The test installs `delay_concurrent_version_insert` and executes `PERFORM pg_sleep(0.15)` for the tested idempotency key before launching the 20 calls. The report explicitly says this delay is used to force callers across the old check-then-insert window. This is distinct from the 10 ms polling interval at `tests/integration/stage-2-asset-storage-postgres.test.ts:160-203`, which repeatedly checks a bounded catalog condition and is not itself the assertion. Replace the trigger sleep with an observable/releasable database barrier before treating the focused suite as timing-independent.

## Minor

None.

## Previous Findings Closure

1. **R3-I1 - CLOSED.** `tests/integration/stage-2-asset-storage-postgres.test.ts:318-360` still requires a unique index with the exact ordered seven columns and a normalized predicate exactly equal to `idempotency_key IS NOT NULL`. Lines 427-474 explicitly require `convalidated: true` for both the lineage CHECK and composite owner FK. Lines 525-583 build a pre-lineage schema, insert a pre-existing cross-owner source lineage row, and require the additive migration to fail with `23503`.
2. **R3-I2 - CLOSED.** `tests/integration/stage-2-asset-storage-postgres.test.ts:661-780` gives the foreign actor its own authorized target project while retaining another actor's source version. Target authorization therefore succeeds before `src/lib/asset-core/service.ts:252-262` performs actor-scoped source resolution and returns `ASSET_NOT_FOUND`. The forged `ownerId` case at lines 769-776 reaches the same result and does not widen authority.
3. **R3-I3 - CLOSED.** `tests/integration/stage-2-asset-storage-postgres.test.ts:146-310` bounds connection, commit, rollback, operation settlement, backend termination, and client release. Its `finally` rolls back an open helper transaction, settles started service promises, terminates dedicated service backends if settlement stalls, and ends helper/observer clients before the caller's bounded `Pool.end()` at lines 831-935. Observer, commit, assertion, and service-operation failures therefore do not retain the original lock-cleanup cycle identified in R3.
4. **C1 and I1-I5 - REMAIN CLOSED.** `src/lib/asset-core/service.ts:209-423` and `src/lib/asset-core/storage.ts:220-518` are byte-unchanged since R3. Static inspection still confirms authorized cross-project copy, common Asset lifecycle locking, owner/project-scoped resource reads, advisory serialization of version idempotency, stable restore-conflict mapping, and destruction of a client whose rollback fails.
5. **I6 - NO COVERAGE REGRESSION, BUT R4-I1 BLOCKS THE STRONGER TEST-QUALITY GATE.** The exact index/lineage, physical target Asset/Version/Placement counts, different-digest race, lifecycle lock observation, and restore-collision assertions remain present at `tests/integration/stage-2-asset-storage-postgres.test.ts:314-583,586-1030`. No prior assertion was removed, but the fixed sleep prevents confirming the newly explicit timing-independence criterion.
6. **M1 - REMAINS CLOSED.** Trusted digest precedence is still implemented at `src/lib/asset-core/storage.ts:306-325` and asserted in both `src/__tests__/lib/asset-service.test.ts:326-345` and `tests/integration/stage-2-asset-storage-postgres.test.ts:586-634`.

## Spec Compliance

- The production migration remains additive and fail-closed: it backfills missing transfer lineage/digest, validates the conditional lineage CHECK and owner-consistent composite FK, drops both superseded indexes, and creates only the exact transfer index at `migrations/20260811_wj_stable_s2_transfer_lineage_invariants.sql:1-50`.
- Same-user cross-project send remains transactional and preserves source identity while creating one target Asset, Version, and Placement. The source graph is unchanged, and physical target-table counts are independently asserted at `tests/integration/stage-2-asset-storage-postgres.test.ts:661-761`.
- Owner/project authorization, source authorization, forged-owner rejection, stable parent order, soft placement deletion, final-placement Asset trash, create/send versus trash serialization, restore rollback, and metadata precedence remain implemented and covered.
- The exact transfer uniqueness scope remains actor/owner + source version + target project + target workspace + entity type + entity ID + idempotency key. `workspace_kind` and target version are absent from the replacement index.
- Task 2 production behavior meets the reviewed lineage, index, physical-row, cross-project, concurrency, metadata, and rollback specifications. R4-I1 is the remaining focused-test quality deviation.

## Code Quality

- Production SQL remains parameterized, transaction ownership is centralized, parent ordering is explicit, and public error codes remain stable.
- The R4 lifecycle helper is materially safer than R3: it uses a dedicated application-named pool, catalog-observed blocking, `finally` cleanup, bounded waits, and aggregated cleanup errors.
- R4-I1 is localized to test orchestration; no production service, storage, or migration defect was found in this round.

## Global Constraints Audit

- `ffe810939a446bbf7288d177b95040b36a05484c` remains an ancestor of HEAD, and the active branch is `codex/wj-stable-s2` in the requested worktree.
- `c3861af..0d7ee9e` changes only `.superpowers/sdd/task-2-report.md` and `tests/integration/stage-2-asset-storage-postgres.test.ts`. Applied migrations, production service/storage, Task 1 schema/types, Task 3+, legacy readers, UI, canvas, node editor, Agent, rollout mode, and protected product/workspace surfaces are unchanged.
- The eight R4 package diff headers contain the current HEAD blob prefixes for the report, three Task 2 migrations, unit test, service, storage, and PostgreSQL test. The package therefore matches the reviewed task files.
- `resolveAssetGraphMode()` still defaults absent or unknown input to `legacy` at `src/lib/asset-core/mode.ts:3-5`. URLs remain data fields and are not used as ownership proof. No physical file deletion is introduced.
- No exact local or remote `stable` ref is available, so the externally documented read-only stable SHA remains UNVERIFIED. The reviewed R4 commit contains no stable-targeted operation.

## Verification Boundaries

- This was a static fourth-round review of the Task 2 brief/report, all three prior reviews, the R4 package, Stage 2 Global Constraints, Task 1 schema/types, current migrations, implementation, and both focused test files.
- Per instruction, the implementer's focused 15-test command, typecheck, lint, full suite, and build were not rerun. The reported 15/15 PostgreSQL result is supplied evidence, not fresh reviewer execution.
- Static verification covered baseline ancestry, exact R4 changed-file scope, Task 1 and R3 production-file immutability, package-to-HEAD blob prefixes, 15 declared focused tests, targeted sleep/timer search, exact stable-ref availability, and path-scoped `git diff --check`.
- This review modified no implementation, migration, Task 3+, legacy, UI, rollout, stable, or test file. Only this requested review report was added.

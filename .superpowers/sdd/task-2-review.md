Verdict=CHANGES_REQUESTED

## Critical

### C1. Same-user cross-project transfer is rejected instead of implemented

- File: `src/lib/asset-core/service.ts:236-238`; `migrations/20260811_wj_stable_s2_asset_transfer_idempotency.sql:5-14`
- Impact: An authenticated actor who owns both projects cannot send a source version to the requested target project. `targetProjectId` is reduced to a same-project assertion, so the Task 2 transfer contract and its sourceVersion + targetProject idempotency scope are not implemented. Task 3 covers legacy-project read/copy-on-write migration, not transfer between two already-authorized asset-graph projects.
- Evidence: After authorizing the target project, `sendVersionToWorkspace()` rejects whenever `version.projectId !== input.targetProjectId`. The schema requires placements and versions to share a project, but the additive migration records only `asset_version_id`; it has no separate `source_version_id` with which to preserve the specified idempotency identity if a target-project asset/version is created copy-on-write. The report's claim at `.superpowers/sdd/task-2-report.md:72-74` therefore defers behavior that the Task 2 brief assigns to `sendVersionToWorkspace()`.

## Important

### I1. Last-placement trash can race with placement creation

- File: `src/lib/asset-core/service.ts:202-219`; `src/lib/asset-core/service.ts:280-293`; `src/lib/asset-core/storage.ts:343-358`
- Impact: The database can commit an active placement whose Asset is `trashed`, violating the binding invariant that an Asset is trashed only after its final active placement disappears.
- Evidence: `trashPlacement()` locks the Asset row before trashing/counting, but `createWorkspacePlacement()` and `sendVersionToWorkspace()` insert placements without taking that Asset lock or checking/activating Asset status. A concurrent insert may therefore commit after the trash transaction counted zero and trashed the Asset. The active-placement unique index does not coordinate Asset lifecycle state.

### I2. Version lookups do not enforce the required owner-and-project storage predicate

- File: `src/lib/asset-core/storage.ts:31`; `src/lib/asset-core/storage.ts:243-249`; `src/lib/asset-core/service.ts:170-174`; `src/lib/asset-core/service.ts:236-238`
- Impact: The repository fetches same-owner rows from other projects and relies on callers to reject them afterward. That violates the brief's fail-closed storage boundary and makes future direct repository use vulnerable to project-scope mistakes.
- Evidence: `findVersion()` accepts only `ownerId` and `versionId`, and its SQL has `v.owner_id = $2` but no `project_id` predicate. Both parent validation and transfer load the row first and perform project checks in service code, despite the explicit requirement that resource queries include both owner and project.

### I3. Concurrent createAssetVersion idempotency is a check-then-insert race

- File: `src/lib/asset-core/service.ts:139-149`; `src/lib/asset-core/service.ts:176-187`; `src/lib/asset-core/storage.ts:271-287`
- Impact: Concurrent same-key/same-digest calls can produce one success and raw PostgreSQL `23505` failures instead of returning the same version with `reused: true`; different digests are likewise not reliably translated to `ASSET_IDEMPOTENCY_CONFLICT`.
- Evidence: The service performs a non-locking lookup followed by a plain INSERT into the Task 1 unique index. Unlike transfer insertion, it has no `ON CONFLICT` recovery/readback path and no unique-violation translation. The mock unit tests execute calls sequentially and cannot expose this PostgreSQL race.

### I4. Restore collisions leak a raw unique-index error

- File: `src/lib/asset-core/service.ts:303-311`; `src/lib/asset-core/storage.ts:439-446`; `migrations/20260810_wj_stable_s2_assets.sql:143-145`
- Impact: Restoring a trashed placement when another active placement occupies the same workspace entity, including two concurrent restores of conflicting placements, fails with an implementation-specific PostgreSQL error rather than the service's stable `ASSET_PLACEMENT_CONFLICT` result.
- Evidence: `restorePlacement()` activates the Asset and issues an unconditional status update. The partial active-entity unique index can reject that update, but there is no preflight under an appropriate lock and no `23505` mapping. Transaction rollback preserves consistency, but the public mutation does not provide reliable conflict semantics.

### I5. Rollback failure returns a potentially poisoned connection to the pool

- File: `src/lib/asset-core/storage.ts:453-465`
- Impact: If `ROLLBACK` itself fails, the connection is released as healthy and may be reused in an unknown or aborted transaction state. The original error is rethrown while the rollback failure is silently lost, so the promised reliable rollback/release boundary is incomplete.
- Evidence: The catch block suppresses every rollback error with `.catch(() => undefined)`, and `finally` always calls `client.release()` without an error/destroy signal.

### I6. Real PostgreSQL coverage does not prove the exact transfer or lifecycle requirements

- File: `tests/integration/stage-2-asset-storage-postgres.test.ts:78-93`; `tests/integration/stage-2-asset-storage-postgres.test.ts:137-168`; `tests/integration/stage-2-asset-storage-postgres.test.ts:170-190`
- Impact: The GREEN evidence cannot support the report's claims about the exact DB uniqueness scope, one physical target row, same-user cross-project behavior, or all relevant trash/restore races.
- Evidence: The migration assertion checks only that two columns exist, not the index columns/predicate. The 20 calls target the same active entity, so the pre-existing `wujie_workspace_placements_active_entity_unique` index alone can force one ID; the test never queries PostgreSQL for the physical row count and does not race different digests. It also omits same-user/different-project transfer, create/send versus final trash, and restores colliding on the active unique index. The delete/restore assertion only checks that promises fulfill and that a later restore is active.

## Minor

### M1. createAssetVersion silently drops caller metadata

- File: `src/lib/asset-core/service.ts:30-40`; `src/lib/asset-core/storage.ts:271-286`
- Impact: A documented input field is accepted but not persisted, causing silent provenance loss.
- Evidence: `CreateAssetVersionInput` exposes `metadata`, while `insertVersion()` writes the metadata column as only `{ requestDigest }` and never merges `input.metadata`.

## Spec Compliance

- Public service mutations each enter one storage transaction, and normal callback/query failures execute rollback before release.
- Owner/project predicates are present for projects, assets, and placements, and the reviewed foreign-user/forged-asset paths converge on `ASSET_NOT_FOUND`; C1 and I2 remain blocking deviations.
- Parent order is preserved by ordered inserts and `array_agg(... ORDER BY parent_order)`.
- Shared-placement and final-active-placement behavior is correct for the serial cases covered, but I1 leaves the invariant unsafe under concurrent placement creation.
- Transfer same-key/same-digest and different-digest behavior is correctly recovered for the same-project path, but cross-project semantics and exact DB proof are incomplete.
- The migration is additive, the Task 1 migration is unchanged in `56294da..7ee6f76`, and existing rows remain compatible through nullable new columns. Its source identity is insufficient for C1.

## Code Quality

- SQL is parameterized, row mapping is explicit, parent ordering is readable, and transaction ownership is centralized.
- Conflict handling is inconsistent across placement insert, transfer insert, version insert, and restore; I3-I5 expose raw database behavior or unsafe pool recovery.
- The storage interface permits project-unscoped version lookup, weakening the intended authorization invariant.

## Global Constraints Audit

- The exact review range changes only the Task 2 report, one additive migration, storage/service modules, and focused tests. It does not touch product UI, canvas, node editor, Agent, Task 3+ readers/migration, rollout mode, or legacy defaults.
- No physical-file deletion is introduced. URLs remain file fields and are not used as ownership proof.
- `WUJIE_ASSET_GRAPH_MODE` and protected product surfaces are unchanged in the supplied range.
- The supplied range does not modify the stable branch. The later worktree commit touching `.superpowers/sdd/progress.md` is outside `56294da..7ee6f76` and was not included in this implementation review.

## Verification Boundaries

- Review was static against `.superpowers/sdd/task-2-brief.md`, the Global Constraints, Task 1 types/schema, `.superpowers/sdd/task-2-report.md`, and the complete `56294da..7ee6f76` review package.
- Per instruction, the implementer's focused PostgreSQL suite, full suite, build, lint, and typecheck were not rerun. The report's real-PostgreSQL run is accepted only as evidence for the scenarios its test code actually asserts; I6 remains unverified.
- No implementation file, migration, test, stable branch, or product UI was modified by this review.

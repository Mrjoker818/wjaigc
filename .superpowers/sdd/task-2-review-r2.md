Verdict=CHANGES_REQUESTED

## Critical

None.

## Important

### R2-I1. The database still does not enforce mandatory, owner-consistent source lineage or only the exact transfer uniqueness scope

- File: `migrations/20260811_wj_stable_s2_cross_project_transfer.sql:1-26`; `migrations/20260811_wj_stable_s2_asset_transfer_idempotency.sql:5-16`
- Impact: A transfer-shaped row can have `source_version_id = NULL` and fall outside the new exact unique index, so the database can accept duplicate idempotency scopes without auditable source lineage. The FK also proves only that the source version ID exists, not that it belongs to the placement owner. In addition, the superseded unique index remains active with `asset_version_id` and `workspace_kind`, leaving an extra uniqueness rule outside the brief's exact actor + sourceVersion + targetProject + targetWorkspace + entityType + entityId + idempotencyKey contract.
- Evidence: The new column is added without `NOT NULL`; the backfill covers only rows whose `idempotency_key` is non-null; there is no later `SET NOT NULL` or conditional CHECK; and the new index explicitly excludes null source IDs. The FK is only `(source_version_id) REFERENCES wujie_asset_versions(id)`. The earlier `wujie_workspace_placements_transfer_idempotency_unique` index is neither dropped nor replaced and still keys on `asset_version_id` plus `workspace_kind`.

### R2-I2. The 13-test suite can pass without proving the claimed PostgreSQL graph and migration invariants

- File: `tests/integration/stage-2-asset-storage-postgres.test.ts:128-170`; `tests/integration/stage-2-asset-storage-postgres.test.ts:274-333`; `tests/integration/stage-2-asset-storage-postgres.test.ts:410-487`
- Impact: The supplied GREEN result does not prove one physical target Asset, one AssetVersion, and one Placement, nor does it prove the source FK, mandatory lineage, old-data backfill, exact uniqueness without an extra index, or deterministic lifecycle locking. This leaves previous finding I6 open and permits false-positive PostgreSQL evidence at the Task 2 gate.
- Evidence: The migration test checks three column names and one named index's ordered columns/predicate substrings, but does not check `attnotnull`, FK ownership/scope, `indisunique`, absence of the old index, or pre-existing-row backfill. The 20-call query counts rows only after joining from the winning placement; orphan target assets/versions created by losing calls would not appear, and separate target-table counts are absent. The lifecycle test infers lock waiting from a 75 ms timer; on a slow run that flag can be true without the create/send path taking the lock, while the final invariant can still pass when create/send happens before final trash.

## Minor

None.

## Previous Findings Closure

1. **C1 - CLOSED in implementation.** `src/lib/asset-core/service.ts:251-357` authorizes the target project, resolves an actor-owned source project, copies cross-project transfers into a new target Asset/Version/Placement, leaves the source rows unwritten, and records `source_version_id`. The strength of the physical-row proof remains limited by R2-I2.
2. **I1 - CLOSED in implementation.** `src/lib/asset-core/service.ts:217-240,263-343,370-380,393-415` coordinates lifecycle-mutating create, same-project send, trash, and restore paths with the Asset row lock; cross-project creation uses a transaction-private new target Asset. Static inspection found no active-placement + trashed-asset commit path in these operations. R2-I2 records the remaining test-proof weakness.
3. **I2 - CLOSED.** `src/lib/asset-core/storage.ts:255-275` uses an owner-scoped minimal project resolution followed by an owner + project + version lookup. Assets and placements likewise use owner + project predicates, and absent/foreign cases converge on `ASSET_NOT_FOUND` in `src/lib/asset-core/service.ts:143-165,251-268,368-370,391-398`.
4. **I3 - CLOSED.** `src/lib/asset-core/service.ts:142-160` acquires the transaction-scoped version-idempotency lock before lookup/insert; `src/lib/asset-core/storage.ts:277-304` implements the advisory lock and digest readback. Same-key callers are serialized and different digests map to `ASSET_IDEMPOTENCY_CONFLICT`.
5. **I4 - CLOSED.** `src/lib/asset-core/service.ts:389-423` preflights the active entity under lifecycle locks and maps the active-placement unique constraint's `23505` to `ASSET_PLACEMENT_CONFLICT`; rollback preserves the losing asset and placement state.
6. **I5 - CLOSED.** `src/lib/asset-core/storage.ts:497-518` calls `client.release(rollbackError)` on rollback failure, marks the client released, rethrows the original operation error, and avoids the normal release path. `src/__tests__/lib/asset-service.test.ts:422-443` asserts one error-bearing release.
7. **I6 - OPEN.** R2-I2 identifies remaining false-positive paths and unproved real-PostgreSQL assertions.
8. **M1 - CLOSED.** `src/lib/asset-core/storage.ts:306-325` persists caller metadata and writes trusted `requestDigest` last. Unit and PostgreSQL assertions at `src/__tests__/lib/asset-service.test.ts:326-345` and `tests/integration/stage-2-asset-storage-postgres.test.ts:199-221` verify that caller spoofing cannot replace it.

## Spec Compliance

- Cross-project same-user copy is implemented without updating source graph rows. The target Asset/Version/Placement and placement-level `source_version_id` are created transactionally; same/different digest behavior is serialized by the source Asset lock.
- Owner/project resource lookups are parameterized and fail closed. The owner-only version-to-project resolver returns only a project ID to an internal scoped read and does not expose a foreign-user version.
- Parent order is preserved by ordered inserts and `array_agg(... ORDER BY parent_order)`.
- Placement lifecycle mutations are soft-only; no physical media deletion exists.
- Exact transfer uniqueness and mandatory auditable lineage are not database-enforced because of R2-I1.
- The second migration performs its limited backfill before adding the FK and index, but it neither makes lineage non-null nor validates owner consistency; R2-I2 also shows that old-data migration behavior is untested.

## Code Quality

- SQL values are parameterized, row mapping is explicit, transaction ownership is centralized, and stable service error codes are used at the reviewed boundaries.
- Advisory and row-lock choices are conservative but readable. Rollback failure handling destroys the suspect pooled connection without a normal second release.
- Broad `ON CONFLICT DO NOTHING` handling depends on the schema containing only intended uniqueness rules; retaining the old transfer index makes that dependency unsafe and harder to audit.

## Global Constraints Audit

- `ffe810939a446bbf7288d177b95040b36a05484c` is an ancestor of HEAD, and the checked-out branch is `codex/wj-stable-s2` at `80c59ddd16ae557c2d6b23d3e45ac16c295faa8b`.
- Task commits `7ee6f76` and `80c59dd` touch only the Task 2 report, two additive migrations, storage/service modules, and focused tests. They do not modify Task 3+ readers/migration, product UI, canvas, node editor, Agent, protected surfaces, or rollout mode.
- `WUJIE_ASSET_GRAPH_MODE` behavior and the default `legacy` mode are unchanged. URLs are data fields, not ownership evidence. No physical file deletion was introduced.
- Commit `f4eba3f` changes controller progress documentation between the two task commits and is excluded from the supplied Task 2 review package; it was not treated as Task 2 implementation.
- No local or remote `stable` ref is present, so the documented read-only stable SHA remains externally UNVERIFIED. The reviewed task commits contain no stable-targeted branch operation or product-surface change.

## Verification Boundaries

- This was a static second review of the brief, report, previous review, R2 package, Global Constraints, Task 1 types/schema, current implementation, migrations, and test source.
- Per instruction, the implementer's focused 13-test PostgreSQL command, full suite, build, lint, and typecheck were not rerun. RED/GREEN counts in `task-2-report.md` are supplied evidence, not fresh reviewer execution.
- Static checks confirmed baseline ancestry, task-commit changed-file scope, and clean `git diff --check` output for both task commits.
- No implementation, migration, test, legacy reader, UI, rollout configuration, or stable branch file was modified by this review; only this requested review report was added.

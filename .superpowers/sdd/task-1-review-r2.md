# WJ-STABLE-001 Stage 2 Task 1 Independent Review R2

Verdict=APPROVED

Scope reviewed: the Task 1 brief and report, previous review, R2 review package,
`dd20b84..HEAD`, the Stage 2 Global Constraints, current implementation and test
source, baseline ancestry, changed-file scope, and static diff integrity. The
implementer's full/focused test commands were not rerun.

## Critical

None.

## Important

None.

## Minor

None.

## Previous Findings Closure

1. **I1 - CLOSED.** `scripts/run-migrations.mjs:19-42` applies the same
   `sslmode=require` to `uselibpqcompat=true` normalization and the same
   Supabase/Aidap SSL option convention as `src/lib/db-client.ts:10-24,36-45`.
   `src/__tests__/scripts/run-migrations.test.ts:4-14` directly asserts the
   generated client connection string. Impact: the migration runner now matches
   the established PostgreSQL connection semantics rather than using a divergent
   raw URL.

2. **I2 - CLOSED.** `scripts/run-migrations.mjs:73-105` begins a transaction,
   acquires a transaction-scoped PostgreSQL advisory lock before the ledger is
   created/read, and commits the migration plus its SHA-256 ledger record as one
   unit. `tests/integration/stage-2-asset-schema-postgres.test.ts:172-186`
   starts two real runner child processes against one isolated PostgreSQL schema,
   requires both to exit zero, and verifies exactly one ledger row. Impact: the
   former check-then-apply race is serialized and reruns remain idempotent.

3. **I3 - CLOSED.** `src/lib/asset-core/types.ts:28-35,74-121` models a
   discriminated workspace/entity pairing and rejects invalid runtime pairs.
   `migrations/20260810_wj_stable_s2_workspace_entity_pairs.sql:1-7` adds the
   matching additive database CHECK (with `NOT VALID`, retaining pre-existing
   data while enforcing new writes). The real PostgreSQL assertion at
   `tests/integration/stage-2-asset-schema-postgres.test.ts:138-147` proves a
   `canvas`/`chat-result` row is rejected. Impact: invalid persisted placements
   cannot contradict the TypeScript contract.

4. **M1 - CLOSED.** `scripts/run-migrations.mjs:81-103` calculates SHA-256 from
   each exact migration file buffer, records it, and refuses a different recorded
   digest. `tests/integration/stage-2-asset-schema-postgres.test.ts:75-81`
   compares the persisted digest to an independently calculated byte digest;
   `:189-213` tampers with it and verifies a nonzero runner exit containing the
   mismatch error. Impact: migration history is auditable and alteration is a
   hard failure, not an unnoticed replay.

## Global Constraints Audit

- **PASS (static):** `ffe810939a446bbf7288d177b95040b36a05484c` is an ancestor
  of HEAD and the active branch is `codex/wj-stable-s2`. `dd20b84..HEAD` changes
  only the Task 1 schema/contracts/runner/tests/report surface.
- **PASS (static):** the diff is additive: two new SQL migrations add tables,
  indexes, and a `NOT VALID` placement-pair constraint; it contains no deletes,
  rewrites of the initial migration, or legacy reader/product-surface changes.
- **PASS (static):** `src/lib/asset-core/mode.ts:3-6` defaults absent and unknown
  values to `legacy`; there is no Task 2+ projector, API, reader, canvas, chat,
  workflow, or Agent implementation in the range.
- **PASS (static):** the seven requested asset-domain tables, owner/project
  foreign-key scopes, status checks, task/version and placement/workspace indexes,
  and scoped idempotency unique index are present in
  `migrations/20260810_wj_stable_s2_assets.sql:1-157`.
- **UNVERIFIED (external):** no local or remote `stable` ref at the documented
  SHA is available in this worktree, so the permanent-read-only remote branch
  condition cannot be independently proven here. The reviewed range has no
  branch-operation artifact or stable-targeted change.
- **NOT YET APPLICABLE:** the Global Constraints governing authorized write APIs,
  copy-on-write readers, task projection, deletion/GC, cloud shadow comparison,
  and three-browser evidence belong to later tasks and are not implemented by
  this Task 1-only range.

## Verification Boundaries

- Static review found no new Critical, Important, or Minor finding. `git diff
  --check dd20b84..HEAD` completed without whitespace errors; baseline ancestry
  and the changed-file list were inspected.
- The reviewed tests exercise real runner processes and real PostgreSQL when
  `POSTGRES_TEST_DATABASE_URL` is configured; they do not mock the migration
  behavior under review. This reviewer did not rerun them, per instruction, and
  therefore treats the report's 3 files / 8 tests GREEN result as supplied
  evidence rather than fresh execution evidence.
- The missing `@vitest/coverage-v8` plugin is not a Task 1 blocker: the brief
  requires the focused Vitest/PostgreSQL suite and idempotent rerun, not a
  coverage threshold or coverage-provider installation.

# WJ-STABLE-001 Stage 2 Task 1 Report

## Status

DONE

## Modified Files

- `src/lib/asset-core/types.ts`
- `src/lib/asset-core/mode.ts`
- `migrations/20260810_wj_stable_s2_assets.sql`
- `scripts/run-migrations.mjs`
- `package.json`
- `src/__tests__/lib/asset-core-types.test.ts`
- `tests/integration/stage-2-asset-schema-postgres.test.ts`

## TDD Evidence

### RED

Command:

```powershell
pnpm exec vitest run src/__tests__/lib/asset-core-types.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts
```

Actual result: failed as intended because `@/lib/asset-core/types` did not yet
exist. The PostgreSQL test explicitly skipped and logged its blocker because
`POSTGRES_TEST_DATABASE_URL` was not configured at that time.

### GREEN

Command:

```powershell
$databaseUrl='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
$env:DATABASE_URL=$databaseUrl
$env:PGDATABASE_URL=$databaseUrl
$env:POSTGRES_TEST_DATABASE_URL=$databaseUrl
pnpm migrate
pnpm migrate
pnpm exec vitest run src/__tests__/lib/asset-core-types.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts
```

Actual result: the first migration applied
`20260810_wj_stable_s2_assets.sql`; the second skipped it after matching the
ledger checksum. The real isolated PostgreSQL integration test executed (not
skipped), and Vitest reported 2 files / 4 tests passed.

Final focused verification reran the same Vitest command with
`POSTGRES_TEST_DATABASE_URL` set and again reported 2 files / 4 tests passed.

## Self Review

- `git diff --check` passed.
- `pnpm ts-check` passed.
- Targeted ESLint over both asset-core modules and both Task 1 test files passed.
- The migration is additive, the graph mode defaults to `legacy`, and no canvas,
  login, task, chat, node, or other business code was changed.

## Commit

`b7dcd79 feat: add asset graph schema and contracts`

## Concerns

No Task 1 blockers. The full repository test suite and production build were not
run because this task's required verification is the focused domain and real
PostgreSQL schema suite; TypeScript and targeted ESLint were also run.

The controller-owned `.superpowers/sdd/progress.md` and
`.superpowers/sdd/task-1-brief.md` were preserved and not included in the commit.

## Review Fix Follow-up (I1, I2, I3, M1)

### Modified Files

- `scripts/run-migrations.mjs`
- `migrations/20260810_wj_stable_s2_workspace_entity_pairs.sql`
- `src/lib/asset-core/types.ts`
- `src/__tests__/scripts/run-migrations.test.ts`
- `src/__tests__/lib/asset-core-types.test.ts`
- `tests/integration/stage-2-asset-schema-postgres.test.ts`
- `.superpowers/sdd/task-1-report.md`

### TDD Evidence

#### RED

Command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-core-types.test.ts src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts
```

Actual result: 3 files / 8 tests ran with four failures. The new runner unit test
failed because `normalizePostgresConnectionString` was not exported; the runtime
contract rejected `canvas` as though it were an entity type; the database accepted
the invalid `canvas`/`chat-result` placement; and concurrent real PostgreSQL
runner processes reproduced the `pg_type_typname_nsp_index` duplicate-key race.
The newly added fake-checksum test already passed against the prior runner because
that specific mismatch exit path was present; it remains as regression coverage
while the happy-path assertion now validates the stored SHA-256 against the exact
migration bytes.

Second focused RED command:

```powershell
pnpm exec vitest run src/__tests__/scripts/run-migrations.test.ts
```

Actual result: failed with `runner.connectionOptions is not a function`, proving
the runner's PostgreSQL client construction boundary was not directly covered by
the no-network `sslmode=require` contract test.

#### GREEN

Command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/wujie_stage2_test?sslmode=disable'
pnpm exec vitest run src/__tests__/lib/asset-core-types.test.ts src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts
```

Actual result: 3 files / 8 tests passed. This run used the required loopback-only
PostgreSQL database and verified two concurrent runner processes both exit 0 while
the Task 1 ledger version has exactly one row. It also verified the ledger digest
is the SHA-256 of the migration bytes and that a preloaded fake checksum causes a
nonzero runner exit with `Migration checksum mismatch for
20260810_wj_stable_s2_assets.sql`.

Additional verification:

```powershell
pnpm ts-check
pnpm exec eslint scripts/run-migrations.mjs src/lib/asset-core/types.ts src/__tests__/lib/asset-core-types.test.ts src/__tests__/scripts/run-migrations.test.ts tests/integration/stage-2-asset-schema-postgres.test.ts
node --check scripts/run-migrations.mjs
git diff --check
```

Actual result: all commands exited 0.

### Implementation Notes and Risks

- The runner now normalizes `sslmode=require` with `uselibpqcompat=true` at the
  `Client` option boundary, begins one transaction, acquires a
  transaction-scoped PostgreSQL advisory lock, then creates/reads the ledger and
  applies migrations. Checksum reads are therefore inside the lock.
- Workspace/entity validation is enforced in the TypeScript discriminated
  placement contract and by a new additive database `CHECK` migration. The new
  constraint is `NOT VALID` so existing data is retained unchanged while all new
  writes are rejected when incorrectly paired.
- The migration is additive and does not alter the original migration bytes,
  preserving existing ledger audit records and legacy graph-mode behavior.
- The requested coverage run was attempted with
  `pnpm exec vitest run --coverage ...`, but Vitest could not start because
  `@vitest/coverage-v8` is not installed in this repository. No dependency was
  added outside Task 1 scope; the focused non-coverage test command above passed.
- Controller-owned `.superpowers/sdd/progress.md`,
  `.superpowers/sdd/task-1-review-package.md`, `.superpowers/sdd/task-1-review.md`,
  and `.superpowers/sdd/task-2-brief.md` remain unmodified and must not be
  included in the fix commit.

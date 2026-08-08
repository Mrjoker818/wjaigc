# WJ-STABLE-001 / S1 Task 3 Report

Date: 2026-08-08
Branch: `codex/wj-stable-s1`
Starting HEAD: `44a352a8e76aebade04fcd1927fed7799b7b53b4`
Commit message: `feat: make postgres authoritative for task terminals`

## Scope

Implemented the Task 3 database-authoritative task state machine only.

Changed:

- `src/lib/task-core/task-state.ts`
- `src/lib/task-core/task-service.ts`
- `src/lib/cloud-task-storage.ts`
- `src/lib/cloud-task-persistence.ts`
- `src/__tests__/lib/task-state.test.ts`
- `tests/integration/task-state-postgres.test.ts`

Not changed:

- `src/lib/task-registry.ts`: no edit was necessary. The new task service calls
  `updateTaskProgress()` only after the PostgreSQL transition returns
  `transitioned=true`, so the registry remains a projection without expanding
  the approved write scope.
- No route or UI files.
- No Task 4 billing/refund implementation.
- No Task 5 multi-image implementation.
- No Task 6 Abort/error-contract implementation.
- No Task 7 entry-point migration.

## Baseline Recheck

Before implementation:

```text
branch: codex/wj-stable-s1
HEAD: 44a352a8e76aebade04fcd1927fed7799b7b53b4
working tree: clean
```

After `git fetch origin main`:

```text
origin/main: 368975822e3e0d81b1b726d1d2658de8e03cc6b5
formal Stage 1 baseline: e5867f08729312dc4164987e09394e46565be769
formal baseline is an ancestor of the Task 3 starting HEAD: yes
E2E_DEPLOYMENT_COMMIT: MISSING
```

The current `origin/main` does not equal the fixed formal baseline. The plan's
formal baseline was retained for protected-baseline verification. The cloud
runtime commit could not be confirmed and remains a release blocker.

## TDD RED

Tests were written before production implementation.

Command:

```text
pnpm exec vitest run src/__tests__/lib/task-state.test.ts tests/integration/task-state-postgres.test.ts
```

Result:

```text
Exit code: 1
Test Files: 1 failed | 1 skipped
Tests: 1 skipped

FAIL src/__tests__/lib/task-state.test.ts
Error: Cannot find module '@/lib/task-core/task-state'

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

This was the stable expected RED: the durable state contract/service did not
exist, while the real PostgreSQL test correctly reported its missing database
gate instead of presenting a pass.

Existing regression baseline before implementation:

```text
pnpm exec vitest run \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/lib/cloud-task-persistence.test.ts

Exit code: 0
Test Files: 2 passed
Tests: 32 passed
```

## Minimal GREEN

Implemented:

1. Explicit `DurableTaskStatus`:
   `created`, `queued`, `submitting`, `processing`, `uploading`, `completed`,
   `failed`, `cancelled`, `timeout`.
2. Pure transition rules:
   - `completed` is allowed only from `processing`.
   - Every terminal status rejects further state transitions.
   - Legacy `pending` normalizes to durable `submitting`.
3. `transitionTask()`:
   - Loads the persisted task and revision.
   - Validates `from`, destination, and optional caller revision.
   - Calls the PostgreSQL conditional transition.
   - Updates the in-memory/SSE projection only after PostgreSQL returns
     `transitioned=true`.
4. Conditional PostgreSQL update:
   - `WHERE id = $1`
   - `AND status = ANY($2::text[])`
   - `AND revision = $3`
   - `RETURNING *`
   - Increments `revision` exactly once for the winning transition.
5. Legacy compatibility:
   - Existing `CloudTaskStatus` remains narrow and unchanged.
   - Existing columns and fields remain in place.
   - `pending` rows participate when durable `submitting` is an allowed source.
   - Existing persistence unit mocks continue through the legacy adapter path.
6. Generic update hardening:
   - `completed` generic writes require persisted `processing`.
   - Other status changes reject already-terminal rows.
   - Progress updates reject terminal rows.
   - Statusless audit/metadata supplements remain allowed after terminal state.
7. Existing image/video/3D terminal persistence now uses the authoritative
   transition service. Credit status remains a statusless legacy metadata patch;
   billing and refund behavior was not redesigned.

## GREEN Verification

Focused Task 3 command:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-state.test.ts \
  tests/integration/task-state-postgres.test.ts

Exit code: 0
Test Files: 1 passed | 1 skipped
Tests: 11 passed | 1 skipped

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

Related regression:

```text
pnpm exec vitest run \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/lib/cloud-task-persistence.test.ts \
  tests/integration/task-core-postgres.test.ts

Exit code: 0
Test Files: 3 passed
Tests: 38 passed | 1 skipped

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
real PostgreSQL isolation test skipped.
```

TypeScript:

```text
pnpm ts-check
Exit code: 0
next typegen: success
tsc -p tsconfig.json: success
```

Changed-file ESLint:

```text
pnpm exec eslint \
  src/lib/task-core/task-state.ts \
  src/lib/task-core/task-service.ts \
  src/lib/cloud-task-storage.ts \
  src/lib/cloud-task-persistence.ts \
  src/__tests__/lib/task-state.test.ts \
  tests/integration/task-state-postgres.test.ts

Exit code: 0
```

Whitespace:

```text
git diff --check
Exit code: 0
```

Protected baseline without approved source paths correctly blocked the source
drift inherited since the formal Stage 1 baseline. It was then run with explicit
approved paths for Tasks 1-3:

```text
pnpm check:protected-baseline -- \
  --base e5867f0 \
  --candidate HEAD \
  <repeated approved --allow-path values>

Exit code: 0
PASS All 38 baseline feature IDs remain present.
PASS No unapproved source drift was detected.
PASS All literal protected component paths are present.
PASS All required evidence contracts are present.
PASS Base and candidate Git refs are confirmed.
PASS Release gate completed with 0 warning(s).
```

## PostgreSQL Test Contract

`tests/integration/task-state-postgres.test.ts` is ready to verify against an
isolated real PostgreSQL schema:

- Two concurrent `processing@revision=0 -> completed` calls produce at most one
  `transitioned=true`.
- The winning row is `completed`, progress `100`, revision `1`.
- `failed`, `cancelled`, and `timeout` cannot transition to `completed`.
- Terminal rows accept a statusless audit label patch.
- Terminal rows reject progress mutation and state resurrection.
- A legacy `pending` row transitions through durable `submitting`.

This test did not execute because `POSTGRES_TEST_DATABASE_URL` was absent.

## Risks And Blockers

BLOCKED:

- `POSTGRES_TEST_DATABASE_URL` is missing. Real PostgreSQL concurrency and
  transaction behavior are not verified in this environment and must not be
  reported as passed.
- `E2E_DEPLOYMENT_COMMIT` is missing. The cloud runtime commit cannot be matched
  to the implementation baseline.

Concerns:

- `origin/main` currently resolves to
  `368975822e3e0d81b1b726d1d2658de8e03cc6b5`, not the fixed formal baseline
  `e5867f08729312dc4164987e09394e46565be769`.
- Task 7 entry migration is intentionally not implemented. Existing direct
  legacy `updateCloudTask()` callers are protected from terminal resurrection
  by storage guards, but they do not all use the new revision-aware service yet.
- Task 4 billing/refund behavior is intentionally unchanged. Terminal
  persistence retains the old credit-status metadata write after a successful
  state transition.

No GitHub push was performed.

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

---

## Independent Review Fix: CHANGES_REQUIRED

The Task 3 independent review found that the first implementation still
allowed overly broad non-terminal transitions, retained a generic terminal
metadata bypass, and let the cancellation route announce an in-memory terminal
state before PostgreSQL confirmed it. This section supersedes the affected
claims in the original report above.

### Additional Scope And Minimal Necessity

Changed for the review fix:

- `src/lib/task-core/task-state.ts`
- `src/lib/task-core/task-service.ts`
- `src/lib/cloud-task-storage.ts`
- `src/lib/cloud-task-persistence.ts`
- `src/lib/task-registry.ts`
- `src/app/api/cancel-task/route.ts`
- `src/__tests__/lib/task-state.test.ts`
- `src/__tests__/lib/cloud-task-storage.test.ts`
- `src/__tests__/lib/cloud-task-persistence.test.ts`
- `src/__tests__/lib/task-registry.test.ts`
- `src/__tests__/api/cancel-task.test.ts`

`src/lib/task-registry.ts` was minimally necessary because `cancelTask()`
previously mutated the registry to `cancelled` and emitted SSE before the
database transition. It now records the cancellation signal and aborts the
current execution without publishing a terminal state.

`src/app/api/cancel-task/route.ts` was minimally necessary because the route
previously called `cancelTask()` first and persisted cancellation
fire-and-forget. It now awaits the authoritative transition or atomic
settlement and projects `cancelled` only after PostgreSQL confirms the terminal
state. No other route or UI file was changed.

The fix did not implement Task 4 billing/refund redesign, Task 5 multi-image
behavior, Task 6 Abort contracts, or Task 7 entry migration.

### Review TDD RED

Tests were changed before the production fix.

Command:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-state.test.ts \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/lib/cloud-task-persistence.test.ts \
  src/__tests__/lib/task-registry.test.ts \
  src/__tests__/api/cancel-task.test.ts \
  tests/integration/task-state-postgres.test.ts
```

Stable RED result:

```text
Exit code: 1
Test Files: 5 failed | 1 skipped
Tests: 46 failed | 122 passed | 1 skipped

Expected failures covered:
- undeclared non-terminal state edges were still accepted;
- generic status updates did not consistently use status plus revision CAS;
- terminal result/error/remoteTaskId/creditStatus/creditCost/progress writes
  were not all blocked;
- durable created/submitting/uploading rows were not centrally projected for
  legacy readers, filters, provider summary, and leases;
- terminal persistence still used the mock-dependent fallback and a second
  credit-status update;
- cancelTask() still announced cancelled before database success;
- cancel route persistence was fire-and-forget;
- TaskNotFoundError did not exist.

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

### Minimal Review Fix GREEN

Implemented:

1. Replaced the permissive state predicate with a table-driven directed graph:
   - `created -> queued|failed|cancelled|timeout`
   - `queued -> submitting|processing|failed|cancelled|timeout`
   - `submitting -> processing|failed|cancelled|timeout`
   - `processing -> uploading|completed|failed|cancelled|timeout`
   - `uploading -> processing|failed|cancelled|timeout`
   - terminal states have no outgoing edges.
2. Kept `completed` exclusive to `processing -> completed`; uploading can
   return to processing before completion.
3. Made every generic status update read the raw durable row, validate the
   explicit edge, and issue a status plus revision CAS.
4. Restricted statusless terminal updates to the audit `label` field.
   `result`, `error`, `remoteTaskId`, `creditStatus`, `creditCost`, and
   `progress` all carry a terminal-row SQL guard.
5. Added `creditStatus` to the same conditional terminal transition statement.
   Image, video, 3D, and cancellation persistence no longer perform a second
   generic metadata update.
6. Removed the `hasOwnProperty`-dependent persistence fallback. Unit tests now
   execute the authoritative `transitionTask()` branch directly and prove a
   losing terminal writer does not issue a compatibility overwrite.
7. Kept raw durable reads in `getCloudTaskById()` and centralized legacy
   projection for existing readers:
   - `created|queued -> queued`
   - `submitting|pending -> pending`
   - `processing|uploading -> processing`.
8. Expanded legacy filters, provider active summaries, lease claims, and lease
   renewals to cover every durable active state plus legacy `pending`.
9. Added dedicated `TaskNotFoundError` for both initial absence and the
   explicit CAS-loss reread-null contract.
10. Changed cancellation projection ordering so registry/SSE remains
    non-terminal until the database transition succeeds.

First implementation run after the production edits:

```text
Exit code: 1
Test Files: 2 failed | 3 passed | 1 skipped
Tests: 2 failed | 166 passed | 1 skipped

The two remaining failures were test-contract adjustments:
- zero-cost lease loss needed to simulate a successful raw read followed by a
  failed CAS;
- stale queue cleanup needed a non-terminal cancellation notification so its
  waiter could resolve without making cancelTask() terminal.
```

Final focused GREEN:

```text
Exit code: 0
Test Files: 5 passed | 1 skipped
Tests: 168 passed | 1 skipped

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

### Review Regression And Gates

Cloud task, cancellation, admin projection, and PostgreSQL-gated regression:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-state.test.ts \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/lib/cloud-task-persistence.test.ts \
  src/__tests__/lib/task-registry.test.ts \
  src/__tests__/api/cancel-task.test.ts \
  src/__tests__/api/admin-cloud-tasks.test.ts \
  tests/integration/task-state-postgres.test.ts \
  tests/integration/task-core-postgres.test.ts

Exit code: 0
Test Files: 7 passed | 1 skipped
Tests: 175 passed | 2 skipped

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
both real PostgreSQL suites explicitly skipped.
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
pnpm exec eslint <all 12 changed TypeScript/test files>
Exit code: 0
Warnings: 0
Errors: 0
```

Whitespace:

```text
git diff --check
Exit code: 0
```

Protected baseline first correctly blocked three previously approved paths that
were not included in the initial allow list:

```text
BLOCK Unapproved source drift: .superpowers/sdd/task-3-report.md
BLOCK Unapproved source drift: scripts/doctor-status.mjs
BLOCK Unapproved source drift: scripts/doctor.mjs
```

Protected baseline with the explicit Task 1-3 approved paths:

```text
pnpm check:protected-baseline -- \
  --base e5867f0 \
  --candidate HEAD \
  <repeated exact --allow-path values for approved Task 1-3 source paths>

Exit code: 0
PASS All 38 baseline feature IDs remain present.
PASS No unapproved source drift was detected.
PASS All literal protected component paths are present.
PASS All required evidence contracts are present.
PASS Base and candidate Git refs are confirmed.
PASS Release gate completed with 0 warning(s).
```

### Review Risks And Blockers

BLOCKED:

- `POSTGRES_TEST_DATABASE_URL` is still missing. Real PostgreSQL concurrency,
  lease, projection, and terminal-field behavior were not executed and are not
  reported as passed.
- `E2E_DEPLOYMENT_COMMIT` remains unavailable, so cloud runtime provenance is
  still unconfirmed.

Concerns:

- The cancellation route change is intentionally limited to ordering and
  projection. Existing refund mechanisms remain unchanged until Task 4.
- Existing legacy callers remain in place. Storage guards and centralized
  projections protect them, but Task 7 migration is intentionally deferred.
- The formal baseline remains
  `e5867f08729312dc4164987e09394e46565be769`; the environment's `origin/main`
  mismatch recorded earlier in this report remains unresolved.

No GitHub push was performed.

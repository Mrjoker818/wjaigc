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

## Fifth Independent Review Fix

### Scope

This follow-up remains limited to Task 3 task authority and projection
correctness. It does not implement Task 4 billing/refunds, Task 5 multi-image
semantics, Task 6 Abort, or Task 7 entry migration.

Changed production paths:

- `src/lib/task-registry.ts`
- `src/lib/task-core/task-service.ts`
- `src/app/api/generate/route.ts`

Changed tests:

- `src/__tests__/lib/task-registry.test.ts`
- `src/__tests__/lib/task-state.test.ts`
- `src/__tests__/api/generate-terminal-persistence-contract.test.ts`

The generate route remains the minimum approved Task 3 direct-result path. No
provider request, response schema, credit behavior, or multi-image fan-out was
changed.

### TDD RED: Durable Marker Lifecycle

The first RED added marker consumption, expiry, eviction/reuse, and HMR store
coverage:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-registry.test.ts \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/api/cancel-task.test.ts

Exit code: 1
Test Files: 1 failed, 2 passed
Tests: 24 failed, 56 passed
```

All registry tests failed at setup because
`cleanupPendingDurableTaskMarkers` did not exist. This established the missing
bounded-marker contract before implementation while cloud storage and cancel
behavior remained GREEN.

### Durable Marker GREEN

- Replaced the permanent `durableTaskIds` Set with timestamped
  `pendingDurableTaskMarkers`.
- `markTaskDurable` upgrades an existing registry task in place and removes any
  pending marker. Only create-before-register stores a temporary marker.
- `registerTask` consumes and deletes a live marker. Unmarked and expired IDs
  still default to `memory`.
- Pending markers use `TASK_TTL_MS` as a bounded TTL and are removed by
  `cleanupExpiredTasks` and the dedicated cleanup helper.
- Registry TTL deletion and capacity eviction defensively remove a same-ID
  marker, so a reused ID cannot inherit stale durable classification.
- HMR initialization upgrades existing tasks from the legacy Set and converts
  only unmatched legacy IDs into timestamped temporary markers.
- The shared `createCloudTask` success hook remains the automatic marker source
  for ordinary generate, video, and extend tasks. Poll recovery remains
  explicitly durable because it restores an existing database row.

Final marker-focused GREEN:

```text
Exit code: 0
Test Files: 3 passed
Tests: 81 passed
```

This includes explicit register-before-create, create-before-register, create
false, marker expiry, TTL eviction/reuse, capacity eviction/reuse, HMR
initialization, video registration, and memory-cancel compatibility coverage.

### TDD RED: Durable Direct Reachability

The second RED removed the callback from the test harness and required a safe
publication step:

```text
pnpm exec vitest run src/__tests__/lib/task-state.test.ts

Exit code: 1
Test Files: 1 failed
Tests: 7 failed, 93 passed
```

The failures proved that the old helper still invoked `publishCompleted` and
that no safe exposure function existed for no-URL, projection-error, or
multi-URL snapshots.

The existing route source contract then failed as expected because it still
asserted the removed callback shape:

```text
Exit code: 1
Test Files: 1 failed
Tests: 1 failed, 1 passed
```

### Durable Direct GREEN

- `publishDurableDirectTask` now performs only
  `createTask -> prepareCompletion -> completeTask` and returns the
  authoritative terminal snapshot.
- Added `exposeDurableDirectTask`. It first appends the authoritative `taskId`
  to the response collection, then appends at most the first authoritative
  image URL, and only afterward attempts registry/SSE projection.
- A completed snapshot with no image URL remains reachable by `taskId`.
- Registry publication exceptions are contained and reported through a warning
  callback after the task has already become reachable.
- CAS losers use only the winner snapshot returned by terminal persistence.
  CAS winners still persist the prepared final URL before terminal completion.
- The durable route no longer has a publisher callback capable of turning a
  committed PostgreSQL completion into an omitted response task.
- The `_skipCloudTaskPersistence` memory-only path retains its previous
  behavior.

Direct-focused GREEN:

```text
Exit code: 0
Test Files: 2 passed
Tests: 102 passed
```

Behavioral coverage includes completed-without-URL, registry publication
failure, winner snapshot selection, persisted winner URL, and one direct URL
maximum per returned task ID.

### Fifth Review Verification

Task 3 focused suite:

```text
Exit code: 0
Test Files: 9 passed, 1 skipped
Tests: 224 passed, 1 skipped
```

Expanded cloud task, generate, poll recovery, video, cancel, admin, registry,
and async-generation regression suite:

```text
Exit code: 0
Test Files: 20 passed, 1 skipped
Tests: 259 passed, 1 skipped
```

PostgreSQL remains explicit:

```text
BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

Static verification:

```text
pnpm ts-check
Exit code: 0

pnpm exec eslint <changed TypeScript/test files>
Exit code: 0
Errors: 0
Warnings: 19 existing warnings in src/app/api/generate/route.ts

git diff --check
Exit code: 0
```

Protected baseline against temporary candidate
`0915b890944034a195649755d7e023fb524ff4c8`, containing the complete fifth
review working tree and the exact cumulative approved Task 1-3 paths:

```text
Exit code: 0
PASS All 38 baseline feature IDs remain present.
PASS No unapproved source drift was detected.
PASS All literal protected component paths are present.
PASS All required evidence contracts are present.
PASS Base and candidate Git refs are confirmed.
PASS Release gate completed with 0 warning(s).
```

### Fifth Review Risks And Blockers

BLOCKED:

- `POSTGRES_TEST_DATABASE_URL` remains absent. Real PostgreSQL CAS concurrency
  and transaction behavior were skipped and are not reported as passed.
- `E2E_DEPLOYMENT_COMMIT` remains unavailable, so cloud runtime provenance is
  still unconfirmed.

Concerns:

- Pending durable markers remain process-local by design, but are now bounded
  by TTL and consumed on registration. Cross-process/restart recovery continues
  to rely on the database and the explicit poll recovery projection.
- A completed durable direct task may have no image URL. It is intentionally
  returned by task ID so polling can expose the authoritative empty-result
  problem instead of hiding a committed task.
- Provider behavior, billing/refunds, multi-image semantics, Abort handling,
  and broad entry migration remain unchanged and deferred to Tasks 4-7.

No GitHub push was performed.

## 2026-08-08 Second Independent Review Fix

Status before this fix: `CHANGES_REQUIRED`.

This pass remained inside Task 3. It did not implement Task 4 billing/refund
redesign, Task 5 multi-image behavior, Task 6 Abort behavior, or Task 7 entry
migration.

### Minimal Scope Necessity

The review explicitly approved two route-level compatibility repairs:

- `src/app/api/generate/route.ts` was minimally necessary because durable image
  generation branches still published terminal registry/SSE state before the
  PostgreSQL terminal CAS completed.
- `src/app/api/cancel-task/route.ts` was minimally necessary because the first
  review's database-first path incorrectly treated legacy registry-only tasks
  as durable tasks and could return `TaskNotFoundError`/500.

No other business route or UI file was changed.

### Second Review TDD RED

Tests were added before the production changes:

- real `updateCloudTask()` SQL/mock coverage for processing, queued, pending,
  and workflow same-status non-terminal patches;
- mixed `pending|processing -> processing` source filtering;
- terminal same-status business patch rejection;
- systematic generate-route terminal ordering contracts;
- registry-only cancellation compatibility and durable cancellation failure
  projection protection.

Initial RED:

```text
pnpm exec vitest run \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/api/generate-terminal-persistence-contract.test.ts \
  src/__tests__/api/cancel-task.test.ts \
  tests/integration/task-state-postgres.test.ts

Exit code: 1
Test Files: 3 failed | 1 skipped
Tests: 6 failed | 45 passed | 1 skipped

Expected failures:
- updateCloudTask rejected processing/queued/pending same-status active patches;
- expectedStatuses containing the active target status discarded valid sources;
- durable generate terminal branches did not await authoritative persistence;
- registry-only cancellation attempted the durable persistence path.

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

After the minimal production changes, one contract test still selected the
wrong `submitOnly` branch in the large generate route:

```text
Exit code: 1
Test Files: 1 failed | 2 passed | 1 skipped
Tests: 1 failed | 52 passed | 1 skipped
```

The test was corrected to anchor on the actual
`recordSubmitOnlyTerminal` helper. No production behavior was relaxed.

### Second Review Minimal GREEN

Implemented:

1. `updateCloudTask()` now filters `expectedStatuses` to sources that are
   either an explicit directed predecessor or the same normalized
   non-terminal status.
2. An empty filtered source set or a current row outside that filtered set
   returns `false`.
3. Same-status active patches still use the current persisted revision and
   `status = ANY(...)` CAS.
4. Terminal same-status business patches remain rejected for completed,
   failed, cancelled, and timeout rows.
5. Every durable terminal branch in the legacy submit-only image worker now
   awaits `recordImageTaskTerminal()` and relies on its successful CAS to
   project terminal registry/SSE state.
6. Direct image results retain the old in-memory terminal behavior only when
   `_skipCloudTaskPersistence` marks the task as non-persistent. Durable direct
   tasks await creation and terminal persistence; CAS loss or persistence
   failure leaves `terminalTransitioned=false` and cannot publish terminal
   registry updates.
7. Registry-only cancellation now remains legacy-compatible: it cancels the
   registry/edit store, runs the existing refund behavior, and projects
   cancelled without invoking authoritative persistence.
8. Persisted cancellation remains database-first and does not project
   cancelled when the transition/settlement throws or loses.

Focused GREEN:

```text
Exit code: 0
Test Files: 3 passed | 1 skipped
Tests: 53 passed | 1 skipped

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

### Second Review Regression And Gates

Unified Task 3, storage/persistence, cancellation, admin projection, async
generation, and all generate contract regressions:

```text
Unified regression files: 16
Exit code: 0
Test Files: 15 passed | 1 skipped
Tests: 208 passed | 1 skipped

BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
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
  src/lib/cloud-task-storage.ts \
  src/app/api/cancel-task/route.ts \
  src/app/api/generate/route.ts \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/api/cancel-task.test.ts \
  src/__tests__/api/generate-terminal-persistence-contract.test.ts

Exit code: 0
Errors: 0
Warnings: 19 historical warnings in src/app/api/generate/route.ts
```

Whitespace:

```text
git diff --check
Exit code: 0
```

Protected baseline with explicit approved Task 1-3 paths plus the review-
approved generate/cancel route paths:

```text
pnpm check:protected-baseline -- --base e5867f0 --candidate HEAD \
  <exact repeated --allow-path values>

Exit code: 0
PASS All 38 baseline feature IDs remain present.
PASS No unapproved source drift was detected.
PASS All literal protected component paths are present.
PASS All required evidence contracts are present.
PASS Base and candidate Git refs are confirmed.
PASS Release gate completed with 0 warning(s).
```

### Second Review Risks And Blockers

BLOCKED:

- `POSTGRES_TEST_DATABASE_URL` remains absent. Real PostgreSQL CAS concurrency
  and terminal transition tests were skipped and are not reported as passed.
- Cloud runtime commit/provider evidence remains outside this local Task 3 fix.

Concerns:

- The legacy submit-only wrapper remains guarded by its existing environment
  flag; this fix changes only terminal ordering inside that path.
- Existing refund calls were preserved for compatibility. Atomic billing and
  refund redesign remains Task 4.
- Internal non-persistent generation tasks intentionally keep registry
  authority because no `cloud_tasks` row exists.

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

## Third Independent Review Fix

### Scope

This follow-up remains limited to Task 3. It does not implement Task 4 billing
or refunds, Task 5 multi-image changes, Task 6 Abort support, or Task 7 entry
migration.

The review required two additional authoritative-persistence contracts:

- Registry tasks now carry an optional persistence classification. Existing
  callers default to `memory`; only generation paths that successfully create a
  `cloud_tasks` row opt into `durable`.
- Durable direct image results are not exposed in the response or registry
  until cloud-task creation and the terminal CAS establish an authoritative
  completed task.

The route changes remain the minimum approved Task 3 ordering work:

- `src/app/api/cancel-task/route.ts`
- `src/app/api/generate/route.ts`

No other business route or UI was changed.

### TDD RED

Tests were written before the implementation changes:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-registry.test.ts \
  src/__tests__/api/cancel-task.test.ts \
  src/__tests__/lib/task-state.test.ts \
  src/__tests__/api/generate-terminal-persistence-contract.test.ts \
  tests/integration/task-state-postgres.test.ts

Exit code: 1
Test Files: 4 failed, 1 skipped
Tests: 9 failed, 117 passed, 1 skipped
```

The RED failures demonstrated:

- `registerTask` did not preserve an explicit durable/memory classification.
- Registry-only cancellation still queried PostgreSQL and returned 500 when
  that lookup failed.
- Direct durable generation published task IDs and registry state before
  authoritative creation/terminal persistence.
- The injectable direct-publication behavior did not yet exist.

The PostgreSQL integration test remained explicit:

```text
BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

### Minimal GREEN Implementation

- Added `TaskPersistence = 'memory' | 'durable'` and optional
  `TaskInfo.persistence`; `registerTask` defaults to `memory`, preserving every
  existing unmodified caller.
- Marked only successfully persisted submit-only, pending multi-slot, and
  durable direct generation registrations as `durable`.
- Split cancellation by the registry persistence property:
  - memory/legacy registry tasks use the existing registry, edit-store, and
    refund behavior without calling `getCloudTaskForUser`;
  - durable registry tasks and registry-missing recovery requests remain
    database-first, and lookup/transition failure cannot publish cancelled.
- Added `publishDurableDirectTask`, a dependency-injected Task 3 helper that
  requires successful create plus an authoritative completed terminal snapshot
  before invoking the registry/response publisher.
- Durable direct create rejection, create exception, missing terminal snapshot,
  and non-completed CAS winner do not add a success task ID. A CAS loser may
  publish only when its authoritative snapshot is already completed.
- `_skipCloudTaskPersistence` direct tasks retain the legacy memory-only path.

### GREEN And Regression Evidence

Focused Task 3 suite:

```text
Exit code: 0
Test Files: 4 passed, 1 skipped
Tests: 127 passed, 1 skipped
```

The focused tests cover:

- default memory and explicit durable registry registration;
- memory cancellation with a rejecting database mock, including an assertion
  that `getCloudTaskForUser` was not called;
- durable lookup failure with no registry terminal projection;
- durable direct create false, create throw, CAS loser with failed winner,
  CAS winner completed, and CAS loser with authoritative completed;
- returned task IDs and registry publication only after authoritative
  completion.

Generate/cancel/cloud-task/admin/async regression suite:

```text
Exit code: 0
Test Files: 16 passed, 1 skipped
Tests: 219 passed, 1 skipped
```

PostgreSQL status:

```text
BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
the real PostgreSQL integration test was skipped and is not reported as passed.
```

Static verification:

```text
pnpm ts-check
Exit code: 0

pnpm exec eslint <changed TypeScript/test files>
Exit code: 0
Errors: 0
Warnings: 19 pre-existing warnings in src/app/api/generate/route.ts

git diff --check
Exit code: 0
```

Protected baseline against a temporary Git candidate containing the complete
working-tree fix, with the exact cumulative Task 1-3 approved paths:

```text
pnpm check:protected-baseline -- \
  --base e5867f0 \
  --candidate <temporary candidate commit> \
  <repeated exact --allow-path values for approved Task 1-3 paths>

Exit code: 0
PASS All 38 baseline feature IDs remain present.
PASS No unapproved source drift was detected.
PASS All literal protected component paths are present.
PASS All required evidence contracts are present.
PASS Base and candidate Git refs are confirmed.
PASS Release gate completed with 0 warning(s).
```

### Third Review Risks And Blockers

BLOCKED:

- `POSTGRES_TEST_DATABASE_URL` is still missing. Real PostgreSQL CAS and
  transaction behavior were not executed and must not be described as passed.
- `E2E_DEPLOYMENT_COMMIT` remains unavailable, so cloud runtime provenance is
  still unconfirmed.

Concerns:

- Existing `registerTask` callers intentionally remain memory tasks unless they
  are part of the generation persistence paths changed here. Full entry
  migration remains Task 7.
- Existing refund implementations and ordering outside the minimum cancellation
  split are unchanged; Task 4 remains deferred.
- The formal protected baseline remains
  `e5867f08729312dc4164987e09394e46565be769`; the previously recorded
  `origin/main` mismatch remains unresolved.

## Fourth Independent Review Fix

### Scope

This follow-up remains strictly within Task 3 authoritative task persistence.
It does not implement Task 4 billing/refunds, Task 5 multi-image behavior,
Task 6 Abort, or Task 7 entry migration.

The minimum additional production paths are:

- `src/lib/task-registry.ts`
- `src/lib/cloud-task-storage.ts`
- `src/lib/task-core/task-service.ts`
- `src/app/api/generate/route.ts`
- `src/app/api/poll-task/route.ts`

The `poll-task` change is necessary because it rebuilds an in-memory task from
an already-existing durable row without calling `createCloudTask` in the
current process. It is limited to passing the explicit durable classification
to `registerTask`; no polling, provider, billing, or terminal behavior changed.

### TDD RED: Durable Marker

The first RED added behavioral coverage for register-before-create,
create-before-register, rejected inserts, video registration, and poll recovery:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-registry.test.ts \
  src/__tests__/lib/cloud-task-storage.test.ts \
  src/__tests__/api/poll-task-recovery-lease-contract.test.ts \
  src/__tests__/api/cancel-task.test.ts

Exit code: 1
Test Files: 3 failed, 1 passed
Tests: 6 failed, 80 passed
```

The failures showed:

- `markTaskDurable` did not exist.
- A successful `createCloudTask` did not upgrade an existing registry task.
- A successful insert was forgotten when registration happened later.
- A registered video task remained memory-only after persistence.
- poll recovery rebuilt a durable row without a durable registry marker.

The rejected-insert test was already GREEN in the RED run, proving that the
new expectation was specifically “mark only on INSERT success,” not “mark every
attempt.”

### Durable Marker GREEN

- Added `durableTaskIds` to the existing `globalThis` registry store, including
  compatibility initialization for a store created by an older module instance.
- Added `markTaskDurable(taskId)`. It records the marker and upgrades an
  existing `TaskInfo.persistence` in place without emitting an SSE event or
  changing task status/progress.
- `registerTask` still defaults unmarked tasks to `memory`; when persistence is
  omitted it consults the durable marker, covering create-before-register.
- `createCloudTask` calls `markTaskDurable` only when the INSERT reports
  `rowCount > 0`. Conflict/false and thrown inserts do not mark.
- Removed the reviewed generate-specific durable arguments so submit-only,
  batch slot, direct, ordinary remote generate, video, and extend paths rely on
  the shared storage contract after successful creation.
- poll recovery explicitly registers durable because it starts from an existing
  database row rather than creating one in this process.

Marker-focused GREEN:

```text
Exit code: 0
Test Files: 4 passed
Tests: 86 passed
```

### TDD RED: Durable Direct Final URL

The second RED added real helper behavior tests plus route ordering contracts:

```text
pnpm exec vitest run \
  src/__tests__/lib/task-state.test.ts \
  src/__tests__/api/generate-terminal-persistence-contract.test.ts

Exit code: 1
Test Files: 2 failed
Tests: 5 failed, 94 passed
```

The failures demonstrated:

- durable completion had no prepare-before-CAS phase;
- no shared helper extracted image URLs from the authoritative task snapshot;
- a CAS winner could not prove that its persisted final URL was passed into the
  terminal write;
- a CAS loser could still publish its own URL instead of the winner snapshot;
- the route still contained terminal-after background result replacement.

### Durable Direct GREEN

- `publishDurableDirectTask` now performs:
  `createTask -> prepareCompletion -> completeTask -> publishCompleted`.
- The generate route awaits `persistRemoteImage(rawUrl)` inside
  `prepareCompletion`; a persistence exception explicitly falls back to the raw
  URL before the terminal CAS.
- `recordImageTaskTerminal` receives that final URL, so PostgreSQL stores the
  same result later projected to registry/SSE and returned as
  `directImageUrls`.
- Added the pure `getTaskResultImageUrls` helper. The publisher reads only the
  authoritative `task.result.imageUrls/imageUrl`; it never unconditionally
  publishes the local raw URL.
- A CAS loser with an authoritative completed winner publishes the winner URL.
  A failed/cancelled/timeout winner remains non-publishable.
- Removed durable terminal-after `persistRemoteImage().then(...)` result
  replacement. The legacy `_skipCloudTaskPersistence` memory path retains its
  background persistence update because no database row exists.

Direct-focused GREEN:

```text
Exit code: 0
Test Files: 2 passed
Tests: 99 passed
```

### Final Verification

Task 3 focused marker/direct/cancel/poll/video suite:

```text
Exit code: 0
Test Files: 8 passed, 1 skipped
Tests: 197 passed, 1 skipped
```

Expanded generate, poll-task, video/extend, cloud-task, cancel, registry,
admin, and async recovery regression suite:

```text
Exit code: 0
Test Files: 24 passed, 1 skipped
Tests: 259 passed, 1 skipped
```

PostgreSQL remains explicit:

```text
BLOCKED: POSTGRES_TEST_DATABASE_URL is not configured;
authoritative task-state PostgreSQL tests skipped.
```

Static verification:

```text
pnpm ts-check
Exit code: 0

pnpm exec eslint <changed TypeScript/test files>
Exit code: 0
Errors: 0
Warnings: 34 existing warnings in generate and poll-task routes

git diff --check
Exit code: 0
```

Protected baseline against a temporary candidate containing the complete
working tree, with exact cumulative approved Task 1-3 paths:

```text
Exit code: 0
PASS All 38 baseline feature IDs remain present.
PASS No unapproved source drift was detected.
PASS All literal protected component paths are present.
PASS All required evidence contracts are present.
PASS Base and candidate Git refs are confirmed.
PASS Release gate completed with 0 warning(s).
```

### Fourth Review Risks And Blockers

BLOCKED:

- `POSTGRES_TEST_DATABASE_URL` is still missing. Real PostgreSQL concurrency
  and transaction behavior were skipped and are not reported as passed.
- `E2E_DEPLOYMENT_COMMIT` remains unavailable, so cloud runtime provenance is
  still unconfirmed.

Concerns:

- `durableTaskIds` is process-local by design. Cross-process/restart recovery
  therefore continues to depend on database reads; the poll recovery path now
  explicitly restores the durable registry classification.
- Pure memory tasks remain `memory` by default and continue to avoid database
  dependency.
- Provider calls, credit behavior, multi-image behavior, Abort handling, and
  broad entry migration remain unchanged and deferred to Tasks 4-7.

No GitHub push was performed.

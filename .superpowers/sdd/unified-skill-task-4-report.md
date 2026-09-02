# Unified Skill Runtime Task 4 Report

## Status

Implemented durable Skill run controls by extending the existing Agent Runtime.
No second task state machine, billing ledger, or in-memory ownership store was
introduced.

## RED Evidence

- Initial Task 4 run:
  `pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/components/use-agent-run-events.test.ts`
- Result: exit 1; 8 expected failures. The reducer did not recognize pause,
  resume, retry, or quality events; service pause/resume methods and client PATCH
  helpers did not exist; polling did not stop at paused.
- Terminal revision RED: completion omitted the task revision and a late failure
  was accepted while paused.
- Skill invocation RED: parsed Agent requests dropped the versioned Skill
  invocation.
- PATCH parsing RED: malformed JSON returned 500 instead of a bounded 400.
- Determinism RED: reversing same-sequence quality events changed the projection.

## Implementation

- Added `paused`, `run.paused`, `run.resumed`, `step.retrying`, and
  `quality.checked`, plus progress, current/resume step, and quality-check
  projection fields.
- Added deterministic event replay using sequence, stable event-type priority,
  and event ID tie-breaking. While paused, only resume or cancel can cross the
  pause barrier; late completion/failure/tool/asset events are ignored.
- Added `AgentSkillInvocation` parsing and persistence in `run.created`, so a
  resumed run does not depend on the caller retaining Skill input/model state.
- Added one PostgreSQL control transaction on the existing Agent event stream.
  It locks the authoritative `cloud_tasks` row, checks its revision, appends the
  control event, increments the same revision, and releases or replaces the
  existing execution lease before commit.
- Pause leaves the cloud task and credit status live, then aborts the old
  controller only after the database transaction succeeds. It never refunds.
- Resume reads the persisted `nextStepId`, creates a new execution generation and
  lease owner, and never reuses the prior lease, Promise, or AbortController.
- Terminal completion/failure/cancel settlement now carries the observed task
  revision. A concurrent pause/resume revision change makes stale settlement
  lose instead of crossing the control event.
- Cancel from paused still uses the existing single terminal failure settlement
  and refund path. Repeated pause/resume and exact event retries are idempotent;
  a resume retry reads the existing lease instead of replacing it.
- Added `PATCH /api/agent-runs/[runId]` with `action: pause|resume`, preserving GET
  and DELETE on the same resource. No parallel control API was added.
- Client polling stops on paused. Resume invalidates the previous poll
  generation before the request and starts a new poller from persisted events;
  late callbacks are generation-guarded.
- Added migration `20260902_unified_skill_task4_agent_controls.sql` to extend the
  existing Agent event type constraint.

## Verification

- Task 4 plus Agent storage/service/cancel regressions: 9 files passed, 108 tests
  passed; PostgreSQL file skipped 19 tests because
  `POSTGRES_TEST_DATABASE_URL` is not configured.
- Task 1-3 compatibility: 7 files passed, 74 tests passed; Task 3 PostgreSQL file
  skipped 2 tests for the same missing isolated database configuration.
- Earlier full `pnpm ts-check`: exit 0. The final rerun was user-interrupted after
  type generation; the immediate replacement
  `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` completed exit 0.
- Limited ESLint over all modified TypeScript/TSX files: exit 0, no warnings.
- `git diff --check`: exit 0; only working-tree LF/CRLF conversion notices.

## PostgreSQL Verification Gap

The real PostgreSQL control test was added and covers pause-before-lease-release,
no credit mutation, revision increments, resume with a new lease, and exact
resume retry preserving that lease. It was not executed because
`POSTGRES_TEST_DATABASE_URL` is absent. No ambient `DATABASE_URL` or production
database was used as a substitute. This is an explicit unverified release item,
not an in-memory fallback and not reported as passing.

## Scope And Protection

- Existing Agent Runtime, `cloud_tasks`, Agent events, execution leases,
  AbortController registry, and atomic settlement remain the sole authorities.
- `stable` was not modified, merged, or pushed.
- Existing untracked `.playwright-cli/`, `_refs-asui-canvas/`,
  `_refs-hero-infinite-canvas/`, and
  `docs/superpowers/plans/2026-08-02-provider-generation-video-reliability.md`
  were not staged or modified.

## Changes Requested Follow-up

- Resume now commits `run.resumed`, allocates a new generation/lease, creates a
  fresh AbortScope and background Promise, and invokes the existing durable
  `/api/poll-task` recovery entry. A database CAS on `dispatch_started_at`
  prevents duplicate resume requests from creating duplicate executions.
  `tool.started` is persisted before recovery dispatch, so the event projection
  advances from `queued` to `executing` instead of remaining parked.
- PATCH responses retain `leaseOwner` and `dispatch.started`; the client keeps
  this metadata on the controlled projection. Poll generation is invalidated
  only after a successful control response. A failed pause/resume keeps the old
  generation valid and immediately refreshes polling.
- Adopted execution now carries `resumeFromStepId` plus a database generation
  fence. Pause atomically marks the Agent lease paused and clears both the Agent
  lease and underlying `cloud_tasks` lease. Cloud task completion, failure,
  direct terminal update, and refund writers reject paused or stale-generation
  workers. The terminal observer also checks the current generation/lease.
- Identical repeated pause calls retry the idempotent abort, covering a crash
  after the database commit but before local abort. A different `nextStepId`
  conflicts with HTTP 409.
- Added migration
  `20260902_unified_skill_task4_execution_fence.sql` for generation, pause,
  next-step, and dispatch-CAS fields on the existing execution lease table.

## Follow-up Verification

- RED run: 6 expected failures across service dispatch, pause retry/conflict,
  client failure recovery, and adopted generation context.
- Task 4/control unit set: 68 tests passed.
- Agent runtime, event/task storage, billing/cancel, and Task 1-3 compatibility:
  416 tests passed; 2 PostgreSQL Skill storage tests skipped.
- Poll/recovery and adopted executor regressions: 68 tests passed.
- PostgreSQL Agent suites: 25 tests skipped because
  `POSTGRES_TEST_DATABASE_URL` is not configured. The new integration assertions
  cover pause blocking late completion/failure and resume allowing only the new
  generation; no in-memory substitute was used.
- TypeScript: `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` passed.
- Limited ESLint: no errors. The touched legacy `poll-task/route.ts` reports 11
  pre-existing unused-symbol warnings; the strict `--max-warnings 0` invocation
  therefore exits nonzero without any new lint error.
- `git diff --check` passed with only line-ending conversion notices.

## Second Review Follow-up

> Status: BLOCKED before commit. Chat and simple-chat adopted continuations are
> durable and directly resumable, but the existing `/api/agent-edit` same-task
> adoption still stores only its process-local executor closure. A cross-instance
> resume of that surface therefore has no durable request descriptor yet. The
> remaining work is to persist the validated agent-edit request on the existing
> cloud task, reference it from `run.created`, and have the adopted adapter invoke
> the same idempotent agent-edit execution entry. No poll or in-memory substitute
> has been added.

### RED

- Added direct resume-dispatch, same-task re-entry, cloud-task fence, recoverable
  dispatch-claim, and background rejection tests before completing the storage
  and service changes.
- The focused RED run failed 6 assertions: resume still reached
  `/api/poll-task`, the dispatch claim was one-way, adopted execution omitted
  generation/owner re-entry, and claim/refund/fallback SQL lacked the Agent
  control fence.

### Changes

- Resume now loads the adopted run's durable continuation and directly invokes
  `executeAdoptedAgentTask`. Generation/edit continuations are persisted in
  `run.created`; execution receives the persisted `nextStepId`, new generation,
  lease owner, and fresh abort signal. The obsolete poll-route resume-header
  path was removed.
- `claimAdoptedAgentExecution` permits only the preallocated same-owner,
  same-generation lease to re-enter before expiry. Stale generations and other
  owners still lose the database CAS.
- Replaced the one-way `dispatch_started_at` gate with a recoverable dispatch
  lease: owner, expiry, attempt counter, and durable error. Same-generation
  concurrent dispatches remain singular; timeout or atomic failure release lets
  an exact resume retry claim again. Migration:
  `20260903_unified_skill_task4_dispatch_lease.sql`.
- Dispatch failure release and `step.retrying` append now occur in one database
  transaction. Service-level background rejection handling also persists a
  stable retry-visible event instead of swallowing the Promise rejection.
- Added one centralized cloud-task Agent SQL fence and applied it to generic
  business updates, cloud lease claim/renew/release/defer, charge, direct refund,
  local fallback, and terminal paths. Paused tasks cannot be reclaimed,
  progressed, refunded, or moved to fallback; an active fence requires exact
  run, generation, and owner. Explicit cancellation from paused remains allowed
  through the existing revision-CAS, single-settlement path.

### Verification

- Focused second-review set: 4 files, 111 tests passed.
- Agent runtime/storage/service/cancel/recovery plus Task 1-3 compatibility:
  16 files, 256 tests passed.
- TypeScript: `pnpm ts-check`, exit 0.
- Limited ESLint over all touched TypeScript files: exit 0 with 0 errors. It
  reports 14 pre-existing unused-symbol warnings in legacy chat, poll-task, and
  chat-tools files.
- PostgreSQL: the discovered isolated suite was run and skipped 2 tests because
  `POSTGRES_TEST_DATABASE_URL` is not configured. No ambient or in-memory
  substitute was used.
- `git diff --check`: exit 0; only line-ending conversion notices.

## Agent Edit Cross-Instance Recovery Follow-up

> Status: DONE. The remaining `/api/agent-edit` adopted-run recovery gap is
> closed without an HTTP re-entry or process-local task dependency.

### RED

- Descriptor/storage RED:
  `pnpm exec vitest run src/__tests__/lib/agent-edit-execution-descriptor.test.ts src/__tests__/lib/cloud-task-storage.test.ts`
  failed because the bounded descriptor module and private atomic storage APIs
  did not exist.
- Continuation RED:
  `pnpm exec vitest run src/__tests__/lib/agent-edit-continuation.test.ts src/__tests__/lib/agent-runtime-same-task-adapter.test.ts`
  failed because agent-edit had no durable continuation loader/executor.
- Route recovery RED:
  `pnpm exec vitest run src/__tests__/api/agent-edit-production-recovery.test.ts -t "resumes from the private descriptor"`
  first failed with `selectedEntityIds is required`, proving the persisted
  descriptor could not reconstruct execution after process-local state loss.
- Dependency-direction RED:
  `pnpm exec vitest run src/__tests__/api/agent-edit-durable-continuation-contract.test.ts`
  failed 2/2 because the executor imported the API route and no stable lib
  execution service existed. A final cycle audit added a stricter contract that
  failed 1/2 while the service still imported the adapter's error class.

### Implementation

- Added private `cloud_tasks.agent_execution_descriptor` JSONB storage with a
  64 KiB database constraint and an owner/type/digest-guarded row-lock CTE.
  Exact retries preserve the first descriptor; conflicting digests fail closed.
  The public `CloudTask` mapper and GET responses do not select or expose it.
- Added strict `AgentEditExecutionDescriptorV1` validation and canonical SHA-256
  digesting. It stores only immutable version IDs, prompts, exact model/provider
  IDs, bounded rounds, quality, and aspect ratio. URLs, data URLs, credentials,
  base URLs, headers, roles, generations, and lease owners are rejected.
- `run.created` now contains only the agent-edit continuation reference, digest,
  and `rootToolId`. Resume reloads and revalidates both event and private
  descriptor, accepts only `nextStepId=agent_edit`, and fails closed for missing,
  mismatched, or unknown versions.
- Moved the stable executor to
  `src/lib/agent-runtime/agent-edit-execution-service.ts`. The Next.js route is
  now a thin POST/GET adapter, while the resume dispatcher dynamically imports
  the same lib service directly. There is no `lib -> API route` dependency.
  The shared model-route error lives in an independent module, so the execution
  service also has no direct or indirect dependency back through the adapter.
- Resume reconstructs authorization from immutable Asset Version IDs, forwards
  the fresh generation, lease owner, operation context, and AbortSignal, and
  executes on the already billed parent task. Missing process-local task state
  is not cancellation; no second `createBillableTask` call occurs.

### GREEN And Regression

- Focused descriptor/continuation/adapter/dispatch/route/recovery set:
  7 files, 108 tests passed.
- Full relevant Agent Runtime, event/task storage, billing/cancel, adopted
  execution, client controls, and Task 1-3 compatibility:
  23 files, 324 tests passed.
- Skill Runtime compatibility and isolation:
  5 files, 67 tests passed, including 21 built-ins for canvas/workflow and 16
  for simple-chat.
- TypeScript: `pnpm ts-check`, exit 0.
- Limited ESLint over all 30 changed TypeScript/TSX files: exit 0, 0 errors and
  14 pre-existing unused-symbol warnings in chat, poll-task, and chat-tools.
- `git diff --check`: exit 0; only LF/CRLF conversion notices.
- PostgreSQL: `src/__tests__/integration/skill-runtime-storage-postgres.test.ts`
  explicitly skipped 2 tests because `POSTGRES_TEST_DATABASE_URL` is absent.
  The descriptor CTE/migration was therefore not claimed as real-database
  verified; no ambient database or in-memory substitute was used.

### Delivery

- No commit or push was created, as requested. All intended Task 4 changes are
  left staged for review. `stable` and the protected untracked paths remain
  untouched.

## Fourth Review Hardening

### RED Evidence

- Command:
  `pnpm exec vitest run src/__tests__/lib/cloud-task-storage.test.ts src/__tests__/lib/agent-runtime-downstream-operations.test.ts src/__tests__/lib/agent-runtime-event-storage-fence.test.ts src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/__tests__/lib/agent-runtime-same-task-adapter.test.ts src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-edit-execution-descriptor.test.ts src/__tests__/api/agent-runs.test.ts`
- Result: exit 1; 8 files failed with 17 expected assertion failures and 148
  existing tests passed.
- Cloud-task fence RED proved that an absent AsyncLocalStorage fence still
  generated SQL that explicitly allowed any active Agent lease through.
- Downstream RED proved that an unfenced operation was accepted, nested steps
  dropped the parent execution fence, and every prepare/read/submitted/accepted/
  completed/submission-unknown/release SQL path omitted the authoritative Agent
  generation and lease-owner check.
- Event RED proved that resumed `tool.started` and initial adopted
  `tool.started` carried no claimed execution fence, stale/missing generations
  changed reducer state, and an already persisted dispatch failure triggered a
  second retry persistence callback.
- Descriptor and event-payload RED proved that ordinary and signed HTTPS URLs,
  Authorization/Bearer, API-key, and token-shaped strings could be persisted.
  The companion Chinese prompt assertions passed, confirming the intended fix
  must remain precise rather than reject ordinary Chinese product copy.

### Fourth Review GREEN

- Cloud-task business, lease, terminal, and refund writers now fail closed when
  a live Agent execution lease exists without an explicit/ALS fence. An explicit
  fence must match the authoritative run ID, generation, and lease owner while
  the run is neither paused nor completed. Non-Agent tasks retain their existing
  behavior, and the dedicated paused-run cancellation settlement remains the
  only intentional bypass.
- Every durable downstream prepare, read/reconcile, claim, submitted, accepted,
  completed, submission-unknown, and release transition now checks the same
  authoritative Agent lease. Nested child operations inherit the parent fence.
- Initial and resumed `tool.started`, completion-failure `step.retrying`, and
  adopted `tool.completed` events carry the claimed generation and owner. Event
  storage rejects a stale lease, and the reducer ignores stale or missing
  execution generations after resume. A dispatcher-persisted failure is marked
  on a stable error object so the service cannot append a duplicate retry event.
- Agent-edit descriptors and Agent event payloads reject HTTP(S)/signed URLs,
  Authorization/Bearer material, API-key and token-shaped values, while ordinary
  Chinese product copy about credential-management interfaces remains valid.
- The requested eight-file command passed: 8 files, 165 tests.
- Related Agent Runtime, adopted recovery, billing/cancel, Task 1-3, and 21/16
  Skill isolation regression passed: 32 files, 428 tests.
- `pnpm ts-check` passed. Targeted ESLint over all modified TypeScript/TSX files
  passed with zero errors and zero warnings. `git diff --check` passed; only the
  repository's existing LF/CRLF conversion notices were emitted.
- Four PostgreSQL suites were discovered and executed, but all 29 tests were
  explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is absent. No ambient
  or in-memory database was substituted, so real PostgreSQL concurrency remains
  correctly reported as unverified.
- The pre-existing source-location assertions in `agent-task-access.test.ts`
  were updated to inspect the shared agent-edit execution service after the
  route became a thin adapter. The authentication, ownership, allowlist, and
  round-limit assertions themselves were retained unchanged.

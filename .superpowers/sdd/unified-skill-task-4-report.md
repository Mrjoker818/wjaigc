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

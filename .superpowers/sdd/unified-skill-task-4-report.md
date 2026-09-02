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

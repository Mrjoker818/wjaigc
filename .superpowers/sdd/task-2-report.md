# Stage 4 Task 2 Report: Chat and Agent Runtime Integration

Date: 2026-08-17
Baseline: `7b3ca85797ee56f381cdb0ef8b120898a84d7296` (`codex/wj-stable-s4`)
Blocker-resolution baseline: `18af75a70f383eacddbb46494a2405be51c333e4`

Status: COMPLETE - the historical blocker and limitation recorded below were
resolved by the same-task adoption adapter described in the completion addendum.

## Scope

- Added pure, credential-rejecting request builders for canvas chat, standalone
  chat, and image Agent. They preserve caller-selected provider/model IDs,
  normalize only context, require a source version for vision, and enable no
  tools for conversation mode.
- Added the shared Agent event hook and progress timeline. They are covered as
  reusable primitives, but are not mounted in a production surface until an
  `agent-v2` request can return a valid shared run ID without changing a legacy
  response or creating a second billable task.
- Added a best-effort shadow observer. It appends only `run.created` and
  `plan.updated` to an already-created task, never calls a provider, charges
  credits, or creates an asset. Failures are contained and diagnostically
  redacted.
- Shadow bridges run only after existing image-Agent or generated image/video
  tasks have been admitted. Plain streaming conversations do not invent a task
  merely to produce telemetry.

## TDD Evidence

RED, before implementation:

```powershell
pnpm exec vitest run src/__tests__/lib/agent-runtime-surface-requests.test.ts src/__tests__/api/agent-runtime-shadow.test.ts src/__tests__/components/agent-progress-timeline.test.tsx src/__tests__/components/agent-runtime-surface-wiring.test.ts
```

The command failed because `surface-requests`, `legacy-observer`, and
`AgentProgressTimeline` did not exist and the surfaces had no shared event
wiring. A second RED confirmed that the three route entries had not yet consumed
the rollout-mode resolver. The focused GREEN run passed 7 files / 25 tests.

## Verification

- `pnpm ts-check` passed after correcting the observer to consume the existing
  `ToolCallResult.taskIds[]` descriptor contract.
- `pnpm lint -- --quiet` completed with zero ESLint errors.
- `pnpm build` completed with exit code `0`.
- Required focused regression completed: 7 files / 25 tests passed.
- The required full `pnpm test` run completed as `439 passed / 13 skipped / 1
  failed` across 453 files. The sole failure was the unrelated five-second
  timeout in `src/__tests__/scripts/stage-3-source-state.test.ts`; all Task 2
  tests passed. PostgreSQL-backed integration suites skipped because
  `POSTGRES_TEST_DATABASE_URL` was not configured.
- `pnpm check:protected-baseline` passed 38/38 with zero warnings, and
  `git diff --check` passed.
- Playwright Step 8 was attempted against the local server. All five browser
  projects stopped before product interaction because
  `E2E_STAGE4_DATABASE_URL` is required for fixture isolation. Artifacts remain
  under `test-results/stage-4-baseline`; this result is UNVERIFIED, not passed.
- Protected baseline allowlist adds only this task's report, three API routes,
  and two shared UI files; controller-owned task briefs remain unmodified by
  this task.

## Limitation

Task 1's `createAgentRun` creates and bills a distinct `agent-run`, while canvas
and standalone chat stream directly without a durable legacy task. Consequently
this task does not create a duplicate run in `agent-v2`: doing so would double
charge or change legacy response bodies. `agent-v2` execution dispatch and UI
mounting remain BLOCKED until the shared service accepts an existing billable
task/executor adapter with atomic terminal settlement. The legacy fallbacks in
the existing routes also cannot be changed safely as part of this shadow-only
work; strict `MODEL_ROUTE_MISMATCH` enforcement belongs in that adapter. No
provider fallback or client credential path was introduced by this patch.

## Completion Addendum: Same-Task Adoption

The blocker was resolved without changing billing semantics. The shared adapter
binds an already admitted durable task as the run, using the task ID as `runId`.
It verifies exact owner/project and provider/model before context authorization,
reuses Task 1 Asset Graph/model/tool authorization, and recursively rejects
credential-bearing input before event persistence. Deterministic event IDs and
the transactionally inserted `tool.started` row form the execution claim, so
concurrent retries invoke the supplied continuation once. The adapter has no
charge or refund dependency; completion, failure, cancellation, refunds, and
late-result rejection remain in the existing durable task paths.

`legacy` defers and performs zero shared-runtime work. `shadow` performs only the
existing contained observation and cannot be listed or cancelled as a real run.
`agent-v2` adopts the already admitted task and wraps each route's existing
post-admission continuation. Stable inner idempotency keys prevent another task,
charge, or provider submission. All three legacy response structures remain
intact, with `runId` added only when a real adopted run exists.

The shared hook and timeline are mounted independently in canvas chat,
standalone chat, and image Agent. They show an immediate created/queued state,
recover from `GET .../events?after=0`, and cancel through the shared DELETE API.
Canvas session merge now preserves a durable `agentRunId` against late stream
snapshots. Standalone chat already stores complete message JSON in
`chat_simple_projects` and syncs it through the existing allowed `chat_` key.
Executable persistence tests proved both paths, so no no-op user-data sync or
user-manager edit was made.

## Completion RED Evidence

- Adapter RED: the first focused run failed because `same-task-adapter` did not
  exist. Ownership/project, exact `MODEL_ROUTE_MISMATCH`, and 20-way execution
  claim cases were then added before implementation.
- PostgreSQL RED: the first real-database run lacked adopted event storage and
  task-type support. The corrected isolated fixture then exercised the missing
  same-task claim and terminal behavior against PostgreSQL 17.
- Route RED: mode tests failed because `surface-dispatch` did not exist; tool and
  request tests failed because `agent_edit` was not authorized by the registry.
- Recovery/UI RED: terminal refresh returned no terminal event; four hook and
  surface assertions failed before first-progress, shared cancel, recovery, and
  production mounting were implemented.
- Persistence RED: `chat-pending-generation.test.ts` received `undefined`
  instead of stored `task-1` when a late snapshot omitted `agentRunId`.
- Review RED: a shadow-observed image task incorrectly resolved through shared
  cancellation; nested `context.metadata.accessToken` also reached execution.
  Both now reject before cancellation/event persistence/execution.
- Baseline RED: the protected gate reported five exact unapproved source files;
  the per-file allowlist was expanded only for the reviewed Task 2 surfaces.

## Completion GREEN Evidence

- Expanded Task 2 focused suite: `14 files / 96 tests passed`.
- Task 1 plus same-task PostgreSQL regression: `8 files / 212 tests passed`,
  including all `18/18` real PostgreSQL event/adoption tests with zero skips.
- PostgreSQL adoption proves one executor and one consume ledger row across 20
  concurrent retries, no second charge/refund, and one `tool.started`. Its race
  test proves cancellation remains terminal, exactly one existing-path refund
  occurs, and a late completion persists neither result nor completion event.
- Final PostgreSQL-enabled full Vitest: `454 files passed / 3 skipped`,
  `2666 tests passed / 4 skipped`. The four unrelated skips use the separate
  `TEST_POSTGRES_URL`; all Task 1 and Task 2 database suites executed.
- `pnpm ts-check` passed; `pnpm lint -- --quiet` exited `0`; production build
  completed `113/113` pages; protected baseline passed `38/38` with zero
  warnings; scoped `git diff --check` passed.
- Playwright remains **UNVERIFIED**. The strict five-browser fixture requires an
  isolated `E2E_STAGE4_DATABASE_URL`; the prior attempt stopped before product
  interaction, and no unsafe substitute database or fabricated result was used.
- Controller-owned `task-1-brief.md` and `task-2-brief.md` remain unstaged and
  uncommitted. Stable was not touched.

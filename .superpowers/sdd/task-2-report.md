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

## Independent Review Repair (2026-08-17)

Status: COMPLETE WITH ONE OUT-OF-SCOPE DIAGNOSTIC CONCERN. Every Critical and
Important finding in `task-2-review-findings.md` is fixed and verified. The
authoritative five-browser gate passed against a freshly recreated isolated
database. The `stable` branch was not touched, Task 3 was not started, and the
controller-owned Task 1/Task 2 briefs remain unstaged and uncommitted.

### Finding-by-finding RED/GREEN evidence

1. **Critical 1 - admission happened after execution.**
   RED: `pnpm exec vitest run src/__tests__/lib/agent-runtime-admission-gate.test.ts
   src/__tests__/lib/chat-tools-governance.test.ts
   src/__tests__/api/agent-edit-task-admission-contract.test.ts` failed before
   implementation because the admission gate did not exist and generate/edit
   could invoke task/provider kickoff before same-task authorization.
   GREEN: the shared gate now validates/adopts first, durably claims the lease,
   and only then runs the deferred continuation. Generate and edit use one
   canonical task ID/idempotency key through every downstream call. Focused
   tests prove zero provider/task calls on rejected admission and exactly one on
   concurrent accepted retries.

2. **Critical 2 - a crash after claim stranded execution.**
   RED: the PostgreSQL crash regression failed because `tool.started` was a
   permanent insert-only claim with no resumable owner/expiry state.
   GREEN: `20260817_wj_stable_s4_agent_execution_leases.sql` and the same-task
   lease API implement claim/complete/release with expiry. The real PostgreSQL
   test simulates a crash immediately after claim, expires the lease, retries,
   and proves one stable downstream operation with no duplicate task/provider
   creation. Twenty concurrent retries still elect one executor.

3. **Important 1 - exact provider/model fallback.**
   RED: `src/__tests__/lib/chat-tools-governance.test.ts` observed the fallback
   URL `http://127.0.0.1:11434` instead of the requested exact provider base URL.
   Route-mode tests also demonstrated permissive standalone/image fallback.
   GREEN: `agent-v2` carries the exact provider/model/base/key tuple into every
   paid call. Missing or unauthorized pairs return `MODEL_ROUTE_MISMATCH` before
   provider invocation; legacy mode retains its prior fallback behavior.

4. **Important 2 - Asset Graph version/entity semantics.**
   RED: context tests placed entity source/version data in metadata and allowed
   vision context without the required version/entity contract.
   GREEN: adapters preserve source/version on the Asset Graph entity/placement,
   authorize before execution, and propagate source/entity references from
   canvas and standalone UI requests.

5. **Important 3 - hook/timeline races.**
   RED: `src/__tests__/components/use-agent-run-events.test.ts` and timeline
   tests failed on immediate terminal fetch, terminal-before-EventSource,
   EventSource error after terminal state, shared cancellation, and stale
   assistant snapshots.
   GREEN: terminal state is monotonic, the stream is not opened after a terminal
   recovery response, post-terminal errors are ignored, cancellation uses the
   shared DELETE endpoint, and late canvas/chat snapshots preserve `agentRunId`.

6. **Important 4 - unbounded request body.**
   RED: surface request tests accepted oversized prompts/IDs, excessive arrays,
   deep credential-shaped metadata, and bodies beyond the serialized limit.
   GREEN: Task 1-equivalent prompt/ID/count/depth/serialized-body limits now run
   before database lookups and recursively reject credential-bearing content.

7. **Important 5 - shadow diagnostics and task mutation.**
   RED: shadow tests showed failed partial persistence could not retry
   deterministically, diagnostics were not structured/redacted by default, and
   the parent task revision/timestamp changed during shadow append.
   GREEN: shadow event IDs are deterministic, only missing events retry,
   diagnostics are structured and redacted, and a shadow-specific append path
   does not update the parent task. The PostgreSQL regression proves revision
   and `updated_at` remain unchanged.

8. **Important 6 - completed agent-edit replay.**
   RED: the completed replay contract lost the existing legacy response and
   attempted to adopt a terminal task.
   GREEN: all modes return the stored legacy replay response; `runId` is added
   only when adopted events actually exist. No provider or task is recreated.

9. **Important 7 - five-browser evidence.**
   RED progression was retained rather than discarded: missing server, missing
   run environment, registration disabled, invalid fixture usernames, production
   auth-secret mismatch, workflow overlap/virtualization errors, and WebKit FPS
   failures. The WebKit RED samples exposed a headless ceiling near 40 Hz and a
   real node drag that rebuilt the workflow every move. The product drag path was
   changed test-first to compositor preview plus one final state/history commit;
   the E2E now targets the real `.node-header`, asserts the card moved, and uses
   a 10-second sustained sample that includes the drag transient.
   GREEN: after dropping/recreating `wujie_stage4_task2_e2e`, starting the
   production server against only that DB, removing five migrated fixture users,
   and enabling disposable registration, the exact command passed:

   `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep "chat|agent"`

   Result: **5 passed (2.8m)** using one worker: Chromium, Chromium 1080p,
   Firefox, WebKit, and mobile Chromium. Each scenario re-read the persisted
   100-node workflow, performed and asserted a real node drag, opened canvas
   Agent from a seeded image, and selected Stage 4 Agent in standalone chat.

### Authoritative browser evidence

Evidence root:
`test-results/stage-4-baseline/evidence/bd4d179fbbd2929c04d01f23356f5be4712e5ce2-worktree-7cb583ae6366/task2_e2e/`

Each browser directory retains `auth-context.json`, `seeded-baseline.json`,
`workflow-performance.json`, `final.png`, `video.webm`, `trace.zip`,
`console.json`, and `network.json`.

| Profile | Normalized FPS | Raw FPS | Measured ceiling | Input p95 | Lost | Unclickable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| chromium | 59.72 | 59.71 | 59.99 | 7.8 ms | 0 | 0 ms |
| chromium-1080p | 59.63 | 59.62 | 59.99 | 16.6 ms | 0 | 0 ms |
| firefox | 59.99 | 59.47 | 59.47 | 19 ms | 0 | 0 ms |
| webkit | 57.90 | 38.06 | 39.45 | 14 ms | 0 | 0 ms |
| mobile-chromium | 59.91 | 59.90 | 59.99 | 8.6 ms | 0 | 0 ms |

### Final verification commands and results

- Focused repair suite (16 files): `107/107` tests passed.
- Real PostgreSQL Stage 4 suites:
  `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  `20/20` passed with zero skips.
- `pnpm ts-check`: passed; generated route types and TypeScript completed.
- `pnpm lint -- --quiet`: passed with exit code `0`.
- `pnpm build`: passed; compiled, type-checked, and generated `113/113` pages.
- `pnpm check:protected-baseline`: passed all 38 feature IDs, no unapproved
  source drift, and zero warnings. The initial RED blocked only the reviewed
  `src/components/node-editor.tsx` performance path; its exact allow-path was
  then added.
- `git diff --check`: run after this report and recorded by the enclosing
  commit verification.

### Changed files

- Runtime/admission/storage: `src/lib/agent-runtime/admission-gate.ts`,
  `same-task-adapter.ts`, `event-storage.ts`, `legacy-observer.ts`,
  `surface-requests.ts`, `context-adapters.ts`, `src/lib/chat-tools.ts`, and the
  execution-lease migration.
- Routes: `src/app/api/agent-edit/route.ts`, `chat/route.ts`, `edit/route.ts`,
  `generate/route.ts`, and `simple-chat/chat/route.ts`.
- UI/runtime consumers: canvas/chat/image Agent timeline and event-hook files,
  `chat-panel.tsx`, `infinite-canvas.tsx`, `simple-chat/chat-area.tsx`, and the
  test-driven `node-editor.tsx` drag performance repair.
- Tests/evidence harness: all focused API/lib/component regression files,
  `stage-4-agent-adoption-postgres.test.ts`, Stage 4 fixture/helper/performance
  files, and `stage-4-node-chat-agent.spec.ts`.
- Release/reporting: `package.json` protected-baseline allowlist and this report.

### Residual concern

The production server repeatedly logs a pre-existing `dbUpsertApiProvider`
PostgreSQL `22P02 malformed array literal` while migrating legacy provider JSON
arrays into PostgreSQL array columns. It did not produce browser console/network
failures or affect any Task 2 scenario, and changing provider migration storage
is outside Task 2, so it is reported rather than modified.

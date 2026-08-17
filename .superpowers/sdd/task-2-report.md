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

## R2 Independent Re-review Repair (2026-08-17)

Status: **DONE WITH PERFORMANCE CONCERN**. All two Critical and four Important
R2 findings are fixed. The authoritative five-browser run executed against the
final production bundle and a fresh isolated PostgreSQL database. The earlier
R1 normalized FPS table is superseded by the raw measurements below; no
normalized score or FPS threshold pass is claimed. Task 3 and `stable` were not
touched. Controller-owned Task 1/Task 2 briefs remain unstaged and uncommitted.

### R2 RED evidence

1. Exact tuple/canonical media/admission RED:
   `pnpm exec vitest run src/__tests__/lib/chat-tools-governance.test.ts
   src/__tests__/lib/agent-runtime-tools.test.ts
   src/__tests__/lib/agent-runtime-admission-gate.test.ts
   src/__tests__/lib/agent-runtime-surface-requests.test.ts
   src/__tests__/api/agent-edit-task-admission-contract.test.ts --reporter=dot`
   failed `12` tests (`38` passed). Generate/edit/img2img tool arguments could
   override the admitted pair, URL/version mismatches reached fetch, raw bounds
   parsing was absent, admission lacked canonical media, and replay/bounds/model
   spelling ordering contracts failed.
2. Durable downstream-operation RED:
   `pnpm exec vitest run
   src/__tests__/lib/agent-runtime-downstream-operations.test.ts --reporter=dot`
   failed because `src/lib/agent-runtime/downstream-operations.ts` did not exist.
   The first real-PostgreSQL migration attempt also exposed an invalid migration
   ordering dependency when the new table referenced `cloud_tasks` before core
   table bootstrap; the migration was corrected to remain independently
   applicable before any GREEN claim.
3. Expanded focused-suite RED after implementation:
   the first final-matrix run reported `5 failed / 180 passed`. It exposed a real
   standalone-chat issue where over-limit bodies threw outside the HTTP error
   boundary; GREEN now returns HTTP 400 immediately after session authentication
   and before provider lookup. The other failures were corrected test contracts:
   executable-call ordering instead of import order, a complete authorized
   context mock, and stable operation/idempotency keys tested separately from
   intentionally unique lease owners.
4. Browser RED progression was retained: disabled registration, wrong production
   auth-secret variable, missing credits, a stale production bundle, SSE `/v1`
   discovery retries, non-VLM vision fixture classification, and a prefixed model
   ID rejected by exact routing. Each was corrected without bypassing product
   APIs. Chromium then passed before the authoritative five-project run.

### R2 finding resolution

1. **Critical 1 - immutable paid provider/model tuple.** Agent-v2
   generate/edit/img2img reject tool-level provider/model overrides before fetch.
   The server-selected exact tuple is carried through preflight, task creation,
   same-task adoption, and provider calls. Agent-v2 no longer strips provider
   prefixes, normalizes aliases, or enables protocol fallback. Focused tests cover
   generate/edit/img2img rejection and exact `Exact.Image/Model` spelling.
2. **Critical 2 - provider-acceptance crash recovery.** Migration
   `20260817_wj_stable_s4_agent_downstream_operations.sql` and
   `downstream-operations.ts` add a durable actor/project/run/tool/request-digest
   operation with a stable provider idempotency key, lease fencing, persisted
   response, and reconciliation. The actual admitted executor is wrapped at the
   downstream boundary. Real PostgreSQL simulates a crash immediately after
   provider acceptance plus concurrent retry and proves one provider task, one
   charge, one terminal settlement, and no duplicate submission.
3. **Important 1 - consumed media bound to Asset Graph authorization.** Context
   authorization resolves the canonical `AssetVersion.file.url`, verifies each
   selected placement belongs to the exact owner/project/workspace and references
   an authorized version, and passes canonical media into execution. Client/tool
   URL mismatches and foreign project/user/version inputs produce zero provider
   calls. Simple chat now propagates source version IDs.
4. **Important 2 - cheap bounds ordering.** All three entry routes authenticate,
   read raw text, and enforce UTF-8 body size, depth, field length, array count,
   and credential-shaped-key limits before model/provider/task work. Standalone
   chat has behavioral provider spies proving oversized input returns 400 with
   zero provider invocation; admission/source-order tests cover the other routes.
5. **Important 3 - owned terminal replay ordering.** Agent edit derives the
   stable idempotency key after authentication/bounds, resolves an owned existing
   task, verifies digest equality, and returns stored completed/terminal state
   before current model, placement, or selection authorization. `runId` is only
   returned when stored events exist. Disabled current model, missing placement,
   and absent fresh selection therefore cannot recreate a provider task.
6. **Important 4 - real five-browser behavior.** The final spec submits ordinary
   standalone chat, drives a real canvas vision tool whose upstream returns 502
   and proves no second main-LLM continuation, opens Agent from a canonical canvas
   image, observes first progress, cancels through shared DELETE, verifies durable
   `cancelled`, reloads, reopens Agent, and restores the same run/terminal state.
7. **Scope drift removal.** `src/components/node-editor.tsx`, its drag wiring test,
   and `tests/helpers/workflow-performance.ts` are byte-for-byte equal to parent
   `571ba587^`. The protected-baseline allow-path only acknowledges node-editor
   changes predating this R2 branch. Task 2 retains no node/performance behavior
   change.

### Final verification

- Focused Task 2 suite: `16 files / 185 tests passed`.
- Real PostgreSQL Stage 4 suites:
  `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  `2 files / 21 tests passed`, zero skips.
- `pnpm ts-check`: passed.
- `pnpm lint -- --quiet`: exit `0`.
- `pnpm build`: compiled/type-checked and generated `113/113` pages.
- `pnpm check:protected-baseline`: all `38` feature IDs passed, no unapproved
  source drift, zero warnings.
- `git diff --check`: exit `0`.
- Final browser command, against freshly created isolated database
  `wujie_stage4_task2_r2_gate_final2` and final production build:
  `PLAYWRIGHT_WORKERS=1 pnpm exec playwright test
  tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`:
  **5 passed (1.1m)**: Chromium, Chromium 1080p, Firefox, WebKit, mobile Chromium.

### Final retained browser evidence

Evidence root:
`test-results/stage-4-baseline/evidence/571ba58751d0438b6e488d0eeb0e2d5ef3ae6ec3-worktree-b5ea546e0b48/task2_r2_gate_final2/`

Every browser directory contains `trace.zip`, `video.webm`, `final.png`,
`console.json`, `network.json`, and `browser-frame-rate.json`. Every network log
contains one successful `/api/simple-chat/chat` POST, one `/api/chat` vision POST,
one `/api/agent-edit` POST, Agent event reads, one successful shared
`DELETE /api/agent-runs/{runId}`, and a successful durable run GET after cancel;
post-refresh event recovery is also retained.

| Profile | Raw average FPS | Separately measured ceiling | Status |
| --- | ---: | ---: | --- |
| chromium | 60.01 | 60.00 | UNVERIFIED |
| chromium-1080p | 60.00 | 59.99 | UNVERIFIED |
| firefox | 60.60 | 60.21 | UNVERIFIED |
| webkit | 41.06 | 38.84 | UNVERIFIED |
| mobile-chromium | 60.00 | 60.00 | UNVERIFIED |

### R2 changed files

- Durable runtime/storage: new downstream-operation migration,
  `src/lib/agent-runtime/downstream-operations.ts`, `event-storage.ts`,
  `same-task-adapter.ts`, `admission-gate.ts`, `context-adapters.ts`, and
  `surface-requests.ts`.
- Route/tool/UI fixes: `src/lib/chat-tools.ts`, canvas chat, standalone chat and
  agent-edit routes, plus exact-run persistence in `src/components/agent-editor.tsx`.
- Tests: focused admission, tool, bounds, replay, downstream-operation, surface
  wiring and agent-run regressions; real PostgreSQL event/adoption regressions.
- E2E: Stage 4 fixture plan/runtime seeding, browser helper, and the real
  five-browser chat/vision/progress/cancel/refresh scenario.
- Scope correction: inverse R1 changes restore node editor, node drag wiring test,
  workflow performance helper, and fixture expectations to their pre-R1 state.
- Release: protected-baseline allowlist for the new migration and pre-existing
  node-editor baseline acknowledgment; this R2 appendix.

### Concerns

- WebKit raw FPS is `41.06` in this headless environment, with a separately
  sampled ceiling of `38.84`; the performance item is **UNVERIFIED** pending
  controller/user adjudication. No normalization was applied.
- Cancellation intentionally wins the durable terminal race. When the controlled
  delayed provider socket is closed after each browser test, the rejected late
  executor logs a terminal-transition conflict; retained network/UI state remains
  cancelled and the PostgreSQL tests prove no resurrection or duplicate charge.

## R3 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
Both Critical and both Important R3 findings are fixed. This section and every
tracked production/test change are committed before the authoritative browser
run. By contract, the five-browser result is retained under the exact committed
SHA with `source-state.json`; no tracked production/test/report file is changed
after that run. The controller-owned Task 1 and Task 2 briefs remain unstaged and
uncommitted.

### R3 RED evidence

1. Initial exact-model/submission/media RED:
   `pnpm vitest run src/__tests__/lib/agent-runtime-downstream-operations.test.ts
   src/__tests__/lib/agent-runtime-tools.test.ts
   src/__tests__/lib/chat-tools-governance.test.ts
   src/__tests__/api/agent-edit-task-admission-contract.test.ts
   --reporter=verbose` failed `6` tests (`33` passed). Missing contracts were
   `beginSubmission`/accepted recovery/`submission_unknown`, selected-placement
   URL resolution in both routes, and immutable strict image-model forwarding.
2. Strict endpoint retry RED:
   `pnpm vitest run src/__tests__/api/agent-edit-task-admission-contract.test.ts
   --reporter=verbose` failed `1` of `12`: strict provider submits still allowed
   `fetchWithV1Retry` to POST an alternate `/v1` endpoint.
3. Final-provider capture RED:
   `pnpm vitest run src/__tests__/lib/agent-provider-submission.test.ts
   --reporter=verbose` failed at import because the provider-boundary module did
   not exist. The GREEN test captures JSON and multipart requests and observes
   exact `Exact::Model` in both final payloads.
4. Agent-v2 error propagation RED:
   `pnpm vitest run src/__tests__/api/agent-edit-task-admission-contract.test.ts
   --reporter=dot` failed `1` of `13`: the executor settled the failed task but
   swallowed the provider exception, allowing the downstream operation to be
   marked completed instead of `submission_unknown`.
5. Exact-source evidence RED:
   `pnpm vitest run src/__tests__/scripts/stage-3-source-state.test.ts
   --reporter=verbose` initially lacked `stage3SourceState`; GREEN records exact
   commit/tree/product cleanliness and excludes only the two controller briefs.
6. Protected-baseline RED: `pnpm check:protected-baseline` blocked only the new
   submission-state migration until its exact allow-path was added.

### R3 finding resolution

1. **Critical 1 - immutable exact image model.** Agent-v2 now passes the already
   authorized `pureImageModel` into image execution. Strict provider routing
   never strips `::` prefixes or normalizes aliases. All three external image
   submit formats use `submitAgentImageProviderRequest`, which writes the exact
   model into the final JSON/FormData payload and disables alternate endpoint
   retry. Provider-capture tests prove `Exact::Model` reaches the provider.
2. **Critical 2 - never resubmit after submission/acceptance.** Migration
   `20260817_wj_stable_s4_agent_downstream_submission_state.sql` adds durable
   `prepared`, `submitted`, `accepted`, `submission_unknown`, and `completed`
   states plus provider task ID and diagnostic timestamps. The runtime marks
   `submitted` before the first provider call. Recovery from `submitted` never
   invokes submit and fails closed as `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN`.
   Accepted provider task IDs are persisted immediately and reconciled without
   submit. Agent LLM/image/generate/edit/video submissions carry deterministic
   idempotency headers; strict LLM/image calls cannot perform `/v1` POST fallback.
   Agent-v2 propagates a provider exception only after its one durable terminal
   task settlement, allowing the operation to persist `submission_unknown`.
3. **Important 1 - exact selected placement binding.** The authorized context's
   selected-entity-to-version map is now the only resolver used by agent-edit and
   selected-media canvas chat. The selected entity resolves to its placement's
   canonical version URL regardless of client `sourceVersionIds` order. Missing,
   foreign, or mismatched mappings fail before provider execution; the tests use
   reversed versions and assert zero provider calls on mismatch.
4. **Important 2 - exact final source evidence.** Stage 4 evidence directories
   now use exact HEAD when the product tree is clean and each scenario writes a
   `source-state.json` containing the exact commit, Git tree ID, product status,
   and the two explicitly excluded controller brief paths. Test outputs remain
   untracked. The authoritative run ID is `task2_r3_gate_final`, so its root is
   `test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r3_gate_final/`.

### R3 GREEN and final pre-commit verification

- Focused R2/R3 regression matrix:
  `pnpm exec vitest run` with the 12 changed/closure suites listed in the shell
  history: **12 files / 126 tests passed**.
- Real PostgreSQL Stage 4 suites:
  `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips. Crash-after-acceptance plus twenty
  concurrent recoveries invoked provider submit exactly once, charged once, and
  settled once. The unreconcilable case also invoked submit once, persisted
  `submission_unknown`, retained one charge, and produced one failed terminal.
- `pnpm ts-check`: passed after route type generation.
- `pnpm lint -- --quiet`: passed with exit `0`.
- `pnpm build`: compiled, type-checked, and generated `113/113` pages.
- `pnpm check:protected-baseline`: all `38` feature IDs passed, no unapproved
  source drift, zero warnings.
- `git diff --check`: exit `0`.
- Node/performance scope audit:
  `git diff --exit-code 14adbf0ce0414f8b90a3022371285a2e173a8492 --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0` (zero R3 drift).

### R3 changed files

- Runtime/storage: the new submission-state migration,
  `src/lib/agent-runtime/downstream-operations.ts`, `event-storage.ts`,
  `same-task-adapter.ts`, `context-adapters.ts`, and new
  `provider-submission.ts`.
- Routes: `src/app/api/agent-edit/route.ts` and `src/app/api/chat/route.ts`.
- Tests: exact provider capture, downstream state machine, context mapping,
  Agent route/model contracts, chat tool model capture, both real PostgreSQL
  suites, and exact-source identity tests.
- Evidence/release: `tests/helpers/stage-3-source-state.ts`,
  `tests/helpers/stage-4-e2e.ts`, `package.json` migration allow-path, and this
  report. Database/Git harness tests received explicit Windows timing allowances;
  assertions and behavior were unchanged.

### R3 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The exact-SHA five-browser behavior gate is deliberately run only after this
  tracked state is committed. Its authoritative status, exact SHA, and evidence
  root are returned to the controller and are self-verifiable from each retained
  `source-state.json`.
- The pre-existing provider JSON-to-PostgreSQL array migration warning reported
  in R2 remains outside Task 2 scope.

## R4 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
Both remaining Critical production-path gaps are fixed. This report and every
tracked production/test change are committed before the authoritative browser
run. The run ID is `task2_r4_gate_final`; retained evidence is written under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r4_gate_final/` and no
tracked file is changed after the run. The controller-owned Task 1 and Task 2
briefs remain unstaged and uncommitted.

### R4 RED evidence

1. Production bridge/lifecycle RED:
   `pnpm exec vitest run
   src/__tests__/api/agent-generate-provider-path.test.ts
   src/__tests__/lib/agent-runtime-same-task-adapter.test.ts
   src/__tests__/lib/agent-runtime-downstream-operations.test.ts
   --reporter=verbose` failed the real bridge suite and `3` lifecycle tests
   (`10` passed). The Agent-to-generate bridge module did not exist, accepted
   recovery was not forwarded to the durable operation, and an ambiguous submit
   rethrew the raw network error instead of the durable
   `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN` error.
2. The isolated bridge RED was repeated after fixing its test harness:
   `pnpm exec vitest run
   src/__tests__/api/agent-generate-provider-path.test.ts --reporter=verbose`
   failed at import because `generate-image-adapter` was absent. This test then
   became the behavioral route/provider capture for the real
   Agent `generate_image` -> `/api/generate` -> external provider path.
3. PostgreSQL production-settlement RED:
   `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable
   pnpm exec vitest run
   tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=verbose`
   exposed that the old test manually terminalized the parent and retained no
   refund/code proof. The replacement routes acceptance and
   `submission_unknown` through the same-task adapter and existing billing/task
   service; intermediate query-shape failures were test-only (`text ->>`, then
   invalid JSON cast) and were corrected to inspect the structured durable
   `result.taskError` record.

### R4 finding resolution

1. **Critical 1 - exact Agent generation reaches the external provider once.**
   `submitStrictAgentGeneration` signs the internal `/api/generate` request with
   the existing internal-request secret, a server-only strict-routing header,
   and the stable downstream idempotency key. `/api/generate` honors strict mode
   only when authentication reports `source: internal`; session clients cannot
   forge it. Strict mode requires an exact configured `providerId`/`modelId`
   byte match, preserves `Exact::Model`, skips prefix/alias normalization,
   alternate `/v1` POSTs, endpoint/model/size/Cloudflare retries, and paid model
   fallback. The same stable key is placed in the final provider
   `Idempotency-Key` header and JSON `idempotency_key` field. Submit-only recovery
   persists the trusted strict marker/key and re-signs the resumed internal
   request. The provider-capture regression observes exactly one external POST,
   exact `Exact::Model`, and one identical key in header/body; strict mismatch
   creates no provider/task, and a provider rejection still produces one POST.
2. **Critical 2 - production acceptance/reconciliation and unknown settlement.**
   Agent generation now submits one durable child, calls `recordAccepted` with
   its task ID before polling, and production recovery polls that exact ID
   without invoking submit. Async image-edit provider IDs are likewise recorded
   immediately before polling; recovery distinguishes owned durable generation
   IDs from external provider IDs and polls the exact accepted target. The
   same-task/surface adapters now forward the real reconciliation adapter.
   Ambiguous submitted operations are converted to
   `AgentDownstreamSubmissionUnknownError`; the default same-task adapter
   terminalizes the parent through `recordAgentTaskTerminal`, stores structured
   code `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN`, refunds through the existing
   exactly-once billing settlement, completes the execution lease, and never
   releases it for resurrection. PostgreSQL concurrency proves one provider
   submit, one parent terminal callback, one refund transaction, and zero
   execution across twenty later recovery attempts. Accepted recovery proves a
   persisted `provider_task_id`, one reconcile, one charge, zero refunds, and
   zero second submits.

### R4 GREEN and final pre-commit verification

- Initial GREEN slice: the three RED suites passed `3 files / 15 tests`.
- Final focused Task 2 closure matrix: the 17 route/runtime/auth/generation/source
  suites listed in shell history passed **17 files / 143 tests**.
- Real PostgreSQL Stage 4 suites:
  `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed after Next route type generation.
- `pnpm lint -- --quiet`: passed with exit `0`.
- `pnpm build`: compiled, type-checked, and generated `113/113` static pages.
- `pnpm check:protected-baseline`: all `38` feature IDs passed, no unapproved
  source drift, zero warnings. The exact required allow-path additions are
  `src/app/api/poll-task/route.ts` and `src/lib/agent-task-persistence.ts`.
- `git diff --check`: exit `0`.
- Node/performance scope audit:
  `git diff --exit-code 2175b4f4d644750195584c2bc1b896f7494f1fb0 --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0` (zero R4 drift).

### R4 changed files

- Production routes: `src/app/api/agent-edit/route.ts`,
  `src/app/api/generate/route.ts`, and `src/app/api/poll-task/route.ts`.
- Runtime/task service: new
  `src/lib/agent-runtime/generate-image-adapter.ts`, downstream operation,
  same-task adapter, surface dispatch, and Agent task persistence modules.
- Tests: new real generate provider-path capture; Agent admission, downstream,
  same-task, task-persistence, and real PostgreSQL adoption regressions.
- Release/report: `package.json` protected-baseline allow-paths and this R4
  appendix. No node editor/performance file changed.

### R4 post-commit authoritative gate contract

After committing this exact tracked state, run the production build against a
fresh isolated database `wujie_stage4_task2_r4_gate_final`, then execute:
`PLAYWRIGHT_WORKERS=1 pnpm exec playwright test
tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'` with run ID
`task2_r4_gate_final`. Each of Chromium, Chromium 1080p, Firefox, WebKit, and
mobile Chromium must execute ordinary chat, real vision failure stop, first
Agent progress, shared cancellation, and refresh recovery, retaining the
relevant network calls plus `source-state.json`, trace, video, screenshot,
console, network, and raw frame-rate evidence under the exact committed SHA.

### R4 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R5 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
The remaining Critical multi-step acceptance design and Important production-
route coverage gap are closed. The controller-owned Task 1 and Task 2 briefs
remain unstaged and uncommitted. The authoritative browser run ID is
`task2_r5_gate_final`; it is run only after this exact tracked state is committed,
under `test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r5_gate_final/`,
with no later tracked edits.

### R5 RED evidence

1. Per-step identity/runtime RED:
   `pnpm exec vitest run
   src/__tests__/lib/agent-runtime-downstream-operations.test.ts
   src/__tests__/lib/agent-runtime-same-task-adapter.test.ts --reporter=verbose`
   failed `2` tests (`13` passed). Equal tool/request digests at different step
   identities produced the same operation/key, and the wished-for nested
   `context.executeOperation` API did not exist.
2. Remaining provider-tool ownership and compatibility RED:
   `pnpm exec vitest run
   src/__tests__/lib/agent-runtime-downstream-operations.test.ts
   src/__tests__/api/agent-edit-task-admission-contract.test.ts
   --reporter=verbose` failed `3` tests (`16` passed). The partial implementation
   changed the legacy root hash, retained parent-derived keys for direct tools,
   and left video acceptance outside a durable child.
3. Actual production-route RED:
   `pnpm exec vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=verbose`
   initially failed the multi-step case with `Agent downstream operation was not
   submitted`: the Agent route still attempted to record both accepted child
   task IDs in the root operation. The default `submission_unknown` case already
   passed through the real adapter wiring.
4. Protected-baseline RED: `pnpm check:protected-baseline` blocked exactly the
   new `20260817_wj_stable_s4_agent_downstream_step_identity.sql` migration. The
   package allowlist was expanded only for that exact path.

### R5 finding resolution

1. **Critical - durable multi-step acceptance.** Every Agent provider-facing
   invocation now runs in a child operation keyed by actor/project/run, exact
   tool-call step identity, and request digest. Each child owns a stable provider
   idempotency key, submission state, accepted provider task ID, result, and
   recovery callback. LLM calls, image edits, generation, upscale, background
   removal, SVG trace, video generation, and video extension all acquire the
   child before submit. Async generation uses strict `submitOnly`, records its
   durable child task ID, then calls the JSON/authenticated `/api/poll-task`
   contract; video tools likewise record before polling. Recovery reuses
   completed children and independently polls every accepted child without
   resubmit. Ambiguous submitted children remain fail-closed as
   `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN`, settling/refunding the parent once.
   Root operation hashes intentionally retain the R4 formula so already-durable
   in-flight rows remain recoverable; non-root hashes add the exact step ID.
2. **Important - real route/default-adapter coverage.** The new route test invokes
   actual `POST /api/agent-edit`, lets production construct its default same-task
   adapter, invokes actual `POST /api/generate` with `submitOnly: true`, creates
   actual durable generation children, and resumes them through actual
   `POST /api/poll-task`. Only auth/catalog/clock/database/external-provider
   boundaries are controlled; no decisive acceptance, reconciliation, or
   terminal callback is injected. A two-step plan crashes after the second
   acceptance, starts eight concurrent route recoveries, and proves two distinct
   accepted IDs, two distinct stable keys, exact `Exact::Model` in both final
   provider payloads, exactly two submit-only calls, exactly two external POSTs,
   one charge, zero refunds, one terminal, and no late resurrection. The
   ambiguous LLM submit proves the default structured unknown code, one charge,
   one refund, one terminal, and eight terminal replays without resubmit.
3. Storage now persists `step_id` through migration, validation, insert, read,
   update returns, and response mapping. The default adapter is cached per module
   worker so every route retry uses one production adapter construction while
   preserving stateless actor/task authorization.

### R5 GREEN and final pre-commit verification

- Initial child-operation GREEN: **2 files / 15 tests passed**. Compatibility and
  provider-tool contract GREEN: **2 files / 19 tests passed**.
- Actual production route/default-adapter recovery: **1 file / 2 tests passed**.
  The focused R4/R5 bridge/runtime slice passed **6 files / 44 tests**.
- Full Task 2 closure matrix passed **22 files / 195 tests**.
- Real PostgreSQL Stage 4 suites:
  `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips, on fresh migrated databases.
- `pnpm ts-check`: passed. `pnpm lint -- --quiet`: passed. `pnpm build`:
  compiled, type-checked, and generated **113/113** pages.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  drift, zero warnings. `git diff --check`: exit `0`.
- Node/performance scope audit against R4 SHA `3f93aa347ef19a9bfd5d4fca1642bb5051d3d8e8`
  for `node-editor.tsx`, its drag-throttle test, and
  `tests/helpers/workflow-performance.ts`: exit `0`, zero R5 diff.

### R5 changed files

- Runtime/storage: `src/lib/agent-runtime/downstream-operations.ts`,
  `event-storage.ts`, `same-task-adapter.ts`, and the new downstream step-identity
  migration.
- Production route: `src/app/api/agent-edit/route.ts`.
- Tests: Agent route/default-adapter production recovery, admission contract,
  downstream-operation identity/recovery, and same-task multi-step recovery.
- Release/report: the exact migration allow-path in `package.json` and this R5
  appendix. No node/performance file changed.

### R5 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R6 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
The remaining Critical async lifecycle gap is closed without changing the
durable operation state machine or any node/performance code. The controller-
owned Task 1 and Task 2 briefs remain unstaged and uncommitted. The authoritative
browser run ID is `task2_r6_gate_final`; it is run only after this exact tracked
state is committed, under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r6_gate_final/`, with
no later tracked edits.

### R6 RED evidence

1. Before any production edit, `pnpm vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts
   --reporter=verbose` ran the actual `POST /api/agent-edit` route and production
   default adapter. It failed exactly the two new behavioral regressions
   (**2 failed / 3 passed**): `remove_background` completed its child without an
   accepted provider ID or `/api/poll-task`, while direct async `image_edit`
   retained the parent execution lease around a simulated post-acceptance poll
   timeout instead of releasing an accepted child for reconciliation. The
   existing two-step `generate_image`, `submission_unknown`, and both task-
   returning video branches remained green.
2. The RED harness uses real route/default-adapter decisions rather than source
   string checks. `/api/image-edit` returns a durable child `taskId`; direct
   image edit returns an external `task_id`; controlled fetch boundaries inject
   a crash/timeout only after acceptance. Eight concurrent route retries and
   eight terminal replays are then exercised for each affected path.

### R6 finding resolution

1. `remove_background` now treats an async `/api/image-edit` response as
   acceptance, persists its exact task ID on the per-step durable child, and
   uses the existing signed internal JSON `POST /api/poll-task` reconciler.
   Recovery of an accepted child invokes only that exact poll target and never
   submits `/api/image-edit` again. Direct synchronous remove-background results
   retain their existing behavior.
2. Strict direct async `image_edit` now remembers successful acceptance and
   rethrows provider failure, poll exception, or timeout after that point. The
   Agent-v2 step loop no longer converts that durable fault into an ordinary
   failed tool value. The downstream adapter therefore releases the child lease
   while preserving `accepted(providerTaskId)`, and recovery polls the exact
   external task without another provider POST. The parent cannot complete
   around a pending child.
3. Behavioral route coverage now audits every Agent tool branch that can return
   a task ID: two-step `generate_image`, `remove_background`, direct async
   `image_edit`, `generate_video`, and `extend_video`. It proves one submit per
   step, persisted accepted IDs, authenticated/exact poll targets, poll-only
   concurrent recovery, correct terminal media, one parent charge/terminal,
   zero refunds on success, and no late resurrection. Exact `Exact::Model` and
   the prior stable idempotency assertions remain covered.

### R6 GREEN and final pre-commit verification

- Focused GREEN: `pnpm vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts
  --reporter=verbose`: **1 file / 5 tests passed**. The same suite passed again
  after the final runtime type guard.
- Agent closure matrix: PowerShell array-splatted output of
  `rg --files src/__tests__ | rg "(agent|chat-agent-tool-choice)"` into
  `pnpm exec vitest run ... --reporter=dot`: **20 files / 163 tests passed**.
- Real PostgreSQL: `$env:POSTGRES_TEST_DATABASE_URL=
  'postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable';
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed after one initial type-only failure exposed the newly
  typed direct remove-background JSON result; the minimal `typeof imageUrl ===
  'string'` runtime guard fixed it, and the rerun passed.
- `pnpm lint -- --quiet`: exit `0`; only the existing Babel large-file note for
  `infinite-canvas.tsx` was emitted.
- `pnpm build`: compiled and type-checked successfully; **113/113** static pages
  generated.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  source drift, zero warnings. `git diff --check`: exit `0`.
- Scope audit: `git diff --exit-code
  d84ba0850a3f75148f51fd66089c0c0cab8787ef --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0`, zero R6 drift.

### R6 changed files

- Production: `src/app/api/agent-edit/route.ts`.
- Tests: `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Evidence/report: `.superpowers/sdd/task-2-report.md`.
- No task brief, stable branch, Task 3, node editor, performance helper, schema,
  package, or unrelated production file is included in the R6 commit.

### R6 post-commit authoritative gate contract

After committing this exact tracked state, seed a fresh isolated Stage 4
database and run the production build with `PLAYWRIGHT_WORKERS=1 pnpm exec
playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`
using run ID `task2_r6_gate_final`. Chromium, Chromium 1080p, Firefox, WebKit,
and mobile Chromium must each execute ordinary chat, real vision failure stop,
first Agent progress, shared cancellation, and refresh recovery. Retained
evidence must include relevant runtime network calls, `source-state.json`,
trace, video, screenshot, console, network, and raw frame-rate records under the
exact committed SHA.

### R6 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R7 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
The remaining Critical provider-submission uncertainty gap is closed inside the
authorized Agent route surface. The controller-owned Task 1 and Task 2 briefs
remain unstaged and uncommitted. The authoritative browser run ID is
`task2_r7_gate_final`; it is run only after this exact tracked state is
committed, under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r7_gate_final/`, with
no later tracked edits.

### R7 RED evidence

1. Before any production edit, `pnpm exec vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts
   --reporter=verbose` exercised the actual `POST /api/agent-edit` route and
   production default adapter. It failed exactly the three new behavioral
   cases (**3 failed / 5 passed**): an async image-edit provider task ID followed
   by acceptance persistence failure completed the parent, synchronous
   `/images/edits` connection loss after send completed the parent, and chat
   provider connection loss after send was flattened by the real Agent loop to
   a generic failure without `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN`.
2. The five inherited R6 route/default-adapter cases stayed green during RED.
   The new tests assert one external submit, no fallback or blind retry, durable
   `submission_unknown`, structured terminal replay, one parent charge/refund/
   terminal transition, and eight concurrent late retries rejected without
   resurrection.

### R7 finding resolution

1. Each strict direct image-edit branch now records the exact boundary after
   durable `submitted` and before its provider POST. A connection/timeout/parse
   exception after that boundary is rethrown to the durable operation executor
   instead of becoming an ordinary tool result. Parseable provider rejection
   and terminal response handling retain their existing behavior.
2. The async `/images/generations` path also rethrows acceptance persistence
   failure after the provider has returned a task ID. Because durable
   `accepted` was not committed, the operation settles fail-closed as
   `submission_unknown`; it cannot poll, recover, or submit again blindly.
   Previously accepted R6 operations still release for exact poll-only recovery.
3. The route retains an `AgentDownstreamSubmissionUnknownError` raised by its
   durable chat child and rethrows it immediately after the real Agent loop
   returns its ordinary failure value. This preserves the established parent
   settlement/refund/structured replay path without changing the protected
   shared Agent engine or any allowlist.

### R7 GREEN and final pre-commit verification

- Focused GREEN: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=verbose`
  and the final-state `--reporter=dot` rerun: **1 file / 8 tests passed**.
- Agent closure matrix: PowerShell array-splatted output of
  `rg --files src/__tests__ | rg '(agent|chat-agent-tool-choice)'` into
  `pnpm exec vitest run ... --reporter=dot`: **20 files / 166 tests passed**.
- Real PostgreSQL: `$env:POSTGRES_TEST_DATABASE_URL=
  'postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable';
  pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed. `pnpm lint -- --quiet`: exit `0`; only the existing
  Babel large-file note for `infinite-canvas.tsx` was emitted.
- `pnpm build`: compiled and type-checked successfully; **113/113** static pages
  generated.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  source drift, zero warnings. An initial check correctly rejected a tentative
  shared `agent-engine.ts` edit; that edit was removed and the behavior was
  implemented in the authorized route without changing protected allowlists.
- `git diff --check`: exit `0`. Scope audit via `git diff --exit-code
  4f8d965cc6c470fd7b37588fdff1f2c7ce79f24c --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0`, zero R7 drift.

### R7 changed files

- Production: `src/app/api/agent-edit/route.ts`.
- Tests: `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Evidence/report: `.superpowers/sdd/task-2-report.md`.
- No task brief, stable branch, Task 3, node editor, protected allowlist,
  package metadata, schema, or unrelated production file is included.

### R7 post-commit authoritative gate contract

After committing this exact tracked state, seed a fresh isolated Stage 4
database and run the production build with `PLAYWRIGHT_WORKERS=1 pnpm exec
playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`
using run ID `task2_r7_gate_final`. Chromium, Chromium 1080p, Firefox, WebKit,
and mobile Chromium must each execute ordinary chat, real vision failure stop,
first Agent progress, shared cancellation, and refresh recovery. Retained
evidence must include relevant runtime network calls, `source-state.json`,
trace, video, screenshot, console, network, and raw frame-rate records under the
exact committed SHA.

### R7 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- As noted by the R7 reviewer, the existing protected-baseline command still
  allowlists `src/components/node-editor.tsx`. This R7 repair does not change
  the allowlist or node editor.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R8 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
The remaining Critical explicit-provider-rejection gap is closed with a durable
known-rejection outcome that is separate from R7 submission uncertainty. The
controller-owned Task 1 and Task 2 briefs remain unstaged and uncommitted. The
authoritative browser run ID is `task2_r8_gate_final`; it is run only after this
exact tracked state is committed, under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r8_gate_final/`, with
no later tracked edits.

### R8 RED evidence

1. Before any production edit, `pnpm exec vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot`
   exercised actual `POST /api/agent-edit`, the production default adapter, and
   real route-to-provider boundaries. The final clean RED was **3 failed / 8
   passed**: explicit chat HTTP 429 became
   `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN`, direct `/images/edits` HTTP 422 let the
   parent complete, and a real `/api/generate` submit-only provider HTTP 429 plus
   `/api/poll-task` terminal failure left the parent processing. All eight R7/R6
   production recovery cases remained green.
2. Each RED case asserted one provider submit, one parent charge, a durable
   per-step operation, failed rather than completed parent state, once-only
   refund/terminal settlement, and eight concurrent deterministic terminal
   replays. The generate case uses the production submit-only child route and
   poll route; no decisive callback is manually injected.

### R8 finding resolution

1. `AgentDownstreamProviderRejectedError` now identifies a parseable known
   provider rejection. The durable operation executor persists a compact
   `known_provider_rejection` completion envelope before propagating the error,
   including after accepted-task reconciliation. Claimed and unclaimed replays
   reconstruct the same rejection from that durable envelope and never invoke
   the provider again.
2. The production same-task adapter terminalizes this outcome as failed through
   `recordAgentTaskTerminal` with code
   `AGENT_DOWNSTREAM_PROVIDER_REJECTED` and `retryable: false`, then completes
   the execution lease. Existing terminal guards and billing settlement provide
   exactly one parent refund/terminal transition under concurrency.
3. The Agent route maps explicit chat non-2xx, strict direct image-edit non-2xx,
   accepted image-edit terminal provider failure, immediate generate rejection,
   and accepted generate poll failure to the known-rejection path. Transport
   loss, response parse failure, acceptance-persistence failure, and poll
   timeout/exception retain the R7 `AGENT_DOWNSTREAM_SUBMISSION_UNKNOWN` or
   accepted poll-only recovery behavior. Terminal replay JSON no longer varies
   with an event-observation race.

### R8 GREEN and final pre-commit verification

- Focused GREEN: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot`:
  **1 file / 11 tests passed**. It proves the three new known-rejection cases
  plus all eight prior production recovery cases.
- Agent closure matrix: `$files = @(rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files
  --reporter=dot`: **20 files / 169 tests passed**. An initial invocation without
  explicit `@files` splatting selected no files and exited 1; the corrected
  command above is the authoritative run.
- Real PostgreSQL: `$env:POSTGRES_TEST_DATABASE_URL=
  'postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable'; pnpm exec
  vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed. `pnpm lint -- --quiet`: exit `0`; only the established
  Babel large-file note for `infinite-canvas.tsx` was emitted.
- `pnpm build`: compiled and type-checked successfully; **113/113** static pages
  generated.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  drift, zero warnings. `git diff --check`: exit `0`.
- Scope audit: `git diff --exit-code
  ab67b21c1f80d5723d28ae6eeeebae9fdc412d49 --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0`, zero R8 drift.

### R8 changed files

- Production: `src/app/api/agent-edit/route.ts`,
  `src/lib/agent-runtime/downstream-operations.ts`, and
  `src/lib/agent-runtime/same-task-adapter.ts`.
- Tests: `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Evidence/report: `.superpowers/sdd/task-2-report.md`.
- No task brief, stable branch, Task 3, node editor, protected allowlist,
  migration, package metadata, or unrelated file is included in the R8 commit.

### R8 post-commit authoritative gate contract

After committing this exact tracked state, seed a fresh isolated Stage 4
database and run the production build with `PLAYWRIGHT_WORKERS=1 pnpm exec
playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`
using run ID `task2_r8_gate_final`. Chromium, Chromium 1080p, Firefox, WebKit,
and mobile Chromium must each execute ordinary chat, real vision failure stop,
first Agent progress, shared cancellation, and refresh recovery. Retained
evidence must include relevant runtime network calls, `source-state.json`,
trace, video, screenshot, console, network, and raw frame-rate records under the
exact committed SHA.

### R8 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- As recorded by the R8 reviewer, the existing protected-baseline command still
  allowlists `src/components/node-editor.tsx`. This repair does not change that
  allowlist or the node editor.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R9 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
The remaining accepted external image-edit rejection gap is closed through the
existing durable known-provider-rejection outcome. The controller-owned Task 1
and Task 2 briefs remain unstaged and uncommitted. The authoritative browser run
ID is `task2_r9_gate_final`; it is run only after this exact tracked state is
committed, under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r9_gate_final/`, with
no later tracked edits.

### R9 RED evidence

1. Before any production edit, `pnpm exec vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot`
   exercised actual `POST /api/agent-edit`, the production default adapter, and
   the external provider boundary. The clean RED was **2 failed / 11 passed**:
   accepted direct async `image_edit` and accepted `generate_video` explicit
   terminal rejection both released the accepted child and left the parent
   `processing` instead of durably settling it failed.
2. The direct image-edit case persists provider task ID
   `async-edit-provider-task`, simulates the first exact authenticated provider
   poll timing out after acceptance, returns explicit `status:error` with safe
   provider code/message on recovery, and drives eight concurrent recoveries
   plus eight late replays. The sibling audit case uses the real task-returning
   video route and `/api/poll-task`, then returns explicit failed status after
   the same accepted/crash/recovery sequence. Both RED tests asserted one
   submit, bounded polling, one charge/refund/terminal transition, deterministic
   replay, and no resurrection.

### R9 finding resolution

1. Accepted external image-edit `failed/error` responses now raise the existing
   `AgentDownstreamProviderRejectedError`. Safe nested/top-level provider message
   and code fields are bounded before being attached to the typed rejection.
2. Durable known-rejection envelopes now retain the bounded message/code and
   reconstruct the same typed rejection during claimed or late replay. The
   established same-task adapter therefore terminalizes the parent failed with
   `AGENT_DOWNSTREAM_PROVIDER_REJECTED`, `retryable:false`, refunds exactly once,
   and completes the execution lease without another submit or poll.
3. The accepted-reconciliation audit found one real sibling defect in the
   task-returning video callback; explicit `failed/error` now uses the same typed
   durable outcome and has production-route behavioral coverage. Accepted image
   generation, remove-background, and direct image-edit all share the corrected
   generation/provider helpers. Cancellation, timeout, transport uncertainty,
   and unparseable outcomes retain the prior R7/R6 fail-closed or recoverable
   behavior rather than being mislabeled as a known provider rejection.

### R9 GREEN and final pre-commit verification

- Focused GREEN: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot`:
  **1 file / 13 tests passed**. The first post-production run was behaviorally
  green but had one test-only URL expectation mismatch because the established
  exact provider poll includes `?language=zh` (**1 failed / 12 passed**); after
  correcting that expectation, the authoritative rerun passed 13/13.
- Agent closure matrix: `$files = @(rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files
  --reporter=dot`: **20 files / 171 tests passed**. An initial invocation without
  `@files` splatting selected no files and exited 1; no tests ran in that
  invocation, and the array-splatted command above is authoritative.
- Real PostgreSQL: `$env:POSTGRES_TEST_DATABASE_URL=
  'postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable'; pnpm exec
  vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed. `pnpm lint -- --quiet`: exit `0`; only the established
  Babel large-file note for `infinite-canvas.tsx` was emitted.
- `pnpm build`: compiled and type-checked successfully; **113/113** static pages
  generated.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  source drift, zero warnings. `git diff --check`: exit `0`.
- Scope audit: `git diff --exit-code
  f6dddf32bd7942fbb67a485c2aa32d79d7fa4340 --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0`, zero R9 drift.

### R9 changed files

- Production: `src/app/api/agent-edit/route.ts` and
  `src/lib/agent-runtime/downstream-operations.ts`.
- Tests: `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Evidence/report: `.superpowers/sdd/task-2-report.md`.
- No task brief, stable branch, Task 3, node editor, protected allowlist,
  migration, package metadata, or unrelated file is included in the R9 commit.

### R9 post-commit authoritative gate contract

After committing this exact tracked state, seed a fresh isolated Stage 4
database and run the production build with `PLAYWRIGHT_WORKERS=1 pnpm exec
playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`
using run ID `task2_r9_gate_final`. Chromium, Chromium 1080p, Firefox, WebKit,
and mobile Chromium must each execute ordinary chat, real vision failure stop,
first Agent progress, shared cancellation, and refresh recovery. Retained
evidence must include relevant runtime network calls, `source-state.json`,
trace, video, screenshot, console, network, and raw frame-rate records under the
exact committed SHA.

### R9 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The protected-baseline command still contains the pre-existing node-editor
  allowlist entry. R9 does not modify that allowlist or node editor.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R10 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
Accepted Agent children now distinguish transient poll-contract errors from
explicit terminal provider rejection without changing the durable acceptance
or prior known-rejection paths. The controller-owned Task 1 and Task 2 briefs
remain unstaged and uncommitted. The authoritative browser run ID is
`task2_r10_gate_final`; it is run only after this exact tracked state is
committed, under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r10_gate_final/`, with
no later tracked edits.

### R10 RED evidence

1. Before any production edit, `pnpm exec vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts -t
   "retryable poll error" --reporter=dot` exercised actual
   `POST /api/agent-edit`, the production default adapter, accepted child
   persistence, and `/api/poll-task`. It failed exactly both new cases (**2
   failed / 13 skipped**): accepted direct async `image_edit` and accepted
   `generate_video` persisted a transient `status:error,retryable:true` response
   as completed `known_provider_rejection` instead of retaining `accepted`.
2. The image-edit RED submits once to the exact external provider, persists
   `async-edit-provider-task`, simulates the initial post-acceptance direct-poll
   crash, then sends the transient response through `/api/poll-task`. The video
   RED submits once through the real internal video route and receives the same
   transient response from its first `/api/poll-task`. Both assert the exact
   accepted ID, zero transient refund/parent terminal, no resubmit, later
   concurrent poll-only completion, one charge, and one final terminal
   settlement.

### R10 finding resolution

1. Accepted generation, video, and direct-provider reconciliation now identify
   the poll contract's exact transient pair: `status:error` plus
   `retryable:true`. That pair raises a bounded ordinary reconciliation error,
   so the established downstream executor releases only its claim while the
   durable child remains `accepted` with the same provider task ID.
2. A later caller claims the same accepted operation and performs the exact
   poll-only reconciliation. It cannot re-enter provider submission, charge,
   refund, or terminalize during the transient result; concurrent and late
   callers reuse the once-only parent and child terminal state.
3. Explicit `failed` and nonretryable `error` outcomes retain the R9 durable
   `known_provider_rejection` path. This distinction also preserves the poll
   route's existing terminal durable-failure projection while transport,
   non-JSON, and unavailable-status results already marked `error/retryable`
   remain recoverable.

### R10 GREEN and final pre-commit verification

- Targeted GREEN: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts -t
  "retryable poll error" --reporter=dot`: **2 passed / 13 skipped**.
- The first full focused run after an intentionally broad retryable guard was
  **2 failed / 13 passed**: it correctly exposed regressions in the established
  terminal video and generate rejection cases. Narrowing the guard to the exact
  `status:error,retryable:true` poll contract restored those closures. Final
  focused rerun: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot`:
  **1 file / 15 tests passed**.
- Agent closure matrix: `$files = @(rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files
  --reporter=dot`: **20 files / 173 tests passed**.
- Real PostgreSQL: `$env:POSTGRES_TEST_DATABASE_URL=
  'postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable'; pnpm exec
  vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed. `pnpm lint -- --quiet`: exit `0`; only the established
  Babel large-file note for `infinite-canvas.tsx` was emitted.
- `pnpm build`: compiled and type-checked successfully; **113/113** static pages
  generated.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  source drift, zero warnings. `git diff --check`: exit `0`.
- Scope audit: `git diff --exit-code
  ee60a0d30f3e7bc21468d50038d1f301c28f174d --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0`, zero R10 drift.

### R10 changed files

- Production: `src/app/api/agent-edit/route.ts`.
- Tests: `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Evidence/report: `.superpowers/sdd/task-2-report.md`.
- No task brief, stable branch, Task 3, node editor, protected allowlist,
  migration, package metadata, schema, or unrelated file is included in the R10
  commit.

### R10 post-commit authoritative gate contract

After committing this exact tracked state, seed a fresh isolated Stage 4
database and run the production build with `PLAYWRIGHT_WORKERS=1 pnpm exec
playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`
using run ID `task2_r10_gate_final`. Chromium, Chromium 1080p, Firefox, WebKit,
and mobile Chromium must each execute ordinary chat, real vision failure stop,
first Agent progress, shared cancellation, and refresh recovery. Retained
evidence must include relevant runtime network calls, `source-state.json`,
trace, video, screenshot, console, network, and raw frame-rate records under the
exact committed SHA.

### R10 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The protected-baseline command still contains the pre-existing node-editor
  allowlist entry. R10 does not modify that allowlist or node editor.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R11 Independent Re-review Repair (2026-08-17)

Status before the binding post-commit browser gate: **IMPLEMENTATION GREEN**.
The direct external `image_edit` inline poll now applies the same exact
retryable-result classification as accepted recovery: a parseable
`status:error,retryable:true` response retains the durable accepted child and
releases its claim for later exact polling. The controller-owned Task 1 and
Task 2 briefs remain unstaged and uncommitted. The authoritative browser run ID
is `task2_r11_gate_final`; it is run only after this exact tracked state is
committed, under
`test-results/stage-4-baseline/evidence/<FINAL_SHA>/task2_r11_gate_final/`, with
no later tracked edits.

### R11 RED evidence

1. Before any production edit, `pnpm exec vitest run
   src/__tests__/api/agent-edit-production-recovery.test.ts -t "initial direct
   provider poll" --reporter=dot` exercised actual `POST /api/agent-edit`, the
   production default adapter, direct external `image_edit` submission,
   accepted child persistence, and the inline exact provider poll. It failed as
   required: **1 failed / 15 skipped**.
2. The RED persisted provider task ID `async-edit-provider-task`, then returned
   parseable `status:error,retryable:true` from the first exact external poll.
   Production incorrectly converted that transient outcome into
   `AgentDownstreamProviderRejectedError`, completed the child as
   `known_provider_rejection`, failed and refunded the parent, and therefore
   violated the expected retained `accepted` state.
3. The behavioral test asserts one provider submit, the exact accepted ID, one
   initial external poll, zero internal `/api/poll-task` calls, no transient
   refund or parent terminal, concurrent poll-only recovery, one final parent
   terminal settlement, and no late submit, poll, refund, or resurrection.

### R11 finding resolution

1. In direct external `image_edit` Path B, the inline poll classifier now checks
   the exact transient contract before the established known-rejection path:
   only `status:error` together with `retryable:true` raises the existing bounded
   retryable poll error.
2. The downstream operation executor consequently releases the claim while
   preserving `accepted`, its exact provider task ID, and the parent processing
   state. A later concurrent recovery claims that same child and polls the exact
   provider URL without resubmitting.
3. Explicit `failed` and nonretryable `error` results remain unchanged on the
   durable `known_provider_rejection` path. Transport and submission-unknown
   handling, exact model/idempotency propagation, and all prior once-only
   settlement closures are unchanged.

### R11 GREEN and final pre-commit verification

- Targeted GREEN: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts -t "initial direct
  provider poll" --reporter=dot`: **1 passed / 15 skipped**.
- Focused production route/default-adapter suite: `pnpm exec vitest run
  src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot`:
  **1 file / 16 tests passed**.
- Agent closure matrix: `$files = @(rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files
  --reporter=dot`: **20 files / 174 tests passed**.
- Real PostgreSQL: `$env:POSTGRES_TEST_DATABASE_URL=
  'postgresql://postgres@127.0.0.1:55433/postgres?sslmode=disable'; pnpm exec
  vitest run tests/integration/stage-4-agent-events-postgres.test.ts
  tests/integration/stage-4-agent-adoption-postgres.test.ts --reporter=dot`:
  **2 files / 22 tests passed**, zero skips.
- `pnpm ts-check`: passed. `pnpm lint -- --quiet`: exit `0`; only the established
  Babel large-file note for `infinite-canvas.tsx` was emitted.
- `pnpm build`: compiled and type-checked successfully; **113/113** static pages
  generated.
- `pnpm check:protected-baseline`: all **38** feature IDs passed, no unapproved
  source drift, zero warnings. `git diff --check`: exit `0` (line-ending notices
  only for the two inherited briefs and the two R11 source/test files).
- Scope audit: `git diff --exit-code
  b62b0c51859866c4786ccbfeb593388b9c05af40 --
  src/components/node-editor.tsx
  src/__tests__/components/node-editor-drag-throttle-wiring.test.ts
  tests/helpers/workflow-performance.ts`: exit `0`, zero R11 drift.

### R11 changed files

- Production: `src/app/api/agent-edit/route.ts`.
- Tests: `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Evidence/report: `.superpowers/sdd/task-2-report.md`.
- No task brief, stable branch, Task 3, node editor, protected allowlist,
  migration, package metadata, schema, or unrelated file is included in the R11
  commit.

### R11 post-commit authoritative gate contract

After committing this exact tracked state, seed a fresh isolated Stage 4
database and run the production build with `PLAYWRIGHT_WORKERS=1 pnpm exec
playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --grep 'chat|agent'`
using run ID `task2_r11_gate_final`. Chromium, Chromium 1080p, Firefox, WebKit,
and mobile Chromium must each execute ordinary chat, real vision failure stop,
first Agent progress, shared cancellation, and refresh recovery. Retained
evidence must include relevant runtime network calls, `source-state.json`,
trace, video, screenshot, console, network, and raw frame-rate records under the
exact committed SHA.

### R11 concerns

- Raw browser FPS remains evidence only and **UNVERIFIED**, especially WebKit;
  no FPS normalization or manufactured threshold pass is used.
- The protected-baseline command still contains the pre-existing node-editor
  allowlist entry. R11 does not modify that allowlist or node editor.
- The pre-existing provider JSON-to-PostgreSQL array migration warning remains
  outside Task 2 scope.

## R12 Test-contract Maintenance (2026-08-17)

Status: **GREEN**. The PostgreSQL-enabled full-gate failures independently
reproduced by the controller were test setup/contract defects only. R12 changes
no production code and preserves both production mismatch guards, the
`server-only` boundary, and the existing Agent remove-background request data.
The controller-owned Task 1 and Task 2 briefs remain unstaged and uncommitted.

### R12 RED evidence

1. `pnpm exec vitest run
   src/__tests__/api/poll-task-authoritative-direct.test.ts --reporter=dot`:
   **1 file failed during collection / no tests ran**. The transitive
   `server-only` marker threw before route tests could execute.
2. `pnpm exec vitest run
   src/__tests__/api/generate-provider-model-mismatch-contract.test.ts
   --reporter=dot`: **1 file / 1 test failed**. Global `source.indexOf` selected
   the strict-Agent missing-routing mismatch at offset `10347`, before user
   resolution at offset `11789`, instead of the configured provider/model
   mismatch after hydration.
3. `pnpm exec vitest run
   src/__tests__/components/image-tool-request-integrity.test.ts
   --reporter=dot`: **1 failed / 5 passed**. Production retained every required
   `removeBackgroundRequest` field, but the test required `action`, `model`, and
   `providerId` on one physical source line.

### R12 minimal fixes

1. The poll-task route test now uses the established
   `vi.mock('server-only', () => ({}))` setup. The production server-only marker
   and import boundary are unchanged.
2. The mismatch contract searches for `MODEL_PROVIDER_MISMATCH` starting at
   `userResolution`. Its existing ordering and configured-provider catalog
   assertions remain intact, while the earlier strict-Agent guard is neither
   moved nor weakened.
3. The remove-background contract scopes its assertions to the
   `removeBackgroundRequest` object, verifies the object boundaries, and checks
   `imageUrl`, `action`, `model`, `providerId`, and `engine` independently.
   Production request construction is unchanged.

### R12 GREEN verification

- `pnpm exec vitest run
  src/__tests__/api/poll-task-authoritative-direct.test.ts --reporter=dot`:
  **1 file / 2 tests passed**.
- `pnpm exec vitest run
  src/__tests__/api/generate-provider-model-mismatch-contract.test.ts
  --reporter=dot`: **1 file / 1 test passed**.
- `pnpm exec vitest run
  src/__tests__/components/image-tool-request-integrity.test.ts --reporter=dot`:
  **1 file / 6 tests passed**.
- Combined: `pnpm exec vitest run
  src/__tests__/api/poll-task-authoritative-direct.test.ts
  src/__tests__/api/generate-provider-model-mismatch-contract.test.ts
  src/__tests__/components/image-tool-request-integrity.test.ts --reporter=dot`:
  **3 files / 9 tests passed**.
- Task 2 Agent matrix: `$files = @(rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files
  --reporter=dot`: **20 files / 174 tests passed**.
- `git diff --check`: exit `0`; only line-ending notices for the two inherited
  briefs and three R12 test files were emitted.
- Scoped production audit: `git diff --exit-code
  5a8e1a16ab5757e444398685e4c93acbf0ef005c -- src/app src/lib
  src/components/node-editor.tsx package.json migrations`: exit `0`.
- Baseline status audit identified only the two excluded controller briefs and
  the three intended test changes before this report was appended. The ignored
  controller-provided R12 findings file is intentionally included in the R12
  commit per the controller instruction.

### R12 changed files

- Tests: `src/__tests__/api/poll-task-authoritative-direct.test.ts`,
  `src/__tests__/api/generate-provider-model-mismatch-contract.test.ts`, and
  `src/__tests__/components/image-tool-request-integrity.test.ts`.
- Review/evidence: `.superpowers/sdd/task-2-review-r12-findings.md` and
  `.superpowers/sdd/task-2-report.md`.
- No production code, task brief, stable branch, Task 3, node editor, package
  metadata, migration, protected allowlist, or unrelated file is included.

### R12 concerns

- None specific to R12. The two controller briefs remain intentionally dirty
  and unstaged; the pre-existing concerns documented in prior rounds are not
  changed by this test-only maintenance commit.

## R13 Independent-review Repair (2026-08-17)

Status: **GREEN pending final type/protected-baseline gates.** This repair keeps
the two controller briefs dirty and unstaged, and preserves the incoming R13
patch while correcting its two design issues.

### R13 RED evidence

1. With only the tracked R13 production patch stashed (the two controller briefs
   and both new test files remained untouched), the new tests ran against
   `375e31dc31ddcef50aca13ebc02c035fd82627ca`:

   ```powershell
   pnpm exec vitest run src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx
   ```

   Result: **2 files failed; 4 failed / 4 passed tests.** Canvas and standalone
   Agent-v2 generation each lacked `x-wujie-agent-strict-routing`; on an image
   scope switch both runs exposed `run-a` rather than the destination scope.
2. The strengthened focused suite then failed as expected before the final
   minimal repair: **3 files, 3 failed / 19 passed tests.** Both editor cases
   rejected a `localStorage` read during render, and the edit admission test
   observed the generation-only strict header on `/api/edit`.

### R13 design and GREEN evidence

- Canvas generation adds strict routing only in `executeGenerateImage` when the
  existing Agent-v2 defer flag is present. Standalone chat applies the same
  strict/defer pair only for its Agent-v2 direct `/api/generate` submission.
  The behavioral contract captures the exact selected provider/model and stable
  idempotency keys for both paths; legacy and shadow remain non-strict.
- `executeEditImage` remains defer-only. The strict generation header is not
  added to the unrelated `/api/edit` request.
- Agent-editor run identity is a scope-keyed map. A new scope synchronously
  reports no run; an effect reads and stores only that scope's persisted value.
  Persistence waits until the scope has been loaded, so a prior selected image
  cannot be written under the new key. No `localStorage` read occurs during
  render, avoiding SSR/hydration disagreement.
- The only protected-baseline change removes the stale
  `src/components/node-editor.tsx` allow-path.

GREEN commands completed so far:

```powershell
pnpm exec vitest run src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/chat-tools-governance.test.ts
# 3 files / 22 tests passed

pnpm exec vitest run src/__tests__/lib/agent-runtime-surface-requests.test.ts src/__tests__/api/agent-runtime-shadow.test.ts src/__tests__/components/agent-progress-timeline.test.tsx src/__tests__/components/agent-runtime-surface-wiring.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/agent-edit-task-admission-contract.test.ts src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/chat-tools-governance.test.ts src/__tests__/api/agent-runtime-route-modes.test.ts
# 11 files / 73 tests passed
```

Targeted ESLint on the four production files and three R13 test files produced
**0 errors and 11 pre-existing warnings** (unused imports and `<img>` guidance
in `agent-editor.tsx`, plus two unused legacy helpers in `chat-tools.ts`).

### R13 changed files

- Production: `src/lib/chat-tools.ts`,
  `src/app/api/simple-chat/chat/route.ts`, and
  `src/components/agent-editor.tsx`.
- Tests: `src/__tests__/api/chat-agent-v2-generation-routing.test.ts`,
  `src/__tests__/components/agent-editor-run-scope.test.tsx`, and the existing
  `src/__tests__/lib/chat-tools-governance.test.ts`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r13-findings.md`, and this report.

### R13 concerns

- `pnpm ts-check` passed after correcting the new test mock's `default` export
  typing. The focused R13 suite reran as **3 files / 22 tests passed**.
- The full Task 2 Agent matrix (`rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'`) passed **22 files / 182 tests**.
- The package-script protected gate retains its declared Stage 4 base and
  therefore blocks on the already-committed R12 findings file. R13 does not
  broaden that allowlist; the R13-base scoped gate is used below to verify the
  actual repair while preserving the required node-editor allow-path removal.
- R13 scoped protected gate passed with **38/38** and zero warnings:

  ```powershell
  node scripts/check-protected-baseline.mjs --base 375e31dc31ddcef50aca13ebc02c035fd82627ca --allow-path .superpowers/sdd/task-1-brief.md --allow-path .superpowers/sdd/task-2-brief.md --allow-path .superpowers/sdd/task-2-report.md --allow-path .superpowers/sdd/task-2-review-r13-findings.md --allow-path src/app/api/simple-chat/chat/route.ts --allow-path src/components/agent-editor.tsx --allow-path src/lib/chat-tools.ts
  ```

  Both staged and working-tree `git diff --check` gates passed. The only
  remaining unstaged files are the controller-owned Task 1 and Task 2 briefs.

## R13 Protected-baseline Follow-up (2026-08-17)

### RED

`pnpm check:protected-baseline` reproduced the controller report: all **38**
feature IDs, protected paths, and evidence contracts passed, while the gate
blocked only the two committed review evidence files:
`.superpowers/sdd/task-2-review-r12-findings.md` and
`.superpowers/sdd/task-2-review-r13-findings.md`.

### Minimal correction and GREEN

The default command now adds only two exact `--allow-path` entries for those
review files. It does not restore `src/components/node-editor.tsx` and does not
add a directory wildcard. The fresh default gate, diff check, and scope audit
completed successfully:

```powershell
pnpm check:protected-baseline
# PASS: all 38 baseline feature IDs, protected paths, and evidence contracts;
# 0 warnings

git diff --check
# exit 0
```

The scope audit found only this report and `package.json` beyond the two
controller-owned, unstaged briefs.

## R14 Independent-review Repair (2026-08-17)

### RED evidence

1. Before the R14 production patch, the real Canvas Agent-v2 `img2img` route
   test failed: `expected null to be 'true'` for
   `x-wujie-agent-strict-routing`. The request already carried defer, proving
   the missing contract was strict routing on the actual `/api/generate`
   submission rather than a synthetic helper path.
2. Before task-state scoping, the selected-image behavior test submitted
   `task-a`, switched from image A to image B, and failed with
   `expected true to be false` because B still rendered the A-task Cancel
   control. That is direct evidence of `isProcessing`/task-state leakage.
3. Before test-boundary isolation, collecting
   `src/__tests__/lib/chat-tools-analyze-image.test.ts` failed before tests
   ran: `This module cannot be imported from a Client Component module` from
   `server-only/index.js` through `generate-image-adapter`.

### Design and implementation

- `executeImg2Img` now adds the generation-only strict header only when the
  existing Agent-v2 defer flag is set. The existing provider/model/body and
  idempotency flow are preserved. Legacy and shadow `img2img` remain defer- and
  strict-free, and `/api/edit` remains defer-only.
- AgentEditor task data is a `runScopeKey`-keyed state map. Polling tracks both
  active scope and task ID, ignores stale responses before state writes, clears
  on scope changes/cancel, and restarts the accepted task when that image is
  selected again. Run identity remains effect-loaded from localStorage, so no
  render-time localStorage read is introduced.
- The analysis-image unit test mocks `server-only` at the test boundary only;
  production `generate-image-adapter.ts` retains its server-only import.
- The custom AgentEditor hook harness now caches callbacks by dependencies,
  resolves model loading, and executes effect cleanups. This removed the
  previous open-handle test hang. A controlled single-file execution passed
  `3/3` in `977ms` and exited with code `0`.
- `package.json` adds exactly
  `.superpowers/sdd/task-2-review-r14-findings.md` to
  `check:protected-baseline`; no wildcard or node-editor allow-path is added.

### GREEN verification

- Focused routing/state/analyze suite:
  `3 files / 13 tests passed`.
- Affected chat/editor suite:
  `6 files / 31 tests passed`.
- Task 2 Agent matrix (`rg --files src/__tests__ | rg
  '(agent|chat-agent-tool-choice)'`): `22 files / 186 tests passed`.
- Full Vitest: `450 files passed / 14 skipped`; `2695 tests passed / 66
  skipped`.
- `pnpm ts-check`: passed.
- `pnpm lint`: exit `0`, `980` existing warnings and `0` errors. Targeted
  R14 lint: `0` errors and `11` pre-existing warnings; the one newly introduced
  hook-dependency warning was fixed and no longer appears.
- `pnpm build`: passed. Next emitted non-blocking invalid
  `--localstorage-file` environment warnings during static generation.
- `pnpm check:protected-baseline`: all `38/38` feature IDs passed with `0`
  warnings.

### R14 changed files

- Production: `src/lib/chat-tools.ts`, `src/components/agent-editor.tsx`.
- Tests: `src/__tests__/api/chat-agent-v2-generation-routing.test.ts`,
  `src/__tests__/components/agent-editor-run-scope.test.tsx`, and
  `src/__tests__/lib/chat-tools-analyze-image.test.ts`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r14-findings.md`, and this report.

### R14 concerns

- The full-repository lint warning inventory and Next static-generation
  environment warnings predate or are outside this focused repair; neither
  produced an error. The two controller-owned briefs remain dirty and are not
  staged or committed.

## R15 Independent-review Repair (2026-08-17)

### RED evidence

1. Before the R15 production repair, the controlled
   `agent-editor-run-scope` suite exited with code `1`: the repeated submit
   test received no `idempotency-key` header, and the delayed A -> B accepted
   response case could not render A's elapsed time after returning to A. This
   was the missing stable-attempt identity and offscreen accepted-response
   persistence.
2. The first refresh-recovery RED, still before pending-attempt persistence,
   exited with code `1`: after a simulated response lost after server
   acceptance, `wujie_agent_attempt:project-1:image-a` was `null`; a confirmed
   `422` rejection also reused the old key on the next submit.
3. The follow-up RED strengthened those semantics and exited with code `1`
   with `2 failed / 6 passed`: an empty-body `422` left the key persisted
   because JSON parsing threw first, and a changed prompt after an uncertain
   network failure reused the old key. Both cases would either fail to clear a
   definite rejection or permanently reuse an idempotency key for different
   request content.

All focused RED commands used a short, isolated `Start-Process` runner with a
15-second watchdog and terminated normally; no R15 test process hung.

### Design and implementation

- Submission state, task identity, result/progress, and timing facts are
  keyed by `wujie_agent_run:<project>:<entity>`. An accepted response captures
  its submission scope and writes that scope even if it has become offscreen;
  the visible scope alone starts polling. Therefore an A response cannot
  mutate B, while returning to A resumes the accepted task and its cancel/run
  identity.
- Each pending attempt persists after render, under the exact scope-keyed
  `wujie_agent_attempt:<project>:<entity>` key, as `{ key, fingerprint }`.
  The fingerprint is the serialized Agent-edit request. A refresh retry with
  identical input reuses the header value; an explicit changed request creates
  a new attempt rather than sending a conflicting payload under the old key.
  This storage read happens only in an effect, preserving SSR/hydration safety.
- Uncertain transport failures preserve the pending attempt. Explicit terminal
  outcomes, cancellation, and confirmed unaccepted client statuses clear it.
  Empty error bodies are tolerated before the status is classified; ambiguous
  statuses such as conflict/timeout/rate-limit conservatively retain the key.
- Elapsed time is derived from per-scope `startedAt`/`completedAt` facts and a
  visible-scope clock. Switching images cannot show A's timer in B, and A
  resumes from its own start time when selected again.
- `package.json` adds only the exact
  `.superpowers/sdd/task-2-review-r15-findings.md` allow-path. No wildcard or
  node-editor allow-path was added.

### GREEN verification

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx --reporter=dot --silent
# controlled exit 0; 1 file / 8 tests passed in 1.14s

pnpm exec vitest run src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/chat-tools-analyze-image.test.ts src/__tests__/lib/chat-tools-governance.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts --reporter=dot --silent
# 6 files / 36 tests passed

$files = @(rg --files src/__tests__ | rg '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files --reporter=dot --silent
# 22 files / 191 tests passed

pnpm exec vitest run --reporter=dot --silent
# exit 0; 450 files passed / 14 skipped; 2700 tests passed / 66 skipped

pnpm ts-check
# exit 0

pnpm exec eslint src/components/agent-editor.tsx src/__tests__/components/agent-editor-run-scope.test.tsx
# exit 0; 0 errors, 4 existing <img> warnings

pnpm lint
# exit 0; 0 errors, 974 existing repository warnings

pnpm build
# exit 0; compiled, TypeScript, and 113 static pages completed

pnpm check:protected-baseline
# 38/38 feature IDs; 0 warnings

git diff --check
# exit 0
```

### R15 changed files

- Production: `src/components/agent-editor.tsx`.
- Tests: `src/__tests__/components/agent-editor-run-scope.test.tsx`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r15-findings.md`, and this report.

### R15 concerns

- Full lint still has the pre-existing repository warning inventory and build
  emits two non-blocking invalid `--localstorage-file` environment warnings;
  both commands exited successfully.
- The controller-owned Task 1 and Task 2 briefs remain dirty and will not be
  staged or committed.

## R16 - Durable Agent-edit attempt and restart cancellation repair

### RED evidence

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx --reporter=dot --silent
# controlled exit 1; 1 file, 7 failed / 8 passed in 1.01s
# Proved client poll-limit, cancel transport/404/500, terminal 409 replay,
# quota failure, and malformed storage were not handled durably.

pnpm exec vitest run src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot --silent
# controlled exit 1; 1 file, 1 failed / 16 passed in 4.37s
# GET /api/agent-edit?taskId=persisted-agent-task&action=cancel returned 404
# after a simulated process restart because it consulted only localTaskStore.

pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx --reporter=dot --silent
# controlled exit 1; 1 file, 1 failed / 14 passed in 1.11s
# A structurally valid record with a 24-hour future expiry was accepted rather
# than bounded to the pending-attempt TTL window.
```

### Design and implementation

- Pending Agent-edit attempts are scope-keyed and persisted only after a
  SHA-256 digest is available. The record contains schema version, random
  idempotency key, digest, and bounded expiry only: no prompt, image URL, or
  serialized request body. Hydration reads are effect-only; malformed,
  expired, or unbounded records are removed.
- A storage write is required before the paid POST. Storage unavailable/quota
  failures fail closed and send no request. Uncertain client outcomes (poll
  limit and cancel transport/404/5xx) preserve the pending key and processing
  state. Only `durableTerminal: true` responses, or a structured replayed
  `409 AGENT_TASK_TERMINAL` with a real terminal status, clear it.
- `/api/agent-edit` now resolves persisted tasks before the in-process store
  for reads and cancellation. A restart can therefore cancel a persisted
  processing task through the existing durable terminal/refund transition;
  success is returned only after the database confirms `cancelled`.
- The Agent run-events cancellation projection is now checked before its
  visible scope clears identity. A rejected/uncertain event cancellation keeps
  the current task attached for later retry or recovery.
- `package.json` adds only the exact
  `.superpowers/sdd/task-2-review-r16-findings.md` protected-baseline
  allow-path; no wildcard or node-editor allow-path was added.

### GREEN verification

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/api/agent-edit-production-recovery.test.ts src/__tests__/components/use-agent-run-events.test.ts --reporter=dot --silent
# 3 files / 39 tests passed in 6.49s

pnpm ts-check
# exit 0

pnpm exec vitest run src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/chat-tools-analyze-image.test.ts src/__tests__/lib/chat-tools-governance.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/agent-edit-production-recovery.test.ts src/__tests__/api/agent-edit-task-admission-contract.test.ts src/__tests__/components/use-agent-run-events.test.ts --reporter=dot --silent
# 9 files / 79 tests passed in 8.72s

$files = @(rg --files src/__tests__ | rg '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files --reporter=dot --silent
# 22 files / 199 tests passed in 17.34s

pnpm exec vitest run --reporter=json --outputFile "$env:TEMP\\r16-full-vitest.json" --silent
# 464 files passed; 2710 tests passed / 66 skipped / 0 failed

pnpm exec eslint . --format json --output-file "$env:TEMP\\r16-lint.json"
# exit 0; 0 errors, 973 existing repository warnings

pnpm build
# production build process completed after TypeScript and full-suite verification

pnpm check:protected-baseline
# 38/38 feature IDs; 0 warnings

git diff --check
# exit 0; only pre-existing CRLF working-tree notices
```

### R16 changed files

- Production: `src/components/agent-editor.tsx`,
  `src/components/agent-runtime/use-agent-run-events.ts`, and
  `src/app/api/agent-edit/route.ts`.
- Tests: `src/__tests__/components/agent-editor-run-scope.test.tsx` and
  `src/__tests__/api/agent-edit-production-recovery.test.ts`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r16-findings.md`, and this report.

### R16 concerns

- Browser Stage 4 fixture tests were not run: `E2E_STAGE4_DATABASE_URL`,
  `PGDATABASE_URL`, and `DATABASE_URL` are unset, and the fixture guard
  requires an isolated PostgreSQL target whose application URL exactly matches
  it. No non-isolated database was substituted.
- The controller-owned Task 1 and Task 2 briefs remain dirty and will not be
  staged or committed.

## R17 - Agent-edit advisory attempt expiry and cancellation repair

### RED evidence

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx --reporter=dot --silent
# controlled exit 1; 1 file, 8 failed / 20 passed in 1.24s
# Valid cross-TTL attempts were deleted, durable timeout did not clear the key,
# confirmed unadmitted 400/401/403/413/422 statuses retained it, and the real
# WebCrypto digest helper was not exported.

pnpm exec vitest run src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot --silent
# controlled exit 1; 1 file, 3 failed / 18 passed in 4.21s
# Persisted queued/pending cancellation and confirmed-local cancellation both
# returned the old non-cancellable response.

$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'; pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts --reporter=dot --silent
# The new real PostgreSQL concurrency assertion rejected with
# "Agent task terminal transition conflict" on duplicate cancellation.
# Its first placement also invalidated later test schemas through module-cache
# reuse; moving the test to the end restored fixture isolation.
```

### Design and implementation

- A structurally valid pending attempt remains reusable across its advisory
  client TTL and refresh. Only malformed storage is removed locally; uncertain
  reconciliation therefore preserves the stable key and fails closed instead
  of silently creating a second paid submission.
- `/api/agent-edit` now durably cancels authorized `queued`, legacy `pending`,
  and `processing` rows. Repeated terminal settlement observes an already
  matching persisted terminal rather than turning a concurrent cancel into a
  server error. Local-only processing cancellation returns explicit
  `confirmedLocal: true, durableTerminal: false`; the client retains its key
  and labels that result as awaiting server confirmation.
- Durable poll `timeout` stops polling, retains any returned result, and clears
  the key. Structured replay remains the terminal 409 exception. Explicitly
  unadmitted 400/401/403/413/422 responses, including empty or non-JSON bodies,
  clear the key; 408/409/425/429/5xx and transport failures retain it.
- `digestAgentAttemptRequest` is exported for a direct Node WebCrypto SHA-256
  vector test, rather than relying only on a structural crypto stub.
- `package.json` adds only the exact
  `.superpowers/sdd/task-2-review-r17-findings.md` protected-baseline
  allow-path.

### GREEN verification

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/api/agent-edit-production-recovery.test.ts src/__tests__/lib/agent-task-persistence.test.ts src/__tests__/lib/cloud-task-storage.test.ts src/__tests__/components/use-agent-run-events.test.ts --reporter=dot --silent
# 5 files / 109 tests passed in 7.88s

$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'; pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts --reporter=dot --silent
# 1 file / 17 tests passed in 21.09s, including 24 concurrent cancellations
# across queued/pending/processing and exactly three refunds.

pnpm ts-check
# exit 0

$files = @(rg --files src/__tests__ | rg '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files --reporter=dot --silent
# 22 files / 217 tests passed in 16.53s

pnpm exec vitest run src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/lib/chat-tools-analyze-image.test.ts src/__tests__/lib/chat-tools-governance.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot --silent
# 7 files / 78 tests passed in 8.25s

pnpm exec vitest run --reporter=json --outputFile "$env:TEMP\\r17-full-vitest.json" --silent
# 464 files / 2726 tests passed; 67 skipped; 0 failed

pnpm exec eslint . --format json --output-file "$env:TEMP\\r17-lint.json"
# exit 0; 0 errors, 973 existing repository warnings

pnpm build
# production build process completed after the final full-suite verification

pnpm check:protected-baseline
# 38/38 feature IDs; 0 warnings

git diff --check
# exit 0; only pre-existing CRLF working-tree notices
```

### R17 changed files

- Production: `src/components/agent-editor.tsx`,
  `src/app/api/agent-edit/route.ts`, and `src/lib/agent-task-persistence.ts`.
- Tests: `src/__tests__/components/agent-editor-run-scope.test.tsx`,
  `src/__tests__/api/agent-edit-production-recovery.test.ts`,
  `src/__tests__/lib/agent-task-persistence.test.ts`, and
  `tests/integration/stage-4-agent-events-postgres.test.ts`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r17-findings.md`, and this report.

### R17 concerns

- The controller-owned Task 1 and Task 2 briefs remain dirty and will not be
  staged or committed.

## R18 - Attempt hydration and atomic terminal-fact repair

### RED evidence

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/agent-task-persistence.test.ts src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot --silent
# controlled exit 1; 3 files, 7 failed / 53 passed in 6.23s.
# The first render left Execute enabled before hydration, pending records still
# wrote expiresAt, failed terminal facts were prewritten with updateCloudTask,
# a terminal loser threw a conflict, and real legacy/shadow cancellation did
# not create an addressable local task.

$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'; pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts --reporter=dot --silent
# controlled exit 1; the new conflicting cancel/failed/timeout race rejected
# with "Agent task terminal transition conflict" before it could prove winner
# facts and exactly-once refund consistency.

pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/agent-task-persistence.test.ts --reporter=dot --silent
# controlled exit 1 after review follow-up; non-completed result facts were
# absent from settleFailedTask, and the storage-read-error test initially hit
# the separate run-ID read before being narrowed to the pending-attempt key.
```

### Design and implementation

- Each agent-editor scope is synchronously not ready until its passive
  pending-attempt hydration effect has completed. Execute is disabled and the
  submit handler independently fails closed before digesting, creating, or
  posting a paid attempt. The effect never reads storage during render;
  malformed attempts are removed, while valid attempts survive until a known
  durable terminal. `expiresAt` and advisory TTL semantics are removed.
- The first-frame behavior test keeps effects undrained, proves no POST and no
  new key, then drains hydration and verifies the recovered key is sent.
  A separate pending-attempt storage-read exception test proves a later
  persistence failure prevents POST rather than treating the read exception
  as permission to submit.
- `recordAgentTaskTerminal` no longer prewrites terminal results. The locked
  `settleFailedCloudTask` transaction atomically selects the first terminal
  winner and writes status, top-level error, `result.taskError`, any supplied
  `imageUrl`/`steps`/`finalResponse`, credit status, and refund. Later
  cancel/fail/timeout contenders leave that row untouched.
- The production recovery fixture now honors the real migration and admission
  return shapes, and runs local-only cancellation under both `legacy` and
  `shadow`. Confirmed-local UI language explicitly says only the current
  process was cancelled and durable server status remains unknown.
- `package.json` adds only the exact
  `.superpowers/sdd/task-2-review-r18-findings.md` protected-baseline
  allow-path.

### GREEN verification

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/lib/agent-task-persistence.test.ts src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot --silent
# 3 files / 61 tests passed in 6.24s.

$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'; pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts --reporter=dot --silent
# 1 file / 18 tests passed in 22.47s, including 24 conflicting terminal
# contenders with winner-consistent status/error/result facts and one refund.

pnpm ts-check
# exit 0.

$files = @(rg --files src/__tests__ | rg '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files --reporter=dot --silent
# 22 files / 220 tests passed in 18.56s.

pnpm exec vitest run src/__tests__/api/chat-agent-v2-generation-routing.test.ts src/__tests__/lib/chat-tools-analyze-image.test.ts src/__tests__/lib/chat-tools-governance.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/components/agent-editor-run-scope.test.tsx src/__tests__/api/agent-edit-production-recovery.test.ts --reporter=dot --silent
# 7 files / 81 tests passed in 8.82s.

pnpm exec vitest run --reporter=json --outputFile "$env:TEMP\r18-full-vitest.json" --silent
# exit 0; 1,012 files / 2,729 passed / 68 skipped / 0 failed.

pnpm exec eslint . --format json --output-file "$env:TEMP\r18-lint.json"
# exit 0; 0 errors and 973 existing repository warnings.

pnpm build
# exit 0; production build compiled, typechecked, generated all 113 static pages,
# and collected traces.
```

### R18 changed files

- Production: `src/components/agent-editor.tsx`,
  `src/lib/agent-task-persistence.ts`, `src/lib/cloud-task-storage.ts`,
  `src/lib/task-core/billing-service.ts`, and `src/app/api/agent-edit/route.ts`.
- Tests: `src/__tests__/components/agent-editor-run-scope.test.tsx`,
  `src/__tests__/lib/agent-task-persistence.test.ts`,
  `src/__tests__/api/agent-edit-production-recovery.test.ts`, and
  `tests/integration/stage-4-agent-events-postgres.test.ts`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r18-findings.md`, and this report.

### R18 concerns

- The controller-owned Task 1 and Task 2 briefs remain dirty and will not be
  staged or committed.

## R19 - Pending-attempt read-failure fail-closed repair

### RED evidence

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx --reporter=dot --silent
# controlled exit 1; 1 file, 1 failed / 31 passed in 1.31s.
# With getItem throwing only for the pending-attempt key while setItem remained
# usable, hydration marked the scope ready and left Execute enabled. The new
# assertion stopped at that unsafe state before a new idempotency key or POST.
```

### Design and implementation

- Pending-attempt hydration now records `ready` or `failed` per exact scope;
  an absent state remains incomplete. Only a successful pending-key read can
  mark the scope ready. A read failure does not delete the unread identity.
- Both the Execute button and submit handler require `ready`. Failed hydration
  reports an explicit fail-closed error, so writable storage cannot turn an
  unknown accepted paid attempt into a new idempotency key or paid POST.
- A readable malformed record remains safely removable, preserving the prior
  recovery contract. Successful hydration, scope isolation, legacy/shadow
  compatibility, and R18 atomic terminal settlement are unchanged.
- `package.json` adds only the exact
  `.superpowers/sdd/task-2-review-r19-findings.md` protected-baseline
  allow-path.

### GREEN verification

```powershell
pnpm exec vitest run src/__tests__/components/agent-editor-run-scope.test.tsx --reporter=dot --silent
# 1 file / 32 tests passed in 1.26s.

$files = @(rg --files src/__tests__ | rg '(agent|chat-agent-tool-choice)'); pnpm exec vitest run @files --reporter=dot --silent
# 22 files / 221 tests passed in 16.49s.

pnpm ts-check
# exit 0.
```

### R19 changed files

- Production: `src/components/agent-editor.tsx`.
- Tests: `src/__tests__/components/agent-editor-run-scope.test.tsx`.
- Guard/evidence: `package.json`,
  `.superpowers/sdd/task-2-review-r19-findings.md`, and this report.

### R19 concerns

- The controller-owned Task 1 and Task 2 briefs remain dirty and will not be
  staged or committed.

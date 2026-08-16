# WJ-STABLE Stage 4 Task 1 Report

## Status

DONE LOCALLY / INDEPENDENT REVIEW FINDINGS REMEDIATED

- Task 1 base: `255a8b6fe20924ae30ab8fd99a98393f2bcd1a52`
- Initial Task 1 commit: `0c5c1adfe3e09eab87a81900a09f33bf789f7881`
- First review-fix commit: `ae8d46082f2f77e815eafb4ca94d02ab4bce098f`
- Second review-fix commit: `53b5f3d739da495c3ecd434ffb3b04f2554041dc`
- Final review-fix commit: pending at report update time
- Immutable baseline: `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`

## Delivered

- Added checksum-managed `wujie_agent_events` storage with ordered, owner/project-scoped streams.
- Added shared Agent contracts, deterministic projection, context authorization, tool registry,
  authenticated run APIs, current-user listing and existing task/billing integration.
- Added explicit model `sourceType` to preserve the real `vlm` catalog distinction. Reference-image
  input support no longer grants `analyze_image` authorization.
- Hardened initialization retries: a reused terminal task returns `AGENT_RUN_TERMINAL` and can never
  append `run.created`, become active again or execute without a charge.
- Hardened terminal ordering: authoritative task completion/failure/cancellation/timeout settlement
  must succeed, or already match the requested terminal state, before the terminal event is written.
  A losing terminal race returns `AGENT_RUN_TERMINAL_CONFLICT` without persisting the losing event.
- Terminal-event retries still pass through event-storage request-digest validation. Nonterminal work
  is rejected when the authoritative task is already terminal.
- Nonterminal acceptance is based on whether the appended event was reduced, not whether it remains
  the latest sequence after a concurrent append.
- Malformed JSON at `POST /api/agent-runs` now returns safe HTTP 400.
- Bound each authoritative terminal transition to a durable event ID, canonical request digest and
  terminal event type in `cloud_tasks`. Task result, billing state and this identity now change in
  the existing atomic task settlement path before event persistence.
- Agent event storage verifies terminal events against that durable identity and advances the owning
  task revision in the same transaction as every new event insert.
- Initialization failure settlement now uses the pre-append revision. A committed `run.created`
  whose response is lost advances the revision, prevents refund and is reconciled by the exact
  deterministic event retry; a true append failure is failed/refunded once and cannot resurrect.
- Added one shared pure Agent event prevalidation contract for identifiers, workspace/type, sensitive
  fields, JSON-safe values, the 256 KiB payload ceiling and canonical request digest. The service
  validates and snapshots terminal payloads before settlement; storage repeats validation inside its
  transaction before any event write.
- Agent run workspace recovery now comes only from the immutable authorized `run.created` event, so
  a business result containing its own `workspace` field cannot alter exact-retry identity.

## RED Evidence

Initial review-regression command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/api/agent-runs.test.ts tests/integration/stage-4-agent-events-postgres.test.ts --reporter=verbose
```

Observed: `8 failed / 54 passed`. Six intended unit failures proved reference-image/VLM confusion,
terminal settlement after event persistence, ignored losing settlement, non-latest event rejection,
terminal initialization resurrection and malformed JSON 500. Two PostgreSQL cases initially failed
for a test-isolation module-cache setup error and were not counted as valid business RED evidence.

After correcting only the PostgreSQL fixture isolation:

- Initialization retry RED: the second same-key call resolved as a reused active projection instead
  of rejecting; the real task had already been failed and refunded.
- Terminal race RED: `1 failed / 12 skipped`; a real PostgreSQL task settled as cancelled still
  persisted and reported `run.completed` on two losing retries.
- Catalog RED: `1 failed / 16 skipped`; descriptors did not expose `sourceType` and therefore could
  not preserve a real VLM distinction.
- Defensive terminal retry RED: `2 failed / 24 skipped`; same-ID terminal retries bypassed canonical
  digest validation and a terminal task without its recovery event accepted nonterminal progress.

Second-review RED evidence:

- Unit command:
  `pnpm exec vitest run src/__tests__/api/agent-runs.test.ts -t "binds a completion result" --reporter=verbose`
  produced `1 failed / 26 skipped`: after completion A settled and its append response failed, a
  same-ID retry carrying result B did not produce the required conflict.
- Real PostgreSQL command:
  `$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'; pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts -t "binds concurrent same-status|reconciles run.created" --reporter=verbose`
  produced `2 failed / 13 skipped`: no durable terminal identity columns existed, and a committed
  `run.created` followed by a lost response was incorrectly surfaced as initialization failure.
- The pre-existing real PostgreSQL case `never resurrects a refunded initialization failure on
  idempotent retry` remains the RED/GREEN guard for a true append failure and one-time refund.

## GREEN Evidence

First-review final focused command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/lib/task-model-catalog.test.ts tests/integration/stage-4-agent-events-postgres.test.ts --reporter=verbose
```

Observed: `5 files / 81 tests passed`, including `13/13` real PostgreSQL tests with zero Task 1 skips.
The database evidence covers 20 concurrent ordered appends, same-ID idempotency conflict, ownership
isolation, 20 concurrent cancellations, one consume/one refund, failed initialization retry, losing
terminal race, repeated losing retry and absence of a losing result/event.

Static verification:

- `pnpm ts-check`: exit 0.
- `pnpm lint -- --quiet`: zero ESLint errors.
- `git diff --check`: exit 0; only Git line-ending notices were emitted.

## Concerns And Follow-up Evidence

- The safe recovery direction is task-first: if event persistence fails after authoritative terminal
  settlement, the event projection can temporarily lag the task. Retrying the identical terminal
  request repairs the event after request-digest verification; it cannot reverse or replace the task
  terminal state. This avoids the unsafe inverse state found by review.
- Exact-SHA cloud deployment and real browser integration remain Stage 4 follow-up evidence and are
  not represented as passed by these local tests.
- This remediation did not modify `stable` or `.superpowers/sdd/task-1-brief.md`.

## Second Review GREEN Evidence

Final combined command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/lib/task-model-catalog.test.ts src/__tests__/lib/task-state.test.ts src/__tests__/lib/task-billing.test.ts tests/integration/stage-4-agent-events-postgres.test.ts --reporter=verbose
```

Observed: `7 files / 202 tests passed`, including all `15/15` Stage 4 real PostgreSQL
migration/event tests with zero skips. The PostgreSQL evidence includes concurrent different-result
completion claims producing one durable terminal identity, one terminal event and a task result equal
to the event projection; committed-then-thrown `run.created` recovery without refund or second charge;
and true initialization append failure with one refund and no resurrection.

Second-review static verification:

- `pnpm ts-check`: exit 0.
- `pnpm lint -- --quiet`: exit 0, zero ESLint errors.
- `git diff --check`: run immediately before commit; result recorded in the commit evidence.

## Final Review RED Evidence

Unit command:

```powershell
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts -t "rejects .* before terminal settlement|uses the immutable run.created workspace" --reporter=verbose
```

Observed: `3 failed / 1 passed / 27 skipped`. Secret-bearing completion and oversized failure
resolved after invoking settlement instead of rejecting, while an exact terminal retry used the
mutable business result workspace (`workflow`) instead of the authorized run workspace (`canvas`).
The unserializable BigInt case already threw before settlement and was retained as a permanent guard.

Real PostgreSQL command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm exec vitest run tests/integration/stage-4-agent-events-postgres.test.ts -t "rejects an invalid terminal payload" --reporter=verbose
```

Observed: `1 failed / 15 skipped`. The rejected secret-bearing completion changed the durable task
from `processing/pending` to `completed/charged`, persisted the secret in `cloud_tasks.result`, and
wrote terminal identity while no matching terminal event existed.

## Final Review GREEN Evidence

Focused regression command:

```powershell
$env:POSTGRES_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/lib/task-model-catalog.test.ts src/__tests__/lib/task-state.test.ts src/__tests__/lib/task-billing.test.ts tests/integration/stage-4-agent-events-postgres.test.ts --reporter=verbose
```

Observed: `7 files / 207 tests passed`, including all `16/16` Stage 4 real PostgreSQL tests with zero
skips. The new database assertion compares task status/result, credit status/balance, consume/refund
ledger counts, terminal identity and event count before and after rejection; every field is unchanged.

Final-review static verification:

- `pnpm ts-check`: exit 0.
- `pnpm lint -- --quiet`: exit 0, zero ESLint errors.
- Intended-file `git diff --check`: exit 0. The unscoped command reports only an unrelated trailing
  blank line in the controller-owned `.superpowers/sdd/task-2-brief.md`; it is not modified or staged
  by this Task 1 fix.

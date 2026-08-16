# WJ-STABLE Stage 4 Task 1 Report

## Status

DONE LOCALLY / INDEPENDENT REVIEW FINDINGS REMEDIATED

- Task 1 base: `255a8b6fe20924ae30ab8fd99a98393f2bcd1a52`
- Initial Task 1 commit: `0c5c1adfe3e09eab87a81900a09f33bf789f7881`
- Review-fix commit: pending at report update time
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

## GREEN Evidence

Final focused command:

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

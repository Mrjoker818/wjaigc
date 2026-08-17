# Task 2 R18 independent review findings

Reviewed HEAD: `49bc1ccfe84ffed73878692674b750263d6a8a5d`

The complete Task 2 re-review is **NOT APPROVED**.

## Critical: submit is enabled before pending-attempt hydration completes

- A persisted scope attempt is loaded in a passive effect, but Execute is
  enabled and `handleSubmit` reads the in-memory map immediately.
- Mounting or switching back to a scope and clicking before the effect runs can
  create a new key for a previously accepted paid request.
- Add an explicit per-scope hydration-readiness state. Disable Execute and make
  the handler fail closed until the exact current scope has loaded/validated
  storage. Switching scope must synchronously expose not-ready for the new
  scope. Add a behavioral RED that clicks before effects are drained and proves
  no POST/new key, then proves the recovered key is reused after hydration.

## Important: terminal state, error/result and refund are split across transactions

- `recordAgentTaskTerminal` writes `result.taskError` before the atomic terminal
  settlement. Competing cancel/fail/timeout calls can leave the winning status
  paired with the losing taskError.
- Move canonical terminal error/result facts into the same row-lock transaction
  that chooses the terminal status and claims the refund. The losing contender
  must not overwrite any winning terminal fact.
- Add real PostgreSQL concurrency tests racing different terminal statuses and
  error codes/messages; assert status, top-level error, result.taskError,
  credit status and exactly-once refund all correspond to the same winner.

## Cleanup and evidence quality

- Remove or rename misleading TTL/`expiresAt` semantics if unresolved identities
  intentionally persist until terminal. Do not reintroduce unsafe time deletion.
- For confirmed-local cancellation, use an accurate local-only message and
  preserve conservative key behavior without claiming server confirmation.
- Run the local-only compatibility test under real legacy and shadow modes, not
  only an agent-v2 environment label.
- Exact-SHA five-browser evidence follows only after independent review passes.

## Required verification

- Strict RED/GREEN; focused hydration/UI/API and conflicting-terminal real
  PostgreSQL tests; Agent matrix; full Vitest; typecheck; lint; build; protected
  baseline; diff check.
- Exact R18 allow-path only. No stable, Task 3, controller brief or unrelated
  changes.

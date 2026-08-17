# Task 2 R16 independent review findings

Reviewed HEAD: `b7e9d667f0530a80b16383522f120cfec8713ac2`

The complete Task 2 re-review is **NOT APPROVED**.

## Critical: uncertain timeout/cancel clears the paid-attempt identity

- Reaching the client poll limit proves only that this browser stopped waiting;
  it does not prove the durable task/provider operation is terminal. Do not
  clear the attempt key on a client-side wait timeout.
- Cancel currently ignores transport/status/body and then clears the key and
  claims cancellation. A failed, 404, or 5xx cancel may leave the durable paid
  task running. Only a database-confirmed terminal cancellation may clear the
  key and present cancelled state.
- The cancel endpoint must resolve persisted tasks after process restart and
  perform the existing durable terminal/refund transition, not depend solely on
  an in-memory task store.
- Add RED tests for poll limit, cancel transport failure, cancel 404/5xx, and
  restart/persisted-task cancellation. The same accepted task must remain
  recoverable and must not permit a second charge.

## Important: terminal replay 409 is classified incorrectly

- `/api/agent-edit` can return a structured `409` with code
  `AGENT_TASK_TERMINAL`, `replayed: true`, task identity and an explicit
  failed/cancelled/timeout terminal state.
- Treat that structured response as a known terminal replay, clear the pending
  key, and present its real terminal state. Do not classify every 409 as
  uncertain, and do not classify unstructured conflicts as terminal.

## Important: pending attempt persistence leaks request content and can fail open

- Do not store the serialized request (prompt, image/data URL, project/entity
  data) in localStorage. Store only a SHA-256 request digest, random
  idempotency key, version and bounded expiry metadata.
- Expired/malformed records must be discarded.
- If the pending attempt cannot be durably written before a paid request, fail
  closed with an actionable error before POST. Do not silently continue and
  later generate a new key after refresh.
- Add tests for quota/security-disabled storage, expiry/malformed data, and
  absence of prompt/image content in storage.

## Evidence gap

- Regenerate five-browser exact-SHA evidence after code review passes, using
  the available isolated PostgreSQL URL rather than leaving
  `E2E_STAGE4_DATABASE_URL` unset.

## Required verification

- Strict RED/GREEN, focused suites, Agent matrix, full Vitest, typecheck, lint,
  build, protected baseline and diff check.
- Only exact R16 evidence allow-path; no stable, Task 3, controller brief, or
  unrelated changes.

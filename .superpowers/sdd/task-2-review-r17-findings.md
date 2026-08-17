# Task 2 R17 independent review findings

Reviewed HEAD: `29a50ccf9cfd9bd85cfe98f06e19950cb8764319`

The complete Task 2 re-review is **NOT APPROVED**.

## Critical: client TTL can discard a still-live accepted attempt

- A process crash can leave a durable processing task/provider operation alive
  beyond the current 30-minute client TTL.
- Never discard a valid pending-attempt identity merely because wall-clock time
  elapsed. Retain/reuse it until the server confirms terminal or confirms the
  idempotency record does not exist. An advisory expiry must fail closed when
  reconciliation is unavailable.
- Add a RED proving a cross-TTL refresh with a durable processing/accepted task
  cannot create a second key, task, charge, or provider submission.

## Important: cancellation state coverage regressed

- Restore local-only legacy/shadow processing cancellation behavior without
  weakening Agent-v2 durable confirmation.
- Persisted `queued`, `pending`, and `processing` tasks must all be cancellable
  by an authorized owner. Extend the existing atomic terminal/refund transition
  as needed and add real PostgreSQL tests, including concurrent repeated cancel
  and exactly-once refund.
- A local-only terminal may use an explicit confirmed-local result; do not label
  it database-durable. The client must distinguish the two contracts.

## Important: persisted timeout is not handled by the poller

- When GET returns `status: timeout` and `durableTerminal: true`, stop polling,
  show the timeout state, preserve existing results, and clear the pending key.

## Important: confirmed unaccepted 4xx must clear the key

- Restore the explicit classification for statuses that prove admission did not
  happen (for example 400/401/403/413/422), including empty/non-JSON bodies.
- Keep ambiguous 408/409/425/429/5xx and transport failures attached unless a
  structured terminal replay proves terminal.

## Evidence quality

- Use real WebCrypto SHA-256 in at least one Node/WebCrypto unit or cover it in
  the final five-browser run; the structural digest stub alone is insufficient.
- Exact-SHA five-browser evidence follows only after independent review passes.

## Required verification

- Strict RED/GREEN, focused UI/API/PostgreSQL concurrency tests, Agent matrix,
  full Vitest, typecheck, lint, build, protected baseline and diff check.
- Exact R17 allow-path only. No stable, Task 3, controller brief or unrelated
  changes.

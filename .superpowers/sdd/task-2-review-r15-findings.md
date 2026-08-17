# Task 2 R15 independent review findings

Reviewed HEAD: `117b87fdb6d9f3dbec1618593761fde25561f520`

The complete Task 2 re-review is **NOT APPROVED**.

## Critical: accepted task identity is lost when initial response arrives after a scope switch

- Image A is marked processing before `/api/agent-edit` returns.
- If the user switches to image B before the accepted response arrives, the
  current scope guard returns before persisting A's `taskId` / `agentRunId`.
- Switching back to A leaves an unrecoverable processing state with no poll or
  cancel identity. A retry has no stable client idempotency key and can create a
  second task and charge.
- Add a behavioral RED that defers the initial POST response, switches A -> B,
  then resolves A's accepted response. The identity must be written to A only,
  must never appear in B, and switching back to A must resume the same task.
- Bind the submission to a captured scope and update that scope explicitly even
  when it is not visible. Add a stable per-attempt idempotency key and preserve
  it for retry/recovery; never launch polling into the currently visible wrong
  scope.

## Minor: elapsed-time presentation is not scoped

- The timer is component-wide. Switching away stops it; switching back resumes
  polling without restoring elapsed-time behavior.
- Scope the timing facts or derive elapsed display from a per-scope start time.
  Add a test that switching scopes cannot show one image's timing on another.

## Evidence gap

- Five-browser exact-SHA evidence must be regenerated only after the final code
  review passes. Existing evidence belongs to an earlier SHA.

## Required verification

- Strict RED/GREEN evidence for the delayed accepted-response window.
- Focused tests, Agent matrix, full Vitest, typecheck, lint, build, protected
  baseline and diff check.
- Add only the exact R15 findings allow-path. Do not touch stable, Task 3,
  controller briefs, or unrelated modules.

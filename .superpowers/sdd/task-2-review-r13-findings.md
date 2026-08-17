# Task 2 R13 independent review findings

Reviewed HEAD: `375e31dc31ddcef50aca13ebc02c035fd82627ca`

The complete Task 2 re-review is **NOT APPROVED**. Controller tracing confirms
the following findings are real production defects, despite the full Vitest
suite passing 462/462 files and 2749/2749 tests.

## Critical: chat generation omits strict paid routing

- Canvas chat (`src/lib/chat-tools.ts`) and standalone chat
  (`src/app/api/simple-chat/chat/route.ts`) submit Agent-v2 image generation
  with `x-wujie-agent-defer-execution`, but not
  `x-wujie-agent-strict-routing`.
- `/api/generate` treats those headers independently. Without strict routing,
  the persisted submission does not carry the strict recovery facts and later
  provider/model retry or fallback remains possible.
- This violates the Task 2 requirement that provider/model mismatch must fail
  closed and must never silently route a paid Agent action to another provider.
- Existing tests inspect source ordering or call the separate strict adapter;
  neither executes the two real chat submission paths.

Required TDD closure:

1. Add behavioral RED tests for both chat-originated generation paths. Capture
   their real internal `/api/generate` request and prove Agent-v2 sends the
   strict-routing header, defer header, stable idempotency key, and the exact
   provider/model body. Also prove legacy/shadow behavior is not broadened.
2. Make the smallest production change that routes both Agent-v2 paths through
   the same strict contract or otherwise supplies the exact same headers and
   recovery facts.
3. Prove no provider/model fallback or blind resubmission is introduced.

## Important: selected-image switch can leak the previous run identity

- `src/components/agent-editor.tsx` derives a new storage key when the selected
  image changes.
- Its recovery effect only sets state when a stored value exists. Its following
  persistence effect can therefore write the previous image's `agentRunId`
  under the new image key before the state catches up.
- Timeline, refresh recovery, and cancellation may then target the prior run.
- The current source-string test never renders the component and switches its
  project/entity scope.

Required TDD closure:

1. Add a component/hook behavioral RED that starts with image A/run A, rerenders
   for image B with no stored run, and proves B remains empty and run A is never
   persisted under B. Cover recovery when B already has its own run.
2. Model run identity as storage-key-scoped state, or an equivalently race-free
   mechanism. A new key must synchronously expose no stale run before recovery.
3. Keep the existing refresh recovery and cancel behavior for the same image.

## Minor: unrelated protected-baseline relaxation

- Remove `--allow-path src/components/node-editor.tsx` from the Task 2
  `check:protected-baseline` command. The node editor has no diff from the Stage
  4 base and Task 2 must not pre-authorize Task 3 changes.
- Re-run the 38-feature protected gate after removal.

## Scope and verification

- Strict TDD: demonstrate the new tests fail for the expected reasons before
  production changes.
- Do not touch `stable`, the two controller briefs, Task 3 renderer work, or
  unrelated modules.
- Append RED/GREEN commands, exact counts, scope audit, and changed files to
  `.superpowers/sdd/task-2-report.md`.
- Commit the R13 findings, tests, minimal production changes, package guard
  correction, and report only.

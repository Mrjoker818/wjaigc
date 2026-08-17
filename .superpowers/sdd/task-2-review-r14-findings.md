# Task 2 R14 independent review findings

Reviewed HEAD: `093b9e74909d51bd203f8293f1cc721e944e2ca7`

The complete Task 2 re-review is **NOT APPROVED**.

## Critical: Canvas Agent-v2 img2img bypasses strict paid routing

- `img2img` is authorized as the `generate_image` capability, but the real
  `/api/generate` request still sends only the defer-execution header.
- It must also send the strict-routing header, stable idempotency key, and exact
  authorized provider/model tuple.
- Add a successful img2img behavioral RED test. Keep legacy/shadow and edit
  requests unchanged.

## Important: selected-image task state is not fully scoped

- R13 scopes `agentRunId`, but `taskId`, polling/progress/results and
  `isProcessing` remain component-wide.
- Switching from image A to B can leave A polling while B shows A's Cancel
  action and state.
- Add a behavioral RED test that switches image scope during an active task.
  Scope the complete active-task identity/state to the selected image, cancel or
  detach stale polling on scope change, and preserve same-image recovery.

## Test-suite isolation failure

- The full suite at this HEAD produced 463/464 passing files and 2756 passing
  tests. `src/__tests__/lib/chat-tools-analyze-image.test.ts` failed during
  collection because the R13 strict-routing import pulled `server-only` into
  this unit environment.
- Fix the module boundary or test isolation without weakening the production
  server-only guard.

## Required verification

- Demonstrate RED before production edits and GREEN after.
- Run the focused routing/state/analyze tests, Agent matrix, full Vitest suite,
  typecheck, lint, build, protected baseline and `git diff --check`.
- Regenerate five-browser evidence from the final exact SHA after review passes.
- Do not touch `stable`, controller briefs, Task 3 renderer work, or unrelated
  modules.

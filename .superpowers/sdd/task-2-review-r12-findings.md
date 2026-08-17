# Task 2 R12 controller findings

Baseline: `5a8e1a16ab5757e444398685e4c93acbf0ef005c`

The PostgreSQL-enabled full Vitest gate exposed three independently reproducible
test failures. Controller tracing confirms the Task 2 production data flow is
correct; this wave is test-contract maintenance only.

## Finding 1: poll-task test lacks server-only test setup

- File: `src/__tests__/api/poll-task-authoritative-direct.test.ts`
- Reproduction: isolated suite fails during collection in
  `node_modules/server-only/index.js` before running any test.
- Root cause: Task 2 added a server-only transitive import through
  `STRICT_AGENT_GENERATE_HEADER`, while this route-level test mocks other
  server-only dependencies but does not mock the `server-only` marker itself.
- Required fix: add the established `vi.mock('server-only', () => ({}))` test
  setup. Do not remove the production server-only boundary.

## Finding 2: mismatch source contract selects the wrong occurrence

- File: `src/__tests__/api/generate-provider-model-mismatch-contract.test.ts`
- Reproduction: `mismatchGate` resolves to the strict-Agent missing-routing
  guard before session hydration, while the explicit configured provider/model
  mismatch gate remains after user resolution and before durable batch creation.
- Root cause: global `source.indexOf("code: 'MODEL_PROVIDER_MISMATCH'")` assumes
  that only one mismatch guard exists.
- Required fix: locate the configured provider/model mismatch occurrence from
  `userResolution` onward, and keep the existing ordering and provider-catalog
  assertions. Do not move or weaken either production guard.

## Finding 3: remove-background contract depends on one-line formatting

- File: `src/__tests__/components/image-tool-request-integrity.test.ts`
- Reproduction: production builds `removeBackgroundRequest` across multiple
  lines with `imageUrl`, `action: 'removebg'`, `model: imageModel`,
  `providerId: imageProviderId`, and `engine: imageModel ? 'ai' : 'auto'`, but
  the test requires the first three fields on one exact line.
- Root cause: a whitespace-sensitive source assertion, not a request-data loss.
- Required fix: scope the assertion to the `removeBackgroundRequest` object and
  assert the four fields independently, or use an equivalently robust contract.
  Do not change the production request object.

## Required verification

1. Re-run each of the three files individually and together.
2. Re-run the Task 2 Agent matrix.
3. Append exact commands/results and changed files to
   `.superpowers/sdd/task-2-report.md`.
4. Commit only the three test files and the report. Never commit the two dirty
   task briefs. Do not modify production code, `stable`, or unrelated files.

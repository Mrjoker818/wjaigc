# Stage 4 Task 0 Report

- Date: 2026-08-16
- Commit: `test: establish stage four node chat agent baseline` (final hash is reported in the Task 0 completion response)
- Branch: `codex/wj-stable-s4`
- Task base commit: `7c668f0`
- Worktree: `J:\无界本地版\projects\_upstream-wjaigc-restore\.worktrees\wj-stable-s3`
- Status: DONE_WITH_CONCERNS (pending final commit hash update)

## Implementation Summary

Implemented the Task 0 baseline-only surface required by the brief:

- Added Stage 4 runtime mode parsers:
  - `src/lib/agent-runtime/mode.ts`
  - `src/lib/workflow-renderer/mode.ts`
- Added Stage 4 inventory generator and artifact writer:
  - `scripts/stage-4-inventory.mjs`
- Added Stage 4 fixture planner:
  - `scripts/stage-4-e2e-fixtures.mjs`
- Added Stage 4 workflow performance helper:
  - `tests/helpers/workflow-performance.ts`
- Added Stage 4 Playwright evidence helper:
  - `tests/helpers/stage-4-e2e.ts`
- Added Stage 4 baseline Playwright spec:
  - `tests/e2e/stage-4-node-chat-agent.spec.ts`
- Added RED/GREEN tests:
  - `src/__tests__/lib/stage-4-modes.test.ts`
  - `src/__tests__/scripts/stage-4-inventory.test.ts`
  - `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- Extended:
  - `scripts/doctor.mjs`
  - `scripts/generate-function-inventory.mjs`
  - `package.json`
  - `.env.example`
- Wrote Stage 4 baseline documentation:
  - `docs/testing/STAGE_4_BASELINE_REPORT.md`

No business logic was intentionally changed.

## Exact RED Commands And Output

### 1. Mode parser RED

Command:

```powershell
pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts
```

Output:

```text
FAIL
Error: Cannot find module '@/lib/agent-runtime/mode'
```

### 2. Inventory RED

Command:

```powershell
pnpm exec vitest run src/__tests__/scripts/stage-4-inventory.test.ts
```

Output:

```text
FAIL
Error: Cannot find module '../../../scripts/stage-4-inventory.mjs'
```

### 3. Fixture RED

Command:

```powershell
pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts
```

Output:

```text
FAIL
Error: Cannot find module '../../../scripts/stage-4-e2e-fixtures.mjs'
```

## Exact GREEN / Iteration Commands And Output

### 1. Focused Stage 4 unit suite

Command:

```powershell
pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts
```

Output:

```text
RUN  v3.2.4 J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3
✓ src/__tests__/scripts/stage-4-inventory.test.ts (1 test)
✓ src/__tests__/scripts/stage-4-e2e-fixtures.test.ts (2 tests)
✓ src/__tests__/lib/stage-4-modes.test.ts (2 tests)
Test Files  3 passed (3)
Tests  5 passed (5)
```

### 2. Stage 4 inventory artifact generation

Command:

```powershell
pnpm test:inventory:stage-4
```

Output:

```text
{
  "routes": 200,
  "workspaces": 3,
  "nodeTypes": 51,
  "portTypes": 10,
  "jsonPath": "J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/inventory/stage-4-inventory.json",
  "markdownPath": "J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/inventory/stage-4-inventory.md"
}
```

### 3. Doctor

Command:

```powershell
pnpm doctor
```

Output:

```text
(exit 0, no stdout)
```

### 4. Protected baseline gate

Command:

```powershell
pnpm check:protected-baseline
```

Output:

```text
Protected baseline gate: origin/main (...) -> HEAD (7c668f0ba2789557dca6758ce9d75163ece6ce21)
PASS  All 38 baseline feature IDs remain present.
PASS  No unapproved source drift was detected.
PASS  All literal protected component paths are present.
PASS  All required evidence contracts are present.
PASS  Base and candidate Git refs are confirmed.
WARN  Recorded baseline commit 69ba94ef6bde041293ad9609ec76285d3e287a7f differs from resolved origin/main commit 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b.
PASS  Release gate completed with 1 warning(s).
```

### 5. Diff whitespace gate

Command:

```powershell
git diff --check
```

Output:

```text
warning: in the working copy of '.env.example', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of '.superpowers/sdd/task-1-brief.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'package.json', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'scripts/doctor.mjs', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'scripts/generate-function-inventory.mjs', LF will be replaced by CRLF the next time Git touches it
```

## Real Baseline Commands And Output

### 1. Initial Playwright baseline attempt

Command:

```powershell
pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium
```

Output:

```text
TypeError: fetch failed
[cause]: Error: connect ECONNREFUSED 127.0.0.1:5000
```

### 2. Local server startup

Command:

```powershell
pnpm dev
```

Relevant output:

```text
▲ Next.js 16.2.11 (webpack)
- Local:         http://localhost:5000
✓ Ready in 1140ms
[db-storage] ensureCoreTables error: Error: [db-client] No DATABASE_URL or PGDATABASE_URL environment variable set
[instrumentation] DB migration failed (non-fatal): Error: [db-client] No DATABASE_URL or PGDATABASE_URL environment variable set
[instrumentation] Python 环境不可用 (torch/iopaint 缺失)
[instrumentation] 本地 AI 必需模型缺失:
[instrumentation] SVG convert deps installed successfully
```

### 3. First rerun after server start

Command:

```powershell
pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium
```

Output:

```text
Error: tracing.start: Tracing has been already started
```

Resolution:

- Adjusted `tests/e2e/stage-4-node-chat-agent.spec.ts` to use Stage 4's dedicated evidence tracing only.

### 4. Final real baseline run

Command:

```powershell
pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium
```

Output:

```text
1 failed
Error: BLOCKED: Stage 4 baseline requires one of: registration enabled, E2E_TEST_USERNAME/E2E_TEST_PASSWORD, or WUJIE_ADMIN_PASSWORD
```

Evidence retained at:

- [final.png](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/final.png)
- [trace.zip](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/trace.zip)
- [video.webm](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/video.webm)
- [console.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/console.json)
- [network.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/network.json)

## Tests Run

- `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts`
- `pnpm exec vitest run src/__tests__/scripts/stage-4-inventory.test.ts`
- `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `pnpm test:inventory:stage-4`
- `pnpm doctor`
- `pnpm check:protected-baseline`
- `git diff --check`
- `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium` (three runs: server down, trace harness conflict, environment auth block)

## Files Changed

Created:

- `src/lib/agent-runtime/mode.ts`
- `src/lib/workflow-renderer/mode.ts`
- `scripts/stage-4-inventory.mjs`
- `scripts/stage-4-e2e-fixtures.mjs`
- `tests/helpers/stage-4-e2e.ts`
- `tests/helpers/workflow-performance.ts`
- `tests/e2e/stage-4-node-chat-agent.spec.ts`
- `src/__tests__/lib/stage-4-modes.test.ts`
- `src/__tests__/scripts/stage-4-inventory.test.ts`
- `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `docs/testing/STAGE_4_BASELINE_REPORT.md`

Modified:

- `.env.example`
- `scripts/doctor.mjs`
- `scripts/generate-function-inventory.mjs`
- `package.json`

Intentionally excluded from commit:

- `.superpowers/sdd/task-1-brief.md` (controller-generated next-task handoff artifact)

## Self-Review

### Inventory completeness

- PASS: the inventory is structured, not count-only
- PASS: it records workspace IDs, routes, components, task types, asset inputs, asset outputs, automation coverage, and risk
- PASS: node types, port types, skills, and agent tools are derived from source rather than handwritten

### Fixture isolation

- PASS: Stage 4 fixture planning is browser-profile scoped
- PASS: user names, project IDs, and workflow IDs are run-id scoped
- PASS: the spec is written to seed only the controlled Stage 4 canvas and chat project IDs
- CONCERN: the local environment never exposed a viable auth path, so full end-to-end isolation could not be proven against a real authenticated user session

### Performance sample honesty

- PASS: no fake runtime sample was reported
- CONCERN: the real node-mode performance thresholds were never exercised because the final Playwright run was blocked before authenticated seeding
- PASS: only the summarization contract was validated at unit level

## Concerns

1. The final Chromium baseline is blocked by environment auth prerequisites:
   - registration disabled
   - no `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`
   - no `WUJIE_ADMIN_PASSWORD`
2. The local dev server environment did not provide `DATABASE_URL` or `PGDATABASE_URL`.
3. The local environment reported missing local AI Python/runtime models; these were non-fatal for this task but are part of the real baseline.
4. Stage 3 external immutable Actions / Coze release gates remain incomplete outside this task and were not executed here; they are not classified as pass evidence.

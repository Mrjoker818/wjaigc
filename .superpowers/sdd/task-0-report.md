# Stage 4 Task 0 Report

- Date: 2026-08-16
- Commit: `test: establish stage four node chat agent baseline` (final hash is reported in the Task 0 completion response)
- Branch: `codex/wj-stable-s4`
- Task base commit: `7c668f0`
- Worktree: `J:\无界本地版\projects\_upstream-wjaigc-restore\.worktrees\wj-stable-s3`
- Status: SECOND_REVIEW_FIX_EVIDENCE_RECORDED (earlier evidence sections are superseded where noted)

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

## Rejection Fix Evidence (2026-08-17)

> SUPERSEDED for fixture identity, 100-node coverage, and doctor-output claims by the Second Independent Review Fix Evidence below. It remains a historical record of the first rejection-fix attempt.

### Exact Tested Code Commit

- Tested code commit: `6c2ead55c6c8277085a97149df45a11037483753` (`test: pin stage four protected baseline gate`)
- Preceding code/test fix: `c53f429a5c7ccb0730956b33555f62ea288ddb34` (`test: enforce stage four isolated baseline fixtures`)
- This document's subsequent commit is documentation-only bookkeeping and must reference the exact tested code commit above.

### RED Evidence

1. `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts`
   - Failed 4 tests before implementation: missing `assertStage4FixtureDatabaseEnvironment`, missing `assertWorkflowMonitorCoverage`, and authentication continued without an application database target.
2. `pnpm exec vitest run tests/unit/protected-baseline-gate.spec.ts`
   - Failed the new contract because `check:protected-baseline` did not allow the exact `.superpowers/sdd/task-0-report.md` evidence path.

### GREEN Evidence

1. `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts`
   - Exit 0; 5 files passed, 20 tests passed.
2. `pnpm test:inventory:stage-4`
   - Exit 0; routes=200, workspaces=3, nodeTypes=51, portTypes=10.
3. `pnpm doctor`
   - Exit 0; actual stdout was empty.
4. `pnpm check:protected-baseline`
   - Exit 0; fixed base `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`, all 38 protected IDs present, no warning, no unapproved drift.
5. `git diff --check 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b..6c2ead5`
   - Exit 0; pristine committed-range whitespace output.
6. `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`
   - Intentionally blocked before authentication and writes: `BLOCKED: E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation`.
   - Verified retained evidence: `final.png`, `video.webm`, `console.json`, and `network.json` at `test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/`.

### Files Changed By Rejection Fix

- `scripts/stage-4-e2e-fixtures.mjs`
- `tests/helpers/stage-4-e2e.ts`
- `tests/helpers/workflow-performance.ts`
- `tests/e2e/stage-4-node-chat-agent.spec.ts`
- `src/__tests__/helpers/stage-4-e2e.test.ts`
- `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `package.json`
- `tests/unit/protected-baseline-gate.spec.ts`

### Self-Review

- Generic test credentials fail closed unless the configured username exactly equals the run-scoped disposable fixture username.
- Admin credentials are used only to create or locate that deterministic disposable user, then the test clears cookies and logs in as the fixture. Persisted project reads/writes are guarded by disposable-session checks.
- Both `E2E_STAGE4_DATABASE_URL` and the application's `PGDATABASE_URL` or `DATABASE_URL` must be isolated and resolve to the same non-credential target before any auth request.
- The performance sampler records and requires all 100 fixture node IDs, then the browser spec asserts the recorded count before accepting lost/unclickable metrics.
- The protected baseline remains a 38-feature gate; it now pins the fixed main SHA and permits only this task's report path.

### Remaining Concern

- No isolated Stage 4 database was available, so authenticated seeding and real 100-node performance values remain blocked. The older `7c668f0` browser evidence did not test this rejection fix and is superseded for fixture-isolation claims.

## Second Independent Review Fix Evidence (2026-08-17)

### Exact Tested Code Commit

- Tested code commit: `615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9` (`test: require exact stage four fixture identities`).
- The following documentation commit is bookkeeping only and references this exact prior code/test SHA.
- The earlier `6c2ead55c6c8277085a97149df45a11037483753` evidence did not test these second-review fixes and is superseded for the affected claims.

### RED Evidence

1. Command: `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts`
   - Result: exit 1; 1 file failed, 1 passed; 8 tests failed, 6 passed.
   - Expected failures proved the fixture plan lacked `expectedNodeIds`, `DATABASE_URL` precedence was wrong, substring/query identities were accepted, and node coverage did not compare exact IDs.
2. Command: `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
   - Result: exit 1; 1 test failed, 9 passed.
   - Expected failure proved a whitespace-only `DATABASE_URL` incorrectly fell through to an isolated `PGDATABASE_URL`, unlike application precedence.

### GREEN And Gate Evidence

1. Command: `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts`
   - Result: exit 0; 5 files passed, 23 tests passed.
2. Command: `pnpm ts-check`
   - Result: exit 0; Next route types generated and TypeScript completed without errors.
3. Command: `pnpm test:inventory:stage-4`
   - Result: exit 0; routes=200, workspaces=3, nodeTypes=51, portTypes=10.
4. Command: `pnpm check:protected-baseline`
   - Result: exit 0; fixed base `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`, 38/38 feature IDs present, 0 warnings.
5. Commands: `git diff --check 08c2596150b7eea11b880e1f584dc407c8f3a054..615d60d` and `git diff --check 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b..615d60d`
   - Result: both exit 0 with empty, pristine output.
6. Command: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`
   - Result: exit 1, intentionally BLOCKED before authentication or persisted writes: `E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation`.
   - Verified evidence directory: `test-results/stage-4-baseline/evidence/615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9-worktree-3683a4b89198/stage4-2026-08-16T16-27-32/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/`.
   - Verified files: `final.png`, `video.webm`, `console.json`, `network.json`, and `trace.zip`.

### Doctor Evidence

1. PowerShell command: `pnpm doctor` (no redirection)
   - Exit 0; stdout empty; stderr empty. This invokes pnpm's built-in doctor command, not the package script.
2. PowerShell command: `node scripts/doctor.mjs` (no redirection)
   - Exit 0; stderr empty; stdout ended with `Summary: 25 passed, 12 warnings, 0 failed, 2 blocked`.
3. PowerShell command: `pnpm run doctor` (no redirection)
   - Exit 0; stderr empty; stdout included the package-script banner and the same `Summary: 25 passed, 12 warnings, 0 failed, 2 blocked`.

Exact direct-script stdout:

```text
[PASS] node-version: v25.2.1 (require >= 18)
[PASS] runtime: Node v25.2.1; mode=development
[PASS] canvas-kernel-mode: legacy (default)
[PASS] agent-runtime-mode: legacy (default)
[PASS] workflow-renderer-mode: legacy (default)
[WARN] authentication-secret: not configured for this runtime
[WARN] INTERNAL_API_SECRET: not configured for this runtime
[WARN] PAYMENT_TOKEN_SECRET: not configured for this runtime
[WARN] WUJIE_ADMIN_PASSWORD: missing, weak, or placeholder value
[WARN] MANDATORY_API_AUTH: must be true for a release environment
[WARN] APIMART_API_KEY: not configured in local environment
[WARN] GEMINI_API_KEY: not configured in local environment
[PASS] data-directory: J:\无界本地版\projects\_upstream-wjaigc-restore\.worktrees\wj-stable-s3\data
[WARN] database: PGDATABASE_URL or DATABASE_URL is not configured
[PASS] asset-mode: legacy
[BLOCKED] asset-graph: database is unavailable; asset graph facts cannot be verified
[BLOCKED] postgres-test-database: POSTGRES_TEST_DATABASE_URL is not configured; Stage 1 release verification is blocked
[WARN] object-storage: COZE_BUCKET_ENDPOINT_URL / COZE_BUCKET_NAME not configured; local storage fallback must be verified
[PASS] build-artifacts: .next directory exists
[PASS] build-manifest: exists
[PASS] dir:src/app: exists
[PASS] dir:src/components: exists
[PASS] dir:src/lib: exists
[PASS] dir:public: exists
[PASS] public-writable: writable
[PASS] node_modules: installed
[PASS] dep:next: installed
[PASS] dep:react: installed
[PASS] dep:react-dom: installed
[PASS] dep:pg: installed
[PASS] dep:jose: installed
[PASS] dep:sharp: installed
[PASS] config:.coze: exists
[PASS] config:package.json: exists
[PASS] config:tsconfig.json: exists
[PASS] port-config: port=5000
[WARN] api:session: unreachable (service may not be running)
[WARN] api:models: unreachable (service may not be running)
[WARN] deployment-url: not supplied; use pnpm doctor -- --url=https://deployment.example

Summary: 25 passed, 12 warnings, 0 failed, 2 blocked
```

### Files Changed By Second Review Fix

- `scripts/stage-4-e2e-fixtures.mjs`
- `src/__tests__/helpers/stage-4-e2e.test.ts`
- `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
- `tests/e2e/stage-4-node-chat-agent.spec.ts`
- `tests/helpers/stage-4-e2e.ts`
- `tests/helpers/workflow-performance.ts`

### Self-Review And Concern

- Effective application DB selection now exactly follows `DATABASE_URL || PGDATABASE_URL`; a shared/production `DATABASE_URL` cannot be masked by an isolated PG fallback.
- Both URLs must independently match `wujie_stage4_<sanitized E2E_STAGE4_RUN_ID>` and then match protocol, host, effective port, database, user, and SSL target. Database/schema query tricks are rejected and credentials never enter errors or reports.
- The fixture retains its exact 100 expected node IDs. DOM IDs are not deduplicated; duplicates, missing IDs, unexpected IDs, and 100 wrong IDs block before measurement. The browser sampler receives only the fixture's expected IDs.
- Concern: no isolated Stage 4 database was available, so authenticated seeding and real 100-node performance values remain BLOCKED rather than passed.

## Third Independent Review Fix Evidence (2026-08-17)

> The Second Independent Review evidence remains historical but is superseded for the dual-DB-variable contract and environment metadata below.

### Exact Tested Code Commit

- Tested code commit: `dd29868cf8e40cbb1f60d614d2607db24f6972ea` (`test: require matching stage four database variables`).
- The following documentation commit is bookkeeping only and references this exact prior code/test SHA.

### RED Evidence

Command: `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`

- Exit 1; 1 test failed and 12 passed.
- Exact failing case: `blocks when either configured application database variable is shared or production`.
- Exact assertion failure: expected isolated `DATABASE_URL` plus shared `PGDATABASE_URL` to throw, but no exception was raised.

### GREEN And Gate Evidence

1. `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`
   - Exit 0; 13/13 tests passed.
2. `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts`
   - Exit 0; 5 files and 26/26 tests passed.
3. `pnpm ts-check`
   - Exit 0; Next route types generated and TypeScript completed without errors.
4. `pnpm test:inventory:stage-4`
   - Exit 0; routes=200, workspaces=3, nodeTypes=51, portTypes=10.
5. `pnpm run doctor`
   - Exit 0; stdout included all checks and ended with `Summary: 25 passed, 12 warnings, 0 failed, 2 blocked`.
6. `pnpm check:protected-baseline`
   - Exit 0 against fixed `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`; 38/38 feature IDs present, no drift, 0 warnings.
7. `git diff --check ffbacdb..dd29868cf8e40cbb1f60d614d2607db24f6972ea` and `git diff --check 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b..dd29868cf8e40cbb1f60d614d2607db24f6972ea`
   - Both exit 0 with no whitespace errors.
8. `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`
   - Exit 1, intentionally BLOCKED before authentication and fixture writes: `E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation`.
   - Verified evidence directory: `test-results/stage-4-baseline/evidence/dd29868cf8e40cbb1f60d614d2607db24f6972ea-worktree-3683a4b89198/stage4-2026-08-16T16-39-42/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/`.
   - Verified non-missing files: `final.png` (4254 bytes), `video.webm` (2584 bytes), `console.json` (2 bytes), `network.json` (2 bytes), and `trace.zip` (2962 bytes).
9. Inventory artifact verification
   - `test-results/stage-4-baseline/inventory/stage-4-inventory.json` exists (12602 bytes).
   - `test-results/stage-4-baseline/inventory/stage-4-inventory.md` exists (9501 bytes).

### Reproducible Environment Metadata

PowerShell command output was captured directly. DB and auth entries intentionally report state only:

```text
OS=Microsoft Windows 10 专业版 10.0.19045 build 19045 64 位
Node=v25.2.1
pnpm=9.0.0
Playwright=Version 1.60.0
Next=Next.js v16.2.11
BrowserProject=chromium
BaseURL=http://127.0.0.1:5000 (default)
AgentRuntimeMode=legacy (default)
WorkflowRendererMode=legacy (default)
DATABASE_URL=unconfigured
PGDATABASE_URL=unconfigured
E2E_STAGE4_DATABASE_URL=unconfigured
E2E_STAGE4_RUN_ID=unconfigured
E2E_TEST_CREDENTIAL_PAIR=unconfigured
WUJIE_ADMIN_PASSWORD=unconfigured
TestedCodeSHA=dd29868cf8e40cbb1f60d614d2607db24f6972ea
```

No database URL, database username, password, admin credential, or authentication secret is persisted in this evidence.

### Files Changed By Third Review Fix

- Code/test commit: `scripts/stage-4-e2e-fixtures.mjs`, `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`.
- Documentation-only bookkeeping commit: `.superpowers/sdd/task-0-report.md`, `docs/testing/STAGE_4_BASELINE_REPORT.md`.
- Controller-owned `.superpowers/sdd/task-1-brief.md` was neither modified, reverted, staged, nor committed.

### Self-Review And Concern

- When both application DB variables exist, each is strictly parsed and validated, their normalized protocol/host/effective port/database/user/SSL identities must match, and the effective app target must still match `E2E_STAGE4_DATABASE_URL`.
- Tests cover both conflict directions, normalized-equivalent dual URLs, and exact one-variable acceptance. Errors and evidence contain no credentials.
- No Agent, chat, workflow, canvas, authentication, provider, billing, or other business behavior changed.
- Concern: this environment has no isolated Stage 4 DB/auth state, so Chromium correctly blocked before writes and real 100-node browser/performance measurements remain unavailable.

## Final Review Query-Override Fix Evidence (2026-08-17)

> The Third Independent Review evidence remains historical but is superseded for PostgreSQL query-parameter isolation by this section.

### Exact Tested Code Commit

- Tested code commit: `f83381fc42cac054e1d8aa0e33de89cf778130f8` (`test: block postgres query identity overrides`).
- The following documentation commit is bookkeeping only and references this exact prior code/test SHA.

### Root Cause And RED

- Root cause: WHATWG `URL` exposed authority/path fields while `pg-connection-string` gives some query parameters precedence or retains them as routing/session configuration. The guard therefore validated a different identity surface from `node-postgres`.
- Parser probe before implementation showed `?host=prod.example` resolved `host` to `prod.example`, while `hostaddr`, `service`, and `options` remained available to PostgreSQL configuration.
- RED command: `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`.
- RED result: exit 1; 7 failed, 14 passed. `host`, `hostaddr`, `user`, and `service` did not throw; `database`, `dbname`, and `options` threw the superseded error contract.

### Fix And GREEN

- The guard resolves `pg-connection-string` from `pg/lib/connection-parameters`, so both use `pg`'s installed parser version 2.10.1. The direct 2.6.0 dependency and lockfile remain unchanged.
- The raw query allowlist contains only one lowercase `sslmode`; accepted values are `disable`, `prefer`, `require`, `verify-ca`, `verify-full`, and `no-verify`.
- Every routing, authority override, service, schema/search-path, credential, duplicate, uppercase-key, and unknown query parameter blocks before parser side effects.
- Final compared identity contains canonical protocol, parser-resolved host, effective port, user, database, SSL mode, SSL-enabled state, and certificate-verification state. The strict run-scoped database-name requirement remains in force.
- Focused fixture GREEN: 23/23 tests passed, including `host`, `hostaddr`, `port`, `user`, `database`, `dbname`, `service`, and `options`; exact `sslmode=require`; final-equivalent syntax; and credential/full-URL redaction.

### Required Command Evidence

1. Focused Stage 4 command: `pnpm exec vitest run src/__tests__/lib/stage-4-modes.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/scripts/stage-4-e2e-fixtures.test.ts src/__tests__/helpers/stage-4-e2e.test.ts tests/unit/protected-baseline-gate.spec.ts`
   - Exit 0; 5 files and 36/36 tests passed.
2. `pnpm ts-check`
   - Exit 0; Next route types generated and TypeScript passed.
3. `pnpm test:inventory:stage-4`
   - Exit 0; routes=200, workspaces=3, nodeTypes=51, portTypes=10.
4. `pnpm run doctor`
   - Exit 0; actual stdout ended with `Summary: 25 passed, 12 warnings, 0 failed, 2 blocked`.
5. `pnpm check:protected-baseline`
   - Exit 0 against `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`; 38/38 IDs, no source drift, 0 warnings.
6. `git diff --check 7d659190d458732001be3db059838e76c367f5c7..f83381fc42cac054e1d8aa0e33de89cf778130f8` and `git diff --check 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b..f83381fc42cac054e1d8aa0e33de89cf778130f8`
   - Both exit 0 with pristine committed-range output.
7. Chromium: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`
   - Exit 1, intentionally BLOCKED before authentication and fixture writes: `E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation`.
   - Evidence directory: `test-results/stage-4-baseline/evidence/f83381fc42cac054e1d8aa0e33de89cf778130f8-worktree-3683a4b89198/stage4-2026-08-16T16-55-46/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/`.
   - Verified files: `final.png` (4254 bytes), `video.webm` (2650 bytes), `console.json` (2 bytes), `network.json` (2 bytes), `trace.zip` (2965 bytes).
8. Inventory artifacts
   - `stage-4-inventory.json` exists (12602 bytes); `stage-4-inventory.md` exists (9501 bytes).

### Files And Self-Review

- Code/test commit changed only `scripts/stage-4-e2e-fixtures.mjs` and `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`.
- Documentation bookkeeping changes only this report and `docs/testing/STAGE_4_BASELINE_REPORT.md`.
- No error or report contains a password or complete connection string. No Agent, chat, workflow, canvas, auth, provider, billing, stable, or controller-owned behavior/file changed.
- Concern: no isolated Stage 4 database was available, so authenticated seeding and real 100-node browser/performance measurements remain BLOCKED.

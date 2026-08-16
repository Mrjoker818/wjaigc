# Stage 4 Baseline Report

- Evidence date: 2026-08-17
- Exact tested code SHA: `dd29868cf8e40cbb1f60d614d2607db24f6972ea`
- Branch: `codex/wj-stable-s4`
- Task base: `7c668f0`
- Protected baseline: `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`
- Documentation commit: bookkeeping only; created after testing the SHA above

The earlier `6c2ead55c6c8277085a97149df45a11037483753` and `615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9` verification sections are retained as historical evidence. They are superseded for the dual-database-variable contract and reproducible environment metadata by the Third Review evidence below.

## Result

The Stage 4 fixture baseline is safe to block, not safe to seed, without an explicit isolated database target. The Chromium run stopped before authentication or persisted project writes because `E2E_STAGE4_DATABASE_URL` was absent. This is blocked evidence, not a passing browser or performance baseline.

## Isolation Contract

- `E2E_STAGE4_DATABASE_URL` is mandatory.
- Effective application DB selection follows production precedence, and when both `DATABASE_URL` and `PGDATABASE_URL` are configured their normalized identities must also match exactly.
- `E2E_STAGE4_RUN_ID` is mandatory, and both effective URLs must use the exact database name `wujie_stage4_<sanitizedRunId>`.
- Fixture and effective app URLs must match normalized protocol, host, effective port, database, user, and SSL target. Database/schema identity query parameters are rejected; credentials are never reported.
- Generic `E2E_TEST_USERNAME` credentials are accepted only when they exactly match the deterministic run-scoped disposable fixture username.
- Admin credentials may only provision that disposable account through `/api/admin/users`; the test then clears admin cookies and logs in as the disposable user before any project mutation.
- The seed helper rejects every non-disposable or non-run-scoped session before it sends user-data requests.

## Reproducible Environment

Actual PowerShell command output, with database and authentication values reduced to state only:

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

No database URL, username, password, or secret value is stored in this report.

## Third Review Verification

- RED: `pnpm exec vitest run src/__tests__/scripts/stage-4-e2e-fixtures.test.ts` exited 1 with 1 failed and 12 passed; isolated `DATABASE_URL` plus shared `PGDATABASE_URL` was incorrectly accepted.
- GREEN: the same command passed 13/13 after the guard began validating both configured variables.
- Focused Stage 4/protected suite: 5 files and 26 tests passed.
- `pnpm ts-check`: passed.
- Inventory: 200 routes, 3 workspaces, 51 node types, 10 port types; both inventory files exist.
- `pnpm run doctor`: exit 0; actual stdout ended with `Summary: 25 passed, 12 warnings, 0 failed, 2 blocked`.
- Protected baseline: fixed `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`, 38/38 feature IDs, 0 warnings.
- `git diff --check ffbacdb..dd29868` and `git diff --check 7fdc010..dd29868`: exit 0 with no whitespace errors.

## Third Review Chromium Blocked Evidence

Command: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`

Result: exit 1, intentionally BLOCKED at the database guard before authentication or fixture writes because `E2E_STAGE4_DATABASE_URL` was unavailable.

- [final.png](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/dd29868cf8e40cbb1f60d614d2607db24f6972ea-worktree-3683a4b89198/stage4-2026-08-16T16-39-42/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/final.png)
- [video.webm](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/dd29868cf8e40cbb1f60d614d2607db24f6972ea-worktree-3683a4b89198/stage4-2026-08-16T16-39-42/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/video.webm)
- [console.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/dd29868cf8e40cbb1f60d614d2607db24f6972ea-worktree-3683a4b89198/stage4-2026-08-16T16-39-42/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/console.json)
- [network.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/dd29868cf8e40cbb1f60d614d2607db24f6972ea-worktree-3683a4b89198/stage4-2026-08-16T16-39-42/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/network.json)
- [trace.zip](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/dd29868cf8e40cbb1f60d614d2607db24f6972ea-worktree-3683a4b89198/stage4-2026-08-16T16-39-42/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/trace.zip)

## Inventory

- Workspaces: 3
- Node types: 51
- Port types: 10
- Agent tools: 7
- Skills: 16
- Routes: 200

Entrypoints: canvas `/`, workflow `/?projectId=<project>`, simple chat `/simple-chat`.

Artifacts:

- [stage-4-inventory.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/inventory/stage-4-inventory.json)
- [stage-4-inventory.md](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/inventory/stage-4-inventory.md)

## Performance Gate

The fixture retains the exact expected 100-node ID set. The sampler rejects duplicate, missing, unexpected, and count-correct-but-wrong IDs, then monitors the fixture IDs rather than arbitrary DOM IDs. No real performance values were collected because the run was blocked before fixture seeding.

## Verification (Superseded First-Fix Evidence)

- Focused Stage 4 and protected-gate tests: 5 files, 20 tests passed.
- `pnpm test:inventory:stage-4`: passed; 200 routes, 3 workspaces, 51 node types, 10 port types.
- `pnpm doctor`: exit 0; stdout was empty.
- `pnpm check:protected-baseline`: passed with all 38 protected feature IDs and 0 warnings.
- `git diff --check 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b..6c2ead5`: passed with no output.

## Chromium Blocked Evidence (Superseded First-Fix Evidence)

Command: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`

Result: blocked before authentication and writes with `BLOCKED: E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation`.

- [final.png](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/final.png)
- [video.webm](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/video.webm)
- [console.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/console.json)
- [network.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/network.json)

The prior blocked browser record for `7c668f0` is superseded for this fix; it did not exercise this database guard.

## Second Independent Review Evidence

Tested code SHA: `615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9`.

- Focused Stage 4/protected suite: 5 files and 23 tests passed.
- `pnpm ts-check`: passed.
- Inventory: 200 routes, 3 workspaces, 51 node types, 10 port types.
- Protected baseline: fixed `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`, 38/38 IDs, 0 warnings.
- Committed-range whitespace checks for `08c2596..615d60d` and `7fdc010..615d60d`: exit 0 with empty output.

Doctor was run from PowerShell without redirection:

- `pnpm doctor`: exit 0, stdout empty, stderr empty; this resolved to pnpm's built-in command.
- `node scripts/doctor.mjs`: exit 0, stderr empty, stdout summary `25 passed, 12 warnings, 0 failed, 2 blocked`.
- `pnpm run doctor`: exit 0, stderr empty, package banner plus the same doctor stdout summary.

The two BLOCKED doctor facts were missing database-backed asset-graph verification and missing `POSTGRES_TEST_DATABASE_URL`. The exact direct-script stdout is preserved in `.superpowers/sdd/task-0-report.md`.

## Current Chromium Blocked Evidence

Command: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`

Result: intentionally BLOCKED before authentication and persisted writes because `E2E_STAGE4_DATABASE_URL` was unavailable.

- [final.png](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9-worktree-3683a4b89198/stage4-2026-08-16T16-27-32/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/final.png)
- [video.webm](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9-worktree-3683a4b89198/stage4-2026-08-16T16-27-32/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/video.webm)
- [console.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9-worktree-3683a4b89198/stage4-2026-08-16T16-27-32/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/console.json)
- [network.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9-worktree-3683a4b89198/stage4-2026-08-16T16-27-32/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/network.json)
- [trace.zip](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/615d60d7a3fa768fee42a23bbd99b1d21d1f5ee9-worktree-3683a4b89198/stage4-2026-08-16T16-27-32/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/trace.zip)

Authenticated seeding and real 100-node timing values remain BLOCKED until an isolated database matching the strict run-scoped identity is supplied.

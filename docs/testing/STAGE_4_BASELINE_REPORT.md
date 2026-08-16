# Stage 4 Baseline Report

- Evidence date: 2026-08-17
- Exact tested code SHA: `6c2ead55c6c8277085a97149df45a11037483753`
- Branch: `codex/wj-stable-s4`
- Task base: `7c668f0`
- Protected baseline: `main@7fdc0108952fb3a68415ca3a2a26b5d33641dc6b`
- Documentation commit: bookkeeping only; created after testing the SHA above

## Result

The Stage 4 fixture baseline is safe to block, not safe to seed, without an explicit isolated database target. The Chromium run stopped before authentication or persisted project writes because `E2E_STAGE4_DATABASE_URL` was absent. This is blocked evidence, not a passing browser or performance baseline.

## Isolation Contract

- `E2E_STAGE4_DATABASE_URL` is mandatory.
- The application's `PGDATABASE_URL` or `DATABASE_URL` is mandatory, must be isolated, and must target the same database/schema/application identity without comparing or recording credentials.
- Generic `E2E_TEST_USERNAME` credentials are accepted only when they exactly match the deterministic run-scoped disposable fixture username.
- Admin credentials may only provision that disposable account through `/api/admin/users`; the test then clears admin cookies and logs in as the disposable user before any project mutation.
- The seed helper rejects every non-disposable or non-run-scoped session before it sends user-data requests.

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

The sampler requires and records all 100 fixture node IDs. The browser spec asserts `monitoredNodeCount === 100` before accepting FPS, input delay, lost-node, or unclickable metrics. No real performance values were collected because the run was blocked before fixture seeding.

## Verification

- Focused Stage 4 and protected-gate tests: 5 files, 20 tests passed.
- `pnpm test:inventory:stage-4`: passed; 200 routes, 3 workspaces, 51 node types, 10 port types.
- `pnpm doctor`: exit 0; stdout was empty.
- `pnpm check:protected-baseline`: passed with all 38 protected feature IDs and 0 warnings.
- `git diff --check 7fdc0108952fb3a68415ca3a2a26b5d33641dc6b..6c2ead5`: passed with no output.

## Chromium Blocked Evidence

Command: `pnpm exec playwright test tests/e2e/stage-4-node-chat-agent.spec.ts --project=chromium`

Result: blocked before authentication and writes with `BLOCKED: E2E_STAGE4_DATABASE_URL is required for Stage 4 fixture isolation`.

- [final.png](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/final.png)
- [video.webm](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/video.webm)
- [console.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/console.json)
- [network.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/6c2ead55c6c8277085a97149df45a11037483753-worktree-3683a4b89198/stage4-2026-08-16T16-08-58/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/network.json)

The prior blocked browser record for `7c668f0` is superseded for this fix; it did not exercise this database guard.

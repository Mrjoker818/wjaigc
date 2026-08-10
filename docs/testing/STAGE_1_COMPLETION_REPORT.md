# Stage 1 Task and Billing Completion Report

## Build identity

| Field | Value |
|---|---|
| Stage | `WJ-STABLE-001 / S1` |
| Latest formal main | `32139c528f4c71284b4416739b4d5bbcf95874f2` |
| Candidate branch | `codex/wj-stable-s1-recovery` |
| Candidate checkpoint | `32139c528f4c71284b4416739b4d5bbcf95874f2` plus the current cloud evidence documentation |
| Test time | 2026-08-10, Asia/Shanghai |
| Current verdict | **Not passed** |

## Completed in Task 8

- Added a non-mocked Playwright release suite for exact deployment SHA, real account, exact `providerId::modelId`, `n=1/2/3/4`, task terminal state, canvas results, credit balance, credit transactions, refresh recovery, and logout.
- Added explicit `workflow_dispatch` inputs and secrets for PostgreSQL plus paid Chromium, Firefox, and WebKit evidence.
- Added an exact per-file Stage 1 source allowlist. It does not permit directory-wide `src/` drift.
- Protected baseline gate retains all 38 protected feature IDs, all literal component paths, and all evidence contracts.
- Playwright discovers the Stage 1 suite in Chromium, Chromium 1080p, Firefox, and WebKit.

## Executed evidence

| Gate | Result | Evidence |
|---|---|---|
| Stage 1 release contract | PASS | 1 file / 3 tests |
| TypeScript | PASS | `pnpm ts-check` |
| Changed-file ESLint | PASS | Stage 1 E2E and contract files |
| Protected feature/source gate | PASS WITH WARNING | 38/38 protected IDs; exact allowlist accepted; recorded baseline metadata SHA is older than current `origin/main` |
| PostgreSQL-focused test command | PASS | 3 files / 9 authoritative tests passed against isolated PostgreSQL 18; 0 skipped |
| Doctor | PASS FOR LOCAL DATABASE GATE | 22 pass, 12 warnings, 0 failures, 0 blocked with `POSTGRES_TEST_DATABASE_URL` supplied |
| Stage 1 Playwright compilation/discovery | PASS | Four browser projects list the real task/billing test |
| Real paid provider run | PARTIAL PASS | Coze Pear `gpt-image-2` direct generation and progressive `n=1/2/3/4` task/billing acceptance passed. Firefox/WebKit and browser-visible canvas persistence/download remain open. |
| Direct credit reconciliation | PASS | BUG-051 task `direct-1786341342235-0-8pta21`: one image, balance/transaction -60, persisted `creditCost=60`, `billing.cost=60`, charged status. |

## Open release blockers

1. Timeout-specific deployed evidence must prove abort propagation, a stable `timeout` terminal state, rejection of late provider completion, and at-most-one refund.
2. The `core-v2 -> legacy` rollback rehearsal must prove no data loss, duplicate task creation, or duplicate billing.

## Completion rule

Stage 1 may be marked complete only after all open blockers above are closed. A local build, mocked provider, skipped database suite, HTTP 200, or browser test discovery is not completion evidence.

## 2026-08-09 real PostgreSQL checkpoint

The candidate after `2682edbe11cbf75e2040d6899c028f897599a17e` was exercised against an isolated loopback-only PostgreSQL 18 database. The first run failed and revealed two production-relevant defects: missing audit-log base DDL and an illegal NUL byte in the advisory-lock identity. Both fixes were added through RED/GREEN tests.

| Gate | Result | Evidence |
|---|---|---|
| Doctor with `POSTGRES_TEST_DATABASE_URL` | PASS | 22 pass, 12 warnings, 0 failed, 0 blocked |
| Authoritative PostgreSQL suites | PASS | 3 files / 9 tests, 0 skipped |
| 20-way cold-start idempotency | PASS | One durable winner; no charge for zero-cost request |
| 20-way paid idempotency | PASS | One durable winner and exactly one charge |
| Failure/cancel/timeout race | PASS | One terminal winner and at most one refund |
| Focused task/billing regression | PASS | 4 files / 77 tests |
| TypeScript / changed-file ESLint | PASS | TypeScript passed; ESLint 0 errors |

The PostgreSQL item is removed from the open-blocker list. Full Vitest and TypeScript pass; ESLint exits with 0 errors and 960 historical warnings; the 112-page production build and 38/38 protected-feature gate pass. BUG-051 cloud credit reconciliation also passes. The current verdict remains **Not passed** because exact runtime identity, complete paid three-browser canvas evidence, deployed cancellation/timeout/late-result proof, and rollback rehearsal remain open.

## 2026-08-10 Task 8 progress update

The paid real-provider suite has now run in Chromium, Firefox, and WebKit. Each engine completed `n=1/2/3/4`, returned ten real images, reached durable terminal states, reconciled billing, filled the canvas, survived refresh, returned to the workbench, and logged out. Evidence bundles contain completed manifests, screenshots, Console logs, network logs, task billing, and four request IDs per engine.

A real Pear cancellation also passed the behavioral boundary: the task was cancelled twice, refunded exactly once, restored 60 credits, and remained cancelled after 50 seconds. This run exposed BUG-052 because the task and transaction lacked durable transaction linkage. The minimal SQL fix passes `46/46` focused unit tests and a real isolated PostgreSQL 18 integration test. Stage 1 remains **Not passed** until that fix is accepted in cloud, a timeout-specific run passes, rollback is rehearsed, and the runtime SHA is independently exposed.

## 2026-08-10 BUG-052 cloud acceptance and runtime identity

The deployed fix is now accepted. Google Chrome submitted one real Pear `gpt-image-2-4k` slot and cancelled the newly created task. Task `async-1786354360647-0-rhvubs` persisted `cancelled/refunded`, retained charge transaction `ctx_1786354360664_6lgxf98n` and refund transaction `ctx_1786354388276_dbyvw059`, and remained cancelled at the final check. The ledger returned exactly one -120 consume and one +120 refund, restoring the balance from 258 to 378; the refund description contains the same task ID.

Runtime identity is also closed for this acceptance run. The process on port 5000 was PID 3573, cwd `/workspace/projects`, command `next-server (v16.2.10)`, build ID `M_Yl150aYcK3uKYM_mbG_`, and worktree commit `d531ce65c1c3cb1dddaf9922696f1d11fe9c3452`. That Coze-only launcher commit has GitHub `main@32139c528f4c71284b4416739b4d5bbcf95874f2` as its direct parent; its only delta loads `.env` in `scripts/coze-start.sh`. The tested business source is therefore independently tied to GitHub main without claiming that the Coze launcher commit itself exists on GitHub.

Stage 1 remains **Not passed**. The remaining gates are a timeout-specific deployed proof and the `core-v2 -> legacy` rollback rehearsal. BUG-052 and exact runtime identity are no longer blockers.

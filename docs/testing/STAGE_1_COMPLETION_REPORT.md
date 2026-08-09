# Stage 1 Task and Billing Completion Report

## Build identity

| Field | Value |
|---|---|
| Stage | `WJ-STABLE-001 / S1` |
| Latest formal main | `9ff09fb08f0e97134f0112617794cde9cde3f545` |
| Candidate branch | `codex/wj-stable-s1` |
| Candidate checkpoint | `db896a3d95ac208b172a57565490e0a18852490c` plus the uncommitted Task 8 gate/report changes |
| Test time | 2026-08-09, Asia/Shanghai |
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
| PostgreSQL-focused test command | BLOCKED | 6 tests passed; 3 real PostgreSQL tests skipped because `POSTGRES_TEST_DATABASE_URL` is absent |
| Doctor | BLOCKED FOR RELEASE | 21 pass, 12 warnings, 0 failures, 1 blocked PostgreSQL test database |
| Stage 1 Playwright compilation/discovery | PASS | Four browser projects list the real task/billing test |
| Real paid provider run | NOT EXECUTED | No deployment URL/SHA/account/model secrets were supplied to this local run |

## Open release blockers

1. Full repository lint still has the inherited 4 errors / 960 warnings recorded at the Task 7 checkpoint.
2. Full repository tests still have the inherited 10 failures recorded at the Task 7 checkpoint.
3. Real PostgreSQL must prove 20-way idempotency, conditional terminal transitions, one charge, and at-most-one refund.
4. The exact deployed commit must pass the paid `n=1/2/3/4` run in Chromium, Firefox, and WebKit with request IDs, task IDs, provider route, canvas results, and ledger evidence.
5. Cancellation, timeout, late provider completion, one-time refund, and `core-v2 -> legacy` rollback still require deployed evidence.

## Completion rule

Stage 1 may be marked complete only after all open blockers above are closed. A local build, mocked provider, skipped database suite, HTTP 200, or browser test discovery is not completion evidence.

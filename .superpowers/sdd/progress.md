# WJ-STABLE-001 Stage 2 Progress

Baseline: `origin/main@ffe810939a446bbf7288d177b95040b36a05484c`  
Branch: `codex/wj-stable-s2`  
Plan: `docs/superpowers/plans/2026-08-10-wujie-stable-asset-version-graph-stage-2.md`  
Protected branch baseline: `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` (user-confirmed read-only stable tip)
Governance confirmation 2026-08-11: the user intentionally updated `stable` from `a53da24` to `52f7c60`; this Stage 2 branch did not write it and will keep it untouched

| Task | Status | RED evidence | GREEN evidence | Review | Commit | Cloud SHA | Unverified |
|---|---|---|---|---|---|---|---|
| 0 Baseline and ledger | completed | Full Vitest: 1 failed / 1806 passed / 8 skipped; indentation-sensitive recovery settlement assertion | Focused recovery lease contract: 13/13; full Vitest: 356 files / 1807 tests passed, 8 env-gated skipped, 0 failed | self-review passed | `dd20b84` | plan-only checkpoint, no cloud deploy required | `stable@a53da24` reverified unchanged |
| 1 Domain and migration | completed | Initial domain module absent; review RED reproduced four failures: missing TLS normalizer export, invalid runtime pair handling, DB accepted `canvas/chat-result`, concurrent runners hit a duplicate-key race | Real PostgreSQL: 3 files / 8 tests passed; concurrent runners both exit 0; SHA-256 happy/mismatch verified; `ts-check`, targeted ESLint, full `pnpm test`, and production build passed | independent R2 review `APPROVED`, 0 findings | `dd20b84..38e578b` | Coze Checkpoint A `main@f733885`, `legacy`, five additive migrations, build/start passed | Runtime transfer is intentionally deferred to Checkpoint B; coverage plugin is not installed |
| 2 Atomic storage and transfer | completed | Initial modules absent; review waves reproduced cross-project rejection, placement lifecycle races, version-idempotency 23505, weak lineage/index proof, authorization short-circuit, cleanup deadlock risk and fixed-sleep race amplification | Real PostgreSQL: 8 integration + 7 unit tests passed; 20-way cross-project transfer creates one target graph; exact lineage/index, owner/project auth, trash/restore races and failure-safe barriers verified; `ts-check`, targeted ESLint, full Vitest and production build passed | fifth independent review `APPROVED`, 0 findings | task commits `7ee6f76`, `80c59dd`, `c3861af`, `0d7ee9e`, `24df8df` | Coze Checkpoint A `main@f733885`, `legacy`, five additive migrations, build/start passed | Cross-workspace runtime transfer is intentionally deferred to Checkpoint B |
| 3 Legacy readers and copy-on-write | completed | Initial modules absent; review regressions then failed 3 cases for text corruption, unstable retry mappings, and key-order-sensitive comparison | Real PostgreSQL 19/19; login protection 18/18; `ts-check`, `lint:build`, full `pnpm test`, 112-page production build, and 38/38 protected-function gate passed | independent R2 review `APPROVED`, 0 findings | `8b73b68`, `b1fc8f4` | Coze Checkpoint A `main@f733885`, `legacy`, preview and auth entry healthy | Asset-authoritative read remains prohibited until later rollout gate |
| 4 Canvas shadow and broken media | completed | R7-R10 reproduced reload resurrection, GET/POST races, split-brain adoption, invisible broken media, same-ID restore, legacy reader and identity failures | Task4 108/108; login 25/25; protected baseline 38/38; TypeScript, full Vitest and 112-page build passed | independent R11 `APPROVED`, Critical/Important/Minor 0 | `f674aa9..6e4df31` | Checkpoint B functional candidate `3431e7d` pushed; bookkeeping follows; Coze shadow pending | Live PostgreSQL concurrency remains UNVERIFIED without `POSTGRES_TEST_DATABASE_URL` |
| 5 Canvas/chat/workflow transfer | completed | Initial RED covered unauthorized asset resolution and missing transfer wiring; R1-R2 reproduced executor 401, incomplete chat entry coverage, stale identity, URL/version misassociation, actor-key idempotency gaps, managed output re-upload, equal-URL output collapse, and late transfer overwrite | Final controller Task 5 suite 62/62; Task4 108/108; login 25/25; asset unit 9/9; TypeScript, targeted ESLint, protected baseline 38/38, full Vitest, and 114-page build passed | independent R3 `APPROVED`, Critical/Important/Minor 0 | `2d28516..55d0fed` | Checkpoint B functional candidate `3431e7d` pushed; bookkeeping follows; Coze shadow pending | Live PostgreSQL concurrency remains UNVERIFIED without `POSTGRES_TEST_DATABASE_URL` |
| 6 Standalone chat transfer | completed | Original RED 7 failed / 4 passed; R1 RED 31 failed / 16 passed / 10 PostgreSQL skipped; R2 RED 6 failed / 27 passed | Task 6 focused 57/57; Task 5 62/62; Task 4 108/108; login 25/25; protected baseline 38/38 | independent R3 `APPROVED`, Critical/Important/Minor 0 | `4934ee9..d0c2e28` | Checkpoint B functional candidate `3431e7d` pushed; bookkeeping follows; Coze shadow pending | Live PostgreSQL concurrency remains UNVERIFIED without a configured database URL |
| 7 Task result projection | pending | pending | pending | pending | pending | pending | Completed-only projection and late-result isolation |
| 8 Trash/recovery/orphan media | pending | pending | pending | pending | pending | pending | Physical purge remains disabled until final gate |
| 9 E2E and rollout | pending | pending | pending | pending | pending | pending | Chromium/Firefox/WebKit and cloud rollback |

## Scope Guard

- In scope: Asset, AssetVersion, WorkspacePlacement, lineage, transfers, trash, orphan media, broken media, legacy compatibility.
- Out of scope: Stage 3 canvas kernel, Stage 4 node/Agent redesign, Stage 5 business tool quality work, BUG-053 unless it blocks Stage 2.
- Rollback: switch `WUJIE_ASSET_GRAPH_MODE` to `legacy`; do not drop tables or delete versions.

## Stable Branch Governance

- Read-only `git ls-remote` observed `stable` move from `a53da24` to `52f7c60` while `main` remained `dd20b84`.
- The user confirmed on 2026-08-11 that `52f7c60` is an intentional stable update.
- `52f7c60` is now the accepted protected stable baseline for Stage 2; this worktree performed no write to it and will not revert, merge into, or overwrite it.
- Tasks 1-3 and all local Checkpoint A technical gates are complete. The governance blocker is closed; Checkpoint A was pushed to `main` only after a fresh remote-ref and protected-baseline check.

## Checkpoint A Push

- Pre-push refs: `main@dd20b84`, `stable@52f7c60`.
- Protected baseline immediately before push: 38/38, no unapproved drift, 0 warnings.
- Fast-forward push: `main@dd20b84 -> 0416372`.
- Post-push refs: `main@041637274a6fd10c699d6e581ebed59ea3d91ed8`, `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- Next gate: Coze must pull the final Checkpoint A commit and start only in `legacy` or `shadow`; exact runtime SHA and migration evidence remain UNVERIFIED.

## Checkpoint A Cloud Closure

- GitHub refs reverified immediately before Task 4: `main@f733885710cbc3208151823e53ef6105fcd4c7ac`, `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- Coze change card records `main@f7338857`, `WUJIE_ASSET_GRAPH_MODE=legacy`, five additive Stage 2 migrations, dependency install and rebuild; the short SHA uniquely matches the full `origin/main` SHA above.
- Coze terminal evidence: Next.js 16.2.10 production build completed, port 5000 became ready, persistent data root loaded, database core/file migration completed without overwriting existing data, and preview rendered the authenticated entry chooser without an identity-verification loop.
- The local Python/IOPaint model warning is an existing API-fallback condition and is not a Stage 2 migration failure.
- Checkpoint A is closed in `legacy`. `asset-v3` remains prohibited. Task 4 is the only active item.

## Task 4 Closure

- Task 4: complete (commits `f674aa9..6e4df31`, independent R11 review clean).
- Persistent per-user authoritative adoption, monotonic GET/POST synchronization, mutation gating, explicit broken-media rendering, whole-project tombstone and same-ID restore are covered by executable regressions.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only and untouched. No Task 4 commit has been pushed.
- Task 5 is the next permitted scope. Checkpoint B remains blocked until Tasks 5-6 and all gates pass.
- Live PostgreSQL concurrency remains **UNVERIFIED** because `POSTGRES_TEST_DATABASE_URL` is unavailable.

## Task 5 Closure

- Task 5 is complete at `55d0fed6881a542764fc52dddf1f1b971bf537e0` after independent R3 review approved both specification and quality with 0/0/0 findings.
- Authorized Asset resolution and transfer, Canvas to embedded chat, Canvas to workflow, and workflow output to Canvas now retain canonical AssetVersion and placement identity without trusting client URLs or re-uploading managed media.
- Equal URLs with different versions remain distinct structured insertions; pending Canvas-to-workflow transfers use generation guards so late responses cannot overwrite user edits.
- Task 5 controller tests passed 62/62. Task 4 108/108, login 25/25, protected baseline 38/38, TypeScript, full Vitest, and the 114-page production build remain green.
- Live PostgreSQL concurrency is still **UNVERIFIED** because `POSTGRES_TEST_DATABASE_URL` is unavailable. No cloud Checkpoint B claim has been made and nothing has been pushed.
- Task 6 standalone chat transfer is now the only active item. Tasks 1-5 must not be repeated; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains untouched and `asset-v3` cloud rollout remains prohibited.

## Task 6 Closure

- Task 6 is complete at `d0c2e28459962a8097aa5b7502d00f9477fa47e2` after independent R3 review approved specification and quality with 0/0/0 findings.
- Standalone chat attachments and generated results retain legacy URLs while adding canonical AssetVersion and placement identity. Explicit transfer targets a selected Canvas project and never treats localStorage as authorization.
- Internal generate, poll, and save-image requests carrying signed identity use controlled loopback URLs. Managed bridge references are reauthorized after project hydration; only explicit 404 `ASSET_NOT_FOUND` references may be omitted, while temporary or malformed responses retain the whole bridge for retry.
- Controller gates passed: Task 6 57/57, Task 5 62/62, Task 4 108/108, login/session 25/25, and protected baseline 38/38 with 0 warnings. The historical Task 4 report hash remains unchanged.
- Live PostgreSQL concurrency and rollback remain **UNVERIFIED** because no database URL is configured. Task 6 is locally closed, but Checkpoint B is not yet a cloud pass and nothing has been pushed.
- The only active item is Checkpoint B: fresh full repository gates, exact remote-ref protection, push to `main` only, then Coze `shadow` verification. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only and cloud `asset-v3` remains prohibited.

## Checkpoint B Push

- Final local gates before push passed: Task 6 57/57, Task 5 62/62, Task 4 108/108, login/session 25/25, TypeScript, full ESLint with 0 errors and 958 historical warnings, full Vitest, 114/114 production pages, and protected baseline 38/38 with 0 warnings.
- Pre-push refs were `main@f733885710cbc3208151823e53ef6105fcd4c7ac` and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`. The candidate was a clean fast-forward from remote main.
- The verified functional candidate was fast-forwarded as `3431e7d522a31f0e46dee8bede8557c1cf592272`; documentation-only bookkeeping commits follow it on `main`. GitHub `stable` remained exactly `52f7c601ed150769e15d06fb435c6e360e28c9e7` and was not pushed or modified.
- Checkpoint B is now **pushed / cloud UNVERIFIED**. Coze must pull the exact final bookkeeping SHA, start in `shadow`, and prove Canvas, embedded chat, workflow, and standalone chat transfers without enabling `asset-v3`.
- Live PostgreSQL concurrency remains **UNVERIFIED** because the local database URL is absent. This unresolved evidence must remain visible during the cloud checkpoint.

## Checkpoint B Cloud Reproduction and Candidate Repair

- In Coze `shadow`, Canvas to embedded chat, Canvas to workflow, and workflow output to Canvas passed browser and database verification.
- Standalone chat to the selected Canvas wrote exactly one placement and showed `已添加 1 张图片`, but the Canvas rendered `MEDIA_LOAD_FAILED`. The provider returned `/v1/images/proxy/img_96d9753789af4461aaceaf9f5d3d951a`; persistence rejected that relative URL and the raw path was incorrectly stored as a ready AssetVersion.
- BUG-055 has a minimal TDD candidate: `parseResponseForProfile` resolves provider-relative direct image URLs against the actual response URL, and `/api/generate` supplies `resp.url`. The focused regression is 16/16; Task 6 is 57/57, Task 5 is 64/64, Task 4 is 108/108, TypeScript passes, ESLint is 0 errors / 957 historical warnings, full Vitest exits 0, the 114-page production build passes, and protected baseline is 38/38.
- Two additional cloud defects remain registered, not repaired in this candidate: BUG-056 (standalone-chat pasted data URL reference fails provider base64 decoding) and BUG-057 (completed generated result still displays `图片生成中... 1`).
- Checkpoint B remains **OPEN** until the exact candidate is deployed and a fresh standalone-chat result renders as a usable Canvas image without duplicate placement. Task 7 remains prohibited. PostgreSQL integration suites remain **UNVERIFIED** locally because `POSTGRES_TEST_DATABASE_URL` is absent.

## Checkpoint B Cloud Closure

- GitHub `main@846c0c4e923bb5fad227c16ace17ce8aaf5c99cf` was deployed through Coze runtime commit `ff0242e2c243979850bb38013a2ff9a0b32228df`; the GitHub candidate is its direct parent. The only runtime delta is the existing `scripts/coze-start.sh` deployment adapter. Runtime mode is `shadow`, task core is `legacy`, port 5000 and auth health return HTTP 200, and stable was not touched.
- A fresh real Gpt Image 2 generation completed in standalone chat and transferred to `project_1786342484250_vjti42ltw`. Canvas rendered the new image from `/api/serve-upload/uploads/gen-1786455914641-nimwmk.png`; the historical broken result remained isolated.
- Database evidence: AssetVersion `5560a3a4-8932-4602-a4e7-7c2a42d1c5c1` is `ready`, `image/png`; the target Canvas has exactly one `canvas-image` placement `41320144-68ba-4cb3-bfa0-ac1494526eb3`. A second click reused the same idempotency key and did not create another target placement.
- All four Checkpoint B transfer directions now pass in cloud `shadow`. BUG-055 is closed. BUG-056 and BUG-057 remain open and do not disappear from the register.
- Checkpoint B is **PASSED**. Task 7 is now the only permitted implementation scope. `asset-v3` remains prohibited, stable remains read-only, and the six environment-gated PostgreSQL suites remain **UNVERIFIED** locally.

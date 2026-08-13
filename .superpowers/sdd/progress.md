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
| 7 Task result projection | completed locally | Completed-only projection, replay, late-result, metadata merge, 3D auth/IDOR, and explicit-retry idempotency tests failed before implementation | Task 7 extended suite 84 passed / 4 PostgreSQL skipped; focused 3D/workflow 23/23; full Vitest exit 0; TypeScript; ESLint 0 errors / 957 historical warnings; 114-page build; protected baseline 38/38 | independent R6 `APPROVED`, Critical/Important/Minor 0 | `12a9026` | pending Coze `shadow` verification | `POSTGRES_TEST_DATABASE_URL` absent; live projection concurrency remains UNVERIFIED |
| 8 Trash/recovery/orphan media | completed locally | Missing lifecycle modules/routes and focused recovery contracts failed before implementation; review RED waves reproduced unsafe shared-asset trashing, stale candidate reuse, basename cross-match, incomplete recovery attempts, lock-order gaps, serialization retry omissions, purge fail-open facts, batch path traversal and GET mutation | Task 8 focused: 72 unit/API passed plus 5/5 real PostgreSQL; full PostgreSQL-enabled Vitest 2105 passed / 4 unrelated `TEST_POSTGRES_URL` skips; `ts-check`; ESLint 0 errors / 957 historical warnings; production build exit 0; protected baseline 38/38 / 0 warnings | task review R5, whole-branch re-review, and `c563efd` review all `APPROVED`, 0/0/0 | `b969c87..c563efd` | Checkpoint C technical push gate met locally; push pending final bookkeeping | Coze shadow verification remains pending; physical purge disabled; four unrelated PostgreSQL tests use separate env key |
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

## Task 7 Local Closure

- Task 7 implementation commit is `12a9026eaf35e60410f775ae59f10c5d7eabe769`. Authoritative completed image, edit, Agent, annotation, video, 3D, workflow, embedded-chat, and standalone-chat tasks now project idempotently into immutable AssetVersion records and authorized placements.
- Only the winning `completed` terminal transition projects. Failed, cancelled, timeout, and late results do not create active versions; projection failures remain completed tasks with `projection_pending` audit state for recovery, without recharging or rewriting the task terminal.
- Workflow 3D submission now preserves signed internal identity, user billing, project/session/message provenance, and a stable per-attempt idempotency key. Explicit retries receive a new attempt identity. Polling requires an existing user-owned local task and binds provider/model to persisted task facts, rejecting arbitrary remote task IDs.
- Independent review R6 is `APPROVED` with Critical/Important/Minor `0/0/0`. Final local gates passed: Task 7 extended suite `84 passed / 4 skipped`, 3D/workflow focused `23/23`, `pnpm ts-check`, full `pnpm test`, full ESLint `0 errors / 957 historical warnings`, production build `114/114`, protected baseline `38/38 / 0 warnings`, and unchanged protected report hash `943816946B0E33AC20443C1AECE527CA70186B869B7130F72573FF7D9143D69D`.
- The four skipped tests are not passes: `POSTGRES_TEST_DATABASE_URL` is absent, so real PostgreSQL projection, task-state, and billing concurrency remain **UNVERIFIED**. Cloud `shadow` deployment is also pending. `asset-v3` remains prohibited and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains untouched.
- Next permitted scope after the Task 7 bookkeeping push is Task 8 only: trash, restore, media health, and orphan governance. Physical purge remains disabled until its final gate.

## Task 8 Local Closure

- Task 8 implementation range is `b969c87893cd7c16674ec2607594f201b74a0129..90cad2ef18f499afdd21543b90a85d7821365668` on `codex/wj-stable-s2`.
- Placement-aware soft deletion and restoration now preserve shared assets, trash an asset only after its final active placement is removed, retain the 30-day boundary, and never perform physical media deletion.
- Media recovery and orphan governance use exact managed paths, fail-closed legacy reference checks, asset-to-version-to-placement lock ordering, deterministic confirmation digests, and SERIALIZABLE bounded retry for candidate-set changes.
- The existing admin recovery route remains compatible while each missing entry is attempted independently; partial Canvas batch deletion reconciles successful deletions without hiding failures.
- Final whole-branch review initially found purge fail-open facts, batch path traversal, and GET mutation. Commit `90cad2e` closed all three with five new RED/GREEN regressions; final re-review is `APPROVED`, Critical/Important/Minor `0/0/0`.
- Fresh local evidence: Task 8 focused `72 passed / 5 PostgreSQL skipped`; `pnpm ts-check` exit 0; full `pnpm test` `2074 passed / 35 environment-skipped`; full ESLint `0 errors / 957 historical warnings`; production build exit 0; protected baseline `38/38 / 0 warnings`; `git diff --check` exit 0. The protected Task 4 report hash remains `943816946B0E33AC20443C1AECE527CA70186B869B7130F72573FF7D9143D69D`.
- A local PostgreSQL 18 cluster was started under untracked `output/`, listening only on `127.0.0.1:55433`. Task 8 lifecycle passed `5/5`; PostgreSQL-enabled full Vitest passed `2105` with four unrelated suites still skipped because they require the separate `TEST_POSTGRES_URL` variable.
- The first PostgreSQL-enabled full run exposed a stable Task 7 test-isolation defect: `ensureCloudTaskTables()` reused its completed initialization Promise after an isolated schema was dropped. RED was `1 passed / 1 failed`; commit `c563efd` scopes the cache to the current connection string/search path. GREEN: projection `2/2`, storage `46/46`, billing `11/11`, followed by full PostgreSQL-enabled Vitest `2105 passed / 4 skipped`.
- Checkpoint C's Task 7-8, S1 billing, full-regression, and protected-feature technical gates are now met locally. Coze remains unchanged, `asset-v3` remains prohibited, and physical purge remains disabled until the candidate is pushed and deployed in `shadow`.
- Task 9 has not started. The next permitted action is final review/bookkeeping, exact remote-ref verification, then fast-forward push to `main` only for Checkpoint C; Tasks 1-8 must not be repeated.

## Checkpoint C Cloud Reproduction and Candidate Repair

- Coze `shadow` on `main@f8bb57c` completed a real Pear generation but exposed BUG-063: Canvas omitted `projectId`, the processing placeholder entered the asset graph, and the completed result received a second legacy identity instead of adopting the task projection.
- The local TDD candidate sends the effective project, uses `${taskId}:${outputIndex}` Canvas identities for direct and asynchronous tasks, records `generationTaskId`, excludes placeholders, adopts matching task projections, coordinates all Canvas deletes through placement-first persistence, and aligns version/placement lock order.
- Independent review initially found unmanaged delete entry points and a lock-order risk; both are now permanent regressions. Focused affected tests pass `48/48` and TypeScript passes.
- BUG-064 remains open: cloud media recovery rendered its source but the durable version stayed `recovering`. Checkpoint C is **NOT PASSED**, Task 9 has not started, `asset-v3` and physical purge remain disabled, and stable remains untouched.
- Final BUG-063 candidate gates: affected regression `51/51`; full Vitest `2083 passed / 35 environment-skipped / 0 failed`; TypeScript passed; ESLint `0 errors / 957 historical warnings`; production build `116/116`; protected baseline `38/38` with no unapproved source drift; `git diff --check` passed. Current-candidate PostgreSQL tests remain skipped because `POSTGRES_TEST_DATABASE_URL` is absent.

## Checkpoint C BUG-064 Local Closure

- Coze pull baseline is confirmed as `main@4bbe6db`; the repair candidate is isolated on `codex/wj-stable-s2`. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only and unchanged.
- BUG-064 now uses authorized POST admission, GET status polling, Next.js `after()` execution, PostgreSQL lease/fencing, attempt-isolated exact media URLs, exact S3 or durable-local reads, raster MIME/byte/checksum validation, client singleflight/deadline, and explicit `unrecoverable` UI state.
- Final PostgreSQL-enabled full Vitest passed `402/402` files and `2160/2160` tests with zero failures/skips. TypeScript, build `116/116`, ESLint `0 errors / 957 historical warnings`, protected baseline `38/38`, and `git diff --check` pass.
- Independent final review returned `APPROVED` with no P0/P1/P2 findings. BUG-064 is closed locally but cloud pending; Checkpoint C remains NOT PASSED until the exact commit is deployed and real `shadow` generation/delete/reload/recovery evidence is captured.
- Task 9 has not started. `asset-v3` and physical purge remain disabled. Tasks 1-8 must not be repeated.
## 2026-08-12: Checkpoint C cloud PASS, Task 9 started

- GitHub `main@1344dec33f93fc9d8a19baeaf9ed251c28176f5f`; Coze runtime `6965f28ceb57650af0f87f10d6509603949f0eff` has that commit as its direct parent and differs only in `scripts/coze-start.sh`.
- BUG-064 cloud proof passed: `MEDIA_UNAVAILABLE` recovered to a real image, survived reload, and PostgreSQL recorded one `succeeded` attempt, one artifact, one active placement, zero GC candidates and `ready` availability.
- Checkpoint C is **PASS**. Task 9 is now the sole in-progress Stage 2 task. Tasks 1-8 are complete and must not be repeated.
- Task 9 scope remains exactly the written plan: two cross-workspace Playwright specs, Chromium/Firefox/WebKit plus mobile, Doctor rollout gates, full local gates, cloud shadow comparison, controlled test-only `asset-v3` switch and proven rollback to `legacy`, then reports and final review.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only. Physical purge remains disabled.

## 2026-08-13: Task 9 local acceptance complete, cloud switch pending

- Coze reported `4bbe6db`; fresh GitHub `origin/main` is `1344dec`, and the Task 9 branch contains both. The next push must be main-only, fast-forward, and must not touch `stable`.
- Browser matrix passed `50/50`: Chromium, 1920x1080 Chromium, Firefox, WebKit, and mobile Chromium each passed both Stage 2 specs (`10/10`). Fixtures are isolated per browser after a shared-user contamination was proven and removed from the execution method.
- BUG-065 managed-transfer adoption, BUG-066 transactional Canvas snapshot restore, and BUG-067 standalone entity identity were reproduced, fixed with TDD, and covered by real-browser plus PostgreSQL evidence.
- Full PostgreSQL-enabled Vitest passed `410` files / `2258` tests; the four remaining skips belong to separate `TEST_POSTGRES_URL` business-module suites. ESLint `0 errors / 959 warnings`, TypeScript, Doctor, 116-route production build, and `git diff --check` pass.
- Task 9 local state is complete enough for a candidate push, but Stage 2 remains in progress. Next unique action: push the exact main-only candidate, let Coze pull it in `shadow`, then perform the controlled test-only `asset-v3` switch and rollback to `legacy`. Physical purge remains disabled.

## 2026-08-13: Task 9 final review and rerun complete

- Coze's reported runtime baseline is `4bbe6db`; it is an ancestor of the candidate and must not be mistaken for the final Task 9 SHA.
- Final review closed BUG-068 standalone projection identity, BUG-069 duplicate bridge consumption, and BUG-070 transactional Canvas delete/restore revision handling. Lost-response retries now return the original delete revision, not a later global revision. Independent review is `APPROVED`.
- Fresh browser execution used one new controlled user/project set per browser and passed `50/50`. A run made with the server accidentally in default `legacy` mode and a later shared-fixture run were rejected as test-environment failures; neither was hidden nor counted.
- Fresh gates pass: full PostgreSQL-enabled tests, API and regression suites, TypeScript, Doctor, build `116` routes, protected baseline `38/38`, and `git diff --check`; ESLint is `0 errors / 959 warnings`. Evidence audit reports 108 recent manifests with zero missing required artifact files.
- Next unique action remains a main-only fast-forward push. Then Coze must pull the exact SHA in `shadow`; only after cloud comparison may the isolated `asset-v3` switch and mandatory `legacy` rollback be executed. `stable` and physical purge remain untouched.

## 2026-08-13: Task 9 BUG-071 local closure, cloud revalidation pending

- Controlled Coze `asset-v3` testing on base `3bd2850` found BUG-071: managed delete succeeded but Canvas undo did not durably restore the placement. Coze was returned to `legacy`; the original asset/version/placement tuple remained intact.
- Local TDD now reconciles managed restore/trash, project revision, the exact post-history snapshot, restored-ID suppression, concurrent undo/redo, and compensation on partial failure.
- The first local production-browser run retained a fixture 503 failure. The first matrix then exposed a real Firefox reload race; after binding snapshot commitment to lifecycle completion, Firefox passed and the full five-profile scenario passed `5/5`.
- Focused tests pass `11/11`; the final PostgreSQL-enabled full regression passes `413/413` files and `2273/2273` tests with zero failures or skips. TypeScript, Doctor, protected baseline `38/38`, build `116/116`, and whitespace checks pass.
- Stage 2 remains in progress. Next unique action after final gates is a main-only push, exact-SHA Coze pull, controlled `asset-v3` revalidation, and mandatory rollback to `legacy`. `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` and physical purge remain untouched.

## 2026-08-13: Task 9 candidate pushed to main

- The verified implementation was fast-forward pushed from `origin/main@1344dec33f93fc9d8a19baeaf9ed251c28176f5f` to `main@644a0809658d500d9e3815c14771dd10581f0998`; no force operation was used.
- Post-push verification confirmed `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` is byte-for-byte unchanged.
- Coze still reports the older runtime baseline `4bbe6db`. The next unique action is for Coze to pull the new main tip and prove the exact runtime SHA in `shadow`; do not start `asset-v3` until that comparison passes.

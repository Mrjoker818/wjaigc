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

## 2026-08-13: Task 9 cloud closure, Stage 2 complete

- GitHub `main@81fe303e73ba2f50d2ca0a6ed7201c5977758231` contains the verified BUG-071 repair. Coze's deployment lineage contains that exact source commit plus deployment-only change cards; no business-source delta was introduced and `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- Authenticated Chrome on the isolated Coze preview passed the controlled `asset-v3` sequence: delete -> Ctrl+Z restore -> Ctrl+Shift+Z trash -> Ctrl+Z restore -> reload. The same 800x534 Pear image remained visible after reload.
- PostgreSQL confirmed asset `559c7f48-04f1-544e-8ec5-3c23ba4fb975`, ready version `66621b79-77c2-561f-966f-0c9870ba168a`, and the unique active Canvas placement `696446c1-3278-5548-9427-3290ca3ea1a5`. The chat attachment and workflow input references remained active and pointed to the same asset/version.
- Exact-candidate `shadow` comparison passed: 5 legacy projects, one image in the controlled project, one active placement for each Canvas/chat/workflow entity type, zero owner/project mismatch, zero active placement with a non-ready version, and zero GC candidates.
- Mandatory rollback passed twice. Final runtime is `WUJIE_ASSET_GRAPH_MODE=legacy`, `WUJIE_TASK_CORE_MODE=legacy`, physical purge disabled; HTTP `/` and `/api/auth/me` are 200, login remains usable, and the controlled image remains visible.
- **Stage 2 is complete.** Tasks 1-9 must not be repeated. The next unique objective is Stage 3 Canvas kernel work under the existing no-feature-loss and `stable` read-only constraints.

## WJ-STABLE-001 Stage 3 Progress

Baseline: `origin/main@18346aa3c48f455ed8d01c3093eea2474e41a166`
Branch: `codex/wj-stable-s3`
Plan: `docs/superpowers/plans/2026-08-13-wujie-stable-canvas-kernel-stage-3.md`
Protected stable branch: read-only and untouched

| Task | Status | RED evidence | GREEN evidence | Commit | Cloud SHA | Unverified |
|---|---|---|---|---|---|---|
| 0 Baseline, three-state mode and ledger | completed locally | Focused RED: 5 expected failures for missing mode module, sync envelope, doctor output, and authenticated client adoption | Focused Task 0 suite passed; cross-platform source-wiring regressions 41/41; TypeScript passed; ESLint 0 errors / 959 historical warnings; full Vitest 902/902 suites, 2236 passed, 0 failed, 44 environment-pending; Doctor 22 pass / 13 warning / 0 fail / 2 blocked; production build 116/116; protected baseline 38/38 with 0 warnings | this Task 0 commit | `UNVERIFIED` | PostgreSQL, cloud exact-SHA, real-browser and performance evidence remain `UNVERIFIED` |
| 1 Real canvas performance and functional evidence baseline | baseline established; acceptance failing | Missing fixture module; invalid `wujie_projects.project_id` cleanup scope; Stage 3 output initially escaped its dedicated artifact directory | Fixture tests 7/7; TypeScript; full Vitest exit 0; ESLint 0 errors / 959 warnings; build 116/116; protected baseline 38/38 / 0 warnings; real Chromium: 100-node pass, 1-node persisted drag fail, 300-node hit-test continuity fail | this Task 1 commit | `UNVERIFIED` | PostgreSQL integration tests remain environment-gated; Chromium 1920x1080, Firefox, WebKit, mobile Chromium, cloud exact-SHA and rollback remain `UNVERIFIED` |
| 2 Viewport controller and pan/zoom continuity | completed locally; Stage 3 still in progress | Missing viewport state machine and React adapter produced the expected focused failures; occupied-right viewport tests then reproduced fit/culling behind the fixed workspace panel | Focused viewport/wiring suite 23/23; TypeScript; full Vitest exit 0; full-repository error-only ESLint exit 0; build 116/116; real Chromium 100/300-node pan both pass with zero disappeared frames and zero unclickable time | this Task 2 commit | `UNVERIFIED` | One-node persisted drag P1 remains open; PostgreSQL integration tests are environment-gated; Chromium 1920x1080, Firefox, WebKit, mobile Chromium, cloud exact-SHA and rollback remain `UNVERIFIED` |
| 3 Stable render projection and tiered media loading | completed locally; Stage 3 still in progress | Missing projection/media modules and missing incremental `applyChanges` produced the expected RED; relative requested URL versus absolute browser `currentSrc` produced an additional decode-commit RED | Focused suite 32/32; TypeScript; full Vitest 918/918 suites, 2268 passed, 0 failed, 44 environment-pending; ESLint 0 errors / 959 historical warnings; build 116/116; protected features 38/38; Chromium 100/300-node pan both pass with zero disappeared frames and zero unclickable time | this Task 3 commit | `UNVERIFIED` | One-node persisted drag P1 remains open; PostgreSQL integration tests are environment-gated; Chromium 1920x1080, Firefox, WebKit, mobile Chromium, cloud exact-SHA and rollback remain `UNVERIFIED` |
| 4 Selection and gesture controller | completed locally; Stage 3 still in progress | Missing selection/controller modules produced the expected RED; real reverse box selection reproduced a mouse box-select/long-press-pan race that shifted nodes instead of selecting them; independent review then reproduced three gesture-boundary regressions before commit | Focused suite 34/34; Task 4 Chromium 3/3; clean-fixture full Chromium 5/6 with only the 300-node input P95 failure retained; TypeScript; full Vitest 411 files / 2291 passed / 44 skipped; ESLint 0 errors / 966 historical warnings; build 116/116; protected features 38/38 present; independent re-review approved | this Task 4 commit | `UNVERIFIED` | Clean-fixture 300-node input P95 is 50.2ms versus the 50ms gate, with earlier runs at 56.8ms and 62.8ms; 12 PostgreSQL-gated files remain skipped; Chromium 1920x1080, Firefox, WebKit, mobile Chromium, cloud exact-SHA and rollback remain `UNVERIFIED` |
| 5 Canvas commands and explicit history transactions | completed locally; Stage 3 still in progress | Command/history modules were absent; RED then reproduced queued user edits losing conflicts, cross-project queue leakage, stale in-flight undo/redo writes, processing-geometry misclassification, first generation-group drag drift, and layer reorder bypass | Focused suite 56/56; Task 5 Chromium 3/3; full PostgreSQL Vitest 428 files / 2374 tests / 0 skipped; TypeScript and production build pass; independent fifth review found no P0/P1 | this Task 5 commit | `UNVERIFIED` | Final-build full Chromium remains 7/8 because 300-node input P95 is 52.3ms versus the fixed 50ms gate; an earlier run reached 72.5ms; async project-switch behavior lacks a component-level E2E; protected gate intentionally blocks 24 Stage 3 source drifts; external browser matrix, cloud exact-SHA and rollback remain `UNVERIFIED` |
| 6 Canvas task result projection | completed locally; Stage 3 still in progress | Missing projector behavior reproduced resumed terminal events, stale server overwrite, duplicate completion writers and task-slot reorder | Focused suite 48/48; Chromium progressive n=4 projection 1/1; full Vitest exit 0; TypeScript; ESLint; build 116/116; protected identities 38/38 | `157d797` | `UNVERIFIED` | S3-BUG-004, external browser profiles, cloud exact-SHA, rollback and protected-baseline approval remain open |
| 7 Non-blocking project persistence | completed locally; Stage 3 still in progress | Scheduler module and wiring were absent: initial focused run 9 failed / 4 passed; immediate flush initially exposed a same-input-task serialization boundary before the regression was added | Focused suite 35/35; PostgreSQL-enabled full Vitest exit 0; TypeScript; ESLint 0 errors / 966 historical warnings; build 116/116; Chromium save/refresh 2/2; 300-node save input P95 21.8ms, longest save task 0ms, reload state preserved | this Task 7 commit | `UNVERIFIED` | S3-BUG-004 full pan gate, four external browser profiles, cloud exact-SHA, rollback and 29 protected-baseline source drifts remain open |
| 8 Tool registry and mutually exclusive sessions | completed locally; Stage 3 still in progress | Registry/host modules and one authoritative tool-session state were absent; focused RED failed 6 files / 10 tests before implementation | Focused suite 32/32; five-profile production-browser tool-session flow 5/5; PostgreSQL-enabled full Vitest exit 0; API 477/477 plus separate PostgreSQL concurrency 3/3; component/lib regression 1759/1759; TypeScript; ESLint 0 errors / 966 historical warnings; Doctor 43/11/0/0; build 116/116; protected identities 38/38 | this Task 8 commit | `UNVERIFIED` | S3-BUG-004, full external-browser Stage 3 matrix, cloud exact-SHA/rollback, Firefox fixture-media decode and 32 protected-baseline source drifts remain open |
| 9 Component-boundary consolidation | completed locally; Stage 3 still in progress | Boundary RED 3 failed / 2 passed; lifecycle RED reproduced the anonymous non-passive wheel listener | Focused 58/58; full Vitest 2376 executed; PostgreSQL 46/46 plus 4/4; TypeScript/build/ESLint/diff pass | `ea2ce08` | `UNVERIFIED` | Full Task 10 gates, cloud exact-SHA and rollback remained open |
| 10 Full local, five-browser, exact-SHA and rollback gates | local gates completed; cloud closure pending | RED retained for resize pointer ownership, button-focused WebKit undo and protected-auth CI liveness probe; prior performance variance retained | Legacy 60/60; shadow 15/15; canvas-v2 15/15; focused 39/39; WebKit repeat 10/10; desktop Chromium 300-node 34.3ms and 21.6ms P95; Doctor/type/lint/test/API/regression/build/diff pass | pending final Task 10 commit | `UNVERIFIED` | Real provider P0, billing/refund, GitHub Actions, Coze exact-SHA shadow, isolated canvas-v2 and mandatory legacy rollback remain open |

### Task 0 Scope And Safety

- Added the fail-closed `legacy | shadow | canvas-v2` Canvas kernel mode contract. Unknown or absent values resolve to `legacy`; `shadow` remains legacy-authoritative for writes.
- The authenticated `/api/user-data/sync` GET response is the runtime authority. Client POST fields and tampered browser cache cannot elevate the mode; old cache envelopes remain readable as `legacy`.
- Doctor reports the effective mode without exposing the raw invalid environment value.
- Three existing source-wiring tests now normalize CRLF to LF before multiline assertions. This is test portability only; annotation settlement, autosave, and asset lock business code were not changed.
- Direct Doctor execution is environment-limited: missing local secrets/database/storage produced 13 warnings and 2 blocked checks. These are retained as unverified prerequisites, not counted as passes.
- The 44 pending full-suite tests are environment-gated and are not counted as passed. This was the Task 0 checkpoint; later task records supersede the old next-task wording below.

### Task 1 Real-Browser Baseline

- A guarded fixture seeder now creates 15 isolated projects: five browser profiles multiplied by 1, 100 and 300 controlled image nodes. It requires an exact database guard token, writes credentials outside the repository and restricts cleanup by owner, run ID and exact project IDs.
- RED/GREEN evidence was retained for the missing fixture module, the invalid cleanup column used for `wujie_projects`, and Playwright Stage 3 output routing. The focused infrastructure suite is `7/7`.
- Accepted Chromium evidence used an isolated PostgreSQL 18 database and local production server in `legacy` mode. The 100-node pan passed at `58.20 FPS`, `14.10ms` input P95, `99ms` longest task, zero disappearing frames and zero unclickable time.
- The one-node functional flow failed because dragging did not change the persisted coordinates from `80/80`. The 300-node pan reached `57.76 FPS` and `24.90ms` input P95 but accumulated `1583.20ms` of failed hit-test continuity. Both failures remain enabled and are the evidence targets for Task 2 and later ordered gesture/render work.
- Browser artifacts are written under ignored `test-results/stage-3-baseline/`; the tracked summary is `tests/reports/stage-3-canvas-baseline.md`. An initial HTTP 503 run caused by missing bootstrap configuration was rejected as environment setup evidence and was not counted as Canvas behavior.
- Task 1 establishes evidence only and does not alter Canvas business behavior. Task 2 is recorded separately below; cloud exact-SHA, four additional browser profiles and rollback remain `UNVERIFIED`.
- Fresh final gates: fixture tests `7/7`, TypeScript exit 0, full Vitest exit 0 with PostgreSQL integration tests still environment-gated, ESLint `0 errors / 959 warnings`, production build `116/116`, protected feature gate `38/38 / 0 warnings`, and `git diff --check` exit 0.

### Task 2 Viewport Controller

- Added a pure viewport state machine and `useCanvasViewport` adapter for pan begin/preview/commit/cancel, anchored zoom, reset/fit and screen/Canvas coordinate conversion.
- The three migration modes remain explicit: `legacy` is authoritative by default; `shadow` computes and records desensitized differences without writing business state; `canvas-v2` can become authoritative only through the existing authenticated mode envelope.
- Pan preview remains requestAnimationFrame-driven with direct transform updates. React state is committed at controlled boundaries; existing toolbar callbacks and Canvas DOM/tool signatures remain available.
- Fit/reset and culling now use the actual usable Canvas width after excluding the fixed right workspace panel. The browser continuity helper samples the interactive Canvas rather than treating legitimate fixed tool overlays as Canvas hit targets.
- Accepted local Chromium results: 100 nodes at `58.78 FPS`, input P95 `16.60ms`, longest task `87ms`, zero disappeared frames and zero unclickable time; 300 nodes at `57.27 FPS`, input P95 `17.10ms`, longest task `87ms`, zero disappeared frames and zero unclickable time.
- TDD retained the original missing-module/wiring RED and the occupied-right fit/culling RED. Fresh focused regression is `23/23`; TypeScript and `git diff --check` pass; full Vitest exits 0; full-repository error-only ESLint exits 0; production build is `116/116`.
- Seven PostgreSQL suites reported `BLOCKED` without `POSTGRES_TEST_DATABASE_URL` and are not counted as verified. The one-node persisted drag P1 remains open and enabled; Task 2 does not move it into history or conceal it.
- Task 2 completes the third of eleven Stage 3 tasks (`3/11`, approximately `27%`). The next unique task is Task 3 render projection and tiered media loading. Do not start it before the Task 2 commit and evidence ledger are closed.

### Task 3 Render Projection And Media Loading

- Added a pure render projection with `critical`, `visible`, `overscan` and `deferred` priorities. Selection, drag, resize, processing, annotation, comparison and active-tool sources are kept mounted, with one-render continuity for nodes leaving natural overscan.
- The Canvas R-tree now rebuilds only when the project hydration key changes. Movement, resize, insertion and deletion are applied incrementally from geometry snapshots; invalid geometry cannot poison the index.
- Added `CanvasSurface` and `CanvasMediaNode`. The prior decoded source stays visible until a replacement decodes, relative source identity is preserved when the browser expands `currentSrc`, stable dimensions are explicit, and existing missing-media recovery remains authoritative.
- Focused RED/GREEN closes at `32/32`. Fresh gates: TypeScript pass; full Vitest `918/918` suites, `2268` passed, `0` failed, `44` environment-pending; full ESLint `0 errors / 959 historical warnings`; production build `116/116`; protected features `38/38 / 0 warnings`; `git diff --check` exit 0.
- Local Chromium rerun: 100 nodes `58.30 FPS`, input P95 `17.10ms`; 300 nodes `56.50 FPS`, input P95 `17.10ms`; both produced zero disappeared frames and zero unclickable time. The one-node persisted drag P1 remains enabled and still fails at unchanged `80/80` coordinates.
- Task 3 completes the fourth of eleven Stage 3 tasks (`4/11`, approximately `36%`). The next unique task is Task 4 selection and gesture control, but it must not start in this Task 3 turn. Cloud exact-SHA, four-browser matrix, rollback and PostgreSQL-gated suites remain `UNVERIFIED`.

### Task 4 Selection And Gesture Controller

- Added a pure selection controller and `useCanvasSelection` React adapter for replace/toggle/append selection, z-order hit resolution, reverse-direction box selection, drag thresholds, cancel rollback and explicit gesture priority.
- Root cause reproduced in a real browser: a mouse blank-space pointerdown started both box selection and a 250ms long-press pan timer. Under a dense project the timer could become authoritative before the first pointer move, shifting the Canvas instead of committing the box. Mouse and pen now use box selection; touch retains long-press pan. Mouse pan remains available through the hand tool, Space and middle button.
- Pointer capture and ref-backed image-drag preview now preserve continuity outside the card. `pointercancel` rolls back preview without persistence, while pointerup publishes and force-saves the same committed image snapshot. Rendered DOM hit identity prevents a one-frame viewport-transform lag from converting blank selection into image drag.
- Independent review found and closed three Important boundaries before commit: touch long-press keeps its 6px jitter tolerance; ordinary/generation/hex group previews all roll back on `pointercancel`; Ctrl/Meta toggles multi-selection unless the existing reference-fusion mode is explicitly enabled. The same reviewer returned `APPROVED` after repair.
- Focused regression passes `34/34`. The Task 4 production Chromium grep passes `3/3`: real Ctrl add/remove multi-selection plus exact reverse box selection, pointercancel rollback, and drag/zoom/reset/reload persistence. After controlled fixture reseeding, the complete Stage 3 Chromium spec passes `5/6`; delete/undo/redo and 100-node pan pass.
- The 300-node pan remains a visible performance blocker: the clean-fixture run measured `50.2ms` input P95 against the fixed `<=50ms` threshold; preceding runs measured `56.8ms` and `62.8ms`. The latest run retained `57.18 FPS`, zero disappeared frames and zero unclickable time. The threshold was not raised.
- Fresh repository gates after review repair: full Vitest `411` files / `2291` passed / `44` skipped across `12` PostgreSQL-gated files and full ESLint `0 errors / 966 historical warnings`. Focused `34/34`, TypeScript, production build `116/116` and Task 4 Chromium `3/3` also pass; final `git diff --check` is recorded at commit closure. The protection gate confirms all `38/38` feature IDs and source paths remain present, but intentionally blocks Stage 3 production-source drift until the plan's later protected-baseline update task.
- Task 4 completes the fifth of eleven Stage 3 tasks (`5/11`, approximately `45%`). Task 5 command/history transactions is next but has not started. Cloud exact-SHA, Chromium 1920x1080, Firefox, WebKit, mobile Chromium, rollback and PostgreSQL-gated suites remain `UNVERIFIED`.

### Task 5 Canvas Commands And Explicit History Transactions

- Added immutable `CanvasCommand` handling for add, move, resize, delete, duplicate, reorder, group assignment and task results, plus a 50-step history controller and explicit pointer transactions. The 500ms gesture grouping guess is removed.
- Hydration and task projection updates explicitly skip user history. User geometry on a processing node remains undoable. Managed placement delete/restore stays coordinated through the Stage 2 lifecycle before committing one history entry.
- Async undo/redo now rebases concurrent task updates, replays queued user edits with user-field precedence, and binds both queues and in-flight transitions to project ID plus lifecycle epoch. A late transition from an old project cannot write into the new project or clear its active transition.
- Generation groups capture source anchors at creation, drag-in and both reference-add paths. Whole-group movement follows history; moving one source no longer shifts the group chrome or result placeholder.
- TDD and five review waves closed all found P1 boundaries. Final independent review reports no residual or new P0/P1. Focused regression is `56/56`; real production Chromium Task 5 grep is `3/3`.
- Full PostgreSQL-enabled Vitest is `428/428` files and `2374/2374` tests with zero failures or skips. The final-build full Chromium suite is `7/8`: the retained S3-BUG-004 measured `52.3ms` input P95 against the fixed `<=50ms` gate after an earlier `72.5ms` run, with zero disappeared frames and zero unclickable duration. The threshold was not relaxed.
- Task 5 completes the sixth of eleven Stage 3 tasks (`6/11`, approximately `55%`). Task 6 task projection is next and has not started. Cloud exact-SHA, external browser profiles, rollback, protected-baseline approval and the async project-switch component E2E remain `UNVERIFIED`.

### Task 6 Canvas Task Projection

- Added one pure Canvas task projector for submitting, queued, processing, uploading and terminal events. Workspace SSE/poll/recovery and infinite-Canvas completion now converge on the same command path instead of retaining independent terminal writers.
- Completion is idempotent per task slot, terminal states cannot regress, stale server placeholders cannot overwrite a locally completed projection, and local slot creation order survives server reconciliation. Existing provider requests, billing and refund behavior are unchanged.
- TDD retained RED evidence for missing projection behavior, resumed terminal events without a revision, stale server projection overwrite, duplicate completion writers, task-slot reorder and ordinary-image isolation. Focused Task 6 regression passes `48/48`.
- Real production Chromium `n=4` completes in provider order `3,1,4,2` while preserving visible slot order `1,2,3,4`; all four results remain real PNG images after project sync and reload. The dedicated scenario passes `1/1` with screenshot, video, trace, Console and network artifacts retained under ignored test output.
- Fresh repository gates: full Vitest `430` files with `2351` passed and `44` environment-skipped tests, TypeScript exit 0, ESLint exit 0, `git diff --check` exit 0, and production build `116/116`. The protected gate confirms all `38/38` feature identities and required contracts, but intentionally blocks `27` accumulated Stage 3 source drifts until the later approved baseline task.
- After controlled fixture reseeding, the complete Stage 3 Chromium run is `7/8`. S3-BUG-004 remains open: the 300-node input P95 is `87.8ms` against the fixed `<=50ms` gate; functional selection, drag, cancel, reload, delete, undo, redo and 100-node pan pass. A preceding reused-fixture `4/8` run is retained as invalid environment evidence and is not counted as product status.
- Task 6 completes the seventh of eleven Stage 3 tasks (`7/11`, approximately `64%`). Task 7 persistence scheduling is next and has not started. External browser profiles, cloud exact-SHA, rollback, protected-baseline approval and the retained performance blocker remain `UNVERIFIED`.

### Task 7 Non-Blocking Persistence

- Added a single-flight persistence scheduler with latest-snapshot wins, project epochs, one-second maximum idle wait, signature deduplication, bounded retry and observable phases. Immediate command saves yield the current input task before snapshot preparation.
- Interaction commits retain structural sharing. Placement normalization, JSON serialization and beacon construction run in the scheduler prepare phase; `data:`/`blob:` uploads remain asynchronous and schedule a higher revision after stable URLs resolve.
- `beforeunload` reads only an already prepared snapshot. Stable snapshots use local cache and a prebuilt beacon payload within 64 KiB; pending media writes a small recovery marker and does not synchronously encode images or issue a keepalive fetch.
- Focused persistence/wiring regression passes `35/35`. PostgreSQL-enabled full Vitest exits `0`; TypeScript, error-only ESLint, full ESLint (`0 errors / 966 historical warnings`), `git diff --check` and the `116/116` production build pass.
- Fresh production Chromium save/refresh regression passes `2/2`. The 300-node save sample records input P95 `21.8ms`, longest task `90ms`, longest save task `0ms`, zero disappeared frames and zero unclickable time; coordinates, size, z-order and processing state survive refresh.
- The protected gate retains all `38/38` feature identities, paths and evidence contracts but correctly blocks `29` accumulated Stage 3 source drifts until the ordered baseline task. S3-BUG-004 remains open because this save-specific result does not replace the full 300-node pan gate.
- Task 7 completes the eighth of eleven Stage 3 tasks (`8/11`, approximately `73%`). Task 8 tool registry and mutually exclusive tool sessions is the next unique task, but it has not started. Nothing is pushed or deployed and `stable` remains untouched.

### Task 8 Tool Registry And Mutually Exclusive Sessions

- Added one typed registry for every protected Canvas capability plus the existing Agent, brand-factory, scene-studio, aspect-recompose and compare tools. Definitions declare feature ownership, supported entry points, selection requirements, session kind and panel placement.
- Added `CanvasToolHost` and one authoritative `CanvasToolSession`. Opening a tool locks project/source identities and closes prior tool UI; Escape, external pointer, project change and source deletion close the session. Existing business panels and provider behavior are retained rather than rewritten.
- Bottom toolbar, image toolbar, context menu and current keyboard shortcuts now enter the same session boundary. Missing required selection fails closed with an explicit user message. Floating-panel, modal, toolbar and Canvas-overlay boundaries prevent panel interaction from leaking into Canvas gestures.
- TDD retained the missing-registry/host/wiring RED. Focused regression passes `32/32`. The production Next.js server passes the same Agent -> brand ecommerce -> erase -> ChatCanvas mutual-exclusion flow in Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium (`5/5`). Video artifacts remain under ignored Playwright output.
- Fresh gates: PostgreSQL-enabled full Vitest exits `0`; API `477/477` plus the separately keyed element-board/Pear PostgreSQL concurrency tests `3/3`; component/lib regression `1759/1759`; TypeScript passes; ESLint is `0 errors / 966 historical warnings`; Doctor is `43 passed / 11 warnings / 0 failed / 0 blocked`; build is `116/116`; `git diff --check` passes.
- Protection evidence remains explicit: all `38/38` identities and paths are present. The default gate correctly blocks `32` accumulated Stage 3 source drifts; the exact 32-path Stage 3 scope gate passes with one historical baseline-commit warning. The baseline was not silently reapproved.
- Task 8 completes the ninth of eleven Stage 3 tasks (`9/11`, approximately `82%`). Task 9 component-boundary consolidation is next but has not started. S3-BUG-004, full cross-browser Stage 3 coverage, cloud exact-SHA and rollback remain open; nothing is pushed or deployed and `stable` remains untouched.

### Task 9 Canvas Kernel Component Boundaries

- `CanvasWorkspace` now owns the shared `/api/poll-task` transport and injects it into the compatibility Canvas facade. `InfiniteCanvas` retains task response interpretation and existing business behavior, but no longer issues that remote request directly.
- Permanent boundary contracts prove history and remote effects remain in the workspace, `CanvasSurface` remains free of API/user-manager ownership, `CanvasToolHost` remains session/panel-only, and all protected business panels remain reachable.
- Replaced the anonymous erase/mask editor wheel listener with a stable bound handler and explicit detach. Canvas unmount now aborts annotation and generation polling, clears tracked intervals and transient timers, cancels animation frames, and releases active pointer capture.
- TDD RED was `3 failed / 2 passed`; lifecycle RED then reproduced the anonymous wheel-listener leak. Final focused Canvas boundary/command/session/selection/viewport/cancellation regression passes `58/58`.
- Fresh full Vitest passes `422` files / `2376` tests with `12` files / `44` tests explicitly environment-skipped; the PostgreSQL suites pass separately (`46/46` plus `4/4`). TypeScript, production build, ESLint (`0 errors / 965 historical warnings`) and `git diff --check` pass.
- Task 9 completes the tenth of eleven Stage 3 tasks (`10/11`, approximately `91%`). Task 10 full local, five-browser, exact-SHA Coze and rollback gates is next but has not started. S3-BUG-004 and the external evidence gates remain open; nothing is pushed or deployed and `stable` remains untouched.

### Task 10 Local And Cross-Browser Gate Closure

- The full production legacy matrix passes `60/60` in Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium. Representative shadow and canvas-v2 matrices each pass `15/15`.
- Correct measurement-window filtering closes S3-BUG-004 locally without relaxing its threshold. Desktop Chromium 300-node P95 is `34.3ms` and `21.6ms`; FPS is `54.62` and `55.31`; disappearance and unclickable time are zero.
- TDD closes resize pointer capture, focused-button Canvas undo, rendered pending-state ordering, oversized keepalive and CI liveness/evidence integrity defects. Focused Canvas contracts pass `39/39`, WebKit repeat `10/10`, workflow/release contracts `15/15`.
- Fresh local quality gates exit 0: Doctor, TypeScript, ESLint (`0 errors / 965 historical warnings`), PostgreSQL-enabled full tests, API (`110 files / 480 tests`), regression, production build (`116/116`), YAML and whitespace checks.
- Task 10 is locally complete but Stage 3 is not complete. The controlled database contains no provider, so real paid P0 and billing/refund evidence remain unverified. The next unique action is independent approval, exact allowlist gate, main-only commit/push, then Coze exact-SHA shadow -> isolated canvas-v2 -> mandatory legacy rollback. `stable` remains untouched.

### Task 10 Independent Review And Final Local Gates

- Independent review P0/P1 findings are closed with owner/revision-bound recovery, geometry-preserving blob fallback, resize immediate persistence, stable model authorization signatures, independent unload channels and a blocking double-failure leave guard. Focused hardening is `88/88`; five-profile key flow is `5/5`; final WebKit and Chromium representatives are `1/1` each.
- The first post-review full gate retained S3-TEST-002 RED because a source contract still expected the pre-recovery direct `targetProject` declaration. Runtime workflow hydration remained present. The corrected ordering contract passes `11/11`, and the same PostgreSQL-enabled full command exits `0` on rerun.
- Fresh gates: Doctor `43/11/0/0`; TypeScript; ESLint `0/965`; API `480/480`; component/lib regression exit `0`; production build `116/116`; YAML, exact 38-feature allowlist and whitespace checks pass. Remote `stable` remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- Stage 3 remains incomplete. Exact committed-source browser evidence, governance bootstrap/main push, GitHub Actions, Coze real provider/billing, isolated canvas-v2 and mandatory legacy rollback remain the only next scope; Stage 4/5 remain prohibited.

### Task 10 Governance Push And Immutable Evidence

- Two-step governance completed without force: bootstrap `d9fde3a0f36b7ca8532591e8b098e4dfb1ac40f6`, complete candidate `e61bdedb9443d8b2ee164539ed21ed48bf0b4b90`, then evidence finalization `afa65eb103bd8fa08d669d4680d068d2c565d341`. Remote stable remains the immutable `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- The first exact-build run retained an environment-only login 503 caused by a short test secret. The next run exposed S3-TEST-003: waiting for video before context closure deadlocked fixture teardown. Contract RED was `1/10`; GREEN is `10/10`; the focused Stage 3 set is `100/100`.
- Clean `main@afa65eb` production evidence passes Chromium/WebKit representatives `4/4` in 35.1 seconds. Each result has screenshot, video, trace, Console and Network artifacts under the exact SHA evidence path.
- Next unique scope is GitHub Actions plus Coze exact-SHA `shadow -> canvas-v2 -> legacy`, including real provider and billing evidence. Stage 3 is not complete and Stage 4/5 remain prohibited.

### Task 10 CI Gate Repair Candidate

- GitHub Actions for `afa65eb` exposed two independent release-infrastructure defects: the Stage 3 job seeded `wujie_users` before the production app created core tables, and the production dependency audit reported `6 moderate / 15 high` advisories.
- S3-TEST-004 is closed locally by ordering the production build/start before controlled fixture seeding. A brand-new isolated PostgreSQL database then created the core schema, seeded one controlled user and 15 projects, and passed the retained Chromium merge-window and move/resize scenarios `2/2`.
- Production dependencies were updated within compatible ranges. A precise pnpm package hook removes only `pptxgenjs@4.0.1`'s unused `image-size` edge; a regression creates a real PPTX ZIP so the pruning cannot silently break exports. Production audit is now `0 low / 0 moderate / 0 high / 0 critical`.
- Sharp 0.35 changed exported TypeScript namespaces; two type-only imports were adjusted without changing image processing behavior. Fresh gates pass: TypeScript, error-only ESLint, API `110 files / 480 tests`, full Vitest exit 0, production build `116/116`, dependency contracts, YAML and whitespace.
- This is still a local candidate until the two-step trusted-parent allowlist push and GitHub Actions rerun complete. The real-P0 workflow also remains externally blocked by missing repository secrets; it must not be bypassed or mocked. Coze `shadow -> canvas-v2 -> legacy` and real provider/billing evidence remain required; Stage 4/5 stay prohibited.

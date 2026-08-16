# Stage 3 Canvas Performance And Reliability Report

Date: 2026-08-14
Pre-bootstrap baseline: `origin/main@18346aa3c48f455ed8d01c3093eea2474e41a166`
Governance bootstrap: `d9fde3a0f36b7ca8532591e8b098e4dfb1ac40f6`
Reviewed code candidate before this report-only cleanup: `73443d06ab0943e24c9942fdfcdfac6aeaf9f23c`
Branch: `codex/wj-stable-s3`
Protected branch: `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`, read-only and unchanged

## Scope And Evidence

- Controlled PostgreSQL fixture run: `task10-ea2ce08-20260814b`.
- Fifteen isolated projects: five browser profiles times 1, 100 and 300 image nodes; all project IDs are unique and all rows match the controlled run ID.
- Production Next.js server, real DOM and real browser input. No fixed long sleeps are used as the primary completion condition.
- Evidence is scoped by Canvas mode, run ID, browser, test, retry and repeat. Each attempt retains screenshot, video, trace, console, network and JSON metrics.
- Browser totals: legacy `60/60`, shadow representative matrix `15/15`, canvas-v2 representative matrix `15/15`.

## Legacy Performance

| Browser | Nodes | Average FPS | Input P95 | Longest task | Disappeared frames | Unclickable time | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Chromium 1280x720 | 100 | 58.51 | 14.0ms | 87ms | 0 | 0ms | PASS |
| Chromium 1280x720 | 300 | 54.62 | 34.3ms | 106ms | 0 | 0ms | PASS |
| Chromium 1920x1080 | 100 | 57.89 | 16.9ms | recorded | 0 | 0ms | PASS |
| Chromium 1920x1080 | 300 | 55.31 | 21.6ms | recorded | 0 | 0ms | PASS |
| Firefox | 100 | 54.87 | 17.0ms | recorded | 0 | 0ms | BEHAVIOR PASS |
| Firefox | 300 | 34.19 | 31.0ms | recorded | 0 | 0ms | BEHAVIOR PASS |
| WebKit | 100 | 5.13 | 6.0ms | recorded | 0 | 0ms | BEHAVIOR PASS |
| WebKit | 300 | 4.58 | 68.0ms | recorded | 0 | 0ms | BEHAVIOR PASS |
| Mobile Chromium | 100 | 58.74 | 13.0ms | recorded | 0 | 0ms | BEHAVIOR PASS |
| Mobile Chromium | 300 | 57.92 | 27.9ms | recorded | 0 | 0ms | BEHAVIOR PASS |

The fixed FPS and P95 release thresholds apply to desktop Chromium only. Firefox, WebKit and mobile profiles are behavior gates and are not misrepresented using Chromium performance thresholds.

## Save And Recovery At 300 Nodes

| Browser | Scenario duration | Input P95 | Longest task | Longest save task | Disappeared / unclickable | Result |
|---|---:|---:|---:|---:|---:|---|
| Chromium | 6903ms | 28.3ms | 90ms | 0ms | 0 / 0ms | PASS |
| Chromium 1920x1080 | 6952ms | 30.2ms | 113ms | 0ms | 0 / 0ms | PASS |
| Firefox | 8907ms | 66.0ms | recorded | 0ms | 0 / 0ms | BEHAVIOR PASS |
| WebKit | 13179ms | 47.0ms | recorded | 0ms | 0 / 0ms | BEHAVIOR PASS |
| Mobile Chromium | 6287ms | 23.7ms | 97ms | 0ms | 0 / 0ms | BEHAVIOR PASS |

Saved geometry, z-order and task state survive reload. The complete functional flow also covers selection, reverse box selection, drag, resize, pointer cancellation, zoom, pan, reset, delete, undo, redo and tool-session isolation.

## Defects Closed Locally

- S3-BUG-004: stale buffered Event Timing entries inflated the 300-node P95. The corrected desktop Chromium measurements are below the fixed 50ms gate.
- S3-BUG-011: resize did not capture its pointer through the transaction boundary.
- S3-BUG-012: focused toolbar buttons and rendered pending-state ordering could suppress Canvas undo.
- S3-BUG-013: oversized audit payloads incorrectly used browser navigation keepalive.
- S3-TEST-001: repeated evidence could overwrite failures, the CI startup probe treated expected auth 401 as liveness failure, and performance collection crossed measurement boundaries.
- S3-BUG-014: emergency recovery is owner/project/server-revision bound; blob media fallback keeps the newest recovered layout.
- S3-BUG-015: quick-create model requests use a stable authorization signature, avoiding WebKit abort churn without hiding real local grant/revoke changes.
- S3-BUG-016: local recovery and beacon are independent unload channels; pending media or double-channel failure blocks silent navigation.

## Post-Review Hardening Evidence

- Focused contracts: `9` files / `88` tests passed after the independent-review fixes.
- Retained RED: WebKit model hydration produced two page errors; Chromium and mobile Chromium recorded aborted `/api/user-data/record` requests; the first rebuilt server returned login 503 because `WUJIE_ADMIN_PASSWORD` was omitted.
- GREEN: five-profile move/resize/undo/redo/immediate-reload `5/5`; final WebKit merge-window `1/1`; final Chromium immediate-reload `1/1`.
- Dirty source evidence is named `HEAD-worktree-<content hash>` and includes untracked file contents. Exact immutable-SHA evidence must be regenerated after commit.
- Open P2 limitations: beacon audit delivery has no application-level receipt; external same-session authorization changes need a server revision/refresh signal.

## Quality Gates

- Focused Canvas contracts: `39/39`.
- WebKit focused repeat: `10/10`.
- Workflow and Stage 3 release contracts: `15/15`; `.github/workflows/quality.yml` parses as YAML.
- Post-review rerun: `pnpm doctor`, `pnpm ts-check`, `pnpm lint`, PostgreSQL-enabled `pnpm test`, `pnpm test:api`, `pnpm test:regression`, `pnpm build` and `git diff --check` exited 0 in the controlled local environment.
- API suite: 110 files / 480 tests. ESLint: 0 errors / 965 historical warnings. Production build: 116/116 routes.
- Doctor: 43 passed / 11 warnings / 0 failed / 0 blocked. Both GitHub workflow files parse as YAML. The exact Stage 3 allowlist gate retains 38/38 protected features and reports only the historical baseline-commit warning.
- The first post-review full run exposed S3-TEST-002, a stale source contract for workflow hydration after recovery-aware project resolution. Its RED was retained, the focused contract passes 11/11, and the same full command passes on rerun.

## Remaining Release Evidence

- The isolated local database contains zero configured API providers. Real paid image generation, task billing, cancellation and refund consistency cannot be honestly validated locally and remain `UNVERIFIED`.
- The candidate and evidence-teardown fix are pushed through `main@afa65eb103bd8fa08d669d4680d068d2c565d341`. A clean build from that SHA passes the Chromium/WebKit merge-window and move/resize/undo/redo/immediate-reload representative set `4/4` with all mandatory artifacts.
- Coze must run the exact SHA in `shadow`, switch the isolated preview to `canvas-v2`, rerun the same gates, and finally prove the mandatory return to `legacy`.
- GitHub Actions has not yet supplied the new three-mode job result for this SHA.

## Current Verdict

**CONDITIONAL / STAGE 3 NOT COMPLETE.** Local functional, performance and three-mode browser gates pass. Cloud exact-SHA, real-provider P0, billing/refund evidence and the controlled `canvas-v2 -> legacy` rollback are mandatory remaining gates.

## CI Gate Follow-Up

- GitHub's Stage 3 browser job did not invalidate the local Canvas measurements; it failed before browser launch because a clean database was seeded before the production core schema existed.
- The candidate now starts the canonical production schema before seeding. A brand-new isolated database passed two real Chromium representative scenarios after creating 15 controlled projects.
- Production dependency audit is zero after compatible updates and a narrowly tested unused-edge removal. These infrastructure repairs do not constitute new Canvas performance evidence.
- Stage 3 remains conditional until immutable GitHub Actions and Coze exact-SHA `shadow -> canvas-v2 -> legacy` evidence complete.

### Immutable CI follow-up

- `0ac9068` did not produce valid Canvas performance samples: legacy stopped at an additive-column seed race, while shadow and canvas-v2 stopped at login HTTP 503 caused by a short CI secret.
- The failures occurred before Canvas assertions, so they neither pass nor invalidate the retained local measurements.
- Condition-based schema readiness and a production-valid CI auth secret now have permanent tests; a new immutable run is required before this report can add GitHub performance evidence.

### `c381d50` GitHub performance evidence

- All `180` mode/profile cases executed. Functional totals were legacy `53/60`, shadow `53/60`, and canvas-v2 `54/60`.
- Hosted desktop Chromium missed the unchanged thresholds: 100-node FPS was `39.27-51.76` against `55`; 300-node FPS was `28.71-41.99` against `45`. Canvas-v2 produced one `187ms` 300-node save long task against `100ms`.
- The run did not report a disappeared-frame or unclickable-time assertion as the primary failure. Cross-browser functional flows largely passed, but performance remains a release blocker.
- No threshold is relaxed. The next step is to separate runner/recording overhead from Canvas render and persistence cost using the retained metric and request boundaries.

### Post-`c381d50` observer-cost candidate

- The performance observer previously executed a full Canvas image query once per monitored node on every animation frame. It now caches the exact image/card pair and only re-resolves after DOM disconnection; all decode, visibility, hit-test and continuity checks remain active.
- Fresh local production Chromium results with unchanged thresholds: Chromium 100/300 pan `58.88/57.07` FPS; Chromium 1080p `58.58/57.69` FPS. The two 300-node save samples are `57.23/56.85` FPS with longest save task `0ms`. All six cases pass with zero disappeared frames and zero unclickable time.
- These local values do not close S3-BUG-017. A new immutable GitHub Actions run must prove the low-core hosted result before release.

## 2026-08-14 Final local `canvas-v2` matrix after hosted-failure triage

- Controlled run: `local-perf-820b-20260814`; execution: `final-local-matrix-p1-barrier-20260814`.
- Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium each pass `12/12`, for `60/60` after a clean reseed.
- Thresholds and all continuity assertions remain unchanged. This local result does not waive immutable hosted failures under S3-BUG-017.
- A prior local run failed four cases because batch-delete undo was later projected back to 98 nodes. Trace evidence proved a queued stale snapshot plus deletion tombstones, not a frame-rate threshold failure. The corrected focused order passes Firefox/mobile `4/4`.
- Evidence root: `test-results/stage-3-baseline/canvas-v2/local-perf-820b-20260814/final-local-matrix-p1-barrier-20260814/`; attempt evidence retains screenshot, video, trace, Console, network and metrics.
- Independent review found one P1 durability gap after an idle-equivalent save. TDD RED was `2 failed / 9 passed`; the immediate-barrier correction passes focused persistence/Canvas/evidence contracts `50/50` and the rebuilt production matrix remains `60/60`.
- Companion gates before the final documentation-only update: full Vitest exit `0`, PostgreSQL concurrency `4/4`, TypeScript and ESLint exit `0`, production build `116/116`.
- **Status: local performance/behavior candidate pass; immutable hosted matrix still required.**

## 2026-08-15 Final local matrix after CAS conflict recovery

- Controlled environment: `local-ci-repro-20260815`; execution: `local-final-candidate-r5-20260815`; production Next.js server with PostgreSQL 18 and freshly seeded isolated projects.
- The exact r5 run is RED `58/60`. Chromium lost the immediate Ctrl+Z after a delete; the following move/resize case was a cascade because the shared one-node project remained empty. Chromium 1920x1080, Firefox, WebKit and mobile Chromium each passed `12/12`.
- The matrix adds an authoritative server snapshot assertion after immediate move/resize reload. WebKit geometry uses numeric tolerance only for browser decimal serialization; no functional threshold was relaxed.
- The preceding mobile batch-delete/undo failure was a real project-revision conflict bug, not test flakiness. S3-BUG-021 serializes sync, rebases one autosave conflict and retries once; the final clean matrix passes in original order.
- The retained `r3` run was `59/60`: the mobile move test used a geometric card center covered by the right-panel collapse control. Pointer diagnostics proved the wrong `pointerdown` target. The harness now chooses an unobstructed pixel within the card/interactive-viewport intersection and a hittable resize handle; targeted mobile repeat is `3/3` and the clean `r4` matrix is `60/60` without changing performance thresholds.
- At this checkpoint S3-BUG-022 was narrowed to dependency-driven listener replacement. The `useLayoutEffect` candidate passed its source contract but was later disproved by exact legacy reproduction on `74268eb`; the final stable-listener correction is recorded below. The retained r5 RED remains valid.
- HTML report: `test-results/stage-3-baseline/canvas-v2/local-ci-repro-20260815/local-final-candidate-r5-20260815/playwright-report/index.html`. JUnit and attempt-level screenshot, video, trace, Console and network evidence are retained beside it.
- **Historical status at this checkpoint: superseded by the later exact legacy RED/GREEN section below. Immutable GitHub Actions and Coze three-mode rollout/rollback remain required.**

## 2026-08-15 `c4c02a9` immutable follow-up

- Actions run `31870799781` remained RED after the frame-window correction: legacy `57/60`, shadow `59/60`, canvas-v2 `56/60`.
- The next local candidate removes inactive-engine work from non-shadow pan, moves reverse-box visual updates out of parent React state, and registers the next measurement RAF before unchanged continuity probes.
- Fixed gates remain 55 FPS for 100 nodes, 45 FPS for 300 nodes, 50ms input P95 and 100ms longest save task. A new immutable run is required; this report does not project a pass from local static evidence.

## 2026-08-15 `30fdedc` immutable matrix and second repair candidate

- GitHub Actions run `31873152403` executed all three Canvas modes but remained RED: canvas-v2 `54/60`, legacy `56/60`, shadow `54/60`.
- Desktop Chromium retained the unchanged gates. Recorded misses included 100-node FPS `49.26-54.66` versus `55`, 300-node FPS `37.10-43.47` versus `45`, one 300-node input P95 of `58.6ms` versus `50ms`, and save tasks of `102-153ms` versus `100ms`.
- Canvas-v2 WebKit reproduced a real durability defect: final resize geometry rolled back after immediate reload. Shadow WebKit then began from a missing node and cascaded into an undefined move/resize target. These failures are retained and are not classified as retries or runner noise.
- The new local candidate keeps the standard `120x72` pan wholly compositor-driven within the existing overscan corridor, removes box-selection active state from the parent React render path, adds bounded v4 unload recovery for the one known revision race, and removes whole-user localStorage serialization from immediate Canvas writes.
- TDD and related regressions pass `8 files / 132 tests`; full Vitest passes `428` files and `2458` tests, with `44` PostgreSQL-gated tests explicitly skipped because this workstation has no isolated test database. TypeScript, ESLint, `git diff --check` and production build `116/116` pass.
- **Status: NOT READY / Stage 3 Task 10 remains active.** A new immutable legacy/shadow/canvas-v2 run must prove the fixed FPS, input, save and WebKit recovery gates. Real-P0 Secrets and Coze exact-SHA `shadow -> canvas-v2 -> legacy` remain separate blockers.

## 2026-08-15 `74268eb` immutable RED and stable-listener candidate

- Immutable Actions run `31875413077` remains RED: canvas-v2 `56/60`, shadow `56/60`, legacy `53/60`. The retained failures include unchanged hosted desktop FPS/input/save budgets plus legacy delete/undo and shared-fixture cascades.
- Exact local legacy production reproduction on unmodified `74268eb` was RED `10/12`: Ctrl+Z immediately after deletion did not restore the node, and the following move/resize case inherited the empty project. This proves a product listener race independently of hosted performance variance.
- A queued-command hypothesis was tested and rejected because it only moved the failure to the final undo. The patch was fully reverted before the final fix.
- Root fix: one component-lifetime DOM keyboard/paste listener now delegates to the latest render behavior through a ref. Dependency changes update behavior without removing the actual window listener.
- Fresh rebuilt and reseeded legacy evidence passes Chromium `12/12` and mobile history/continuity `4/4`. Desktop metrics keep all thresholds unchanged: 100-node pan `58.62 FPS`, input P95 `14.20ms`; 300-node pan `57.03 FPS`, input P95 `17.30ms`; 300-node save `56.13 FPS`, input P95 `25.60ms`, longest save task `0ms`; disappeared and unclickable evidence remains zero.
- Full local gates pass: focused Canvas contracts `35/35`, full Vitest `428 files / 2461 tests`, ESLint, TypeScript, production build `116/116`, whitespace, and protected features `38/38`. The generic test command still reports `12 files / 44 tests` skipped because `POSTGRES_TEST_DATABASE_URL` is absent.
- **Verdict: LOCAL LEGACY CANDIDATE PASS / STAGE 3 NOT COMPLETE.** The next exact `main` SHA must pass immutable legacy, shadow and canvas-v2 jobs. Coze mode rollout/rollback and real paid provider accounting remain mandatory.

## 2026-08-15 `9d8e7bf` immutable RED and direct-pan candidate

- Immutable Actions run `31878749102` completed all three modes at `57/60` each. Static, PostgreSQL and build gates passed; real P0 continued to fail closed because required repository Secrets are absent.
- The fixed release budgets remain 100 nodes `>=55 FPS`, 300 nodes `>=45 FPS`, input P95 `<=50ms`, save longest task `<=100ms`, with zero disappeared frames and zero unclickable time. No threshold or continuity assertion was removed.
- Root-cause tracing showed a standard Space/hand pan immediately entered parent React state even though its `120x72` movement remained inside the existing compositor/overscan corridor. The candidate defers React panning state until the existing 256px/80ms culling synchronization actually occurs. Immediate Canvas save also waits for the authoritative project sync before starting the unchanged audit request, avoiding two complete project payload uploads in the same save window.
- Two alternatives were rejected and fully reverted: `translate3d` did not improve local metrics; removing node `content-visibility` failed the unchanged 1080p/300-node input gate at `60.2ms`.
- The first independent review rejected the candidate on two Important findings: `beginPan` still published parent React state, and a competing pointer could replace or terminate the active pan. The corrected runtime keeps pointerdown ref-only, rejects competing ownership and lets only the authoritative pointer move or finish. The same reviewer then returned `APPROVED`.
- Fresh production evidence execution `local-owner-safe-legacy-full-20260815` passes the complete five-profile legacy matrix `60/60`. Desktop metrics: Chromium/1080p 100 nodes `57.42/57.42 FPS`, 300 nodes `54.82/54.26 FPS`, input P95 at most `40.1ms`, save longest task `0ms`, disappeared frames `0`, unclickable time `0`.
- Repository gates pass: focused contracts `8 files / 78 tests`; PostgreSQL-enabled full Vitest `441 files / 2512 tests` with zero skips; TypeScript; ESLint `0 errors / 973 historical warnings`; exact reviewed protected-source gate `38/38`; production build `116/116`; whitespace check.
- **Verdict: LOCAL CANDIDATE PASS / STAGE 3 TASK 10 REMAINS ACTIVE.** Commit and fast-forward only `main`, then require a new immutable legacy/shadow/canvas-v2 matrix. Coze `shadow -> canvas-v2 -> legacy`, real provider execution and authoritative charge/cancel/refund evidence remain mandatory.

## 2026-08-16 media stability candidate `0a34c73`

- Browser tracing on the previous render path recorded about `900` image load events during one 3.6-second 100-node pan, despite the same 100 image elements and unchanged sources. This explained the visible blanking and temporary loss of clickability under load.
- The media subtree is now value-memoized, replacement images decode before commit, and the source state machine explicitly handles pending replacement, rollback and stale DOM load events. The E2E sampler records native image loads and source mutations instead of inferring them only from React state.
- Exact-SHA matrices pass canvas-v2 `60/60`, legacy `60/60` and shadow `60/60`, for `180/180` cases total. Desktop Chromium results across modes range from `55.62` to `58.60 FPS`; input P95 is at most `43.9ms`. All 30 pressure samples have zero disappeared frames, zero unclickable duration and zero monitored media load/src events.
- Full local verification passes `2527/2527` tests with PostgreSQL enabled, TypeScript, build, zero-error ESLint, protected features and whitespace checks.
- **Verdict: EXACT-SHA LOCAL THREE-MODE PASS / HOSTED IMMUTABLE EVIDENCE PENDING.** GitHub Billing prevented runner allocation; the failure is infrastructure, not a product test result. Task 10 remains active and fixed thresholds remain unchanged.

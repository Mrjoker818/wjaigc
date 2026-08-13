# Stage 3 Canvas Functional And Performance Baseline

Status: controlled Chromium baseline plus Tasks 2-4 reruns executed. Task 4 closes the one-node persisted drag and selection-gesture defects locally, but the Canvas still misses the fixed 300-node input-delay threshold.

## Scope

- Profiles: Chromium, Chromium 1920x1080, Firefox, WebKit, mobile Chromium.
- Isolated projects per profile: 1, 100 and 300 image nodes.
- Functional path: drag, anchored zoom, reset view, delete, undo, redo, save and reload recovery.
- Performance path: requestAnimationFrame FPS, Event Timing input delay when supported, Long Task duration, save-overlap long tasks, disappearing frames and hit-test continuity.
- Thresholds are fixed by the approved Stage 3 plan and are not relaxed by this baseline.

## Environment Contract

Fixture mutation is blocked unless all of these are present:

- `E2E_STAGE3_ALLOW_SEED=1`
- `E2E_STAGE3_DATABASE_URL`
- `E2E_STAGE3_DATABASE_GUARD`
- an exact matching row in `wujie_stage3_e2e_guard`
- `E2E_STAGE3_RUN_ID`
- controlled test credentials and `WUJIE_AUTH_SECRET`

Credential-bearing environment output must remain outside the repository. Cleanup is constrained by owner, Stage 3 run ID and the exact 15 project IDs.

## Baseline Results

| Commit | Browser | Viewport | Nodes | Average FPS | Input P95 | Longest task | Longest save task | Disappeared frames | Unclickable time | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `143bbc579b2fcb8293022e54df2b5e53ce07461e` | Chromium | 1280x720 | 1 | 57.60 | 13.70ms | 94ms | 0ms | 0 | 0ms | **FAIL**: drag did not change the persisted x/y coordinates |
| `143bbc579b2fcb8293022e54df2b5e53ce07461e` | Chromium | 1280x720 | 100 | 58.20 | 14.10ms | 99ms | 0ms | 0 | 0ms | **PASS** |
| `143bbc579b2fcb8293022e54df2b5e53ce07461e` | Chromium | 1280x720 | 300 | 57.76 | 24.90ms | 95ms | 0ms | 0 | 1583.20ms | **FAIL**: hit-test continuity threshold is 0ms |
| Task 2 implementation commit | Chromium | 1280x720 | 100 | 58.78 | 16.60ms | 87ms | 0ms | 0 | 0ms | **PASS** |
| Task 2 implementation commit | Chromium | 1280x720 | 300 | 57.27 | 17.10ms | 87ms | 0ms | 0 | 0ms | **PASS** |
| Task 3 candidate | Chromium | 1280x720 | 100 | 58.30 | 17.10ms | 105ms | 0ms | 0 | 0ms | **PASS** |
| Task 3 candidate | Chromium | 1280x720 | 300 | 56.50 | 17.10ms | 122ms | 0ms | 0 | 0ms | **PASS** |
| Task 4 candidate | Chromium | 1280x720 | reverse box / 100 fixture | 57.76 | 14.70ms | 78ms | 0ms | 0 | 0ms | **PASS** |
| Task 4 candidate | Chromium | 1280x720 | 1 | 58.30 | 25.40ms | 78ms | 0ms | 0 | 0ms | **PASS**: drag coordinates persist and survive reload |
| Task 4 candidate | Chromium | 1280x720 | 100 | 58.50 | 35.60ms | 78ms | 0ms | 0 | 0ms | **PASS** |
| Task 4 candidate | Chromium | 1280x720 | 300 | 57.18 | 50.20ms | 85ms | 0ms | 0 | 0ms | **FAIL**: input P95 exceeds 50ms; preceding runs were 56.80ms and 62.80ms |

Execution environment: Windows, Playwright 1.60.0, local PostgreSQL 18 isolated cluster, local production Next.js server, `WUJIE_CANVAS_KERNEL_MODE=legacy`, `WUJIE_ASSET_GRAPH_MODE=legacy`, `WUJIE_TASK_CORE_MODE=legacy`.

The first environment attempt returned HTTP 503 because a brand-new database requires an administrator bootstrap password before any account can log in. That run was rejected as environment setup evidence and is not counted as a Canvas result. A second isolated server was started with a temporary administrator bootstrap configuration; controlled ordinary-user login then returned HTTP 200 before the accepted run.

## Findings

### S3-BL-001: Image drag does not persist coordinates

- Status: closed locally by Task 4; exact-SHA cloud and four-browser matrix remain unverified.
- Original severity for Stage 3: P1 baseline failure.
- Reproduction: open the isolated one-node project, drag the visible image 96px right and 64px down across 45 animation frames, wait for the project save response, then read the authenticated project snapshot.
- Expected: persisted x/y differs from `80/80` and survives reload.
- Original actual: persisted x/y remained `80/80`.
- Evidence: one-node screenshot, video, Trace, console/network logs and `one-node-drag-performance.json` under the evidence directory described below.
- Task 4 now retains the latest drag offset in refs, commits one image snapshot on pointerup, synchronously updates `imagesRef`, and publishes that same snapshot to `onImagesChange` and `onForceSave`. Local production-browser evidence proves changed coordinates, reload persistence and pointercancel rollback.

### S3-BL-002: 300-node pan loses hit-test continuity

- Status: closed locally by Task 2; exact-SHA cloud and four-browser matrix remain unverified.
- Original severity for Stage 3: P1 performance/interaction baseline failure.
- Reproduction: reset the controlled 300-node project, verify four center nodes are loaded and hittable, then Space-pan 120x72px across 75 animation frames.
- Expected: `unclickableDurationMs = 0`.
- Actual: `1583.20ms`; FPS, input P95 and disappeared-frame gates still pass.
- Root cause: reset and culling treated the fixed 480px right workspace panel as usable Canvas viewport, while the continuity sampler also treated legitimate fixed toolbar/panel overlays as Canvas hit targets. At 300 nodes this created sustained false interaction loss near the occupied edge and could fit content behind the panel.
- Task 2 now derives a usable viewport excluding the fixed right panel, applies it to fit/reset and culling, and marks the viewport/panel boundaries explicitly. The continuity sampler still checks image disappearance and hit testing throughout the actual interactive Canvas, but no longer treats fixed tool surfaces as Canvas.
- Local Chromium rerun passes at both 100 and 300 nodes with zero disappearing frames and `unclickableDurationMs = 0`. The 300-node result remains above the fixed FPS and input-delay thresholds.

## Task 2 Viewport Controller Evidence

- Added a pure viewport state machine for pan preview/commit/cancel, anchored zoom, coordinate conversion and fit-to-content.
- Added a React adapter with explicit `legacy`, `shadow` and `canvas-v2` paths. `shadow` computes and records differences without becoming authoritative; `legacy` remains the default.
- High-frequency pan preview remains `requestAnimationFrame`-driven and uses direct transform updates. React state is committed at controlled boundaries.
- Focused viewport and wiring regression: 5 files, 23 tests passed.
- Full Vitest exited 0. Seven PostgreSQL suites were explicitly blocked because `POSTGRES_TEST_DATABASE_URL` was absent and are not counted as verified.
- TypeScript passed; full-repository error-only ESLint exited 0; production build generated 116/116 pages; `git diff --check` passed.
- S3-BL-001 remains open. Task 2 does not claim to repair image drag command persistence, which belongs to the ordered gesture/command work.

## Task 3 Render Projection Evidence

- Replaced per-image-change R-tree rebuilds with project-hydration rebuilds plus incremental upsert/remove changes. Geometry-only changes no longer rebuild the complete index.
- Added explicit `critical`, `visible`, `overscan` and `deferred` priorities. Selected, dragged, resized, processing, annotation and active-tool source nodes remain mounted outside the viewport; naturally visible nodes receive a one-render continuity grace period.
- Added a stable Canvas transform surface and media node. New image sources are decoded before replacing the last usable pixels, dimensions remain stable, missing media keeps the existing recovery state, and priority controls eager/lazy loading and fetch priority.
- RED evidence covered missing render policy/media components and absent `applyChanges`; an additional RED reproduced relative URL versus absolute browser `currentSrc` mismatch. Final focused regression: 5 files, 32 tests passed.
- Chromium pressure rerun passed: 100 nodes at `58.30 FPS`, input P95 `17.10ms`, zero disappeared frames and zero unclickable time; 300 nodes at `56.50 FPS`, input P95 `17.10ms`, zero disappeared frames and zero unclickable time.
- The plan's literal grep (`100 nodes|300 nodes|continuity`) matched no current test title; the equivalent existing titles (`100-node|300-node|preserves drag`) were executed. The one-node flow still failed only at the previously registered persisted-coordinate assertion (`80/80`).
- Fresh repository gates: TypeScript passed; full ESLint returned `0 errors / 959 historical warnings`; full Vitest returned `918/918` suites, `2268` passed, `0` failed and `44` environment-pending; production build generated `116/116` pages; protected features remained `38/38` with 0 warnings.

## Task 4 Selection And Gesture Evidence

- A pure controller now owns committed selection, primary selection, z-order hits, reverse box geometry, thresholds and cancellation. The React adapter stores frame-level box previews in refs and publishes only committed business state.
- Real Chromium diagnosis proved that blank mouse pointerdown activated two competing controllers: immediate box selection and delayed long-press pan. In a dense fixture the pan timer could fire before the first delivered move, changing the Canvas transform and moving every target by the drag delta. Mouse and pen now use box selection; touch retains long-press pan. Hand tool, Space and middle button continue to provide mouse panning.
- Independent review exposed and closed touch jitter, group `pointercancel`, and Ctrl/Meta selection-versus-fusion boundaries. The re-review returned `APPROVED` with no remaining finding.
- Task 4's exact grep passed `3/3`; focused unit/wiring/contract regression passed `34/34`. Real Ctrl add/remove selection and reverse box selection selected exactly the intended nodes at `14.70ms` input P95, and `pointercancel` restored the preview without saving coordinates.
- After reseeding all 15 controlled projects, the complete Chromium Stage 3 run passed `5/6`. The 100-node run passed at `58.50 FPS`, `35.60ms` P95, zero disappeared frames and zero unclickable time. The 300-node run retained zero disappearance and click loss at `57.18 FPS`, but failed the fixed input P95 gate at `50.20ms`; preceding runs were `56.80ms` and `62.80ms`. The threshold remains unchanged.
- TypeScript, production build (`116/116`), full Vitest (`411` files / `2288` passed / `44` skipped) and `git diff --check` pass. ESLint reports `0 errors / 966 historical warnings`. The `12` skipped files remain PostgreSQL-gated. The protected-feature gate confirms all `38/38` feature identities and paths are present but blocks Stage 3 production-source drift until the plan's later baseline-update task.

## Not Yet Verified

- Chromium 1920x1080, Firefox, WebKit and mobile Chromium were not executed in Task 1; their 12 isolated projects are prepared for the later matrix gate.
- Cloud exact-SHA and `canvas-v2 -> legacy` rollback remain `UNVERIFIED`.
- The current baseline is not a release pass. S3-BL-001 is closed locally, while the 300-node input P95 performance gate and the external browser/cloud matrix remain open.

## Evidence

Successful and failed runs write under `test-results/stage-3-baseline/`:

- `playwright-report/`
- `playwright-output/` including videos
- `evidence/<commit>/<browser>/<test>/final.png`
- `evidence/<commit>/<browser>/<test>/trace.zip`
- redacted `console.json`, `network.json` and performance JSON

The existing `pnpm perf:check` string microbenchmark is auxiliary only and is not accepted as real DOM or browser performance evidence.

## Task 7 Non-Blocking Persistence Evidence

- Canvas interaction commits now schedule structural snapshots; placement normalization, JSON serialization and project writes run after yielding through the persistence scheduler. Immediate command saves no longer prepare the snapshot in the originating input task.
- The scheduler is single-flight, keeps the newest pending revision, isolates project epochs, deduplicates equal signatures, retries bounded failures and prepares a reusable unload snapshot. Pending `data:`/`blob:` media stays asynchronous and schedules a higher revision after URL resolution.
- `beforeunload` performs no placement traversal, image encoding or fresh JSON serialization. It uses an already prepared payload within the beacon limit, or writes a small recovery marker when media is unresolved.
- Focused unit/source contracts pass `35/35`; PostgreSQL-enabled full Vitest exits `0`; TypeScript, ESLint (`0 errors / 966 historical warnings`), whitespace checks and the `116/116` production build pass.
- Fresh production Chromium save/refresh passes `2/2`. The 300-node sample records `56.79 FPS`, input P95 `21.8ms`, longest task `90ms`, longest save task `0ms`, disappeared frames `0` and unclickable time `0ms`; refreshed geometry, z-order and processing state match the saved project.
- S3-BUG-004 remains open because the full pan scenario has not been rerun by this save-specific grep. External browser profiles, cloud exact-SHA, rollback and pending-media close recovery remain unverified.

## Task 8 Tool Registry And Session Evidence

- A typed registry maps all actions in the 11 protected Canvas feature groups and the existing auxiliary tools to explicit entry points, selection policy, session kind and panel placement.
- One source-locked session is authoritative. Escape, external pointer, project change and source deletion close the session; opening another tool closes prior tool UI.
- Focused unit/source regression passes `32/32`.
- The production-browser mutual-exclusion flow passes `5/5` in Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium. The accepted flow covers shortcut Agent, replacement by brand ecommerce, Escape cleanup, selected-image erase, ChatCanvas prompt interaction and final Escape cleanup.
- Firefox did not decode the legacy 155-byte fixture PNG in this run. The card remained visible and the tool-session behavior passed, but media decode is explicitly not claimed by this Task 8 evidence.
- Repository gates pass: PostgreSQL-enabled full Vitest exit `0`; API `477/477` plus separate PostgreSQL concurrency `3/3`; component/lib `1759/1759`; TypeScript; ESLint `0 errors / 966 historical warnings`; Doctor `43 passed / 11 warnings / 0 failed / 0 blocked`; production build `116/116`; `git diff --check`.
- Protected identities remain `38/38`. The default release gate blocks 32 accumulated Stage 3 paths until the ordered baseline task; the exact 32-path scope gate passes with one historical baseline-commit warning.

## Task 9 Canvas Kernel Boundary Evidence

- `CanvasWorkspace` owns the shared task-poll transport and injects it into the compatibility facade. Nine existing Canvas poll paths preserve payload, cancellation and response behavior without a direct `/api/poll-task` call in `InfiniteCanvas`.
- Permanent source contracts keep history and remote effects out of `InfiniteCanvas`, API/user ownership out of `CanvasSurface` and `CanvasToolHost`, and verify that every protected business panel remains reachable.
- The erase/mask editor's wheel listener now detaches by stable identity. Top-level teardown aborts tracked requests, clears timers/intervals, cancels RAFs and releases pointer capture.
- RED evidence: boundary suite `3 failed / 2 passed`, followed by a lifecycle RED for the anonymous listener. GREEN evidence: focused Canvas regression `58/58`; full Vitest `422` files / `2376` executed tests; PostgreSQL suites `46/46` plus `4/4`; TypeScript, build, whitespace and ESLint `0 errors / 965 warnings` pass.
- This is local structural/regression evidence only. The fixed 300-node performance gate, complete five-browser Stage 3 matrix, exact-SHA Coze validation, protected-baseline approval and `canvas-v2 -> legacy` rollback remain for Task 10.

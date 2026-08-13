# Stage 3 Canvas Functional And Performance Baseline

Status: controlled Chromium baseline and Task 2 viewport rerun executed; current Canvas does not yet pass all Stage 3 thresholds because the one-node persisted drag P1 remains open.

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

Execution environment: Windows, Playwright 1.60.0, local PostgreSQL 18 isolated cluster, local production Next.js server, `WUJIE_CANVAS_KERNEL_MODE=legacy`, `WUJIE_ASSET_GRAPH_MODE=legacy`, `WUJIE_TASK_CORE_MODE=legacy`.

The first environment attempt returned HTTP 503 because a brand-new database requires an administrator bootstrap password before any account can log in. That run was rejected as environment setup evidence and is not counted as a Canvas result. A second isolated server was started with a temporary administrator bootstrap configuration; controlled ordinary-user login then returned HTTP 200 before the accepted run.

## Findings

### S3-BL-001: Image drag does not persist coordinates

- Severity for Stage 3: P1 baseline failure.
- Reproduction: open the isolated one-node project, drag the visible image 96px right and 64px down across 45 animation frames, wait for the project save response, then read the authenticated project snapshot.
- Expected: persisted x/y differs from `80/80` and survives reload.
- Actual: persisted x/y remains `80/80`.
- Evidence: one-node screenshot, video, Trace, console/network logs and `one-node-drag-performance.json` under the evidence directory described below.
- Repair is intentionally deferred to the ordered viewport/gesture work; Task 1 does not change Canvas business behavior.

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

## Not Yet Verified

- Chromium 1920x1080, Firefox, WebKit and mobile Chromium were not executed in Task 1; their 12 isolated projects are prepared for the later matrix gate.
- Cloud exact-SHA and `canvas-v2 -> legacy` rollback remain `UNVERIFIED`.
- The current baseline is not a release pass. S3-BL-001 remains enabled and failing until the ordered gesture/command task repairs it.

## Evidence

Successful and failed runs write under `test-results/stage-3-baseline/`:

- `playwright-report/`
- `playwright-output/` including videos
- `evidence/<commit>/<browser>/<test>/final.png`
- `evidence/<commit>/<browser>/<test>/trace.zip`
- redacted `console.json`, `network.json` and performance JSON

The existing `pnpm perf:check` string microbenchmark is auxiliary only and is not accepted as real DOM or browser performance evidence.

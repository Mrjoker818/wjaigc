# Stage 3 Canvas Functional And Performance Baseline

Status: controlled Chromium baseline executed; current Canvas does not yet pass all Stage 3 thresholds.

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

- Severity for Stage 3: P1 performance/interaction baseline failure.
- Reproduction: reset the controlled 300-node project, verify four center nodes are loaded and hittable, then Space-pan 120x72px across 75 animation frames.
- Expected: `unclickableDurationMs = 0`.
- Actual: `1583.20ms`; FPS, input P95 and disappeared-frame gates still pass.
- The same test passes at 100 nodes with `unclickableDurationMs = 0`, so this is node-count sensitive rather than a universal instrumentation failure.
- Repair is intentionally deferred to the ordered viewport/render work.

## Not Yet Verified

- Chromium 1920x1080, Firefox, WebKit and mobile Chromium were not executed in Task 1; their 12 isolated projects are prepared for the later matrix gate.
- Cloud exact-SHA and `canvas-v2 -> legacy` rollback remain `UNVERIFIED`.
- The current baseline is not a release pass. Its two failing assertions must remain enabled until repaired.

## Evidence

Successful and failed runs write under `test-results/stage-3-baseline/`:

- `playwright-report/`
- `playwright-output/` including videos
- `evidence/<commit>/<browser>/<test>/final.png`
- `evidence/<commit>/<browser>/<test>/trace.zip`
- redacted `console.json`, `network.json` and performance JSON

The existing `pnpm perf:check` string microbenchmark is auxiliary only and is not accepted as real DOM or browser performance evidence.

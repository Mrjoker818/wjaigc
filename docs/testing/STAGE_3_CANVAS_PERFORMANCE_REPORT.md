# Stage 3 Canvas Performance And Reliability Report

Date: 2026-08-14  
Baseline: `origin/main@18346aa3c48f455ed8d01c3093eea2474e41a166`  
Local candidate: `ea2ce0828d87a39271b93304b26f158821d124c0` plus the reviewed Task 10 working tree  
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
- The candidate must be committed and pushed to `main`, then Coze must run the exact SHA in `shadow`, switch the isolated preview to `canvas-v2`, rerun the same gates, and finally prove the mandatory return to `legacy`.
- GitHub Actions has not executed the new three-mode job until the candidate is pushed.

## Current Verdict

**CONDITIONAL / STAGE 3 NOT COMPLETE.** Local functional, performance and three-mode browser gates pass. Cloud exact-SHA, real-provider P0, billing/refund evidence and the controlled `canvas-v2 -> legacy` rollback are mandatory remaining gates.

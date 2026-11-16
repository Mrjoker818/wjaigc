# Release acceptance, 2026-11-16

Candidate on the VPS QA service: 88e009cd. main now points to e56358e6, which is that candidate plus one fix to the video progress label.

## Paid re-verification (QA account user_1794700382227_pc03if)

- Top-up: wrote directly to the QA database (wujie_qa_79a92dc3, port 15479) in one transaction. Balance is now 1032 and total recharged is 1600. Production database was not touched.
- Silent video: task video_1794793829103_5qfyg7, Seedance 2.0 via the PearAPI provider, 16:9, 4 s, 720p, generateAudio=false.
  - The task completed with result.generateAudio=false.
  - ffprobe on the downloaded file shows one h264 video stream (1280×720, 4.04 s) and no audio stream (0 `soun` / `mp4a` boxes).
- New filename: the saved file is `/api/serve-upload/video/<taskId>/video_0c4830ed-ae90-4c79-87bd-83ad9646bf23.mp4`, which uses a random UUID token as intended.
- Planning error codes (BRIEF_VIDEO_PLAN_INVALID, BRIEF_VIDEO_PLANNER_UNAVAILABLE, MODEL_CAPABILITY_MISMATCH): verified with unit tests only (4 files, 58 tests pass). There is no paid run for these, because triggering them requires a planner model failure.

## Defect found and fixed during re-verification

- Each poll rebuilt the processing label from the text before the first `·`. That dropped the model name and added one space per poll, for example `文生视频      · 生成中...`.
- Fix e56358e6: `buildVideoProgressLabel` keeps the mode and model segments and replaces only the trailing status. Covered by `src/__tests__/lib/video-task-polling.test.ts`. That file and the poll-task contract test pass (16 tests).
- Deployed to the QA service in candidate bec5044b-r2 (see below). A paid video was not re-run against it.

## Bottom-toolbar icon centering (bec5044b)

- Defect: the 44px minimum hit area added to bottom-toolbar buttons kept `display: block` with `p-2`, so each 16px icon sat 6–7px left of center and outside the round active fill (select, AI generator, minimap).
- Fix: `globals.css` makes those buttons `inline-flex` and centers their content. A source-contract case was added to `canvas-toolbar-floating-windows.test.ts`.
- Tests: `canvas-toolbar-floating-windows.test.ts` and `canvas-minimap-gg-native.test.tsx` pass. `canvas-toolbar-available-width-native.test.tsx` has 4 failures at 320×568 and 375×812 (`expected 224 to be close to 320`). The same 4 fail with the CSS change stashed, so they predate this fix.
- QA build: the first bec5044b build reused `.next/cache` and served the old stylesheet (`0t7bap0lxzdvs.css`, without the rule). A clean rebuild (candidate-bec5044b-r2, `.next` removed) was OOM-killed on the 4GB host with no swap. It succeeded with a temporary 1.5GB swap file, which was removed afterwards. The served stylesheet `3rry_yq53j5x2.css` contains the rule.
- Stale-cache impact on earlier candidates: none found. candidate-88e009cd's stylesheet contains `scrollbar-color:#4a4a4a`, the class 1ee077fd added for the drawer, and candidate-cc242fc2 (built before it) does not. So the earlier drawer and floating-panel checks ran against current CSS. d93ed924 changed no styles. Only bec5044b's first build was affected.
- Browser check at 1440×900 on candidate-bec5044b-r2: all 15 toolbar buttons are 44px wide, compute to `display: flex`, and have 0px icon offset horizontally and vertically.

## Phone-width expanded panel (c2a18012)

- Defect: 60f26992 set the expanded workspace panel to `min(480px, calc(100vw - 96px))` to keep the left toolbar column uncovered. Below 576px wide that reserve applies, so at 320px the panel was 224px wide and its tabs and headings wrapped one character per line. This is what the 4 `canvas-toolbar-available-width-native.test.tsx` failures (`expected 224 to be close to 320`) reported.
- Fix: `WORKSPACE_PANEL_EXPANDED_WIDTH` is `min(480px, 100vw)` again. On phones the panel opens as a full-width sheet that the 44px rail collapses again. At 576px and wider the value is 480px either way, so desktop and tablet layouts are unchanged.
- Tests: `workspace-panel-layout.test.ts`, `canvas-toolbar-floating-windows.test.ts`, `canvas-toolbar-available-width-native.test.tsx` and `image-toolbar-position.test.ts` pass (41 tests). The other suites that use the panel width also pass: announcement-mobile, empty-state, minimap, viewport-wiring, draft and popup lifecycle. One empty-state 1040×720 case failed once and passed on rerun with and without the change, then the whole file passed (14 tests), so it is flaky. `tsc` reports only the missing local `@pdf-lib/fontkit` module.
- QA: clean build of candidate-c2a18012 with a temporary 1.5GB swap file (removed afterwards). Inactive QA candidates' `.next/cache` folders were deleted to free disk. In a 320×568 frame on the QA service the panel goes from 44px to 316px when expanded, and the 快速创作 tab is 77×36px on one line.

## Remote branch cleanup

Each branch was compared against HEAD (commit count, `git cherry` patch-ID check, and a line-level check that the added code is present in HEAD). The branch tips are kept locally under `refs/backup/remote-20261116/*`.

| Branch | Commits not in HEAD | Finding | Action |
| --- | --- | --- | --- |
| acceptance/vps-p0-79a92dc3 | 2 | Only a one-off workflow file pinned to candidate 79a92dc3 | Deleted |
| apimart-doc-align | 2 | Both patches already in HEAD | Deleted |
| codex/wj-stable-s1 | 0 | Fully merged | Deleted |
| codex/wj-stable-s1-pre-main-sync-20260808 | 19 | 18 already in HEAD. The 19th (91680d96) is in HEAD in a reworked form: its exported helpers and the chat/poll logic are present | Deleted |
| feat/native-transparent-generation | 0 | Fully merged | Deleted |
| fix/provider-generation-reliability | 0 | Fully merged | Deleted |
| fix/v61-audit-repairs | 1543 (old history) | Subset of v62. Main is a superset of its fixes | Deleted |
| fix/v62-canvas-stability | 1552 (old history) | Key fixes 9c04dc0d, a83a08a8, c921983f are present in HEAD | Deleted |
| sync/merged-20261103 | 0 | Fully merged | Deleted |

The remote now has only `main` and `stable`.

## Paid silent-video re-run on candidate c2a18012

- Task video_1794806386683_u5frx3: text-to-video, Seedance 2.0 (AI Link), 16:9, 4 s, 1x, sound off in the panel. The request carried generateAudio=false.
- Completed after about 6.5 minutes and 87 polls. The poll label took only three values, `文生视频 · Seedance 2.0 (AI Link) · 提交中...`, `排队中...` and `生成中...`. The model name stayed and no spaces accumulated, so e56358e6 works on the deployed build.
- Saved file: `/api/serve-upload/video/video_1794806386683_u5frx3/video_7989a398-7a7a-4d8b-90d3-8ed65b76f6dd.mp4` (UUID token name).
- ffprobe: one h264 video stream, 1280×720, 4.04 s, no audio stream. The file has 0 `soun` / `mp4a` boxes.

## Native layout tests

All 34 native (Playwright/CDP) layout test files ran against ffc98c7b: 567 of 567 tests pass. `canvas-empty-state-available-width-native.test.tsx` was run separately: 3 consecutive runs, 14 of 14 tests each. The single 1040×720 failure seen earlier did not reproduce. The likely source is the touch-routing checks, which wait at most 1500 ms (`expect.poll` timeout) for scroll or canvas-transform changes after a CDP touch drag and can miss that window on a loaded machine. The test was left unchanged.

## Production deployment of ffc98c7b

- Release: `/srv/wujie-vps/releases/ffc98c7b22d7d3d54989be9a43d2c4a99e8a8e34`, git tree `9fbca7df645700101cdec22470e3ac30ca95aa96`. `.next/BUILD_ID` and `.next/WUJIE_BUILD_COMPLETE` match the tree, and `verify-deploy-package.mjs` and `audit-build-traces.mjs --strict` pass (log: `/srv/wujie-vps/candidate-build-ffc98c7b.log`).
- Database backup before activation: `/root/db-backups/wujie_vps_validation-pre-ffc98c7b-20261116T063742Z.dump` (57 table data entries in `pg_restore -l`).
- Activation saved the previous unit and build guard in `/srv/wujie-vps/activation-ffc98c7b.81WMVftK`. Rollback target is release 2d66cb1c, which is kept on disk.
- After restart: `wujie-vps` is active with 0 restarts and runs from the new release. Both pending migrations applied (`wujie_brand_kits` and `wujie_favorites` exist). `/` and `/api/auth/me` return 200. The served stylesheet contains the drawer scrollbar rule and the toolbar centering rule.
- The only journal error is `pip3: not found` while installing optional SVG conversion dependencies. It is not fatal and was present before.
- Production `runtime.env` lacks six keys that QA sets: `BRIEF_TO_VIDEO_SKILL_ENABLED`, `DEPLOY_RUN_PORT`, `INTERNAL_API_SECRET`, `MANDATORY_API_AUTH`, `MULTI_PLATFORM_EXPORT_ENABLED`, `PAYMENT_TOKEN_SECRET`. The previous release reads them the same way, so this deploy did not change behavior. Whether production should set them is an open decision.

## Branches and cleanup

- `stable` (52f7c601) was left as is. It is 52 commits ahead of and 1348 behind `main`, so moving it would need a force push. No force push was done.
- VPS: inactive QA candidates were removed (only candidate-c2a18012 remains), as were the temporary deploy bundles. No swap file is left active. Disk use went from 92% to 58%.
- Local: prunable worktrees were pruned. The local `acceptance/vps-p0-79a92dc3` branch was deleted; its tip is kept under `refs/backup/remote-20261116/`.

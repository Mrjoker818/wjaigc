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
- Not yet deployed to the QA service.

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

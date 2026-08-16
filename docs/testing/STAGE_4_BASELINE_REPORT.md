# Stage 4 Baseline Report

- Date: 2026-08-16
- Commit: `test: establish stage four node chat agent baseline` (final hash is reported in the Task 0 completion response)
- Branch: `codex/wj-stable-s4`
- Task base commit: `7c668f0`
- Scope: Stage 4 Task 0 local legacy baseline only

## Summary

This task added the Stage 4 inventory generator, dual mode parsers, isolated Stage 4 fixture planner, Stage 4 Playwright evidence helper, workflow interaction sampler, and the first local legacy baseline spec for node mode, simple-chat, and Agent surfaces.

No business behavior was changed in Agent, chat, workflow execution, canvas behavior, authentication flows, provider routing, billing, or release logic. The only runtime-facing code changes are Stage 4 mode parsing and doctor reporting for those modes.

## Inventory Snapshot

- Workspaces: `3`
- Node types: `51`
- Port types: `10`
- Agent tools: `7`
- Skills: `16`
- Routes: `200`

### Workspace Entrypoints

- `canvas`: `/`
- `workflow`: `/?projectId=<project>`
- `simple-chat`: `/simple-chat`

Inventory artifacts:

- [stage-4-inventory.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/inventory/stage-4-inventory.json)
- [stage-4-inventory.md](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/inventory/stage-4-inventory.md)

## Current Failures

1. Initial Playwright baseline attempt failed before browser execution because `http://127.0.0.1:5000` was not serving on 2026-08-16.
2. After the local dev server was started, the first rerun exposed a Stage 4 test harness issue: duplicate tracing startup. This was fixed in the Stage 4 spec by disabling Playwright's built-in trace for that spec and keeping Stage 4's dedicated evidence capture.
3. The final real baseline run was blocked by environment prerequisites: registration was closed, and no `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` or `WUJIE_ADMIN_PASSWORD` were available to create or access an isolated Stage 4 user.

The blocked final run is retained as evidence and is not classified as a pass.

## Performance Sample

- Real workflow runtime sample: unavailable
- Reason: the final legacy baseline was blocked before authenticated fixture seeding, so no honest runtime node-mode measurement could be captured
- Unit-level Stage 4 performance summarization contract: passed via `src/__tests__/scripts/stage-4-e2e-fixtures.test.ts`

## Evidence

Blocked Chromium baseline evidence:

- [final.png](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/final.png)
- [trace.zip](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/trace.zip)
- [video.webm](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/video.webm)
- [console.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/console.json)
- [network.json](/J:/无界本地版/projects/_upstream-wjaigc-restore/.worktrees/wj-stable-s3/test-results/stage-4-baseline/evidence/7c668f0ba2789557dca6758ce9d75163ece6ce21-worktree-45d163dcf0d0/stage4-2026-08-16T15-40-19/chromium/establishes-the-local-legacy-node-chat-and-agent-baseline/retry-0/repeat-0/network.json)

## Environment Notes

- Local dev server was started with `pnpm dev` on 2026-08-16.
- The server reported no `DATABASE_URL` / `PGDATABASE_URL`.
- The server also reported missing local AI Python environment and missing local AI models, both explicitly treated as non-fatal fallback conditions.
- Stage 3 external immutable Actions / Coze release gates remain incomplete outside this task and were not executed here; they are not counted as Stage 4 pass evidence.

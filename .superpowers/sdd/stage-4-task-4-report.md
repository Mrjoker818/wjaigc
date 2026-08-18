# Stage 4 Task 4 Implementation Report

## Scope

- Branch: `codex/wj-stable-s4`
- Base commit: `9c53387`
- Stable baseline: `52f7c601ed150769e15d06fb435c6e360e28c9e7` (read-only)
- GitHub Actions billing remains external and unexecuted; local evidence is authoritative for this checkpoint.

## Implemented

- Added `projectAgentResultToWorkspace()` as the shared completed-task result projector.
- Bound placement idempotency to the actor, caller key, task output and exact workspace target.
- Reused one canonical `AssetVersion` while creating independent chat, Canvas and workflow placements.
- Rejected stale project targets and cross-owner source versions before creating versions or placements.
- Persisted canonical workspace references in task projection metadata while retaining legacy `versionIds` reads.
- Routed durable task persistence and standalone-chat Agent image results through the shared projector.
- Added project/task scope guards so late chat, Canvas and workflow results cannot mutate a newly selected project.
- Enabled the controlled `react-flow-v2` authoritative surface only when explicitly selected.
- Added the complete chat-to-Canvas-to-workflow-to-chat browser journey and Stage 4 CI job definition.

## TDD And Verification

- Initial focused RED: CI contract missing; PostgreSQL command initially pointed at a non-existent controller database.
- Corrected environment: `POSTGRES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/postgres`.
- Focused GREEN: `8 files / 80 tests` passed, including two real PostgreSQL tests.
- PostgreSQL evidence covers 20 concurrent identical projections, same-key/different-target conflict, stale-project rejection, cross-owner rejection, one charge, at most one refund, monotonic cancelled/timeout/failed terminals, memory-registry clearing and zero late versions.
- TypeScript: `pnpm ts-check` passed after replacing callback-assigned nullable E2E state with explicit post-poll reads.
- Changed-file ESLint: `0 errors / 64 historical warnings`.

## Final Local Verification (2026-08-18)

- Full PostgreSQL-enabled Vitest: `476/476` files and `2920/2920` tests passed with zero skipped tests.
- API suite: `117/117` files and `582/582` tests passed.
- Component/lib regression suite: `320/320` files and `2063/2063` tests passed.
- Production Stage 4 matrix: Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium all passed, `15/15` total.
- Chromium 1920x1080 100-node performance repeated `3/3`: `56.70 / 57.15 / 55.62 FPS`; P95 `12.80 / 14.40 / 16.70 ms`; disappeared frames and unclickable duration were all zero.
- TypeScript passed. ESLint reported `0 errors / 988 historical warnings`.
- Production build passed with `113` generated pages/routes.
- Doctor exited successfully. Protected baseline passed `38/38`, with zero unapproved drift and zero warnings.
- `git diff --check` passed. Manual task-scoped review found no new P0/P1 issue. A separate Codex reviewer could not be launched because the local Windows executable returned access denied, so this is not represented as an independent review.

## Local Task 4 Result

Task 4 is locally complete. The three workspaces now preserve durable AssetVersion lineage, persist before navigation, reject stale/duplicate transfers, keep Agent settlement monotonic, and run React Flow v2 above the fixed performance threshold without reducing any gate.

## Remaining External Gates

- Push the reviewed candidate to `main` only and record the exact resulting SHA.
- Pull that exact SHA in Coze and repeat the authenticated Chrome smoke, workspace round-trip, paid cancellation and accounting checks.
- GitHub Actions remains externally unavailable because of account billing. It is bypassed only for local progress and is not classified as a pass.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` must remain unchanged.

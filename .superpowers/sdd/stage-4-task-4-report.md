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

## Remaining Gates

- Independent task-scoped specification and code-quality review.
- Fresh full PostgreSQL, Vitest, API, ESLint, build and protected-baseline gates.
- Five-browser local matrices in the fixed sequence: legacy, shadow, v2, legacy rollback.
- Final testing reports, progress ledger and Obsidian update.
- Main-only push and Coze exact-SHA validation; `stable` must remain unchanged.

# WJ-STABLE-001 Stage 2 Task 6 Report

## Status

IMPLEMENTED AND COMMITTED on `codex/wj-stable-s2`. Nothing was pushed and
`stable` was not modified. Production changes remain inside four of the five
Task 6 allowlisted paths; `src/app/simple-chat/page.tsx` already satisfied the
direct dashboard-return contract and did not need a change.

## TDD Evidence

The three specified tests were created or strengthened before production code.

RED command:

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/simple-chat-auth.test.ts
```

RED result: 3/3 files failed, with 7 failed and 4 passed tests. The observed
failures were behavioral: asset registration returned 400 instead of the
expected managed reference or fail-closed 404; `imageRefs`, bridge parsing,
authorized transfer/chat placement wiring, and explicit Canvas project
navigation were absent. There were no syntax or environment-only failures.

The RED contract was committed as
`4934ee9c02fed7e7b05ae76ea80a1bd3cf48b4d4` (`test: define standalone chat
asset transfer contracts`). A malformed `_blank` regex character class in the
workspace-return assertion was corrected before the final GREEN run.

Final focused command added the required dashboard synchronization contract:

```powershell
pnpm exec vitest run src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/components/simple-chat-workspace-return-contract.test.ts src/__tests__/api/simple-chat-auth.test.ts src/__tests__/components/simple-chat-dashboard-sync-contract.test.ts
```

GREEN result: 4/4 files and 12/12 tests passed.

## Implementation

- `SimpleChatMessage` retains URL compatibility through `images` and now stores
  durable `imageRefs`. `ChatAttachment` retains `url` and adds optional asset,
  version, and placement identity.
- The Canvas bridge parser accepts legacy `string[]`, legacy
  `{ images: string[] }`, and structured references. The reader preserves asset
  identity and consumes a project-tagged payload only in its selected project.
- New uploaded attachments and generated standalone-chat images are registered
  with authenticated `chat-attachment` or `chat-result` placements before a
  managed reference is exposed. New data URLs are persisted only at this
  initial registration boundary.
- Sending managed media to Canvas first resolves the source reference against
  the selected project and then reuses Task 5 `/api/assets/transfer` to create a
  `canvas-image` placement. The transfer must return the same AssetVersion and a
  placement; the managed path never calls `/api/save-image`.
- URL-only historical images stay readable and are carried only as legacy URLs.
  Opening or forwarding one does not upload it or fabricate asset identity.
- Foreign project/version access uses the existing session actor and uniform
  `ASSET_NOT_FOUND` behavior. localStorage is written only after server
  authorization/transfer and serves solely as the navigation bridge.
- Existing project/task local and server synchronization serializes `imageRefs`,
  so refresh preserves managed message references. Workspace return remains the
  direct `/?view=dashboard` path, while Canvas opens with an explicit
  `projectId` and does not pass through login or a bare Canvas route.

## Task 6 / Task 7 Boundary

No implementation conflict was required even though both tasks name the simple
chat route. Task 6 handles only immediate registration for the current
standalone-chat attachment/result and explicit user-initiated transfer. It does
not inspect authoritative completed task state, project late results, attach
billing/provider/model lineage, write `projection_pending`, or add a generic
task projector. Those remain Task 7 work. `asset-v3` rollout was not enabled.

## Verification

The requested gates were run in order; TypeScript and build were run serially.

- Focused Task 6 plus dashboard sync: 4 files, 12/12 passed.
- Task 5 regression: 10 files, 62/62 passed.
- Task 4 regression: 11 files, 108/108 passed.
- Login/session regression: 7 files, 23/23 passed.
- Asset unit tests: 2 files, 13/13 passed.
- PostgreSQL asset integration: 3 files, 19 tests explicitly skipped because
  `POSTGRES_TEST_DATABASE_URL`, `PGDATABASE_URL`, and `DATABASE_URL` are absent.
- `pnpm ts-check`: an intermediate implementation run exposed two TS2345
  errors caused by optional `User.role`; the helper was narrowed to accept the
  real session type. The fresh final run passed.
- `pnpm lint`: exit 0, 0 errors and 959 repository warnings. Targeted ESLint over
  the seven Task 6 code/test files also exited 0 with 0 errors and 49 existing
  large-component warnings.
- Protected baseline from `e1e1dfd` to implementation commit `15a856c`, using
  only the five Task 6 production allow paths: 38/38 feature IDs present, no
  unapproved source drift, all paths/evidence contracts/refs passed, 0 warnings.
- Full `pnpm test`: exit 0 in 175.9 seconds. Database-backed groups skipped when
  their required environment was absent.
- `pnpm build`: exit 0 in 116.3 seconds; compile and TypeScript passed and
  114/114 static pages were generated.
- Playwright runtime smoke check at `/simple-chat`: page loaded with the expected
  title and 0 console errors. The unauthenticated environment stopped at the
  entry selector, so the protected post-login UI flow was not exercised live.
- `git diff --cached --check`: passed before the implementation commit.

## Unverified

Live PostgreSQL asset registration, placement creation, and transfer remain
UNVERIFIED because no PostgreSQL test/database URL is configured. The protected
post-login browser workflow also remains unverified in this local unauthenticated
session. These are not represented as passing live checks.

## Commits

- `4934ee9c02fed7e7b05ae76ea80a1bd3cf48b4d4` - RED tests.
- `15a856c7bad0297047563e0a777efb942e51a9ac` - Task 6 implementation and final
  workspace-return assertion correction.
- The report commit is the commit containing this file.

## Files

- `src/components/simple-chat/simple-chat-types.ts`
- `src/components/simple-chat/chat-area.tsx`
- `src/app/api/simple-chat/chat/route.ts`
- `src/components/canvas-workspace.tsx`
- `src/__tests__/components/simple-chat-asset-transfer.test.ts`
- `src/__tests__/components/simple-chat-workspace-return-contract.test.ts`
- `src/__tests__/api/simple-chat-auth.test.ts`
- `.superpowers/sdd/s2-task-6-report.md`

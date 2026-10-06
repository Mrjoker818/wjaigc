# 302 Upscale Submission Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A refreshed canvas can identify an already-submitted quoted 302 upscale without creating a second paid attempt.

**Architecture:** Add an exact actor/project/idempotency-key read-only branch to the existing task recovery endpoint. Persist only an actor-scoped non-secret attempt marker before the paid POST, then recover status from the exact endpoint; an absent task remains unresolved rather than authorizing a new key.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, isolated PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-09-28-302-upscale-submission-recovery-design.md`

## Global Constraints

- No Pear layered verification in this goal; preserve core PSD behavior.
- No real provider calls, business database, paid submission, deployment, push, or broad data cleanup.
- Existing dirty `main` belongs to the ongoing work; preserve all unrelated changes and keep the Git index untouched.
- `found:false` is never evidence that a previous paid POST was not sent.
- Do not store quote tokens, API keys, image bytes, or the paid request body in browser persistence.

---

### Task 1: Exact read-only recovery API

**Files:**
- Modify: `src/app/api/tasks/recover/route.ts`
- Test: `tests/integration/image-edit-302-identity-postgres.test.ts`

**Interfaces:**
- Consumes: `getCloudTaskForUserByIdempotencyKey(userId, key)` and the existing `imageEditAdmission` / `imageEditQuote` task result markers.
- Produces: `GET /api/tasks/recover?projectId=P&idempotencyKey=K` returning `{success:true,found:false}` or `{success:true,found:true,taskId,status,quote:{total,components}}`, with `Cache-Control:no-store`.

- [x] **Step 1: Write the failing real-POST test.** Create a quoted 302 upscale using the existing isolated-PostgreSQL fixture, query the exact endpoint while its transport gate is held, and assert the task ID, processing status and original `7`-credit quote. Test other actor/project/key, non-302 task, and pre/post task+ledger+send snapshots. Use the existing `makeRequest`, `readTaskAndLedger`, and `waitForSubmission` helpers.
- [x] **Step 2: Run the focused RED.** Run `pnpm vitest run tests/integration/image-edit-302-identity-postgres.test.ts -t 'exact read-only recovery'` with only the explicit loopback test database and isolated media directory; expect an assertion failure because the current route returns a recent-task list instead of an exact match.
- [x] **Step 3: Implement the branch.** Before `listCloudTasks`, validate the key, look up by authenticated `user.id`, require exact `projectId`, `type==='upscale'`, admission kind `requested-302-upscale`, and `imageEditQuote.confirmed===true`; return only the specified safe fields. Do not call projection or settlement code on this branch.
- [x] **Step 4: Run focused GREEN and adjacent recovery tests.** Assert exact contract and unchanged no-key listing; verify `Cache-Control:no-store` and no media/secret leakage.

### Task 2: Browser attempt marker and safe continuation

**Files:**
- Create: `src/lib/canvas-upscale-submission-marker.ts` (pure marker validation and actor/project/source matching)
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-upscale-submission-marker.test.ts`
- Test: `src/__tests__/components/canvas-document-upscale-entry.test.tsx`

**Interfaces:**
- Consumes: Task 1 exact endpoint, `/api/auth/me`, current `CanvasUpscaleQuote.idempotencyKey`, project/source identity.
- Produces: persistent `version:1` marker containing only `actorId`, `projectId`, source identity, `idempotencyKey`, timestamp; recovery may poll known task IDs but cannot resubmit or re-quote an unresolved marker.

- [x] **Step 1: Write failing pure and mounted-component tests.** Reload/remount with a stored marker, assert same-source new quote/paid POST is blocked; found processing task uses only task-ID status, found=false/network error remains blocked, terminal clears only the matching marker, storage write failure prevents paid POST, different actor never observes another actor’s task.
- [x] **Step 2: Run focused RED.** The mounted-component refresh test failed on business behavior (the expected exact lookup never occurred); pure marker tests were added after that RED, then run with the component suite for GREEN.
- [x] **Step 3: Implement minimal browser flow.** Persist marker before paid POST and fail closed on storage/auth failure; at mount and before quoting read marker after `/api/auth/me`, query exact recovery, and keep any absent/failed result unresolved. Do not persist quote token or copy media payloads.
- [x] **Step 4: Run GREEN and regression.** Rerun focused tests, non-incremental TypeScript, targeted ESLint and diff-check; report remaining cloud/browser gates explicitly.

## Self-review

- The two tasks cover exact lookup and browser refresh, but cannot establish that a non-persisted in-flight POST will never later create a task. The design therefore intentionally blocks automatic new attempts on `found:false`.
- No branch changes to the existing no-key recent-task recovery contract.
- The isolated test database is a mandatory guard, not a CI default.

## Execution evidence and remaining gate

- Focused real-POST test first failed because the existing endpoint returned a recent-task list. After implementation, 302 identity and adjacent recovery suites passed 30/30 against the explicitly isolated loopback PostgreSQL database; task/ledger/send snapshots were unchanged by exact reads.
- Mounted canvas refresh test first failed because a new quote was requested. After implementation and review corrections, canvas/marker tests passed 23/23, including read-only same-mount recheck, found=false, recovery failure, terminal cleanup, other-actor isolation, storage-write failure, delayed auth with auto mode, model/dimension changes, image switching, and same-ID/new-version switching.
- Non-incremental TypeScript check exited 0; targeted ESLint exited 0 with 15 pre-existing canvas warnings. No real paid request, deployment, push, or business-database operation was made.
- A simultaneous first confirmation in two tabs can still race before either tab observes the other's marker. A stronger shared source lock/server admission rule and browser-level two-tab test remain required before claiming end-to-end duplicate-charge prevention. Real browser refresh and production auth/deployment gates also remain open.
- Independent review initially found a refresh/auto-mode race; the handler now checks a stored attempt before current model and dimensions, and the recovery control stays enabled for read-only lookup. Review also requested current project-access gating on exact task metadata; the existing recovery route deliberately retains an owner's own task record after editor revocation, and this new branch returns no media or source payload, so that proposed change was not adopted.
- The same reviewer confirmed the Critical race and model/status usability findings were addressed, then found same-ID/new-version state retention; a regression now proves version two may quote without clearing version one's unresolved marker.

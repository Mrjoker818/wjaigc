# Regression Report - 2026-08-02

## Scope and Evidence Boundary

- Local repository: `J:\无界本地版\projects\_upstream-wjaigc-restore`
- Base commit before this remediation set: `4d58688e9b08af516d0c3c4a63ba572560694982`
- Verification date: 2026-08-02 (Asia/Shanghai)
- Browser evidence baseline: authenticated Chrome checks against `https://wjaigc.coze.site/`, recorded in `QUICK_CREATE_DEPLOYMENT_RECHECK_2026-08-02.md`

This report records the post-remediation local regression state. It does not claim that the uncommitted worktree has been deployed. Provider calls, billing, PSD extraction, and browser download behavior remain deployment verification items until fresh cloud evidence is attached.

## Repaired Contracts

| Finding | Root cause | Local repair | Regression evidence | Deployment status |
| --- | --- | --- | --- | --- |
| `AUD-20260802-003` canvas reopen viewport | Persisted nodes could remain outside `(0, 0, 1)` after reopen; reset view only returned to origin | Persist/restore validated canvas view state; reset view fits persisted non-processing nodes | `canvas-view-state.test.ts`, `canvas-project-reopen-contract.test.ts`, `canvas-incremental-history.test.ts` | Pending fresh browser proof |
| `AUD-20260802-001` generation provider traceability | Requested route and actual execution route shared a mutable display field | Persist immutable requested and actual provider/model route audit data, with fallback reason; render explicit fallback badge | `generation-route-audit.test.ts`, `generation-route-audit-contract.test.ts` | Pending real fallback proof |
| Explicit 302 upscale rejection | Provider `422 / -10021` was surfaced as generic `502`, and frontend removed the processing card | Typed 302 error parsing, persistent terminal/refund transition, visible failed card and retryable classification | `upscale-provider-error.test.ts`, `302-upscale-failure-contract.test.ts`, `upscale-terminal-state-contract.test.ts` | Pending real 302 rejection/refund proof |
| Nested 302 review rejection and native dialog leakage | A documented `error.err_code=-10021` response was embedded inside a top-level error string, leaked as raw JSON through a browser dialog, and left the frame at 8% | Parse nested `error.err_code` / `message_cn`; normalize review rejection to user-safe Chinese; route all business failures through the failed-card path; collect and fail P0 E2E on unexpected native dialogs | `image-processing-state.test.ts`, `upscale-provider-error.test.ts`, `upscale-terminal-state-contract.test.ts`, `browser-dialog-evidence-contract.test.ts` | Pending deployed Chrome proof |
| Explicit 302 fallback leakage | A charged exact-302 request could fall through to CPU mode after the cloud task was created | Exact selected 302 model resolves to AI-only; no CPU fallback after an 302 billing boundary starts | `upscale-orchestrator.test.ts` | Pending real provider proof |
| Configured upscale provider routing | Toolbar showed a hard-coded 302 catalog and could submit the selected model through the current image-generation provider | Load enabled upscaler catalog dynamically, submit provider-model pairs together, validate ownership before charge, and admit only verified Pear Real-ESRGAN | `302-upscale-models.test.ts`, `302-upscale-toolbar-wiring.test.ts`, `configured-upscale-provider-routing.test.ts` | Pending deployed catalog and provider proof |
| Pear `Image-Layered` ZIP result | Adapter submitted synchronous jobs and only accepted PSD URLs | Require asynchronous URL response; safely download ZIP/PSD artifacts; extract one non-depth PSD with bounded entry, byte, MIME, path and signature checks | `pear-layer-adapter.test.ts`, `layer-source-image.test.ts`, layered API/concurrency suites | Pending cloud Pear ZIP to editable PSD proof |
| Failed image toolbar tasks disappear | Several catch paths deleted the placeholder/card instead of reaching an explicit terminal state | Preserve failed cards for remove background, erase/mask, color adjustment, legacy decomposition, video, 3D and upscale paths | image-toolbar terminal-state contract tests | Pending browser module verification |
| Transparent-subject decomposition claim | Opaque raster could be labeled as a transparent subject | Require actual alpha-zero background and non-empty foreground before marking transparent output valid | `layer-transparency-gate.test.ts`, `layer-decomposition-validation.test.ts` | Pending output-quality review |

## Local Quality Gate Results

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm doctor` | PASS, exit code 0 | 2026-08-02 local run |
| `pnpm ts-check` | PASS, exit code 0 | Next route types generated; TypeScript completed |
| `pnpm lint` | PASS with technical-debt warnings | 0 errors, 952 warnings |
| `pnpm test` | PASS with environment skips | 290 files / 1304 tests passed; 3 files / 4 tests skipped |
| `pnpm test:api` | PASS with environment skips | 78 files / 289 tests passed; 2 files / 3 tests skipped |
| `pnpm test:regression` | PASS with environment skip | 202 files / 969 tests passed; 1 file / 1 test skipped |
| `pnpm build` | PASS, exit code 0 | Next.js 16.2.10 production build; 111 generated pages/routes |

## Addendum: 302 Dialog Regression - 2026-08-02

- The original Chrome run against `https://wjaigc.coze.site/` reproduced a real provider rejection rather than a fabricated failure: Super-Upscale V2 returned `422 / -10021` from its content checker.
- The old UI behavior was not acceptable: it opened a native browser dialog containing raw provider JSON and the placeholder remained in a non-terminal 8% state after the dialog was dismissed.
- The current worktree has passed the focused 20-test toolbar/provider suite and `pnpm ts-check`. `pnpm lint` completed with 0 errors and 952 pre-existing warnings.
- A fresh `pnpm build` completed on this worktree on August 2, 2026. Next.js generated 111 routes successfully; Node emitted a non-fatal `--localstorage-file` path warning.

## Known Gate Limits

- Local PostgreSQL connection variables are absent. The PostgreSQL concurrency suites for annotation, element decomposition, and layered decomposition are correctly skipped rather than represented as passed.
- The browser automation bridge cannot prove native local-file chooser transfer or client-side Blob download persistence.
- Supplier behavior is not inferred from a unit test: 302, Pear, provider fallback, credit/refund, and PSD editor opening must be repeated on the deployed build.
- The production build emitted a Node `--localstorage-file` invalid-path warning. It did not fail compilation, type checking, static generation or trace collection.

## Current Release Decision

**Not approved for release yet.** The local code gates are necessary evidence, but the deployment gates above are mandatory before the P1/P0 findings can be closed.

## Deployed Preflight Addendum - 2026-08-02

- Deployed URL inspected in authenticated Chrome: `https://wjaigc.coze.site/`
- GitHub `main` and the local verified worktree both resolve to `05f809652e35fbb1032042af747c7a46b0c9d7b6`.
- The deployed image-toolbar upscale dialog still exposed four hard-coded 302 choices:
  - `Super-Upscale V2 (AI超分)`
  - `Upscale V6 (标准放大)`
  - `Image Upscale (基础放大)`
  - `ESRGAN (高清增强)`
- The same deployed administrator API page reported a different effective configuration:
  - `302放大`: enabled, upscale type, **1 enabled model**
  - `Pear放大接口`: enabled, upscale type, **2 enabled models**
- Therefore the inspected deployment does not contain the dynamic configured-upscaler catalog from commit `05f8096`. That code must show configured 302/Pear choices rather than the old four-item hard-coded 302 list.
- No billable upscale request was submitted from this stale deployment. Testing a known stale request-routing surface would not be valid evidence for the repaired code.
- The no-charge 302 protocol preflight returned `2 passed, 1 warning, 0 failed`: `/models` was reachable (961 models), while generic `/images/generations` returned 404 with an `/images/edits` fallback hint. This is a provider endpoint/capability signal, not proof that a configured 302 special-upscale model is either usable or broken.
- Current release decision remains **not approved** until Coze deploys GitHub `main` at `05f8096` and the browser re-check proves the corrected catalog and provider-model routing.

## 方案 B Local Verification Addendum - 2026-08-04

Scope: Effect Reverse Engineering Pro Chinese three-column workbench, collision-safe bottom toolbar drawer, and selected-image `+N` overflow menu.

- Focused Vitest: **47 passed / 47**, across 7 files.
- TypeScript: `pnpm ts-check` **passed**.
- Production build: `pnpm build` **passed**, Next.js 16.2.10, 112 static pages generated and application routes collected.
- `git diff --check`: **passed**.
- Existing action descriptors and callbacks remain the source of truth; the new overflow menu reuses the same action objects and the bottom drawer retains existing feature buttons and annotation entry.
- The reverse-engineering result tab is gated on a real completed task result. Manual regions remain explicitly manual and are not represented as AI analysis.
- No deployed-browser evidence exists for this addendum. The Chinese window, three-column layout, drawer collision behavior, overflow callbacks, narrow viewport behavior, console/network state, and real provider task flow remain **unverified until Coze deploys this commit**.

Release decision for this addendum: **not approved for release until deployed-browser verification is attached**.

## 方案 B Deployed Browser Check - 2026-08-04

Deployment inspected in the authenticated Chrome session:
`https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/`

- Login and project loading completed without an authentication loop.
- The selected-image toolbar kept five primary actions visible and exposed all 14 remaining actions through the bounded `+14` menu.
- The `+14` callback path was exercised by opening the real `参数调色` panel.
- Effect Reverse Engineering Pro opened as a Chinese `1180 × 760` three-column workbench fully inside the `1920 × 863` viewport.
- Source, workspace and layer regions were present. Original, perspective and flat tabs switched successfully.
- Manual layer add, rename, lock, unlock and visibility changes worked.
- No application console errors or warnings were captured during these interactions.
- A real browser regression was reproduced in the bottom toolbar drawer: its rendered top was `1069px` while the viewport height was `863px`. The expected viewport-relative top was approximately `272px`.
- Root cause: the fixed drawer was nested below the toolbar's Tailwind `-translate-x-1/2` containing block, so viewport coordinates were applied relative to the translated toolbar.
- Local remediation portals the unchanged drawer to `document.body`. This remediation requires a new deployed-browser check before closure.

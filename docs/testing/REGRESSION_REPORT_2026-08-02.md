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

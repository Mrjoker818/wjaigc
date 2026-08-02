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
| Explicit 302 fallback leakage | A charged exact-302 request could fall through to CPU mode after the cloud task was created | Exact selected 302 model resolves to AI-only; no CPU fallback after an 302 billing boundary starts | `upscale-orchestrator.test.ts` | Pending real provider proof |
| Pear `Image-Layered` ZIP result | Adapter submitted synchronous jobs and only accepted PSD URLs | Require asynchronous URL response; safely download ZIP/PSD artifacts; extract one non-depth PSD with bounded entry, byte, MIME, path and signature checks | `pear-layer-adapter.test.ts`, `layer-source-image.test.ts`, layered API/concurrency suites | Pending cloud Pear ZIP to editable PSD proof |
| Failed image toolbar tasks disappear | Several catch paths deleted the placeholder/card instead of reaching an explicit terminal state | Preserve failed cards for remove background, erase/mask, color adjustment, legacy decomposition, video, 3D and upscale paths | image-toolbar terminal-state contract tests | Pending browser module verification |
| Transparent-subject decomposition claim | Opaque raster could be labeled as a transparent subject | Require actual alpha-zero background and non-empty foreground before marking transparent output valid | `layer-transparency-gate.test.ts`, `layer-decomposition-validation.test.ts` | Pending output-quality review |

## Local Quality Gate Results

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm doctor` | PASS, exit code 0 | 2026-08-02 local run |
| `pnpm ts-check` | PASS, exit code 0 | Next route types generated; TypeScript completed |
| `pnpm lint` | PASS with technical-debt warnings | 0 errors, 952 warnings |
| `pnpm test` | PASS with environment skips | 288 files / 1297 tests passed; 3 files / 4 tests skipped |
| `pnpm test:api` | PASS with environment skips | 78 files / 289 tests passed; 2 files / 3 tests skipped |
| `pnpm test:regression` | PASS with environment skip | 202 files / 969 tests passed; 1 file / 1 test skipped |
| `pnpm build` | PASS, exit code 0 | Next.js 16.2.10 production build; 111 generated pages/routes |

## Known Gate Limits

- Local PostgreSQL connection variables are absent. The PostgreSQL concurrency suites for annotation, element decomposition, and layered decomposition are correctly skipped rather than represented as passed.
- The browser automation bridge cannot prove native local-file chooser transfer or client-side Blob download persistence.
- Supplier behavior is not inferred from a unit test: 302, Pear, provider fallback, credit/refund, and PSD editor opening must be repeated on the deployed build.
- The production build emitted a Node `--localstorage-file` invalid-path warning. It did not fail compilation, type checking, static generation or trace collection.

## Current Release Decision

**Not approved for release yet.** The local code gates are necessary evidence, but the deployment gates above are mandatory before the P1/P0 findings can be closed.

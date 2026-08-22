# V5.8.8 Selective Absorption Inventory

## Decision

Continue the current GitHub `main` line and selectively absorb proven V5.8.8 improvements. Do not migrate the current product onto the V5.8.8 tree and do not copy either tree wholesale into the other.

The current line owns the accepted task/accounting, asset/version, Agent runtime, React Flow v2 and Stage 4 cloud evidence. V5.8.8 is a read-only donor for specific UI, admin, provider, mobile, media-gateway and collaboration improvements.

## Comparison Baseline

| Metric | Current `main@99d226a4` | V5.8.8 donor |
|---|---:|---:|
| Package version | `4.0.0` | `5.8.8` |
| `src` files | 1175 | 1126 |
| Identical same-path files | 7 | 7 |
| Changed same-path files | 939 | 939 |
| Tree-only files | 229 | 180 |
| `infinite-canvas.tsx` lines | 19073 | 11505 |
| `canvas-*.tsx` leaf components | 2 | 25 |
| API routes | 198 | 192 |
| Admin API routes | 25 | 24 |
| Runtime dependencies | 93 | 93 |

This comparison was recomputed on 2026-08-21 against exact `main@99d226a4`. The V5.8.8 donor still contains 1126 source files / 11,549,563 bytes and its lock digest remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`.

V5.8.8 adds `wujie-media-gateway` and `yjs`, while the current line adds `@xyflow/react` and `server-only`. V5.8.8 uses older `next`, `sharp`, `svgo`, and `eslint-config-next` versions. Dependency downgrades are prohibited.

## Batch A: UI, Admin API, Provider Adaptation

These are the only authorized first absorption targets. Every row remains unimplemented until its RED test exists in the current worktree.

| ID | Donor capability | Current evidence | Absorption decision | First RED gate | Risk |
|---|---|---|---|---|---|
| V588-UI-001 | Leaf Canvas components: image toolbar, context menus, download popup, edit panels, generation groups, image layer, connection layer, zoom cluster and tool drawer | Current Canvas contains newer Stage 3/4 persistence, performance and task fixes | **FIRST LEAF ABSORBED.** Zoom and auxiliary controls render through `CanvasZoomCluster`; current controllers, refs, event ordering and domain state remain in `InfiniteCanvas` | RED/GREEN source boundary, 64 focused assertions, 2988-test full suite, TypeScript, zero-error ESLint, build 116/116, protected baseline and exact-tree Coze Google Chrome interaction pass | High |
| V588-UI-002 | `canvas-command-palette.tsx` | No current command-palette surface; current command executor exists | **ABSORBED / CLOUD VERIFIED.** Behavior was reimplemented on the current command and tool-session APIs; donor Canvas state was not imported | Local RED/GREEN, 3005-test full suite, protected baseline, exact-SHA Coze build and Google Chrome `30/30` interaction proof | Medium |
| V588-UI-003 | `canvas-minimap.tsx` | 当前 Canvas 已有绑定现有视口、控制器和空间索引基础设施的小地图叶组件 | **本地候选通过 / 云端待验。** 绑定当前视口投影，不采用 donor 变换；不得标记为已吸收 | 100/300 节点视口映射、点击导航、缩放/尺寸变化、隐藏/空状态和性能预算；仍需 Coze exact SHA 与 Chrome 实测 | 中 |
| V588-UI-004 | Empty-state, zoom, overflow-safe toolbar and editing-panel layout components | Current toolbar behavior is protected but remains embedded | **ABSORB AS PRESENTATION-ONLY EXTRACTIONS.** No entry, label, handler or feature may disappear | Desktop/mobile visual contract, every existing toolbar action callable, no clipping/overlap, reduced-motion contract | Medium |
| V588-ADMIN-001 | `admin-dashboard-projection.ts`: no fabricated model/provider usage data | Current route fabricates zero-call provider rows and `99%` model success when database metrics are absent | **ABSORBED / CLOUD VERIFIED.** Real positive-call rows only; missing rates are nullable and coverage is explicit | Local RED/GREEN and full gates passed; authenticated Chrome and cloud API proved empty states, no fabricated `99%`, and zero fresh Console errors on `1ba98f7` | Low |
| V588-ADMIN-002 | Repository-wide admin-route authorization contract | Current 24 admin routes use both `requireAdminUser` and explicit `getRequestUser + role` patterns; donor test recognizes only one manual exception | **ABSORBED / CLOUD VERIFIED.** The current architecture is retained; an exact 24-route manifest accepts only the reviewed shared and explicit guard forms | Local RED/GREEN and full gates passed; exact-candidate Coze returned unauthenticated 401 and authenticated Chrome refreshed the administrator dashboard with zero fresh Console errors/warnings | Medium |
| V588-ADMIN-003 | Thumbnail backfill endpoint and idempotent worker | Current asset recovery/health subsystem is newer; donor route is absent | **BACKFILL + SHADOW RECONCILIATION CLOUD VERIFIED / THUMBNAIL PROJECTION CONDITIONAL.** Migration, dry-run, durable batches and `6/6` shadow project parity pass on `99d226a4` | Resolve 2 explicit missing versions plus 1 false-ready 404 asset before `asset-v3`; then prove thumbnail delivery/reload, original fallback and S3 recovery | High |
| V588-PROVIDER-001 | New display mappings such as Nano Banana Lite, GPT Image 2 2K/4K, FLUX 2 Klein, Grok Imagine video/image, HappyHorse, Gemini Omni and Seedance/Seedream variants | Current map already contains several newer Pear/Seedance entries; blind copy would duplicate or reorder wildcard matches | **ABSORB ONLY MISSING EXACT PATTERNS.** Preserve current longest/specific-first matching and administrator display-name priority | Table-driven RED cases for each missing model and collision tests for generic patterns | Low |
| V588-PROVIDER-002 | Explicit `providerId::modelId` catalog and ambiguous legacy-ID rejection | Current `task-core/model-catalog` is more advanced and already includes authorization migration, effective type and configured-provider snapshots | **AUDIT AND BACKFILL TESTS ONLY.** Do not replace current catalog or `/api/models` route | Duplicate model IDs across providers, disabled provider, unauthorized model, ordinary-user visibility and persisted legacy selection migration | High |
| V588-PROVIDER-003 | Route export cleanup into `result-store.ts` / `constants.ts` | Donor extracted non-route exports for Next route-module compatibility | **ABSORB WHERE CURRENT ROUTES STILL EXPORT NON-HTTP SYMBOLS.** Pure mechanical extraction with unchanged imports | Route manifest/build contract must identify exact illegal exports before any move | Low |
| V588-PROVIDER-004 | Unified generation tool metadata and document-tool execution | Donor executor uses localhost fetches, an internal user header, process-memory source edges and a separate poll lifecycle; current task/asset/accounting runtime is authoritative | **DO NOT ABSORB THE EXECUTOR.** Consider only declarative tool metadata after a current-runtime adapter design | Security/identity, idempotency, cancellation, task ownership, billing and asset projection contracts | Critical |

## Batch B: Mobile, Media Gateway, Collaboration

These remain deferred until every accepted Batch A item has focused regression, full regression and cloud evidence.

| ID | Donor capability | Decision | Required boundary |
|---|---|---|---|
| V588-MOBILE-001 | Single-finger pan, pinch zoom and long-press context menu | Reimplement on current pointer/viewport controller; preserve mouse, Space-pan, box selection, annotation and editing modes | 375px Chromium plus Firefox/WebKit where available; no accidental image move or page scroll |
| V588-MOBILE-002 | Mobile toolbar, image action toolbar and `/simple-create` | Absorb responsive interaction patterns after desktop toolbar extraction; keep all existing entries | Touch target, clipping, drawer, model/ratio/quality/count, result persistence and return-navigation tests |
| V588-MOBILE-003 | Reduced-motion contracts and motion tokens | Absorb semantic tokens and opt-out behavior, not scattered class copies | CSS contract plus desktop/mobile browser assertions |
| V588-MEDIA-001 | `packages/wujie-media-gateway` | Review as a package boundary around current provider compatibility code; do not move current adapters until import parity is proven | API compatibility parity, provider fixtures, package build and zero behavior-diff tests |
| V588-MEDIA-002 | `/api/gateway/v1/[media]`, gateway keys, quota and ledger tags | Deferred behind default-off feature flag; integrate with current request identity and task accounting | Bearer auth, hashed key storage, rate/daily quota, idempotent charge/refund and SSRF/input gates |
| V588-MEDIA-003 | Thumbnail variants and historical backfill | Integrate with current media health/recovery, never create a second source of truth | Variant uniqueness, alpha/orientation, idempotent backfill, storage failure and cleanup tests |
| V588-COLLAB-001 | Read-only Canvas share | Absorb before live collaboration; use sanitized immutable projection and explicit revocation | Owner authorization, public token entropy, no API key/prompt leakage, revoke and expired-link tests |
| V588-COLLAB-002 | WebSocket presence | Feature-flagged and stateless; no document writes | Auth, project isolation, heartbeat cleanup, reconnect, rate/size limits and cloud proxy proof |
| V588-COLLAB-003 | Yjs document collaboration | Last donor capability to consider; requires current asset/version and persistence adapters | Convergence, permissions, late join, reconnect, conflict, 300-node performance and rollback tests |
| V588-COLLAB-004 | Sketch-to-code | Independent optional business feature; only after collaboration/media gates | Sanitized HTML, sandboxed preview, provider failure, persistence and download tests |

## Explicitly Rejected or Superseded

1. Whole-tree replacement or migration onto V5.8.8.
2. Whole-file replacement of `infinite-canvas.tsx`, `canvas-workspace.tsx`, `user-manager.ts`, `cloud-task-storage.ts`, `poll-task`, `generate`, `agent-edit`, or task/accounting modules.
3. Replacing current `task-core/model-catalog` and `/api/models` with donor `model-core/model-catalog`; the donor path would remove current authorization migration and effective-type logic.
4. Donor `generation-execution-contract.ts` as a runtime owner. Its localhost polling, process-memory source-edge log and internal identity forwarding conflict with current durable task and asset boundaries.
5. Removing `@xyflow/react` or overwriting React Flow v2 Stage 4 work because the donor package does not contain that dependency.
6. Downgrading Next.js, Sharp, SVGO or ESLint configuration to donor versions.
7. Copying donor environment files, runtime data, generated reports, build output or credentials.
8. Any change to `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.

## Per-Item Execution Contract

For every accepted inventory ID:

1. Recompute the V5.8.8 baseline and prove the donor is unchanged.
2. Write a failing current-line test that captures the missing user behavior or contract.
3. Integrate the minimum donor idea into current architecture; do not copy unrelated code.
4. Run focused tests and affected workspace regression.
5. Run full Vitest, isolated PostgreSQL gates when the change touches persistence/accounting, TypeScript, ESLint, production build and protected-feature contracts.
6. Push only to GitHub `main`.
7. Pull the exact candidate into Coze and perform authenticated Google Chrome verification, including Console and network evidence.
8. Record the result in this inventory and the testing reports before starting the next ID.

No item is “absorbed” merely because its source file exists or a unit test passes.

## Execution Log

### V588-ADMIN-001 — 2026-08-21

- Donor remained read-only; no donor file has a write time after the captured baseline, and the lock digest still equals `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`.
- RED evidence: three API contract failures plus one UI contract failure reproduced fabricated/invalid rows and non-nullable rate rendering.
- Minimal integration: added a current-architecture projection helper, removed provider/model synthesis from the dashboard route, and rendered unavailable rates as `—`.
- Local gates: focused `4/4`, related admin `8/8`, full Vitest `465 files / 2866 tests` with `15 files / 70 PostgreSQL-only tests` explicitly skipped, TypeScript pass, ESLint `0 errors / 988 historical warnings`, production build `114/114`.
- PostgreSQL was not rerun for this item because it changes neither persistence nor accounting.
- Authenticated cloud API evidence on exact `main@1ba98f776b0c19141a9f05343ce7bb23d0c50fb2` passed: HTTP 200, both coverage objects present, model/provider coverage `unavailable`, and both projected row counts `0`. Evidence: `docs/testing/evidence/v588-admin-001-cloud-api-2026-08-21.json`.
- Authenticated Google Chrome reused only the two existing tabs. The Coze project page showed no sandbox-disconnect dialog; the existing preview tab was hard-refreshed and opened the administrator operations dashboard.
- Cloud UI assertions passed: `暂无模型调用数据` count `1`, `暂无提供商数据` count `1`, fabricated `99%` count `0`, and fresh Console Error/Warning count `0`. Screenshot: `docs/testing/evidence/v588-admin-001-cloud-ui-2026-08-21.png`.
- `V588-ADMIN-001` is absorbed. The nullable-rate `—` branch remains permanently covered by the focused UI contract; cloud data exposed the unavailable empty state rather than a valid unknown-rate row, so no test data was fabricated merely to render that branch.

### V588-ADMIN-002 — 2026-08-21

- The V5.8.8 donor remained read-only. Its `pnpm-lock.yaml` SHA-256 still equals `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`; `stable` remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- RED evidence: the donor authorization contract failed on `api/admin/assets/orphans/route.ts` because it recognized `requireAdminUser` and one `getSessionUser` exception, but not the current reviewed `getRequestUser + role` guard.
- Minimal integration changed tests only. The new contract freezes the exact 24-route administrator manifest and permits only the reviewed shared guard or the two explicitly audited manual guards. The existing orphan-scan API suite now also proves unauthenticated `401`; its existing non-admin case proves `403`, and neither rejection invokes the media-health service.
- Focused regression passed `2 files / 6 tests`; the related administrator suite passed `8 files / 26 tests`.
- Full Vitest passed `466 files / 2868 tests`; `15 files / 70` PostgreSQL-only tests were explicitly skipped because `POSTGRES_TEST_DATABASE_URL` is absent. TypeScript passed, ESLint exited 0 with `0 errors / 988 historical warnings`, and the production build completed `114/114` routes.
- PostgreSQL was not rerun because this item changes neither runtime production code, persistence nor accounting.
- Coze pulled exact `main@d220479214a88b45fcd3a9520d220b864d19cb28`; the workspace was clean, port 5000 remained HTTP 200, no rebuild/restart occurred, and `stable` remained unchanged.
- A credential-free `GET /api/admin/assets/orphans` returned HTTP `401` with `{"error":"Authentication required"}`. In the two existing Chrome tabs, the authenticated administrator refreshed the operations dashboard; user metrics and both empty-state projections rendered, with zero fresh Console errors/warnings.
- Evidence: `docs/testing/evidence/v588-admin-002-cloud-api-2026-08-21.json` and `docs/testing/evidence/v588-admin-002-cloud-ui-2026-08-21.png`.
- `V588-ADMIN-002` is absorbed. The next authorized item is `V588-ADMIN-003`; it must begin with a new RED contract and reuse the current asset/media-health subsystem.

### V588-ADMIN-003 — 2026-08-21 local candidate

- Donor review rejected direct copying: it scans the upload directory, uses a process-local lock and creates a parallel media truth. The current implementation discovers only active, ready image versions from the asset/version graph.
- RED/GREEN coverage proves administrator authorization on both handlers, bounded inputs, dry-run behavior, durable `(asset_version_id, size)` uniqueness, database leases with `FOR UPDATE SKIP LOCKED`, lease-owner terminal writes, safe image decoding, pixel limits, deterministic S3/media-gateway paths and generic error responses.
- Canvas hydration selects only `ready` variants, prefers 512 then 256, preserves an existing legacy thumbnail when no variant is ready, and falls back to the prior asset query only while this new table alone is pending migration. Unrelated database failures still propagate.
- Related asset/media regression passed `32 files / 245 tests`; `4 files / 27` existing PostgreSQL tests were explicitly skipped. Full non-PostgreSQL Vitest passed `471 files / 2895 tests`; `16 files / 72` PostgreSQL-only tests were explicitly skipped in that run.
- A fresh isolated PostgreSQL 18.4 cluster first passed the dedicated thumbnail suite `2/2`, then ran the complete repository suite with both PostgreSQL gates enabled: `487/487` files and `2967/2967` tests passed with zero failures and zero skips. This includes the checksum-managed migration, exact version/size uniqueness, mutually exclusive concurrent claims, expired-lease reclaim, stale-worker rejection and all existing asset/task/accounting concurrency gates. Evidence: `docs/testing/evidence/v588-admin-003-local-postgres-2026-08-21.json`.
- TypeScript passed. ESLint exited 0 with `0 errors / 988 historical warnings`. Production build completed `115/115` routes and includes `/api/admin/backfill-thumbnails`.
- Donor lock digest remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`; `stable` remains `52f7c601ed150769e15d06fb435c6e360e28c9e7`.
- GitHub `main` now contains exact candidate `d941384f3f7abb5c0b7a67d71686e4ebfee24da8`; `stable` remains unchanged. Coze first returned platform `instance_not_found`, then recovered while still serving an older build whose new route returns the Next.js not-found page. Neither response counts as route verification.
- Coze then pulled `d941384`: unauthenticated GET/POST correctly returned `401`, and administrator login returned `200`, but status and dry-run returned generic `500`. The real batch was not called. Root-cause tracing proved both Coze build scripts omitted `pnpm migrate`, while the runtime fast path intentionally avoids slow startup work.
- RED/GREEN deployment contracts now require both preview and deploy builds to run checksum-managed migrations before `next build`, guarded by `DATABASE_URL`/`PGDATABASE_URL`; `coze-start.sh` remains migration-free. Focused deployment, migration, protection and route-contract tests pass `21/21`; full non-PostgreSQL regression passes `2898/2898`; TypeScript, zero-error ESLint and build `115/115` pass.
- Coze pulled `main@172f38c5454b7fa5a708b61392c47d99e9f46461`. Unauthenticated access returned `401`; administrator login, status and dry-run returned `200`. The dry-run discovered 10 candidates and left all counts unchanged. Two real `limit=1` runs each claimed and completed one candidate; final status was `ready=2`, `pending=0`, `processing=0`, `failed=0`.
- Two project reads returned the same revision and `6` projects / `48` images, but exposed `assetGraphMode=legacy`, `canvasKernelMode=legacy` and zero projected thumbnails. This is an expected runtime-mode boundary, not evidence that projection failed. Chrome listed the exact existing project/preview tabs but could not claim either within the timeout; no new tab or alternate browser was used.
- **Status: BACKFILL CLOUD VERIFIED / CANVAS PROJECTION PENDING.** Do not mark absorbed or start `V588-PROVIDER-001` until a controlled `asset-v3` run proves thumbnail delivery/reload, original fallback and S3 recovery, followed by rollback to the approved runtime mode.

### V588-ADMIN-003 — 2026-08-21 shadow reconciliation acceptance

- The exact deployed source is `main@99d226a4fa9a1ffe7425e241963f110ec8609055`; Coze build and port 5000 health passed, while `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remained unchanged.
- The production-readiness API returned HTTP 200 with request ID `6a330ba2-48bf-9529-af7d-16257ea64248`. The historical `5/6` drift is closed: `legacyProjects=6`, `graphProjects=6`, `matchingProjects=6`, and every mismatch/unmigrated/orphan/checkpoint-error counter is zero.
- The deployment remains deliberately in `shadow`. The readiness result is `releaseReady=false` and `switchAuthorized=false` because two historical media records and their placements are still `missing`; these records were not hidden, deleted or relabeled as ready.
- Authenticated Google Chrome retained six projects and 48 images, and a settled reload produced zero fresh Console errors or warnings. Evidence: `docs/testing/evidence/stage4-asset-shadow-reconciliation-cloud-2026-08-21.json` and `.jpg`.
- **Status: SHADOW RECONCILIATION VERIFIED / ASSET-V3 PROMOTION NOT AUTHORIZED.** V588-ADMIN-003 remains conditional only for real thumbnail projection and recovery. The next unique action is to classify and repair the two missing historical media records under the current asset subsystem; do not bypass the doctor gate and do not copy the donor media subsystem.

### V588-ADMIN-003 — 2026-08-21 missing-media diagnosis

- Read-only PostgreSQL and authenticated browser probes identified both doctor-reported missing versions. One is a chat-only `gen-ph-*` placeholder with an empty URL; the other is a Canvas chat bridge whose `/v1/images/proxy/...` URL returns 404. Neither has `storage_key`, `recovery_source_url` or a direct `task_id`.
- The same expired proxy URL is also used by a third active current AssetVersion whose database availability remains `ready`. This third Canvas image returns 404 and is therefore a readiness false negative, registered as `V588-BUG-005`.
- The related historical cloud task is completed and preserves the prompt/provider/model, but its result contains only the expired proxy URL. Exact-byte recovery is impossible from current durable state; regeneration would create a new image and requires an explicit content decision.
- All 26 managed `/api/serve-upload/...` URLs passed. Of 28 relative project URLs, only the two Canvas references to the shared expired proxy URL failed.
- Evidence: `docs/testing/evidence/v588-admin-003-missing-media-diagnosis-cloud-2026-08-21.json` plus the two referenced `.jpg` screenshots.
- **Status: DATA CLASSIFIED / NO DESTRUCTIVE ACTION TAKEN.** The next implementation must first make readiness reject false-ready ephemeral media and provide an audited remediation choice. Do not silently delete user history or regenerate content without an explicit administrator decision.

### V588-ADMIN-003 — 2026-08-21 durability gate local closure

- TDD added deterministic detection for active current versions and active placements that claim `ready` but rely on an empty or `/v1/images/proxy/...` URL without `storage_key` or `recovery_source_url`.
- The doctor now emits aggregate `falseReadyCurrentVersions` and `falseReadyActivePlacements` counts and blocker `non-durable-ready-media`; no network probe, record identity or historical mutation was added.
- Real PostgreSQL negative verification observed `falseReadyCurrent=1`; final full regression passed `489/489` files and `2992/2992` tests with zero skips. Validate, zero-error ESLint and build `115/115` passed.
- The protected baseline gate still reports 16 accumulated source-drift entries against its older allowlist. All feature/path/evidence contracts remain present; the gate was not weakened in this change.
- Coze pulled exact `main@e809f5c105d6e42d584a38ae217d7791c7864759`, kept `stable` and `shadow`, built cleanly and served HTTP 200. Authenticated Chrome proved `falseReadyCurrentVersions=1`, `falseReadyActivePlacements=2`, `non-durable-ready-media`, six projects, 48 images, migration `6/6`, shadow parity `6/6` and zero fresh Console errors/warnings.
- **Status: DURABILITY GATE LOCAL + CLOUD VERIFIED / HISTORICAL REMEDIATION OPEN.** Keep `asset-v3` blocked and do not start destructive remediation until the administrator chooses replace, regenerate or archive for each historical record.

### S4-HISTORICAL-MEDIA-SAFE-ARCHIVE Task 6 - 2026-08-22

- Production source remains `86b8e176b2dcb88e3bf4d43ae19c64dc05dc9f54`; test-contract correction `aca74ea33bbaa92eac2566edf502e46656dfcd74` changes no production code. Fresh evidence used a migrated loopback-only PostgreSQL 18.4 database with all repository PostgreSQL URL variables populated.
- The obsolete Task 4 expectation was corrected to the approved Task 5 behavior: archive commits, overlapping restore rejects `ASSET_MEDIA_UNRECOVERABLE`, and no partial state appears. Focused `97/97`, affected `77/77`, and full `492 files / 3066 tests` pass with zero failures and zero skips.
- Validate, lint (`0` errors / `988` warnings), build (`116/116` static pages, including remediation route), and whitespace checks pass. The protected baseline still blocks on `23` unapproved historical source-drift paths, although all `38` protected feature IDs remain present. No allowlist was changed.
- **Decision: FUNCTIONAL LOCAL PASS / GOVERNANCE BLOCKED / NO MAIN PUSH.** The remaining blocker is the dedicated authorization review for 23 accumulated protected-baseline source paths, not a failing business or PostgreSQL test. `origin/stable` remains exact `52f7c601ed150769e15d06fb435c6e360e28c9e7`; the V5.8.8 donor lock SHA-256 remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`.
- Cloud archive, idempotent retry, and `asset-v3` acceptance remain **UNVERIFIED**. No cloud POST, archive, billing, regeneration, replacement, physical delete, or runtime-mode change was performed. Open minors remain the mixed `1079`-line remediation module, broad `assets/` ignore rule, and self-hosted production-origin documentation/readiness.

### V588-ADMIN-003 - 2026-08-22 protected-baseline authorization

- The administrator approved the dedicated exact-path design. Commit `34391fbda9ee2dfe7c32c103c1418d0b59361dcb` authorizes the 23 traced files without adding any directory-wide source grant.
- `docs/testing/baselines/protected-source-authorizations.json` records one source commit per path. The regression test verifies both exact command membership and that each commit actually touched its declared file.
- RED exposed the absent manifest and then three inaccurate provenance proposals; corrected GREEN passes `7/7`. The real gate now passes all `38/38` contracts with zero warning and zero blocker.
- Final PostgreSQL-enabled verification passes `492/492` files and `3067/3067` tests, validate, full lint (`0` errors / `988` warnings), build `116/116`, protected baseline and whitespace checks.
- **Decision: LOCAL GOVERNANCE + FINAL GATES PASS / MAIN PUSH PENDING.** This approval does not authorize a cloud archive POST, billing action, physical deletion, `asset-v3` promotion or donor copying.

### V588-ADMIN-003 - 2026-08-22 历史媒体覆盖闭环

- PostgreSQL RED 确认非当前坏版本上的活动 placement 会被旧发现逻辑漏掉；最小修复保持现有 Asset/Version/Placement 架构，不复制 V5.8.8 媒体子系统。
- 保护门禁进一步发现 `media-health.ts` 与 `recovery-media.ts` 是同一受审实现提交的必要改动；授权清单从 23 条纠正为 25 条精确路径，仍无任何目录级授权。
- 最新本地证据：受影响 `108/108`，带 PostgreSQL 的全仓 `3090/3090` 且 0 skip，TypeScript、构建 `116/116`、保护基线与空白检查通过，ESLint `0 error / 988` 条历史 warning。
- GitHub 与 Coze 项目页均证明精确候选为 `main@04a7a9104a96ae74325a76776e831c0e567e362b`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`、donor 和 `shadow` 未变化。
- 已登录 Google Chrome 连续两轮只读结果逐字段一致：`4` 个坏版本、`4` 个活跃 placement、其中 `1` 个非当前版本；`coverage.complete=true`、`uncoveredBlockingPlacements=0`。
- readiness 仍为 `releaseReady=false`、`switchAuthorized=false`，保留 `non-ready-current-media` 与 `non-durable-ready-media` blocker；Console Error/Warning 为 `0/0`。
- **状态：ADMIN-003 本地、main 与云端只读验收通过 / 云端归档仍需操作时确认。** 证据：`docs/testing/evidence/s4-bug-014-cloud-readonly-2026-08-22.json` 和 `.png`。本结果不授权归档 POST 或 `asset-v3`，也不允许提前启动 `V588-UI-001`。

### V588-ADMIN-003 - 2026-08-22 云端软归档闭环

- 管理员对 Task 7 的 4 个精确候选完成操作时确认；首次归档和同 key 幂等重放均为 HTTP 200，重放复用同一 remediationId。
- 数据库只读核验：ledger `1`、audit `1`、软删除 placement `4`、不可恢复版本 `4`、版本行保留 `4`，积分/退款 `0/0`；无物理删除或供应商任务。
- 归档后连续两轮 remediation 均为 0，readiness 均为 `releaseReady=true`、`switchAuthorized=true`、blocker 为空；迁移 `6/6`、shadow 对账 `6/6`。
- 当前仍为 `shadow`，没有执行 `asset-v3`。其投影、刷新恢复、原图回退、S3 恢复和回退属于独立门禁，不能从 doctor 授权状态推断为已经通过。
- **状态：ADMIN-003 历史媒体归档闭环完成。** 正式 donor 吸收下一唯一项恢复为 `V588-UI-001`；只提取叶级 UI 责任，保留当前 Stage 3/4 控制器、任务、资产和事件顺序。证据：`docs/testing/evidence/s4-bug-014-cloud-archive-2026-08-22.json` 和 `.png`。

### V588-UI-001 - 2026-08-22 首个叶组件本地候选

- 选定底部工具栏的缩放与辅助控制簇作为首个最小叶子；拒绝直接复制 donor 的控制器实现，因为它会绕过当前工具会话互斥。
- RED 先证明叶组件不存在且父组件仍内联全部控件；GREEN 后新增纯展示 `CanvasZoomCluster`，父画布继续拥有缩放边界、视图适配、网格、连线、图层/历史互斥和 AI 引擎状态。
- 聚焦矩阵通过 `7 files / 64 tests`；全仓通过 `475 files / 2988 tests`，另有 `18 files / 105` 个 PostgreSQL 环境测试明确跳过。本项不修改持久化、账务或供应商链路。
- TypeScript 通过，ESLint 为 `0 errors / 988` 条历史 warning，生产构建完成 `116/116`，保护基线 `38/38` 且 0 blocker，空白检查通过。
- 精确治理前置提交为 `cf65a65`，实现提交为 `c808e50`；新增源码路径绑定来源提交，不增加目录级授权。`stable@52f7c60` 与 donor 保持只读。
- **状态：本地通过 / GitHub main 已含实现 / Coze exact-SHA 与 Google Chrome 真实交互待验。** 未完成云端验证前不开始 `V588-UI-002`，也不把 `V588-UI-001` 标记为已吸收。

### V588-UI-001 - 2026-08-22 云端吸收闭环

- Coze 运行 HEAD 为环境配置空提交 `0e16ea0a29365c2c179c0624059e8a8e0fa263e1`；其父提交与 `origin/main` 均为 `986f128006c246b400f116da7fb3a5b4c02f0a6c`，代码树逐字节一致且工作树干净。云端生产构建返回 `BUILD_EXIT=0`，根路径 HTTP 200。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化；本项没有启用 `asset-v3`，没有修改 donor、任务、账务、供应商或持久化链路。
- Google Chrome“用户1”复用现有标签页完成管理员真实验收，没有创建新标签页。Coze 内嵌 iframe 的第三方 Cookie 上下文不能持久化登录，切换到同一现有标签页的第一方预览后，会话正常进入 6 项目、48 图片的管理员工作台；未发现业务登录回归。
- 交互证据通过：缩放 `90% -> 75% -> 90%`；重置视图 `69% -> 90%`；网格 `点阵 -> 线条 -> 空白 -> 点阵`；连线 `显示 -> 隐藏 -> 显示`；图层与版本历史双向互斥；AI 引擎弹窗可打开并关闭。
- 最终时间截点后的 Console Error/Warning 为 `0`，浏览器原生弹窗为 `0`。截图确认工具栏贴合画布，无错位、遮挡、裁切或叠加。
- **状态：V588-UI-001 已吸收。** 机器证据：`docs/testing/evidence/v588-ui-001-cloud-2026-08-22.json`，截图同名 `.png`。下一项可以进入 `V588-UI-002`，仍须从 RED 开始且只进入 `main`。

### V588-UI-002 - 2026-08-22 命令面板本地候选

- 继续采用“重实现交互、保留当前控制器”的融合方式；没有复制 donor Canvas 状态，也未引入小地图、协作、供应商、任务、账务、持久化或 `asset-v3` 改动。
- RED 先稳定复现命令面板组件、工具簇入口、父画布接线及输入焦点保护均缺失；GREEN 后新增无领域状态的 `CanvasCommandPalette`，由 `InfiniteCanvas` 继续拥有全部状态和动作。
- 当前提供按钮与 `Ctrl/Cmd+K` 两个入口，支持中文/英文关键词检索、循环键盘导航、Enter 执行、Escape/快捷键/遮罩关闭、空结果，以及输入框、文本域、选择框、可编辑区域和既有浮层保护。
- 所有命令复用当前缩放、重置、网格、连线、选择、抓手、取消选择、图层和版本历史路径；图层/历史继续经过工具会话互斥，没有删除或替换原入口。
- 聚焦回归通过 `3 files / 18 tests`；全仓通过 `477 files / 3004 tests`，另有 `18 files / 105` 个 PostgreSQL 环境测试因未配置隔离库明确跳过。本项不触及数据库与账务。
- TypeScript 通过；ESLint `0 errors / 988` 条历史 warning；生产构建 `116/116`；保护基线 `38/38` 且 0 blocker；空白检查通过。
- 实现来源提交为 `8acb3c9`，新增源码路径采用精确授权并登记来源提交，不增加目录级放行。V5.8.8 donor 与 `stable@52f7c601` 保持只读。
- **状态：本地候选通过 / 云端待验。** 未完成 Coze exact-tree 与 Google Chrome 真实交互前，不标记为已吸收，也不开始 `V588-UI-003`。

### V588-UI-002 - 2026-08-22 云端闭环

- 首轮云端交互稳定复现了两个真实缺陷：命令面板调用图层与版本历史时使用 `shortcut` 入口，但工具注册表未授权该入口，Console 记录 `CANVAS_TOOL_ENTRY_POINT_UNSUPPORTED`。
- 按 TDD 新增失败用例后，仅为 `layer-order` 与 `version-history` 增加 `shortcut` 入口；聚焦回归 `4 files / 26 tests`、全仓 `477 files / 3005 tests`、TypeScript、零错误 Lint、生产构建、保护基线和空白检查全部通过。
- 最终候选为 `main@1681b2b80a5afdbb23c710616a3b9cd99fd47e71`；Coze 构建退出码 `0`、5000 端口监听、首页 HTTP `200`，`stable@52f7c601` 与 `shadow` 模式保持不变。
- Google Chrome 在最终 SHA 上完成 `30/30` 项真实交互：入口、自动聚焦、四类检索、空结果、三种关闭、循环导航、Enter 执行、缩放/重置、网格/连线、选择/抓手、清空选择、输入保护、图层、版本历史、互斥和状态恢复全部通过；新鲜 Console Error/Warning 与 `[CanvasToolSession]` 错误均为 `0`。
- **状态：V588-UI-002 已吸收。** 机器证据：`docs/testing/evidence/v588-ui-002-cloud-2026-08-22.json`，截图同名 `.png`。下一项固定为 `V588-UI-003`，仍从 RED 开始。

### V588-UI-003 - 2026-08-22 小地图本地候选

- 当前实现候选为 `20dd2d92951078ad04c0cb356ed66c4c20b8c350`；本次进度账本基线 `67e1f85` 仅含文档。`origin/main@e1166f8ec73e9ee5745da6f2a0fb0d875708fb69` 是当前候选祖先，分支可快进。`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读且未变化。
- donor 保持只读：`J:/无界云端0820/src/components/canvas-minimap.tsx` 的 SHA-256 为 `66B41B25CA9D5932C1894D8250EBD7960261454F3C519E583036830173BC4440`，`J:/无界云端0820/src/__tests__/components/canvas-minimap.test.ts` 的 SHA-256 为 `3D2E9005A471399421C060B6CDB996B4850573F1ACE0714C1D4811C5BE1D3754`。
- 当前实现 SHA-256：`CanvasMinimap.tsx` 为 `320AAD7E9F9B643686CB19F5CF6FAC86AFAFBFD5934DE897AB267E3C16DDA1F6`；叶测试为 `701808DE318A4A8EB3BE7F0DE5443B75A520041D7C2C406075B4319D19BF07D8`；接线测试为 `1227ED785A6EB856BB2DAD772BB58A5F0A66E528617865ED3E7C2A78766CDD49`；缩放工具簇测试为 `437A9C71DAE7EC5CD0BAF2C2CF2348F9F4524E6F538E3B1286E27822926BFB99`。
- Task 1 RED 证明缺少 `CanvasMinimap` 模块、父画布接线和工具簇入口，并同时执行精确 TypeScript 门禁；独立审查为 `0/0/0`。Task 2 叶组件最终 `14` 个测试和 `pnpm ts-check` 通过，极端有限坐标及 `x + width` 溢出均纳入永久回归，独立审查为 `0/0/0`。Task 3 聚焦回归为 `6` 个文件、`27` 个测试通过，独立审查为 `0/0/0`。
- 本地完整门禁记录：全仓 TypeScript 通过；ESLint 为 `0 errors / 988` 条历史 warning，新增 warning 为 `0`；全仓 Vitest 为 `499` 个文件（`481` 通过、`18` 跳过）和 `3140` 个测试（`3035` 通过、`105` 跳过）；跳过项是未配置 `POSTGRES_TEST_DATABASE_URL` 的既有真实 PostgreSQL 集成/并发门禁，不计为通过。Next.js `16.2.11` 生产构建生成 `116/116` 页面并以退出码 `0` 完成；干净 HEAD 保护基线 `38/38`，未授权源码漂移 `0`、warning `0`；`git diff --check` 通过。
- 小地图契约：桌面默认关闭，偏好键为 `wujie.canvas.minimap.open.v1`；宽度 `<768px` 或可用宽度 `<560px` 时隐藏；关闭态零小地图遍历/投影；矩形渲染无缩略图/网络；点击导航保持 zoom；提供工具按钮和命令面板入口，适配暗色/黑白主题并避让右侧占用。
- **状态：本地候选通过 / 云端待验。** 未创建任何云端证据文件，未标记为已吸收。云端仍须验证 Coze exact SHA、构建/5000/HTTP 200、现有 Google Chrome 标签页中的默认关闭、工具按钮、命令、关闭按钮、偏好恢复、响应式隐藏恢复、导航保持 zoom、右侧面板避让、空态、暗色/黑白、100/300 节点、Console/Warning/网络/dialog 与截图。`V588-UI-004` 及后续项不得开始。

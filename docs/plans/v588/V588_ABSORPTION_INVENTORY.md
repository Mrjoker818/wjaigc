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
| V588-UI-003 | `canvas-minimap.tsx` | 当前 Canvas 已有绑定现有视口、控制器和空间索引基础设施的小地图叶组件 | **已吸收 / 云端验证通过。** 绑定当前视口投影，不采用 donor 变换；保留现有控制器、任务和持久化边界 | 本地 RED/GREEN、全仓门禁、Coze exact SHA，以及 Google Chrome 100/300 节点、导航、响应式、主题、偏好和空闲同步证据 | 中 |
| V588-UI-004 | Empty-state, zoom, overflow-safe toolbar and editing-panel layout components | Current toolbar behavior is protected but remains embedded | **ABSORB AS PRESENTATION-ONLY EXTRACTIONS.** No entry, label, handler or feature may disappear | Desktop/mobile visual contract, every existing toolbar action callable, no clipping/overlap, reduced-motion contract | Medium |
| V588-ADMIN-001 | `admin-dashboard-projection.ts`: no fabricated model/provider usage data | Current route fabricates zero-call provider rows and `99%` model success when database metrics are absent | **ABSORBED / CLOUD VERIFIED.** Real positive-call rows only; missing rates are nullable and coverage is explicit | Local RED/GREEN and full gates passed; authenticated Chrome and cloud API proved empty states, no fabricated `99%`, and zero fresh Console errors on `1ba98f7` | Low |
| V588-ADMIN-002 | Repository-wide admin-route authorization contract | Current 24 admin routes use both `requireAdminUser` and explicit `getRequestUser + role` patterns; donor test recognizes only one manual exception | **ABSORBED / CLOUD VERIFIED.** The current architecture is retained; an exact 24-route manifest accepts only the reviewed shared and explicit guard forms | Local RED/GREEN and full gates passed; exact-candidate Coze returned unauthenticated 401 and authenticated Chrome refreshed the administrator dashboard with zero fresh Console errors/warnings | Medium |
| V588-ADMIN-003 | Thumbnail backfill endpoint and idempotent worker | Current asset recovery/health subsystem is newer; donor route is absent | **BACKFILL + SHADOW RECONCILIATION CLOUD VERIFIED / THUMBNAIL PROJECTION CONDITIONAL.** Migration, dry-run, durable batches and `6/6` shadow project parity pass on `99d226a4` | Resolve 2 explicit missing versions plus 1 false-ready 404 asset before `asset-v3`; then prove thumbnail delivery/reload, original fallback and S3 recovery | High |
| V588-PROVIDER-001 | New display mappings such as Nano Banana Lite, GPT Image 2 2K/4K, FLUX 2 Klein, Grok Imagine video/image, HappyHorse, Gemini Omni and Seedance/Seedream variants | Current map already contains several newer Pear/Seedance entries; blind copy would duplicate or reorder wildcard matches | **已吸收 / Coze 云端验证通过。** 仅补齐缺失精确模式，统一采用最长匹配，继续保持管理员/供应商显示名优先 | 表驱动 RED/GREEN、通配碰撞、管理员显示名优先、全量回归、Coze exact SHA 与普通用户图像/视频目录证据 | Low |
| V588-PROVIDER-002 | Explicit `providerId::modelId` catalog and ambiguous legacy-ID rejection | Current `task-core/model-catalog` is more advanced and already includes authorization migration, effective type and configured-provider snapshots | **AUDIT AND BACKFILL TESTS ONLY.** Do not replace current catalog or `/api/models` route | Duplicate model IDs across providers, disabled provider, unauthorized model, ordinary-user visibility and persisted legacy selection migration | High |
| V588-PROVIDER-003 | Route export cleanup into `result-store.ts` / `constants.ts` | Donor extracted non-route exports for Next route-module compatibility | **ABSORB WHERE CURRENT ROUTES STILL EXPORT NON-HTTP SYMBOLS.** Pure mechanical extraction with unchanged imports | Route manifest/build contract must identify exact illegal exports before any move | Low |
| V588-PROVIDER-004 | Unified generation tool metadata and document-tool execution | Donor executor uses localhost fetches, an internal user header, process-memory source edges and a separate poll lifecycle; current task/asset/accounting runtime is authoritative | **DO NOT ABSORB THE EXECUTOR.** Consider only declarative tool metadata after a current-runtime adapter design | Security/identity, idempotency, cancellation, task ownership, billing and asset projection contracts | Critical |

### 2026-08-23 月度归档补充审计

只读归档 `wujie-one-month-repair-upgrade-files-2026-08-22.tar.gz` 已完成完整性和差异审计：SHA-256 为 `778F829415EF913B698CC4CD7F08E4B92A7C0A186DD34040C6396E69EDA33495`，共 `136` 个归档条目；未发现路径穿越或链接条目。以归档相对路径对比 `origin/main@6e3a4378a1b94a47bafbd5c8d814421772d6051b`，得到 `43` 个相同文件、`32` 个真实差异文件、`53` 个当前线缺失文件。该结果证明“选择性吸收”方向不变，但原清单偏重 UI，必须补入以下运行时稳定性项目，并在后续 UI 项之前优先处理 P0/P1。

| ID | 归档能力 | 调整后的吸收结论 | 强制门禁 | 优先级 |
|---|---|---|---|---|
| V588-STABILITY-001 | SVG/WASM 像素预算与超大输入保护 | 在当前 `/api/svg-trace` 架构内重实现预算门禁；不得复制旧路由控制器 | 边界像素、压缩炸弹、内存上限、失败终态、全仓与云端大图验证 | P0 |
| V588-STABILITY-002 | PSD 分析的受控本地媒体解析、VLM 回退与输出预算 | 复用当前安全媒体解析器，只吸收回退策略和预算思想；禁止引入任意本地路径读取 | 路径穿越、SSRF、MIME/字节/像素上限、VLM 超时、回退一致性 | P0 |
| V588-CHAT-001 | `simple-chat` 普通对话、画布修图和 Deep Research 共用严格 SSE 分块解析 | **本地已吸收 / 云端待验。** 三条流式链路已接入共享严格解析器；同时修正 CanvasEditor 参数错位和正文事件名不匹配。未复制 donor 会话、任务、同步或原始 URL 桥接 | RED/GREEN、分块/CRLF/UTF-8/多行/尾事件/畸形事件/取消、关联与全仓回归已通过；Coze 三入口真实流式、错误态、Console 与网络证据待验 | P1 |
| V588-CHAT-002 | 失败消息状态与原位确定性重试 | **待吸收。** 为当前消息增加 `streaming/completed/failed` 状态和冻结的重试上下文；重试不得重复插入用户消息，必须复用原模型、供应商、模式、附件和幂等键 | 普通对话、联网、Deep Research、画布修图失败与重试；同一消息原位恢复且不重复提交/扣费 | P1 |
| V588-CHAT-003 | 项目同步合并、离页冲刷和可诊断失败 | **待吸收。** 以远端同 ID 数据为权威合并本地项目/任务，补齐离页与用户切换前同步；保留当前登录、注销和用户数据 API，不复制 donor 存储所有权 | 多标签页、跨设备、离页、切换用户、同步失败、恢复后继续编辑和用户数据隔离 | P1 |
| V588-CHAT-004 | 聊天结果来源追踪与发送到无限画布/节点模式 | **待吸收且必须适配当前架构。** 保留当前 `AssetVersion -> /api/assets/transfer` 画布链路；补齐消息、项目、模型、供应商和任务来源，以及文本/图片发送到工作流节点。禁止复制 donor 的原始 URL `localStorage` 桥接 | 跨项目资产归属、来源可追踪、刷新恢复、文本节点、图片节点、非法 URL、重复消费与普通用户权限 | P1 |
| V588-AUTH-001 | 数据库唯一/数据库加文件两种持久化模式 | **本地候选已完成。** 只吸收显式持久化模式与启动诊断；继续使用当前认证密钥和密码校验，拒绝 donor 弱口令恢复 | 真实 PostgreSQL、普通用户/管理员多浏览器会话、退出后数据隔离和全量门禁已通过；Coze 精确 SHA 待验 | P1 |
| V588-ADMIN-004 | 用户积分、项目数和最后活动时间的真实投影 | 接入当前管理员查询和统一用户身份，不复制 donor 用户存储 | 新增用户、删除用户、批量操作、积分、项目、聊天记录与统计一致性 | P1 |
| V588-PROVIDER-005 | 图像比例/尺寸/质量与视频时长/模式能力矩阵 | **已吸收 / Coze Google Chrome 云端验证通过。** 保留 `providerId + modelId` 精确目录；管理员持久化、普通用户五入口、真实透明双图、真实视频和非法能力前置拒绝均已闭环 | 本地自动化、真实 PostgreSQL 专项、Coze exact SHA、Pear/APIMART 五入口、透明 Alpha、逐张回填、视频终态与零任务/零扣费拒绝证据均已保存；供应商后台独立计数未在本轮 Chrome 标签中直接读取 | P1 |

本次归档不能独立证明完整发布质量：它不是完整源码，不含锁定后的全量测试环境；归档声明的 donor source commit 在当前仓库不可解析；部分报告混有不同日期状态；AGENTS 对 SVG 预算写为 `256x256`，而实现/测试为 `512x512`。以上矛盾必须以 RED、当前架构实现和云端机器证据重新闭环，不能把归档报告直接当作通过证据。

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
9. 整文件复制 donor `server-auth.ts`。其中“旧密钥状态下任意长度不少于 8 的密码可触发重哈希登录”属于严重认证降级，明确拒绝。
10. 整文件复制 donor `local-image-to-data-url.ts`。其远程/本地输入缺少当前线要求的 SSRF、路径、MIME、字节和像素闭环，明确拒绝。
11. 用 donor `cloud-task-storage.ts` 替换当前任务存储。当前线已有更严格的终态身份、原子任务创建和退款唯一性，donor 只可作为测试案例来源。

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

### V588-UI-003 - 2026-08-22 小地图已吸收

- 云端验收提交为 `efe5e4f16ac3c8a0c7ed6b8fc73cba48af6fd6b2`，Coze 工作区与 `origin/main` 精确一致、构建退出码 `0`、首页和 `/api/auth/me` 均为 HTTP `200`。`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读且未变化。
- donor 保持只读：`J:/无界云端0820/src/components/canvas-minimap.tsx` 的 SHA-256 为 `66B41B25CA9D5932C1894D8250EBD7960261454F3C519E583036830173BC4440`，`J:/无界云端0820/src/__tests__/components/canvas-minimap.test.ts` 的 SHA-256 为 `3D2E9005A471399421C060B6CDB996B4850573F1ACE0714C1D4811C5BE1D3754`。
- 当前实现 SHA-256：`CanvasMinimap.tsx` 为 `320AAD7E9F9B643686CB19F5CF6FAC86AFAFBFD5934DE897AB267E3C16DDA1F6`；叶测试为 `701808DE318A4A8EB3BE7F0DE5443B75A520041D7C2C406075B4319D19BF07D8`；接线测试为 `1227ED785A6EB856BB2DAD772BB58A5F0A66E528617865ED3E7C2A78766CDD49`；缩放工具簇测试为 `437A9C71DAE7EC5CD0BAF2C2CF2348F9F4524E6F538E3B1286E27822926BFB99`。
- Task 1 RED 证明缺少 `CanvasMinimap` 模块、父画布接线和工具簇入口，并同时执行精确 TypeScript 门禁；独立审查为 `0/0/0`。Task 2 叶组件最终 `14` 个测试和 `pnpm ts-check` 通过，极端有限坐标及 `x + width` 溢出均纳入永久回归，独立审查为 `0/0/0`。Task 3 聚焦回归为 `6` 个文件、`27` 个测试通过，独立审查为 `0/0/0`。
- 本地完整门禁记录：全仓 TypeScript 通过；ESLint 为 `0 errors / 988` 条历史 warning，新增 warning 为 `0`；全仓 Vitest 为 `499` 个文件（`481` 通过、`18` 跳过）和 `3143` 个测试（`3038` 通过、`105` 跳过）；跳过项是未配置 `POSTGRES_TEST_DATABASE_URL` 的既有真实 PostgreSQL 集成/并发门禁，不计为通过。Next.js `16.2.11` 生产构建生成 `116/116` 页面并以退出码 `0` 完成；保护基线、治理门禁和 `git diff --check` 通过。
- 小地图契约：桌面默认关闭，偏好键为 `wujie.canvas.minimap.open.v1`；宽度 `<768px` 或可用宽度 `<560px` 时隐藏；关闭态零小地图遍历/投影；矩形渲染无缩略图/网络；点击导航保持 zoom；提供工具按钮和命令面板入口，适配暗色/黑白主题并避让右侧占用。
- Google Chrome「用户1」复用现有标签页完成 26/26 项云端矩阵：默认关闭、工具栏与命令开关、偏好恢复、`767/768px` 与可用宽度 `559/560px` 边界、右侧面板 12px 避让、暗色/黑白主题、空态、100/300 节点、手形拖动和保持 `46%` 缩放的小地图导航全部通过。最终 12 秒健康窗口为 Console error/warning `0/0`、原生弹窗 `0`、请求全部 `200`；两个 30 秒空闲窗口的画布/项目同步 POST 为 `0`。
- **状态：V588-UI-003 已吸收。** 机器证据：`docs/testing/evidence/v588-ui-003-cloud-2026-08-22.json`，截图和 Console/网络/任务日志位于同目录。PostgreSQL 专项仍因缺少隔离库单独保持未验证；下一唯一项为 `V588-UI-004`，必须重新从 RED 开始。

## 2026-08-23 V588-AUTH-001 本地候选闭环

- 实现提交为 `b0cd946f`。数据库唯一与数据库加文件模式均显式失败关闭；认证副本刷新使用 PostgreSQL 事务级 advisory lock，避免多进程、跨连接并发覆盖。旧凭据只在真实旧哈希匹配后迁移，没有吸收 donor 的八位密码绕过。
- `simple-chat` 退出现在真实调用服务端注销，并以独立硬截止限制用户数据同步；任意 `{success:false}` 不再被误判为匿名成功，退出失败时保留当前登录态并明确提示。
- 真实 PostgreSQL 聚焦门禁通过 `7 files / 63 tests`，其中包含 `8` 项未跳过的 PostgreSQL 集成与并发用例。全仓 Vitest 通过 `503 files / 3286 tests`，另有 `19 files / 113 tests` 因缺少其余模块完整隔离数据库明确跳过；API `701/701`、回归 `2336/2336` 均无失败。
- `doctor`、TypeScript、零错误 ESLint 和 Next.js `16.2.11` 生产构建均通过，构建生成 `116/116` 页面。独立代码审查与数据库审查均为 `Critical/Important/Minor = 0/0/0`。
- 本地生产环境真实浏览器矩阵通过 `10/10`：Chromium、1080p Chromium、Firefox、WebKit、移动 Chromium，各覆盖管理员和普通用户。流程包含错误密码、正确登录、刷新保持、三个工作区导航、真实注销和注销后的受保护数据隔离。
- 首轮浏览器 `503 AUTH_CONFIGURATION_UNAVAILABLE` 的根因是验收夹具意外继承 `FILE_ONLY`，不是代码回归；使用计划要求的 `DB_PLUS_FILE` 后同一最终构建全部通过，未通过修改业务代码掩盖。
- **状态：本地候选通过 / GitHub main 与 Coze 精确 SHA 待验。** `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。云端未拉取并完成同一会话矩阵前，不标记为已吸收，也不开始下一 donor 项。

## 2026-08-23 V588-UI-004 本地候选

- 六个展示叶已完成：空态、图片浮动工具栏、放大/SVG、擦除/蒙版、调色/去背景、扩展/裁切；父画布继续持有模型、任务、API、状态、账务和保存副作用。
- 抽取后旧测试读取错误所有者的问题已按真实组件边界修正，未修改运行时代码；图片、视频、3D 和底部工具入口没有减少。
- 聚焦矩阵 `13 files / 65 tests`、修复回归 `3 files / 14 tests` 通过；独立复审为 `Critical/Important/Minor = 0/0/0`。Chromium E2E 已定义 375/768/1440、底部抽屉、图片工具栏、8 个编辑入口、面板保持打开时的桌面到 375px resize 和 reduced-motion；本机因缺少凭据与 PostgreSQL 实际结果为 `2 skipped`，不计通过。
- 全仓 Vitest 共 `507` 个文件、`3180` 项测试，其中 `489` 个文件、`3075` 项通过；`18` 个文件、`105` 项 PostgreSQL 专项因缺少 `POSTGRES_TEST_DATABASE_URL` 明确跳过，不计为通过。TypeScript、构建 `116/116`、保护基线 `38/38`、空白检查通过；ESLint 为 `0 errors / 987` 条历史 warning。
- 本地生产 E2E 环境没有真实登录凭据与 PostgreSQL，测试在业务动作前明确跳过；浏览器布局、动作与错误零基线必须由 Coze 云端关闭。
- **状态：本地候选、独立审查与 GitHub main 推送通过 / 云端待验。** 实现候选已普通快进到 `main@be96c59d2d4dec6bbe510c3b7fd0de59ef092e0b`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与 donor 保持只读。Google Chrome 能列出正确的现有项目页和预览页，但接管任一标签连续超时，因此 Coze 拉取、运行健康和浏览器矩阵仍未验证，V588-UI-004 不标记为已吸收。云端闭环后先处理上述 P0/P1 稳定性项，再继续移动端、媒体网关与协作吸收。

## 2026-08-24 V588-PROVIDER-005 与原生透明 PNG 集成检查点

- `feat/native-transparent-generation` 的功能提交已进入 `main@36a986fcb74b2d16313a349600a4022c71b482e0`，临时功能分支已在完成合并后清理；透明请求规范化、PNG 输出约束和逐图 Alpha 校验均保留。
- `V588-PROVIDER-005` 基于上述最新 `main` 重新集成，候选为 `93253e6f981a2c6cc4403c9c5615e7044c7db62e`。图像、参考图组、融图组、节点、视频和 Agent 继续使用精确 `providerId + modelId` 能力目录，未恢复模型名猜测。
- 联合专项回归为 `126 passed / 1 PostgreSQL-gated skipped / 0 failed`；全仓为 `3419 passed / 116 PostgreSQL-gated skipped / 0 failed`。TypeScript、ESLint（`0 errors / 970` 条历史 warning）、Next.js `116/116` 构建、Doctor、保护基线 `38/38` 和空白检查均通过。
- Windows 保护门禁的 166 个精确路径已迁移到 JSON 清单，避免命令行长度上限；保护范围没有扩大为目录级授权。
- donor 只读基线保持 `1126` 个 `src` 文件、`11549563` 字节，锁文件 SHA-256 为 `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- **状态：本地集成候选通过，尚未标记吸收。** 关闭条件仍是 Coze 拉取最终 exact SHA，在现有 Google Chrome 标签完成管理员能力持久化、普通用户五入口、真实图像/视频、非法参数零扣费，以及 GPT Image 2 透明 PNG Alpha 与单次扣费验证。

## 2026-08-24 最终候选 Coze 基础设施检查点

- 最终候选已进入并运行于 Coze：`main = origin/main = 0adbd5ee5b8e32e3987ddf0ccb9f09dd816f5f4d`。本地 Coze 同步空提交已保留备份引用后安全移出运行分支，工作区无业务差异。
- 云端生产构建退出码 `0`，服务按 `shadow` 模式启动，5000 端口 PID `2547`；根路由、认证接口和页面引用静态资源全部 HTTP `200`。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 和 V5.8.8 donor 仍保持只读。
- **吸收状态不变：尚未完成。** 本检查点只关闭 exact-SHA、构建和运行健康；真实浏览器能力矩阵、透明 Alpha、任务与账务关闭后，才可将 `V588-PROVIDER-005` 和原生透明 PNG 标记为已吸收并进入下一项。

## 2026-08-24 `4711501b` 原生透明 PNG 最终候选检查点

- 功能分支已并入并清理，`main = origin/main = 4711501bdeb059a16d404184ef38c0956a57fb06`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 和 V5.8.8 donor 均未修改。
- 新增真实 E2E 永久合同要求透明 `n=2` 生成拥有两个不同任务、逐张回填、每张独立 Alpha 字节验证和恰好两笔扣费；本地全仓为 `526 files / 3420 tests passed`，`20 files / 116 PostgreSQL-gated tests skipped`，Doctor、TypeScript、零错误 Lint 与生产构建通过。
- 当前 Coze 预览返回 `404 instance_not_found`，现有 Chrome 标签可枚举但页面动作超时；因此新 SHA 的云端运行和业务验收均未成立。
- **吸收状态保持未完成。** 先恢复沙箱并在 `4711501b` 上关闭 Stage 4 真实 Alpha、逐张回填、任务终态和账务；完成前不进入新的 V5.8.8 donor 吸收项。

## 2026-08-24 Stage 4 透明生成关闭与能力持久化检查点

- Coze `a2705680` 的 Pear `gpt-image-2` 透明 PNG `n=2` 已完成两个独立任务、逐张回填、两份 Alpha 字节和恰好两笔扣费验证；原生透明输出子项可标记为已云端吸收。
- 管理员能力保存发现历史 JSONB 表兼容缺陷。`d56844b4` 仅增加 `selected_models` 双结构编码与失败传播，已通过真实 PostgreSQL 18、全仓测试、TypeScript、Lint、构建和保护门禁。
- **V588-PROVIDER-005 整体仍未吸收。** 下一唯一动作是部署新 main，完成管理员保存/刷新/重启/恢复原值；随后继续普通用户五入口、非法能力零副作用与真实视频，不能跳到新的 donor 功能。

## 2026-08-25 视频播放修复后的唯一继续点

- 当前本地与 GitHub 精确为 `main@fb6741853272b43a4e36e046511900f031ab758f`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读且未变化。
- `S4-BUG-018` 的媒体恢复已在 Coze `ebf611ea` 证明：历史视频为真实可加载 `<video>`、`readyState=4`、`duration=5`、无媒体错误和 `MEDIA_UNAVAILABLE`。同轮稳定复现播放浮层被画布根节点指针捕获，新增 RED 后以单行 `pointerdown` 隔离最小修复并推送 `fb674185`。
- 最终聚焦画布/视频矩阵 `47/47`、全仓 `3446` 项测试、TypeScript、零错误专项 Lint 与 Next.js `116/116` 构建通过；`117` 项 PostgreSQL 门禁因未配置完整隔离库继续明确标记为未验证。
- V5.8.8 donor 再次只读核验：`src` 为 `1126` 个文件、`11549563` 字节，`pnpm-lock.yaml` SHA-256 仍为 `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`，没有重新定义或扩大吸收范围。
- Coze 沙箱已由用户恢复；Google Chrome 能枚举正确“用户1”的原有项目页和预览页，但旧控制会话仍占用标签，重新接管持续超时。该外部状态不能解释为代码失败，也不能作为云端通过证据。
- **下一唯一动作保持不变：** Chrome 旧控制占用释放后，让 Coze 拉取精确 `fb674185`，验证历史视频播放时间推进、刷新/重开保持、非空下载及无新增扣费；随后完成普通用户五入口及非法能力零副作用。上述 Stage 4 门禁关闭前，不开始新的 V5.8.8 donor 功能吸收，也不重复管理员能力持久化或透明 PNG `n=2` 已通过项目。

## 2026-08-25 视频云端验收检查点

- 当前本地、GitHub 与 Coze 精确为 `main@f19ab16441c8ef632124fb12afb1d94ad2200d2f`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 和 V5.8.8 donor 均未触碰。
- 播放浮层、未选中首次下载弹窗和托管视频下载三个独立根因已按 RED/GREEN 最小修复；Coze 真实历史视频完成播放、刷新恢复和 MP4 文件字节校验。
- 本地全部视频 `58/58`、TypeScript、零错误专项 Lint 与 `116/116` 构建通过；全仓 3447 项业务断言通过，但 1 项既存 Git 源指纹测试超时、117 项 PostgreSQL 门禁跳过，均继续保留。
- **Stage 4 仍未整体完成，V5.8.8 吸收顺序不变。** 下一唯一动作是普通用户五入口，再执行非法能力零副作用；下载前后积分独立取样作为补充账务证据保留。上述门禁关闭前，不开始新的 donor 功能吸收或重复透明 PNG、管理员持久化、视频播放下载已完成项目。

## 2026-08-25 普通用户五入口与非法能力准入关闭

- Coze、本地与 GitHub 精确为 `main@1ec32f49c651b8f18aa47df382435cede650523a`，运行时代码为 `f19ab16441c8ef632124fb12afb1d94ad2200d2f`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 隔离普通账号 `canvas-user` 在 Google Chrome 现有标签完成五入口：底部图像生成器、参考图组、融图组、节点图像生成节点和视频生成器。Pear/APIMART 的模型、比例、尺寸/分辨率、质量、数量及时长均按精确供应商模型目录切换。
- 融图组“出图数量无响应”经复核属于视频生成器浮层未关闭导致的测试命中错误；关闭浮层后菜单显示 `1-4张`，并可切换为 `4张`。未为误判修改业务代码。
- 真实普通用户会话提交 Pear `gpt-image-2` 的 `n=5`，返回 HTTP 400、`MODEL_CAPABILITY_MISMATCH`、`field=outputCount` 和允许值 `1-4`。数据库前后均为任务 `83`、积分流水 `108`、累计使用 `3917`，没有创建应用任务或扣费。
- 普通用户点击“用户管理”没有进入管理员界面，只返回普通用户项目仪表盘；未出现用户表、API 管理、积分管理或支付配置。入口命名的误导性作为后续 P3 交互观察保留，不属于越权。
- **状态：V588-PROVIDER-005 已吸收。** 原生透明 PNG、管理员能力持久化、真实视频、普通用户五入口与非法能力零副作用已形成连续云端证据。供应商后台独立任务计数未在本轮授权 Chrome 标签直接读取，不能扩大为第三方审计通过；下一项按清单进入 `V588-PROVIDER-001` 的只读精确差异与 RED。
- 证据：`docs/testing/evidence/s4-ordinary-five-entry-and-admission-2026-08-25.json` 与同名 PNG。

## 2026-08-25 V588-PROVIDER-001 精确模型显示映射关闭

- 当前实现与 GitHub 为 `main@3c597cd9a4c14dfeb851ad06670c49b3158a7d49`；Coze 从旧 `1ec32f49` 普通快进拉取该提交，生产构建成功，Build ID 为 `x6PRiIKqawBZ5fFXbvn55`，新进程 PID `3471`，根路由 HTTP `200`，持久化模式继续为 `DB_ONLY`。
- 仅吸收 V5.8.8 缺失的精确显示模式，并把匹配规则统一为“最长模式优先、同长度保持声明顺序”。没有复制 donor 的模型目录、授权或供应商控制器，也没有改变 `providerId + modelId` 身份边界。
- 本地 TDD 先得到 `26` 项中的 `25` 项预期失败，修复后 `26/26`；关联映射回归 `59/59`，全仓 `530` 个文件通过、`20` 个文件因缺少隔离 PostgreSQL 明确跳过，业务断言 `3474` 项通过、`117` 项跳过。TypeScript、改动文件 ESLint、`git diff --check` 和 Next.js `116/116` 构建均通过。
- Google Chrome“用户1”只复用现有 Coze 项目页和预览页。普通用户目录真实显示 `Gpt Image 2 4k`、`Nano Banana 2 Lite`、`Kling V3 Omni`、`HappyHorse` 和 APIMART Grok Imagine 1.5 视频别名；管理员/供应商给出的显示名仍优先，没有被 fallback 覆盖。
- 新进程稳定后重新加载并建立干净观察窗口，Console error/warning 为 `0/0`，原生浏览器弹窗为 `0`。服务切换瞬间的一条项目同步 `502` 历史 warning 与干净窗口分开保存，未被隐藏。
- **状态：V588-PROVIDER-001 已吸收。** 本轮是目录和显示回归，没有调用付费模型，不能扩大为供应商生成任务通过。`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 未修改。
- 证据：`docs/testing/evidence/v588-provider-001-model-labels-cloud-2026-08-25.json`、`v588-provider-001-image-model-cloud-2026-08-25.jpg` 和 `v588-provider-001-deployment-cloud-2026-08-25.jpg`。
- 下一项不是模糊的“simple-chat 优化”，而是先完成 `V588-CHAT-001` 的 Coze 三入口验收；未关闭前不得进入 `V588-CHAT-002`。其余三项仍为待吸收，必须分别从失败测试开始。

## 2026-08-25 V588-CHAT-001 本地吸收检查点

- 设计与实施边界分别记录在 `docs/superpowers/specs/2026-08-25-v588-simple-chat-strict-sse-design.md` 和 `docs/superpowers/plans/2026-08-25-v588-simple-chat-strict-sse.md`；V5.8.8 donor 保持只读，未复制其会话、任务、同步或原始 URL `localStorage` 桥接。
- TDD 首轮解析器因目标模块不存在得到 1 个预期失败套件，三入口接线合同得到 `2/2` 预期失败；实现后解析器 `9/9`、解析器与接线合同 `11/11`、关联回归 `56/56` 通过。
- 接线审计额外发现并修复两个当前分支缺陷：CanvasEditor 的旧内联回调把 `instruction/content/selection` 参数角色传错；画布修图流只读取 `content`，而服务端正文事件实际使用 `text`。
- 全仓结果为 `532` 个文件通过、`20` 个 PostgreSQL 文件因缺少隔离数据库跳过；业务断言 `3485` 项通过、`117` 项跳过。TypeScript、零错误 ESLint、Next.js `116/116` 构建和 `38/38` 受保护基线门禁通过。
- 受保护基线白名单只补录 8 个已经过审的路径，并保留来源提交：`97634feb`、`f19ab164`、`3c597cd9`、`717f3eab`；没有把未审改动静默加入允许范围。
- **当前状态：本地已吸收 / 云端待验。** 必须在 Coze 精确拉取新 `main` 后验证普通对话、CanvasEditor 修图、Deep Research、严格错误态和浏览器健康；通过前不进入 `V588-CHAT-002`。

## 2026-08-25 Simple Chat 模型菜单和请求上下文本地检查点

- V5.8.8 的模型菜单遮挡修复已选择性吸收：保留其顶部栏 `relative z-50` 父级层叠上下文，当前两个菜单进一步使用 `z-[100]`、有界高度与内部滚动；未复制 donor 的重复 `selectedModel/selectedProviderId` 本地状态。
- 当前任务成为聊天模型唯一数据源，模型与供应商原子更新；普通对话、CanvasEditor、Deep Research 固化请求快照，历史失效图片仅从请求副本排除，不改写用户历史。
- 聚焦回归 `8 files / 43 tests`、全仓 `536 files / 3508 tests`、TypeScript、零错误 Lint、Next.js `116/116` 构建、保护基线和空白检查均通过。`20 files / 117 tests` PostgreSQL 专项因缺少隔离数据库明确跳过。
- Playwright 门禁已建立桌面、412px、375px、320px 的 100 消息菜单可见性、hit-test、滚动、点选、横向溢出和请求体一致性断言，并阻断页面对真实聊天项目测试数据的延迟写回；本机缺少真实 E2E 凭据，因此实际浏览器结果保持未验证。
- **状态：本地加固完成 / Coze Chrome 待验。** 云端证据完成前，`V588-CHAT-001` 仍不关闭，也不进入 `V588-CHAT-002`。

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
| V588-STABILITY-002 | PSD 分析的受控本地媒体解析、VLM 回退与输出预算 | **真实 ZIP/主 PSD 消费已确认，远程成功终态未通过。** 当前架构已实现受控媒体、授权 VLM、总截止、持久幂等、数据库租约接管、托管结算和一次性账务终态；只读云任务审计证明 `layer_be958ed4...` 最终为 `failed/refunded`，此前看到的 5 层来自本地回退或旧编辑器状态，不能作为 Pear 成功证据 | 已关闭异步提交、ZIP/主 PSD 消费、失败退款、同键重放和 PostgreSQL 并发；仍须处理/明确 Pear 将 `3504x2336` 输入变为 `1280x1280` 的能力边界，部署旧 PSD 状态清理修复，并重新验证远程成功、导出、保存和一次成功扣费 | P0 |
| V588-CHAT-001 | `simple-chat` 普通对话、画布修图和 Deep Research 共用严格 SSE 分块解析 | **已吸收 / Coze 云端验证通过。** 三条流式链路共用严格解析器，并已关闭 CanvasEditor 参数错位与正文事件名不匹配；未复制 donor 会话、任务、同步或原始 URL 桥接 | RED/GREEN、分块/CRLF/UTF-8/多行/尾事件/畸形事件/取消、三入口真实 APImart 流式终态及零 Console/原生弹窗证据 | P1 |
| V588-CHAT-002 | 失败消息状态与原位确定性重试 | **已吸收 / 云端通过。** 普通与联网原位重试、CanvasEditor 精确选区、刷新精确任务恢复、服务器终态持久化及 Deep Research 单 Artifact 均取得 Coze 证据 | `main-fix@1572a222` 的 Deep Research 任务刷新前后 UI 与服务器均严格保持同一个 `msg_1787715525319-research` Artifact；Console/原生弹窗为 0。第三方 exactly-once 仅保留为供应商能力边界 | P1 |
| V588-CHAT-003 | 项目同步合并、离页冲刷和可诊断失败 | **已吸收 / Coze Google Chrome 云端验证通过。** 版本化快照、CAS 冲突重放、冲突副本、删除不复活、用户隔离、离页冲刷和可诊断同步状态均已闭环；保留当前登录、注销、用户数据 API 和前台流式生成边界 | 真实 PostgreSQL `4030/4030`、Coze 冷启动、项目/任务 CRUD、刷新恢复、双标签合并/冲突副本、离页、账号切换、布局及浏览器健康证据 | P1 |
| V588-CHAT-004 | 聊天结果来源追踪与发送到无限画布/节点模式 | **已吸收 / Coze Google Chrome 云端验证通过。** 已保留 `AssetVersion -> /api/assets/transfer` 安全链路并补齐节点模式转交与来源追踪；普通用户正向、跨用户 403、URL-only 未托管媒体跳过、不远程读取、重复消费与刷新恢复均已闭环 | 跨项目资产归属、来源可追踪、刷新恢复、文本节点、图片节点、非法 URL、重复消费与普通用户权限 | P1 |
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
- **状态：模型菜单已完成 Coze Chrome 验收 / 三入口流式仍待验。** `main@9a3fcb63` 已在 1440、412、375、320 四档验证两个菜单的视口边界、内部滚动和点选关闭；320px 二次缺陷经 RED/GREEN 修复。普通对话、CanvasEditor 与 Deep Research 的真实流式终态和错误态仍未关闭，因此 `V588-CHAT-001` 整体仍不关闭，也不进入 `V588-CHAT-002`。

## 2026-08-25 V588-CHAT-002 本地实现检查点

- 领域层新增版本化、有界的失败状态与重试上下文；刷新遗留的 `streaming` 消息会收敛为可解释的 `failed`，无有效上下文时失败关闭且不可重试。
- 普通/联网对话与 Deep Research 均在原助手消息上失败和重试，不新增第二组消息；模型、供应商、联网模式、附件引用、历史消息、`responseMessageId` 和幂等键均从首次请求冻结。CanvasEditor 同样冻结指令、正文、选区起止位置和模型配对，失败不新增版本，成功只新增一个版本。
- `/api/simple-chat/chat` 与 `/api/simple-chat/deep-research` 统一校验 1-256 字符幂等键；Header 与正文不一致返回 409。普通对话透传原键，Deep Research 分别派生 `:plan` 与 `:report`，且错误正文与日志不回显键值。
- TDD 按 RED -> 最小实现完成；聚焦套件 `7 files / 71 tests`、全仓 `540 files / 3531 tests` 通过。另有 `20 files / 117 tests` 因缺少隔离 PostgreSQL 测试库明确跳过；TypeScript 通过，ESLint 为 `0 errors / 967 historical warnings`，Next.js 生产构建生成 `116/116` 页面。
- 全量回归先后暴露一个过时源码字符串断言和一个 Windows/Git 同步文件系统测试的 20 秒门禁抖动；前者改为验证冻结的 `context.assistantMessageId`，后者只把同步 Git 测试预算校准为 45 秒，没有增加任何业务等待或掩盖异步状态。
- **状态：本地已实现 / 云端待验。** 应用内原位消息与下游幂等透传已验证；不宣称不支持幂等 Header 的第三方文本供应商具有严格 exactly-once。Coze 仍需验证真实失败、原位重试、刷新恢复、单 Artifact/单版本和浏览器健康后才能标记为已吸收。

## 2026-08-26 V588-CHAT-002 CanvasEditor 补充检查点

- 旧云端 `7bf1cc3c` 已真实证明 CanvasEditor 离线失败保留正文、选区和指令；恢复在线后只发送一个重试请求、只新增一个版本，并复用冻结的 APIMart 模型配对和应用幂等键。
- 同一验收发现当前分支自身的选区提示契约缺陷：只发送选区片段，却要求供应商返回完整文本。该问题不是 V5.8.8 donor 迁移项，也未通过复制 donor 代码处理。
- 按 RED -> 最小修复新增选区提示合同，提交 `e0ec998d28a2bad0fc27981220bff42fb9a390d7`。全文编辑行为、会话所有权、模型选择、幂等键、`stable` 和 V5.8.8 donor 均未改动。
- 专项 `39/39`、全仓 `3533` 项业务断言、TypeScript、零错误 Lint 和 `116/116` 构建通过；`117` 项 PostgreSQL 测试仍因缺少隔离库跳过。保护门禁的 4 个既有未批准漂移继续单列，不静默加入白名单。
- **状态：CanvasEditor 重试机制云端通过 / 选区输出修复待 Coze 验收。** 在精确替换、单版本和浏览器健康再次取得真实证据前，不把 V588-CHAT-002 标记为完整吸收，也不进入下一吸收项。

## 2026-08-26 V588-CHAT-002 刷新恢复检查点

- CanvasEditor 精确选区替换已在云端真实通过；刷新中断随后暴露新的当前线任务身份缺陷，不是 donor 迁移偏移。
- 旧云端只保存 `projectId`，刷新固定选中第一条任务；真实中断任务虽然已入库并带冻结上下文，仍长期保持 `streaming` 且用户看不到。
- 已按 RED -> 最小接入增加 `taskId` URL 身份，目标测试从 `2 failed / 2 passed` 转为 `4/4`，关联 Simple Chat `33/33` 通过。未改动 `stable`、V5.8.8 donor、供应商、模型、积分或数据库结构。
- 完整本地门禁已通过：全仓 `541` 个文件、`3535` 项已执行测试全部通过；`20` 个文件、`117` 项 PostgreSQL 专项因缺少隔离测试库明确跳过且不计为通过；TypeScript、ESLint `0 errors / 967 historical warnings`、Next.js `116/116` 生产构建、证据清单与空白检查通过。
- **当前状态：本地修复与完整门禁通过 / Coze 复验待完成，V588-CHAT-002 仍未关闭。** 只有同一任务刷新后出现单一可重试失败或合法完成终态，且数据库不再保留 `streaming`，才允许进入 `V588-CHAT-003`。

## 2026-08-26 V588-CHAT-002 刷新恢复第二轮检查点

- `origin/main@da1f5c4` 已在 Coze 以完全相同代码树运行，Google Chrome 真实刷新证明 URL 能恢复精确 `projectId + taskId`，同一测试标记、单一消息组和单一请求均保留。
- 权威 PostgreSQL 仍记录助手 `status=streaming`，说明第一轮修复只关闭“回到旧任务”，没有关闭“服务器终态持久化”。这项真实失败没有被 UI 的可重试提示掩盖。
- 根因限定在当前线项目装载边界，不属于 donor 吸收偏移。第二轮按 RED -> 最小修复新增项目树恢复函数，确保服务器/本地项目在进入父状态和后续同步前已把遗留 `streaming` 收敛为 `failed`。
- 本地新结果：目标 `12/12`、Simple Chat `122/122`、全仓 `3536` 项已执行测试通过；`117` 项 PostgreSQL 隔离测试继续跳过；TypeScript、ESLint `0 errors / 967 historical warnings` 和 Next.js `116/116` 构建通过。
- **当前状态：首次新云端部分失败 / 第二轮本地通过 / 待提交和再次云端验收。** 仍停留在 `V588-CHAT-002`，不得进入 `V588-CHAT-003`；`stable` 与 V5.8.8 donor 均未触碰。

## 2026-08-26 V588-CHAT-002 刷新恢复第二候选云端关闭检查点

- `origin/main@3ecd2f9b` 已以相同代码树 `eb205aae` 在 Coze 运行；健康路由和 12 个静态资源通过，`stable@52f7c601` 未触碰。
- 历史任务和新建 APImart `deepseek-v4-flash` 流式任务均在刷新后恢复精确 `projectId + taskId`；新任务刷新前已真实流出标记和正文，刷新后部分正文与单一重试入口保留。
- 服务器权威快照严格为 1 条用户消息、1 条助手消息，助手 `status=failed`、`retryable=true`；Console error/warning 与原生弹窗均为 0。Gemini 通道的 `get_channel_failed` 作为供应商对照保留，不计作产品刷新缺陷。
- **当前状态：V588-CHAT-002-BUG-003 已云端关闭 / V588-CHAT-002 整项仍为部分通过。** 下一步仍先关闭联网模式与 Deep Research 单 Artifact，不得跳到 `V588-CHAT-003`；第三方 exactly-once 不作无证据承诺。

## 2026-08-26 V588-CHAT-002 联网重试与 Artifact 检查点

- 联网模式已用 Google Chrome 对 APImart `deepseek-v4-flash` 完成真实离线失败和在线原位重试：同一消息、同一模型配对、`webSearch=true`、同一幂等键、单一 HTTP 200 请求和单一完成消息均有证据，联网子项关闭。
- Deep Research 同场完成后服务器已有单一 `completed` 助手消息，但 Artifacts 面板为 0，确认当前线局部状态与消息持久状态断开。该缺陷按 RED -> 最小接入修复为消息级单一 Artifact，没有吸收 donor 会话、同步或原始 URL 桥接。
- `main@90772d42` 已推送；目标 `19/19`、全仓 `3536` 项已执行测试、TypeScript、ESLint `0 errors / 967 historical warnings` 和 Next.js 生产构建通过。`stable@52f7c601` 与只读 V5.8.8 donor 未改动。
- **当前状态：联网模式已关闭 / Deep Research Artifact 本地候选通过、Coze 待验。** 沙箱当前返回 `instance_not_found`；恢复后唯一动作是部署 `90772d42` 并验证刷新前后单一 Artifact。完成前不进入 `V588-CHAT-003`，也不重复已关闭的刷新恢复或联网重试。

## 2026-08-26 V588-CHAT-002 Deep Research Artifact 云端关闭检查点

- Coze `main-fix@1572a222` 精确包含运行时修复 `90772d42`；构建退出码 0，5001 健康检查 HTTP 200，`stable@52f7c601` 与 V5.8.8 donor 均未触碰。
- APImart `deepseek-v4-flash` 研究任务 `11tvkeffmt9jnh88` 完成后，刷新前后 UI 与服务器都严格保持一个稳定 Artifact；助手消息状态为 `completed`，消息与 Artifact 均无重复，Console error/warning 与原生弹窗为 0。
- 保护门禁仅登记 4 个已审源码的精确路径与来源提交，来源测试 `7/7`、特征门禁 `38/38`、警告 0；没有目录级授权。
- **当前状态：V588-CHAT-002 已吸收。** 下一唯一吸收项为 `V588-CHAT-003`，继续执行 RED -> 最小接入 -> 全量回归 -> Coze 云端验证；不重复已关闭的 V588-CHAT-002 子项。

## 2026-08-27 V588-CHAT-003 本地候选检查点

- 任务分支基于 `9e05cf0881d0d64af4ba96311837885ac77b3c33`，最终复审修复后的本地实现候选为 `5663441a30c279d5a696235020dae5d47cc0703d`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 donor `J:\无界云端0820` 均未修改。
- 修复前阶段完整门禁：全仓 Vitest `3906 passed / 118 skipped / 0 failed`，API `765 passed / 3 skipped / 0 failed`，回归 `2887 passed / 10 skipped / 0 failed`；Next.js 构建完成 `116` 个静态页面/路由。跳过项不计为通过。
- 最终复审后的聚焦合同为 `13/13`；Playwright 仅完成五项目发现，共 `70` 项（`chromium`、`chromium-1080p`、`firefox`、`webkit`、`mobile-chromium` 各 `14` 项），没有把发现数量写成浏览器执行通过。保护基线 `38/38`、TypeScript 与目标 ESLint 通过。
- 全分支终审随后发现 1 个 Critical 旧服务端存储键迁移缺陷：新 helper 曾使用新命名空间，导致历史 `data_key='chat_simple_projects'` 行不可见。修复提交 `5663441a` 保留历史数据键、保留按用户 advisory lock，并让旧数组 revision `0` 在原行升级为 revision `1`。
- 修复专项先得到 RED `2 failed / 10 passed`，GREEN 后服务端单元 `12/12`、Simple Chat API `28/28`、`ts-check`、目标 ESLint、保护基线 `38/38` 与 `git diff --check` 通过。PostgreSQL 迁移和并发测试因缺少 `POSTGRES_TEST_DATABASE_URL` 为 `2/2 skipped`，不计为通过。
- 窄范围复审结论为 Ready to merge: Yes，Critical/Important/Minor `0/0/0`。
- **当前状态：本地候选完成 / 云端待验 / 未吸收。** 真实浏览器矩阵、跨账号隔离、PostgreSQL 迁移与并发均为 `UNVERIFIED`；Coze 尚未拉取并运行该精确候选，也没有云端业务或证据文件。全平台继续为有条件通过，云端矩阵全部通过前不得进入 `V588-CHAT-004`。

## 2026-08-27 V588-CHAT-003 Coze 构建检查点

- Coze 对齐 `origin/main@e64edbbe` 后，根目录遗留 `worktrees/main-fix` 被 `**/*.ts` 重复扫描，生产构建在 TypeScript 阶段失败；该缺陷属于当前线部署边界，不是 donor 功能吸收项。
- `11abb548` 只增加两类工作树目录的 Git/TypeScript/ESLint 隔离和永久契约测试，未修改 Simple Chat 业务逻辑、数据库、供应商、积分、`stable` 或 donor。
- 本地门禁：目标 `6/6`、全仓 `3909 passed / 119 skipped / 0 failed`、TypeScript、零错误 Lint、保护门禁 `38/38`、嵌套夹具生产构建 `116/116`；独立复审无阻断项。
- **当前状态：构建修复本地完成 / GitHub 与 Coze 待复验 / V588-CHAT-003 仍未吸收。** 云端构建和业务矩阵关闭前不得进入 `V588-CHAT-004`。

## 2026-08-27 V588-CHAT-003 Coze 构建关闭与目标重定锚

- `origin/main@48c2ad3fd262d933ac08ab18f389e320e192d634` 已由 Coze 重新对齐；无关的嵌套 `worktrees/main-fix` 在保留备份分支后从当前升级沙箱移除，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未改动。
- Coze 生产构建退出码为 `0`，Build ID 为 `8Iztiwokck9HEnxplOf78`；`/`、`/simple-chat`、`/api/auth/me` 与 HTML 引用的 `12` 个静态资源均返回 HTTP `200`，PostgreSQL 配置存在。
- Coze 会在对话操作后生成仅含平台元数据的本地提交；本轮本地 `HEAD` 虽显示为 `f65dcfd6`，但 `HEAD^{tree}` 与 `origin/main^{tree}` 一致。后续同步固定使用 `git fetch origin main` 后受控 `git reset --hard origin/main`，禁止用 `git pull --ff-only` 判断源码污染，也禁止 `git clean` 删除运行数据。
- **阶段边界已重新确认：Stage 4 于 2026-08-21 验收、能力目录专项于 2026-08-25 关闭，不再重复执行。当前唯一进行项为 `V588-CHAT-003` 云端业务矩阵；构建阻断已关闭，但项目/任务 CRUD、刷新恢复、冲突、删除不复活、账号隔离、退出冲刷和 PostgreSQL 最终快照仍未全部取证，因此本项仍为未吸收。**

## 2026-08-27 V588-CHAT-003 首轮业务矩阵与仪表盘计数修复

- Google Chrome 已证明专用项目/任务创建、项目与任务重命名、普通 APImart 对话、助手唯一完成标记、`已同步`、刷新后精确 `projectId + taskId` 恢复和任务名称持久化；Console error/warning 与原生弹窗均为 0。
- 同轮真实发现 `V588-CHAT-003-BUG-001`：工作台初始侧栏显示“智能对话 0”，进入页签后才加载并显示真实 `2` 个项目。根因是仪表盘把聊天项目加载错误绑定到页签激活。
- 按 RED -> 最小修复新增双产品用户初始徽标合同；聚焦 `10/10`、Simple Chat 同步 `348/348`、全仓 `3910 passed / 119 skipped / 0 failed`、TypeScript、零错误 Lint、保护门禁 `38/38` 与构建 `116/116` 通过。
- `b92998dafd289a433232eb72cddacef32a53ea28` 部署后，Google Chrome 在未点击聊天页签前已直接显示“智能对话 2”，进入页签后仍为 `2` 个项目，Console 与原生弹窗均为 0；`V588-CHAT-003-BUG-001` 云端关闭。
- 同一专用任务深链恢复后，历史标记唯一且状态为“已同步”；点击“工作台”只经过当前 Simple Chat 和最终仪表盘，没有绕回登录页或无限画布。该证据不覆盖未同步写入离页冲刷。
- **当前状态：普通对话、刷新恢复、重命名、仪表盘初始计数、已同步任务深链恢复和返回工作台路径云端通过；删除不复活、多标签冲突、跨账号隔离、未同步离页冲刷和 PostgreSQL 并发仍未关闭。`V588-CHAT-003` 保持未吸收。**

## 2026-08-27 V588-CHAT-003 PostgreSQL 本地闭环检查点

- 一次性 PostgreSQL 18.4 全新库首次完整回归为 `558/570` 文件通过、`3935/4029` 测试通过、`87` 失败、`7` 跳过，稳定暴露认证增量迁移缺少核心用户表前置迁移；第二个隔离 schema 同时暴露核心表初始化 Promise 未按数据库 URL 隔离。
- `f923b98fd51088c68ad2390052634f2d013fbdc6` 仅追加 `20260809_wj_core_users.sql`、按数据库 URL 绑定初始化缓存，并修正过期的 PostgreSQL 测试前置/能力夹具；已发布的 `20260823` 迁移、生产 Agent 授权、供应商、积分和 `stable` 均未改动。
- 迁移相关专项 `12 files / 97 tests` 通过；最终带真实 PostgreSQL 的全仓 `570/570` 文件、`4030/4030` 测试通过，失败和跳过均为 `0`。Doctor、TypeScript、零错误 Lint、生产构建 `116/116`、保护基线 `38/38` 与空白检查通过。
- **当前状态：V588-CHAT-003 的本地 PostgreSQL 阻塞已关闭；整项仍未吸收。** 下一步只做 GitHub `main` 推送、Coze 精确 SHA 冷启动和既有项目恢复复验；删除不复活、未同步离页、多标签和跨账号边界继续保留。Stage 4 不重做，`stable` 不触碰。

## 2026-08-27 V588-CHAT-003 Coze 精确 SHA 冷启动检查点

- Coze 已精确运行 `main@4793f602161d389eaf28bd8ecbc98ddbeb8df7d8`，受控迁移、生产构建和 5000 启动通过；Build ID `ff5BAPW-3ycPVraxauIYN`，三个健康路由及 11 个静态资源全部 200，`stable@52f7c601` 未动。
- Google Chrome 现有标签页刷新后恢复专用项目和精确任务；历史标记严格 1 次、模型与“已同步”正确，仪表盘首次显示 `智能对话 2`。首次返回工作台出现一次同步 502 警告，后续恢复未复现且数据完整，作为观察项保留。
- **当前状态：本地 PostgreSQL与 Coze 冷启动/恢复通过，V588-CHAT-003 仍未完全吸收。** 下一步只关闭专用测试数据的删除不复活与未同步离页冲刷；多标签和跨账号受当前环境约束继续 `UNVERIFIED`，不重复 Stage 4，也不进入 `V588-CHAT-004`。

## 2026-08-27 V588-CHAT-003 删除/离页关闭与布局修复检查点

- 专用空任务删除后，经刷新、返回工作台和重新进入项目均未复活；专用项目任务数稳定从 2 降为 1。删除不复活已云端关闭。
- 唯一用户标记提交后立即离页，重进时先“正在同步”后“已同步”，再次刷新仍严格 1 条；未同步用户写入的离页冲刷已云端关闭。助手生成未续跑，作为独立未验证边界保留。
- 同轮真实发现当前线布局缺陷：关闭的图像模型列表仍贡献约 2415px 高度，使 Simple Chat 根容器自动滚动 518px，造成侧栏、顶部栏和历史消息看似消失。该问题不是数据丢失，也不是 V5.8.8 donor 功能偏移。
- 按 RED -> 最小修复只把两个关闭菜单改为 `hidden`；聚焦 `5/5`、Simple Chat `493/493`、全仓已执行项 `3912/3912`、TypeScript、零错误 Lint、构建 `116/116`、保护门禁 `38/38` 通过。
- `main@483ee0ce` 已在 Coze 完成构建和启动；Chrome 强制刷新后页面根容器 `clientHeight=scrollHeight=863`、`scrollTop=0`，输入框聚焦不再偏移。关闭菜单高度为 0，两个打开菜单仍正确覆盖对话，图像菜单内部滚动有效。
- **当前状态：页面完整性缺陷已云端关闭，V588-CHAT-003 仍未吸收。** 下一步只处理既有的多标签、跨账号和离页后助手任务续跑边界；不重复删除、离页用户写入或布局测试，不进入 `V588-CHAT-004`，`stable` 不触碰。

## 2026-08-27 V588-CHAT-003 最终云端吸收闭环

- 原始设计将“重构聊天生成、供应商调用或计费链路”列为非目标；既有确定性重试设计也明确拒绝在本项引入数据库聊天任务队列。因此，普通流式对话离页中断后的合法终态是同一助手消息收敛为 `failed + retryable`，不是无依据扩张为后台续跑。
- Google Chrome 中的标记 `V588_CHAT_003_PAGEHIDE_20260827_C` 刷新后仍严格保留 1 条，助手消息显示唯一“上次请求中断，可重试”和 1 个重试按钮，同步状态为“已同步”。该边界与本地 `recoverInterruptedSimpleChatProjects` 永久回归一致。
- 未创建新标签页。复用现有预览标签和 Coze 项目标签，从同一服务器版本同时在项目 `ocw2ssbvmtb987wq` 新增两个任务；冲突重放后，两标签刷新均得到初始任务加两个新任务，共 `3` 个任务。
- 随后两标签同时把同一任务分别改为 `V588-TASK-CONFLICT-A` 与 `V588-TASK-CONFLICT-B`。服务器保留 `V588-TASK-CONFLICT-B`，并生成 `V588-TASK-CONFLICT-A（冲突副本）`；两标签刷新后均得到完全一致的 `4` 个任务和“已同步”状态。
- 在同一预览标签从普通用户 `canvas-user` 退出并登录真实管理员 `Mr.joker`；管理员侧只显示自己的 1 个默认项目，普通用户的 `V588-CHAT-003-CLOUD-20260827` 与 `V588-CHAT-003-MULTITAB-20260827` 均为 0 次可见，证明浏览器缓存与服务器数据没有跨账号串入。
- 两个业务标签的应用 Console error/warning 均为 `0/0`；没有原生错误弹窗。Coze 项目标签完成双标签测试后已恢复到原项目页。`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- **状态：V588-CHAT-003 已吸收。** 机器证据：`docs/testing/evidence/v588-chat-003-final-cloud-matrix-2026-08-27.json`；截图：`v588-chat-003-multitab-conflict-cloud-2026-08-27.png`、`v588-chat-003-cross-account-isolation-cloud-2026-08-27.png` 及既有中断恢复截图。下一唯一项为 `V588-CHAT-004`，必须重新从 RED 开始，不得重复 Stage 4 或已关闭的 CHAT-003。

## 2026-08-27 V588-CHAT-004 首轮 Coze 云端验收

- Coze 已精确运行 `main@3f0564429ae100448d17343b5d18ccf58b933e9d`；Google Chrome 复用既有项目页和预览页完成构建、重启与验收，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 纯文本到空工作流、托管图片到空工作流、同一用户跨项目、向已有“智能对话导入”工作流追加、重复消费、刷新恢复、节点/画布来源追踪及既有“添加到画布”链路均通过；已执行流程没有 Console error/warning，完成后的导航 URL 不含原始媒体地址。
- 畸形 `chatMessageId` 未触发工作区交接或素材转移请求，已有工作流未变化。
- 已额外建立“新工作流、2 节点、1 连线、80%”受控基线；转交后为 4 节点、1 连线、80%，名称和原节点不变，刷新后完全保持。已有连线/视图边界关闭。
- 普通测试账号 `canvas-user` 已真实登录并创建自有项目；文本消息转交后得到 1 节点、0 连线。相同账号向管理员项目发起真实云端交接 API，返回 HTTP 403 与 `FORBIDDEN`，未读取或写入管理员项目。
- 仍未取得 URL-only 未托管历史媒体的完整云端证据。
- **当前状态：本地候选完成 / 云端部分通过 / 未吸收。** 机器证据：`docs/testing/evidence/v588-chat-004-cloud-matrix-partial-2026-08-27.json`。下一步只关闭 URL-only 剩余边界，不重复已通过矩阵，不进入下一 V5.8.8 吸收项。

## 2026-08-27 V588-CHAT-004 URL-only 边界关闭

- 通过正式 `/api/user-data/sync` 版本化 CAS 接口建立单一旧格式历史样本，内容包含非托管 `.invalid` 图片 URL 且不包含 `imageRefs`；没有直接修改数据库，也没有使用 Mock。
- Google Chrome 用户1真实打开该消息：“添加到画布”入口禁用并显示“历史图片或登记失败的图片不可转移”；“发送到节点模式”可用且只增加一个 `input-text` 节点。目标项目从 1 个文本节点变为 2 个文本节点，画布图片保持 0，工作流与项目持久化内容均不含该外部 URL。
- `/api/simple-chat/workspace-handoff` 返回 HTTP 200、`images=[]`、`UNMANAGED_IMAGE_SKIPPED`，响应不含外部 URL；解析器只查询当前用户的 AssetVersion 与 Placement，不存在远程图片下载调用。
- 相同消息重复转交并刷新后仍为 2 节点、0 图片；测试对话项目已通过当前 revision 的 CAS 写入删除，复查剩余数量为 0。
- **状态：V588-CHAT-004 已吸收 / Coze Google Chrome 云端验证通过。** 最终机器矩阵：`docs/testing/evidence/v588-chat-004-final-cloud-matrix-2026-08-27.json`，URL-only 明细：`docs/testing/evidence/v588-chat-004-url-only-cloud-2026-08-27.json`。下一项必须按清单顺序重新从 RED 开始，不重复 Stage 4、CHAT-003 或 CHAT-004。

## 2026-08-28 V588-STABILITY-002 本地终审检查点

- 当前候选基于 `origin/main@7cb6e2fbae59c6a0a141ec3a3510fc29a486de6b`，只在隔离分支实现；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 和只读 V5.8.8 donor 未修改。
- PSD 分析已收敛到受控媒体、用户授权 VLM、严格输出、持久幂等、租约接管和数据库条件终态。请求截止后的延迟入账、退款与晚到租约由 Next.js `after()` 托管，结算重试有 JavaScript 尝试上限和仅 PSD 启用的 PostgreSQL 锁/语句超时，不改变其他工具的共享账务行为。
- 最终专项 `131/131`，全仓 `565` 个文件、`4068` 项测试通过；`21` 个文件、`119` 项 PostgreSQL 相关测试因缺少隔离库明确跳过。TypeScript、目标文件零警告 ESLint、全仓 `0 errors`、生产构建 `117/117` 和 `git diff --check` 通过。
- 八轮独立复审最终无 Critical/Important。该结论仅证明本地候选，不证明真实 PostgreSQL 并发、Coze 精确 SHA、PearAPI/APIMART 调用、一次扣费/退款或最终 PSD 文件。
- **状态：本地候选完成 / 云端待验 / 未吸收。** 下一步只能先推送 `main` 并关闭 `UNVERIFIED_ITEMS.md` 中的数据库与云端矩阵；完成前不得进入 `V588-ADMIN-004`，不得重复 Stage 4，绝不触碰 `stable`。

## 2026-08-28 V588-STABILITY-002 图片预览入口检查点

- Coze `main@4c7dc72d` 的真实 Google Chrome 复现表明，首次选中图片触发 DOM 目标重渲染，旧 `MouseEvent.detail` 双击判断只完成选择，未打开图片预览，因而阻断后续 Pro/Studio PSD 验收。
- 按 RED -> 最小修复新增同图/时间/距离序列 helper，并把识别边界移动到完整 pointer-up；聚焦 `16/16`、全仓 `4071/4071` 已执行项、TypeScript、零错误 Lint 和 `117/117` 构建通过。
- 修复已推送为 `main@6bea240f34dcbd3176ab1e63a8ccb43d32a54797`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 未改动。
- **状态：本地已关闭 / Coze UI 待验 / V588-STABILITY-002 仍未吸收。** Chrome 页面控制恢复后，唯一动作是 Coze 精确对齐 `6bea240f` 并验证双击预览；完成前不进入 `V588-ADMIN-004`，也不重复已关闭的 Simple Chat 或 Stage 4 历史矩阵。

## 2026-08-28 V588-STABILITY-002 图片预览入口云端关闭

- Coze 已运行包含 `6bea240f` 修复的 `main@2e1e21e2856e91e6bf1ed1af83aed68610d35c8c`，代码树为 `9647c2951b8d128e3cdd20d29b5202472bbd29f7`；生产构建、启动、健康路由与静态资源此前已通过，`stable@52f7c601` 未改动。
- Google Chrome 在项目 `project_1787549625844_nfmso3ts9` 加载 1 张真实图片，原始尺寸 `3504 x 2336`。单击只进入选中态；双击一次打开且只打开 1 个图片预览；关闭后预览数量归零。真实拖动 `24 x 16px` 未误开预览，随后 `Ctrl+Z` 精确恢复原坐标。
- 预览中 `PSD` 按钮可见且当前实现明确调用 `downloadPSD(..., 'pro')`。专项规格明确“不调整 PSD 导出 UI”，因此不把缺少单独的 Studio 按钮误报为本项缺陷；Studio 继续由既有 PSD 编辑器导出模式承担。
- 全程 Console error/warning 为 `0/0`，无原生错误弹窗。证据为 `docs/testing/evidence/v588-stability-002-image-preview-cloud-2026-08-28.json` 与同名 PNG。
- **当前状态：图片预览入口云端已关闭 / V588-STABILITY-002 仍未吸收。** 真实付费 Pro PSD、同键重放、一次扣费/退款及 PostgreSQL 并发终态仍未验证；下一步不得进入 `V588-ADMIN-004`。

## 2026-08-28 V588-STABILITY-002 PostgreSQL 并发与账务本地关闭

- 在全新 loopback PostgreSQL 18.4 隔离库 `wujie_psd_stability` 中新增 PSD 专项并发测试。两个相同请求并发时复用同一 `taskId`、只调用一次执行器并只扣费一次；相同幂等键对应不同规范化摘要时明确冲突。
- `completed / failed / timeout / cancelled` 并发竞争只允许一个数据库终态获胜；迟到完成与迟到失败均被拒绝，退款最多一次，余额与最终终态一致。该测试已加入 `.github/workflows/quality.yml` 的 PostgreSQL 质量任务，避免后续只在开发机执行。
- 聚焦 PostgreSQL 与 PSD 关联矩阵 `11 files / 92 tests` 全部通过；启用全部数据库变量后的全仓结果为 `587/587 files`、`4193/4193 tests`，失败和跳过均为 `0`。TypeScript 与零错误 ESLint 通过。
- 默认约 4 GiB Node 堆的本地生产构建在 webpack 编译阶段 OOM；以 `NODE_OPTIONS=--max-old-space-size=8192` 复验后完成编译、TypeScript、`117/117` 静态页面和构建追踪。此资源风险保留，不把 8 GiB 结果误写为默认堆通过。
- **当前状态：真实 PostgreSQL 并发/终态/退款门禁已在本地关闭，V588-STABILITY-002 仍未吸收。** 云端 Pro PSD 已停在真实付费按钮前，未扣积分；仍需动作时确认后验证供应商、任务身份、一次扣费、同键重放、失败退款及最终文件。机器证据：`docs/testing/evidence/v588-stability-002-postgres-local-2026-08-28.json`。

## 2026-08-28 V588-STABILITY-002 ac8e826b 云端部署检查点

- `main@ac8e826b34f91649c47cefd504d9d6664ee12eb8` 已推送并在 Coze 精确对齐；`HEAD`/`origin/main` tree 均为 `b05448edae7126ac0833c28f2ee552c9c200c320`。 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 未修改。
- Coze 构建退出码 `0`，Build ID `VALgz1-sdVe-tiy5Jz8yU`，单一 5000 服务 PID `4372`；`/`、`/simple-chat`、`/api/auth/me` 与 11 个静态资源全部成功。
- Google Chrome“用户1”复用现有标签强制刷新后恢复节点模式与画布；真实图片可双击打开预览，`PSD` 按钮可见。元素拆解“可编辑图层”只作探索，不作为本项付费验收入口。服务重启窗口的同步 502 已在后续连续同步成功中恢复。
- 真实付费按钮尚未点击，因此 Pear 任务、Range ZIP 下载、主 PSD 提取、远程图层、一次扣费、同键重放和失败一次退款仍为 `UNVERIFIED`。
- **状态：部署前缀已通过 / V588-STABILITY-002 仍未吸收。** 取得付费动作时确认后只关闭上述剩余矩阵；完成前不进入 `V588-ADMIN-004`，不重复 Stage 4 其他已关闭项目。证据：`docs/testing/evidence/v588-stability-002-ac8e826b-cloud-deploy-2026-08-28.json`。

## 2026-08-28 V588-STABILITY-002 真实付费失败回退检查点

- 已在 Google Chrome 真实点击 Pro PSD，应用任务 `layer_bde7c937-ecdb-4fee-b901-54c834aeb1f0` 与 Pear 任务 `6bbcd3f8-1d11-41be-8866-40fba1bfb479` 建立成功；没有旧版同步阻塞或浏览器超时。
- Pear 本次在产出制品前返回“任务处理失败，请稍后重试”，`remoteArtifactUrl=null`，所以 `ac8e826b` 的 Range ZIP 下载补丁没有被真实调用，不能据此判定补丁失败或通过。
- 本地智能回退完成并下载可解析 PSD；账务唯一扣除 15 分并唯一退回 15 分，净变化 0。失败回退与退款子项关闭。
- **V588-STABILITY-002 继续未吸收。** 仍需真实 Pear ZIP 成功、主 PSD 提取、远程可编辑图层、同键重放与显式取消退款；完成前不进入 `V588-ADMIN-004`。`stable` 和只读 V5.8.8 donor 均未触碰。

## 2026-08-28 V588-STABILITY-002 Pear 失败可观测性检查点

- 对照 Pear 官方图片编辑与任务查询文档后，当前 `image-layered` 请求的 `/v1/images/edits`、`image`、非空 `prompt`、`task_type=async`、`response_format=url` 及 `/v1/images/tasks/{id}` 均与官方契约一致；没有证据支持通过改接口或重复提交规避本次供应商失败。
- 发现独立可观测性缺陷：轮询适配器只保留 `error.message`，丢弃官方响应中的 `error.code/type/param`；智能本地回退完成时又会覆盖回退诊断，导致供应商故障与应用故障难以精确区分。
- 已按 TDD 最小修复：结构化字段经过长度约束后写入 `providerError`，同时保留兼容的文本错误；智能回退原子退款和最终本地完成均保留 `providerError + fallbackReason`。没有修改供应商请求、计费价格、退款条件或任务终态转换。
- 聚焦分层矩阵 `55/55`，全仓非 PostgreSQL `566 files / 4099 passed / 122 skipped / 0 failed`，TypeScript 与 ESLint 通过；默认约 4 GiB 堆构建 OOM，8 GiB 堆完成 `117/117` 页面生产构建。
- **状态：失败诊断本地已关闭 / V588-STABILITY-002 仍未吸收。** 推送并部署新 `main` 后可在下一次自然供应商失败中直接读取结构化错误；真实 ZIP Range、主 PSD、远程图层、同键重放和显式取消退款仍维持 `UNVERIFIED`，不得因此进入 `V588-ADMIN-004`。

## 2026-08-28 V588-STABILITY-002 ca356477 云端部署检查点

- Coze 已精确运行 `main@ca3564779685be52f1dc13b8f0106f27095647f9`，`HEAD` 与 `origin/main` 的 tree 均为 `2e6030b31c1b1a4399275bf51919daa28b0eae53`；工作区干净。`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 和只读 V5.8.8 donor 均未修改。
- Pear 失败诊断与分层并发两组非付费专项共 `23/23` 通过，没有触发真实供应商任务。生产构建退出码 `0`，Build ID `xzK65dcSQKxZk2kJiNVk0`，单一 5000 服务 PID `4260`；`/`、`/simple-chat`、`/api/auth/me` 与 `11/11` 静态资源成功。
- Google Chrome“用户1”复用既有项目页和预览页，未新建标签。强制刷新后已登录节点项目恢复，工作流工具栏可见；以 `2026-08-28T12:19:48.127Z` 为界的新页面日志中 Console error/warning 为 `0/0`。服务重启窗口曾出现项目同步 502，随后同步成功，干净刷新后未复现。
- **状态：失败诊断候选已部署并通过非付费云端门禁 / V588-STABILITY-002 仍未吸收。** 下一次自然 Pear 失败才可验证真实 `providerError`；远程 ZIP Range、主 PSD、远程图层、同键重放和显式取消退款仍为 `UNVERIFIED`，不得进入 `V588-ADMIN-004`。
- 证据：`docs/testing/evidence/v588-stability-002-ca356477-cloud-deploy-2026-08-28.json`、`docs/testing/evidence/v588-stability-002-ca356477-cloud-refresh-2026-08-28.png`。

## 2026-08-28 V588-STABILITY-002 云端同键重放关闭

- 在已登录 Google Chrome 现有预览标签内，以历史任务的原始请求摘要和幂等键重放 `POST /api/layered-decompose`。接口返回 HTTP `202`，直接复用应用任务 `layer_bde7c937-ecdb-4fee-b901-54c834aeb1f0` 及其既有 `completed/ready` 结果，没有等待新供应商任务。
- 重放前后只读 PostgreSQL 审计一致：同用户同键任务数始终为 `1`，余额始终为 `403`；唯一扣费流水仍为 `ctx_1787915813431_ze8j8rz3`，唯一退款流水仍为 `ctx_1787915898711_4upz06jc`，Pear 远端任务仍为 `6bbcd3f8-1d11-41be-8866-40fba1bfb479`。
- **状态：云端同键重放子项已关闭 / V588-STABILITY-002 仍未吸收。** 远程 ZIP Range、非 `_depth` 主 PSD、远程可编辑图层、真实结构化自然失败及显式取消退款仍未关闭；不得进入 `V588-ADMIN-004`。
- 机器证据：`docs/testing/evidence/v588-stability-002-ca356477-idempotency-replay-2026-08-28.json`。`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 未修改。

## 2026-08-28 V588-STABILITY-002 方案 C 本地检查点

- 方案 C 实现提交：`a50fcbeb73803b9886bab2ec82327c1e8f5bb209`。修复任务提交响应前取消/关闭的注册竞态，并冻结同一幂等键对应的最终请求目标，包括“云端目标”和“智能模式空目标”。
- 取消、关闭、外部卸载统一复用一次操作级状态与取消 Promise；已注册任务执行精确 DELETE，取消成功后停止轮询，失败与终态竞争保留真实状态。
- 本地最终门禁：分层矩阵 `168 passed / 2 skipped`，全仓 `4117 passed / 122 PostgreSQL-gated skipped / 0 failed`，TypeScript、零错误 ESLint、空白检查和 8 GiB `117/117` 生产构建通过；独立复审 Critical 0、Important 0。
- 并行 Range 三部分已经是当前 main 的祖先，不重复合并。`V588-PROVIDER-002/003` 必须重基到最新 main 后再评估；`V588-COLLAB-004` 与 `V588-ADMIN-004` 缺少前置和真实环境证据，本轮不合并。
- **状态：方案 C 本地关闭 / V588-STABILITY-002 仍未吸收。** 下一唯一动作是推送 main、Coze exact-SHA 拉取，并在 Google Chrome 真实验证取消、关闭、账务和迟到终态；不开始 ADMIN-004。

## 2026-08-29 V588-STABILITY-002 Pear 五层成功与 BUG-008 修复检查点

- Coze 精确运行 `main@940a0b7fdabd9327b75d3b8963c5eee4ec3b0f8c`，生产构建、启动、三个健康路由及 `11/11` 静态资源通过；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 与只读 V5.8.8 donor 未修改。
- 经用户明确授权 15 积分，在既有 Google Chrome 标签对 `/api/serve-upload/uploads/gen-1786507598285-t9qt60.png` 只提交一次 `Pear / Image-Layered / cloud`。UI 从 `processing · 5%` 进入 `completed · 100%`，PSD 编辑器自动打开。
- 编辑器真实显示 `reconstruction/correction`、`元素 2`、`元素 1`、`主体`、`背景` 共 5 层；主体和背景可独立选择，主体显隐可独立切换。隐藏整图校正层后，底层仍能重建杯子画面，证明远程 ZIP、非 `_depth` 主 PSD 和质量门禁已形成可用的远程分层结果，而不是单一整图伪分层。
- 同轮发现 `V588-STABILITY-002-BUG-008`：任务完成后元素拆解浮层无法关闭并遮挡 PSD 编辑器。按 RED -> 最小修复将浮层可见性收敛到 `showDisplayDecomposePanel`，保留任务对象供进度、重试、取消与 PSD 初始结果使用；聚焦分层矩阵 `64/64` 通过。
- 修复已随 `main@2be6eff7d65a90a4b07aefff24a5f9b36db7e294` 推送。完整本地门禁为 `572` 个测试文件、`4154` 项通过、`122` 项本轮 PostgreSQL 环境门禁明确跳过、`0` 失败；TypeScript、ESLint `0 errors / 961 historical warnings`、8 GiB 生产构建及 `117/117` 静态页面通过。
- **状态：远程 Pear 成功路径已关闭，V588-STABILITY-002 仍为有条件未吸收。** 下一唯一动作是让 Coze 精确拉取 `2be6eff7`，在现有 Google Chrome 标签验证完成浮层可关闭且任务结果不丢失；随后完成真实图层移动/保存/刷新、PSD 导出文件 `8BPS`/图层校验，并以只读数据库证据确认该成功任务恰好扣除一次 15 积分、无退款且记录应用 taskId。以上关闭前不开始 `V588-ADMIN-004`，不重复 Stage 4 或已通过的 Pear 任务。
- 机器证据：`docs/testing/evidence/v588-stability-002-940a0b7f-cloud-deploy-2026-08-29.json`。

## 2026-08-29 V588-STABILITY-002 云端审计纠正检查点

- 管理员“云端任务监控”只读响应确认，先前声称成功的应用任务实际为 `layer_be958ed4-b5d4-4afa-865d-f960a4fd8c85`，远端任务为 `18659220-883d-45ce-aa59-cee9d356e2ff`；最终状态 `failed`、阶段 `checking-quality`、错误 `LAYER_QUALITY_FAILED`，唯一扣费 `ctx_1787931983358_3f21y708` 已由唯一退款 `ctx_1787932271727_2h0c8apc` 抵消。
- 真实 ZIP 可下载，包含主 PSD `Image-Layered_00002.psd` 和 `_depth.psd`；主 PSD `8BPS` 可解析且包含 6 个像素图层。因此 ZIP MIME、安全下载、解压和主 PSD 选择不是本次失败点。
- 离线使用生产提取、精修和质量门禁复现：源图 `3504x2336`，Pear PSD 画布 `1280x1280`，重建 MAE `0.7853434784673393`、得分 `21`，正确触发 `RECONSTRUCTION_ERROR_HIGH`。Pear 当前文档的 Image-Layered 示例仅要求 `model + image`，没有证据证明可强制保持原尺寸；不得通过放宽门禁把变形结果标为完整还原。
- 同时确认前端状态污染：全局关闭 PSD 编辑器未清空 `psdEditorInitialResult`，从另一张图片直接打开“编辑元素”也会沿用旧分层结果。RED 后仅在这两个边界清空旧结果，专项 `8/8` 转绿。
- **状态：撤销“远程 Pear 成功路径已关闭”的结论。** V588-STABILITY-002 继续未吸收；下一步是完成本地全量门禁、推送 `main`、Coze 精确部署并验证旧结果不串用。新的付费 Pear 成功测试必须使用可证明保持尺寸/比例的输入或先取得供应商能力说明，不能重复消费积分碰运气。
- 机器证据：`docs/testing/evidence/v588-stability-002-pear-audit-correction-2026-08-29.json`。

## 2026-08-29 V588-STABILITY-002 `90231c70` 云端回归检查点

- Coze 精确运行 `main@90231c70f7dacca43eb5e8ccd688c8204d12f3fe`、tree `a6dbe58d477112b7f2d0df205892efb0b34b428e`、Build ID `6-RXcDf1VQ8054PNXPhF5`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- Google Chrome 真实图片入口证明 BUG-009 已关闭：单图项目先复验，随后在 7 图项目依次从 `3504 x 2336` 蓝色杯子切换到 `1254 x 1254` 紫色立方体；两次打开“编辑元素”都只显示“选择分层引擎 / 开始分层”，旧图层计数为 `0`。Console error/warning `0/0`，无原生弹窗，且没有供应商调用或积分变化。
- 管理员只读任务接口确认数据库已有完成父任务，但刷新后的 UI 不会自动恢复父任务为当前面板状态；空面板关闭不能替代 BUG-008 完成态验收。管理员只读定价显示 Pear `Image-Layered` 和 Pear `gpt-image-2` 当前均为 `60` 积分/图。
- **状态：BUG-009 云端关闭；BUG-008 继续未验证；V588-STABILITY-002 仍未整体吸收。** 下一步只关闭完成态面板显隐门禁，完成前不进入 `V588-ADMIN-004`，不重复 Stage 4。

## 2026-08-29 V588-STABILITY-002 `805e695d` BUG-008 关闭检查点

- Coze `HEAD=origin/main=805e695d9a621bf1b1f6505cd28e5818416c573b`，tree `2d1fdf737d2e201dc63e56af763a2d1f7af2d1c2`，Build ID `tRbCDehbN-Px9OoY0qHRH`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 现有 Google Chrome 标签真实执行零积分“可编辑图层”：`completed · 100%`，PSD 编辑器显示 `主体/背景` 两层；关闭元素面板后编辑器保持，关闭编辑器后重开元素面板仍保留完成状态。BUG-008 云端关闭。
- 同轮新增 `V588-STABILITY-002-BUG-010`：重开后的完成态面板被画布媒体遮挡。Coze 全量测试另有 2 项域名环境断言失败，均保留为开放项。
- **状态：BUG-008 已关闭；V588-STABILITY-002 仍未吸收。** 下一步先关闭 BUG-010 和 Coze 域名测试合同，再继续远程 Pear 成功、编辑/保存/导出与账务矩阵；仍不进入 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 BUG-010 本地修复检查点

- 已用失败测试确认元素拆解面板被挂在画布 `overflow-clip` 层叠上下文内，随后最小改为 `createPortal(..., document.body)`；任务、供应商、图层和账务代码未改。
- 元素拆解专项 `46/46`，全量 `4157` 项通过、`122` 项 PostgreSQL 专项明确跳过、`0` 失败；TypeScript、Lint 与生产构建通过。
- **状态：本地候选修复完成，尚未计为吸收。** 下一步推送精确 SHA，由 Coze 拉取后在既有 Google Chrome 标签完成无遮挡视觉回归，再处理域名测试合同和远程 Pear 矩阵；不进入 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 BUG-010 云端关闭检查点

- Coze 已精确运行 `main@b0eefdf4`，tree `85358ca4`，Build ID `72AxKgi4YmnIHZAbqBwoJ`；专项 `46/46`、TypeScript、Lint、构建和健康检查通过，`stable` 未触碰。
- Google Chrome 三轮证据确认元素拆解面板初始态、完成态和完成态重开均完整无遮挡；`completed · 100%`、PSD 两层和编辑器独立关闭行为保留。
- **BUG-010 已云端关闭，V588-STABILITY-002 仍未整体吸收。** 下一步只处理 Coze 域名测试合同与远程 Pear/账务矩阵，完成前不进入 `V588-ADMIN-004`，不重复已关闭的 Stage 4 工作。

## 2026-08-29 V588-STABILITY-002 Coze 域名测试合同本地关闭

- 在进程外注入 `COZE_PROJECT_DOMAIN_DEFAULT=preview.example.dev.coze.site` 后稳定复现 `auth-login-configuration` 的 3 项重定向断言失败；实际响应使用配置的公开域名，登录路由行为正确，根因是测试继承宿主部署环境。
- 测试 `beforeEach` 现显式清空该变量，专用公网域名用例继续单独注入并验证 HTTPS 重定向；同一注入环境下由 `3 failed / 34 passed` 恢复为 `37/37`。
- 全量 Vitest `4157` 项通过、`122` 项 PostgreSQL 专项明确跳过，TypeScript、Lint、`git diff --check` 通过。生产构建在本机 4 GB 堆上限 OOM，8 GB 重试持续占用约 7.74 GB 后为避免系统失稳人工终止，不计为构建通过。
- **状态：域名测试合同本地关闭、Coze 原生环境复验待执行；V588-STABILITY-002 仍未整体吸收。** 后续仅剩 Coze 测试确认与远程 Pear 编辑/保存/导出及账务矩阵，不进入 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 Coze 域名测试合同云端关闭

- Coze 已精确对齐 `HEAD=origin/main=4d0ee0d7178a7d8c1326e1834fe4d62ee86326d5`，tree `d4bddd7e2f61decb4b1279fcaa80489ff6e11328`；`origin/stable=52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- Coze 原生公开域名环境下 `auth-login-configuration` 为 `37/37`，TypeScript、Lint、8 GB 生产构建、`/`、`/simple-chat`、`/api/auth/me` 与 `11/11` 静态资源全部通过；Build ID `aSKtExrAPjz-iBkM5RZmg`。
- 现有 Google Chrome“用户1”预览标签强制刷新后 `document.readyState=complete`，入口内容完整显示。
- **状态：Coze 域名测试合同已关闭；V588-STABILITY-002 仍未整体吸收。** 下一步仅执行 Pear 远程完成态、图层编辑/保存/刷新、PSD 导出与成功/失败/取消账务矩阵，不进入 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 元素拆解 Pear 精确目标路由检查点

- 云端只读模型目录已确认当前用户获授权的分层目标为 `providerId=api_1785190544435_1heimk6`、`modelId=Image-Layered`，协议为 `pearapi-layer`，执行模式为异步，输出类型包含 ZIP 与 PSD。
- 稳定根因是元素拆解父请求仅传递物料板的图像 provider/model，没有为 `layers` 分支解析并传递上述 Pear 精确目标；因此“可编辑图层”会稳定落到 smart 本地回退，并出现 `No exact Pear provider/model was selected`，不能据此判断 Pear ZIP 链路通过或失败。
- `main@2166f0321265eeeb2aed7985084ca5a090e43a7a` 已按 TDD 最小接入：父请求提交前从 `/api/workflow/models?type=layer` 解析当前用户获授权的 `Image-Layered`；显式目标保持不变，`board`/`local` 不查询，smart 模式目录短暂故障仍保留本地回退，cloud 模式与取消错误继续失败关闭。
- 本地门禁：聚焦 Pear/分层 10 文件 `98/98`；全仓 `572` 文件、`4159` 项通过、`122` 项因本轮缺少隔离 PostgreSQL 测试库明确跳过、`0` 失败；TypeScript 与构建版 Lint 通过。12 GiB Node 堆下生产构建完成，webpack 编译 `16.9` 分钟、TypeScript 通过、静态页面 `117/117`，Build ID `BEGTUtSa2MLS18fd4_yW6`；默认/8 GiB 资源边界仍保留为部署容量风险。
- **状态：精确目标路由本地关闭 / 云端未吸收。** 下一步只让 Coze 精确拉取本提交并验证请求体、异步阶段、ZIP/主 PSD、远程图层编辑/保存/刷新、PSD 导出及账务矩阵；完成前不进入 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 干净 main 来源追溯检查点

- Coze 精确运行 `89c2f12c` 时，专项 `96/96`、TypeScript、Lint、生产构建、三个健康端点和 `11/11` 静态资源均通过；全量测试唯一失败来自受保护来源授权引用了干净 `main` 不包含的侧分支提交。
- `128ec13b` 仅修复测试与授权来源元数据：30 条来源改为 `main` 祖先链上的等价提交，并新增来源必须从 `HEAD` 可追溯的永久门禁；没有修改任何业务功能、管理员配置、数据库或账务逻辑。
- 本地聚焦门禁 `7/7`，全仓 `4159` 项通过、`122` 项 PostgreSQL 专项明确跳过、`0` 失败，TypeScript 与构建版 Lint 通过。
- `check:protected-baseline` 仍阻止 41 个既有未授权业务文件，保持发布阻断；不得把本次来源可达修复解释成这些业务漂移已获准。
- **状态：BUG-012 本地关闭 / 云端待验；V588-STABILITY-002 仍未整体吸收。** 下一步先完成 Coze 干净检出零失败回归，再继续 Pear 远程与账务闭环；不进入 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 保护基线精确授权检查点

- 在来源提交已可从 `main` 追溯后，独立 `check:protected-baseline` 仍准确识别 41 个历史生产源码漂移；本轮没有绕过脚本，而是逐文件完成来源与内容核验。
- `main@bf8d86230f6a4fc41c3ed788f633aa3ab5ed1b6f` 为 41 个路径建立精确授权：来源提交均在 `HEAD` 祖先链，均修改对应路径，且来源 blob 与当前 blob 相同；验证 `41/41`、失败 `0`。
- 本地聚焦门禁 `16/16`，保护基线未授权漂移 `0`、警告 `0`；全仓 `4160` 项通过、`122` 项 PostgreSQL 专项明确跳过、`0` 失败，TypeScript 与构建版 Lint 通过。业务源码与 `stable` 均未修改。
- **状态：BUG-012/013 本地关闭 / Coze 最终提交待验；V588-STABILITY-002 仍未整体吸收。** 下一步只做 Coze 干净检出全量回归、生产构建和健康检查，随后继续 Pear 远程与账务闭环；不进入 `V588-ADMIN-004`。

### 最终本地构建证据

精确提交 `51a313717df4edb30dc4758b78c476242b7667cf` 已完成 12 GiB 堆生产构建，webpack `14.0` 分钟、TypeScript `65` 秒、静态页面 `117/117`、Build ID `I9uo73xu5yg9CivYsHhRj`、退出码 `0`。下一动作不变：Coze 干净检出并复跑相同门禁；不得跳到 `V588-ADMIN-004`。

## 2026-08-29 V588-STABILITY-002 干净 main 云端关闭检查点

- Coze 已精确运行 `main@c3bfc8123c956b186d0b61beb0bbdc72e92ee673`、tree `b3180959aa35518c013f67409b94339b8619d1a3`，`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 聚焦测试 `16/16`、保护基线 `0` 未授权/`0` 警告、TypeScript/Lint、全量 `572 files / 4160 passed / 0 failed / 22 skipped files`、生产构建、5000 单实例、三个健康端点和 `11/11` 静态资源均通过。
- Google Chrome“用户1”复用既有标签，稳定态二次刷新后完整工作台加载，Console `error/warning=0/0`，无原生弹窗；没有新建标签或发起付费任务。
- **BUG-012/013 已云端关闭，V588-STABILITY-002 仍未整体吸收。** 下一项继续 Pear 远程图层编辑/保存/刷新、PSD 导出及账务矩阵；不进入 `V588-ADMIN-004`，不重复已关闭的保护基线工作。

## 2026-08-29 V588-STABILITY-002 子门禁拆分

`V588-STABILITY-002` 是一组发布验收条件，不再作为单一 Bug 反复开启。后续按以下子门禁独立关闭；已经关闭的子门禁不得因为其他子门禁失败而重做。

| 子门禁 | 验收范围 | 当前状态 | 关闭证据 / 唯一下一动作 |
|---|---|---|---|
| `002-A` | 干净 `main`、来源追溯、保护基线、全量测试、生产构建、Coze 健康检查 | **已关闭** | `main@c3bfc812` 云端全量 `4160 passed / 0 failed`、生产构建及健康路由通过；后续提交只需执行增量回归，不再重做历史来源授权 |
| `002-B` | Pear 精确 provider/model、异步任务、ZIP 安全下载、主 PSD 提取、质量合格的远程成功终态 | **部分通过** | 异步、ZIP、主 PSD `8BPS` 与 6 个像素图层已有真实证据；尚需使用自然 1:1 原图取得一次 `completed` 远程终态，禁止放宽质量门禁 |
| `002-C` | 图层选择、显隐、移动、保存、刷新恢复、PSD 导出 | **核心云端门禁已关闭** | Coze 运行 `8cd07e1f`；Google Chrome 已验证 5 层文档移动、排序、显隐、锁定、重命名、导出模式、关闭重开、整页刷新恢复，并导出可由 `ag-psd` 解析的 `8BPS` PSD。该证据来自明确披露的本地 fallback，不替代 `002-B` 的 Pear 远程质量或 `002-D` 的成功账务证据 |
| `002-D` | 成功任务账务一致性 | **未关闭** | 只读核对同一应用 taskId、唯一扣费流水、当前定价、余额变化和无退款；不得以 UI 文案代替管理员任务与积分流水 |
| `002-E` | 失败/取消、迟到终态、一次退款和 PostgreSQL 多实例并发 | **部分通过** | 临时隔离 PostgreSQL 18 已完成 4 文件/5 项真实并发用例；仍需云端失败与取消各一次的任务级证据，迟到完成不得覆盖 `failed/cancelled/timeout` |

执行顺序固定为 `002-B -> 002-C -> 002-D -> 002-E`。`002-A` 永久关闭；在 `002-B` 完成前不得启动新的付费失败/取消实验，也不得进入 `V588-ADMIN-004`。

本轮早期只读预检曾把页面执行超时暂记为浏览器控制/沙箱阻塞；恢复连接后确认真实原因是浏览器只读执行环境不提供 `fetch/XMLHttpRequest`，直接 API 导航又被客户端策略拦截。现有 Google Chrome 页面和云端 UI 实际可交互，该早期现象不得登记为 Pear、ZIP、PSD、账务或沙箱失败。

### `002-E` 本地 PostgreSQL 并发证据

- 在不修改本机既有 PostgreSQL 服务认证配置的前提下，于临时目录启动隔离 PostgreSQL `18.4`、独立端口和独立 `wujie_test` 数据库；测试结束后已正常停止临时实例。
- `task-billing-concurrency`、`task-state-postgres`、`task-entry-rollback-postgres` 与 `layered-decompose-postgres-concurrency` 共 `4/4` 文件、`5/5` 用例通过，退出码 `0`。
- 已证明：20 路相同幂等请求只创建一个任务、只扣费一次；失败/取消/超时竞争只允许一个终态和一次退款；8 路迟到完成全部被拒绝；积分账户并发删除时任务不会被错误标记为已退款。
- 机器证据：`docs/testing/evidence/v588-stability-002e-postgres-concurrency-2026-08-29.json`。这关闭了 `002-E` 的本地数据库部分，不替代云端真实供应商失败/取消与账务流水验证。

### `002-C` 图层编辑持久化审计

- `PsdLayerEditor` 的 `layers`、选择、位移和显隐状态均为组件内 `useState`；关闭编辑器会清空 `psdEditorInitialResult`，没有项目级保存回调或服务端编辑状态写入。
- 现有 `dual-element-decomposition.spec.ts` 已验证选择、显隐、移动和导出，也验证父任务及分支 taskId 刷新后可查询，但没有断言用户编辑后的图层几何与显隐状态在刷新后恢复。
- 因此不得把“任务刷新可恢复”写成“图层编辑刷新可恢复”。`002-C` 需要先建立项目/源版本绑定的编辑状态合同，再按失败测试、最小接入、全量回归、云端验证执行。

### `002-B/002-D` 云端付费前预检

- Google Chrome“用户1”现有预览标签已恢复可交互；管理员积分页显示当前余额 `403`，模型计费页显示 `pear分层 / Image-Layered / 60 积分每张`。
- API 管理确认 `pear分层` 已启用，类型为“图片分层模型”，基础地址为 `https://api.pearapi.ai`，唯一启用模型为 `Image Layered / Image-Layered`。
- 云端任务监控刷新后可见的最近元素拆解与图层任务均为 `completed` 的 legacy/零积分任务，没有正在运行的同类任务。
- 当前画布已选中自然 `800 x 800` 紫色立方体，元素拆解面板已切换到“可编辑图层”；生成按钮尚未点击，未调用供应商、未扣积分。
- 源图已进一步锁定为受控媒体 `/api/serve-upload/uploads/gen-1786870726496-j7ht8e.png`；源图可见，提交按钮可见且可用。证据明确区分云端运行提交 `c3bfc812` 与后续仅修改文档的 `main` 提交。
- 机器证据：`docs/testing/evidence/v588-stability-002bd-paid-preflight-2026-08-29.json`。下一动作必须取得本次 `60` 积分的动作时确认后，才允许提交一次。

## 2026-08-29 V588-STABILITY-002 唯一付费任务与根因拆分检查点

- 经明确授权只提交一次 `Pear / Image-Layered`：应用任务 `layer_a328d329-ebcb-45f1-8098-53ff27b5a139`，Pear 任务 `5b395ce3-37fb-4eab-b968-586a8db367e0`。真实 ZIP 已通过安全下载、主 PSD 提取与解析，关闭“沙箱不能解压 ZIP/解析 PSD”的疑点。
- 源图为 `1254x1254`，PSD 为 `1280x1280 / 29` 层。直接比较造成越界率 `1`，归一到 PSD 坐标后越界率为 `0`；但 MAE 仍为 `0.7125`、重复率 `0.8621`，图层名为人物部件，与紫色立方体不符，因此远程制品仍必须被质量门禁拒绝。
- smart 模式交付本地 `背景/主体` 两层，并产生唯一 `-15` 与唯一 `+15`，余额 `403 -> 388 -> 403`、净积分 `0`。这证明失败退款，不证明 Pear 远程成功或成功不退款账务。
- 同轮确认管理员预检错误显示 60，而权威任务按 `OTHER_OPERATION_CREDITS.segment=15` 结算。`main@2c25af5937b0c69e91e55d15291378edbb7901ac` 已按 TDD 最小修复计价目录与同宽高比坐标归一，质量阈值未改变。
- 本地门禁：聚焦 `7 files / 58 tests`、全仓 `572 files / 4163 passed / 122 PostgreSQL-gated skipped / 0 failed`、TypeScript、ESLint `0 error / 961 warnings`；受保护计价路由采用单文件精确来源授权，门禁 `8/8`、未授权漂移 `0`、警告 `0`。
- `002-C` 的数据库图层文档持久化仅完成规格 `docs/superpowers/specs/2026-08-29-layer-document-persistence-design.md`，尚未实施。**当前状态：应用侧坐标与计价本地修复，Coze 待验证；Pear 远程成功、smart 回退提示、图层保存/刷新与 PSD 导出仍开放，不进入 `V588-ADMIN-004`。**

## 2026-08-29 V588-STABILITY-002 坐标与计价云端关闭检查点

- Coze 已精确运行 `main@c79cd0fea3003d5c97f92957de577fcf41d89b7c`、tree `69d703a6329839bb5bd4b272ce505b2b7a70b931`，12 GiB 构建 Build ID `wj8pRWQN7qQibcQoiHsXy`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- 云端专项 `70/70`、保护基线 `0/0`、TypeScript、Lint、5000 单实例、三个健康端点和 `11/11` 静态资源通过。
- Google Chrome 管理员模型计费表真实显示 `pear分层 / Image-Layered / 每次 / 15`，因此 BUG-014 云端关闭；同提交的坐标归一专项通过，因此 BUG-007 的应用侧越界误报云端关闭。
- 本轮没有创建第二个付费 Pear 任务。历史 29 层错误制品仍因高 MAE、高重复率和素材语义不匹配而失败；不降低质量阈值，不把本地 fallback 当作远程成功。
- 稳定刷新有 1 条 `[Sync] syncToServer: server returned 502` warning，保留为独立项目同步可靠性观察。`V588-STABILITY-002` 整体仍开放，下一顺序不变：先解决 smart 回退披露，再实施已批准的图层文档持久化，随后用合适素材验证远程成功/保存/导出与成功账务。

## 2026-08-29 V588-STABILITY-002 smart 回退披露本地关闭检查点

- 根因不是 Pear ZIP 或 PSD 解析，而是元素拆解父任务投影丢失子任务持久化的 `creditStatus/fallbackReason/providerError`，前端只能看到笼统的 `completed`。
- 已按批准规格 `docs/superpowers/specs/2026-08-29-v588-stability-002-fallback-disclosure-design.md` 实施：分层响应返回真实账务状态，父分支完整透传，重试清除旧诊断；UI 仅在 `engine=local + fallbackReason + creditStatus=refunded` 同时成立时显示“Pear 云端分层未完成，已退款并使用本地分层”。该中性文案适用于质量拒绝、供应商超时等回退原因，不虚构具体根因，详细诊断保留在提示标题中。
- RED 为 `2 failed / 27 passed`；初次 GREEN 为 `29/29`。两轮独立复核继续发现旧版终态兼容、非质量失败误报、重试提示绕过、历史读取可推进子任务、拆解板重试漏披露和保护脚本大输出假通过等缺口，均先补 RED 再最小修复。最终聚焦 `3 files / 41 tests`；扩展 Pear/ZIP/PSD、元素拆解、编辑器与保护门禁矩阵 `30 files / 227 tests` 通过。
- 历史 `completed` 父任务仅在 `creditStatus` 缺失时通过纯存储快照读取既有终态子任务，并在本次响应中投影退款/回退证据；不领取 worker lease、不推进子任务、不回写不可变终态。子任务过期或仍在处理时保留原完成结果。不重新提交 Pear、不创建新任务、不重复扣费。全仓 `572 files / 4171 passed / 122 PostgreSQL-gated skipped / 0 failed`；TypeScript、完整 Lint `0 errors / 961 historical warnings` 与构建版 Lint通过。12 GiB 构建 webpack `9.9` 分钟、TypeScript `45` 秒、静态页面 `117/117`、Build ID `ZJo5NS6MxxuKE1ppzZHNq`。保护脚本已修复 1 MiB 输出溢出假通过，当前含既有工具产物的脏工作树会诚实阻断，提交后的干净检出门禁单独记录。
- 未降低任何质量阈值，未改变扣费退款状态机，未新建付费任务。**状态：BUG-015 本地关闭 / Coze 待验；V588-STABILITY-002 仍开放。下一项仍是已批准的 `002-C` 图层文档持久化，云端验收后再进入，不重复已关闭的计价、坐标或 Stage 4 工作。**

## 2026-08-29 V588-STABILITY-002 `002-C` 图层文档持久化本地关闭

- 已新增按 `userId + projectId + sourceImageId + sourceVersionId + taskId` 绑定的独立 PostgreSQL 图层文档；同任务幂等创建，PATCH 使用 revision CAS，跨用户、跨项目、旧版本和伪造任务均拒绝。
- 编辑器持久化移动、显隐、锁定、重命名、顺序和导出模式；保存中发生的新编辑会串行追赶，来源切换隔离旧请求，创建/恢复失败保留 dirty，409 只允许显式选择服务器版本或基于最新 revision 重试。
- 关闭、外部画布面板切换、页面隐藏和导出均先 flush；导出读取最终保存 refs。所有 POST/PATCH 使用 keepalive，请求体上限收紧为 60 KiB，卸载补偿处理 rejection。
- 元素拆解重试只使用冻结的项目、源版本、canonical URL 和最终 taskId，不回退到当前选图或当前项目。
- 隔离 PostgreSQL 18 CAS `1/1`、分层专项 `94/94`、全仓 `600 files / 4348 tests / 0 skipped`、TypeScript、Lint、118 页构建和干净保护基线 `38/38 / 0 drift / 0 warnings` 通过；独立终审 `APPROVED`，0 Critical / 0 Important / 0 Minor。
- **状态：`002-C` 本地关闭、Coze/Chrome 待验；`V588-STABILITY-002` 整体仍开放。** 不进入 `V588-ADMIN-004`，不重复已关闭的 Stage 4、计价、坐标或 smart 披露工作。证据：`docs/testing/evidence/v588-stability-002-layer-documents-local-2026-08-29.json`。

## 2026-08-29 `002-C` 云端部分验收与 Pear 合同纠正

- Coze 已精确运行 `main@18adea660eaccc66797a17cbbef9a0f1ac45da3c`，专项、保护基线、TypeScript、Lint、生产构建、5000 单实例、三个健康端点和静态资源均通过；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。
- Google Chrome 对蓝色杯子提交一次 smart 分层，Pear 远程结果未通过质量门禁并已退款，界面明确显示“Pear 云端分层未完成，已退款并使用本地分层”。这证明异步提交、失败披露、退款回退及本地图层编辑入口可用，不证明 Pear 远程成功。
- 同一本地回退图层文档已真实完成重命名为“元素 1-云端持久化验收”、隐藏、锁定，并多次显示“已保存”。`002-C` 的创建/更新已取得云端证据；移动、排序、导出模式、关闭重开、整页刷新恢复及 PSD `8BPS` 导出仍未验证。
- Pear 当前 Image-Layered 专页明确写明“只需传图，无需 prompt 与任何其他参数”，请求示例只有 `model + image`。`main@9e4d945e` 按 RED -> GREEN 移除 8 月 6 日旧通用 Schema 引入的 `prompt: "."`，保留异步和 URL 制品字段；聚焦分层矩阵 `85/85`、TypeScript、精确 Lint 与保护基线通过。
- `9e4d945e` 后新鲜全仓回归为 `4225 passed / 123 PostgreSQL-gated skipped / 0 failed`，完整 Lint 为 `0 errors / 961 historical warnings`；默认 4 GiB Node 堆构建 OOM，8 GiB 堆下生产构建与 `118/118` 静态页面通过。该结果允许进入 Coze 候选验收，但不能替代隔离 PostgreSQL 零跳过门禁。
- **状态：`002-C` 云端部分通过，不能关闭；`002-B` 仍受远程制品质量阻塞。** 浏览器标签控制超时单独记录为验收工具阻塞，不改写产品结论，不进入 `V588-ADMIN-004`。证据：`docs/testing/evidence/v588-stability-002-18adea-layer-documents-cloud-partial-2026-08-29.json`。

## 2026-08-30 `002-C` 图层文档与 PSD 导出云端关闭检查点

- Coze 业务运行代码为 `8cd07e1fcc00b93d683783318148ea54f5cd3827`。首次观察到旧拖动行为时，服务器已返回 `webpack-5a113952c3414a17.js`，现有 Chrome 标签仍运行旧 `webpack-a832e364079383cd.js`；使用同一标签页执行真实重载后切换到当前资源，因此旧包结果不计为新代码回归。
- Google Chrome 从图片工具栏重新打开同一 5 层文档，侧栏选择“元素 2”后在重叠区域拖动，只有该层从 `589,416` 移至 `745,520`，`reconstruction/correction` 保持 `0,0`；测试位移随后还原并保存，整页刷新后坐标仍一致。`V588-STABILITY-002-BUG-019` 云端关闭。
- 图层顺序和导出模式分别临时改为新顺序与 `pro`，关闭重开后准确恢复；还原原顺序与 `studio` 后再次整页刷新仍保持最终值。图层移动、排序、显隐、锁定、重命名、导出模式、自动保存、关闭重开与刷新恢复均已取得云端证据。
- 最终文件 `图片_studio_edited.psd` 为 `14,089,648` 字节，签名 `8BPS`，SHA-256 `6264C9B75597CD437732CFC339AE28DEEB36467851F52BB9766075187B3379E0`；`ag-psd` 解析为 `3504x2336` 与 5 个编辑图层，顺序及关键坐标与保存文档一致。
- 本轮没有新建供应商任务或执行付费操作。该文档来自界面已明确披露的本地 fallback，因此只关闭 `002-C` 核心云端门禁；不证明 `002-B` 的 Pear 远程质量成功、`002-D` 的一次扣费零退款，也不替代 `002-E` 的云端失败/取消账务矩阵。完成态父任务卡“打开编辑器”仍保留为独立云端补证项。
- 证据：`docs/testing/evidence/v588-stability-002-8cd07e1f-psd-selected-layer-cloud-2026-08-30.json`、`docs/testing/evidence/v588-stability-002-8cd07e1f-layer-document-export-cloud-2026-08-30.json` 及同名 PNG。后续文档提交 `af2132de`、`1dab4e3f` 不改变上述运行时代码。

**当前唯一顺序：** `002-B` Pear 远程质量成功 -> `002-D` 同一成功任务一次扣费且零退款 -> 完成态任务卡入口补证 -> `002-E` 云端失败/取消账务矩阵。上述门禁关闭前不进入 `V588-ADMIN-004`，已经关闭的 `002-A`、`002-C` 与 Stage 4 不得重复执行。

## 2026-08-30 完成态任务卡父任务水合本地关闭检查点

- 刷新后卡片丢失的根因已定位为父任务缺少 `projectId` 和前端只持有 React 内存状态；不是图层文档、Pear ZIP 或 PSD 解析回退。
- 当前实现持久化新父任务项目身份，并以用户 + 项目 + `element-decompose-parent` 精确查询恢复；旧任务只在 `project_id` 为空且 `result.request.projectId` 精确匹配时兼容。稳定排序和 `LIMIT 1` 避免全局 500 条扫描遗漏。
- 项目切换、新提交与卸载会中止恢复并提升请求代次，迟到响应不能覆盖新任务或写入其他项目。恢复只读，不提交供应商、不创建任务、不产生账务。
- 首轮审查的 3 项 Important 与 1 项 Minor 均补 RED 后关闭，终审 APPROVED。聚焦 `175/175`、全仓 `4244 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、零错误 ESLint、干净候选保护基线和生产构建 `118/118` 通过。
- **状态：本地关闭、Coze 非付费验收待执行。** 当前顺序不变：`002-B -> 002-D -> 完成态任务卡云端补证 -> 002-E`；本地卡片水合不得重复实施，也不进入 `V588-ADMIN-004`。

## 2026-08-30 完成态父任务水合云端关闭检查点

- Coze 业务 tree 已精确对齐 `origin/main@3b47dfb75d1b1413d7691306c6ae700d9e39f4c4` 的 `eeabd8124a4580e1a5548e79d31cfc544d58bec0`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。专项 `151/151`、全量 `4244 passed / 123 skipped / 0 failed`、保护基线 `0/0`、TypeScript、Lint、生产构建和健康端点通过。
- 既有 Google Chrome 标签真实重载后，选择 `canvas image / 3504x2336` 并打开元素拆解，历史父任务卡恢复为 `completed · 100%`，显示实际本地引擎、退款回退说明和“打开编辑器”。
- 首次及再次整页重载后的“打开编辑器”均恢复同一 5 层文档、同一 `3504x2336` 来源和历史重命名“元素 1-云端持久化验收”；二次打开先出现正常的“正在恢复 / 0 层”中间态，约 6 秒后稳定为 5 层和“已保存”。Console 新增 error/warning 为 `0/0`。
- 云端只读数据库审计确认窗口内新建元素拆解父任务 `0`、积分流水 `0`、扣费 `0`、退款 `0`；原有 6 个父任务均早于窗口且为 `completed / credit_status=not-applicable / credit_cost=0`。服务日志不记录 path/method，因此 HTTP 方法本身标记为“日志不可直接验证”，不虚构网络证据；零新任务与零账务证明恢复没有业务副作用。
- **BUG-018 完成态父任务水合已云端关闭。** `V588-STABILITY-002` 仍为有条件通过；后续唯一顺序更新为 `002-B -> 002-D -> 002-E`，不再重复 `002-C`、完成态卡片或 Stage 4，也不进入 `V588-ADMIN-004`。证据：`docs/testing/evidence/v588-stability-002-3b47dfb7-completed-parent-cloud-2026-08-30.json`。

## 2026-08-30 `5f6e84b1` Pear 三组真实制品审计检查点

- Coze、本地与 GitHub `main` 精确一致为 `5f6e84b11d08e462805292f07c76c2c772fb0edf`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未触碰。聚焦 `138/138`、全仓 `4245 passed / 123 PostgreSQL-gated skipped / 0 failed`、TypeScript、构建版 Lint、保护基线与生产构建均通过。
- 三个真实 Pear 任务均按异步模式返回 ZIP；无界成功经过安全下载、非 depth 主 PSD 选择、`8BPS` 校验、PSD 解析和质量门禁。由此确认沙箱可以下载 ZIP、解压并解析 PSD，旧“沙箱能力不足”假设正式撤销。
- 两次青绿色圆环任务分别返回仅含 `front hair` 的单层 PSD，或缺少真实透明主体；橙色锥体任务返回仅含 `topwear` 的单层 PSD。三组制品都与源图语义不匹配或重建误差过高，均被现有质量门禁拒绝，未降低任何阈值。
- smart 回退均交付本地结果并退款。前两组取得精确流水：每组恰好一笔 `-15` 与一笔 `+15`，余额 `403 -> 388 -> 403`；第三组也确认一扣一退、净额 `0`。这关闭失败退款证据，不证明成功任务一次扣费零退款。
- Pear 官方专页确认当前合同为 `POST /v1/images/edits`、`model + image`、异步任务、URL 结果和 `GET /v1/images/tasks/{id}` 轮询；当前适配器合同与文档一致，不通过改端点、改大小写或放宽质量门禁掩盖供应商制品问题。
- **状态：`002-B` 仍为部分通过，`002-D` 仍未关闭，`002-E` 的云端失败退款部分通过、显式取消仍未验证。** 下一动作仅使用官方示例类型的受控肖像再做一次远程质量成功验证；成功前不进入 `V588-ADMIN-004`。证据：`docs/testing/evidence/v588-stability-002-pear-cloud-audit-20260830.json` 与同前缀 PNG。

# 未验证项目

## 2026-07-19 New P0 cloud acceptance required: public media isolation

- `BUG-20260719-038` / `SEC-018` is fixed locally but not yet deployed/accepted.
- Required cloud checks: anonymous requests to `/api/serve-upload/system/users.json` and `/api/serve-upload/system/api-providers.json` return 404 with no file body; signed-in PNG upload succeeds; a generated result persists and reloads; SVG trace/export downloads rather than rendering active SVG.

## 2026-07-19 P1 cloud acceptance required: video source SSRF guard

- `BUG-20260719-039` / `SEC-019` is source-verified only. With an authenticated session, each of `/api/video/download`, `/api/video/tools`, `/api/video/extract-frame`, and `/api/video/extract-frames` must reject loopback and link-local URLs with `400` before work begins.
- A valid provider-hosted video must then complete each applicable product operation, proving that the tightened source policy does not break supported video workflows.

## 2026-07-19 Current authoritative unverified state

### Superseding cloud observation after the latest reported synchronization

- The live logged-in Chrome preview now renders the selected image with `z-[60]`; the previous stale-`z-20` deployment observation is superseded.
- A real destructive interaction still failed: clicking the unique selected-image delete button left the image in place and opened `美陈拆解`. DOM hit testing showed the overlapping selected-image toolbar received the click. This is registered as P1 `BUG-20260719-036` and is fixed only in the current local workspace pending a fresh cloud synchronization.
- The same session logged repeated `[Sync] loadProjectsFromServer: server returned 502` messages. The project may be visible from local state, but server persistence and reopen recovery are not accepted until that API succeeds during the deletion acceptance flow.
- Next cloud acceptance sequence: reload, select the one-image test project, click the new selected-toolbar delete control, verify zero matching image elements and no decompose panel, then reopen the project and verify the deletion persisted.

### New local P1 repair pending deployment

- `BUG-20260719-037` protects `GET /api/recharge/[orderId]` from anonymous and cross-user reads and removes a payment-config write from GET. It requires cloud evidence for anonymous 401, foreign-user 404, owner page success, and administrator order review.

- `BUG-20260719-035` (professional image upscale authorization) is fixed locally. Cloud acceptance must show anonymous `POST /api/image/upscale-pro` rejected before parsing a supplied URL, while an authenticated toolbar upscale can persist a result.

### Latest cloud probe after the reported synchronization

- Source of record is `c702d0125748d894486b3be1e824d4f8a4b10591` (`origin/main`). It contains the selected-image stacking correction from `ec149a3`, whose expected selected-image class is `z-[60]`.
- A new real Chrome inspection of the logged-in Coze preview completed after the reported update. The application is interactive, shows the existing test image, and exposes the image toolbar, `美陈拆解`, and `人物精修大师`; the browser console contained zero error entries.
- The same live DOM still reports the selected image container as `absolute group z-10 z-20`, rather than `z-[60]`. This is an authoritative version mismatch. Do not perform destructive delete acceptance or close BUG-20260719-024 on this preview. The on-screen Chrome capture and DOM probe were recorded on 2026-07-19 Asia/Shanghai.
- Required deployment check: synchronize `c702d01` or a descendant, reload the existing signed-in preview, and confirm the exact `z-[60]` class before executing the selected-image delete plus project-reopen regression.

- `BUG-20260719-033` (P0 export archive authorization) and `BUG-20260719-034` (seven high-cost media/AI routes) are fixed locally but require cloud acceptance. Do not mark the deployment secure until anonymous rejection and normal signed-in use are both verified after synchronization.

- `BUG-20260719-032` is fixed locally in `4901d25`: `POST /api/save-image` now requires verified authentication and all direct server persistence callers use signed internal-request headers. It remains unverified on cloud until anonymous rejection and authenticated image/workflow/video/refinement/upscale persistence are exercised against the synchronized deployment.
- Fresh Chrome check after the reported cloud update still rendered the selected image as `absolute group z-10 z-20`, not the fixed `z-[60]`. The screenshot and console evidence are `test-results/screenshots/cloud-stale-z20-after-update-20260719.png` and `test-results/console/cloud-stale-z20-after-update-20260719.json`. The preview is therefore older than `ec149a3` and cannot be used to accept `4901d25`.

- Local source baseline: `73ccc02 fix: require authentication for uploads` on `origin/main`. Local API regression passes 43 files / 98 assertions; component/library regression and TypeScript checks pass.
- Cloud acceptance is **not current**. In the logged-in Chrome preview, the selected image container still rendered as `absolute group z-10 z-20`; clicking its visible `删除` control opened `美陈拆解`. This proves the preview has not loaded `04927ee` or any later commit, including `73ccc02`.
- `BUG-20260719-024` remains P1 open until the synchronized cloud bundle deletes the selected image without opening `美陈拆解`, and the deletion survives reopening the project.
- `BUG-20260719-025` through `BUG-20260719-031` are fixed locally but require cloud acceptance. They cover recovery, local service startup, SVG tracing, video operations/download, image caching, and file upload authorization.
- `BUG-20260719-032` is fixed locally: `/api/save-image` now requires a verified session or signed internal-request headers, and its direct server-side callers have been migrated. It remains P1 cloud-acceptance pending until anonymous rejection plus authenticated image/workflow/video/refinement/upscale persistence are exercised on the synchronized preview.
- Native file chooser and download-event evidence remain unavailable through the attached Chrome-control channel. They are **unverified**, not passed or failed.
- The release decision remains **not approved**. No historical pass entry below can override this section.

## 2026-07-19 Authentication cloud acceptance completed

- Cloud authentication startup, logout, anonymous-entry isolation, login, and dashboard restoration are now verified on the existing Chrome account at commit `b906a15`.
- Remaining P0 work is independent of authentication: native upload, image generation, terminal task state, save/reload recovery, download, and credits reconciliation still need cloud evidence.
- P2 BUG-20260719-023 requires root-cause investigation; it does not invalidate the completed authentication evidence.

## 2026-07-19 Pending cloud acceptance after BUG-20260719-022

- The local fix is verified in four Playwright browser projects, but the Coze preview has not yet synchronized this revision.
- After synchronization, Chrome must reload the preview and prove that the authentication shell resolves, the login/dashboard is interactive, and a same-origin `/api/session` request occurs.
- Paid P0 flows (upload, generation, task completion, save/reload, download, logout/relogin, and credits) remain unverified until the cloud startup acceptance passes.

## 2026-07-19 Coze Next Flight execution blocker

- **P1 / INFRA-20260719-002:** Cloud preview inserts but does not execute Next Flight inline scripts. Authentication, upload, generation, persistence, download, and logout cannot be truthfully verified until Coze deployment/proxy behavior is corrected.
- **Acceptance prerequisite:** Existing signed-in Chrome must expose `window.__next_f`, React mount markers, a dismissed auth shell, and a real `/api/session` request after reload.

## 2026-07-19 First-commit router isolation

- **P1 / BUG-20260719-021:** The third source-level remediation requires a cloud Chrome reload after synchronization. Passing evidence requires a real `/api/session` request and a dismissed authentication shell.
- **P1 / BUG-20260719-019:** Authorized generation, persistence, and logout/relogin remain paused until the authentication acceptance check passes.

## 2026-07-19 Root-layout hydration isolation

- **P1 / BUG-20260719-021:** The server-rendered root layout has passed local development and production regression but requires a fresh cloud Chrome reload after synchronization. Success requires the authentication shell to disappear and `/api/session` to be requested.
- **P1 / BUG-20260719-019:** Do not rerun the paid generation and logout/relogin persistence check until BUG-20260719-021 passes in cloud Chrome.

## 2026-07-19 Auth-bootstrap cloud acceptance

- **P1 / BUG-20260719-021:** The local small-shell hydration repair is not cloud-verified. Required evidence is a fresh reload of the signed-in Chrome session where `正在验证身份...` disappears, followed by an interactive dashboard or canvas state.
- **P1 / BUG-20260719-019:** Only after the auth-overlay check passes, execute an authorized generation, save/reload, logout, and Chrome-saved-credential relogin. Project and asset counts must remain unchanged after relogin.

## 2026-07-19 Current cloud blocker

- Environment: `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`; commit `1713ab6`.
- Evidence: the first `doctor` probe saw `/api/auth/me` return `502`, but the preview recovered to `200`. In the subsequent logged-in Chrome run, the deployed `1713ab6` bundle loaded, same-origin `/api/session` returned an authenticated user, but the visible `正在验证身份...` overlay remained. The reload trace had no application session request and the document had no React hydration attachment. Screenshot and console evidence are archived as `cloud-p1-auth-overlay-1713ab6-deployment-check-20260719` under `test-results/`.
- Impact: the real logged-in P0 flow cannot be operated in Chrome. Login/session refresh, native upload, canvas operations, paid generation, task terminal state, persistence/reload, download, and logout cannot be marked passed from this environment.
- Required release action: diagnose and restore cloud client hydration, then rerun `doctor` until it has no failed checks and execute the authorized real-browser P0 journey with screenshot, video, trace, console, and network evidence.

- Independent confirmation: unauthenticated Chromium failed the no-write `p0-login-ui-contract` at the first “选择入口” assertion. This run has no credentials and made no business API request; its failure is a real cloud-client regression, not a substitute for the still-required logged-in P0 journey. Archived evidence ID: `20260719-cloud-anonymous-hydration-failure`.

- Control result: the identical test passed against the same local commit on `http://127.0.0.1:5012` in Chromium, Firefox, WebKit, and mobile Chromium (4/4). This local result narrows, but does not resolve, the cloud-only startup failure.

- Environment scope: the reproduced cloud address is a `.dev.coze.site` development preview that runs `next dev`. A separately accessible production deployment using the configured `build` and `start` commands remains unverified.

## 2026-07-18 最新阻塞

- 已登录 Chrome 中 `/api/auth/me` 和 `/api/connector/auth/me` 均稳定被客户端拦截为 `ERR_BLOCKED_BY_CLIENT`；会话 Cookie 仍存在。页面因而持续显示 `正在验证身份...`，底层界面渲染不等于用户可操作。
- 最新云端中页面内 `/api/session` 已确认返回当前登录用户，但认证遮罩仍存在。Chrome 刷新期间没有记录应用自身的会话请求，失败回退又会同步创建本地管理器；本地已把无项目入口的缓存水合及失败会话清理都拆出认证 effect，改为 UI 渲染后的独立 effect。待云端同步并在已登录 Chrome 中确认遮罩关闭、模型列表加载后，才能执行已授权的单次 Lite `1:1`、`x1` 真实生成，验证任务终态、画布结果、保存/刷新恢复和积分流水。

## 2026-07-18 已补充但不替代云端验收的 P0 证据

- 本地匿名入口在 Chromium、Firefox、WebKit 和移动 Chromium 的 Playwright 实测 4/4 通过，证据归档 ID 为 `20260718-local-p0-login-contract`。
- 该结果不包含真实账号、上传、下载、模型或积分，不得用于关闭任何云端 P0/P1 缺陷或改变发布结论。

## 2026-07-18 当前权威状态（优先于下方历史记录）

| 项目 | 风险 | 当前证据与解除条件 |
| --- | --- | --- |
| BUG-20260718-016 认证初始化遮罩 | P1 | 当前云端 `/api/session` 已确认返回已登录用户，但浏览器刷新中没有应用会话请求且失败回退仍会同步创建管理器；本地已把无项目入口的管理器创建、缓存水合和失败清理拆到认证后的独立 effect，待同步。云端刷新后遮罩须关闭、模型列表可加载，且项目同步失败时不应重新阻塞会话。 |
| 云端部署健康 | P1 阻塞 | 2026-07-18 对预览地址执行 `pnpm run doctor -- --url=...`，`/api/auth/me` 返回 `502`，命令退出码 1。须先恢复后端可达性并复跑 doctor 至无失败项，之后才可执行登录、生成与积分真实回归。 |
| BUG-20260718-015 恢复后的真实图像任务远端轮询 | P1 | 云端真实 Lite 任务持续 `processing 10%` 超过 5 分钟。修复已推送 `2e04766`，但尚未同步云端。同步后必须提交一张授权的 `doubao-seedream-5-0-lite` x1 任务，归档生成响应、非终态轮询、终态、画布结果、刷新恢复与积分流水。 |
| BUG-20260718-013 云端轮询节流 | P1 | 同一真实任务在云端同步后，至少归档两次非终态 `/api/poll-task` 时间戳，间隔须遵守当前 800ms 策略；不能用页面看似无卡顿代替网络证据。 |
| 原生文件上传与下载 | P0 验证缺口 | 当前 Chrome 控制通道无法将文件写入原生选择器，也未捕获下载事件；这不是产品失败证据。需用独立 Playwright 浏览器或人工录屏完成上传、下载、项目刷新恢复，并保留 Trace/Network。 |
| 跨浏览器真实核心链路 | P0 验证缺口 | Chromium、Firefox、WebKit、移动 Chromium 已有登录链路证据，但尚未以同一真实项目执行上传、生成、保存恢复、下载。需要有效独立测试凭据与精确模型标识。 |
| 生产依赖安全复扫 | 已完成，残余风险 | `pnpm audit --prod` 当前为 `0 critical / 0 high / 5 moderate / 1 low`，见 `test-results/npm-audit-prod-final-20260718.json`。剩余中低风险必须在正式发布前的干净环境再次复扫。 |

> 下方内容用于保留发现过程与历史证据；若与本节冲突，以本节和最新发布就绪报告为准。

## 2026-07-18 云端后端可用性阻塞

| 项目 | 风险 | 解除条件 |
| --- | --- | --- |
| BUG-20260718-014 管理员供应商/任务数据 | P1 | 云端恢复 `/api/admin/apis`、`/api/admin/cloud-tasks`、项目同步的非 500/502 响应；管理员页面应恢复既有供应商和任务记录，并显示真实发布自检结果。同步本地错误提示修复后，失败场景必须显示错误而非空数据。 |

## 2026-07-18 当前云端待验项

| 项目 | 风险 | 解除条件 |
| --- | --- | --- |
| BUG-20260718-013 的云端轮询节流 | P1 | 同步本次修复后，对一个授权的真实 Lite 任务归档至少两次 `/api/poll-task` 请求时间戳；非终态间隔应遵守当前 800ms 策略，SSE 终态事件可提前结束。 |
| 任务 `async-1784381325092-zkypoi` 的终态与结果归属 | P1 | 在云端任务监控确认 `completed` 或 `failed`；若完成，验证绿色立方体进入创建它的项目、刷新后仍存在；若失败，验证仅退款一次且无结果残留。当前 `processing / 10%` 不能被标记为成功、失败或丢失。 |

## 2026-07-18 云端后端连通性阻塞

| 项目 | 风险 | 解除条件 |
| --- | --- | --- |
| 恢复任务终态、结果保存、失败退款、跨重启取消退款与真实 -6 积分流水 | P1 | 云端 `/api/poll-task` 不再返回 `502 {"detail":"无法连接到后端服务"}` 后，使用当前 Chrome 已登录账号完成同一历史任务终态复验及新的 `doubao-seedream-5-0-lite` x1 真实付费任务。必须归档网络响应、项目刷新恢复和积分流水，不能以 Mock 或 HTTP 200 替代。 |

## 2026-07-18 当前部署阻塞

| 项目 | 风险 | 解除条件 |
| --- | --- | --- |
| BUG-20260718-010 当前已扣费 submitOnly 任务恢复 | P1 | 云端同步包含 `generate-async` 与兼容恢复修复后，刷新或重新轮询任务 `async-1784362294335-88ydio`；必须得到供应商真实结果或明确失败退款，不能再向供应商发送外层 `async-*` ID。 |
| BUG-20260718-009 新任务真实扣费 | P1 | 再提交一张 `doubao-seedream-5-0-lite` x1，确认 `Mr.joker` 余额和总消耗各变化 6，且积分概览出现新的 -6 流水。 |

> P0 图像生成执行时，必须提供精确 `E2E_GENERATION_MODEL=providerId::modelId`。仅填写显示名会被测试拒绝，避免重复标签误选供应商。

## 2026-07-18 新增待验证项

| 项目 | 风险 | 解除条件 |
| --- | --- | --- |
| BUG-20260718-007 云端任务恢复 | P1 | 云端同步本次提交后，以当前 Chrome 已登录账号执行一次真实付费生图；验证不再停在 `submitting 5%`，刷新后结果仍可恢复。 |
| 恢复失败积分补偿 | P1 | 在授权的测试模型上构造供应商可识别失败，核对任务状态、`cloud_tasks.credit_cost`、积分余额和退款流水；不得使用 Mock 代替。 |
| 跨重启取消退款 | P1 | 生成中刷新页面后取消任务，确认按持久化成本仅退款一次。 |
| BUG-20260718-009 `submitOnly` 真实扣费 | P1 | 云端同步本次修复后，使用当前 Chrome 登录账号对 `doubao-seedream-5-0-lite` 提交 1 张真实任务；积分概览须出现新的 -6 消费流水、余额同步下降，任务的 `creditCost` 不得为 0。 |

### 2026-07-18 状态更新：已解除

| 项目 | 状态 | 验证证据 |
| --- | --- | --- |
| BUG-20260718-007 云端任务恢复、完成与项目刷新恢复 | 已验证 | `9026dcc` 云端同步后，Chrome 已登录管理员会话完成真实付费豆包任务；任务完成并在刷新后重开项目时恢复。见 `cloud-p0-generation-*-after-9026dcc-20260718.png` 及对应 Console JSON。 |

## 2026-07-18 已解除的部署阻塞

| 项目 | 状态 | 验证证据 |
| --- | --- | --- |
| 新建普通用户的云端画布登录 | 已验证 | `8248852` 已部署后，以独立账号在 Chromium、Firefox、WebKit 和移动 Chromium 完成登录、刷新保持会话与退出，4/4 通过。 |
| 普通用户会话的 `/api/admin/user-folder` 401 | 已验证 | 同一四浏览器运行的 Console/Network 均无该越权请求或未处理 Console error；归档 ID `20260718-p0-auth-session-cloud-green`。 |

## 2026-07-18 新增阻塞项

| 项目 | 原因 | 风险 | 解除条件 |
| --- | --- | --- | --- |
| 新建普通用户的云端画布登录 | 已在本地以隔离存储修复并回归通过，但云端尚未同步此修复；此前创建的测试用户没有默认产品权限，不能作为部署后默认值的验证对象 | P1 | 云端同步后新建隔离普通用户，使用 Chromium、Firefox、WebKit 和移动 Chromium 验证“登录→刷新保持→退出”；归档截图、录像、Trace、Console 和网络日志 |
| 普通用户会话无 Console 401 | 修复 BUG-005 后的真实跨浏览器回归发现普通用户仍会调用管理员建目录接口；BUG-006 已本地修复，尚未部署 | P1 | 云端同步后以当前隔离账号重新执行四浏览器 `p0-auth-session`，Console 与 Network 不得再出现 `/api/admin/user-folder` 的 401 |

## 2026-07-18 状态更新

| 项目 | 状态 | 原因与解除条件 |
| --- | --- | --- |
| 单次真实图像生成与项目刷新恢复 | 部分验证 | Chrome 已登录云端会话中完成真实任务，生成结果刷新后存在；首轮删除回流异常在第二次隔离复现中未出现，仍需独立浏览器复验。 |
| 图片上传、鼠标拖动、节点工具栏下载 | 部分验证 | 剪贴板粘贴的真实 PNG 已成功保存，鼠标拖动坐标已变化；原生文件选择器和 download event 仍受 Chrome 控制层限制，需独立浏览器或人工录屏复验。 |
| 真实登录、Token 刷新、退出后重新登录 | 部分验证 | 已登录 Chrome 管理员会话刷新页面后仍恢复为 `Mr.joker / 管理员`，并能重新打开隔离项目；当前会话的退出也已验证。历史临时账号仍返回 401，独立账号登录、Token 过期刷新和退出后重新登录仍没有可安全恢复的凭据。 |

| 项目 | 原因 | 风险 | 解除条件 |
| --- | --- | --- | --- |
| P0真实登录/刷新/重新登录 | 已登录管理员会话的普通页面刷新与项目恢复通过；历史临时账号 `admin/admin123` 仍实测返回 `POST /api/auth/login` 401。该证据不能覆盖独立登录→Token 过期刷新→退出后重新登录 | P0 | 提供当前云端有效的独立 `E2E_TEST_USERNAME`、`E2E_TEST_PASSWORD`，并允许使用该测试账号 |
| P0真实图像生成 | 已完成一次真实任务；多数量、参考图、超时等边界组合未在本轮 P0 范围内执行 | P1/P2 | P0关闭后按模型能力矩阵补充真实任务与异常回归 |
| P0真实浏览器上传与下载 | 剪贴板上传已通过；2026-07-18 两次原生上传尝试均在控制通道的 `filechooser.setFiles` 阶段返回 `Not allowed`，未触及业务上传请求。下载按钮已真实点击两次，控制通道均未返回可观察 `download` 事件 | P0 | 用配置好的独立Playwright真实环境或人工录屏执行上传与下载，保留trace/network/截图；不能将当前限制登记为产品缺陷 |
| P0删除后状态持久化 | 首轮隔离项目出现一次回流；第二轮按同序列完成真实生成、返回项目列表与重开项目后，仅保留 256×256 上传图和 2048×2048 生成图，未回流 32×32 已删除图 | P2 / 观察 | 以独立浏览器与凭据至少重复两次；稳定复现后再增加失败回归测试并修复 |
| P0项目保存/刷新恢复 | 生成结果两轮均可恢复；删除状态第二轮通过，但因首轮异常尚未可独立复核 | P0 验证缺口 | 用独立浏览器完成创建、删除、生成、刷新恢复和下载全链路并归档 Trace/Network |
| Firefox/移动Chromium 完整 P0 链路 | 已通过匿名登录入口，但尚未使用真实账号、项目和模型执行上传、生成、保存、下载与退出 | P0 | 提供真实测试环境参数并运行完整套件 |
| WebKit完整 P0 链路 | 已通过匿名登录入口，但尚未使用真实账号、项目和模型执行上传、生成、保存、下载与退出 | P0 | 提供真实测试环境参数并运行完整套件 |
| P1及以下业务模块 | 本轮范围明确限制为P0，未提前执行 | P1/P2 | P0关闭后按功能矩阵逐项执行 |
| 依赖漏洞扫描 | 镜像审计端点不存在，官方审计端点超时 | P1 | 在可信网络/registry恢复后归档 `pnpm audit --prod --json` 结果 |
| 云端匿名工作流拒绝 | 已验证 | 未带凭据的 `POST /api/workflow/execute` 已返回 `401 {"error":"Authentication required"}` | 无需解除；纳入后续全量 API 回归 |
| 退出后的无控制台错误 | 部分验证 | 真实已登录会话退出后归档 Console 未见 `/api/activity` 或 401；但 `DashboardView` key 警告仍在，且尚无独立浏览器 Network trace | P2 / 发布门槛 | 修复 `DashboardView` key 警告，并以独立测试账号完成退出 Network/Console 多浏览器回归 |
## 2026-07-19 Resume Blocker

| Item | Status | Required evidence to clear |
| --- | --- | --- |
| BUG-20260718-016 cloud authentication initialization | P1 blocking | On a fresh cloud preview reload, capture a network request to `/api/session`, disappearance of the auth overlay, and an interactable canvas. |
| P0 image upload, canvas manipulation, paid generation, save/reload, download, logout | Unverified in this run | Run the real logged-in Chrome flow after the authentication overlay is gone, preserving screenshot, trace, console, and network artifacts. |

| Coze production-preview runtime change | Pending cloud verification | Synchronise the `.coze` change, verify the preview reports a production build/server rather than HMR development runtime, then repeat the authenticated entry test. |

| Coze preview dependency bootstrap correction | Pending cloud verification | Sync the corrected `[dev]` lifecycle (`pnpm install --frozen-lockfile` then `pnpm run dev`), verify no `next: not found` startup error, then execute the logged-in P0 entry test. |

| Existing administrator authentication after redeploy | Pending cloud verification | Sync BUG-20260719-017, log in as the existing `Mr.joker` account using the established password, refresh the canvas, and retain the login response plus screenshot/trace evidence. |

### 2026-07-19 GitHub Push Does Not Synchronise Coze Preview

`49684ed` and its two preceding evidence commits were pushed to `origin/main` successfully. A bounded three-minute poll of the preview root continued to return the old development runtime markers (`hmr-client`/`next-devtools`) on every successful `200` response. Evidence: `test-results/console/cloud-preview-runtime-poll-20260719.json`. GitHub push alone is therefore not deployment evidence; Coze-side sync or redeploy is required before any P0 result can be accepted.

### 2026-07-19 User-Reported Cloud Update Recheck

### 2026-07-19 Chrome authenticated-session recheck

- The existing `Mr.joker` administrator account successfully reached the project dashboard, and a page reload retained the authenticated session without a visible login form or persistent authentication overlay.
- The dashboard restored the `视频测试` project card and its `55 张图片` count. Opening that project exposed persisted canvas assets, provider/model metadata, image selection controls, and the canvas zoom/reset controls.
- The Chrome console nevertheless recorded two `loadProjectsFromServer` timeout errors from the Coze Console Bridge during project reload. The application returned to the project dashboard rather than reopening the previously active canvas. Treat this as a recovery-path investigation item; do not classify it as a product defect until reproduced outside the injected-preview bridge context.
- Native file selection remains unverified because the Chrome control channel rejected `fileChooser.setFiles(...)` with `Not allowed` before the application upload request. This is control-channel evidence, not a product-upload failure.
- Evidence: `test-results/screenshots/cloud-auth-session-refresh-20260719.png` and `test-results/console/cloud-auth-session-refresh-20260719.json`.

### 2026-07-19 APImart P0 generation run

- Verified in real Chrome with the exact model value `api_1778430731224_533e09a::doubao-seedream-5-0-lite` displayed by the UI as `豆包5.0Lite · 来自 APImart imgae`.
- One 1:1 generation progressed from `submitting 5%` to `processing 10%` and produced one `800 × 800` canvas image. After a reload, the dashboard counter rose from 13 projects / 183 assets to 14 projects / 184 assets; reopening the new project restored the same prompt, model and image dimensions.
- Browser download was clicked from the selected-image toolbar, but the Chrome control channel did not surface a download event within 15 seconds and emitted no console error. Keep download as unverified until it is repeated in a browser environment with observable download events.
- Native file upload remains unverified for the same control-channel limitation (`fileChooser.setFiles` was blocked before the application request).
- Logout and Chrome-saved-credential relogin succeeded, but the asset count regressed from 184 to 183 while project count remained 14. This is now tracked as P1 `BUG-20260719-019`; it blocks P0 release closure.

### 2026-07-19 persistence follow-up pending cloud verification

- `BUG-20260719-019`: the source fix flushes the final project payload before logout. Repeat generate -> logout -> Chrome-saved-credential relogin and verify that project and asset counters do not change.
- `BUG-20260719-021`: with an account that has no projects, create one project, refresh, and reopen it. This verifies the explicit empty-server-list path outside the mocked regression test.

### 2026-07-19 cloud availability blocker

### 2026-07-19 Post-update recheck

- Authentication entry is no longer the immediate blocker in the active `Mr.joker` session: the infinite canvas is interactive and includes the expected 19 bottom-toolbar entries.
- The cloud P0 generation chain remains **unverified and failed at infrastructure level**: the real APImart request created a `submitting 5%` frame, then received HTTP 502 and produced no canvas asset. Project sync logged the same 502 class.
- Do not treat the recovered UI as deployment acceptance. Repeat generation -> result -> save -> reload -> download only after `/api/generate` and project sync return business responses instead of gateway errors.

### 2026-07-19 Availability recovered; authenticated session required

- Cloud health is no longer blocked by 502: the signed-out health probe to `/api/auth/me` returned HTTP 200 and `doctor` reported no failed checks.
- The active Chrome session reached the `Mr.joker` login form after choosing the canvas entry. The username is present but no password is available to automation, so real paid P0 actions remain intentionally unverified rather than being replaced by anonymous or mocked tests.

### 2026-07-19 latest cloud acceptance blockers

- Selected-image deletion is **failed**, not unverified: the real Chrome click on `删除` opened `美陈拆解` and left the image in place. The deployed DOM shows only the occluded hover delete control; it did not expose the source's direct `selected-image-delete` action. A synchronized deployment plus delete -> reopen-project proof is required.
- Public-media authorization and video SSRF behavior are **unverified** in the latest preview because the Coze backend proxy returned `502` for all three same-origin probes. No inference about the source repair is made from a gateway error.
- Batch video extraction is **unverified** until a signed-in user extracts frames from a persisted uploaded or generated video and opens every returned frame URL.
- The newest signed-in generation attempt also returned HTTP 502 before the provider was contacted. This prevents creation of a test image, so selection, move, resize, delete, persistence, and download cannot be exercised in this cloud run.

### 2026-07-19 production login configuration blocker

- `INFRA-20260719-003` is a confirmed P0 blocker: Chrome submitted the saved `Mr.joker` credentials and `/api/auth/login` returned HTTP 503 because the production authentication secret is missing. No authenticated cloud P0 test may be marked passed until Coze restores the secret and the existing account signs in successfully.
- The source now has a startup health gate for this condition, but its cloud deployment is unverified. The preview currently still returns the same 503, so the saved-credential refresh/login/canvas path remains P0-unverified.

- `pnpm run doctor -- --url=https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` reported `/api/auth/me` as HTTP 502 and exited 1.
- Independent read-only probes for `/`, `/api/auth/me`, and `/api/session` each returned HTTP 502. Evidence: `test-results/network/cloud-health-502-20260719.json`.
- Do not run login, paid generation, project persistence, or download regression until the preview returns a healthy root plus authenticated API responses.

### 2026-07-19 cloud persistence recheck

- Availability recovered: the preview root, `/api/auth/me`, and `/api/session` each returned HTTP 200; `doctor` reported `3 passed / 9 warnings / 0 failed`.
- The authorized real Chrome generation completed as one 800 x 800 APImart `doubao-seedream-5-0-lite` image. The dashboard reached 15 projects / 184 assets before logout.
- P1 remains open: Chrome-saved-credential relogin returned 15 projects / 183 assets. The follow-up source fix now waits for project sync before server logout, but cloud proof is pending deployment and an exact repeat of this flow.

### 2026-07-19 Local Production Recheck

- The source-side authentication bootstrap fix is locally verified, but its cloud deployment is not.
- A clean Webpack production build and Chromium anonymous entry-to-login E2E run passed locally. The earlier port-5014 result is invalid because that port served a stale Turbopack process; the fresh port-5016 run passed.
- Cloud logged-in upload, paid generation, save/reload, download, and logout remain unverified until this source revision is deployed and the auth overlay is absent.

### 2026-07-19 cloud recovery replay remaining items

- Native image upload is still unverified. The cloud UI accepted the upload-button interaction, but the Chrome automation host rejected file chooser injection before a request was sent to the application. Repeat with a standalone Playwright runner or manual Chrome using a non-sensitive test PNG.
- Download file creation is still unverified. The selected-image download dialog and confirmation action completed, but the host did not expose a `download` event or downloaded path. Repeat in an automation environment that captures browser downloads and retain the resulting file metadata.
- The cloud login/reload, new-project result recovery, and selected-image delete paths are no longer listed as unverified: they passed in the real Chrome recovery replay.

### 2026-07-19 native-upload replay correction

- Native image upload is no longer unverified at the storage boundary: a standalone Chromium run used the file chooser, received HTTP 200 from `/api/save-image`, and loaded the returned `/api/serve-upload/...png` URL.
- The same run found `BUG-20260719-045`: the right workspace panel blocks the selected-image delete click. A local source repair exists but must be deployed and rerun before delete can be accepted.
- Generated-result download file creation remains unverified because the P0 script stopped at the delete failure before it reached the download stage.

### 2026-07-19 Production preview follow-up

- The next cloud deployment must run the new locked-install/build script and `next start`, not `next dev`.
- Required Chrome proof remains: reload the authenticated session, confirm the auth overlay is hidden, verify dashboard or canvas interaction, and repeat logout/relogin project persistence.
- The local four-browser production result does not replace those cloud acceptance checks.

After the reported cloud update, the preview root still served the same `95618` byte development document with `next-devtools`, HMR, and all three injected bridge scripts. A fresh logged-in Chrome reload kept `正在验证身份...` visible after the 12-second condition wait, although the canvas controls had rendered behind it. Evidence: `test-results/screenshots/cloud-p0-auth-overlay-after-user-sync-20260719.png` and `test-results/console/cloud-p0-auth-overlay-after-user-sync-20260719.json`. No P0 upload or paid generation was attempted.

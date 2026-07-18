# 缺陷登记册

## 2026-07-18 BUG-20260718-014：云端管理数据失败被伪装成空数据

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 云端后端可用性、管理员 API 管理与任务监控 |
| 稳定复现 | 当前 Chrome 已登录管理员会话中，项目列表仍显示 11 个项目和 182 张图片，但 API 管理显示 0 个供应商、0 个用户、任务监控为空。点击“刷新列表”和“刷新自检”后状态不变。Console 连续记录项目同步 `500/502`。 |
| 实际影响 | 当前无法安全提交真实模型任务、确认已有任务终态或验证积分。原 UI 将所有失败清空成“暂无API提供商 / 暂无云端任务记录”，会误导管理员认为配置被删除。 |
| 根因 | `DashboardView` 对 `/api/admin/apis`、`/api/admin/cloud-tasks` 和 `/api/admin/production-readiness` 的非 2xx / 业务失败 / 网络异常均清空数据或置空，未保留错误状态；云端后端的实际 500/502 仍需部署环境恢复。 |
| 修复 | 新增三类加载错误状态及重试入口，保留已加载数据。供应商、任务监控与发布自检在失败时明确显示 HTTP/业务/网络错误，不再伪装为空数据。 |
| 回归 | 先红后绿：新增 `dashboard-admin-load-error-contract.test.ts`。目标测试、`pnpm ts-check`、`pnpm lint --quiet` 通过；全量回归和构建待本次提交前执行。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-provider-config-zero-20260718.png`、`test-results/console/cloud-p1-provider-config-zero-20260718.json`。本地可观测性修复完成；云端 500/502 为外部 P1 阻塞，未关闭。 |

## 2026-07-18 INFRA-20260718-007：生产构建依赖外部 Google 字体网络

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 构建与部署可靠性 |
| 稳定复现 | `pnpm build` 在请求 `fonts.gstatic.com` 的 Geist 字体失败后，Turbopack 报字体内部模块无法解析，生产构建退出码为 1。 |
| 根因 | `src/app/layout.tsx` 使用 `next/font/google`，把全局字体加载绑定到构建时外部网络；而项目 CSS 已有完整本地系统字体回退链。 |
| 修复 | 移除远程 Geist 导入及变量注入，根布局保留 `antialiased`，继续使用 `globals.css` 的中英文字体栈。 |
| 回归 | 先红后绿：新增 `root-layout-font-contract.test.ts`，修复前断言失败；修复后通过。`pnpm ts-check`、`pnpm lint --quiet` 通过，`pnpm build` 于 2026-07-18 退出码 0。 |
| 状态 | 本地已修复并验证，已随 `6c2185c` 推送；待云端同步验证。 |

## 2026-07-18 BUG-20260718-013：SSE 断开时图像生成轮询绕过节流

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成、任务轮询与积分安全 |
| 环境 / 前置条件 | 云端预览、Chrome 已登录 `Mr.joker`；模型 `doubao-seedream-5-0-lite`，单张 `1:1` 任务 `async-1784381325092-zkypoi`。 |
| 稳定复现 | 提交真实生成后，任务稳定处于 `processing / 10%`。网络证据记录至少 79 次 `POST /api/poll-task`，相邻请求间隔约 76–269ms；每次均为业务成功 JSON，但状态仍是 `processing`。 |
| 预期 / 实际 | 预期在 SSE 断开时按模型估算时间执行正常轮询间隔（本任务应为 800ms），并仅在终态 SSE 事件到达时提前唤醒。实际为 SSE 未连接分支立即 resolve，循环跳过定时器，形成高频轮询。 |
| 根因 | 两处图像生成循环均以 `Promise.race` 等待计时器或 SSE；当 `taskEventsClient.isConnected()` 为 false 时，SSE promise 同步完成，导致 race 立即返回。 |
| 修复 | 两处循环统一调用 `waitForTaskPollInterval`。该帮助器在 SSE 未连接时只等待计时器，在连接时仅由匹配任务的 `completed`、`failed`、`cancelled` 事件提前结束。 |
| 回归 | 先红后绿：新增 `src/__tests__/components/page-task-polling-wiring.test.ts`，修复前因页面未接入 helper 失败；修复后与 `src/__tests__/lib/task-polling-wait.test.ts` 共 3/3 通过。`pnpm ts-check`、`pnpm lint --quiet` 已通过；全量回归待本次提交前执行。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-generation-polling-busy-loop-20260718.png`、`test-results/network/cloud-p1-generation-polling-busy-loop-20260718.json`、`test-results/console/cloud-p1-generation-polling-busy-loop-20260718.json`。本地修复完成，待推送、云端同步及真实间隔复验；未关闭。 |

### 云端恢复链路复验更新

历史任务 `async-1784362294335-88ydio` 已由云端 `POST /api/poll-task` 返回 `completed / 100%`，并返回可访问的生成图地址；重新打开项目可见蓝色立方体结果。积分概览同时出现一次 `-6` 的 `doubao-seedream-5-0-lite` 流水，余额和累计消耗各精确变化 6。该证据关闭 BUG-20260718-010、BUG-20260718-011 与 BUG-20260718-012 的“历史任务恢复、持续轮询和单次结算”范围；不替代 BUG-20260718-013 的节流复验，也不替代新任务的终态验证。

## 2026-07-18 BUG-20260718-012：恢复任务仅轮询一次

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成恢复 |
| 稳定复现 | 云端 `f9a2835` 重新打开含 `async-1784362294335-88ydio` 的项目。恢复接口返回该任务后，首次 `/api/poll-task` 业务成功并返回 `processing / 10%`；页面随后保持 `processing 10%`，未继续发出 `/api/poll-task`。 |
| 根因 | 恢复轮询 effect 依赖 `images`。首次轮询更新进度会触发 React 清理函数，将局部 `cancelled` 设为 true；任务 ID 已被记入已启动集合，新 effect 又跳过该任务，因此循环只执行一次。 |
| 修复 | 使用项目级 generation token 作为唯一取消边界，不再因进度刷新取消轮询；任务 ID 集合仍保证同一任务只启动一个循环。 |
| 回归 | 先红后绿：`src/__tests__/lib/resumed-task-polling.test.ts` 2/2 通过；`pnpm ts-check` 与 `pnpm lint --quiet` 通过。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-recovery-f9-processing-stall-20260718.png`、`test-results/network/cloud-p1-recovery-f9-network-20260718.json`、`test-results/console/cloud-p1-recovery-f9-processing-stall-20260718.json`。待推送和云端终态复验，未关闭。 |

### 云端复验更新（`c7ee167`）

恢复同一任务后，浏览器连续发出至少 3 次 `/api/poll-task`，证明“仅轮询一次”已修复；但每次均收到 `502 {"detail":"无法连接到后端服务"}`，页面保持 `processing 10%`。这是云端网关到后端服务的可用性阻塞，尚不能判定供应商结果、任务终态或退款。证据：`test-results/screenshots/cloud-p1-recovery-c7ee167-gateway-502-20260718.png`、`test-results/network/cloud-p1-recovery-c7ee167-gateway-502-20260718.json`、`test-results/console/cloud-p1-recovery-c7ee167-gateway-502-20260718.json`。

## 2026-07-18 BUG-20260718-011：重开画布后任务无法恢复

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成恢复 |
| 稳定复现 | Chrome 云端项目刷新并重新打开后，真实待处理占位框保持 `submitting 5%`，浏览器没有发出 `/api/poll-task` 请求。 |
| 根因 | 占位框未持久化后端返回的 `taskId`；生成请求也未传递 `projectId`，因此恢复 API 无法关联旧云端任务和画布。 |
| 修复 | 首轮轮询前持久化每个 `taskId`；提交携带 `projectId`；恢复接口仅返回脱敏字段；旧无归属任务仅在提示词和规范化模型完全一致且唯一时绑定。 |
| 安全约束 | 歧义、缺少提示词或模型、失败、取消的任务均不猜测或绑定。 |
| 回归 | 先红后绿：`canvas-task-placeholders.test.ts`、`legacy-task-recovery.test.ts`、`page-task-placeholder-persistence-contract.test.ts`、`task-recovery-route-contract.test.ts`；全量 121 文件 / 504 用例通过。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-recovery-not-resumed-20260718.png`、`test-results/console/cloud-p1-recovery-not-resumed-20260718.json`。本地修复已验证，待云端部署复验。 |

## 2026-07-18 BUG-20260718-010：submitOnly 恢复任务类型错误

| 字段 | 记录 |
| --- | --- |
| 等级 / 模块 | P1 / 无限画布图像生成、云端任务恢复、积分结算 |
| 稳定复现 | Chrome 已登录 `Mr.joker` 会话选择 `doubao-seedream-5-0-lite`、`1:1`、`x1`，提交“蓝色玻璃立方体”。外层任务 `async-1784362294335-88ydio` 保持 `submitting 5%`，连续 4 次 `/api/poll-task` 返回业务错误 `查询任务状态失败: 400`。 |
| 实际 / 根因 | `submitOnly` 任务持久化时未传 `type: 'generate-async'`，恢复分支仅对该类型重新提交供应商任务；错误类型被当作普通远程任务，导致将本地 `async-*` 包装 ID 发给供应商轮询。 |
| 修复 | `src/app/api/generate/route.ts` 明确持久化 `generate-async`；`src/app/api/poll-task/route.ts` 以“有恢复载荷且远程 ID 仍等于外层 ID”为恢复条件，并把旧记录兼容注册为 `generate-async`。 |
| 回归 | 先红后绿：`src/__tests__/lib/async-generate-task.test.ts`、`generate-idempotency-contract.test.ts` 与 `poll-task-recovery-lease-contract.test.ts` 共 17/17 通过；`pnpm ts-check` 通过；目标 ESLint 为 0 error / 36 个历史 warning。 |
| 证据 / 状态 | `test-results/screenshots/cloud-p1-submitonly-credit-submitted-20260718.png`、`cloud-p1-submitonly-credit-poll-error-20260718.png`、`test-results/network/cloud-p1-submitonly-credit-poll-diagnostics-20260718.json`。待云端部署后恢复当前已扣费任务并复验新任务的 -6 流水，未关闭。 |

## 2026-07-18 云端 P0 真实验证补充

| ID | 等级 | 模块 | 状态 | 证据与结论 |
| --- | --- | --- | --- | --- |
| BUG-20260718-001 | P2 | Chrome 自动化适配 | 已定位，非业务代码缺陷 | 云端图片顶部工具栏的 `删除` DOM 绑定为 `onImagesChange(images.filter(...))`；Chrome 扩展自动化执行该按钮点击两次均命中相邻的“美陈拆解”。此现象记录为浏览器自动化坐标/缩放适配风险，不能作为产品删除功能失败。键盘 `Delete` 的即时删除已另由 BUG-20260718-004 跟踪其持久化回流问题。截图：`test-results/screenshots/cloud-p0-delete-opens-display-decompose-20260718.png`。 |
| BUG-20260718-002 | P2 | 云端控制台质量 | 待后续处理 | 云端开发预览出现 React hydration mismatch 与 `DashboardView` 缺少列表 key 的 Console Error；账户菜单还显示“加入于 Invalid Date”。Hydration 信息来源于 Coze Console Bridge，不能在无独立浏览器复现前归因为产品；`DashboardView` key 和日期展示均需后续修复。证据：`test-results/console/cloud-p0-real-logout-20260718.json`。 |
| BUG-20260718-003 | P1 | 工作流执行鉴权 | 已修复并在云端复验 | GitHub `16c5900` 的 `requireApiAuthOrReject` 已部署。对当前预览地址匿名 `POST /api/workflow/execute`（`action=status`、虚拟 `executionId`）返回 `401 {"error":"Authentication required"}`；认证已先于业务查询执行。 |
| BUG-20260718-004 | P2（观察项） | 无限画布删除持久化 | 未稳定复现，持续观察 | 首次隔离项目中曾观察到：1×1 PNG 经 `Delete` 后，在后续生成和刷新后回流。2026-07-18 第二个全新隔离项目按相同步骤执行“粘贴 32×32 PNG → `Delete` → 粘贴 256×256 PNG → 真实生成 → 返回项目列表 → 重新打开”后，项目稳定为 256×256 上传图与 2048×2048 生成图两张，已删除的 32×32 图未回流。该异常尚不能作为稳定产品缺陷或触发猜测性修复。证据：`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-project-restored-20260718.png`、`cloud-delete-repro-before-reload-20260718.png`、`cloud-delete-repro-after-reopen-20260718.png`、`cloud-delete-repro-after-reopen-20260718.json`。下一步：用独立浏览器/凭据重复该序列；仅在稳定复现后，先添加失败回归测试再定位竞争写入。 |
| BUG-20260718-005 | P1 | 管理员新建用户登录 | 本地已修复，待云端部署复验 | 管理员界面创建启用的普通用户后，以无限画布入口登录，真实云端 `POST /api/auth/login` 在请求含 `productType: "canvas"` 时稳定返回 `401`；移除该字段即返回 `200`。跨 Chromium、Firefox、WebKit 与移动 Chromium 的 `p0-auth-session` 自动化均在同一点失败。证据：`test-results/screenshots/cloud-e2e-account-created-20260718.png`、`test-results/console/p0-auth-session-*.json`、`test-results/network/p0-auth-session-*.json`、Playwright trace/video。 | 根因：登录页始终提交当前产品入口；`createManagedUser` 未收到产品字段时持久化为空，认证层将其判定为无画布权限。修复：`src/lib/server-auth.ts` 对未指定产品权限的新建用户默认写入 `canvas,chat`，显式空值仍保留禁用语义。新增 `server-auth-production-security.test.ts` 回归用例，先红后绿；云端需同步后新建独立账号复验。 |
| BUG-20260718-006 | P1 | 普通用户会话控制台错误 | 本地已修复，待云端部署复验 | 修复 BUG-005 后创建新的真实普通用户，`p0-auth-session` 在 Firefox 通过，但 Chromium、WebKit 和移动 Chromium 均稳定在 Console 出现两次 `/api/admin/user-folder` 的 `401`。网络日志证明登录、用户数据同步、刷新和退出均成功；失败仅来自客户端越权请求。 | 根因：`UserManager` 对普通用户登录、服务端用户写回及本地创建无条件调用管理员专用的建目录端点。修复：移除客户端建目录副作用；服务端 `createManagedUser` 继续负责管理员创建用户时的目录初始化。新增 `user-manager-admin-folder.test.ts`，先失败后通过。 |

## 规则

每个缺陷先有稳定复现与证据，再做最小范围修复；修复后必须保留失败回归用例并执行模块和全量回归。严重级别：P0（安全/数据/核心不可用/错误扣费）、P1（核心链路失败）、P2（特定场景功能问题）、P3（UI/文案/轻微交互）。

## 2026-07-18 云端部署复验结案补充

| Bug ID | 云端复验 | 结果 | 证据 | 结案范围 |
| --- | --- | --- | --- | --- |
| BUG-20260718-005 | 新建的独立普通账号，以 `canvas` 产品入口完成登录、刷新与退出 | 已修复并云端通过，四浏览器 4/4 通过 | 归档 ID `20260718-p0-auth-session-cloud-green`；`test-results/screenshots/p0-auth-session-*.png`；同名 Console/Network JSON；`playwright-report/index.html` | 默认 `canvas,chat` 产品权限已在云端生效；不代表旧账号的显式权限配置被迁移。 |
| BUG-20260718-006 | 同一独立普通账号完成登录、刷新与退出，并审查 Console/Network | 已修复并云端通过，四浏览器 4/4 通过 | 同上；Network 未出现 `/api/admin/user-folder` 401，Console 无 error | 普通用户会话不再调用管理员目录端点；不替代其他业务模块的权限回归。 |

## 2026-07-18 测试基础设施风险

| ID | 等级 | 模块 | 状态 | 根因、修复与回归 |
| --- | --- | --- | --- | --- |
| INFRA-20260718-001 | P1 | P0 真实图像生成 E2E | 已修复，真实生成待授权执行 | 云端图像模型下拉框中存在跨供应商的同名显示标签，原用例使用 `selectOption({ label })`，可能静默选择 FHL、虚宝或其他同名提供商，导致测试结果不能证明目标供应商。修复为只接受精确的 `providerId::modelId` 选项值并使用 `selectOption({ value })`；非复合值立即失败。`pnpm ts-check` 与 `pnpm exec playwright test tests/e2e/p0-core.spec.ts --list` 于 2026-07-18 通过。 |

## 当前登记

| Bug ID | 级别 | 模块 | 状态 | 复现与证据 | 根因/修复 | 回归结果 |
| --- | --- | --- | --- | --- | --- | --- |
| BUG-20260717-001 | P1 | 节点编辑器 | 已修复，待云端回归 | 真实Chrome拖动节点后 React 报错“Cannot update a component while rendering a different component”；提交 `da4c37e` 前本地复现 | `setWf` updater 中同步调用父组件状态更新；改为 revision effect 延迟同步 | 云端拖动复测无 React warning；仍需纳入本轮统一证据 |
| BUG-20260717-002 | P1 | 工作流执行授权 | 已修复并云端通过 | 云端匿名 `POST /api/workflow/execute`（`action=status`、虚构 executionId）此前返回 `400 {"error":"缺少 executionId"}`，证明认证检查未先于业务参数检查执行 | `src/app/api/workflow/execute/route.ts` 改用 `requireApiAuthOrReject`；`high-risk-route-auth-contract.test.ts` 先失败后通过 | 目标测试、`pnpm ts-check`、`pnpm lint --quiet`、483/483 测试及生产构建通过；2026-07-18 云端匿名请求固定返回 401 |
| BUG-20260717-003 | P2 | 退出登录后的操作审计 | 云端实测通过，仍有独立浏览器回归项 | 四浏览器匿名入口实测的 Console/Network 证据中，`POST /api/auth/logout` 后出现 `POST /api/activity` 的 401；根因是全局 fetch 审计在会话清除后仍记录退出请求 | `shouldAuditClientRequest('/api/auth/logout', 'POST')` 先失败；排除 `/api/auth/` 和 `/api/connector/auth/` 的客户端二次审计，避免无会话审计请求 | `operation-audit.test.ts` 通过；2026-07-18 已登录云端会话退出后页面回到“选择入口”，归档 Console 未见 `/api/activity` 或 401；仍需独立浏览器 Network trace 作为正式多浏览器回归证据 |
| INFRA-20260717-001 | P1 | 多浏览器E2E | 已排除 | 安装阶段曾提示 Windows WebKit 运行库缺失 | 随后 `pnpm test:e2e:p0` 已实际启动 WebKit 项目并执行到环境前置检查，说明该提示未阻断当前浏览器启动 | 不作为发布阻塞；WebKit真实业务流程仍待凭据后验证 |
| INFRA-20260717-002 | P1 | Chrome上传自动化 | 已定位为控制通道限制，待独立浏览器复验 | 已登录云端项目中，底部“图片上传”按钮已触发选择链路；2026-07-18 再次使用 48×32 无敏感 PNG 时，失败点固定在控制通道的 `fileChooser.setFiles`，返回 `Not allowed`，未到达上传业务请求 | 当前 Chrome 扩展会话不允许自动写入原生文件选择器；尚未形成业务缺陷复现 | 用独立 Playwright 浏览器或人工录屏执行相同入口，再判断产品上传是否通过；证据：`cloud-p0-native-upload-not-allowed-20260718.png`、`cloud-p0-native-upload-not-allowed-20260718.json` |
| INFRA-20260717-003 | P1 | 依赖漏洞扫描 | 阻塞 | `pnpm audit --prod --json` 的镜像审计端点不存在；官方端点请求超时 | 注册表/网络不可用，未获得漏洞清单 | 恢复可用审计端点后重新扫描；不得视为零漏洞 |
| INFRA-20260717-004 | P2 | P0 多浏览器测试隔离 | 已缓解，持续观察 | 首次四项目并发执行时 Chromium 进入已认证画布而其余浏览器显示登录入口；Chromium 单独重复 3 次和单 worker 四浏览器复验均通过，未形成稳定产品复现 | 真实账号和项目的多浏览器并发会放大云端会话、localStorage 或异步认证状态竞争 | Playwright 默认 `workers=1`，顺序执行四浏览器；下一次携带真实凭据的 P0 全链路需验证不再出现跨浏览器状态污染 |
| INFRA-20260717-005 | P2 | Playwright 产物与 ESLint | 本地已修复 | 生成 `playwright-report/` 后，`pnpm lint --quiet` 扫描第三方压缩报告代码并报 159 项错误 | `eslint.config.mjs` 未忽略 Playwright 报告和测试证据目录 | 精确忽略 `playwright-report/**`、`test-results/**`；重新执行 `pnpm lint --quiet` 通过，源码和测试目录仍受检查 |
| INFRA-20260717-006 | P2 | Playwright 证据留存 | 本地已修复 | `outputDir=test-results` 会在每次 Playwright 执行前清理前一轮视频和 Trace，导致审计证据被覆盖 | 临时运行产物和长期归档共用一个目录 | 临时输出改为 `.playwright-output/`，归档脚本以运行 ID 将视频/Trace/截图复制到 `test-results/`；四浏览器重跑后新增 12 个归档文件且此前 Chromium 登录失败证据仍保留 |

## 新缺陷模板

| 字段 | 内容 |
| --- | --- |
| Bug ID / 标题 / 等级 |  |
| 模块 / 环境 / Git Commit / 浏览器 |  |
| 前置条件 / 精确复现步骤 |  |
| 预期结果 / 实际结果 |  |
| 截图 / 视频 / Trace / Console / Network / 服务端日志 |  |
| requestId / taskId |  |
| 根因 / 修复文件 / 修复方案 |  |
| 新增测试 / 回归结果 |  |

## 2026-07-18 云端生成恢复与积分补偿

| 字段 | 记录 |
| --- | --- |
| Bug ID / 等级 | BUG-20260718-007 / P1 |
| 模块 | 无限画布图像生成、`submitOnly` 云端任务恢复、积分 |
| 环境 | 云端预览 `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`；Chrome 已登录管理员会话；本地提交基线 `1bf1386` |
| 稳定复现 | 新建隔离项目，选择精确值 `api_1778430731224_533e09a::doubao-seedream-5-0-lite`，比例 `1:1`、数量 `x1`，提交“红色玻璃立方体、白色背景”提示词。任务停在 `submitting 5%` 超过四分钟；刷新并从仪表盘重开项目后，同一占位任务仍停在该状态。 |
| 预期 / 实际 | 预期任务必须进入供应商提交、完成或明确失败并完成积分结算。实际外层 `async-*` 任务已持久化，但请求结束后 fire-and-forget 内部请求在云端运行时未继续执行，导致没有供应商任务 ID、没有终态。 |
| 证据 | `test-results/screenshots/cloud-p0-generation-stalled-20260718.png`；`test-results/console/cloud-p0-generation-stalled-20260718.json`。Console 仅有 Coze Console Bridge 警告，未将其误判为业务根因。 |
| 根因 | `src/app/api/generate/route.ts` 在 `submitOnly` 返回后依赖进程内后台 fetch；`src/app/api/poll-task/route.ts` 将外层本地任务直接视为“继续处理中”，无法从持久化请求恢复实际供应商提交。积分成本只在内存任务中保存，重启后失败/取消没有可靠退款依据。 |
| 修复文件 | `src/app/api/generate/route.ts`、`src/app/api/poll-task/route.ts`、`src/app/api/cancel-task/route.ts`、`src/lib/async-generate-task.ts`、`src/lib/cloud-task-persistence.ts`、`src/lib/cloud-task-storage.ts`。 |
| 修复方式 | 持久化经白名单过滤的提交参数与实际积分成本；默认禁用不可靠的进程内后台 worker；首个轮询请求取得持久化租约后恢复一次供应商提交，随后改用真实供应商任务 ID 轮询；恢复提交、供应商失败、空结果和跨重启取消均按持久化成本退款。退款在同一数据库 CTE 中原子更新任务状态、余额和退款流水，任务的 `credit_status='pending'` 只能被结算一次。 |
| 新增测试 | 先红后绿：`generate-idempotency-contract.test.ts`、`poll-task-recovery-lease-contract.test.ts`、`async-generate-task.test.ts`、`cloud-task-storage.test.ts`。定向 26/26 通过；全量 `pnpm test` 为 118 文件 / 494 测试通过；`pnpm ts-check`、全量 `pnpm lint --quiet` 与生产 `pnpm build` 均通过。 |
| 当前状态 | 本地修复完成，待推送、云端同步后使用当前 Chrome 已登录账号再次执行真实付费生成、刷新恢复和取消退款验证。未完成此项前不得关闭本 BUG 或宣布发布通过。 |

### 2026-07-18 云端复验更新（取代上表“当前状态”）

`9026dcc` 已同步到云端预览。使用 Chrome 中已登录的 `Mr.joker / 管理员` 会话，以精确模型值 `api_1778430731224_533e09a::doubao-seedream-5-0-lite`、`1:1`、`x1` 真实提交“红色玻璃立方体”任务。UI 先显示 `submitting 5%`，随后真实结果写入项目；浏览器刷新进入项目列表后，最新项目卡片显示结果缩略图；重新进入项目可见同一结果图、原始提示词、`doubao-seedream-5-0-lite`、`APImart imgae` 与 `2048 × 2048` 元数据。证据：`test-results/screenshots/cloud-p0-generation-stalled-after-9026dcc-20260718.png`、`test-results/screenshots/cloud-p0-generation-recovered-after-9026dcc-20260718.png`、对应 `test-results/console/` JSON。

BUG-20260718-007 的“任务恢复、完成和刷新恢复”范围已修复并云端通过；恢复失败退款和跨重启取消退款仍未验证，继续作为独立 P1 验证缺口，不能据此宣称积分补偿已通过。

| Bug ID | 等级 | 模块 | 状态 | 稳定证据 | 后续动作 |
| --- | --- | --- | --- | --- | --- |
| BUG-20260718-008 | P2 | DashboardView / SSR hydration | 已复现，待 P0/P1 关闭后修复 | 同一 Chrome 会话刷新项目列表三次均出现 React `Each child in a list should have a unique key`（`DashboardView`）及 hydration mismatch；不影响本次生成完成，但违反“无未处理 Console Error”发布门禁。 | 建立最小复现测试后，修正列表 key 与服务端/客户端不稳定属性；在 Chromium、Firefox、WebKit 回归。 |
| BUG-20260718-009 | P1 | 无限画布 `submitOnly` 图像计费 | 本地已修复，待云端付费回归 | Chrome 真实提交 `doubao-seedream-5-0-lite` 后生成结果已保存；积分规则页面明确该模型为每张 6 积分，但云端积分概览的最新流水仍停在 7 月 17 日，没有本次消费。静态数据流复现：`src/app/api/generate/route.ts` 在 `if (submitOnly)` 内持久化并返回任务，而 `consumeCredits` 位于该分支之后，无法执行。 | 将 `submitOnly` 的扣费放到同一分支内、持久化任务之前；将成本持久化到 `cloud_tasks`；持久化失败或并发冲突即时退款。先红后绿新增 `generate-idempotency-contract.test.ts`，定向 24/24 通过。云端同步后需以同一模型再跑一次，确认新增 -6 流水与余额变化。 |

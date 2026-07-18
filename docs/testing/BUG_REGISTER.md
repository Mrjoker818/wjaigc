# 缺陷登记册

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

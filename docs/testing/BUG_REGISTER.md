# 缺陷登记册

## 2026-07-18 云端 P0 真实验证补充

| ID | 等级 | 模块 | 状态 | 证据与结论 |
| --- | --- | --- | --- | --- |
| BUG-20260718-001 | P2 | Chrome 自动化适配 | 已定位，非业务代码缺陷 | 云端图片顶部工具栏的 `删除` DOM 绑定为 `onImagesChange(images.filter(...))`；Chrome 扩展自动化执行该按钮点击两次均命中相邻的“美陈拆解”。此现象记录为浏览器自动化坐标/缩放适配风险，不能作为产品删除功能失败。键盘 `Delete` 的即时删除已另由 BUG-20260718-004 跟踪其持久化回流问题。截图：`test-results/screenshots/cloud-p0-delete-opens-display-decompose-20260718.png`。 |
| BUG-20260718-002 | P2 | 云端控制台质量 | 待后续处理 | 云端开发预览出现 React hydration mismatch 与 `DashboardView` 缺少列表 key 的 Console Error；账户菜单还显示“加入于 Invalid Date”。Hydration 信息来源于 Coze Console Bridge，不能在无独立浏览器复现前归因为产品；`DashboardView` key 和日期展示均需后续修复。证据：`test-results/console/cloud-p0-real-logout-20260718.json`。 |
| BUG-20260718-003 | P1 | 工作流执行鉴权 | 已修复并在云端复验 | GitHub `16c5900` 的 `requireApiAuthOrReject` 已部署。对当前预览地址匿名 `POST /api/workflow/execute`（`action=status`、虚拟 `executionId`）返回 `401 {"error":"Authentication required"}`；认证已先于业务查询执行。 |
| BUG-20260718-004 | P1 | 无限画布删除持久化 | 待稳定复现，发布阻断 | 在新建隔离项目中，先粘贴 1×1 PNG、选择后按 `Delete`，DOM 图片数从 1 变为 0；随后粘贴 256×256 PNG 并发起真实生成时，先前已删除的 1×1 图片再次出现。刷新后重新打开该项目，仍有 256×256、1×1 与 2048×2048 三张图片。预期删除后的节点不得被后续异步保存或任务完成回写恢复。证据：`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-project-restored-20260718.png`。下一步：使用相同步骤在新隔离项目稳定复现，再先添加失败回归测试并定位竞争写入。 |

## 规则

每个缺陷先有稳定复现与证据，再做最小范围修复；修复后必须保留失败回归用例并执行模块和全量回归。严重级别：P0（安全/数据/核心不可用/错误扣费）、P1（核心链路失败）、P2（特定场景功能问题）、P3（UI/文案/轻微交互）。

## 当前登记

| Bug ID | 级别 | 模块 | 状态 | 复现与证据 | 根因/修复 | 回归结果 |
| --- | --- | --- | --- | --- | --- | --- |
| BUG-20260717-001 | P1 | 节点编辑器 | 已修复，待云端回归 | 真实Chrome拖动节点后 React 报错“Cannot update a component while rendering a different component”；提交 `da4c37e` 前本地复现 | `setWf` updater 中同步调用父组件状态更新；改为 revision effect 延迟同步 | 云端拖动复测无 React warning；仍需纳入本轮统一证据 |
| BUG-20260717-002 | P1 | 工作流执行授权 | 已修复并云端通过 | 云端匿名 `POST /api/workflow/execute`（`action=status`、虚构 executionId）此前返回 `400 {"error":"缺少 executionId"}`，证明认证检查未先于业务参数检查执行 | `src/app/api/workflow/execute/route.ts` 改用 `requireApiAuthOrReject`；`high-risk-route-auth-contract.test.ts` 先失败后通过 | 目标测试、`pnpm ts-check`、`pnpm lint --quiet`、483/483 测试及生产构建通过；2026-07-18 云端匿名请求固定返回 401 |
| BUG-20260717-003 | P2 | 退出登录后的操作审计 | 云端实测通过，仍有独立浏览器回归项 | 四浏览器匿名入口实测的 Console/Network 证据中，`POST /api/auth/logout` 后出现 `POST /api/activity` 的 401；根因是全局 fetch 审计在会话清除后仍记录退出请求 | `shouldAuditClientRequest('/api/auth/logout', 'POST')` 先失败；排除 `/api/auth/` 和 `/api/connector/auth/` 的客户端二次审计，避免无会话审计请求 | `operation-audit.test.ts` 通过；2026-07-18 已登录云端会话退出后页面回到“选择入口”，归档 Console 未见 `/api/activity` 或 401；仍需独立浏览器 Network trace 作为正式多浏览器回归证据 |
| INFRA-20260717-001 | P1 | 多浏览器E2E | 已排除 | 安装阶段曾提示 Windows WebKit 运行库缺失 | 随后 `pnpm test:e2e:p0` 已实际启动 WebKit 项目并执行到环境前置检查，说明该提示未阻断当前浏览器启动 | 不作为发布阻塞；WebKit真实业务流程仍待凭据后验证 |
| INFRA-20260717-002 | P1 | Chrome上传自动化 | 待定位 | 已登录云端项目中，底部“图片上传”按钮与 `filechooser` 事件未在自动化控制时建立连接；直接定位的文件输入为隐藏元素 | 可能是Chrome扩展会话对原生文件选择器的限制，也可能是入口事件链未触发；尚未有稳定业务缺陷复现 | Playwright独立浏览器真实环境运行后，再判断为产品缺陷或自动化适配缺陷 |
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

# 回归测试报告

## 2026-07-18 新建用户画布登录回归

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 云端预览、管理员已登录会话 | 管理员“添加用户”创建启用的普通用户；以无限画布入口提交用户名、密码与 `productType=canvas` | 失败，稳定返回 `401`；同一凭据在不传产品入口时返回 `200`，确认不是用户名或密码错误 | `cloud-e2e-account-created-20260718.png`、`p0-auth-session-{chromium,firefox,webkit,mobile-chromium}.json`、Playwright trace/video |
| 本地隔离存储 | `createManagedUser` 后以 `productType=canvas` 调用 `authenticateUser` | 修复前返回 `null`；修复后通过，返回普通用户及 `productType: canvas,chat` | `pnpm exec vitest run src/__tests__/lib/server-auth-production-security.test.ts`，4/4 通过 |

云端结论仍为未验证：修复仅影响部署后的新建用户，必须在云端同步后创建新的隔离测试用户，并运行四浏览器真实登录/刷新/退出回归。现有测试账号在修复部署前创建，不能用于证明默认权限已生效。

## 2026-07-18 普通用户会话 Console 回归

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 云端预览、修复后新建的普通用户 | Chromium、Firefox、WebKit 与移动 Chromium 执行登录 → 刷新 → 退出 | 身份链路均成功；Firefox 全通过。Chromium、WebKit 和移动 Chromium因两次 `POST /api/admin/user-folder` 返回 401 而被 Console 门禁阻断 | `test-results/console/p0-auth-session-*.json`、`test-results/network/p0-auth-session-*.json`、`.playwright-output/` 中的截图、录像和 Trace |
| 本地隔离测试 | 普通用户调用 `UserManager.upsertUserFromServer` | 修复前访问管理员端点；修复后仅访问 `/api/user-data/sync?key=projects` | `pnpm exec vitest run src/__tests__/lib/user-manager-admin-folder.test.ts`，1/1 通过 |

云端同步此修复后，复用当前隔离账号重新执行四浏览器 `p0-auth-session`；只有四项目均无 Console error 后，才能关闭 BUG-20260718-006。

## 2026-07-18 云端 Chrome 已登录会话 P0 实测

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`，Chrome 已登录管理员会话 | 新建隔离项目，不触碰既有 6 个项目 | 通过：创建后仪表盘显示 7 个项目 | `cloud-p0-canvas-entry-20260718.png` |
| 同上 | 选择 `豆包5.0Lite`（`api_1778430731224_533e09a::doubao-seedream-5-0-lite`），比例 `1:1`，数量 `x1`，提交最小提示词 | 通过：任务经过 `submitting 5%` 后返回真实图片；画布标注 `APImart imgae`、`2048 × 2048` | `cloud-p0-before-generate-20260718.png`、`cloud-p0-task-state-20260718.png` |
| 同上 | 画布缩放 | 通过：`100%` 变为 `120%` | Chrome DOM 记录 |
| 同上 | 刷新、从仪表盘重新打开最新项目 | 通过：项目中保留 1 张生成图；资产数由 174 增至 175 | `cloud-p0-before-reload-20260718.png` |
| 同上 | 选中图片后键盘 `Delete` | 通过：图片计数由 1 变为 0 | Chrome DOM 记录 |
| 同上 | 上传、鼠标拖动、节点工具栏点击下载 | 未验证为业务通过：Chrome 扩展拒绝 `filechooser.setFiles`；拖动未改变 DOM 几何；下载点击未产生扩展可观察到的 download event。均已归档，不能用作产品失败或通过结论。 | `cloud-p0-upload-filechooser-blocked-20260718.png`、`cloud-p0-node-move-20260718.png`、`cloud-p0-download-state-20260718.png` |
| 同上 | 匿名 `POST /api/workflow/execute`（`action=status`） | 通过：返回 `401 {"error":"Authentication required"}`，认证在业务查询前被拒绝 | 终端 HTTP 探针，2026-07-18，部署后复验 |
| 同上 | 已登录会话退出登录 | 通过：执行退出后进入“选择入口”，页面显示“请联系管理员创建新账户并授权对应功能”；归档 Console 未见 `/api/activity` 或 401 | `cloud-p0-logout-20260718.png`、`cloud-p0-logout-20260718.json` |

## 2026-07-18 云端 Chrome 第二轮 P0 实测

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 新建第 8 个隔离项目并刷新会话 | 通过：刷新后仍为管理员会话；项目数由 7 变为 8 | `cloud-p0-logged-in-project-20260718.png`、Chrome DOM |
| 同上 | 底部“图片上传”→文件选择器写入 PNG | 未验证为业务失败：控制层返回 `Not allowed`，不能据此判断产品上传入口异常 | `cloud-p0-upload-filechooser-not-allowed-20260718.png`、`cloud-p0-upload-filechooser-not-allowed-20260718.json` |
| 同上 | 剪贴板粘贴 1×1 与 256×256 无敏感 PNG | 通过：图片实际保存到画布；项目资产数最终由 175 增至 178 | `cloud-p0-paste-result-20260718.png`、刷新后 DOM 图片尺寸 |
| 同上 | 选中 256×256 图片、拖动、缩小画布 | 通过：矩形从 `(704,175.5)` 移至 `(774,225.5)`；画布比例从 `200%` 变为 `167%` | Chrome DOM 记录 |
| 同上 | 选中 1×1 图片后键盘 `Delete` | 即时 UI 通过但持久化不通过：DOM 图片数 1→0；后续异步操作后图片重新出现并在刷新后保留 | BUG-20260718-004，`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-project-restored-20260718.png` |
| 同上 | `豆包5.0Lite`，`1:1`、`x1`、最小中文提示词真实生成 | 通过：任务显示 `submitting 5%`，完成后回到画布，结果标注 `doubao-seedream-5-0-lite / APImart imgae / 2048×2048` | `cloud-p0-before-real-generation-20260718.png`、`cloud-p0-generation-submitted-20260718.png`、`cloud-p0-generation-after-wait-20260718.png` |
| 同上 | 刷新后从“刚刚”创建的隔离项目重新打开 | 部分通过：三张图片均恢复，真实生成结果已持久化；同时证实已删除节点回流 | `cloud-p0-project-restored-20260718.png` |
| 同上 | 选择生成结果并点击“下载” | 未验证：按钮被真实点击，但 Chrome 控制层未给出 download event，不能作为下载通过或失败 | Chrome DOM，控制层 download event 为 `not-observed` |
| 同上 | 账户菜单退出登录 | 通过：回到“选择入口”；Console 无 `/api/activity` 或 401，但仍有 `DashboardView` key 警告 | `cloud-p0-real-logout-20260718.png`、`cloud-p0-real-logout-20260718.json` |

## 2026-07-18 删除状态第二次隔离复现

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 新建第 9 个隔离项目；粘贴 32×32 PNG 后按 `Delete` | 通过：删除后画布无该图片 | Chrome DOM；后续复核图片清单 |
| 同上 | 粘贴 256×256 PNG，选择 `豆包5.0Lite`、`1:1`、`x1` 后发起真实生成 | 通过：任务完成后仅有 256×256 上传图和 2048×2048 生成图 | `cloud-delete-repro-before-reload-20260718.png` |
| 同上 | 返回项目列表并重新打开显示“2 张图片”的刚创建项目 | 未复现删除回流：DOM 仅包含 256×256 上传图与 2048×2048 生成图；32×32 已删除图未出现 | `cloud-delete-repro-after-reopen-20260718.png`、`cloud-delete-repro-after-reopen-20260718.json` |

## 2026-07-18 原生上传与下载控制通道复验

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 底部“图片上传”选择无敏感 48×32 PNG | 未验证为产品失败：按钮已触发原生选择链路，但控制通道在 `fileChooser.setFiles` 阶段返回 `Not allowed`，尚未到达上传业务请求 | `cloud-p0-native-upload-not-allowed-20260718.png`、`cloud-p0-native-upload-not-allowed-20260718.json` |
| 同上 | 选中真实生成结果，展开图片工具栏并点击“下载” | 未验证为产品失败：下载按钮真实点击后，控制通道 10 秒内没有收到 `download` 事件；不能把“未观察到事件”推导为下载未执行 | `cloud-p0-download-event-not-observed-20260718.png`、`cloud-p0-download-event-not-observed-20260718.json` |

## 2026-07-18 已登录会话刷新与项目恢复复验

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 当前预览地址，Chrome 已登录管理员会话 | 刷新页面并等待身份校验完成 | 通过：回到管理员仪表盘，显示 `Mr.joker / 管理员`、9 个项目和 180 张图片 | `cloud-p0-session-refresh-project-restore-20260718.png`、`cloud-p0-session-refresh-project-restore-20260718.json` |
| 同上 | 打开刚创建且显示“2 张图片”的隔离项目 | 通过：恢复 256×256 上传图与 2048×2048 真实生成图 | `cloud-p0-session-refresh-project-restore-20260718.png`、`cloud-p0-session-refresh-project-restore-20260718.json` |

## 执行记录

| 时间 | Git Commit | 版本 | 地址 | 浏览器 | 套件 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 待执行 | `da4c37e` | `2.5.0` | 待提供 `E2E_BASE_URL` | 待执行 | P0真实用户链路 | 未验证 | `test-results/` 待生成 |
| 2026-07-17 | `da4c37e` | `2.5.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | Chrome（既有登录会话） | 预览页加载、画布/生成表单可见性、医生远程可达性 | 部分通过 | Chrome DOM证据显示画布、上传入口、图像模型、提示词和生成按钮存在；上传自动化超时，未声称上传或生成通过 |
| 2026-07-17 | `da4c37e` | `2.5.0` | 默认本地地址（未实际导航） | Chromium/Firefox/WebKit/移动 Chromium | `pnpm test:e2e:p0` | 阻塞，4/4失败 | `playwright-report/index.html`、`test-results/junit.xml`、`test-results/screenshots/`、`test-results/videos/`、`test-results/traces/`；失败原因为缺少真实测试环境变量，未将其算作业务失败或通过 |
| 2026-07-17 | 本地未提交修复 | `2.5.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | HTTP 匿名请求 | 工作流执行授权 | 失败（云端未部署修复） | 匿名 `POST /api/workflow/execute` 返回 `400 {"error":"缺少 executionId"}`，预期应为 401；请求无用户凭据且未创建任务 |
| 2026-07-17 | 本地未提交测试改进 | `2.5.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | Chromium/Firefox/WebKit/移动 Chromium | P0-AUTH-ENTRY-001 匿名登录入口 | 通过，4/4 | 以单 worker 顺序执行。四个浏览器均完成“选择入口→无限画布→登录表单”；截图、视频、Trace、Console、Network 和 JUnit 已归档。首轮并发下 Chromium 的失败证据保留为隔离风险，未登记为稳定产品 Bug |
| 2026-07-17 | 本地未提交修复 | `2.5.0` | 本地源码 | 操作审计单元回归 | 退出后审计 401 | 通过 | 先增加 `/api/auth/logout` 不应触发客户端审计的失败断言，再排除认证端点；`pnpm exec vitest run src/__tests__/lib/operation-audit.test.ts` 为 2/2 通过。云端实测仍待部署后复验 |
| 2026-07-17 | `da4c37e` 云端版本 | `3.9.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` | Chromium | P0-AUTH-001 真实登录 | 阻塞 | 在隔离浏览器输入历史临时账号后，`POST /api/auth/login` 返回 401，页面显示登录失败。Trace、视频、截图、Console 和 Network 已归档；不将无效凭据误报为应用通过或代码缺陷 |
| 2026-07-18 | `258d510` | `3.9.0` | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` | Chrome（用户完成登录） | P0 画布、生成、恢复、退出 | 部分通过；删除异常待独立复验 | 真实粘贴上传、移动、缩放、生成、刷新恢复、退出通过；文件选择器与下载为控制层未验证。首轮删除回流异常在第二个全新隔离项目中未复现，保留为 BUG-20260718-004 观察项 |

## 基线校验

- `pnpm run doctor -- --url=https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`：3 项通过、9 项警告、0 项失败。警告均为本机未注入生产密钥、数据库、对象存储及模型凭据；仅证明 `/api/auth/me` 可达，不能据此推导云端数据库、对象存储、登录或模型数据链路健康。
- `pnpm ts-check`：2026-07-18 当前提交通过（退出码 0）。
- `pnpm exec playwright test tests/e2e/p0-core.spec.ts --list`：4个浏览器项目均已发现测试用例。
- `pnpm lint`：首次为 1 error / 929 warnings；修复 P0生成路由的 `prefer-const` 后，2026-07-18 `pnpm lint --quiet` 再次通过。warning 仍是历史存量，未被隐藏或清除；Babel 对超大 `infinite-canvas.tsx` 的样式降级提示不属于 ESLint error。
- `pnpm test`：2026-07-18 运行结果为 117 个测试文件、483 个测试通过；本机无数据库时出现预期回退日志，因此数据库链路仍未验证。
- `pnpm build`：2026-07-18 通过，耗时 78.7 秒。构建提示本地 `data` 目录不会在重部署后持久化，并有 Node `--localstorage-file` 无有效路径的 warning；两者未导致构建失败，但需在云端部署环境单独验证。
- 工作流鉴权修复后复验（2026-07-17）：`pnpm ts-check`、`pnpm lint --quiet`、`pnpm test`（117 个测试文件、483 个测试）以及 `pnpm build` 均通过；最新生产构建耗时 76 秒。2026-07-18 云端匿名 HTTP 探针也返回预期 401。该结果不能替代真实账号、存储和模型调用验证。
- `pnpm audit --prod --json`：未验证，镜像端点不存在、官方端点超时，详见 `SECURITY_REPORT.md`。
- 本轮新增回归：`pnpm exec vitest run src/__tests__/lib/operation-audit.test.ts` 为 2/2 通过；`pnpm lint --quiet`（排除自动生成 Playwright 报告后）与 `pnpm ts-check` 通过；`pnpm test` 为 117 个测试文件、483 个测试通过。测试环境没有数据库连接，因此输出中的本地存储回退日志不能作为数据库链路证据。
- 证据留存复验：Playwright 临时输出已移至 `.playwright-output/`，执行 `E2E_RUN_ID=20260717-p0-auth-entry` 的四浏览器匿名入口用例后，归档脚本新增 12 个视频/Trace/截图文件；`test-results/` 同时保留此前 Chromium 登录失败的证据，未再被新运行清空。

## 当前结论

已执行 Chrome 已登录会话的真实 P0 操作，并保留截图和 Console 证据；不能将其替代为独立凭据驱动的 Chromium、Firefox、WebKit 和移动 Chromium 全链路。首轮删除持久化异常在第二次隔离实测中未复现，尚不具备稳定缺陷的证据；文件选择器/下载、独立登录及跨浏览器完整链路仍未获得可审计证据，因此发布结论仍为不通过。

## 2026-07-18 云端独立普通用户会话复验（已部署）

| 环境 | Git Commit | 浏览器 | 流程 | 结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/` | `8248852`（含此前 `bb91262`） | Chromium、Firefox、WebKit、移动 Chromium | 无限画布入口登录 → 仪表盘 → 刷新保持会话 → 退出登录 | 4/4 通过。每个浏览器均收到包含用户 ID 的成功登录响应；刷新后仍为已登录状态；退出后回到“选择入口”；Console 无 error，Network 无普通用户对 `/api/admin/user-folder` 的 401。 | `test-results/screenshots/p0-auth-session-{chromium,firefox,webkit,mobile-chromium}.png`；对应 `console/`、`network/` JSON；归档 ID `20260718-p0-auth-session-cloud-green` 下的 video/trace/screenshot；`playwright-report/index.html` |

该项关闭 BUG-20260718-005 和 BUG-20260718-006 的云端部署验证缺口，但不覆盖原生文件上传、真实付费图像生成、下载与项目恢复的独立账号全链路。

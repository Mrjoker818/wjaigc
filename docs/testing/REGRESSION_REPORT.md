# 回归测试报告

## 2026-07-18 云端 Chrome 已登录会话 P0 实测

| 环境 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9.dev.coze.site/`，Chrome 已登录管理员会话 | 新建隔离项目，不触碰既有 6 个项目 | 通过：创建后仪表盘显示 7 个项目 | `cloud-p0-canvas-entry-20260718.png` |
| 同上 | 选择 `豆包5.0Lite`（`api_1778430731224_533e09a::doubao-seedream-5-0-lite`），比例 `1:1`，数量 `x1`，提交最小提示词 | 通过：任务经过 `submitting 5%` 后返回真实图片；画布标注 `APImart imgae`、`2048 × 2048` | `cloud-p0-before-generate-20260718.png`、`cloud-p0-task-state-20260718.png` |
| 同上 | 画布缩放 | 通过：`100%` 变为 `120%` | Chrome DOM 记录 |
| 同上 | 刷新、从仪表盘重新打开最新项目 | 通过：项目中保留 1 张生成图；资产数由 174 增至 175 | `cloud-p0-before-reload-20260718.png` |
| 同上 | 选中图片后键盘 `Delete` | 通过：图片计数由 1 变为 0 | Chrome DOM 记录 |
| 同上 | 上传、鼠标拖动、节点工具栏点击下载 | 未验证为业务通过：Chrome 扩展拒绝 `filechooser.setFiles`；拖动未改变 DOM 几何；下载点击未产生扩展可观察到的 download event。均已归档，不能用作产品失败或通过结论。 | `cloud-p0-upload-filechooser-blocked-20260718.png`、`cloud-p0-node-move-20260718.png`、`cloud-p0-download-state-20260718.png` |

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

## 基线校验

- `npm run doctor`：2项通过、10项警告、0项失败。警告均为本机未注入生产密钥、数据库、对象存储及模型凭据，不能据此推导云端健康。
- `pnpm run doctor -- --url=https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site`：3项通过、9项警告、0项失败；仅证明 `/api/auth/me` 可达，不证明登录或数据链路通过。
- `pnpm ts-check`：通过。
- `pnpm exec playwright test tests/e2e/p0-core.spec.ts --list`：4个浏览器项目均已发现测试用例。
- `pnpm lint`：首次为 1 error / 929 warnings；修复 P0生成路由的 `prefer-const` 后，`pnpm lint --quiet` 通过。warning 仍是历史存量，未被隐藏或清除。
- `pnpm test`：117 个测试文件、483 个测试通过；本机无数据库时出现预期回退日志，因此数据库链路仍未验证。
- `pnpm build`：通过，耗时约 127 秒。
- 工作流鉴权修复后复验（2026-07-17）：`pnpm ts-check`、`pnpm lint --quiet`、`pnpm test`（117 个测试文件、483 个测试）以及 `pnpm build` 均通过；最新生产构建耗时 76 秒。该结果仅证明静态、单元/集成与构建回归通过，不能替代真实账号、存储和模型调用验证。
- `pnpm audit --prod --json`：未验证，镜像端点不存在、官方端点超时，详见 `SECURITY_REPORT.md`。
- 本轮新增回归：`pnpm exec vitest run src/__tests__/lib/operation-audit.test.ts` 为 2/2 通过；`pnpm lint --quiet`（排除自动生成 Playwright 报告后）与 `pnpm ts-check` 通过；`pnpm test` 为 117 个测试文件、483 个测试通过。测试环境没有数据库连接，因此输出中的本地存储回退日志不能作为数据库链路证据。
- 证据留存复验：Playwright 临时输出已移至 `.playwright-output/`，执行 `E2E_RUN_ID=20260717-p0-auth-entry` 的四浏览器匿名入口用例后，归档脚本新增 12 个视频/Trace/截图文件；`test-results/` 同时保留此前 Chromium 登录失败的证据，未再被新运行清空。

## 当前结论

尚未执行本轮要求的全新 Playwright P0真实用户测试，不能将既往手动验证、构建或接口200状态等同于通过。执行完成后在此列出每个浏览器、每个用例和实际任务/下载证据。

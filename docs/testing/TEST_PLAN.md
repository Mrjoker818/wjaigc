# P0真实用户测试计划

## 执行约束

- 测试地址由 `E2E_BASE_URL` 指定，禁止对非授权的外部系统做攻击性测试。远程健康检查命令为 `pnpm run doctor -- --url=https://deployment.example`。
- 仅使用真实登录账户、真实项目和真实模型提供商；测试账户凭据只通过环境变量注入，不写入仓库或报告。
- 生成会产生供应商计费，必须在授权后才设置 `E2E_ENABLE_PAID_GENERATION=true`。
- `E2E_GENERATION_MODEL` 必须填写图像模型下拉框的精确选项值 `providerId::modelId`，不得填写可重复的显示名；执行前需确认该提供商不是已声明跳过的 FHL 或虚宝。
- Playwright 不使用固定长等待：上传、生成和恢复均等待网络响应、元素数量或任务结果。

## P0用例

| 用例 | 验证点 | 证据 | 通过条件 |
| --- | --- | --- | --- |
| P0-AUTH-001 | 登录、刷新会话、退出 | trace、截图、console、network | 登录进入项目；退出后回到登录页 |
| P0-AUTH-ENTRY-001 | 匿名登录入口 | trace、视频、截图、console、network | 选择“无限画布”后显示用户名和密码输入框 |
| P0-HOME-001 | 首页/项目画布加载 | trace、截图 | 页面无白屏，工具栏可交互 |
| P0-UPLOAD-001 | 浏览器文件选择上传 | trace、网络响应、截图 | 实际文件进入画布且数量变化 |
| P0-CANVAS-001 | 选择、拖动、缩放、删除 | trace、截图 | 节点可选、移动、缩放和删除，不抛异常 |
| P0-GEN-001 | 提示词、模型、真实生成 | `/api/generate`响应、任务状态、截图 | 业务成功，结果进入画布 |
| P0-PERSIST-001 | 保存与刷新恢复 | 截图、网络日志 | 刷新后结果存在且归属当前项目 |
| P0-DOWNLOAD-001 | 图片下载 | Playwright download 证据 | 可获得非空文件名下载 |

## 浏览器矩阵

Chromium、Firefox、WebKit、移动 Chromium。四个项目已能启动；任何尚未进入真实业务页面的组合必须写入 `UNVERIFIED_ITEMS.md`。

## 失败证据

`playwright.config.ts` 始终启用 Trace、视频和截图。`tests/helpers/evidence.ts` 额外保存 console 和 network JSON 到 `test-results/`。每次执行还必须在 `REGRESSION_REPORT.md` 写入 Commit、版本、地址、时间、账户类型（不含凭据）和结果。

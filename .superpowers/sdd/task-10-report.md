# Task 10 实现报告

## 当前结论

当前统一状态为 `LOCAL BLOCKED / CLOUD UNVERIFIED`。审查前记录的本地通过数字已被独立审查作废，不作为当前候选证据。未修改或暂存六个用户保护文件，未触碰 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。

## 二次复审

二次复审结论为 `CHANGES REQUIRED`（Critical 0 / Important 4 / Minor 1）：

1. Simple Chat 第二次发送可能复用刷新恢复后的旧 cancelled 卡片。
2. E2E 没有从浏览器 UI 断言 Canvas/Workflow/Simple Chat 为 `30/30/16`。
3. manifest 未强制六类制品，云端 `exactCommit` 未绑定受审候选。
4. 本报告和阶段看板的历史通过数字与后文阻塞状态冲突。
5. 阶段看板规格第 13 节及移动端措辞仍误报通过。

## 本轮实现

- Simple Chat 发送前记录卡片数量和 runId 集合，只接受本次新增且 runId 不同的审批卡；旧 cancelled 卡片不能满足等待条件。
- Canvas Skill 项增加 `data-canvas-skill-id`，Workflow Skill 选项增加 `data-workflow-skill-id`。E2E spec 明确从浏览器 DOM 断言 `30/30/16`。
- evidence validator 要求每个浏览器 manifest 精确包含 `console.json`、`network.json`、`final.png`、`trace.zip`、`video.webm`、`machine-evidence.json`，并继续验证每个文件的字节数与 SHA-256。
- 云端验证要求 `cloud.exactCommit` 与 doctor 传入的预期候选完全一致；doctor 默认使用当前 HEAD，也支持显式 `BRIEF_TO_VIDEO_EXPECTED_EXACT_COMMIT`。

## TDD

- RED：新卡片选择模块不存在；错误的另一个 40 位 commit 仍能通过；E2E spec 缺 Canvas/Workflow 30 项 UI 断言。
- GREEN：相关 helper、evidence、审查合同和两个组件定向测试共 `15/15`；`pnpm exec tsc --noEmit --incremental false` 退出 0。
- 反例明确覆盖：仅声明 machine evidence 的 manifest 失败；字段完整但 `exactCommit` 不等于受审候选时失败。

## 当前阻塞

- 父级已解除隔离数据库、账号、迁移和 feature flag 阻塞，PostgreSQL 专项真实执行 `2/2 PASS`。
- 四浏览器已进入 Canvas 业务链且 Canvas 目录 `30` 均通过；该轮 `0/4`，四项目一致停在 `tests/helpers/brief-to-video.ts:403` 的“画面比例”宽松 label strict-mode 歧义，不能写成浏览器通过。
- 保护门禁仍受三个既有用户保护脏文件阻塞；这些文件未被本任务修改或暂存。
- 未部署云端 exact commit，真实供应商成功/取消、远程 task、退款交易、父版本、MIME、签名、时长、分辨率和制品哈希均未验证。

## 定位器后续修复

- RED：新增 helper 合同要求 Canvas Brief 表单 9 个可访问标签全部使用 `{ exact: true }`，初始为 `1 failed / 2 passed`。
- GREEN：统一收紧 video 模型、创作 Brief、目标受众、传播目标、发布平台、视频时长、画面比例、分辨率和尾帧定位器；旧审查合同同步改为精确匹配，最终定向 `7/7 PASS`。
- `pnpm run ts-check` 退出 0。按父级要求未运行 Playwright 或全仓测试，父级将从真实环境继续矩阵。

## 发布判断

本次只提交 Task 10 二次复审修复。当前不得登记本地发布通过或 `CLOUD PASS / CLOSED`。

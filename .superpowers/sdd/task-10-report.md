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

## 四浏览器业务链后续（本轮）

- 父级使用 `BRIEF_TO_VIDEO_SKILL_ENABLED=true`、`MULTI_PLATFORM_EXPORT_ENABLED=true` 与隔离 PostgreSQL 重新执行真实四浏览器；PostgreSQL 专项保持 `2/2 PASS`，Canvas Skills `30` 已越过。
- 该轮浏览器结果仍为 `0/4`，不得记为通过。Chromium、Firefox、WebKit 在第三种 `first-last-frame` Canvas UI 提交返回 HTTP 500 `SKILL_RUN_ERROR`；mobile-chromium 在第二种 `image-to-video` 前等待 `[data-canvas-image-id]` 15 秒超时。
- trace 证明三次 Canvas POST 的 `sourceVersionIds` 均为空；第三次同时携带未纳入授权来源的 `endFrame=stage4-version-<browser>`，触发严格来源绑定拒绝。原因是 helper 先点击图像、随后 `openCanvasSkill()` 再次导航，清空了选中态。
- 375px 截图与代码证明右侧面板展开宽度为 `min(480px, 100vw)`，画布虚拟化仍按 480px 占用宽度计算，375px 下可用宽度收缩为 1px，因此源图元素未挂载。

### 本轮修复与 TDD

- RED：`canvas-skill-source-inputs` 新增反例，要求显式首帧/尾帧字段并入提交授权列表；helper 合同要求最后一次 Canvas 导航发生在选图前，并要求真实收起面板、按稳定 image id 点击、断言选中、再展开面板。首次定向结果为 `2 failed / 6 passed`。
- GREEN：Canvas 请求从上下文来源和所有 `bindToSourceVersions` 表单值合并、去重来源版本；Task 10 fixture 增加独立受管尾帧 Asset/AssetVersion/Placement；helper 在最后一次导航后收起面板，使 375px 源图重新进入虚拟化可见区，真实点击并确认 `data-canvas-selected=true` 后再展开、激活 Skill，尾帧通过 UI 填入独立版本。
- 定向 Vitest：`src/__tests__/lib/canvas-skill-source-inputs.test.ts`、`src/__tests__/scripts/brief-to-video-helper.test.ts`、`src/__tests__/components/chat-panel-skill-runtime.test.tsx` 共 `13/13 PASS`。
- `pnpm run ts-check` 退出 0。按父级要求未运行 Playwright 或全仓测试；本修复后的四浏览器结果等待父级复跑，当前状态继续为 `LOCAL BLOCKED / CLOUD UNVERIFIED`。

## 来源修复后的真实轮次

- 父级真实四浏览器仍为 `0/4`，不得登记为通过。Chromium、Firefox、WebKit 均已越过 Canvas 图片选择、来源绑定、审批与恢复，事件推进至 `run.resumed` / `tool.started`，随后停在 `run.paused`，`execution-error=SKILL_SUBMISSION_UNKNOWN`，受控 provider submissions 为 0。
- 桌面三项目的原因已确认是父级启动本地环境时遗漏 `DEPLOY_RUN_PORT=5010`：内部 API URL 仍默认指向 5000，而测试服务实际运行于 5010。该项由父级下轮补齐环境变量，不修改业务提交或错误断言。
- mobile-chromium 同样已越过图片选择和来源绑定，但 `assertMobileApprovalExperience` 实测批准、修改、取消控件高度仅 33px，低于规格要求的 40px；这是本轮唯一需要产品代码修复的真实移动 UI 缺陷。

### 移动审批控件修复

- 根因：审批卡使用 Tailwind `min-h-10`（2.5rem），移动环境根字号缩放后实际高度约为 33px，rem 下限不能保证 40px 触控目标。
- RED：组件测试要求批准生成、修改脚本、取消任务三个按钮均具有固定 `min-h-[44px]`，首次结果 `1 failed / 3 passed`，失败值为旧 `min-h-10`。
- GREEN：审批卡主、次操作共享样式改为固定 `min-h-[44px]`；移动端继续采用单列 `grid-cols-1 gap-2`，避免三个控件重叠并保持纵向可达。展开后的“提交修改要求”按钮复用同一主操作样式。
- 定向 Vitest：审批卡、Canvas 接入、Simple Chat 接入共 `9/9 PASS`；`pnpm run ts-check` 退出 0。按要求未运行 Playwright 或全仓测试，44px 的真实移动浏览器结果等待父级复跑。

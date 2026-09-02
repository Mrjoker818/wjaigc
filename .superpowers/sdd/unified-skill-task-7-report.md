# Unified Skill Runtime Task 7 实施报告

## 范围与基线

- 需求源：`.superpowers/sdd/unified-skill-task-7-brief.md`。
- 仓库规则：已读取并遵守 `AGENTS.md`。
- 工作分支：`main`；任务开始时 HEAD 为 `7e1c1b2af9b30cb1d8ee1f24e899edab074e7dd9`，简报基线 `13cf233f` 为其祖先。
- 未修改 Canvas、聊天、节点、simple-chat、Agent Runtime、账务、数据库、stable 或四个既有受保护未跟踪项。

## TDD：RED 记录

1. 首次创建测试后运行：
   `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx`
   结果：RED，测试文件因缺少 `SkillInputFields` 模块而无法解析，确认 production 行为尚不存在。
2. 首次最小实现后运行同一命令：
   结果：3 通过、4 失败；失败来自测试环境没有 jest-dom matcher，以及 required 星号影响精确可访问名称。改为原生 DOM 断言并补显式 `aria-label`。
3. 增加旧请求竞态测试后运行同一命令：
   结果：2 失败、6 通过；旧 start 返回值未隔离，旧 control 错误会污染新 run。随后加入 generation guard。
4. 增加组合 UTF-8 容量测试后运行同一命令：
   结果：1 失败、8 跳过；普通文本跨越组合 512 KiB 边界时仍提交。随后统一所有八类输入的提交容量校验。
5. 根据首轮独立评审增加暂停重试和事件订阅重启测试：
   `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx`
   结果：2 失败、8 通过；暂停态没有重试按钮，resume/retry 后未重启 Agent 事件投影。
6. 增加数据约束、估价并发隔离和 Strict Mode 测试：
   结果：3 失败、10 通过；数据集对象行未校验、旧估价可写回、Strict Mode effect replay 后 mounted 标记错误。
7. 修复后同一命令仍有 1 失败、12 通过：JSON 语法错误透出了引擎英文错误。随后归一为中文可访问错误。
8. 自审补充取消后的订阅重启测试：
   `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx -t "restarts the existing Agent event projection"`
   结果：RED，1 失败、12 跳过；cancel 尚未触发订阅重启。已将成功 cancel 纳入刷新条件，但按用户停止指令未再运行验证。

## GREEN 与门禁记录

- 单文件测试曾依次达到 7/7、8/8、9/9、10/10，完成评审修复后达到 13/13。
- 限定聚焦/回归：
  `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx src/__tests__/components/agent-progress-timeline.test.tsx src/__tests__/components/use-agent-run-events.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skills.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/api/skill-runs.test.ts`
  结果：8 文件、102 测试全部通过。`skill-runs` 的受控 dispatch rejection 用例按设计输出一条 stderr。
- `pnpm ts-check`：首次及修正 mock 参数类型后均通过；中间一次因零参数 mock 的 `mock.calls[][0]` 触发 TS2493，补类型后通过。
- 目标 ESLint：
  `pnpm exec eslint src/components/skill-runtime/SkillInputFields.tsx src/components/skill-runtime/SkillRunProgress.tsx src/components/skill-runtime/use-skill-run.ts src/__tests__/components/skill-runtime-controls.test.tsx --max-warnings 0`
  最后一次已执行结果为通过、0 warning。
- `git diff --check`：通过。
- 保护基线：默认门禁会把四个任务前已存在的未跟踪保护项计入；使用精确临时 allow-path 重跑后，38/38 feature ID 保留、无未授权 source drift、0 warning。
- 未运行全仓 Vitest 或 build，符合用户最后指令。

## 实现摘要

- `SkillInputFields`：覆盖 text、image、images、brand-kit、dataset、select、number、boolean 八类输入；提供标签、required、错误关联、图片数量、数据集对象行/行数、有限数字与组合 UTF-8 512 KiB 约束，并在外部 Skill/values 切换时同步结构化草稿。
- `SkillRunProgress`：展示估价、Agent 投影阶段、进度、步骤、可访问错误，以及暂停、继续、取消、持久化暂停步骤重试按钮；暂停状态不再被 stale 覆盖。
- `useSkillRun`：复用既有 Skill estimate/run/control/retry API 与 `useAgentRunEvents`；通过 AbortController、run/estimate/busy generation 隔离旧响应并清理卸载请求；resume/retry/cancel 成功后重新建立既有 Agent 事件订阅，不创建第二执行状态机。

## 独立评审与自审

- 首轮独立只读评审结论：`CHANGES_REQUESTED; Critical: 0; Important: 8; Minor: 2`。
- 已处理：失败步骤重试状态契约、暂停后事件订阅重启、Strict Mode mounted、旧估价隔离、busy 竞态、accepted=false、数据集/有限数字约束、结构化草稿同步、stale paused 文案。
- 报告缺失项由本文件补齐。
- 自审发现 cancel 也需在 paused 后重启订阅，已补测试并实施最小修复。
- 当前未取得修复后的第二次独立 `APPROVED 0/0/0`；原因是用户要求立即停止测试和代码修改。

## 当前关注项

- 最后一处 cancel 订阅刷新及随后加入的共享错误 generation guard 尚未重新运行测试、TypeScript 和 ESLint。
- 独立复审尚未达到简报要求的 `APPROVED; Critical: 0; Important: 0; Minor: 0`。
- 因以上两点，本次提交应视为 `DONE_WITH_CONCERNS`，不应宣称所有最终门禁已在最终差异上通过。

## 改动文件

- `src/components/skill-runtime/SkillInputFields.tsx`
- `src/components/skill-runtime/SkillRunProgress.tsx`
- `src/components/skill-runtime/use-skill-run.ts`
- `src/__tests__/components/skill-runtime-controls.test.tsx`
- `.superpowers/sdd/unified-skill-task-7-report.md`

## 2026-09-02 审查修复：TDD RED

1. 在 `skill-runtime-controls.test.tsx` 新增 5 组审查回归后运行：
   `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx`
   结果：RED，`6 failed / 12 passed`。六个失败分别证明：无关 `values` 更新会清除
   非法结构化草稿、八类默认值未完整显示/回写、普通暂停误显示重试、提交期间暴露旧
   projection、未从真实执行错误中得出重试语义、缺失 `accepted` 被误判为成功。
2. 首轮最小实现后同命令结果为 `1 failed / 17 passed`。剩余失败来自测试 mock 每次渲染
   构造新 projection，和真实 `useAgentRunEvents` 的稳定 state 引用不符；改用稳定 fixture 后
   达到 `18/18`。
3. 将草稿测试进一步收紧为“父组件重建语义相同的 `fields` 数组仍保留草稿，只有字段定义
   语义变化才同步”后运行：
   `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx -t "preserves invalid structured drafts"`
   结果：RED，`1 failed / 17 skipped`，确认数组引用判断仍会误清除草稿。
4. 将重试语义收紧为权威 `run.paused` 事件合同后运行：
   `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx -t "exact persisted execution-error pause event"`
   结果：RED，`1 failed / 17 skipped`，确认此前 Skill 历史近似判断没有精确消费
   `pauseReason`。
5. 首次运行 `pnpm ts-check` 结果：RED，2 个 TS2345；测试 hoisted mock 把 projection
   推断为字面量 `undefined`。补充显式 `AgentRunProjection | undefined` 测试类型后修复。

## 2026-09-02 审查修复：GREEN 与说明

- 重试合同：核对既有 Agent reducer、pause 服务与 Skill retry 服务后，确认 projection 仅保留
  `resumeFromStepId`，`run.paused` 事件保留 `pauseReason`，retry 只接受 paused 的持久化步骤。
  Hook 现在读取既有 Agent events API，并要求 `runId`、`lastSequence`、`nextStepId` 全部匹配且
  `pauseReason === 'execution-error'` 才暴露 `retryableStepId`。UI 仅在 paused 且该步骤与
  `resumeFromStepId` 相等时显示重试；普通用户暂停和 failed 终态均不显示必然返回 400 的按钮。
- projection 隔离：新提交开始即断开 `eventRunId`；返回值仅在 `runId === eventRunId ===
  events.projection.runId` 时暴露 projection。历史重试语义请求也由 AbortController、generation、
  runId 和 sequence 精确隔离。
- 结构化草稿：images/dataset 只在对应外部有效值变化或字段定义签名变化时同步；无关字段更新、
  语义相同字段数组的新引用不会清除未提交草稿和本地错误，真实外部字段值/定义变化仍会同步。
- 默认值：text、image、images、brand-kit、dataset、select、number、boolean 八类统一采用与服务端
  resolver 相同的 `value ?? defaultValue` 有效值语义，并通过 `onChange` 初始化缺失默认值，避免
  展示、估价和执行输入分叉。
- accepted 合同：control/retry 现在仅在 `result.accepted === true` 时成功和刷新事件订阅；测试分别
  覆盖 `accepted: false` 与字段缺失。
- 收紧草稿同步后的定向 GREEN：`1 passed / 17 skipped`。
- 权威 pause 事件语义定向 GREEN：`1 passed / 17 skipped`。
- 最终单文件 GREEN：`18/18`。

## 2026-09-02 最终验证

- 8 文件聚焦回归：
  `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx src/__tests__/components/agent-progress-timeline.test.tsx src/__tests__/components/use-agent-run-events.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skills.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/api/skill-runs.test.ts`
  结果：`8 files / 107 tests passed`。`skill-runs` 的受控 dispatch rejection 用例保留一条设计内
  stderr。
- `pnpm ts-check`：exit 0，Next route typegen 与 TypeScript 均通过。
- 目标 ESLint：
  `pnpm exec eslint src/components/skill-runtime/SkillInputFields.tsx src/components/skill-runtime/SkillRunProgress.tsx src/components/skill-runtime/use-skill-run.ts src/__tests__/components/skill-runtime-controls.test.tsx --max-warnings 0`
  结果：exit 0，0 warning。
- 保护基线：
  `pnpm check:protected-baseline -- --allow-path .playwright-cli/ --allow-path _refs-asui-canvas/ --allow-path _refs-hero-infinite-canvas/`
  结果：`38/38` feature ID、全部受保护路径及证据合同保留，无未授权 source drift，0 warning。
  三个临时许可精确对应任务前既有未跟踪目录，没有修改永久 allowlist。
- `git diff --check`：exit 0；仅输出工作区既有 LF→CRLF 提示。
- 修改范围仍严格限于四个授权源码/测试文件与本报告；未修改业务接线、Agent Runtime、服务端、
  数据库、账务、simple-chat、chat-panel、node-editor 或 stable，未 push。

## 2026-09-02 剩余关注

- 本轮修复尚未取得全新独立评审的 `APPROVED 0/0/0`；实现与用户指定本地门禁均已完成，Task 7
  的最终独立复审仍由后续控制端执行。

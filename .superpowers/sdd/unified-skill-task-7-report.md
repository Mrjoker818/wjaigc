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

# Unified Skill Runtime Task 7：共享输入与运行进度控件

## 目标

建立供无限画布与节点模式复用的结构化 Skill 输入、运行进度和运行控制 Hook。仅提供展示与 API 客户端状态隔离，不在本任务接入 `chat-panel.tsx` 或 `node-editor.tsx`。

## 基线与边界

- 基线：`main@13cf233f`。
- 新增 `SkillInputFields`、`SkillRunProgress`、`useSkillRun()` 三个共享边界。
- 消费既有 Skill 定义、估价 API、Skill Run API 和 Agent 事件投影；不建立第二状态机、任务表、计费边界或供应商调用。
- 旧 run 的延迟响应不得覆盖新 run；组件卸载后不得写状态或残留轮询。
- 输入控件必须按现有八类字段及约束渲染，保持可访问标签、错误提示和 UTF-8 容量边界。
- 进度必须展示估价、阶段、终态和暂停/继续/取消/从失败步骤重试；不使用固定长 sleep。
- 本任务不迁移 21 个 Canvas Skills，不修改 16 个 Simple Chat Skills，不接工作流节点。
- 不修改 `stable`，不触碰四个受保护未跟踪项，不推送 GitHub。

## 文件

- Create: `src/components/skill-runtime/SkillInputFields.tsx`
- Create: `src/components/skill-runtime/SkillRunProgress.tsx`
- Create: `src/components/skill-runtime/use-skill-run.ts`
- Test: `src/__tests__/components/skill-runtime-controls.test.tsx`
- Report: `.superpowers/sdd/unified-skill-task-7-report.md`

## TDD 与验收

1. 先写 RED：字段类型/标签/错误、估价显示、运行阶段与控制按钮、run 切换旧响应隔离、卸载清理。
2. 最小实现三个共享边界，不复制 Agent Runtime 状态机。
3. 聚焦回归必须包含：
   - `skill-runtime-controls.test.tsx`
   - `agent-progress-timeline.test.tsx`
   - `use-agent-run-events.test.ts`
   - Skill input/parser 与 API 合同回归
4. TypeScript、目标 ESLint、保护基线和 diff-check 通过。
5. 全新独立评审 `APPROVED` 且 Critical/Important/Minor `0/0/0` 后才标记 Task 7 完成。

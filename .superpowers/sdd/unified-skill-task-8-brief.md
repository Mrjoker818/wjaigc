# Unified Skill Runtime Task 8：无限画布 21 Skills 接入

## 目标

将无限画布 AI 对话中的 21 个 Canvas Skills 从组件内嵌目录和普通聊天触发路径迁入统一 Skill 运行内核，同时保留现有搜索、推荐、我的 Skills、保存为 Skill、服务器同步和普通聊天能力。

## 基线与边界

- 基线：`main@97d1e401`。
- Canvas 目录只能请求 `GET /api/skills?surface=canvas`，完整显示 21 个内置 Skill；不得读取或展示 16 个 Simple Chat Skills。
- 使用 Task 7 的 `SkillInputFields`、`SkillRunProgress`、`useSkillRun()`，不得在 `chat-panel.tsx` 建立第二套运行状态、轮询、计费或供应商调用。
- Skill 运行结果必须作为新的资产版本加入画布，保留 `parentVersionIds`，不得覆盖来源图片；失败、取消或迟到结果不得加入画布。
- 保留搜索、推荐、我的 Skills、保存为 Skill、启停/删除及服务器同步入口；旧 `chat_skills` 仅由既有兼容迁移器读取，组件不再直接维护第二套目录真相。
- 普通聊天、Agent、图像生成、参考图和现有画布任务恢复不得回归。
- 本任务不修改节点模式；Task 9 才接 `ai-skill` 节点。
- 本任务不修改 `/simple-chat` 页面及其 16 个 Skills。
- 不修改 `stable`，不触碰四个受保护未跟踪项，不推送 GitHub。

## 文件

- Modify: `src/components/chat-panel.tsx`
- Create: `src/lib/skill-runtime/canvas-client.ts`
- Test: `src/__tests__/components/chat-panel-skill-runtime.test.tsx`
- Test: `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`
- Update: `src/__tests__/lib/skill-runtime-catalog.test.ts`（将 Task 1 的旧直接导入断言迁移为 Task 8 的 API 唯一目录合同）
- Report: `.superpowers/sdd/unified-skill-task-8-report.md`

## TDD 与验收

1. 先写 RED：只请求 canvas 目录、完整 21 项、无内嵌目录、结构化输入/估价/运行/控制、结果新版本入画布、零覆盖、旧响应隔离、16 项 Simple Chat 不可见。
2. 最小实现目录客户端和画布聊天接线；复用现有 API、共享组件和资产投影，不复制运行内核。
3. 保留现有搜索/推荐/我的 Skills/保存/服务器同步及普通聊天行为，并加入永久回归。
4. 聚焦回归必须包含：
   - `chat-panel-skill-runtime.test.tsx`
   - `chat-panel-skill-catalog-contract.test.ts`
   - `chat-panel-generation-recovery-contract.test.ts`
   - `agent-runtime-surface-wiring.test.ts`
   - Task 7 共享控件测试和 21/16 目录隔离测试
   - 更新后的旧目录合同不得要求 `chat-panel.tsx` 直接导入预设；必须验证 Canvas API 客户端和 21/16 surface 隔离
5. TypeScript、目标 ESLint、保护基线和 diff-check 通过。
6. 全新独立评审 `APPROVED` 且 Critical/Important/Minor `0/0/0` 后才标记 Task 8 完成。

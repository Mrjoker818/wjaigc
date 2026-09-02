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
- Fix: `src/lib/skill-runtime/step-registry.ts`（把运行开始时冻结的 `sourceVersionIds` 传入权威资产投影父链）
- Fix: `src/components/canvas-workspace.tsx`（以稳定的 `runId + assetVersionId` 接收结果，保留来源追踪并阻止迟到/重复 placement）
- Fix: `src/lib/skill-runtime/storage.ts`、`src/app/api/skills/route.ts`、`src/app/api/skills/[skillId]/route.ts`（恢复独立保存对话 Skill、可管理 disabled 项和真实删除/批量一致性）
- Test: 可新增或更新对应组件、API、storage、step-registry 行为测试；源码字符串断言只能作为架构辅助，不能替代交互、竞态、持久化和 lineage 行为证据
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

## 独立审查修复门禁

- 输出资产版本必须在服务端权威投影中保存冻结的 `parentVersionIds`；画布 placement 与 CanvasImage 必须保留可恢复的来源追踪。
- 关闭/切换 Skill、切换项目或 effect 重入后，已发出的旧投影不得插入；同一 `runId + assetVersionId` 只能产生一个 placement/节点。
- “保存当前对话为 Skill”不得依赖先选择模板，不得覆盖同一模板的旧副本；连续保存必须得到两个可持久恢复的独立 Skill。
- disabled 用户 Skill 刷新后仍须在管理目录可见并可重新启用；删除必须有明确服务端合同；批量清空不得以高并发 CAS 留下本地与服务器不一致。
- `WorkspaceSourceTrace` 必须支持受校验的 Canvas Skill 来源（runId、Skill ID/版本、冻结的 sourceVersionIds、时间），并能经资产解析、transfer、CanvasImage 和刷新恢复往返；不得把私有 metadata 字段冒充公开可恢复 trace。
- 开始新 Skill Run 时必须在等待 POST 之前取消旧投影；新 Run 启动成功或失败都不得让旧 Run 在等待窗口插入。
- owner-scoped 用户 Skill 必须由服务端按真实用户、surface、enabled、version 授权并冻结其自身定义；不得在 ChatPanel 或服务端替换成内置 sourceSkill 模板执行。estimate、create、retry/restore 继续使用统一运行时和冻结快照。

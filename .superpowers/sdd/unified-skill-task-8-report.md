# Unified Skill Runtime Task 8 实施报告

## 结论

已将无限画布 AI 对话中的 Canvas Skills 从组件内嵌目录和普通聊天触发路径迁移到统一 Skill 运行时。组件只请求 `GET /api/skills?surface=canvas`，复用 Task 7 的 `SkillInputFields`、`SkillRunProgress` 和 `useSkillRun()`，并通过权威运行历史与资产版本查询把完成结果作为新节点加入画布。

执行基线：用户指定的 `main@d9263477a352b97b8403c937fc56f09418235698`。

交付状态为 `DONE_WITH_CONCERNS`：第三轮最终独立复审命令被用户中断，未取得简报要求的最终 `APPROVED Critical/Important/Minor 0/0/0`；中断后按用户要求未再运行测试。

## TDD 记录

### 初始 RED

先创建以下两份测试，再创建客户端或修改实现：

- `src/__tests__/components/chat-panel-skill-runtime.test.tsx`
- `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`

命令：

```text
pnpm exec vitest run src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts
```

结果：`2 files failed / 4 tests failed`。失败原因符合预期：`chat-panel.tsx` 仍直接维护内嵌 Canvas 目录，并把 Skill 注入普通聊天路径；共享 Task 7 控件、运行钩子和 Canvas 目录客户端均不存在。

补充客户端行为合同后再次 RED：目录测试因 `canvas-client.ts` 尚不存在而加载失败，运行时接线测试继续失败。

### 评审驱动 RED/GREEN

1. 关闭 Skill 与投影去重竞态：新增断言后 `2/2` RED；统一 teardown、成功后标记投影后 `2/2` GREEN。
2. 普通聊天真实切片、orchestrator 绑定、来源节点快照、严格目录校验：新增断言后 `2 tests failed / 8 passed`；实现后 `10/10` GREEN。
3. 保存副本与删除本地移除：新增断言后 `1/2` RED；实现后目标测试 GREEN。
4. 用户副本通过 `sourceSkillId` 对应内置版本执行、批量清空 teardown：新增断言后 `1/2` RED；实现后 `2/2` GREEN。

## 实现摘要

- Canvas 目录只经 `/api/skills?surface=canvas` 加载，并在客户端再次过滤 `allowedSurfaces`；不再直接导入 21 项预设，不读取或写入 `chat_skills`。
- 保留搜索、推荐、我的 Skills、保存副本、启停、删除/清空和服务器同步入口；保存操作使用既有 POST copy + PATCH 合同，并把最近对话摘要写入描述。
- 普通聊天 `handleSend` 不再读取活动 Skill 或触发 Skill 图像生成；Skill 仅通过结构化输入、估价和共享运行时启动。
- 请求冻结 `surface`、Skill 版本、结构化输入、模型绑定与 `sourceVersionIds`；orchestrator 始终绑定。
- “我的 Skills”副本通过 `sourceSkillId` 找到内置源定义及其版本执行，避免统一运行时拒绝用户副本 ID。
- 完成投影重新读取 `/api/skill-runs/{runId}`，只接受同一 `runId` 的 `completed` 状态，再逐个解析 `/api/assets` 权威资产引用。
- 排除所有来源版本；按资产版本去重；保存运行开始时的来源节点 ID；切换 Skill、项目或运行时终止旧投影；失败最多自动重试一次；取消、失败、暂停和迟到响应均不加入画布。
- 未连接节点模式，未修改 Simple Chat、Agent Runtime、服务端 Skill API、数据库、计费、供应商或 `stable`。

## 验证结果

简报限定回归命令：

```text
pnpm exec vitest run src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/agent-runtime-surface-wiring.test.ts src/__tests__/components/skill-runtime-controls.test.tsx src/__tests__/api/skills.test.ts --reporter=dot
```

结果：`6 files passed / 54 tests passed`。

其他验证：

```text
pnpm ts-check
pnpm exec eslint src/lib/skill-runtime/canvas-client.ts src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts --max-warnings 0
pnpm exec eslint src/components/chat-panel.tsx
git diff --check
```

结果：

- `ts-check` 通过。
- 新客户端与两份目标测试 ESLint：零 error、零 warning。
- `chat-panel.tsx` ESLint：零 error、50 条既有 warning。
- `git diff --check` 通过。
- 中断后的最后两处小改动仅重跑 `chat-panel-skill-runtime.test.tsx`，结果 `2/2` 通过；依用户要求未重跑上述整组命令。

Task 7 目录测试 `src/__tests__/lib/skill-runtime-catalog.test.ts` 的 21/16 隔离、预设基线和 403/404 合同共 6 项通过；唯一失败项仍要求 `chat-panel.tsx` 直接导入 `CANVAS_PRESET_CHAT_SKILLS`，与 Task 8 “组件不再直接维护目录真相”要求冲突，且该旧测试不在允许修改文件中。

## 独立评审

- 第一轮：`Important 5 / Minor 1`；已修复 orchestrator 绑定、投影时序/来源快照、空断言和严格目录校验。保存与删除按现有服务端合同收敛。
- 第二轮：`Important 1 / Minor 1`；已修复用户副本源定义执行和批量清空 teardown。
- 第三轮：启动全新静态复审，但 `codex exec` 在约 24 秒时被用户中断，未返回结论。没有把 Task 8 标记为满足最终 APPROVED 门槛。

## 改动文件

- `src/components/chat-panel.tsx`
- `src/lib/skill-runtime/canvas-client.ts`
- `src/__tests__/components/chat-panel-skill-runtime.test.tsx`
- `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`
- `.superpowers/sdd/unified-skill-task-8-report.md`

## 自审

- 变更严格限制在简报允许的五个文件。
- 四个既有未跟踪保护项保持未改动。
- 未运行全仓 Vitest 或 build，未推送远端。
- 已检查组件中不存在 `CANVAS_PRESET_CHAT_SKILLS`、`SIMPLE_CHAT_PRESET_SKILLS`、`chat_skills`、`surface=simple-chat` 或节点模式接线。
- 已知关注项：最终独立复审未完成；最后两处修复后没有再次执行整组限定回归与 TypeScript 检查。

## 旧目录合同迁移（HEAD 09ad037c）

控制端更新 Task 8 简报后，精确授权迁移 `src/__tests__/lib/skill-runtime-catalog.test.ts` 中遗留的 Task 1 组件接线断言。本次只修改该测试并追加本报告，没有修改生产代码。

### RED

在修改测试前运行：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts --reporter=verbose
```

结果：`1 file failed / 1 failed / 6 passed`。唯一失败项要求 `chat-panel.tsx` 直接导入 `CANVAS_PRESET_CHAT_SKILLS` 并声明 `LOVART_PRESET_SKILLS`；其余 21 个 Canvas、16 个 Simple Chat、surface 隔离、预设基线和 403/404 合同全部通过。

### GREEN

将最后一项迁移为 Task 8 API 唯一目录合同后，再次运行同一命令：`1 file passed / 7 tests passed`。新断言验证：

- `chat-panel.tsx` 通过 `@/lib/skill-runtime/canvas-client` 接入目录。
- 客户端使用精确路径 `/api/skills?surface=canvas`。
- `chat-panel.tsx` 不直接包含 `CANVAS_PRESET_CHAT_SKILLS`。
- `chat-panel.tsx` 不包含 `LOVART_PRESET_SKILLS` 内嵌目录。

完整限定回归：

```text
pnpm exec vitest run src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/agent-runtime-surface-wiring.test.ts src/__tests__/components/skill-runtime-controls.test.tsx src/__tests__/api/skills.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts --reporter=verbose
```

结果：`7 files passed / 61 tests passed`。

附加验收结果：

- `pnpm ts-check`：通过。
- 目标 ESLint（`chat-panel.tsx`、`canvas-client.ts`、两份 Task 8 测试及迁移后的旧目录测试）：零 error；仅 `chat-panel.tsx` 保留 50 条既有 warning。
- `pnpm exec eslint src/__tests__/lib/skill-runtime-catalog.test.ts --max-warnings 0`：通过，零 warning。
- `git diff --check`：通过。
- `git diff --name-only HEAD`：仅本次授权的旧目录测试与本报告。
- 保护基线：`HEAD` 起点为 `09ad037cde057dca4887673a08e912476d538f3a`；四个既有未跟踪项仍保持未跟踪且未纳入变更。

### 范围与待审

- 本次变更文件仅为 `src/__tests__/lib/skill-runtime-catalog.test.ts` 与本报告。
- 四个既有未跟踪保护项保持不变。
- 未运行全仓 Vitest 或 build，未推送远端。
- 状态保持 `DONE_WITH_CONCERNS`，等待全新独立审查。

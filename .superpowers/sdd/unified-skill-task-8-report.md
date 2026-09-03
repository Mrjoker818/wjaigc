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

## 第二轮独立审查修复波次（基于 HEAD 1cea42e2）

### 审查发现

第二轮复审仍报告 `Important 3 / Minor 1`：Canvas Skill 产物缺少公开且可恢复的来源追踪；新 Run 在等待创建请求期间仍可能接收旧 Run 的迟到投影；owner-scoped 对话 Skill 会被替换为来源内置模板执行；关键行为测试仍需补强。

### RED 与最小修复

- 新增 Canvas Skill `WorkspaceSourceTrace` 解析、拒绝非法输入、冻结来源版本及资产往返测试；修复前无法从权威资产版本、placement 和刷新恢复后的 CanvasImage 找回运行来源。
- 新增启动竞态测试；修复前旧投影只在新 Run POST 返回后才取消，等待窗口内仍可能插入旧结果。
- 新增 owner-scoped Skill 解析、估价与运行请求测试；修复前 ChatPanel 使用 `sourceSkillId` 对应的内置模板，用户保存的独立步骤定义不会执行。
- 新增 Simple Chat 来源追踪兼容回归，确保扩展联合类型后，独立智能对话仍只接受 `simple-chat` 来源。

实现保持最小边界：

- 服务端按 `actorUserId + skillId + surface + enabled + version` 解析用户 Skill，估价、创建和恢复继续使用统一运行时及冻结快照。
- ChatPanel 直接提交当前 owner-scoped Skill；不再把用户 Skill 映射回内置来源模板。
- `startCanvasSkillRun` 在等待创建请求之前取消旧投影；成功后只激活新 Run，失败时旧 Run 也不能恢复插入。
- Canvas Skill 来源追踪经任务提交、权威资产投影、版本 metadata、placement metadata、资产查询、transfer 与 CanvasImage 水合完整往返；Simple Chat 来源类型保持独立。

### 最新验证证据

Task 1-8 扩展回归覆盖 22 个测试文件：

```text
Test Files  22 passed (22)
Tests       248 passed (248)
```

附加门禁：

- `pnpm ts-check`：通过，零 TypeScript 错误。
- 26 个新增/变更小文件 ESLint `--max-warnings=0`：通过，零 error、零 warning。
- `src/components/chat-panel.tsx` ESLint：零 error；保留 50 条既有 warning。
- `pnpm check:protected-baseline`（显式排除四个既有未跟踪保护项）：38 项能力、组件路径、证据合同和 Git refs 全部通过，零 warning。
- `git diff --check 1cea42e2`：通过；仅报告 Windows 工作区 LF/CRLF 提示，无空白错误。
- `origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`；未修改、未推送。

### 当前状态

三项 Important 已有对应行为测试并转绿，Minor 所指测试缺口已由运行竞态、用户 Skill 授权、来源追踪和 Simple Chat 隔离回归补齐。Task 8 在取得全新独立复审 `APPROVED / 0-0-0` 前仍保持 `DONE_WITH_CONCERNS`，不提前进入 Task 9。

## 独立审查修复波次（HEAD 7195a739）

### 审查结论与范围

针对 `unified-skill-task-8-review.md` 的 `Important 4 / Minor 1` 完成修复。生产改动限于更新后简报授权的 ChatPanel、CanvasWorkspace、canvas-client、step-registry、Skill storage 与 Skills API；未修改 Simple Chat、node-editor/workflow、stable、账务、供应商和四个既有未跟踪保护项。

### RED 证据

先新增真实行为测试，再修改生产实现：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-step-registry-lineage.test.ts src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts --reporter=verbose
```

结果：`4 files failed / 7 tests failed / 31 passed`。失败分别证明：生成任务没有冻结父版本、投影 pending/取消协调器不存在、对话 Skill 独立创建与持久删除不存在、POST 对话创建和 DELETE API 不存在。

补充稳定 transfer 行为测试首次运行：`1 failed / 10 passed`，失败原因为 `transferCanvasSkillAsset` 不存在。补充串行批量删除 deferred 测试首次运行：`1 failed / 11 passed`，失败原因为 `deleteCanvasSkillsSequentially` 不存在。

RTL 保存交互首次执行因项目未安装 jest-dom matcher 而失败（`Invalid Chai property: toBeDisabled`）；改为读取原生 `HTMLButtonElement.disabled` 后通过，该次失败属于测试写法而非产品 RED。

### GREEN 实现

- step-registry 在下游生成任务执行前，把运行开始时冻结的 `sourceVersionIds` 合并写入任务 `submissionPayload.assetParentVersionIds`；写入失败即终止，权威资产投影由此生成 `parentVersionIds`。
- canvas-client 新增稳定身份 `canvas-skill:{runId}:{assetVersionId}`、服务端 `/api/assets/transfer` 调用和投影协调器。协调器在调用前登记 pending，重复 effect 不再发起第二次调用，失败释放 claim；关闭/切换 Skill、切换项目或新 run 会 abort 旧信号，迟到回调不能插入节点。
- CanvasWorkspace 将同一稳定身份同时作为 transfer `entityId` 和 `idempotencyKey`，由资产服务端幂等合同保证单 placement；metadata 保存 `runId`、冻结的 `sourceVersionIds` 及已有 `sourceTrace`，CanvasImage 继续保存权威 reference 的 `sourceTrace`，项目和 abort 信号在插入前再次校验，不覆盖来源节点。
- 保存当前对话不再要求 activeSkill；POST 创建新的随机 owner-scoped Skill，保存最近对话上下文，每次得到独立 ID，并通过版本化 Skill 信封持久化。
- 目录读取保留 surface 隔离，同时返回 disabled 用户 Skill，刷新后仍能管理和重新启用；DELETE 真实移除服务端记录。批量清空严格串行，任一失败停止后续请求，并重新加载权威目录；单项启停/删除失败也重载。
- 新增 RTL 保存表单交互、API POST/DELETE、storage 连续保存/disabled/删除、step-registry lineage、deferred pending/取消/重入、稳定 transfer 与串行删除行为测试。既有源码测试仅保留共享控件、目录边界和普通聊天隔离等架构辅助断言。

### 验证结果

最终 Task1-8 限定回归（17 个 Skill Runtime API/lib/component 文件，不含全仓测试）：

```text
pnpm exec vitest run [8 个 skill-runtime lib 测试] [3 个 Skill API 测试] [6 个目标组件测试] --reporter=dot
```

结果：`17 files passed / 180 tests passed`。其中包括 Task7 共享控件、21/16 catalog isolation、Task8 lineage/storage/API/RTL/deferred 竞态及普通聊天生成恢复回归。

其他门禁：

- `pnpm ts-check`：通过。
- 非巨型目标文件 ESLint `--max-warnings 0`：通过，零 error、零 warning。
- `chat-panel.tsx` 与 `canvas-workspace.tsx` 目标 ESLint：通过，零 error；共 57 条既有 warning。
- `git diff --check`：通过。
- 动态 PowerShell 文件数组首次被 Vitest 解析为单一 filter，返回 `No test files found`；随后改用显式 17 文件命令并取得 180/180 通过。
- `pnpm check:protected-baseline`：38 个 feature IDs、组件路径、evidence contracts 和 Git refs 全部 PASS；最终被四个简报指定的既有未跟踪保护项扫描阻塞，共报告 42347 个 unapproved drift。未删除、修改或暂存这些保护项。

### 本波改动文件

- `src/components/chat-panel.tsx`
- `src/components/canvas-workspace.tsx`
- `src/lib/skill-runtime/canvas-client.ts`
- `src/lib/skill-runtime/step-registry.ts`
- `src/lib/skill-runtime/storage.ts`
- `src/app/api/skills/route.ts`
- `src/app/api/skills/[skillId]/route.ts`
- `src/__tests__/components/chat-panel-skill-runtime.test.tsx`
- `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`
- `src/__tests__/components/chat-panel-skill-management.test.tsx`
- `src/__tests__/lib/skill-runtime-step-registry-lineage.test.ts`
- `src/__tests__/lib/skill-runtime-storage.test.ts`
- `src/__tests__/api/skills.test.ts`
- `.superpowers/sdd/unified-skill-task-8-report.md`

### 自审与待审

四项 Important 均有对应真实行为测试并转绿，Minor 的关键源码字符串断言已由 RTL/API/storage/step-registry/deferred 测试补强。未运行全仓 Vitest 或 build，未 push。交付仍标记 `DONE_WITH_CONCERNS`：保护基线脚本受既有未跟踪保护项阻塞，且按简报需等待新的独立复审结论。

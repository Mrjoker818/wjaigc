# Unified Skill Runtime Task 5 报告

## 范围

- 基线：`main@1fd49be8087f2ee538b91a14a9284a96864a5c6e`
- 实现模型角色的服务端授权与 `providerId + modelId` 冻结。
- 实现逐步骤只读费用预估及 `POST /api/skill-runs/estimate`。
- Skill Run 创建前服务端重新报价，并只通过既有 Agent Runtime / `createBillableTask` 账务边界创建任务。
- 未实现 Task 6 执行器、Skill Run UI 或 21 个画布 Skills 的执行迁移。

## RED

首次只新增测试后运行：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts
```

结果：退出 1，2 个测试文件均在收集阶段按预期失败：

- `Cannot find module '@/lib/skill-runtime/run-request'`
- `Cannot find module '@/app/api/skill-runs/estimate/route'`

这证明 RED 来自 Task 5 模块尚不存在，而不是测试断言或语法错误。

首次实现后的迭代运行中，API 与 Agent Runtime 53 项通过；库测试因缺少仓库惯用的 `server-only` Vitest mock 而收集失败。补齐测试环境 mock 后，真实行为测试运行，59/60 通过；唯一失败是 create 测试未注入资产授权依赖，尝试访问未配置 PostgreSQL。补入授权测试桩后进入 GREEN，同时锁定资产授权早于报价。

## GREEN

最终聚焦命令：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-admission-gate.test.ts src/__tests__/api/agent-runs.test.ts
```

结果：退出 0，4 个文件、65 项测试全部通过。

覆盖的关键契约：

- 画布 Skill 只允许 `canvas/workflow`；伪造到 `simple-chat` 时在模型解析、资产授权、报价和任务创建前返回 403。
- 16 个 Simple Chat Skills 继续只允许 `simple-chat`，并映射到 Agent Runtime 的 `chat` workspace。
- orchestrator/image 等每个实际角色都必须提供绑定，逐角色调用 `resolveTaskModel(providerId, modelId, actorUserId)`，并按角色能力 fail closed。
- 冻结值来自服务端授权后的模型描述符；额外客户端绑定不会进入冻结请求。
- estimate 先授权项目、工作区及 Asset Version 上下文，再按步骤调用 `calculateConfiguredCreditCost`；不调用 Agent Runtime 或 `createBillableTask`。
- 客户端 `creditCost/billingQuote` 不参与报价；create 路径重新计算总价后以服务端 `billingQuote` 调用 Agent Runtime。
- Agent Runtime 收到服务端报价时不再次改价，仍由现有 `createBillableTask` 建立唯一账务边界；既有 pause/resume/retry 路径未增加扣费调用。

## 回归

Task 1-4 兼容回归：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts src/__tests__/integration/skill-runtime-storage-postgres.test.ts src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/components/use-agent-run-events.test.ts
```

结果：退出 0；10 个文件通过、1 个文件跳过；167 项通过、2 项 PostgreSQL 测试跳过。

其他验证：

- `pnpm ts-check`：退出 0。
- 目标 ESLint（8 个改动文件）：退出 0，0 error，0 warning。
- `git diff --check`：退出 0，仅显示仓库既有 LF/CRLF 转换提示，无 whitespace error。

## 风险

- 当前 16 个 Simple Chat Skill 定义没有步骤，因此严格按 brief 的“逐步骤求和”算法估价为 0；Task 6 若赋予这些 Skill 可计费步骤，报价会随定义自动计算。Task 5 未提前修改目录或执行器语义。
- estimate 与 create 都会执行 Asset Version 授权；create 随后进入 Agent Runtime 时还会再次执行其既有上下文授权。这是有意的 fail-closed 双重检查，代价是一次额外只读授权查询。
- 未进行真实供应商调用或真实积分扣费，以免产生外部费用；模型授权、能力和账务边界由依赖注入测试覆盖。

## 未验证项

- `PGDATABASE_URL`、`DATABASE_URL`、`POSTGRES_TEST_DATABASE_URL` 均未设置。`src/__tests__/integration/skill-runtime-storage-postgres.test.ts` 的 2 项隔离 PostgreSQL 测试明确 SKIP，未验证真实 PostgreSQL 环境。
- 未执行 Task 6 Skill 步骤执行、UI 或云端端到端流程；这些均在本任务明确禁区之外。

## 自审

- 新模块未导入或调用 `createBillableTask`、积分流水或任务状态迁移；唯一创建调用是 `createAgentRun(...billingQuote)`。
- 请求构建顺序为 surface/version/input 校验、逐角色模型授权、资产授权、报价、Agent Runtime 创建；所有可预见的权限和能力错误都发生在扣费前。
- 未修改 `stable`，未 push，未触碰或暂存任务开始前已有的四个保护未跟踪项：`.playwright-cli/`、`_refs-asui-canvas/`、`_refs-hero-infinite-canvas/`、`docs/superpowers/plans/2026-08-02-provider-generation-video-reliability.md`。

## 独立复审修复（2026-09-02）

### RED

在任何生产代码修改前新增复审覆盖并运行：

```text
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-tools.test.ts
```

结果：退出 1；4 个文件均正常收集，88 项中 78 项通过、10 项按预期失败：

- 公共 Agent Runtime service 接受了映射到 `chat` 的画布 Skill，且已经走到任务创建。
- 公共 service 接受额外 `video` binding，并接受与服务端 Skill 定义不一致的 prompt 快照。
- 直接 service 调用接受 UTF-8 体积超过 32,000 bytes 的 prompt。
- `buildSkillAgentRunRequest` 接受实际角色集合之外的已知额外角色。
- 同项目但仅放置于另一 workspace 的 source Asset Version 被授权。
- 零步骤 Simple Chat Skill 的 estimate/create 报价为 0，没有调用 orchestrator 基础费用计算。
- estimate 未知异常响应没有 `x-request-id`，仍返回内部异常消息结构。

所有失败都来自复审指出的行为缺失，不是测试语法、模块加载或环境错误。

实现首轮 GREEN 后又补了两次窄 RED：

- estimate 已知 `SKILL_INPUT_REQUIRED` 异常仍返回 500；单文件运行 8 项中 7 通过、1 失败。修复为按既有业务 code 返回统一 400 envelope。
- 合法 Skill 可直接通过公共 Agent Runtime 使用普通 `agent_edit` 单价，绕过 Skill 同一报价；定向运行 54 项中 1 失败、53 跳过，实际调用为 `agent_edit` 而预期为 orchestrator `chat`。随后把 Skill 重报价收口到 Agent Runtime service。

### GREEN

最终复审聚焦命令：

```text
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/lib/agent-runtime-admission-gate.test.ts
```

结果：退出 0；5 个文件、96 项全部通过。

关键修复：

- 所有携带 `request.skill` 的请求在 Agent Runtime service 统一执行目录 surface/version、规范化 inputs/prompt/tools、精确 model role 集合及逐角色模型能力授权，早于上下文授权、报价和 `createBillableTask`。
- `chat` 只映射 16 个 `simple-chat` Skills；`canvas/workflow` 只接受 21 个画布 Skills。公共 Agent 请求伪造画布 Skill 到 chat 时，模型解析、费用计算和任务创建调用均为 0。
- model bindings 缺失、额外、未知角色均通过精确集合 fail closed；服务端授权结果与请求冻结快照不一致时拒绝。
- source Asset Version 除 actor/project 外，还必须存在匹配 workspace kind、workspaceId、versionId 的 active placement；同项目跨 workspace 拒绝发生在报价和任务创建前。
- 零步骤 Simple Chat Skill 合成且仅合成一个 orchestrator `chat` 计费步骤；若未来目录已有 orchestrator step，则不重复合成。estimate、Skill create 与公共 Agent service 均使用同一估价器；客户端费用字段无效。
- compile 后 prompt 与直接 service prompt 均按 UTF-8 32,000 bytes 上限拒绝，且发生在授权、报价、任务创建前。
- estimate 未知异常固定返回 `SKILL_RUN_ERROR / Skill run request failed`、`requestId`、`x-request-id` 与统一错误结构，不泄漏内部消息；已知业务 code/status 保留。

### 回归

brief 指定聚焦命令：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-admission-gate.test.ts
```

结果：退出 0；3 个文件、22 项全部通过。

Task 1-4、21/16 目录隔离、Asset/Agent Runtime 与 Task 4 pause/resume/retry fences 回归：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts src/__tests__/integration/skill-runtime-storage-postgres.test.ts src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/components/use-agent-run-events.test.ts src/__tests__/lib/agent-runtime-tools.test.ts
```

结果：退出 0；11 个文件通过、1 个文件跳过；193 项通过、2 项 PostgreSQL 测试跳过。

其他验证：

- `pnpm ts-check`：退出 0。
- 目标 ESLint（11 个本次 TypeScript 改动文件）：退出 0，0 error，0 warning。
- `git diff --check`：退出 0；仅 LF/CRLF 转换提示，无 whitespace error。

### 风险

- Skill create 入口先生成服务端报价，Agent Runtime service 在唯一账务边界前再次按冻结 Skill 快照重算并采用该报价；这是有意的双重只读计算，用于阻断公共入口和内部调用绕过，代价是 create 路径会重复执行费用配置读取。
- Asset workspace 授权新增 active placement 查询；真实数据库索引和查询计划未在本地无 PG 环境下测量。
- 未进行真实供应商调用或真实积分扣费；模型授权、报价与唯一 `createBillableTask` 边界由依赖注入测试验证。

### 未验证项

- `PGDATABASE_URL`、`DATABASE_URL`、`POSTGRES_TEST_DATABASE_URL` 均未设置；2 项 PostgreSQL 集成测试明确 SKIP，未验证真实数据库 placement 查询。
- 未执行 Task 6 执行器、Skill UI、21 个 Skills 执行迁移或云端端到端流程，符合本次边界。

### 复审自审

- 未新增第二套任务、扣费或状态机；Skill 报价最终仍只进入既有 Agent Runtime `createBillableTask`。
- pause/resume/retry 路径未增加费用计算或扣费；Task 4 fences 回归通过。
- 未修改 `stable`，未 push，未触碰或暂存四个保护未跟踪项。

## 第二轮复审修复（2026-09-02）

### RED

先仅新增直接 service 回归测试并运行：

```text
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts -t "normalized|oversized raw prompt"
```

结果：退出 1；2 项执行、2 项按预期失败，54 项跳过：

- `40,001` 个空格加 `x` 与规范化 `x` 产生不同 `requestDigest`，证明原始超限 prompt 仍进入任务幂等身份。
- 正常前后空白 prompt 原样进入上下文授权，且未统一为后续 `run.created` 执行数据使用的规范化值。

失败来自 `createRun()` 调用 `readAgentPrompt()` 后丢弃返回值，符合本轮问题，不是测试或环境错误。

### GREEN

最小实现是在 `createRun()` 入口构造一次规范化 `AgentRunRequest`，随后 Skill 准入、上下文授权、模型与工具授权、费用、`requestDigest`、任务字段和 `run.created` 均只使用该对象。未改变摘要算法，也未创建第二种幂等身份。

定向 GREEN：

```text
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts -t "normalized|oversized raw prompt"
```

结果：退出 0；2 项通过，54 项跳过。

Task 5 最终聚焦：

```text
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/lib/agent-runtime-admission-gate.test.ts
```

结果：退出 0；5 个文件、98 项全部通过。

### 回归

Task 1-4、21/16 隔离和 Task 4 pause/resume/retry fences 回归：退出 0；11 个文件通过、1 个 PostgreSQL 文件跳过；195 项通过、2 项跳过。

其他验证：

- `pnpm ts-check`：退出 0。
- 目标 ESLint（`service.ts` 与 `agent-runs.test.ts`）：退出 0，0 error，0 warning。
- `git diff --check`：退出 0；仅 LF/CRLF 转换提示，无 whitespace error。

### 风险

- `readAgentPrompt()` 的既有语义仍是先 trim 再按规范化 UTF-8 bytes 校验；原始超长空白输入会被接受为短规范化 prompt，但原始值不再进入授权、摘要或持久事件。这是本轮明确要求的统一规范化行为。
- 未执行真实 Agent 执行器或供应商调用；`run.created` 是当前后续执行使用的持久请求数据，本轮通过其 payload 与 digest 一致性验证。

### 未验证项

- `PGDATABASE_URL`、`DATABASE_URL`、`POSTGRES_TEST_DATABASE_URL` 均未设置；2 项 PostgreSQL 集成测试明确 SKIP。
- 未扩展 Task 6、UI 或 Skill 迁移范围。

### 自审

- 调用方传入对象未被修改；`createRun()` 内部只生成一个规范化请求对象。
- 相同规范化 prompt 生成相同 `requestDigest`，`run.created` 和上下文授权均使用同一 prompt。
- 未修改 `stable`，未 push，未触碰或暂存四个保护未跟踪项。

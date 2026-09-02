# Unified Skill Runtime Task 6 报告

## 范围

- 基线：`main@ed2ed997edbf26bcc764cf339c9f991dbae523e6`。
- 新增数据库幂等 Skill 步骤执行器、Skill Run 服务和 create/list/get/pause/resume/cancel/retry API。
- 复用 Task4 Agent Runtime 的任务、事件、数据库 execution lease、generation fence、终态和结算状态机。
- 复用 Task5 服务端 Skill/model/input/Asset Version 授权、冻结模型绑定、重新报价与唯一 `createBillableTask` 账务边界。
- 未创建第二套任务表、状态机、账务逻辑或进程内幂等 Map。

## RED

首次只新增 Task 6 测试后运行：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts
```

结果：退出 1。执行器测试因 `@/lib/skill-runtime/executor` 不存在而收集失败；7 项 API 测试因三个 Skill Run 路由不存在而失败。这是预期的缺模块 RED。

后续窄 RED 依次验证：

- 质量门禁失败尚未调用终态失败结算，普通步骤错误尚未持久化暂停点：3 项中 2 项预期失败。
- 冻结步骤快照未用于历史，公共 Agent request digest 未导出：5 项中 2 项预期失败。
- malformed JSON 被映射为 500 而不是 400：1 项预期失败。
- accepted provider task 的 reconciliation handler 未传入 durable child operation：1 项预期失败。
- 并发加入的安全测试发现非 JSON、未知字段与超大 body 未在 service admission 前拒绝：2 项预期失败。
- 提交后审计新增两条约束测试：冻结历史仍先读取当前目录、模型绑定会静默丢弃未知字段；聚焦结果为 2 项预期失败、5 项通过。

所有 RED 均由目标行为缺失触发，不是测试语法或环境错误。

## GREEN

### Durable Skill Executor

- 顺序步骤逐组执行；相邻且 `parallelGroup` 相同的并行步骤共享组级 abort signal。
- 并行组任一步骤执行或质量检查失败会立即 abort 其余底层工作，并等待所有 sibling settle 后停止后续组。
- 每一步必须调用父 operation context 的 `executeOperation(...)`，因此继续使用 `executeDurableAgentDownstreamOperation()` 与数据库 lease。
- 步骤 request digest 只包含 `runId + skillId/version + stepId/template + frozen inputs + frozen model binding`，不包含 generation；重试保持同一 operation identity。
- generation 只进入执行事件 ID/payload，用于 Agent event fence；不会改变供应商幂等键。
- completed operation 由既有 durable operation 直接重放；accepted operation 使用 adapter 提供的 reconciliation handler；submitted 且无 remote identity 的 fail-closed 行为继续由 Task4 实现。
- 已完成步骤由持久 `tool.completed` 事件恢复并跳过，恢复从持久 `resumeFromStepId` 开始。

### 终态与账务

- 成功只通过 `appendAgentRunEvent(run.completed)` 进入 Task4 原子终态。
- 质量门禁失败只通过 `appendAgentRunEvent(run.failed)` 进入 Task4 单次失败退款。
- 普通可重试步骤错误调用 `pauseAgentRun(nextStepId)`，持久化恢复点且不退款。
- 显式取消调用 `cancelAgentRun()`；pause/resume/retry 未新增报价、扣费或退款调用。
- Task4 终态 fence 保证迟到 completed 无法越过 failed/cancelled/timeout。

### 服务与 API

- `POST /api/skill-runs` 复用 Task5 `createSkillRun()`；同 actor/幂等键的同请求复用，异请求由既有 idempotency boundary 返回 409。
- `GET /api/skill-runs?limit=20` 与 `GET /api/skill-runs/:runId` 只读取 actor 自己的任务与事件；跨用户按不存在处理。
- `PATCH /api/skill-runs/:runId` 支持 pause/resume/cancel，actor 只来自认证上下文。
- `POST /api/skill-runs/:runId/retry` 只允许重试数据库中已暂停且 `resumeFromStepId` 相同的步骤，随后复用 Agent Runtime resume generation；不重新扣费。
- create/control/retry 使用统一严格 JSON reader：仅接受 `application/json`；create 最大 512 KiB，control/retry 最大 8 KiB；拒绝未知字段、无效 UTF-8、畸形 JSON 与客户端 actor 字段。
- 模型绑定只接受 `providerId + modelId`，未知嵌套字段同样 fail closed。

### 历史与隐私

- `run.created` 持久化最小 Skill snapshot：Skill ID、版本、名称和步骤 ID/label。
- 历史优先读取持久化快照；即使对应 Skill 版本已从当前目录移除，既有运行仍可审计。
- 历史返回冻结 Skill ID/version、冻结步骤状态、质量事件、结果 AssetVersion IDs、最终 credit status/cost 和时间戳。
- 历史不返回 model bindings、provider descriptor、API Key、凭据或原始事件 payload。
- 恢复 helper 同时验证 actor/project/task type、持久 created digest、task digest 和调用请求的 canonical digest，错误请求不能借用已有 run 执行。

## 验证

Task 6 聚焦与账务回归：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/agent-runtime-accounting.test.ts src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts
```

最终聚焦结果：3 个文件、20 项全部通过。

Task1-5、Agent Runtime 与生产恢复相关回归最终结果：28 个文件、400 项通过；2 个 PostgreSQL 文件因缺少配置跳过，共 4 项跳过。

## PostgreSQL 未验证项

`POSTGRES_TEST_DATABASE_URL` 未设置。`src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts` 明确输出 BLOCKED 并跳过，未用内存实现冒充数据库证据。

配置后该测试验证：

- 20 个同 actor/同幂等键并发请求只创建一个 `agent-run`、只扣费一次、只写一条 consume ledger。
- 同键不同 digest 返回 `IDEMPOTENCY_CONFLICT` 409。
- quality failure/cancel 竞态只有一个终态赢家与一笔退款。
- 终态后迟到 completed 返回 false，不能写入结果或逆转退款。

## 保护项

- 未 push，未切换或修改 `stable`。
- 未触碰或暂存任务开始前已有的四个保护未跟踪项：`.playwright-cli/`、`_refs-asui-canvas/`、`_refs-hero-infinite-canvas/`、`docs/superpowers/plans/2026-08-02-provider-generation-video-reliability.md`。

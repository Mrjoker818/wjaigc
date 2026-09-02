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

## 独立复审补强（基线 d85a8b08）

### 基线审计

- 复审基线：`main@d85a8b0836bfc93cc24b8508a8cd45dd04d2c6f9`。
- `d85a8b08` 完整包含 `9ea8b623`，晚到变更只增加 Task6 报告、executor 测试与 service 补强，没有丢失 `9ea` 的既有实现。
- 本轮未重做已闭环的模型绑定未知字段拒绝和冻结历史独立于当前目录两项。

### 本轮 RED

先增加复审测试并执行：

```text
pnpm exec vitest run src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/agent-runtime-same-task-adapter.test.ts
```

首次结果：4 项失败、33 项通过。失败分别证明：

- 新建 Skill Run 后生产 API 没有启动执行；
- Task4 恢复 loader 拒绝没有 `adopted=true` 的普通 durable Skill Run；
- 质量失败终态没有携带 execution generation/lease fence；
- 质量失败步骤在历史中错误显示为 `processing`。

另增加恢复前置校验，证明冻结 continuation 无效时不会先写 `run.resumed`。

### 本轮 GREEN

- `POST /api/skill-runs` 仅对 `reused=false` 的新 run 调用 `startSkillRunExecution()`，后台启动同一个已计费 run；幂等重放不启动、不提交、不再次扣费。
- 新增生产 Skill step registry。步骤继续复用 Task4 durable downstream operation、数据库 operation lease 和 Task5 冻结 provider/model；没有进程内 Map、第二任务状态机或第二账务边界。
- Task4 resumable loader 先识别持久 `run.created.skill`，从冻结 snapshot、inputs、modelBindings 和 resume step 重建 Skill continuation；原有 chat/simple-chat/agent-edit 的 `adopted=true` 分支保持不变。
- resume/retry 在状态转换前验证持久 continuation；验证失败不会先进入 resumed 再由后台失败。
- `tool.started/completed`、质量事件及 `run.completed/run.failed` 都携带 active generation fence；终态事件 ID 包含 generation，旧 generation 在 pause/resume/cancel 后不能写终态或触发退款。
- 质量失败、普通步骤失败和持久 `resumeFromStepId` 均投影为 `failed`；冻结 Skill 版本从目录移除后仍可通过 snapshot 审计。
- PostgreSQL 集成已提升为五组，其中新增高层链路直接经过 `createSkillRun`/Skill service、真实 Agent events、Skill executor、质量门禁和 generation fence；覆盖 20 并发同键、异 digest、质量失败、取消竞态、一扣一退和迟到 completed。

### 本轮验证结果

Task6 聚焦与 accounting：

```text
4 个文件通过，41 项通过；PostgreSQL 文件 5 项因环境未配置明确跳过。
```

Task1-6、Task4 Agent/accounting 精确回归：

```text
25 个文件通过，447 项通过；4 个 PostgreSQL 文件共 8 项明确跳过。
```

工程门禁：

```text
pnpm ts-check                         PASS
目标 ESLint                           PASS（0 error / 0 warning）
git diff --check                      PASS
```

完整 `pnpm test` 共执行 4,859 项：4,715 通过、140 跳过、4 失败。4 项失败均已存在于 `d85a8b08` 基线且不在本轮授权路径：保护基线授权清单漂移、`agent-edit` 路由迁移契约、`save-image` 调用契约、Agent 去背景请求源码契约。本轮没有修改这些模块，也未把它们伪报为通过。

### 仍受阻项

本机未设置 `POSTGRES_TEST_DATABASE_URL`，因此新增的五项真实 PostgreSQL 并发测试只完成了编译和显式 skip，尚无数据库运行证据。未用 Mock 或内存实现替代该证据；配置隔离测试库后必须补跑，才能对 PostgreSQL 并发验收给出通过结论。

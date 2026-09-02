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

## 全量 Vitest 四项失败闭环（基线 5d0f69d6）

### RED 与根因

先独立执行四个失败文件：

```text
pnpm exec vitest run tests/regression/task-entry-migration.test.ts tests/unit/protected-baseline-gate.spec.ts src/__tests__/api/save-image-auth-contract.test.ts src/__tests__/components/image-tool-request-integrity.test.ts
```

结果为 4 个文件失败、4 项失败、25 项通过。逐项追踪后确认：

- `agent-edit` 的任务入口迁移、`/api/save-image` 持久化调用和 `remove_background` 请求已经迁到 `src/lib/agent-runtime/agent-edit-execution-service.ts`，生产实现仍完整携带迁移审计、签名内部请求头以及 `imageUrl/providerId/model`；三个源码契约仍读取薄路由，属于测试所有权陈旧，不是生产行为回归。
- 保护基线缺少 Unified Skill Runtime Task1-6 已提交生产文件的来源授权。33 个漂移路径均逐文件核对最后内容提交，且提交可从当前 `HEAD` 到达；问题是授权记录未随 Task6 完成同步。

### 最小修复

- 将三个结构契约的读取目标改为真实执行服务，保留全部原断言，没有删除或弱化测试。
- 为 33 个 Task1-6 生产文件分别补充精确路径和来源提交，并同步测试清单、允许路径清单及来源凭证清单。
- 未增加目录授权或通配符，未修改生产代码、`stable` 或四个保护未跟踪项。

### GREEN 与回归

```text
四个原失败文件：4 个文件通过，29 项通过。
Task6 focused：4 个文件通过，41 项通过；PostgreSQL 文件 5 项因缺少 POSTGRES_TEST_DATABASE_URL 明确跳过。
pnpm test：614 个文件通过，27 个文件跳过；4,719 项通过，141 项跳过，0 失败。
pnpm ts-check：PASS。
目标 ESLint：PASS（0 error / 0 warning）。
git diff --check：PASS。
```

PostgreSQL 的五项 Task6 并发验证仍是环境阻塞项，未用 Mock 结果冒充真实数据库证据。

## 独立评审修复：并行恢复、错误暂停 fence 与暂停历史（基线 668bcb7a）

### RED

本轮先只修改测试，并运行：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/lib/agent-runtime-event-storage-fence.test.ts
```

首次结果为 3 个文件失败，71 项通过、5 项失败。失败分别证明：

- 从并行组的后置步骤 `generate-4` 恢复时，尚未完成的前置 sibling `generate-3` 被遗漏；
- 普通执行错误调用 `pauseForRetry` 时没有携带 generation/lease fence；
- Task4 `pauseRun` 没有把执行 fence 传入原子控制转换；
- 用户显式暂停被错误投影为失败步骤；
- 数据库暂停 fence 测试首次暴露测试桩的事件流/`revision` 数据不完整。修正测试夹具后单独复跑，稳定失败于生产 SQL 缺少 `wujie_agent_execution_leases` 条件，而不是夹具异常。

测试进一步模拟新 generation 已取得 lease：旧 generation 的暂停必须被拒绝，且不得插入 `run.paused` 事件或清空新 lease。

### GREEN 与最小实现

- 恢复步骤位于并行组时，执行起点回溯到该连续并行组首项，再用持久 `tool.completed` 集合过滤；因此所有未完成 sibling 都会执行，已完成 sibling 不会重复执行。
- executor 的错误恢复回调强制携带 active execution fence；Skill service 以 `pauseReason=execution-error` 复用 Task4 `pauseAgentRun`。
- Task4 暂停转换在锁定 `cloud_tasks` 的同一事务中，用 `runId + actor + project + leaseOwner + generation + paused_at=0 + completed_at=0` 校验当前执行所有权。新 generation 接管后，旧 generation 无法写暂停事件、清空 lease 或中断新执行。
- 用户暂停写入 `pauseReason=user`。历史仅把 `execution-error` 暂停的恢复步骤标为 `failed`；用户暂停的未完成步骤保持 `pending`。质量失败仍由 `quality.checked(passed=false)` 独立投影为失败。
- 没有新增任务、计费或退款状态机，也没有改变 chat/simple-chat/agent-edit 的恢复分支。

### 生产 Registry 审计

新增机械覆盖测试扫描当前全部 37 个内置 Skill：21 个 canvas/workflow Skill 的执行步骤当前只使用 `generate_image`，16 个 simple-chat Skill 为零步骤定义。生产 registry 同时提供 `generate_image` adapter 与 recovery，当前没有遗漏 toolId，因此无需扩张 registry 或增加虚假适配器。

### 验证结果

三项修复与竞态证据：

```text
3 个文件通过，77 项通过。
```

Task6 focused 5 文件：

```text
4 个文件通过、1 个 PostgreSQL 文件跳过；99 项通过、5 项跳过。
```

Task4 pause/resume/fence 回归：

```text
6 个文件通过、1 个 PostgreSQL 文件跳过；125 项通过、19 项跳过。
```

工程门禁：

```text
pnpm ts-check                         PASS
目标 ESLint（7 个本轮源码/测试文件） PASS，0 error / 0 warning
git diff --check                      PASS
```

### 环境跳过项

本机仍未设置 `POSTGRES_TEST_DATABASE_URL`。Task6 的 5 项和 Task4 的 19 项真实 PostgreSQL 测试均输出明确 `BLOCKED` 后跳过；本轮通过 SQL 所有权测试和 service 竞态测试验证逻辑，但没有把测试桩结果冒充真实 PostgreSQL 并发证据。配置隔离数据库后仍需补跑这 24 项。

### 修改范围

- `src/lib/skill-runtime/executor.ts`
- `src/lib/skill-runtime/service.ts`
- `src/lib/agent-runtime/service.ts`
- `src/lib/agent-runtime/event-storage.ts`
- `src/__tests__/lib/skill-runtime-executor.test.ts`
- `src/__tests__/api/agent-runs.test.ts`
- `src/__tests__/lib/agent-runtime-event-storage-fence.test.ts`

未切换或修改 `stable`，未触碰四个受保护未跟踪项，未 push。

## 二次独立评审修复：simple-chat 执行真相、retry 计划与跨代资产（基线 d8abeaf4）

### RED

先只新增评审要求的测试并执行：

```text
pnpm exec vitest run src/__tests__/api/agent-runs.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-executor.test.ts
```

首次结果为 3 个文件失败，81 项通过、4 项失败：

- simple-chat Skill 虽按唯一 orchestrator 步骤计费，但 `run.created.skillSnapshot.steps` 仍为空；
- kickoff Promise 拒绝后没有调用持久失败终态，只输出控制台日志；
- 从后置并行 sibling 重试时，API/service 返回遗漏同组较早的未完成 sibling；
- 新 generation 的最终 `assetVersionIds` 丢失历史 generation 已持久化的资产。

随后将 37 个内置 Skill 的 registry 审计切换到规范化执行步骤，独立 RED 为 1 项失败：`skillExecutionSteps` 尚不存在，且生产 registry 没有 `chat` adapter。这证明 simple-chat 不只是快照为空，执行入口也缺少共享 orchestrator adapter。

### GREEN 与单一真相

- 新增唯一 `skillExecutionSteps()`：当 Skill 自身没有 orchestrator 步骤时，合成唯一 `chat/orchestrator` 步骤。Task5 报价和 Task4 `run.created` 冻结快照都调用该函数，Task6 continuation 只执行冻结的同一规范化步骤。
- 旧 simple-chat 空快照恢复时，在 Skill ID、版本和 surface 校验通过后使用同一规范化函数兼容恢复；不会将 21 个 Canvas Skills 暴露给 simple-chat。
- production registry 新增真实 `chat` adapter，直接复用既有 orchestrator provider 路径；没有伪造异步 recovery，也没有新增任务或计费状态机。
- simple-chat 规范化 executor 回归证明：只启动 `orchestrator` 一次、只写完成终态一次、没有画布资产；API 既有回归继续证明新建只 kickoff 一次，幂等重放不再次 kickoff；Agent Runtime 报价回归证明只计算一次 chat 费用、只创建一次计费任务。
- 新增 `failSkillRunExecution()`，kickoff 异常通过 Task4 `appendAgentRunEvent(run.failed)` 的统一终态与退款边界持久化，不再只写日志。执行期异常会附带 active execution fence；执行前 continuation 加载异常没有 lease，因此通过同一原子终态边界结算但不伪造 fence。
- `selectSkillStepsForExecution()` 成为 executor 和 retry 返回值的共同算法：回溯连续并行组首项，再过滤持久 completed sibling。
- executor 接收按事件顺序恢复的历史 `asset.created` 版本；每个并行组按定义顺序汇总新资产，最终与历史资产稳定合并并去重。`run.completed.result.assetVersionIds` 因此不会丢失旧 generation 结果。

### 验证结果

新增专项：

```text
3 个文件通过，86 项通过。
```

Task6 focused：

```text
4 个文件通过、1 个 PostgreSQL 文件跳过；103 项通过、5 项跳过。
```

Task4 accounting/fence：

```text
5 个文件通过、1 个 PostgreSQL 文件跳过；76 项通过、19 项跳过。
```

simple-chat Skill 目录、请求与报价隔离：

```text
3 个文件通过，24 项通过。
```

工程门禁：

```text
pnpm ts-check                         PASS
目标 ESLint（10 个本轮源码/测试文件）PASS，0 error / 0 warning
git diff --check                      PASS
```

### 环境跳过项

`POSTGRES_TEST_DATABASE_URL` 仍未配置。Task6 的 5 项和 Task4 的 19 项真实 PostgreSQL 测试明确输出 `BLOCKED` 并跳过；没有用内存或 Mock 冒充数据库并发证据。

### 修改范围与保护项

- 生产：`src/app/api/skill-runs/route.ts`、`src/lib/agent-runtime/service.ts`、`src/lib/skill-runtime/{continuation,cost-estimator,executor,service,step-registry}.ts`
- 测试：`src/__tests__/api/{agent-runs,skill-runs}.test.ts`、`src/__tests__/lib/skill-runtime-executor.test.ts`
- 报告：`.superpowers/sdd/task-6-report.md`

未切换或修改 `stable`，未触碰四个受保护未跟踪项，未 push。

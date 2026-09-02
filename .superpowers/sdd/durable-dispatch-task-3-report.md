# Skill 持久调度纠偏 Task 3 实施报告

## 结论

Task 3 已在 `main` 本地完成实现与聚焦验证，未推送 GitHub，未修改 `stable`。首轮独立评审结论为 `FAIL（2 Important）`，两个 finding 已按 TDD 修复，当前状态为**待重新独立评审**。Skill 首次执行、同键创建重放、单项 GET 与列表 GET 现统一复用 Agent Runtime 的数据库 execution fence 和 dispatch lease；没有新增任务表、进程内权威锁、供应商状态机或账务边界。

## TDD 证据

### RED

首次新增路由与恢复合同后运行：

```text
pnpm exec vitest run src/__tests__/api/skill-runs.test.ts
```

结果：`5 failed / 10 passed`，并出现 `1` 个未处理 Promise 拒绝。失败准确证明旧实现存在以下问题：

- 首次执行仍调用请求进程内 `startSkillRunExecution()`。
- 同键创建重放不会唤醒任务。
- 单项 GET 与列表 GET 不触发有界恢复。
- completion 拒绝会形成未处理 Promise，且旧路径会另写失败终态。

### GREEN

最终聚焦命令：

```text
pnpm exec vitest run src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/agent-runtime-event-storage-fence.test.ts src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts
```

结果：`50 passed / 6 skipped / 0 failed`，无未处理 Promise。

覆盖内容：

- 首次执行与恢复执行均先领取 execution fence，再领取 dispatch lease。
- 无既有租约的同键 create replay 仍可重新领取首次执行权。
- 20 个并发唤醒只有一个有效 dispatch claim 和一个执行器启动。
- 过期 dispatch generation 使用原 generation/lease fence 恢复。
- completion 失败受控写入 `dispatch_error`，不创建第二终态。
- 已取消任务和失去 generation fence 的任务不会执行。
- 单项 GET 只恢复当前用户当前 run；列表 GET 最多恢复响应中的前 20 个 run。
- 终态任务不会因迟到 completion catch 追加重试事件。

### 独立评审 finding 修复

1. **dispatch claim 后投影读取失败未持久化**
   - RED：`getProjection()` 拒绝导致 `dispatchSkillRunExecution()` 直接拒绝，`failDispatch` 未调用。
   - GREEN：投影读取与 `executeAdopted` 启动进入同一受控 `try/catch`；同步启动失败和异步 completion 失败复用同一 `persistDispatchFailure()`，失败后返回 `started:false`，留下可恢复 `dispatch_error`，无未处理拒绝。
2. **PostgreSQL 测试只覆盖低层 claim**
   - 已将 20 并发场景改为真实隔离数据库下直接并发调用高层 `dispatchSkillRunExecution()`，独立统计 `executeAdopted` 与供应商提交边界，均要求恰好一次，账务流水要求恰好一次消费。
   - 过期恢复场景仅用低层 claim 构造“进程在 dispatch 后丢失”的数据库前置状态；恢复动作本身由 20 个高层 dispatcher 竞争，要求一个成功执行、一次供应商提交、一次计费，并验证 `dispatch_attempt_count = 2`。

## 实现摘要

- `event-storage.ts`
  - 新增按 `actorUserId + projectId + runId` 查询可恢复 dispatch 的读取函数。
  - 只返回非终态、未暂停、未完成且 dispatch lease 为空或已过期的 Agent run。
  - dispatch 失败持久化增加终态保护，并继续使用 generation 与 dispatch owner 条件更新。
- `skill-runtime/service.ts`
  - 新增 `dispatchSkillRunExecution()` 与 `recoverLiveSkillRunExecution()`。
  - 删除旧的请求内启动和独立 kickoff 失败终态入口。
  - completion Promise 内外两层受控 catch，错误只留下可恢复 dispatch 状态。
  - dispatch claim 后的 projection 读取和执行器启动也使用同一持久失败路径。
- Skill run API
  - POST 对新建和同键重放都等待数据库 claim 结果，但不等待供应商完成。
  - 单项 GET 触发一次归属受控恢复。
  - 列表 GET 最多触发 20 个恢复探测。

## 工程门禁

- `pnpm ts-check`：通过。
- 目标文件 ESLint：通过，`0 errors / 0 warnings`。
- `git diff --check`：通过。
- Protected baseline：通过，`0 block / 0 warning`；仅使用三个既有本地参考目录的临时精确 allow 参数。
- `origin/stable`：`52f7c601ed150769e15d06fb435c6e360e28c9e7`，未改变。
- 四个受保护未跟踪项：未修改、未加入提交。

## BLOCKED / 未验证

当前环境未设置 `POSTGRES_TEST_DATABASE_URL`，因此 6 个真实 PostgreSQL 专项为 **BLOCKED**，未使用 Mock 冒充：

- 20 并发同键创建在真实事务与 advisory lock 下的一次扣费证明。
- execution fence 与 dispatch lease 的真实 SQL 并发唯一领取。
- dispatch lease 过期后的真实数据库回收。
- 取消、迟到完成、失败退款的真实 PostgreSQL 竞态一致性。

测试文件已保留真实隔离库用例；配置专用测试库后可直接执行：

```text
pnpm exec vitest run src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts
```

## 边界确认

- 未修改 UI、21/16 Skill 目录、模型目录或供应商业务适配。
- 未新增迁移、表、账务逻辑或进程内锁。
- 未推送 GitHub。
- 首轮评审的两个 Important 已修复；全新独立复审为 Critical/Important/Minor `0/0/0`，Spec compliance 与 Code quality 均为 PASS，最终结论 `APPROVED`。

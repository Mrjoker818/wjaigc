# Skill 持久调度纠偏 Task 3：数据库调度租约与有界恢复

## 目标

让 Skill 首次执行与恢复执行复用现有 Agent Runtime 的数据库 execution fence 和 dispatch lease。请求进程丢失后，可由同键创建重放、单项 GET 或列表 GET 有界唤醒；任意并发路径只能产生一次真实供应商提交和一次计费。

## 基线与边界

- 基线：`main@c7c93d49`。
- 必须复用 `claimAdoptedAgentExecution()`、`claimResumedAgentExecutionDispatch()` 与 `loadPersistedSkillContinuation()`，不得建立第二状态机、第二账务边界或进程内权威锁。
- 创建接口只等待数据库 claim 结果，不等待供应商完成。
- 恢复只允许当前用户、非终态、有效 Skill snapshot、过期 dispatch lease；单次最多处理响应涉及的 20 个 run。
- 取消与终态不可逆；旧 generation 不得写入完成、失败、资产或退款。
- 持久结算失败必须被受控捕获并留下可恢复的 `dispatch_error`，不得出现未处理 Promise。
- 不修改 21/16 Skill 目录，不接 UI，不推送 GitHub，不修改 `stable`。
- 不触碰四个既有未跟踪保护项。

## 允许修改

- `src/lib/agent-runtime/event-storage.ts`
- `src/lib/agent-runtime/execution-dispatch.ts`
- `src/lib/skill-runtime/service.ts`
- `src/app/api/skill-runs/route.ts`
- `src/app/api/skill-runs/[runId]/route.ts`
- `src/__tests__/lib/agent-runtime-execution-dispatch.test.ts`
- `src/__tests__/lib/skill-runtime-executor.test.ts`
- `src/__tests__/api/skill-runs.test.ts`
- `src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts`
- 本 Task brief/report 与精确治理白名单条目

## TDD 与验收

1. RED：首次 dispatch 进程丢失后，过期租约可被 GET 回收；同键 20 并发只产生一个 run、一个有效 claim、一次提交和一次计费。
2. GREEN：新增 `dispatchSkillRunExecution()` 和 `recoverLiveSkillRunExecution()`，首次与恢复均走数据库 fence + lease。
3. 创建重放、单 GET、列表 GET 的唤醒有界、归属受控、终态跳过。
4. 旧 generation、取消后迟到结果和结算失败均有永久回归。
5. 运行计划中的聚焦回归、TypeScript、目标 ESLint、保护基线、diff-check。
6. PostgreSQL 专项仅在 `POSTGRES_TEST_DATABASE_URL` 存在时判定；缺失必须记录 `BLOCKED/未验证`，不能用 mock 冒充。
7. 全新独立评审 `APPROVED` 且 Critical/Important/Minor 为 `0/0/0` 后才完成。

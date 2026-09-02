# Skill 持久调度纠偏 Task 2 实施报告

## 范围

- 基线：`main@c9d9b58465061cca0f3ddd9226e6543f902e2ee4`
- 只纠正 Skill 重试响应合同。
- 未实现 Task 3 的数据库调度租约、恢复扫描或唤醒逻辑。
- 未改变目录隔离、计费、执行顺序、暂停/恢复、终态和资产持久化语义。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 保持只读。

## RED

先修改测试，再运行：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts
```

结果：`1 failed / 1 passed` 测试文件，`2 failed / 32 passed` 测试。

两个失败均符合预期：

- 并行重试把后续顺序步骤 `quality-3` 错误包含在 `startedStepIds` 中。
- 顺序重试把完整待执行计划错误包含在 `startedStepIds` 中。
- 两个响应都缺少 `scheduledStepIds`。

API 透传测试在 RED 阶段已通过，证明路由没有重命名或删除服务返回字段。

## 最小实现

- 新增 `selectInitialSkillStepIds()`：只返回首个顺序步骤，或首个连续并行组中的全部未完成步骤。
- 新增 `SkillRetryResult`，显式包含：
  - `accepted`
  - `startedStepIds`
  - `scheduledStepIds`
- `scheduledStepIds` 继续复用既有 `selectSkillStepsForExecution()`，不改变真实执行计划。
- 已完成的并行 sibling 先由既有选择算法排除，不会进入任一集合。
- 重试 API 保持原有 `NextResponse.json(await retrySkillStep(...))`，原样返回服务结果。

## GREEN 与回归

运行：

```text
pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/agent-runs.test.ts
```

结果：`3/3` 测试文件通过，`91/91` 测试通过。

覆盖：

- 并行首批与完整计划分离。
- 顺序首批与完整计划分离。
- 已完成 sibling 不进入任一集合。
- API 原样返回两个集合。
- Agent 恢复回归保持通过。

## 工程门禁

- `pnpm ts-check`：通过。
- 改动文件 ESLint：`0 errors / 0 warnings`。
- `git diff --check`：通过。
- 保护基线：通过，`0` 阻断、`0` 警告；仅使用本地临时 allow 参数排除三个受保护未跟踪目录。

## 修改文件

- `src/lib/skill-runtime/executor.ts`
- `src/lib/skill-runtime/service.ts`
- `src/__tests__/lib/skill-runtime-executor.test.ts`
- `src/__tests__/api/skill-runs.test.ts`
- `.superpowers/sdd/durable-dispatch-task-2-report.md`

## 独立评审纠正

- 后续独立评审发现一项 Important：`resumeRun` 返回 `accepted:false` 时，响应仍错误报告非空 `startedStepIds`。
- 新增并发重试失败回归后，RED 为 `1 failed / 33 passed`，实际值错误包含 `generate-3`、`generate-4`。
- 最小修复要求：未接受恢复执行权的请求返回 `startedStepIds: []`，同时保留完整 `scheduledStepIds`。
- 本报告原有 `APPROVED` 与 `0 / 0 / 0` 表述作废；新一轮独立复审完成前，Task 2 状态为“修复后待复审”。
- 修复后聚焦及 Agent 恢复回归重新通过：`3/3` 测试文件、`91/91` 测试。
- 修复后 `pnpm ts-check`、目标 ESLint、保护基线和 `git diff --check` 均通过；保护门禁为 `0` 阻断、`0` 警告。
- 新一轮复审继续发现一项 Important：幂等恢复事件可能返回 `accepted:true`，但当前请求未取得 dispatch claim，表现为 `dispatch.started:false`。
- 为该场景建立第二个 RED：`1 failed / 33 passed`，证明仅检查 `accepted` 仍会误报首批启动。
- 最终最小修复以 `accepted && dispatch.started === true` 作为非空 `startedStepIds` 的必要条件；未实际调度的请求继续保留完整 `scheduledStepIds`。
- 第二项修复后的独立复审尚未进行，Task 2 继续保持“修复后待复审”。

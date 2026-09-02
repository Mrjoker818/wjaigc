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

## 独立评审

- 模型：`gpt-5.6-sol`，推理强度 `medium`。
- 范围：`c9d9b58465061cca0f3ddd9226e6543f902e2ee4..4cf6aa09d3b694d825356e4f5d52583d3307f747`。
- 结论：`APPROVED`。
- Critical / Important / Minor：`0 / 0 / 0`。
- 评审只读沙箱无法创建 Vitest 临时目录；动态测试证据由控制端提交后新鲜运行的 `91/91` 结果提供。

# Skill 持久调度纠偏 Task 2：重试返回合同

## 目标

纠正 Skill 重试接口的状态表达：区分本次请求实际启动的首批步骤与随后将执行的完整计划，避免客户端把尚未启动的顺序步骤显示为运行中。

## 基线与边界

- 基线：`main@2c3a6ebf`。
- 只修改重试返回合同及其选择辅助函数，不提前实现 Task 3 的数据库调度租约或恢复唤醒。
- 不修改 21 个 Canvas Skills 与 16 个 Simple Chat Skills 的目录和 surface 隔离。
- 不改变既有执行顺序、计费、暂停、恢复、终态或资产持久化语义。
- `origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 只读。
- 不触碰四个既有未跟踪保护项：`.playwright-cli/`、`_refs-asui-canvas/`、`_refs-hero-infinite-canvas/`、`docs/superpowers/plans/2026-08-02-provider-generation-video-reliability.md`。

## 允许修改

- `src/lib/skill-runtime/executor.ts`
- `src/lib/skill-runtime/service.ts`
- `src/app/api/skill-runs/[runId]/retry/route.ts`
- `src/__tests__/lib/skill-runtime-executor.test.ts`
- `src/__tests__/api/skill-runs.test.ts`
- 本报告与本 brief 的精确治理白名单条目

## TDD 要求

1. 先增加失败测试，覆盖首个连续并行组与后续顺序步骤。
2. 重试结果必须返回：
   - `startedStepIds`：本次立即启动的第一个顺序步骤，或第一个连续并行组中全部尚未完成的步骤。
   - `scheduledStepIds`：从重试点开始、排除已完成步骤后的完整执行计划。
3. 已完成的并行 sibling 不得出现在任一集合，也不得重复执行。
4. API 原样返回两个集合，旧的 `accepted` 语义保持不变。
5. 运行聚焦测试、Agent 恢复回归、TypeScript、目标 ESLint、保护基线与 diff-check。

## 验收

- RED 能证明旧实现把后续顺序步骤误报为已启动且缺少完整计划字段。
- GREEN 能证明并行首批、顺序首批和已完成 sibling 三种情况。
- 独立评审为 `APPROVED`，Critical/Important/Minor 均为 0 后才记为完成。
- 不推送 GitHub，不进入云端验收。

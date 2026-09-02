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

# Skill 运行内核持久调度纠偏设计

## 背景

Task 6 已建立数据库幂等的 Skill 执行器，但连续独立评审证明四处契约仍未形成单一真相：首次执行依赖进程内 Promise、文本结果没有进入持久终态、部分步骤的计费类型与实际供应商操作不一致，以及重试接口把完整候选计划称为已启动步骤。

本设计只收口统一 Skill 运行内核，不增加第二套任务、供应商或账务状态机，不改变 21 个 Canvas Skills 与 16 个 Simple Chat Skills 的目录隔离。

## 目标

1. 首次执行和恢复执行共用 Task 4 的数据库 generation、execution lease 与 dispatch lease。
2. 进程退出或瞬时调度失败后，持久任务仍可被既有恢复扫描重新认领。
3. 图片资产和 simple-chat 文本都进入同一个 `run.completed.result` 持久结果。
4. 每一步的积分操作类型由真实执行适配器决定，报价、冻结和执行保持一致。
5. 重试响应区分“本次真实启动的首批步骤”和“后续计划步骤”。

## 非目标

- 不新增独立队列表或事务 Outbox。
- 不创建第二个 taskId、父子账务任务或额外扣费边界。
- 不让 simple-chat 使用 Canvas Skill 目录，也不让 Canvas 使用 simple-chat Skill 目录。
- 不触碰 `stable`，不修改供应商业务协议或现有画布入口。

## 方案

### 1. 统一持久调度

新建 Skill Run 时，服务端在返回成功前完成首次 execution generation 与 dispatch claim 的持久化。首次执行和 resume/retry 均调用同一个数据库调度入口：

- 使用 `runId + generation + leaseOwner` 作为执行围栏；
- 使用数据库 dispatch lease 保证同一 generation 只能由一个 worker 启动；
- API 进程只负责唤醒，不作为执行存在性的唯一真相；
- 幂等重放可以安全触发一次调度唤醒，但不能重复执行、重复创建任务或重复扣费；
- 过期 dispatch lease 由既有 Agent 恢复扫描重新认领；
- 调度失败和执行失败均写入围栏保护的持久事件，并进入统一退款结算。

不得通过延长请求等待时间掩盖调度问题。

### 2. 持久结果合同

`SkillStepResult` 的可交付结果统一投影到终态：

```ts
interface DurableSkillResult {
  assetVersionIds: string[];
  outputs: Array<{
    stepId: string;
    kind: 'text' | 'html';
    content: string;
  }>;
}
```

- 图片类步骤继续保存去重且顺序稳定的 `assetVersionIds`；
- simple-chat 编排步骤的文本保存为 `outputs`；
- 不保存 API Key、完整供应商响应或未脱敏内部信息；
- 跨 generation 恢复时，历史资产和文本结果与新增结果稳定合并；
- GET/list/history 均从同一持久结果读取，不依赖进程内变量。

### 3. 执行与计费一致

每个规范化步骤必须解析为唯一执行类型：

- `modelRole=orchestrator` 且走聊天适配器时，计费操作为 `chat`；
- 真正调用图片生成适配器时，计费操作为 `image_generate`；
- 其他步骤继续使用已登记的真实操作类型。

报价、`run.created` 冻结快照、生产 registry 和执行器必须使用同一个规范化步骤描述，禁止只根据表面的 `toolId` 推断计费。

### 4. 重试返回语义

保留兼容字段，同时消除语义歧义：

```ts
interface SkillRetryResult {
  accepted: boolean;
  startedStepIds: string[];
  scheduledStepIds: string[];
}
```

- `startedStepIds` 只包含调度后立即启动的首个顺序步骤，或同一并行组内本次实际启动且尚未完成的全部 sibling；
- `scheduledStepIds` 包含本次恢复允许继续执行的完整未完成计划；
- 已完成 sibling 不出现在任一重新执行集合；
- 后续顺序步骤只有在真正写入 `tool.started` 后，才可通过运行历史视为已启动。

原 Task 6 示例中把后续顺序步骤放入 `startedStepIds` 的表达由本设计纠正，以真实执行语义为准。

## 错误与恢复

- kickoff 尚未取得 execution fence 时，不得返回“已启动”。
- worker 在取得 lease 后的任何终态写入都必须携带 generation fence。
- 旧 generation 的迟到完成、失败或暂停不能覆盖新 generation。
- dispatch claim 后进程退出，lease 到期后可重新认领。
- 失败退款只依据数据库最终终态，保持一次且仅一次。

## 测试要求

实施前必须新增并观察以下 RED：

1. 创建成功后进程未执行 Promise，恢复扫描仍能认领同一 run。
2. 同键重放只唤醒，不重复扣费或执行。
3. simple-chat 完成后可从 GET/list 读取持久文本结果。
4. Canvas 编排步骤按 chat 计费，图片步骤按 image_generate 计费。
5. 重试后 `startedStepIds` 只包含首批真实启动步骤，`scheduledStepIds` 包含完整计划。
6. 跨 generation 的文本和资产结果稳定合并。
7. 调度、取消、失败和迟到完成竞态保持终态不可逆及一扣一退。

完成专项测试后，必须运行 Task 4/5/6 回归、全量 Vitest、TypeScript、ESLint、构建和保护基线门禁。缺少 `POSTGRES_TEST_DATABASE_URL` 时，数据库并发仍标记为“未验证”，不得用 Mock 冒充。

## 验收标准

- 独立评审 Critical、Important、Minor 均为 0。
- 全量本地自动化测试 0 失败。
- `stable` 指针和四个受保护未跟踪项保持不变。
- 未推送前不宣称云端已验证；推送并由 Coze 拉取后，再进行 Chrome 真实验收。

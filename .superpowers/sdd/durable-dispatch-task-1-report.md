# Skill 持久调度纠偏 Task 1 实施报告

## 范围与基线

- 基线：`ea60e7fa528ef8c1d9c423f7f9bf95f32003b53a`
- 提交：`99846fe5`（`fix: persist truthful skill results`）
- 实施范围：仅 Task 1 的步骤计费类型、可持久结果和历史投影。
- 未实施：Task 2 重试返回合同、Task 3 持久调度、首次 execution/dispatch lease 纠偏。
- `origin/stable`：`52f7c601ed150769e15d06fb435c6e360e28c9e7`，本 Task 未修改。
- 起始时四个受保护未跟踪项：`.playwright-cli/`、`_refs-asui-canvas/`、`_refs-hero-infinite-canvas/`、`docs/superpowers/plans/2026-08-02-provider-generation-video-reliability.md`；均未修改或纳入提交。

## TDD 证据

### RED

命令：

```bash
pnpm exec vitest run src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts
```

经一次仅修正既有 `output-present` 质量门禁夹具后，正式 RED 结果：

- Test Files：`2 failed | 1 passed`，共 `3`
- Tests：`4 failed | 28 passed`，共 `32`
- 精确失败原因：
  - orchestrator-role `generate_image` 实际收到 `image_generate`，期望 `chat`；
  - simple-chat 执行结果缺少 `outputs`；
  - 历史与新增 outputs 合并结果为 `undefined`；
  - Skill history 缺少持久 `outputs` 投影。

### GREEN

brief 三文件命令首次 GREEN：

- Test Files：`3 passed (3)`
- Tests：`32 passed (32)`

加入真实 chat adapter 文本类型回归后，同命令最终结果：

- Test Files：`3 passed (3)`
- Tests：`33 passed (33)`

brief 指定 GREEN 与目录隔离命令：

```bash
pnpm exec vitest run src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts
```

- Test Files：`5 passed (5)`
- Tests：`49 passed (49)`
- 目录合同：`21 Canvas / 16 simple-chat` 及双向隔离测试保持通过。

相关 Task 5 accounting：

```bash
pnpm exec vitest run src/__tests__/api/agent-runtime-accounting.test.ts
```

- Test Files：`1 passed (1)`
- Tests：`3 passed (3)`

## 实现结果

- 新增 `DurableSkillOutput` 与 `ExecuteSkillRunResult.outputs`。
- 新增 `skillStepCreditOperation(step)`：orchestrator 固定按 `chat`，真实图片步骤继续按 `image_generate`。
- chat adapter 将普通响应保存为 `text`，不再误称 `html`。
- 每个已通过质量门禁的步骤仅把规范化 `{ stepId, kind, content }` 写入 `tool.completed`；未持久化 API key、token 或完整上游响应。
- Executor 合并历史与新增 outputs，按 Skill 步骤定义顺序稳定排序，以 `stepId + kind` 去重。
- `run.completed.result` 同时保存 `assetVersionIds` 与 `outputs`。
- GET/list/history 从持久事件和终态结果读取并重新构造允许字段，不透传结果对象中的额外敏感字段。

## 文件清单

生产文件：

- `src/lib/skill-runtime/types.ts`
- `src/lib/skill-runtime/cost-estimator.ts`
- `src/lib/skill-runtime/executor.ts`
- `src/lib/skill-runtime/service.ts`
- `src/lib/skill-runtime/step-registry.ts`

测试文件：

- `src/__tests__/lib/skill-runtime-cost-estimator.test.ts`
- `src/__tests__/lib/skill-runtime-executor.test.ts`
- `src/__tests__/lib/skill-runtime-run-request.test.ts`
- `src/__tests__/api/skill-runs.test.ts`

报告：

- `.superpowers/sdd/durable-dispatch-task-1-report.md`

## 验证

- `pnpm ts-check`：通过，`0` TypeScript 错误。
- 目标 ESLint：通过，`0` 错误、`0` 警告。
- `git diff --check`：通过，`0` whitespace error。

## 自审

- 计费、执行适配器和持久结果的角色判断一致；未按表面 `toolId` 误计 orchestrator。
- 合并 helper 由 executor 与 service 共用，避免终态和 history 出现不同排序/去重规则。
- 成功 sibling 的输出在 `tool.completed` 中先持久化，后续步骤失败并跨 generation 恢复时仍可合并。
- 新增公开结果只包含 `stepId`、`kind`、`content`；测试验证 projection 中额外的 `apiKey` 和 `upstreamResponse` 不进入 history。
- 未修改 retry 的 `startedStepIds` 语义，未增加调度 lease 或恢复扫描行为。

## Concern

`pnpm check:protected-baseline` 的核心特征、组件路径、证据合同和 Git refs 检查均 PASS，但整体命令失败：该脚本从旧基线 `7fdc0108` 扫描当前仓库已有漂移及受保护 `.playwright-cli/`，报告 `42,356` 个既存阻断项。未尝试清理或改写这些非 Task 1 内容；本 Task 以起止 `git status`、`origin/stable` ref、提交文件清单和 `git diff --check` 证明边界。

## Concern 闭环（2026-09-02）

控制端用仅针对 `.playwright-cli/`、`_refs-asui-canvas/`、`_refs-hero-infinite-canvas/` 的临时 allow-path 重跑后，保护门禁精确剩余 9 条已提交 Task 4-6 成果。本次逐项核对 Git 内容历史后完成精确授权：

- `.superpowers/sdd/task-5-report.md`：首次 `77df365d`，最后内容提交 `eb053968`。
- `.superpowers/sdd/task-6-report.md`：首次 `d85a8b08`，最后内容提交 `364cdda7`。
- `.superpowers/sdd/unified-skill-task-2-report.md`：首次 `fb70d7c7`，最后内容提交 `50888daa`。
- `.superpowers/sdd/unified-skill-task-3-report.md`：首次 `d68391cc`，最后内容提交 `e196d039`。
- `.superpowers/sdd/unified-skill-task-4-report.md`：首次 `9226821e`，最后内容提交 `d0bf0dc3`。
- `migrations/20260902_unified_skill_task4_agent_controls.sql`：内容提交 `9226821e`。
- `migrations/20260902_unified_skill_task4_execution_fence.sql`：内容提交 `2bbd6851`。
- `migrations/20260903_unified_skill_task4_dispatch_lease.sql`：内容提交 `b8c687d3`。
- `migrations/20260904_unified_skill_task4_agent_edit_descriptor.sql`：内容提交 `b8c687d3`。

TDD RED：`pnpm exec vitest run tests/unit/protected-baseline-gate.spec.ts` 得到 `2 failed / 8 passed`；第一个失败完整列出上述 9 个缺失路径，第二个失败证明 migration provenance 从应有 `204` 条仍只有 `200` 条。

GREEN：

- `tests/unit/protected-baseline-gate.spec.ts`：`10 passed (10)`。
- 保护门禁（三个参考目录仅通过命令行临时 allow）：`0` 阻断、`0` 警告。
- Task 1 focused：`49 passed (49)`。
- `git diff --check`：`0` whitespace error。

授权文件仅新增 9 个精确路径；没有 `.superpowers/`、`migrations/` 或任何通配符/目录授权。四个 migration 按现有治理合同补入真实 `sourceCommit`。原 concern 已闭环。

闭环提交：`5cd5a44c`（`test: authorize unified skill runtime artifacts`）。

## HTML 持久化净化复审闭环（2026-09-02）

独立复审确认 `result.html` 与恢复输入 `existingOutputs` 在进入持久事件和最终结果前缺少可信净化边界。修复严格限定在 Task 1 的结果真实性范围，没有修改 retry、dispatch lease 或恢复状态机。

### TDD 证据

RED：先在 `src/__tests__/lib/skill-runtime-executor.test.ts` 增加恶意 HTML 恢复执行用例，再运行：

```bash
pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts
```

结果为 `1 failed / 19 passed`。失败值完整保留了历史 `onload`、`<script>`、`javascript:` URL，证明用例命中真实持久化缺口。

GREEN：在 `src/lib/skill-runtime/executor.ts` 内增加服务端白名单净化器，复用已有生产依赖 `@xmldom/xmldom`，没有增加依赖。净化规则如下：

- 保留常用文本、列表、表格、链接和图片等安全基础标签；不在白名单内的容器仅保留其安全子内容。
- 完整删除 `script`、`style`、`iframe`、`object`、`embed`、`template` 及其内容。
- 删除所有 `on*` 事件属性与未授权属性。
- `href/src` 仅允许 `http`、`https`、`mailto`（仅 `href`）、相对路径和锚点；拒绝 `javascript`、`data`、`vbscript` 与协议相对 URL。
- 当前 adapter HTML 在写入 `tool.completed` 前净化；历史 `existingOutputs` 在 merge 和 `run.completed.result` 前再次净化。

### 验证结果

- Task 1 focused：`5` 个文件、`50 passed / 0 failed`。
- `pnpm ts-check`：通过，`0` TypeScript 错误。
- 改动文件 ESLint：通过，`0` 错误、`0` 警告。
- 保护门禁：仅通过命令行临时允许 `.playwright-cli/`、`_refs-asui-canvas/`、`_refs-hero-infinite-canvas/`，结果 `0` 阻断、`0` 警告。
- 未新增保护路径授权，未触碰四个受保护未跟踪项。

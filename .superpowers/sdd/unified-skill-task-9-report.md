# Unified Skill Runtime Task 9 实施报告

## 结论

Task 9 已在当前 `main@10661f7a` 基线上完成本地实现与回归：节点模式新增同源 `ai-skill` 节点，使用 workflow 专属 Skill 目录和统一 Skill Run 服务，不复制 21 份业务表单，也不把 Canvas Skills 混入独立智能对话页面。

交付状态为 **本地完成、外部条件保留**。本地全量测试、TypeScript、目标 ESLint 和生产构建通过；缺少 `POSTGRES_TEST_DATABASE_URL` 的真实 PostgreSQL 并发测试仍明确未验证，Coze exact-SHA 与 Google Chrome 真实业务验收也尚未执行。Task 10 没有开始，`stable@52f7c601` 未触碰。

## TDD 记录

### 初始 RED

先建立以下测试，再实现节点类型、目录和执行接线：

- `src/__tests__/lib/workflow-skill-node.test.ts`
- `src/__tests__/components/node-editor-skill-node.test.tsx`
- `src/__tests__/api/workflow-skill-execution.test.ts`

初始测试稳定失败，原因符合计划：`ai-skill` 尚未定义，节点编辑器没有 workflow Skill 目录和动态输入，工作流执行 API 也不能创建或投影 Skill Run。

### 评审驱动 RED/GREEN

后续每项均先用失败测试复现，再做最小修复：

1. 根执行与嵌套执行身份、取消传播及活动 Run 注册竞态。
2. 失败、暂停、取消和恢复后的 `runId`、`resumeFromStepId` 与持久化投影。
3. 手动重试幂等命名空间、循环节点局部身份和同节点重复执行隔离。
4. `prompt/image/reference` 输入映射、资产版本解析和来源 lineage。
5. 精确 provider/model 授权角色、清空模型绑定及禁用 Skill 过滤。
6. 提交/恢复超时、底层取消、取消确认失败和迟到完成拒绝。
7. Skill Run 取消接口真实 `{ projection }` 响应结构。
8. rollout 开关关闭时 UI 隐藏并由服务端拒绝执行。
9. 取消与 Skill 提交并发时等待 `runId` 注册，避免迟到计费 Run 变成孤儿任务。
10. 节点清空字段不再遮挡上游输入，仅连接参考图端口时不再误升格为主图。
11. 已暂停 Run 先按持久化 `runId + resumeFromStepId` 恢复，不再被后续 Skill 改名或版本变化阻断。

## 实现摘要

- 新增 `NodeType = 'ai-skill'`、节点模板、标准输入输出端口及渲染图标。
- 节点面板只请求 `GET /api/skills?surface=workflow`，并复用共享 `SkillInputFields` 动态渲染输入。
- 运行请求冻结 Skill/version、结构化输入、精确模型绑定、上游资产版本和幂等身份。
- 工作流执行通过认证内部请求调用 `/api/skill-runs`，不在节点层复制任务、供应商、积分或资产逻辑。
- 进度、错误、暂停、取消和结果统一来自 Skill Run 投影；节点仅持久化最小配置和 `runId`。
- 根工作流与嵌套工作流共享取消状态；缓存丢失时仍可从持久化工作流投影取消真实 Run。
- 暂停 Run 可从保存的步骤继续；超时会主动取消底层工作并保持终态一致。
- rollout 开关 `NEXT_PUBLIC_WUJIE_ENABLE_WORKFLOW_SKILL_NODE=false` 可同时关闭 UI 入口和服务端执行。
- 未修改 Simple Chat 16 Skills 的目录或入口，未开始 Task 10。

## 验证结果

目标回归：

```text
6 files passed / 73 tests passed
```

相关工作流与分层回归：

```text
3 files passed / 36 tests passed
```

全仓 Vitest：

```text
623 files passed / 27 skipped
4844 tests passed / 142 skipped / 0 failed
```

跳过项均由缺少 `POSTGRES_TEST_DATABASE_URL` 的环境门禁产生，不标记为通过。

其他门禁：

- `pnpm ts-check`：通过。
- Task 9 目标 ESLint `--quiet`：通过，零错误。
- `git diff --check`：通过；仅有 Windows LF/CRLF 工作区提示。
- 默认约 4 GiB Node 堆构建发生 OOM；未改项目配置，使用一次性 `NODE_OPTIONS=--max-old-space-size=8192` 重跑后生产构建通过，119 个静态页面完成。

## 独立评审

多轮独立评审发现的取消、恢复、并发、幂等、输入映射、授权、超时和 rollout 问题均已补充行为测试并修复。最后一轮独立评审又指出“取消时提交未完成”、“空字段遮挡上游输入”、“暂停 Run 被可变 Skill 版本阻断”和“参考图误当主图”边界；均已先增加 RED 再最小修复，并由定向回归、TypeScript、ESLint 和全仓回归证明。仍不把 Task 9 写成云端或发布级通过。

## 改动范围

生产代码：

- `src/lib/workflow-engine.ts`
- `src/components/node-editor.tsx`
- `src/app/api/workflow/execute/route.ts`
- `src/lib/workflow-renderer/presentation.ts`
- `src/lib/skill-runtime/service.ts`
- `src/lib/skill-runtime/workflow-client.ts`
- `src/lib/workflow-execution-context.ts`
- `src/lib/workflow-skill-execution.ts`

测试代码：

- `src/__tests__/api/workflow-skill-execution.test.ts`
- `src/__tests__/components/node-editor-skill-node.test.tsx`
- `src/__tests__/lib/workflow-skill-node.test.ts`
- `src/__tests__/api/workflow-annotation-auth-wiring.test.ts`
- `src/__tests__/api/workflow-layer-task.test.ts`
- `src/__tests__/lib/skill-runtime-executor.test.ts`

## 未验证项

- 隔离 PostgreSQL 上的并发幂等、取消与账务一致性。
- Coze exact-SHA 拉取、构建和重启。
- 既有 Google Chrome 标签中的节点创建、动态输入、上游图片/参考图、运行进度、暂停/继续/取消、结果回填、保存及刷新恢复。
- rollout 开关在云端的关闭与恢复演练。

下一唯一阶段是 Task 10：只对独立智能对话建立 16 Skills 的 UI 与服务端双层隔离门禁。不得重做 Task 8/9，也不得修改 `stable`。

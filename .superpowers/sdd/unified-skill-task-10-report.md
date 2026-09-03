# 统一 Skill Runtime Task 10 实施报告

## 结论

Task 10 已在 `main@347b0b21` 基线上完成本地实现：独立智能对话继续只显示自身 16 个 Skills，服务端会在幂等、模型及供应商解析之前拒绝 21 个 Canvas/Workflow Skill ID。无限画布 AI 对话与节点模式的 21 个 Skills 没有接入 `/simple-chat`。

状态为 **Task 10 本地完成，Task 11 保护清单待收口**。`stable@52f7c601` 未触碰，未推送 GitHub，未进行 Coze/Google Chrome 云端验收。

## TDD 与评审

初始 RED 证明：伪造 `preset-ecommerce-listing` 时，旧路由会继续进入供应商解析并返回 400，而不是在 Skill 作用域边界返回 403。

独立评审进一步发现非法类型、空值、空白和超长 `skillId` 可绕过或得到错误分类。补充 RED 后，校验被限制在 Simple Chat 顶层请求，不修改共享 Agent 请求解析器；资产注册继续在 Skill 门禁前独立返回。

最终门禁覆盖：

- 21 个 Canvas/Workflow Skill：精确 `403 / SKILL_SURFACE_FORBIDDEN`，供应商零调用。
- 16 个 Simple Chat Skill：全部允许进入供应商解析，不被误伤。
- 未知 Skill：精确 `404 / SKILL_NOT_FOUND`。
- 非字符串、`null`、空值、空白和超过 256 字符：精确 `400 / SKILL_ID_INVALID`。
- UI：完整、有序的 16 个 Simple Chat Skill ID，且不包含“电商商品套图”。

最终复审结论：P1/P2 阻断为 0，可以提交。

## 验证结果

- Task 10 计划回归：`6 files / 106 tests` 通过。
- 扩大关联回归：`8 files / 133 tests` 通过。
- TypeScript：`pnpm ts-check` 通过。
- 目标 ESLint `--quiet`：通过，零错误。
- `git diff --check`：通过，仅有 Windows LF/CRLF 提示。
- 8 GiB 生产构建：通过，`119/119` 静态页面生成完成。
- 全仓 Vitest：`4890 passed / 142 PostgreSQL-gated skipped / 1 failed`。

全仓唯一失败为保护基线尚未授权 Task 9 已提交的四个生产文件：

- `src/app/api/workflow/execute/route.ts`
- `src/lib/skill-runtime/workflow-client.ts`
- `src/lib/workflow-execution-context.ts`
- `src/lib/workflow-skill-execution.ts`

该失败属于计划中的 Task 11 清单与保护门禁，未通过跳过或删除测试掩盖。本次 Task 10 生产文件没有出现在未授权漂移列表中。

## 改动范围

- `src/app/api/simple-chat/chat/route.ts`
- `src/components/simple-chat/chat-area.tsx`
- `src/__tests__/api/simple-chat-skill-scope.test.ts`
- `src/__tests__/components/simple-chat-skill-isolation.test.tsx`

## 未验证项

- Task 11 的 21/16 清单、保护基线和三浏览器 E2E。
- 缺少 `POSTGRES_TEST_DATABASE_URL` 的 142 项真库测试。
- Coze exact-SHA 拉取、构建、重启和 Google Chrome 真实页面验收。

下一唯一阶段是 Task 11：保护清单、全量回归和 Chromium/Firefox/WebKit E2E。不得重做 Task 8/9/10，不得触碰 `stable`。

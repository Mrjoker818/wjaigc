# WJ-STABLE-001 Stage 0 验收报告

> 验收日期：2026-08-08
> 计划阶段：S0 版本收口与功能冻结
> 基线提交：`origin/main@69ba94ef6bde041293ad9609ec76285d3e287a7f`
> 验收候选：`cd19d88fc9778635ee557da2e741f47f2def2cfd`（报告生成前）
> 实施分支：`codex/wj-stable-s0`

## 阶段结论

**Stage 0 基础设施目标完成，但无界平台整体发布结论仍为“不通过”。**

本阶段只建立版本基线、受保护功能清单、兼容样本、证据契约和发布阻断门禁，没有修改供应商、登录、任务、积分、画布、节点或聊天等业务运行代码。

云端页面可达，但运行 Git SHA 无法确认，因此 Playwright 证据状态为 `BLOCKED`，不能将页面可达解释为业务通过。

## 已交付内容

| 项目 | 结果 |
| --- | --- |
| 受保护功能 | 38 项 |
| 产品表面 | 7 个：身份、创作者仪表盘、管理员仪表盘、工作区、公开交付、桌面连接器、支持运维 |
| 核心工作区 | 3 个：无限画布、节点模式、独立智能对话 |
| 兼容性固定样本 | 15 个 |
| 静态发现 | 186 个 API 路由、51 个工作流节点类型、150 个组件、7 个 Agent 工具、23 个图片工具栏动作 |
| 证据契约 | 截图、Console、Network、任务证据和可追溯 Manifest |
| GitHub 门禁 | 受保护功能删除、重复 ID、越界业务源码变化、证据契约缺失均阻断 |

## 验证结果

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| S0 专项 Vitest | 通过 | 3 个测试文件，15/15 用例通过 |
| TypeScript | 通过 | `tsc --noEmit --incremental false`，退出码 0 |
| Doctor | 通过 | `pnpm doctor`，退出码 0 |
| 生产构建 | 通过 | `pnpm build`，退出码 0 |
| 保护基线门禁 | 通过并有 1 个预期警告 | 38 个功能 ID 全部存在；无越界源码漂移 |
| Git 差异检查 | 通过 | `git diff --check`，退出码 0 |
| 全量 Vitest | 未通过，和基线一致 | 1489 通过、5 失败、4 跳过；没有新增失败 |
| ESLint | 未通过，和业务基线一致 | 4 errors、962 warnings；S0 未修改对应业务文件 |
| Chromium 云端证据 | 阻塞 | 页面可达；运行 SHA 无法确认，测试按契约跳过并写入 `BLOCKED` 证据 |

## 基线遗留测试失败

以下 5 项在 Stage 0 开始前已经失败，本阶段没有越界修改业务代码：

1. `src/__tests__/lib/api-compatibility.test.ts`：4SAPI 协议识别期望与当前实现不一致。
2. `src/__tests__/lib/pear-layer-adapter.test.ts`：Pear 分层请求中的 `prompt: "."` 与测试期望不一致。
3. `src/__tests__/components/image-tool-request-integrity.test.ts`：测试依赖旧的精确源码字符串。
4. `src/__tests__/lib/upscale-onnx-model.test.ts`：ONNX 线程数已改为环境驱动，测试仍期望固定值 2。
5. `src/__tests__/lib/video-api-parsing.test.ts`：Pear 字符串结果未提供测试期望的时长 5。

## 基线遗留 Lint 错误

4 个错误均位于 `origin/main` 已存在且本阶段未修改的业务文件：

1. `src/app/api/image/upscale-pro/route.ts`：`tileSize` 应为 `const`。
2. `src/components/help-guide.tsx`：2 个未转义双引号。
3. `src/components/layered-editor-panel.tsx`：变量声明前访问。

这些问题必须在后续对应阶段建立复现和回归测试后处理，不能混入 S0 基础设施提交。

## 浏览器证据与阻塞

- 部署地址：`https://www.wjaigc.top/`
- 浏览器：Playwright Chromium
- 视口：`1280 × 720`
- 页面：可达
- 未捕获 `pageerror`：0
- 业务任务：未发起
- 云端运行 Commit：未确认
- 结论：`BLOCKED`

浏览器还记录到两项后续调查线索：

1. APM Plus 脚本域名被当前 CSP 拒绝。
2. 数据隔离层报告从 `admin_mr_joker` 清除了 2 个跨用户项目。

## 下一阶段边界

下一步只能先生成并评审 S1“稳定任务与账务核心”的详细实施计划。S1 未经确认前，不进入供应商任务、积分扣费、退款、任务终态或并发幂等的业务代码修改。

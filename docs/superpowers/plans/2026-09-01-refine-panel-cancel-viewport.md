# 精修面板取消与视口可靠性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复精修任务在提交响应前取消时的假取消竞态，确保浮窗始终位于视口内，并向用户展示服务端真实错误。

**Architecture:** 保持后端精修任务、原子终态和退款协议不变，在前端使用显式运行阶段、运行令牌、取消意图和单次取消 Promise 管理异步生命周期。浮窗边界计算下沉为纯函数，由组件在首次测量、拖动和窗口变化时统一调用。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest 3、Testing Library、Tailwind CSS 4。

## Global Constraints

- 只修改 `main`，不得修改或合并到 `stable`。
- V5.8.8 donor 保持只读，不复制其同样存在缺陷的精修面板。
- 不修改 `/api/refine-engine`、`/api/poll-task`、`/api/cancel-task`、数据库结构、积分规则和供应商协议。
- 每个行为必须先在当前实现上看到预期 RED，再写最小生产代码。
- 取消成功前不得显示已取消；取消失败必须继续确认真实任务终态。
- 已取消或旧运行的迟到响应不得展示结果或重新开始轮询。
- 浮窗安全边距固定为 `16px`；内容滚动，标题和底部操作区可达。
- 不提交 `.playwright-cli/`、参考仓库或其他既有未跟踪文件。

---

### Task 1: 浮窗位置纯函数

**Files:**
- Modify: `src/lib/floating-panel-position.ts`
- Create: `src/__tests__/lib/floating-panel-position.test.ts`

**Interfaces:**
- Consumes: 现有 `FloatingPanelPosition`。
- Produces: `constrainFloatingPanelPosition(input): FloatingPanelPosition`，供精修面板首次布局、拖动和 resize 使用。

- [ ] **Step 1: 编写视口边界失败测试**

测试桌面、窄屏、四边拖动和视口缩小时，返回坐标满足：

```ts
expect(constrainFloatingPanelPosition({
  x: 1500,
  y: 900,
  panelWidth: 460,
  panelHeight: 795,
  viewportWidth: 2048,
  viewportHeight: 935,
  margin: 16,
})).toEqual({ x: 1500, y: 124 });
```

当面板大于可视区时，坐标固定在安全边距，组件负责把实际宽高限制在可视区。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/floating-panel-position.test.ts`

Expected: FAIL，原因是 `constrainFloatingPanelPosition` 尚未导出。

- [ ] **Step 3: 实现最小纯函数**

函数先规范化 margin/viewport/panel 数值，再把 `x` 和 `y` clamp 到 `[margin, viewport - margin - effectivePanelSize]`。不得引入 DOM 或 React 依赖。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/floating-panel-position.test.ts`

Expected: PASS，全部边界用例通过。

### Task 2: 精修任务生命周期与提交中取消

**Files:**
- Modify: `src/components/refine-engine-panel.tsx`
- Create: `src/__tests__/components/refine-engine-panel-lifecycle.test.tsx`

**Interfaces:**
- Consumes: 现有精修、轮询和取消 JSON 协议。
- Produces: `RefineRunPhase = 'idle' | 'submitting' | 'processing' | 'cancelling' | 'completed' | 'failed' | 'cancelled'` 的前端运行状态。

- [ ] **Step 1: 编写提交中取消的组件 RED**

测试用 deferred Promise 挂起 `/api/refine-engine`：点击“开始精修”后立即点击“取消”，确认 taskId 返回前没有取消请求；返回 `task-race` 后恰好发送一次：

```ts
expect(cancelBodies).toEqual([{ taskId: 'task-race' }]);
expect(pollBodies).toEqual([]);
expect(screen.getByText('任务已取消')).toBeTruthy();
```

同时断言服务端确认前只显示“正在确认任务并取消…”，不能显示“任务已取消”。

- [ ] **Step 2: 运行组件测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/refine-engine-panel-lifecycle.test.tsx`

Expected: FAIL，当前实现不会在 taskId 返回后补发取消，并会开始轮询。

- [ ] **Step 3: 最小实现显式阶段和运行令牌**

在组件中增加：

```ts
type RefineRunPhase = 'idle' | 'submitting' | 'processing' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

const runTokenRef = useRef(0);
const cancelRequestedRef = useRef(false);
const cancelPromiseRef = useRef<Promise<boolean> | null>(null);
```

每次运行递增令牌并清理旧计时器；所有异步响应在更新 UI 前核对令牌。取消函数记录意图，拿到 taskId 后复用同一 Promise 调用一次 `/api/cancel-task`。成功后进入 `cancelled` 并阻止轮询；失败进入 `processing` 并继续确认真实状态。

- [ ] **Step 4: 增加取消失败与迟到结果 RED/GREEN**

覆盖：

```ts
// 取消返回 409：显示真实原因，并继续 poll。
// 已确认取消后 deferred completed：不展示图片，不调用 onAddImage。
// 连点取消：同一 taskId 只发送一次 cancel。
// 新运行开始后，旧运行响应不得覆盖新运行。
```

逐条先运行到 RED，再补最小实现并运行到 GREEN。

- [ ] **Step 5: 保持正常完成路径回归**

测试同步直接图片和异步 poll completed 均仍展示正确结果；开始按钮在终态后恢复可用。

### Task 3: 真实错误提取与失败界面

**Files:**
- Modify: `src/components/refine-engine-panel.tsx`
- Test: `src/__tests__/components/refine-engine-panel-lifecycle.test.tsx`

**Interfaces:**
- Produces: `extractRefineError(payload, status?, fallback): string` 纯函数或文件内等价纯逻辑。

- [ ] **Step 1: 编写嵌套错误 RED**

模拟 HTTP 500：

```ts
Response.json({ BaseResp: { StatusMessage: 'no sandbox ID found for taskID' } }, { status: 500 })
```

断言结果页显示该内容及“返回精修设置”，且不显示“暂无精修结果”。

- [ ] **Step 2: 实现最小错误提取和失败视图**

按 `error → message → BaseResp.StatusMessage → HTTP 状态 → fallback` 提取；字符串和 `{ message }` 均可读。提交、取消、轮询失败共享该逻辑，失败态保留清晰重试入口。

- [ ] **Step 3: 运行组件测试确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/refine-engine-panel-lifecycle.test.tsx`

Expected: PASS，空结果态不再掩盖失败。

### Task 4: 精修浮窗接入视口约束

**Files:**
- Modify: `src/components/refine-engine-panel.tsx`
- Test: `src/__tests__/components/refine-engine-panel-lifecycle.test.tsx`
- Test: `src/__tests__/lib/floating-panel-position.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `constrainFloatingPanelPosition`。

- [ ] **Step 1: 编写组件布局 RED**

mock `getBoundingClientRect()` 为真实高度 `795px`，设置 `window.innerWidth=2048`、`innerHeight=935`，断言面板 `top <= 124`、`maxHeight=903px`、宽度不超过 `460px`。再触发 resize 到 `320×568`，断言 `left=16`、宽度 `288px`、最大高度 `536px`。

- [ ] **Step 2: 最小接入实际尺寸和 resize**

首次挂载后读取 `panelRef.current.getBoundingClientRect()`，用实际尺寸居中并 clamp；拖动 mousemove 与 window resize 使用同一函数。根容器宽度为 `min(460px, viewportWidth - 32px)`，最大高度为 `viewportHeight - 32px`。

- [ ] **Step 3: 运行布局测试确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/components/refine-engine-panel-lifecycle.test.tsx src/__tests__/lib/floating-panel-position.test.ts`

Expected: PASS，无越界且原面板内容仍独立滚动。

### Task 5: 专项与全量门禁

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`

- [ ] **Step 1: 运行精修和取消专项**

Run:

```bash
pnpm exec vitest run src/__tests__/components/refine-engine-panel-lifecycle.test.tsx src/__tests__/lib/floating-panel-position.test.ts src/__tests__/api/refine-async-terminal-contract.test.ts src/__tests__/api/cancel-task.test.ts
```

Expected: 0 failed。

- [ ] **Step 2: 运行全量工程门禁**

Run:

```bash
pnpm ts-check
pnpm lint
pnpm test
pnpm build
pnpm check:protected-baseline
```

Expected: TypeScript 通过、ESLint 0 errors、测试 0 failed、构建成功、保护基线无未授权源码漂移。若 PostgreSQL 用例因环境门禁跳过，必须明确记录，不能写成全量通过。

- [ ] **Step 3: 更新中文测试记录**

登记真实复现、根因、修改文件、RED/GREEN 结果及云端待验项。积分时间 `NaN/NaN` 保留为独立缺陷，不在本批次误标修复。

- [ ] **Step 4: 提交本地候选**

仅暂存本计划列出的源码、测试和报告文件，检查 `git diff --cached --name-only` 后提交；不得暂存既有未跟踪目录。

### Task 6: GitHub、Coze 与 Google Chrome 验收

**Files:**
- Modify after evidence: `docs/testing/REGRESSION_REPORT.md`
- Modify after evidence: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify outside repository: Obsidian `无界计划/11-阶段进度看板.md`、`16-V5.8.8选择性吸收.md`

- [ ] **Step 1: 推送 main 并核对 SHA**

确认 `git rev-parse HEAD` 与 `git rev-parse origin/main` 一致，确认 `stable` SHA 未变。

- [ ] **Step 2: Coze 拉取 exact-SHA 并重启沙箱**

只使用既有 Google Chrome 项目页；沙箱恢复后强制刷新既有预览页，不新建标签，不进入 360。

- [ ] **Step 3: 执行一次提交阶段真实取消**

证据必须包含一个 `/api/refine-engine`、恰好一个 `/api/cancel-task`、取消成功后零继续轮询、无结果回填、一次扣费和一次对应退款、刷新后余额稳定。

- [ ] **Step 4: 执行一次处理中真实取消**

取得相同终态、退款和迟到完成拒绝证据；Console error/warning 检查为 0 或逐项解释。

- [ ] **Step 5: 更新报告与 Obsidian**

只有云端全部证据满足时关闭该门禁；否则标记“不通过”或“未验证”，并保留精确阻塞点。随后才允许进入下一 V5.8.8 吸收项。

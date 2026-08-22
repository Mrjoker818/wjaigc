# V588-UI-002 Canvas Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前无限画布控制器之上增加不破坏既有功能的命令面板，并完成本地与云端回归闭环。

**Architecture:** `CanvasCommandPalette` 是无领域状态的叶组件；`InfiniteCanvas` 持有开关和命令回调；`CanvasZoomCluster` 只暴露打开入口。全部动作复用当前视图、选择和工具会话处理路径。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS 4、lucide-react、Vitest、Testing Library、Playwright/Google Chrome。

## Global Constraints

- 只修改 `main`；禁止修改 `stable` 与 `J:\无界云端0820`。
- 先 RED，再最小 GREEN；没有失败测试不得写生产代码。
- 不引入小地图、协作、供应商、任务、账务、持久化或 `asset-v3` 改动。
- 不删除、隐藏、重命名或替换现有画布入口与处理函数。
- 输入框、文本域、选择框和可编辑区域中的 `Ctrl/Cmd+K` 不得被画布劫持。

---

### Task 1: 建立命令面板 RED 门禁

**Files:**
- Create: `src/__tests__/components/canvas-command-palette.test.tsx`
- Create: `src/__tests__/components/canvas-command-palette-wiring.test.ts`

**Interfaces:**
- Consumes: 当前 `InfiniteCanvas` 的视图、选择、指针工具和工具会话函数。
- Produces: 对 `CanvasCommandPalette`、`filterCanvasCommands`、工具簇入口和父画布接线的失败契约。

- [ ] 写过滤、焦点、键盘、鼠标、空结果和关闭行为测试。
- [ ] 写源码接线契约，要求 `CanvasZoomCluster.onOpenCommandPalette` 与父画布命令回调存在。
- [ ] 运行 `pnpm exec vitest run src/__tests__/components/canvas-command-palette.test.tsx src/__tests__/components/canvas-command-palette-wiring.test.ts`，确认因组件和接线缺失而失败。

### Task 2: 最小实现叶组件

**Files:**
- Create: `src/components/canvas/CanvasCommandPalette.tsx`
- Modify: `src/components/canvas/CanvasZoomCluster.tsx`

**Interfaces:**
- Consumes: `CanvasCommandItem[]`、主题和关闭回调。
- Produces: `filterCanvasCommands(commands, query)` 与 `CanvasCommandPalette`；工具簇新增 `onOpenCommandPalette(): void`。

- [ ] 实现四通道大小写不敏感过滤。
- [ ] 实现自动聚焦、循环导航、Enter、Escape、Ctrl/Cmd+K、鼠标和遮罩关闭。
- [ ] 给工具簇增加命令图标入口，保持其余按钮与顺序不变。
- [ ] 运行 Task 1 测试，确认叶组件相关断言转绿，父画布接线仍按预期失败。

### Task 3: 接入当前 InfiniteCanvas 控制器

**Files:**
- Modify: `src/components/infinite-canvas.tsx`

**Interfaces:**
- Consumes: `resetViewToContent`、`zoomViewportAtPoint`、`setGridMode`、`setShowConnections`、`activePointerToolRef`、`setActivePointerTool`、`setSelectedIds`、`selectImage`、`activateCanvasToolSession`、`closeCanvasToolPanels`。
- Produces: `commandPaletteOpen`、当前命令列表、受输入焦点保护的 `Ctrl/Cmd+K` 开关和命令面板渲染。

- [ ] 在现有稳定键盘处理器中最先识别 `Ctrl/Cmd+K`，输入目标返回不处理，面板打开时切换关闭。
- [ ] 建立视图、工具、选择、图层和历史命令回调；图层/历史必须复用当前互斥路径。
- [ ] 将打开回调传给 `CanvasZoomCluster` 并在画布根部渲染 `CanvasCommandPalette`。
- [ ] 运行 Task 1 全部测试，确认通过。

### Task 4: 本地全量回归与治理记录

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify: `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: Task 1-3 的代码和测试结果。
- Produces: 本地候选状态、来源哈希、门禁结果和云端待验条件。

- [ ] 运行聚焦组件与接线测试。
- [ ] 运行 `pnpm ts-check`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm check:protected-baseline` 和 `git diff --check`。
- [ ] 只在全部通过后更新仓库报告和 Obsidian 进度；明确 PostgreSQL 跳过项及云端未验证项。
- [ ] 提交并推送 `main`，再次核对 `origin/stable` 未变化。

### Task 5: Coze Google Chrome 云端验收

**Files:**
- Create: `docs/testing/evidence/v588-ui-002-cloud-2026-08-22.json`
- Create: `docs/testing/evidence/v588-ui-002-cloud-2026-08-22.png`
- Modify: Task 4 的四份仓库报告与两份 Obsidian 进度文件。

**Interfaces:**
- Consumes: Coze exact-tree 候选与已登录 Google Chrome 现有标签页。
- Produces: 入口、快捷键、搜索、动作、输入保护、视觉和 Console 的真实证据。

- [ ] Coze 拉取 `main` 后验证代码树、构建、HTTP 健康和 `stable` SHA。
- [ ] 在现有 Chrome 标签页验证按钮与 `Ctrl/Cmd+K` 打开、搜索、上下导航、Enter、Escape、遮罩关闭。
- [ ] 验证重置/缩放/网格/连线/选择/抓手/图层/历史动作，并证明图层/历史仍互斥。
- [ ] 在提示词输入框中按 `Ctrl/Cmd+K`，确认内容和焦点不被命令面板劫持。
- [ ] 保存截图、Console 和机器 JSON；通过后标记 `V588-UI-002` 已吸收，否则登记缺陷并保持未通过。

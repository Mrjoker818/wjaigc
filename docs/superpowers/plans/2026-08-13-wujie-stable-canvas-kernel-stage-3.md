# 无界无限画布稳定内核 Stage 3 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留全部现有入口、工具、旧项目和 Stage 2 素材语义的前提下，将无限画布的视口、渲染、选择、命令、历史、任务投影、持久化和工具会话逐项收拢为可测试的稳定内核，并达到既定商业级交互性能门禁。

**Architecture:** 不重写画布，不改变视觉设计，不同时迁移多个职责。新增 `legacy -> shadow -> canvas-v2` 三态画布内核：`legacy` 继续执行现有逻辑，`shadow` 使用相同输入计算新内核结果但不写业务状态，只记录脱敏差异；单项行为和性能门禁通过后，`canvas-v2` 才逐项成为权威。React 只渲染控制器投影，指针高频预览使用 `requestAnimationFrame` 和直接 transform，业务提交仍通过不可覆盖命令、Stage 2 placement 协调和数据库权威任务投影完成。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Tailwind CSS 4、RBush、Vitest、Playwright、PostgreSQL、现有 Asset Graph/Task Core/UserManagerCore。

## Global Constraints

- 实施基线固定为 `origin/main@18346aa3c48f455ed8d01c3093eea2474e41a166`；工作分支为 `codex/wj-stable-s3`，工作目录为 `.worktrees/wj-stable-s3`。
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永久只读；不得合并、重置、强推或直接提交到 `stable`。
- Stage 2 Tasks 1-9 已完成，不得重做；最终云端保持 `WUJIE_ASSET_GRAPH_MODE=legacy`、`WUJIE_TASK_CORE_MODE=legacy`、物理 purge disabled，除非另有独立批准。
- 本阶段只处理无限画布稳定内核；不得提前实施 Stage 4 节点模式/Agent 重构或 Stage 5 业务工具质量升级。
- 38 项受保护功能、7 个产品表面、无限画布/节点模式/独立智能对话三个工作区、图片浮动工具栏和底部工具栏入口保留率必须为 100%。
- 现有工具的模型路由、参数、扣费、退款和业务结果不得因内核迁移而改变；本阶段只统一画布侧会话和投影边界。
- 新内核开关固定为 `WUJIE_CANVAS_KERNEL_MODE=legacy|shadow|canvas-v2`，默认 `legacy`；未知值必须回落 `legacy`。
- `shadow` 禁止写 React 业务状态、项目数据、Asset Graph、任务、积分或媒体文件；只允许记录计数、耗时和脱敏差异码。
- 任何用户手势只产生一个历史事务；服务器同步、项目水合、任务进度和 shadow 计算不得进入用户撤销栈。
- 图片节点在平移、缩放和加载期间不得出现空白消失帧；未加载、损坏、处理中和失败必须有互斥且可理解的可见状态。
- 性能门禁：空画布 2 秒内可交互；缓存项目 3 秒内打开；100 节点平移平均不低于 55 FPS；300 节点不低于 45 FPS；拖动和缩放输入延迟 P95 不高于 50ms；图片消失帧和不可点击时间均为 0；保存主线程阻塞不超过 100ms。
- 不能用当前 `scripts/benchmark-ui-interactions.mjs` 的字符串微基准替代真实 DOM/浏览器性能证据。
- 每个 Task 必须先 RED、再最小实现、再聚焦回归和受保护功能门禁；未经真实验证的云端项标记 `UNVERIFIED`。
- 每次候选版本必须回归入口、正确登录、刷新保持、三个工作区进出、退出、错误密码、会话超时和鉴权超时，不得再次引入“正在验证身份”卡死。
- 所有测试账号、密码、Cookie、Token、API Key、真实用户图片和数据库连接串不得进入 Git、报告或浏览器证据。

## File Structure

- `src/lib/canvas-kernel/mode.ts`: 三态开关和纯读写策略。
- `src/lib/canvas-kernel/types.ts`: 视口、选择、手势、命令、历史、渲染投影和工具会话领域类型。
- `src/lib/canvas-kernel/viewport.ts`: 坐标转换、平移、缩放、内容适配、裁剪走廊和视口状态机。
- `src/lib/canvas-kernel/render-policy.ts`: 可见节点、保活节点、分级图片加载和渲染优先级。
- `src/lib/canvas-kernel/selection.ts`: 点选、多选、框选、命中顺序和选择不变量。
- `src/lib/canvas-kernel/commands.ts`: 添加、移动、缩放、删除、复制、层级、分组和任务结果命令。
- `src/lib/canvas-kernel/history.ts`: 明确事务边界的撤销/重做控制器。
- `src/lib/canvas-kernel/task-projection.ts`: 任务占位框、逐张结果和终态的画布纯投影。
- `src/lib/canvas-kernel/persistence.ts`: 快照准备、合并调度、空闲序列化和刷新前最小提交。
- `src/lib/canvas-kernel/tool-registry.ts`: 工具描述、入口映射、互斥会话和关闭规则。
- `src/lib/canvas-kernel/metrics.ts`: 性能采样、shadow 差异和脱敏诊断。
- `src/components/canvas/use-canvas-viewport.ts`: 视口控制器 React 适配器。
- `src/components/canvas/use-canvas-selection.ts`: 选择控制器 React 适配器。
- `src/components/canvas/CanvasMediaNode.tsx`: 单个媒体节点与加载状态。
- `src/components/canvas/CanvasSurface.tsx`: 变换层、可见节点和交互表面。
- `src/components/canvas/CanvasToolHost.tsx`: 工具注册表和工具会话面板宿主。
- `scripts/stage-3-e2e-fixtures.mjs`: 只在受控测试数据库创建 1/100/300 节点项目并可完整清理。
- `tests/helpers/canvas-performance.ts`: FPS、输入延迟、长任务、消失帧和不可点击时间采集。
- `tests/e2e/stage-3-canvas-kernel.spec.ts`: Chromium/Firefox/WebKit、1080p 和移动端的功能与性能门禁。

---

### Task 0: 固定 Stage 3 基线、三态开关和阶段账本

**Files:**
- Create: `src/lib/canvas-kernel/mode.ts`
- Modify: `src/app/api/user-data/sync/route.ts`
- Modify: `src/lib/user-manager.ts`
- Modify: `scripts/doctor.mjs`
- Modify: `.env.example`
- Modify: `.superpowers/sdd/progress.md`
- Test: `src/__tests__/lib/canvas-kernel-mode.test.ts`
- Test: `src/__tests__/lib/user-manager-sync-epoch.test.ts`

**Interfaces:**
- Produces: `type CanvasKernelMode = 'legacy' | 'shadow' | 'canvas-v2'`。
- Produces: `resolveCanvasKernelMode(raw?: string): CanvasKernelMode`。
- Produces: `getCanvasKernelReadStrategy(mode)` 和 `getCanvasKernelWriteStrategy(mode)`；`shadow` 的写策略必须为 `legacy-authoritative`。
- Produces: `UserManagerCore.getCanvasKernelMode()`，值来自已鉴权 `/api/user-data/sync` 响应，不读取浏览器可篡改的 localStorage。

- [ ] **Step 1: 写三态和同步信封 RED**

```ts
expect(resolveCanvasKernelMode(undefined)).toBe('legacy');
expect(resolveCanvasKernelMode('shadow')).toBe('shadow');
expect(resolveCanvasKernelMode('canvas-v2')).toBe('canvas-v2');
expect(resolveCanvasKernelMode('invalid')).toBe('legacy');
expect(getCanvasKernelWriteStrategy('shadow')).toBe('legacy-authoritative');
```

同步测试断言 GET 信封包含服务端解析后的 `canvasKernelMode`，缓存信封升级后仍保留该值，普通用户不能通过 POST 修改它。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-kernel-mode.test.ts src/__tests__/lib/user-manager-sync-epoch.test.ts`
Expected: FAIL，模块和信封字段尚不存在。

- [ ] **Step 3: 实现最小三态契约**

```ts
export type CanvasKernelMode = 'legacy' | 'shadow' | 'canvas-v2';

export function resolveCanvasKernelMode(raw?: string): CanvasKernelMode {
  return raw === 'shadow' || raw === 'canvas-v2' ? raw : 'legacy';
}

export function getCanvasKernelWriteStrategy(mode: CanvasKernelMode) {
  return mode === 'canvas-v2' ? 'kernel-authoritative' : 'legacy-authoritative';
}
```

将服务端环境解析结果加入同步信封；`doctor` 输出模式、默认值和非法值警告，不输出其他环境变量值。

- [ ] **Step 4: 建立阶段账本**

`.superpowers/sdd/progress.md` 记录基线 `18346aa`、分支、Task 状态、RED/GREEN 命令、评审、Commit、云端 SHA、性能数据和未验证项。保留 Stage 2 完成记录，不覆盖历史。

- [ ] **Step 5: 运行 GREEN 和基线门禁**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-kernel-mode.test.ts src/__tests__/lib/user-manager-sync-epoch.test.ts && pnpm doctor && pnpm check:protected-baseline`
Expected: 新测试通过；doctor 明确 `legacy`；38/38 受保护功能通过。

- [ ] **Step 6: 提交**

Commit: `feat: add stage three canvas kernel mode`

### Task 1: 建立真实画布性能与功能证据基线

**Files:**
- Create: `scripts/stage-3-e2e-fixtures.mjs`
- Create: `src/__tests__/scripts/stage-3-e2e-fixtures.test.ts`
- Create: `tests/helpers/canvas-performance.ts`
- Create: `tests/helpers/stage-3-e2e.ts`
- Create: `tests/e2e/stage-3-canvas-kernel.spec.ts`
- Create: `tests/reports/stage-3-canvas-baseline.md`
- Modify: `package.json`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces: `buildStage3FixturePlan(runId)`，为每个浏览器生成隔离的 1/100/300 节点项目。
- Produces: `measureCanvasInteraction(page, action): Promise<CanvasPerformanceSample>`。
- Produces: `assertCanvasNodeContinuity(page, ids)`，检测任意帧 DOM/图片可见性和命中能力。
- Produces: `pnpm seed:e2e:stage-3`、`pnpm test:e2e:stage-3`。

- [ ] **Step 1: 写夹具隔离 RED**

```ts
const plan = buildStage3FixturePlan('run-20260813');
expect(plan.projects).toHaveLength(15);
expect(new Set(plan.projects.map(item => item.id)).size).toBe(15);
expect(plan.projects.filter(item => item.nodeCount === 300)).toHaveLength(5);
expect(() => assertStage3OutputOutsideRepository(process.cwd())).toThrow();
```

夹具只能在存在 `wujie_stage3_e2e_guard` 且 guard token 精确匹配的数据库运行；清理必须按 owner、runId、projectId 三重限定。

- [ ] **Step 2: 写浏览器性能 RED**

真实页面测试必须记录：

```ts
expect(sample.averageFps).toBeGreaterThanOrEqual(nodeCount === 100 ? 55 : 45);
expect(sample.inputDelayP95Ms).toBeLessThanOrEqual(50);
expect(sample.disappearedFrames).toBe(0);
expect(sample.unclickableDurationMs).toBe(0);
expect(sample.longestSaveTaskMs).toBeLessThanOrEqual(100);
```

同时断言拖动坐标变化、缩放锚点不漂移、重置视图包含全部节点、删除/撤销/重做结果正确、刷新后坐标和层级一致。

- [ ] **Step 3: 运行 RED 并保存基线**

Run: `pnpm exec vitest run src/__tests__/scripts/stage-3-e2e-fixtures.test.ts`
Expected: FAIL，夹具模块尚不存在。

Run: `pnpm test:e2e:stage-3 --project=chromium`
Expected: 真实浏览器基线可执行；未满足的性能或行为断言必须失败并写入 `test-results/stage-3-baseline/`，不得放宽阈值。

- [ ] **Step 4: 实现夹具与证据采集**

使用同一张 64x64 PNG 的受控服务端 URL 构造规则网格，避免网络差异污染渲染测量。`canvas-performance.ts` 使用 `requestAnimationFrame` 时间戳、Event Timing/Long Task（浏览器支持时）和逐帧 `elementFromPoint` 采样；不使用固定长 sleep。

- [ ] **Step 5: 记录当前真实基线**

`tests/reports/stage-3-canvas-baseline.md` 写入 Commit、浏览器、视口、机器、节点数、FPS、P95、最长任务、消失帧、保存阻塞及失败证据路径。当前 `perf:check` 的字符串微基准仅列为辅助，不计入验收。

- [ ] **Step 6: 提交**

Commit: `test: establish stage three canvas performance baseline`

### Task 2: 抽取视口控制器并保持平移缩放连续

**Files:**
- Create: `src/lib/canvas-kernel/types.ts`
- Create: `src/lib/canvas-kernel/viewport.ts`
- Create: `src/components/canvas/use-canvas-viewport.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/canvas-pan-virtualization.ts`
- Modify: `src/lib/canvas-view-state.ts`
- Test: `src/__tests__/lib/canvas-kernel-viewport.test.ts`
- Test: `src/__tests__/components/canvas-viewport-wiring.test.ts`

**Interfaces:**
- Produces: `CanvasViewportState { committed, preview, zoom, interaction }`。
- Produces: `beginPan`、`previewPan`、`commitPan`、`zoomAtPoint`、`fitContent`、`screenToCanvas`、`canvasToScreen`。
- Produces: `useCanvasViewport()`，只在 rAF 或手势提交点更新 React 状态。

- [ ] **Step 1: 写坐标和状态机 RED**

```ts
const started = beginPan(initial, { pointerId: 7, clientX: 100, clientY: 80 });
const preview = previewPan(started, { pointerId: 7, clientX: 460, clientY: 300 });
expect(preview.preview).toEqual({ x: 360, y: 220 });
expect(commitPan(preview).committed).toEqual(preview.preview);
const before = screenToCanvas(initial, { x: 400, y: 300 });
const zoomed = zoomAtPoint(initial, { x: 400, y: 300 }, 1.5);
expect(screenToCanvas(zoomed, { x: 400, y: 300 })).toEqual(before);
```

覆盖 pointerId 不匹配、pointercancel、0.1/5 缩放边界、负坐标、大范围平移走廊和窗口尺寸变化。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-kernel-viewport.test.ts src/__tests__/components/canvas-viewport-wiring.test.ts`
Expected: FAIL，新模块和接线尚不存在。

- [ ] **Step 3: 实现纯视口控制器**

```ts
export function zoomAtPoint(
  state: CanvasViewportState,
  anchor: CanvasPoint,
  nextZoom: number,
): CanvasViewportState {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / state.zoom;
  return {
    ...state,
    zoom,
    committed: {
      x: anchor.x - (anchor.x - state.committed.x) * ratio,
      y: anchor.y - (anchor.y - state.committed.y) * ratio,
    },
  };
}
```

将现有 RAF transform、80ms 裁剪同步和 corridor overscan 移入 hook，保留 DOM 结构和工具栏按钮处理函数签名。

- [ ] **Step 4: 先以 shadow 接线**

`legacy` 继续执行旧处理；`shadow` 对每次 pan/zoom/reset 计算新状态并通过 `recordCanvasKernelDiff('viewport', code)` 比对，不改变 DOM；无差异后 `canvas-v2` 使用 hook 输出。

- [ ] **Step 5: 聚焦 GREEN 与浏览器回归**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-kernel-viewport.test.ts src/__tests__/lib/canvas-pan-virtualization.test.ts src/__tests__/lib/canvas-view-state.test.ts src/__tests__/components/canvas-viewport-wiring.test.ts`
Expected: 全部通过。

Run: `pnpm test:e2e:stage-3 --project=chromium --grep "viewport|pan|zoom|reset"`
Expected: 坐标正确，消失帧 0，工具仍可点击。

- [ ] **Step 6: 提交**

Commit: `refactor: isolate canvas viewport controller`

### Task 3: 建立稳定渲染投影和分级图片加载

**Files:**
- Create: `src/lib/canvas-kernel/render-policy.ts`
- Create: `src/components/canvas/CanvasMediaNode.tsx`
- Create: `src/components/canvas/CanvasSurface.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/canvas-spatial-index.ts`
- Test: `src/__tests__/lib/canvas-render-policy.test.ts`
- Test: `src/__tests__/lib/canvas-spatial-index.test.ts`
- Test: `src/__tests__/components/canvas-media-node.test.tsx`

**Interfaces:**
- Produces: `buildCanvasRenderProjection(images, viewport, keepAliveIds): CanvasRenderItem[]`。
- Produces: `CanvasRenderPriority = 'critical' | 'visible' | 'overscan' | 'deferred'`。
- Produces: 增量 `CanvasSpatialIndex.applyChanges(changes)`，拖动单节点不全量 rebuild。

- [ ] **Step 1: 写渲染不变量 RED**

```ts
expect(projectedIds).toContain(selectedOffscreenId);
expect(projectedIds).toContain(activeTaskOffscreenId);
expect(projectedIds).toContain(draggedId);
expect(projection.filter(item => item.priority === 'visible')).toHaveLength(visibleCount);
expect(index.rebuildCount).toBe(1);
expect(index.incrementalUpdateCount).toBe(100);
```

覆盖选中、拖动、调整尺寸、处理中、批注源、工具会话源和刚进入/离开 overscan 的节点保活。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-render-policy.test.ts src/__tests__/lib/canvas-spatial-index.test.ts src/__tests__/components/canvas-media-node.test.tsx`
Expected: FAIL，投影和媒体节点尚不存在。

- [ ] **Step 3: 实现渲染投影和图片状态**

```ts
export type CanvasMediaLoadState =
  | { kind: 'placeholder' }
  | { kind: 'loading' }
  | { kind: 'ready'; naturalWidth: number; naturalHeight: number }
  | { kind: 'broken'; reason: 'missing' | 'decode-failed' | 'unrecoverable' };
```

`CanvasMediaNode` 使用稳定宽高/纵横比、`decoding="async"`、按优先级设置 eager/lazy 和 fetchPriority；ready 图像在新源解码完成前保留上一可用像素，失败显示现有坏媒体状态，不呈现伪成功空白框。

- [ ] **Step 4: 保持交互节点挂载并增量更新索引**

渲染集合为视口查询结果与 `keepAliveIds` 并集。移动/调整尺寸只调用 `updateItem`；添加/删除使用批量增量；项目整体水合才允许 `rebuild`。

- [ ] **Step 5: GREEN 与压力回归**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-render-policy.test.ts src/__tests__/lib/canvas-spatial-index.test.ts src/__tests__/components/canvas-media-node.test.tsx src/__tests__/components/canvas-broken-media-state.test.ts src/__tests__/lib/canvas-pan-virtualization.test.ts`
Expected: 全部通过。

Run: `pnpm test:e2e:stage-3 --project=chromium --grep "100 nodes|300 nodes|continuity"`
Expected: 无消失帧、无不可点击时段，达到对应 FPS。

- [ ] **Step 6: 提交**

Commit: `perf: stabilize canvas render projection`

### Task 4: 抽取选择与手势控制器

**Files:**
- Create: `src/lib/canvas-kernel/selection.ts`
- Create: `src/components/canvas/use-canvas-selection.ts`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-selection.test.ts`
- Test: `src/__tests__/components/canvas-selection-wiring.test.ts`
- Test: `tests/e2e/stage-3-canvas-kernel.spec.ts`

**Interfaces:**
- Produces: `CanvasSelectionState { ids: string[]; primaryId: string | null; gesture }`。
- Produces: `selectHit`、`toggleHit`、`beginBoxSelection`、`updateBoxSelection`、`commitBoxSelection`、`clearSelection`。
- Consumes: Task 3 的空间索引和渲染保活集合。

- [x] **Step 1: 写选择不变量 RED**

```ts
expect(selectHit(state, 'top', 'replace').ids).toEqual(['top']);
expect(selectHit(state, 'lower', 'toggle').ids).toEqual(['top', 'lower']);
expect(commitBoxSelection(boxState, hitIds).ids).toEqual(hitIdsInZOrder);
expect(clearSelection(state)).toEqual({ ids: [], primaryId: null, gesture: null });
```

覆盖重叠节点最上层优先、Ctrl/Meta 多选、空白点击、框选方向反转、拖动阈值、pointercancel、面板事件隔离和编辑模式优先级。

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-selection.test.ts src/__tests__/components/canvas-selection-wiring.test.ts`
Expected: FAIL，新控制器尚不存在。

- [x] **Step 3: 实现纯选择控制器与 React 适配器**

```ts
export function selectHit(
  state: CanvasSelectionState,
  hitId: string | null,
  mode: 'replace' | 'toggle' | 'append',
): CanvasSelectionState;
```

适配器只发布已提交选择；框选预览保存在控制器 ref/rAF 中。`data-modal`、`data-popup`、`data-floating-panel`、`data-toolbar` 和 dialog 继续阻断画布手势。

- [x] **Step 4: 迁移入口而不改变语义**

逐一接入鼠标、触控笔、触摸、右键、空格平移、中键平移、图片拖动、组拖动和批注优先级；每迁移一种手势先跑对应聚焦测试。

- [x] **Step 5: GREEN 与真实多选回归**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-selection.test.ts src/__tests__/components/canvas-selection-wiring.test.ts src/__tests__/components/canvas-group-gesture-contract.test.ts src/__tests__/components/canvas-image-drag-contract.test.ts`
Expected: 全部通过。

Run: `pnpm test:e2e:stage-3 --project=chromium --grep "select|drag|box|pointer cancel"`
Expected: 坐标和选择集合精确匹配，输入 P95 不高于 50ms。

- [x] **Step 6: 提交**

Commit: `refactor: isolate canvas selection gestures`

### Task 5: 建立画布命令和显式历史事务

**Files:**
- Create: `src/lib/canvas-kernel/commands.ts`
- Create: `src/lib/canvas-kernel/history.ts`
- Modify: `src/lib/canvas-incremental-history.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-commands.test.ts`
- Test: `src/__tests__/lib/canvas-history-controller.test.ts`
- Test: `src/__tests__/components/canvas-command-wiring.test.ts`

**Interfaces:**
- Produces: `executeCanvasCommand(snapshot, command): CanvasCommandResult`。
- Produces: `CanvasCommand` 联合类型：`add`、`move`、`resize`、`delete`、`duplicate`、`reorder`、`assign-group`、`task-result`。
- Produces: `CanvasHistoryController.begin(id)`、`record(result)`、`commit(id)`、`rollback(id)`、`undo()`、`redo()`。

- [x] **Step 1: 写命令和 50 步历史 RED**

```ts
const moved = executeCanvasCommand(snapshot, { type: 'move', ids: ['a'], delta: { x: 40, y: 30 } });
expect(moved.next.byId.a.x).toBe(snapshot.byId.a.x + 40);
expect(moved.inverse.type).toBe('move');

for (let index = 0; index < 50; index += 1) history.commitMove('a', { x: index, y: index });
expect(runUndo(history, 50).byId.a).toMatchObject(original);
expect(runRedo(history, 50).byId.a).toMatchObject({ x: 49, y: 49 });
```

覆盖单次拖动只产生一步、删除/恢复、复制、调整尺寸、组移动、项目切换清栈、服务器水合不入栈、失败 placement 副作用回滚。

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-commands.test.ts src/__tests__/lib/canvas-history-controller.test.ts src/__tests__/components/canvas-command-wiring.test.ts`
Expected: FAIL，新命令和控制器尚不存在。

- [x] **Step 3: 实现不可变命令结果**

```ts
export interface CanvasCommandResult {
  next: CanvasDocumentSnapshot;
  inverse: CanvasCommand;
  affectedIds: string[];
  history: 'record' | 'skip';
  persistence: 'schedule' | 'immediate' | 'skip';
}
```

命令层不 fetch、不 toast、不读 DOM。Stage 2 placement 删除/恢复由 `canvas-workspace` 协调器在命令提交前后执行，失败时应用 inverse，保证内存、项目快照和 placement 一致。

- [x] **Step 4: 用显式事务替换 500ms 猜测分组**

pointerdown `begin('drag:<pointerId>')`，pointermove 只预览，pointerup 只提交最终 diff，pointercancel rollback。离散按钮命令立即提交；任务进度和水合标记 `history: 'skip'`。

- [x] **Step 5: GREEN、Stage 2 生命周期与 E2E 回归**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-commands.test.ts src/__tests__/lib/canvas-history-controller.test.ts src/__tests__/components/canvas-command-wiring.test.ts src/__tests__/components/canvas-managed-delete-contract.test.ts src/__tests__/lib/canvas-incremental-history.test.ts`
Expected: 全部通过。

Run: `pnpm test:e2e:stage-3 --project=chromium --grep "undo|redo|delete|move|resize"`
Expected: 每个手势一步历史，刷新后最终状态一致。

- [x] **Step 6: 提交**

Commit: `refactor: route canvas edits through commands`

### Task 6: 收拢任务占位框和终态投影

**Files:**
- Create: `src/lib/canvas-kernel/task-projection.ts`
- Modify: `src/lib/canvas-task-placeholders.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Test: `src/__tests__/lib/canvas-task-projection.test.ts`
- Test: `src/__tests__/components/canvas-task-projection-wiring.test.ts`
- Test: `src/__tests__/api/task-result-asset-projection.test.ts`

**Interfaces:**
- Produces: `projectCanvasTaskEvent(snapshot, event): CanvasCommand[]`。
- Consumes: Stage 1 权威任务终态和 Stage 2 `taskId:outputIndex` 素材身份。
- Produces: 每槽独立 `submitting -> queued -> processing -> uploading -> completed|failed|cancelled|timeout` 画布投影。

- [ ] **Step 1: 写终态和迟到结果 RED**

```ts
expect(projectCanvasTaskEvent(snapshot, completedSlot)).toEqual([
  expect.objectContaining({ type: 'task-result', outputIndex: 1 }),
]);
expect(projectCanvasTaskEvent(cancelledSnapshot, lateCompleted)).toEqual([]);
expect(projectCanvasTaskEvent(completedSnapshot, duplicateCompleted)).toEqual([]);
```

覆盖 n=1/2/3/4、逐张回填、部分失败、取消、超时、刷新恢复、重复事件、乱序事件、旧请求迟到和 provider/model 身份保持。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-task-projection.test.ts src/__tests__/components/canvas-task-projection-wiring.test.ts`
Expected: FAIL，新投影模块尚不存在。

- [ ] **Step 3: 实现纯任务投影**

```ts
export interface CanvasTaskEvent {
  taskId: string;
  batchId?: string;
  slotId?: string;
  outputIndex: number;
  status: GenerationStatus;
  progress: number;
  result?: { url: string; assetVersionId?: string; placementId?: string };
}
```

投影只生成命令；完成结果通过 Task 5 命令更新现有占位框，不新增第二个 legacy 身份。终态不可回退，失败原因保留统一错误码和用户提示。

- [ ] **Step 4: 接入现有 SSE/轮询/恢复入口**

所有事件进入同一投影函数；SSE 与轮询同时到达时按任务/槽版本去重。保留旧恢复读取器，不改变供应商请求和账务结算。

- [ ] **Step 5: GREEN 与跨阶段保护**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-task-projection.test.ts src/__tests__/components/canvas-task-projection-wiring.test.ts src/__tests__/api/task-result-asset-projection.test.ts src/__tests__/components/canvas-progressive-generation-contract.test.ts src/__tests__/components/canvas-sync-completed-image-state.test.ts`
Expected: 全部通过。

- [ ] **Step 6: 提交**

Commit: `refactor: unify canvas task projection`

### Task 7: 将项目持久化移出交互热路径

**Files:**
- Create: `src/lib/canvas-kernel/persistence.ts`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/lib/canvas-autosave-guard.ts`
- Test: `src/__tests__/lib/canvas-persistence.test.ts`
- Test: `src/__tests__/components/project-autosave-wiring.test.ts`
- Test: `tests/e2e/stage-3-canvas-kernel.spec.ts`

**Interfaces:**
- Produces: `CanvasPersistenceScheduler.schedule(snapshot)`、`flush(reason)`、`cancel(projectId)`。
- Produces: 单飞、最新快照胜出、项目隔离、最大等待 1 秒和可观测保存阶段。
- Consumes: Task 5 命令结果的 `persistence` 提示。

- [ ] **Step 1: 写调度、竞态和预算 RED**

```ts
scheduler.schedule(snapshot1);
scheduler.schedule(snapshot2);
await scheduler.flush('idle');
expect(writer).toHaveBeenCalledTimes(1);
expect(writer).toHaveBeenCalledWith(expect.objectContaining({ revision: snapshot2.revision }));
expect(metrics.longestMainThreadTaskMs).toBeLessThanOrEqual(100);
```

覆盖项目切换、服务器合并、data/blob 持久化、beforeunload、失败重试、旧保存迟到和相同签名不重复写。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-persistence.test.ts src/__tests__/components/project-autosave-wiring.test.ts`
Expected: FAIL，调度器尚不存在。

- [ ] **Step 3: 实现快照调度器**

```ts
export interface CanvasPersistenceSnapshot {
  projectId: string;
  revision: number;
  images: PersistableCanvasImage[];
  metadata: ProjectMetadata;
}
```

交互提交只构造结构共享快照并 schedule；序列化在 `requestIdleCallback` 执行，缺失时使用短任务切片的 `setTimeout(0)` 降级。data/blob 上传保持异步，URL 解析后以更高 revision 重排一次保存。

- [ ] **Step 4: 收紧刷新前保存**

`beforeunload` 不做全量图片重编码或同步网络；仅对已准备的最后快照调用 local cache 与 `sendBeacon`。若存在未持久化媒体，记录恢复标记而不是阻塞页面关闭。

- [ ] **Step 5: GREEN 与 300 节点保存测量**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-persistence.test.ts src/__tests__/components/project-autosave-wiring.test.ts src/__tests__/lib/canvas-autosave-guard.test.ts src/__tests__/components/canvas-project-reopen-contract.test.ts`
Expected: 全部通过。

Run: `pnpm test:e2e:stage-3 --project=chromium --grep "save|refresh|300 nodes"`
Expected: 保存最长主线程任务不超过 100ms；刷新恢复坐标、尺寸、层级和任务状态。

- [ ] **Step 6: 提交**

Commit: `perf: move canvas persistence off hot path`

### Task 8: 建立工具注册表和互斥工具会话

**Files:**
- Create: `src/lib/canvas-kernel/tool-registry.ts`
- Create: `src/components/canvas/CanvasToolHost.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/canvas-toolbar-layout.ts`
- Modify: `docs/testing/baselines/protected-features.json`
- Test: `src/__tests__/lib/canvas-tool-registry.test.ts`
- Test: `src/__tests__/components/canvas-tool-host.test.tsx`
- Test: `src/__tests__/components/canvas-toolbar-floating-windows.test.ts`

**Interfaces:**
- Produces: `CanvasToolDefinition { featureId, id, entryPoints, requiresSelection, sessionKind, open, close }`。
- Produces: `CanvasToolSession { toolId, sourceImageIds, status, panelPlacement }`。
- Consumes: 既有组件和既有按钮；不得新增替代空壳。

- [ ] **Step 1: 写入口完整性和互斥 RED**

```ts
expect(registry.featureIds()).toEqual(expect.arrayContaining(protectedCanvasToolFeatureIds));
expect(registry.duplicates()).toEqual([]);
expect(openTool(session, 'erase').toolId).toBe('erase');
expect(openTool(openTool(session, 'erase'), 'mask').toolId).toBe('mask');
expect(closeTool(active).sourceImageIds).toEqual([]);
```

覆盖底部工具栏、图片浮动工具栏、右键菜单和快捷键入口；验证选中图锁定、ESC、外部点击、项目切换、图片删除和面板重开。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-tool-registry.test.ts src/__tests__/components/canvas-tool-host.test.tsx`
Expected: FAIL，注册表和宿主尚不存在。

- [ ] **Step 3: 实现注册表并适配现有组件**

```ts
export const canvasToolRegistry: readonly CanvasToolDefinition[] = [
  { featureId: 'workspace.canvas.image-tools', id: 'upscale', entryPoints: ['image-toolbar', 'context-menu'], requiresSelection: true, sessionKind: 'image-edit' },
  { featureId: 'workspace.canvas.annotation', id: 'chatcanvas', entryPoints: ['bottom-toolbar', 'shortcut'], requiresSelection: false, sessionKind: 'annotation' },
];
```

注册表必须显式覆盖以下受保护分组与动作，不能通过动态扫描猜测：

- `workspace.canvas.core`：选择、多选、移动、缩放、平移、删除、复制、撤销、重做、重置视图。
- `workspace.canvas.upload`：点击上传、拖入上传、粘贴图片、持久化媒体。
- `workspace.canvas.generate`：图像生成面板、快速创作、底部图像生成器。
- `workspace.canvas.reference-groups`：图片组、参考图组、融图组。
- `workspace.canvas.image-tools`：放大、移除背景、SVG 智能描摹、元素拆解、擦除、蒙版、调色、编辑元素、多角度、扩展、裁切、下载。
- `workspace.canvas.annotation`：点选、框选、画笔圈选、修改输入、提交、进度。
- `workspace.canvas.layers-history-export`：图层、版本历史、PNG/SVG/PSD/项目导出。
- `workspace.canvas.video`：视频生成、延长、抽帧、配音、压缩、下载。
- `workspace.canvas.three-d`：单图/多图/文生 3D、多角度、预览、下载。
- `workspace.canvas.specialized-tools`：品牌电商、品牌 IP、Logo Pro、包装 Pro、展陈 Pro、效果图反拆、字境大师、AI 矢量设计、AI PSD、表情助手、六面体。
- `workspace.canvas.refine`：产品精修、人物精修、人脸修复、手部修复、三维视角。

注册表只管理入口、选择要求、会话和面板宿主，业务面板仍调用原组件和原回调。

- [ ] **Step 4: 统一面板事件边界与定位**

`CanvasToolHost` 为所有工具面板提供 `data-floating-panel` 和稳定 portal 层；抽屉/浮窗沿用现有商业 UI，不将底部工具面板移回画布中央，不改变图标、名称、模型和提交行为。

- [ ] **Step 5: GREEN 与全入口冒烟**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-tool-registry.test.ts src/__tests__/components/canvas-tool-host.test.tsx src/__tests__/components/canvas-toolbar-floating-windows.test.ts src/__tests__/components/infinite-canvas-split-wiring.test.ts`
Expected: 全部通过，受保护工具 featureId 无缺失。

Run: `pnpm check:protected-baseline`
Expected: 38/38，无未批准源码漂移。

- [ ] **Step 6: 提交**

Commit: `refactor: centralize canvas tool sessions`

### Task 9: 收口画布组件边界并删除重复实现

**Files:**
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/components/canvas-workspace.tsx`
- Modify: `src/components/canvas/CanvasSurface.tsx`
- Modify: `src/components/canvas/CanvasToolHost.tsx`
- Modify: `src/__tests__/components/infinite-canvas-split-wiring.test.ts`
- Create: `src/__tests__/components/canvas-kernel-boundaries.test.ts`

**Interfaces:**
- `InfiniteCanvas` 保持当前公开 Props，作为兼容 facade。
- `CanvasWorkspace` 继续拥有用户、项目、远端副作用和 Asset Graph 协调。
- `CanvasSurface` 只接收可渲染投影、控制器状态和命令回调。
- `CanvasToolHost` 只接收工具会话和既有面板 props。

- [ ] **Step 1: 写边界 RED**

```ts
expect(boundaries.infiniteCanvas).not.toContain('new IncrementalHistoryManager');
expect(boundaries.infiniteCanvas).not.toContain("fetch('/api/poll-task'");
expect(boundaries.surface).not.toContain('/api/');
expect(boundaries.toolHost).not.toContain('UserManagerCore');
```

同时断言所有受保护工具组件仍由 facade/host 可达，不能以文件变小为理由删除入口。

- [ ] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/__tests__/components/canvas-kernel-boundaries.test.ts src/__tests__/components/infinite-canvas-split-wiring.test.ts`
Expected: FAIL，旧组件仍含重复职责。

- [ ] **Step 3: 逐段删除已迁移旧实现**

只删除已经在 Tasks 2-8 由新模块接管且 shadow 无差异的代码。每删除一段立即运行该职责聚焦测试；禁止顺手重写业务工具、样式或 API。

- [ ] **Step 4: 检查监听器、RAF、定时器和 Object URL 生命周期**

所有 controller/hook 在卸载、项目切换和模式切换时取消 pointer capture、RAF、idle callback、timer、SSE/轮询订阅和临时 Object URL；重复挂载不得增加全局监听器数量。

- [ ] **Step 5: GREEN 与静态边界门禁**

Run: `pnpm exec vitest run src/__tests__/components/canvas-kernel-boundaries.test.ts src/__tests__/components/infinite-canvas-split-wiring.test.ts src/__tests__/components/infinite-canvas-drag-throttle-wiring.test.ts`
Expected: 全部通过。

Run: `pnpm ts-check && pnpm lint:build && pnpm check:protected-baseline`
Expected: TypeScript、ESLint errors 0、38/38 受保护功能通过。

- [ ] **Step 6: 提交**

Commit: `refactor: complete canvas kernel boundaries`

### Task 10: 完成本地、三浏览器、云端和回退门禁

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/testing/STAGE_3_CANVAS_PERFORMANCE_REPORT.md`
- Modify: `.github/workflows/quality.yml`

**Interfaces:**
- Produces: 可复查的 Stage 3 本地/云端证据、精确 Commit、三态切换结果和回退点。
- Produces: CI 画布聚焦测试、受保护功能门禁和 Chromium 性能门禁；Firefox/WebKit 行为门禁不使用 Chromium FPS 数字替代。

- [ ] **Step 1: 执行完整本地门禁**

```bash
pnpm doctor
pnpm ts-check
pnpm lint
pnpm test
pnpm test:api
pnpm test:regression
pnpm build
pnpm check:protected-baseline
```

Expected: 0 failed；历史 warnings 精确记录，不新增 warning；环境缺失导致的 skip 逐项列入 `UNVERIFIED_ITEMS.md`。

- [ ] **Step 2: 执行五规格真实浏览器矩阵**

Run: `pnpm test:e2e:stage-3`
Expected: Chromium、1920x1080 Chromium、Firefox、WebKit、移动 Chromium 的功能回归通过；桌面 Chromium 达到 100/300 节点性能阈值；截图、视频、trace、console、network 和 JSON 性能样本保存到 `test-results/stage-3/`。

- [ ] **Step 3: 执行登录和全站保护回归**

Run: `pnpm test:e2e:p0`
Expected: 入口、登录、刷新保持、上传、画布、生成、保存恢复、下载、退出均通过；Console Error 和未处理 Promise 为 0。

- [ ] **Step 4: 独立代码审查**

审查范围为 Stage 3 基线到候选 HEAD。Critical/Important 必须全部关闭并加永久回归；Minor 若保留必须登记，不得静默忽略。

- [ ] **Step 5: main-only 推送与 Coze shadow 验证**

推送前重新 fetch 并使用 lease 保护，只快进 GitHub `main`；精确确认 `stable@52f7c60` 未变。Coze 部署标签页拉取精确候选 SHA，先设置 `WUJIE_CANVAS_KERNEL_MODE=shadow`，保持 Asset/Task 为 `legacy`，在 Chrome 已登录账号完成 1/100/300 节点、工具入口、任务回填、保存刷新和登录保护验证。

- [ ] **Step 6: 受控 canvas-v2 与 legacy 回滚**

shadow 差异为 0 后，隔离预览切换 `canvas-v2` 重跑同一矩阵；随后强制回滚 `legacy`，验证登录、旧项目、图片、三个工作区、工具栏、任务、积分和保存均无变化。生产稳定域不在本阶段直接切换。

- [ ] **Step 7: 更新报告和 Obsidian**

报告必须给出节点数、测试数、浏览器、FPS、P95、长任务、消失帧、不可点击时长、保存阻塞、缺陷等级、修复数、未验证数、运行 Commit、回退 Commit 和最终结论。同步 `无界计划` 的看板、决策日志和防偏移记录。

- [ ] **Step 8: 阶段完成判定**

只有 P0/P1 为 0、受保护入口 100%、功能/性能/登录/旧项目/云端/回退全部通过时标记 Stage 3 “已完成”。任何云端或性能证据缺失时只能标记“有条件完成”或“未完成”，不得进入 Stage 4。

Commit: `docs: close stage three canvas kernel rollout`

## 计划自检

- 规格覆盖：视口、选择、命令、历史、任务投影、持久化、工具注册、分级图片加载、平移消失、拖动、缩放、撤销、重置视图、保存阻塞和工具定位均有独立 Task。
- 范围检查：不包含节点模式、Agent 运行时或业务工具质量改造；Stage 2 数据模型和任务核心只作为既有依赖。
- 功能保护：38 项 featureId、七产品表面、三工作区和全部工具入口在 Task 8/9/10 设硬门禁。
- 性能真实性：以真实 DOM、真实浏览器和受控项目为准，不以字符串微基准、HTTP 200 或构建通过代替。
- 回退完整性：每项先 shadow；最终云端验证 `shadow -> canvas-v2 -> legacy`，stable 始终只读。
- 无占位符：计划无 TBD/TODO；阈值、模式、文件、接口、命令和预期结果均已明确。

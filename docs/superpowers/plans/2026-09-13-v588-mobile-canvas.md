# V5.8.8 移动端画布选择性吸收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变桌面工作区和现有业务入口的前提下，为无限画布补齐可靠触摸交互、移动端工具抽屉和复用权威任务/资产链路的 `/simple-create`。

**Architecture:** 触摸手势由独立、无 React 状态的 Pointer Events 控制器解释，再调用现有 `useCanvasViewport` 命令；移动工具栏只投影现有 action 列表，不复制业务处理器。快速生图页复用 `/api/generate`、任务事件/轮询、项目和 AssetVersion 投影，以共享客户端控制器表达槽位状态，不建立第二套任务或存储模型。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、Pointer Events、Tailwind CSS 4、Vitest 3、Testing Library、Playwright 1.60。

## Global Constraints

- 只修改当前 `main`；不得修改、合并或强推 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 当前实现基线为 `main@edcb2d2d2216928bb2c9b2923b0600aade0994f5`；V5.8.8 供体只读，不整文件覆盖 `infinite-canvas.tsx`。
- 不暂存、修改或还原 `.superpowers/sdd/progress.md`、`task-1-brief.md`、`task-1-review.md`、`task-2-brief.md`、`task-2-review.md`、`task-3-brief.md`。
- 桌面鼠标选择、框选、图片拖动、空格平移、中键平移、滚轮缩放、批注、图片组和撤销重做保持原行为。
- 移动端和 `/simple-create` 不建立第二套任务、积分、项目、媒体或供应商状态机。
- 生成结果必须由现有任务投影建立 AssetVersion 和 Canvas placement；禁止覆盖旧 `projects` JSON 或只存 localStorage。
- 现有底部工具和图片工具全部可达；移动布局不得以隐藏方式删除能力。
- `touch-action: none` 只用于画布交互表面；抽屉、表单和页面保持正常滚动。
- 每项生产修改先有预期 RED，再以最小实现转为 GREEN；不得用固定长 `sleep` 掩盖状态问题。
- 完成每个阶段后更新仓库测试报告与 Obsidian 无界计划目录，并仅推送 `main`。

---

### Task 1: 触摸手势状态机

**Files:**
- Create: `src/lib/canvas-touch-gestures.ts`
- Create: `src/__tests__/lib/canvas-touch-gestures.test.ts`

**Interfaces:**
- Consumes: `CanvasPoint` from `src/lib/canvas-kernel/types.ts`。
- Produces: `createCanvasTouchGestureController(options): CanvasTouchGestureController`，其 `pointerDown/move/up/cancel/dispose` 返回 `CanvasTouchIntent[]`；意图种类为 `pan-start`、`pan-move`、`pan-end`、`pinch`、`long-press`、`cancel-default-interaction`。

- [ ] **Step 1: 写入阈值、长按、双指和旁路的失败测试**

```ts
const controller = createCanvasTouchGestureController({
  getZoom: () => 1,
  scheduleLongPress: callback => clock.setTimeout(callback, 500),
  cancelLongPress: id => clock.clearTimeout(id),
});
expect(controller.pointerDown(touch(1, 10, 10, 'blank'))).toEqual([]);
expect(controller.pointerMove(touch(1, 15, 10, 'blank'))).toEqual([]);
expect(controller.pointerMove(touch(1, 17, 10, 'blank'))).toContainEqual(expect.objectContaining({ type: 'pan-start' }));
expect(controller.pointerDown(mouse(2, 20, 20))).toEqual([]);
```

测试还必须断言：500ms/<10px 触发一次长按；第二指立即发出取消意图；pinch 返回中点、距离比和中点位移；两指变一指进入 `blocked-until-release`；`pointercancel` 和 `dispose` 清理定时器。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-touch-gestures.test.ts`

Expected: FAIL，提示无法解析 `@/lib/canvas-touch-gestures`。

- [ ] **Step 3: 实现最小确定性状态机**

```ts
export const TOUCH_PAN_THRESHOLD_PX = 6;
export const TOUCH_LONG_PRESS_MS = 500;
export const TOUCH_LONG_PRESS_SLOP_PX = 10;

export interface CanvasTouchSample {
  pointerId: number;
  pointerType: string;
  point: CanvasPoint;
  target: 'blank' | 'image';
}

export type CanvasTouchIntent =
  | { type: 'pan-start' | 'pan-move'; pointerId: number; point: CanvasPoint }
  | { type: 'pan-end'; pointerId: number }
  | { type: 'pinch'; midpoint: CanvasPoint; scale: number; midpointDelta: CanvasPoint }
  | { type: 'long-press'; pointerId: number; point: CanvasPoint; target: CanvasTouchSample['target'] }
  | { type: 'cancel-default-interaction' };
```

控制器内部只保留 active pointer map、gesture mode、初始距离/中点和一个长按计时器；所有坐标计算使用欧氏距离，不读取 DOM。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-touch-gestures.test.ts`

Expected: PASS，覆盖单指、长按、双指、取消、销毁和非 touch 旁路。

- [ ] **Step 5: 提交独立手势内核**

```bash
git add src/lib/canvas-touch-gestures.ts src/__tests__/lib/canvas-touch-gestures.test.ts
git commit -m "feat: add deterministic canvas touch gestures"
```

### Task 2: 将触摸意图接入现有画布内核

**Files:**
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/components/canvas/use-canvas-viewport.ts`
- Modify: `src/__tests__/components/canvas-selection-wiring.test.ts`
- Create: `src/__tests__/components/canvas-touch-wiring.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CanvasTouchIntent` 和现有 `beginPan/previewPan/commitPan/cancelPan/zoomAtPoint`。
- Produces: `applyCanvasTouchIntent(intent, dependencies): void`；只负责命令接线，可注入测试替身。

- [ ] **Step 1: 写入接线失败测试**

```ts
applyCanvasTouchIntent({ type: 'cancel-default-interaction' }, deps);
expect(deps.cancelSelectionGesture).toHaveBeenCalledOnce();
expect(deps.cancelImageDrag).toHaveBeenCalledOnce();

applyCanvasTouchIntent({
  type: 'pinch', midpoint: { x: 160, y: 240 }, scale: 1.2,
  midpointDelta: { x: 4, y: -3 },
}, deps);
expect(deps.zoomAtPoint).toHaveBeenCalledWith({ x: 160, y: 240 }, 1.2);
expect(deps.translateViewport).toHaveBeenCalledWith({ x: 4, y: -3 });
```

同时保留已有 touch 选择断言，证明图片点击和图片拖动仍走原路径，鼠标框选不调用触摸控制器。

- [ ] **Step 2: 运行接线测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/canvas-touch-wiring.test.ts src/__tests__/components/canvas-selection-wiring.test.ts`

Expected: 新测试因 `applyCanvasTouchIntent` 缺失而 FAIL；旧选择测试继续 PASS。

- [ ] **Step 3: 增加视口平移增量命令并完成 Pointer Events 接线**

```ts
export interface CanvasViewportController {
  // existing members remain unchanged
  translateBy(delta: CanvasPoint): void;
}

const translateBy = useCallback((delta: CanvasPoint) => {
  setViewOffset(current => ({ x: current.x + delta.x, y: current.y + delta.y }));
}, [setViewOffset]);
```

在画布交互层创建一次控制器；touch pointer 使用 `setPointerCapture`，意图调用现有选择/拖动取消和视口命令；`pointercancel`、`blur`、unmount 调用清理。不得修改 mouse/pen 条件分支。

- [ ] **Step 4: 运行触摸与桌面回归**

Run: `pnpm exec vitest run src/__tests__/lib/canvas-touch-gestures.test.ts src/__tests__/components/canvas-touch-wiring.test.ts src/__tests__/components/canvas-selection-wiring.test.ts src/__tests__/components/canvas-group-gesture-contract.test.ts src/__tests__/components/canvas-image-drag-contract.test.ts`

Expected: 全部 PASS，且旧测试断言未删除或放宽。

- [ ] **Step 5: 提交画布接线**

```bash
git add src/components/infinite-canvas.tsx src/components/canvas/use-canvas-viewport.ts src/__tests__/components/canvas-touch-wiring.test.ts src/__tests__/components/canvas-selection-wiring.test.ts
git commit -m "feat: connect touch gestures to canvas viewport"
```

### Task 3: 移动端底部工具栏投影

**Files:**
- Create: `src/components/canvas/mobile-bottom-toolbar.tsx`
- Create: `src/lib/mobile-canvas-toolbar.ts`
- Create: `src/__tests__/lib/mobile-canvas-toolbar.test.ts`
- Create: `src/__tests__/components/mobile-bottom-toolbar.test.tsx`
- Modify: `src/components/infinite-canvas.tsx`

**Interfaces:**
- Consumes: 当前底部工具目录的 `{ id, label, group, icon, onActivate, hidden }[]`。
- Produces: `buildMobileCanvasToolbar(actions)` 和 `MobileBottomToolbar`；固定槽位 id 为 `select`、`pan`、`upload`、`zoom-status`、`all-tools`。

- [ ] **Step 1: 写入功能可达性和事件隔离失败测试**

```ts
const projection = buildMobileCanvasToolbar(existingActions);
expect(projection.primary.map(item => item.id)).toEqual([
  'select', 'pan', 'upload', 'zoom-status', 'all-tools',
]);
expect(new Set(projection.drawer.map(item => item.id))).toEqual(
  new Set(existingActions.filter(item => !item.hidden).map(item => item.id)),
);
```

组件测试点击抽屉 action 后必须调用原 `onActivate` 一次；`pointerdown` 不冒泡到画布；按钮触控目标最小 40×40 CSS px。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/mobile-canvas-toolbar.test.ts src/__tests__/components/mobile-bottom-toolbar.test.tsx`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现投影和移动栏**

```ts
export function buildMobileCanvasToolbar(actions: CanvasToolbarAction[]) {
  const reachable = actions.filter(action => !action.hidden);
  return {
    primary: MOBILE_PRIMARY_SLOTS,
    drawer: reachable,
  };
}
```

在 `<768px` 渲染五槽移动栏；桌面继续渲染当前 toolbar。抽屉使用当前分组、排序、图标和 handler，`max-height: calc(100dvh - 48px - env(safe-area-inset-bottom))`，内部纵向滚动并隐藏视觉滚动条。

- [ ] **Step 4: 运行测试和现有工具栏合同**

Run: `pnpm exec vitest run src/__tests__/lib/mobile-canvas-toolbar.test.ts src/__tests__/components/mobile-bottom-toolbar.test.tsx src/__tests__/lib/canvas-toolbar-layout.test.ts`

Expected: 全部 PASS。

- [ ] **Step 5: 提交移动底栏**

```bash
git add src/components/canvas/mobile-bottom-toolbar.tsx src/lib/mobile-canvas-toolbar.ts src/components/infinite-canvas.tsx src/__tests__/lib/mobile-canvas-toolbar.test.ts src/__tests__/components/mobile-bottom-toolbar.test.tsx
git commit -m "feat: add reachable mobile canvas toolbar"
```

### Task 4: 移动端图片动作条与完整工具抽屉

**Files:**
- Create: `src/components/canvas/mobile-image-actions.tsx`
- Create: `src/__tests__/components/mobile-image-actions.test.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/__tests__/lib/image-toolbar-position.test.ts`

**Interfaces:**
- Consumes: 当前 `visibleToolbarActions` 原数组；固定动作通过 id 查找 `preview`、`download`、`delete`，其余动作进入 `more` 抽屉。
- Produces: `MobileImageActions`，不拥有任何业务 handler 或第二份 action 注册表。

- [ ] **Step 1: 写入完整性、裁切和误触失败测试**

```tsx
render(<MobileImageActions actions={visibleActions} viewportWidth={320} />);
expect(screen.getByRole('button', { name: '预览' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '更多' }));
for (const action of visibleActions) {
  expect(screen.getByRole('button', { name: action.label })).toBeVisible();
}
expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
```

测试还要断言 drawer pointer/wheel 事件不冒泡、关闭后焦点返回“更多”、执行 action 后仍传入当前选中图片 id。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/mobile-image-actions.test.tsx src/__tests__/lib/image-toolbar-position.test.ts`

Expected: 新组件测试 FAIL；既有定位测试 PASS。

- [ ] **Step 3: 实现动作条并复用现有 action**

```tsx
const fixedIds = new Set(['preview', 'download', 'delete']);
const fixed = actions.filter(action => fixedIds.has(action.id));
return <MobileActionBar fixed={fixed} drawerActions={actions} onAction={action => action.onActivate()} />;
```

移动动作条固定在底栏上方并应用安全区；打开具体工具继续调用 `activateCanvasToolSession`。`>=768px` 保留桌面图片工具条和现有定位算法。

- [ ] **Step 4: 运行图片工具回归**

Run: `pnpm exec vitest run src/__tests__/components/mobile-image-actions.test.tsx src/__tests__/lib/image-toolbar-position.test.ts src/__tests__/components/canvas-image-drag-contract.test.ts`

Expected: 全部 PASS，所有当前可见 action id 数量相等。

- [ ] **Step 5: 提交图片工具抽屉**

```bash
git add src/components/canvas/mobile-image-actions.tsx src/components/infinite-canvas.tsx src/__tests__/components/mobile-image-actions.test.tsx src/__tests__/lib/image-toolbar-position.test.ts
git commit -m "feat: add mobile image action drawer"
```

### Task 5: 抽取共享图像生成会话控制器

**Files:**
- Create: `src/lib/image-generation-session.ts`
- Create: `src/__tests__/lib/image-generation-session.test.ts`
- Modify: `src/components/canvas-workspace.tsx`

**Interfaces:**
- Consumes: `/api/generate` 的 `submitOnly` 合同、`taskEventsClient`、`/api/poll-task`、`extractTaskAssetReferences(payload)`。
- Produces: `createImageGenerationSession(dependencies)`；方法为 `submit(request)`、`restore(projectId)`、`cancel(slotId)`、`retry(slotId)`、`dispose()`，并通过 `subscribe(listener)` 发布 `ImageGenerationSlot[]`。

- [ ] **Step 1: 写入多槽、逐张、迟到隔离和恢复失败测试**

```ts
const session = createImageGenerationSession(fakeDependencies);
await session.submit({ projectId: 'p1', outputCount: 2, prompt: '海报', providerId: 'pear', model: 'gpt-image-2' });
expect(session.snapshot().map(slot => slot.status)).toEqual(['processing', 'processing']);
fakeDependencies.emit(completed('task-2', managedReference('v2', 'pl2')));
expect(session.snapshot()[1].assetVersionId).toBe('v2');
expect(session.snapshot()[0].status).toBe('processing');
```

继续断言：相同 task event 只落一次；cancelled 后的 completed 不写 AssetVersion；失败保留 code/retryable/taskId；restore 只读取相同 projectId 的权威任务。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/image-generation-session.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现共享会话并让画布生成路径调用它**

```ts
export interface ImageGenerationSlot {
  id: string;
  projectId: string;
  taskId?: string;
  status: 'submitting' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  progress: number;
  assetVersionId?: string;
  placementId?: string;
  url?: string;
  error?: { code?: string; message: string; retryable: boolean };
}
```

控制器将每个服务器 taskId 绑定固定 slotId，SSE 优先、轮询兜底；终态单向迁移，取消后拒绝迟到完成。`canvas-workspace.tsx` 保留现有占位框 UI，只将提交、终态和受管引用解析委托给该控制器。

- [ ] **Step 4: 运行生成与任务投影回归**

Run: `pnpm exec vitest run src/__tests__/lib/image-generation-session.test.ts src/__tests__/lib/canvas-task-placeholders.test.ts src/__tests__/lib/canvas-task-projection.test.ts src/__tests__/components/canvas-task-projection-wiring.test.ts src/__tests__/api/generate-output-count.test.ts`

Expected: 五个测试文件全部 PASS，且 `generate-output-count` 继续证明每个请求数量对应独立供应商任务。

- [ ] **Step 5: 提交共享生成会话**

```bash
git add src/lib/image-generation-session.ts src/components/canvas-workspace.tsx src/__tests__/lib/image-generation-session.test.ts
git commit -m "refactor: share authoritative image generation session"
```

### Task 6: 实现 `/simple-create` 快速生图页

**Files:**
- Create: `src/app/simple-create/page.tsx`
- Create: `src/components/simple-create/simple-create-page.tsx`
- Create: `src/components/simple-create/simple-create-form.tsx`
- Create: `src/components/simple-create/simple-create-results.tsx`
- Create: `src/lib/simple-create-navigation.ts`
- Create: `src/__tests__/components/simple-create-page.test.tsx`
- Create: `src/__tests__/lib/simple-create-navigation.test.ts`

**Interfaces:**
- Consumes: Task 5 `ImageGenerationSession`、`/api/session`、当前管理员授权模型目录、`GenerationParams` 能力约束、受管 `WorkspaceAssetReference`。
- Produces: `/simple-create?projectId=<id>` 页面；`buildSimpleCreateCanvasUrl(projectId, reference)` 返回同项目画布定位 URL。

- [ ] **Step 1: 写入登录、能力联动、数量和跳转失败测试**

```tsx
render(<SimpleCreatePage dependencies={deps} initialProjectId="p1" />);
expect(await screen.findByLabelText('模型')).toHaveTextContent('PearAPI');
await user.selectOptions(screen.getByLabelText('生成数量'), '4');
await user.click(screen.getByRole('button', { name: '开始生成' }));
expect(deps.session.submit).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', outputCount: 4 }));
```

测试必须覆盖未登录返回登录且保留 returnTo、模型变化后比例/尺寸/质量仅显示能力目录允许值、参考图上传、独立取消/重试、刷新 restore、下载、同 projectId 打开画布。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-create-page.test.tsx src/__tests__/lib/simple-create-navigation.test.ts`

Expected: FAIL，页面和导航 helper 尚不存在。

- [ ] **Step 3: 实现单列页面且不复制持久化逻辑**

```ts
export function buildSimpleCreateCanvasUrl(projectId: string, reference: WorkspaceAssetReference): string {
  const query = new URLSearchParams({ projectId });
  if (reference.assetVersionId) query.set('assetVersionId', reference.assetVersionId);
  if (reference.placementId) query.set('placementId', reference.placementId);
  return `/?${query.toString()}`;
}
```

页面加载时校验会话和 projectId；表单使用当前模型能力，数量限制 `1～4`；结果组件直接展示 Task 5 槽位，只有受管引用可“在画布中打开”。不得读写 `MOBILE_PROJECT_NAME`、旧 `projects` JSON 或 localStorage 图片备份。

- [ ] **Step 4: 运行组件、鉴权和任务测试**

Run: `pnpm exec vitest run src/__tests__/components/simple-create-page.test.tsx src/__tests__/lib/simple-create-navigation.test.ts src/__tests__/lib/image-generation-session.test.ts src/__tests__/api/auth-login-configuration.test.ts`

Expected: 全部 PASS。

- [ ] **Step 5: 提交快速生图页**

```bash
git add src/app/simple-create/page.tsx src/components/simple-create src/lib/simple-create-navigation.ts src/__tests__/components/simple-create-page.test.tsx src/__tests__/lib/simple-create-navigation.test.ts
git commit -m "feat: add authoritative mobile quick create page"
```

### Task 7: 响应式样式与 Reduced Motion

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/__tests__/components/mobile-canvas-css-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 3、4、6 的 `data-mobile-*` 属性。
- Produces: 320/375/393/768 响应式合同、安全区和 reduced-motion 合同。

- [ ] **Step 1: 写入 CSS 合同失败测试**

```ts
expect(css).toContain('@media (max-width: 767px)');
expect(css).toContain('env(safe-area-inset-bottom)');
expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
expect(css).toMatch(/\[data-canvas-interaction-surface\][^{]*\{[^}]*touch-action:\s*none/);
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/mobile-canvas-css-contract.test.ts`

Expected: FAIL，缺少新增 data contract 或移动断点。

- [ ] **Step 3: 添加范围受控的移动样式**

```css
@media (max-width: 767px) {
  [data-mobile-canvas-toolbar] { padding-bottom: env(safe-area-inset-bottom); }
  [data-mobile-tool-drawer] { max-height: calc(100dvh - 48px - env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  [data-mobile-tool-drawer], [data-mobile-image-actions] { transition-duration: 0ms !important; }
}
```

仅画布交互面设置 `touch-action:none`；`body`、表单和抽屉不得设置该属性。

- [ ] **Step 4: 运行 CSS 与组件回归**

Run: `pnpm exec vitest run src/__tests__/components/mobile-canvas-css-contract.test.ts src/__tests__/components/mobile-bottom-toolbar.test.tsx src/__tests__/components/mobile-image-actions.test.tsx`

Expected: 全部 PASS。

- [ ] **Step 5: 提交响应式样式**

```bash
git add src/app/globals.css src/__tests__/components/mobile-canvas-css-contract.test.ts
git commit -m "style: harden mobile canvas layout and motion"
```

### Task 8: Playwright 移动端与桌面回归矩阵

**Files:**
- Create: `tests/e2e/v588-mobile-canvas.spec.ts`
- Create: `tests/e2e/v588-simple-create.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: `data-testid`/ARIA 名称、Pointer Events、现有登录 fixture 和失败制品配置。
- Produces: Chromium 320×568、375×667、393×852、桌面 1440×900，以及 Firefox/WebKit 375×667 的可重复 E2E 证据。

- [ ] **Step 1: 写入移动端 RED E2E**

```ts
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true });
test('single pan, pinch, long press and all tools remain reachable', async ({ page }) => {
  await openSeededCanvas(page);
  await dispatchTouchPointerSequence(page, singleFingerPan);
  await expect.poll(() => readCanvasTransform(page)).not.toEqual(initialTransform);
  await dispatchTouchPointerSequence(page, twoFingerPinch);
  await expect(page.getByRole('button', { name: '全部工具' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
```

`simple-create` 测试使用测试环境受控任务 fixture，只验证 UI/任务合同，不把 fixture 结果写成真实供应商通过。

- [ ] **Step 2: 运行 E2E 并确认 RED 原因准确**

Run: `pnpm exec playwright test tests/e2e/v588-mobile-canvas.spec.ts tests/e2e/v588-simple-create.spec.ts --project=chromium --reporter=line`

Expected: 在缺失移动能力的断言处 FAIL，并自动保留 screenshot、video、trace、console 和 network 制品。

- [ ] **Step 3: 补齐稳定定位器和浏览器项目**

```ts
projects: [
  { name: 'mobile-320-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 }, hasTouch: true } },
  { name: 'mobile-375-firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 375, height: 667 }, hasTouch: true } },
  { name: 'mobile-375-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 375, height: 667 }, hasTouch: true } },
]
```

不得使用固定长等待；等待 transform、菜单、任务状态或网络响应。桌面用例必须验证鼠标框选、空格平移、滚轮缩放和图片工具。

- [ ] **Step 4: 运行完整新增浏览器矩阵**

Run: `pnpm exec playwright test tests/e2e/v588-mobile-canvas.spec.ts tests/e2e/v588-simple-create.spec.ts --reporter=html,line`

Expected: 所有配置项目 PASS，报告位于 `playwright-report/index.html`，失败时对应制品存在。

- [ ] **Step 5: 提交 E2E 矩阵**

```bash
git add tests/e2e/v588-mobile-canvas.spec.ts tests/e2e/v588-simple-create.spec.ts playwright.config.ts
git commit -m "test: cover mobile canvas and quick create"
```

### Task 9: 全量门禁、报告和 Obsidian 阶段记录

**Files:**
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify outside Git: `J:/无界本地版/projects/_obsidian_wujie/16-V5.8.8选择性吸收.md`
- Modify outside Git: `J:/无界本地版/projects/_obsidian_wujie/00-无界计划索引.md`

**Interfaces:**
- Consumes: Tasks 1～8 的真实命令输出和制品路径。
- Produces: `V588-MOBILE-001～003` 的本地发布候选状态；实体触屏和云端供应商证据未完成时只能写 `LOCAL PASS / CLOUD UNVERIFIED`。

- [ ] **Step 1: 运行静态与测试门禁**

Run: `pnpm ts-check`

Expected: exit 0。

Run: `pnpm lint:build`

Expected: exit 0。

Run: `pnpm test`

Expected: exit 0，无失败、无被新增 skip 掩盖的测试。

- [ ] **Step 2: 运行保护基线与生产构建**

Run: `pnpm check:protected-baseline`

Expected: exit 0，无未授权保护文件漂移。

Run: `pnpm build`

Expected: exit 0，`/simple-create` 出现在路由产物。

- [ ] **Step 3: 更新中文证据报告**

报告写入 exact Git SHA、时间、命令、测试数量、浏览器矩阵、制品路径、已通过项和未验证项；实体设备手感、真实付费生成、取消退款没有证据时不得标记通过。

- [ ] **Step 4: 更新 Obsidian 唯一计划锚点**

在 `16-V5.8.8选择性吸收.md` 记录本阶段完成项、提交 SHA 和下一验证点；在索引只更新当前锚点，不复制整份报告，不重新打开已冻结 Stage 4/Task12。

- [ ] **Step 5: 提交报告并推送 main**

```bash
git add docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: record mobile canvas local verification"
git push origin main
```

提交前运行 `git diff --cached --name-only`，结果不得包含 `.superpowers/sdd/*`；运行 `git rev-parse origin/stable` 必须仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

### Task 10: Coze 与实体触屏发布验收

**Files:**
- Modify after evidence: `docs/testing/REGRESSION_REPORT.md`
- Modify after evidence: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify after evidence: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify outside Git after evidence: `J:/无界本地版/projects/_obsidian_wujie/16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: Task 9 推送的 exact `origin/main` SHA、现有 Coze 项目页和现有浏览器标签。
- Produces: `LOCAL PASS / CLOUD PASS / CLOSED` 或带明确阻塞证据的 `CLOUD UNVERIFIED`。

- [ ] **Step 1: 让 Coze 拉取 exact SHA 并重启沙箱**

核对 `git rev-parse HEAD`、`git diff --exit-code`、Build ID、5000 唯一服务和首页 HTTP 200；沙箱重启完成后必须强制刷新现有预览标签，不新建浏览器标签。

- [ ] **Step 2: 验证云端移动画布 UI**

在 320、375、393 宽度验证单指平移、合成双指缩放、图片/空白长按、底部工具抽屉、图片动作抽屉、无横向溢出和 Console 0 未处理错误。合成触摸只证明事件合同，不冒充实体触屏手感。

- [ ] **Step 3: 执行一次真实 `n=2` 快速生图**

只使用可用的 PearAPI 或 APIMart；记录 providerId、modelId、两个 taskId、逐张到达时间、两个 AssetVersion/placement、积分前后值、刷新恢复、下载和在画布中定位证据。

- [ ] **Step 4: 执行一次真实取消与退款**

记录 taskId、扣费流水、取消终态、退款流水；确认只有一次扣费、一次退款，迟到供应商结果不产生 AssetVersion。供应商不支持取消时必须记录为未验证，不得伪造成功。

- [ ] **Step 5: 使用实体触屏设备补验手感**

验证真实双指中点锚定、单指和页面滚动边界、长按误触率、软键盘打开后的表单/抽屉可达性。缺少实体设备时该项保留在 `UNVERIFIED_ITEMS.md`，本阶段不能关闭。

- [ ] **Step 6: 更新最终证据并提交**

```bash
git add docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: close mobile canvas cloud verification"
git push origin main
```

只有 Tasks 1～10 全部有真实证据、P0/P1 为 0 且 `stable` 未变，才能将 `V588-MOBILE-001～003` 标记为关闭；这不会自动关闭整个无界总目标。

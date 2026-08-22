# V588-UI-003 无限画布小地图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前无限画布视口控制器之上增加桌面端按需小地图导航，并完成本地全量门禁与 Coze/Google Chrome 云端闭环。

**Architecture:** `CanvasMinimap` 是只接收几何与视口快照的叶组件，内部只执行纯投影和点击反投影；`InfiniteCanvas` 继续拥有开关、偏好、响应式可用性和唯一视口写入口；`CanvasZoomCluster` 只提供切换按钮。不得复制 donor 控制器或建立第二套平移/缩放状态。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Tailwind CSS 4、lucide-react、Vitest、Testing Library、Google Chrome、Coze 沙箱。

## Global Constraints

- 只修改 `main`；禁止修改 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- donor `J:\无界云端0820` 全程只读，不复制其 `offsetX/offsetY` 控制器接线。
- 严格执行 RED → 最小 GREEN → 聚焦回归 → 全量回归 → exact-SHA 云端验收。
- 小地图桌面端默认关闭；偏好键固定为 `wujie.canvas.minimap.open.v1`。
- 视口宽度小于 `768px` 或扣除右侧占用后可用宽度小于 `560px` 时隐藏。
- 关闭状态不得遍历图片或计算投影；打开状态只渲染矩形，不加载真实缩略图、不发起网络请求。
- 不删除、移动、重命名现有工具栏按钮，不改变供应商、任务、账务、资产、项目保存或版本历史结构。
- 不新建 Chrome 标签页，不使用 360 浏览器；云端测试只复用现有 Coze 项目页与预览页。

---

### Task 1: 建立小地图 RED 门禁

**Files:**
- Create: `src/__tests__/components/canvas-minimap.test.tsx`
- Create: `src/__tests__/components/canvas-minimap-wiring.test.ts`
- Modify: `src/__tests__/components/canvas-zoom-cluster.test.tsx`

**Interfaces:**
- Consumes: 规格中的世界坐标公式、当前 `CanvasZoomCluster` 和 `InfiniteCanvas` 源码。
- Produces: 对 `CanvasMinimap`、几何纯函数、偏好函数、响应式可用性、工具入口、命令入口和父画布接线的稳定失败契约。

- [ ] **Step 1: 写几何、偏好与组件失败测试**

在 `src/__tests__/components/canvas-minimap.test.tsx` 顶部使用 `// @vitest-environment jsdom`，从尚不存在的组件导入以下固定接口：

```tsx
import {
  CanvasMinimap,
  computeCanvasMinimapBounds,
  computeCanvasMinimapProjection,
  projectCanvasMinimapScene,
  readCanvasMinimapPreference,
  writeCanvasMinimapPreference,
  isCanvasMinimapAvailable,
} from '@/components/canvas/CanvasMinimap';
```

测试固定覆盖：

```tsx
const viewport = {
  width: 1000,
  height: 600,
  zoom: 2,
  offsetX: -400,
  offsetY: -300,
};

expect(computeCanvasMinimapBounds([], viewport)).toEqual({
  minX: 200,
  minY: 150,
  maxX: 700,
  maxY: 450,
});

const projected = projectCanvasMinimapScene(
  Array.from({ length: 300 }, (_, index) => ({
    id: `node-${index}`,
    x: (index % 20) * 180,
    y: Math.floor(index / 20) * 140,
    width: 160,
    height: 120,
  })),
  viewport,
);
expect(projected.items).toHaveLength(300);
expect(Object.values(projected.viewport).every(Number.isFinite)).toBe(true);
```

同时断言：空画布、负坐标、远端矩形、零面积/非有限输入过滤、退化边界不除零、保持宽高比、点击反投影、暗色/黑白主题、空态、关闭按钮、事件不穿透；`isCanvasMinimapAvailable(1200, 480)` 为 `true`，`(767, 20)` 与 `(1000, 480)` 为 `false`；偏好只有精确字符串 `true` 恢复为开启，损坏值和存储异常回退关闭。

- [ ] **Step 2: 写性能预算失败测试**

在同一文件用 300 个矩形执行 100 次 `projectCanvasMinimapScene`，排序耗时并断言 p95：

```tsx
const samples = Array.from({ length: 100 }, () => {
  const startedAt = performance.now();
  projectCanvasMinimapScene(items300, viewport);
  return performance.now() - startedAt;
}).sort((left, right) => left - right);

expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThanOrEqual(8);
```

测试不得放宽节点数量、采样次数或 `8ms` 门槛来制造通过。

- [ ] **Step 3: 写父画布与工具簇接线失败契约**

`src/__tests__/components/canvas-minimap-wiring.test.ts` 必须先断言组件文件存在，再读取三个源码文件并要求：

```ts
expect(component).toContain('export function CanvasMinimap');
expect(component).toContain('data-canvas-minimap');
expect(cluster).toContain('minimapOpen: boolean;');
expect(cluster).toContain('onToggleMinimap: () => void;');
expect(cluster).toContain('title={minimapOpen ? \'关闭小地图\' : \'打开小地图\'}');
expect(canvas).toContain("from '@/components/canvas/CanvasMinimap';");
expect(canvas).toContain('const [minimapOpen, setMinimapOpen] = useState(false);');
expect(canvas).toContain('const minimapAvailable = isCanvasMinimapAvailable(');
expect(canvas).toContain("id: 'toggle-minimap'");
expect(canvas).toContain('<CanvasMinimap');
expect(canvas).toContain('setViewOffset({');
```

更新 `canvas-zoom-cluster.test.tsx` 默认 props，新增 `minimapOpen: false`、`minimapAvailable: true`、`onToggleMinimap: vi.fn()`；断言可用时存在“打开小地图”，active 时存在“关闭小地图”，不可用时按钮不存在，并继续断言所有旧按钮仍存在。

- [ ] **Step 4: 运行 RED 并保存精确失败**

Run:

```powershell
pnpm exec vitest run src/__tests__/components/canvas-minimap.test.tsx src/__tests__/components/canvas-minimap-wiring.test.ts src/__tests__/components/canvas-zoom-cluster.test.tsx
```

Expected: FAIL，首要原因是 `@/components/canvas/CanvasMinimap` 不存在或 wiring 契约缺失；不得接受环境、语法或历史测试失败作为有效 RED。

- [ ] **Step 5: 提交 RED 证据**

```powershell
git add -- src/__tests__/components/canvas-minimap.test.tsx src/__tests__/components/canvas-minimap-wiring.test.ts src/__tests__/components/canvas-zoom-cluster.test.tsx
git commit -m "test: define canvas minimap absorption contract"
```

---

### Task 2: 最小实现小地图叶组件

**Files:**
- Create: `src/components/canvas/CanvasMinimap.tsx`

**Interfaces:**
- Consumes: `CanvasMinimapItem[]`、`CanvasMinimapViewport`、主题、右侧偏移和关闭/导航回调。
- Produces: 几何与偏好纯函数、`CanvasMinimapScene` 和无领域状态的 `CanvasMinimap`。

- [ ] **Step 1: 定义固定类型、常量与偏好函数**

```tsx
'use client';

import { X } from 'lucide-react';
import { useCallback, useMemo } from 'react';

export const CANVAS_MINIMAP_PREFERENCE_KEY = 'wujie.canvas.minimap.open.v1';
export const CANVAS_MINIMAP_WIDTH = 176;
export const CANVAS_MINIMAP_HEIGHT = 124;
export const CANVAS_MINIMAP_PADDING = 10;

export interface CanvasMinimapItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasMinimapViewport {
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

type CanvasMinimapStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readCanvasMinimapPreference(storage?: CanvasMinimapStorage | null): boolean {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    return target?.getItem(CANVAS_MINIMAP_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeCanvasMinimapPreference(open: boolean, storage?: CanvasMinimapStorage | null): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    target?.setItem(CANVAS_MINIMAP_PREFERENCE_KEY, String(open));
  } catch {
    // Preference persistence must never block the canvas.
  }
}

export function isCanvasMinimapAvailable(viewportWidth: number, occupiedRight: number): boolean {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(occupiedRight)) return false;
  return viewportWidth >= 768 && viewportWidth - Math.max(0, occupiedRight) >= 560;
}
```

- [ ] **Step 2: 实现有限值安全的投影纯函数**

固定导出：

```tsx
export interface CanvasMinimapBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface CanvasMinimapProjection { scale: number; offsetX: number; offsetY: number }
export interface CanvasMinimapRect { id?: string; x: number; y: number; width: number; height: number }
export interface CanvasMinimapScene {
  items: CanvasMinimapRect[];
  viewport: CanvasMinimapRect;
  bounds: CanvasMinimapBounds;
  projection: CanvasMinimapProjection;
}
```

`computeCanvasMinimapBounds(items, viewport)` 使用 `safeZoom = Number.isFinite(viewport.zoom) && viewport.zoom >= 0.1 ? viewport.zoom : 0.1`，先计算视口世界矩形，再逐项合并有效矩形。`computeCanvasMinimapProjection(bounds, width = 176, height = 124, padding = 10)` 对退化宽高使用 `Math.max(1, ...)`，并返回有限 scale/offset。`projectCanvasMinimapScene` 只执行一次 `O(n)` 遍历并返回 300 个完整色块与视口框。

点击反投影固定公式：

```tsx
const worldX = (miniX - scene.projection.offsetX) / scene.projection.scale;
const worldY = (miniY - scene.projection.offsetY) / scene.projection.scale;
onNavigate({ x: worldX, y: worldY });
```

- [ ] **Step 3: 实现展示组件**

组件 props 固定为：

```tsx
export interface CanvasMinimapProps {
  items: CanvasMinimapItem[];
  viewport: CanvasMinimapViewport;
  theme?: 'dark' | 'mono';
  rightOffset: number;
  onNavigate: (point: { x: number; y: number }) => void;
  onClose: () => void;
}
```

根节点必须包含 `data-popup data-canvas-minimap`，宽度 `192px`、底部 `76px`、`right: Math.max(12, rightOffset)`、`z-40`、圆角 `8px`；地图区域使用 `data-testid="canvas-minimap-map"`、`176x124`。`onPointerDown`、`onWheel` 和地图点击均 `stopPropagation()`。空列表显示“暂无画布内容”，但仍绘制有限视口框。关闭按钮使用 `X` 图标和 `aria-label="关闭小地图"`。

- [ ] **Step 4: 运行叶组件测试**

Run:

```powershell
pnpm exec vitest run src/__tests__/components/canvas-minimap.test.tsx
```

Expected: PASS；wiring 与工具簇测试仍按预期失败。

- [ ] **Step 5: 提交叶组件**

```powershell
git add -- src/components/canvas/CanvasMinimap.tsx
git commit -m "feat: add canvas minimap leaf component"
```

---

### Task 3: 接入现有视口、工具簇和命令面板

**Files:**
- Modify: `src/components/canvas/CanvasZoomCluster.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 叶组件、当前 `canvasSize`、`canvasOccupiedRight`、`viewOffset`、`zoom` 与 `setViewOffset`。
- Produces: 单一切换路径、桌面可用性、零常态计算、工具入口、命令入口和当前视口导航。

- [ ] **Step 1: 给 CanvasZoomCluster 增加展示入口**

增加 props：

```tsx
minimapOpen: boolean;
minimapAvailable: boolean;
onToggleMinimap: () => void;
```

从 Lucide 导入 `Map as MapIcon`，在重置视图与命令面板之间仅当 `minimapAvailable` 时渲染：

```tsx
<button
  type="button"
  onClick={onToggleMinimap}
  aria-pressed={minimapOpen}
  className={`${buttonClassName} ${minimapOpen ? activeToggleClassName : inactiveToggleClassName}`}
  title={minimapOpen ? '关闭小地图' : '打开小地图'}
>
  <MapIcon className="h-4 w-4" />
  <span className={tooltipClassName}>{minimapOpen ? '关闭小地图' : '打开小地图'}</span>
</button>
```

其余按钮、顺序、props 与处理函数不得改变。

- [ ] **Step 2: 在 InfiniteCanvas 建立偏好和响应式可用性**

导入 Task 2 组件与 helpers，并在 `commandPaletteOpen` 附近增加：

```tsx
const [minimapOpen, setMinimapOpen] = useState(false);

useEffect(() => {
  setMinimapOpen(readCanvasMinimapPreference());
}, []);
```

在 `canvasOccupiedRight` 之后增加：

```tsx
const minimapAvailable = isCanvasMinimapAvailable(canvasSize.width, canvasOccupiedRight);
const usableMinimapViewport = useMemo(() => resolveCanvasUsableViewportSize(
  { width: canvasSize.width, height: canvasSize.height },
  { right: canvasOccupiedRight },
), [canvasOccupiedRight, canvasSize.height, canvasSize.width]);

const toggleCanvasMinimap = useCallback(() => {
  if (!minimapAvailable) return;
  setMinimapOpen(current => {
    const next = !current;
    writeCanvasMinimapPreference(next);
    return next;
  });
}, [minimapAvailable]);
```

窗口变窄时只停止渲染，不把用户偏好写成关闭；恢复宽度后继续遵循原偏好。

- [ ] **Step 3: 只在开启且可用时构建几何**

```tsx
const minimapItems = useMemo<CanvasMinimapItem[]>(() => {
  if (!minimapOpen || !minimapAvailable) return [];
  return images.flatMap(image => (
    !image.isProcessingPlaceholder
    && Number.isFinite(image.x)
    && Number.isFinite(image.y)
    && Number.isFinite(image.width)
    && Number.isFinite(image.height)
    && image.width > 0
    && image.height > 0
      ? [{ id: image.id, x: image.x, y: image.y, width: image.width, height: image.height }]
      : []
  ));
}, [images, minimapAvailable, minimapOpen]);

const handleMinimapNavigate = useCallback((point: { x: number; y: number }) => {
  setViewOffset({
    x: usableMinimapViewport.width / 2 - point.x * zoom,
    y: usableMinimapViewport.height / 2 - point.y * zoom,
  });
}, [setViewOffset, usableMinimapViewport.height, usableMinimapViewport.width, zoom]);
```

不得调用 `applyViewState`、直接写 DOM transform 或改变 zoom。

- [ ] **Step 4: 接入命令、工具簇和渲染**

在命令数组的视图区仅当 `minimapAvailable` 时插入：

```tsx
...(minimapAvailable ? [{
  id: 'toggle-minimap',
  label: minimapOpen ? '关闭小地图' : '打开小地图',
  hint: '查看画布缩略导航',
  section: '视图',
  keywords: 'minimap overview navigation 小地图 导航 总览',
  action: toggleCanvasMinimap,
}] : []),
```

将 `minimapOpen/minimapAvailable/onToggleMinimap` 传入 `CanvasZoomCluster`，并在命令面板之前渲染：

```tsx
{minimapOpen && minimapAvailable && (
  <CanvasMinimap
    items={minimapItems}
    viewport={{
      width: usableMinimapViewport.width,
      height: usableMinimapViewport.height,
      zoom,
      offsetX: viewOffset.x,
      offsetY: viewOffset.y,
    }}
    theme={isMonochrome ? 'mono' : 'dark'}
    rightOffset={canvasOccupiedRight + 12}
    onNavigate={handleMinimapNavigate}
    onClose={toggleCanvasMinimap}
  />
)}
```

- [ ] **Step 5: 授权精确保护路径**

只在 `package.json` 的 `check:protected-baseline` 命令加入：

```text
--allow-path src/components/canvas/CanvasMinimap.tsx
```

不得扩大为整个 `src/components/canvas/` 目录。

- [ ] **Step 6: 运行聚焦 GREEN**

Run:

```powershell
pnpm exec vitest run src/__tests__/components/canvas-minimap.test.tsx src/__tests__/components/canvas-minimap-wiring.test.ts src/__tests__/components/canvas-zoom-cluster.test.tsx src/__tests__/components/canvas-command-palette-wiring.test.ts src/__tests__/components/infinite-canvas-split-wiring.test.ts src/__tests__/components/canvas-project-reopen-contract.test.ts
```

Expected: 6 files PASS；旧入口保持完整，小地图入口与父画布接线转绿。

- [ ] **Step 7: 提交接线**

```powershell
git add -- src/components/canvas/CanvasZoomCluster.tsx src/components/infinite-canvas.tsx package.json
git commit -m "feat: connect minimap to canvas viewport"
```

---

### Task 4: 全量回归、治理记录与 main 候选

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify: `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: Task 1-3 的代码、RED/GREEN 输出和来源哈希。
- Produces: 本地候选状态、门禁结果、已知跳过项、云端验收矩阵和不偏移的 Obsidian 进度。

- [ ] **Step 1: 运行全部本地门禁**

```powershell
pnpm ts-check
pnpm lint
pnpm test
pnpm build
pnpm check:protected-baseline
git diff --check
```

Expected: TypeScript、ESLint、全仓测试、构建、38 项保护基线和 diff 检查均通过；缺少 `POSTGRES_TEST_DATABASE_URL` 的既有 PostgreSQL 跳过项必须原样记录，不能写成通过。

- [ ] **Step 2: 更新仓库与 Obsidian 治理记录**

记录：donor 组件/测试 SHA-256、实际 RED 原因、聚焦测试数量、全仓通过/跳过数量、构建页数、保护基线结果、`stable` SHA、当前候选 SHA、云端仍待验矩阵。`V588-UI-003` 在云端证据完成前只标记“本地候选通过 / 云端待验”。

- [ ] **Step 3: 验证文档与工作树**

```powershell
pnpm exec vitest run tests/unit/v588-absorption-inventory.spec.ts tests/unit/v588-cloud-evidence-manifest.spec.ts
pnpm check:protected-baseline
git diff --check
git status --short
```

Expected: 治理测试通过；只存在本项计划内文件和明确排除的 `.playwright-cli/`、`output/`，后两者不得加入提交。

- [ ] **Step 4: 提交并推送 main**

```powershell
git add -- docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: record v588 minimap local acceptance"
git push origin HEAD:main
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `HEAD == origin/main`，`origin/stable == 52f7c601ed150769e15d06fb435c6e360e28c9e7`。

---

### Task 5: Coze exact-SHA 与 Google Chrome 云端验收

**Files:**
- Create: `docs/testing/evidence/v588-ui-003-cloud-2026-08-22.json`
- Create: `docs/testing/evidence/v588-ui-003-cloud-2026-08-22.png`
- Modify: Task 4 的四份仓库报告与两份 Obsidian 进度文件。

**Interfaces:**
- Consumes: 已推送的 `origin/main` exact SHA、现有 Coze 项目页与已登录 Google Chrome 预览页。
- Produces: 默认状态、偏好、导航、响应式、性能、视觉、Console 和稳定分支不变的真实证据。

- [ ] **Step 1: Coze 拉取 exact SHA 并重启**

在现有 Google Chrome Coze 项目页确认沙箱状态；若出现断开弹窗，只刷新该项目页并等待恢复。让 Coze 拉取 `main`，输出并核对 `HEAD`、`origin/main`、`origin/stable`、构建 exit code、5000 端口和根路由 HTTP 200。该代表性外部操作必须在发送前取得当次确认。

- [ ] **Step 2: 强制刷新现有预览页并验证基础矩阵**

验证：默认关闭、工具按钮打开/关闭、命令面板检索并切换、关闭按钮、暗色/黑白主题、空态、点击不穿透、无原生错误弹窗。不得新建标签页。

- [ ] **Step 3: 验证导航、布局与偏好**

在正常项目中记录点击前后缩放与视口位置，点击远端矩形后证明 zoom 不变且目标进入可用视口中心；展开/折叠右侧面板证明小地图不重叠；刷新证明用户偏好恢复；缩窄到 `<768px` 和可用宽度 `<560px` 时隐藏，恢复后按偏好重现。

- [ ] **Step 4: 验证 100/300 节点和运行时健康**

使用现有测试夹具或可恢复的测试项目验证 100/300 矩形完整显示，拖动画布无明显冻结；采集 Console Error、Console Warning、`[CanvasToolSession]`、网络请求和原生 dialog，要求新增错误为 0、小地图网络请求为 0。

- [ ] **Step 5: 保存证据并关闭 V588-UI-003**

机器 JSON 至少包含：`gitSha/stableSha/url/testedAt/browser/matrix/passCount/failCount/consoleErrors/consoleWarnings/networkRequests/screenshot`。截图必须显示小地图、主画布、右侧面板和底部工具栏均未重叠。通过后把 `V588-UI-003` 标记为“已吸收”；任何失败先登记、稳定复现、补 RED、最小修复并重跑全量门禁。

- [ ] **Step 6: 提交云端证据并再次推送 main**

```powershell
pnpm exec vitest run tests/unit/v588-absorption-inventory.spec.ts tests/unit/v588-cloud-evidence-manifest.spec.ts
pnpm check:protected-baseline
git diff --check
git add -- docs/testing/evidence/v588-ui-003-cloud-2026-08-22.json docs/testing/evidence/v588-ui-003-cloud-2026-08-22.png docs/plans/v588/V588_ABSORPTION_INVENTORY.md docs/testing/REGRESSION_REPORT.md docs/testing/RELEASE_READINESS_REPORT.md docs/testing/UNVERIFIED_ITEMS.md
git commit -m "docs: close v588 ui 003 cloud acceptance"
git push origin HEAD:main
```

最终再次证明 `HEAD == origin/main` 且 `origin/stable` 未变化，再进入吸收清单中的下一项。

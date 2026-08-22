# V588-UI-004 画布展示层拆分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不丢失任何现有入口、动作、状态和业务 handler 的前提下，把无限画布空态、图片浮动工具栏及编辑面板拆成可独立验证的展示叶组件，并证明桌面/移动端无裁切、无重叠且尊重 reduced-motion。

**Architecture:** 当前 `InfiniteCanvas` 继续拥有所有业务状态、命令、任务、计费、持久化与画布控制器；新叶组件只接收数据和回调，不自行调用 API、不读取项目状态、不创建任务。继续使用当前更完整的 `getBottomToolbarDrawerPlacement()`、`getConstrainedImageToolbarPosition()`、工具会话和偏好迁移，不复制 V5.8.8 的控制器或旧布局算法。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Tailwind CSS 4、Vitest、Testing Library、Playwright/Google Chrome。

## Global Constraints

- 只修改 `main`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 始终只读。
- 只读 donor 固定为 `J:/无界云端0820`，不得向 donor 写入文件。
- 所有生产代码改动必须先有对应 RED，随后最小实现、聚焦回归、全量回归和 Coze exact-SHA Google Chrome 验收。
- 不删除、重命名、隐藏或重排任何现有底部工具栏、图片工具栏、右键菜单、快捷键或编辑模式入口。
- 不移动业务 handler、API 调用、任务轮询、扣费退款、项目保存或画布控制器到展示组件。
- 底部抽屉继续 portal 到 `document.body`；图片工具栏继续使用当前视口约束算法和 `+N` 有界弹层。
- 新组件必须支持暗色/黑白主题、375px 视口、右侧 480px 工作面板、键盘关闭、pointer/wheel 隔离和 `prefers-reduced-motion`。
- V5.8.8 仅提供展示边界参考。donor SHA-256：空态 `D678ABFE22BF4FE81D5AB25DD9034C3E227336CF5D3EA779B480D83208E79A4D`；图片工具栏 `13E4E5165DF33D8F7A332CF273DF522CD3DD15F36CD6BD503AC77A294B7E5C25`；调色/去背景 `4263B55EBA22DF013ED766168EA18536B0F00DAD91EDCB3E3E607A3A05F38209`；擦除/蒙版 `AB790DB3CD81BA99931EB7B6620FA61AABE8CE95CA5B14B0DD1F5E01F0B71130`；扩展/裁切 `6EA03A346E617130CA30897E4150DE7193AB89BED62E62A8CCEEE12BBFD9966F`；放大/SVG `1EB901AC7A0500969BA1A7C1C7C06E7EB01C5A73E4858946C8933855E9C8CB8E`。

---

### Task 1: 建立展示边界与入口完整性 RED

**Files:**
- Create: `src/__tests__/components/canvas-presentation-boundaries.test.ts`
- Create: `src/__tests__/components/canvas-toolbar-entry-manifest.test.ts`
- Modify: `docs/testing/baselines/protected-source-authorizations.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: 当前 `InfiniteCanvas`、`DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER`、底部抽屉四个 section 和工具会话注册表。
- Produces: 六个展示叶组件的文件/接线契约，以及图片、视频、3D 与底部工具栏的精确入口清单。

- [x] **Step 1: 写边界失败测试**

  测试必须断言以下文件存在并由 `InfiniteCanvas` 导入：

  ```ts
  const leaves = [
    'CanvasEmptyState.tsx',
    'CanvasImageActionToolbar.tsx',
    'CanvasEditUpscaleSvgPanel.tsx',
    'CanvasEditEraseMaskPanel.tsx',
    'CanvasEditColorRemoveBgPanel.tsx',
    'CanvasEditExpandCropPanel.tsx',
  ];
  ```

  同时断言父组件仍持有 `fetch(`、`activateCanvasToolSession`、`requestDeleteImages`、`onForceSave`，新叶组件不得包含这些业务入口。

- [x] **Step 2: 写入口清单失败测试**

  图片入口必须包含且只包含当前实际能力：

  ```ts
  const imageTools = [
    '放大', '移除背景', 'SVG智能描摹', '元素拆解', '横竖重组', '擦除', '蒙版',
    '调色', '编辑元素', '多角度', '图转3D工厂', '扩展', '裁切', '全景生成',
    '精修引擎', '人物精修大师', '语言修图', 'Agent编排', '下载',
  ];
  const videoTools = ['视频抽帧', 'AI配音', '转 GIF', '视频压缩', '下载'];
  const model3DTools = ['下载'];
  ```

  底部抽屉必须继续包含 `ai-creation`、`brand-design`、`pro-tools`、`canvas-tools` 四组和全部现有 `aria-label`/`title`。

- [x] **Step 3: 运行 RED**

  Run: `pnpm exec vitest run src/__tests__/components/canvas-presentation-boundaries.test.ts src/__tests__/components/canvas-toolbar-entry-manifest.test.ts`

  Expected: FAIL，原因仅为六个叶组件尚不存在、父组件尚未接线或入口清单尚未集中导出；不得因语法或环境错误失败。

- [ ] **Step 4: 将新路径加入保护门禁授权**

  仅将六个精确路径加入 `check:protected-baseline` allow-path 和 `protected-source-authorizations.json`，sourceCommit 使用本任务实际提交 SHA；不得授权整个目录。

- [x] **Step 5: 提交 RED**

  ```bash
  git add src/__tests__/components/canvas-presentation-boundaries.test.ts src/__tests__/components/canvas-toolbar-entry-manifest.test.ts docs/testing/baselines/protected-source-authorizations.json package.json
  git commit -m "test: define V588 UI004 presentation boundaries"
  ```

### Task 2: 提取空态叶组件

**Files:**
- Create: `src/components/canvas/CanvasEmptyState.tsx`
- Create: `src/__tests__/components/canvas-empty-state.test.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/__tests__/components/canvas-presentation-boundaries.test.ts`

**Interfaces:**
- Consumes: `isMonochrome: boolean`、`onUploadClick: () => void`、`onHelpClick: () => void`。
- Produces: `CanvasEmptyState`，容器不阻断拖放/粘贴，两个按钮区域可交互。

- [x] **Step 1: 写行为 RED**

  断言标题、上传、使用说明、核心快捷提示存在；点击两个按钮各调用一次回调；外层 `pointer-events-none`，按钮区 `pointer-events-auto`。

- [x] **Step 2: 运行 RED**

  Run: `pnpm exec vitest run src/__tests__/components/canvas-empty-state.test.tsx`

  Expected: FAIL，原因是组件尚未实现。

- [x] **Step 3: 最小实现并接线**

  `InfiniteCanvas` 仅在 `images.length === 0` 渲染叶组件；上传回调调用 `uploadFileInputRef.current?.click()`，说明回调调用 `setShowHelpModal('instructions')`。不得改变拖放、粘贴或生成逻辑。

- [x] **Step 4: 验证 GREEN**

  Run: `pnpm exec vitest run src/__tests__/components/canvas-empty-state.test.tsx src/__tests__/components/canvas-presentation-boundaries.test.ts`

- [x] **Step 5: 提交**

  ```bash
  git add src/components/canvas/CanvasEmptyState.tsx src/components/infinite-canvas.tsx src/__tests__/components/canvas-empty-state.test.tsx src/__tests__/components/canvas-presentation-boundaries.test.ts
  git commit -m "refactor: extract canvas empty state"
  ```

### Task 3: 提取图片浮动工具栏叶组件

**Files:**
- Create: `src/components/canvas/CanvasImageActionToolbar.tsx`
- Create: `src/__tests__/components/canvas-image-action-toolbar.test.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/lib/image-toolbar-preferences.ts`
- Modify: `src/__tests__/components/canvas-toolbar-floating-windows.test.ts`
- Modify: `src/__tests__/components/canvas-presentation-boundaries.test.ts`

**Interfaces:**
- Consumes: 父组件构建的 `CanvasImageToolbarAction[]`、约束后位置、显示/溢出数组、删除/展开/设置回调和偏好状态 setter。
- Produces: `CanvasImageActionToolbar`；不包含模型选择、任务或 API 逻辑。

- [x] **Step 1: 写行为 RED**

  验证前五项显示、其余仅在 `+N` 弹层、删除始终可达、设置可恢复默认、wheel/pointer 不穿透、暗色/黑白与 reduced-motion 类存在。验证 375px 合同依赖 `max-w-[calc(100vw-24px)]` 与有界溢出层，而不是横向滚动主工具栏。

- [x] **Step 2: 写入口迁移 RED**

  将 `横竖重组` 纳入 `DEFAULT_IMAGE_TOOLBAR_ITEM_ORDER`，并证明旧 localStorage 顺序会在 `元素拆解` 后补入，旧隐藏列表不能误隐藏新入口。

- [x] **Step 3: 运行 RED**

  Run: `pnpm exec vitest run src/__tests__/components/canvas-image-action-toolbar.test.tsx src/__tests__/lib/image-toolbar-preferences.test.ts src/__tests__/components/canvas-toolbar-entry-manifest.test.ts`

- [x] **Step 4: 最小实现与接线**

  父组件继续构建 `imageActions`、媒体过滤和所有回调；叶组件仅渲染。沿用 `getConstrainedImageToolbarPosition()`，不得复制 donor 的旧定位函数。

- [x] **Step 5: 验证 GREEN 并提交**

  Run: `pnpm exec vitest run src/__tests__/components/canvas-image-action-toolbar.test.tsx src/__tests__/lib/image-toolbar-position.test.ts src/__tests__/lib/image-toolbar-preferences.test.ts src/__tests__/components/canvas-toolbar-floating-windows.test.ts src/__tests__/components/canvas-toolbar-entry-manifest.test.ts src/__tests__/components/canvas-presentation-boundaries.test.ts`

  Commit: `refactor: extract selected image toolbar`

### Task 4: 提取放大/SVG 与擦除/蒙版展示叶

**Files:**
- Create: `src/components/canvas/CanvasEditUpscaleSvgPanel.tsx`
- Create: `src/components/canvas/CanvasEditEraseMaskPanel.tsx`
- Create: `src/__tests__/components/canvas-edit-upscale-svg-panel.test.tsx`
- Create: `src/__tests__/components/canvas-edit-erase-mask-panel.test.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/__tests__/components/canvas-presentation-boundaries.test.ts`

**Interfaces:**
- Consumes: 当前块引用的精确 state/value/setter/handler；画布坐标继续由父组件提供。
- Produces: 两个无副作用展示叶，分别覆盖放大/SVG 和擦除/蒙版。

- [x] **Step 1: 先写模式可见性、确认/取消、模型/参数与 reduced-motion RED。**
- [x] **Step 2: 运行 RED，确认仅因叶组件/接线缺失失败。**
- [x] **Step 3: 从当前 `InfiniteCanvas` 机械移动 JSX；禁止从 donor 覆盖当前业务逻辑。**
- [x] **Step 4: 运行两个新测试、所有放大/SVG/擦除/蒙版既有测试和 TypeScript。**
- [x] **Step 5: 提交 `refactor: extract primary canvas edit panels`。**

### Task 5: 提取调色/去背景与扩展/裁切展示叶

**Files:**
- Create: `src/components/canvas/CanvasEditColorRemoveBgPanel.tsx`
- Create: `src/components/canvas/CanvasEditExpandCropPanel.tsx`
- Create: `src/__tests__/components/canvas-edit-color-removebg-panel.test.tsx`
- Create: `src/__tests__/components/canvas-edit-expand-crop-panel.test.tsx`
- Modify: `src/components/infinite-canvas.tsx`
- Modify: `src/__tests__/components/canvas-presentation-boundaries.test.ts`

**Interfaces:**
- Consumes: 当前调色、去背景、扩展、裁切的精确 state/setter/handler 与画布几何数据。
- Produces: 两个无副作用展示叶；当前模型、引擎、透明 PNG、蒙版、裁切和扩图参数行为保持不变。

- [x] **Step 1: 写模式可见性、确认/取消、参数传递、处理态与 reduced-motion RED。**
- [x] **Step 2: 运行 RED。**
- [x] **Step 3: 机械移动当前 JSX 并接线，不采用 donor 中可能过时的模型/引擎列表。**
- [x] **Step 4: 运行新测试、去背景/调色/扩展/裁切既有回归和 TypeScript。**
- [x] **Step 5: 提交 `refactor: extract secondary canvas edit panels`。**

### Task 6: 桌面/移动端视觉和动作完整性门禁

**Files:**
- Create: `tests/e2e/v588-ui004-canvas-presentation.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `docs/testing/TEST_CASES.md`

**Interfaces:**
- Consumes: 隔离 fixture、现有登录态、全部工具抽屉、图片工具栏与编辑模式入口。
- Produces: Chromium/Firefox/WebKit 可复用 E2E；云端 Google Chrome 使用相同动作矩阵。

- [ ] **Step 1: 建立 375x812、768x900、1440x900 的失败视觉/可点击 RED。**
- [ ] **Step 2: 验证底部抽屉、图片 `+N`、右侧 480px 面板、编辑面板均不越界、不重叠，所有入口可点击。**
- [ ] **Step 3: 在 `reducedMotion: 'reduce'` 下确认没有依赖动画才能到达的状态，关键组件包含 motion-reduce 合同。**
- [ ] **Step 4: 保存 screenshot、trace、console、network；失败不得用固定长 sleep 掩盖。**
- [ ] **Step 5: 提交 `test: cover canvas presentation layouts`。**

### Task 7: 全量回归、云端验收与治理闭环

**Files:**
- Modify: `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- Modify: `F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

- [ ] **Step 1: 本地门禁**

  ```bash
  pnpm exec vitest run <UI-004 focused files>
  pnpm test
  pnpm ts-check
  pnpm lint
  pnpm build
  pnpm check:protected-baseline
  git diff --check
  ```

- [ ] **Step 2: 独立审查并只修复可复现问题。**
- [ ] **Step 3: 推送 `main`，确认 `origin/stable` SHA 未变化。**
- [ ] **Step 4: Coze 拉取 exact SHA、构建并重启；只复用 Google Chrome「用户1」现有项目页和预览页，不创建标签、不使用 360。**
- [ ] **Step 5: 云端执行桌面/移动端、全部入口、右侧面板、主题、reduced-motion、Console/网络/dialog 和截图矩阵。**
- [ ] **Step 6: 只有机器证据、中文治理文档和 Obsidian 均记录 exact SHA 后，才把 `V588-UI-004` 标记为已吸收并进入 `V588-ADMIN-001/002/003` 后的下一唯一未吸收管理员项。**

## Self-Review

- 规格覆盖：空态、zoom 既有叶、overflow-safe 底部/图片工具栏、四组编辑面板、入口完整性、桌面/移动端、主题、右侧避让和 reduced-motion 均有对应任务。
- 目标边界：没有任务允许复制 donor 控制器、替换当前布局算法、迁移 API/任务/账务或修改 stable。
- 防功能丢失：Task 1 的精确入口清单先于任何生产改动；Task 3-5 只允许父状态/handler 注入展示叶。
- 无占位：每项均指定文件、RED、实现边界、验证命令和提交点。
- 类型一致：所有叶组件使用当前 `CanvasImage`、`EditMode`、`ImageToolbarPosition` 与现有 setter/handler，不新增平行领域类型。

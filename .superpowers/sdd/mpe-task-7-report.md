# Task 7 实施报告

## 结论

状态：**本地 GREEN；未进行云端浏览器验收；未推送。**

- 开始基线：`main@c06fda254dd7322b1d78fc67e238ffe04da3a440`
- 提交信息：`feat: add canvas export drawer`
- 仅使用当前工作区，未创建分支或 worktree，未触碰 `stable`。
- 多平台批量导出使用现有 Canvas Skill 入口，不新增中央浮窗或独立 Simple Chat 目录入口。
- `SkillInputFields` 的通用行为保持不变；导出 Skill 使用专用六区抽屉，其他 Skill 继续走原控件。

## TDD 证据

先建立失败测试，再实现生产代码。

首轮 RED：三个新测试文件因组件、客户端和 ChatPanel 接线不存在而失败。

结果清单专项 RED：`multi-platform-export-results.test.tsx` 的 5 项中 2 项失败：

1. `loadExportManifestFiles` 尚不存在；
2. 结果没有按平台分组，也没有显示来源 AssetVersion。

最小实现后专项转为 `5/5` GREEN；四个 Task7 计划测试转为 `16/16` GREEN。

## 已实现内容

### 贴底工具抽屉

- 通过现有 Canvas ChatPanel Skill 入口打开，使用 `data-bottom-toolbar-drawer` 和底部定位，不使用中央对话框。
- 六区完整实现：素材、目标平台、适配方式、命名、执行预览、结果。
- 仅读取并显示公开且 `enabled` 的平台预设。
- 375px 起始为单列，较宽视口逐步扩展；交互控件最小高度 40px，文本使用截断或换行防止溢出。
- 使用现有颜色 token、边框与 Lucide 图标；区块圆角不超过 8px，无卡片嵌套。

### 输入、预览与执行

- 来源仅使用当前项目画布已选图片的 `AssetVersion` ID。
- 按 Task3 冻结预设尺寸计算真实文件数与总像素；ZIP 仅显示明确标注的估算值；积分固定为 0。
- 进度只读取服务端 `AgentRunProjection.progress`，没有本地定时器或假进度。
- 取消复用现有 `useSkillRun.cancel()` 的 PATCH 链路。
- 部分成功保留结果，并通过 `useSkillRun.retry('export')` 仅重试失败项。

### 稳定结果与画布投影

- 结构化结果按 `multi-platform-export-result-v1` 严格解析。
- manifest、ZIP 和单张图片均先通过项目授权的 `/api/assets` 解析稳定 AssetVersion URL。
- manifest 读取后校验 schema、runId 和内容约束，结果按平台分组并显示来源 AssetVersion。
- 批量放入画布只接受 `kind: image`；manifest 和 ZIP 不投影。
- 已在画布中的历史 AssetVersion 会跳过，恢复历史 Run 时复用原版本，不重新导出。

### 兼容边界

- 保留 ChatPanel 现有功能和其他 Skill 的 `SkillInputFields`、运行进度与历史能力。
- 独立 Simple Chat 未添加目录入口；既有 `catalogSurfaces: ['canvas', 'workflow']` 契约保持不变。
- 因本任务直接修改 `chat-panel.tsx`，按简报要求仅更新一条已经过时的源码字符串断言，使其匹配当前 `requiredSkillModelRoles` 实现。
- 首版未修改 `infinite-canvas.tsx`；复审后在用户明确批准的最小边界内，仅让真实底部工具栏发布动态位置 CSS 变量，未重构画布。Workflow 和 Simple Chat 页面仍未修改。

## 本地验证

### Task7 计划测试

```text
4 个测试文件
16 个测试通过
0 失败
```

### Skill 与画布相关回归

```text
10 个测试文件
78 个测试通过
0 失败
```

覆盖 Task7 四项计划测试、通用 Skill 输入控件、运行恢复、取消订阅、公开目录和多平台导出 preset 契约。

### 静态检查

```text
pnpm ts-check：退出码 0
Task7 目标 ESLint：退出码 0
Task7 scoped git diff --check：退出码 0
```

`chat-panel.tsx` 单独扫描仍报告 50 条历史 warning；本次没有新增该文件 warning。Task7 新文件扫描为 0 error、0 warning。

## 未验证项

- 本任务没有执行云端 Coze 真实导出或浏览器视觉验收。
- 没有在真实 375px 设备、Chromium、Firefox、WebKit 中采集截图或交互证据；本轮仅通过响应式类名和组件测试验证布局契约。
- Task6 已登记的 PostgreSQL 隔离库并发验证不属于 Task7，本任务未把它标记为通过。

## 保护与提交约束

以下进入本任务前已经存在的脏 SDD 文件不暂存、不提交：

- `.superpowers/sdd/mpe-progress.md`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/task-1-brief.md`
- `.superpowers/sdd/task-1-review.md`
- `.superpowers/sdd/task-2-brief.md`
- `.superpowers/sdd/task-2-review.md`
- `.superpowers/sdd/task-3-brief.md`

本报告受 `.superpowers/sdd/.gitignore` 覆盖，将仅对本报告使用精确强制暂存。提交完成后不执行 push。

## NEEDS_FIXES 复审修复

### TDD 证据

- 首轮复审 RED：6 项失败，稳定覆盖嵌套 `label`、历史 Run、权威估算/损坏结果、整组下载/定位/错误展示、新 retry runId 和动态工具栏位置。
- 客户端工具 RED：`downloadExportGroup`、`projectExportImagesInBatches`、`shouldAutoProjectCanvasSkill` 尚不存在。
- 估算语义 RED：2 项失败，证明只有积分的响应被错误标成完整服务端校验，且未展示可选的服务端导出计划字段。
- 整组下载授权 RED：1 项失败，证明下载前没有按项目与 AssetVersion 重新解析稳定 URL。

### 复审项闭环

1. 通用 completed 自动投影明确排除 `preset-multi-platform-export`；只有用户点击“批量放入画布”才投影。图片最多 100 项，默认每 10 项让出一次主线程，并复用既有 AssetVersion 布局/幂等投影。
2. 专用抽屉接入既有 `SkillRunHistory`，可选择历史 Run；恢复使用原有输出版本，不重新导出，恢复异常会在 UI 显示。
3. `useSkillRun.retryRun()` 返回服务端权威 runId；ChatPanel 在重试后立即同步 coordinator 和 `activeCanvasSkillRunRef`，新投影不再优先使用旧 ref。
4. 真实底部工具栏通过 `ResizeObserver` 和窗口尺寸发布 `--canvas-bottom-toolbar-offset`；抽屉消费同一变量，图层/历史面板改变布局时会重新测量，无复制魔法数。
5. 终态结果缺失、JSON/schema 解析失败会显示“结果数据损坏或版本不兼容”，并提供重试与运行日志入口。
6. 单图、全局 ZIP、manifest、平台整组、放入画布与重试均由统一 async action 边界捕获；按钮有 loading/disabled，错误在抽屉显示，不产生 `unhandledrejection`。
7. 结果操作已补齐：manifest、全局 ZIP、单图、按平台整组、来源版本定位。整组下载逐项重新通过 `/api/assets` 授权稳定 AssetVersion，客户端 JSZip 限制 100 件/256 MiB 并显示进度。
8. 本地文件数/像素/ZIP 启发式值持续标注“本地预估”和“尚未校验”。抽屉可接收并展示 `skillRun.estimate.exportPlan` 的服务端文件数/像素/ZIP 估计与积分；当共享估算 API 只返回积分时，明确显示“积分已校验，导出计划尚未校验”，不再冒充完整服务端校验。
9. 背景控件已消除嵌套 `label`。
10. ChatPanel 测试已升级为真实 React 集成契约：渲染 ChatPanel、点击 Skill 目录与“多平台批量导出”，验证真实抽屉；375px 验证单列、纵向滚动和 DOM 不溢出。Simple Chat 目录隔离保持。

### 复审后验证

```text
Task7 四项计划测试：4 文件，22/22 通过
Task7 + history/useSkillRun/canvas placement/ChatPanel 回归：12 文件，127/127 通过
pnpm ts-check：退出码 0
目标 ESLint --quiet：退出码 0
```

本轮仍未执行云端真实导出与多浏览器视觉验收；不把这些项标记为通过。

## 第二轮 NEEDS_FIXES 修复

### 修复内容

1. 新增规范导出请求指纹，固定绑定 `projectId`、来源 AssetVersion 顺序、目标平台、适配方式、背景和命名模板。只有指纹与当前表单完全一致时，服务端 estimate 和 `validatedExportPlan` 才能显示；任一字段变化立即回到“尚未校验”。
2. 底部工具栏发生 `bottom` 过渡时，通过 `transitionrun` 启动逐帧测量，并在对应的 `transitionend` / `transitioncancel` 后停止及最终测量；组件卸载时移除监听并取消 rAF。无关属性结束不会提前终止位置跟随，未复制 300ms 或工具栏偏移魔法数。
3. 来源版本不在当前画布时，抽屉使用当前 `projectId + sourceVersionId` 调用授权 `/api/assets`。成功后显示来源预览和“查看来源版本”操作；无权访问、已删除或非图片结果进入统一 UI 错误边界。
4. `cancelled`、`timeout` 且没有输出时不再误报“结果数据损坏或版本不兼容”；只有应当携带结果的 `completed`，以及携带损坏输出的 `failed` 才显示该错误。
5. 375px 契约不再使用 jsdom 中恒真的 `0 <= 0`。测试现在验证真实响应式结构：抽屉视口宽度约束、单列基础网格、`md`/`xl` 扩展、各区 `min-w-0` 和纵向滚动。
6. 因生产 `chat-panel.tsx` 的 estimate 路径被本轮直接修改，按 Task7 简报仅更新了对应旧字符串断言；Simple Chat 目录隔离和其他 ChatPanel 功能保持不变。

### TDD 证据

首轮 RED：

```text
pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx src/__tests__/lib/canvas-toolbar-layout.test.ts src/__tests__/components/chat-panel-multi-platform-export.test.tsx --reporter=dot
4 个测试文件：3 failed / 1 passed
29 项测试：7 failed / 22 passed
```

失败点分别为：请求指纹函数不存在、旧 estimate 未失效、取消/超时误报损坏、来源预览和异步错误边界缺失、工具栏过渡帧跟踪不存在。

过渡细化 RED：

```text
pnpm exec vitest run src/__tests__/lib/canvas-toolbar-layout.test.ts --reporter=dot
1 个测试文件失败
6 项测试：1 failed / 5 passed
```

该失败证明无关属性的 `transitionend` 会提前停止 bottom 位置跟踪；实现按属性过滤后转为 GREEN。

### 最终验证

Task7 四项计划测试：

```text
pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx src/__tests__/components/chat-panel-multi-platform-export.test.tsx src/__tests__/components/chat-panel-skill-runtime.test.tsx --reporter=dot
4 个测试文件通过
29/29 项测试通过
```

Task7、ChatPanel、Run History、useSkillRun 交互契约和画布 placement 回归：

```text
17 个测试文件通过
159/159 项测试通过
```

静态门禁：

```text
pnpm ts-check：退出码 0
Task7 目标 ESLint --quiet：退出码 0
git diff --check -- <Task7 本轮生产文件与测试文件>：退出码 0
```

`eslint` 仅输出 `infinite-canvas.tsx` 超过 500KB 的 Babel deoptimised 提示，没有 lint error。全工作树中 3 个受保护 SDD 文件仍有任务开始前既存的 EOF 空行提示；这些文件未被本任务修改、暂存或提交。

### 验证边界

- 本轮未执行真实 375px 浏览器视觉验收、云端 Coze 导出或 Chromium/Firefox/WebKit 截图，因此这些项目仍明确为未验证。
- 仅在 `main` 当前工作区修复；没有创建分支，没有触碰 `stable`，没有 push，也没有 amend。

## Task7 最终竞态修复

### 修复内容

1. 校验开始时冻结请求 A 的规范指纹；await 返回后与 `useLayoutEffect` 同步的最新请求指纹比较。若用户期间已改为请求 B，A 的成功、部分成功或失败响应均不得覆盖 B 的“尚未校验”状态。
2. estimate 和服务端导出计划仍只由与当前规范请求指纹匹配的数据派生，来源、平台、适配、背景或命名变化继续立即失效旧结果。
3. 每次开始查看新来源版本时先清空旧预览。来源 B 查询失败后只显示 B 的错误，不继续展示来源 A。

### TDD 证据

RED 命令：

```text
pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx --reporter=dot
2 个测试文件失败
24 项测试：2 failed / 22 passed
```

两个失败分别稳定证明：请求 A 飞行中切换到 B 后仍未回到“尚未校验”；开始查询来源 B 时来源 A 预览仍然存在。

最小实现后专项 GREEN：

```text
pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx --reporter=dot
2 个测试文件通过
24/24 项测试通过
```

### 最终验证

Task7 四项计划测试：

```text
pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx src/__tests__/components/chat-panel-multi-platform-export.test.tsx src/__tests__/components/chat-panel-skill-runtime.test.tsx --reporter=dot
4 个测试文件通过
31/31 项测试通过
```

Task7、drawer/results、ChatPanel、Run History、useSkillRun 与画布 placement 相关回归：

```text
17 个测试文件通过
161/161 项测试通过
```

静态门禁：

```text
pnpm ts-check：退出码 0
Task7 本轮目标 ESLint --quiet：退出码 0
git diff --check -- <本轮 4 个生产/测试文件>：退出码 0
```

目标 ESLint 曾在 GREEN 后识别出 render 阶段写 ref 的 React 19 违规；已改为 `useLayoutEffect` 同步最新指纹，并重新执行上述全部测试和静态门禁。真实浏览器验收仍不在本轮范围内，不标记为已验证。

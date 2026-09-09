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

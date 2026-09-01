# 精修面板取消与视口可靠性设计

## 1. 背景

2026-09-01 在 Coze 独立测试项目的 Google Chrome 预览页中，使用普通用户 `canvas-user`、APImart `gpt-image-2` 完成真实取消测试，稳定复现以下问题：

1. 在 `2048 × 935` 视口中，精修面板位于 `y=177.5–972.4`，底部“开始精修”按钮位于 `y=915.6–959.6`，按钮下半部分超出视口。自动或真实点击可能落到画布，导致面板关闭而没有提交任务。
2. 面板在提交请求尚未返回任务 ID 时已经显示“取消”。用户此时点击取消，前端只清除本地处理状态，没有调用 `/api/cancel-task`。
3. 提交响应随后返回任务 `refine-1788227589826-lkryvv`，前端继续轮询，供应商任务完成并展示结果。
4. 积分从 `4794` 降至 `4782`，产生 `-12` 的“精修: 取消链路验证”流水，没有退款记录。
5. 非标准错误响应会被记录到 Console，但结果页只显示“暂无精修结果”，用户无法看到真实错误。

真实测试证据位于：

- `.playwright-cli/refine-cancel-cloud-20260901-race/evidence.json`
- `.playwright-cli/refine-cancel-cloud-20260901-race/credits-after-fake-cancel.png`

V5.8.8 只读参考版本与当前版本的 `refine-engine-panel.tsx` 归一化内容一致，因此不能直接从 V5.8.8 吸收修复。本批次属于当前 `main` 的稳定性修复，不改变 V5.8.8 只读规则。

## 2. 目标

1. 精修面板在桌面和移动视口中完整可操作，标题栏与底部操作区始终可达。
2. 用户在任务 ID 返回前点击取消时，取消意图不会丢失；任务 ID 返回后只调用一次取消接口。
3. 取消接口确认成功前，不显示“已取消”。
4. 已确认取消的任务不得继续轮询、展示迟到结果或重复结算。
5. 取消失败时显示真实原因，并继续跟踪任务真实终态，不能制造假取消。
6. 提交失败或异常响应必须显示可理解的真实错误，不能退化为“暂无精修结果”。
7. 保持现有模型选择、提示词、精修参数、结果添加画布和后端任务结算行为不变。

## 3. 非目标与保护边界

本批次不修改：

- `stable` 分支及 V5.8.8 参考目录。
- 精修提示词、模型能力、供应商选择或降级策略。
- 登录、权限、数据库结构、积分计算规则和全局账务实现。
- `/api/refine-engine`、`/api/poll-task` 与 `/api/cancel-task` 的既有协议。
- 其他画布工具面板的行为和样式。

后端现有 `createRefineTask`、`terminateCloudTaskAndRefund`、条件式终态转换及迟到完成拒绝逻辑保持不变。本批次通过前端正确调用现有取消协议闭环真实用户路径。

## 4. 方案

采用已批准的方案 A：在精修面板内建立显式运行阶段和取消意图闭环，同时复用纯函数处理浮窗位置。

### 4.1 运行阶段

面板使用以下明确阶段：

```text
idle
submitting
processing
cancelling
completed
failed
cancelled
```

不再只用一个 `isProcessing` 布尔值表达提交、运行和取消。

每次开始精修时创建新的运行令牌，并重置：

- 当前应用任务 ID
- 取消意图
- 取消请求 Promise
- 轮询计时器和轮询次数
- 上一轮错误与结果

异步回调必须核对运行令牌；旧运行的响应不得覆盖新运行或已取消终态。

### 4.2 提交阶段取消

当阶段为 `submitting` 且任务 ID 尚未返回时：

1. 用户点击取消后记录 `cancelRequested=true`。
2. 阶段切换为 `cancelling`，界面显示“正在确认任务并取消…”。
3. 不停止提交请求，不提前显示“已取消”，也不开始新的供应商任务。
4. 提交响应返回任务 ID 后，立即调用一次 `/api/cancel-task`。
5. 取消成功后清除轮询计时器、使当前运行令牌失效，并进入 `cancelled`。
6. 取消失败时显示接口返回的真实错误，恢复为 `processing` 并继续轮询真实终态。

这样可以避免中止浏览器请求后丢失已被服务器接收的任务 ID，也避免同一取消意图发送多次取消请求。

### 4.3 处理中取消

当阶段为 `processing` 且已有任务 ID 时：

1. 立即进入 `cancelling`。
2. 对同一任务只创建一个取消请求 Promise。
3. 取消成功才进入 `cancelled`。
4. HTTP 409 或其他失败不得显示“已取消”；界面显示“取消失败，正在确认任务状态”，随后继续轮询。

### 4.4 轮询和迟到结果

- 每轮只允许存在一个轮询计时器。
- 轮询前后都核对运行令牌和当前阶段。
- `cancelled`、`failed`、`completed` 均为前端终态，不再安排轮询。
- 已确认取消后到达的 processing/completed 响应被忽略，不写入结果、不添加画布。
- 正常 completed 路径保持现有结果解析与画布添加能力。

### 4.5 错误呈现

增加纯错误提取函数，按以下顺序读取服务端错误：

1. `error`
2. `message`
3. `BaseResp.StatusMessage`
4. HTTP 状态对应的回退文案

提交、取消和轮询失败都进入明确的错误状态。结果页显示错误标题、真实错误内容和“返回精修设置”按钮；不能显示“暂无精修结果”来掩盖失败。

### 4.6 浮窗视口约束

扩展 `src/lib/floating-panel-position.ts`，增加纯函数：

```ts
constrainFloatingPanelPosition(input: {
  x: number;
  y: number;
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}): { x: number; y: number }
```

精修面板遵循以下规则：

- 外边距固定为 `16px`。
- 宽度为 `min(460px, viewportWidth - 32px)`。
- 最大高度为 `viewportHeight - 32px`。
- 首次挂载后使用实际 DOM 尺寸居中并约束位置。
- 拖动过程中约束 `x/y`，不允许标题栏或底部操作区移出视口。
- 浏览器尺寸变化时重新约束当前位置。
- 内容区独立滚动，标题栏、标签栏和底部操作区保持可见。

## 5. 文件边界

计划修改：

- `src/components/refine-engine-panel.tsx`
  - 显式运行阶段、取消意图、单次取消、运行令牌、错误状态和视口约束接入。
- `src/lib/floating-panel-position.ts`
  - 新增通用纯位置约束函数。
- `src/__tests__/components/refine-engine-panel-lifecycle.test.tsx`
  - 新增精修提交、取消、失败和迟到结果行为测试。
- `src/__tests__/lib/floating-panel-position.test.ts`
  - 增加精修尺寸对应的桌面、窄屏、拖动和窗口变化边界测试。

不修改后端路由和账务模块，除非 RED 测试证明现有取消协议无法满足本设计；若出现该情况，必须停止并重新确认边界，不能顺手扩大范围。

## 6. 自动化验收

必须先看到以下测试在当前代码上按预期失败：

1. 提交响应延迟时点击取消，响应返回任务 ID 后恰好调用一次 `/api/cancel-task`。
2. 上述场景不调用 `/api/poll-task`，不显示结果。
3. 取消接口成功前不显示“任务已取消”。
4. 取消接口失败时显示真实原因并继续确认任务状态。
5. 已取消运行收到迟到 completed 响应时不展示结果。
6. `BaseResp.StatusMessage` 能作为用户可见错误显示。
7. `2048 × 935`、`1366 × 768`、`768 × 600`、`320 × 568` 下，面板和底部按钮均位于 16px 安全边界内。
8. 拖动到四个边缘及窗口缩小时，面板会被重新约束。

GREEN 后执行：

```bash
pnpm exec vitest run src/__tests__/components/refine-engine-panel-lifecycle.test.tsx src/__tests__/lib/floating-panel-position.test.ts src/__tests__/api/refine-async-terminal-contract.test.ts src/__tests__/api/cancel-task.test.ts
pnpm ts-check
pnpm lint
pnpm test
pnpm build
pnpm check:protected-baseline
```

## 7. 云端验收

只在 `main` 推送并由 Coze 独立测试项目拉取后执行：

1. 强制刷新现有 Google Chrome 预览页，不新建标签页，不进入 360 浏览器。
2. 在无需手动拖动的情况下确认“开始精修”完整可见。
3. 使用 APImart 或 Pear 稳定模型提交一项精修任务。
4. 在任务 ID 返回前点击取消。
5. 网络证据必须显示一个 `/api/refine-engine` 和恰好一个 `/api/cancel-task`，不能继续轮询。
6. UI 必须显示服务端确认的取消状态，不能随后出现精修结果。
7. 积分流水必须出现一次扣费和一次对应退款，余额恢复；重复刷新不得重复退款。
8. 追加验证任务 ID 返回后的正常取消，结果同样只退款一次并拒绝迟到完成。
9. Console 不得出现未处理异常；失败证据、截图和网络响应写入测试报告。

任何一项未取得真实证据时只能标记为“未验证”或“不通过”，不能宣布完成。


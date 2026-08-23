# V588-SAFETY-001 WASM SVG 描摹像素预算规格

## 状态

- 日期：2026-08-23
- 目标分支：`main`
- 当前权威实现：当前仓库 `src/app/api/svg-trace/route.ts`
- 只读参考：`J:/无界云端0820` 与归档 `wujie-one-month-repair-upgrade-files-2026-08-22.tar.gz`
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 始终只读

## 问题

当前彩色 SVG 描摹在 AI 管线失败或返回不可用结果后，会进入本地 VTracer 路径。`preprocessForVTracer()` 为质量考虑允许长边最高约 4096 像素，随后 `runWasmVTracer()` 将整张图片解码成 RGBA，并在 Node.js 请求线程同步调用 `convertImageToSvg()`。

同步 WASM 调用没有可中断超时。大图可能长时间占用事件循环，拖慢甚至阻塞同一进程中的登录、画布保存、任务查询和其他 API。Python VTracer 使用子进程且有超时，不属于本次风险边界。

## 设计结论

采用“仅限制同步 WASM fallback”的最小方案：

1. 新增 `src/app/api/svg-trace/wasm-budget.ts`，提供不依赖 Sharp、路由或运行时状态的纯函数。
2. 默认预算固定为 `512 * 512 = 262,144` 像素。
3. 输入像素数未超过预算时保持原尺寸；超过预算时按面积比例等比缩小，宽高最小为 1 像素。
4. `runWasmVTracer()` 在解码 raw RGBA 之前读取图片尺寸、计算预算，并仅对传给 WASM 的图片执行一次 `sharp.resize()`。
5. `convertImageToSvg()` 必须只接收预算后的宽、高和像素数组。
6. Recraft/管理员矢量模型、VLM、Python VTracer、ImageTracer、Potrace、源图保存与前端画布尺寸语义均保持现状。

## 为什么不采用其他方案

### 全链路统一缩图

拒绝。它会同时降低管理员矢量模型、VLM 和 Python VTracer 的输入质量，把稳定性修复扩大成可见画质回归。

### 本轮迁移到 Worker 或任务队列

拒绝。Worker 隔离是后续架构优化方向，但会改变任务生命周期、部署构建和错误处理，超出本次选择性吸收边界。像素预算可以先消除已知的最坏阻塞风险。

### 整体复制 V5.8.8 SVG 路由

拒绝。donor 路由包含与当前线路不同的供应商、认证、质量预设和 fallback 行为，整文件覆盖会破坏当前已验证能力。

## 纯函数契约

`computeWasmTraceBudget(width, height, maxPixels?)` 返回：

```ts
{
  scale: number;
  width: number;
  height: number;
}
```

- 非有限值、0、负数和小于 1 的尺寸归一化为 1。
- `maxPixels` 必须归一化为至少 1 的有限整数，避免调用方传入非法预算后产生 `NaN` 或无限尺寸。
- 当 `width * height <= maxPixels` 时，`scale === 1` 且尺寸不变。
- 超预算时，使用 `sqrt(maxPixels / pixels)` 计算缩放比例。
- 取整后结果必须再次保证 `width * height <= maxPixels`。如果四舍五入导致超出预算，应收紧较长边，不能把近边界结果交给 WASM。
- 纵横比在整数像素允许范围内保持稳定。

## 测试与验收

必须先建立 RED，证明当前仓库缺少预算保护，然后最小接入：

1. `256x256` 不缩放。
2. `512x512` 边界不缩放。
3. `2048x2048` 缩为 `512x512`。
4. `1024x512` 保持约 2:1，且面积不超过预算。
5. 极端长条图、非法尺寸和非法自定义预算均返回有限、正整数尺寸。
6. 近预算非方图经取整后仍不得超预算。
7. 源码契约证明预算发生在 `convertImageToSvg()` 之前，且没有改动其他引擎输入。
8. 聚焦测试、TypeScript、ESLint、全量 Vitest、生产构建和保护门禁全部通过。
9. 推送 `main` 前后确认 `origin/stable` SHA 不变。
10. Coze 拉取 exact SHA 后，在 Google Chrome 现有标签页验证：大图 SVG 描摹请求期间首页或健康接口仍可响应；任务得到成功结果或明确失败，不能永久加载；Console、网络和服务端日志没有未处理异常。

## 非目标

- 不承诺本轮消除同步 WASM 的全部事件循环占用。
- 不修改 SVG 输出路径数量、颜色预设或质量等级。
- 不修改积分、退款、任务注册或前端 SVG 面板。
- 不吸收 donor 的其他认证、PSD、供应商、移动端、媒体网关或协作改动。

## 回滚边界

本项只有独立纯函数、路由内一次预算调用和专项测试。若云端出现可复现画质或兼容性回归，可单独回滚该提交，不影响 V588-UI-004 与之前 Stage 4 成果。

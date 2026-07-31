# 无界 AI 横竖重组 v1.0.0 开发文档

## 1. 功能定义

“横竖重组”是内容比例调整与元素重排能力，目标是把已有图片中的主体、产品、文字、品牌标识、装饰和信息层级重新组织到用户选择的新画幅内。

它不是扩图、Outpainting、补边、填充背景或裁切：

- 不向画布外新增内容；
- 不用留白或纯色边框伪造目标比例；
- 不以裁掉原内容的方式完成比例变换；
- 原图保持不变，结果作为新图片添加到原图右侧。

支持比例：`9:16`、`3:4`、`4:5`、`1:1`、`4:3`、`16:9`。面板会根据原图方向给出默认推荐，但用户始终可以手动选择目标比例。

## 2. 用户流程

1. 在无限画布选中一张图片。
2. 打开图片浮动工具栏中的“横竖重组”。该按钮默认紧邻“美陈拆解”。
3. 在六个比例中手动选择目标比例。
4. 点击“按目标比例开始重组”。
5. 画布右侧创建处理中占位框，原图不覆盖。
6. 任务完成后，结果图片替换占位框，并保留编辑关系元数据。
7. 结果含可识别文字时，前端提示需要人工复核。

## 3. 架构与文件

| 文件 | 作用 |
| --- | --- |
| `src/lib/aspect-recompose.ts` | 比例白名单、比例解析、方向推荐、尺寸校验、重组提示词构建 |
| `src/app/api/aspect-recompose/route.ts` | 提交异步任务，调用视觉分析和现有图像生成链路，校验结果比例并最多重试一次 |
| `src/components/aspect-recompose-panel.tsx` | 六比例手动选择浮动面板 |
| `src/components/infinite-canvas.tsx` | 工具栏入口、占位框、轮询、结果插入和原图保护 |
| `src/lib/task-registry.ts` | 注册 `aspect-recompose` 任务类型 |
| `src/app/api/poll-task/route.ts` | 返回本地重组任务状态、结果、目标比例和校验信息 |
| `scripts/verify-aspect-recompose.ts` | 无模型凭据的契约验证 |

## 4. 服务端流程

```text
POST /api/aspect-recompose
  -> registerTask(aspect-recompose)
  -> /api/vision-prompt 分析主体、文字、元素和布局
  -> buildAspectRecomposePrompt()
  -> /api/generate(referenceImages + target aspectRatio)
  -> 兼容同步 imageUrl 或异步 taskId
  -> /api/poll-task 轮询上游图像任务
  -> sharp 读取输出尺寸
  -> 1% 比例误差校验
  -> 失败时使用校验反馈重试 1 次
  -> completed / failed
```

服务端复用当前项目的模型、供应商配置、API 兼容层、任务注册中心和任务轮询接口，不硬编码供应商或 API Key。

## 5. API 契约

### 请求

`POST /api/aspect-recompose`

```json
{
  "imageUrl": "https://.../source.png",
  "targetRatio": "9:16",
  "model": "可选，当前画布图像模型",
  "providerId": "可选，当前供应商 ID"
}
```

`targetRatio` 必须来自比例白名单。缺少图片地址或比例非法时返回 `400`。

### 提交响应

```json
{
  "success": true,
  "taskId": "aspect-recompose-...",
  "status": "processing",
  "targetRatio": "9:16",
  "maxRetries": 1
}
```

前端使用现有 `pollForResult()` 查询 `/api/poll-task`。完成结果中包含：

```json
{
  "imageUrl": "https://.../result.png",
  "targetRatio": "9:16",
  "validation": {
    "valid": true,
    "expected": 0.5625,
    "actual": 0.5625,
    "error": 0
  },
  "retryCount": 0,
  "requiresManualReview": true
}
```

## 6. 原图保护与文字保真

保护策略分三层：

1. **语义分析**：先调用视觉识别，提取文字、主体、产品外观、品牌标识、装饰和布局摘要。
2. **约束提示词**：明确要求内容重排、禁止新主体和新文案、文字逐字保持、颜色与品牌信息保持一致。
3. **结果校验**：使用 Sharp 检查最终像素尺寸与目标比例，误差超过 1% 时自动再生成一次。

这能显著提高原图内容保持率，但不能承诺生成模型对文字做到像素级或逐字 100% 一致。尤其是小字号、复杂字体、弯曲文字和低清原图，仍需人工检查；检测到文字时结果标记 `requiresManualReview: true`。

当前版本不做独立的生成后 OCR/视觉逐项比对，因此文档和 UI 不宣称“文字绝对不变”。后续可增加生成后 OCR 对照、品牌 Logo 感知哈希和人工确认门禁。

## 7. 错误与重试

- 视觉分析失败：使用保守的“保留全部可见内容”分析继续生成。
- 图像模型同步返回：直接校验结果。
- 图像模型异步返回：内部轮询现有任务接口，最长约 9 分钟。
- 目标比例校验失败：带误差反馈重新生成一次。
- 二次校验仍失败：任务失败，不插入不符合比例的结果。
- 原图和处理中占位框保留，便于用户重试或删除失败占位框。

## 8. 运行前提

- 已配置至少一个可用的图像生成模型；
- 该模型支持参考图/图生图或等价的参考图片输入；
- 当前用户具备项目既有的图像生成权限；
- `sharp`、Next.js、React 和项目锁定的 pnpm 依赖已安装；
- 视觉分析模型不可用时仍可走保守分析，但文字保护能力会下降。

## 9. 验证与 QA

无凭据契约测试：

```bash
pnpm exec tsx scripts/verify-aspect-recompose.ts
```

定向代码检查：

```bash
pnpm exec eslint src/lib/aspect-recompose.ts src/app/api/aspect-recompose/route.ts src/components/aspect-recompose-panel.tsx scripts/verify-aspect-recompose.ts
```

手工验收至少覆盖：

- 横图选择 `9:16`；
- 竖图选择 `16:9`；
- 方图选择 `1:1`；
- 六个比例均可手动点击；
- 原图未被覆盖，结果位于右侧；
- 处理进度和失败状态可见；
- 带标题、Logo、价格、按钮文字的海报人工复核；
- 上游同步和异步两种返回方式；
- 比例异常时自动重试一次后正确失败。

## 10. 安全与数据边界

升级包不包含 `.env`、`.env.local`、API Key、数据库连接串、用户图片或模型权重。所有供应商凭据继续由现有管理员配置和环境变量管理。接口仍使用当前应用的用户解析和任务体系，不新增公开的密钥入口。

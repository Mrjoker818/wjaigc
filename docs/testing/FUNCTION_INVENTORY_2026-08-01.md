# 无界 AI 功能盘点与审计范围（2026-08-01）

## 审计基线

| 项目 | 值 |
| --- | --- |
| Git 仓库 | `Mrjoker818/wjaigc` |
| 分支 | `main` |
| Git Commit | `36607f28963f30adc611509e315d104f1b78b805` |
| Commit 时间 | 2026-08-01 12:24:28 +08:00 |
| 云端预览 | `https://c3b2eda1-b7a7-4067-bc55-3cfb9c675bd9-5000.dev.coze.site/` |
| 扣子项目页 | `https://code.coze.cn/p/7633105031805370404/preview` |
| 审计原则 | 先检测、保存证据、统一修复；本轮不改业务代码 |

`origin/main` 已在审计开始后重新 fetch，并与本地 HEAD 完全一致。工作区中仅有 `.playwright-cli/`、`output/` 两个未跟踪的历史测试输出目录，未纳入代码基线。

## 技术架构

| 层级 | 当前实现 |
| --- | --- |
| Web 框架 | Next.js 16.2.10 App Router，React 19.2.3，TypeScript 5 |
| UI | Tailwind CSS 4、shadcn/Radix、Lucide、Konva/react-konva、Three.js/react-three-fiber |
| 服务端 | Next Route Handlers，任务注册中心、SSE/轮询兼容、异步任务与取消 |
| 数据库 | PostgreSQL（`pg`、Drizzle）；管理员、用户、项目、积分、任务、操作日志配置均依赖数据库 |
| 文件与结果 | 本地/受控上传路径、S3 持久化回退、Sharp、PSD/SVG/ZIP 处理 |
| 模型适配 | OpenAI 兼容、Gemini、Responses API、第三方适配档案、提供商动态配置 |
| 图像工具 | 本地 IOPaint/RemoveBG/LaMa、Upscayl、Sharp、VTracer/Potrace、Pear 图层 PSD/ZIP |
| AI 功能 | 文生图、图生图、语言修图、Agent 工具调用、聊天、提示词优化、视觉识别、工作流 |
| 安全与权限 | Cookie/session 鉴权、内部 API 鉴权、用户模型授权、输入 URL 校验、积分扣除/退款、操作日志 |
| 测试体系 | Vitest、Playwright（Chromium/Firefox/WebKit）、`doctor`、ESLint、`ts-check`、构建 |

静态规模：184 个 API Route、142 个 React/TSX 组件文件、261 个 Vitest 测试文件、10 个 Playwright E2E 规格文件。

测试基础设施补充：Playwright 当前定义 Chromium、1920×1080 Chromium、Firefox、WebKit 四个**桌面**项目；没有移动端设备项目。`pnpm exec playwright test --list` 在当前基线枚举 10 个规格文件、140 条跨项目用例。其覆盖存在有效用例与“仅检查页面未崩溃”的弱断言混合问题，详细见 `BUG_REGISTER_2026-08-01.md` 的 AUD-014 至 AUD-016；不得依据用例数量推断功能已真实通过。

## 产品功能矩阵

状态定义：

- `已通过`：本轮或本基线有真实可复核证据。
- `已失败`：已复现实际错误并保存证据。
- `已打开`：入口和前端面板已出现，但尚未完成真实后端闭环。
- `受阻`：云端运行实例失联，无法对该项作真实业务结论。
- `待测`：尚未进入本轮真实验证。

| 功能域 | 用户可见功能 | 主要入口/组件 | 主要 API/依赖 | 当前审计状态 |
| --- | --- | --- | --- | --- |
| 登录与会话 | 登录、注册、退出、当前用户、密码修改、connector 登录 | `dashboard/login-panel.tsx`、`simple-chat/login.tsx` | `/api/auth/*`、`/api/session`、`/api/user/change-password` | 受阻：本次云端 API 实例缺失，不能重新完成真实登录回归 |
| 首页与入口 | 工作台、无限画布、智能对话、项目数据、用户管理、提示词模板、主题切换 | `page.tsx`、`canvas-workspace.tsx`、`dashboard/*` | session、announcement、user-data | 已打开；后端相关数据读取受阻 |
| 无限画布 | 选择、平移、缩放、框选、多选、拖动、尺寸调整、删除、撤销/重做、右键菜单、缩放复位、图层、版本历史、连线 | `infinite-canvas.tsx`、`layer-panel.tsx`、`version-history-panel.tsx` | project/user-data、task-events | 已打开；保存/恢复受阻 |
| 图片输入 | 文件上传、拖入、粘贴、恢复图片、缓存图片、参考图、图片预览、下载 | `infinite-canvas.tsx`、`image-preview.tsx` | `/api/upload`、`/api/save-image`、`/api/recover-images`、`/api/serve-upload/*` | 受阻：未在本次失联实例上做上传闭环 |
| 图像生成 | 快速创作、专业创作、AI 矢量、提示词、模型、比例、尺寸、质量、数量、参考图、任务状态、取消、结果进画布 | `generation-panel.tsx`、`quick-create-panel.tsx`、`canvas-generation-group.ts` | `/api/generate`、`/api/poll-task`、`/api/task-events`、`/api/cancel-task` | 已失败：真实 `/api/generate` 返回 Coze `instance_not_found` 404 |
| 图像模型能力 | 每模型比例、尺寸档位、质量档位、数量、图生图能力 | `canvas-generation-group.ts`、`model-capabilities.ts`、`api-compatibility.ts` | 动态管理员模型配置、供应商文档 | 部分通过：Pear Nano Banana 2 Lite 的 UI 选项已按模型收窄；端到端提交受阻 |
| 图生图与编辑 | 图生图、语言修图、Agent 编排、擦除、蒙版、扩展、裁切、调色、横竖重组、全景生成 | `image-editor.tsx`、`agent-editor.tsx`、`infinite-canvas.tsx` | `/api/edit`、`/api/image-edit`、`/api/image/color-adjust`、`/api/aspect-recompose` | 待测/受阻 |
| 图片工具栏 | 放大、移除背景、SVG 智能描摹、元素拆解、横竖重组、擦除、蒙版、调色、编辑元素、多角度、图转 3D、扩展、裁切、全景、精修、人物精修、语言修图、Agent、下载 | `infinite-canvas.tsx` | image/edit/3D/segment/refine/human/export API | 已盘点 19 项；已确认工具栏白名单含“横竖重组”；真实执行受阻 |
| 放大与超分 | 302 Super-Upscale V2、Upscale V6、Image Upscale、ESRGAN，本地/云端放大 | `UpscaleDialog`、`302-upscale-models.ts` | `/api/image/upscale`、`/api/image/upscale-pro`、`/api/upscayl` | 待测；静态可见 4 个 302 原生模型定义 |
| 去背景 | AI/本地 RemoveBG、透明 PNG 与蒙版、后处理 | `image-edit`、`remove-bg-postprocess` | `/api/image-edit`、本地 Python/IOPaint | 待测 |
| 元素拆解与图层 | 普通元素分层、双输出、美陈拆解、Pear PSD/ZIP 分层、图层编辑、重建校验 | `layer-decomposition/*`、`display3d-panel.tsx` | `/api/element-decompose`、`/api/layered-decompose`、`/api/design/layer-split`、`/api/display-3d/decompose` | 待测；Pear ZIP/PSD 兼容链已静态确认存在 |
| SVG 与 AI 矢量 | Recraft 矢量生成、图生矢量、风格、探索、编辑器、保存到画布、下载 | `vector-design/*`、`svg-trace` | `/api/vector-design`、`/api/design/vectorize`、`/api/svg-trace` | 已通过：真实 Recraft V4.1 生成、编辑器展示并保存到画布 |
| 聊天与提示词 | 画布聊天、Agent 模式、Skills、提示词大师、图像引用、Tune、快捷指令、模型切换、聊天历史 | `chat-panel.tsx`、`oh-my-prompt.tsx` | `/api/chat`、`/api/chat-tasks`、`/api/optimize-prompt` | 已失败：真实 `/api/chat` 返回 Coze `instance_not_found` 404 |
| 独立智能对话 | 对话、文件、全局搜索、记忆、模型比较、提示词优化、分享、报告导出、使用统计 | `/simple-chat`、`components/simple-chat/*` | `/api/simple-chat/*` | 待测；当前云端核心实例故障阻断 |
| ChatCanvas 批注 | C 键入口、点选/框选/画笔、批注浮动输入栏、进度、目标解析、执行与导出 | `canvas-annotation.ts`、`annotations/*` | `/api/annotations/resolve-target`、`/api/annotations/execute` | 待测 |
| 节点模式与工作流 | 节点编辑、连线、AI 建图、执行、保存、模型、素材库、ComfyUI 导入、工作流中心 | `node-editor.tsx`、`workflow-hub.tsx` | `/api/workflow/*` | 待测/受阻 |
| 图转 3D | 图片转 3D、自动多视角、Meshi 流、后处理、模型查看器、代理下载 | `model-viewer-3d.tsx` | `/api/image-to-3d/*`、`/api/poll-3d-task`、`/api/proxy-3d-model` | 已打开（历史证据）；真实完成待测 |
| 视频与音频 | 视频生成、导演诊断、分镜、延长、提帧、下载、视频编辑、音频生成/播放器 | `video-generation-panel.tsx`、`video-edit-panel.tsx`、`audio-generation-panel.tsx` | `/api/video/*`、`/api/audio/generate` | 已打开（历史证据）；真实任务待测 |
| 精修能力 | 精修引擎、人物精修大师、人物分析/选择/修复与任务进度 | `refine-engine-panel.tsx`、`human-repair-panel.tsx` | `/api/refine-engine`、`/api/human/*` | 已打开（历史证据）；真实任务待测 |
| 品牌与设计 | 品牌电商、品牌工厂、品牌 IP、品牌资产、品牌套件、Logo Pro、包装 Pro、3D 构图、展陈 Pro、活动现场 | `brand-*`、`logo-skill-panel.tsx`、`display3d-panel.tsx` | `/api/brand-*`、`/api/logo-skill`、`/api/display-3d/*`、`/api/activity-venue/*` | 待测/受阻 |
| 字境与文档 | 字境大师、字图生成、PDF/PPT/Word/Excel/思维导图/流程图 | `font-design-panel.tsx` | `/api/font-design/*`、`/api/pdf/*`、`/api/ppt/*`、`/api/word/*`、`/api/excel/*`、`/api/mindmap/*`、`/api/flowchart/*` | 待测 |
| PSD 与导出 | AI PSD 创建/状态/结果、PSD 图层编辑、导出 PNG/SVG/PSD/PDF/BOM/项目 | `ai-psd/*`、`psd-editor/*` | `/api/ai-psd/*`、`/api/export/*` | 待测 |
| 项目与资源 | 项目数据、收藏、素材、资源、文件夹、分享、下载、备份、桌面客户端 | `project-data-panel.tsx`、`favorites-panel.tsx` | project/user-data/favorites/resources/desktop APIs | 已失败：项目同步 API 404；其余待测 |
| 积分与支付 | 积分余额、模型定价、充值、支付配置、通知、二维码、订单、退款结算 | `user-credits-tab.tsx`、admin recharge | `/api/credits/*`、`/api/admin/credits/*` | 待测/受阻 |
| 管理后台 | 仪表盘、用户、分组、API 提供商、提供商全测、余额、任务、审计、日志、设置、资源、备份、生产就绪 | `dashboard/*`、`admin-tabs.tsx` | `/api/admin/*` | 待测/受阻 |
| 稳定性与监控 | health、diagnostics、客户端错误、操作审计、任务恢复、队列、SSE、取消 | `task-registry.ts`、`operation-audit.ts` | `/api/diag/*`、`/api/diagnostics/export`、`/api/client-error`、`/api/tasks/recover` | 部分已验证：浏览器捕获到真实操作日志请求；服务端实例失联 |

## 当前云端图像模型目录（浮动图像生成器）

当前会话从真实下拉框读取到 20 个图像模型：

1. Gpt Image 2（FHL 图像模型）
2. Gpt Image 2（AI Link 图像）
3. Gpt Image 2 C（4SAPI 图像）
4. 豆包即梦 4.0（PearAPI 图像）
5. 豆包即梦 4.5（PearAPI 图像）
6. 豆包即梦 5.0（PearAPI 图像）
7. Gpt Image 2（PearAPI 图像）
8. Gpt Image 2 4K（PearAPI 图像）
9. Nano Banana 2 4K（PearAPI 图像）
10. Nano Banana 2 Lite（PearAPI 图像）
11. Nano Banana Pro 4K（PearAPI 图像）
12. 豆包即梦 5.0 Lite（APIMart）
13. 豆包即梦 5.0 Pro（APIMart）
14. Nano Banana（APIMart）
15. Nano Banana Pro（APIMart）
16. Nano Banana 2（APIMart）
17. Nano Banana 2 Lite（APIMart）
18. Gpt Image 2（APIMart）
19. Gpt Image 2 Official（APIMart）
20. Midjourney（APIMart）

已执行的模型能力 UI 对照：

| 模型 | 真实界面观察 |
| --- | --- |
| PearAPI Nano Banana 2 Lite | 切换后比例收窄到 `1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3`，分辨率只保留 `1K`。 |
| 4SAPI Gpt Image 2 C | 界面显示 15 种比例、`1K/2K/4K`、`auto/low/medium/high`。端到端请求因云端实例 404 未进入供应商。 |

## API Route 清单

以下为当前 `src/app/api` 中的全部 184 个 Route。该清单用于保证后续接口测试不遗漏任何已暴露端点。

```text
/activity
/activity-venue/analyze
/activity-venue/lock-design
/activity-venue/proposals
/activity-venue/qc
/admin/api-balance
/admin/apis
/admin/audit
/admin/backups
/admin/backups/[id]
/admin/backups/[id]/download
/admin/cloud-tasks
/admin/credits/overview
/admin/credits/pricing
/admin/credits/recharge
/admin/dashboard-stats
/admin/desktop-devices
/admin/desktop-update
/admin/groups
/admin/local-generation-records
/admin/op-log
/admin/production-readiness
/admin/resources
/admin/settings
/admin/test-all-providers
/admin/user-folder
/admin/user-images
/admin/users
/agent-edit
/ai-psd/create
/ai-psd/result
/ai-psd/status
/analyze
/analyze-psd
/annotations/execute
/annotations/resolve-target
/announcement
/artifacts
/aspect-recompose
/audio/generate
/auth/login
/auth/logout
/auth/me
/auth/register
/brand-assets
/brand-ecommerce
/brand-factory
/brand-ip/generate
/brand-ip/projects
/brand-ip/strategy
/brand-ip/tasks
/brand-kit
/brand-packaging/generate
/brand-packaging/tasks
/cache-image
/cancel-task
/chat
/chat-tasks
/client-error
/connector/auth/login
/connector/auth/me
/creative/health
/creative/illustrator
/creative/photoshop
/creative/templates
/credits
/credits/payment-config
/credits/payment-notify
/credits/payment-qr
/credits/payment-status
/credits/pay-redirect
/dcc/health
/dcc/preflight
/dcc/templates
/design/layer-split
/design/vectorize
/desktop/backup/download/[id]
/desktop/backup/list
/desktop/backup/upload
/desktop/config
/desktop/device/heartbeat
/desktop/generation-records
/desktop/login
/desktop/resources
/desktop/update
/desktop/update/download/[id]
/diag/storage
/diagnostics/export
/display-3d/decompose
/display-3d/generate
/ecom-templates
/edit
/element-decompose
/excel/generate
/export/annotation-image
/export/bom
/export/pdf
/export/to-canvas
/export-project
/favorites
/flowchart/generate
/font-design/gallery
/font-design/gallery-image
/font-design/generate-image
/font-design/plan
/font-design/prompt
/generate
/help-image
/human/analyze
/human/repair
/human/select
/human/task/[id]
/image/color-adjust
/image/health
/image/start-services
/image/upscale
/image/upscale-pro
/image-edit
/image-to-3d
/image-to-3d/auto-multi-view
/image-to-3d/meshy-stream
/image-to-3d/poll-post-process
/image-to-3d/post-process
/knowledge/extract-text
/layered-decompose
/logo-skill
/mindmap/generate
/models
/omp-agent
/omp-resources
/optimize-prompt
/pdf/generate
/poll-3d-task
/poll-task
/ppt/generate
/ppt/template/upload
/proxy-3d-model
/quick-create/compile
/recharge/[orderId]
/recover-images
/refine-engine
/save-image
/scene-studio
/scene-studio/generate
/segment-elements
/serve-upload/[...path]
/session
/simple-chat/chat
/simple-chat/deep-research
/simple-chat/memory
/simple-chat/share
/simple-chat/share/[shareId]
/simple-chat/upload-file
/story-assets/plan
/svg-convert
/svg-trace
/task-events
/tasks/recover
/test-provider-connection
/universal-discover
/universal-generate
/upload
/upscayl
/user/change-password
/user-data/record
/user-data/sync
/vector-design
/verify-protocol
/video/director/diagnose
/video/director/prompt
/video/director/shot-plan
/video/download
/video/extend
/video/extract-frame
/video/extract-frames
/video/generate
/video/tools
/vision-prompt
/wasm/vtracer
/word/generate
/workflow/ai-build
/workflow/execute
/workflow/models
/workflow/save
```

## 真实浏览器证据索引

所有证据都位于本仓库，未包含 Cookie、密码、API Key 或用户私密文件：

```text
test-results/screenshots/audit-2026-08-01/
test-results/network/audit-2026-08-01-core-api-404.json
test-results/network/audit-2026-08-01-canvas-chat-404.json
test-results/console/audit-2026-08-01-pear-nano-banana-lite.json
```

# 无界AI — 功能盘点矩阵

> 版本: v3.8.0 | 扫描时间: 2026-07-20 | Git Commit: $(git rev-parse --short HEAD)

---

## 一、技术架构

| 层级 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| 前端框架 | Next.js (App Router) | 16.2.10 | React SSR/SSG + API Routes |
| UI 库 | React | 19.2.3 | 函数组件 + Hooks |
| 组件库 | shadcn/ui (Radix UI) | — | 40+ 封装组件 |
| 样式 | Tailwind CSS | 4.x | 原子化 CSS + 语义变量 |
| 语言 | TypeScript | 5.x | 严格模式 |
| 数据库 | PostgreSQL | — | 通过 PGDATABASE_URL 连接 |
| ORM/驱动 | pg (node-postgres) | — | 原生连接池，无 ORM |
| 对象存储 | S3 兼容 (可选) | — | 用于图片/视频持久化 |
| 登录鉴权 | JWT (jose) | — | httpOnly Cookie, 7天过期 |
| 状态管理 | React useState/useRef | — | 无外部状态库 |
| 任务队列 | task-registry (内存) | — | Map + 并发限制 + SSE推送 |
| 实时通信 | SSE (Server-Sent Events) | — | /api/task-events 任务进度推送 |
| AI模型调用 | api-compatibility.ts | — | 通用 OpenAI 兼容适配层 |
| 视频协议 | video-api.ts | — | 6种协议适配器，20+模型 |
| 图像生成 | DALL-E 3 / Flux / SD / Seedream | — | 管理员配置，30+模型 |
| 视频生成 | 可灵V3 / Seedance / Vidu / Sora | — | 管理员配置，20+模型 |
| 3D生成 | Hunyuan3D / Meshy / Tripo / Rodin | — | 4提供商 |
| 部署方式 | Next.js 生产构建 | — | coze build / coze start |
| 日志系统 | op-log.ts → wujie_audit_log 表 | — | DB持久化 + AI分析 |
| 错误监控 | console.log + app.log | — | /app/work/logs/bypass/ |
| 支付/积分 | credits 系统 | — | 充值/消费/管理员定价 |
| 文件上传 | /api/upload + /api/save-image | — | 前端压缩 + 后端 sharp |
| 图片保存链 | persistImageBuffer 三级fallback | — | S3 → save-image → base64 |

## 二、环境变量清单

| 变量名 | 必需 | 用途 | 当前状态 |
|--------|------|------|---------|
| PGDATABASE_URL / DATABASE_URL | ✅ | PostgreSQL 连接串 | 已配置 |
| COZE_WORKSPACE_PATH | ✅ | 工作目录 | 沙箱预置 |
| DEPLOY_RUN_PORT | ✅ | 服务端口 | 沙箱预置 |
| COZE_PROJECT_DOMAIN_DEFAULT | ✅ | 对外域名 | 沙箱预置 |
| COZE_PROJECT_ENV | ✅ | 环境标识 (DEV/PROD) | 沙箱预置 |
| AUTH_SECRET | ⚠️ | JWT 签名密钥 | 未配置时使用默认值(警告) |
| APIMART_API_KEY | ❌ | APImart 备用 Key | 优先管理员后台配置 |
| GEMINI_API_KEY | ❌ | Gemini 备用 Key | 优先管理员后台配置 |
| PY_VECTORIZE_ENDPOINT | ❌ | VTracer/StarVector 端点 | 未配置时使用本地 fallback |
| LOCAL_AI_ENABLED | ❌ | 本地 AI 工具开关 | 开发环境默认 true |
| IOPAINT_BASE_URL | ❌ | IOPaint 服务地址 | 默认 http://127.0.0.1:8080 |
| IMAGE_MAX_SIZE_MB | ❌ | 上传大小限制 | 默认 20MB |
| IMAGE_MAX_EDGE | ❌ | 图片最大边长 | 默认 2048 |
| UPSCAYL_MODELS_DIR | ❌ | 放大模型目录 | 默认 ./upscayl-models |

## 三、数据库表清单

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| wujie_users | 用户账号 | id, name, password_hash, role, status, api_permissions, email |
| wujie_api_providers | API 提供商配置 | id, name, base_url, api_key, model_type, selected_models |
| wujie_user_data | 用户项目/画布数据 | user_id, data_key, data_value (联合主键) |
| wujie_system_settings | 系统设置 | key, value |
| wujie_audit_log | 操作日志 | id, user_id, action, level, error_message, duration_ms, model, resolution_status |
| cloud_tasks | 云端任务持久化 | task_id, user_id, type, status, progress, result, credits |

## 四、功能矩阵

### 4.1 认证与用户

| # | 功能 | 入口 | 路由/组件 | 后端接口 | 数据表 | 自动化测试 | 风险等级 |
|---|------|------|----------|---------|--------|-----------|---------|
| 1 | 用户登录 | 登录页 | page.tsx → LoginDialog | POST /api/auth/login | wujie_users | ✅ E2E+API | 低 |
| 2 | 用户退出 | 侧边栏 | page.tsx → UserManager | POST /api/auth/logout | — | ✅ E2E+API | 低 |
| 3 | 会话检查 | 自动 | page.tsx → useEffect | GET /api/session | wujie_users | ✅ E2E+API | 低 |
| 4 | 当前用户 | 自动 | page.tsx → UserManager | GET /api/auth/me | wujie_users | ✅ API | 低 |
| 5 | 用户管理(管理员) | 管理员面板 | admin-tabs.tsx | GET/POST /api/admin/users | wujie_users | ✅ API(403) | 低 |
| 6 | 权限控制 | 全局中间件 | server-auth.ts | requireApiAuthOrReject | wujie_users | ✅ API(401) | 低 |

### 4.2 无限画布

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 7 | 画布渲染 | 首页 | infinite-canvas.tsx | — | ✅ E2E | 低 |
| 8 | 图片选择(单选/多选/框选) | 画布 | infinite-canvas.tsx | — | ✅ E2E | 低 |
| 9 | 图片拖拽移动 | 画布 | infinite-canvas.tsx | — | ✅ E2E | 低 |
| 10 | 图片缩放(四角等比) | 画布 | infinite-canvas.tsx | — | ⚠️ 未验证 | 中 |
| 11 | 画布平移(空格/长按) | 画布 | infinite-canvas.tsx | — | ✅ E2E | 低 |
| 12 | 画布缩放(滚轮) | 画布 | infinite-canvas.tsx | — | ✅ E2E | 低 |
| 13 | 删除选中图片 | 画布 | infinite-canvas.tsx (Delete键) | — | ✅ E2E | 低 |
| 14 | 撤销/重做(Ctrl+Z) | 画布 | infinite-canvas.tsx | — | ⚠️ 未验证 | 中 |
| 15 | 右键菜单 | 画布 | infinite-canvas.tsx | — | ✅ E2E | 低 |
| 16 | 图层面板 | 画布 | layer-panel.tsx | — | ⚠️ 未验证 | 中 |
| 17 | 节点连线 | 画布 | infinite-canvas.tsx | — | ⚠️ 未验证 | 中 |
| 18 | 重置视图 | 画布工具栏 | infinite-canvas.tsx | — | ⚠️ 未验证 | 低 |
| 19 | 版本历史 | 画布 | version-history-panel.tsx | — | ⚠️ 未验证 | 中 |
| 20 | 100节点压力 | 画布 | infinite-canvas.tsx | — | ❌ 未测试 | 高 |

### 4.3 图片上传与管理

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 21 | 点击上传 | 工具栏 | infinite-canvas.tsx | POST /api/upload | ⚠️ 未验证 | 中 |
| 22 | 拖入上传 | 画布 | infinite-canvas.tsx (drag-drop) | POST /api/upload | ⚠️ 未验证 | 中 |
| 23 | 粘贴上传 | 画布 | infinite-canvas.tsx (Ctrl+V) | POST /api/upload | ⚠️ 未验证 | 中 |
| 24 | 图片压缩 | 前端 | image-compress.ts | — | ⚠️ 未验证 | 低 |
| 25 | 保存图片到服务器 | 自动 | — | POST /api/save-image | ✅ API | 低 |
| 26 | 提供上传文件 | 自动 | — | GET /api/serve-upload/[...path] | ✅ API(路径穿越) | 低 |
| 27 | 项目保存 | 自动(2s防抖) | page.tsx | POST /api/user-data/sync | ✅ API | 低 |
| 28 | 项目恢复 | 自动 | page.tsx | GET /api/user-data/sync | ✅ API | 低 |

### 4.4 图像生成

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 29 | 文生图 | 生成面板 | generation-panel.tsx | POST /api/generate | ✅ E2E+API | 低 |
| 30 | 图生图 | 画布工具栏 | infinite-canvas.tsx (img2img) | POST /api/generate | ⚠️ 未验证 | 中 |
| 31 | 模型选择 | 生成面板 | generation-panel.tsx | GET /api/models | ✅ E2E+API | 低 |
| 32 | 比例选择 | 生成面板 | generation-panel.tsx | — | ✅ E2E | 低 |
| 33 | 数量选择 | 生成面板 | generation-panel.tsx | — | ✅ E2E | 低 |
| 34 | 参考图上传 | 生成面板 | generation-panel.tsx | POST /api/upload | ⚠️ 未验证 | 中 |
| 35 | 任务轮询 | 前端自动 | infinite-canvas.tsx | POST /api/poll-task | ✅ API | 低 |
| 36 | SSE任务推送 | 前端自动 | task-events-client.ts | GET /api/task-events | ⚠️ 未验证 | 中 |
| 37 | 任务取消 | 画布processing框 | infinite-canvas.tsx | POST /api/cancel-task | ✅ API | 低 |
| 38 | 提示词优化 | 聊天面板 | chat-panel.tsx | POST /api/optimize-prompt | ⚠️ 未验证 | 低 |
| 39 | 图片识词 | 画布 | infinite-canvas.tsx | POST /api/vision-prompt | ⚠️ 未验证 | 低 |

### 4.5 AI 聊天

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 40 | AI 对话 | 聊天面板 | chat-panel.tsx | POST /api/chat | ✅ E2E | 低 |
| 41 | 图像理解 | 聊天面板 | chat-panel.tsx (多模态) | POST /api/chat | ⚠️ 未验证 | 中 |
| 42 | Skills 系统 | 聊天面板 | chat-panel.tsx | — | ⚠️ 未验证 | 低 |
| 43 | @引用系统 | 聊天面板 | chat-panel.tsx (@菜单) | — | ⚠️ 未验证 | 低 |
| 44 | Tab模式 | 聊天面板 | chat-panel.tsx (选中图片) | — | ⚠️ 未验证 | 低 |
| 45 | 生成后引导 | 聊天面板 | chat-panel.tsx | — | ⚠️ 未验证 | 低 |

### 4.6 图片编辑工具

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 46 | 语言修图 | 画布右键/工具栏 | image-editor.tsx | POST /api/edit | ⚠️ 未验证 | 中 |
| 47 | 擦除(涂抹消除) | 画布工具栏 | infinite-canvas.tsx (erase) | POST /api/image-edit | ⚠️ 未验证 | 中 |
| 48 | 蒙版修图 | 画布工具栏 | infinite-canvas.tsx (mask) | POST /api/image-edit | ⚠️ 未验证 | 中 |
| 49 | 无损放大 | 画布工具栏 | infinite-canvas.tsx (upscale) | POST /api/image/upscale | ⚠️ 未验证 | 中 |
| 50 | 无损放大Pro | 画布工具栏 | infinite-canvas.tsx | POST /api/image/upscale-pro | ⚠️ 未验证 | 中 |
| 51 | 移除背景 | 画布工具栏 | infinite-canvas.tsx | POST /api/image-edit (removebg) | ⚠️ 未验证 | 中 |
| 52 | 扩展画面 | 画布工具栏 | infinite-canvas.tsx (extend) | POST /api/image-edit | ⚠️ 未验证 | 中 |
| 53 | 裁切 | 画布工具栏 | infinite-canvas.tsx (crop) | — | ⚠️ 未验证 | 低 |
| 54 | SVG智能描摹 | 画布工具栏 | infinite-canvas.tsx | POST /api/svg-trace | ⚠️ 未验证 | 中 |
| 55 | 元素分层 | 画布工具栏 | infinite-canvas.tsx | POST /api/segment-elements | ⚠️ 未验证 | 中 |
| 56 | Agent编排编辑 | 画布工具栏 | agent-editor.tsx | POST /api/agent-edit | ⚠️ 未验证 | 中 |

### 4.7 视频生成与编辑

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 57 | 文生视频 | 视频面板 | video-generation-panel.tsx | POST /api/video/generate | ⚠️ 未验证 | 高 |
| 58 | 图生视频 | 视频面板 | video-generation-panel.tsx | POST /api/video/generate | ⚠️ 未验证 | 高 |
| 59 | 首尾帧视频 | 视频面板 | video-generation-panel.tsx | POST /api/video/generate | ⚠️ 未验证 | 高 |
| 60 | 多参考图视频 | 视频面板 | video-generation-panel.tsx | POST /api/video/generate | ⚠️ 未验证 | 高 |
| 61 | 视频延长 | 视频编辑面板 | video-edit-panel.tsx | POST /api/video/extend | ⚠️ 未验证 | 高 |
| 62 | 视频播放 | 画布 | video-player.tsx | — | ⚠️ 未验证 | 低 |
| 63 | AI导演增强 | 视频面板 | video-generation-panel.tsx | POST /api/video/director/prompt | ⚠️ 未验证 | 中 |
| 64 | AI分镜 | 视频面板 | video-generation-panel.tsx | POST /api/video/director/shot-plan | ⚠️ 未验证 | 中 |
| 65 | 视频抽帧 | 视频面板 | — | POST /api/video/extract-frame | ⚠️ 未验证 | 中 |
| 66 | 视频编辑(语言) | 视频编辑面板 | video-edit-panel.tsx | POST /api/video/generate (edit) | ⚠️ 未验证 | 高 |
| 67 | 运动笔刷 | 视频面板 | motion-brush-canvas.tsx | — | ⚠️ 未验证 | 中 |

### 4.8 3D 模型

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 68 | 单图转3D | 画布弹窗 | infinite-canvas.tsx (3D) | POST /api/image-to-3d | ⚠️ 未验证 | 高 |
| 69 | 多图转3D | 画布弹窗 | infinite-canvas.tsx (3D多图) | POST /api/image-to-3d | ⚠️ 未验证 | 高 |
| 70 | 文生3D | 画布弹窗 | infinite-canvas.tsx (3D文字) | POST /api/image-to-3d | ⚠️ 未验证 | 高 |
| 71 | 自动多视角 | 画布弹窗 | infinite-canvas.tsx | POST /api/image-to-3d/auto-multi-view | ⚠️ 未验证 | 高 |
| 72 | 3D预览器 | 3D结果 | model-viewer-3d.tsx | — | ⚠️ 未验证 | 中 |
| 73 | 3D后处理 | 3D预览器 | model-viewer-3d.tsx | POST /api/image-to-3d/post-process | ⚠️ 未验证 | 高 |
| 74 | 3D模型下载 | 3D预览器 | model-viewer-3d.tsx | — | ⚠️ 未验证 | 低 |

### 4.9 业务模块面板

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 75 | 字境大师Pro | 侧边栏 | font-design-panel.tsx | POST /api/font-design/* | ⚠️ 未验证 | 中 |
| 76 | 品牌电商 | 侧边栏 | brand-ecommerce-panel.tsx | POST /api/brand-ecommerce | ⚠️ 未验证 | 中 |
| 77 | 品牌工厂 | 侧边栏 | brand-factory-panel.tsx | POST /api/brand-factory | ⚠️ 未验证 | 中 |
| 78 | 精修引擎 | 侧边栏 | refine-engine-panel.tsx | POST /api/refine-engine | ⚠️ 未验证 | 中 |
| 79 | 人物精修 | 侧边栏 | human-repair-panel.tsx | POST /api/human/repair | ⚠️ 未验证 | 中 |
| 80 | Logo Pro | 侧边栏 | logo-skill-panel.tsx | POST /api/logo-skill | ⚠️ 未验证 | 中 |
| 81 | 3D构图 | 侧边栏 | scene-studio-panel.tsx | POST /api/scene-studio/generate | ⚠️ 未验证 | 中 |
| 82 | 包装Pro | 侧边栏 | brand-packaging-panel.tsx | POST /api/brand-packaging/generate | ⚠️ 未验证 | 中 |
| 83 | 展陈Pro | 侧边栏 | display3d-panel.tsx | POST /api/display-3d/generate | ⚠️ 未验证 | 中 |
| 84 | AI PSD | 侧边栏 | — | POST /api/ai-psd/create | ⚠️ 未验证 | 中 |
| 85 | 表情助手 | 侧边栏 | sticker-assistant-panel.tsx | POST /api/generate | ⚠️ 未验证 | 中 |
| 86 | 音频生成 | 侧边栏 | audio-generation-panel.tsx | POST /api/audio/generate | ⚠️ 未验证 | 中 |
| 87 | ChatCanvas | 聊天面板 | chat-panel.tsx | — | ⚠️ 未验证 | 低 |
| 88 | 收藏夹 | 侧边栏 | favorites-panel.tsx | GET/POST /api/favorites | ⚠️ 未验证 | 低 |
| 89 | 工作流节点 | 节点模式 | node-editor.tsx | POST /api/workflow/execute | ⚠️ 未验证 | 高 |
| 90 | AI自然语言建图 | 节点编辑器 | node-editor.tsx | POST /api/workflow/ai-build | ⚠️ 未验证 | 中 |

### 4.10 下载与导出

| # | 功能 | 入口 | 组件/库 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|--------|---------|-----------|---------|
| 91 | 下载PNG | 画布右键/工具栏 | infinite-canvas.tsx | — | ⚠️ 未验证 | 低 |
| 92 | 下载SVG | 画布右键 | infinite-canvas.tsx | POST /api/svg-trace | ⚠️ 未验证 | 低 |
| 93 | 下载PSD | 画布右键 | infinite-canvas.tsx → psd-export.ts | — | ⚠️ 未验证 | 中 |
| 94 | 下载3D模型 | 3D预览器 | model-viewer-3d.tsx | — | ⚠️ 未验证 | 低 |
| 95 | 下载视频 | 视频播放器 | video-player.tsx | — | ⚠️ 未验证 | 低 |

### 4.11 管理员系统

| # | 功能 | 入口 | 组件 | 后端接口 | 自动化测试 | 风险等级 |
|---|------|------|------|---------|-----------|---------|
| 96 | API提供商管理 | 管理员面板 | admin-tabs.tsx | GET/POST /api/admin/apis | ✅ API(403) | 低 |
| 97 | 用户管理 | 管理员面板 | admin-tabs.tsx | GET/POST /api/admin/users | ✅ API(403) | 低 |
| 98 | 操作日志 | 管理员面板 | admin-tabs.tsx (op-log) | GET/POST /api/admin/op-log | ✅ API(403) | 低 |
| 99 | 系统设置 | 管理员面板 | admin-tabs.tsx | GET/POST /api/admin/settings | ✅ API(403) | 低 |
| 100 | API余额分析 | 管理员面板 | admin-tabs.tsx | GET /api/admin/api-balance | ⚠️ 未验证 | 低 |
| 101 | 协议验证 | 管理员面板 | admin-tabs.tsx | POST /api/verify-protocol | ⚠️ 未验证 | 低 |
| 102 | 积分管理 | 管理员面板 | admin-tabs.tsx (credits) | GET/POST /api/admin/credits/* | ⚠️ 未验证 | 中 |
| 103 | 公告管理 | 管理员面板 | admin-tabs.tsx | GET/POST /api/announcement | ⚠️ 未验证 | 低 |

## 五、统计摘要

| 类别 | 功能数 | 已自动化测试 | 未验证 | 风险高 |
|------|--------|------------|--------|--------|
| 认证与用户 | 6 | 6 ✅ | 0 | 0 |
| 无限画布 | 14 | 8 | 6 ⚠️ | 1 |
| 图片上传 | 8 | 4 | 4 ⚠️ | 0 |
| 图像生成 | 11 | 6 | 5 ⚠️ | 0 |
| AI聊天 | 6 | 1 | 5 ⚠️ | 0 |
| 图片编辑 | 11 | 0 | 11 ⚠️ | 0 |
| 视频生成 | 11 | 0 | 11 ⚠️ | 5 |
| 3D模型 | 7 | 0 | 7 ⚠️ | 3 |
| 业务模块 | 16 | 0 | 16 ⚠️ | 1 |
| 下载导出 | 5 | 0 | 5 ⚠️ | 0 |
| 管理员 | 8 | 4 | 4 ⚠️ | 0 |
| **合计** | **103** | **29 (28%)** | **74 (72%)** | **10** |

> **说明**: "已自动化测试"指有对应的 E2E 或 API 测试用例覆盖。"未验证"指功能存在但尚无自动化测试覆盖，不表示功能不可用。

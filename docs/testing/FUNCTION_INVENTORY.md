# 无界AI功能盘点

- 生成时间：2026-07-19T12:55:17.727Z
- Git Commit：`47c1056`
- 软件版本：`2.5.0`
- 工作目录：`J:\无界本地版\projects\_upstream-wjaigc-restore`
- 盘点方法：源码路由、页面入口、组件、数据存储和依赖静态扫描；“已定位”不代表已通过真实验证。

## 架构

| 领域 | 现状 | 证据 |
| --- | --- | --- |
| 前端/后端 | Next.js 16.2.10 App Router + React 19.2.3 + TypeScript | `src/app`、`src/components` |
| UI/状态 | Tailwind 4、shadcn/Radix；React Hooks、localStorage、BroadcastChannel、用户数据同步 | `src/components`、`src/app/page.tsx` |
| 数据库 | PostgreSQL（`pg`），`DATABASE_URL`/`PGDATABASE_URL` | `src/lib/db-client.ts`、`src/lib/db-storage.ts` |
| 对象存储/上传 | S3兼容对象存储优先，服务器本地文件回退 | `src/app/api/upload/route.ts`、`src/app/api/save-image/route.ts` |
| 身份鉴权 | 签名 HTTP-only cookie `wujie_session`，7天会话 | `src/lib/server-auth.ts`、`/api/auth/*` |
| AI调用层 | 多提供商兼容层，OpenAI/Gemini兼容及管理员模型配置 | `src/lib/api-compatibility.ts`、`src/app/api/generate/route.ts` |
| 异步任务 | 内存/云端任务注册、SSE推送，轮询回退、取消和恢复 | `src/lib/task-registry.ts`、`/api/task-events` |
| 部署 | Coze云端/容器化；端口和域名由环境变量控制 | `Dockerfile`、`docker-compose.yml`、`.coze*` |
| 日志/监控 | 操作审计、数据库审计；未发现Sentry依赖。GitHub Actions质量门禁已配置，但云端真实P0依赖仓库环境密钥 | `src/components/operation-audit-client.tsx`、`src/app/api/admin/audit`、`.github/workflows/quality.yml` |
| 积分/支付 | 积分、充值订单、支付二维码/回调接口 | `/api/credits/*`、`wujie_recharge_orders` |

## 数据与关键依赖

主要表/逻辑存储：`wujie_users`、`wujie_api_providers`、`wujie_user_data`、`wujie_system_settings`、`wujie_recharge_orders`、`wujie_brand_assets`、`wujie_user_groups`及积分、审计和任务关联数据。关键环境变量包括数据库连接、认证/内部/支付密钥、对象存储配置、管理员账户、模型提供商密钥和本地AI工具配置；详细可执行检查由 `npm run doctor` 输出。

## 功能矩阵

| 功能 | 入口 | 路由 | 前端组件/逻辑 | 后端接口 | 数据表/状态 | 外部依赖 | 当前状态 | 风险 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 登录/退出/会话 | 首页登录页、用户菜单 | / | src/app/page.tsx; src/lib/server-auth.ts | /api/auth/login, /logout, /me | wujie_users | PostgreSQL/Cookie | 已定位，P0真实测试待执行 | P0 |
| 自助注册 | 未发现用户入口 | 未发现独立页面 | 未发现注册组件 | 未发现 `/api/auth/register` | 管理员创建用户 | PostgreSQL | 未实现或未暴露，需产品确认 | P1 |
| Token刷新/访问控制 | 全局路由/API中间层 | / | src/lib/server-auth.ts; src/lib/api-auth.ts | 受保护API | wujie_users | Cookie/服务端认证 | 签名会话续期逻辑待真实验证；未发现独立refresh端点 | P0 |
| 项目仪表盘/项目管理 | 登录后首页 | / | src/components/dashboard-view.tsx | /api/user-data/sync, /api/artifacts | wujie_user_data | PostgreSQL | 已定位 | P1 |
| 无限画布 | 首页“无限画布”/项目入口 | / | src/components/infinite-canvas.tsx | /api/user-data/sync | wujie_user_data | 浏览器/对象存储 | 已定位，P0真实测试待执行 | P0 |
| 上传/拖入/粘贴图片 | 底部工具栏/画布 | / | src/components/infinite-canvas.tsx | /api/upload, /api/save-image | wujie_user_data | S3或本地文件 | 已定位，P0真实测试待执行 | P0 |
| 参考图/多参考图 | 生成器“新增参考图” | / | src/components/generation-panel.tsx | /api/upload, /api/generate | 生成器状态 | 对象存储/模型提供商 | 已定位，P1待测 | P1 |
| 画布选择/多选/移动/缩放/删除/复制 | 画布、选择工具、右键菜单 | / | src/components/infinite-canvas.tsx | /api/user-data/sync | wujie_user_data | 浏览器交互 | 已定位，P0真实测试待执行 | P0 |
| 画布平移/重置/图层/版本历史/连线 | 底部工具栏 | / | src/components/infinite-canvas.tsx; src/components/layer-panel.tsx | /api/user-data/sync | wujie_user_data | 浏览器交互 | 已定位，P1待测 | P1 |
| 图像生成 | 左侧生成器 | / | src/components/generation-panel.tsx | /api/generate, /api/poll-task, /api/task-events | 任务注册表/用户数据 | 模型提供商/SSE | 已定位，真实付费生成待授权 | P0 |
| 模型/尺寸/比例/质量/数量 | 图像生成高级设置 | / | src/components/generation-panel.tsx | /api/models, /api/generate | wujie_api_providers | 提供商模型配置 | 已定位，P0真实测试待执行 | P0 |
| 任务状态/取消/恢复 | 生成卡片/画布节点 | / | src/lib/task-events-client.ts | /api/task-events, /api/poll-task, /api/cancel-task, /api/tasks/recover | 云端任务数据 | SSE/轮询 | 已定位，P0真实测试待执行 | P0 |
| 保存/刷新恢复/下载 | 项目工具栏/图片工具栏 | / | src/app/page.tsx; src/lib/db-storage.ts | /api/user-data/sync, /api/export-project | wujie_user_data | PostgreSQL/浏览器下载 | 已定位，P0真实测试待执行 | P0 |
| AI聊天/提示词大师/Skills/Agent | 智能对话页及画布聊天 | /simple-chat, / | src/components/chat-panel.tsx; src/app/simple-chat/page.tsx | /api/chat, /api/optimize-prompt, /api/agent-edit | 用户数据/审计 | LLM提供商 | 已定位，P1待测 | P1 |
| 节点工作流 | 底部工具栏“节点编辑器” | / | src/components/node-editor.tsx | /api/workflow/* | wujie_user_data | 模型提供商/SSE | 已定位，P1待测 | P1 |
| 节点选择/删除/连线/保存恢复 | 节点编辑器 | / | src/components/node-editor.tsx | /api/workflow/save, /api/workflow/execute | wujie_user_data | 浏览器/SSE | 已定位，P1待测 | P1 |
| 图转3D/多角度/六面体 | 图片浮动工具栏/底部工具栏 | / | src/components/model-viewer-3d.tsx; src/components/*3d*.tsx | /api/image-to-3d/*, /api/poll-3d-task | 任务数据 | 3D供应商 | 已定位，P1待测 | P1 |
| 语言修图/擦除/蒙版/扩图/放大/去背景 | 图片浮动工具栏 | / | src/components/image-editor.tsx; src/components/image-editor/* | /api/edit, /api/image-edit, /api/image/* | 任务数据 | 模型提供商/本地AI | 已定位，P1待测 | P1 |
| 人物精修大师 | 图片右键/浮动工具栏/底部工具栏 | / | src/components/human-ai-engine-panel.tsx | /api/human/* | 任务数据 | 人物精修引擎 | 已定位，P1待测 | P1 |
| 品牌电商/品牌工厂/包装Pro/展陈Pro | 底部工具栏 | / | src/components/brand-*.tsx; src/components/display3d-panel.tsx | /api/brand-*, /api/display-3d/* | 品牌资产数据 | 模型提供商 | 已定位，P1待测 | P1 |
| 字境大师/Logo Pro/AI PSD/表情助手/ChatCanvas | 底部工具栏 | / | src/components/font-design-panel.tsx; src/components/*panel.tsx | /api/font-design/*, /api/logo-skill, /api/ai-psd/* | 用户数据 | 模型提供商 | 已定位，P1待测 | P1 |
| 视频生成/编辑/下载 | 视频生成器 | / | src/components/video-generation-panel.tsx | /api/video/* | 任务数据 | 视频提供商 | 已定位，P1待测 | P1 |
| 管理员/API提供商/积分/支付/审计 | 管理员系统 | / | src/components/admin-system.tsx | /api/admin/*, /api/credits/* | provider/credits/audit表 | PostgreSQL/支付网关 | 已定位，P1及安全待测 | P1 |
| AI引擎设置 | 画布底部“AI引擎设置” | / | src/components/ai-engine-settings.tsx | /api/admin/apis, /api/models | wujie_api_providers | 模型提供商 | 已定位，P1待测 | P1 |
| 项目导出/文件下载 | 图片工具栏、项目菜单 | / | src/lib/psd-export.ts; src/lib/svg-export.ts | /api/export-project, /api/export/* | 用户数据/对象存储 | 浏览器下载 | 已定位，P0下载待测 | P0 |

## API路由清单（164项）

| 路由 | 方法 | 源文件 |
| --- | --- | --- |
| `/api/activity` | POST | [src/app/api/activity/route.ts](../../src/app/api/activity/route.ts) |
| `/api/admin/api-balance` | GET, POST | [src/app/api/admin/api-balance/route.ts](../../src/app/api/admin/api-balance/route.ts) |
| `/api/admin/apis` | GET, POST | [src/app/api/admin/apis/route.ts](../../src/app/api/admin/apis/route.ts) |
| `/api/admin/audit` | GET, POST | [src/app/api/admin/audit/route.ts](../../src/app/api/admin/audit/route.ts) |
| `/api/admin/backups` | GET | [src/app/api/admin/backups/route.ts](../../src/app/api/admin/backups/route.ts) |
| `/api/admin/backups/:id` | DELETE | [src/app/api/admin/backups/[id]/route.ts](../../src/app/api/admin/backups/[id]/route.ts) |
| `/api/admin/backups/:id/download` | GET | [src/app/api/admin/backups/[id]/download/route.ts](../../src/app/api/admin/backups/[id]/download/route.ts) |
| `/api/admin/cloud-tasks` | GET | [src/app/api/admin/cloud-tasks/route.ts](../../src/app/api/admin/cloud-tasks/route.ts) |
| `/api/admin/credits/overview` | GET | [src/app/api/admin/credits/overview/route.ts](../../src/app/api/admin/credits/overview/route.ts) |
| `/api/admin/credits/pricing` | GET, POST | [src/app/api/admin/credits/pricing/route.ts](../../src/app/api/admin/credits/pricing/route.ts) |
| `/api/admin/credits/recharge` | POST | [src/app/api/admin/credits/recharge/route.ts](../../src/app/api/admin/credits/recharge/route.ts) |
| `/api/admin/dashboard-stats` | GET | [src/app/api/admin/dashboard-stats/route.ts](../../src/app/api/admin/dashboard-stats/route.ts) |
| `/api/admin/desktop-devices` | GET | [src/app/api/admin/desktop-devices/route.ts](../../src/app/api/admin/desktop-devices/route.ts) |
| `/api/admin/desktop-update` | GET, POST | [src/app/api/admin/desktop-update/route.ts](../../src/app/api/admin/desktop-update/route.ts) |
| `/api/admin/groups` | GET, POST | [src/app/api/admin/groups/route.ts](../../src/app/api/admin/groups/route.ts) |
| `/api/admin/local-generation-records` | GET | [src/app/api/admin/local-generation-records/route.ts](../../src/app/api/admin/local-generation-records/route.ts) |
| `/api/admin/op-log` | GET, POST | [src/app/api/admin/op-log/route.ts](../../src/app/api/admin/op-log/route.ts) |
| `/api/admin/production-readiness` | GET | [src/app/api/admin/production-readiness/route.ts](../../src/app/api/admin/production-readiness/route.ts) |
| `/api/admin/resources` | GET, POST | [src/app/api/admin/resources/route.ts](../../src/app/api/admin/resources/route.ts) |
| `/api/admin/settings` | GET, POST | [src/app/api/admin/settings/route.ts](../../src/app/api/admin/settings/route.ts) |
| `/api/admin/test-all-providers` | GET | [src/app/api/admin/test-all-providers/route.ts](../../src/app/api/admin/test-all-providers/route.ts) |
| `/api/admin/user-folder` | POST | [src/app/api/admin/user-folder/route.ts](../../src/app/api/admin/user-folder/route.ts) |
| `/api/admin/user-images` | GET | [src/app/api/admin/user-images/route.ts](../../src/app/api/admin/user-images/route.ts) |
| `/api/admin/users` | GET, POST | [src/app/api/admin/users/route.ts](../../src/app/api/admin/users/route.ts) |
| `/api/agent-edit` | GET, POST | [src/app/api/agent-edit/route.ts](../../src/app/api/agent-edit/route.ts) |
| `/api/ai-psd/create` | POST | [src/app/api/ai-psd/create/route.ts](../../src/app/api/ai-psd/create/route.ts) |
| `/api/ai-psd/result` | GET | [src/app/api/ai-psd/result/route.ts](../../src/app/api/ai-psd/result/route.ts) |
| `/api/ai-psd/status` | GET | [src/app/api/ai-psd/status/route.ts](../../src/app/api/ai-psd/status/route.ts) |
| `/api/analyze` | POST | [src/app/api/analyze/route.ts](../../src/app/api/analyze/route.ts) |
| `/api/analyze-psd` | POST | [src/app/api/analyze-psd/route.ts](../../src/app/api/analyze-psd/route.ts) |
| `/api/announcement` | GET | [src/app/api/announcement/route.ts](../../src/app/api/announcement/route.ts) |
| `/api/artifacts` | GET, POST, DELETE | [src/app/api/artifacts/route.ts](../../src/app/api/artifacts/route.ts) |
| `/api/audio/generate` | POST | [src/app/api/audio/generate/route.ts](../../src/app/api/audio/generate/route.ts) |
| `/api/auth/login` | POST | [src/app/api/auth/login/route.ts](../../src/app/api/auth/login/route.ts) |
| `/api/auth/logout` | POST | [src/app/api/auth/logout/route.ts](../../src/app/api/auth/logout/route.ts) |
| `/api/auth/me` | GET | [src/app/api/auth/me/route.ts](../../src/app/api/auth/me/route.ts) |
| `/api/brand-assets` | GET, POST | [src/app/api/brand-assets/route.ts](../../src/app/api/brand-assets/route.ts) |
| `/api/brand-ecommerce` | POST | [src/app/api/brand-ecommerce/route.ts](../../src/app/api/brand-ecommerce/route.ts) |
| `/api/brand-factory` | GET, POST | [src/app/api/brand-factory/route.ts](../../src/app/api/brand-factory/route.ts) |
| `/api/brand-kit` | GET, POST | [src/app/api/brand-kit/route.ts](../../src/app/api/brand-kit/route.ts) |
| `/api/brand-packaging/generate` | POST | [src/app/api/brand-packaging/generate/route.ts](../../src/app/api/brand-packaging/generate/route.ts) |
| `/api/brand-packaging/tasks` | GET | [src/app/api/brand-packaging/tasks/route.ts](../../src/app/api/brand-packaging/tasks/route.ts) |
| `/api/cache-image` | POST | [src/app/api/cache-image/route.ts](../../src/app/api/cache-image/route.ts) |
| `/api/cancel-task` | POST | [src/app/api/cancel-task/route.ts](../../src/app/api/cancel-task/route.ts) |
| `/api/chat` | POST | [src/app/api/chat/route.ts](../../src/app/api/chat/route.ts) |
| `/api/chat-tasks` | GET | [src/app/api/chat-tasks/route.ts](../../src/app/api/chat-tasks/route.ts) |
| `/api/connector/auth/login` | POST | [src/app/api/connector/auth/login/route.ts](../../src/app/api/connector/auth/login/route.ts) |
| `/api/connector/auth/me` | GET | [src/app/api/connector/auth/me/route.ts](../../src/app/api/connector/auth/me/route.ts) |
| `/api/creative/health` | GET | [src/app/api/creative/health/route.ts](../../src/app/api/creative/health/route.ts) |
| `/api/creative/illustrator` | POST | [src/app/api/creative/illustrator/route.ts](../../src/app/api/creative/illustrator/route.ts) |
| `/api/creative/photoshop` | POST | [src/app/api/creative/photoshop/route.ts](../../src/app/api/creative/photoshop/route.ts) |
| `/api/creative/templates` | GET | [src/app/api/creative/templates/route.ts](../../src/app/api/creative/templates/route.ts) |
| `/api/credits` | GET, POST | [src/app/api/credits/route.ts](../../src/app/api/credits/route.ts) |
| `/api/credits/pay-redirect` | GET | [src/app/api/credits/pay-redirect/route.ts](../../src/app/api/credits/pay-redirect/route.ts) |
| `/api/credits/payment-config` | GET, POST | [src/app/api/credits/payment-config/route.ts](../../src/app/api/credits/payment-config/route.ts) |
| `/api/credits/payment-notify` | GET, POST | [src/app/api/credits/payment-notify/route.ts](../../src/app/api/credits/payment-notify/route.ts) |
| `/api/credits/payment-qr` | GET | [src/app/api/credits/payment-qr/route.ts](../../src/app/api/credits/payment-qr/route.ts) |
| `/api/credits/payment-status` | GET | [src/app/api/credits/payment-status/route.ts](../../src/app/api/credits/payment-status/route.ts) |
| `/api/dcc/health` | GET | [src/app/api/dcc/health/route.ts](../../src/app/api/dcc/health/route.ts) |
| `/api/dcc/preflight` | GET | [src/app/api/dcc/preflight/route.ts](../../src/app/api/dcc/preflight/route.ts) |
| `/api/dcc/templates` | GET | [src/app/api/dcc/templates/route.ts](../../src/app/api/dcc/templates/route.ts) |
| `/api/design/layer-split` | POST | [src/app/api/design/layer-split/route.ts](../../src/app/api/design/layer-split/route.ts) |
| `/api/design/vectorize` | POST | [src/app/api/design/vectorize/route.ts](../../src/app/api/design/vectorize/route.ts) |
| `/api/desktop/backup/download/:id` | GET | [src/app/api/desktop/backup/download/[id]/route.ts](../../src/app/api/desktop/backup/download/[id]/route.ts) |
| `/api/desktop/backup/list` | GET | [src/app/api/desktop/backup/list/route.ts](../../src/app/api/desktop/backup/list/route.ts) |
| `/api/desktop/backup/upload` | POST | [src/app/api/desktop/backup/upload/route.ts](../../src/app/api/desktop/backup/upload/route.ts) |
| `/api/desktop/config` | GET | [src/app/api/desktop/config/route.ts](../../src/app/api/desktop/config/route.ts) |
| `/api/desktop/device/heartbeat` | POST | [src/app/api/desktop/device/heartbeat/route.ts](../../src/app/api/desktop/device/heartbeat/route.ts) |
| `/api/desktop/generation-records` | POST | [src/app/api/desktop/generation-records/route.ts](../../src/app/api/desktop/generation-records/route.ts) |
| `/api/desktop/login` | POST | [src/app/api/desktop/login/route.ts](../../src/app/api/desktop/login/route.ts) |
| `/api/desktop/resources` | GET | [src/app/api/desktop/resources/route.ts](../../src/app/api/desktop/resources/route.ts) |
| `/api/desktop/update` | GET, POST | [src/app/api/desktop/update/route.ts](../../src/app/api/desktop/update/route.ts) |
| `/api/desktop/update/download/:id` | dynamic | [src/app/api/desktop/update/download/[id]/route.ts](../../src/app/api/desktop/update/download/[id]/route.ts) |
| `/api/diag/storage` | GET | [src/app/api/diag/storage/route.ts](../../src/app/api/diag/storage/route.ts) |
| `/api/diagnostics/export` | GET | [src/app/api/diagnostics/export/route.ts](../../src/app/api/diagnostics/export/route.ts) |
| `/api/display-3d/decompose` | POST | [src/app/api/display-3d/decompose/route.ts](../../src/app/api/display-3d/decompose/route.ts) |
| `/api/display-3d/generate` | POST | [src/app/api/display-3d/generate/route.ts](../../src/app/api/display-3d/generate/route.ts) |
| `/api/ecom-templates` | GET, POST | [src/app/api/ecom-templates/route.ts](../../src/app/api/ecom-templates/route.ts) |
| `/api/edit` | GET, POST | [src/app/api/edit/route.ts](../../src/app/api/edit/route.ts) |
| `/api/excel/generate` | POST | [src/app/api/excel/generate/route.ts](../../src/app/api/excel/generate/route.ts) |
| `/api/export-project` | GET, POST | [src/app/api/export-project/route.ts](../../src/app/api/export-project/route.ts) |
| `/api/export/annotation-image` | POST | [src/app/api/export/annotation-image/route.ts](../../src/app/api/export/annotation-image/route.ts) |
| `/api/export/bom` | POST | [src/app/api/export/bom/route.ts](../../src/app/api/export/bom/route.ts) |
| `/api/export/pdf` | POST | [src/app/api/export/pdf/route.ts](../../src/app/api/export/pdf/route.ts) |
| `/api/export/to-canvas` | POST | [src/app/api/export/to-canvas/route.ts](../../src/app/api/export/to-canvas/route.ts) |
| `/api/favorites` | GET, POST, DELETE | [src/app/api/favorites/route.ts](../../src/app/api/favorites/route.ts) |
| `/api/flowchart/generate` | POST | [src/app/api/flowchart/generate/route.ts](../../src/app/api/flowchart/generate/route.ts) |
| `/api/font-design/gallery` | GET | [src/app/api/font-design/gallery/route.ts](../../src/app/api/font-design/gallery/route.ts) |
| `/api/font-design/gallery-image` | GET | [src/app/api/font-design/gallery-image/route.ts](../../src/app/api/font-design/gallery-image/route.ts) |
| `/api/font-design/generate-image` | POST | [src/app/api/font-design/generate-image/route.ts](../../src/app/api/font-design/generate-image/route.ts) |
| `/api/font-design/plan` | GET, POST | [src/app/api/font-design/plan/route.ts](../../src/app/api/font-design/plan/route.ts) |
| `/api/font-design/prompt` | POST | [src/app/api/font-design/prompt/route.ts](../../src/app/api/font-design/prompt/route.ts) |
| `/api/generate` | POST | [src/app/api/generate/route.ts](../../src/app/api/generate/route.ts) |
| `/api/help-image` | GET | [src/app/api/help-image/route.ts](../../src/app/api/help-image/route.ts) |
| `/api/human/analyze` | POST | [src/app/api/human/analyze/route.ts](../../src/app/api/human/analyze/route.ts) |
| `/api/human/repair` | POST | [src/app/api/human/repair/route.ts](../../src/app/api/human/repair/route.ts) |
| `/api/human/select` | POST | [src/app/api/human/select/route.ts](../../src/app/api/human/select/route.ts) |
| `/api/human/task/:id` | GET | [src/app/api/human/task/[id]/route.ts](../../src/app/api/human/task/[id]/route.ts) |
| `/api/image-edit` | POST | [src/app/api/image-edit/route.ts](../../src/app/api/image-edit/route.ts) |
| `/api/image-to-3d` | POST | [src/app/api/image-to-3d/route.ts](../../src/app/api/image-to-3d/route.ts) |
| `/api/image-to-3d/auto-multi-view` | GET, POST | [src/app/api/image-to-3d/auto-multi-view/route.ts](../../src/app/api/image-to-3d/auto-multi-view/route.ts) |
| `/api/image-to-3d/meshy-stream` | GET | [src/app/api/image-to-3d/meshy-stream/route.ts](../../src/app/api/image-to-3d/meshy-stream/route.ts) |
| `/api/image-to-3d/poll-post-process` | POST | [src/app/api/image-to-3d/poll-post-process/route.ts](../../src/app/api/image-to-3d/poll-post-process/route.ts) |
| `/api/image-to-3d/post-process` | GET, POST | [src/app/api/image-to-3d/post-process/route.ts](../../src/app/api/image-to-3d/post-process/route.ts) |
| `/api/image/color-adjust` | POST | [src/app/api/image/color-adjust/route.ts](../../src/app/api/image/color-adjust/route.ts) |
| `/api/image/health` | GET | [src/app/api/image/health/route.ts](../../src/app/api/image/health/route.ts) |
| `/api/image/start-services` | POST | [src/app/api/image/start-services/route.ts](../../src/app/api/image/start-services/route.ts) |
| `/api/image/upscale` | POST | [src/app/api/image/upscale/route.ts](../../src/app/api/image/upscale/route.ts) |
| `/api/image/upscale-pro` | POST | [src/app/api/image/upscale-pro/route.ts](../../src/app/api/image/upscale-pro/route.ts) |
| `/api/knowledge/extract-text` | POST | [src/app/api/knowledge/extract-text/route.ts](../../src/app/api/knowledge/extract-text/route.ts) |
| `/api/layered-decompose` | GET, POST | [src/app/api/layered-decompose/route.ts](../../src/app/api/layered-decompose/route.ts) |
| `/api/logo-skill` | GET, POST | [src/app/api/logo-skill/route.ts](../../src/app/api/logo-skill/route.ts) |
| `/api/mindmap/generate` | POST | [src/app/api/mindmap/generate/route.ts](../../src/app/api/mindmap/generate/route.ts) |
| `/api/models` | GET | [src/app/api/models/route.ts](../../src/app/api/models/route.ts) |
| `/api/omp-agent` | GET, POST | [src/app/api/omp-agent/route.ts](../../src/app/api/omp-agent/route.ts) |
| `/api/omp-resources` | GET | [src/app/api/omp-resources/route.ts](../../src/app/api/omp-resources/route.ts) |
| `/api/optimize-prompt` | POST | [src/app/api/optimize-prompt/route.ts](../../src/app/api/optimize-prompt/route.ts) |
| `/api/pdf/generate` | POST | [src/app/api/pdf/generate/route.ts](../../src/app/api/pdf/generate/route.ts) |
| `/api/poll-3d-task` | POST | [src/app/api/poll-3d-task/route.ts](../../src/app/api/poll-3d-task/route.ts) |
| `/api/poll-task` | POST | [src/app/api/poll-task/route.ts](../../src/app/api/poll-task/route.ts) |
| `/api/ppt/generate` | POST | [src/app/api/ppt/generate/route.ts](../../src/app/api/ppt/generate/route.ts) |
| `/api/ppt/template/upload` | POST | [src/app/api/ppt/template/upload/route.ts](../../src/app/api/ppt/template/upload/route.ts) |
| `/api/proxy-3d-model` | GET | [src/app/api/proxy-3d-model/route.ts](../../src/app/api/proxy-3d-model/route.ts) |
| `/api/recharge/:orderId` | GET, POST | [src/app/api/recharge/[orderId]/route.ts](../../src/app/api/recharge/[orderId]/route.ts) |
| `/api/recover-images` | GET, POST | [src/app/api/recover-images/route.ts](../../src/app/api/recover-images/route.ts) |
| `/api/refine-engine` | GET, POST | [src/app/api/refine-engine/route.ts](../../src/app/api/refine-engine/route.ts) |
| `/api/save-image` | POST | [src/app/api/save-image/route.ts](../../src/app/api/save-image/route.ts) |
| `/api/scene-studio` | GET, POST | [src/app/api/scene-studio/route.ts](../../src/app/api/scene-studio/route.ts) |
| `/api/scene-studio/generate` | GET, POST | [src/app/api/scene-studio/generate/route.ts](../../src/app/api/scene-studio/generate/route.ts) |
| `/api/segment-elements` | POST | [src/app/api/segment-elements/route.ts](../../src/app/api/segment-elements/route.ts) |
| `/api/serve-upload/:path*` | GET | [src/app/api/serve-upload/[...path]/route.ts](../../src/app/api/serve-upload/[...path]/route.ts) |
| `/api/session` | dynamic | [src/app/api/session/route.ts](../../src/app/api/session/route.ts) |
| `/api/simple-chat/chat` | POST | [src/app/api/simple-chat/chat/route.ts](../../src/app/api/simple-chat/chat/route.ts) |
| `/api/simple-chat/deep-research` | POST | [src/app/api/simple-chat/deep-research/route.ts](../../src/app/api/simple-chat/deep-research/route.ts) |
| `/api/simple-chat/upload-file` | POST | [src/app/api/simple-chat/upload-file/route.ts](../../src/app/api/simple-chat/upload-file/route.ts) |
| `/api/story-assets/plan` | POST | [src/app/api/story-assets/plan/route.ts](../../src/app/api/story-assets/plan/route.ts) |
| `/api/svg-convert` | POST | [src/app/api/svg-convert/route.ts](../../src/app/api/svg-convert/route.ts) |
| `/api/svg-trace` | POST | [src/app/api/svg-trace/route.ts](../../src/app/api/svg-trace/route.ts) |
| `/api/task-events` | GET, POST | [src/app/api/task-events/route.ts](../../src/app/api/task-events/route.ts) |
| `/api/tasks/recover` | GET | [src/app/api/tasks/recover/route.ts](../../src/app/api/tasks/recover/route.ts) |
| `/api/test-provider-connection` | POST | [src/app/api/test-provider-connection/route.ts](../../src/app/api/test-provider-connection/route.ts) |
| `/api/universal-discover` | POST | [src/app/api/universal-discover/route.ts](../../src/app/api/universal-discover/route.ts) |
| `/api/universal-generate` | POST | [src/app/api/universal-generate/route.ts](../../src/app/api/universal-generate/route.ts) |
| `/api/upload` | POST | [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts) |
| `/api/upscayl` | GET, POST | [src/app/api/upscayl/route.ts](../../src/app/api/upscayl/route.ts) |
| `/api/user-data/record` | POST | [src/app/api/user-data/record/route.ts](../../src/app/api/user-data/record/route.ts) |
| `/api/user-data/sync` | GET, POST | [src/app/api/user-data/sync/route.ts](../../src/app/api/user-data/sync/route.ts) |
| `/api/verify-protocol` | POST | [src/app/api/verify-protocol/route.ts](../../src/app/api/verify-protocol/route.ts) |
| `/api/video/director/diagnose` | POST | [src/app/api/video/director/diagnose/route.ts](../../src/app/api/video/director/diagnose/route.ts) |
| `/api/video/director/prompt` | POST | [src/app/api/video/director/prompt/route.ts](../../src/app/api/video/director/prompt/route.ts) |
| `/api/video/director/shot-plan` | POST | [src/app/api/video/director/shot-plan/route.ts](../../src/app/api/video/director/shot-plan/route.ts) |
| `/api/video/download` | GET | [src/app/api/video/download/route.ts](../../src/app/api/video/download/route.ts) |
| `/api/video/extend` | GET, POST | [src/app/api/video/extend/route.ts](../../src/app/api/video/extend/route.ts) |
| `/api/video/extract-frame` | POST | [src/app/api/video/extract-frame/route.ts](../../src/app/api/video/extract-frame/route.ts) |
| `/api/video/extract-frames` | POST | [src/app/api/video/extract-frames/route.ts](../../src/app/api/video/extract-frames/route.ts) |
| `/api/video/generate` | GET, POST | [src/app/api/video/generate/route.ts](../../src/app/api/video/generate/route.ts) |
| `/api/video/tools` | POST | [src/app/api/video/tools/route.ts](../../src/app/api/video/tools/route.ts) |
| `/api/vision-prompt` | POST | [src/app/api/vision-prompt/route.ts](../../src/app/api/vision-prompt/route.ts) |
| `/api/wasm/vtracer` | GET | [src/app/api/wasm/vtracer/route.ts](../../src/app/api/wasm/vtracer/route.ts) |
| `/api/word/generate` | POST | [src/app/api/word/generate/route.ts](../../src/app/api/word/generate/route.ts) |
| `/api/workflow/ai-build` | POST | [src/app/api/workflow/ai-build/route.ts](../../src/app/api/workflow/ai-build/route.ts) |
| `/api/workflow/execute` | POST | [src/app/api/workflow/execute/route.ts](../../src/app/api/workflow/execute/route.ts) |
| `/api/workflow/models` | GET | [src/app/api/workflow/models/route.ts](../../src/app/api/workflow/models/route.ts) |
| `/api/workflow/save` | GET, POST | [src/app/api/workflow/save/route.ts](../../src/app/api/workflow/save/route.ts) |

## 自动化覆盖现状

已有 Vitest 测试位于 `src/__tests__`。本次新增的真实浏览器P0套件位于 `tests/e2e/p0-core.spec.ts`，并配置 Chromium、Firefox、WebKit 和移动 Chromium。当前文件仅描述覆盖设计，测试通过与否以 `docs/testing/REGRESSION_REPORT.md` 和 `test-results/` 中的真实执行证据为准。

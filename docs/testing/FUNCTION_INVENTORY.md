# 无界 AI 功能盘点

- Git Commit：`1aee7df`
- 软件版本：`4.0.0`
- 生成时间：2026-08-08T05:38:57.496Z
- 受保护功能：38 项
- 页面：4 项
- API 路由：186 项
- 组件源码：150 项
- 工作流节点类型：51 项
- Agent 工具：7 项
- 图片浮动工具动作：23 项

> 本报告由显式保护契约和源码静态发现合并生成。入口、组件或路由“已发现”只证明代码存在，不代表真实浏览器、供应商、数据库、积分或云端链路已经通过。

## 受保护功能矩阵

| Feature ID | 产品表面 | 工作区 | 功能 | 入口 | 路由 | 动作 | 产物 | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `identity.session` | identity | — | 登录与会话恢复 | 入口选择页<br>受保护页面自动校验 | /<br>/api/auth/login<br>/api/auth/me<br>/api/session | 登录<br>恢复会话<br>刷新身份 | authenticated-session<br>route-transition | P0 | protected-unverified |
| `identity.logout` | identity | — | 退出登录 | 用户菜单<br>项目仪表盘 | /api/auth/logout | 退出登录<br>清理会话<br>返回入口选择页 | anonymous-session<br>route-transition | P0 | protected-unverified |
| `identity.authorization` | identity | — | 用户权限与数据隔离 | 全部受保护 API<br>管理员入口 | /api/auth/me<br>/api/admin/* | 鉴权<br>角色校验<br>资源归属校验 | authorization-decision<br>audit-event | P0 | protected-unverified |
| `creator.projects` | creator-dashboard | — | 用户项目管理 | 项目仪表盘<br>返回工作台 | /<br>/api/user-data/sync<br>/api/artifacts | 创建项目<br>打开项目<br>删除项目<br>批量删除项目<br>恢复项目 | project-record<br>workspace-navigation | P0 | protected-unverified |
| `creator.assets-templates` | creator-dashboard | — | 模板与资产管理 | 项目仪表盘模板页<br>资产页 | /api/artifacts<br>/api/admin/resources | 浏览模板<br>管理资产<br>导入工作区 | template<br>media-asset | P1 | protected-unverified |
| `creator.credits-settings` | creator-dashboard | — | 用户积分与设置 | 项目仪表盘积分页<br>设置页 | /api/credits<br>/api/credits/payment-config | 查看积分<br>查看订单<br>修改用户设置 | credit-balance<br>user-setting | P0 | protected-unverified |
| `admin.users-groups` | admin-dashboard | — | 用户与分组管理 | 管理员仪表盘用户管理<br>分组管理 | /api/admin/users<br>/api/admin/groups | 新增用户<br>编辑用户<br>批量删除用户<br>分配分组<br>配置模型权限 | user-record<br>group-record<br>audit-event | P0 | protected-unverified |
| `admin.providers-models` | admin-dashboard | — | API 供应商与模型管理 | 管理员仪表盘 API 管理 | /api/admin/apis<br>/api/admin/test-all-providers<br>/api/verify-protocol<br>/api/models | 新增供应商<br>编辑供应商<br>同步模型<br>测试连接<br>授权模型 | provider-config<br>model-catalog<br>connection-test | P0 | protected-unverified |
| `admin.credits-pricing` | admin-dashboard | — | 积分与模型定价管理 | 管理员仪表盘积分管理 | /api/admin/credits/overview<br>/api/admin/credits/pricing<br>/api/admin/credits/recharge | 设置模型积分<br>人工充值<br>查询流水<br>冲正 | pricing-rule<br>credit-transaction | P0 | protected-unverified |
| `admin.payment` | admin-dashboard | — | 支付配置与订单审核 | 管理员仪表盘支付设置<br>充值订单 | /api/credits/payment-config<br>/api/credits<br>/api/recharge/:orderId | 配置收款<br>确认付款<br>驳回订单<br>撤销订单 | payment-config<br>recharge-order<br>credit-transaction | P0 | protected-unverified |
| `admin.audit-operations` | admin-dashboard | — | 操作日志与运行监控 | 管理员仪表盘操作日志<br>云端任务 | /api/admin/audit<br>/api/admin/op-log<br>/api/admin/cloud-tasks<br>/api/admin/dashboard-stats | 筛选日志<br>查看错误<br>查看用户操作<br>查看任务状态 | audit-event<br>task-summary<br>dashboard-metric | P1 | protected-unverified |
| `admin.data-settings` | admin-dashboard | — | 数据管理与系统设置 | 管理员仪表盘数据管理<br>设置 | /api/admin/user-images<br>/api/admin/settings<br>/api/admin/production-readiness | 查看用户数据<br>清理数据<br>修改系统设置<br>检查生产就绪度 | user-data-summary<br>system-setting<br>readiness-report | P0 | protected-unverified |
| `workspace.canvas.core` | workspaces | canvas | 无限画布核心交互 | 入口选择页无限画布<br>项目仪表盘项目 | / | 选择<br>多选<br>移动<br>缩放<br>平移<br>删除<br>复制<br>撤销<br>重做<br>重置视图 | canvas-state<br>media-node | P0 | protected-unverified |
| `workspace.canvas.upload` | workspaces | canvas | 图片上传与导入 | 底部工具栏上传<br>拖入画布<br>剪贴板粘贴 | /api/upload<br>/api/save-image<br>/api/serve-upload/:filename | 点击上传<br>拖入上传<br>粘贴图片<br>持久化媒体 | media-asset<br>canvas-image | P0 | protected-unverified |
| `workspace.canvas.generate` | workspaces | canvas | 图像生成与逐张回填 | 图像生成面板<br>快速创作<br>底部图像生成器 | /api/generate<br>/api/poll-task<br>/api/task-events | 选择模型<br>选择比例<br>选择质量<br>设置数量<br>提交生成<br>逐张回填<br>取消 | generation-task<br>canvas-image | P0 | protected-unverified |
| `workspace.canvas.reference-groups` | workspaces | canvas | 图片组、参考图组与融图组 | 画布分组操作<br>参考图组<br>融图组 | /api/generate<br>/api/vision-prompt | 创建组<br>拖动组<br>折叠<br>关闭<br>识别参考图<br>按参考语义生成<br>融图生成 | image-group<br>reference-group<br>fusion-group<br>canvas-image | P0 | protected-unverified |
| `workspace.canvas.image-tools` | workspaces | canvas | 图片浮动工具栏 | 选中图片后的浮动工具栏<br>图片右键菜单 | /api/image-edit<br>/api/edit<br>/api/image/*<br>/api/svg-trace<br>/api/segment-elements | 放大<br>移除背景<br>SVG智能描摹<br>元素拆解<br>擦除<br>蒙版<br>调色<br>编辑元素<br>多角度<br>扩展<br>裁切<br>下载 | canvas-image<br>transparent-png<br>mask<br>svg<br>psd<br>layered-artifact | P0 | protected-unverified |
| `workspace.canvas.annotation` | workspaces | canvas | ChatCanvas 融合批注 | 底部工具栏 ChatCanvas<br>快捷键 C<br>节点批注入口 | /api/annotation/*<br>/api/edit | 点选<br>框选<br>画笔圈选<br>输入修改要求<br>提交批注<br>查看进度 | annotation<br>edit-task<br>canvas-image | P0 | protected-unverified |
| `workspace.canvas.layers-history-export` | workspaces | canvas | 图层、版本历史与导出 | 画布图层面板<br>版本历史<br>图片下载<br>项目导出 | /api/export-project<br>/api/export/*<br>/api/user-data/sync | 调整层级<br>查看版本<br>恢复版本<br>导出 PNG<br>导出 SVG<br>导出 PSD<br>下载项目 | project-snapshot<br>png<br>svg<br>psd<br>project-archive | P0 | protected-unverified |
| `workspace.canvas.video` | workspaces | canvas | 视频生成与编辑 | 底部工具栏视频生成<br>视频浮动工具栏 | /api/video/generate<br>/api/video/extend<br>/api/video/* | 文生视频<br>图生视频<br>延长视频<br>抽帧<br>配音<br>压缩<br>下载 | video-task<br>video<br>image-frame<br>audio | P0 | protected-unverified |
| `workspace.canvas.three-d` | workspaces | canvas | 图转 3D 与多视角 | 图片浮动工具栏图转3D<br>底部工具栏3D功能 | /api/image-to-3d<br>/api/poll-3d-task<br>/api/image-to-3d/* | 单图转3D<br>多图转3D<br>文生3D<br>多角度生成<br>预览<br>下载 | three-d-task<br>glb<br>obj<br>fbx<br>usdz | P1 | protected-unverified |
| `workspace.canvas.specialized-tools` | workspaces | canvas | 底部专业工具面板 | 底部工具栏抽屉 | /api/brand-*<br>/api/font-design/*<br>/api/ai-psd/*<br>/api/vector-design<br>/api/display-3d/* | 品牌电商<br>品牌IP<br>Logo Pro<br>包装Pro<br>展陈Pro<br>效果图反拆<br>字境大师<br>AI矢量设计<br>AI PSD<br>表情助手<br>六面体 | canvas-image<br>brand-asset<br>vector-artifact<br>psd<br>three-d-scene | P1 | protected-unverified |
| `workspace.canvas.refine` | workspaces | canvas | 精修引擎与人物精修大师 | 图片浮动工具栏<br>右键菜单<br>底部工具栏 | /api/refine-engine<br>/api/human/* | 产品精修<br>人物精修<br>人脸修复<br>手部修复<br>三维视角 | refine-task<br>canvas-image | P1 | protected-unverified |
| `workspace.workflow.graph` | workspaces | workflow | 节点图编辑 | 入口选择页节点模式<br>底部工具栏节点模式 | /api/workflow/models<br>/api/workflow/save | 创建节点<br>选择节点<br>删除节点<br>连线<br>复制粘贴<br>撤销重做<br>自动布局<br>保存恢复 | workflow<br>workflow-node<br>workflow-edge | P0 | protected-unverified |
| `workspace.workflow.ai-build` | workspaces | workflow | AI 自然语言建图 | 节点模式 AI 建图 | /api/workflow/ai-build | 输入目标<br>生成节点图<br>二次修正<br>自动布局 | workflow | P1 | protected-unverified |
| `workspace.workflow.execute` | workspaces | workflow | 工作流执行与结果传递 | 节点模式运行按钮 | /api/workflow/execute | 拓扑执行<br>等待上游<br>传递图片和提示词<br>取消<br>查看日志 | workflow-task<br>node-output<br>canvas-image<br>video | P0 | protected-unverified |
| `workspace.chat.independent` | workspaces | chat | 独立智能对话页面 | 入口选择页智能对话<br>/simple-chat | /simple-chat<br>/api/simple-chat/chat<br>/api/simple-chat/memory | 新建对话<br>选择模型<br>发送消息<br>上传图片<br>搜索历史<br>返回工作台 | chat-project<br>chat-message<br>generated-media | P0 | protected-unverified |
| `workspace.chat.canvas-agent` | workspaces | chat | 画布聊天、Skills 与 Agent | 无限画布 AI 聊天窗口<br>Agent 模式<br>图片工具栏 Agent | /api/chat<br>/api/agent-edit<br>/api/optimize-prompt | 普通对话<br>图像理解<br>提示词优化<br>Skills 调用<br>Agent 编排<br>发送结果到画布 | chat-message<br>agent-task<br>canvas-image<br>optimized-prompt | P0 | protected-unverified |
| `workspace.chat.memory-share` | workspaces | chat | 对话记忆、分享与导出 | 独立智能对话侧栏<br>分享弹窗<br>报告导出 | /api/simple-chat/memory<br>/api/simple-chat/share<br>/shared/:shareId | 保存记忆<br>删除记忆<br>分享对话<br>导出报告 | memory-record<br>share-link<br>report | P1 | protected-unverified |
| `public.shared-chat` | public-delivery | — | 公开对话分享页 | 分享链接 | /shared/:shareId<br>/api/simple-chat/share/:shareId | 打开分享<br>查看内容 | public-share | P1 | protected-unverified |
| `public.recharge` | public-delivery | — | 充值订单页面 | 用户积分页充值<br>充值订单链接 | /recharge/:orderId<br>/api/recharge/:orderId<br>/api/credits | 查看收款信息<br>确认已付款<br>查看审核状态 | recharge-order | P0 | protected-unverified |
| `public.download-export` | public-delivery | — | 文件下载与项目交付 | 图片下载<br>视频下载<br>项目导出<br>备份下载 | /api/export-project<br>/api/admin/backups/:id/download<br>/api/desktop/backup/download/:id | 下载图片<br>下载视频<br>导出 PSD<br>导出 SVG<br>下载项目归档 | download<br>project-archive<br>psd<br>svg | P0 | protected-unverified |
| `desktop.backup-update` | desktop-connectors | — | 本地无界设备、备份与更新 | 管理员仪表盘本地无界 | /api/admin/desktop-devices<br>/api/admin/backups<br>/api/admin/desktop-update<br>/api/desktop/backup/* | 查看设备<br>上传备份<br>下载备份<br>删除备份<br>发布客户端更新 | desktop-device<br>backup<br>desktop-update | P1 | protected-unverified |
| `desktop.resources` | desktop-connectors | — | 本地资源与生成记录 | 管理员仪表盘本地无界资源页 | /api/admin/resources<br>/api/admin/local-generation-records | 发布资源<br>删除资源<br>查看本地生成记录 | desktop-resource<br>local-generation-record | P1 | protected-unverified |
| `desktop.connectors` | desktop-connectors | — | 插件连接器管理 | 管理员仪表盘插件连接器 | /api/connectors/* | 查看连接器<br>配置连接器<br>检查状态 | connector-config<br>connector-status | P1 | protected-unverified |
| `support.doctor-readiness` | support-operations | — | 环境诊断与生产就绪检查 | npm run doctor<br>管理员生产就绪页 | /api/admin/production-readiness<br>/api/diagnostics/export<br>/api/diag/storage | 检查环境变量<br>检查数据库<br>检查存储<br>检查供应商<br>导出诊断 | doctor-report<br>readiness-report<br>diagnostic-archive | P0 | protected-unverified |
| `support.task-lifecycle` | support-operations | — | 统一任务状态、恢复与取消 | 生成任务卡片<br>管理员云端任务<br>恢复流程 | /api/task-events<br>/api/poll-task<br>/api/cancel-task<br>/api/tasks/recover<br>/api/queue-position | 注册任务<br>推送进度<br>轮询<br>取消<br>恢复<br>终态结算 | task-state<br>task-event<br>refund-settlement | P0 | protected-unverified |
| `support.provider-health` | support-operations | — | 供应商协议与健康验证 | 管理员 API 验证<br>全供应商测试 | /api/verify-protocol<br>/api/admin/test-all-providers<br>/api/test-provider-connection<br>/api/image/health | 验证协议<br>测试连接<br>检查本地图像服务<br>记录错误 | provider-health<br>protocol-report | P0 | protected-unverified |

## 页面

| 路由 | 文件 |
| --- | --- |
| `/` | `src/app/page.tsx` |
| `/recharge/:orderId` | `src/app/recharge/[orderId]/page.tsx` |
| `/shared/:shareId` | `src/app/shared/[shareId]/page.tsx` |
| `/simple-chat` | `src/app/simple-chat/page.tsx` |

## API 路由

| 路由 | 方法 | 文件 |
| --- | --- | --- |
| `/api/api/activity` | POST | `src/app/api/activity/route.ts` |
| `/api/api/activity-venue/analyze` | POST | `src/app/api/activity-venue/analyze/route.ts` |
| `/api/api/activity-venue/lock-design` | POST | `src/app/api/activity-venue/lock-design/route.ts` |
| `/api/api/activity-venue/proposals` | POST | `src/app/api/activity-venue/proposals/route.ts` |
| `/api/api/activity-venue/qc` | POST | `src/app/api/activity-venue/qc/route.ts` |
| `/api/api/admin/api-balance` | GET, POST | `src/app/api/admin/api-balance/route.ts` |
| `/api/api/admin/apis` | GET, POST | `src/app/api/admin/apis/route.ts` |
| `/api/api/admin/audit` | GET, POST | `src/app/api/admin/audit/route.ts` |
| `/api/api/admin/backups` | GET | `src/app/api/admin/backups/route.ts` |
| `/api/api/admin/backups/:id` | DELETE | `src/app/api/admin/backups/[id]/route.ts` |
| `/api/api/admin/backups/:id/download` | GET | `src/app/api/admin/backups/[id]/download/route.ts` |
| `/api/api/admin/cloud-tasks` | GET | `src/app/api/admin/cloud-tasks/route.ts` |
| `/api/api/admin/credits/overview` | GET | `src/app/api/admin/credits/overview/route.ts` |
| `/api/api/admin/credits/pricing` | GET, POST | `src/app/api/admin/credits/pricing/route.ts` |
| `/api/api/admin/credits/recharge` | POST | `src/app/api/admin/credits/recharge/route.ts` |
| `/api/api/admin/dashboard-stats` | GET | `src/app/api/admin/dashboard-stats/route.ts` |
| `/api/api/admin/desktop-devices` | GET | `src/app/api/admin/desktop-devices/route.ts` |
| `/api/api/admin/desktop-update` | GET, POST | `src/app/api/admin/desktop-update/route.ts` |
| `/api/api/admin/groups` | GET, POST | `src/app/api/admin/groups/route.ts` |
| `/api/api/admin/local-generation-records` | GET | `src/app/api/admin/local-generation-records/route.ts` |
| `/api/api/admin/op-log` | GET, POST | `src/app/api/admin/op-log/route.ts` |
| `/api/api/admin/production-readiness` | GET | `src/app/api/admin/production-readiness/route.ts` |
| `/api/api/admin/resources` | GET, POST | `src/app/api/admin/resources/route.ts` |
| `/api/api/admin/settings` | GET, POST | `src/app/api/admin/settings/route.ts` |
| `/api/api/admin/test-all-providers` | GET | `src/app/api/admin/test-all-providers/route.ts` |
| `/api/api/admin/user-folder` | POST | `src/app/api/admin/user-folder/route.ts` |
| `/api/api/admin/user-images` | GET | `src/app/api/admin/user-images/route.ts` |
| `/api/api/admin/users` | GET, POST | `src/app/api/admin/users/route.ts` |
| `/api/api/agent-edit` | GET, POST | `src/app/api/agent-edit/route.ts` |
| `/api/api/ai-psd/create` | POST | `src/app/api/ai-psd/create/route.ts` |
| `/api/api/ai-psd/result` | GET | `src/app/api/ai-psd/result/route.ts` |
| `/api/api/ai-psd/status` | GET | `src/app/api/ai-psd/status/route.ts` |
| `/api/api/analyze` | POST | `src/app/api/analyze/route.ts` |
| `/api/api/analyze-psd` | POST | `src/app/api/analyze-psd/route.ts` |
| `/api/api/annotations/execute` | POST | `src/app/api/annotations/execute/route.ts` |
| `/api/api/annotations/resolve-target` | POST | `src/app/api/annotations/resolve-target/route.ts` |
| `/api/api/announcement` | GET | `src/app/api/announcement/route.ts` |
| `/api/api/artifacts` | GET, POST, DELETE | `src/app/api/artifacts/route.ts` |
| `/api/api/aspect-recompose` | POST | `src/app/api/aspect-recompose/route.ts` |
| `/api/api/audio/generate` | POST | `src/app/api/audio/generate/route.ts` |
| `/api/api/auth/login` | POST | `src/app/api/auth/login/route.ts` |
| `/api/api/auth/logout` | POST | `src/app/api/auth/logout/route.ts` |
| `/api/api/auth/me` | GET | `src/app/api/auth/me/route.ts` |
| `/api/api/auth/register` | GET, POST | `src/app/api/auth/register/route.ts` |
| `/api/api/brand-assets` | GET, POST | `src/app/api/brand-assets/route.ts` |
| `/api/api/brand-ecommerce` | POST | `src/app/api/brand-ecommerce/route.ts` |
| `/api/api/brand-factory` | GET, POST | `src/app/api/brand-factory/route.ts` |
| `/api/api/brand-ip/generate` | POST | `src/app/api/brand-ip/generate/route.ts` |
| `/api/api/brand-ip/projects` | GET, POST, PATCH | `src/app/api/brand-ip/projects/route.ts` |
| `/api/api/brand-ip/strategy` | POST | `src/app/api/brand-ip/strategy/route.ts` |
| `/api/api/brand-ip/tasks` | GET | `src/app/api/brand-ip/tasks/route.ts` |
| `/api/api/brand-kit` | GET, POST | `src/app/api/brand-kit/route.ts` |
| `/api/api/brand-packaging/generate` | POST | `src/app/api/brand-packaging/generate/route.ts` |
| `/api/api/brand-packaging/tasks` | GET | `src/app/api/brand-packaging/tasks/route.ts` |
| `/api/api/cache-image` | POST | `src/app/api/cache-image/route.ts` |
| `/api/api/cancel-task` | POST | `src/app/api/cancel-task/route.ts` |
| `/api/api/chat` | POST | `src/app/api/chat/route.ts` |
| `/api/api/chat-tasks` | GET | `src/app/api/chat-tasks/route.ts` |
| `/api/api/client-error` | POST | `src/app/api/client-error/route.ts` |
| `/api/api/connector/auth/login` | POST | `src/app/api/connector/auth/login/route.ts` |
| `/api/api/connector/auth/me` | GET | `src/app/api/connector/auth/me/route.ts` |
| `/api/api/creative/health` | GET | `src/app/api/creative/health/route.ts` |
| `/api/api/creative/illustrator` | POST | `src/app/api/creative/illustrator/route.ts` |
| `/api/api/creative/photoshop` | POST | `src/app/api/creative/photoshop/route.ts` |
| `/api/api/creative/templates` | GET | `src/app/api/creative/templates/route.ts` |
| `/api/api/credits` | GET, POST | `src/app/api/credits/route.ts` |
| `/api/api/credits/pay-redirect` | GET | `src/app/api/credits/pay-redirect/route.ts` |
| `/api/api/credits/payment-config` | GET, POST | `src/app/api/credits/payment-config/route.ts` |
| `/api/api/credits/payment-notify` | GET, POST | `src/app/api/credits/payment-notify/route.ts` |
| `/api/api/credits/payment-qr` | GET | `src/app/api/credits/payment-qr/route.ts` |
| `/api/api/credits/payment-status` | GET | `src/app/api/credits/payment-status/route.ts` |
| `/api/api/dcc/health` | GET | `src/app/api/dcc/health/route.ts` |
| `/api/api/dcc/preflight` | GET | `src/app/api/dcc/preflight/route.ts` |
| `/api/api/dcc/templates` | GET | `src/app/api/dcc/templates/route.ts` |
| `/api/api/design/layer-split` | POST | `src/app/api/design/layer-split/route.ts` |
| `/api/api/design/vectorize` | POST | `src/app/api/design/vectorize/route.ts` |
| `/api/api/desktop/backup/download/:id` | GET | `src/app/api/desktop/backup/download/[id]/route.ts` |
| `/api/api/desktop/backup/list` | GET | `src/app/api/desktop/backup/list/route.ts` |
| `/api/api/desktop/backup/upload` | POST | `src/app/api/desktop/backup/upload/route.ts` |
| `/api/api/desktop/config` | GET | `src/app/api/desktop/config/route.ts` |
| `/api/api/desktop/device/heartbeat` | POST | `src/app/api/desktop/device/heartbeat/route.ts` |
| `/api/api/desktop/generation-records` | POST | `src/app/api/desktop/generation-records/route.ts` |
| `/api/api/desktop/login` | POST | `src/app/api/desktop/login/route.ts` |
| `/api/api/desktop/resources` | GET | `src/app/api/desktop/resources/route.ts` |
| `/api/api/desktop/update` | GET, POST | `src/app/api/desktop/update/route.ts` |
| `/api/api/desktop/update/download/:id` | dynamic | `src/app/api/desktop/update/download/[id]/route.ts` |
| `/api/api/diag/storage` | GET | `src/app/api/diag/storage/route.ts` |
| `/api/api/diagnostics/export` | GET | `src/app/api/diagnostics/export/route.ts` |
| `/api/api/display-3d/decompose` | POST | `src/app/api/display-3d/decompose/route.ts` |
| `/api/api/display-3d/generate` | POST | `src/app/api/display-3d/generate/route.ts` |
| `/api/api/ecom-templates` | GET, POST | `src/app/api/ecom-templates/route.ts` |
| `/api/api/edit` | GET, POST | `src/app/api/edit/route.ts` |
| `/api/api/effect-reverse-engineering` | GET, POST, DELETE | `src/app/api/effect-reverse-engineering/route.ts` |
| `/api/api/element-decompose` | GET, POST, DELETE | `src/app/api/element-decompose/route.ts` |
| `/api/api/excel/generate` | POST | `src/app/api/excel/generate/route.ts` |
| `/api/api/export-project` | GET, POST | `src/app/api/export-project/route.ts` |
| `/api/api/export/annotation-image` | POST | `src/app/api/export/annotation-image/route.ts` |
| `/api/api/export/bom` | POST | `src/app/api/export/bom/route.ts` |
| `/api/api/export/pdf` | POST | `src/app/api/export/pdf/route.ts` |
| `/api/api/export/to-canvas` | POST | `src/app/api/export/to-canvas/route.ts` |
| `/api/api/favorites` | GET, POST, DELETE | `src/app/api/favorites/route.ts` |
| `/api/api/flowchart/generate` | POST | `src/app/api/flowchart/generate/route.ts` |
| `/api/api/font-design/gallery` | GET | `src/app/api/font-design/gallery/route.ts` |
| `/api/api/font-design/gallery-image` | GET | `src/app/api/font-design/gallery-image/route.ts` |
| `/api/api/font-design/generate-image` | POST | `src/app/api/font-design/generate-image/route.ts` |
| `/api/api/font-design/plan` | GET, POST | `src/app/api/font-design/plan/route.ts` |
| `/api/api/font-design/prompt` | POST | `src/app/api/font-design/prompt/route.ts` |
| `/api/api/generate` | POST | `src/app/api/generate/route.ts` |
| `/api/api/help-image` | GET | `src/app/api/help-image/route.ts` |
| `/api/api/human/analyze` | POST | `src/app/api/human/analyze/route.ts` |
| `/api/api/human/repair` | POST | `src/app/api/human/repair/route.ts` |
| `/api/api/human/select` | POST | `src/app/api/human/select/route.ts` |
| `/api/api/human/task/:id` | GET | `src/app/api/human/task/[id]/route.ts` |
| `/api/api/image-edit` | POST | `src/app/api/image-edit/route.ts` |
| `/api/api/image-to-3d` | POST | `src/app/api/image-to-3d/route.ts` |
| `/api/api/image-to-3d/auto-multi-view` | GET, POST | `src/app/api/image-to-3d/auto-multi-view/route.ts` |
| `/api/api/image-to-3d/meshy-stream` | GET | `src/app/api/image-to-3d/meshy-stream/route.ts` |
| `/api/api/image-to-3d/poll-post-process` | POST | `src/app/api/image-to-3d/poll-post-process/route.ts` |
| `/api/api/image-to-3d/post-process` | GET, POST | `src/app/api/image-to-3d/post-process/route.ts` |
| `/api/api/image/color-adjust` | POST | `src/app/api/image/color-adjust/route.ts` |
| `/api/api/image/health` | GET | `src/app/api/image/health/route.ts` |
| `/api/api/image/start-services` | POST | `src/app/api/image/start-services/route.ts` |
| `/api/api/image/upscale` | POST | `src/app/api/image/upscale/route.ts` |
| `/api/api/image/upscale-pro` | POST | `src/app/api/image/upscale-pro/route.ts` |
| `/api/api/knowledge/extract-text` | POST | `src/app/api/knowledge/extract-text/route.ts` |
| `/api/api/layered-decompose` | GET, POST, DELETE | `src/app/api/layered-decompose/route.ts` |
| `/api/api/logo-skill` | GET, POST | `src/app/api/logo-skill/route.ts` |
| `/api/api/mindmap/generate` | POST | `src/app/api/mindmap/generate/route.ts` |
| `/api/api/models` | GET | `src/app/api/models/route.ts` |
| `/api/api/omp-agent` | GET, POST | `src/app/api/omp-agent/route.ts` |
| `/api/api/omp-resources` | GET | `src/app/api/omp-resources/route.ts` |
| `/api/api/optimize-prompt` | POST | `src/app/api/optimize-prompt/route.ts` |
| `/api/api/pdf/generate` | POST | `src/app/api/pdf/generate/route.ts` |
| `/api/api/poll-3d-task` | POST | `src/app/api/poll-3d-task/route.ts` |
| `/api/api/poll-task` | POST | `src/app/api/poll-task/route.ts` |
| `/api/api/ppt/generate` | POST | `src/app/api/ppt/generate/route.ts` |
| `/api/api/ppt/template/upload` | POST | `src/app/api/ppt/template/upload/route.ts` |
| `/api/api/proxy-3d-model` | GET | `src/app/api/proxy-3d-model/route.ts` |
| `/api/api/queue-position` | GET, POST | `src/app/api/queue-position/route.ts` |
| `/api/api/quick-create/compile` | POST | `src/app/api/quick-create/compile/route.ts` |
| `/api/api/recharge/:orderId` | GET, POST | `src/app/api/recharge/[orderId]/route.ts` |
| `/api/api/recover-images` | GET, POST | `src/app/api/recover-images/route.ts` |
| `/api/api/refine-engine` | GET, POST | `src/app/api/refine-engine/route.ts` |
| `/api/api/save-image` | POST | `src/app/api/save-image/route.ts` |
| `/api/api/scene-studio` | GET, POST | `src/app/api/scene-studio/route.ts` |
| `/api/api/scene-studio/generate` | GET, POST | `src/app/api/scene-studio/generate/route.ts` |
| `/api/api/segment-elements` | POST | `src/app/api/segment-elements/route.ts` |
| `/api/api/serve-upload/:path*` | GET | `src/app/api/serve-upload/[...path]/route.ts` |
| `/api/api/session` | dynamic | `src/app/api/session/route.ts` |
| `/api/api/simple-chat/chat` | POST | `src/app/api/simple-chat/chat/route.ts` |
| `/api/api/simple-chat/deep-research` | POST | `src/app/api/simple-chat/deep-research/route.ts` |
| `/api/api/simple-chat/memory` | GET, POST, DELETE | `src/app/api/simple-chat/memory/route.ts` |
| `/api/api/simple-chat/share` | POST | `src/app/api/simple-chat/share/route.ts` |
| `/api/api/simple-chat/share/:shareId` | GET, DELETE | `src/app/api/simple-chat/share/[shareId]/route.ts` |
| `/api/api/simple-chat/upload-file` | POST | `src/app/api/simple-chat/upload-file/route.ts` |
| `/api/api/story-assets/plan` | POST | `src/app/api/story-assets/plan/route.ts` |
| `/api/api/svg-convert` | POST | `src/app/api/svg-convert/route.ts` |
| `/api/api/svg-trace` | POST | `src/app/api/svg-trace/route.ts` |
| `/api/api/task-events` | GET, POST | `src/app/api/task-events/route.ts` |
| `/api/api/tasks/recover` | GET | `src/app/api/tasks/recover/route.ts` |
| `/api/api/test-provider-connection` | POST | `src/app/api/test-provider-connection/route.ts` |
| `/api/api/universal-discover` | POST | `src/app/api/universal-discover/route.ts` |
| `/api/api/universal-generate` | POST | `src/app/api/universal-generate/route.ts` |
| `/api/api/upload` | POST | `src/app/api/upload/route.ts` |
| `/api/api/upscayl` | GET, POST | `src/app/api/upscayl/route.ts` |
| `/api/api/user-data/record` | POST | `src/app/api/user-data/record/route.ts` |
| `/api/api/user-data/sync` | GET, POST | `src/app/api/user-data/sync/route.ts` |
| `/api/api/user/change-password` | POST | `src/app/api/user/change-password/route.ts` |
| `/api/api/vector-design` | POST | `src/app/api/vector-design/route.ts` |
| `/api/api/verify-protocol` | POST | `src/app/api/verify-protocol/route.ts` |
| `/api/api/video/director/diagnose` | POST | `src/app/api/video/director/diagnose/route.ts` |
| `/api/api/video/director/prompt` | POST | `src/app/api/video/director/prompt/route.ts` |
| `/api/api/video/director/shot-plan` | POST | `src/app/api/video/director/shot-plan/route.ts` |
| `/api/api/video/download` | GET | `src/app/api/video/download/route.ts` |
| `/api/api/video/extend` | GET, POST | `src/app/api/video/extend/route.ts` |
| `/api/api/video/extract-frame` | POST | `src/app/api/video/extract-frame/route.ts` |
| `/api/api/video/extract-frames` | POST | `src/app/api/video/extract-frames/route.ts` |
| `/api/api/video/generate` | GET, POST | `src/app/api/video/generate/route.ts` |
| `/api/api/video/tools` | POST | `src/app/api/video/tools/route.ts` |
| `/api/api/vision-prompt` | POST | `src/app/api/vision-prompt/route.ts` |
| `/api/api/wasm/vtracer` | GET | `src/app/api/wasm/vtracer/route.ts` |
| `/api/api/word/generate` | POST | `src/app/api/word/generate/route.ts` |
| `/api/api/workflow/ai-build` | POST | `src/app/api/workflow/ai-build/route.ts` |
| `/api/api/workflow/execute` | POST | `src/app/api/workflow/execute/route.ts` |
| `/api/api/workflow/models` | GET | `src/app/api/workflow/models/route.ts` |
| `/api/api/workflow/save` | GET, POST | `src/app/api/workflow/save/route.ts` |

## 工作流节点类型

- `agent-auto`
- `agent-chat`
- `ai-3d-model`
- `ai-analyze`
- `ai-annotation-edit`
- `ai-audio`
- `ai-brand-ecommerce`
- `ai-color-adjust`
- `ai-edit`
- `ai-font-design`
- `ai-generate`
- `ai-human-repair`
- `ai-llm`
- `ai-multi-angle`
- `ai-panorama`
- `ai-refine-engine`
- `ai-removebg`
- `ai-retouch`
- `ai-segment`
- `ai-style-transfer`
- `ai-upscale`
- `ai-vectorize`
- `ai-video-generate`
- `ai-video-i2v`
- `audio-input`
- `condition-if`
- `condition-switch`
- `group`
- `input-image`
- `input-param`
- `input-text`
- `input-video`
- `loop-each`
- `loop-for`
- `loop-while`
- `manual-color-adjust`
- `output-audio`
- `output-export`
- `output-image`
- `output-image-group`
- `output-save`
- `output-video`
- `parallel`
- `storyboard-sequence`
- `subgraph`
- `video-compose`
- `video-concat`
- `video-extract-frames`
- `video-filter`
- `video-speed-change`
- `video-trim`

## Agent 工具

- `extend_video`
- `generate_image`
- `generate_video`
- `image_edit`
- `remove_background`
- `svg_trace`
- `upscale`

## 图片浮动工具动作

- `放大`
- `移除背景`
- `SVG智能描摹`
- `元素拆解`
- `擦除`
- `蒙版`
- `调色`
- `编辑元素`
- `多角度`
- `图转3D工厂`
- `扩展`
- `裁切`
- `全景生成`
- `精修引擎`
- `人物精修大师`
- `语言修图`
- `Agent编排`
- `下载`
- `横竖重组`
- `视频抽帧`
- `AI配音`
- `转 GIF`
- `视频压缩`

## 组件源文件

- `src/components/agent-editor.tsx`
- `src/components/ai-psd/ai-psd-panel.tsx`
- `src/components/app-error-boundary.tsx`
- `src/components/aspect-recompose-panel.tsx`
- `src/components/audio-generation-panel.tsx`
- `src/components/audio-player.tsx`
- `src/components/brand-ecommerce-panel.tsx`
- `src/components/brand-ecommerce/BrandAssetManager.tsx`
- `src/components/brand-ecommerce/BrandResultGallery.tsx`
- `src/components/brand-ecommerce/BrandSettingsForm.tsx`
- `src/components/brand-ecommerce/BrandTemplateSelector.tsx`
- `src/components/brand-ecommerce/index.ts`
- `src/components/brand-ecommerce/template-fields.ts`
- `src/components/brand-factory-panel.tsx`
- `src/components/brand-ip-panel.tsx`
- `src/components/brand-kit-panel.tsx`
- `src/components/brand-packaging-panel.tsx`
- `src/components/canvas-workspace.tsx`
- `src/components/canvas/CanvasHelpModal.tsx`
- `src/components/canvas/MultiAngleSpherePreview.tsx`
- `src/components/chat-panel.tsx`
- `src/components/chat/AgentBuilderDialog.tsx`
- `src/components/custom-dialogs.tsx`
- `src/components/dashboard/admin-recharge-orders.tsx`
- `src/components/dashboard/admin-tabs.tsx`
- `src/components/dashboard/dashboard-view.tsx`
- `src/components/dashboard/data-manager-tab.tsx`
- `src/components/dashboard/desktop-admin-tab.tsx`
- `src/components/dashboard/login-panel.tsx`
- `src/components/dashboard/user-credits-tab.tsx`
- `src/components/dashboard/user-settings-tab.tsx`
- `src/components/display3d-panel.tsx`
- `src/components/effect-reverse-engineering-panel.tsx`
- `src/components/effect-reverse-engineering/i18n.ts`
- `src/components/effect-reverse-engineering/layer-panel.tsx`
- `src/components/effect-reverse-engineering/source-panel.tsx`
- `src/components/effect-reverse-engineering/workspace.tsx`
- `src/components/engine-select-dialog.tsx`
- `src/components/favorites-panel.tsx`
- `src/components/font-design-panel.tsx`
- `src/components/generation-panel.tsx`
- `src/components/global-error-monitor.tsx`
- `src/components/help-guide.tsx`
- `src/components/human-repair-panel.tsx`
- `src/components/image-compare-dialog.tsx`
- `src/components/image-editor.tsx`
- `src/components/image-preview.tsx`
- `src/components/infinite-canvas.tsx`
- `src/components/layer-panel.tsx`
- `src/components/logo-skill-panel.tsx`
- `src/components/model-viewer-3d.tsx`
- `src/components/motion-brush-canvas.tsx`
- `src/components/node-editor.tsx`
- `src/components/oh-my-prompt.tsx`
- `src/components/operation-audit-client.tsx`
- `src/components/project-data-panel.tsx`
- `src/components/prompt-equation.tsx`
- `src/components/prompt-template-panel.tsx`
- `src/components/psd-editor/CanvasImage.tsx`
- `src/components/psd-editor/ExportToolbar.tsx`
- `src/components/psd-editor/LayerInspector.tsx`
- `src/components/psd-editor/LayerPanel.tsx`
- `src/components/psd-editor/LayerRow.tsx`
- `src/components/psd-editor/PsdCanvas.tsx`
- `src/components/psd-editor/PsdLayerEditor.tsx`
- `src/components/quick-create-panel.tsx`
- `src/components/refine-engine-panel.tsx`
- `src/components/scene-studio-panel.tsx`
- `src/components/simple-chat/canvas-editor.tsx`
- `src/components/simple-chat/chat-area.tsx`
- `src/components/simple-chat/global-search.tsx`
- `src/components/simple-chat/image-lightbox.tsx`
- `src/components/simple-chat/login.tsx`
- `src/components/simple-chat/markdown-renderer.tsx`
- `src/components/simple-chat/memory-panel.tsx`
- `src/components/simple-chat/model-compare.tsx`
- `src/components/simple-chat/prompt-optimizer.tsx`
- `src/components/simple-chat/quick-commands.tsx`
- `src/components/simple-chat/report-export.tsx`
- `src/components/simple-chat/share-dialog.tsx`
- `src/components/simple-chat/sidebar.tsx`
- `src/components/simple-chat/simple-chat-types.ts`
- `src/components/simple-chat/theme-script.tsx`
- `src/components/simple-chat/theme-toggle.tsx`
- `src/components/simple-chat/usage-stats.tsx`
- `src/components/sticker-assistant-panel.tsx`
- `src/components/third-party-model-dialog.tsx`
- `src/components/ui/accordion.tsx`
- `src/components/ui/alert-dialog.tsx`
- `src/components/ui/alert.tsx`
- `src/components/ui/aspect-ratio.tsx`
- `src/components/ui/avatar.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/breadcrumb.tsx`
- `src/components/ui/button-group.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/calendar.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/carousel.tsx`
- `src/components/ui/chart.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/collapsible.tsx`
- `src/components/ui/command.tsx`
- `src/components/ui/context-menu.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/drawer.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/empty.tsx`
- `src/components/ui/field.tsx`
- `src/components/ui/form.tsx`
- `src/components/ui/hover-card.tsx`
- `src/components/ui/input-group.tsx`
- `src/components/ui/input-otp.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/item.tsx`
- `src/components/ui/kbd.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/menubar.tsx`
- `src/components/ui/navigation-menu.tsx`
- `src/components/ui/pagination.tsx`
- `src/components/ui/popover.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/radio-group.tsx`
- `src/components/ui/resizable.tsx`
- `src/components/ui/scroll-area.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/slider.tsx`
- `src/components/ui/sonner.tsx`
- `src/components/ui/spinner.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/toast.tsx`
- `src/components/ui/toggle-group.tsx`
- `src/components/ui/toggle.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/vector-design/vector-design-panel.tsx`
- `src/components/vector-design/vector-editor-dialog.tsx`
- `src/components/venue-region-canvas.tsx`
- `src/components/version-history-panel.tsx`
- `src/components/video-compare-dialog.tsx`
- `src/components/video-edit-panel.tsx`
- `src/components/video-generation-panel.tsx`
- `src/components/video-player.tsx`
- `src/components/workflow-hub.tsx`

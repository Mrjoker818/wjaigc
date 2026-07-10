# 无界AI 全功能检测计划

## 概述
对无界AI平台进行全面功能检测，覆盖画布模式、节点模式、智能对话窗口、管理员仪表盘、普通用户仪表盘等所有功能区。采用 program-repair-auditor 工作流：先建立基线、诊断根因、受控修复、逐步验证。

## 检测模式
- **Full Repair Mode**：当前使用强编码模型，允许检查整个项目、运行命令、编辑代码、运行验证
- **Two-Model Safety Pattern**：高风险修复使用诊断+审查双模型模式

---

## 第1阶段：静态基线检测

### Task 1: TypeScript 类型检查
**描述：** 运行 `pnpm ts-check` 确保所有 TypeScript 类型正确
**验收标准：**
- [ ] `pnpm ts-check` 零错误退出
- [ ] 无隐式 any 类型
- [ ] 无未解析的模块引用

**验证：** `pnpm ts-check`
**涉及文件：** 全项目
**预估范围：** 检测（不修改）

### Task 2: ESLint 代码规范检查
**描述：** 运行 `pnpm lint` 确保代码规范
**验收标准：**
- [ ] `pnpm lint` 零错误（警告可接受）
- [ ] 无未使用变量（critical）
- [ ] 无语法错误

**验证：** `pnpm lint --quiet`
**涉及文件：** 全项目
**预估范围：** 检测（不修改）

### Task 3: 构建检查
**描述：** 运行 `pnpm build` 确保生产构建成功
**验收标准：**
- [ ] `pnpm build` 成功退出
- [ ] 无构建时错误
- [ ] 输出目录正常生成

**验证：** `pnpm build`
**涉及文件：** 全项目
**预估范围：** 检测（不修改）

### Task 4: 服务启动与探活
**描述：** 确认服务在端口 5000 正常运行
**验收标准：**
- [ ] 服务在 5000 端口监听
- [ ] 首页可访问
- [ ] API 端点可达

**验证：** `curl -I http://localhost:5000`
**涉及文件：** 无
**预估范围：** 检测

---

## 第2阶段：API 路由全量检测

### Task 5: 认证 API 检测
**描述：** 检测登录/登出/会话 API
**验收标准：**
- [ ] POST /api/auth/login - 正常登录返回 token
- [ ] GET /api/auth/me - 返回当前用户信息
- [ ] POST /api/auth/logout - 正常登出

**涉及文件：**
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/me/route.ts`
- `src/app/api/auth/logout/route.ts`
**预估范围：** 中

### Task 6: 图像生成 API 检测
**描述：** 检测图像生成核心 API
**验收标准：**
- [ ] POST /api/generate - 提交生成任务返回 taskId
- [ ] POST /api/poll-task - 轮询任务状态正常
- [ ] GET /api/models - 返回模型列表

**涉及文件：**
- `src/app/api/generate/route.ts`
- `src/app/api/poll-task/route.ts`
- `src/app/api/models/route.ts`
**预估范围：** 中

### Task 7: 图像编辑 API 检测
**描述：** 检测图像编辑相关 API
**验收标准：**
- [ ] POST /api/image-edit (action: erase) - 擦除功能
- [ ] POST /api/image-edit (action: mask) - 蒙版修图
- [ ] POST /api/image-edit (action: upscale) - 无损放大
- [ ] POST /api/image-edit (action: extend) - 扩展画面
- [ ] POST /api/image-edit (action: removebg) - 移除背景
- [ ] POST /api/image-edit (action: multi_angle) - 多角度
- [ ] POST /api/image-edit (action: outpaint) - 外扩绘制
- [ ] POST /api/image-edit (action: inpaint) - 涂抹修复

**涉及文件：**
- `src/app/api/image-edit/route.ts`
**预估范围：** 大

### Task 8: 语言修图 API 检测
**描述：** 检测自然语言修图 API
**验收标准：**
- [ ] POST /api/edit - 提交修图任务
- [ ] GET /api/edit - 获取支持的编辑模型

**涉及文件：**
- `src/app/api/edit/route.ts`
**预估范围：** 小

### Task 9: 视频生成 API 检测
**描述：** 检测视频生成相关 API
**验收标准：**
- [ ] POST /api/video/generate - 提交视频生成任务
- [ ] GET /api/video/generate - 获取视频配置
- [ ] POST /api/video/extend - 视频延长
- [ ] POST /api/video/extract-frame - 视频抽帧
- [ ] POST /api/video/director/prompt - 导演增强
- [ ] POST /api/video/director/shot-plan - AI分镜
- [ ] POST /api/video/director/diagnose - 失败诊断

**涉及文件：**
- `src/app/api/video/generate/route.ts`
- `src/app/api/video/extend/route.ts`
- `src/app/api/video/extract-frame/route.ts`
- `src/app/api/video/director/prompt/route.ts`
- `src/app/api/video/director/shot-plan/route.ts`
- `src/app/api/video/director/diagnose/route.ts`
**预估范围：** 大

### Task 10: 3D 模型 API 检测
**描述：** 检测 3D 模型生成相关 API
**验收标准：**
- [ ] POST /api/image-to-3d - 图片转3D
- [ ] POST /api/image-to-3d/auto-multi-view - 自动多视角
- [ ] POST /api/image-to-3d/post-process - 后处理
- [ ] POST /api/poll-3d-task - 3D任务轮询

**涉及文件：**
- `src/app/api/image-to-3d/route.ts`
- `src/app/api/image-to-3d/auto-multi-view/route.ts`
- `src/app/api/image-to-3d/post-process/route.ts`
- `src/app/api/poll-3d-task/route.ts`
**预估范围：** 大

### Task 11: AI 聊天 API 检测
**描述：** 检测 AI 聊天相关 API
**验收标准：**
- [ ] POST /api/chat - 发送消息并接收 SSE 流式响应
- [ ] POST /api/optimize-prompt - 提示词优化

**涉及文件：**
- `src/app/api/chat/route.ts`
- `src/app/api/optimize-prompt/route.ts`
**预估范围：** 中

### Task 12: 智能对话 API 检测
**描述：** 检测智能对话窗口专用 API
**验收标准：**
- [ ] POST /api/simple-chat/chat - 智能对话（含联网搜索/知识库/Deep Research）
- [ ] POST /api/simple-chat/deep-research - 深度研究
- [ ] POST /api/simple-chat/upload-file - 文件上传

**涉及文件：**
- `src/app/api/simple-chat/chat/route.ts`
- `src/app/api/simple-chat/deep-research/route.ts`
- `src/app/api/simple-chat/upload-file/route.ts`
**预估范围：** 中

### Task 13: 工作流 API 检测
**描述：** 检测工作流节点模式 API
**验收标准：**
- [ ] POST /api/workflow/execute (action: start) - 启动工作流
- [ ] POST /api/workflow/execute (action: status) - 查询状态
- [ ] POST /api/workflow/execute (action: cancel) - 取消工作流
- [ ] GET /api/workflow/models - 获取模型列表
- [ ] POST /api/workflow/save - 保存工作流
- [ ] POST /api/workflow/ai-build - AI自然语言建图

**涉及文件：**
- `src/app/api/workflow/execute/route.ts`
- `src/app/api/workflow/models/route.ts`
- `src/app/api/workflow/save/route.ts`
- `src/app/api/workflow/ai-build/route.ts`
**预估范围：** 大

### Task 14: Agent 编排 API 检测
**描述：** 检测 Agent 编排 API
**验收标准：**
- [ ] POST /api/agent-edit - 提交 Agent 编辑任务

**涉及文件：**
- `src/app/api/agent-edit/route.ts`
**预估范围：** 小

### Task 15: 矢量化与 SVG API 检测
**描述：** 检测矢量化和 SVG 相关 API
**验收标准：**
- [ ] POST /api/design/vectorize - 图片矢量化
- [ ] POST /api/svg-trace - SVG 智能描摹
- [ ] POST /api/svg-convert - SVG 转换

**涉及文件：**
- `src/app/api/design/vectorize/route.ts`
- `src/app/api/svg-trace/route.ts`
- `src/app/api/svg-convert/route.ts`
**预估范围：** 中

### Task 16: 任务管理 API 检测
**描述：** 检测任务注册/取消/SSE 推送 API
**验收标准：**
- [ ] POST /api/cancel-task - 取消任务
- [ ] GET /api/task-events - SSE 事件流
- [ ] GET /api/queue-position - 队列位置

**涉及文件：**
- `src/app/api/cancel-task/route.ts`
- `src/app/api/task-events/route.ts`
- `src/app/api/queue-position/route.ts`
**预估范围：** 中

### Task 17: 品牌系统 API 检测
**描述：** 检测品牌工厂相关 API
**验收标准：**
- [ ] POST /api/brand-factory - 品牌工厂
- [ ] POST /api/brand-kit - 品牌套件
- [ ] POST /api/brand-ecommerce - 品牌电商
- [ ] POST /api/brand-packaging/generate - 品牌包装
- [ ] GET/POST /api/brand-assets - 品牌资产

**涉及文件：**
- `src/app/api/brand-factory/route.ts`
- `src/app/api/brand-kit/route.ts`
- `src/app/api/brand-ecommerce/route.ts`
- `src/app/api/brand-packaging/generate/route.ts`
- `src/app/api/brand-assets/route.ts`
**预估范围：** 大

### Task 18: 字境大师 API 检测
**描述：** 检测字体设计相关 API
**验收标准：**
- [ ] GET/POST /api/font-design/plan - 设计方案
- [ ] POST /api/font-design/prompt - 提示词生成
- [ ] POST /api/font-design/generate-image - 图片生成
- [ ] GET /api/font-design/gallery - 风格库

**涉及文件：**
- `src/app/api/font-design/plan/route.ts`
- `src/app/api/font-design/prompt/route.ts`
- `src/app/api/font-design/generate-image/route.ts`
- `src/app/api/font-design/gallery/route.ts`
**预估范围：** 中

### Task 19: 图片工具 API 检测
**描述：** 检测本地图像工具 API
**验收标准：**
- [ ] GET /api/image/health - 健康检测
- [ ] POST /api/image/upscale - 无损放大
- [ ] POST /api/image/upscale-pro - 放大Pro
- [ ] POST /api/image/inpaint - 涂抹修复

**涉及文件：**
- `src/app/api/image/health/route.ts`
- `src/app/api/image/upscale/route.ts`
- `src/app/api/image/upscale-pro/route.ts`
- `src/app/api/image/inpaint/route.ts`
**预估范围：** 中

### Task 20: 管理员 API 检测
**描述：** 检测管理员后台 API
**验收标准：**
- [ ] GET/POST /api/admin/users - 用户管理
- [ ] GET/POST /api/admin/apis - API 提供商管理
- [ ] GET/POST /api/admin/settings - 系统设置
- [ ] GET /api/admin/dashboard-stats - 仪表盘统计
- [ ] GET/POST /api/admin/op-log - 操作日志
- [ ] GET /api/admin/api-balance - API 余额
- [ ] POST /api/admin/test-all-providers - 批量测试
- [ ] GET/POST /api/admin/groups - 用户组管理
- [ ] GET /api/admin/credits/overview - 积分概览
- [ ] POST /api/admin/credits/recharge - 积分充值

**涉及文件：**
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/apis/route.ts`
- `src/app/api/admin/settings/route.ts`
- `src/app/api/admin/dashboard-stats/route.ts`
- `src/app/api/admin/op-log/route.ts`
- `src/app/api/admin/api-balance/route.ts`
**预估范围：** 大

### Task 21: 数据持久化 API 检测
**描述：** 检测用户数据同步和存储 API
**验收标准：**
- [ ] GET/POST /api/user-data/sync - 数据同步
- [ ] POST /api/user-data/record - 数据记录
- [ ] POST /api/save-image - 图片保存
- [ ] POST /api/upload - 文件上传
- [ ] GET /api/serve-upload/[path] - 文件服务

**涉及文件：**
- `src/app/api/user-data/sync/route.ts`
- `src/app/api/save-image/route.ts`
- `src/app/api/upload/route.ts`
**预估范围：** 中

### Task 22: 导出与场景 API 检测
**描述：** 检测导出和场景相关 API
**验收标准：**
- [ ] POST /api/export/pdf - PDF 导出
- [ ] POST /api/export/bom - BOM 导出
- [ ] POST /api/scene-studio/generate - 场景生成
- [ ] POST /api/display-3d/generate - 3D 展示生成
- [ ] POST /api/refine-engine - 精修引擎
- [ ] POST /api/segment-elements - 元素分层
- [ ] POST /api/layered-decompose - 分层解构

**涉及文件：**
- `src/app/api/export/pdf/route.ts`
- `src/app/api/scene-studio/generate/route.ts`
- `src/app/api/refine-engine/route.ts`
- `src/app/api/segment-elements/route.ts`
**预估范围：** 大

---

## 检查点：第2阶段完成后
- [ ] 所有 API 路由静态检查通过
- [ ] 所有 API 路由返回正确 HTTP 状态码
- [ ] 无 500 内部错误
- [ ] 参数验证正确（缺少必填参数返回 400）

---

## 第3阶段：画布模式前端检测

### Task 23: 无限画布基础功能
**描述：** 检测画布核心交互功能
**验收标准：**
- [ ] 画布渲染正常，无空白页面
- [ ] 图片上传功能正常
- [ ] 图片拖拽/缩放/旋转正常
- [ ] 多选/框选功能正常
- [ ] 右键菜单显示正常
- [ ] 底部工具栏显示正常
- [ ] Ctrl+Z 撤回功能正常
- [ ] Delete 删除选中图片正常

**涉及文件：**
- `src/components/infinite-canvas.tsx`
**预估范围：** 大

### Task 24: 画布图片编辑工具
**描述：** 检测画布上的图片编辑工具栏
**验收标准：**
- [ ] 放大按钮功能正常
- [ ] 移除背景按钮功能正常
- [ ] SVG 智能描摹按钮功能正常
- [ ] 擦除按钮功能正常
- [ ] 蒙版按钮功能正常
- [ ] 编辑元素按钮功能正常
- [ ] 扩展按钮功能正常
- [ ] 图生图按钮功能正常
- [ ] 裁切按钮功能正常
- [ ] 下载按钮功能正常（PNG/SVG/PSD）

**涉及文件：**
- `src/components/infinite-canvas.tsx`
- `src/components/image-editor.tsx`
**预估范围：** 大

### Task 25: 图像生成面板
**描述：** 检测图像生成控制面板
**验收标准：**
- [ ] 模型选择器正常显示和切换
- [ ] 提示词输入框正常
- [ ] 画面比例选择正常
- [ ] 生图质量选择正常
- [ ] 分辨率档位切换正常
- [ ] 生成按钮触发正确 API 调用
- [ ] 产品品类切换正常

**涉及文件：**
- `src/components/generation-panel.tsx`
**预估范围：** 中

### Task 26: 视频生成面板
**描述：** 检测视频生成控制面板
**验收标准：**
- [ ] 文生视频模式正常
- [ ] 图生视频模式正常
- [ ] 首尾帧模式正常
- [ ] 多参考图模式正常
- [ ] 视频延长功能正常
- [ ] 导演风格选择器正常
- [ ] AI 导演增强按钮正常
- [ ] AI 分镜功能正常
- [ ] 视频播放器正常

**涉及文件：**
- `src/components/video-generation-panel.tsx`
- `src/components/video-edit-panel.tsx`
- `src/components/video-player.tsx`
**预估范围：** 大

### Task 27: 3D 模型功能
**描述：** 检测 3D 模型生成和预览
**验收标准：**
- [ ] 单图转3D功能正常
- [ ] 多图转3D功能正常
- [ ] 文生3D功能正常
- [ ] 3D 预览器交互正常（旋转/缩放/平移）
- [ ] 视角切换正常
- [ ] 光照模式切换正常
- [ ] 下载功能正常

**涉及文件：**
- `src/components/model-viewer-3d.tsx`
- `src/components/display3d-panel.tsx`
**预估范围：** 大

### Task 28: 语言修图与 Agent 编排
**描述：** 检测语言修图和 Agent 编排功能
**验收标准：**
- [ ] 语言修图入口正常（右键菜单/工具栏）
- [ ] 模型选择正常（OpenAI/Gemini）
- [ ] 画笔/橡皮擦工具正常（OpenAI 模型）
- [ ] 自然语言输入正常
- [ ] Agent 编排入口正常
- [ ] Agent 执行进度显示正常
- [ ] Agent 取消功能正常

**涉及文件：**
- `src/components/image-editor.tsx`
- `src/components/agent-editor.tsx`
**预估范围：** 大

### Task 29: 下载与导出功能
**描述：** 检测各种导出格式
**验收标准：**
- [ ] PNG 下载正常
- [ ] SVG 导出正常（Fast/Pro/Studio）
- [ ] PSD 导出正常（Basic/Pro/Studio）
- [ ] PDF 导出正常
- [ ] 画布整体导出正常

**涉及文件：**
- `src/lib/psd-export.ts`
- `src/lib/svg-export.ts`
- `src/components/infinite-canvas.tsx`
**预估范围：** 大

### Task 30: 品牌系统前端
**描述：** 检测品牌相关面板
**验收标准：**
- [ ] 品牌工厂面板正常
- [ ] 品牌套件面板正常
- [ ] 品牌电商面板正常
- [ ] 品牌包装面板正常
- [ ] Logo 技能面板正常
- [ ] 字境大师面板正常
- [ ] 贴纸助手面板正常

**涉及文件：**
- `src/components/brand-factory-panel.tsx`
- `src/components/brand-kit-panel.tsx`
- `src/components/brand-ecommerce-panel.tsx`
- `src/components/brand-packaging-panel.tsx`
- `src/components/logo-skill-panel.tsx`
- `src/components/font-design-panel.tsx`
- `src/components/sticker-assistant-panel.tsx`
**预估范围：** 大

---

## 检查点：第3阶段完成后
- [ ] 画布模式所有功能可正常交互
- [ ] 所有编辑工具可正常调用
- [ ] 生成面板参数传递正确
- [ ] 导出功能正常

---

## 第4阶段：节点模式前端检测

### Task 31: 节点编辑器基础
**描述：** 检测节点编辑器核心功能
**验收标准：**
- [ ] 节点编辑器打开正常
- [ ] 添加节点功能正常
- [ ] 节点拖拽/连线正常
- [ ] 节点属性面板正常
- [ ] 删除节点/连线正常
- [ ] 撤销/重做正常

**涉及文件：**
- `src/components/node-editor.tsx`
**预估范围：** 大

### Task 32: 工作流执行
**描述：** 检测工作流执行功能
**验收标准：**
- [ ] 工作流执行启动正常
- [ ] 节点状态更新正常
- [ ] 执行日志显示正常
- [ ] 取消执行正常
- [ ] AI 自然语言建图正常
- [ ] 预设工作流加载正常

**涉及文件：**
- `src/components/node-editor.tsx`
- `src/lib/workflow-engine.ts`
**预估范围：** 大

### Task 33: 节点类型完整性
**描述：** 检测所有 30+ 节点类型
**验收标准：**
- [ ] 输入节点（input-text, input-image）正常
- [ ] AI 图像节点（ai-generate, ai-remove-bg 等）正常
- [ ] AI 视频节点（ai-video-generate, ai-video-i2v）正常
- [ ] 控制节点（condition, loop, agent）正常
- [ ] 输出节点（output-image, output-export 等）正常
- [ ] 画布模式专用节点正常

**涉及文件：**
- `src/lib/workflow-engine.ts`
- `src/components/node-editor.tsx`
**预估范围：** 大

---

## 检查点：第4阶段完成后
- [ ] 节点编辑器所有功能正常
- [ ] 工作流执行链路完整
- [ ] 所有节点类型可用

---

## 第5阶段：智能对话窗口检测

### Task 34: 智能对话基础
**描述：** 检测智能对话窗口核心功能
**验收标准：**
- [ ] 对话界面渲染正常
- [ ] 消息发送/接收正常
- [ ] SSE 流式响应正常
- [ ] 模型选择器正常（聊天模型+图像模型）
- [ ] 同名模型选择正确（providerId+modelId 复合判断）
- [ ] 历史记录正常

**涉及文件：**
- `src/components/simple-chat/chat-area.tsx`
**预估范围：** 大

### Task 35: 联网搜索功能
**描述：** 检测智能对话联网搜索
**验收标准：**
- [ ] 联网搜索触发正常
- [ ] 搜索结果卡片显示正常
- [ ] 搜索结果包含标题/链接/摘要
- [ ] 搜索结果数量正确

**涉及文件：**
- `src/components/simple-chat/chat-area.tsx`
- `src/app/api/simple-chat/chat/route.ts`
**预估范围：** 中

### Task 36: 知识库功能
**描述：** 检测知识库相关功能
**验收标准：**
- [ ] 知识库文件上传正常
- [ ] 知识库文件预览正常（图片/文本/其他）
- [ ] 知识库引用正常
- [ ] 知识库搜索正常

**涉及文件：**
- `src/components/simple-chat/chat-area.tsx`
**预估范围：** 中

### Task 37: Skills 系统
**描述：** 检测 Skills 功能
**验收标准：**
- [ ] Skills 面板显示正常
- [ ] 预设 Skills 列表正确（仅办公类）
- [ ] Skill 调用正常
- [ ] Skill 参数注入正常
- [ ] 自定义 Skill 创建正常

**涉及文件：**
- `src/components/simple-chat/chat-area.tsx`
- `src/components/simple-chat/simple-chat-types.ts`
**预估范围：** 中

### Task 38: Deep Research 功能
**描述：** 检测深度研究功能
**验收标准：**
- [ ] Deep Research 入口正常
- [ ] 研究任务提交正常
- [ ] 研究进度显示正常
- [ ] 研究结果展示正常

**涉及文件：**
- `src/components/simple-chat/chat-area.tsx`
- `src/app/api/simple-chat/deep-research/route.ts`
**预估范围：** 中

### Task 39: 智能对话侧边栏
**描述：** 检测侧边栏功能
**验收标准：**
- [ ] 项目列表显示正常
- [ ] 新建项目正常
- [ ] 切换项目正常
- [ ] 删除项目正常
- [ ] 主题切换正常

**涉及文件：**
- `src/components/simple-chat/sidebar.tsx`
- `src/components/simple-chat/theme-toggle.tsx`
**预估范围：** 中

---

## 检查点：第5阶段完成后
- [ ] 智能对话所有功能正常
- [ ] 联网搜索/知识库/Skills/Deep Research 可用
- [ ] 侧边栏项目管理正常

---

## 第6阶段：管理员仪表盘检测

### Task 40: 用户管理
**描述：** 检测管理员用户管理功能
**验收标准：**
- [ ] 用户列表显示正常
- [ ] 新建用户抽屉正常（点击不关闭）
- [ ] 新建用户提交正常（有 toast 反馈）
- [ ] 用户详情抽屉正常
- [ ] 模型权限多选正常
- [ ] 用户状态切换正常
- [ ] 功能权限默认全部启用

**涉及文件：**
- `src/components/dashboard/admin-tabs.tsx`
- `src/components/dashboard/dashboard-view.tsx`
**预估范围：** 大

### Task 41: API 提供商管理
**描述：** 检测 API 提供商管理功能
**验收标准：**
- [ ] API 列表显示正常
- [ ] 添加 API 提供商正常
- [ ] 编辑 API 提供商正常
- [ ] 删除 API 提供商正常
- [ ] 测试连接正常
- [ ] 模型列表加载正常
- [ ] 模型选择/取消选择正常
- [ ] 验证协议按钮正常

**涉及文件：**
- `src/components/dashboard/admin-tabs.tsx`
**预估范围：** 大

### Task 42: 系统设置
**描述：** 检测系统设置功能
**验收标准：**
- [ ] 系统设置页面正常
- [ ] 设置项保存正常
- [ ] 设置项读取正常

**涉及文件：**
- `src/components/dashboard/admin-tabs.tsx`
**预估范围：** 中

### Task 43: 操作日志
**描述：** 检测操作日志功能
**验收标准：**
- [ ] 日志列表显示正常
- [ ] 日志筛选正常
- [ ] 日志详情展开正常
- [ ] AI 分析功能正常
- [ ] 批量操作正常
- [ ] 导出功能正常

**涉及文件：**
- `src/components/dashboard/admin-tabs.tsx`
**预估范围：** 中

### Task 44: 积分与充值
**描述：** 检测积分管理功能
**验收标准：**
- [ ] 积分概览显示正常
- [ ] 充值订单管理正常
- [ ] 用户积分查询正常

**涉及文件：**
- `src/components/dashboard/admin-recharge-orders.tsx`
- `src/components/dashboard/user-credits-tab.tsx`
**预估范围：** 中

### Task 45: 桌面端管理
**描述：** 检测桌面端管理功能
**验收标准：**
- [ ] 设备列表显示正常
- [ ] 更新管理正常
- [ ] 配置管理正常

**涉及文件：**
- `src/components/dashboard/desktop-admin-tab.tsx`
**预估范围：** 中

---

## 检查点：第6阶段完成后
- [ ] 管理员仪表盘所有功能正常
- [ ] 用户/API/设置/日志管理可用
- [ ] 无重复/无效 UI 元素

---

## 第7阶段：普通用户仪表盘检测

### Task 46: 登录/注册
**描述：** 检测用户认证功能
**验收标准：**
- [ ] 登录页面渲染正常
- [ ] 登录提交正常
- [ ] 登录成功后跳转正常
- [ ] 登出功能正常
- [ ] 会话保持正常

**涉及文件：**
- `src/components/dashboard/login-panel.tsx`
- `src/app/api/auth/login/route.ts`
**预估范围：** 中

### Task 47: 用户设置
**描述：** 检测用户个人设置
**验收标准：**
- [ ] 用户设置页面正常
- [ ] 密码修改正常
- [ ] 个人信息更新正常

**涉及文件：**
- `src/components/dashboard/user-settings-tab.tsx`
**预估范围：** 小

### Task 48: 数据管理
**描述：** 检测用户数据管理功能
**验收标准：**
- [ ] 数据管理页面正常
- [ ] 数据同步正常
- [ ] 项目导入/导出正常

**涉及文件：**
- `src/components/dashboard/data-manager-tab.tsx`
**预估范围：** 中

### Task 49: 项目仪表盘
**描述：** 检测项目仪表盘整体
**验收标准：**
- [ ] 仪表盘布局正常
- [ ] Tab 切换正常
- [ ] 数据加载正常
- [ ] 响应式布局正常

**涉及文件：**
- `src/components/dashboard/dashboard-view.tsx`
**预估范围：** 中

---

## 检查点：第7阶段完成后
- [ ] 普通用户所有功能正常
- [ ] 登录/设置/数据管理可用
- [ ] 项目仪表盘正常

---

## 第8阶段：跨模块集成检测

### Task 50: 画布↔聊天联动
**描述：** 检测画布和聊天面板的联动
**验收标准：**
- [ ] 选中图片后聊天面板切换模式
- [ ] @ 引用系统正常
- [ ] 品牌资产跨面板注入正常

**涉及文件：**
- `src/components/infinite-canvas.tsx`
- `src/components/chat-panel.tsx`
**预估范围：** 中

### Task 51: 画布↔节点联动
**描述：** 检测画布和节点编辑器的联动
**验收标准：**
- [ ] 从画布切换到节点模式正常
- [ ] 节点模式数据同步正常
- [ ] 工作流结果回到画布正常

**涉及文件：**
- `src/components/infinite-canvas.tsx`
- `src/components/node-editor.tsx`
**预估范围：** 中

### Task 52: 数据持久化完整性
**描述：** 检测数据持久化链路
**验收标准：**
- [ ] 数据库连接正常
- [ ] 用户数据读写正常
- [ ] API 提供商配置持久化正常
- [ ] 系统设置持久化正常
- [ ] 文件迁移正常

**涉及文件：**
- `src/lib/db-client.ts`
- `src/lib/db-storage.ts`
**预估范围：** 中

---

## 检查点：第8阶段完成后
- [ ] 跨模块联动正常
- [ ] 数据持久化完整
- [ ] 无数据丢失风险

---

## 风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| API 密钥未配置导致功能不可测 | 高 | 使用 mock 或跳过需要真实 API 的测试 |
| 数据库连接失败 | 高 | 检查 PGDATABASE_URL 环境变量 |
| 外部服务不可用（视频/3D/品牌） | 中 | 仅检测 API 路由可达性和参数验证 |
| 前端组件依赖链复杂 | 中 | 按依赖图自底向上检测 |
| 修复引入新 bug | 高 | 每次修复后运行完整静态检查 + 回归测试 |

## 待解决问题
- 需要确认管理员 API 密钥是否已配置
- 需要确认数据库连接是否正常
- 需要确认外部 API 服务是否可用

## 执行策略
按照 program-repair-auditor 工作流：
1. **建立基线**：先运行 Task 1-4 静态检查
2. **逐阶段检测**：按阶段顺序执行，每个检查点验证后再继续
3. **诊断优先**：发现问题先诊断根因，不急于修复
4. **受控修复**：每次只修复一个问题，修复后立即验证
5. **回归保护**：修复后运行完整静态检查确保无新问题
6. **证据驱动**：每个修复必须有验证证据（日志/截图/测试结果）

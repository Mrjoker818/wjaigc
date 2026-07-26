# 无界AI 更新说明 (CHANGELOG)

所有版本的重要变更都会记录在此文件中。版本号遵循语义化版本（MAJOR.MINOR.PATCH）。

---

## v4.0.0（2026-07-20）

### ✨ P0 核心新功能

#### 1. 元素拆解全面升级（原美陈拆解）
- 功能标题从「美陈拆解」改名为「元素拆解」，适配任意画面类型
- 通用化拆解 prompt，支持任意视觉内容的结构化分析
- 两阶段流程确保拆解质量 + 透明PNG输出，新增自动去背景开关
- 拆解面板从 toolbar 块内移出为独立 fixed 浮层，修复右键菜单触发时序问题
- 强化结果契约与模型授权校验

#### 2. ChatCanvas 批注融合升级
- 安装 ChatCanvas 融合批注 r3/r4 升级包，通过安全门禁审计
- 修复批注 projectId 兜底、Shift+数字快捷键
- 移按钮至折叠区末尾

#### 3. 品牌 IP 设计工场修复与增强
- 恢复三栏设计工场界面与样式
- 补充资产类型与生命周期存储能力（收藏/归档）
- 恢复资产交互并优化工作台可读性
- 提升异步任务恢复与权限隔离

#### 4. 用户注册系统
- 实现用户注册系统，含防恶意注册措施（验证码/频率限制）
- 管理员可开关注册功能

### 🐛 Bug 修复
- **Midjourney quality 参数修复**：修复 quality 参数类型与尺寸比例格式校验
- **视频链路修复**：PearAPI 视频轮询解析扁平响应格式、修复 Pear 视频供应商模型 ID；修复 APImart/PearAPI resolution 大小写问题
- **积分系统修复**：积分规则模型分类使用 inferModelType 替代提供商类型；修复管理员仪表盘积分系统多个问题
- **API 管理面板修复**：模型列表仅显示已启用模型，编辑时才显示全部
- **视频模型分类修复**：修复视频模型分类关键词与模型发现过滤逻辑
- **底部工具栏修复**：修复选择工具按钮无响应
- **管理员面板修复**：修复系统设置无法保存的问题
- **CSP 安全修复**：frame-ancestors 添加 coze.cn 允许 IDE 预览面板嵌入；移除 X-Frame-Options
- **Oh My Prompt 修复**：修复浮动窗口不显示的问题
- **放大超时修复**：完善异步错误保真与 Auto 降级审计

### 🚀 新功能
- **Oh My Prompt 灵感工坊识词升级**：分类显示+按类发送/复制
- **AI Link 视频协议适配器**：新增 AI Link 视频API协议适配器
- **4K/8K 放大预设**：接入 2x、4x、4K 与 8K 放大预设
- **超时主动推送**：P1 超时主动推送预计剩余时间
- **18 个工具后端 API 冒烟测试**：全量通过

### 🔧 工程与运维
- 完成无界项目规模与工程质量评级
- 制定无界平台企业级升级计划
- 完成 API 供应商图像和视频模型真实链接测试报告
- 所有安全修复验证通过（lint/ts-check/service_probe 全绿）

---

## v3.9.0（2026-07-08）

### ✨ P0 核心新功能

#### 1. 四大编辑工具本地能力 + AI 引擎选择器
- 放大 / 去背景 / SVG 描摹 / 元素分层 四大功能统一支持**三档引擎选择**：🤖自动（云端优先+本地兜底）/ ☁️云端AI / 💻本地
- 底部工具栏新增 ⚙️ **AI 引擎设置** 按钮，可按工具独立选择偏好，localStorage 持久化
- **本地擦除**：OpenCV inpaint 双算法（TELEA + NS）融合 + 边缘羽化，无需 torch/深度学习依赖
- **本地去背景**：rembg + ONNX Runtime 方案，支持 BiRefNet/U2Net/Silueta 三模型自动回退，自动边缘颜色修复
- **本地放大**：upscayl-node NCNN 引擎 + ONNX Runtime 推理
- **本地 SVG**：vtracer（彩色）+ potrace（黑白）双引擎
- **本地分层**：连通域分析分割前景主体
- Python 依赖通过 `scripts/bootstrap-local-tools.sh` 启动时自动安装（pip --target 持久化目录），无需 torch 200MB+ 大包

#### 2. FHL 等代理平台出图参数一致性修复
- **模型名归一化重构**：`normalizeModelForApi` 新增 `preserveTier` 逻辑，对非官方 OpenAI 域名（FHL/funai/自定义代理）保留 `-2k`/`-hd` 分辨率后缀，避免错误回退到 1K 默认
- **gpt-image-2-2k 完整支持**：MODEL_SPECIFIC_PIXEL_SIZES 新增三档尺寸（low=1536 / medium=2048 / high=2048 基准）
- **size 参数强制覆盖**：generate 主流程在 filterRequestForModel 之后用 `finalOutputSize` 覆盖 body.size，防止模型能力过滤覆盖正确像素尺寸
- **参考图主体保持增强**：存在参考图/图生图时自动注入主体保持强提示，保持人物/角色外观一致
- **Responses API 路径优化**：检测代理平台直接走 Responses API SSE 流式，跳过不存在的 /images/generations 端点尝试，节省 60-90s 无效等待
- **私有 IP 误判修复**：代理域名跳过私有 IP 检查，避免触发 URL 替换/非流式回退/chat 三级回退
- **data:URL 直接解码**：SSE 中 data:/blob: 图片直接 base64 保存，不重复走网络下载
- 修复后 FHL/funai 等代理的实际耗时从 3 分钟收敛到接近后台真实出图时间（80-100s），2K 尺寸和参考图强度正确传递

### 🐛 Bug 修复
- **精修引擎模型选择器**：修复模型列表供应商全部显示"未知提供商"问题。根因：refine-engine 路由使用 `p.apiKey` 作为过滤条件，但 `getPublicApiProviders` 返回的是脱敏数据（apiKey 被置空），导致所有 provider 被过滤；已移除脱敏后必为空的条件
- **image-edit/route.ts aiUsedModel 类型错误**：修复 logOpError 传对象而非字符串的 TS2339 报错
- **iopaint-client.ts validModel 未定义**：修复移除 torch 依赖后擦除模型健康检查的变量引用问题
- **segment-elements TS 错误**：回退到稳定版本并增量添加 engine 参数，避免 14 个类型错误
- **EngineSelectDialog 打不开**：修复组件 import 了但未在 JSX 中挂载的问题
- **toast 调用参数错误**：sonner toast 在本项目中接受字符串参数而非 {title, description} 对象
- 其他若干小修复

### 🔧 工程与运维
- 新增 `scripts/bootstrap-local-tools.sh`：启动时自动检测并安装 Python 依赖到持久化目录
- 新增 `scripts/iopaint_removebg.py`：基于 rembg+onnxruntime 的无 torch 去背景
- 新增 `scripts/iopaint_erase.py`：基于 OpenCV inpaint 的无 torch 擦除
- `src/instrumentation.ts`：服务启动时非阻塞异步执行 bootstrap 脚本
- `src/lib/image-tools/config.ts`：自动注入 /space/python-libs 到 PYTHONPATH
- 健康端点 `/api/image/health` 新增 removebg.scriptAvailable、erase script、upscale ONNX 可用性检测
- **文档**：新增全新 USER_GUIDE.md（不含管理员内容）和 CHANGELOG.md

---

## v3.8.0（2026-06）

### ✨ P0 视频导演系统（Video Director）
- 新增 `src/lib/video-director/` 导演核心模块：
  - `prompt-compiler.ts`：6 种导演风格（cinematic/documentary/commercial/music-video/anime/minimal），输出结构化镜头语言 + 统一负向提示词
  - `continuity.ts`：结构化分镜计划（VideoShotPlan）+ 连续性账本（ContinuityLedger）+ 尾帧续写提示词构造
  - `retake-diagnosis.ts`：10 类失败模式诊断（人物变形/角色不一致/动作不符/运镜错误/首尾帧不连贯/参考图污染/风格跑偏/时长不足/镜头过乱/文字水印）
  - `model-capabilities.ts`：视频模型导演能力档案
  - `reference-binding.ts`：参考资产语义绑定（角色/场景/风格/构图/运动/光线/摄像机/声音/首帧/尾帧 10 类）
- 3 个导演 API：
  - `POST /api/video/director/prompt`：导演增强
  - `POST /api/video/director/shot-plan`：AI 分镜
  - `POST /api/video/director/diagnose`：失败诊断
- 视频生成/延长集成导演增强：支持 useDirector + directorStyle 参数
- 视频生成面板升级：两列布局、导演风格选择器、AI 导演增强、AI 分镜、结构化镜头卡片
- P3 尾帧续写闭环：`/api/video/extract-frame` ffmpeg 抽帧 API，支持 first/last/at/N-grid 四种模式；多镜头流水线自动尾帧接力
- 参考图语义角色标签、镜头卡片内联编辑/重排/重拍诊断/删除/状态徽标

---

## v3.7.0（2026-05）

### ✨ P0 管理员操作日志系统
- 新增 `op-log.ts`：logOpSuccess/logOpError/logOpWarn 快捷函数，40+ 操作类型
- 扩展 `wujie_audit_log` 表：level/error_message/stack_trace/request_data/response_status/duration_ms/model/provider_id/resolution_status 等列
- **15 个 API 路由集成日志**：generate / chat / image-edit / edit / video/generate / video/extend / workflow/execute / image-to-3d / refine-engine / agent-edit / font-design/generate-image / brand-ecommerce / design/vectorize / svg-trace / segment-elements
- `POST /api/admin/op-log`：查询/统计/AI分析/修复/批量删除/导出
- AI 日志分析：调用 LLM 分析错误根因并给出修复建议
- 智能修复脚本（重置配额/切换模型/调整参数）
- 管理员面板"操作日志"Tab：统计卡片+筛选+详情+AI分析

### 🐛 FHL API 兼容性修复
- Responses API SSE 解析增强：支持 `response.output_text.done/delta`、Markdown 图片 URL 提取
- FHL 私有 IP 图片 URL 三级回退：域名替换 → 非流式 responses → chat/completions
- 服务端代理下载私有 IP 图片（downloadAndSaveImage）
- api-compatibility 新增渠道不可用错误模式匹配
- api-error-translator 新增 FHL 特定错误中文翻译

---

## v3.5.0

### ✨ P0 图片转 3D 全面升级
- 三种模式：单图转3D / 多图转3D / 文生3D
- 四家提供商：Hunyuan3D 3.0/3.1 / Meshy 5/6 / Tripo / Rodin
- 高级参数：PBR 材质 / 目标面数 / A-Pose/T-Pose / GLB/OBJ/FBX/USDZ/STL 导出
- 自动多视角生成：AI 先生成 4 视角图再合并转 3D
- Meshy SSE 流式进度、重贴图/减面后处理
- 3D 预览器：6 预设视角、3 光照、4 材质显示、自动旋转、多视角缩略图、多格式下载、模型信息、一键截图

### P1 工作流 3D 节点增强
- ai-3d-model 节点字段扩展，image_multi 输入端口支持多张图片

---

## v3.4.0

### ✨ P0 Image-Studio 借鉴升级（5 项容错）
- `api-error-translator.ts`：9 类错误结构化中文翻译（标题+描述+建议+是否可重试）
- `size-auto-repair.ts`：Invalid Size 错误自动修正为 16 对齐合法尺寸
- `responses-api-sse.ts`：Responses API SSE 保活路径，解决 CF 524/504 超时
- `smart-retry.ts`：CF 超时智能重试（3次指数退避）+ Partial Image 兜底
- 集成到 generate/poll-task 路由，Feature Flag 控制

### P0 通用模型能力优化
- `model-capabilities.ts`：覆盖 6 大家族 30+ 模型能力检测（尺寸/质量/Responses API 支持等）
- filterRequestForModel 按模型能力自动过滤不支持参数
- normalizeSizeForModel 按家族约束规范化尺寸（OpenAI 16对齐/Flux 8对齐/SD 64对齐）

---

## v3.3.0

### 🔒 P0 生产环境数据丢失修复
- detectAndRecoverOrphanedUsers：启动时自动检测并恢复孤立用户
- 修复 db-storage.ts 循环依赖、authSecret 警告刷屏、readStore 回退覆盖生产数据
- 临时密码 wujie_reset_2024 恢复孤立账号

### ⚡ P0 任务并发控制
- task-registry 每用户最大 15 并发、全局 500 任务上限、自动排队
- waitForQueueSlot 异步等待函数、超额任务排队

### 🐛 关键 Bug 修复（视频/品牌/轮询链路）
- infinite-canvas 视频编辑 data.taskIds→data.taskId（3 处致命错误）
- poll-task model 参数对象→字符串
- video-edit-panel model/providerId 未传递问题
- brand-kit-panel action 参数错误
- SSE sseBuffer 行级拼接修复跨 chunk JSON 断裂
- node-editor 工作流轮询 300 次上限
- 5 处移除 apiKey 前端传递（安全修复）

---

## v3.2.0

### ✨ P0 视频生成核心功能
- `video-api.ts`：6 种协议适配（dashscope-kling / volcengine-ark / minimax / vidu / openai-video / fal-video）
- 20+ 视频模型注册表、`/api/video/generate` 异步提交+轮询
- `video-player.tsx`：黑金主题播放器（进度条/音量/倍速/全屏/ESC）
- `video-generation-panel.tsx`：模型选择/提示词/比例/时长/模式
- generation-panel 图像/视频 Tab 切换
- 无限画布视频渲染（播放按钮覆盖层/VideoPlayer 弹窗/右键菜单）

### P1 视频增强
- 首帧 / 首尾帧 / 多参考图三模式
- 视频延长 API `/api/video/extend`（可灵 V3/Seedance 等）
- 音效生成（模型支持时动态显示开关）

### P2 视频节点与编辑
- 工作流 3 个视频节点：ai-video-generate / ai-video-i2v / output-video
- Agent 注册 generate_video/extend_video 工具
- `video-edit-panel.tsx`：语言编辑+视频延长，黑金/单色双主题

---

## v3.1.0

### ✨ P0 图片模型信息持久化修复
- CanvasImage 新增 modelName/apiProvider 字段
- 服务器+本地数据字段级合并，保留本地非空字段
- normalizeImageUrls/loadProjectsFromServer 自动回填 modelName
- modelProviderMap 支持纯 modelId 和 providerId::modelId 双格式

### 🔌 P0 扩展命令 gemini-image 协议修复
- submitImageTask 新增 gemini-image 协议检测 + buildGeminiChatImageRequest
- isGeminiImageModel 精确检测，避免非 Gemini 被错误跳过

### 🎯 P0 images[].image_url 格式适配
- adjustRequestForProfile 新增 image/image_urls → images[{image_url:{url}}] 转换，修复 "images[].image_url is required"

### 🔍 P0 精修引擎与表情助手修复
- submitRefineToApi 新增 gemini-image 专用路由
- selectedModel 从纯 modelId 改为 providerId::modelId，修复多供应商同名 bug
- 表情助手并发控制 + 串行逐张生成

---

## v3.0.0

### ✨ P0 SVG 智能描摹全面升级
- VTracer 预处理管道：小图智能放大、中值滤波减噪、低精度预量化
- AI SVG 工程师 Prompt（角色定义+7步流程+1:1还原+220路径限制+禁止 base64/image/foreignObject）
- AI SVG 重试机制、sanitizeAIGeneratedSvg 安全过滤
- 路径数质量控制（>900 路径提示保留 PNG）
- design/vectorize 同步升级

### 🎨 P0 移除背景边缘修复
- repairEdgeColors 半透明边缘像素颜色加权混合，消除抠图锯齿
- 所有去背景策略（IOPaint/AI原生透明/本地透明化）统一应用边缘修复

### ⚡ P0 放大超时修复 + 任务注册
- 放大异步任务注册到 task-registry
- submitImageTask/autoTrySubmitImageTask 传播 provider 信息
- pollForResult 缓存 providerId
- 放大 fetch 添加 5 分钟 AbortController 超时

### 🧩 P1 26+ 模型参数适配
- MODEL_QUALITIES / MODEL_PIXEL_SIZES / MODEL_SPECIFIC_PIXEL_SIZES 扩展到 26-33 个模型
- 修正 Seedream 5.0 Lite/4.5、新增 Kling V3、Ideogram、SD-XL、HiDream、Flux 等

### 🔗 P1 节点模式与画布对齐
- 节点编辑器模型名称显示友好化
- quality/aspectRatio 按模型动态更新
- buildNodeExecutionRequest 统一使用 calculateActualPixels

---

## v2.9.0

### 🎯 P0 RemoveBG 同时输出透明图+蒙版图
- 移除背景同时生成透明 PNG 和黑白蒙版 PNG，两图并排添加到画布
- remove-bg-postprocess 重构：Python 端完成蒙版处理（膨胀+模糊+应用），Node.js 仅保存文件
- API 响应新增 maskUrl 字段

### ⚡ P0 任务基础设施升级
- `task-registry.ts`：统一任务注册/状态追踪/SSE推送/取消/队列
- `/api/cancel-task`、`/api/task-events`（SSE）、`/api/queue-position`
- `task-events-client.ts`：前端 SSE 客户端自动连接/重连/降级
- 处理框新增取消按钮

### 📦 P0 图片压缩上传
- `image-compress.ts`：前端 canvas 压缩 + 尺寸限制
- save-image 后端 sharp 压缩（maxWidth/maxHeight/quality/format）
- 超 4MB/2048px 自动缩放压缩

### 🔌 P1 API 协议验证
- `/api/verify-protocol`：一键验证兼容性（模型列表/图片生成/对话）
- pass/warn/fail 三档结果，管理员面板每个提供商旁新增验证按钮

### 🤖 P2 Agent 编排
- `agent-engine.ts`：工具注册表+Agent 循环（思考→选工具→执行→再思考）
- `agent-editor.tsx`：黑金/单色双主题面板
- `/api/agent-edit`：异步提交+轮询
- 注册 4 个工具：image_edit / generate_image / analyze_image / adjust_color
- 安全限制：最大 10 轮、单轮 60s、全局 5min 超时

### 🧹 IOPaint 本地集成
- 擦除：LaMa 默认 / ZITS 结构保持 / Anime-Lama 动漫
- 去背景：BiRefNet通用 / U2Net轻量快速 / Silueta轻量人像
- Python 子进程模式（无需启动独立服务）+ HTTP 兼容
- `scripts/download-iopaint-models.sh` 模型下载脚本
- 健康检测报告 4 模型可用性

---

## v2.8.0

### ✨ SVG 智能描摹
- `/api/svg-trace`：彩色 vtracer + 黑白 potrace
- 4 档质量预设（64/256/1024/4096 色）+ 自定义参数
- 温和颜色合并、多策略降级（矢量API → LLM fallback → 本地 vtracer）
- PNG 预览生成，画布显示 PNG、下载输出完整 SVG

### ✨ 语言修图
- `/api/edit`：OpenAI（GPT Image 2/DALL·E 3+蒙版）+ Gemini（纯文字）
- 异步提交+轮询，SSE 兼容解析，5 分钟全局超时
- ImageEditor 黑金面板，画笔/橡皮/清除，5 模型 3+2 网格布局
- 尺寸 1024/1536/2048、质量低/中/高选择

### 🎯 擦除/蒙版 AI 增强
- 擦除：AI 全图发送+蒙版精确合成 + BFS 边界扩散兜底
- 蒙版：AI 优先生成 + 后端精确合成，8px 边缘羽化
- 图片编辑异步任务统一提交+轮询模式
- persistImageBuffer 三级 fallback：S3 → save-image → base64

### 🔌 API 兼容层升级
- 5 种兼容配置文件：openai / openai-async / apimart / auto / custom
- resolveCompatProfile / adjustRequestForProfile / parseResponseForProfile / buildPollUrl
- JSON 优先 → multipart/form-data 降级

---

## v2.7.0

### 🔄 客户端数据服务器同步
- UserManagerCore.syncToServer()/loadProjectsFromServer()
- 每次 saveData 后 2 秒防抖同步到数据库
- `/api/user-data/sync` GET/POST 读写 wujie_user_data
- 管理员面板数据统一服务器 API+数据库，不再 fallback localStorage

### 📐 z-index 层级规范
- 重构全局 z-index：90 认证覆盖层 → 100 UserManager → 200/201 Dialog
- 修复新建项目弹窗被 UserManager 遮挡 bug

### 💾 组数据持久化修复
- beforeunload/退出登录保存 groupId+metadata.groups
- 自动保存后同步 currentProject React 状态
- localStorage 独立兜底机制

---

## v2.6.0

### 💾 P0 数据库持久化
- 管理员系统数据从文件系统迁移到 PostgreSQL
- `db-client.ts`：PostgreSQL 连接池（PGDATABASE_URL/DATABASE_URL）
- `db-storage.ts`：CRUD + 文件迁移
- `instrumentation.ts`：启动时自动迁移文件数据到数据库
- 存储策略：读先 DB 后文件，写双写
- 用户认证/API 配置更新为 DB 优先

### 🔌 API v1 重试
- `fetchWithV1Retry()`：先试原始 URL，失败重试带 /v1
- 所有 API 路由统一使用

### 🛠️ 管理员系统增强
- 测试连接支持 providerId 参数，扩大成功状态码范围（200/400/422/429/500+）
- 图片自动居中，帮助文字更新

---

## v2.5.0

### 🎨 参考图与图生图类别统一
- 右键"生成变体"改为"发送参考图"，点击直接添加到参考图列表
- 参考图/图生图类别统一为 6 大类：风格/构图/场景/色彩/主体/细节
- 参考图每张最多选 2 项，图生图 6 类全可选+独立强度滑块

### 🛠️ 工具栏功能提示优化
- 各按钮添加明确功能说明文字
- 除扩展和裁切外所有编辑保持原图比例

### ⚙️ 管理员系统
- API 类型精简为 5 种：图像/LLM/3D/矢量/分层
- 自动识别模型，默认不选中，管理员手动选择
- 全选/取消全选按钮
- API 用量分析和余额显示 `/api/admin/api-balance`

### 🔧 擦除/蒙版修复
- 蒙版检测核心 bug 修复：canvas 导出 PNG alpha 全为 255→改用 RGB 亮度阈值
- 移除 OpenCV 修复引擎，改为 AI 生成+蒙版合成策略

---

## v2.4.0

### 🔑 服务器端 API 密钥管理
- 移除前端内置模型列表和 API Key 输入框
- 模型列表通过 `/api/models?type=image|chat` 从服务器加载
- 第三方模型对话框支持自定义端点和模型
- getApiKey 返回 'server-managed'，后端 findProviderForModel 查找密钥
- `/api/generate`、`/api/chat`、`/api/image-edit` 等路由统一服务器密钥
- 侧边栏管理员按钮（仅管理员可见）

---

## v2.3.0

### 🖼️ 图生图功能
- 黑金配色浮动面板（#1a1a1a + #d4af37）
- 四个参考类别（风格/构图/角色/IP）默认全选+独立强度滑块 0-100%
- "当前图片描述"一键填充、反向提示词自动填充默认值
- 可拖拽 textarea、全宽金色生成按钮
- 结果比例与原图一致，生成在原图右侧并连线

### 🐛 Bug 修复
- editImageId 未设置导致点击无反应
- /api/poll-task 从 GET 改为 POST（405 修复）
- taskIds 数组解析
- generation-panel effectiveApiKey 作用域错误

---

## v0.4.0

### 🎨 图像生成面板
- 画面比例图形预览（矩形按比例显示）
- 扩图缩放比例选项（原始/1x/1.5x/2x/3x/4x）

### ⌨️ Ctrl+Z 撤回优化
- 移除 toast 提示，historyStackRef+historyIndexRef 纯 ref 管理
- handleUndo 直接调用 setImagesRaw，快速连续撤回流畅无卡顿

---

> 更早版本（v0.1 - v2.2）为早期开发版本，功能逐步迭代完善，不再单独列出。

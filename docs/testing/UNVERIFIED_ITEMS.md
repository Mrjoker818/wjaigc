# 无界AI — 未验证项目清单 (UNVERIFIED ITEMS)

## 当前增量：2026-08-31

- **防重复校正：** WASM 历史 `V588-SAFETY-001` 是 `V588-STABILITY-001` 的已验预算子范围；AUTH-001 管理员同 secret 冷启动、ADMIN-003 历史软归档均已云端验证，不重复实施。其他引擎/异常输入、普通用户重启会话、缩略图交付/回退/S3 恢复仍按原边界保留，不自动关闭。
- **PROVIDER-003 保留：** 非路由导出拆分和 AST 门禁已在 main，当前 193 个路由合同及相关专项 11/11；不再列为待开发。品牌/精修/字境专项云端业务证据与原始 RED 日志关联尚不齐，不能仅凭构建成功标记整体吸收。
- **已解除本地数据库跳过：** PostgreSQL 18.4 独立临时集群完成最终全量 `4413/4413`、0 跳过。此前 123 项环境跳过不再是本地阻塞；Coze 旧运行的 123 跳过记录仍保留为历史事实。
- **ADMIN-004 保留：** 云端 post-done tree、运营总览接口正文、最后再次强刷和完整新鲜日志。原 Chrome 标签接管超时，不能写成通过。
- **PROVIDER-002 保留：** JSONB 空授权编码新补丁的部署验证，以及普通用户 `/api/models`、无限画布、节点、独立聊天中的真实可见性。管理员投影真库测试只模拟身份，不替代登录 E2E。
- **Pear 保留：** `002-B/002-D/002-E` 按用户决定延期，不创建新付费任务，不阻挡其他已批准吸收。
- 源码候选 `bd9655b88ec037a0ebb6891addaba19a8280240f` 已通过生产构建 118/118 和干净保护基线 38/38、0 漂移、0 warning；无需重复本轮本地门禁。权威记录：`docs/testing/evidence/v588-admin-provider-postgres-20260831.json`；下方旧日期条目只作历史追溯。

> 生成时间：2026-07-20
> 说明：以下功能/场景因环境限制或API配额原因未纳入本次自动化测试范围，建议后续版本补充验证。

---

## 未验证功能模块

### 1. 视频生成与编辑
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 文生视频 | 需要视频模型API配额 | 手动测试 + 补充E2E |
| 图生视频（首帧驱动） | 需要视频模型API配额 | 手动测试 |
| 首尾帧驱动 | 需要支持首尾帧的模型 | 手动测试 |
| 视频延长 | 需要支持延长的模型 | 手动测试 |
| 视频编辑（语言编辑） | 需要视频模型API配额 | 手动测试 |
| 视频导演系统 | 需要LLM+视频模型配额 | 手动测试 |

### 2. 3D 模型生成与预览
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 单图转3D | 需要3D模型API配额（Hunyuan3D/Meshy/Tripo/Rodin） | 手动测试 |
| 多图转3D | 需要3D模型API配额 | 手动测试 |
| 文生3D | 需要3D模型API配额 | 手动测试 |
| 3D后处理（重贴图/减面） | 需要3D模型API配额 | 手动测试 |
| 3D预览器交互 | 需要生成的3D模型文件 | 手动测试 |

### 3. 工作流节点模式
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| AI自然语言建图 | 需要LLM API配额 | 手动测试 |
| 工作流串行执行 | 需要图像生成API配额 | 手动测试 |
| 节点复制粘贴 | 纯前端交互，可补充E2E | 补充E2E |
| ComfyUI工作流导入 | 需要ComfyUI格式JSON | 手动测试 |
| 连线语义类型 | 纯前端交互，可补充E2E | 补充E2E |

### 4. Agent 编排
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| Agent多轮编辑 | 需要LLM+图像API配额 | 手动测试 |
| 工具自动选择 | 需要LLM API配额 | 手动测试 |

### 5. 品牌系统
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 品牌DNA生成 | 需要LLM API配额 | 手动测试 |
| 品牌电商套图 | 需要图像生成API配额 | 手动测试 |
| 品牌包装设计 | 需要图像生成API配额 | 手动测试 |

### 6. 字境大师
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 字体设计方案 | 需要LLM API配额 | 手动测试 |
| 提示词生成 | 需要LLM API配额 | 手动测试 |
| 字体图片生成 | 需要图像生成API配额 | 手动测试 |

### 7. 高级编辑功能
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 擦除（IOPaint） | 需要本地IOPaint服务运行 | 手动测试 |
| 蒙版修图 | 需要AI模型API配额 | 手动测试 |
| 无损放大 | 需要upscayl模型或AI API | 手动测试 |
| 无损放大Pro | 需要PearAPI配额 | 手动测试 |
| 移除背景 | 需要IOPaint或AI API | 手动测试 |
| 扩展画面 | 需要AI模型API配额 | 手动测试 |
| 语言修图 | 需要OpenAI/Gemini API配额 | 手动测试 |
| SVG智能描摹 | 同步 WASM 大图路径已在 Coze exact `d968ad3` 真实验证；Python VTracer、AI/Vectorizer、ImageTracer 与 Potrace 路径仍未形成同等云端证据 | 按引擎分别执行真实图片、终态、下载与 Console/服务日志验证 |
| 元素分层 | 需要分层模型API配额 | 手动测试 |

### 8. 画布高级交互
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 多选拖拽 | 纯前端交互 | 补充E2E |
| 框选 | 纯前端交互 | 补充E2E |
| Ctrl+Z撤回 | 纯前端交互 | 补充E2E |
| PSD导出 | 需要ag-psd库环境 | 手动测试 |
| SVG导出 | 需要vtracer环境 | 手动测试 |
| 裁切 | 纯前端交互 | 补充E2E |

### 9. AI 聊天面板
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| 聊天对话 | 需要LLM API配额 | 手动测试 |
| 提示词优化 | 需要LLM API配额 | 手动测试 |
| Skills系统 | 纯前端+localStorage | 补充E2E |
| @引用系统 | 纯前端交互 | 补充E2E |
| Tab模式 | 纯前端交互 | 补充E2E |

### 10. 管理员后台
| 项目 | 原因 | 建议验证方式 |
|------|------|-------------|
| API提供商管理 | 需要管理员权限 | 手动测试 |
| 用户管理 | 需要管理员权限 | 手动测试 |
| 操作日志 | 需要管理员权限 | 手动测试 |
| API余额分析 | 需要管理员权限 | 手动测试 |

---

## 未验证非功能性场景

| 场景 | 原因 | 建议 |
|------|------|------|
| 高并发压力测试（100+并发用户） | 测试环境资源限制 | 使用 k6/JMeter 单独执行 |
| 长时间稳定性测试（24h+） | 测试周期限制 | 生产环境监控 |
| 弱网环境测试 | 测试环境为本地网络 | 使用 Chrome DevTools 网络节流 |
| 数据库故障恢复 | 生产环境数据库不可中断 | 灾备演练 |
| CDN/静态资源缓存 | 测试环境无CDN | 生产环境验证 |

---

## 建议的后续测试计划

### 优先级 P1（下一版本应补充）
1. 补充画布交互 E2E 测试（多选/框选/撤回/裁切）
2. 补充聊天面板 E2E 测试（Skills/@引用/Tab模式）
3. 补充工作流节点 E2E 测试（复制粘贴/连线语义）

### 优先级 P2（有API配额后补充）
1. 视频生成全流程 E2E 测试
2. 3D模型生成与预览 E2E 测试
3. Agent编排多轮编辑 E2E 测试
4. 品牌系统全流程 E2E 测试

### 优先级 P3（长期改进）
1. 高并发压力测试
2. 长时间稳定性测试
3. 弱网环境测试
4. 灾备恢复演练

## 2026-07-29 Pear 混合分层未验证项

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| 真实 Pear 云端分层 | 未验证 | 部署包含 Task 1-9 的提交；配置授权的 `image-layered` provider/model；执行一次付费 Chromium E2E |
| 三模式 UI（智能/云端/本地） | 仅本地代码与契约测试通过 | 新版本部署后在 Chrome、Firefox、WebKit 分别验证入口与切换 |
| 本地分层浏览器完整链路 | 阻塞 | 已执行 Chromium 并保存全部证据；需配置可用 PostgreSQL、生产鉴权密钥和有效 E2E 账号后重跑 |
| PostgreSQL 并发幂等 | 未验证 | 提供隔离的 `LAYER_TEST_DATABASE_URL`，运行 PostgreSQL 并发测试 |
| 一次扣费/一次退款 | 未验证 | 真实数据库 + 授权 Pear 模型下执行并发重复、取消、超时、失败场景 |
| PSD 下载、刷新恢复、重新打开 | 未验证 | 新版本部署后保存项目并执行浏览器回归 |
| 节点模式真实执行 | 未验证 | 新版本部署后在 `ai-segment` 节点执行一次本地和一次 Pear 分层 |
| 跨浏览器证据 | 未验证 | 带有效凭据运行 Firefox/WebKit 非付费分层套件并保存 trace/video/screenshot |

2026-07-29 已使用本地生产构建执行一项 Chromium 分层冒烟，登录接口返回 503；截图、视频、Trace、Console 和网络日志均已生成。该失败是环境阻塞，不证明分层功能通过或失败。无凭据跳过结果同样只证明门禁正确拒绝执行，不证明功能可用。

### 2026-07-29 第二轮状态

- 同源媒体 403 已解除，不再属于未验证项。
- 真实 Pear 调用目前被历史模型类型过滤阻断；本地兼容修复通过，待部署后重新执行。
- PostgreSQL 两项并发测试已实际启动但均因 `TEST_POSTGRES_URL` 缺失而跳过。
- Firefox/WebKit 命令已实际启动，但 Coze 预览地址对独立 HTTP 客户端返回 404，且无可独立登录的测试凭据，未产生可宣称通过的浏览器证据。

### 2026-07-29 09850e3 后续未验证项

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| Coze 配置域名同源归一化 | 本地通过，云端未验证 | 部署新提交后使用同源 `serve-upload` 图片重试 Pear |
| Pear 成功终态 | 未验证 | 获得 Pear task、PSD 下载地址与至少 2 个可编辑图层 |
| 新结算 SQL 的 PostgreSQL 并发 | 未验证 | GitHub PostgreSQL 16 job 通过一次扣费、一次退款、终态竞争 |
| 云端失败退款 | 未验证 | 真实失败后出现同 taskId 的一笔退款，余额恢复 |
| 历史错误扣费补偿 | 未完成 | 核对 08:13、10:05、10:10 三笔记录并按失败任务状态补偿 |
| Firefox/WebKit | 阻塞 | 配置 `E2E_BASE_URL`、测试账号密码及分层 provider/model Secrets |

### 2026-07-29 f8f7cef 复测后

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| 客户端同源托管路径修复 | 本地通过，云端未验证 | 部署包含 `normalizeLayerImageUrlForSubmission` 的提交后重试同一黄色纸鹤图片 |
| Pear 官方 `/v1/images/edits` 请求 | 本地协议测试通过，真实调用未验证 | 云端任务进入 `submitting-pear` 并返回同步 PSD 或远程 taskId |
| PSD 与可编辑图层 | 未验证 | 下载有效 `8BPS` 文件并在编辑器显示至少 2 个图层 |
| 成功扣费 | 未验证 | 单个任务只产生一笔 15 积分扣费且余额与流水一致 |
| 取消退款 | 未验证 | 取消处理中的任务，只产生一笔退款且余额恢复 |

### 2026-07-29 活动图片目标修复后

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| 当前图片提交正确性 | 本地通过，云端未验证 | 部署后选中纸鹤并确认请求体为 `/api/serve-upload/generate/img_1783849131687_22nasq.png`，不再是历史 3D URL |
| Pear 真实任务阶段 | 未验证 | UI/接口依次进入 `submitting-pear`、`waiting-for-pear`、`downloading-psd` |
| Pear PSD 结果 | 未验证 | 下载有效 PSD，编辑器显示至少 2 个可编辑图层 |
| PostgreSQL 并发与结算 | 阻塞 | 提供隔离测试数据库；当前全仓测试明确跳过 3 项 PostgreSQL 用例 |
| Firefox/WebKit | 阻塞 | 提供可从独立浏览器访问的 E2E 地址和登录凭据后执行分层回归 |

### 2026-07-29 Pear ZIP 适配后

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| Pear 异步提交 | 本地协议测试通过，云端未验证 | 部署后确认后台任务模式为异步，初始应用 POST 不再等待约 4m30s |
| ZIP 主 PSD 提取 | 本地通过，云端未验证 | 下载真实 Pear ZIP，排除 `_depth.psd` 并成功解析主 PSD |
| 编辑器图层 | 未验证 | ZIP 解析后显示至少 2 个可编辑图层并可保存、刷新恢复 |
| 成功扣费一致性 | 未验证 | 同一个无界 taskId 与 Pear taskId 只产生一次扣费 |
| 失败/取消退款一致性 | 未验证 | 真实 PostgreSQL 下分别执行失败与取消，确认每个任务只退款一次 |

### 2026-07-29 最终本地修复后

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| 云端异步提交 | 未验证 | 部署本次提交后，应用 POST 快速返回 taskId，Pear 后台显示异步任务 |
| 云端阶段进度 | 未验证 | 依次观测 `submitting-pear`、`waiting-for-pear`、`downloading-psd`、`extracting-psd` |
| 云端 ZIP 与编辑器 | 未验证 | 下载真实 ZIP，提取非 depth 主 PSD，编辑器显示至少 2 个可编辑图层 |
| PostgreSQL 并发结算 | 阻塞 | 提供隔离 `TEST_POSTGRES_URL` 并让当前跳过的 2 项并发用例通过 |
| 成功扣费与失败退款 | 未验证 | 同一 taskId 只扣一次；失败或取消只退一次，余额和流水一致 |
| Firefox / WebKit | 阻塞 | 使用可访问预览地址和测试账号完成登录、分层、保存、刷新恢复 |
### 2026-07-29 Pear ZIP MIME 修复后

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| 云端异步提交 | 已验证 | HTTP 202、应用 taskId、`waiting-for-pear` 均已有 Chrome 网络证据 |
| ZIP MIME 下载 | 本地通过，云端未验证 | 部署本次提交后真实下载 Pear ZIP，不再返回 `UNSAFE_REMOTE_IMAGE` |
| 主 PSD 提取 | 未验证 | 排除 `_depth.psd`，验证主 PSD `8BPS` 签名并完成解析 |
| 编辑器图层 | 未验证 | `layer-count` 显示至少 2 个可编辑图层，且图层可选择、隐藏和移动 |
| 本次失败退款 | 未验证 | 核对 taskId `layer_1904e57f-2385-44f1-92a2-038908a0bd36` 只产生一笔扣费和一笔退款 |
| PostgreSQL 并发结算 | 阻塞 | 提供隔离 `TEST_POSTGRES_URL` 并执行并发幂等、迟到完成与退款一致性用例 |
| Firefox / WebKit | 阻塞 | 使用可访问部署地址与测试凭据执行登录、分层、保存及刷新恢复 |

### 2026-07-29 Pear 双栈 DNS 修复后

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| ZIP MIME 与安全下载 | 本地真实制品通过 | 部署本次提交后，预览页任务越过 `downloading-psd` |
| 主 PSD 提取与解析 | 本地真实制品通过 | 云端任务进入 `extracting-psd`、`refining-layers` 并完成 |
| 编辑器图层操作 | 未验证 | 预览页显示至少 2 个图层，并验证选择、隐藏、移动和导出 |
| 成功扣费与失败退款 | 未验证 | 管理员流水证明同一 taskId 只扣一次；失败或取消只退一次 |
| PostgreSQL 并发结算 | 阻塞 | 提供隔离 `TEST_POSTGRES_URL` 并执行多实例竞态用例 |
| Firefox / WebKit | 阻塞 | 使用已部署版本完成核心分层回归 |

## 2026-07-31 图片工具质量与双输出拆解未验证项

| 项目 | 当前状态 | 解除条件 |
|------|----------|----------|
| 移除背景真实透明 PNG | 本地像素测试通过，云端未验证 | 部署后下载输出，用 Sharp 证明 `hasAlpha=true` 且存在 alpha=0 像素 |
| 擦除结果质量 | 本地合成测试通过，真实供应商未验证 | 在 Chrome 涂抹明确对象，证明涂抹区改变且蒙版外 RGBA 字节不变 |
| 蒙版结果质量 | 本地合成测试通过，真实供应商未验证 | 在 Chrome 提交提示词和蒙版，下载结果进行逐像素边界检查 |
| 调色持久化 | 本地 API/UI 测试通过，云端未验证 | 证明结果为独立节点，保存项目、刷新恢复并下载检查 alpha/RGB |
| 元素拆解三种模式 | 本地契约与 E2E 脚本已建立，云端未执行 | 分别执行 `board`、`layers`、`both` 并保存 screenshot/video/trace/network |
| 双分支源图一致性 | 本地 SHA-256 冻结测试通过 | 云端记录父任务与两分支使用相同 source hash、尺寸和源图 ID |
| Pear ZIP/PSD 应用链路 | 本地真实制品回放通过，当前部署未验证 | 任务越过下载/解压/解析阶段，编辑器显示至少 2 个图层 |
| PSD 图层操作与导出 | 未验证 | 验证选择、显示/隐藏、移动和导出，下载文件以 `8BPS` 开头并可解析 |
| 部分完成与单分支重试 | 本地状态测试通过 | 云端制造一分支失败，保留成功分支并只重试失败分支 |
| PostgreSQL 多实例幂等 | 阻塞 | 配置隔离 `TEST_POSTGRES_URL`，让当前跳过的并发测试真实执行通过 |
| 成功扣费与失败/取消退款 | 未验证 | 管理员流水证明同一任务只扣一次；失败或取消只退款一次 |
| Firefox / WebKit | 未验证 | 使用已部署版本执行非付费图片工具及元素拆解回归 |

当前跳过的 4 项测试不计入通过率，也不允许用内存存储或 mock 结果替代 PostgreSQL 证据。

## 2026-08-02 供应商任务可靠性未验证项（状态已更新）

| 项目 | 当前状态 | 完成证据 |
|------|----------|----------|
| 图像生成 `n=2` | 已验证（生成与逐张回填） | 快速创建与专业创作均已取得独立任务、独立占位框、逐张返回和最终数量证据；账务流水仍需单独核对。 |
| 图像生成 `n=3/4` | 已验证（生成与刷新恢复） | 专业创作 `n=3`、`n=4` 已通过 Chrome 验证；无重复、无空白框、刷新恢复通过。 |
| 单子任务取消 | 未验证 | 取消一张后仅该槽位终止和退款一次；其余槽位继续并正常完成。 |
| 图像失败与迟到完成 | 未验证 | 失败/超时后只退款一次；迟到供应商完成不会覆盖已失败或已取消槽位。 |
| 视频同步 URL 响应 | 未验证 | 真实供应商无 task ID 但返回 URL 时，画布视频节点直接完成且只扣费一次。 |
| 视频异步刷新恢复 | 未验证 | 远端 task ID 已持久化后刷新页面，任务继续轮询并完成。 |
| 视频提交前重启边界 | 未验证 | 在远端 ID 未写入时，任务显示可重试且只退款一次；不得错误轮询本地 task ID。 |
| PostgreSQL 并发结算 | 阻塞 | 提供隔离 `TEST_POSTGRES_URL` 后执行所有跳过的并发、幂等与退款测试。 |
| Firefox / WebKit | 未验证 | 对图像多输出、取消、视频终态执行真实浏览器回归并保存 trace、录像和网络日志。 |

## 2026-08-02 增补：已发现但尚待部署验证

| 项目 | 当前状态 | 完成证据 |
|------|----------|----------|
| Pear `n=2` 画布只出现两张结果 | 已验证 | 2026-08-02 云端 Chrome 项目 `project_1785672740345_w0o09zyjz` 最终仅 2 层，项目同步记录 `canvasImages: 2`，两个结果位置不重叠。 |
| Pear 结果供应商徽标 | 已验证 | 同一真实请求的两张图均显示 `gpt-image-2 / PearAPI 图像`，未再显示 FHL。 |
| 项目刷新恢复当前画布 | 本地已修复，待云端验收 | BUG-027 已稳定复现并登记；成功加载项目后会将 `projectId` 写入 URL。部署后需用已保存项目真实刷新，确认仍留在画布并恢复图片。 |
| PostgreSQL 并发结算 | 阻塞 | 完整 Vitest 已通过 1340 项；仍需隔离 `TEST_POSTGRES_URL` 执行 4 个跳过的并发、幂等与退款用例。 |

## 2026-08-02 已关闭的云端多图验证项

| 项目 | 验证结果 | 证据 |
|------|----------|------|
| 专业创作 `n=3` | 已验证 | 3 个独立进度框；首张先回填，另外 2 张仍处理；最终恰好 3 张 Pear 结果，无控制台错误或警告。 |
| 专业创作 `n=4` | 已验证 | 4 个独立进度框；最终恰好 4 张 Pear 结果，无重复、无空白框、无残留进度框。 |
| 多图项目刷新恢复 | 已验证 | `projectId=project_1785676375816_qvjpfv81z` 刷新后恢复同一画布及 7 张生成图。 |

`n=2` 的快速创建与专业创作均已通过云端验证；当前本地新修复需要补做单子任务取消、失败/超时后的单次退款与真实 PostgreSQL 并发结算。BUG-028/029 部署前不得从本表移除。

## 2026-08-02 重新打开的验证项

| 项目 | 当前状态 | 完成证据 |
|------|----------|----------|
| Pear `n=2` 单槽取消 | FAIL（`98ba6c2` 云端） | 取消第一个槽位后重新打开项目仍有两张结果；最新本地修复待随本次提交部署和复验。 |
| 取消槽位迟到完成拒绝 | 未验证 | 取消后等待供应商返回；项目、任务轮询和画布都不能接受该槽位结果。 |
| 取消与成功账务一致性 | 未验证 | 管理员账务流水证明幸存槽位只扣一次，取消槽位只退款一次，不存在重复扣费或退款。 |
| 自动保存本地配额 | 新发现 P2 | 需复现 `QuotaExceededError`，为快照实现容量预算、淘汰策略和回归测试。 |
| PostgreSQL 并发结算 | 阻塞 | 仍需隔离 `TEST_POSTGRES_URL` 执行已跳过的幂等、终态竞争和退款测试。 |
| Firefox / WebKit | 未验证 | 对图像多输出、单槽取消与视频终态执行真实浏览器回归并保留 trace、录像和网络日志。 |

## 2026-08-02 新增：底部图像生成器待部署验收

| 项目 | 当前状态 | 完成证据 |
|------|----------|----------|
| 真实 Pear `n=2` 两个独立处理框 | 待部署 | 新版前端提交后立即看到两个带独立 `taskId` 的处理框，而不是一个批处理框。 |
| 真实单槽取消 | 待部署 | 取消第一个槽位命中 `/api/cancel-task`；该槽位不再回写，第二个槽位正常完成。 |
| 取消/完成账务一致性 | 待部署 | 管理员流水证明完成槽位只扣一次、取消槽位只退款一次；不存在重复扣费、重复退款。 |
| 显式 Pear 路由 | 待部署 | 提交显式 Pear `providerId + gpt-image-2` 后，响应、结果元数据和 UI 均保持 Pear，不回退到 FHL 或其他提供商。 |
| 旧包装器兼容性 | 待部署 | 非 `canvas-direct` 的历史调用仍保持原有提交行为；不应因该定向修复引入其他生成入口回归。 |

## 2026-08-02 云端多图测试新增待验证项

| 项目 | 当前状态 | 完成证据 |
|------|----------|----------|
| `success` / `succeeded` 成功终态后的生成器解锁 | 待部署 | 完成真实 Pear `n=2` 批次后，提交按钮必须从“生成中…”恢复为可用状态，且无需刷新页面。 |
| 立即取消时机 | 待部署 | 在同一次浏览器操作中发现两个新建槽位后立刻取消，避免先检查大量日志导致供应商已完成全部任务。 |
## 2026-08-02 Newly Pending Deployment Checks

| Item | Why it is still unverified | Acceptance evidence |
|---|---|---|
| Pear `n=2` provider attribution after recovery | Requires the deployed task service and real provider response. | All `/api/poll-task` requests carry the configured provider ID and final cards show Pear, never FHL. |
| Per-slot cancellation | Requires a live provider task that remains active long enough to cancel. | One `/api/cancel-task` success, one cancelled slot that never reappears after refresh, and one surviving completed slot. |
| Charge/refund consistency | Requires access to the deployed billing ledger. | Exactly one charge for the successful slot and at most one refund for the cancelled slot. |
| Browser storage quota regression | Requires a large real project in the deployed browser. | No `QuotaExceededError` for `wujie_autosave_snapshots_v1` after project load, save, and refresh. |

## 2026-08-03 Additional Deployed Verification

| Item | Current status | Acceptance evidence |
|---|---|---|
| Pear completion metadata with empty provider fields | BUG-037 fixed locally, pending deployment | A completed Pear `gpt-image-2` card keeps the configured Pear label even when `/api/poll-task` returns empty `providerName` or `providerId`. |
| Single-slot cancellation under a long-running task | Still unverified | Use a task that remains processing long enough to cancel one of two slots, then verify the sibling slot completes and only the cancelled slot is absent after refresh. |

| BUG-037 cloud provider-label verification | Pending deployment | Deploy the non-empty provider metadata guard, submit Pear `gpt-image-2`, and verify completed canvas cards remain labeled Pear when the provider poll response is blank. |
| BUG-038 precise cancellation rejection | Pending deployment | Submit a live Pear `n=2` task, cancel the first active slot, and record the exact server rejection message, sibling task outcome, refresh recovery, and billing ledger state. |

## 2026-08-03 Canvas Group Deployment Checks

| Item | Current status | Acceptance evidence |
|---|---|---|
| Reference group creation | Pending deployment | `Alt + click` on a real canvas image produces one visible reference group without moving the source image. |
| Fusion group creation | Pending deployment | `Ctrl/Cmd + click` on a real canvas image produces one visible fusion group without moving the source image. |
| Group movement | Pending deployment | Dragging the group header moves its source and result layout together; a blank-canvas long press pans instead of box-selecting. |
| Reference recognition | Pending deployment | `识别参考图` returns visible success feedback and the next generation request includes the recognized descriptions. |
| Group generation | Pending deployment | With a valid selected image model, both reference and fusion groups submit successfully even before custom prompt text is entered; generated output reaches the canvas. |
| Project recovery | Pending deployment | Save and refresh after group creation; group descriptions and generated output retain the correct source-image relationship. |

## 2026-08-03 Newly Opened Group-Control Acceptance

| Item | Current status | Acceptance evidence |
|---|---|---|
| Image-group collapse and close | Pending exact-build deployment | Collapse changes the visible group state; Close removes the group and its saved group record without deleting unrelated images. |
| Reference-group collapse, close, and model selection | Pending exact-build deployment | A selected model remains visible after the menu closes and Generate becomes available when the model supports the action. |
| Fusion-group collapse, close, and model selection | Pending exact-build deployment | Same as reference group, with no unwanted image drag or canvas selection. |
| Group title drag after control isolation | Pending exact-build deployment | Header drag still moves the group as before; pressing a title button does not start a drag. |
| Paid `n=2` progressive return after group-control acceptance | Pending | The enabled provider creates two durable task slots and each result appears as soon as its own provider task completes. |

## 2026-08-03 Group Zoom and Fidelity Acceptance

| Item | Current status | Acceptance evidence |
|---|---|---|
| Reference/fusion configuration menu scaling | Pending exact-build deployment | At 50% and 100% canvas zoom, aspect ratio, resolution, quality, and output-count menus visually match their trigger scale and remain selectable. |
| Reference category fidelity | Pending provider verification | Changing one of the six category controls affects only that semantic preservation instruction in the request. |
| Fusion full-content fidelity | Pending provider verification | Each fusion source is sent as an image input with all six preservation categories at 100%; the result retains salient information from every source. |
| Image-to-image `n=2` after fidelity change | Pending | Two independent provider tasks and progressive canvas results remain correct with reference or fusion inputs. |

## 2026-08-03 Image Generator Reference-Constraint Acceptance

| Item | Current status | Acceptance evidence |
|---|---|---|
| English-native reference constraints | Pending exact-build deployment | With an enabled English-native image model, two references with different selected categories produce a successful task whose request preserves numbered category ownership. |
| Chinese-native reference constraints | Pending exact-build deployment | With an enabled Chinese-native image model, the same two-reference scenario produces a successful task while retaining the Chinese constraint strategy. |
| Blank description alignment | Pending cloud observation | Reference #1 without a prior description must not inherit reference #2's description after automatic subject identification. |
| Async recovery retention | Pending cloud observation | Refresh or reopen while a multi-reference generation is pending; the recovered task retains `referenceCategoryStrengths` and finishes with the same source-image relationship. |

## 2026-08-03 Reference/Fusion Group Failure Diagnosis

| Item | Current status | Acceptance evidence |
|---|---|---|
| Missing group provider preflight | Verified locally, pending deployment | A group that has no provider binding does not call `/api/generate` and explains that the user must reselect a model. |
| Provider capability vs. application failure | Pending real browser verification | Submit a reference group through an enabled provider, retain the exact task error if it fails, and classify it as model capability, provider configuration, or application defect from the returned evidence. |
| Reference group success path | Pending real browser verification | A supported image-to-image model receives the selected group references and returns an editable canvas image without a generic configuration message. |

## 2026-08-03 Shared Reference-Image Transport Acceptance

| Item | Current status | Acceptance evidence |
|---|---|---|
| Bottom image-generator reference submission | Pending exact-build deployment | Upload one valid reference image in the bottom generator, submit through an enabled model, and verify the provider receives an image-bearing request rather than returning `Missing required parameter: image`. |
| Canvas reference-group submission | Pending exact-build deployment | Create a reference group from a loaded canvas image, submit through an enabled model, and verify the request reaches a provider task with its image input retained. |
| Provider error classification after transport repair | Pending cloud observation | If a model still rejects the request, record the exact provider/model response and classify it as capability, configuration, moderation, or provider outage rather than re-labeling it as a missing-image application defect. |

## 2026-08-03 Provider/Model Routing Acceptance

| Item | Current status | Acceptance evidence |
|---|---|---|
| Stale local model recovery | Pending exact-build deployment | After a hard refresh, the model visible in the selector and the `/api/generate` `providerId/model` fields are the same configured pair. |
| Invalid provider/model preflight | Pending exact-build deployment | A deliberately stale explicit pair returns `MODEL_PROVIDER_MISMATCH` before a task ID is created and without a credit ledger entry. |
| Valid configured provider task | Pending exact-build deployment | A real configured model returns an application task ID quickly, records the selected provider/model, and progresses through terminal completion or an actionable provider failure. |
| Submission-uncertain recovery | Pending cloud observation | Simulate or observe a browser/proxy fetch interruption after task submission. The UI must not call the task failed solely from its own network error; it must recover using the durable app task and provider status. |
| Provider terminal propagation | Pending cloud observation | When the provider marks an identified remote task failed, the next app poll transitions the matching app task to failed with the provider reason and does not remain generating beyond the defined polling/recovery interval. |

## 2026-08-04 RemoveBG and Pear Deployment Acceptance

| Item | Current status | Acceptance evidence |
|---|---|---|
| Dedicated RemoveBG protocol | Verified locally, pending deployment | Capture the selected `providerId` and `model`, provider request path, application response, and final canvas artifact. The dedicated call must not use generic `/images/generations`. |
| RemoveBG alpha quality | Pending real output | PNG, WebP, and ZIP paths each produce a readable RGBA PNG with both transparent and non-transparent pixels; no checkerboard pixels are baked into the image. |
| RemoveBG billing settlement | Pending PostgreSQL evidence | Exactly one `image_remove_bg` charge for either action alias; failure or cancellation creates at most one compensating refund. |
| Pear asynchronous submission | Pending real provider run | Initial `/api/layered-decompose` returns an application task ID before the provider finishes and exposes `submitting-pear`, `waiting-for-pear`, and `downloading-psd` phases. |
| Pear ZIP to PSD editor | Pending real artifact run | The safe downloader accepts the real ZIP, extracts the primary non-`_depth.psd` file, validates `8BPS`, and opens at least two editable layers. |
| PostgreSQL concurrency suites | Skipped locally | Run annotation, element decomposition, and layered decomposition concurrency suites against an isolated PostgreSQL database and retain transaction/ledger evidence. |
| Exact-build smoke regression | Pending deployment | Verify authentication, configured model visibility, reference/fusion groups, `n > 1` progressive generation, canvas/node/ChatCanvas, image toolbar, and bottom toolbar after deploying the exact commit. |

---

## 2026-08-05 acceptance-chain additions (`7d88625`)

| Item | Status | Notes |
|------|--------|-------|
| Paid P0 generation E2E on exact build | Unverified | Missing `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` / `E2E_GENERATION_MODEL` and `E2E_ENABLE_PAID_GENERATION=true` |
| Cloud exact-build smoke | Unverified | Preview URL returns 404 `instance_not_found`; restart Coze sandbox first |
| PostgreSQL concurrency/refund suites | Skipped | No isolated PostgreSQL URL configured |

## 2026-08-08 Stage 1 PostgreSQL task baseline

| Item | Status | Notes |
|------|--------|-------|
| Isolated PostgreSQL schema lifecycle | BLOCKED | `POSTGRES_TEST_DATABASE_URL` is not configured in the current environment. The real integration test is explicitly skipped and must not be counted as passed. |
| Stage 1 PostgreSQL capability probe | BLOCKED | `pnpm doctor` reports the missing test database as a release blocker. When configured, it verifies connection, `CREATE TABLE`, transactions, unique indexes, and advisory locks. |

## 2026-08-09 Stage 1 Task 6 cancellation and recovery acceptance

| Item | Status | Notes |
|------|--------|-------|
| Deterministic cancellation/timeout terminal races | Verified locally | Focused Vitest coverage proves terminal states cannot be overwritten by late completion, task abort reaches the owned network signal, and recovery retries honor lease/backoff metadata. |
| Progressive generation browser regression | Verified locally | Chromium, Chromium 1080p, Firefox, and WebKit passed the four-slot out-of-order completion and refresh-resume scenario. |
| Real PostgreSQL terminal/refund races | BLOCKED | `POSTGRES_TEST_DATABASE_URL` is not configured; the authoritative PostgreSQL task-state and billing-concurrency suites were explicitly skipped. |
| Real provider cancellation and late result | BLOCKED | Requires a deployed exact commit, a long-running paid provider task, request/task IDs, provider status evidence, and the PostgreSQL ledger proving at most one refund. |
| Cloud recovery backoff | Pending deployment | After deploying the exact candidate commit, verify that an active lease or recent update does not trigger a hot `/api/tasks/recover` loop and that recovery resumes after the advertised retry time. |

## 2026-08-09 Stage 1 Task 8 external evidence

| Item | Status | Required proof |
|---|---|---|
| Exact deployment identity | BLOCKED | `E2E_DEPLOYMENT_COMMIT` must equal the runtime commit at `E2E_BASE_URL`. |
| Paid three-browser generation | BLOCKED | Real account and exact provider/model must complete `n=1/2/3/4` in Chromium, Firefox, and WebKit. |
| Progressive provider results | BLOCKED | Each child task records its own completion time and appears on canvas without waiting for unrelated slots. |
| Billing ledger | BLOCKED | Balance and transaction evidence ties every charge/refund to request ID and task ID. |
| PostgreSQL races | BLOCKED | Isolated database proves concurrent same-key admission, terminal races, and at-most-one refund. |
| Cancellation and timeout | BLOCKED | Provider request is aborted, late completion is rejected, terminal state is stable, and refund occurs once. |
| Rollback rehearsal | BLOCKED | `core-v2 -> legacy` rollback preserves existing data and lets old tasks continue under `handlerVersion`. |

## 2026-08-09 Stage 1 PostgreSQL evidence update

| Item | Status | Evidence still required |
|---|---|---|
| Isolated PostgreSQL schema lifecycle | VERIFIED LOCALLY | None for the local gate; schema creation, binding, cleanup, and removal passed. |
| Concurrent idempotency and billing settlement | VERIFIED LOCALLY | 20-way duplicate admission, one charge, terminal race, and at-most-one refund passed on PostgreSQL 18. |
| Deployed provider ledger | UNVERIFIED | Exact deployed SHA must tie real request IDs, application task IDs, provider task IDs, balance changes, charges, and refunds together. |
| Chromium / Firefox / WebKit paid E2E | BLOCKED | Deploy the candidate commit and supply the exact runtime SHA plus real account/model configuration. |
| Cancellation, timeout, late completion | BLOCKED | Run against the deployed provider and retain abort, stable terminal state, and one-time refund evidence. |
| Rollback rehearsal | BLOCKED | Demonstrate `core-v2 -> legacy` rollback without data loss or task duplication. |

## 2026-08-10 durable generation deployment acceptance

| Item | Status | Required proof |
|---|---|---|
| Server-owned first submission | VERIFIED IN COZE RUNTIME; EXACT SHA UNVERIFIED | Stale task `async-1786322172707-0-uzo191` was cancelled/refunded once. Fresh task `async-1786328158112-0-c83jkr` completed with an image and `charged/60` without a client `/api/poll-task` call. Coze did not expose the exact pulled Git SHA, so runtime identity remains open. |
| Concurrent server/browser wakeup | PENDING DEPLOYMENT | Capture the database lease and provider ledger proving one provider task and one charge per slot. |
| Legacy zombie cleanup | VERIFIED IN CLOUD | Three synthetic tasks reached `cancelled/refunded`, each returned 60 credits, and repeated cancellation produced no second refund. |
| Progressive `n=1/2/3/4` | TASK/BILLING VERIFIED; CANVAS UI PENDING | Unique `n=1/2/3/4` task slots all completed with images and independent charges. In `n=3`, two slots completed before the slowest. A browser-visible proof that each result appears on canvas, survives refresh, and downloads correctly is still required. |
| Direct generation credit metadata | VERIFIED IN CLOUD (BUG-051 CLOSED) | Real Pear task `direct-1786341342235-0-8pta21` deducted 60 credits and persisted `creditCost=60` / `billing.cost=60` with charged status. Exact Coze runtime SHA remains unverified and is tracked separately. |

## 2026-08-10 remaining Stage 1 evidence gaps

| Item | Status | Required evidence |
|---|---|---|
| Three-browser paid generation | VERIFIED | Chromium, Firefox, and WebKit completed real `n=1/2/3/4` task, billing, canvas-fill, refresh, workbench-return, and logout flows. |
| Cancellation and late result | VERIFIED | Repeated cancellation produced one refund; the task remained cancelled after the provider completion window. |
| BUG-052 ledger linkage | VERIFIED IN CLOUD | Task `async-1786354360647-0-rhvubs` persisted non-empty transaction IDs matching exactly one consume and one refund; the refund description contains the same task ID and the balance returned to 378. Structured column linkage is also covered by the isolated PostgreSQL integration test. |
| Timeout-specific terminal behavior | BLOCKED AFTER ATTEMPT 1 | External delayed-provider probe was cut off by Coze egress and correctly became `failed/refunded`, so it is not timeout evidence. Start a Coze-local delayed provider, then prove application-owned abort, stable `timeout`, no late completion, and at-most-one refund. |
| Rollback rehearsal | UNVERIFIED | Demonstrate `core-v2 -> legacy` without data loss, duplicate tasks, or duplicate billing. |
| Exact runtime SHA | VERIFIED | Coze runtime `d531ce65` directly parents GitHub `main@32139c5`; process cwd, PID, Next server version, build ID, and the launcher-only delta were recorded. |

## 2026-08-10 timeout attempt 2 status

| Item | Status | Required evidence |
|---|---|---|
| BUG-054 absolute timeout | REPRODUCED; FIXED LOCALLY; DEPLOYMENT PENDING | Deploy the exact candidate, rerun the Coze-local delayed-provider probe, and prove automatic `timeout/refunded` after the original task deadline. |
| Timeout billing | MANUAL CLEANUP VERIFIED ONLY | Candidate deployment must produce exactly one automatic refund and restore the balance without manual cancellation. |
| Late completion isolation | UNVERIFIED FOR TIMEOUT | Observe the task beyond the delayed provider response window and prove it cannot transition from `timeout` to `completed`. |
| Delay-service cleanup | PARTIALLY VERIFIED | The stop command was sent, but its terminal acknowledgement was not captured because browser control timed out; confirm no listener remains before the next probe. |

## 2026-08-10 timeout acceptance update

| Item | Status | Evidence |
|---|---|---|
| BUG-054 absolute timeout | VERIFIED IN CLOUD | Task `async-1786366442668-0-dzxu9y` reached automatic `timeout/refunded` at 602.934s from durable creation. |
| Timeout billing | VERIFIED IN CLOUD | One -140 consume and one +140 refund restored balance `378 -> 238 -> 378`; transaction IDs remained attached to the task. |
| Late completion isolation | VERIFIED IN CLOUD | The task remained unchanged at 1132.6s after the 900-second response window and a Coze sandbox restart. |
| Delay-service cleanup | VERIFIED | The temporary provider was deleted and confirmed absent; local heartbeat and public tunnel processes were stopped. |
| BUG-053 terminal recovery label | UNVERIFIED / OPEN P2 | Failed and timeout recovery tasks can retain a label that says the task is still retrying. |
| Stage 1 rollback rehearsal | UNVERIFIED / BLOCKING | `core-v2 -> legacy` must still be exercised and documented before Stage 1 can close. |

## 2026-08-10 Stage 1 rollback update

| Item | Status | Evidence |
|---|---|---|
| Stage 1 rollback rehearsal | VERIFIED IN CLOUD | Core-v2 tasks remained readable after changing only `.env` to `legacy`; the next task used `handlerVersion=legacy`. |
| Rollback data migration | VERIFIED ABSENT | No data migration, checkout, reset, pull, or business-source edit occurred during rollback. |
| Rollback billing | VERIFIED IN CLOUD | Three task probes each produced one consume and one refund; balance remained 378 with no duplicates. |
| Runtime business source | VERIFIED | Cloud `origin/main=104b140`; only `scripts/coze-start.sh` differed for `.env` loading. |
| BUG-053 terminal label | OPEN P2 | Terminal failed/timeout rows can retain retry wording; this remains registered and is not a Stage 1 P0/P1 blocker. |
| Stage 2 and later stages | NOT STARTED | Deliberately outside this task. Stage 1 completion must not be read as whole-program completion. |

## 2026-08-11 Stage 2 Checkpoint B open items

| Item | Status | Required evidence |
|---|---|---|
| BUG-055 provider-relative result persistence | FIXED LOCALLY / CLOUD PENDING | Deploy the exact candidate in `shadow`; generate a fresh standalone-chat image; prove controlled persistence, one placement, usable Canvas rendering, and idempotent retry. |
| BUG-056 pasted reference data URL | REPRODUCED / OPEN P1 | Add a separate failing test for the exact encoded payload path, then verify a real provider reference-image request. |
| BUG-057 stale generating label | REPRODUCED / OPEN P2 | Prove terminal UI projection replaces `图片生成中... 1` after result arrival. |
| Stage 2 PostgreSQL concurrency | UNVERIFIED | Configure an isolated `POSTGRES_TEST_DATABASE_URL` and run the six skipped schema/storage/migration/billing/task-state suites. |
| Checkpoint B | NOT PASSED | All four transfer paths must pass in cloud `shadow`; Task 7 and `asset-v3` remain prohibited until then. |

## 2026-08-11 Checkpoint B closure update

| Item | Status | Evidence |
|---|---|---|
| BUG-055 provider-relative result persistence | VERIFIED IN CLOUD | Fresh controlled upload URL rendered in Canvas; one target placement remained after two transfer clicks. |
| Checkpoint B | VERIFIED IN CLOUD | Four of four transfer directions pass in `shadow`; Task 7 is permitted. |
| BUG-056 pasted reference data URL | OPEN P1 | Real provider base64 decode failure remains reproduced and unfixed. |
| BUG-057 stale generating label | OPEN P2 | The completed result still displayed `图片生成中... 1` during the successful cloud run. |
| Stage 2 PostgreSQL concurrency | UNVERIFIED | Six suites remain skipped until an isolated `POSTGRES_TEST_DATABASE_URL` is supplied. |

## 2026-08-11 Task 7 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Completed-task projection on PostgreSQL | UNVERIFIED | Configure isolated `POSTGRES_TEST_DATABASE_URL`; run task projection, task-state, and billing concurrency suites without skips; prove one version/placement under concurrent replay. |
| Workflow 3D billing and ownership | FIXED LOCALLY / CLOUD PENDING | Deploy `12a9026` in `shadow`; submit one real 3D workflow task; prove caller ownership, one charge, persisted provider/model, and authorized polling. |
| Workflow 3D explicit retry | FIXED LOCALLY / CLOUD PENDING | Prove ambiguous retransmission reuses one task while a deliberate retry creates a distinct attempt without duplicate charge for either attempt. |
| Task 7 cloud projection | UNVERIFIED | In Coze `shadow`, complete representative image/edit/video/3D tasks and verify immutable versions plus placements, idempotent replay, and `projection_pending` recovery. |
| Task 8 lifecycle governance | COMPLETED LOCALLY / EXTERNAL EVIDENCE PENDING | Local implementation and focused regressions are complete; real PostgreSQL and Coze shadow evidence are listed below. Physical purge remains disabled. |

## 2026-08-12 Task 8 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Five PostgreSQL lifecycle tests | VERIFIED LOCALLY | Isolated PostgreSQL 18 run passed 5/5, including shared-placement lifecycle, lock waits, exact-path rechecks, arriving-asset serialization retry, and no-deadlock recovery. |
| Task 8 Coze lifecycle | UNVERIFIED | After Checkpoint C is eligible and pushed, deploy the exact SHA in `shadow`; exercise delete, restore, missing-media recovery, dry-run orphan scan, and legacy admin recovery without enabling `asset-v3`. |
| Physical purge | DISABLED BY DESIGN | Do not execute S3/local deletion. A later explicit release gate must separately authorize and prove physical deletion and retry behavior. |
| Task 9 E2E and rollback | NOT STARTED | Run Chromium/Firefox/WebKit cross-workspace E2E, shadow comparison, controlled `asset-v3` test-only switch, and legacy rollback only after Checkpoint C closes. |
| Element board, Pear layer decomposition, annotation PostgreSQL tests | UNVERIFIED / NON-CHECKPOINT-C | Four tests remain skipped because they use `TEST_POSTGRES_URL`, not `POSTGRES_TEST_DATABASE_URL`. Keep them visible for their owning business-module stages. |

## 2026-08-12 Checkpoint C remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| BUG-063 cloud acceptance | FIXED LOCALLY / CLOUD PENDING | Deploy the exact candidate in Coze `shadow`; generate one real image and prove the selected project owns one cloud task, one task-projected AssetVersion, one active Canvas placement, no placeholder asset, and no duplicate after autosave/reload. |
| Canvas managed deletion | FIXED LOCALLY / CLOUD PENDING | Exercise keyboard, context-menu, hover-toolbar, and layer-panel deletion for managed images; each must delete its placement before UI removal and remain deleted after reload. |
| BUG-064 durable media recovery | FIXED LOCALLY / CLOUD PENDING | Local worker, exact media delivery, lease/fencing, terminal status, and server-side image-tool compatibility are verified. Deploy the exact candidate and prove `recovering -> ready` or an explicit terminal failure survives reload in Coze `shadow`. |
| Current-candidate PostgreSQL concurrency | VERIFIED LOCALLY | Isolated PostgreSQL at `127.0.0.1:55433` was supplied through all supported test URL variables; final full run passed `2160/2160` with zero skips, including Stage 2 lifecycle/projection and billing concurrency. |
| Task 9 | PROHIBITED | Do not start three-browser E2E or `asset-v3` switching until Checkpoint C passes. |
## 2026-08-12 after Checkpoint C

| Item | Status | Required evidence |
|---|---|---|
| BUG-064 cloud media recovery | VERIFIED | Coze Chrome UI, reload and read-only PostgreSQL terminal evidence captured under `docs/testing/evidence/bug-064-media-recovery-cloud-2026-08-12.json`. |
| Task 9 multi-browser and mobile E2E | IN PROGRESS | Chromium, Firefox, WebKit and one mobile viewport must cover the two Stage 2 specs with retained failure artifacts. |
| Controlled `asset-v3 -> legacy` rollback | NOT STARTED | Allowed only after shadow comparison passes; test environment only; stable stays untouched and physical purge stays disabled. |

## 2026-08-13 Task 9 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Five-profile local E2E | VERIFIED LOCALLY | `50/50` passed with per-browser isolated users/projects and retained evidence. |
| Stage 2 PostgreSQL concurrency | VERIFIED LOCALLY | Full isolated run executed Stage 2 storage, migration, lifecycle, projection, task-state and billing tests; concurrent restore collision passed. |
| Separate business-module PostgreSQL suites | UNVERIFIED / NON-STAGE-2 | Four tests for element board, Pear layering, and annotation still require `TEST_POSTGRES_URL`; keep them assigned to their owning module plans. |
| Exact Task 9 Coze candidate | UNVERIFIED | Push the final main-only SHA, pull it in Coze, and independently confirm the runtime SHA and `shadow` mode. |
| Cloud shadow comparison | UNVERIFIED | Re-run the two Task 9 specs or equivalent authenticated flows against the exact Coze candidate and compare graph/snapshot identities. |

## 2026-08-13 final candidate remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| BUG-065 through BUG-070 local closure | VERIFIED LOCALLY | TDD, real PostgreSQL, five-profile production-browser matrix, and independent review all pass. |
| Exact final candidate in Coze | UNVERIFIED | The verified implementation entered `main@644a0809658d500d9e3815c14771dd10581f0998`; Coze still reports `4bbe6db`. Pull the current main tip and record the exact runtime SHA with `WUJIE_ASSET_GRAPH_MODE=shadow`, task core `legacy`, and physical purge disabled. |
| Cloud three-workspace comparison | UNVERIFIED | Verify Canvas, embedded chat, standalone chat, and node workflow preserve one asset/version/placement/entity tuple; delete/restore and reload must agree between graph and project snapshot. |
| Controlled `asset-v3` run | NOT STARTED | Only after the exact-SHA shadow comparison passes; use an isolated test environment and retain database/browser evidence. |
| Rollback to `legacy` | NOT STARTED | After the controlled `asset-v3` run, switch only the mode, restart, and prove login, old projects, three workspaces, task/billing references, and media remain intact. |
| Physical asset purge | PROHIBITED | Remains disabled throughout Stage 2. |

## 2026-08-13 BUG-071 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| BUG-071 local lifecycle and reload | VERIFIED LOCALLY | Focused `11/11` and five production-browser profiles `5/5`, including Firefox and mobile. |
| Exact BUG-071 Coze candidate | VERIFIED | Coze source lineage contains GitHub `main@81fe303e73ba2f50d2ca0a6ed7201c5977758231`; deployment-only change cards did not alter business source. |
| Controlled cloud asset-v3 history | VERIFIED | Authenticated Chrome passed delete, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Z and reload; PostgreSQL confirmed the restored Canvas placement and unchanged chat/workflow references. |
| Mandatory legacy rollback | VERIFIED | Final runtime returned to asset `legacy`, task core `legacy`, purge disabled; HTTP health, login session, project and image passed. |
| Exact-candidate shadow comparison | VERIFIED | 5 legacy projects, one controlled Canvas image, one active placement per Canvas/chat/workflow type, zero ownership drift, zero non-ready active reference, zero GC candidate. |
| Physical asset purge | PROHIBITED / NOT EXECUTED | This is intentional Stage 2 safety scope, not missing validation. Purge remains disabled for the next stage. |

## 2026-08-13 Stage 3 Task 4 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| 300-node input P95 | OPEN P1 | Isolate and repair the clean-fixture `50.2ms` measurement plus preceding `56.8ms` / `62.8ms` runs without changing the fixed `<=50ms` threshold; rerun the complete production Chromium spec. |
| Chromium 1920x1080 | UNVERIFIED | Run the Task 4 selection, pointercancel, drag persistence and 100/300-node performance flows against an isolated fixture. |
| Firefox | UNVERIFIED | Run the same selection/gesture contract with retained screenshot, video, trace, Console and network evidence. |
| WebKit | UNVERIFIED | Run the same selection/gesture contract with retained evidence. |
| Mobile Chromium | UNVERIFIED | Prove touch long-press pan remains usable while touch selection/edit priorities remain correct. |
| PostgreSQL-gated full suites | UNVERIFIED | Configure the required isolated PostgreSQL URL variables and rerun all `12` skipped files / `44` skipped tests; skipped tests are not passes. |
| Protected-baseline production drift | BLOCKED BY ORDERED PLAN | Task 4 confirms all `38/38` protected identities remain. Update the allowlist/metadata only in the later approved Stage 3 baseline task, then rerun the gate. |

## 2026-08-13 Stage 3 Task 5 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| 300-node input latency | OPEN P1 | Reduce the final-build fixed pan scenario P95 from `52.3ms` to `<=50ms` without reducing assertions; keep the earlier `72.5ms` run as variance evidence. |
| Async undo/redo project switch | UNVERIFIED P2 EVIDENCE | Add a component-level or Playwright test that holds the placement Promise, switches projects, starts a new transition and proves the old success/catch/finally cannot alter the new project. |
| External browser matrix | UNVERIFIED | Run Chromium 1920x1080, Firefox, WebKit and mobile Chromium on the exact Task 5 candidate. |
| Protected-baseline source drift | BLOCKED BY ORDERED PLAN | `38/38` identities remain, but `24` accumulated Stage 3 source files are not yet in the approved baseline metadata. Update only in the later planned task. |
| Cloud exact SHA and rollback | UNVERIFIED | Push only after authorized, deploy the exact candidate in the isolated Coze project, execute the Canvas history regression, then prove rollback. |
| Exact-SHA Coze candidate and rollback | UNVERIFIED | After the ordered local tasks and main-only candidate are ready, pull the exact SHA, validate in the isolated Coze environment, and prove `canvas-v2 -> legacy` rollback. `stable` remains read-only. |

## 2026-08-13 Stage 3 Task 6 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| 300-node input latency | OPEN P1 | Reduce the latest clean-fixture fixed-scenario P95 from `87.8ms` to `<=50ms` without weakening the assertion; retain prior `50.2ms`, `52.3ms`, `56.8ms`, `62.8ms`, `71.8ms`, `72.5ms` and `79.6ms` variance evidence. |
| External browser matrix | UNVERIFIED | Run the Task 6 n=4 projection, completion, reload and failure/cancel paths in Chromium 1920x1080, Firefox, WebKit and mobile Chromium with retained artifacts. |
| Cloud exact-SHA task projection | UNVERIFIED | After authorized push, deploy the exact candidate and prove provider completion, Canvas projection, refresh recovery and rollback without duplicate placement or status regression. |
| Provider billing/refund behavior | NOT CHANGED / NOT REVERIFIED IN TASK 6 | Task 6 intentionally leaves supplier submission and accounting untouched; retain Stage 1/2 evidence and rerun exact-SHA cloud billing gates before release. |
| Protected-baseline source drift | BLOCKED BY ORDERED PLAN | `38/38` feature identities remain, but `27` accumulated Stage 3 source files are not approved in baseline metadata. Update only in the later planned baseline task. |
| Task 7 persistence scheduler | VERIFIED LOCALLY | Focused `35/35`, PostgreSQL-enabled full Vitest exit `0`, and production Chromium save/refresh `2/2`; 300-node longest save task `0ms` and refresh state preserved. |

## 2026-08-13 Stage 3 Task 7 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Full 300-node pan/input gate | OPEN P1 | Rerun the complete fixed Stage 3 performance scenario and reduce S3-BUG-004 to `<=50ms`; the Task 7 save-only `21.8ms` sample cannot replace it. |
| External browser matrix | UNVERIFIED | Run Task 7 save/refresh in Chromium 1920x1080, Firefox, WebKit and mobile Chromium with retained artifacts. |
| Cloud exact-SHA and rollback | UNVERIFIED | After an authorized main-only push, deploy the exact candidate, verify project save/refresh and pending-media recovery, then prove `canvas-v2 -> legacy` rollback. |
| Pending data/blob close recovery | UNVERIFIED IN REAL BROWSER | Close during unresolved media persistence and prove the small recovery marker is consumed without duplicate placement or data loss. |
| Protected-baseline source drift | BLOCKED BY ORDERED PLAN | `38/38` identities remain, but `29` accumulated Stage 3 source files await the later approved baseline task. |
| Task 8 tool sessions | NOT STARTED | Task 7 evidence does not authorize tool-registry work in this task. |

## 2026-08-13 Stage 3 Task 8 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Task 8 mutual-exclusion browser flow | VERIFIED LOCALLY | Production Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium pass `5/5` with retained videos. |
| Full 300-node pan/input gate | OPEN P1 | Reduce S3-BUG-004 to the fixed `<=50ms` P95 threshold in the complete performance scenario; Task 8 does not alter or relax this gate. |
| Full cross-browser Stage 3 matrix | UNVERIFIED | The Task 8 flow is not a substitute for selection, gesture, history, task projection, persistence and 1/100/300-node performance in every profile. |
| Firefox Stage 3 fixture media | UNVERIFIED / FIXTURE LIMITATION | Replace or formally validate the historical 155-byte PNG fixture, then prove Firefox `naturalWidth > 0`; Task 8 only proves the stable Canvas card and tool-session behavior. |
| Cloud exact-SHA and rollback | UNVERIFIED | After an authorized main-only push, deploy the exact candidate, rerun representative toolbar/context/shortcut sessions, then prove `canvas-v2 -> legacy` rollback. |
| Protected-baseline source drift | BLOCKED BY ORDERED PLAN | `38/38` identities remain. The default gate blocks `32` accumulated Stage 3 source paths; only the exact reviewed scope gate passes. Baseline approval belongs to the ordered later task. |
| Task 9 component consolidation | NOT STARTED | Task 8 evidence does not authorize component-boundary cleanup in this task. |

## 2026-08-14 Stage 3 Task 9 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Task 9 component boundaries | VERIFIED LOCALLY | Boundary contracts and focused Canvas regression pass `58/58`; full Vitest passes `2376/2376` executed tests and PostgreSQL suites pass separately. |
| Full 300-node pan/input gate | OPEN P1 | In Task 10, rerun the complete fixed scenario and meet `<=50ms` P95 without weakening assertions or discarding prior variance evidence. |
| Full five-browser Stage 3 matrix | UNVERIFIED | Run the complete functional/performance suite, not only Task 8's tool-session flow, in Chromium, Chromium 1920x1080, Firefox, WebKit and mobile Chromium. |
| Firefox Stage 3 fixture media | UNVERIFIED / FIXTURE LIMITATION | Replace or formally validate the historical 155-byte PNG fixture and prove decoded media dimensions in Firefox. |
| Protected-baseline source drift | BLOCKED BY ORDERED PLAN | Keep the default gate blocking accumulated Stage 3 source paths until Task 10 reviews and explicitly approves the exact candidate scope. |
| Cloud exact-SHA and rollback | UNVERIFIED | After authorized push, deploy the exact candidate in the isolated Coze project, run representative Canvas flows and prove `canvas-v2 -> legacy` rollback. |
| Task 10 release gates | NOT STARTED | Task 9 evidence does not authorize a Stage 3 completion or release claim. |

## 2026-08-14 Stage 3 Task 10 remaining evidence

| Item | Status | Required evidence |
|---|---|---|
| Real paid P0 generation | UNVERIFIED / LOCAL PROVIDER ABSENT | The isolated local database has zero API providers. Deploy the exact candidate SHA to Coze and prove one authorized real generation reaches a terminal Canvas result without duplicate task or charge. |
| Billing, cancellation and refund consistency | UNVERIFIED / CLOUD REQUIRED | Use the authenticated cloud account and PostgreSQL records to prove one task/one charge, terminal-state monotonicity, one cancellation and at-most-once refund. |
| GitHub Actions Stage 3 matrix | PENDING PUSH | Push the reviewed candidate to `main` and require all legacy/shadow/canvas-v2 jobs plus artifact uploads to finish successfully. |
| Coze exact-SHA shadow comparison | UNVERIFIED | Coze must report the exact pushed commit and run 1/100/300-node, tools, task projection, save/reload and auth protection in shadow with zero unexpected differences. |
| Isolated canvas-v2 activation | UNVERIFIED | Only after shadow passes, switch the isolated preview to canvas-v2 and rerun the same functional/performance matrix. Do not switch the stable production domain in Stage 3. |
| Mandatory legacy rollback | UNVERIFIED | Return the isolated runtime to legacy and prove login, old projects, images, three workspaces, tools, tasks, credits and save behavior remain unchanged. |
| Historical ESLint warnings | ACCEPTED DEBT | `965` warnings remain historical; current release gate requires zero errors and no newly introduced warning. |
| Small audit beacon application receipt | OPEN P2 | Add server-persisted idempotency plus a delivery receipt/retry path; verify 401/500, disk failure, reload and logout. `sendBeacon(true)` currently proves queue acceptance only. |
| Cross-session model authorization refresh | OPEN P2 | Push or poll a session/catalog authorization revision so grant/revoke changes refresh the open Canvas without page reload; backend authorization already remains authoritative. |
| Browser storage quota double failure | UNVERIFIED CHAOS EDGE | Unit/source contracts prove storage failure still attempts beacon and a double failure blocks leaving. A real browser quota/private-mode run with retained video/trace remains required. |
| Final committed-source browser evidence | VERIFIED LOCALLY | Clean `main@afa65eb103bd8fa08d669d4680d068d2c565d341` production evidence passes Chromium/WebKit representatives `4/4` with screenshot, video, trace, Console and Network artifacts under the exact SHA path. |
| `stable` GitHub ruleset enforcement | EXTERNAL GOVERNANCE BLOCKED | Repository permissions do not permit adding/verifying a server-side ruleset. Workflow detection remains secondary; do not claim branch protection enforcement. |

### 2026-08-14 immutable-main remaining scope

- GitHub Actions has not yet supplied a Stage 3 run for `afa65eb103bd8fa08d669d4680d068d2c565d341`.
- Coze has not proved the exact SHA in `shadow`, isolated `canvas-v2`, or the mandatory final `legacy` rollback.
- Real provider generation, one-charge/one-refund settlement and cloud PostgreSQL terminal-state evidence remain unverified; the isolated local fixture has no provider configuration.
- Every immutable representative emitted one `[DataIsolation] loadData` cleanup warning for historical cross-user project rows. Guards removed the rows and isolation assertions passed, but the origin of those historical rows remains a separate P2 audit item.

### 2026-08-14 CI repair remaining scope

- Clean-schema seeding and production dependency audit are fixed and verified only in the local candidate. They remain `UNVERIFIED ON IMMUTABLE CI` until the trusted-parent push and GitHub Actions rerun finish.
- The `real-p0-browser` workflow is `BLOCKED BY MISSING GITHUB SECRETS`; paid generation, Pear layering and billing/refund must not be mocked or skipped to obtain a green badge.
- Coze still must identify the exact candidate SHA, pass `shadow`, pass isolated `canvas-v2`, and prove the mandatory final `legacy` rollback.
- `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains read-only; Stage 4/5 remain prohibited while these items are open.

#### Immutable `0ac9068` result

- `VERIFIED`: protected baseline, Stage 1 local gates, PostgreSQL concurrency, Doctor, TypeScript, ESLint, unit/integration, API, production dependency audit and production build.
- `NOT EXECUTED`: all Canvas assertions in legacy because guarded seed raced `product_type`; all Canvas assertions in shadow/canvas-v2 because login returned 503 before project entry.
- `LOCALLY REPAIRED / CI RERUN REQUIRED`: condition-based core-column readiness and minimum 32-character Stage 3 auth secret.
- `EXTERNALLY BLOCKED`: real P0 browser configuration still lacks required GitHub Secrets. It must remain red rather than be skipped or mocked.

#### Immutable `c381d50` result

- `VERIFIED`: all three Stage 3 modes create schema, seed, authenticate and execute the five-browser suite; protected/static/API/audit/build/PostgreSQL gates pass.
- `FAILED`: 20 of 180 Canvas cases, comprising merge-window marker observation, hosted Chromium FPS/save budgets and one shadow WebKit immediate-reload geometry rollback.
- `UNVERIFIED`: whether the failed Chromium merge-window cases issued and completed the periodic sync request; whether the WebKit geometry failure is deterministic; real provider/billing/refund and Coze exact-SHA mode rollout.
- Stage 3 remains incomplete and Stage 4/5 remain prohibited.

#### Post-`c381d50` local candidate

- `LOCALLY VERIFIED`: the merge-window test now observes the exact periodic projects-sync response and passes five browser profiles `5/5`.
- `HOSTED RERUN REQUIRED`: cached continuity-probe lookups retain all assertions and pass six local desktop Chromium performance gates, but S3-BUG-017 remains open until immutable GitHub Actions meets the unchanged thresholds.
- `NOT REPRODUCED LOCALLY / HOSTED RERUN REQUIRED`: shadow WebKit move/resize/undo/redo/immediate reload passes `6/6`; the single immutable rollback remains recorded.
- `EXTERNALLY BLOCKED`: real P0 still lacks GitHub Secrets; Coze exact-SHA shadow, isolated canvas-v2 and mandatory legacy rollback remain unverified.

### 2026-08-14 latest candidate remaining scope

- `LOCALLY VERIFIED`: production `canvas-v2` matrix `60/60` in `final-local-matrix-p1-barrier-20260814`, including Firefox/mobile batch-delete undo followed by 100-node continuity and the independent-review immediate-persistence barrier; mandatory artifacts are retained.
- `LOCALLY VERIFIED`: TypeScript, ESLint, full Vitest, production build and layer/annotation/element-board PostgreSQL concurrency (`4/4`).
- `IMMUTABLE CI REQUIRED`: run `31797149839`, attempt 2 remains RED and predates the local history/tombstone closure. A new commit and hosted rerun must meet unchanged thresholds and reproduce no WebKit immediate-reload rollback.
- `EXTERNALLY BLOCKED`: real-P0 GitHub Secrets, paid provider generation, authoritative charge/cancel/refund rows, Coze exact-SHA shadow, isolated canvas-v2 and final legacy rollback.
- `NOT AUTHORIZED`: Stage 4/5 and any write to `stable` remain prohibited until all required Stage 3 external gates close.

## 2026-08-15 Stage 3 Task 10 remaining evidence after CI RED closure

| Item | Status | Required evidence |
|---|---|---|
| Immutable GitHub Actions rerun | UNVERIFIED | Run the exact new `main` SHA through legacy, shadow and canvas-v2 jobs with unchanged performance and network-evidence gates. Local `60/60` cannot replace hosted-runner evidence. |
| Coze exact-SHA shadow | UNVERIFIED | Deploy the exact commit with `WUJIE_CANVAS_KERNEL_MODE=shadow`; verify login, 1/100/300 nodes, tools, save/reload and zero shadow divergence. |
| Coze isolated canvas-v2 | UNVERIFIED | Switch only the isolated preview to `canvas-v2` and repeat the same browser matrix, including CAS conflict recovery and authoritative server geometry after immediate reload. |
| Mandatory legacy rollback | UNVERIFIED | Return the same deployment to `legacy` and prove login, old projects, three workspaces, images, tools, tasks, credits and saves remain intact. |
| Real paid provider and billing | BLOCKED EXTERNALLY | Use authorized provider credentials to prove task creation, one charge, cancellation, terminal failure/timeout and at most one refund. No mock result may close this item. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; no Stage 3 candidate may be pushed to it. |

Historical checkpoint: the isolated PostgreSQL suite passed `14 files / 54 tests`, while `local-final-candidate-r5-20260815` remained RED `58/60`. The later stable-listener candidate now has exact local legacy Chromium `12/12` and mobile `4/4`; immutable three-mode CI, cloud rollout/rollback and real accounting remain required. Stage 3 is not complete and Stage 4/5 must not start.

## 2026-08-15 remaining scope after `a372e9e` Actions attempt 2

| Item | Status | Required evidence |
|---|---|---|
| Hosted desktop Chromium performance | OPEN P1 | Keep `100 nodes >=55 FPS`, `300 nodes >=45 FPS`, input P95 `<=50ms` and longest save task `<=100ms`. Isolate video/trace/automation observer cost from application work, implement only a proven root-cause fix, then pass all three immutable modes. |
| Evidence duplicate-abort classifier | LOCALLY VERIFIED | Push the narrow exact-digest fix and require a new immutable Firefox/shadow run. Different payloads, missing status and HTTP failures must remain blocking. |
| Shadow immediate-reload geometry | CLOSED / RECURRENCE WATCH | Attempt 2 passed all five profiles and isolated shadow Chromium 1080p passed `10/10`. Retain the original artifact and reopen on any recurrence. |
| Real paid P0 and accounting | BLOCKED EXTERNALLY | Configure the required GitHub/Coze provider credentials and prove real generation, one charge, cancellation, terminal-state monotonicity and at-most-once refund. Mock data cannot close this item. |
| Coze exact-SHA mode sequence | UNVERIFIED | After immutable CI passes, execute `shadow -> canvas-v2 -> legacy` on the exact commit and retain login, old-project, 1/100/300-node, tool, save/reload and rollback evidence. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. |

## 2026-08-16 queue after immutable `b4ad786`

| Item | Status | Required evidence |
|---|---|---|
| Projection-only visibility candidate | LOCALLY VERIFIED | Focused `41/41`; production canvas-v2 `16/16`, shadow `4/4`, legacy `4/4`; Chromium reverse-box `3/3`; WebKit merge-window deletion `3/3`; PostgreSQL-enabled full Vitest `2520/2520`. Reproduce from the exact committed SHA. |
| Hosted three-mode Canvas | REQUIRED | Legacy, shadow and canvas-v2 must all pass unchanged `55/45 FPS`, `50ms` input P95, `100ms` save and all continuity/history/persistence assertions. |
| Real paid P0 and accounting | BLOCKED BY SECRETS | Configure all ten authorized controls and prove real generation, cancellation, one charge and at-most-once refund. A fail-closed job is correct but not a release pass. |
| Coze exact-SHA sequence | WAITING FOR IMMUTABLE CI | Only after the exact SHA passes all hosted modes, retain `shadow -> canvas-v2 -> legacy` login, old-project, 1/100/300-node, tool, save/reload and rollback evidence. |
| Independent review | UNAVAILABLE LOCALLY | The Windows Codex executable could not be launched for a separate reviewer. Manual diff review found no feature/persistence/accounting changes; immutable CI remains the independent technical gate. |
| Stable branch and later stages | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. Stage 4/5 remain prohibited while Stage 3 Task 10 is active. |

Stage 3 remains `10/11` (about `91%`).

## 2026-08-16 queue after immutable `2509fcf`

| Item | Status | Required evidence |
|---|---|---|
| Hover-hot-path candidate | LOCALLY VERIFIED | Focused `33/33`, browser lifecycle `5/5`, canvas-v2 repeated performance `16/16`, shadow `4/4`, legacy exact outlier repeat `3/3`, and PostgreSQL-enabled full Vitest `2520/2520` pass. Reproduce from the committed SHA. |
| Hosted three-mode Canvas | REQUIRED | The next exact `main` SHA must pass legacy, shadow and canvas-v2 under unchanged 55/45 FPS, 50ms input, 100ms save, continuity, history and persistence gates. |
| Canvas-v2 WebKit merge-window timeout | NOT STABLY REPRODUCED | Immutable run timed out once; exact local production WebKit passed `4/4`. Retain the test and diagnose only if the new immutable run reproduces it. |
| Real paid P0 and accounting | BLOCKED BY SECRETS | Configure all ten authorized URL/account/model/paid controls and prove real generation, cancellation, one charge and at-most-once refund. Mock evidence cannot close this item. |
| Coze exact-SHA sequence | WAITING FOR IMMUTABLE CI | Only after all hosted modes pass, retain `shadow -> canvas-v2 -> legacy` login, old-project, 1/100/300-node, tool, save/reload and rollback evidence. |
| Stable branch and later stages | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. Stage 4/5 remain prohibited. |

Stage 3 remains in Task 10 (`10/11`, about `91%`).

## 2026-08-15 queue for the pointer-ownership candidate

| Item | Status | Required evidence |
|---|---|---|
| Direct-pan pointer ownership | LOCALLY VERIFIED | Preserve the five-profile capture/release assertion and existing Space/focused-control behavior on the exact committed SHA. |
| Hosted cold performance | OPEN P1 | Immutable legacy, shadow and canvas-v2 must pass unchanged 55/45 FPS, 50ms input P95 and 100ms save limits. The retained local `54.5ms` cold sample cannot be ignored. |
| Functional matrix | MUST NOT REGRESS | Retain all history, persistence, selection, continuity, save/reload, disappeared-image and clickability assertions already green on `main@3535268`. |
| Real paid P0 | BLOCKED BY SECRETS | Supply the authorized provider/account/storage controls and prove generation, one charge, cancellation, monotonic terminal state and at-most-once refund without mocks. |
| Coze sequence | WAITING FOR IMMUTABLE CI | Only after the exact SHA passes hosted Canvas gates, execute and retain `shadow -> canvas-v2 -> legacy` evidence. |
| Stable branch and later stages | PROTECTED | Do not write `stable`; Stage 4/5 remain prohibited while Stage 3 Task 10 is active. |

## 2026-08-15 remaining gaps for the pointer-up candidate

| Item | Status | Required evidence |
|---|---|---|
| Pointer-up reconciliation fix | LOCALLY VERIFIED | Immutable legacy/shadow/canvas-v2 must reproduce the local `180/180` result on the exact pushed SHA. |
| Hosted performance | UNVERIFIED / REQUIRED | Preserve `55/45 FPS`, `50ms` input P95, `100ms` save and zero continuity failures in all hosted profiles. |
| Real paid P0 | BLOCKED EXTERNALLY | Configure authorized URL/account/model/paid controls and prove one charge, cancellation, monotonic terminal state and at-most-once refund without Mocking. |
| Coze sequence | NOT STARTED | Start only after immutable three-mode CI is green; execute `shadow -> canvas-v2 -> legacy` on the exact SHA and retain evidence. |
| Stage 4/5 | PROHIBITED | Stage 3 Task 10 remains `10/11`; do not enter later stages. |

### Immutable gaps after `main@3535268`

| Item | Status | Required evidence |
|---|---|---|
| Hosted canvas-v2 | FAILED `56/60` | Close four desktop performance failures, including `76.5ms` input P95, without threshold changes. |
| Hosted legacy | FAILED `57/60` | Close Chromium/300 input P95 and 1080p 100/300 FPS failures. |
| Hosted shadow | FAILED `57/60` | Close Chromium/100 and 1080p 100/300 FPS failures while retaining dual-engine comparison. |
| Functional matrix | VERIFIED ON EXACT SHA | Preserve all non-performance passes while changing only the shared pan/compositing path. |

## 2026-08-15 open evidence after Space-pan local repair

| Item | Status | Required evidence |
|---|---|---|
| Space-pan hot path | LOCALLY VERIFIED | Focused `49/49`, desktop production performance `4/4`, deterministic functional reruns `2/2`, independent review `APPROVED`; reproduce from the new committed SHA in immutable CI. |
| Hosted three-mode Canvas matrix | UNVERIFIED / REQUIRED | Legacy, shadow and canvas-v2 must each pass the complete fixed-threshold matrix and upload screenshot, video, trace, Console and network evidence. |
| GitHub real-P0 browser | BLOCKED EXTERNALLY | Configure the authorized repository Secrets. Mock credentials or a skipped job cannot satisfy this gate. |
| Local full matrix asset reliability | OPEN P2 | Preserve the intermittent Next static CSS/JS 500 evidence and verify clean-server static assets during the next exact-SHA run; do not hide it with long waits. |
| Coze exact-SHA sequence | UNVERIFIED | Only after immutable Canvas CI passes, execute `shadow -> canvas-v2 -> legacy` against the same SHA and retain rollback evidence. |
| Real provider and accounting | UNVERIFIED / REQUIRED | Prove real generation, one charge, cancellation, monotonic terminal state and at-most-once refund in PostgreSQL-backed Coze. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; Stage 4/5 remain prohibited. |

## 2026-08-16 deployment shell verification queue

| Item | Status | Required evidence |
|---|---|---|
| Dynamic app-shell candidate | LOCALLY VERIFIED | Production routes `/` and `/simple-chat` are dynamic; root HTML returns private `no-store`; full PostgreSQL-enabled `2521/2521`, TypeScript, zero-error ESLint, build and protected feature gates pass. |
| Coze stale chunk closure | VERIFIED ON `9a6363f` | Authenticated Chrome dashboard and `/simple-chat` load without the global error boundary or `Loading chunk`; current HTML assets are `11/11` HTTP 200, old chunk absent, root private `no-store`, `/api/auth/me` 200. |
| GitHub immutable workflows | BLOCKED EXTERNALLY | Actions runs on `fc190b1` never received a runner because of account payment/spending-limit status. Restore billing and run the exact new SHA; local evidence cannot replace this gate. |
| Stage 3 hosted Canvas and real-P0 | STILL REQUIRED | Preserve unchanged three-mode performance/continuity thresholds and prove real provider generation, charge, cancel and at-most-once refund. The deployment fix does not close these gates. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; do not enter Stage 4/5. |

## 2026-08-15 immutable gaps after `3e46150`

| Item | Status | Required evidence |
|---|---|---|
| Hosted legacy Canvas | FAILED `59/60` | Raise Chromium 1080p/100-node pan from `53.89` to at least `55 FPS` without threshold changes. |
| Hosted shadow Canvas | FAILED `58/60` | Raise Chromium 1080p 100/300-node pan from `51.03/41.92` to `55/45 FPS`; retain dual-engine comparison. |
| Hosted canvas-v2 Canvas | FAILED `56/60` | Resolve Chromium/1080p FPS `45.36/48.78/40.74` and Chromium/300 input P95 `60.9ms`; retain kernel-authoritative behavior. |
| Canvas functional matrix | VERIFIED ON IMMUTABLE SHA | All non-performance cases passed in all three modes; preserve this coverage during the next fix. |
| Real-P0 Secrets | BLOCKED EXTERNALLY | Configure all ten required URL/account/model/paid controls and rerun without Mocking or skips. |

## 2026-08-15 queue after immutable run `31875413077`

| Item | Status | Required evidence |
|---|---|---|
| Stable keyboard-listener candidate | LOCALLY VERIFIED | Exact legacy Chromium `12/12`, mobile focused `4/4`, focused contracts `35/35`; reproduce from the committed SHA in immutable CI. |
| Hosted three-mode Canvas matrix | REQUIRED | Legacy, shadow and canvas-v2 must all pass unchanged 55/45 FPS, 50ms input P95, 100ms save-task, history, persistence and continuity gates. |
| PostgreSQL-gated generic tests | BLOCKED LOCALLY | `POSTGRES_TEST_DATABASE_URL` is absent; `12 files / 44 tests` are explicitly skipped. The immutable PostgreSQL job remains authoritative. |
| Real paid P0 | BLOCKED BY SECRETS | Configure real provider/account/database/storage Secrets and prove generation, cancellation, one charge and at-most-once refund. |
| Coze exact-SHA sequence | WAITING FOR CI | After immutable CI passes, run and retain `shadow -> canvas-v2 -> legacy` evidence on the same commit. |
| Stable branch | PROTECTED | Do not modify `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`. |

Stage 3 remains in Task 10. Stage 4/5 are not authorized.

## 2026-08-15 queue after immutable run `31878749102`

| Item | Status | Required evidence |
|---|---|---|
| Direct-pan and immediate-save candidate | LOCALLY VERIFIED | First independent review rejected two pointer-state ownership issues; both gained regressions, were corrected, and follow-up review returned `APPROVED`. Focused `8 files / 78 tests`, production legacy five-profile `60/60`, PostgreSQL-enabled full Vitest `441 files / 2512 tests`, TypeScript, ESLint `0 errors / 973 historical warnings`, protected-source `38/38` and build `116/116` pass. Reproduce from the committed SHA. |
| Hosted three-mode Canvas matrix | REQUIRED | Legacy, shadow and canvas-v2 must each pass the unchanged 55/45 FPS, 50ms input P95, 100ms save-task, history, persistence and continuity gates. Run `31878749102` remains RED at `57/60` per mode. |
| Local PostgreSQL gate | VERIFIED | Isolated PostgreSQL 18 full run completed `441 files / 2512 tests` with zero skips; retain immutable PostgreSQL CI as an independent gate. |
| Real paid P0 | BLOCKED BY SECRETS | Configure authorized provider/account/storage credentials and prove generation, cancellation, one charge and at-most-once refund. Mock data cannot close this item. |
| Coze exact-SHA sequence | WAITING FOR IMMUTABLE CI | After the new SHA passes all three modes, retain `shadow -> canvas-v2 -> legacy` login, old-project, 1/100/300-node, tool, save/reload and rollback evidence. |
| Stable branch | PROTECTED | Do not modify `stable`; verify its remote SHA before and after the main-only push. |

Stage 3 remains in Task 10. Stage 4/5 are not authorized.

## 2026-08-15 queue after immutable run `31873152403`

| Item | Status | Required evidence |
|---|---|---|
| Three-mode Canvas rerun | REQUIRED | The next exact `main` SHA must pass legacy, shadow and canvas-v2 with unchanged 55/45 FPS, 50ms input P95, 100ms save-task and continuity gates. |
| WebKit v4 unload recovery | REQUIRED | Immediate move/resize reload must retain final geometry after the bounded one-revision race; the following case must start from the intact node. |
| Immediate-save performance | REQUIRED | Hosted 300-node save scenarios must remain at or below 100ms without synchronous whole-user localStorage serialization. |
| Local PostgreSQL suite | BLOCKED LOCALLY | `POSTGRES_TEST_DATABASE_URL` is absent; 12 files / 44 tests remain explicitly skipped here. GitHub PostgreSQL concurrency is authoritative. |
| Real paid P0 | BLOCKED BY SECRETS | Configure real authorized provider/account/database/storage Secrets and prove generation, cancellation, one charge and at-most-once refund. |
| Coze exact-SHA sequence | WAITING FOR CI | After immutable CI passes, execute and retain `shadow -> canvas-v2 -> legacy` evidence on the same SHA. |
| Stable branch | PROTECTED | Do not modify `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`. |

## 2026-08-15 post-`c4c02a9` verification queue

| Item | State | Required proof |
|---|---|---|
| S3-BUG-023 legacy WebKit durability | IMMUTABLE RERUN REQUIRED | The delete/undo/redo/final-undo case must restore the node and observe its matching project-save POST; the following move/resize case must start from an intact one-node project. |
| S3-BUG-017 hosted performance | IMMUTABLE RERUN REQUIRED | Legacy, shadow and canvas-v2 desktop Chromium must meet unchanged 55/45 FPS, 50ms input P95 and 100ms save-task limits with zero disappeared and unclickable evidence. |
| Local PostgreSQL browser reproduction | BLOCKED LOCALLY | No isolated PostgreSQL service is configured on this workstation. Generic Vitest explicitly skips 12 files / 44 tests; GitHub's PostgreSQL job is the authoritative next execution. |
| Real P0 browser | BLOCKED BY SECRETS | Configure the required repository provider/account/database/storage secrets. Mock credentials are not accepted. |
| Coze exact-SHA sequence | NOT STARTED FOR NEXT SHA | Pull the exact new main SHA, prove shadow, then isolated canvas-v2, then mandatory legacy rollback. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. |

## 2026-08-15 remaining scope after local FPS-window correction

| Item | Status | Required evidence |
|---|---|---|
| Corrected FPS sampler | LOCALLY VERIFIED | Unit regression `17/17`, desktop subset `6/6` and full shadow five-profile matrix `60/60` pass without threshold changes. Commit and reproduce in immutable CI. |
| Hosted three-mode Canvas matrix | UNVERIFIED / REQUIRED | Run legacy, shadow and canvas-v2 from the new exact SHA. All functional and performance assertions must pass and upload immutable artifacts. |
| Real paid P0 and accounting | BLOCKED EXTERNALLY | Supply authorized provider credentials and prove generation, one charge, cancellation, monotonic terminal state and at-most-once refund. |
| Coze exact-SHA sequence | UNVERIFIED | After immutable CI, execute `shadow -> canvas-v2 -> legacy` with retained login, project, Canvas, tool, save/reload and rollback evidence. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. |

## 2026-08-16 pending verification after cancellation and quick-create fixes

- **P0 cloud cancellation/accounting: VERIFIED ON `9e6cfb0`.** Google Chrome reached `/api/cancel-task`; task `async-1786874691821-0-gqs5y2` remained `cancelled`; no late image entered Canvas after 50 seconds; one `-120` consume and one `+120` refund restored balance `138`. A repeated authenticated cancel returned the same task and the credits API still exposed exactly one refund row.
- **PostgreSQL concurrency: VERIFIED LOCALLY ON EXACT CANDIDATE.** A fresh PostgreSQL 18 cluster supplied `POSTGRES_TEST_DATABASE_URL` and `TEST_POSTGRES_URL`; full Vitest passed `441 files / 2523 tests` with zero skips, including task settlement/refund races, terminal monotonicity, projection, annotation, element-board and layered-decomposition concurrency. Evidence: `docs/testing/evidence/s3-bug-033-local-postgres-2026-08-16.json`. Immutable hosted PostgreSQL CI remains an independent unexecuted gate.
- **Quick Create proxy fallback:** the Coze fallback path has been observed continuing into a real Pear task. Exact HTTP-404 attribution and terminal authorization/model fail-closed behavior remain unverified in cloud evidence.
- **Immutable three-mode matrix:** GitHub runs `31916152862` and `31916152867` received no runner and executed no steps because of the account billing/spending limit. Rerun the exact SHA when infrastructure is restored; do not replace it with a local claim.
- **Release order:** Google Chrome on the isolated Coze preview first, then the stable deployment domain. Stage 4/5 and any `stable` branch change remain unauthorized.

## 2026-08-16 verification delta for `0a34c73`

- **Local three-mode Canvas matrix: VERIFIED.** Exact-SHA canvas-v2, legacy and shadow each pass `60/60` across Chromium, Chromium 1080p, Firefox, WebKit and mobile Chromium (`180/180`).
- **Native media continuity: VERIFIED LOCALLY.** All 30 pressure-pan samples report zero monitored native loads/src rewrites, zero disappeared frames and zero unclickable duration.
- **Hosted immutable matrix: STILL UNVERIFIED.** GitHub Actions billing prevented runner allocation and no workflow steps executed. Local evidence does not replace this release gate.
- **Coze exact-SHA Canvas regression: UNVERIFIED.** After `main` receives the candidate, Coze must pull the exact SHA and repeat the required Chrome deployment smoke/regression sequence.
- **Stage status:** Task 10 remains `10/11`; do not begin Stage 4/5 and do not modify `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`.
## 2026-08-18 Stage 4 Task 4 remaining verification

| Item | Status | Required proof |
|---|---|---|
| Exact pushed SHA | PENDING | Push normally to `main`, fetch again and record the remote SHA. |
| Coze authenticated Chrome | UNVERIFIED | Pull the exact SHA and repeat login, chat -> Canvas -> workflow -> chat, refresh recovery and browser evidence checks. |
| Real provider/accounting | UNVERIFIED ON THIS CANDIDATE | Prove one charge, cancellation, monotonic terminal state, late-result rejection and at-most-once refund. |
| GitHub hosted Actions | BLOCKED EXTERNALLY | Billing prevented runner allocation. Local verification does not reclassify this as passed. |
| Independent reviewer | UNAVAILABLE LOCALLY | Windows Codex executable returned access denied; manual review completed, but is not labeled independent. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. |

## 2026-08-20 Stage 4 cloud acceptance delta

| Item | Status | Required proof |
|---|---|---|
| Canonical Canvas -> workflow -> chat | VERIFIED | Google Chrome observed HTTP 200 `workflow-input` and `chat-result` transfers, workflow `5/5`, navigation and rendered returned image. |
| Historical Canvas images without `assetVersionId` | LOCALLY FIXED / CLOUD UNVERIFIED | Guarded session-owned adoption and canonical transfer now exist. Prove real PostgreSQL migration and the complete Coze Canvas -> workflow -> chat chain without duplicate assets. |
| Shadow renderer | VERIFIED FOR ONE-NODE PARITY | Server delivered `shadow`; legacy remained authoritative and `data-in-sync=true`. Broader browser matrix remains separate. |
| React Flow v2 selection/property editing | LOCALLY FIXED / CLOUD UNVERIFIED | Domain selection now follows node/pane clicks. Repeat drag/select/edit/save/reload in Coze and force rollback to legacy before enabling v2. |
| Chat -> Canvas paid front half | BLOCKED BY PROVIDER | APImartLLM returned `get_channel_failed` before image-tool invocation. Retry only when an authorized chat channel is healthy; do not classify the image provider as failed. |
| Real current-candidate accounting | UNVERIFIED | Prove one charge, cancellation, monotonic terminal state, late-result rejection and at-most-once refund on this candidate. |
| Runtime mode after testing | RESTORED | Coze sandbox again delivers `WUJIE_WORKFLOW_RENDERER_MODE=legacy`, HTTP 200. |

## 2026-08-20 S4-BUG-008 remaining verification

| Item | Status | Required proof |
|---|---|---|
| Project workflow save/reload | VERIFIED | Coze `main@016e5d2feb98cb0377fc0475389b10b914c1020f`, authenticated Google Chrome profile `用户1`: `/api/workflow/save` and project `/api/user-data/sync` returned HTTP 200; project metadata contained the one-node workflow; reload plus direct node-mode entry restored `1 节点 · 0 连线`; zero fresh Console Error/Warning. |
| PostgreSQL-only regression | BLOCKED IN CURRENT WORKSTATION RUN | Supply an isolated `POSTGRES_TEST_DATABASE_URL` and rerun the 70 explicitly skipped tests; do not count them as passed. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. |

## 2026-08-20 Stage 4 verification after historical adoption closure

| Item | Status | Remaining proof |
|---|---|---|
| Historical Canvas image adoption | VERIFIED | Real Coze/PostgreSQL adoption, workflow transfer, `3/3` execution, chat transfer, duplicate-intent placement reuse and full-reload identity retention passed in authenticated Google Chrome. |
| React Flow v2 selection and immediate Save | VERIFIED | Exact-business-tree Coze edit/save/reload/blank-pane clear and forced legacy rollback passed; keep broader renderer rollout gates separate. |
| Current provider generation/accounting | UNVERIFIED | Run one authorized real provider task, cancel before completion, prove one charge, durable `cancelled`, late-result rejection and exactly one refund. |
| PostgreSQL multi-instance accounting race | UNVERIFIED ON CURRENT CANDIDATE | Execute the current candidate against an isolated PostgreSQL concurrency environment; historical Stage 3 evidence does not automatically cover current Stage 4. |
| Hosted immutable Actions | BLOCKED EXTERNALLY | GitHub billing previously prevented runner allocation; local and Coze evidence do not reclassify the hosted gate as passed. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged. |

## 2026-08-20 Stage 4 verification after real-provider cancellation

| Item | Status | Remaining proof |
|---|---|---|
| Durable cancellation and late-result rejection | VERIFIED ON DEPLOYED `92d0ede` | Task `async-1787237343655-0-ehq3d9` remained `cancelled` for 73,895 ms and produced no matching Canvas result. |
| At-most-once charge/refund | VERIFIED ON DEPLOYED `92d0ede` | One `-60` consume and one `+60` refund restored balance `138`; repeated cancellation retained one refund. |
| Cancellation UI and Console cleanliness | LOCALLY FIXED / CLOUD UNVERIFIED | Deploy the narrow S4-BUG-012 fix, cancel a fresh paid task, observe informational `任务已取消`, zero generic `生成失败` toast and zero Console Error. |
| Direct provider remote-task cancellation | UNVERIFIED | Obtain a distinct provider `remoteTaskId` or provider audit evidence. Current evidence proves durable application cancellation and late-result rejection only. |
| PostgreSQL multi-instance accounting race | UNVERIFIED ON CURRENT CANDIDATE | Supply isolated `POSTGRES_TEST_DATABASE_URL` and execute all `70` currently gated tests against the exact candidate. |
| Hosted immutable Actions | BLOCKED EXTERNALLY | Prior billing prevented runner allocation; retain as missing independent evidence rather than a product failure or pass. |
| V5.8.8 absorption | NOT STARTED | Keep the snapshot read-only until Stage 4 exact-candidate UI and PostgreSQL gates close. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; all candidate work targets `main` only. |

## 2026-08-20 Stage 4 verification after terminal-placeholder persistence repair

| Item | Status | Remaining proof |
|---|---|---|
| Cancelled placeholder persistence | LOCALLY FIXED / CLOUD UNVERIFIED | Pull the new exact `main` candidate into Coze, reload the affected project, verify the cancelled empty frame is removed, wait for project sync and reload again to prove it cannot return. |
| Cancellation UI and Console cleanliness | CLOUD UNVERIFIED ON NEW CANDIDATE | A paid task must reach durable `cancelled`, show informational cancellation feedback, emit no generic failure Console Error and leave no reloadable placeholder. |
| PostgreSQL multi-instance accounting race | UNVERIFIED ON CURRENT CANDIDATE | Supply an isolated `POSTGRES_TEST_DATABASE_URL` and execute all `70` gated tests against the exact candidate. |
| V5.8.8 absorption | NOT STARTED | Keep `J:\无界云端0820` read-only until the two Stage 4 gates above close. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; push only to `main`. |

## 2026-08-21 Stage 4 closure and V5.8.8 transition

| Item | Status | Evidence / next boundary |
|---|---|---|
| Cancelled placeholder persistence | VERIFIED / CLOSED | Coze authenticated server snapshots at revisions `5295` and `5305` both contain seven images and no `gen-ph-1787238934569-0-hmfie8`. Evidence: `docs/testing/evidence/stage4-terminal-placeholder-cloud-2026-08-21.json`. |
| Stage 4 PostgreSQL concurrency/accounting | VERIFIED | Isolated PostgreSQL 18 candidate gate passed `2931/2931` with zero skipped immediately before the client-only hydration repair. |
| Stage 4 status | ACCEPTED | Do not repeat completed Stage 4 matrices. Reopen only if a new, independently reproducible regression appears. |
| V5.8.8 donor | NEXT / READ-ONLY | Freeze `J:\无界云端0820`, record its file and dependency baseline, then create the absorption inventory. No files are copied before an item has a RED compatibility test. |
| Stable branch | PROTECTED | `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains unchanged. All future changes target `main` only. |

## 2026-08-21 V5.8.8 selective absorption verification

| Item | Status | Remaining proof |
|---|---|---|
| V588-ADMIN-001 local implementation | VERIFIED LOCALLY | RED/GREEN contracts, related admin regression, full Vitest, TypeScript, zero-error ESLint and build passed. |
| V588-ADMIN-001 cloud API behavior | VERIFIED ON `1ba98f7` | Authenticated HTTP 200 response exposes both coverage objects, unavailable model/provider metrics and zero fabricated rows. Evidence: `docs/testing/evidence/v588-admin-001-cloud-api-2026-08-21.json`. |
| V588-ADMIN-001 Chrome UI | VERIFIED ON `1ba98f7` | Existing preview tab was hard-refreshed; model/provider empty states each appeared once, fabricated `99%` appeared zero times, and fresh Console Error/Warning count was zero. |
| Nullable `—` cloud row | NOT APPLICABLE TO CURRENT DATASET | The cloud response contained no valid row with an unknown rate. The branch is covered by the permanent focused UI contract; no cloud data was fabricated to force it. |
| Next absorption item | AUTHORIZED | Start `V588-ADMIN-002` with a repository-wide RED authorization-manifest contract. |
| Donor snapshot | READ-ONLY VERIFIED | No donor file has a write time after the captured baseline; lock digest remains unchanged. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; push candidate changes only to `main`. |

## 2026-08-21 V588-ADMIN-002 verification

| Item | Status | Remaining proof |
|---|---|---|
| Exact administrator route manifest | VERIFIED LOCALLY | The contract enumerates all 24 current routes and rejects route-set drift or an unreviewed guard pattern. |
| Representative rejection behavior | VERIFIED LOCALLY | Unauthenticated orphan scan returns `401`; non-admin returns `403`; neither path calls the protected media-health service. |
| Full local regression | VERIFIED | Focused `6/6`, administrator `26/26`, full Vitest `2868` tests, TypeScript, ESLint with zero errors, and build `114/114` passed. |
| PostgreSQL-only suite | NOT RUN FOR THIS ITEM | `70` tests remain gated by the absent isolated database. This item changes tests only and does not modify persistence or accounting. |
| V588-ADMIN-002 cloud behavior | VERIFIED ON `d220479` | Credential-free orphan scan returned `401`; authenticated Chrome refreshed the administrator dashboard with expected content and zero fresh Console errors/warnings. |
| Next absorption item | AUTHORIZED | Start `V588-ADMIN-003` with a RED dry-run/idempotency contract against the current media-health subsystem; do not import a parallel donor media source of truth. |
| Donor snapshot | READ-ONLY VERIFIED | Lock digest remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`. |
| Stable branch | PROTECTED | `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains unchanged. |

## 2026-08-21 V588-ADMIN-003 verification

| Item | Status | Remaining proof |
|---|---|---|
| Thumbnail migration and lease concurrency | VERIFIED LOCALLY | Isolated PostgreSQL 18.4 passed the full repository `2967/2967` with zero skips, including the two schema/claim/reclaim/stale-finalization tests. Evidence: `docs/testing/evidence/v588-admin-003-local-postgres-2026-08-21.json`. |
| Coze migration | VERIFIED ON `172f38c` | Authenticated status/dry-run now return `200`; the prior missing-table `500` is closed and two real variants persist as ready. |
| Administrator backfill API | VERIFIED IN CLOUD | Unauthenticated access returns `401`; dry-run discovered 10 and changed no state; two `limit=1` runs completed with final `ready=2`, zero pending/processing/failed. Database uniqueness and concurrent lease safety remain covered by the full PostgreSQL `2967/2967` run. |
| Canvas thumbnail projection | BLOCKED BY DEPLOYED `legacy` MODE | Two stable project reads returned `6` projects / `48` images and no thumbnails because variant projection is enabled only in `asset-v3`. Perform a controlled mode switch only through the existing doctor/release gate, prove delivery/reload/original fallback, then roll back to the approved mode. |
| Storage recovery | UNVERIFIED IN CLOUD | Remove or bypass the local thumbnail copy and prove `/api/serve-upload/thumbnails/{version}/{size}.webp` recovers the exact S3 object. |
| Browser evidence | CHROME CONTROL PENDING | The exact existing project and preview tabs were listed, but two claim attempts timed out. No new tab or alternate browser was used. Capture screenshot and zero fresh Console Error/Warning during the controlled projection run. |
| Donor snapshot | READ-ONLY VERIFIED | Lock digest remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`. |
| Stable branch | PROTECTED | Keep `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` unchanged; candidate changes target `main` only. |

## 2026-08-21 V588-ADMIN-003 verification after shadow reconciliation

| Item | Status | Remaining proof |
|---|---|---|
| Exact Coze source and health | VERIFIED ON `99d226a4` | Build passed, port 5000 returned HTTP 200, and `stable` remained unchanged. |
| Six-project shadow parity | VERIFIED | `6/6` legacy/graph projects match; mismatch, unmigrated, orphan and checkpoint-error counters are zero. |
| Project/image preservation | VERIFIED IN GOOGLE CHROME | The authenticated dashboard still contains 6 projects and 48 images; fresh Console Error/Warning is `0/0`. |
| Historical missing media | OPEN / 2 RECORDS | Classify each missing current media and placement, recover from controlled durable storage when possible, or record an explicit administrator decision without fabricating bytes. |
| Historical missing media classification | VERIFIED | One empty chat-only placeholder and one expired Canvas proxy asset are explicitly missing; neither has durable recovery metadata. |
| False-ready physical media | DETECTION VERIFIED / DATA OPEN | `e809f5c` reports one false-ready current version and its two active placements through `non-durable-ready-media`. Historical content remediation remains explicit. |
| `asset-v3` promotion | BLOCKED BY DOCTOR | `releaseReady=false`, `switchAuthorized=false`, blocker `non-ready-current-media`. Do not force the mode switch. |
| Thumbnail projection/reload | UNVERIFIED | After the two media records are resolved and the doctor authorizes promotion, prove 512/256 delivery, original fallback, reload and no image-count drift. |
| S3 thumbnail recovery | UNVERIFIED IN CLOUD | Prove the nested durable object can reconstruct the exact public thumbnail path after local loss. |
| V588-PROVIDER-001 | NOT STARTED | The current inventory still requires ADMIN-003 projection closure and V588-BUG-005 readiness hardening before starting the provider display-map item. |
| Donor and stable | PROTECTED | Donor lock digest remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`; `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains unchanged. |

## 2026-08-21 V588-BUG-005 remaining verification

| Item | Current evidence | Required closure |
|---|---|---|
| Exact-SHA cloud durability gate | VERIFIED ON `e809f5c` | Authenticated Google Chrome proved one false-ready current version, two active placements, blocker `non-durable-ready-media`, and zero fresh Console errors/warnings. No further gate verification is required. |
| Historical broken-media remediation | Three active broken asset/placement records are classified | Explicitly replace, regenerate or archive them; never silently fabricate or delete user content. |
| Protected baseline refresh | All protected features remain present, but 16 source-drift entries exceed the older allowlist | Review against the currently authorized main baseline in a dedicated change; do not weaken the gate inside this bug fix. |

## 2026-08-22 Task 6 safe-archive unresolved items

| Item | Status | Required closure |
|---|---|---|
| Overlapping archive then Canvas restore | VERIFIED LOCALLY | Archive commits first, restore rejects exact `ASSET_MEDIA_UNRECOVERABLE`, and final Asset/placement/snapshot/revision/ledger/audit state proves no partial restore. Focused `97/97`, affected `77/77`, full `3066/3066`. |
| Protected baseline source drift | BLOCKED | Review the `23` current drift paths in a dedicated authorization/baseline task; do not broaden the allowlist in historical-media remediation. |
| Cloud archive action | UNVERIFIED | No cloud POST or archive action was performed. Verify only after the local race is green and an explicit controlled target is approved. |
| Idempotent cloud retry | UNVERIFIED | No cloud retry was exercised; local tests do not replace an exact cloud execution proof. |
| `asset-v3` acceptance | UNVERIFIED / BLOCKED | Keep the approved runtime mode unchanged until doctor, historical media, thumbnail projection, reload, original fallback, and S3 recovery evidence all close. |
| Remediation module size | OPEN MINOR | `src/lib/asset-core/historical-media-remediation.ts` is a mixed `1079`-line module; review decomposition separately without changing the archive behavior in this task. |
| Broad asset ignore rule | OPEN MINOR | The repository-level `assets/` ignore rule remains broad and should receive a scoped ownership review. |
| Self-hosted production origin documentation/readiness | OPEN MINOR | Document and verify the self-hosted production origin/readiness boundary before treating local route/build evidence as deployment acceptance. |

## 2026-08-22 post-authorization unresolved items

| Item | Status | Required closure |
|---|---|---|
| Protected baseline authorization | VERIFIED LOCALLY | Exact 23-path manifest and provenance checks pass; no broad directory authorization exists. |
| Candidate push and Coze exact SHA | UNVERIFIED | Final local gates pass; fast-forward only `main`, then prove Coze pulled the exact resulting SHA. |
| Cloud archive action | UNVERIFIED / REQUIRES ACTION-TIME CONFIRMATION | Perform no POST until a fresh read-only candidate digest is compared and the administrator confirms the exact action. |
| Cloud idempotent retry | UNVERIFIED | After the authorized archive, replay the same idempotency key and prove one ledger/audit outcome and no duplicate mutation. |
| `asset-v3` acceptance | UNVERIFIED / BLOCKED | Keep `shadow` until archive/readiness closes and controlled thumbnail projection, reload, original fallback and S3 recovery pass. |

## 2026-08-22 S4-BUG-014 本地闭环后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| 精确源码授权 | 本地已验证 | 25 条精确路径来源验证和实际保护门禁均通过；禁止扩大为目录授权。 |
| `main` 集成与 Coze 精确 SHA | 已验证 | 干净 release worktree 全门禁通过；GitHub 和 Coze 项目页均为 `04a7a9104a96ae74325a76776e831c0e567e362b`，`stable` 未变化。 |
| 云端只读候选稳定性 | 已验证 | Chrome 两轮逐字段一致：`4 versions / 4 placements`，`coverage.complete=true`，`uncovered=0`，readiness 保持 fail-closed。 |
| 云端归档 | 未执行，需操作时确认 | 只读候选对齐后，由管理员确认精确候选集，再执行一次 POST。 |
| 云端幂等重试 | 未验证 | 使用同一幂等键重放，证明同一 remediationId、单一 ledger/audit 且无重复变更。 |
| 缩略图与 `asset-v3` | 阻塞 | 保持 `shadow`；历史 blocker 关闭后仍需验证缩略图投影、刷新恢复、原图回退和 S3 恢复，doctor 授权前不得切换。 |

## 2026-08-22 S4-BUG-014 软归档后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| 云端软归档 | 已验证 | 4 个版本和 4 个 placement 完成软归档；版本行保留，无物理删除、供应商调用或账务事件。 |
| 云端幂等重试 | 已验证 | 同一请求体与幂等键返回相同 remediationId，`reused=true`；ledger/audit 均为 1。 |
| 归档后候选与 readiness | 已验证 | 连续两轮候选均为 0；`releaseReady=true`、`switchAuthorized=true`、blocker 为空，迁移与 shadow 对账均为 `6/6`。 |
| `asset-v3` 投影与回退 | 未验证，未切换 | 在保持可回退的受控窗口验证缩略图投影、刷新恢复、原图回退、S3 恢复与回退；本次授权不包含模式切换。 |
| Coze 管理员 origin 持久化 | 待配置 | 在项目级环境变量中写入带 `-5000` 的精确预览 origin，并在正常重启后读取实际进程环境和执行管理员只读探针；`.env.local` 不能替代此项。 |
| Coze 本地空提交 | 待自然对齐 | `7912fd9` 不含文件变化且 tree 与 `origin/main@04a7a91` 相同，不推送；后续拉取新的 `main` 文档提交时自然对齐。 |
| 正式 V5.8.8 吸收 | `V588-UI-001` 已闭环 | `CanvasZoomCluster` 已完成 RED、最小接入、本地全量回归和 Coze exact-tree Google Chrome 验收；下一叶为 `V588-UI-002`。 |

## 2026-08-22 V588-UI-001 云端闭环后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| `V588-UI-001` 首叶 | 已验证 | Coze 代码树与 `main@986f128` 一致；缩放、重置、网格、连线、图层、历史、互斥和 AI 引擎均由 Google Chrome 实测通过，新鲜 Console 问题为 0。 |
| `V588-UI-002` | 未开始 | 按吸收清单选择下一个单一 UI 叶子，先写失败测试，不覆盖画布控制器或当前工具会话。 |
| `asset-v3` 投影与回退 | 仍未验证、未切换 | 该独立 Stage 4 发布门禁仍需缩略图投影、刷新恢复、原图回退、S3 恢复与回退验证；不能由本次 UI 通过替代。 |
| Coze 项目级管理员 origin | 仍待持久化 | 当前 `.env.local` 值正确且本次管理员操作成功；仍需在项目级环境变量中保存带 `-5000` 的 origin，避免重建后丢失。 |

## 2026-08-22 V588-UI-002 本地候选后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| `V588-UI-002` 本地门禁 | 已验证 | 聚焦 `18/18`、全仓 `3004/3004`、TypeScript、零错误 Lint、构建、保护基线和空白检查均通过。 |
| Coze exact-tree 与运行健康 | 未验证 | 拉取最终 `main` 后证明运行代码树一致、生产构建退出 0、根路径 HTTP 200 且 `stable` 未变化。 |
| Google Chrome 命令面板交互 | 未验证 | 复用现有标签页验证按钮/快捷键、检索、上下导航、执行、全部关闭方式、动作结果、图层/历史互斥和视觉布局。 |
| 输入焦点保护 | 未验证 | 在真实提示词输入框、文本域或选择控件中按 `Ctrl/Cmd+K`，确认面板不打开、焦点和输入内容不被劫持。 |
| 浏览器错误基线 | 未验证 | 从刷新后的时间截点采集 Console/原生弹窗，要求新鲜 Error/Warning 为 0。 |
| `asset-v3` 投影与回退 | 仍未验证、未切换 | 本 UI 项不能替代缩略图投影、刷新恢复、原图回退、S3 恢复与模式回退验收。 |

## 2026-08-22 V588-UI-002 云端闭环后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| `V588-UI-002` | 已验证 | Coze 与 `main@1681b2b` 精确对齐；构建/HTTP 健康、Google Chrome `30/30` 交互、Console 和视觉证据全部通过。 |
| `V588-UI-003` 小地图 | 未开始 | 先建立 100/300 节点映射、点击导航、缩放/尺寸变化、空状态/隐藏和性能预算 RED，不复制 donor 视口控制器。 |
| PostgreSQL 本机专项 | 环境阻塞 | 本轮 `18 files / 105 tests` 因缺少隔离库跳过；UI-002 不触及数据库，但跳过事实继续保留。 |
| `asset-v3` 投影与回退 | 仍未验证、未切换 | 继续独立验证缩略图投影、刷新恢复、原图回退、S3 恢复和模式回退，不能由 UI-002 通过替代。 |

## 2026-08-22 V588-UI-003 小地图云端关闭记录

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| `V588-UI-003` 小地图 | 已吸收，云端验证通过 | exact SHA 为 `efe5e4f16ac3c8a0c7ed6b8fc73cba48af6fd6b2`，机器证据为 `docs/testing/evidence/v588-ui-003-cloud-2026-08-22.json`。 |
| Coze exact SHA 与运行健康 | 已关闭 | Coze 工作区、`origin/main` 与 exact SHA 一致，构建退出 `0`、首页和鉴权健康接口 HTTP `200`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变。 |
| 默认关闭、入口与偏好 | 已关闭 | 工具按钮、命令面板、关闭按钮和刷新后的偏好恢复均通过。 |
| 响应式、视口与布局 | 已关闭 | `767/768px`、可用宽度 `559/560px`、右侧面板避让、空态、两种主题和 100/300 节点均通过；导航前后均为 `46%`。 |
| 浏览器与视觉证据 | 已关闭 | 仅使用 Google Chrome「用户1」现有标签页；最终 Console error/warning、网络失败和原生 dialog 均为 `0`，截图和日志已落盘。 |
| PostgreSQL 专项 | 仍未验证 | 缺少 `POSTGRES_TEST_DATABASE_URL`，18 个文件、105 个真实集成/并发测试保持跳过，不得冒充通过。 |
| 后续吸收 | 可进入下一唯一项 | `V588-UI-004` 必须重新从 RED 开始；donor 和 stable 继续只读。 |

## 2026-08-23 V588-UI-004 本地候选后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| 独立代码审查 | 已关闭 | 最终 `Critical/Important/Minor = 0/0/0`；桌面打开 SVG 面板后缩至 375px 的发现已完成最小修复与回归。 |
| Coze exact SHA 与运行健康 | 未验证，Chrome 控制阻塞 | GitHub 实现候选为 `be96c59d2d4dec6bbe510c3b7fd0de59ef092e0b` 且 `stable` 未变；Chrome 能列出正确现有标签，但项目页/预览页接管均超时。恢复控制后拉取最终 `main`，证明 exact SHA、生产构建、5000 服务与 HTTP 健康。 |
| Google Chrome 多视口矩阵 | 未验证 | 仅复用现有 Chrome 标签页，验证 375/768/1440、底部抽屉、图片 `+N`、右侧面板、8 个编辑入口、主题与 reduced-motion。 |
| 浏览器错误零基线 | 未验证 | 云端从新鲜时间截点确认 Console Error/Warning、失败网络请求和原生 dialog 均为 0。 |
| PostgreSQL 专项 | 环境阻塞 | 本地缺少 `POSTGRES_TEST_DATABASE_URL`，18 个文件、105 项真实集成/并发测试保持跳过，不得冒充通过。 |
| 本地同步 500 | 云端待排除 | 本地生产 E2E 的 `/api/user-data/sync?key=projects` 因无数据库返回 500；云端必须证明真实数据库环境下无同类错误。 |

## 2026-08-23 UI004-BUG-002 修复后的剩余验证

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| Coze exact `3becee8` | 未部署验证 | 在项目终端确认 `HEAD=origin/main=3becee8b54d9cc6320b137c4070e129cbed06ffe`、`stable=52f7c601...`、工作区无业务差异，构建退出 0、5000 端口和根路径健康。 |
| 同源安全图片端点 | 未验证 | 已登录会话请求真实 Pear URL 的 `/api/image/source` 返回 HTTP 200、正确图片 MIME 和非零字节；未登录返回 401，禁止协议/私网目标失败关闭。 |
| 擦除与蒙版源图 | 未验证 | 两个面板的 `img[alt=edit]` 自然尺寸非零，不再出现“图片加载失败”，加载前仍禁止绘制和提交，加载后真实笔迹可启用动作。 |
| 调色预览 | 未验证 | `img[alt=预览]` 自然尺寸非零，亮度等滑杆有可见预览；本轮只要求预览与入口，不在未授权情况下创建付费任务。 |
| 其余五个编辑入口 | 待复验 | 放大、SVG、去背景、扩展、裁切继续可打开、关闭且位置不越界，证明最小修复未引入功能丢失。 |
| Google Chrome 控制 | 当前阻塞 | 主实例能列出项目页与预览页，但标签读取/交互超时；另一实例仅有 360 导航页，已排除且不会使用。恢复连接后只复用现有 Google Chrome 标签，不新建标签。 |
| PostgreSQL 专项 | 环境阻塞 | 本机仍缺少 `POSTGRES_TEST_DATABASE_URL`，105 项真实集成/并发测试保持跳过。 |

## 2026-08-23 UI004-BUG-002 云端关闭更新

| 项目 | 状态 | 证据/剩余边界 |
|---|---|---|
| Coze exact SHA | 已验证 | `HEAD=origin/main=8c936cac777f5b05cfb381c73e929c13a5341efd`，`origin/stable=52f7c601ed150769e15d06fb435c6e360e28c9e7`。 |
| 同源安全图片端点 | 已验证 | 生产构建包含 `/api/image/source`；未登录请求返回 401 JSON，已登录面板加载 Pear 图片 `1536x1024`。 |
| 擦除与蒙版源图 | 已验证 | 两个面板均自然尺寸非零，真实笔迹使提交按钮可用。 |
| 调色预览 | 已验证 | 自然尺寸 `1536x1024`，渲染尺寸 `291x162.8125`，滑杆立即更新 filter。 |
| Google Chrome 控制 | 已恢复 | 只复用现有 Google Chrome 标签，未使用 360，未新建标签。 |
| PostgreSQL 专项 | 仍未验证 | 本地仍缺少 `POSTGRES_TEST_DATABASE_URL`，105 项跳过不计为通过。 |

## 2026-08-23 V588-SAFETY-001 云端关闭与剩余边界

| 项目 | 状态 | 证据/剩余边界 |
|---|---|---|
| 同步 WASM 大图像素预算 | 已验证 | Coze exact `d968ad3448c9a3202f462959baaa89dab5f471cd`；`1536x1024 -> 627x418`，面积 `262086 <= 262144`。 |
| 服务可用性 | 已验证 | 描摹约 `10.245s` 完成；并发健康探针 `80/80` HTTP 200，P95 `8.163ms`，最大 `13.152ms`。 |
| 结果与下载 | 已验证 | 结果节点保持 `1536x1024`；SVG 文件实际落盘，`4726` 字节且 SHA-256 已核对。下载事件监听超时属于自动化捕获限制，未掩盖。 |
| 浏览器错误基线 | 已验证 | Google Chrome 现有标签页 Console error/warning 与原生 dialog 均为 0。 |
| 其他 SVG 引擎 | 仍未验证 | Python VTracer、AI/Vectorizer、ImageTracer 和 Potrace 需要分别取得真实云端终态与下载证据。 |
| PostgreSQL 专项 | 仍未验证 | 105 项因缺少隔离库跳过；本路由不触及持久化或账务，但跳过项仍不计通过。 |
| 后续吸收 | 可进入下一唯一项 | `V588-AUTH-001` 必须从认证安全 RED 开始；donor 与 `stable` 继续只读。 |

## 2026-08-23 V588-AUTH-001 本地闭环后的未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| 本地认证实现与真实 PostgreSQL | 已验证 | `b0cd946f` 的聚焦 `63/63`，其中 8 项真实 PostgreSQL 集成/并发测试；独立复审 `0/0/0`。 |
| 本地多浏览器会话矩阵 | 已验证 | Chromium、Firefox、WebKit、1080p 与移动 Chromium，管理员/普通用户合计 `10/10`。 |
| GitHub main 精确提交 | 待推送核验 | 仅普通快进推送 `main`，记录远端最终 SHA；禁止修改或强推 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。 |
| Coze 精确 SHA 与会话矩阵 | 未验证 | Coze 拉取最终 main 后，在现有 Google Chrome 标签页验证登录、刷新、三个工作区、注销和注销后数据隔离，并检查新鲜 Console/网络错误。 |
| 非认证 PostgreSQL 全库门禁 | 部分未验证 | 全仓仍有 `19 files / 113 tests` 因缺少其他模块完整隔离数据库跳过；认证专项的 8 项真实数据库测试不能替代它们。 |
| 真实付费供应商与账务 | 未验证 | 隔离夹具无真实 provider 配置；图像/视频生成、取消、超时、单次扣费与一次退款仍需独立云端证据。 |
| 下一 donor 吸收项 | 暂停 | 先完成 Coze 认证 exact-SHA 闭环，再按优先级选择 `V588-ADMIN-004` 或 `V588-PROVIDER-005`；不得重复 AUTH 或跳过 RED。 |

## 2026-08-24 V588-AUTH-001 云端闭环后的未验证项

| 项目 | 状态 | 说明 |
|---|---|---|
| Coze 同 secret 冷启动与历史密钥环兼容 | 已验证 | exact `42e540bd`；刷新保持管理员会话，session、admin、projects 全部业务成功。 |
| 真实云端 auth secret 轮换 | 未验证 / 独立批准 | 仍需备份、未迁移 legacy 统计、previous-session 七天兼容和紧急失效回滚演练；本轮禁止顺带执行。 |
| 普通用户 Coze 重启前后登录 | 本轮未重复 | 本次修复针对持久化密钥环读取；管理员真实会话已闭环，普通用户仍按原 Task 10 矩阵保留独立证据要求。 |
| 非认证 PostgreSQL 全库门禁 | 部分未验证 | 默认全仓仍跳过 `19` 文件/`115` 项；本次认证专项真实 PostgreSQL 已 `10/10`，不能替代其他模块。 |
| 下一选择性吸收项 | 可进入 RED | 认证项不得重复；按当前优先级在 `V588-ADMIN-004` 与 `V588-PROVIDER-005` 中只选择一个，先完成只读差异与 RED。 |

## 2026-08-24 GPT Image 2 原生透明 PNG 未验证项

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| 本地领域合同与入口覆盖 | 已验证 | 所有主要生图入口、服务端规范化、能力拒绝和逐图 Alpha 校验已由单元/API/契约测试覆盖。 |
| 真实 GPT Image 2 透明生成 | 未验证 | 部署精确候选，在真实授权模型上提交 `background=transparent`、`output_format=png`，保存请求、供应商任务和成功终态证据。 |
| 真实 Alpha 文件 | 未验证 | 从画布下载最终 PNG，解码证明至少存在一个 Alpha 值小于 255 的像素；棋盘格或白底结果不得计为通过。 |
| 所有入口云端抽样 | 未验证 | 至少验证主生成面板、参考图入口、工作流和 Agent；其余入口由统一合同保护，但仍需在云端确认没有旧请求体覆盖规范字段。 |
| 多图逐张透明结果 | 未验证 | 使用 `n>1` 证明每张结果独立返回并分别记录 Alpha 状态，不能等待整批后统一展示。 |
| 扣费和失败边界 | 未验证 | 支持模型只扣一次；不支持模型在供应商提交和扣费前拒绝；不透明返回不会自动创建去背景任务或产生第二次扣费。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `19` 个文件、`114` 项真实集成/并发测试因缺少隔离 PostgreSQL 配置而跳过，不得冒充通过。 |
| 非专用模型分层 | 仅完成设计分析 | 本轮未实现。后续应以 OCR、主体/元素分割、深度估计、Alpha 蒙版、背景修复、矢量描摹和重建质量门禁组成可编辑层；不得宣称可从扁平图完美恢复原始作者图层。 |

## 2026-08-24 V588-PROVIDER-005 Task 11 后的未验证项

| 项目 | 状态 | 完成条件 |
|---|---|---|
| 隔离 PostgreSQL 能力往返 | 已验证 | PostgreSQL 18 一次性隔离集群 `1/1` 通过，覆盖两个供应商并发更新、重读、能力 JSON 与 `compatProfile/customHeader` 保留。 |
| 真实登录三浏览器 | 阻塞 / 未验证 | 提供隔离 `E2E_TEST_USERNAME`、`E2E_TEST_PASSWORD`，在 Chromium、Firefox、WebKit 执行生成面板、参考图组、融图组、节点和视频入口；当前运行 9 项跳过。 |
| 同名模型跨供应商差异 | 未验证 | 真实目录中找到相同 modelId、不同 providerId 且能力不同的模型对，逐入口证明比例、尺寸、质量、数量、时长和模式不串用。 |
| 管理员能力持久化 | 未验证 | 在 Coze 修改一个非破坏性字段，保存、刷新、重启后保持，再恢复原值；不得修改 API Key 或删除供应商。 |
| 真实付费图像与视频 | 未验证 | 显式启用 `E2E_ENABLE_PAID_GENERATION`，完成一图一视频，记录精确模型、任务终态、积分前后和一次扣费。 |
| 非法能力请求零副作用 | 未验证 | 在真实登录会话提交不支持参数，取得 `MODEL_CAPABILITY_MISMATCH`，并证明供应商任务数与积分均未变化。 |
 | Coze 与稳定域名 | 未验证 | GitHub/Coze/运行树精确 SHA 一致；Google Chrome 现有标签页完成五入口与稳定域名刷新恢复，Console/Network/Trace/截图齐全。 |

## 2026-08-24 合并后的统一云端未验证项

| 项目 | 状态 | 完成条件 |
|---|---|---|
| GitHub/Coze exact SHA | 待本地候选并入 main 后验证 | Coze 拉取最终 `origin/main`，运行树、构建树与 GitHub SHA 一致；`stable` 保持 `52f7c601...`。 |
| 原生透明 PNG | 未验证 | 使用真实 GPT Image 2 提交透明 PNG，下载结果并解码证明存在 Alpha 小于 255 的像素，且任务和扣费各一次。 |
| 透明多图逐张返回 | 未验证 | 使用 `n>1` 证明每张透明结果独立回填、分别校验 Alpha，不等待整批统一返回。 |
| 管理员能力持久化 | 未验证 | 修改一个无破坏性的模型能力字段，保存、刷新和重启后保持，再恢复原值。 |
| 普通用户五入口 | 未验证 | 图像面板、参考图组、融图组、节点和视频均只展示并提交当前模型支持的参数。 |
| 真实图像/视频与账务 | 未验证 | 各执行一个付费任务，核对 provider/model、供应商任务、最终状态、积分变化与一次扣费。 |
| 非法能力零副作用 | 未验证 | 不支持参数在供应商提交和扣费前返回 `MODEL_CAPABILITY_MISMATCH`，任务数和积分均不变。 |
| PostgreSQL 全仓专项 | 环境阻塞 | 当前仍有 `116` 项真实 PostgreSQL 集成/并发测试跳过，不得计为通过。 |

## 2026-08-24 Coze 对齐后的剩余项

| 项目 | 最新状态 | 仍需证据 |
|---|---|---|
| GitHub/Coze exact SHA | 已验证 | `main = origin/main = 0adbd5ee5b8e32e3987ddf0ccb9f09dd816f5f4d`；后续业务验收期间不得产生新云端源码提交。 |
| Coze 构建与运行 | 已验证 | 构建退出码 0、PID 2547、根路由/认证/11 个静态资源均为 200；业务验收完成后再复核一次进程和 SHA。 |
| Google Chrome 登录与工作区 | 未完成 | 复用现有预览标签登录，验证冷刷新会话、管理员仪表盘和无限画布入口；不得新建标签或使用 360。 |
| 原生透明 PNG 与能力矩阵 | 未验证 | 继续执行原表中的真实 Alpha、`n>1` 逐张回填、管理员持久化、普通用户五入口、图像/视频、单次扣费和非法请求零副作用。 |
| 浏览器可观测性 | 未验证 | 保存本次最终 SHA 下的 Console、Network、截图及下载文件 Alpha 解析证据；当前 Chrome 扩展重新绑定现有标签超时。 |

## 2026-08-24 `4711501b` 云端验收剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| GitHub 与本地候选 | 已验证 | `main = origin/main = 4711501bdeb059a16d404184ef38c0956a57fb06`；`stable` 不变。 |
| Coze 沙箱与 exact SHA | 阻塞 / 未验证 | 当前预览 HTTP 404 `instance_not_found`；重启沙箱、拉取 `4711501b`，证明运行树、构建树与 GitHub 一致。 |
| Chrome 控制 | 阻塞 / 未验证 | 现有项目页和预览页可枚举，但接管、DOM 快照和刷新动作超时；恢复页面动作通道后仍只复用现有标签。 |
| 透明 PNG `n=2` | 未验证 | 两个独立任务，第一张先回填，两张下载文件分别存在 Alpha 小于 255 的像素。 |
| 透明生成账务 | 未验证 | 恰好两笔生图扣费，余额与累计使用量变化等于两笔成本之和；不得出现隐藏去背景任务或重复退款。 |
| 能力矩阵与非法请求 | 未验证 | 管理员能力保存/刷新/重启保持；普通用户五入口一致；非法能力请求在供应商提交和扣费前拒绝且零副作用。 |
| PostgreSQL 完整门禁 | 环境阻塞 | `20 files / 116 tests` 仍因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过，不计为通过。 |

## 2026-08-24 `4e99aa33` 修复后的云端剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| S4-BUG-016 本地修复 | 已验证 | RED/GREEN、32 项聚焦回归、严格 TypeScript、改动文件零错误 Lint、2 项 E2E 发现和 `116/116` 构建通过。 |
| Coze exact SHA | 阻塞 / 未验证 | 项目页恢复可控后拉取最新 `origin/main`，证明运行树和构建树包含 `4e99aa33` 及后续报告提交；`stable` 保持不变。 |
| Google Chrome 项目页控制 | 阻塞 | 正确实例为“用户1”；项目标签在接管阶段连续超时，预览标签此前可正常操作。不得改用 360 或新建标签绕过。 |
| 透明 PNG `n=2` | 未验证 | 只提交一次 Pear `gpt-image-2 / 1:1 / 1K / transparent / PNG / x2`，取得两个唯一 taskId、第一张早于第二张回填、两份 PNG Alpha 像素证据。 |
| 透明生成账务 | 未验证 | 新增交易恰好两笔图像生成扣费，余额和累计使用量变化等于成本之和；无隐藏 RemoveBG、重复任务或额外扣费。 |
| 能力矩阵、视频与非法请求 | 未验证 | 管理员持久化、普通用户五入口、真实视频和 `MODEL_CAPABILITY_MISMATCH` 零副作用仍按原表闭环。 |

## 2026-08-24 S4-BUG-017 修复后的云端剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| Coze 旧候选健康 | 已验证 | `3c8fd1ca` 构建退出码 0、5000 与根路由/鉴权接口 200，`stable` 未触碰。该证据不能继承给尚未提交的新修复。 |
| S4-BUG-017 本地修复 | 已验证 | 两个 RED 后完成最小归一化；聚焦 `19/19`、全仓 `3423/3423`、严格 TypeScript、零错误 Lint 与 `116/116` 构建通过。 |
| 新候选 Coze exact SHA | 未验证 | 提交并推送后由现有 Google Chrome 项目页拉取，核对运行树、构建树与 GitHub 一致；不得触碰 `stable`。 |
| 透明 PNG `n=2` | 未验证 | 只提交一次 Pear `gpt-image-2 / 1:1 / 1K / transparent / PNG / x2`，取得两个唯一 taskId、第一张早于第二张回填和两份真实 Alpha 证据。 |
| 透明生成账务 | 未验证 | 恰好两笔生图扣费，余额及累计使用量变化匹配两笔成本；无隐藏 RemoveBG、重复任务或重复退款。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 116 tests` 因未配置隔离测试库跳过，继续不得计为通过。 |

## 2026-08-24 透明双图通过后的 Stage 4 剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 透明 PNG `n=2`、逐张回填与账务 | 已云端验证 | 两个唯一任务、两份 Alpha PNG、两笔各 60 积分及无隐藏 RemoveBG 证据已保存。 |
| 管理员能力持久化 | 本地已修复 / 云端未验证 | Coze 拉取含 `d56844b4` 的最终 main；保存图像和视频各一个低风险能力字段，刷新与沙箱重启后保持，再恢复原值。 |
| 普通用户五入口 | 未验证 | 普通用户在图像面板、参考图组、融图组、节点和视频入口只能看到并提交授权模型的有效参数。 |
| 非法能力零副作用 | 未验证 | 提交不支持的能力取得 `MODEL_CAPABILITY_MISMATCH`，积分、应用任务和供应商任务均不增加。 |
| 真实视频能力与账务 | 未验证 | 选择可用模型完成一次真实视频任务，核对时长、终态和恰好一次扣费。 |
| PostgreSQL 其余专项 | 环境阻塞 | 当前干净全仓仍有 `20 files / 117 tests` 跳过；本次仅真实执行供应商能力双结构 `2/2`，不能替代其他模块。 |

## 2026-08-24 管理员能力持久化关闭后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 管理员能力持久化 | 已云端验证 | Pear 图像与 APIMART 视频均完成保存、刷新、重读和原值恢复；历史 JSONB 路径另经沙箱重启验证。 |
| 普通用户五入口 | 未验证 | 使用隔离普通测试账号验证图像面板、参考图组、融图组、节点和视频入口；现有 `canvas-user` 历史密码已失效，未继续猜测。 |
| 非法能力零副作用 | 未验证 | 对 Pear/APIMART 的已授权模型提交明确超出目录的参数，取得 `MODEL_CAPABILITY_MISMATCH`，并证明积分、应用任务及供应商任务均不增加。 |
| 真实视频能力与账务 | 未验证 | 仅使用稳定的 PearAPI 或 APIMART 视频模型完成一次真实任务，核对模型能力、终态、积分变化和恰好一次扣费。 |
| Chrome 控制 | 已恢复连接 | 继续只复用现有 Google Chrome 项目页和预览页；新候选部署后执行强制刷新与视频验收，不得新建标签或改用 360。 |

## 2026-08-24 S4-BUG-018 修复后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| Pear 视频供应商与账务 | 已取得旧部署真实证据 | 5 秒 `doubao-seedance-2-0-mini-260615` 已完成且只扣一次 `250` 积分；该证据仅证明供应商与账务，不证明媒体展示可用。 |
| 视频媒体完成态 | 云端媒体加载已验证 / 播放交互待最终验证 | `ebf611ea` 已证明历史卡片存在可加载 `<video>` 且无 `MEDIA_UNAVAILABLE`；`fb674185` 修复播放浮层指针捕获后，仍需 Coze 拉取并证明播放时间真实推进。 |
| 视频刷新与下载 | 未验证 | 在 `fb674185` 上整页刷新和项目重开后视频仍可播放；下载得到非空媒体文件，并记录 URL、大小与 SHA-256。 |
| 视频账务复验 | 历史单次扣费已验证 / 新候选无重复扣费待验 | 旧真实任务只有一笔 `250` 积分扣费；部署 `fb674185` 后证明播放、刷新、恢复和下载不会新增扣费。 |
| 普通用户五入口 | 未验证 | 隔离普通账号验证图像面板、参考图组、融图组、节点和视频入口的授权模型与能力参数。 |
| 非法能力零副作用 | 未验证 | Pear/APIMART 不支持参数在供应商提交和扣费前返回 `MODEL_CAPABILITY_MISMATCH`，应用任务、供应商任务和积分均不增加。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 因本机未配置隔离数据库跳过，不得计为通过。 |

## 2026-08-25 视频云端闭环后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 视频展示、播放与刷新 | 已云端验证 | `f19ab164` 上 5 秒历史视频 `readyState=4`，播放时间推进，刷新后仍存在且可播放。 |
| 视频首次悬停下载与文件字节 | 已云端验证 | 首次点击打开 MP4 弹窗；真实文件 783,768 字节、`ftyp/isom`、SHA-256 `30E6CF78...A6927B5C`，下载错误日志为 0。 |
| 视频下载无新增扣费 | 未独立取样 | 下载路由不进入供应商或账务代码，但本轮未在点击前采集积分快照；如作为发布账务证据，需记录下载前后余额、交易和任务列表均不变。 |
| 普通用户五入口 | 未验证 | 隔离普通账号验证图像面板、参考图组、融图组、节点和视频入口的授权模型与能力参数。 |
| 非法能力零副作用 | 未验证 | Pear/APIMART 不支持参数在供应商提交和扣费前返回 `MODEL_CAPABILITY_MISMATCH`，应用任务、供应商任务和积分均不增加。 |
| 全仓源指纹门禁 | 未通过 | `stage-3-source-state` 在当前 Windows 环境超过自身 20 秒上限；不得通过增加等待时间隐藏，需单独定位性能原因。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 因缺少 `POSTGRES_TEST_DATABASE_URL` 跳过，不得计为通过。 |

## 2026-08-25 普通用户五入口与非法能力准入关闭后的剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 普通用户五入口 | 已云端验证 | 底部图像生成器、参考图组、融图组、节点和视频均按 Pear/APIMART 精确模型能力展示；融图数量可切换 `1-4张`。 |
| 非法能力应用侧零副作用 | 已云端验证 | Pear `gpt-image-2 / n=5` 返回 `MODEL_CAPABILITY_MISMATCH`；应用任务、积分流水和累计使用均不变化。 |
| 供应商后台独立零任务计数 | 未验证 | 本轮授权的 Google Chrome 标签没有 Pear/APIMART 供应商任务后台；当前仅由前置返回分支和应用数据库证明未进入提交路径。需要供应商侧审计时再独立取证。 |
| 普通用户管理员入口命名 | P3 待优化 | 点击“用户管理”只返回普通项目仪表盘，没有越权；后续 UI 阶段应改为不误导的入口名称或按角色隐藏。 |
| PostgreSQL 全仓专项 | 环境阻塞 | 既有 `20 files / 117 tests` 仍需完整隔离 `POSTGRES_TEST_DATABASE_URL` 才能执行；本轮云端只读计数不能替代并发/退款专项。 |
| V588-PROVIDER-001 | 已云端验证 | 精确映射、最长匹配、管理员名称优先、本地全量门禁和 Coze 普通用户图像/视频目录均已取得证据。 |
| V588-CHAT-001 | 已云端验证 | 模型菜单在 1440、412、375、320 四档关闭遮挡、裁切、滚动和点选问题；普通对话、CanvasEditor 与 Deep Research 三入口的 APImart 真实链路已通过。 |
| V588-CHAT-002 | 已云端验证 | 普通/联网原位重试、CanvasEditor 单版本、刷新精确任务恢复、服务器终态和 Deep Research 单 Artifact 均已闭环；第三方 exactly-once 仅保留为供应商能力边界。 |
| V588-CHAT-003 | 本地候选完成 / 云端待验 / 未吸收 | `5663441a30c279d5a696235020dae5d47cc0703d` 已完成版本化同步并修复历史服务端键迁移；真实浏览器、跨账号、PostgreSQL 迁移/并发与 Coze 矩阵仍未验证。 |
| V588-CHAT-004 | 部分现有能力 / 未吸收 | 无限画布已有更安全的 `AssetVersion -> /api/assets/transfer` 链路；来源追踪和发送到节点模式仍缺失，禁止复制 donor 的原始 URL `localStorage` 桥接。 |

## 2026-08-25 Simple Chat 本地加固后的云端待验项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 聊天模型下拉遮挡 | 已云端验证 | `main@9a3fcb63` 在桌面、412px、375px、320px 均位于视口内；4 个 option 可见，点选后菜单关闭。 |
| 图像模型下拉遮挡 | 已云端验证 | 320px 为 `left=12/right=308/width=296`；375、412、桌面均无横向裁切；23 个 option 使用内部滚动并可点选。 |
| 模型请求一致性 | 本地已修复 / 云端待验 | 切换 APIMart 模型后重新打开菜单显示正确 `aria-selected`，实际请求携带同一 `providerId + modelId`。 |
| Simple Chat 三入口 | 本地已加固 / 云端待验 | 普通对话、CanvasEditor 和 Deep Research 分别得到真实终态或如实供应商错误；CanvasEditor 流式期间切换任务/项目不回写旧结果或旧消息；无重复请求、原生弹窗或未处理 Console Error。 |
| Coze 服务替换期 chunk | 复发 / 未关闭 | `9a3fcb63` 启动后首次刷新出现 chunk 3230 加载失败；同一资源随后 200、第二次刷新恢复。需要原子发布或旧构建静态资源保留，并证明首次加载连续通过，不能把手动刷新当作发布修复。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 需要独立 `POSTGRES_TEST_DATABASE_URL`；不得使用生产数据库或把跳过项计为通过。 |

## 2026-08-25 Simple Chat 错误终态修复后的云端待验项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| CanvasEditor 供应商错误 | 本地已修复 / 云端待验 | APIMart 成功时只替换目标文本并保留其余内容；失败时显示供应商真实错误，不得退化为“AI 未返回内容”。 |
| Deep Research 供应商错误 | 本地已修复 / 云端待验 | 阶段提示最终必须被真实报告或明确失败替换，不得永久停在处理中；失败消息保留供应商原因。 |
| 普通对话模型配对 | 云端待验 | 切换 APIMart 模型后只产生一次 `/api/simple-chat/chat`，请求中的 `providerId + modelId` 与选中项一致，并得到真实终态。 |
| 三入口浏览器健康 | 云端待验 | 三条链路均无重复请求、浏览器原生错误弹窗、未处理 Promise 或新增 Console Error；网络日志保留精确终态证据。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 需要独立 `POSTGRES_TEST_DATABASE_URL`，不能使用生产库代替。 |

## 2026-08-25 V588-CHAT-001 云端关闭后的剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| V588-CHAT-001 成功链路 | 已云端验证 | APImart 普通对话、CanvasEditor 局部替换、Deep Research 均精确模型配对、单请求、SSE `done`；Console 和原生弹窗为 0。 |
| V588-CHAT-001 真实供应商失败注入 | 未执行 / 非关闭阻塞 | 本轮供应商三次均成功；`type:error` 保真与迟到流所有权已有本地 RED/GREEN 覆盖，但没有把它描述成云端故障注入。 |
| V588-CHAT-002 | 本地已实现 / 云端待验 | 普通/联网、Deep Research 与 CanvasEditor 自动化已通过；下一步是 Coze 真实失败、原位重试、刷新恢复和浏览器健康证据。 |
| V588-CHAT-003 | 本地候选完成 / 云端待验 / 未吸收 | 候选 `5663441a30c279d5a696235020dae5d47cc0703d` 已关闭全分支终审发现的历史键迁移 Critical；仍须完成 Coze 精确 SHA、真实多标签/离线/跨账号与 PostgreSQL 迁移/并发矩阵。 |
| V588-CHAT-004 | 未开始 | 保留安全 `AssetVersion -> /api/assets/transfer` 链路，补充来源追踪与发送到节点模式，禁止复制 donor 原始 URL `localStorage` 桥接。 |
| 部署期旧 chunk | 仍未关闭 | 首次加载连续通过与旧静态资源保留/原子切换仍需独立发布证据。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 需要独立 `POSTGRES_TEST_DATABASE_URL`，不得计为通过。 |

## 2026-08-25 V588-CHAT-002 本地实现后的云端待验项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 普通/联网原位重试 | 普通模式云端通过 / 联网模式待验 | `7bf1cc3c` 最终候选已证明单一失败消息、原位重试、单一 `/api/simple-chat/chat` 请求、冻结 APIMart 模型配对、复用幂等键和单一最终回复；联网搜索模式尚未执行同等故障注入。 |
| 离线遥测递归 | 已云端验证 | `7bf1cc3c` 故障注入窗口 `/api/client-error=0`，只有聊天、审计、用户同步各 1 次失败尝试，Console error/warning=`0/0`；该项不再阻塞。 |
| Deep Research 原位重试 | 云端部分通过 | 已真实证明失败态只有一个重试入口，单击后在同一消息位置恢复流式报告；长流控制锁阻止了完成态、请求快照和单一 Artifact 计数取证，服务器权威快照当时尚未出现测试标记。 |
| CanvasEditor 原位重试 | 重试链云端通过 / 选区输出待新提交复验 | `7bf1cc3c` 已证明失败保留指令、正文和精确选区，单击一次重试只产生一个 HTTP 200 请求和一个成功版本；同时发现选区片段与“完整文本”提示冲突，云端结果重复旧片段。已在 `e0ec998d` 以 RED/GREEN 改为只返回替换片段，待 Coze 拉取后证明结果精确为“前缀 + 新片段 + 后缀”。 |
| 刷新中断恢复 | 已云端验证 | `3ecd2f9b` 新任务真实流式 5 秒刷新后保留精确任务、部分正文和单一重试入口；服务器助手终态为 `failed`、`retryable=true`，消息各一份，Console/原生弹窗为 0。 |
| 第三方文本供应商 exactly-once | 能力相关 / 不保证 | 已证明应用复用并透传相同幂等键；只有供应商明确支持且云端审计证明时，才能声明供应商侧严格去重。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 因缺少隔离测试数据库跳过，不得使用生产库或计为通过。 |

## 2026-08-26 CanvasEditor 新构建部署后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 选区输出修复部署 | 已确认 | Coze 新 Build ID `5v4rvNIC6-MWnYjJ5HWaz` 的 Simple Chat 客户端脚本包含精确新契约，公网 `/` 与 `/simple-chat` 均为 200。 |
| CanvasEditor 精确替换 | 云端交互待验 | 在已登录 Google Chrome 中选中“原文”，单次修改后正文必须精确等于“前缀 + 新片段 + 后缀”，旧片段不得保留；记录请求次数、模型配对、版本数和 Console。 |
| 刷新中断恢复 | 云端待验 | 流式过程中刷新后，持久化消息必须收敛为可解释失败或可恢复终态，不能永久加载、重复消息或重复 Artifact。 |
| Chrome 页面控制 | 外部连接阻塞 | Chrome、扩展和 native host 检查均正常，但现有预览标签在重启后页面级操作超时；需要在同一标签重新连接扩展，不允许用 360 或新建标签替代。 |

## 2026-08-26 刷新中断修复后的待验项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 精确任务恢复 | 已在 `da1f5c4` 云端验证 | 新建对话 URL 包含 `projectId + taskId`；流式刷新后仍显示同一任务和测试标记，没有回到项目第一条旧对话。 |
| 中断终态持久化 | 已云端验证 | 历史遗留任务与新建 APImart 流式任务的服务器快照均为 `failed`，不再保留 `streaming`。 |
| 消息唯一性 | 已云端验证 | 新任务服务器快照严格为 1 条用户消息和 1 条助手消息；刷新未新增重复消息。第三方 exactly-once 仍不作保证。 |
| Deep Research 单 Artifact | 已云端验证 | APImart 报告完成后，刷新前后 UI 与服务器均严格为同一个 Artifact；助手消息为 `completed`，无重复消息或重复 Artifact。 |

## 2026-08-26 V588-CHAT-002 最新未验证边界

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 联网模式原位重试 | 已云端验证 | 离线失败、单一重试、冻结 APImart 配对与幂等键、HTTP 200、单一完成消息和浏览器健康均已取证。 |
| Deep Research Artifact | 已云端验证 | Coze `main-fix@1572a222` 包含 `90772d42`；报告完成后刷新前后 UI 与服务器均只显示并保存同一个 Artifact。 |
| Coze 沙箱 | 已恢复 | 5001 主修复预览入口 HTTP 200，本轮 Google Chrome 验收完成。 |
| 第三方 exactly-once | 能力相关 / 不保证 | 应用已复用幂等键；只有供应商明确支持并有独立审计证据时才可声明供应商侧严格去重。 |
| PostgreSQL 全仓专项 | 环境阻塞 | `20 files / 117 tests` 缺少隔离测试库，继续不计为通过。 |

## 2026-08-27 V588-CHAT-003 候选未验证边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 候选身份 | 本地已确认 | 基线 `9e05cf0881d0d64af4ba96311837885ac77b3c33`，最终复审修复后候选 `5663441a30c279d5a696235020dae5d47cc0703d`；`stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未修改。 |
| 阶段自动化 | 已通过 / 含明确跳过 | 修复前候选全仓 `3906 passed / 118 skipped / 0 failed`，API `765 passed / 3 skipped / 0 failed`，回归 `2887 passed / 10 skipped / 0 failed`，构建完成 `116` 个静态页面/路由；skipped 不计为通过。 |
| 全分支终审与修复 | Critical 已关闭 | 终审发现 1 个历史服务端键迁移 Critical；`5663441a` 保留 `data_key='chat_simple_projects'`、按用户 advisory lock，并将旧数组 revision `0` 在原行升级为 revision `1`。 |
| 修复专项证据 | 已通过 / PostgreSQL 未执行 | RED `2 failed / 10 passed`；GREEN 单元 `12/12`、Simple Chat API `28/28`、`ts-check`、目标 ESLint、保护基线 `38/38` 与 `git diff --check` 通过。窄复审 Ready to merge: Yes，问题 `0/0/0`。 |
| Playwright | 仅发现 / 未执行 | 五项目共发现 `70` 项，分别为 `chromium`、`chromium-1080p`、`firefox`、`webkit`、`mobile-chromium`；缺少真实浏览器账号凭据，不能计为浏览器通过。 |
| 跨账号隔离 | `UNVERIFIED` | 缺少专用次账号；必须使用互不相同的真实主/次账号验证缓存与服务器数据隔离。 |
| PostgreSQL 迁移与并发 | `UNVERIFIED` | 未配置 `POSTGRES_TEST_DATABASE_URL`，迁移与并发测试为 `2/2 skipped`；原行 revision 升级、原子 CAS 唯一 winner、冲突重放与最终 revision 仍需隔离 PostgreSQL 实测，不得计为通过。 |
| Coze 云端矩阵 | 待验 | Coze 尚未拉取并运行精确候选；项目/任务 CRUD、普通对话与 Artifact 恢复、多标签合并/冲突、删除不复活、离线恢复、仪表盘计数、退出同步、浏览器健康和最终数据库快照均需真实证据。 |
| 发布与吸收状态 | 有条件通过 / 未吸收 | `V588-CHAT-003` 仅本地候选完成，不是云端通过；云端矩阵全部关闭前不得进入 `V588-CHAT-004`，其他既有未验证项继续有效。 |

## 2026-08-27 V588-CHAT-003 构建修复待验边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Coze 构建阻断 | 本地已修复 / 云端未验证 | `11abb548` 已阻止 `.worktrees/` 与 `worktrees/` 进入 Git、TypeScript 和 ESLint；Coze 必须在保留现有嵌套工作树时重新构建成功。 |
| 服务健康 | `UNVERIFIED` | 5000 旧服务在失败构建前已停止；需重新取得 PID、Build ID、`/`、`/simple-chat`、`/api/auth/me` 与全部 HTML 静态资源状态。 |
| 业务矩阵 | 尚未开始 | 构建与服务健康未关闭前，不执行或宣称项目同步、多标签冲突、删除不复活、离线恢复、账号隔离及退出同步通过。 |

## 2026-08-27 V588-CHAT-003 构建关闭后的未验证边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Coze 构建与服务健康 | 已验证 | `origin/main@48c2ad3f` 构建退出码 0；Build ID `8Iztiwokck9HEnxplOf78`；根页、Simple Chat、认证接口和 12 个静态资源均为 HTTP 200。 |
| 普通对话与刷新恢复 | 进行中 | 已创建专用项目/任务并提交唯一测试标记；必须确认助手合法终态、刷新后消息与任务唯一、Artifact 恢复及无浏览器错误。不得在未知终态时重复提交。 |
| 多标签自动合并与同实体冲突副本 | `UNVERIFIED` | 用户约束禁止创建新 Chrome 标签；现有 Chrome 只有一个业务预览标签，不能用单标签结果冒充多标签通过。 |
| 删除不复活 | `UNVERIFIED` | 仪表盘计数、已同步任务恢复和直接返回工作台已云端通过；仍须在专用测试数据上执行删除并在刷新后证明不复活。 |
| 未同步写入的离页冲刷 | `UNVERIFIED` | 已同步任务返回工作台不绕登录页或画布页已经通过，但尚未构造未同步写入窗口并证明离页前完成持久化。 |
| 跨账号缓存与服务器隔离 | `UNVERIFIED` | 缺少已确认可用的专用次账号；必须使用两个真实账号验证。 |
| PostgreSQL 迁移与并发 | `UNVERIFIED` | 本机缺少有效 `POSTGRES_TEST_DATABASE_URL`；云端只证明已配置数据库，尚未取得最终 revision、CAS 唯一 winner 和冲突快照证据。 |

## 2026-08-27 V588-CHAT-003 首轮云端矩阵后的边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 普通对话、同步和刷新恢复 | 已云端验证 | APImart 完成标记唯一，刷新前后同一项目/任务、消息和“已同步”保持；项目/任务重命名已持久化。 |
| 仪表盘初始聊天数量 | 已云端验证 | `b92998da` 部署后，未点击聊天页签前侧栏首次渲染即显示 `2`；进入页签后仍为 `2` 个项目，Console 与原生弹窗均为 0。 |
| 已同步任务深链恢复与返回工作台 | 已云端验证 | 专用 `projectId + taskId` 恢复唯一历史标记；返回地址只经过当前 Simple Chat 和最终仪表盘，没有跳转登录页或无限画布。 |
| 任务/项目删除不复活 | `UNVERIFIED` | 删除属于真实云端数据变更，需在专用测试数据上执行并在刷新后证明不复活。 |
| 多标签合并与冲突副本 | `UNVERIFIED` | 当前禁止创建新 Chrome 标签，且只有一个业务预览标签；不能用单标签结果替代。 |
| 跨账号与 PostgreSQL 并发 | `UNVERIFIED` | 仍缺专用次账号和隔离 PostgreSQL 凭据。 |

## 2026-08-27 V588-CHAT-003 PostgreSQL 本地闭环后的边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 全新库迁移 | 本地已验证 | PostgreSQL 18.4 全新隔离库执行完整迁移和全仓测试；最终 `570/570` 文件、`4030/4030` 测试通过，`0` 失败、`0` 跳过。该项不再列为本地环境阻塞。 |
| Simple Chat 迁移与并发 | 本地已验证 | 历史数据键原行升级、CAS、冲突与同步相关数据库门禁均在完整 PostgreSQL 套件中执行；机器证据为 `docs/testing/evidence/v588-chat-003-postgres-local-2026-08-27.json`。 |
| Coze 精确 SHA 冷启动 | `UNVERIFIED` | Coze 尚未拉取包含 `f923b98fd51088c68ad2390052634f2d013fbdc6` 的最终 `main`；必须证明迁移成功、`/`、`/simple-chat`、`/api/auth/me` 健康，且历史专用任务仍可恢复。 |
| 任务/项目删除不复活 | `UNVERIFIED` | 属于真实云端数据删除，执行时需要用户操作时确认；删除后刷新与重新登录均不得复活。 |
| 未同步写入的离页冲刷 | `UNVERIFIED` | 需要在未同步窗口内发送真实消息并立即离页，属于对外提交操作，执行时需要用户操作时确认。 |
| 多标签合并与冲突副本 | `UNVERIFIED` | 用户明确禁止创建新 Chrome 标签；现有单标签不能替代多标签验证。 |
| 跨账号隔离 | `UNVERIFIED` | 当前没有第二个已确认可用的真实账号；不能用同账号或模拟数据冒充通过。 |

## 2026-08-27 V588-CHAT-003 Coze 冷启动后的剩余边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Coze 精确 SHA 冷启动 | 已验证 | `main@4793f602`、Build ID `ff5BAPW-3ycPVraxauIYN`；项目管理迁移、构建、启动、三个健康路由和 11 个静态资源通过。 |
| 历史项目/任务恢复 | 已验证 | 专用项目、精确任务、唯一历史标记、模型和“已同步”均在刷新后恢复；工作台首次显示 `智能对话 2`。 |
| 重启后首次同步 502 | 观察项 | 首次返回工作台记录 1 次 502 警告；随后进入项目和精确任务恢复未再出现新警告，数据未丢失。若后续再次出现，应登记独立缺陷并保留请求证据。 |
| 任务/项目删除不复活 | `UNVERIFIED` | 需对专用空任务或测试项目执行真实删除；浏览器删除属于破坏性操作，必须在动作时再次确认。 |
| 未同步写入的离页冲刷 | `UNVERIFIED` | 需发送唯一测试消息并立即离页；这是对外提交操作，必须在动作时再次确认。 |
| 多标签合并与冲突副本 | `UNVERIFIED` | 用户禁止创建新 Chrome 标签，当前单标签不能替代该测试。 |
| 跨账号隔离 | `UNVERIFIED` | 无第二个已确认可用真实账号，不能使用模拟账号冒充。 |

## 2026-08-27 V588-CHAT-003 最新剩余边界（覆盖前述旧状态）

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 任务删除不复活 | 已云端验证 | 专用空任务删除后刷新、返回工作台并重新进入项目，任务数稳定减少且被删任务未复活。 |
| 未同步用户写入的离页冲刷 | 已云端验证 | 唯一用户标记提交后立即离页，重进时从“正在同步”收敛为“已同步”，再次刷新严格保留 1 条。 |
| 离页后助手生成任务续跑 | `UNVERIFIED` | 严格立即离页后用户消息保留，但没有助手回复；需先明确产品预期，再以持久任务身份、终态和重复提交证据验收。 |
| Simple Chat 完整布局 | 已云端验证 | `main@483ee0ce` 部署后根容器为 `863/863/0`，输入框聚焦不偏移；关闭菜单为 `display:none`，聊天与图像菜单打开后仍覆盖消息且图像列表内部可滚动。 |
| 多标签合并与冲突副本 | `UNVERIFIED` | 用户禁止创建新 Chrome 标签；单标签不能替代多标签冲突测试。 |
| 跨账号隔离 | `UNVERIFIED` | 当前没有第二个已确认可用真实账号。 |

## 2026-08-27 V588-CHAT-003 最终状态（覆盖前述旧状态）

| 项目 | 最新状态 | 说明 |
|---|---|---|
| 离页中断助手终态 | 已云端验证 | 本项不引入后台聊天任务队列；刷新后同一助手消息收敛为唯一 `failed + retryable`，用户消息唯一且“已同步”，符合既有设计。 |
| 多标签不同实体合并 | 已云端验证 | 复用两个现有 Chrome 标签并发创建两个不同任务，刷新后两端均得到初始任务加两个新任务，共 `3` 个任务。 |
| 多标签同实体冲突副本 | 已云端验证 | 同一任务并发改名后，两端一致保留 `V588-TASK-CONFLICT-B` 与 `V588-TASK-CONFLICT-A（冲突副本）`，总任务数 `4`。 |
| 跨账号缓存与服务器隔离 | 已云端验证 | 从 `canvas-user` 切换到真实管理员 `Mr.joker` 后，普通用户两个专用项目均不可见，管理员只显示自己的 1 个默认项目。 |
| V588-CHAT-003 | 已吸收 | 本项不再包含未验证阻断。证据：`docs/testing/evidence/v588-chat-003-final-cloud-matrix-2026-08-27.json`。下一项是 `V588-CHAT-004`。 |

其余全平台未验证项继续有效；本节只覆盖 `V588-CHAT-003`，不把其他模块、Firefox/WebKit 全平台流程或第三方供应商 exactly-once 自动标记为通过。

## 2026-08-27 V588-CHAT-004 首轮云端剩余边界

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 管理员文本、托管图片与同用户跨项目转交 | 已云端验证 | 空工作流、已有导入工作流、重复转交、刷新恢复、来源追踪和既有画布转移均通过。 |
| 普通用户转交成功 | 已云端验证 | `canvas-user` 新建并同步自有项目后，文本消息真实转交为 1 节点、0 连线。 |
| 他人项目拒绝 | 已云端验证 | `canvas-user` 向 `Mr.joker` 项目发起真实交接 API，返回 HTTP 403 与 `FORBIDDEN`；没有读取或写入目标项目。 |
| URL-only 未托管历史媒体 | 已云端验证 | 正式 CAS 同步建立隔离旧格式样本；Chrome 真实禁用画布入口，节点模式只导入文本；API 返回 `images=[]` 与 `UNMANAGED_IMAGE_SKIPPED`，项目不含外部 URL，重复/刷新幂等，样本已清理。 |
| 带连线和自定义视口的已有工作流保持 | 已云端验证 | 受控基线为 2 节点、1 连线、80%；转交后为 4 节点、1 连线、80%，名称和基线节点不变，刷新后完全保持。 |
| V588-CHAT-004 | 已吸收 | 11 项云端矩阵全部通过，不再包含未验证阻断。证据：`docs/testing/evidence/v588-chat-004-final-cloud-matrix-2026-08-27.json`。 |

其余全平台未验证项继续有效；本节只关闭 `V588-CHAT-004`，不把 `NODE-003`、Firefox/WebKit、第三方供应商 exactly-once 或其他业务模块自动标记为通过。
## 2026-08-28 V588-STABILITY-002 剩余验证点

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| PostgreSQL 并发幂等 | `UNVERIFIED` | 在隔离库并发提交同一 `userId + Idempotency-Key`，证明唯一 taskId、唯一上游调用和唯一扣费；同键不同摘要必须 409 |
| PostgreSQL 终态与退款竞争 | `UNVERIFIED` | 让 completed、timeout、cancelled、failed 竞争，证明只保留一个终态，迟到完成不能覆盖，失败只退款一次 |
| Coze 精确 SHA 与启动 | `UNVERIFIED` | 推送 `main` 后由 Coze 拉取精确 SHA，完成构建、启动、健康路由与静态资源检查 |
| 真实 PSD 分析成功链路 | `UNVERIFIED` | Google Chrome 使用 PearAPI 或 APIMART 已授权 VLM 完成一次 Pro PSD 导出，记录 provider/model、taskId、requestId、积分和下载文件 |
| 真实同键重放 | `UNVERIFIED` | 同一请求摘要与幂等键重复提交，返回同一 taskId，不产生第二次调用或扣费 |
| 真实失败退款 | `UNVERIFIED` | 触发可控提供商失败或总超时，证明任务终态、一次退款和可理解错误提示 |
| `V588-STABILITY-002` | 本地候选完成 | 上述云端与数据库证据全部关闭后才可标为已吸收并进入 `V588-ADMIN-004` |

其余全平台未验证项继续有效；本节只描述 PSD 分析专项，不覆盖 AI PSD 独立生成器、Pear 分层、元素拆解或 PSD 合成质量。

本地终审补充：专项 `131/131`、全仓 `4068/4068` 已执行项、TypeScript、目标零警告 ESLint、生产构建和空白检查均通过；独立复审无 Critical/Important。以上仍不能替代本表列出的真实 PostgreSQL 与 Coze 证据。

## 2026-08-28 V588-STABILITY-002 图片预览入口剩余验证

| 项目 | 状态 | 关闭条件 |
|---|---|---|
| Coze 精确候选 | `UNVERIFIED` | Coze 受控对齐 `origin/main@6bea240f34dcbd3176ab1e63a8ccb43d32a54797`，证明代码树一致、构建/启动/健康路由及静态资源通过 |
| 画布双击图片 | 本地已修复 / 云端待验 | 在现有 Google Chrome 预览标签中选择真实已加载图片，双击一次即打开图片预览，不要求第三次点击 |
| 交互隔离 | `UNVERIFIED` | 云端证明单击仍只选择、拖动不误开预览、视频/占位框不误开、编辑和批注模式不被双击抢占 |
| 浏览器健康 | `UNVERIFIED` | 双击与关闭预览全程无新增 Console error/warning、无原生错误弹窗 |
| PSD 入口连续性 | `UNVERIFIED` | 图片预览打开后可见 Pro/Studio PSD 入口；付费分析仍须独立动作时确认并记录供应商、模型、taskId、requestId、积分和下载文件 |

当前 Chrome 扩展能发现正确的 Coze 项目页和预览页，但页面级操作持续超时；此项属于验证环境阻塞，不计为产品通过或失败。

## 2026-08-28 V588-STABILITY-002 图片预览入口最新状态（覆盖上一节）

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Coze 精确候选 | 已验证 | Coze 运行 `main@2e1e21e2856e91e6bf1ed1af83aed68610d35c8c`，包含 `6bea240f` 修复；代码树、构建、启动、健康路由和静态资源已确认，`stable` 未变。 |
| 单击与双击图片 | 已云端验证 | 真实 `3504 x 2336` 图片单击只选择，双击一次严格打开 1 个预览，关闭后严格归零。 |
| 浏览器健康 | 已云端验证 | 本轮 Console error/warning `0/0`，无原生错误弹窗。 |
| PSD Pro 入口 | 已云端验证 | 预览 `PSD` 按钮可见，源码固定调用 `downloadPSD(..., 'pro')`；本专项明确不调整导出 UI。 |
| 拖动隔离 | 已云端验证 | 真实拖动 `24 x 16px` 未误开预览，随后 `Ctrl+Z` 精确恢复原坐标，Console 无错误。 |
| 视频/占位框与编辑/批注隔离 | `UNVERIFIED` | 需要相应真实对象和模式；不得用普通图片双击结果替代。 |
| 真实付费 Pro PSD | `UNVERIFIED` | 使用授权 PearAPI/APIMART VLM，记录 provider/model、taskId、requestId、积分变化和下载文件。 |
| 同键重放、失败退款与 PostgreSQL 竞争 | `UNVERIFIED` | 仍按上一节主矩阵执行；本次 UI 通过不自动关闭账务与并发门禁。 |

证据：`docs/testing/evidence/v588-stability-002-image-preview-cloud-2026-08-28.json` 与同名 PNG。

## 2026-08-28 V588-STABILITY-002 最新剩余项（覆盖数据库旧状态）

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| PostgreSQL 并发幂等 | 已本地验证 | 全新 PostgreSQL 18.4 隔离库证明唯一任务、唯一执行器、唯一扣费及同键异摘要冲突；已进入 CI。 |
| PostgreSQL 终态与退款竞争 | 已本地验证 | `completed / failed / timeout / cancelled` 只有一个赢家，迟到终态被拒绝，退款最多一次，余额一致。 |
| 云端真实 Pro PSD | 等待动作时确认 | Google Chrome 已停在真实图片预览的 `PSD` 按钮前；点击预计扣除 15 积分并把图片提交给管理员已配置的 VLM。当前尚未点击、未扣费。 |
| 云端同键重放 | `UNVERIFIED` | 需在同一真实任务上下文复用相同摘要与幂等键，证明返回同一 taskId，且供应商与扣费均不重复。 |
| 云端失败退款 | `UNVERIFIED` | 需使用可控失败或超时，不得故意改坏生产配置；证明唯一失败终态、一次退款和可理解提示。 |
| 最终 PSD 文件 | `UNVERIFIED` | 需验证下载文件存在、可解析、图层数量与结构合理，并记录 provider/model、taskId、requestId 与积分前后值。 |
| 视频/占位框及编辑/批注双击隔离 | `UNVERIFIED` | 普通图片拖动隔离已通过，但这些对象和模式尚无本轮真实云端样本。 |

本地机器证据：`docs/testing/evidence/v588-stability-002-postgres-local-2026-08-28.json`。本节只覆盖数据库旧状态，不关闭云端付费、供应商或文件质量门禁。

## 2026-08-28 Pro PSD 修复后的最新待验项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 旧云端 Pro PSD | 已验证失败 | `main@28a722b3` 缺少幂等 Header，HTTP 400；下载文件仅为本地回退，不能算真实供应商通过。 |
| 修复候选 | 本地通过 | 共享异步客户端、轮询、合法幂等、图层 URL 物化已通过全仓 `4195/4195` 与真实 PostgreSQL。 |
| 修复后 Coze 精确 SHA | `UNVERIFIED` | Coze 拉取即将推送的新提交后，确认运行 SHA、构建、启动、健康路由与静态资源。 |
| 真实供应商成功 | `UNVERIFIED` | POST 必须快速返回应用 taskId，阶段至少出现供应商等待和 PSD 下载/解析；最终下载 PSD 包含真实远端图层。 |
| 一次扣费 | `UNVERIFIED` | 记录提交前后积分、taskId、provider/model 与唯一账务记录；本次 400 尝试不能证明扣费。 |
| 同键重放 | `UNVERIFIED` | 使用完全相同的幂等键和请求摘要返回同一 taskId，供应商调用与扣费均不得增加。 |
| 失败退款 | `UNVERIFIED` | 受控失败或超时收敛到唯一终态并只退款一次，不修改生产供应商配置制造故障。 |

机器证据：`docs/testing/evidence/v588-stability-002-psd-pro-cloud-prefix-2026-08-28.json`。

## 2026-08-28 Pro PSD 本地终审后的云端剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 本地持久提交合同 | 已验证 | 按源独立 v3 记录、WebCrypto 摘要、Web Locks、代次防旧写、目标冻结、taskId 直连恢复与失败关闭均有自动化证据。 |
| 本地 PSD 几何与 Studio 保真 | 已验证 | 裁剪层源尺寸、负偏移命中、单次绝对偏移、检查器尺寸及 Studio 阴影/效果组已覆盖。 |
| 本地完整门禁 | 已验证 | 真实 PostgreSQL 全仓 `588/588 files`、`4213/4213 tests`，失败与跳过均为 0；Lint、TypeScript 与 8 GiB 堆生产构建退出 0，静态页面 `117/117`。 |
| 修复后 Coze 精确 SHA | `UNVERIFIED` | Coze 拉取待推送的新 `main`，确认 SHA、构建、启动、健康路由和静态资源。 |
| 真实远程分层终态 | `UNVERIFIED` | Pro PSD 必须快速取得应用 taskId，跨刷新恢复同一任务并经历供应商等待、制品下载/解析，最终 PSD 含真实远程图层。 |
| 云端一次扣费与同键重放 | `UNVERIFIED` | 记录积分、taskId、provider/model；同摘要同键重放必须返回同一任务且无第二次供应商调用或扣费。 |
| 云端失败退款 | `UNVERIFIED` | 使用安全可控的供应商失败或总超时，证明唯一失败终态、一次退款和可理解提示，不改坏生产配置。 |

旧云端 `main@28a722b3` 的 400 与本地 PSD 回退只证明修复前失败，不能作为上述任何新云端项的通过证据。

## 2026-08-28 ac8e826b 部署后剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| Coze 精确 SHA / tree | 已验证 | `HEAD=origin/main=ac8e826b34f91649c47cefd504d9d6664ee12eb8`，tree 一致，`stable` 未变 |
| 构建、启动、健康与静态资源 | 已验证 | build 0、Build ID `VALgz1-sdVe-tiy5Jz8yU`、PID `4372`、三个 HTTP 200、11/11 静态资源成功 |
| Chrome 登录态与 Pro PSD 入口 | 已验证到提交前 | 现有标签恢复项目，双击图片打开预览，`PSD` 按钮可见且可用；30 秒健康窗口 error/warning `0/0` |
| Pear 真实远程任务 | `UNVERIFIED` | 操作时确认后点击真实提交，快速返回应用 taskId，并经历 `submitting-pear`、`waiting-for-pear`、制品下载/解析阶段 |
| ZIP Range 下载与 PSD 提取 | `UNVERIFIED` | 真实 Pear ZIP 经 1 MiB Range 下载，提取非 `_depth` 主 PSD，编辑器展示至少 2 个可编辑远程图层 |
| 一次扣费与同键重放 | `UNVERIFIED` | 记录积分与账务；同请求同键返回同一 taskId，不增加供应商任务或扣费 |
| 失败/取消退款 | `UNVERIFIED` | 安全受控失败或取消只产生一个数据库终态与一次退款，迟到完成不得覆盖 |

部署证据：`docs/testing/evidence/v588-stability-002-ac8e826b-cloud-deploy-2026-08-28.json`。当前阻塞仅是付费动作时确认及其后的真实运行时间，不得把提交前状态写成通过。

## 2026-08-28 一次真实付费后的剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Pear 应用任务快速建立 | 已验证 | 应用任务 `layer_bde7c937-ecdb-4fee-b901-54c834aeb1f0` 与远端任务 `6bbcd3f8-1d11-41be-8866-40fba1bfb479` 已建立，浏览器未出现同步超时。 |
| 供应商失败回退 | 已验证 | Pear 在制品前失败；任务原子进入本地回退并最终 `completed/ready`，下载 PSD 可解析。 |
| 一次扣费与一次退款 | 已验证 | 19:16 `-15`、19:18 `+15`，`credit_status=refunded`，净变化 0。 |
| 远程 ZIP Range 下载 | `UNVERIFIED` | 本次 `remoteArtifactUrl=null`，没有调用 Range 下载器；需 Pear 成功返回 ZIP 后验证 1 MiB 分段与稳定 validator。 |
| 主 PSD 提取与远程图层 | `UNVERIFIED` | 需从真实 ZIP 选择非 `_depth.psd` 主文件，并证明最终 PSD 含至少 2 个远程可编辑图层。 |
| 同键重放 | `UNVERIFIED` | 需复用同一幂等键与摘要返回同一 taskId，且不增加供应商任务或扣费。 |
| 显式取消退款 | `UNVERIFIED` | 需安全取消处理中任务，证明唯一取消终态、一次退款与迟到完成拒绝。 |

本次下载文件属于本地智能回退，不能替代上述远程成功路径。下一次付费动作仍需单独动作时确认。

## 2026-08-28 Pear 失败诊断修复后的剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 结构化供应商错误 | 本地已验证 | 自动化证明 `code/type/param/message` 在轮询、智能回退和最终任务结果中保留；待部署后观察一次真实失败响应。 |
| 请求协议 | 已复核 | 当前字段与 Pear 官方图片编辑、异步任务查询契约一致；除非取得新的官方证据，不调整端点或重复提交。 |
| 远程 ZIP Range 与主 PSD | `UNVERIFIED` | 仍需供应商成功返回真实 ZIP，验证 Range 下载、非 `_depth` 主 PSD 选择和 `8BPS` 解析。 |
| 远程可编辑图层 | `UNVERIFIED` | 最终 PSD 必须包含至少 2 个来自远端制品的可编辑图层；本地回退图层不计。 |
| 同键重放 | `UNVERIFIED` | 同一摘要与幂等键返回同一应用 taskId，供应商任务和扣费均不得增加。 |
| 显式取消退款 | `UNVERIFIED` | 处理中取消只产生唯一取消终态和一次退款，迟到完成不得覆盖。 |

本轮没有再次提交付费任务。部署后可先用自然失败验证结构化诊断，无需为验证错误字段故意破坏供应商配置。

## 2026-08-28 ca356477 部署后的最新剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Coze 精确 SHA、构建与健康 | 已验证 | `HEAD=origin/main=ca3564779685be52f1dc13b8f0106f27095647f9`；专项 `23/23`、build 0、三个 HTTP 200、静态资源 `11/11`。 |
| Chrome 干净刷新 | 已验证 | 已登录节点项目和工作流工具栏恢复；刷新后 Console error/warning `0/0`。 |
| 真实结构化供应商错误 | `UNVERIFIED` | 等待下一次自然 Pear 失败，确认最终任务结果保留受限长度的 `providerError.code/type/param/message` 与 `fallbackReason`；禁止改坏供应商配置制造失败。 |
| 远程 ZIP Range 与主 PSD | `UNVERIFIED` | 供应商成功返回 ZIP 后，证明 1 MiB Range、稳定 validator、非 `_depth.psd` 主文件选择与 `8BPS` 解析。 |
| 远程可编辑图层 | `UNVERIFIED` | 最终 PSD 至少包含 2 个来自远程制品的可编辑图层；本地回退不计。 |
| 云端同键重放 | `UNVERIFIED` | 相同摘要与幂等键返回同一应用 taskId，供应商任务和扣费不增加。 |
| 显式取消退款 | `UNVERIFIED` | 处理中取消只产生唯一 `cancelled` 终态和一次退款，迟到完成不得覆盖。 |

证据：`docs/testing/evidence/v588-stability-002-ca356477-cloud-deploy-2026-08-28.json`。本节覆盖此前“待部署”状态，但不覆盖任何真实供应商成功、重放或取消结论。

## 2026-08-28 ca356477 同键重放后的最新剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 云端同键重放 | 已验证 | 相同摘要和幂等键返回同一应用 taskId；同键任务数、余额、扣费/退款流水和 Pear taskId 均未变化。 |
| 真实结构化供应商错误 | `UNVERIFIED` | 等待自然 Pear 失败，确认最终结果保留受限长度的 `providerError.code/type/param/message`；不得破坏配置制造失败。 |
| 远程 ZIP Range 与主 PSD | `UNVERIFIED` | 供应商成功返回 ZIP 后验证分段下载、稳定 validator、非 `_depth.psd` 主文件和 `8BPS` 解析。 |
| 远程可编辑图层 | `UNVERIFIED` | 最终 PSD 至少包含 2 个来自远程制品的可编辑图层；本地回退不计。 |
| 显式取消退款 | `UNVERIFIED` | 处理中取消只产生唯一 `cancelled` 终态和一次退款，迟到完成不得覆盖。 |

机器证据：`docs/testing/evidence/v588-stability-002-ca356477-idempotency-replay-2026-08-28.json`。本节仅覆盖此前“云端同键重放未验证”状态，不扩大为远程成功或取消通过。

## 2026-08-28 a50fcbeb 方案 C 后剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| 客户端取消注册竞态 | 本地已验证 | 16 条组件状态测试与 10 条客户端测试通过；云端行为仍需单独验收。 |
| Coze exact-SHA | `UNVERIFIED` | Coze 拉取后必须证明运行提交精确等于 `a50fcbeb73803b9886bab2ec82327c1e8f5bb209` 或其纯文档后继。 |
| 提交响应前立即取消 | `UNVERIFIED` | 真实 Pear 任务返回同一 taskId，只产生一个取消请求，最终唯一 `cancelled`。 |
| 提交响应前立即关闭/路由离开 | `UNVERIFIED` | 窗口或页面离开后 keepalive 取消仍完成，不遗留 processing 任务。 |
| 取消账务 | `UNVERIFIED` | 只扣费一次、最多退款一次；迟到 `completed` 不得覆盖 `cancelled`。 |
| 远程 ZIP/PSD 成功 | `UNVERIFIED` | 仍需 Pear 成功返回真实 ZIP，验证 Range、主 PSD、`8BPS` 与至少 2 个远程可编辑图层。 |
| PostgreSQL 本轮重跑 | `UNVERIFIED` | 本轮本机没有 `POSTGRES_TEST_DATABASE_URL`，122 项明确跳过；不得把历史证据写成本轮通过。 |

## 2026-08-29 Pear 图层顺序修复后的最新剩余项

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Pear 异步提交 | 已验证 | 真实应用 POST 快速返回 taskId，任务进入供应商等待；未再出现 4 分 30 秒同步请求导致的 `Failed to fetch`。 |
| ZIP 下载与主 PSD 提取 | 已验证到质量门禁 | 真实任务越过 `downloading-psd` 并进入 `checking-quality`；这证明 ZIP 与主 PSD 已被消费，但不证明最终图层质量通过。 |
| 取得 taskId 后立即取消与退款 | 已验证 | `layer_bc4b0371-956c-40b7-8c0d-00b726c9e666` 最终唯一 `cancelled`，余额和累计使用恢复到基线。 |
| 提交响应前关闭/路由离开 | `UNVERIFIED` | 仍需证明未知 taskId 窗口经同键恢复后只取消一次，不遗留 processing 任务。 |
| 修复后 Coze exact-SHA | `UNVERIFIED` | 推送本次 Pear 图层顺序候选后，Coze 必须精确拉取并完成构建、启动和强制刷新。 |
| Pear 成功终态与可编辑图层 | `UNVERIFIED` | 真实任务达到 `completed/ready`；编辑器至少显示 2 个远程图层，可独立显隐/移动/保存，且没有整图校正层覆盖实际图层。 |
| 成功账务 | `UNVERIFIED` | 成功任务只扣费一次，不退款；同键重放仍返回同一任务且不产生第二次供应商任务或扣费。 |
| PostgreSQL 本轮重跑 | `UNVERIFIED` | 本轮 122 项因未配置隔离 `POSTGRES_TEST_DATABASE_URL` 跳过；历史真实数据库证据不冒充本轮运行。 |
| Firefox / WebKit | `UNVERIFIED` | 在不触发重复付费的条件下完成登录、任务恢复、编辑器和保存回归。 |

### `940a0b7f` 部署后的收敛状态

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Coze exact-SHA、构建与健康 | 已验证 | `HEAD=origin/main=940a0b7f...`；`53/53` 专项、build 0、Build ID `TUepofVA2ahBpz5Izw2Fj`、PID `4332`、三个 HTTP 200、静态资源 `11/11`。 |
| Chrome 登录与入口 | 已验证 | 既有 Google Chrome 标签刷新后保持管理员登录，画布图片可选，“可编辑图层”入口可打开；未新建标签。 |
| Pear 成功终态与远程图层 | `UNVERIFIED` | 等待一次明确授权的真实扣费任务达到 `completed/ready`，打开至少 2 个可独立显隐、移动和保存的远程图层。 |
| 成功账务与同键零重复 | `UNVERIFIED` | 成功只扣费一次且不退款；同键重放返回同一 taskId，不新增供应商任务或积分流水。 |

机器证据：`docs/testing/evidence/v588-stability-002-940a0b7f-cloud-deploy-2026-08-29.json`。

### 2026-08-29 权威最新状态（覆盖本文件此前所有 Pear 成功表述）

- 管理员云任务与账务记录是最终依据：`layer_be958ed4-b5d4-4afa-865d-f960a4fd8c85` 实际为 `failed / checking-quality / refunded`，不是远程成功任务。
- ZIP 下载、非 `_depth` 主 PSD 选择、`8BPS` 解析和 6 个像素图层已验证；Pear 将 `3504x2336` 输入变为 `1280x1280`，质量门禁得到 `MAE=0.7853434784673393`、得分 `21` 并正确拒绝。
- BUG-009 旧 `initialResult` 串用已完成本地专项 `8/8`、分层聚焦 `44/44`、全仓 `4155 passed / 122 PostgreSQL-gated skipped / 0 failed`，TypeScript、零错误 ESLint 和 `117/117` 生产构建通过。
- **仍未验证：** 精确部署本次 `main` 后的 BUG-009 云端回归、Pear 保持源图尺寸/比例的真实成功终态、远程图层编辑/保存/PSD 导出及成功任务一次扣费且不退款。完成前不得关闭 `V588-STABILITY-002`，不得进入 `V588-ADMIN-004`。
- 权威机器证据：`docs/testing/evidence/v588-stability-002-pear-audit-correction-2026-08-29.json`。

### 2026-08-29 Pear 审计纠正后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| ZIP 下载与主 PSD 提取 | 已验证 | 真实 ZIP 可下载，正确选择非 `_depth.psd` 主文件并解析 6 个像素图层。 |
| Pear 尺寸/比例保持能力 | `UNVERIFIED / BLOCKED BY PROVIDER OUTPUT` | 官方确认 Image-Layered 是否支持 `size`/`aspect_ratio` 并能保持源图比例；或用天然 `1:1` 源图取得不变形成功结果。 |
| Pear 成功终态 | `UNVERIFIED` | 应用任务必须真实达到 `completed/ready`，`result.decomposition.engine=pear`，不得使用本地 fallback 或旧编辑器状态。 |
| 成功账务 | `UNVERIFIED` | 同一成功任务恰好一笔 `-15` 且无退款；记录应用 taskId、Pear taskId 和交易 ID。 |
| 远程图层编辑/保存/导出 | `UNVERIFIED` | 至少 2 个 `source=pear-psd` 图层可移动、显隐、保存刷新恢复；导出文件存在、`8BPS` 且图层数正确。 |
| BUG-009 旧结果串用 | 本地专项通过 / 云端未验 | 全量门禁后部署精确 `main`，依次打开两张图片证明第二张不继承第一张 `initialResult`。 |
| BUG-008 完成浮层关闭 | `UNVERIFIED` | 必须在真实完成父任务对象仍存在时关闭浮层并保持关闭；普通空任务面板关闭不能代替。 |

机器证据：`docs/testing/evidence/v588-stability-002-pear-audit-correction-2026-08-29.json`。

### `940a0b7f` 真实 Pear 成功后的收敛状态

| 项目 | 最新状态 | 说明 / 关闭条件 |
|---|---|---|
| Pear 成功终态与远程图层 | 已验证 | UI `completed/100%`；PSD 编辑器显示 5 层，主体/背景可独立选择与显隐；隐藏校正层后底层仍能重建画面。 |
| ZIP 与非 depth 主 PSD | 已验证到编辑器 | 真实云端任务已越过质量门禁并打开 5 层编辑器；不是本地回退 PSD。 |
| 成功账务 | `UNVERIFIED` | 仍需只读数据库核对：恰好一笔 `-15`、无退款、无重复供应商任务，并记录应用 taskId。 |
| PSD 导出 | `UNVERIFIED` | 需点击导出并验证下载文件存在、`8BPS` 签名、图层数及无错误弹窗。 |
| 图层移动与保存 | `UNVERIFIED` | 需真实拖动独立图层并验证位置变化、保存/刷新恢复；当前只完成选择与显隐。 |
| BUG-008 云端修复 | `UNVERIFIED` | 本地 `64/64` 通过；部署后确认完成态浮层可关闭且任务状态仍可恢复。 |

机器证据：`docs/testing/evidence/v588-stability-002-940a0b7f-cloud-deploy-2026-08-29.json`。

### 文档最终裁决：Pear 远程成功结论已撤销

本节位于文件末尾并覆盖上方所有历史检查点。管理员云任务确认 `layer_be958ed4-b5d4-4afa-865d-f960a4fd8c85` 的权威终态为 `failed / checking-quality / refunded`；此前 UI 显示的 5 层不能归因于该任务。当前仅可确认 ZIP、主 PSD 与图层解析通过，Pear 远程成功、远程图层编辑、成功账务仍为 `UNVERIFIED`。本地 BUG-009 修复已通过 `4155` 项全仓测试、TypeScript、零错误 ESLint 和 `117/117` 生产构建，云端部署回归仍待执行。

最终机器证据：`docs/testing/evidence/v588-stability-002-pear-audit-correction-2026-08-29.json`。

## 2026-08-29 V588-STABILITY-002 `90231c70` 未验证项增量

- `V588-STABILITY-002-BUG-009` 已移出未验证：Coze Google Chrome 已证明新图片“编辑元素”只进入干净初始态，证据见 `docs/testing/evidence/v588-stability-002-90231c70-bug-009-cloud-2026-08-29.json`。
- `V588-STABILITY-002-BUG-008` 保留：必须使用真实 `completed` 的 `element-decompose-parent` 驱动前端状态，验证关闭后浮层隐藏、父任务仍保留、重新打开仍能查看状态；空面板关闭不算通过。
- 当前配置成本为 Pear `Image-Layered=60`、Pear `gpt-image-2=60` 积分/图。历史 15 积分授权与当前定价不一致，因此本轮未发起新付费任务。

## 2026-08-29 `805e695d` 未验证项更新

- `V588-STABILITY-002-BUG-008` 已移出未验证：Google Chrome 完成态证明关闭、编辑器保持和重开状态保留均通过。
- `V588-STABILITY-002-BUG-010` 新增为开放 P2：完成态面板重开后视觉上被画布媒体遮挡，需层级回归和最小修复。
- Pear 远程 `completed/ready`、成功一次扣费、远程图层移动/保存/刷新和 PSD 导出仍为 `UNVERIFIED`；本次零积分本地两层结果不得替代这些证据。
- Coze 全量测试的 2 项 `auth-login-configuration` 域名环境断言仍为未通过项；需统一测试环境域名合同后复验。

## 2026-08-29 BUG-010 本地修复后的剩余证据

- 本地代码和自动化门禁已通过；仍需部署新 SHA 后，在既有 Google Chrome 预览标签验证完成态元素拆解面板完整位于画布媒体之上。
- 云端证据必须包含本地存在的 PNG 截图、面板关闭/重开状态、PSD 编辑器独立关闭行为、Console error/warning 与网络摘要。
- 此视觉回归不应创建新的供应商任务或扣除积分；远程 Pear 与账务验证仍按独立未验证项处理。

## 2026-08-29 `b0eefdf4` 未验证项收敛

- `V588-STABILITY-002-BUG-010` 已移出未验证：Coze Google Chrome 已证明初始态、完成态和完成态重开均无遮挡，Portal 层级、状态保留及 PSD 编辑器独立关闭均通过。
- 保留：Coze `auth-login-configuration` 域名环境合同、Pear 远程 `completed/ready`、远程图层编辑/保存/刷新、PSD 导出、成功一次扣费以及失败/取消一次退款。
- 本轮积分只读查询超时，因此没有把 BUG-010 的视觉关闭解释为账务关闭。

## 2026-08-29 Coze 域名测试合同未验证项收敛

- `auth-login-configuration` 的宿主域名污染已在本地注入 Coze 风格变量后复现并修复，同环境 `37/37` 通过；从功能缺陷清单移除。
- 保留部署证据：Coze 拉取本提交后，需在其原生环境至少运行登录契约测试并证明不再出现域名断言失败。
- 保留发布证据：本机生产构建因 4 GB OOM、8 GB 资源异常终止而未完成；仍须由 Coze 构建或具备足够内存的干净环境提供成功终态。
- Pear 远程 `completed/ready`、图层移动/保存/刷新、PSD 导出、成功一次扣费及失败/取消一次退款继续保持 `UNVERIFIED`。

## 2026-08-29 `4d0ee0d7` Coze 域名合同最终收敛

- Coze 原生环境复验已完成，`auth-login-configuration` `37/37`、构建与三个健康端点通过；该项从未验证表移除。
- 保留：Pear 远程 `completed/ready` 与真实 ZIP/主 PSD、至少两个远程可编辑图层、图层移动/保存/刷新、PSD 导出 `8BPS` 与图层校验。
- 保留：成功任务恰好一次扣费且不退款；失败和显式取消任务最多一次退款，迟到完成不得覆盖终态。

## 2026-08-29 `2166f032` 精确目标路由后的剩余云端证据

- 本机 12 GiB Node 堆生产构建已通过，Build ID `BEGTUtSa2MLS18fd4_yW6`；Coze 仍未精确拉取并构建包含修复的最新 `main`，因此只保留 Coze 部署构建为 `UNVERIFIED`。默认/8 GiB 构建容量继续作为资源风险记录，不再误记为代码构建失败。
- 真实元素拆解请求必须包含 `layerProviderId=api_1785190544435_1heimk6` 与 `layerModelId=Image-Layered`，并确认用户授权接口在提交时仍允许该 pair。
- 必须证明任务进入 `submitting-pear -> waiting-for-pear -> downloading-psd -> extracting-psd -> checking-quality -> ready`；如供应商失败，应保留结构化原因并正确退款，不能用本地 fallback 结果标记 Pear 通过。
- 成功路径仍需：真实 ZIP、唯一非 `_depth.psd` 主 PSD、`8BPS`、至少 2 个 `source=pear-psd` 可编辑图层、移动/显隐、保存刷新恢复和 PSD 导出文件检查。
- 账务仍需：成功任务一次扣费且不退款；同键重放不新增任务或扣费；失败/取消最多一次退款；迟到完成不覆盖终态。

## 2026-08-29 `128ec13b` 来源门禁后的剩余验证

- Coze 干净检出尚未精确拉取 `128ec13b`；必须复跑 `protected-baseline-gate.spec.ts` 和全量 Vitest，确认不再依赖本机侧分支对象。
- `pnpm check:protected-baseline` 当前仍阻止 41 个既有业务文件。每个文件需按实际来源、测试证据和发布边界单独审计；不得批量加入宽泛白名单。
- `122` 项 PostgreSQL 专项在本轮本机环境因缺少隔离测试库跳过，继续保持未验证；不得指向生产数据库补跑。
- Pear 远程成功终态、真实图层编辑/保存/刷新、PSD 导出、一次扣费及失败/取消一次退款仍未关闭。

## 2026-08-29 `bf8d8623` 精确授权后的剩余验证

- 原 41 个保护基线漂移已在本地逐项审计并关闭，不再列为本地阻断；仍需 Coze 对最终提交执行 `pnpm check:protected-baseline`，证明干净检出也为 `0` 个未授权漂移。
- Coze 最终提交尚未完成全量 Vitest、生产构建、单实例 5000 启动、`/`、`/simple-chat`、`/api/auth/me` 与静态资源健康检查。
- `122` 项 PostgreSQL 专项仍因缺少 `POSTGRES_TEST_DATABASE_URL` 隔离库未执行；禁止使用生产数据库代替。
- Pear 远程成功终态、真实图层编辑/保存/刷新、PSD 导出、一次扣费及失败/取消一次退款继续保持未验证。

## 2026-08-29 `c3bfc812` 云端门禁后的剩余验证

- Coze 干净检出、保护基线、全量测试、生产构建、5000 单实例、健康端点、静态资源与 Google Chrome 稳定态冒烟均已关闭，不再列为未验证。
- `22` 个文件内的 PostgreSQL 专项仍因未提供隔离测试库而跳过；本轮 Coze 虽配置业务 PostgreSQL，但按安全约束没有把生产/业务库当测试库使用。
- Pear 真实远程完成态、图层编辑/保存/刷新、PSD 导出、成功一次扣费、失败/取消最多一次退款及迟到完成拒绝仍未关闭。

## 2026-08-29 唯一 Pear 付费任务后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| ZIP MIME、安全下载、主 PSD 提取与解析 | `VERIFIED` | 真实任务已返回 ZIP 并进入质量门禁；不再列为沙箱能力阻断。 |
| 真实失败一次退款 | `VERIFIED` | 任务恰好一笔 `-15`、一笔 `+15`，余额恢复 403。 |
| Pear 远程可编辑成功 | `FAILED / OPEN` | `decomposition.engine` 必须为 `pear`，至少 2 个 `source=pear-psd` 图层通过质量门禁；不得由本地 fallback 代替。 |
| 本次 1:1 PSD 几何根因 | `PARTIALLY VERIFIED` | 坐标差已定位为 `1254 -> 1280` 未归一；远程内容仍有 `MAE=0.7125`、重复率 `0.8621` 和人物部件层名。下一次付费前确认模型适用素材范围，并为坐标归一化建立 RED。 |
| 成功账务 | `UNVERIFIED` | 成功任务恰好一次扣费、零退款，provider/model/价格与管理员展示一致。 |
| 计费价格单一权威源 | `CLOUD DEFAULT PASS / CUSTOM PENDING` | `c79cd0fe` 已让管理员默认显示价与权威 `segment=15` 结算一致；provider/model 自定义价格仍需在一次远程成功任务中核对展示、预检、`creditCost` 和流水。 |
| smart 回退终态说明 | `FAILED / OPEN` | UI 明确显示 Pear 失败原因、已退款、实际使用本地引擎，自动化不得把父任务 completed 误判为 Pear 成功。 |
| 图层编辑文档持久化 | `UNVERIFIED / IMPLEMENTATION GAP` | 使用已批准的数据库专用文档，绑定用户、项目、源图版本与任务；移动、显隐、重命名、顺序跨刷新和设备恢复。 |
| PSD 导出 | `UNVERIFIED` | 下载文件存在、`8BPS`、图层数/顺序/位置与保存文档一致。 |

权威证据：`docs/testing/evidence/v588-stability-002-pear-smart-fallback-2026-08-29.json`。

## 2026-08-29 坐标与计价本地修复后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 管理员 Image-Layered 价格 | `CLOUD UI PASS` | `c79cd0fe` 管理员页面已显示 15 积分/次并与既有权威任务结算一致；后续 provider/model 自定义价格仍需在成功任务矩阵中复核。 |
| 源图到 PSD 坐标归一 | `CLOUD CODE/TEST PASS` | 云端同提交专项已覆盖 `1254 -> 1280` 同宽高比归一与不同宽高比拒绝拉伸；本轮未再次付费，历史错误制品仍保持失败。 |
| Pear 远程制品质量 | `FAILED / OPEN` | 获得与源素材匹配、通过既有 MAE/重复层/空层/越界门禁的远程图层；不得降低阈值。 |
| smart 回退终态说明 | `LOCAL PASS / CLOUD PENDING` | 本地已由持久化退款事实驱动披露；Coze exact-SHA 后在现有 Chrome 标签确认分支卡片和完成提示明确显示实际本地引擎与退款，且普通本地执行不误报退款。 |
| 图层文档持久化 | `DESIGN ONLY` | 审阅并实施 `docs/superpowers/specs/2026-08-29-layer-document-persistence-design.md`，完成用户/项目/源版本绑定、乐观锁、刷新和跨设备恢复。 |
| 通用 PostgreSQL 套件 | `122 TESTS SKIPPED` | 使用专用 `POSTGRES_TEST_DATABASE_URL` 执行，不得指向 Coze 业务库或生产库。 |

### BUG-015 本地关闭后的云端验证点

- Coze 必须精确拉取本轮最终 `main` 提交，`origin/stable` 保持 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 复用已有 Google Chrome 项目页和预览页，不创建新标签；验证完成态可编辑图层分支显示“实际引擎：本地分层”和“Pear 云端分层未完成，已退款并使用本地分层”。
- 优先复用既有回退任务或非付费合同验证；不得为了文案再次触发付费 Pear 任务。
- 升级前已完成且缺少披露字段的父任务应在第一次查询时通过纯存储快照从既有终态子任务补齐证据；若子任务已过期或仍为非终态，应保留原完成结果而不是推进子任务或返回错误。验证所有路径都没有新的 Pear taskId、worker lease、扣费或退款记录。
- 本项云端关闭不代表 Pear 远程制品质量成功，也不关闭图层文档保存、刷新恢复、成功账务或 PSD 导出。

### `2d3c2582` 云端部署后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| Coze exact-SHA、构建与健康 | `VERIFIED` | `HEAD=origin/main=2d3c2582...`，131/131 专项、Build ID `m5wMb_9pluExcucjbglti`、三个 HTTP 200、静态资源 11/11。 |
| 元素拆解基础 UI | `VERIFIED` | 既有 Chrome 登录态下选图正确、面板可打开、Console 0/0、无原生弹窗。 |
| 历史退款回退文案 | `UNVERIFIED` | 让既有 completed 父任务在真实 UI 中恢复，观察“实际引擎：本地分层”及中性退款回退说明；不得创建新的付费失败任务。 |
| 图层文档持久化 | `DESIGN ONLY` | 实施 `002-C`，完成用户/项目/源版本绑定、乐观锁、保存、刷新和跨设备恢复。 |
| Pear 远程成功与成功账务 | `FAILED / UNVERIFIED` | 合适素材取得 `engine=pear`、2+ 远程图层、一次扣费零退款；不得以本地 fallback 替代。 |
| PSD 导出 | `UNVERIFIED` | 下载并验证 `8BPS`、图层数、顺序、位置与持久化文档一致。 |

### `002-C` 本地实现后的剩余验证

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 图层文档代码与 PostgreSQL CAS | `VERIFIED LOCALLY` | `245517c1`，全仓 4348/4348、隔离 PostgreSQL 唯一 winner、保护基线 38/38。 |
| Coze exact-SHA | `UNVERIFIED` | Coze `HEAD`、`origin/main` 与 `245517c1` 或后续仅文档提交精确一致。 |
| 编辑状态刷新恢复 | `UNVERIFIED` | Chrome 完成移动、显隐、锁定、重命名、排序、关闭、刷新和重开，状态逐项一致。 |
| 跨设备恢复 | `UNVERIFIED` | 同账号第二浏览器读取同一源版本文档，不读取其他用户或其他源版本。 |
| PSD 最终导出 | `UNVERIFIED` | 文件签名为 `8BPS`，图层数、顺序、坐标与最终保存 revision 一致。 |
| Pear 成功账务 | `FAILED / UNVERIFIED` | 真实 `engine=pear`、2+ 可编辑层、一次扣费、零退款；不得以本地 fallback 替代。 |

### `18adea/9e4d945e` 后的最新剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| `002-C` 创建/更新 | `CLOUD PARTIAL PASS` | 重命名、隐藏、锁定和“已保存”已通过；不再重复这四项。 |
| `002-C` 恢复 | `CLOUD PASS` | 移动、排序、导出模式、关闭重开与整页刷新均已逐项通过；测试变更已还原并再次恢复确认。 |
| `002-C` PSD 导出 | `CLOUD PASS` | `图片_studio_edited.psd` 为 `14,089,648` 字节、`8BPS`，解析后的 5 层顺序和坐标与最终文档一致。 |
| Pear 图像专用请求 | `LOCAL PASS / CLOUD PENDING` | Coze 精确部署 `9e4d945e` 或后续 main，并证明真实请求不再携带 prompt。 |
| Pear 远程质量 | `FAILED / OPEN` | 使用模型适用、内容可核对的源图取得 `engine=pear`、2+ 合格图层；不能降低门禁或使用本地 fallback 冒充。 |
| Chrome 预览标签控制 | `TEST TOOL BLOCKED` | 在不新建标签、不切换 360 的前提下恢复同一 Google Chrome 预览标签控制，然后继续剩余 UI 动作。 |
| 本轮全仓 PostgreSQL 专项 | `SKIPPED / OPEN` | 新鲜全仓运行 `4225 passed / 123 skipped / 0 failed`；需重新提供隔离 PostgreSQL 测试库，复跑至 `4348/4348` 零跳过。 |
| 本地生产构建内存 | `PASS WITH 8 GIB HEAP` | 默认 4 GiB 堆 OOM；8 GiB 堆构建通过。后续 CI/Coze 构建环境需显式提供足够 Node 堆，不能把默认堆失败隐藏为业务编译错误。 |

### 2026-08-30 BUG-018/019 本地修复后的云端验证点

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 完成态重新打开 PSD 编辑器 | `CLOUD PARTIAL PASS` | 整页刷新后已从图片工具栏重开同一 5 层文档；仍需在一个新完成态父任务中验证状态卡“打开编辑器”按钮，并采集零新增任务、零扣费/退款证据。 |
| 重叠图层精确拖动 | `CLOUD PASS` | `8cd07e1f` 当前资源包中，元素层 `589,416 → 745,520` 时校正层保持 `0,0`；位移已还原并保存。隐藏、锁定和越界 fallback 由永久自动化覆盖。 |
| 图层文档完整恢复 | `CLOUD PASS` | 重命名、隐藏、锁定、移动、排序、导出模式、自动保存、关闭重开和整页刷新恢复均已通过。跨浏览器同账号读取保留为独立增强验证。 |
| PSD 最终导出 | `CLOUD PASS` | 下载文件签名 `8BPS`，`ag-psd` 解析为 3504×2336、5 个编辑图层；顺序、坐标与最终保存 revision 一致。 |
| Pear 远程成功与账务 | `FAILED / UNVERIFIED` | 合适素材取得 `engine=pear`、2+ 合格远程图层、一次扣费零退款；不得以本地 fallback 或本轮非付费重开验证替代。 |

### 2026-08-30 完成态父任务水合候选剩余验证

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 父任务项目绑定与竞态隔离 | `LOCAL PASS` | 聚焦 175/175、终审 APPROVED；不得重复改造。 |
| 完成卡片刷新恢复 | `CLOUD PENDING` | Coze exact-SHA 后整页真实重载，打开元素拆解浮层，历史 completed 父任务卡及“打开编辑器”必须出现。 |
| 同任务编辑器载荷 | `CLOUD PENDING` | 按钮打开的 taskId、source image/version 和 layers 与历史任务一致。 |
| 零副作用证明 | `CLOUD PENDING` | 浏览器网络中无新的 `/api/element-decompose` POST，管理员任务与积分流水无新增供应商任务、扣费或退款。 |
| PostgreSQL 全仓专项 | `123 TESTS SKIPPED / OPEN` | 使用隔离 `POSTGRES_TEST_DATABASE_URL` 复跑；不得指向 Coze 业务库或生产库。 |

云端执行顺序固定为：Coze 拉取最终 `main` exact-SHA，确认 `stable` 未变；沙箱完全重启；强制刷新既有 Google Chrome 预览标签；最后开始验证。不得新建 Chrome 标签，也不得在旧沙箱进程上得出通过结论。

补充门禁：刷新后必须核对浏览器已加载的 webpack/page chunk 与服务器当前 HTML 一致。仅发送 `Ctrl+Shift+R` 不再作为“新构建已加载”的充分证据。

### 2026-08-30 完成态父任务水合云端状态（覆盖上一节）

| 项目 | 最新状态 | 证据 / 剩余边界 |
|---|---|---|
| 父任务项目绑定与竞态隔离 | `LOCAL PASS` | 聚焦 `175/175`、终审 APPROVED；不重复改造。 |
| 完成卡片刷新恢复 | `CLOUD PASS` | Google Chrome 两次整页重载均恢复 `completed · 100%` 卡片及“打开编辑器”。 |
| 同任务编辑器载荷 | `CLOUD PASS` | 两次均恢复 5 层、`3504x2336` 来源、历史重命名和“已保存”。 |
| 零业务副作用 | `CLOUD PASS` | 验证窗口内新任务 `0`、积分流水 `0`、扣费 `0`、退款 `0`，Console `0/0`。 |
| HTTP 方法直接抓取 | `OBSERVABILITY GAP` | `app.log` 不含 path/method，无法单独证明请求方法；不得把这一限制写成网络抓包通过。 |
| PostgreSQL 全仓专项 | `123 TESTS SKIPPED / OPEN` | 使用隔离 `POSTGRES_TEST_DATABASE_URL` 复跑；不得指向 Coze 业务库或生产库。 |

BUG-018 已从未验证项移除。剩余顺序为 `002-B -> 002-D -> 002-E`；证据：`docs/testing/evidence/v588-stability-002-3b47dfb7-completed-parent-cloud-2026-08-30.json`。

### 2026-08-30 `5f6e84b1` Pear 三组真实制品后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 异步提交、ZIP/MIME、安全下载、主 PSD、`8BPS` 与解析 | `CLOUD PASS` | 三组真实任务均已越过这些阶段，不再作为沙箱阻塞重复验证。 |
| 质量门禁与 smart 回退披露 | `CLOUD PASS` | 错误单层、缺透明主体和高重建误差均被拒绝；最终实际引擎为本地并披露退款。 |
| 云端失败退款 | `CLOUD PASS` | 两组精确一扣一退、第三组一扣一退计数，净积分均为 `0`；不再重复付费验证普通质量失败。 |
| Pear 远程质量成功 `002-B` | `FAILED / OPEN` | 使用官方示例类型的受控肖像取得 `engine=pear`、至少 2 个语义正确且通过现有质量门禁的图层。 |
| 成功账务 `002-D` | `UNVERIFIED` | 仅在上述同一成功任务中证明唯一扣费、零退款、余额变化与管理员 15 积分定价一致。 |
| 显式取消 `002-E` | `UNVERIFIED` | 提交后立即取消，数据库终态保持 cancelled，迟到完成被拒绝，最多一次退款。 |
| 受控肖像 Chrome 上传 | `TEST TOOL BLOCKED` | 合成非敏感测试图已准备好；Google Chrome 标签可发现但因上次文件选择器超时残留控制占用，尚未完成上传。不得切换 360 或新建标签。 |

证据：`docs/testing/evidence/v588-stability-002-pear-cloud-audit-20260830.json` 与 `docs/testing/evidence/v588-stability-002-pear-quality-fallback-20260830.png`。

### 2026-08-30 `c5d39b11` 受控肖像候选后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 不同宽高比坐标与透明底比较 | `LOCAL PASS / CLOUD PENDING` | Coze 精确部署 `c5d39b11` 或后续同 tree；同类肖像真实任务不得再因 `RECONSTRUCTION_ERROR_HIGH` 或越界误报回退。 |
| Pear 远程质量成功 `002-B` | `LOCAL ARTIFACT REPLAY PASS / CLOUD PENDING` | 同一或同类受控肖像取得 `engine=pear`、23+ 可编辑图层、质量 score 接近本地重放结果；不得以本地 fallback 替代。 |
| 成功账务 `002-D` | `UNVERIFIED` | 上述同一成功任务只有一笔 15 积分扣费、零退款，余额变化与管理员价格一致。 |
| 显式取消 `002-E` | `UNVERIFIED` | 提交后立即取消，数据库最终为 cancelled，迟到完成不能覆盖终态，最多一笔退款。 |
| PostgreSQL 全仓专项 | `123 TESTS SKIPPED / OPEN` | 提供隔离 `POSTGRES_TEST_DATABASE_URL` 后重跑；严禁使用业务库或生产库。 |
| 可编辑图层按钮文案 | `LOCAL PASS / CLOUD PENDING` | `a2b1a850` 已完成三模式动作文案与稳定 E2E 标识；Coze 部署后非付费切换三模式核对，不创建供应商任务。 |

证据：`docs/testing/evidence/v588-stability-002-pear-portrait-audit-20260830.json` 与 `docs/testing/evidence/v588-stability-002-pear-portrait-fallback-20260830.png`。

最终本地候选补充：`d9b9c402` 已完成 `4247 passed / 123 PostgreSQL-gated skipped / 0 failed`、生产构建 `118/118`、保护基线 `38/38 / 0 drift / 0 warnings`。这些证据只关闭本地发布门禁，不改变上表四项云端待验证状态。

### 2026-08-30 Pear ZIP 瞬时超时修复后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 瞬时下载超时单次恢复 | `LOCAL PASS / CLOUD PENDING` | 新提交部署后，真实 Pear ZIP 首次中断可恢复；若第二次仍失败，应维持原子退款与本地回退。 |
| Pear 远程质量成功 `002-B` | `UNVERIFIED ON NEW BUILD` | 同类受控肖像最终为 `engine=pear`、23+ 合格图层，不得以本地 3 层回退替代。 |
| 成功账务 `002-D` | `UNVERIFIED` | 同一成功任务只有一笔图层费用、零退款，余额、流水和管理员价格一致。 |
| 显式取消 `002-E` | `UNVERIFIED` | 提交后立即取消，数据库保持 cancelled，迟到完成不得覆盖终态，退款最多一次。 |
| PostgreSQL 全仓专项 | `123 TESTS SKIPPED / OPEN` | 提供隔离 `POSTGRES_TEST_DATABASE_URL` 后复跑；严禁使用业务库或生产库。 |

当前本地候选已通过 `4248 passed / 123 skipped / 0 failed`、`118/118` 构建和保护功能 `38/38`。这些只证明候选可部署，不关闭上述云端验证项。

### 2026-08-30 `c15ba26a` 云端复验后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 三模式动作文案 | `CLOUD PASS` | “拆解板 / 可编辑图层 / 双输出”存在；可编辑图层动作显示“生成可编辑图层”。 |
| 应用任务快速建立 | `CLOUD PASS` | 单次提交快速进入 `processing · 27%`，没有浏览器同步等待断线。 |
| 普通供应商失败退款 | `CLOUD PASS` | “当前服务暂不可用”只产生一笔 `-15` 与一笔 `+15`，余额 `388 → 373 → 388`。 |
| 瞬时 ZIP 下载重试 | `NOT EXERCISED` | Pear 成功返回可下载 ZIP，且首个 Range 请求出现瞬时中断时由同参数单次重试恢复。不得人为破坏安全配置制造失败。 |
| Pear 远程质量成功 `002-B` | `UNVERIFIED / PROVIDER UNAVAILABLE THIS RUN` | 同类受控肖像最终为 `engine=pear`、23+ 合格图层；不得以本地 3 层替代。 |
| 成功账务 `002-D` | `UNVERIFIED` | 同一远程成功任务只有一笔 15 积分扣费且零退款。 |
| 显式取消 `002-E` | `UNVERIFIED` | 单独授权后提交并立即取消，数据库保持 cancelled，迟到完成不覆盖，退款最多一次。 |
| 精确 taskId/providerError 审计 | `OBSERVABILITY GAP` | 当前管理员页面未展示 taskId、Pear taskId、requestId 或结构化 providerError；需 Coze 只读数据库/服务日志审计补全。 |

证据：`docs/testing/evidence/v588-stability-002-c15ba26a-pear-cloud-20260830.json`。

### 2026-08-30 Pear 后期验证点

| 项目 | 最新状态 | 后期关闭条件 |
|---|---|---|
| Pear 远程质量成功 `002-B` | `DEFERRED / UNVERIFIED` | 稳定登录会话和供应商可用同时成立时，单次受控肖像任务得到 `engine=pear` 与 23+ 合格图层。 |
| 成功账务 `002-D` | `DEFERRED / UNVERIFIED` | 与同一成功任务绑定的唯一 15 积分扣费、零退款及余额一致。 |
| 显式取消与迟到终态 `002-E` | `DEFERRED / UNVERIFIED` | 单次取消保持 `cancelled`，迟到完成被拒绝，退款最多一次。 |
| 本轮 Chrome 控制 | `TEST TOOL BLOCKED` | 用户1现有预览页可枚举，但页面读取时控制连接断开；不得改用 360 或新建标签页冒充复验。 |
| 本轮 API 探针 | `AUTH BLOCKED BEFORE SUBMIT` | 独立登录 HTTP 401，未创建任何任务或账务；该结果不是 Pear 失败。 |

这些项目不再阻断其余 V5.8.8 吸收，但始终保留在未验证表中，直到取得对应真实证据。

### 2026-08-30 `V588-ADMIN-004` 云端待验证项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 管理员四处总用户数 | `LOCAL PASS / CLOUD PENDING` | 同一管理员会话对比 `/api/admin/users`、积分总览、用户数据与仪表盘，四处总数必须一致。 |
| 逐用户积分余额 | `LOCAL PASS / CLOUD PENDING` | 用户管理的 `credits` 与积分管理同一 userId 的权威余额一致，缺少积分行的真实用户才显示 0。 |
| 逐用户项目数 | `LOCAL PASS / CLOUD PENDING` | 用户管理的 `project_count` 与数据管理中同一 userId 的项目数组长度一致。 |
| 最后活动时间 | `LOCAL PASS / CLOUD PENDING` | 有审计、用户数据更新或用户记录更新时间时显示最大真实时间；无证据时显示“从未”。 |
| 数据库查询失败披露 | `AUTOMATED PASS / CLOUD NOT FORCED` | 自动化已验证 500 / `ADMIN_USER_PROJECTION_FAILED`；禁止在生产库人为制造故障。 |
| 隔离 PostgreSQL 查询验证 | `BLOCKED / OPEN` | 提供专用 `POSTGRES_TEST_DATABASE_URL` 后执行真实三查询与数据形状测试；严禁使用 Coze 业务库或生产库。 |
| Google Chrome UI 回归 | `CLOUD PENDING` | exact-SHA 部署、沙箱重启、既有预览标签强制刷新后，管理员用户列表、详情、积分与数据页无新增 Console error/warning。 |

上述云端证据完成前，`V588-ADMIN-004` 只能标记本地通过，不能写成完整吸收关闭。

### 2026-08-30 `V588-ADMIN-004` Coze 补证后剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| exact-SHA 测试/构建/服务 | `CLOUD PASS` | `main@3bded1de`、全仓零失败、构建与单实例健康已取得证据。 |
| 数据库投影一致性 | `CLOUD DATA PASS` | 只读复算的用户数、积分、项目数组与活动时间一致。 |
| 四接口同会话响应 | `AUTHENTICATED HTTP UNVERIFIED` | 使用现有管理员 Cookie 真实请求 users/credits/user-images/dashboard-stats，并逐 userId 比对；不得用 SQL 复算替代。 |
| 管理员 UI | `CLOUD PENDING` | 真实打开用户、积分、数据与仪表盘页面，刷新恢复且 Console 无新增错误。 |

### 2026-08-30 `V588-PROVIDER-002` 云端待验证项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 唯一裸键迁移 | `LOCAL PASS / CLOUD PENDING` | 管理员保存历史唯一裸模型后，服务端持久化精确 `providerId::modelId`。 |
| 歧义裸键拒绝 | `LOCAL PASS / CLOUD PENDING` | 同名多供应商裸键返回 409、明确提示、用户记录与成功审计均不变化。 |
| 无效/错误类型拒绝 | `LOCAL PASS / CLOUD PENDING` | 不存在、禁用、畸形或错误命名空间返回 400 且零写入。 |
| 普通用户模型可见性 | `LOCAL PASS / CLOUD PENDING` | 保存精确授权后，普通用户 `/api/models` 与三个工作区只显示被授权模型。 |
| 隔离 PostgreSQL | `123 TESTS SKIPPED / OPEN` | 配置专用 `POSTGRES_TEST_DATABASE_URL` 后复跑；严禁使用业务库。 |
| 停用供应商目录过滤 | `OLD CLOUD FAIL / LOCAL PASS` | Coze 部署 `95b489be` 或后续提交后，停用供应商不得出现在聊天/图像授权选项；可逆单模型保存必须返回 200，并恢复原“不限”状态。 |
| 历史 JSONB 模型列兼容 | `CLOUD PASS` | `318fe2d7` 下有效 Pear 精确授权保存和恢复“不限”均为 200，关闭重开状态一致；管理员写入闭环。 |
| 普通用户模型可见性 | `UNVERIFIED` | 使用安全的普通用户会话验证 `/api/models`、无限画布、节点模式和独立智能对话仅展示管理员授权模型；不得使用管理员会话替代。 |
| 模型列 PostgreSQL 双契约 | `123 TESTS SKIPPED / OPEN` | 在专用隔离库分别建立 JSONB 与 TEXT[] 模式执行真实写入测试；严禁使用 Coze 业务库作为测试库。 |
| 服务替换后的延迟分块一致性 | `INTERMITTENT / OPEN` | 首次导航曾请求 `5504` 并返回 500；服务稳定后清缓存强刷恢复且 34 个资源全 200。需由部署流程确保构建目录切换与服务启动原子一致。 |

### 2026-08-30 `V588-ADMIN-004` 最后活动候选后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 四接口与三页面用户总数 | `CLOUD PASS` | 已登录管理员会话中 users/credits/user-images/dashboard-stats 均为 200，四处总数均为 6。 |
| 逐用户积分与项目数 | `CLOUD PASS` | `admin_mr_joker=388/10`、`canvas-user=0/1`，其余 4 用户为 `0/0`，与积分和数据页一致。 |
| 最后活动 API 数据 | `CLOUD PASS ON PREVIOUS UI` | 6 个用户均有有效 `last_login`；未修改云端数据制造结果。 |
| 最后活动 UI 候选 | `LOCAL + GITHUB PASS / COZE UNVERIFIED` | Coze 拉取精确 `a9956bc5`，既有 Google Chrome 预览标签强制刷新后，6 行显示真实时间而不是 `-`；刷新恢复且 Console error/warning 为 0。 |
| 隔离 PostgreSQL 全仓门禁 | `123 TESTS SKIPPED / OPEN` | 配置专用 `POSTGRES_TEST_DATABASE_URL` 后运行；严禁使用 Coze 业务库。 |
| Pear `002-B/002-D/002-E` | `DEFERRED / UNVERIFIED` | 按后期验证点单独关闭，不因管理员投影通过而改变状态。 |

### 2026-08-31 `V588-ADMIN-004` 仪表盘边界候选后的剩余项

| 项目 | 最新状态 | 关闭条件 |
|---|---|---|
| 三字段组件边界 | `LOCAL + GITHUB PASS` | `main@a27e33be` 已有 RED/GREEN、全量门禁、构建和保护基线证据。 |
| Coze exact-SHA 与构建 | `CLOUD PASS / POST-DONE TREE OPEN` | `fa857e44` 与目标 tree 已对齐、测试构建重启已通过；只缺 Coze 自动元数据提交后的最终只读 tree 复核，不重新拉取或构建。 |
| 用户列表真实显示 | `CLOUD UI POSITIVE PASS` | 服务重启后 Chrome 首次强刷已显示真实三字段；积分、数据、运营总览 UI 总数均为 6。保留最后刷新补证，不将已完成正向测试重新列为未执行。 |
| 四接口机器证据 | `3 RESPONSES CAPTURED / 1 OPEN` | users、credits overview、user-images 正文与 HTTP 200 已取得；运营总览 UI 已核对，dashboard-stats 正文采集时断线，尚待补齐。 |
| 再次刷新与完整日志 | `FINAL CHECK UNVERIFIED` | 首次强刷已成功；最终再次刷新后字段、完整新鲜 Console/未捕获异常和原生弹窗仍需收集，不根据先前日志推断为零。 |
| Coze 注入脚本 CSP | `OBSERVED / SEPARATE` | 3 个外部编辑器和 bridge 脚本被 CSP 拦截；业务页面已正常加载。保持安全策略，后续明确是否影响预览编辑器桥接，不冒充应用接口失败。 |
| Chrome 控制通道 | `INTERRUPTED AFTER UI VERIFICATION` | 本轮曾完整控制现有 Chrome 并取得正向结果；采集运营总览响应时中断，诊断正常但重新接管失败。只恢复原标签，不进入 360 或新建窗口。 |
| 隔离 PostgreSQL 全仓门禁 | `123 TESTS SKIPPED / OPEN` | 配置专用 `POSTGRES_TEST_DATABASE_URL` 后运行；严禁使用 Coze 业务库。 |

上述云端证据完成前，`V588-ADMIN-004-BUG-003` 和 `V588-ADMIN-004` 整体均不得标记为关闭或已吸收。

本检查点证据：`docs/testing/evidence/v588-admin-004-fa857e44-cloud-20260831.json`。Pear 延后状态和普通用户模型可见性不因管理员页面正向验证而改变。

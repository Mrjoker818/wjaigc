# 无界AI — 未验证项目清单 (UNVERIFIED ITEMS)

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
| SVG智能描摹 | 需要Python vtracer环境 | 手动测试 |
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

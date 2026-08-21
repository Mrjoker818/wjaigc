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
| V588-ADMIN-002 cloud behavior | UNVERIFIED | Coze must pull the exact candidate; verify a representative unauthenticated `401` and authenticated administrator success without creating another Chrome tab. |
| Next absorption item | BLOCKED UNTIL CLOUD ACCEPTANCE | Do not start `V588-ADMIN-003` before the exact-candidate cloud check is recorded. |
| Donor snapshot | READ-ONLY VERIFIED | Lock digest remains `cc9e5e848bdb4cec6aeb394b086f8fe3015be9888787d350815c8b06b62f00e0`. |
| Stable branch | PROTECTED | `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` remains unchanged. |

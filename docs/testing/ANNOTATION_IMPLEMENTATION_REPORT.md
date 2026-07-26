# ChatCanvas 融合批注实施报告

## 目标

保留无限画布底部工具栏入口与 `C` 快捷键，以浮动输入栏承载批注操作，并在无限画布和节点模式中提供一致的语义修改能力。选择工具本身不得创建批注，只有完成有效手势或确认有效对象后才提交记录。

## 已实现能力

- 支持点选对象、框选、画笔圈画、箭头和文字五类修改意图。
- 画笔显示为可见矢量轨迹，不把黑白蒙版展示给用户。
- 1 至 10 条批注组成一个绑定源图片版本的编辑意图包。
- 同一批注包只能引用同一源图片和同一源版本，过期来源阻止执行。
- 语义识别失败或置信度不足时回退到框选，并明确提示原因。
- 服务端生成联合蒙版、编号参考图和完整指令列表。
- 异步任务复用现有图片编辑任务、积分和结果回写链路，不重复扣费。
- 项目保存、刷新恢复和旧版 pin 数据迁移均受支持。
- 节点模式创建下游 `ai-annotation-edit` 节点，不覆盖源节点。
- 浮动输入栏按画布可用宽度居中，并避开右侧工作区。

## r4 执行闭环与主线兼容

- 基线更新到远端主线 `591167d6a3b517880d1bafb5fa113dedebb4df2d`。
- 保留最新美陈拆解的两阶段流程、比例选择和去背景流程。
- 保留 Oh My Prompt 的分类选择后再发送行为，不自动把识词结果写入生图面板。
- 新增 Manifest v2 安装前哈希校验。
- `replace` 文件必须匹配 `expectedBaseSha256`，否则安装终止。
- `add` 文件若已经存在且内容不同，安装终止。
- 文本安装哈希统一按 LF 计算，避免 Windows CRLF 检出产生误报；二进制文件保持严格字节校验。
- 已经安装相同内容时允许幂等复检。
- 登录页面、鉴权协议、依赖、启动配置和 `.coze` 文件均不在升级范围。
- 批注幂等键使用现有 `cloud_tasks` 唯一索引绑定 `userId + idempotencyKey`，并保存规范化请求摘要。
- 同键同请求返回同一 `taskId`；同键不同请求返回 409。
- 批注扣费、任务扣费状态和流水记录由单条 PostgreSQL CTE 原子结算，失败退款同样为任务级一次性原子结算。
- 普通用户只能调用已分配给自己的图片模型；语义目标识别也只能使用已分配的视觉聊天模型。
- 所有批注远程图片读取使用 DNS 解析后公网校验、固定目标 IP、禁重定向、MIME/体积/超时限制。
- 文本、标识符、几何点数、data URL 所在请求体和整体 JSON 都有明确上限。
- 包内附带 `SOURCE_COMMIT.bundle`，可离线验证并导入源码提交。
- 整个批注编辑后台任务使用可主动取消的 `AbortController`；请求断开、任务取消和超时会中止当前网络与图像处理。
- 异步供应商结果经 `/api/poll-task` 回收时，也必须先通过数据库条件式终态转换，不能绕过原子结算。
- `completed` 只允许从 `processing` 进入；`failed`、`timeout`、`cancelled` 均不能被迟到结果覆盖。
- 退款由数据库最终终态和任务级一次性条件决定，不依赖可能被竞态覆盖的内存状态。
- `/api/edit` 的主图、蒙版和参考图统一经过安全输入层；远程 URL、受控媒体路径、data URL 和 raw base64 使用同一 MIME、字节、格式和像素上限。
- Sharp 对外部输入统一启用像素上限，避免像素炸弹。
- 语义目标解析采用“当前用户已授权视觉模型内自动选择”，响应中显式返回 `modelSelection.mode = auto-authorized`。
- r4 Manifest 强制包含轮询、取消、终态结算、安全图片输入和对应回归测试，不允许只更新入口层。

## 主要模块

- `src/features/annotations/annotation-types.ts`：类型与状态词汇。
- `src/features/annotations/annotation-geometry.ts`：归一化坐标、阈值与路径插值。
- `src/features/annotations/annotation-bundle.ts`：意图包构建和严格校验。
- `src/features/annotations/use-annotation-controller.ts`：临时手势与已提交批注状态机。
- `src/features/annotations/annotation-overlay.tsx`：可见批注标记渲染。
- `src/features/annotations/annotation-composer.tsx`：画布底部浮动输入栏。
- `src/features/annotations/annotation-persistence.ts`：项目持久化和恢复。
- `src/features/annotations/node-annotation-workspace.tsx`：节点模式批注工作区。
- `src/app/api/annotations/resolve-target/route.ts`：鉴权后的语义对象解析。
- `src/app/api/annotations/execute/route.ts`：鉴权、来源校验、资源编译和任务提交。
- `src/lib/annotation-mask.ts`：联合蒙版和编号参考图编译。
- `src/lib/annotation-provider-adapter.ts`：供应商能力适配与明确拒绝。
- `src/lib/annotation-idempotency.ts`：数据库任务抢占和规范化请求摘要。
- `src/lib/safe-image-download.ts`：防 DNS rebinding 的远程图片下载器。
- `src/lib/safe-image-input.ts`：远程 URL、受控媒体路径、data URL/raw base64 的统一安全输入和 Sharp 像素门禁。
- `src/app/api/edit/route.ts`：仅对带批注幂等键的请求启用原子任务、扣费、取消和安全图片输入门禁。
- `src/app/api/poll-task/route.ts`：异步供应商结果的数据库终态提交与主动取消。
- `src/app/api/cancel-task/route.ts`：批注取消与数据库一次性退款。
- `src/lib/cloud-task-storage.ts`：条件式成功终态及失败、超时、取消的一次性原子退款。
- `src/lib/task-registry.ts`：后台任务 AbortController 注册和主动中止。
- `scripts/verify-annotation-upgrade.mjs`：包完整性与安装前目标校验。

## 可靠性规则

1. 切换工具只改变工具状态，不追加记录。
2. 小于屏幕阈值的拖动、空文字和缺失几何不提交。
3. 蒙版或参考图编译失败时整体失败，不降级为无空间约束的整图编辑。
4. 任务提交透传 requestId 和幂等键，数据库唯一约束在扣费前确定唯一任务。
5. 同项目本地批注一旦变脏，延迟到达的旧快照不能覆盖它。
6. 节点执行等待上游来源完成，结果写入下游节点。
7. 安装器先验证所有目标，任何文件不匹配时不会开始覆盖。
8. 后台完成结果必须先赢得数据库 `processing -> completed` 转换，之后才允许更新内存状态。
9. 失败、超时和取消只能由数据库终态结算一次退款，迟到成功不得反转终态。

## 部署要求

必须先执行：

```bash
node <PACKAGE_DIR>/payload/scripts/verify-annotation-upgrade.mjs --package <PACKAGE_DIR> --target <PROJECT_ROOT>
```

只有输出包含 `PASS package=` 和 `PASS target-ready=` 时才允许复制 `payload/`。复制后再次执行相同命令，必须显示全部文件为 `already-applied`，随后执行类型检查、专项测试和生产构建。

## 已知限制

- 本地隔离环境没有真实图像编辑供应商密钥，因此没有验证真实供应商成功出图和云端结果回写。
- PostgreSQL 真并发测试已提供，但本地没有 `TEST_POSTGRES_URL`，因此本轮被测试框架明确标记为 skipped；必须在云端测试数据库执行后才能关闭该未验证项。
- 单个意图包最多 10 条批注，更多修改需要拆分执行。
- 语义对象区域依赖视觉模型返回的结构化结果，低置信度时必须人工确认。

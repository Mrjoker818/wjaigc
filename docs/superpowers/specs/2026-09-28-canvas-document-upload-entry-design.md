# 协作文档画布上传入口设计（2026-09-28）

## 现状与目标

`InfiniteCanvas` 的选择文件与拖入文件入口目前先转 data URL，再交 `CanvasWorkspace.handleAddImages`；文档权威模式的 `routeCanvasWorkspaceChange` 正确拒绝没有 `assetVersionId`、`placementId` 的新增图片。服务端已有 `POST /api/collaboration/document-assets/upload`，它从登录会话确认 actor、校验项目编辑权限与媒体，原子创建版本、画布 placement 和文档命令。目标是把两个本地 File 入口接到该既有 API，不让浏览器自行制造协作身份，也不放宽 Yjs 媒体命令保护。旧个人/未限定画布上传行为不变。

## 方案选择

采用画布向父工作区上交 `File[]` 的方式：`InfiniteCanvas` 在文档权威模式把选择或拖入的原始文件交给 `CanvasWorkspace`；父工作区生成显示 transform、调用受权上传 API，收到完整 `assetReference` 和 `documentSequence` 后调用 `collaborativeCanvas.refreshMedia`。不走 `/api/save-image` 再用公开 URL 冒充来源；也不先走 `/api/upload` 再复制一次资产。后两条路径会增加无归属中间媒体、造成重复存储，并不能代替服务端文档命令。

## 身份、重试与作用域

每个文件操作有一个由浏览器生成、与项目绑定的幂等键；同一文件操作的网络回执不确定时保留键，重选同文件重放原命令，不用新键重复建 placement。只有确认服务端命令且媒体刷新完成后才清除键。项目切换、协作只读/连接不可用时，不把响应写进当前项目画布；已提交到旧项目的请求由服务端记录，后续可回到旧项目恢复。失败只给用户可理解的原因，服务端保持 401/403/409/413/503 合同；不泄露底层路径或 SQL。

重试槽以项目、规范化文件名、MIME 和原始文件 SHA-256 构成，不能仅凭文件名/大小/修改时间，否则不同二进制可能误用同键并永久冲突；同一批选择的完全相同文件只提交一次。项目的 `authority` 尚未判定时停止上传，不能先落入 legacy 再等待协作文档拒绝。

请求使用原始图片二进制及合法 MIME，`x-wujie-asset-import` 为 UTF-8 JSON 的 base64url 编码，包含 `projectId`、`idempotencyKey`、安全文件名和 `attach` transform；用户、URL、资产版本、placement、原始 Yjs 均不在请求中。服务端仍以媒体解析和大小上限为权威。客户端在提交前检查当前项目与文档可写状态，提交后核响应必需字段并据序号刷新；刷新失败只提示“已提交、同步待确认”，保留幂等键，不改走 legacy。

## 界面与验收

复用原“上传图片”入口和拖入手势，不新增视觉样式。保留原文件读取的个人模式。文档模式显示处理中、完成与可重试错误反馈；非图片及超出服务端支持格式要明确提示。键盘可继续触发原上传控件，提示使用现有 toast 的可读语义。测试覆盖文档上传请求的真实编码/原始二进制、成功后按序号刷新、错误或不确定回执不产生 legacy 图、项目切换不跨项目展示、同文件重试保持幂等键，以及旧个人路径。既有文档上传真库测试继续作为服务端授权/事务证据；无真实浏览器与云端预览证据前只算本地候选。

本切片不解决所有 URL 来源、工作流/聊天生成图及旧项目无版本历史图的导入；这些继续依 `2026-09-28-image-edit-source-and-quote-integration.md` 的消费者清单推进。Pear 分层验证排除，PSD 核心不变。

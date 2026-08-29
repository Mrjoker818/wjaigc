# PSD 图层文档持久化设计

## 目标

为 `PsdLayerEditor` 增加数据库持久化，使移动、显隐、锁定、重命名、顺序和导出设置能够在关闭窗口、刷新页面和更换设备后恢复。持久化必须绑定真实用户、项目、源图片版本和分层任务，不能写入无限画布的大型项目 JSON，也不能把图片二进制复制进数据库。

## 非目标

- 不改变 Pear、local 或 smart 分层算法。
- 不放宽分层质量门禁。
- 不把编辑状态存入 `cloud_tasks.result`。
- 不实现多人实时协同、操作级历史或图层像素在线编辑。
- 不修改 `stable` 分支。

## 数据模型

新增独立表 `wujie_layer_documents`：

| 字段 | 说明 |
|---|---|
| `id` | 文档 ID，随机 UUID。 |
| `user_id` | 文档所有者。所有业务查询必须包含。 |
| `project_id` | 所属项目。 |
| `source_image_id` | 画布源图片 ID。 |
| `source_version_id` | 源图片不可变版本标识。 |
| `task_id` | 产生初始图层的应用任务 ID；元素拆解入口使用其图层分支或父任务 ID。 |
| `engine` | 实际结果引擎 `pear` 或 `local`。 |
| `schema_version` | 文档内容版本，首版固定为 `1`。 |
| `revision` | 乐观并发版本，每次成功保存原子加一。 |
| `content` | 经过服务端校验的 JSONB 图层文档。 |
| `created_at` / `updated_at` | 毫秒时间戳。 |

索引与约束：

- `(user_id, project_id, source_image_id, source_version_id, updated_at DESC)` 用于恢复最新文档。
- `(user_id, task_id)` 唯一，保证一个分层任务只创建一个编辑文档。
- `revision >= 0`，`schema_version = 1`。
- 数据库不可用时创建与保存必须明确失败，不能伪装成本地成功。

`content` 只保存：画布宽高、图层数组、导出模式和文档标题。每个图层保存 `id/name/role/imageUrl/width/height/offsetX/offsetY/opacity/blendMode/visible/locked/order/source`。当前选中图层、面板位置、展开状态等临时 UI 状态不持久化。

## 身份与来源绑定

`InfiniteCanvas` 在所有 PSD 编辑入口统一构造 `LayerDocumentSource`：

```ts
interface LayerDocumentSource {
  projectId: string;
  sourceImageId: string;
  sourceVersionId: string;
  imageUrl: string;
  taskId?: string;
}
```

- `sourceVersionId` 复用现有 `buildAnnotationSourceVersionId` 规则。
- 服务端通过 `findOwnedAnnotationSource` 验证项目、图片、版本和 URL 完全一致。
- 已完成分层任务还要验证 `cloud_tasks.user_id`、任务类型和终态，不接受客户端伪造任务结果。
- 管理员普通使用 PSD 编辑器时仍按自己的 `user_id` 隔离；跨用户审计另走专用管理员接口，本轮不提供。
- 缺少有效项目或源图片身份时允许临时编辑，但界面明确显示“未保存到项目”，不宣称可跨设备恢复。

## API

新增 `/api/layer-documents`：

- `GET ?projectId=&sourceImageId=&sourceVersionId=`：返回当前用户该源版本最近更新的文档，找不到返回 `404 LAYER_DOCUMENT_NOT_FOUND`。
- `POST`：从已验证的源身份和已完成分层结果创建文档。同一 `userId + taskId` 重试返回原文档，不重复创建。
- `PATCH`：请求携带 `documentId`、`expectedRevision` 和完整规范化 `content`。SQL 使用 `WHERE id = ? AND user_id = ? AND revision = ?` 条件更新并 `revision = revision + 1`。
- `DELETE` 本轮不开放；删除项目时由项目清理流程级联或显式清理。

统一错误格式包含 `success/code/message/requestId/retryable`。校验边界：请求体不超过 60 KiB，以保证所有写请求都可安全使用浏览器 `keepalive`；最多 64 层；名称 128 字符；ID 256 字符；仅接受受管媒体 URL；坐标、尺寸、不透明度和顺序必须为有限值并在安全范围内。

## 编辑器数据流

1. 用户打开“编辑元素”。编辑器先用完整源身份查询可恢复文档。
2. 找到同一 `sourceVersionId` 文档时直接恢复，并提供“重新分层”命令；不同版本绝不复用。
3. 没有文档时执行现有分层流程。任务完成后立即创建初始文档，然后进入编辑态。
4. 移动、显隐、锁定、重命名、排序和导出模式变化后标记 `dirty`。短防抖用于合并连续拖动，关闭、页面隐藏和导出前必须主动 flush，不能依赖长时间等待。
5. 保存中显示状态；失败保留本地编辑并提供重试。关闭时仍有未保存修改则阻止静默丢失。
6. `409 LAYER_DOCUMENT_REVISION_CONFLICT` 时停止自动覆盖，重新读取服务器版本并让用户选择“使用服务器版本”或“保留当前修改并基于最新 revision 重试”。首版不做字段级自动合并。
7. 导出前等待当前保存完成；导出的图层顺序与该保存成功 revision 必须一致。

## 回退结果表达

smart 模式父任务成功但 Pear 失败并退款时，文档保存实际 `engine=local`。编辑器必须显示：

- “Pear 结果未通过质量门禁”；
- 实际使用“本地分层”；
- “云端分层积分已退款”；
- 可展开查看 `fallbackReason`，不能仅显示笼统 `completed`。

该信息来自持久化任务响应，不由前端根据图层数量猜测。

## 兼容与迁移

- 表由独立 `ensureLayerDocumentTables()` 幂等创建，不并入 `ensureCoreTables()` 的巨型迁移列表。
- 已有项目和历史分层结果不自动回填；用户首次重新打开时可重新分层并创建文档。
- `PsdLayerEditor` 仍接受旧的 `imageUrl + initialResult` 调用，但仅在收到完整 `source` 时启用持久化。
- 图片 URL 仍指向现有受管媒体文件，数据库只存引用。

## 测试与验收

### 单元与 API

- 文档 schema、64 层、请求体、URL、坐标和字符串边界。
- 未登录、跨用户、跨项目、旧源版本、伪造 taskId、非完成任务均拒绝。
- 相同 taskId 幂等创建同一文档。
- PostgreSQL 两个并发 `PATCH` 只有一个 revision 成功，另一个稳定返回 409。
- 删除项目后文档不可读取，并完成清理。

### 组件与 E2E

- 移动、显隐、锁定、重命名、排序后保存状态可见。
- 关闭时 flush；保存失败不会误报成功。
- 刷新页面恢复所有图层状态。
- 第二设备/浏览器登录同一账号可恢复。
- 源图版本变化不恢复旧文档。
- 导出 PSD 为 `8BPS`，图层数、顺序、位置与已保存 revision 一致。
- smart 回退明确显示 Pear 失败、退款和实际本地引擎。

### 发布门禁

- focused Vitest、PostgreSQL 并发测试、TypeScript、Lint、全量 Vitest 和生产构建通过。
- Coze 最新 `main` 使用 Google Chrome 既有标签完成真实创建、编辑、刷新恢复与导出。
- `stable` SHA 和 tree 必须保持不变。

## 风险控制

- 不在未确认项目归属时自动创建持久化文档。
- 不将 `data:`、`blob:`、外部任意 URL 或图片二进制写入 JSONB。
- 不在 revision 冲突时采用最后写入覆盖。
- 不把本地 fallback 的父任务完成态标记为 Pear 成功。
- 不为通过 Pear 测试而降低 MAE、重复层或透明度质量阈值。

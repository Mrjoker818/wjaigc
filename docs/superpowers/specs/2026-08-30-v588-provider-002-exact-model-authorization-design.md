# V588-PROVIDER-002 精确模型授权写入门禁设计

> 状态：设计已获用户批准，等待规格复核与实施计划。V5.8.8 donor 仅作只读参考；`stable` 始终只读，所有实现只进入 `main`。

## 目标

在不替换当前 `task-core` 模型目录、供应商适配器、任务状态机和账务链路的前提下，补齐管理员保存用户模型授权时的服务端数据完整性门禁：

- 精确授权只接受当前已启用、已配置且属于正确授权命名空间的 `providerId::modelId`。
- 历史裸 `modelId` 只有在当前可见目录中唯一匹配时才迁移并持久化为精确键。
- 多供应商同名、不可见、已禁用、类型错误或格式畸形的授权不能写入用户记录。
- 读取端继续使用当前更先进的能力目录、权限过滤、迁移诊断和普通用户脱敏响应。

## 当前事实与根因

### 当前版本已有能力

当前 `src/lib/task-core/model-catalog.ts` 已经具备：

- `providerId::modelId` 精确目录键。
- 已启用提供商、配置模型、有效能力类型和用户权限联合过滤。
- 唯一裸模型授权的只读解析。
- 多供应商同名裸模型的 `ambiguous` 拒绝。
- 普通用户迁移诊断脱敏。
- 图像生成、工作流、节点、聊天与管理员 UI 的精确目录消费。

这些能力比 V5.8.8 donor 的 `model-core/model-catalog.ts` 更完整，不能被 donor 覆盖。

### 缺口

`POST /api/admin/users` 的 `action=update` 当前直接把 `chatModels` 和 `imageModels` 数组传给 `updateManagedUser()`。浏览器 UI 会尽量规范化选择，但服务端没有验证：

- API 客户端可以保存多供应商同名的裸 `modelId`。
- 可以保存不存在、已禁用或授权命名空间错误的精确键。
- 唯一裸模型只在读取时临时解析，不会在管理员保存时升级为精确键。
- 错误数据会导致普通用户目录为空或产生迁移告警，问题被推迟到使用时才暴露。

根因是“目录读取门禁”和“管理员授权写入门禁”分离，写入端依赖前端善意输入。

## 备选方案

### 方案 A：保存时服务端规范化与拒绝（采用）

管理员更新用户模型授权时，服务端基于一次当前公开目录快照规范化两个命名空间。唯一裸模型迁移为精确键；歧义、无效和类型错误请求在写入前失败。

优点：从源头阻止新脏数据；兼容可安全迁移的历史值；不需要批量数据库作业；不改变读取和执行链路。

代价：管理员保存遇到歧义旧值时需要重新选择具体供应商。

### 方案 B：只读诊断，不阻止写入（拒绝）

继续允许任意数组，只在 `/api/models` 返回迁移提示。

缺点：无法阻止新脏数据，用户仍可能突然看不到模型，不满足本项数据完整性目标。

### 方案 C：一次性批量数据库迁移（暂不采用）

扫描所有用户并批量替换历史授权。

缺点：歧义值无法自动决定供应商；扩大到数据库迁移、回滚和生产数据操作，风险超过本项需要。

## 架构

### 纯规范化模块

新增 `src/lib/admin-model-authorization.ts`，只负责纯数据转换，不读取数据库、不调用网络、不写用户：

```ts
export type ModelAuthorizationNamespace = 'chat' | 'image';

export interface NormalizeModelAssignmentsInput {
  assignments: unknown;
  namespace: ModelAuthorizationNamespace;
  models: ModelInfo[];
}

export type NormalizeModelAssignmentsResult =
  | { ok: true; assignments: string[]; migrated: Array<{ from: string; to: string }> }
  | {
      ok: false;
      code: 'MODEL_ASSIGNMENT_INVALID' | 'MODEL_ASSIGNMENT_AMBIGUOUS';
      assignment: string;
      candidateCount: number;
    };
```

规则：

1. 输入必须是字符串数组；空数组保持空数组。
2. 去除首尾空格并稳定去重，保留首次出现顺序。
3. 精确键必须恰好包含一个 `::`，并命中当前目录中同一命名空间的模型。
4. 裸键在同一命名空间中唯一命中时迁移为精确键。
5. 裸键命中多个提供商时返回 `MODEL_ASSIGNMENT_AMBIGUOUS`。
6. 零命中、空字符串、非字符串、格式畸形、错误命名空间或禁用模型返回 `MODEL_ASSIGNMENT_INVALID`。
7. 输出不包含 API Key、baseUrl 或其他私有提供商字段。

### 管理员 API 接线

`POST /api/admin/users` 仅在 `action=update` 且请求包含 `chatModels` 或 `imageModels` 时加载一次 `getPublicModelCatalogSnapshot()`：

1. 分别规范化聊天和图像命名空间。
2. 任一失败时立即返回错误，不能调用 `updateManagedUser()`，也不能写成功审计。
3. 两者均成功时，把规范化后的精确键数组传给既有 `updateManagedUser()`。
4. 成功审计记录规范化后的模型键和迁移数量，不记录凭证或完整供应商配置。
5. 不含模型字段的普通用户更新不加载目录，保持现有性能与行为。

### HTTP 错误合同

```json
{
  "success": false,
  "code": "MODEL_ASSIGNMENT_AMBIGUOUS",
  "error": "模型授权存在多个供应商，请选择具体供应商模型",
  "field": "imageModels",
  "assignment": "shared-model",
  "candidateCount": 2
}
```

- `409 MODEL_ASSIGNMENT_AMBIGUOUS`：裸模型有多个可用精确候选。
- `400 MODEL_ASSIGNMENT_INVALID`：格式、值、可见性或命名空间无效。
- 不返回候选 providerId 列表，避免把管理员目录细节扩散到通用错误对象。

### 管理员界面反馈

当前 `dashboard-view.tsx` 的模型授权回调没有检查 `fetch` 的 HTTP 与业务结果。服务端门禁上线后，同时补齐这一最小交互闭环：

1. 成功时才刷新管理员数据并显示“模型授权已保存”。
2. `MODEL_ASSIGNMENT_AMBIGUOUS` 显示“存在同名模型，请重新选择具体供应商模型”。
3. `MODEL_ASSIGNMENT_INVALID` 显示服务端安全错误文案；网络或未知失败显示统一重试提示。
4. 失败时不刷新成假成功状态；界面继续显示服务端最后一次已保存值。
5. 不改变模型选择器布局、空数组语义或其他管理员操作。

## 数据流

```text
管理员模型选择
  -> POST /api/admin/users action=update
  -> requireAdminUser
  -> 读取一次公开目录快照
  -> chat/image 分别纯规范化
     -> 唯一裸键：迁移为精确键
     -> 精确有效：保留
     -> 歧义/无效：拒绝且零写入
  -> updateManagedUser(规范化数组)
  -> 脱敏审计
  -> 刷新管理员列表
  -> 普通用户 /api/models 读取精确授权
```

## 兼容边界

- `undefined` 表示本次不更新该字段。
- `[]` 保持当前“未限制该命名空间”的既有语义，不擅自改为“禁止全部”。
- 历史数据库中的歧义裸值不会在 GET 请求中自动改写；管理员下次保存时必须明确选择。
- 不增加启动迁移，不扫描所有用户，不修改数据库表结构。
- 不修改 `resolveTaskModel()`、`/api/models`、工作流、生成、节点、Agent、积分或支付。

## 测试设计

### RED 纯函数测试

- 唯一裸图像模型迁移成精确键。
- 多供应商同名裸模型返回歧义错误。
- 精确键指向禁用/不存在模型时返回无效。
- 聊天模型不能写入图像命名空间，反之亦然。
- 畸形键、非字符串、空值拒绝。
- 精确键稳定去重，顺序不变化。

### RED API 测试

- 歧义请求返回 409，`updateManagedUser` 与成功审计均未调用。
- 无效请求返回 400，零写入。
- 唯一裸值保存为精确键，并只加载一次目录快照。
- 同时更新 chat/image 时共用同一快照。
- 不含模型字段的更新不加载目录。
- 非管理员在目录读取前返回 403。

### RED 管理员界面合同测试

- 保存回调必须检查 `response.ok` 和业务 `success`。
- 409/400/网络失败必须提供明确错误反馈，不能静默刷新。
- 仅成功响应触发 `refreshAdmin()`。

### 回归门禁

- 管理员用户 CRUD、密码审计与 `V588-ADMIN-004` 投影专项。
- 模型目录、管理员模型选择、普通用户目录和任务精确路由专项。
- TypeScript、ESLint、保护基线、全仓测试、生产构建和 `git diff --check`。
- Coze exact-SHA 后使用同一管理员会话：保存唯一裸值迁移、歧义值拒绝、普通用户模型可见、刷新与重启保持一致、Console 零新增错误。

## 不在本项范围

- 不自动选择歧义模型的第一个供应商。
- 不修改用户 CRUD、积分、支付或项目数据。
- 不吸收 donor 的任务快照、执行器或媒体网关。
- 不批量迁移生产数据。
- 不触碰 `stable`、V5.8.8 donor、Coze 环境变量或真实供应商任务。

## 完成标准

1. RED 测试能稳定证明旧 API 接受模糊/无效授权。
2. 最小实现后所有新测试转绿，现有模型目录与管理员测试不回归。
3. 全量门禁为零失败；跳过项单独披露。
4. 只提交并推送 `main`，`stable` 哈希保持不变。
5. Coze exact-SHA 和 Google Chrome 证明保存、迁移、拒绝、普通用户可见性与刷新恢复真实成立。

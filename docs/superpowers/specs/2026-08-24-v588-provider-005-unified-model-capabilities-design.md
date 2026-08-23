# V588-PROVIDER-005 统一模型能力目录设计

## 1. 背景与目标

当前无界已经使用 `providerId + modelId` 标识任务模型，并在服务端返回
`taskModelCatalog`。但图像生成面板、无限画布生成组、节点模式、视频面板和生成 API
仍分别按照模型名称、供应商名称或本地常量推断比例、尺寸、质量、数量、参考图和视频时长。
同名模型出现在不同供应商时，这些推断会得到相同能力，无法表达供应商接口之间的真实差异。

本项吸收 V5.8.8 的“供应商能力矩阵”思想，但不复制 donor 媒体网关、生成控制器或任务生命周期。
目标是在当前任务、授权、资产和账务架构内建立一份唯一、精确、可审计的模型能力目录，保证：

1. 所有能力都绑定精确的 `providerId + modelId`。
2. 管理员配置、前端可选项和后端请求校验使用同一份结果。
3. 图像、参考图、融图、节点和视频入口不再各自维护模型能力表。
4. 同名模型可以因供应商不同而拥有不同能力。
5. 不支持的参数在创建供应商任务和扣费前被明确拒绝。
6. 旧项目与未配置能力的现有模型继续可用，但不会跨供应商静默降级。
7. `stable` 始终只读，V5.8.8 donor 始终只读，修改只进入当前 `main`。

## 2. 当前问题的证据

只读审计确认当前实现存在以下分裂：

- `src/lib/task-core/model-catalog.ts` 已生成精确任务描述，但前端没有消费其能力字段。
- `/api/models` 返回 `taskModelCatalog`，普通 `models` 对象仍主要承载名称和身份。
- `generation-panel.tsx`、`infinite-canvas.tsx` 和 `node-editor.tsx` 直接调用
  `getProviderAspectRatios`、`getQualityLevelOptions` 与 `getResolutionTierOptions`。
- `video-generation-panel.tsx` 根据 `VIDEO_MODEL_REGISTRY` 和模型名称推断能力。
- `/api/generate`、`/api/video/generate` 与 `/api/video/extend` 使用另一套推断或验证逻辑。
- `ModelInfo` 声明了比例、质量和最大数量字段，但数据库反序列化没有完整恢复这些字段。
- 管理员只能在“高级参数”中手写 `taskModelCapabilities` JSON 字符串，没有结构化编辑和字段校验。
- 当前云端同名 `gpt-image-2` 分布在多个供应商中，但生成出的能力签名相同，不能证明供应商差异。

## 3. 设计原则

### 3.1 唯一身份

模型能力主键固定为：

```text
providerId::modelId
```

任何显式选择都必须同时携带 `providerId` 与 `modelId`。模型名称不能作为跨供应商路由依据。
旧的裸 `modelId` 授权和保存值只允许在候选唯一时迁移；存在多个候选时继续明确拒绝。

### 3.2 按字段合并，而非整对象覆盖

每个能力字段按以下优先级独立解析：

1. **管理员明确配置**：精确供应商、精确模型的结构化覆盖。
2. **供应商适配或发现结果**：供应商文档适配器及模型发现返回的可信能力；同一字段冲突时，
   已审核的精确适配器优先于运行时发现结果。
3. **保守模型族默认值**：现有模型能力表，只作为缺失字段的最后兜底。

高优先级只覆盖它明确提供的字段。例如管理员只修改最大生成数量时，不得清空适配器提供的比例和质量。
空数组表示管理员明确禁止该能力；缺失字段才表示继续向下解析。

### 3.3 服务端为唯一事实来源

服务端生成最终 `TaskModelDescriptor`。前端只读取目录，不再按模型名称推断业务能力。
现有本地能力表仍可作为服务端兜底实现，但不得被业务面板直接调用。

### 3.4 不静默换模型或供应商

当用户提交的比例、尺寸、质量、数量、参考图、蒙版、视频时长或模式不受支持时，服务端在任务创建和扣费前返回稳定错误。
禁止为了“请求成功”而切换到其他供应商、其他模型或悄悄删除用户参数。

## 4. 统一能力合同

保留当前 `TaskModelDescriptor` 作为公共合同，并扩展缺失字段，避免再创建第二套模型目录。

```ts
type CapabilitySource = 'admin' | 'adapter' | 'discovery' | 'fallback';

type CapabilityField =
  | 'protocol'
  | 'executionMode'
  | 'allowedRatios'
  | 'allowedSizes'
  | 'qualityOptions'
  | 'maxOutputs'
  | 'supportsReferenceImages'
  | 'maxReferenceImages'
  | 'supportsMask'
  | 'allowedDurationsSeconds'
  | 'maxDurationSeconds'
  | 'supportedOperations'
  | 'outputKinds';

interface TaskModelDescriptor {
  providerId: string;
  modelId: string;
  kind: 'image' | 'video' | 'chat' | 'edit' | 'upscale' | 'layer' | '3d';
  sourceType: ApiKind;
  protocol: string;
  executionMode: 'sync' | 'async';

  allowedRatios: string[];
  allowedSizes: string[];
  qualityOptions: string[];
  maxOutputs: number;

  supportsReferenceImages: boolean;
  maxReferenceImages?: number;
  supportsMask: boolean;

  allowedDurationsSeconds?: number[];
  maxDurationSeconds?: number;
  supportedOperations?: Array<
    | 'text-to-image'
    | 'image-to-image'
    | 'text-to-video'
    | 'image-to-video'
    | 'first-last-frame'
    | 'multi-reference'
    | 'video-extend'
  >;

  outputKinds: string[];
  capabilitySources: Partial<Record<CapabilityField, CapabilitySource>>;
}
```

`capabilitySources` 只公开来源类别，不公开 API Key、供应商私有参数或内部 URL。它用于管理员诊断、测试证据和问题定位。

## 5. 配置与持久化

### 5.1 管理员配置

管理员供应商编辑器增加“模型能力”区域。管理员先选择该供应商已启用的模型，再按模型类型编辑：

- 图像：比例、像素尺寸或分辨率档位、质量、最大数量、参考图、最大参考图数量、蒙版与输出格式。
- 视频：比例、分辨率、离散时长、最大时长、文生视频、图生视频、首尾帧、多参考图和视频延长。
- 专项模型：放大、去背景、分层、矢量和 3D 只显示与类型相关的能力。

输入必须使用多选、数字输入、复选框或受控枚举，不要求管理员手写 JSON。现有高级参数入口保留，但
`taskModelCapabilities` 作为系统保留键由结构化编辑器管理，避免两处互相覆盖。

### 5.2 向后兼容

为避免新增并迁移第二张能力表，第一版继续把版本化能力对象存入供应商 `advanced_params` JSONB，
在服务端边界完成结构化解析和序列化。历史 `taskModelCapabilities` 字符串继续只读兼容；管理员首次保存后升级为规范化 v1 结构。

`normalizeDiscoveredModels` 必须完整保留所有已支持的能力字段，保证数据库重启、Coze 重部署和供应商刷新后能力不丢失。

### 5.3 发现数据的信任边界

普通 `/models` 响应通常只提供模型 ID，不能因此推断完整能力。只有适配器明确解析并验证的字段才标记为
`discovery`；未知字段忽略。供应商刷新不得覆盖管理员明确配置。

## 6. 服务端数据流

```text
供应商配置/模型发现
        |
        v
按字段规范化与校验
        |
        v
精确适配器(providerId/provider profile + modelId)
        |
        v
管理员 > 适配/发现 > 保守默认值 合并
        |
        v
TaskModelDescriptor[]
        |-----------------------|
        v                       v
/api/models 前端目录      任务创建前服务端校验
                                |
                                v
                       供应商适配与任务/扣费
```

`/api/models` 和 `/api/workflow/models` 继续执行现有用户授权过滤。普通用户只能看到已授权的精确模型及对应能力；
管理员能力覆盖不能扩大用户模型权限。

## 7. 前端消费范围

新增轻量客户端索引，以 `providerId::modelId` 查找服务端描述。以下入口必须全部接入同一索引：

1. 图像生成面板。
2. 无限画布参考图组、融图组和普通图片生成组。
3. 节点模式的图像、图生图、视频及相关模型节点。
4. 底部视频生成面板。
5. 快速创作及其他同时暴露比例、尺寸、质量、数量或参考图控制的业务面板。
6. 工作流模型接口和 Agent 工具准入。

仅选择模型而不暴露能力参数的业务面板可继续使用 `models` 列表，但提交时仍必须携带精确模型对，并受服务端统一校验。

当前面板中的模型名称、入口、默认布局和工具数量不变。本项不重构业务 UI，不删除功能。

## 8. 选择变化与旧项目行为

- 用户切换模型后，面板立即使用新描述重建可选项。
- 旧项目保存的值仍有效时原样保留。
- 旧值不受新模型支持时，前端选择该模型的第一个允许值，并显示一次非阻断提示。
- 目录尚未加载或精确描述不存在时，提交按钮禁用并显示“模型能力尚未加载”，不得回退到前端猜测。
- 已经发出的任务绑定提交时的能力目录快照；管理员后续修改不改变运行中任务。

## 9. 服务端校验与错误合同

统一校验发生在创建供应商任务、写入扣费记录之前。错误使用结构化合同：

```json
{
  "success": false,
  "code": "MODEL_CAPABILITY_MISMATCH",
  "message": "当前模型不支持所选视频时长",
  "requestId": "req_xxx",
  "retryable": false,
  "details": {
    "providerId": "provider_xxx",
    "modelId": "model_xxx",
    "field": "duration",
    "received": 30,
    "allowed": [5, 10, 15]
  }
}
```

需要区分：

- `MODEL_NOT_CONFIGURED`：精确模型对不存在或供应商停用。
- `MODEL_NOT_AUTHORIZED`：用户无权使用精确模型对。
- `MODEL_CAPABILITY_UNAVAILABLE`：目录无法形成安全能力描述。
- `MODEL_CAPABILITY_MISMATCH`：用户参数不在允许范围。

能力错误不得创建云任务、不得扣除积分，也不得触发供应商降级。

## 10. 供应商适配范围

本项以五家既有供应商文档为验证来源：APIB、PearAPI、4SAPI、AI Link 和 302.AI。
只加入当前管理员实际启用模型需要的精确适配条目，不把供应商所有文档模型一次性硬编码进程序。

适配器必须满足：

- 同一模型在不同供应商下可拥有不同能力。
- 模型精确规则优先于供应商默认规则。
- 未确认能力使用保守默认值，不能凭相似名称开放高分辨率、长视频或多参考图。
- V5.8.8 `wujie-media-gateway` 只作为测试案例和字段映射参考，不成为本项运行时所有者。
- 不吸收 donor 中同步等待长任务、localhost 回调、进程内任务边或独立扣费逻辑。

## 11. 测试策略

### 11.1 首批 RED

在修改生产代码前建立以下失败证据：

1. 同名模型在两个供应商下配置不同能力时，目录当前仍产生相同结果。
2. 管理员能力字段经过数据库序列化/反序列化后丢失。
3. `/api/models` 虽返回目录，但生成面板、参考图组、融图组、节点和视频面板没有消费。
4. `/api/generate` 接受目录不允许的比例、质量或数量。
5. 视频 API 接受目录不允许的离散时长或模式，或与前端可选项不一致。
6. 当前缺少永久测试证明能力不匹配一定在任务创建和扣费之前被拒绝。

### 11.2 单元与集成测试

- 每字段优先级和空值/空数组语义。
- 非法 JSON、超长数组、无效枚举、越界数量和原型污染防护。
- 管理员覆盖、发现结果、精确适配器和默认值的来源标记。
- 同名模型跨供应商差异。
- 普通用户授权过滤与管理员覆盖不扩大权限。
- 数据库与文件模式往返一致。
- 前端所有能力控件随模型切换更新。
- API 在任务创建和扣费前拒绝非法参数。
- 合法旧项目值保留，非法旧值只在 UI 内显式归一化。

### 11.3 全量门禁

按现有项目命令执行 Doctor、TypeScript、ESLint、全量 Vitest、API、回归、生产构建、保护清单和空白检查。
涉及 PostgreSQL 持久化时必须运行真实隔离 PostgreSQL；缺少数据库不得把跳过记为通过。

### 11.4 Coze 与真实浏览器验收

只推送 GitHub `main`。Coze 拉取精确 SHA 后，使用现有 Google Chrome 标签页完成：

- 管理员配置能力并刷新/重启，配置不丢失。
- 普通用户只看到授权模型和正确能力。
- 至少选择两家供应商的同名或同族图像模型，确认可选范围不同且提交载荷正确。
- 图像生成、参考图组、融图组、节点模式和视频面板逐项验证。
- 非法参数在创建任务和扣费前拒绝。
- 至少完成一条真实图像和一条真实视频合法链路；记录任务、结果、积分与 Console/Network 证据。
- 沙箱验收后按发布边界在稳定部署域名复验；`stable` 分支不变。

## 12. 发布与回滚

能力目录改造不使用一次性全量切换。实施顺序为：

1. 完成服务端合同、持久化和 RED/GREEN。
2. 接入图像生成和服务端校验。
3. 接入参考图组、融图组与节点模式。
4. 接入视频面板与视频 API。
5. 接入管理员结构化编辑器。
6. 完成全量与云端验收。

每一步都保留现有功能清单和入口合同。回滚以当前 `main` 的前一已验证提交为边界，不修改 `stable`，不删除管理员已有能力配置；旧运行时忽略新版本字段时仍使用现有保守默认值。

## 13. 非目标

本项不包含：

- 整体迁移 V5.8.8 媒体网关。
- 改写生成任务、资产、积分或退款状态机。
- 新增供应商自动切换或故障转移。
- 调整模型价格和积分规则。
- 重构无限画布或业务工具 UI。
- 扩大普通用户模型授权。
- 修改 GitHub `stable`。

## 14. 完成标准

只有同时满足以下条件，`V588-PROVIDER-005` 才能标记为吸收完成：

1. 所有能力使用精确模型对和统一服务端目录。
2. 所有暴露能力控件的前端入口均使用该目录。
3. 图像和视频服务端在任务/扣费前使用同一目录校验。
4. 管理员结构化配置可持久化且重启后不丢失。
5. 五家供应商的当前启用模型都有文档契约或明确保守回退证据。
6. RED 测试转绿且全量本地门禁通过。
7. Coze exact-SHA 与 Google Chrome 真实验证通过，并保留 Console、Network、截图和任务/积分证据。
8. `stable` 与 V5.8.8 donor 均保持不变。

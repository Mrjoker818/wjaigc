# V588-PROVIDER-005 统一模型能力目录实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在当前无界任务、授权、资产和账务架构内建立以 `providerId::modelId` 为唯一身份的模型能力目录，并让图像、参考图、融图、节点、视频、管理员和服务端校验使用同一事实来源。

**架构：** 把客户端安全的能力合同、纯合并/校验逻辑、精确供应商适配器和服务端目录装配拆成四个明确边界。能力按字段使用“管理员明确配置 > 精确供应商适配器 > 可信发现结果 > 保守模型族默认值”合并；所有业务 UI 读取 `/api/models` 返回的 `taskModelCatalog`，所有生成 API 在任务创建和扣费前使用同一描述校验。

**技术栈：** Next.js 16 App Router、React 19、TypeScript 5、Vitest、Playwright、PostgreSQL、现有 `task-core`、shadcn/ui、Tailwind CSS 4。

## 全局约束

- GitHub `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 永久只读。
- V5.8.8 donor `J:/无界云端0820` 永久只读，只允许提取测试案例和字段映射思想。
- 所有修改只进入 GitHub `main`，禁止整体复制 donor 媒体网关、生成控制器、任务或扣费逻辑。
- 每个任务必须按 RED → 最小实现 → 聚焦回归 → 独立提交执行，不得删除或跳过失败测试。
- 模型唯一身份始终为 `providerId::modelId`，不得用裸模型名跨供应商猜测。
- 能力错误必须发生在任务创建、供应商提交和积分扣除之前。
- 不删除任何现有工具入口、模型入口、参考图能力、节点能力或视频能力。
- 新增和更新的设计、计划、测试、发布文档统一使用中文。
- Coze 操作只使用现有 Google Chrome 标签页，不创建新标签，不使用 360 浏览器。

---

## 文件结构与职责

### 新建文件

- `src/lib/task-core/model-capability-contract.ts`：客户端和服务端共享的类型、复合键和目录索引。
- `src/lib/task-core/model-capability-resolution.ts`：纯函数解析、按字段合并、输入校验和能力错误。
- `src/lib/task-core/provider-capability-adapters.ts`：仅包含经过文档审核的精确供应商/模型适配条目。
- `src/hooks/use-task-model-catalog.ts`：请求 `/api/models`、构建精确索引并暴露加载/错误状态。
- `src/components/dashboard/model-capability-editor.tsx`：管理员结构化能力编辑器，仅编辑选中供应商的选中模型。
- `src/__tests__/lib/task-model-capability-resolution.test.ts`：优先级、边界和错误合同。
- `src/__tests__/lib/server-api-config-model-capabilities.test.ts`：数据库/文件反序列化与旧格式兼容。
- `src/__tests__/lib/server-api-config-model-capabilities-postgres.test.ts`：真实 PostgreSQL JSONB 往返与并发更新。
- `src/__tests__/lib/provider-capability-adapters.test.ts`：五家供应商精确文档契约。
- `src/__tests__/api/model-capability-admission.test.ts`：图像/视频任务和扣费前拒绝。
- `src/__tests__/api/admin-api-provider-capabilities.test.ts`：管理员能力更新的鉴权与原子保存。
- `src/__tests__/components/model-capability-consumers.test.tsx`：所有前端消费端一致性。
- `tests/e2e/v588-provider-005-capabilities.spec.ts`：本地和 Coze 真实浏览器验收。

### 修改文件

- `src/lib/task-core/model-catalog.ts`：装配统一描述、授权现有用户对象并保留旧导出。
- `src/lib/universal-api-types.ts`：补齐可持久化的发现能力字段。
- `src/lib/server-api-config.ts`：能力字段往返、v1 管理员覆盖解析和公开目录装饰。
- `src/app/api/models/route.ts`：返回版本化能力目录。
- `src/app/api/workflow/models/route.ts`：返回同一授权目录。
- `src/app/api/generate/route.ts`：在扣费前执行精确图像能力准入。
- `src/app/api/video/generate/route.ts`：在任务/扣费前执行精确视频能力准入。
- `src/app/api/video/extend/route.ts`：使用同一视频延长能力准入。
- `src/components/generation-panel.tsx`：使用目录控制比例、尺寸、质量和数量。
- `src/components/infinite-canvas.tsx`：参考图组、融图组和普通生成组使用目录。
- `src/components/node-editor.tsx`：图像和视频节点使用目录。
- `src/components/video-generation-panel.tsx`：使用目录控制模式、比例、分辨率和离散时长。
- `src/components/third-party-model-dialog.tsx`：接入结构化模型能力编辑器。
- `src/lib/agent-runtime/admission-gate.ts`：继续从统一描述推导工具准入。
- `src/__tests__/lib/api-compatibility.test.ts` 与 `src/__tests__/lib/video-model-inference.test.ts`：只保留服务端 fallback 合同，不再允许业务消费端直接推断。
- `docs/plans/v588/V588_ABSORPTION_INVENTORY.md`、`docs/testing/BUG_REGISTER.md`、`docs/testing/REGRESSION_REPORT.md`、`docs/testing/UNVERIFIED_ITEMS.md` 与 `docs/testing/RELEASE_READINESS_REPORT.md`：记录实现、证据和未验证项。

---

### Task 1：建立统一能力合同的 RED 证据

**文件：**
- 新建：`src/__tests__/lib/task-model-capability-resolution.test.ts`
- 修改：`src/__tests__/lib/task-model-catalog.test.ts`
- 修改：`src/__tests__/api/models-configured-catalog.test.ts`
- 修改：`src/__tests__/api/models-defaults.test.ts`

**接口：**
- 消费：现有 `resolveTaskModelCatalogResultFromSnapshot()`、`taskModelKey()`。
- 产出：后续任务必须实现的 `CapabilitySource`、`CapabilityField`、`TaskModelDescriptor` 扩展字段及版本化目录合同。

- [ ] **Step 1：写入同名模型跨供应商能力差异的失败测试**

```ts
it('keeps different capabilities for the same model id on different providers', () => {
  const result = resolveTaskModelCatalogResultFromSnapshot(models, admin, [pear, provider302]);
  const pearModel = result.taskModelCatalog.find(item => item.providerId === 'pear');
  const model302 = result.taskModelCatalog.find(item => item.providerId === 'provider-302');

  expect(pearModel).toMatchObject({
    modelId: 'gpt-image-2',
    allowedSizes: ['1024x1024'],
    maxOutputs: 4,
    capabilitySources: { allowedSizes: 'admin', maxOutputs: 'admin' },
  });
  expect(model302).toMatchObject({
    modelId: 'gpt-image-2',
    allowedSizes: ['1K', '2K', '4K'],
    maxOutputs: 1,
    capabilitySources: { allowedSizes: 'adapter', maxOutputs: 'fallback' },
  });
});
```

- [ ] **Step 2：写入离散视频时长、模式和来源字段的失败测试**

```ts
expect(videoDescriptor).toMatchObject({
  allowedDurationsSeconds: [5, 10, 15],
  maxDurationSeconds: 15,
  supportedOperations: ['text-to-video', 'image-to-video', 'first-last-frame'],
  capabilitySources: {
    allowedDurationsSeconds: 'admin',
    supportedOperations: 'adapter',
  },
});
```

- [ ] **Step 3：写入 `/api/models` 版本化目录失败测试**

```ts
expect(data.capabilityCatalogVersion).toBe(1);
expect(data.taskModelCatalog).toContainEqual(expect.objectContaining({
  providerId: 'provider-a',
  modelId: 'gpt-image-2',
  capabilitySources: expect.any(Object),
}));
```

- [ ] **Step 4：运行 RED 并保存精确失败**

运行：

```bash
pnpm exec vitest run src/__tests__/lib/task-model-capability-resolution.test.ts src/__tests__/lib/task-model-catalog.test.ts src/__tests__/api/models-configured-catalog.test.ts src/__tests__/api/models-defaults.test.ts
```

预期：仅因 `model-capability-contract`、`capabilitySources`、`allowedDurationsSeconds`、`supportedOperations` 和 `capabilityCatalogVersion` 尚不存在而失败；现有授权测试不得新增失败。

- [ ] **Step 5：提交 RED 测试**

```bash
git add src/__tests__/lib/task-model-capability-resolution.test.ts src/__tests__/lib/task-model-catalog.test.ts src/__tests__/api/models-configured-catalog.test.ts src/__tests__/api/models-defaults.test.ts
git commit -m "test: define unified provider capability contract"
```

---

### Task 2：实现客户端安全合同、合并器和校验器

**文件：**
- 新建：`src/lib/task-core/model-capability-contract.ts`
- 新建：`src/lib/task-core/model-capability-resolution.ts`
- 修改：`src/lib/task-core/model-catalog.ts`
- 测试：`src/__tests__/lib/task-model-capability-resolution.test.ts`

**接口：**
- 产出：`TaskModelDescriptor`、`CapabilityOverrideV1`、`createTaskModelCatalogIndex()`、`mergeCapabilityLayers()`、`validateTaskModelSelection()`、`ModelCapabilityError`。
- 约束：两个新文件不得导入 `server-only`、数据库、React 或 Next.js。

- [ ] **Step 1：定义共享合同和精确索引**

```ts
export const CAPABILITY_CATALOG_VERSION = 1 as const;
export type CapabilitySource = 'admin' | 'adapter' | 'discovery' | 'fallback';
export type CapabilityField =
  | 'protocol' | 'executionMode'
  | 'allowedRatios' | 'allowedSizes' | 'qualityOptions' | 'maxOutputs'
  | 'supportsReferenceImages' | 'maxReferenceImages' | 'supportsMask'
  | 'allowedDurationsSeconds' | 'maxDurationSeconds'
  | 'supportedOperations' | 'outputKinds';
export type SupportedOperation =
  | 'text-to-image' | 'image-to-image'
  | 'text-to-video' | 'image-to-video'
  | 'first-last-frame' | 'multi-reference' | 'video-extend';

export interface TaskModelDescriptor {
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
  supportedOperations?: SupportedOperation[];
  outputKinds: string[];
  capabilitySources: Partial<Record<CapabilityField, CapabilitySource>>;
}

export type CapabilityLayer = Partial<Pick<TaskModelDescriptor, CapabilityField>>;
export interface CapabilityMergeResult {
  value: CapabilityLayer;
  sources: Partial<Record<CapabilityField, CapabilitySource>>;
}
export type CapabilityOverrideV1 = CapabilityLayer;
export interface ProviderCapabilityOverridesV1 {
  version: typeof CAPABILITY_CATALOG_VERSION;
  models: Record<string, CapabilityOverrideV1>;
}

export interface TaskModelSelection {
  aspectRatio?: string;
  size?: string;
  quality?: string;
  outputCount?: number;
  referenceImageCount?: number;
  usesMask?: boolean;
  durationSeconds?: number;
  operation?: SupportedOperation;
}

export interface CapabilityMismatch {
  code: 'MODEL_CAPABILITY_MISMATCH';
  field: string;
  received: unknown;
  allowed: unknown[];
}
export type CapabilityValidationResult =
  | { ok: true }
  | { ok: false; error: CapabilityMismatch };

export class ModelCapabilityError extends Error {
  constructor(
    public readonly code:
      | 'MODEL_NOT_CONFIGURED'
      | 'MODEL_NOT_AUTHORIZED'
      | 'MODEL_CAPABILITY_UNAVAILABLE'
      | 'MODEL_CAPABILITY_MISMATCH',
    message: string,
    public readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ModelCapabilityError';
  }
}

export function taskModelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

export function createTaskModelCatalogIndex(items: TaskModelDescriptor[]) {
  return new Map(items.map(item => [taskModelKey(item.providerId, item.modelId), item]));
}
```

- [ ] **Step 2：实现按字段优先级合并**

```ts
export function mergeCapabilityLayers(input: {
  fallback: CapabilityLayer;
  discovery?: CapabilityLayer;
  adapter?: CapabilityLayer;
  admin?: CapabilityLayer;
}): CapabilityMergeResult {
  const layers: Array<[CapabilitySource, CapabilityLayer | undefined]> = [
    ['fallback', input.fallback],
    ['discovery', input.discovery],
    ['adapter', input.adapter],
    ['admin', input.admin],
  ];
  const value: CapabilityLayer = {};
  const sources: Partial<Record<CapabilityField, CapabilitySource>> = {};
  for (const [source, layer] of layers) {
    if (!layer) continue;
    for (const field of CAPABILITY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(layer, field)) continue;
      value[field] = cloneCapabilityValue(layer[field]);
      sources[field] = source;
    }
  }
  return { value, sources };
}
```

- [ ] **Step 3：实现任务选择校验和固定错误码**

```ts
export function validateTaskModelSelection(
  descriptor: TaskModelDescriptor,
  selection: TaskModelSelection,
): CapabilityValidationResult {
  if (selection.aspectRatio && !descriptor.allowedRatios.includes(selection.aspectRatio)) {
    return mismatch('aspectRatio', selection.aspectRatio, descriptor.allowedRatios);
  }
  if (selection.size && !descriptor.allowedSizes.includes(selection.size)) {
    return mismatch('size', selection.size, descriptor.allowedSizes);
  }
  if (selection.quality && !descriptor.qualityOptions.includes(selection.quality)) {
    return mismatch('quality', selection.quality, descriptor.qualityOptions);
  }
  if (selection.outputCount !== undefined && selection.outputCount > descriptor.maxOutputs) {
    return mismatch('outputCount', selection.outputCount, range(1, descriptor.maxOutputs));
  }
  if (selection.referenceImageCount && !descriptor.supportsReferenceImages) {
    return mismatch('referenceImages', selection.referenceImageCount, [0]);
  }
  if (selection.referenceImageCount
      && descriptor.maxReferenceImages !== undefined
      && selection.referenceImageCount > descriptor.maxReferenceImages) {
    return mismatch('referenceImages', selection.referenceImageCount, range(0, descriptor.maxReferenceImages));
  }
  if (selection.usesMask && !descriptor.supportsMask) {
    return mismatch('mask', true, [false]);
  }
  if (selection.durationSeconds !== undefined
      && !descriptor.allowedDurationsSeconds?.includes(selection.durationSeconds)) {
    return mismatch('duration', selection.durationSeconds, descriptor.allowedDurationsSeconds || []);
  }
  if (selection.operation && !descriptor.supportedOperations?.includes(selection.operation)) {
    return mismatch('operation', selection.operation, descriptor.supportedOperations || []);
  }
  return { ok: true };
}
```

- [ ] **Step 4：从 `model-catalog.ts` 重新导出共享类型，保持旧导入兼容**

```ts
export type { TaskModelDescriptor } from './model-capability-contract';
export { taskModelKey } from './model-capability-contract';
```

- [ ] **Step 5：运行聚焦测试**

运行：

```bash
pnpm exec vitest run src/__tests__/lib/task-model-capability-resolution.test.ts src/__tests__/lib/task-model-catalog.test.ts
pnpm ts-check
```

预期：新纯函数测试通过；目录装配相关测试可继续因尚未接线而 RED；TypeScript 不出现重复导出或客户端导入服务端模块错误。

- [ ] **Step 6：提交纯能力边界**

```bash
git add src/lib/task-core/model-capability-contract.ts src/lib/task-core/model-capability-resolution.ts src/lib/task-core/model-catalog.ts src/__tests__/lib/task-model-capability-resolution.test.ts
git commit -m "feat: add provider model capability contract"
```

---

### Task 3：修复能力持久化并兼容历史管理员覆盖

**文件：**
- 修改：`src/lib/universal-api-types.ts`
- 修改：`src/lib/server-api-config.ts`
- 新建：`src/__tests__/lib/server-api-config-model-capabilities.test.ts`
- 修改：`src/__tests__/lib/server-api-config-public-provider.test.ts`

**接口：**
- 消费：Task 2 的 `CapabilityOverrideV1` 与严格解析器。
- 产出：`ModelInfo` 完整能力往返；`readProviderCapabilityOverrides()` 与 `serializeProviderCapabilityOverrides()`。

- [ ] **Step 1：写数据库/文件往返 RED**

```ts
expect(roundTripped.discoveredModels?.[0]).toMatchObject({
  supportedAspectRatios: ['1:1', '16:9'],
  supportedQualities: ['standard', 'hd'],
  maxImages: 4,
  maxReferenceImages: 3,
  allowedDurationsSeconds: [5, 10, 15],
  maxDurationSeconds: 15,
  supportedOperations: ['text-to-video', 'image-to-video'],
  outputKinds: ['mp4'],
});
```

- [ ] **Step 2：写历史直接映射与 v1 包装格式兼容 RED**

```ts
expect(readProviderCapabilityOverrides(JSON.stringify({
  'gpt-image-2': { maxOutputs: 2 },
}))).toEqual({ version: 1, models: { 'gpt-image-2': { maxOutputs: 2 } } });

expect(readProviderCapabilityOverrides(JSON.stringify({
  version: 1,
  models: { 'gpt-image-2': { maxOutputs: 4 } },
}))).toEqual({ version: 1, models: { 'gpt-image-2': { maxOutputs: 4 } } });
```

- [ ] **Step 3：补齐 `ModelInfo` 字段并严格恢复**

```ts
export interface ModelInfo {
  // existing fields stay unchanged
  maxReferenceImages?: number;
  allowedDurationsSeconds?: number[];
  maxDurationSeconds?: number;
  supportedOperations?: SupportedOperation[];
  outputKinds?: string[];
}
```

在 `normalizeDiscoveredModels()` 中逐字段调用有限数组/整数解析器；未知字段、错误元素、超长数组和继承属性一律忽略。

- [ ] **Step 4：实现版本化覆盖序列化**

```ts
export function serializeProviderCapabilityOverrides(value: ProviderCapabilityOverridesV1): string {
  return JSON.stringify({ version: 1, models: sortCapabilityModels(value.models) });
}
```

保存时只更新 `advancedParams.taskModelCapabilities`，保留同一提供商其他高级参数。

- [ ] **Step 5：运行持久化回归**

```bash
pnpm exec vitest run src/__tests__/lib/server-api-config-model-capabilities.test.ts src/__tests__/lib/server-api-config-public-provider.test.ts src/__tests__/lib/server-api-config-layer-models.test.ts
pnpm ts-check
```

预期：能力往返、历史格式兼容、凭据脱敏和分层模型测试全部通过。

- [ ] **Step 6：提交持久化修复**

```bash
git add src/lib/universal-api-types.ts src/lib/server-api-config.ts src/__tests__/lib/server-api-config-model-capabilities.test.ts src/__tests__/lib/server-api-config-public-provider.test.ts
git commit -m "fix: persist provider model capabilities"
```

---

### Task 4：装配精确适配器和版本化服务端目录

**文件：**
- 新建：`src/lib/task-core/provider-capability-adapters.ts`
- 修改：`src/lib/task-core/model-catalog.ts`
- 修改：`src/app/api/models/route.ts`
- 修改：`src/app/api/workflow/models/route.ts`
- 新建：`src/__tests__/lib/provider-capability-adapters.test.ts`
- 修改：`src/__tests__/api/models-configured-catalog.test.ts`
- 修改：`src/__tests__/api/workflow-models.test.ts`

**接口：**
- 产出：`resolveProviderCapabilityAdapter(provider, model)` 和授权后的版本化 `taskModelCatalog`。
- 精确适配器主键：供应商 profile/baseUrl 分类与完整 `model.id`，不得使用会跨模型吞并的宽泛正则。

- [ ] **Step 1：为当前已配置的五家供应商建立文档夹具 RED**

```ts
expect(resolveProviderCapabilityAdapter(provider302, model302)).toEqual({
  protocol: audited302Fixture.protocol,
  executionMode: audited302Fixture.executionMode,
  allowedRatios: audited302Fixture.allowedRatios,
  allowedSizes: audited302Fixture.allowedSizes,
});
expect(resolveProviderCapabilityAdapter(pear, sameModelId)).not.toEqual(
  resolveProviderCapabilityAdapter(provider302, sameModelId),
);
```

每条期望必须在测试注释中记录官方页面 URL、接口路径和审核日期；没有文档证据的字段不写入适配器。
五家来源固定为 `https://pearapi.apifox.cn/`、`https://docs.apib.ai/cn`、`https://4sapi.apifox.cn/`、`https://docs.ai-link.shop` 和 `https://doc.302.ai/`。测试夹具值来自审核时保存的精确模型接口样例，不得根据相似模型名手写猜测值。

- [ ] **Step 2：实现精确适配器选择**

```ts
export function resolveProviderCapabilityAdapter(
  provider: ApiProvider,
  model: ModelInfo,
): CapabilityLayer | undefined {
  const providerFamily = classifyProviderCapabilityFamily(provider);
  return EXACT_MODEL_CAPABILITIES[`${providerFamily}::${model.id}`]
    ?? PROVIDER_DEFAULT_CAPABILITIES[providerFamily]?.[model.type];
}
```

- [ ] **Step 3：让目录按字段合并并记录来源**

```ts
const merged = mergeCapabilityLayers({
  fallback: createFallbackCapabilities(provider, model),
  discovery: createDiscoveryCapabilities(model),
  adapter: resolveProviderCapabilityAdapter(provider, model),
  admin: readAdminModelCapabilities(provider, model.id),
});
return createDescriptor(provider, model, merged.value, merged.sources);
```

- [ ] **Step 4：增加当前用户对象解析，避免内部认证再次查找用户失败**

```ts
export async function resolveTaskModelForUser(
  providerId: string,
  modelId: string,
  user: User,
): Promise<TaskModelDescriptor> {
  const providers = await getApiProviders();
  return resolveDescriptorFromProviders(providers, providerId, modelId, user);
}
```

现有 `resolveTaskModel(providerId, modelId, userId)` 继续保留，并在查出用户后调用该函数。

- [ ] **Step 5：让两个模型 API 返回目录版本**

```ts
return NextResponse.json({
  success: true,
  capabilityCatalogVersion: CAPABILITY_CATALOG_VERSION,
  providers: snapshot.providers,
  models: responseModels,
  taskModelCatalog: filteredDescriptors,
  // existing migration and quick-create fields remain unchanged
});
```

- [ ] **Step 6：运行目录、授权和 API 回归**

```bash
pnpm exec vitest run src/__tests__/lib/provider-capability-adapters.test.ts src/__tests__/lib/task-model-catalog.test.ts src/__tests__/api/models-configured-catalog.test.ts src/__tests__/api/models-defaults.test.ts src/__tests__/api/workflow-models.test.ts
pnpm ts-check
```

预期：同名模型差异、普通用户过滤、禁用供应商、裸 ID 歧义和工作流目录全部通过。

- [ ] **Step 7：提交目录装配**

```bash
git add src/lib/task-core/provider-capability-adapters.ts src/lib/task-core/model-catalog.ts src/app/api/models/route.ts src/app/api/workflow/models/route.ts src/__tests__/lib/provider-capability-adapters.test.ts src/__tests__/lib/task-model-catalog.test.ts src/__tests__/api/models-configured-catalog.test.ts src/__tests__/api/models-defaults.test.ts src/__tests__/api/workflow-models.test.ts
git commit -m "feat: resolve exact provider model capabilities"
```

---

### Task 5：在图像任务与扣费前执行统一准入

**文件：**
- 修改：`src/app/api/generate/route.ts`
- 新建：`src/__tests__/api/model-capability-admission.test.ts`
- 修改：`src/__tests__/api/generate-provider-capabilities.test.ts`
- 回归：`src/__tests__/api/generate-output-count.test.ts`
- 回归：`src/__tests__/api/generate-idempotency-contract.test.ts`
- 回归：`src/__tests__/api/poll-task-progressive-generation-contract.test.ts`
- 回归：`src/__tests__/api/generate-reference-constraint-persistence-contract.test.ts`
- 回归：`src/__tests__/api/generate-reference-category-strength-contract.test.ts`
- 回归：`src/__tests__/lib/task-billing.test.ts`
- 回归：`src/__tests__/lib/billing-model-category.test.ts`

**接口：**
- 消费：`resolveTaskModelForUser()` 与 `validateTaskModelSelection()`。
- 产出：图像能力错误固定 JSON，且 `consumeCredits()`、`createBillableTask()`、`registerTask()` 和供应商 `fetch()` 调用次数均为零。

- [ ] **Step 1：写非法比例/质量/数量/参考图的路由 RED**

```ts
const response = await POST(requestFor({
  providerId: 'pear', model: 'gpt-image-2', aspectRatio: '21:9', outputCount: 5,
}));
expect(response.status).toBe(400);
expect(await response.json()).toMatchObject({
  success: false,
  code: 'MODEL_CAPABILITY_MISMATCH',
  retryable: false,
  details: { providerId: 'pear', modelId: 'gpt-image-2' },
});
expect(mocks.consumeCredits).not.toHaveBeenCalled();
expect(mocks.createBillableTask).not.toHaveBeenCalled();
expect(mocks.providerFetch).not.toHaveBeenCalled();
```

- [ ] **Step 2：写显式供应商不可用时禁止跨供应商降级 RED**

```ts
expect(response.status).toBe(400);
expect(body.code).toBe('MODEL_NOT_CONFIGURED');
expect(body.actualProviderId).toBeUndefined();
expect(mocks.findProviderForModel).not.toHaveBeenCalledWith(
  expect.anything(), expect.anything(), expect.not.stringMatching(/^$/),
);
```

- [ ] **Step 3：在凭证确认后、任何扣费前解析精确描述**

```ts
const descriptor = await resolveTaskModelForUser(provider.id, modelConfig.modelId, authResult.user);
const admission = validateTaskModelSelection(descriptor, {
  operation: accessibleReferenceImages.length ? 'image-to-image' : 'text-to-image',
  aspectRatio,
  size: requestedPixelSize || resolutionTier,
  quality,
  outputCount: requestedOutputCount,
  referenceImageCount: accessibleReferenceImages.length,
  usesMask: false,
});
if (!admission.ok) return modelCapabilityErrorResponse(admission.error, requestId);
```

移除该路径对 `normalizeImageGenerationSelection()` 的静默纠正。前端负责旧值显式归一化；服务端拒绝直接 API 的非法值。

- [ ] **Step 4：保留多图逐槽任务语义**

目录 `maxOutputs` 控制单次用户请求上限；现有逐槽 `n=1` 提交、逐张返回、取消和退款逻辑保持不变。

- [ ] **Step 5：运行图像 API 与账务聚焦回归**

```bash
pnpm exec vitest run src/__tests__/api/model-capability-admission.test.ts src/__tests__/api/generate-provider-capabilities.test.ts src/__tests__/api/generate-output-count.test.ts src/__tests__/api/generate-idempotency-contract.test.ts src/__tests__/api/poll-task-progressive-generation-contract.test.ts src/__tests__/api/generate-reference-constraint-persistence-contract.test.ts src/__tests__/api/generate-reference-category-strength-contract.test.ts src/__tests__/lib/task-billing.test.ts src/__tests__/lib/billing-model-category.test.ts
```

预期：非法能力请求无任务、无扣费、无供应商调用；合法 `n=1/2/3/4` 保持逐槽返回。

- [ ] **Step 6：提交图像准入**

```bash
git add src/app/api/generate/route.ts src/__tests__/api/model-capability-admission.test.ts src/__tests__/api/generate-provider-capabilities.test.ts
git commit -m "fix: enforce image model capabilities before billing"
```

---

### Task 6：建立客户端目录 Hook 并接入图像生成面板

**文件：**
- 新建：`src/hooks/use-task-model-catalog.ts`
- 修改：`src/components/generation-panel.tsx`
- 修改：`src/__tests__/components/generation-panel-provider-capabilities.test.ts`
- 修改：`src/__tests__/components/generation-panel-model-reconciliation-contract.test.ts`
- 新建：`src/__tests__/components/model-capability-consumers.test.tsx`

**接口：**
- 产出：`useTaskModelCatalog(type)`，返回 `models`、`descriptorsByKey`、`loading`、`error` 和 `reload()`。

- [ ] **Step 1：写组件行为 RED**

```tsx
render(<GenerationPanel />);
await selectModel('pear::gpt-image-2');
expect(optionValues('画面比例')).toEqual(['1:1', '16:9']);
expect(optionValues('生图质量')).toEqual(['standard', 'hd']);
expect(optionValues('生图数量')).toEqual(['1', '2', '3', '4']);
expect(screen.queryByText('21:9')).not.toBeInTheDocument();
```

- [ ] **Step 2：实现带取消的目录 Hook**

```ts
export function useTaskModelCatalog(type: ApiKind) {
  const [state, setState] = useState<CatalogState>(initialCatalogState);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/models?type=${type}`, { cache: 'no-store', signal });
    const data = await response.json() as ModelsResponse;
    if (!response.ok || data.capabilityCatalogVersion !== 1) throw new Error('模型能力目录不可用');
    setState({ models: data.models, descriptorsByKey: createTaskModelCatalogIndex(data.taskModelCatalog), loading: false, error: null });
  }, [type]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error }));
    });
    return () => controller.abort();
  }, [reload]);
  return { ...state, reload };
}
```

- [ ] **Step 3：把生成面板能力选择改为精确描述**

```ts
const descriptor = descriptorsByKey.get(taskModelKey(selectedProviderId, pureModelId));
const supportedRatios = descriptor?.allowedRatios ?? [];
const qualityOptions = descriptor?.qualityOptions ?? [];
const sizeOptions = descriptor?.allowedSizes ?? [];
const countOptions = descriptor ? range(1, descriptor.maxOutputs) : [];
const capabilityReady = Boolean(descriptor) && !catalogError;
```

目录未加载时禁用生成并显示“模型能力尚未加载”；不得调用旧的 providerHint 推断函数。

- [ ] **Step 4：实现旧值一次性显式归一化**

```ts
useEffect(() => {
  if (!descriptor) return;
  setAspectRatio(value => descriptor.allowedRatios.includes(value) ? value : descriptor.allowedRatios[0]);
  setQuality(value => descriptor.qualityOptions.includes(value) ? value : descriptor.qualityOptions[0]);
  setOutputCount(value => Math.min(value, descriptor.maxOutputs));
}, [descriptor]);
```

- [ ] **Step 5：运行图像面板回归**

```bash
pnpm exec vitest run src/__tests__/components/model-capability-consumers.test.tsx src/__tests__/components/generation-panel-provider-capabilities.test.ts src/__tests__/components/generation-panel-model-reconciliation-contract.test.ts
pnpm ts-check
```

- [ ] **Step 6：提交图像面板接入**

```bash
git add src/hooks/use-task-model-catalog.ts src/components/generation-panel.tsx src/__tests__/components/model-capability-consumers.test.tsx src/__tests__/components/generation-panel-provider-capabilities.test.ts src/__tests__/components/generation-panel-model-reconciliation-contract.test.ts
git commit -m "feat: drive image controls from model catalog"
```

---

### Task 7：接入无限画布生成组和节点模式

**文件：**
- 修改：`src/components/infinite-canvas.tsx`
- 修改：`src/components/node-editor.tsx`
- 修改：`src/components/canvas-workspace.tsx`
- 修改：`src/__tests__/components/infinite-canvas-provider-capabilities.test.ts`
- 修改：`src/__tests__/components/node-editor-provider-capabilities.test.ts`
- 回归：`src/__tests__/components/canvas-group-generation-error-contract.test.ts`
- 回归：`src/__tests__/components/canvas-group-gesture-contract.test.ts`
- 回归：`src/__tests__/components/generation-entry-slot-contract.test.ts`
- 回归：`src/__tests__/components/node-editor-execution-wiring.test.ts`
- 回归：`src/__tests__/components/node-editor-react-flow-v2-integration.test.tsx`

**接口：**
- 消费：Task 6 的授权目录或由 `CanvasWorkspace` 注入的相同目录快照。
- 约束：参考图组与融图组必须使用精确 `providerId`，不得退回 localStorage 中含 API Key 的旧供应商快照。

- [ ] **Step 1：写三类生成组和节点切换 RED**

```ts
expect(referenceGroup.controls.ratios).toEqual(descriptor.allowedRatios);
expect(fusionGroup.controls.maxOutputs).toBe(descriptor.maxOutputs);
expect(imageNode.fields.quality.options).toEqual(descriptor.qualityOptions);
expect(videoNode.fields.duration.options).toEqual(videoDescriptor.allowedDurationsSeconds);
```

- [ ] **Step 2：由工作区加载一次目录并注入画布/节点**

```tsx
<InfiniteCanvas taskModelCatalog={taskModelCatalog} catalogStatus={catalogStatus} />
<NodeEditor taskModelCatalog={taskModelCatalog} catalogStatus={catalogStatus} />
```

避免两个大型组件重复请求 `/api/models`，并保持当前请求取消和项目切换生命周期。

- [ ] **Step 3：替换参考图组、融图组和普通生成组推断**

```ts
const descriptor = catalogIndex.get(taskModelKey(group.toolbar.providerId, group.toolbar.model));
const controls = descriptor ? buildGenerationControlsFromDescriptor(descriptor) : unavailableControls;
```

融图仍保持全部参考图语义，参考图组六类约束不变；本任务只改变能力来源。

- [ ] **Step 4：替换节点模式能力推断**

模型字段保存复合键；执行请求继续拆分成 `providerId` 与 `modelId`。切换模型时只重置不支持的值，不清空提示词、参考图或节点连线。

- [ ] **Step 5：运行画布/节点聚焦回归**

```bash
pnpm exec vitest run src/__tests__/components/infinite-canvas-provider-capabilities.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/canvas-group-generation-error-contract.test.ts src/__tests__/components/canvas-group-gesture-contract.test.ts src/__tests__/components/generation-entry-slot-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/components/node-editor-react-flow-v2-integration.test.tsx
pnpm ts-check
```

- [ ] **Step 6：提交画布和节点接入**

```bash
git add src/components/canvas-workspace.tsx src/components/infinite-canvas.tsx src/components/node-editor.tsx src/__tests__/components/infinite-canvas-provider-capabilities.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts
git commit -m "feat: unify canvas and node model capabilities"
```

---

### Task 8：统一视频服务端准入和前端控制

**文件：**
- 修改：`src/app/api/video/generate/route.ts`
- 修改：`src/app/api/video/extend/route.ts`
- 修改：`src/components/video-generation-panel.tsx`
- 修改：`src/__tests__/lib/video-duration-capabilities.test.ts`
- 修改：`src/__tests__/components/video-duration-slider-contract.test.ts`
- 修改：`src/__tests__/api/model-capability-admission.test.ts`

**接口：**
- 消费：统一目录中的 `allowedDurationsSeconds`、`supportedOperations`、`allowedRatios`、`allowedSizes`。

- [ ] **Step 1：写视频非法时长/模式/参考图的任务前 RED**

```ts
expect(await submitVideo({ duration: 30, mode: 'text2video' })).toMatchObject({
  status: 400,
  body: { code: 'MODEL_CAPABILITY_MISMATCH', details: { field: 'duration', allowed: [5, 10, 15] } },
});
expect(mocks.createBillableTask).not.toHaveBeenCalled();
expect(mocks.buildVideoSubmitRequest).not.toHaveBeenCalled();
```

- [ ] **Step 2：在查到精确供应商后、任务/扣费前统一校验**

```ts
const descriptor = await resolveTaskModelForUser(provider.id, pureModel, authResult.user);
const admission = validateTaskModelSelection(descriptor, {
  operation: toSupportedVideoOperation(mode, imageUrl, lastFrameImageUrl, referenceImages),
  aspectRatio,
  size: resolution,
  durationSeconds: parsedDuration,
  referenceImageCount: referenceImages?.length || 0,
});
if (!admission.ok) return modelCapabilityErrorResponse(admission.error, requestId);
```

视频延长路由必须要求 `video-extend`，不能只检查模型名或最大时长。

- [ ] **Step 3：视频面板从目录生成控制项**

```ts
const currentDescriptor = descriptorsByKey.get(taskModelKey(currentModel.providerId, currentModel.modelId));
const availableDurations = currentDescriptor?.allowedDurationsSeconds ?? [];
const availableRatios = currentDescriptor?.allowedRatios ?? [];
const availableResolutions = currentDescriptor?.allowedSizes ?? [];
const modeOptions = buildVideoModes(currentDescriptor?.supportedOperations ?? []);
```

保留当前离散滑轨；滑轨索引必须来自 `availableDurations`，平台 15 秒上限作为服务端 fallback/管理员上限，不覆盖更小的供应商上限。

- [ ] **Step 4：运行视频回归**

```bash
pnpm exec vitest run src/__tests__/api/model-capability-admission.test.ts src/__tests__/lib/video-duration-capabilities.test.ts src/__tests__/components/video-duration-slider-contract.test.ts src/__tests__/api/video-task-durability-contract.test.ts src/__tests__/api/video-tools-auth-contract.test.ts src/__tests__/api/poll-task-video-terminal-contract.test.ts src/__tests__/lib/video-task-polling.test.ts
pnpm ts-check
```

- [ ] **Step 5：提交视频统一**

```bash
git add src/app/api/video/generate/route.ts src/app/api/video/extend/route.ts src/components/video-generation-panel.tsx src/__tests__/api/model-capability-admission.test.ts src/__tests__/lib/video-duration-capabilities.test.ts src/__tests__/components/video-duration-slider-contract.test.ts
git commit -m "fix: enforce video model capability catalog"
```

---

### Task 9：增加管理员结构化模型能力编辑器

**文件：**
- 新建：`src/components/dashboard/model-capability-editor.tsx`
- 修改：`src/components/third-party-model-dialog.tsx`
- 修改：`src/app/api/admin/apis/route.ts`
- 新建：`src/__tests__/components/model-capability-editor.test.tsx`
- 新建：`src/__tests__/api/admin-api-provider-capabilities.test.ts`

**接口：**
- 消费：`ProviderCapabilityOverridesV1`、严格字段解析器和供应商已选模型。
- 产出：规范化 v1 JSON 字符串写入 `advancedParams.taskModelCapabilities`。

- [ ] **Step 1：写图像/视频表单和保留其他高级参数 RED**

```tsx
await selectCapabilityModel('gpt-image-2');
await chooseRatios(['1:1', '16:9']);
await setMaxOutputs(4);
await saveProvider();
expect(updatePayload.advancedParams).toMatchObject({
  compatProfile: 'pearapi',
  taskModelCapabilities: JSON.stringify({
    version: 1,
    models: { 'gpt-image-2': expect.objectContaining({ allowedRatios: ['1:1', '16:9'], maxOutputs: 4 }) },
  }),
});
```

- [ ] **Step 2：实现类型相关控件**

图像显示比例、尺寸、质量、数量、参考图、参考图数量、蒙版和输出格式；视频显示比例、分辨率、离散时长、最大时长和操作模式。使用多选、复选框和数字输入，不提供自由 JSON 文本框。

- [ ] **Step 3：保留历史高级参数但保护系统键**

```ts
const visibleAdvancedParams = Object.fromEntries(
  Object.entries(formAdvancedParams).filter(([key]) => key !== 'taskModelCapabilities'),
);
```

结构化编辑器是该键唯一写入者；删除某模型覆盖只删除 `models[modelId]`，不影响其他模型。

- [ ] **Step 4：管理员 API 在持久化前严格解析**

非法能力返回 HTTP 400 和 `INVALID_MODEL_CAPABILITIES`，不保存部分对象；未修改 API Key 的更新继续保留旧密钥。

- [ ] **Step 5：运行管理员回归**

```bash
pnpm exec vitest run src/__tests__/components/model-capability-editor.test.tsx src/__tests__/api/admin-api-provider-capabilities.test.ts src/__tests__/lib/server-api-config-model-capabilities.test.ts
pnpm ts-check
```

- [ ] **Step 6：提交管理员能力编辑器**

```bash
git add src/components/dashboard/model-capability-editor.tsx src/components/third-party-model-dialog.tsx src/app/api/admin/apis/route.ts src/__tests__/components/model-capability-editor.test.tsx src/__tests__/api/admin-api-provider-capabilities.test.ts
git commit -m "feat: add structured model capability editor"
```

---

### Task 10：统一 Agent、工作流和所有剩余消费端合同

**文件：**
- 新建：`src/lib/agent-runtime/model-capability-set.ts`
- 修改：`src/lib/agent-runtime/admission-gate.ts`
- 修改：`src/lib/agent-runtime/service.ts`
- 修改：`src/lib/agent-runtime/same-task-adapter.ts`
- 修改：`src/__tests__/lib/api-compatibility.test.ts`
- 修改：`src/__tests__/lib/video-model-inference.test.ts`
- 测试：`src/__tests__/components/model-capability-consumers.test.tsx`
- 测试：`src/__tests__/lib/agent-runtime-admission-gate.test.ts`
- 测试：`src/__tests__/lib/agent-runtime-tools.test.ts`
- 测试：`src/__tests__/lib/agent-runtime-same-task-adapter.test.ts`

**接口：**
- 目标：仓库中业务组件不再直接导入图像/视频能力推断函数。

- [ ] **Step 1：建立禁止旧消费方式的 RED 合同**

```ts
for (const file of CAPABILITY_UI_CONSUMERS) {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  expect(source).not.toMatch(/getProviderAspectRatios|getQualityLevelOptions|getResolutionTierOptions|getVideoModelInfo/);
  expect(source).toMatch(/taskModelCatalog|useTaskModelCatalog/);
}
```

服务端 fallback 文件和精确适配器允许继续导入旧模型族表；业务 UI 与任务路由不允许。

- [ ] **Step 2：让 Agent 工具准入只使用统一描述**

```ts
export function toAgentModelCapabilitySet(model: TaskModelDescriptor): Set<string> {
  const capabilities = new Set<string>([model.kind]);
  if (model.supportsReferenceImages) capabilities.add('reference-images');
  if (model.supportsMask) capabilities.add('edit');
  for (const operation of model.supportedOperations || []) capabilities.add(operation);
  return capabilities;
}
```

- [ ] **Step 3：扫描并接入剩余能力控件**

运行：

```bash
rg -n "getProviderAspectRatios|getQualityLevelOptions|getResolutionTierOptions|getVideoModelInfo" src/components src/app/api
```

预期剩余命中只位于明确允许的服务端 fallback/适配层；每个业务组件命中必须迁移或在计划报告中证明它不暴露能力参数。

- [ ] **Step 4：运行 Agent、工作流和消费端回归**

```bash
pnpm exec vitest run src/__tests__/components/model-capability-consumers.test.tsx src/__tests__/lib/agent-runtime-admission-gate.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/lib/agent-runtime-same-task-adapter.test.ts src/__tests__/api/workflow-models.test.ts src/__tests__/components/node-editor-provider-capabilities.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts
pnpm ts-check
```

- [ ] **Step 5：提交剩余接入**

```bash
git add src/lib/agent-runtime/model-capability-set.ts src/lib/agent-runtime/admission-gate.ts src/lib/agent-runtime/service.ts src/lib/agent-runtime/same-task-adapter.ts src/__tests__/components/model-capability-consumers.test.tsx src/__tests__/lib/agent-runtime-admission-gate.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/lib/agent-runtime-same-task-adapter.test.ts src/__tests__/lib/api-compatibility.test.ts src/__tests__/lib/video-model-inference.test.ts src/__tests__/api/workflow-models.test.ts
git diff --cached --name-only
git commit -m "refactor: remove split model capability inference"
```

提交前必须检查暂存清单，移除与本任务无关的文件；禁止使用 `git add -A`。

---

### Task 11：本地全量门禁、PostgreSQL 往返和跨浏览器 E2E

**文件：**
- 新建：`tests/e2e/v588-provider-005-capabilities.spec.ts`
- 新建：`src/__tests__/lib/server-api-config-model-capabilities-postgres.test.ts`
- 修改：`docs/testing/BUG_REGISTER.md`
- 修改：`docs/testing/REGRESSION_REPORT.md`
- 修改：`docs/testing/UNVERIFIED_ITEMS.md`
- 修改：`docs/testing/RELEASE_READINESS_REPORT.md`
- 修改：`docs/plans/v588/V588_ABSORPTION_INVENTORY.md`

**接口：**
- 产出：可重放本地证据和精确未验证项，不伪造供应商成功。

- [ ] **Step 1：编写浏览器目录/控制项 E2E**

```ts
test('same model id keeps provider-specific image controls', async ({ page }) => {
  await loginControlledUser(page);
  await openGenerationPanel(page);
  await selectExactModel(page, 'pear', 'gpt-image-2');
  await expectCapabilityOptions(page, pearExpected);
  await selectExactModel(page, 'provider-302', 'gpt-image-2');
  await expectCapabilityOptions(page, provider302Expected);
});
```

同一套测试覆盖生成面板、参考图组、融图组、节点和视频面板，并在失败时保留 screenshot/video/trace/Console/Network。

- [ ] **Step 2：运行真实隔离 PostgreSQL 往返**

设置一次性 `POSTGRES_TEST_DATABASE_URL`，执行：

```bash
pnpm exec vitest run src/__tests__/lib/server-api-config-model-capabilities-postgres.test.ts --reporter=verbose
```

预期：管理员能力保存、重读、并发更新和其他高级参数保留全部通过；若数据库不可用，记录为未验证并停止发布，不得跳过后继续云端。

- [ ] **Step 3：运行完整本地门禁**

```bash
pnpm doctor
pnpm ts-check
pnpm lint
pnpm test
pnpm test:api
pnpm test:regression
pnpm build
pnpm check:protected-baseline
git diff --check
```

预期：全部命令退出 0；ESLint error 为 0，历史 warning 数只能持平或下降；保护清单如因新路径失败，必须按真实功能范围审核后单独更新，不能静默放宽。

- [ ] **Step 4：运行本地多浏览器 E2E**

```bash
pnpm exec playwright test tests/e2e/v588-provider-005-capabilities.spec.ts --project=chromium --project=firefox --project=webkit
```

预期：目录、控件和非法请求拒绝均通过；真实付费生成只在具备隔离凭据时运行，否则明确跳过并保留到 Coze。

- [ ] **Step 5：更新中文测试报告并提交**

```bash
git add tests/e2e/v588-provider-005-capabilities.spec.ts src/__tests__/lib/server-api-config-model-capabilities-postgres.test.ts docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/RELEASE_READINESS_REPORT.md docs/plans/v588/V588_ABSORPTION_INVENTORY.md
git commit -m "test: verify unified provider capabilities"
```

---

### Task 12：独立复审、推送 main、Coze exact-SHA 和真实付费验收

**文件：**
- 新建：`docs/testing/evidence/v588-provider-005-coze-2026-08-24.json`
- 新建：`docs/testing/evidence/v588-provider-005-coze-2026-08-24-console.json`
- 新建：`docs/testing/evidence/v588-provider-005-coze-2026-08-24-network.json`
- 新建：`docs/testing/evidence/v588-provider-005-coze-2026-08-24-screenshot.png`
- 新建：`docs/testing/evidence/v588-provider-005-coze-2026-08-24-trace.zip`
- 修改：Task 11 的中文测试报告与 V5.8.8 吸收清单。
- 修改：`F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`
- 修改：`F:/AIGC/vault-template/无界计划/16-V5.8.8选择性吸收.md`

**接口：**
- 产出：精确 SHA 的本地、GitHub、Coze、Google Chrome 和账务闭环。

- [ ] **Step 1：执行最终差异和分支保护审计**

```bash
git status --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- src/lib/task-core src/app/api/models src/app/api/generate src/app/api/video src/components/generation-panel.tsx src/components/infinite-canvas.tsx src/components/node-editor.tsx src/components/video-generation-panel.tsx
git rev-parse origin/stable
```

预期：`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`；donor 无修改；没有凭据、运行数据或无关文件进入差异。

- [ ] **Step 2：普通快进推送 main**

```bash
git fetch origin
git rebase origin/main
git push origin HEAD:main
```

禁止 force push。记录推送后的精确 SHA。

- [ ] **Step 3：在现有 Google Chrome Coze 项目页拉取精确 SHA**

检查项目页沙箱状态；若断开，点击现有页面的恢复/刷新，等待服务运行。拉取 `main` 后核对 `git rev-parse HEAD` 与 GitHub 精确 SHA，完成构建和端口 5000 健康检查，再强制刷新现有预览页。

- [ ] **Step 4：管理员真实持久化验收**

在管理员供应商页选择一个图像模型和一个视频模型，修改一个非破坏性能力字段，保存、刷新并重启沙箱后确认值保持。恢复原值并再次确认。不得修改 API Key 或删除供应商。

- [ ] **Step 5：普通用户目录和五个入口验收**

使用当前 Chrome 登录账号逐项验证：

1. 图像生成面板。
2. 参考图组。
3. 融图组。
4. 节点模式。
5. 视频生成面板。

每项记录选中精确模型对、可见比例/尺寸/质量/数量/时长/模式、提交载荷、HTTP 状态、Console 和 Network。

- [ ] **Step 6：真实合法与非法链路验收**

合法链路至少完成一张图像和一个视频，验证供应商、模型、结果、任务终态和积分只发生一次。非法能力请求通过浏览器 DevTools 或受控测试入口提交，必须在供应商任务和扣费前返回 `MODEL_CAPABILITY_MISMATCH`。

- [ ] **Step 7：稳定部署域名复验与证据提交**

沙箱通过后，在稳定部署域名完成目录加载、图像生成和一次刷新恢复冒烟。保存机器可读 JSON、截图、Trace、Console、Network 和积分前后值；更新中文报告、吸收清单和 Obsidian 阶段看板。

```bash
git add docs/testing/evidence/v588-provider-005-coze-2026-08-24.json docs/testing/evidence/v588-provider-005-coze-2026-08-24-console.json docs/testing/evidence/v588-provider-005-coze-2026-08-24-network.json docs/testing/evidence/v588-provider-005-coze-2026-08-24-screenshot.png docs/testing/evidence/v588-provider-005-coze-2026-08-24-trace.zip docs/testing/BUG_REGISTER.md docs/testing/REGRESSION_REPORT.md docs/testing/UNVERIFIED_ITEMS.md docs/testing/RELEASE_READINESS_REPORT.md docs/plans/v588/V588_ABSORPTION_INVENTORY.md
git commit -m "docs: record provider capability cloud acceptance"
git push origin HEAD:main
```

只有上述证据全部存在且 P0/P1 为零，才能把 `V588-PROVIDER-005` 标记为“已吸收 / 云端验证通过”。

# Lovart 第二批内容与商品工作流实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变既有 24/16 项 Skills 的前提下，交付 YouTube/B站缩略图、Pinterest 图钉和 CSV/JSON 批量 SKU 商品素材三个可持久运行、逐项回图和精确结算的工作流。

**Architecture:** 第二批定义放入独立目录文件，通过通用步骤条件和数据集扇出编译器产生不可变执行步骤，再复用现有 Skill Runtime 的模型冻结、operation、账务、AssetVersion、恢复与事件投影。CSV/JSON 只在统一数据集控件转换为结构化行，服务端仍执行完整验证；执行器中禁止出现三个新 Skill ID 的特判。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、Playwright、PostgreSQL 18、Papa Parse、现有 Agent/Skill Runtime。

## Global Constraints

- 权威起点为 `main@1c5e9186c8c1540357eb7e94bfb230bd2b3ec2ab`。
- 只修改 `main`；不得触碰 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- 不修改或重新执行 Stage4、Task12、第一批 Lovart Task 1-6 和既有 24/16 项 Skill 的业务合同。
- 三项新 Skill 只进入 Canvas 和 Workflow；独立 Simple Chat 保持 16 项隔离目录。
- 不增加底部工具栏入口，不创建第二套任务、供应商、积分或资产状态机。
- 不使用本地 GPU；只调用管理员配置的远程模型。
- 所有输出创建新的 AssetVersion，不覆盖来源版本。
- 每项先 RED、再最小实现、再聚焦和全量回归；无法云端验证的内容必须进入 `UNVERIFIED_ITEMS.md`。

---

## 文件结构

- Create: `src/lib/skill-runtime/content-commerce-presets.ts`：第二批三个 Skill 的静态定义。
- Create: `src/lib/skill-runtime/step-compiler.ts`：通用条件过滤和数据集扇出编译。
- Create: `src/lib/skill-runtime/dataset-schema.ts`：SKU 行规范化与错误码。
- Create: `src/components/skill-runtime/dataset-file-parser.ts`：CSV/JSON 文件解析，不访问业务状态。
- Modify: `src/lib/skill-runtime/types.ts`：声明式 `when`、`fanOut` 和数据集字段限制。
- Modify: `src/lib/skill-runtime/catalog.ts`：组合第二批目录，不改旧定义。
- Modify: `src/lib/skill-runtime/input-resolver.ts`：执行每个定义自己的数据集上限和校验器。
- Modify: `src/components/skill-runtime/SkillInputFields.tsx`：文件导入、预览和错误显示。
- Modify: `src/lib/skill-runtime/run-request.ts`：创建 Run 前编译执行步骤。
- Modify: `src/lib/skill-runtime/cost-estimator.ts`：按编译后的真实步骤估价。
- Modify: `src/lib/skill-runtime/executor.ts`：执行编译后的稳定步骤 ID。
- Modify: `src/lib/skill-runtime/continuation.ts`、`service.ts`、`storage.ts`：冻结、读取和恢复扩展字段。
- Modify: `src/lib/skill-runtime/execution-context.ts`：扇出行提示词上下文。
- Modify: `package.json`、`pnpm-lock.yaml`：直接依赖 `papaparse` 与类型。
- Tests: 新增定义、编译器、SKU 数据、CSV/JSON、执行与 PostgreSQL 回归，并扩展现有目录、组件和 E2E。

---

### Task 1: 锁定第二批目录定义与零丢失保护

**Files:**
- Create: `src/lib/skill-runtime/content-commerce-presets.ts`
- Create: `src/__tests__/lib/skill-runtime-content-commerce-presets.test.ts`
- Modify: `src/lib/skill-runtime/catalog.ts`
- Modify: `src/__tests__/lib/skill-runtime-catalog.test.ts`
- Modify: `src/__tests__/scripts/skill-runtime-inventory.test.ts`

**Interfaces:**
- Produces: `LOVART_CONTENT_COMMERCE_SKILLS: readonly SkillDefinition[]`。
- Preserves: 既有 `CANVAS_PRESET_SKILLS` 和 `LOVART_MARKETING_SKILLS` 的 ID、顺序与定义摘要。

- [x] **Step 1: 写目录失败测试**

```ts
expect(LOVART_CONTENT_COMMERCE_SKILLS.map(skill => skill.id)).toEqual([
  'preset-video-platform-thumbnails',
  'preset-pinterest-pins',
  'preset-batch-sku-assets',
]);
expect(listSkillsForSurface('canvas')).toHaveLength(27);
expect(listSkillsForSurface('workflow')).toHaveLength(27);
expect(listSkillsForSurface('simple-chat')).toHaveLength(16);
expect(listSkillsForSurface('simple-chat').map(skill => skill.id))
  .not.toEqual(expect.arrayContaining(LOVART_CONTENT_COMMERCE_SKILLS.map(skill => skill.id)));
```

同时保存当前 24 项的定义摘要并断言完全不变。

- [x] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-content-commerce-presets.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/skill-runtime-inventory.test.ts`
Expected: 新模块或三项 ID 不存在而 FAIL；旧保护断言 PASS。

- [x] **Step 3: 实现最小静态定义**

```ts
export const LOVART_CONTENT_COMMERCE_SKILLS: readonly SkillDefinition[] = [
  definition({
    id: 'preset-video-platform-thumbnails',
    name: 'YouTube/B站缩略图',
    category: 'marketing',
    inputs: [
      sourceImages(6), requiredText('videoTitle', '视频标题'),
      requiredText('subject', '主体'), requiredText('audience', '目标观众'),
      requiredText('hook', '点击动机'),
      optionalText('brandTone', '品牌调性', '醒目、清晰、可信'),
      optionalText('headline', '封面短文案', '由编排步骤提出'),
      optionalBoolean('faceEmphasis', '突出人物表情', false),
      optionalText('negativeConstraints', '禁止内容', '禁止水印、乱码和无关文字'),
    ],
    steps: [
      chatStep('thumbnail-plan', '制定缩略图方案', '为{{videoTitle}}规划平台差异、短标题和视觉层级。'),
      imageStep('youtube-thumbnail', 'YouTube 缩略图', '生成16:9 YouTube封面，主体{{subject}}，受众{{audience}}，动机{{hook}}。'),
      imageStep('bilibili-thumbnail', 'B站缩略图', '生成16:9 B站封面，主体{{subject}}，受众{{audience}}，动机{{hook}}。'),
    ],
  }),
  definition({
    id: 'preset-pinterest-pins',
    name: 'Pinterest 图钉',
    category: 'marketing',
    inputs: [
      sourceImages(6), requiredText('topic', '内容主题'),
      requiredText('audience', '目标受众'),
      requiredSelect('goal', '目标', ['收藏', '访问', '购买', '品牌认知'], '收藏'),
      optionalText('style', '视觉风格', '编辑感、可收藏、层级清晰'),
      optionalText('callToAction', '行动号召', '不得虚构优惠或稀缺信息'),
      requiredSelect('seriesCount', '图钉数量', ['2', '3'], '3'),
      optionalText('negativeConstraints', '禁止内容', '禁止水印、乱码和无关文字'),
    ],
    steps: [
      chatStep('pin-plan', '制定图钉系列方案', '为{{topic}}规划内容支柱、视觉连续性和行动路径。'),
      imageStep('pin-hero', '主图钉', '生成2:3主图钉，目标{{goal}}，风格{{style}}。'),
      imageStep('pin-detail', '细节图钉', '生成2:3细节或步骤型图钉，面向{{audience}}。'),
      { ...imageStep('pin-conversion', '转化图钉', '生成2:3转化图钉，行动号召{{callToAction}}。'), when: { input: 'seriesCount', includes: ['3'] } },
    ],
  }),
  definition({
    id: 'preset-batch-sku-assets',
    name: '批量 SKU 商品素材',
    category: 'commerce',
    inputs: [
      sourceImages(6),
      requiredDataset('rows', 'SKU 数据', { maximumItems: 20, datasetSchema: 'sku-v1' }),
      requiredSelect('platform', '平台', ['通用电商', '淘宝/天猫', '京东', 'Amazon'], '通用电商'),
      requiredSelect('assetType', '素材类型', ['主图', '卖点图', '场景图'], '主图'),
      requiredSelect('aspectRatio', '生成比例', ['1:1', '4:5', '3:4'], '1:1'),
      optionalText('brandTone', '品牌调性', '沿用来源图片和品牌信息'),
      optionalText('negativeConstraints', '禁止内容', '禁止虚构参数、优惠、认证、销量和评价'),
    ],
    steps: [
      chatStep('sku-plan', '检查批次规则', '检查{{platform}}商品数据完整性，不补造商品事实。'),
      {
        ...imageStep('sku-creative', 'SKU 商品素材', '为{{sku.name}}（{{sku.sku}}，{{sku.variant}}）生成{{assetType}}，卖点{{sku.sellingPoints}}，比例{{aspectRatio}}。'),
        fanOut: { inputKey: 'rows', itemAlias: 'sku', keyField: 'sku', maximumItems: 20, concurrency: 3 },
      },
    ],
  }),
];
```

`catalog.ts` 只追加数组：

```ts
export const CANVAS_WORKFLOW_SKILLS = [
  ...CANVAS_PRESET_SKILLS,
  ...LOVART_MARKETING_SKILLS,
  ...LOVART_CONTENT_COMMERCE_SKILLS,
] as const;
```

- [x] **Step 4: 运行定义回归**

Run: 与 Step 2 相同。
Expected: 3 个文件全 PASS，Canvas/Workflow 27，Simple Chat 16。

- [x] **Step 5: 提交**

```bash
git add src/lib/skill-runtime/content-commerce-presets.ts src/lib/skill-runtime/catalog.ts src/__tests__/lib/skill-runtime-content-commerce-presets.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/skill-runtime-inventory.test.ts
git commit -m "feat: define second Lovart workflow batch"
```

---

### Task 2: 增加通用条件步骤编译

**Files:**
- Create: `src/lib/skill-runtime/step-compiler.ts`
- Create: `src/__tests__/lib/skill-runtime-step-compiler.test.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/content-commerce-presets.ts`
- Modify: `src/lib/skill-runtime/cost-estimator.ts`
- Modify: `src/lib/skill-runtime/run-request.ts`
- Modify: `src/lib/skill-runtime/continuation.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/skill-runtime/storage.ts`

**Interfaces:**
- Produces: `SkillStepCondition`、`compileSkillExecutionPlan(definition, inputs)`。
- Returns: `{ steps: SkillStepDefinition[]; skippedStepIds: string[] }`。

- [x] **Step 1: 写条件编译 RED 测试**

```ts
const plan2 = compileSkillExecutionPlan(pinterest, { seriesCount: '2' });
expect(plan2.steps.map(step => step.id)).toEqual(['pin-plan', 'pin-hero', 'pin-detail']);
expect(plan2.skippedStepIds).toEqual(['pin-conversion']);

const plan3 = compileSkillExecutionPlan(pinterest, { seriesCount: '3' });
expect(plan3.steps.map(step => step.id)).toEqual([
  'pin-plan', 'pin-hero', 'pin-detail', 'pin-conversion',
]);
expect(plan3.skippedStepIds).toEqual([]);
```

再断言未知 input、空 includes、非 select/multi-select 字段和空执行计划抛出 `SKILL_STEP_CONDITION_INVALID`。

- [x] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-step-compiler.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts`
Expected: 编译器缺失而 FAIL。

- [x] **Step 3: 增加声明式类型和纯编译器**

```ts
export interface SkillStepCondition {
  input: string;
  includes: readonly (string | number | boolean)[];
}

export interface SkillStepDefinition {
  // existing fields
  when?: SkillStepCondition;
  fanOut?: SkillStepFanOut;
}
```

`compileSkillExecutionPlan` 必须纯函数、保持原顺序、不修改输入，并在编译结果中移除 `when`。报价和 Run 创建使用同一编译结果，禁止分别实现条件判断。

- [x] **Step 4: 冻结与恢复扩展字段**

在 `storage.ts`、`continuation.ts`、`service.ts` 的严格解析器中显式复制并验证 `when`，拒绝未知形状，不使用类型断言绕过验证。Run 创建事件记录 `skippedStepIds`，不为跳过项建立 operation。

- [x] **Step 5: 运行条件步骤回归并提交**

Run: Step 2 命令，加 `src/__tests__/lib/skill-runtime-continuation.test.ts src/__tests__/lib/skill-runtime-storage.test.ts`。
Expected: seriesCount 2/3 的报价和冻结步骤一致，旧 Skill 结果不变。

Commit: `feat: compile conditional skill steps`

---

### Task 3: 增加安全 CSV/JSON 数据集导入

**Files:**
- Create: `src/components/skill-runtime/dataset-file-parser.ts`
- Create: `src/__tests__/components/skill-dataset-file-parser.test.ts`
- Modify: `src/components/skill-runtime/SkillInputFields.tsx`
- Modify: `src/__tests__/components/skill-runtime-controls.test.tsx`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `parseSkillDatasetFile(file: File): Promise<readonly Record<string, unknown>[]>`。
- Consumes: `.json` 或 `.csv`，最大 512 KiB。

- [x] **Step 1: 安装直接依赖并写失败测试**

Run: `pnpm add papaparse && pnpm add -D @types/papaparse`

测试固定：UTF-8 BOM、引号内逗号、CRLF、多行字段、空行、重复表头、公式前缀、未知扩展名、超大文件和非法 JSON。

```ts
await expect(parseSkillDatasetFile(csvFile('sku,name\nA-1,"耳机, 黑色"')))
  .resolves.toEqual([{ sku: 'A-1', name: '耳机, 黑色' }]);
await expect(parseSkillDatasetFile(csvFile('sku,name\n=cmd,危险')))
  .rejects.toMatchObject({ code: 'SKILL_DATASET_FORMULA_VALUE' });
```

- [x] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/skill-dataset-file-parser.test.ts src/__tests__/components/skill-runtime-controls.test.tsx`
Expected: 解析模块和导入控件不存在而 FAIL。

- [x] **Step 3: 实现独立解析器**

```ts
export async function parseSkillDatasetFile(
  file: File,
): Promise<readonly Record<string, unknown>[]> {
  assertDatasetFile(file);
  const text = await file.text();
  return file.name.toLowerCase().endsWith('.json')
    ? parseJsonRows(text)
    : parseCsvRowsWithPapa(text);
}
```

Papa Parse 必须启用 `header: true`、`skipEmptyLines: 'greedy'`，并把任何 parser error 转为稳定中文错误。不得使用 `split(',')`。

- [x] **Step 4: 扩展统一数据集控件**

在 `dataset` 分支增加隐藏文件输入和带上传图标的命令按钮，`accept=".csv,.json"`；解析后调用现有 `commitValue`。显示总行数、前 5 行表格和字段错误，保证 375px 下横向表格在自身区域滚动，不改变画布缩放。

- [x] **Step 5: 运行组件回归并提交**

Run: Step 2 命令。
Expected: 所有解析边界和既有八类输入控件通过。

Commit: `feat: import skill datasets from csv and json`

---

### Task 4: 锁定 SKU 行服务端合同

**Files:**
- Create: `src/lib/skill-runtime/dataset-schema.ts`
- Create: `src/__tests__/lib/skill-runtime-dataset-schema.test.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/input-resolver.ts`
- Modify: `src/__tests__/lib/skill-runtime-inputs.test.ts`
- Modify: `src/lib/skill-runtime/content-commerce-presets.ts`

**Interfaces:**
- Produces: `normalizeSkuDataset(value, authorizedSourceVersionIds)`。
- Returns: `readonly NormalizedSkuRow[]`，保持输入顺序。

- [x] **Step 1: 写严格合同 RED 测试**

```ts
expect(normalizeSkuDataset([
  { sku: ' A-1 ', name: ' 黑色耳机 ', sellingPoints: '降噪' },
], ['version-1'])).toEqual([
  { sku: 'A-1', name: '黑色耳机', sellingPoints: '降噪' },
]);
```

覆盖：1–20 行、SKU 唯一、字段白名单、各字段长度、有限 JSON 值、公式前缀、保留键和序列化 512 KiB。整批只使用顶层已授权来源图片，行数据不得重新声明来源版本。

- [x] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-dataset-schema.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts`
Expected: 新规范化函数不存在而 FAIL。

- [x] **Step 3: 实现字段级校验器**

```ts
export interface NormalizedSkuRow {
  sku: string;
  name: string;
  sellingPoints?: string;
  variant?: string;
  headline?: string;
}
```

`SkillInputField` 增加可选 `datasetSchema: 'sku-v1'`。`resolveSkillInputs` 对 `dataset` 使用 `field.maximumItems`，并在 `sku-v1` 时调用规范化器；未知 schema 返回 `SKILL_INPUT_INVALID_DEFINITION`。

- [x] **Step 4: 运行服务端输入回归并提交**

Run: Step 2 命令，加 `src/__tests__/lib/skill-runtime-content-commerce-presets.test.ts`。
Expected: 所有非法数据在报价/任务创建前失败，合法行顺序稳定。

Commit: `feat: validate batch sku skill inputs`

---

### Task 5: 实现通用数据集扇出与精确报价

**Files:**
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/step-compiler.ts`
- Modify: `src/lib/skill-runtime/execution-context.ts`
- Modify: `src/lib/skill-runtime/cost-estimator.ts`
- Modify: `src/lib/skill-runtime/run-request.ts`
- Modify: `src/lib/skill-runtime/content-commerce-presets.ts`
- Modify: `src/__tests__/lib/skill-runtime-step-compiler.test.ts`
- Create: `src/__tests__/lib/skill-runtime-batch-cost.test.ts`

**Interfaces:**
- Produces: `SkillStepFanOut` 和稳定子步骤 ID `baseId:<rowDigest>`。
- Invariant: 同一规范化输入永远产生同序、同 ID、同报价的执行计划。

- [x] **Step 1: 写扇出与报价 RED 测试**

```ts
const plan = compileSkillExecutionPlan(batchSkuSkill, {
  rows: [{ sku: 'A-1', name: '黑色' }, { sku: 'B-2', name: '白色' }],
});
expect(plan.steps.map(step => step.id)).toEqual([
  'sku-plan',
  expect.stringMatching(/^sku-creative:[a-f0-9]{16}$/),
  expect.stringMatching(/^sku-creative:[a-f0-9]{16}$/),
]);
expect(estimate.steps).toHaveLength(3);
```

断言改变行顺序会改变执行顺序但不改变各行摘要；重复 key、超过 maximumItems、非法并发和模板缺少 itemAlias 被拒绝。

- [x] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-step-compiler.test.ts src/__tests__/lib/skill-runtime-batch-cost.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts`
Expected: fanOut 缺失而 FAIL。

- [x] **Step 3: 编译成不可变具体步骤**

```ts
export interface SkillStepFanOut {
  inputKey: string;
  itemAlias: string;
  keyField: string;
  maximumItems: number;
  concurrency: number;
}
```

使用现有规范化 JSON 摘要工具计算 16 位行摘要。编译后的具体步骤删除 `fanOut`，把 `{{sku.*}}` 只替换一次为该行规范值，并把同批子步骤放入稳定 `parallelGroup`。全局 `{{product}}` 等占位符留给现有提示词编译器。

- [x] **Step 4: 报价和 Run 使用同一计划**

`estimateSkillRunCost` 接收已解析 inputs 或 `CompiledSkillExecutionPlan`，禁止再次独立展开。`createSkillRun` 在冻结模型和预扣前持久化 `executionSteps`、`skippedStepIds` 和计划摘要；摘要参与请求幂等冲突检测。

实现说明：报价与 Run 快照统一调用同一纯编译器，并在 `run.created` 冻结具体步骤；请求幂等继续使用既有的 `skillVersion + 规范化 inputValues + 模型绑定` 摘要。未另改摘要格式，避免升级前已接收的在途运行在重试时产生身份冲突；条件未命中的步骤不进入冻结计划，因此不创建 operation。

- [x] **Step 5: 运行扇出回归并提交**

Run: Step 2 命令，加 `src/__tests__/lib/skill-runtime-run-request.test.ts`。
Expected: 1、2、20 行报价与实际步骤数一致；21 行在报价前拒绝。

Commit: `feat: compile dataset fanout skill steps`

---

### Task 6: 持久执行、逐项回图、失败重试和取消结算

**Files:**
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/skill-runtime/continuation.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Modify: `src/lib/skill-runtime/quality-gates.ts`
- Modify: `src/__tests__/lib/skill-runtime-executor.test.ts`
- Create: `src/__tests__/lib/skill-content-commerce-execution.test.ts`
- Modify: `src/__tests__/lib/skill-runtime-step-registry.test.ts`
- Modify: `src/__tests__/lib/skill-runtime-quality.test.ts`

**Interfaces:**
- Consumes: Task 5 的具体 `executionSteps`。
- Produces: 每个扇出步骤独立 operation、事件、AssetVersion、attempt 和结算。

- [ ] **Step 1: 写逐项执行 RED 测试**

构造三行批次，让第 2 行第一次失败：

```ts
expect(events.filter(event => event.type === 'asset.created')).toHaveLength(2);
expect(run.status).toBe('paused');
await retrySkillStep({ runId, stepId: secondStepId });
expect(callsByStep.get(firstStepId)).toBe(1);
expect(callsByStep.get(secondStepId)).toBe(2);
expect(callsByStep.get(thirdStepId)).toBe(1);
expect(uniqueAssetVersionIds).toHaveLength(3);
```

再覆盖取消时已完成项不退款、未完成项退款一次、重复取消不新增退款、迟到成功被拒绝。

- [ ] **Step 2: 运行并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-content-commerce-execution.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/skill-runtime-step-registry.test.ts`
Expected: 动态步骤恢复或逐项结算断言 FAIL。

- [ ] **Step 3: 复用现有 operation 执行**

不得为 SKU 新建状态机。让 executor 按冻结具体步骤运行；`step.id` 自然进入现有 `skillStepRequestDigest`、operation key、事件 ID 和 AssetVersion 来源追踪。并发度由编译后的平行组分片控制，每片最多 3 项，前一片全部终态后进入下一片。

- [ ] **Step 4: 恢复和重试精确读取冻结步骤**

`loadPersistedSkillContinuation` 只读取 Run 创建时的 `executionSteps`，不得按后来修改的 CSV 或最新 Skill 定义重新扇出。`retrySkillStep` 只接受冻结步骤 ID，成功步骤返回 409，未知或不同 Run 的 ID 返回 404/403。

- [ ] **Step 5: 增加宽高与比例质量门禁**

```ts
'image-dimensions-known': result => result.media.every(media => (
  Number.isInteger(media.width) && Number.isInteger(media.height)
)),
'aspect-ratio-match': (result, context) => matchesRatioWithinOnePercent(result, context),
```

扩展 `SkillResultMedia` 和 `SkillQualityContext` 的明确字段；媒体元数据读取失败使该步骤质量失败，但不得改写已成功的供应商任务身份。

- [ ] **Step 6: 运行执行回归并提交**

Run: Step 2 命令，加 `src/__tests__/lib/skill-runtime-quality.test.ts src/__tests__/lib/skill-runtime-continuation.test.ts`。
Expected: 单项回图、恢复、重试、取消和质量门禁全部 PASS。

Commit: `feat: execute batch skill outputs durably`

---

### Task 7: 锁定 Canvas/Workflow 双入口与 Simple Chat 隔离

**Files:**
- Modify: `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`
- Modify: `src/__tests__/components/node-editor-skill-node.test.tsx`
- Modify: `src/__tests__/components/simple-chat-skill-isolation.test.tsx`
- Modify: `src/__tests__/components/skill-runtime-controls.test.tsx`
- Modify: `tests/e2e/skill-runtime-canvas-workflow.spec.ts`

**Interfaces:**
- Consumes: 动态 27 项 Canvas/Workflow 目录。
- Preserves: Simple Chat 16 项、旧 24 项行为和现有工作区入口。

- [ ] **Step 1: 写入口合同 RED 测试**

```ts
for (const id of [
  'preset-video-platform-thumbnails',
  'preset-pinterest-pins',
  'preset-batch-sku-assets',
]) {
  expect(canvasIds).toContain(id);
  expect(workflowIds).toContain(id);
  expect(simpleChatIds).not.toContain(id);
}
```

断言组件源码不静态复制三个 ID，来源版本在 Canvas 与 Workflow 都由服务端授权绑定。

- [ ] **Step 2: 扩展 Chromium E2E**

使用测试数据库与可控供应商夹具：

- Canvas YouTube/B站显示两个逐项结果。
- Workflow Pinterest 计数 2/3 的步骤和报价准确。
- CSV 三行批次逐项显示，刷新后状态与顺序恢复。
- Simple Chat 搜索三个名称均无结果。

- [ ] **Step 3: 运行双入口回归**

Run: `pnpm exec vitest run src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/simple-chat-skill-isolation.test.tsx src/__tests__/components/skill-runtime-controls.test.tsx`
Run: `pnpm exec playwright test tests/e2e/skill-runtime-canvas-workflow.spec.ts --project=chromium`
Expected: 组件和 E2E 全 PASS；没有新底部工具栏按钮。

- [ ] **Step 4: 运行执行器特判扫描并提交**

Run: `rg -n "preset-video-platform-thumbnails|preset-pinterest-pins|preset-batch-sku-assets" src/lib/skill-runtime/executor.ts src/lib/skill-runtime/service.ts src/lib/skill-runtime/step-registry.ts src/lib/skill-runtime/cost-estimator.ts`
Expected: 无匹配。

Commit: `test: cover second Lovart workflows across workspaces`

---

### Task 8: PostgreSQL、全量门禁、Obsidian、推送与云端验收

**Files:**
- Create: `src/__tests__/integration/skill-content-commerce-concurrency-postgres.test.ts`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`

**Interfaces:**
- Produces: 可追溯 `main` 候选、真库证据和 Coze 云端结论。

- [ ] **Step 1: 隔离 PostgreSQL 真并发**

启动一次性 PostgreSQL 18 临时集群，不连接业务库。执行：

```powershell
$env:POSTGRES_TEST_DATABASE_URL=$url
$env:TEST_POSTGRES_URL=$url
pnpm exec vitest run src/__tests__/integration/skill-content-commerce-concurrency-postgres.test.ts
```

至少证明：重复提交一个 Run、每行一个 operation、成功行一次消费、失败/取消行一次退款、迟到结果不覆盖终态、刷新恢复顺序一致。测试结束停止并删除临时集群。

- [ ] **Step 2: 运行聚焦和全量门禁**

```powershell
pnpm exec vitest run src/__tests__/lib/skill-runtime-content-commerce-presets.test.ts src/__tests__/lib/skill-runtime-step-compiler.test.ts src/__tests__/lib/skill-runtime-dataset-schema.test.ts src/__tests__/lib/skill-runtime-batch-cost.test.ts src/__tests__/lib/skill-content-commerce-execution.test.ts src/__tests__/components/skill-dataset-file-parser.test.ts src/__tests__/components/skill-runtime-controls.test.tsx
pnpm ts-check
pnpm lint
pnpm test
pnpm run check:protected-baseline
git diff --check
$env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm build
```

Expected: 所有命令退出 0；记录真实测试、跳过、警告、页面数和 Build ID。

- [ ] **Step 3: 最终审查与保护核对**

核对：旧 24 项摘要零漂移、Simple Chat 16、三个新 Skill 无执行器特判、没有密钥或用户数据、没有未追踪构建产物、`origin/stable` SHA 不变。

- [ ] **Step 4: 更新中文证据与一次 Obsidian 阶段记录**

只有本阶段完成时，向 Obsidian 追加一次权威检查点。测试报告分别记录本地、PostgreSQL、GitHub、Coze 和未验证项，不用窄测试宣称全平台通过。

- [ ] **Step 5: 提交并推送 `main`**

```powershell
git add package.json pnpm-lock.yaml src tests docs
git commit -m "feat: add second Lovart workflow batch"
git push origin main
git fetch origin main stable --quiet
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `HEAD == origin/main`，stable 仍为固定 SHA。

- [ ] **Step 6: Coze 精确部署与真实浏览器验收**

在现有项目标签让 Coze 拉取精确 `main`、核对 tree、类型、保护、构建、Build ID 和唯一服务进程；沙箱重启后强刷现有预览标签，不新建标签。

真实验收：

1. Canvas 使用 APImart/Pear 稳定供应商运行 YouTube/B站缩略图，验证两个成品、两个 AssetVersion、来源保留、计费和刷新恢复。
2. Workflow 运行 Pinterest 三图钉，验证步骤进度、三项结果、继续连线和保存恢复。
3. Canvas 导入三行 CSV，验证逐项回图；在有安全故障注入时只重试失败行。
4. 取消当前归属的批量 Run，证明只退款未完成项一次，等待迟到窗口确认终态不回写。
5. 检查 Simple Chat 仍为 16 Skills，Console、Network、事件、AssetVersion 和积分流水留证。

- [ ] **Step 7: 形成阶段结论**

只有本地、真库和云端核心链路有真实证据时关闭第二批。无法安全制造的供应商故障或浏览器证据写入 `UNVERIFIED_ITEMS.md`，结论最多为“有条件通过”，不得伪造完整通过。

---

## 计划自审结论

- 规格覆盖：三个 Skill、CSV/JSON、条件步骤、动态扇出、逐项回图、计费、取消、恢复、质量门禁、双入口和云端证据均有对应任务。
- 边界一致：Amazon 合规、Brief 到视频和多平台导出没有混入第二批。
- 类型一致：`when` 和 `fanOut` 只存在于声明定义，执行前统一编译为稳定 `SkillStepDefinition`；执行器继续消费既有步骤接口。
- 保护一致：旧 24/16 项、`stable`、三工作区和当前业务入口均有显式回归门禁。

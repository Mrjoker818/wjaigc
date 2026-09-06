# Lovart 营销增量工作流第一批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有统一 Skill Runtime 中增加广告 A/B 变体、再营销素材和全渠道活动素材包，并在 Canvas 与 Workflow 共享运行，保持旧 21/16 Skills 和所有既有入口不变。

**Architecture:** 新建独立的营销 Skill 定义模块，由目录层组合为 24 项 Canvas/Workflow 内置目录；规划步骤使用现有 `chat`，成品步骤通过通用、受控的 `img2img` Skill 适配器把已授权 AssetVersion 解析为真实供应商参考图，并继续复用现有 Agent Run、积分、幂等和 AssetVersion。Simple Chat 仍保持独立 16 项目录，服务端禁止营销 Skill 以 `simple-chat` surface 运行。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、Vitest、Playwright、PostgreSQL、现有 Agent/Skill Runtime。

## Global Constraints

- 只修改 `main`，不得触碰 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- V5.8.8 donor 只读，不整文件复制。
- 不修改旧 21 个 Canvas/Workflow Skills 的 ID、版本、内容和顺序。
- 不修改独立 Simple Chat 的 16 个 Skills。
- 新三项 Skill 只允许 `canvas` 与 `workflow`。
- 不新建任务、账务或供应商状态机。
- 不使用本地 GPU，不覆盖来源素材。
- 每项先 RED、最小实现、聚焦回归、全量回归，再做云端真实验收。

---

### Task 1: 锁定旧目录并定义三项营销 Skill

**Files:**
- Create: `src/lib/skill-runtime/marketing-presets.ts`
- Create: `src/__tests__/lib/skill-runtime-marketing-presets.test.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/__tests__/lib/skill-runtime-catalog.test.ts`

**Interfaces:**
- Consumes: `SkillDefinition` from `src/lib/skill-runtime/types.ts`。
- Produces: `LOVART_MARKETING_SKILLS: readonly SkillDefinition[]`，固定顺序为 `preset-ad-ab-variants`、`preset-retargeting-creative`、`preset-omnichannel-campaign`。

- [ ] **Step 1: 写入定义结构失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { LOVART_MARKETING_SKILLS } from '@/lib/skill-runtime/marketing-presets';

describe('Lovart marketing Skill definitions', () => {
  it('defines three canvas/workflow-only built-ins with stable ids', () => {
    expect(LOVART_MARKETING_SKILLS.map(skill => skill.id)).toEqual([
      'preset-ad-ab-variants',
      'preset-retargeting-creative',
      'preset-omnichannel-campaign',
    ]);
    expect(LOVART_MARKETING_SKILLS.every(skill => (
      skill.version === 1
      && skill.executionContextVersion === 1
      && skill.builtIn
      && skill.enabled
      && skill.allowedSurfaces.join(',') === 'canvas,workflow'
    ))).toBe(true);
  });

  it('keeps deterministic output steps and quality gates', () => {
    expect(LOVART_MARKETING_SKILLS.map(skill => skill.steps.map(step => ({
      id: step.id,
      toolId: step.toolId,
      execution: step.execution,
      parallelGroup: step.parallelGroup,
      role: step.modelRole,
      gates: step.qualityGateIds,
    })))).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-marketing-presets.test.ts`
Expected: FAIL，模块 `marketing-presets` 不存在。

- [ ] **Step 3: 最小实现定义模块**

先在 `types.ts` 只扩展定义能力：`SkillInputKind` 增加 `multi-select`，`SkillInputField` 增加可选的 `bindToSourceVersions?: boolean`。输入值校验、冻结快照和 UI 行为留给 Task 3 的 RED/GREEN 实现。

```ts
import type { SkillDefinition, SkillInputField, SkillStepDefinition } from './types';

const surfaces = ['canvas', 'workflow'] as const;
const now = 1;

function definition(input: {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  inputs: readonly SkillInputField[];
  steps: readonly SkillStepDefinition[];
}): SkillDefinition {
  return {
    executionContextVersion: 1,
    version: 1,
    category: 'marketing',
    allowedSurfaces: surfaces,
    enabled: true,
    builtIn: true,
    ownerId: undefined,
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    ...input,
  };
}

const commonInputs: readonly SkillInputField[] = [
  { key: 'sourceImages', label: '来源图片', kind: 'images', required: true, maximumItems: 6, bindToSourceVersions: true },
  { key: 'campaignName', label: '活动名称', kind: 'text', required: true },
  { key: 'product', label: '产品或服务', kind: 'text', required: true },
  { key: 'audience', label: '目标受众', kind: 'text', required: true },
  { key: 'sellingPoints', label: '核心卖点', kind: 'text', required: true },
  { key: 'tone', label: '品牌调性', kind: 'text', defaultValue: '清晰、可信、具有行动感' },
  { key: 'aspectRatio', label: '生成比例', kind: 'select', defaultValue: '1:1', options: ['1:1', '4:5', '3:4', '16:9', '9:16'] },
  { key: 'negativeConstraints', label: '禁止内容', kind: 'text' },
];

function imageStep(skillId: string, id: string, label: string, promptTemplate: string): SkillStepDefinition {
  return {
    id,
    label,
    toolId: 'img2img',
    promptTemplate,
    modelRole: 'image',
    execution: 'parallel',
    parallelGroup: `${skillId}:outputs`,
    qualityGateIds: ['output-present'],
  };
}
```

在上述完整共用字段和 `imageStep` helper 上定义三项 Skill；不能提交空输入、空步骤或 `generate_image` 成品步骤。专属结构如下：

| Skill | 专属输入 | 输出步骤 |
|---|---|---|
| `preset-ad-ab-variants` | `objective` 必填单选：认知/点击/加购/购买/留资；`channel` 必填单选：信息流/搜索展示/社交媒体/电商站内；`hypothesis` 可选文本 | `plan` 顺序 chat；`variant-a`、`variant-b` 同一并行组 img2img |
| `preset-retargeting-creative` | `funnelStage` 必填单选：浏览未点击/点击未加购/加购未购买/老客复购；`objection`、`offer` 可选文本；`urgency` 默认温和，单选：无/温和/明确 | `diagnose` 顺序 chat；`proof`、`benefit`、`offer` 同一并行组 img2img |
| `preset-omnichannel-campaign` | `channels` 必填 multi-select，默认小红书/微信/Instagram/电商站内，最多6项；`campaignMessage`、`callToAction` 必填文本；`visualAnchor` 可选文本 | `campaign-plan` 顺序 chat；`master-key-visual`、`social-adaptation`、`commerce-adaptation`、`owned-media-adaptation` 同一并行组 img2img |

三项共用输入固定为：`sourceImages` 必填 images/最多6项、`campaignName`/`product`/`audience`/`sellingPoints` 必填文本、`tone` 默认“清晰、可信、具有行动感”、`aspectRatio` 默认 `1:1` 且选项为 `1:1`/`4:5`/`3:4`/`16:9`/`9:16`、`negativeConstraints` 可选文本。首批不暴露尚未形成授权快照闭环的 `brandKit` 字段。所有成品步骤使用 `output-present`，并行组名固定为 `${skillId}:outputs`。

- [ ] **Step 4: 锁死旧 21 项基线**

在 `skill-runtime-catalog.test.ts` 保留原 `canvasIds` 和 `CANVAS_PRESET_SKILLS` 21 项断言，并增加：

```ts
expect(CANVAS_PRESET_SKILLS.map(skill => skill.id)).toEqual(canvasIds);
expect(CANVAS_PRESET_SKILLS).toHaveLength(21);
```

- [ ] **Step 5: 运行聚焦测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-marketing-presets.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts`
Expected: PASS，旧目录 21 项和新定义 3 项分别可证明。
Commit: `feat: define Lovart marketing skills`

---

### Task 2: 合并 24 项权威目录并更新存储与盘点

**Files:**
- Modify: `src/lib/skill-runtime/catalog.ts`
- Modify: `src/lib/skill-runtime/storage.ts`
- Modify: `scripts/stage-4-inventory.mjs`
- Modify: `src/__tests__/lib/skill-runtime-catalog.test.ts`
- Modify: `src/__tests__/scripts/skill-runtime-inventory.test.ts`

**Interfaces:**
- Consumes: `CANVAS_PRESET_SKILLS` 21 项与 `LOVART_MARKETING_SKILLS` 3 项。
- Produces: `CANVAS_WORKFLOW_SKILLS: readonly SkillDefinition[]` 24 项，供目录、存储和盘点共同使用。

- [ ] **Step 1: 写入目录与隔离失败测试**

```ts
expect(CANVAS_PRESET_SKILLS).toHaveLength(21);
expect(CANVAS_WORKFLOW_SKILLS).toHaveLength(24);
expect(listSkillsForSurface('canvas').map(skill => skill.id))
  .toEqual(CANVAS_WORKFLOW_SKILLS.map(skill => skill.id));
expect(listSkillsForSurface('workflow').map(skill => skill.id))
  .toEqual(CANVAS_WORKFLOW_SKILLS.map(skill => skill.id));
expect(listSkillsForSurface('simple-chat')).toHaveLength(16);
expect(() => requireSkillForSurface('preset-ad-ab-variants', 'simple-chat'))
  .toThrowError(SkillSurfaceForbiddenError);
```

盘点测试改为 Canvas 24、Workflow 24、Simple Chat 16，并额外断言旧 21 项仍为新目录前缀。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/skill-runtime-inventory.test.ts`
Expected: FAIL，`CANVAS_WORKFLOW_SKILLS` 未导出且盘点仍为 21。

- [ ] **Step 3: 实现目录组合**

```ts
import { LOVART_MARKETING_SKILLS } from './marketing-presets';

export const CANVAS_WORKFLOW_SKILLS: readonly SkillDefinition[] = [
  ...CANVAS_PRESET_SKILLS,
  ...LOVART_MARKETING_SKILLS,
];

const ALL_BUILT_IN_SKILLS = [
  ...CANVAS_WORKFLOW_SKILLS,
  ...SIMPLE_CHAT_PRESET_SKILLS,
] as const;
```

`storage.ts` 的内置目录改为组合后的 `CANVAS_WORKFLOW_SKILLS`，确保复制、启停、用户覆盖和历史版本均能读取新增 Skill，同时不更改已有存储 key。

- [ ] **Step 4: 让盘点脚本读取新定义模块**

读取 `marketing-presets.ts`，分别提取 `LOVART_MARKETING_SKILLS` 的 Canvas/Workflow ID，再与旧目录合并去重。不得通过硬编码 `24` 伪造盘点结果。

- [ ] **Step 5: 验证目录 API 与存储回归**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/skill-runtime-inventory.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts`
Expected: PASS，Canvas/Workflow 24、Simple Chat 16、旧 21 定义不变。
Commit: `feat: publish marketing skills to canvas workflow catalog`

---

### Task 3: 验证结构化输入、提示词与来源素材

**Files:**
- Modify: `src/__tests__/lib/skill-runtime-marketing-presets.test.ts`
- Modify: `src/__tests__/lib/skill-runtime-inputs.test.ts`
- Modify: `src/__tests__/lib/skill-execution-context.test.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/input-resolver.ts`
- Modify: `src/lib/skill-runtime/storage.ts`
- Modify: `src/lib/skill-runtime/continuation.ts`
- Modify: `src/lib/skill-runtime/run-request.ts`
- Modify: `src/lib/agent-runtime/service.ts`
- Modify: `src/components/skill-runtime/SkillInputFields.tsx`
- Modify: `src/__tests__/components/skill-runtime-controls.test.tsx`
- Modify: `src/lib/skill-runtime/execution-context.ts`
- Modify: `src/__tests__/lib/skill-runtime-run-request.test.ts`
- Modify: `src/__tests__/lib/skill-runtime-continuation.test.ts`

**Interfaces:**
- Consumes: `resolveSkillInputs`, `buildSkillStepPrompt`, `SkillRunRequest.sourceVersionIds`。
- Produces: 规范化输入快照与不含 base64 的步骤提示词；来源图片继续通过受控 AssetVersion 链路传递。

- [ ] **Step 1: 写入输入边界失败测试**

```ts
const ad = LOVART_MARKETING_SKILLS[0];
expect(() => resolveSkillInputs(ad, {})).toThrowError(expect.objectContaining({
  code: 'SKILL_INPUT_REQUIRED',
  field: 'campaignName',
}));
expect(() => resolveSkillInputs(ad, {
  campaignName: '秋季上新', product: '耳机', audience: '通勤人群',
  sellingPoints: '降噪', sourceImages: Array(7).fill('version-id'),
})).toThrowError(expect.objectContaining({
  code: 'SKILL_INPUT_LIMIT_EXCEEDED',
  field: 'sourceImages',
}));
```

分别覆盖非法 `objective`、`channel`、`funnelStage`、`urgency`，以及 `channels` 的未知项、重复项、非字符串项和超过 6 项。

三项营销 Skill 的 `sourceImages` 已设置 `bindToSourceVersions: true`。在 `skill-runtime-run-request.test.ts` 断言所有带该标记的字段都必须与去重后的 `sourceVersionIds` 同序一致；空数组、重复、URL/base64、缺失、额外和换序均在任务创建与扣费前拒绝。不得根据三个 Skill ID 写条件分支。

- [ ] **Step 2: 写入提示词与来源隔离失败测试**

```ts
const prompt = buildSkillStepPrompt({
  definition: ad,
  step: ad.steps[1],
  inputValues: resolved,
  previousOutputs: [{ stepId: 'plan', kind: 'text', content: '只测试利益点表达' }],
});
expect(prompt).toContain('只测试利益点表达');
expect(prompt).toContain('秋季上新');
expect(prompt).not.toContain('data:image');
expect(prompt).not.toContain('version-source-1');
```

- [ ] **Step 3: 运行测试确认真实缺口**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-marketing-presets.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-execution-context.test.ts`
Expected: 新定义相关断言在实现前 FAIL；已有安全合同继续 PASS。

- [ ] **Step 4: 实现通用 `multi-select` 与来源绑定输入合同**

```ts
// `multi-select` 与 `bindToSourceVersions` 已在 Task 1 加入类型定义；
// 本任务实现它们的解析、快照、恢复和 UI 合同。

function validateMultiSelect(field: SkillInputField, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    return invalidType(field);
  }
  const limit = field.maximumItems ?? SKILL_INPUT_LIMITS.images;
  if (value.length > limit) throw new SkillInputError('SKILL_INPUT_LIMIT_EXCEEDED', field.key);
  if (new Set(value).size !== value.length) invalidValue(field);
  if (field.options && value.some(item => !field.options!.includes(item))) invalidValue(field);
  return value;
}
```

在 `validateField` 中调用该函数；`storage.ts` 与 `continuation.ts` 把 `multi-select` 加入允许类型；`SkillInputFields.tsx` 使用语义化复选框组，达到 `maximumItems` 后禁用未选项，已选项仍可取消。`storage.ts` 的字段白名单、复制逻辑和 `agent-runtime/service.ts` 的冻结快照必须保留 `bindToSourceVersions`。`continuation.ts` 从冻结快照恢复字段时必须同时保留经过类型校验的 `defaultValue`、`options`、`maximumItems` 和 `bindToSourceVersions`，确保刷新、暂停、恢复后仍执行与创建时相同的输入约束。

`execution-context.ts` 明确允许经过校验的 `multi-select` 字符串数组进入 JSON 需求段：

```ts
type PromptRequirementValue = string | number | boolean | null | readonly string[];
const promptKinds = new Set(['text', 'select', 'multi-select', 'number', 'boolean']);
const values: Record<string, PromptRequirementValue> = {};

if (field.kind === 'multi-select') {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('SKILL_CONTEXT_INVALID_VALUE');
  }
  values[field.key] = [...value];
}
```

媒体、Brand Kit ID 和 base64 仍不得作为自由文本注入供应商提示词。

- [ ] **Step 5: 运行聚焦测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-marketing-presets.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-execution-context.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/components/skill-runtime-controls.test.tsx`
Expected: PASS，错误发生在任务创建和扣费之前。
Commit: `test: protect marketing skill input contracts`

---

### Task 4: 接通受控参考图并证明并行、幂等、退款与资产版本

**Files:**
- Create: `src/__tests__/lib/skill-marketing-execution.test.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Modify: `src/lib/skill-runtime/continuation.ts`
- Modify: `src/lib/chat-tools.ts`
- Modify: `src/__tests__/lib/agent-runtime-tools.test.ts`
- Modify: `src/__tests__/lib/skill-runtime-step-registry.test.ts`
- Modify: `src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts`

**Interfaces:**
- Consumes: `createSkillExecutor`、`estimateSkillRunCost`、`createProductionSkillStepRegistry`、`authorizeAgentContext` 的已授权来源映射、现有 `img2img` 工具。
- Produces: 仅从本次 Run 已授权 `sourceVersionIds` 解析的 1–6 张参考图、三项营销 Skill 的冻结估价、并行独立 operation key、部分失败恢复和 AssetVersion 结果集合。

- [ ] **Step 1: 写入静态执行图失败测试**

```ts
for (const skill of LOVART_MARKETING_SKILLS) {
  expect(skill.steps[0]).toMatchObject({
    toolId: 'chat', execution: 'sequential', modelRole: 'orchestrator',
  });
  const outputs = skill.steps.slice(1);
  expect(outputs.every(step => (
    step.toolId === 'img2img'
    && step.execution === 'parallel'
    && step.parallelGroup === `${skill.id}:outputs`
    && step.modelRole === 'image'
    && step.qualityGateIds.includes('output-present')
  ))).toBe(true);
}
```

- [ ] **Step 2: 写入运行与账务失败测试**

使用现有执行器测试夹具断言：

```ts
expect(quote.steps).toHaveLength(skill.steps.length);
expect(new Set(acceptedOperations.map(item => item.operationKey)).size)
  .toBe(acceptedOperations.length);
expect(run.assetVersionIds).toEqual(['asset-a', 'asset-b']);
expect(retryCalls.map(call => call.stepId)).toEqual(['variant-b']);
expect(ledger.filter(row => row.kind === 'consume')).toHaveLength(1);
expect(ledger.filter(row => row.kind === 'refund')).toHaveLength(1);
```

再补取消后迟到完成不会覆盖 `cancelled/refunded` 的断言。

- [ ] **Step 3: 写入来源授权与多参考图失败测试**

在 `agent-runtime-tools.test.ts` 和 `skill-runtime-step-registry.test.ts` 先固定以下合同：

```ts
expect(generateBody.referenceImages).toEqual([
  '/api/serve-upload/source-a.png',
  '/api/serve-upload/source-b.png',
]);
expect(generateBody.model).toBe('frozen-image-model');
expect(generateBody.providerId).toBe('frozen-provider');
```

同时覆盖：

- `sourceVersionIds` 至少一项，且数量不得超过 6。
- `loadPersistedSkillContinuation` 使用持久化 Agent Request 重新调用 `authorizeAgentContext`，并把返回的 `mediaByVersionId` 传给 Step Registry；按请求中 `sourceVersionIds` 的顺序解析 URL，缺失版本或空 URL 在供应商提交前拒绝。
- `sourceImages` 只允许 AssetVersion ID，并与 `sourceVersionIds` 同序一致；供应商请求只能使用上述服务端解析结果。
- `img2img` 的新 `image_urls` 必须与 `ToolContext.canonicalImageUrls` 规范化后逐项、同序完全一致；伪造、缺失、增删或换序返回 `AGENT_MEDIA_URL_MISMATCH`。
- 旧调用仍可使用单一 `image_url + canonicalImageUrl`，行为和错误码不变。
- Skill 适配器必须把 `referenceImages` 真正发送到 `/api/generate`，不能只把版本 ID 写进来源追踪。
- 多参考图能力不足时必须由权威能力目录给出明确限制或只接收一张的错误，不允许在 Skill 层静默丢图。

- [ ] **Step 4: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-marketing-execution.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/lib/skill-runtime-step-registry.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts`
Expected: 多参考图和 `img2img` Skill 适配器断言因缺少实现而 FAIL；旧单图合同继续 PASS。任何其他失败都保留为具体运行内核缺陷证据，不以营销 Skill ID 特判绕过。

- [ ] **Step 5: 实现通用受控 `img2img` 适配器**

1. 在 `loadPersistedSkillContinuation` 使用刚重建并完成摘要核验的 `agentRequest` 调用现有 `authorizeAgentContext`，保留它返回的 `mediaByVersionId`，不要只保留 `snapshot`。
2. 创建前要求 `sourceImages` 与去重后的 `sourceVersionIds` 同序一致；恢复时按 `request.sourceVersionIds` 顺序生成 `canonicalImageUrls`，要求数量为 1–6、每项都存在。
3. `createProductionSkillStepRegistry` 新增通用 `img2img` adapter 与 recovery，复用 `executeGenerationStep` 的持久任务接纳、`recordLocalAccepted`、监控、AssetVersion 聚合和来源追踪；不要复制第二套账务逻辑。
4. `chat-tools.ts` 扩展 `ToolContext` 为 `canonicalImageUrls?: readonly string[]`，并让 `executeImg2Img` 接受 `image_urls?: string[]`。受控执行时执行规范化后的严格数组匹配；非受控调用与旧 `image_url` 路径保持兼容。数组限制为 1–6 项，拒绝空值、重复、非字符串和歧义的单双图组合。
5. `/api/generate` 请求体使用已授权的 `referenceImages`，透传输入的 `aspect_ratio` 和 `skillBillingContext`，继续冻结 `providerId + modelId`、幂等键和现有异步任务语义。模型的 `maxReferenceImages` 不足时由现有能力目录明确拒绝，Skill 层不得换模型或截断数组。

实现不得根据三个营销 Skill ID 分支，所有使用 `toolId: 'img2img'` 且来源已授权的 Skill 都走同一适配器。

- [ ] **Step 6: 复核通用运行内核无需营销特判**

Run: `rg -n "preset-ad-ab-variants|preset-retargeting-creative|preset-omnichannel-campaign" src/lib/skill-runtime/executor.ts src/lib/skill-runtime/cost-estimator.ts src/lib/skill-runtime/service.ts src/lib/skill-runtime/step-registry.ts`
Expected: 无匹配。若前述测试暴露通用执行器缺陷，先登记精确缺陷并为通用合同另建 RED 测试；禁止在本任务写 Skill ID 特判。

- [ ] **Step 7: PostgreSQL 真并发验证**

在临时隔离库运行：

```powershell
$pg='C:\Program Files\PostgreSQL\18\bin'
$data=Join-Path $env:TEMP ('wujie-lovart-pg-'+[guid]::NewGuid())
& "$pg\initdb.exe" -D $data -U wujie_test -A trust
& "$pg\pg_ctl.exe" -D $data -o '-p 55493 -h 127.0.0.1' -w start
& "$pg\createdb.exe" -h 127.0.0.1 -p 55493 -U wujie_test wujie_lovart_test
$url='postgresql://wujie_test@127.0.0.1:55493/wujie_lovart_test'
$env:POSTGRES_TEST_DATABASE_URL=$url
$env:TEST_POSTGRES_URL=$url
$env:PGDATABASE_URL=$url
$env:DATABASE_URL=$url
try { pnpm exec vitest run src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts }
finally { & "$pg\pg_ctl.exe" -D $data -m fast -w stop }
```

Expected: 同一用户同一幂等键只创建一个父 Run；每个输出步骤一个 operation；失败退款一次；迟到完成被条件终态拒绝。没有隔离库时必须记录为未验证，不能跳过后宣称通过。

- [ ] **Step 8: 聚焦回归并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-marketing-execution.test.ts src/__tests__/lib/agent-runtime-tools.test.ts src/__tests__/lib/skill-runtime-step-registry.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts`
Expected: PASS；至少证明两张真实授权参考图进入生成请求、旧单图调用无回归、每个输出步骤仍只有一个持久 operation。

Commit: `feat: execute Lovart marketing workflows durably`

---

### Task 5: 锁定 Canvas 与 Workflow 双入口及 Simple Chat 隔离

**Files:**
- Modify: `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`
- Modify: `src/__tests__/components/node-editor-skill-node.test.tsx`
- Modify: `src/__tests__/components/simple-chat-skill-isolation.test.tsx`
- Modify: `src/lib/workflow-engine.ts`
- Modify: `src/__tests__/lib/workflow-skill-node.test.ts`
- Modify: `tests/e2e/skill-runtime-canvas-workflow.spec.ts`

**Interfaces:**
- Consumes: `/api/skills?surface=canvas`、`/api/skills?surface=workflow`、`ai-skill` 节点。
- Produces: 三项营销 Skill 在 Canvas/Workflow 可选择、可输入、可运行、可恢复；Simple Chat 不可见且不可执行。

- [ ] **Step 1: 写入组件合同失败测试**

```ts
expect(await loadCanvasSkillCatalog(fetcher)).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'preset-ad-ab-variants' }),
]));
expect(workflowSkills.map(skill => skill.id)).toContain('preset-omnichannel-campaign');
expect(simpleChatSkills.map(skill => skill.id)).not.toContain('preset-retargeting-creative');
```

断言 Canvas 与 Workflow 使用同一服务端定义，不在组件中复制三项静态卡片。

Workflow 组装 `ai-skill` 请求时，所有 `bindToSourceVersions` 字段使用 `workflowSourceVersionIds(inputs)` 得到的 AssetVersion ID，不能写入上游图片 URL；最终 `inputValues.sourceImages` 与 `sourceVersionIds` 同序一致，真实 URL 仍由服务端授权解析。

- [ ] **Step 2: 运行组件测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/simple-chat-skill-isolation.test.tsx`
Expected: 目录接入前新断言 FAIL。

- [ ] **Step 3: 证明动态目录无需静态 UI 分叉**

Run: `rg -n "preset-ad-ab-variants|preset-retargeting-creative|preset-omnichannel-campaign" src/components/chat-panel.tsx src/components/node-editor.tsx src/lib/skill-runtime/canvas-client.ts src/lib/skill-runtime/workflow-client.ts`
Expected: 无匹配。三项必须由服务端目录自动显示；不得增加底部工具栏按钮，不得把营销 Skills 写入 Simple Chat。

- [ ] **Step 4: 扩展双入口 E2E**

在现有夹具中加入一项营销 Skill，验证：

```ts
await expect(page.getByText('广告 A/B 变体', { exact: true })).toBeVisible();
await expect(page.getByText('再营销素材', { exact: true })).toBeVisible();
expect(canvasRun.skillId).toBe('preset-ad-ab-variants');
expect(workflowRun.skillId).toBe('preset-ad-ab-variants');
expect(workflowRun.assetVersionIds).toHaveLength(2);
```

- [ ] **Step 5: 运行双入口回归并提交**

Run: `pnpm exec vitest run src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/simple-chat-skill-isolation.test.tsx`
Run: `pnpm exec playwright test tests/e2e/skill-runtime-canvas-workflow.spec.ts --project=chromium`
Expected: Canvas/Workflow 通过，Simple Chat 仍为 16 项。
Commit: `test: cover marketing skills across canvas and workflow`

---

### Task 6: 全量回归、Obsidian、推送与云端验收

> 执行状态（2026-09-06）：Task 1-5 已按 TDD、隔离 PostgreSQL 和本地 Chromium 证据完成，不得重复实施。Task 6 的本地门禁、文档和 `main` 推送已完成；只剩 Coze 精确部署与云端真实验收。

> 2026-09-07 云端检查点：Step 6 首次执行已复现 Canvas 来源字段与实际请求来源不一致。`LOVART-CANVAS-002` 已按 TDD 在本地修复并通过全量门禁，尚未部署复验；Task 6 仍处于 Step 6，不回退、不重复 Task 1-5 或 Task12。

> 2026-09-07 续接检查点：Coze `4786e59b` 已证明托管来源图片显示为“已选择 1 张来源图片”，随后真实估价复现 `LOVART-CANVAS-003`（必填下拉项仅有视觉默认值，请求缺少 `objective`）。该问题已按 RED/GREEN 最小修复；扩大相关回归 `94/94`、全仓 `5304 passed / 171 conditional skipped / 0 failed`、类型、构建版 ESLint、保护基线和生产构建 `119/119` 已通过。待推送和 Coze 复验。Task 6 仍只执行 Step 6，不重复已关闭内容。

> 2026-09-07 云端验收检查点：Coze 已运行 `main@da15f30d`。Canvas A/B 报价、双成品、两个 AssetVersion、来源保留与刷新恢复通过；取消样本精确退款一次且迟到窗口无终态覆盖；Workflow 全渠道包在沙箱实例丢失并恢复后继续完成，固定 APImart 路由、5/5 步骤、4 个 AssetVersion 和单次 242 积分计费均由持久事件证明；`/simple-chat` 仍为 16 Skills 且不含三项营销 Skill。仅“生产环境受控单步失败后只重试失败步骤”缺少安全故障注入条件，保持未验证；本地确定性故障夹具 `42/42` 通过。Task 6 仍处于 Step 6，不重复 Task 1-5 或 Task12。

**Files:**
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `F:/AIGC/vault-template/无界计划/11-阶段进度看板.md`

**Interfaces:**
- Consumes: Tasks 1 至 5 的固定候选与测试证据。
- Produces: 可追溯的 GitHub `main` 候选、Obsidian 阶段记录和云端真实验收结论。

- [x] **Step 1: 运行聚焦门禁**

```powershell
pnpm exec vitest run src/__tests__/lib/skill-runtime-marketing-presets.test.ts src/__tests__/lib/skill-marketing-execution.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/skill-runtime-inventory.test.ts src/__tests__/api/skills.test.ts src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/simple-chat-skill-isolation.test.tsx
```

Expected: 0 failed、0 unexpected skipped。

- [x] **Step 2: 运行完整本地门禁**

```powershell
pnpm ts-check
pnpm lint
pnpm test
pnpm build
```

Expected: 所有命令退出 0；记录真实通过、跳过和警告数，不能只写“通过”。

- [x] **Step 3: 检查功能保护和分支约束**

```powershell
pnpm run check:protected-baseline
git diff --check
git status --short
git rev-parse origin/stable
```

Expected: 保护门禁通过、无未批准漂移、`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`。

- [x] **Step 4: 更新中文证据文档和 Obsidian**

记录：旧 21/16 零丢失、三项新目录、测试数、PostgreSQL 状态、已修问题、未验证项、提交 SHA。Obsidian 只新增本阶段一次权威检查点，不复制历史长记录。

- [x] **Step 5: 提交并推送 `main`**

```powershell
git add src scripts tests docs
git commit -m "feat: add first Lovart marketing workflows"
git push origin main
git fetch origin main stable --quiet
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `HEAD == origin/main`，stable SHA 不变。

- [x] **Step 6: Coze 精确部署与真实浏览器验收**

执行结论（2026-09-07）：`main@da15f30d` 的业务候选已在 Coze 完成核心真实验收；Canvas 广告 A/B、Workflow 全渠道素材包、取消与一次退款、迟到终态隔离、AssetVersion、刷新恢复及 Simple Chat 隔离均有持久证据。生产环境缺少不破坏供应商配置的安全单步故障注入条件，因此“仅重试失败步骤”保留为明确未验证项；本地确定性故障夹具 `42/42` 通过。该缺口不伪装为云端通过，也不阻止按本计划约定形成有条件阶段结论。

在现有项目页让 Coze 拉取精确 `main`，核对源码 tree、类型、保护门禁、构建退出码、Build ID 和唯一服务进程。沙箱重启后强制刷新现有预览页，不新建重复标签。

真实执行：

1. Canvas 运行“广告 A/B 变体”，确认报价、两项成品、两个新 AssetVersion、来源图未覆盖、保存刷新恢复。
2. Workflow 运行“全渠道活动素材包”，确认固定 provider/model、步骤进度、结果进入节点并可继续连接。
3. 制造一个受控可恢复的单步失败，确认只重试失败步骤且不重复扣除已完成步骤。
4. 取消一个当前归属任务，确认只退款一次，等待迟到窗口后终态不回写。
5. 检查 `/simple-chat` 仍为 16 Skills，三个营销 Skill 不可见。
6. 保存截图、Console、Network、持久事件和积分流水证据。

- [x] **Step 7: 形成阶段结论**

仅当本地门禁和云端核心链路均有真实证据时，将第一批标记为完成。供应商故障、浏览器控制或对象存储证据缺失必须进入 `UNVERIFIED_ITEMS.md`，不得写成通过。第一批关闭后才创建第二批规格。

阶段结论（2026-09-07）：**有条件通过并关闭第一批**。本地、隔离 PostgreSQL、本地 Chromium、GitHub `main` 和 Coze 云端核心链路均已完成；唯一保留项为生产受控单步失败重试，已登记在 `UNVERIFIED_ITEMS.md`。后续不得重做 Task 1-6；下一阶段从第二批规格设计开始。

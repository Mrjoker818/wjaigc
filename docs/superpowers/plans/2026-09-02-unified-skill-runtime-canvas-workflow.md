# 统一 Skill 运行内核与画布/节点迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变独立智能对话定位、不丢失现有功能的前提下，建立商业级统一 Skill 运行内核，并将现有 21 个画布 Skills 同源接入无限画布和节点模式。

**Architecture:** 新增独立的 `skill-runtime` 领域层，规范 Skill 定义、结构化输入、步骤图、作用域、模型冻结、费用预估、质量门禁和运行控制；执行层复用现有 Agent Runtime、`cloud_tasks`、Agent 事件、资产版本和原子积分结算，不建立第二套任务状态机。21 个画布 Skills 共享一份目录并授权给 `canvas + workflow`，独立智能对话 16 个 Skills 继续只授权给 `simple-chat`。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、现有 Agent Runtime、Vitest、Playwright。

## Global Constraints

- 只修改 `main`；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 不得修改、合并或推送。
- 当前实施基线为计划创建时的 `main@cd15bfbb087102ca62c4e653fdddc6965c409db4`；开始每个任务前必须复读实际 `HEAD` 和 `origin/main`。
- V5.8.8 仅作只读供体，不整体复制文件覆盖当前架构。
- 画布 21 Skills 的允许表面固定为 `canvas + workflow`；独立对话 16 Skills 固定为 `simple-chat`。
- 三工作区只共享任务、模型、积分、资产和结果版本，不共享 Skill 目录、提示词或 UI。
- 不删除、重命名或减少现有 21/16 个 Skill ID、名称、入口和提示词内容。
- 不建立第二套供应商任务状态机、积分账本或资产真相源。
- 不引入本地 GPU、CUDA、PyTorch GPU 服务或本地生成模型。
- 每个任务必须 RED 测试先行、最小实现、聚焦回归、保护门禁和独立提交。
- 无隔离 `POSTGRES_TEST_DATABASE_URL` 时，PostgreSQL 并发项必须标记为未验证，不得连接生产库代替。
- 云端验收只使用现有 Google Chrome 项目页与预览页，不新建标签，不使用 360。

## 文件职责

- `src/lib/skill-runtime/types.ts`：Skill 定义、输入、步骤、模型绑定、质量门禁和运行控制类型。
- `src/lib/skill-runtime/canvas-presets.ts`：现有 21 个画布预设的唯一规范来源。
- `src/lib/skill-runtime/simple-chat-presets.ts`：现有 16 个独立对话预设的唯一规范来源。
- `src/lib/skill-runtime/catalog.ts`：目录合并、按表面过滤、版本选择和作用域拒绝。
- `src/lib/skill-runtime/input-resolver.ts`：必填项、默认值、文本/图片/Brand Kit/数据集输入校验。
- `src/lib/skill-runtime/prompt-compiler.ts`：参数插值和规范化请求摘要输入。
- `src/lib/skill-runtime/storage.ts`：用户复制、启停、权限和旧 `chat_skills` 兼容存储。
- `src/lib/skill-runtime/run-request.ts`：把 Skill 调用编译为冻结模型的 `AgentRunRequest`。
- `src/lib/skill-runtime/cost-estimator.ts`：执行前逐步骤积分预估。
- `src/lib/skill-runtime/quality-gates.ts`：输出存在性、透明度、尺寸、数量和格式等确定性门禁。
- `src/lib/skill-runtime/executor.ts`：顺序/并行步骤执行、暂停、恢复、重试和终态收口。
- `src/app/api/skills/route.ts`：按当前用户和表面列出、复制 Skill。
- `src/app/api/skills/[skillId]/route.ts`：启停和用户副本更新。
- `src/app/api/skill-runs/estimate/route.ts`：执行前费用预估。
- `src/app/api/skill-runs/route.ts`：创建和列出 Skill 运行。
- `src/app/api/skill-runs/[runId]/route.ts`：读取、取消、暂停和恢复。
- `src/app/api/skill-runs/[runId]/retry/route.ts`：从失败步骤重试。
- `src/components/skill-runtime/SkillRunProgress.tsx`：画布和节点模式共用进度、暂停、取消、重试 UI。
- `src/components/skill-runtime/SkillInputFields.tsx`：结构化输入控件。
- `src/components/chat-panel.tsx`：只保留画布 Skill 消费端，不再定义目录与运行状态机。
- `src/lib/workflow-engine.ts`：增加 `ai-skill` 节点及标准请求映射。
- `src/components/node-editor.tsx`：Skill 节点目录、属性和运行投影。

---

### Task 1: 建立 21/16 目录基线与领域类型

**Files:**
- Create: `src/lib/skill-runtime/types.ts`
- Create: `src/lib/skill-runtime/canvas-presets.ts`
- Create: `src/lib/skill-runtime/simple-chat-presets.ts`
- Create: `src/lib/skill-runtime/catalog.ts`
- Modify: `src/components/simple-chat/simple-chat-types.ts:601-末尾 PRESET_SKILLS 区域`
- Test: `src/__tests__/lib/skill-runtime-catalog.test.ts`

**Interfaces:**
- Produces: `SkillSurface`、`SkillDefinition`、`CANVAS_PRESET_SKILLS`、`SIMPLE_CHAT_PRESET_SKILLS`、`listSkillsForSurface()`、`requireSkillForSurface()`。
- Consumes: 无。

- [ ] **Step 1: 写入失败目录测试**

```ts
import {
  CANVAS_PRESET_SKILLS,
  SIMPLE_CHAT_PRESET_SKILLS,
  listSkillsForSurface,
  requireSkillForSurface,
  SkillSurfaceForbiddenError,
} from '@/lib/skill-runtime/catalog';

const canvasIds = [
  'preset-ecommerce-listing', 'preset-logo-brand', 'preset-storyboard',
  'preset-marketing-brochure', 'preset-social-media', 'preset-ip-character',
  'preset-product-packaging', 'preset-concept-art', 'preset-interior-design',
  'preset-poster-design', 'preset-ppt-design', 'preset-magazine-cover',
  'preset-apparel-fashion', 'preset-business-card', 'preset-book-cover',
  'preset-sticker-emoji', 'preset-comic-manga', 'preset-mockup-showcase',
  'preset-illustration', 'preset-ui-design', 'preset-food-photography',
];

it('保留 21 个画布 Skill 并只授权 canvas/workflow', () => {
  expect(CANVAS_PRESET_SKILLS.map(skill => skill.id)).toEqual(canvasIds);
  expect(listSkillsForSurface('canvas').map(skill => skill.id)).toEqual(canvasIds);
  expect(listSkillsForSurface('workflow').map(skill => skill.id)).toEqual(canvasIds);
  expect(CANVAS_PRESET_SKILLS.every(skill =>
    skill.allowedSurfaces.join(',') === 'canvas,workflow')).toBe(true);
});

it('保留 16 个独立对话 Skill 且不泄漏画布目录', () => {
  expect(SIMPLE_CHAT_PRESET_SKILLS).toHaveLength(16);
  expect(listSkillsForSurface('simple-chat')).toHaveLength(16);
  expect(listSkillsForSurface('simple-chat').some(skill => canvasIds.includes(skill.id))).toBe(false);
  expect(() => requireSkillForSurface('preset-ecommerce-listing', 'simple-chat'))
    .toThrow(SkillSurfaceForbiddenError);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts`

Expected: FAIL，提示 `@/lib/skill-runtime/catalog` 不存在；不得因测试语法错误失败。

- [ ] **Step 3: 实现领域类型**

```ts
export type SkillSurface = 'canvas' | 'workflow' | 'simple-chat';
export type SkillInputKind = 'text' | 'image' | 'images' | 'brand-kit' | 'dataset' | 'select' | 'number' | 'boolean';

export interface SkillInputField {
  key: string;
  label: string;
  kind: SkillInputKind;
  required: boolean;
  defaultValue?: unknown;
  options?: readonly string[];
  maximumItems?: number;
}

export interface SkillModelBinding {
  role: 'orchestrator' | 'image' | 'video' | 'vision' | 'edit' | 'three-d';
  requiredCapabilities: readonly string[];
}

export interface SkillStepDefinition {
  id: string;
  label: string;
  toolId: string;
  execution: 'sequential' | 'parallel';
  parallelGroup?: string;
  promptTemplate: string;
  modelRole: SkillModelBinding['role'];
  qualityGateIds: readonly string[];
}

export interface SkillDefinition {
  id: string;
  version: number;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  allowedSurfaces: readonly SkillSurface[];
  inputs: readonly SkillInputField[];
  steps: readonly SkillStepDefinition[];
  enabled: boolean;
  builtIn: boolean;
  ownerId?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}
```

- [ ] **Step 4: 提取两套预设且保持内容不变**

将 `chat-panel.tsx` 当前 `LOVART_PRESET_SKILLS` 的 21 个对象移入 `canvas-presets.ts`，仅作以下机械字段映射，不改 ID、名称、描述、`systemPrompt`、参数默认值或步骤文字：

```ts
const canvasSurfaces = ['canvas', 'workflow'] as const;

interface LegacyCanvasSkill {
  id: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string;
  paramSlots: Array<{ name: string; label: string; defaultValue?: string; placeholder?: string }>;
  steps: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

export function normalizeCanvasPresetSkills(
  rawCanvasSkills: readonly LegacyCanvasSkill[],
  now = Date.now(),
): SkillDefinition[] {
  return rawCanvasSkills.map(skill => ({
    ...skill,
    version: 1,
    allowedSurfaces: canvasSurfaces,
    inputs: skill.paramSlots.map(slot => ({
      key: slot.name,
      label: slot.label,
      kind: 'text' as const,
      required: slot.defaultValue === undefined,
      defaultValue: slot.defaultValue,
    })),
    steps: skill.steps.map((step, index) => ({
      id: `conversation-${index + 1}`,
      label: index === 0 ? '需求规划' : '成品交付',
      toolId: 'generate_image',
      execution: 'sequential' as const,
      promptTemplate: step.content,
      modelRole: index === 0 ? 'orchestrator' as const : 'image' as const,
      qualityGateIds: index === 0 ? [] : ['output-present'],
    })),
    enabled: true,
    builtIn: true,
    createdAt: skill.createdAt || now,
    updatedAt: skill.updatedAt || now,
  }));
}
```

`RAW_CANVAS_PRESET_SKILLS` 必须是从 `LOVART_PRESET_SKILLS` 机械移动出的完整 21 对象数组；导出使用：

```ts
export const CANVAS_PRESET_SKILLS = normalizeCanvasPresetSkills(RAW_CANVAS_PRESET_SKILLS);
```

把 `simple-chat-types.ts` 中 16 个 `PRESET_SKILLS` 对象移动到 `simple-chat-presets.ts`，固定 `allowedSurfaces: ['simple-chat']`；原文件通过 `export { SIMPLE_CHAT_PRESET_SKILLS as PRESET_SKILLS }` 保持所有消费者兼容。

- [ ] **Step 5: 实现目录过滤和稳定错误**

```ts
export class SkillSurfaceForbiddenError extends Error {
  readonly code = 'SKILL_SURFACE_FORBIDDEN';
  readonly status = 403;
}

export function listSkillsForSurface(surface: SkillSurface): SkillDefinition[] {
  return ALL_BUILT_IN_SKILLS.filter(skill => skill.enabled && skill.allowedSurfaces.includes(surface));
}

export function requireSkillForSurface(id: string, surface: SkillSurface): SkillDefinition {
  const skill = ALL_BUILT_IN_SKILLS.find(candidate => candidate.id === id);
  if (!skill) throw new SkillNotFoundError(id);
  if (!skill.enabled || !skill.allowedSurfaces.includes(surface)) {
    throw new SkillSurfaceForbiddenError('此 Skill 不适用于当前工作区');
  }
  return skill;
}
```

- [ ] **Step 6: 运行聚焦测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`

Expected: PASS，21/16 数量固定，Simple Chat 现有导入不变。

```bash
git add src/lib/skill-runtime src/components/simple-chat/simple-chat-types.ts src/__tests__/lib/skill-runtime-catalog.test.ts
git commit -m "feat: define scoped skill catalogs"
```

### Task 2: 结构化输入、模板编译与质量门禁

**Files:**
- Create: `src/lib/skill-runtime/input-resolver.ts`
- Create: `src/lib/skill-runtime/prompt-compiler.ts`
- Create: `src/lib/skill-runtime/quality-gates.ts`
- Test: `src/__tests__/lib/skill-runtime-inputs.test.ts`
- Test: `src/__tests__/lib/skill-runtime-quality.test.ts`

**Interfaces:**
- Consumes: `SkillDefinition`、`SkillInputField`。
- Produces: `resolveSkillInputs()`、`compileSkillPrompt()`、`runSkillQualityGates()`。

- [ ] **Step 1: 写入缺失字段、默认值、数据集和模板 RED 测试**

```ts
it('缺少必填输入时返回字段级错误且不创建任务', () => {
  expect(() => resolveSkillInputs(definition, { style: '科技感' })).toThrowError(
    expect.objectContaining({ code: 'SKILL_INPUT_REQUIRED', field: 'product' }),
  );
});

it('应用默认值并同时支持图片、Brand Kit 和数据集', () => {
  const resolved = resolveSkillInputs(definition, {
    product: '耳机', imageVersionIds: ['ver-1'], brandKitId: 'brand-1',
    dataset: [{ sku: 'A-1', name: '黑色耳机' }],
  });
  expect(resolved.style).toBe('高端科技感');
  expect(resolved.imageVersionIds).toEqual(['ver-1']);
});

it('模板仅替换已声明字段并拒绝未解析占位符', () => {
  expect(compileSkillPrompt('为{{product}}制作{{platform}}素材', {
    product: '耳机', platform: '亚马逊',
  })).toBe('为耳机制作亚马逊素材');
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`

Expected: FAIL，缺少三个新模块。

- [ ] **Step 3: 实现有界输入解析**

```ts
const LIMITS = { text: 16_384, images: 16, datasetRows: 1_000, serialized: 512 * 1024 } as const;

export function resolveSkillInputs(
  definition: SkillDefinition,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  assertSerializedBytes(raw, LIMITS.serialized);
  const output: Record<string, unknown> = {};
  for (const field of definition.inputs) {
    const value = raw[field.key] ?? field.defaultValue;
    if (field.required && isEmpty(value)) throw new SkillInputError('SKILL_INPUT_REQUIRED', field.key);
    output[field.key] = validateField(field, value, LIMITS);
  }
  return output;
}
```

- [ ] **Step 4: 实现确定性质量门禁**

```ts
export const QUALITY_GATES = {
  'output-present': (result: SkillStepResult) => result.assetVersionIds.length > 0,
  'expected-count': (result: SkillStepResult, expected: number) => result.assetVersionIds.length === expected,
  'transparent-alpha': (result: SkillStepResult) => result.media.some(media => media.hasTransparency === true),
  'valid-html': (result: SkillStepResult) => typeof result.html === 'string' && result.html.length > 0,
} satisfies Record<string, SkillQualityGate>;

export function runSkillQualityGates(
  ids: readonly string[], result: SkillStepResult, context: SkillQualityContext,
): SkillQualityResult[] {
  return ids.map(id => ({ id, passed: QUALITY_GATES[id]?.(result, context) === true }));
}
```

- [ ] **Step 5: 运行聚焦测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`

Expected: PASS，边界值、未知字段、空数据和未解析模板均被覆盖。

```bash
git add src/lib/skill-runtime src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts
git commit -m "feat: validate skill inputs and outputs"
```

### Task 3: Skill 副本、版本、启停和权限持久化

**Files:**
- Create: `src/lib/skill-runtime/storage.ts`
- Create: `src/lib/skill-runtime/legacy-migration.ts`
- Create: `src/app/api/skills/route.ts`
- Create: `src/app/api/skills/[skillId]/route.ts`
- Test: `src/__tests__/lib/skill-runtime-storage.test.ts`
- Test: `src/__tests__/api/skills.test.ts`
- Test: `src/__tests__/integration/skill-runtime-storage-postgres.test.ts`

**Interfaces:**
- Consumes: `dbGetUserData()`、`dbSetUserData()`、目录类型。
- Produces: `loadUserSkillCatalog()`、`copySkillForUser()`、`updateUserSkill()`、`migrateLegacyChatSkills()`。

- [ ] **Step 1: 写入所有权和版本 RED 测试**

```ts
it('复制内置 Skill 时生成 owner scoped 副本和递增版本', async () => {
  const copy = await store.copy({ actorUserId: 'user-1', sourceSkillId: 'preset-ecommerce-listing' });
  expect(copy.ownerId).toBe('user-1');
  expect(copy.builtIn).toBe(false);
  expect(copy.version).toBe(1);
  expect(copy.allowedSurfaces).toEqual(['canvas', 'workflow']);
});

it('用户不能修改他人的 Skill 副本', async () => {
  await expect(store.update({ actorUserId: 'user-2', skillId: 'skill-user-1', enabled: false }))
    .rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts`

Expected: FAIL，新存储和 API 不存在。

- [ ] **Step 3: 使用现有用户数据表持久化，不新增第二套账号体系**

```ts
const SKILL_CATALOG_KEY = 'skill_catalog_v1';

interface UserSkillEnvelope {
  schemaVersion: 1;
  revision: number;
  skills: SkillDefinition[];
  migratedLegacyIds: string[];
}

export async function saveUserSkillEnvelope(
  userId: string,
  expectedRevision: number,
  next: UserSkillEnvelope,
): Promise<void> {
  const current = parseEnvelope(await dbGetUserData(userId, SKILL_CATALOG_KEY));
  if (current.revision !== expectedRevision) throw new SkillRevisionConflictError();
  const saved = await dbSetUserData(userId, SKILL_CATALOG_KEY, { ...next, revision: expectedRevision + 1 });
  if (!saved) throw new SkillStorageError();
}
```

旧 `chat_skills` 只迁移用户自定义项；内置 `preset-*` 不复制进用户存储。迁移后记录 `migratedLegacyIds`，重复执行不新增副本。

- [ ] **Step 4: 实现 API 授权契约**

```ts
// GET /api/skills?surface=canvas|workflow|simple-chat
return NextResponse.json({ skills: await loadUserSkillCatalog(auth.user.id, surface) });

// POST /api/skills { sourceSkillId }
return NextResponse.json({ skill: await copySkillForUser(auth.user.id, sourceSkillId) }, { status: 201 });

// PATCH /api/skills/:skillId { enabled, name, description }
return NextResponse.json({ skill: await updateUserSkill(auth.user.id, skillId, patch) });
```

- [ ] **Step 5: 运行本地和隔离 PostgreSQL 测试**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts`

Run only when configured: `pnpm exec vitest run src/__tests__/integration/skill-runtime-storage-postgres.test.ts`

Expected: 本地 PASS；无隔离库时 PostgreSQL 项明确 SKIP。

- [ ] **Step 6: 提交**

```bash
git add src/lib/skill-runtime src/app/api/skills src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/api/skills.test.ts src/__tests__/integration/skill-runtime-storage-postgres.test.ts
git commit -m "feat: persist versioned user skills"
```

### Task 4: 扩展 Agent 事件支持 Skill 进度、暂停、恢复和重试

**Files:**
- Modify: `src/lib/agent-runtime/types.ts`
- Modify: `src/lib/agent-runtime/event-reducer.ts`
- Modify: `src/lib/agent-runtime/event-storage.ts`
- Modify: `src/lib/agent-runtime/service.ts`
- Modify: `src/components/agent-runtime/use-agent-run-events.ts`
- Test: `src/__tests__/lib/agent-runtime-state.test.ts`
- Test: `src/__tests__/api/agent-runs.test.ts`

**Interfaces:**
- Produces: `paused` 状态、`run.paused`、`run.resumed`、`step.retrying`、`quality.checked` 事件；`pauseAgentRun()`、`resumeAgentRun()`。
- Consumes: 现有 Agent 事件顺序、终态保护、AbortController 和原子结算。

- [ ] **Step 1: 写入状态竞争 RED 测试**

```ts
it('暂停后迟到 completed 不得越过暂停继续写终态', () => {
  const projection = reduceAgentEvents([
    event(1, 'run.created'), event(2, 'tool.started'), event(3, 'run.paused'),
    event(4, 'run.completed'),
  ]);
  expect(projection.status).toBe('paused');
  expect(projection.ignoredEventIds).toContain('event-4');
});

it('恢复后只从记录的 nextStepId 继续', () => {
  const projection = reduceAgentEvents([
    event(1, 'run.created'), event(2, 'run.paused', { nextStepId: 'generate-2' }),
    event(3, 'run.resumed', { nextStepId: 'generate-2' }),
  ]);
  expect(projection.resumeFromStepId).toBe('generate-2');
  expect(projection.status).toBe('queued');
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/api/agent-runs.test.ts`

Expected: FAIL，类型或 reducer 尚不认识新事件。

- [ ] **Step 3: 最小扩展事件类型和投影**

```ts
export type AgentRunStatus =
  | 'created' | 'queued' | 'planning' | 'awaiting-confirmation'
  | 'executing' | 'uploading' | 'paused'
  | 'completed' | 'failed' | 'cancelled' | 'timeout';

export type AgentEventType =
  | 'run.created' | 'plan.updated' | 'tool.started' | 'tool.progress'
  | 'tool.completed' | 'asset.created' | 'run.completed' | 'run.failed'
  | 'run.cancelled' | 'run.timeout' | 'run.paused' | 'run.resumed'
  | 'step.retrying' | 'quality.checked';

export interface AgentSkillInvocation {
  skillId: string;
  skillVersion: number;
  inputValues: Record<string, unknown>;
  modelBindings: Record<string, { providerId: string; modelId: string }>;
}

export interface AgentRunProjection {
  runId: string;
  status: AgentRunStatus;
  lastSequence: number;
  plan: AgentPlanStep[];
  assetVersionIds: string[];
  result?: Record<string, unknown>;
  error?: AgentRunError;
  ignoredEventIds: string[];
  missingSequences: number[];
  currentStepId?: string;
  resumeFromStepId?: string;
  progress?: number;
  qualityChecks: Array<{ stepId: string; gateId: string; passed: boolean }>;
}

export interface AgentRunRequest {
  projectId: string;
  workspace: AgentWorkspace;
  workspaceId: string;
  mode: AgentMode;
  providerId: string;
  modelId: string;
  prompt: string;
  sourceVersionIds: string[];
  allowedToolIds: string[];
  idempotencyKey: string;
  context: AgentContextSnapshot;
  skill?: AgentSkillInvocation;
}
```

`paused` 不是终态，不退款；`cancelled/failed/timeout` 仍是终态。暂停必须先以数据库条件更新接受 `run.paused`，使后续完成事件失效，再主动 abort 当前底层工作；恢复必须通过数据库 lease 重新认领，不能复用已释放的内存 Promise。

- [ ] **Step 4: 扩展客户端轮询终止条件**

```ts
const POLL_STOP_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timeout', 'paused']);
```

恢复后创建新 poller generation，旧请求回包不得更新新运行投影。

- [ ] **Step 5: 运行回归并提交**

Run: `pnpm exec vitest run src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/components/use-agent-run-events.test.ts`

Expected: PASS，既有取消、终态和乱序事件测试保持通过。

```bash
git add src/lib/agent-runtime src/components/agent-runtime/use-agent-run-events.ts src/__tests__/lib/agent-runtime-state.test.ts src/__tests__/api/agent-runs.test.ts src/__tests__/components/use-agent-run-events.test.ts
git commit -m "feat: add durable skill run controls"
```

### Task 5: 模型冻结、费用预估与 Skill Run 请求

**Files:**
- Create: `src/lib/skill-runtime/run-request.ts`
- Create: `src/lib/skill-runtime/cost-estimator.ts`
- Create: `src/app/api/skill-runs/estimate/route.ts`
- Test: `src/__tests__/lib/skill-runtime-run-request.test.ts`
- Test: `src/__tests__/api/skill-run-estimate.test.ts`

**Interfaces:**
- Consumes: `requireSkillForSurface()`、`resolveTaskModel()`、`calculateConfiguredCreditCost()`、资产上下文授权。
- Produces: `SkillRunRequest`、`buildSkillAgentRunRequest()`、`estimateSkillRunCost()`。

- [ ] **Step 1: 写入供应商冻结和作用域 RED 测试**

```ts
it('为每个模型角色冻结 providerId + modelId', async () => {
  const request = await buildSkillAgentRunRequest(input);
  expect(request.skill.modelBindings).toEqual({
    orchestrator: { providerId: 'pear-chat', modelId: 'gemini-3.1-flash' },
    image: { providerId: 'pear-image', modelId: 'gpt-image-2' },
  });
});

it('simple-chat 伪造画布 Skill 在扣费前拒绝', async () => {
  await expect(buildSkillAgentRunRequest({ ...input, surface: 'simple-chat' }))
    .rejects.toMatchObject({ code: 'SKILL_SURFACE_FORBIDDEN', status: 403 });
  expect(calculateCost).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts`

Expected: FAIL，新请求与估价模块不存在。

- [ ] **Step 3: 实现冻结请求**

```ts
export interface SkillRunRequest {
  skillId: string;
  skillVersion: number;
  surface: SkillSurface;
  projectId: string;
  workspaceId: string;
  inputValues: Record<string, unknown>;
  sourceVersionIds: string[];
  modelBindings: Partial<Record<SkillModelBinding['role'], { providerId: string; modelId: string }>>;
  idempotencyKey: string;
}

export async function buildSkillAgentRunRequest(input: SkillRunRequest): Promise<AgentRunRequest> {
  const skill = requireSkillForSurface(input.skillId, input.surface);
  const resolved = resolveSkillInputs(skill, input.inputValues);
  const bindings = await authorizeAndFreezeBindings(input.modelBindings, skill.steps);
  return {
    projectId: input.projectId,
    workspace: input.surface === 'simple-chat' ? 'chat' : input.surface,
    workspaceId: input.workspaceId,
    mode: 'agent',
    providerId: bindings.orchestrator.providerId,
    modelId: bindings.orchestrator.modelId,
    prompt: compileSkillPrompt(skill.systemPrompt, resolved),
    sourceVersionIds: input.sourceVersionIds,
    allowedToolIds: [...new Set(skill.steps.map(step => step.toolId))],
    idempotencyKey: input.idempotencyKey,
    context: buildSkillContext(input),
    skill: { skillId: skill.id, skillVersion: skill.version, inputValues: resolved, modelBindings: bindings },
  };
}
```

`Agent Runtime` 增加只供服务端调用的计费报价；客户端请求中的费用字段一律忽略：

```ts
export interface AgentRunBillingQuote {
  creditCost: number;
  label: string;
}

async function createRun(input: {
  actor: User;
  request: AgentRunRequest;
  billingQuote?: AgentRunBillingQuote;
}): Promise<AgentRunCreateResult> {
  const creditCost = input.billingQuote?.creditCost
    ?? await dependencies.calculateCreditCost('agent_edit', input.request.modelId, {
      providerId: input.request.providerId,
    });
  // 下方现有 createBillableTask 调用继续使用这个 creditCost，其他任务创建字段不变。
}
```

- [ ] **Step 4: 实现执行前逐步骤费用预估**

```ts
export async function estimateSkillRunCost(skill: SkillDefinition, bindings: FrozenBindings) {
  const steps = await Promise.all(skill.steps.map(async step => ({
    stepId: step.id,
    cost: await calculateConfiguredCreditCost(toolCostType(step.toolId), bindings[step.modelRole].modelId, {
      providerId: bindings[step.modelRole].providerId,
    }),
  })));
  return { minimum: steps.reduce((sum, step) => sum + step.cost, 0), maximum: steps.reduce((sum, step) => sum + step.cost, 0), steps };
}
```

估价接口只读，不创建 `cloud_tasks`、不写流水、不扣积分。

`createSkillRun()` 必须在服务端重新计算同一报价，并以 `billingQuote` 调用 Agent Runtime；同一 `runId` 的暂停、恢复和失败步骤重试不再次扣费。只有创建新的 Skill Run 才创建新账务边界。

- [ ] **Step 5: 运行聚焦测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-admission-gate.test.ts`

Expected: PASS，错配、未授权、模型能力不足在创建任务前拒绝。

```bash
git add src/lib/skill-runtime src/app/api/skill-runs/estimate src/lib/agent-runtime/types.ts src/lib/agent-runtime/service.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/api/skill-run-estimate.test.ts
git commit -m "feat: freeze and estimate skill execution"
```

### Task 6: 建立数据库幂等的 Skill 执行器

**Files:**
- Create: `src/lib/skill-runtime/executor.ts`
- Create: `src/lib/skill-runtime/service.ts`
- Create: `src/app/api/skill-runs/route.ts`
- Create: `src/app/api/skill-runs/[runId]/route.ts`
- Create: `src/app/api/skill-runs/[runId]/retry/route.ts`
- Modify: `src/lib/agent-runtime/service.ts`
- Modify: `src/lib/agent-runtime/same-task-adapter.ts`
- Test: `src/__tests__/lib/skill-runtime-executor.test.ts`
- Test: `src/__tests__/api/skill-runs.test.ts`
- Test: `src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts`

**Interfaces:**
- Consumes: Agent Runtime、`createBillableCloudTask()`、`adoptAndExecuteExistingAgentTask()`、质量门禁、资产版本投影。
- Produces: `createSkillRun()`、`pauseSkillRun()`、`resumeSkillRun()`、`retrySkillStep()`。

- [ ] **Step 1: 写入并发、失败退款和迟到结果 RED 测试**

```ts
it('同用户同幂等键并发只创建一个 run 且只扣费一次', async () => {
  const [a, b] = await Promise.all([service.create(input), service.create(input)]);
  expect(a.runId).toBe(b.runId);
  expect(chargeTransactions()).toHaveLength(1);
});

it('质量门禁失败只退款一次且迟到 completed 被拒绝', async () => {
  await service.execute(inputWithFailingQualityGate);
  await service.appendLateCompleted(runId);
  expect(await taskStatus(runId)).toBe('failed');
  expect(refundTransactions(runId)).toHaveLength(1);
});

it('重试从失败步骤开始而不重复已完成步骤', async () => {
  const retry = await service.retry({ runId, stepId: 'generate-3' });
  expect(retry.startedStepIds).toEqual(['generate-3', 'quality-3']);
});

it('运行历史返回 Skill 版本、步骤、结果版本和最终账务状态', async () => {
  const history = await service.list({ actorUserId: 'user-1', limit: 20 });
  expect(history[0]).toMatchObject({
    skillId: 'preset-ecommerce-listing', skillVersion: 1,
    assetVersionIds: ['result-version-1'], creditStatus: 'charged',
  });
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts`

Expected: FAIL，新服务和 API 不存在。

- [ ] **Step 3: 实现顺序/并行步骤调度**

```ts
for (const group of groupSkillSteps(definition.steps)) {
  assertRunStillExecutable(runId);
  const results = group.parallel
    ? await Promise.all(group.steps.map(step => executeStep(run, step, signal)))
    : [await executeStep(run, group.steps[0], signal)];
  for (const result of results) {
    const checks = runSkillQualityGates(result.step.qualityGateIds, result, context);
    await appendQualityEvents(runId, result.step.id, checks);
    if (checks.some(check => !check.passed)) throw new SkillQualityFailedError(result.step.id, checks);
  }
}
```

底层每一步使用 `executeDurableAgentDownstreamOperation()` 的 `operationKey` 和数据库 lease；禁止使用进程内 `Map` 作为幂等真相。

- [ ] **Step 4: 实现控制端点**

```ts
// PATCH /api/skill-runs/:runId { action: 'pause' | 'resume' | 'cancel' }
switch (body.action) {
  case 'pause': return json(await pauseSkillRun(auth.user.id, runId));
  case 'resume': return json(await resumeSkillRun(auth.user.id, runId));
  case 'cancel': return json(await cancelAgentRun({ actorUserId: auth.user.id, runId }));
  default: throw new SkillRunRequestError('action is invalid');
}

// GET /api/skill-runs?limit=20
return json({
  runs: await listSkillRuns({ actorUserId: auth.user.id, limit: parseLimit(request) }),
});
```

- [ ] **Step 5: 运行本地和 PostgreSQL 并发测试**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/agent-runtime-accounting.test.ts`

Run only when configured: `pnpm exec vitest run src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts`

Expected: 本地 PASS；隔离 PostgreSQL 验证同键并发、取消/失败竞态、一扣一退和终态不可逆。

- [ ] **Step 6: 提交**

```bash
git add src/lib/skill-runtime src/lib/agent-runtime src/app/api/skill-runs src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts
git commit -m "feat: execute durable skill workflows"
```

### Task 7: 共用结构化输入和运行进度组件

**Files:**
- Create: `src/components/skill-runtime/SkillInputFields.tsx`
- Create: `src/components/skill-runtime/SkillRunProgress.tsx`
- Create: `src/components/skill-runtime/use-skill-run.ts`
- Test: `src/__tests__/components/skill-runtime-controls.test.tsx`

**Interfaces:**
- Consumes: Skill 定义、估价 API、Skill Run API、Agent 事件投影。
- Produces: `SkillInputFields`、`SkillRunProgress`、`useSkillRun()`。

- [ ] **Step 1: 写入控件与旧响应隔离 RED 测试**

```tsx
it('按字段类型渲染输入且显示执行前积分预估', async () => {
  render(<SkillInputFields definition={skill} value={{}} onChange={onChange} />);
  expect(screen.getByLabelText('产品名称')).toBeVisible();
  expect(screen.getByLabelText('参考图片')).toBeVisible();
});

it('切换运行后旧轮询响应不能覆盖新运行', async () => {
  const { rerender } = render(<Harness runId="run-1" />);
  rerender(<Harness runId="run-2" />);
  resolveRun1(completedProjection);
  expect(screen.queryByText('run-1 已完成')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现控件和运行控制**

```tsx
export function SkillRunProgress({ projection, estimate, onPause, onResume, onCancel, onRetry }: Props) {
  return <section aria-live="polite">
    <div>预计消耗 {estimate.minimum} 积分</div>
    <progress value={projection.progress ?? 0} max={100} />
    {projection.plan.map(step => <div key={step.id}>{step.label} · {step.status}</div>)}
    {projection.status === 'paused'
      ? <button onClick={onResume}>继续</button>
      : !isTerminal(projection.status) && <button onClick={onPause}>暂停</button>}
    {!isTerminal(projection.status) && <button onClick={onCancel}>取消</button>}
    {projection.error?.retryable && <button onClick={onRetry}>从失败步骤重试</button>}
  </section>;
}
```

- [ ] **Step 4: 运行组件回归并提交**

Run: `pnpm exec vitest run src/__tests__/components/skill-runtime-controls.test.tsx src/__tests__/components/agent-progress-timeline.test.tsx src/__tests__/components/use-agent-run-events.test.ts`

Expected: PASS，无固定长等待。

```bash
git add src/components/skill-runtime src/__tests__/components/skill-runtime-controls.test.tsx
git commit -m "feat: add shared skill run controls"
```

### Task 8: 将无限画布 AI 对话迁入统一内核

**Files:**
- Modify: `src/components/chat-panel.tsx:49-64,1749-3075,3821-5035,7096-7319`
- Create: `src/lib/skill-runtime/canvas-client.ts`
- Test: `src/__tests__/components/chat-panel-skill-runtime.test.tsx`
- Test: `src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`

**Interfaces:**
- Consumes: `GET /api/skills?surface=canvas`、估价/运行 API、共享输入和进度组件。
- Produces: 画布 Skill 选择、结构化输入、运行、暂停/取消/重试、结果入画布。

- [ ] **Step 1: 写入 21 项、真实运行与零覆盖 RED 测试**

```ts
it('画布只请求 canvas 目录并显示全部 21 个 Skill', () => {
  expect(source).toContain("/api/skills?surface=canvas");
  expect(source).not.toContain('const LOVART_PRESET_SKILLS');
});

it('Skill 结果创建新资产版本而不覆盖来源版本', async () => {
  await runCanvasSkill();
  expect(onAddImages).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ parentVersionIds: ['source-version-1'] }),
  ]));
  expect(replaceSourceImage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts`

Expected: FAIL，组件仍使用内嵌目录和普通聊天发送。

- [ ] **Step 3: 最小替换目录与执行接线**

```ts
const { skills, activeSkill, selectSkill } = useCanvasSkillCatalog(projectId);
const skillRun = useSkillRun({ projectId, workspaceId: currentSessionId, surface: 'canvas' });

const handleRunSkill = async () => {
  const estimate = await skillRun.estimate({ skillId: activeSkill.id, inputValues, sourceVersionIds, modelBindings });
  setPendingEstimate(estimate);
  await skillRun.start({ skillId: activeSkill.id, inputValues, sourceVersionIds, modelBindings });
};
```

保留现有搜索、推荐、我的 Skills、保存为 Skill 和服务器同步入口；旧 `chat_skills` 只由兼容迁移器读取，组件不再直接维护第二套运行状态。

- [ ] **Step 4: 运行画布回归并提交**

Run: `pnpm exec vitest run src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/chat-panel-generation-recovery-contract.test.ts src/__tests__/components/agent-runtime-surface-wiring.test.ts`

Expected: PASS，21 个 ID、搜索/推荐/我的 Skills 和普通聊天均不回归。

```bash
git add src/components/chat-panel.tsx src/lib/skill-runtime/canvas-client.ts src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts
git commit -m "feat: run canvas skills through shared runtime"
```

### Task 9: 在节点模式增加同源 `ai-skill` 节点

**Files:**
- Modify: `src/lib/workflow-engine.ts:22-90,1715-2445`
- Modify: `src/components/node-editor.tsx:98-420,1021,2400-2600,3229-3285,3490-4210`
- Modify: `src/app/api/workflow/execute/route.ts`
- Test: `src/__tests__/lib/workflow-skill-node.test.ts`
- Test: `src/__tests__/components/node-editor-skill-node.test.tsx`
- Test: `src/__tests__/api/workflow-skill-execution.test.ts`

**Interfaces:**
- Consumes: `GET /api/skills?surface=workflow`、Skill Run 服务、Workflow 上游输入和资产版本。
- Produces: `NodeType = 'ai-skill'`、Skill 节点配置与输出。

- [x] **Step 1: 写入节点目录、输入映射和输出 RED 测试**

```ts
it('ai-skill 节点只列出 21 个 workflow Skill', async () => {
  expect(await loadWorkflowSkills()).toHaveLength(21);
  expect(await loadWorkflowSkills()).not.toContainEqual(expect.objectContaining({ id: 'ppt-master' }));
});

it('把上游文本和图片版本映射为 Skill 输入', () => {
  expect(buildNodeExecutionRequest(node, inputs)).toEqual({
    endpoint: '/api/skill-runs', method: 'POST',
    body: expect.objectContaining({
      skillId: 'preset-ecommerce-listing', surface: 'workflow',
      sourceVersionIds: ['version-1'], inputValues: expect.objectContaining({ product: '耳机' }),
    }),
  });
});
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/api/workflow-skill-execution.test.ts`

Expected: FAIL，`ai-skill` 尚未定义。

- [x] **Step 3: 增加节点类型和标准端口**

```ts
// NodeType
| 'ai-skill'

// buildNodeExecutionRequest
case 'ai-skill':
  return {
    endpoint: '/api/skill-runs',
    method: 'POST',
    body: {
      skillId: getConfigString(config, 'skillId'),
      skillVersion: getConfigNumber(config, 'skillVersion', 1),
      surface: 'workflow',
      projectId: getConfigString(config, 'projectId'),
      workspaceId: getConfigString(config, 'workflowId'),
      inputValues: config.skillInputs || {},
      sourceVersionIds: getConfigStringArray(config, 'sourceVersionIds'),
      modelBindings: config.modelBindings || {},
      idempotencyKey: getConfigString(config, 'idempotencyKey'),
    },
  };
```

标准端口：`prompt`、`image`、`reference` 输入；`image`、`prompt`、`task` 输出。节点属性面板按选中 Skill 的 `inputs` 动态渲染，不在节点文件复制 21 份表单。

- [x] **Step 4: 复用运行投影并保持撤销重做**

Skill 节点只保存 `skillId/version/inputValues/modelBindings/runId`；进度、错误和结果从 Skill Run 投影读取。创建、修改、删除 Skill 节点必须进入现有节点历史栈。

- [x] **Step 5: 运行节点回归并提交**

Run: `pnpm exec vitest run src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/api/workflow-skill-execution.test.ts src/__tests__/components/node-editor-history-baseline-contract.test.ts src/__tests__/components/node-editor-execution-wiring.test.ts src/__tests__/lib/workflow-engine.test.ts`

Expected: PASS，现有 NodeType、连线、保存、刷新和撤销重做不减少。

```bash
git add src/lib/workflow-engine.ts src/components/node-editor.tsx src/app/api/workflow/execute/route.ts src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/api/workflow-skill-execution.test.ts
git commit -m "feat: add shared skill workflow nodes"
```

### Task 10: 对独立智能对话建立双层隔离门禁

**Files:**
- Modify: `src/components/simple-chat/chat-area.tsx:2090-2105,2380-2480,2913-末尾`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Test: `src/__tests__/components/simple-chat-skill-isolation.test.tsx`
- Test: `src/__tests__/api/simple-chat-skill-scope.test.ts`

**Interfaces:**
- Consumes: `SIMPLE_CHAT_PRESET_SKILLS`。
- Produces: Simple Chat UI 只展示 16 个；后端拒绝画布 Skill ID。

- [x] **Step 1: 写入 UI 和服务端越权 RED 测试**

```ts
it('独立智能对话只显示 16 个自身 Skill', () => {
  render(<SimpleChatHarness />);
  expect(screen.getByText('PPT大师')).toBeVisible();
  expect(screen.queryByText('电商商品套图')).not.toBeInTheDocument();
});

it('伪造画布 Skill ID 返回稳定错误且不调用模型', async () => {
  const response = await postSimpleChat({ skillId: 'preset-ecommerce-listing' });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ success: false, code: 'SKILL_SURFACE_FORBIDDEN' });
  expect(providerCall).not.toHaveBeenCalled();
});
```

- [x] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-skill-isolation.test.tsx src/__tests__/api/simple-chat-skill-scope.test.ts`

Expected: 至少服务端越权用例 FAIL。

- [x] **Step 3: 最小接入双层门禁**

```ts
if (body.skillId) {
  requireSkillForSurface(body.skillId, 'simple-chat');
}
```

前端继续读取 `SIMPLE_CHAT_PRESET_SKILLS`，不请求 `surface=canvas` 或 `surface=workflow`。跨工作区资产发送功能保持显式操作，不据此共享 Skill 目录。

- [x] **Step 4: 运行 Simple Chat 全回归并提交**

Run: `pnpm exec vitest run src/__tests__/components/simple-chat-skill-isolation.test.tsx src/__tests__/api/simple-chat-skill-scope.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts src/__tests__/components/simple-chat-project-selection.test.ts src/__tests__/components/simple-chat-asset-transfer.test.ts src/__tests__/api/simple-chat-auth.test.ts`

Expected: PASS，16 个 Skill、模型菜单、项目同步、刷新恢复和跨账号隔离不回归。

```bash
git add src/components/simple-chat src/app/api/simple-chat/chat/route.ts src/__tests__/components/simple-chat-skill-isolation.test.tsx src/__tests__/api/simple-chat-skill-scope.test.ts
git commit -m "fix: isolate simple chat skill catalog"
```

### Task 11: 保护清单、全量回归和三浏览器 E2E

**Files:**
- Modify: `scripts/stage-4-inventory.mjs`
- Modify: `scripts/check-protected-baseline.mjs`
- Create: `tests/e2e/skill-runtime-canvas-workflow.spec.ts`
- Create: `tests/e2e/skill-runtime-simple-chat-isolation.spec.ts`
- Modify: `playwright.config.ts`
- Test: `src/__tests__/scripts/skill-runtime-inventory.test.ts`

**Interfaces:**
- Consumes: 两套目录、Canvas/Workflow/Simple Chat 入口、Playwright 证据配置。
- Produces: 21/16 数量门禁和 Chromium/Firefox/WebKit 核心证据。

- [x] **Step 1: 写入保护清单 RED 测试**

```ts
expect(inventory.skillCatalogs.canvas).toHaveLength(21);
expect(inventory.skillCatalogs.workflow).toEqual(inventory.skillCatalogs.canvas);
expect(inventory.skillCatalogs.simpleChat).toHaveLength(16);
expect(intersection(inventory.skillCatalogs.canvas, inventory.skillCatalogs.simpleChat)).toEqual([]);
expect(inventory.nodeTypes).toContain('ai-skill');
```

- [x] **Step 2: 运行清单测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/scripts/skill-runtime-inventory.test.ts`

Expected: FAIL，清单尚未输出 Skill 作用域。

- [x] **Step 3: 增加 E2E 场景和失败证据**

```ts
test('画布 Skill 与节点 Skill 共用同一任务和结果版本', async ({ page }) => {
  await loginFixture(page, 'canvas-user');
  await openCanvasSkill(page, '电商商品套图');
  await fillSkillInputs(page, { product: '测试耳机', features: '降噪' });
  const canvasRun = await runSkill(page);
  await expect(page.getByText('已完成')).toBeVisible();
  await openWorkflow(page);
  await addSkillNode(page, '电商商品套图');
  const workflowRun = await runWorkflowSkill(page);
  expect(workflowRun.skillId).toBe(canvasRun.skillId);
});

test('独立智能对话无法检出画布 Skill', async ({ page }) => {
  await openSimpleChat(page);
  await page.getByTitle('Skill').click();
  await expect(page.getByText('PPT大师')).toBeVisible();
  await expect(page.getByText('电商商品套图')).toHaveCount(0);
});
```

Playwright 失败必须保留 screenshot、video、trace、console 和 network；不得用固定长 `sleep` 代替状态等待。

- [ ] **Step 4: 运行完整本地门禁（代码门禁通过；隔离 PostgreSQL 与三浏览器业务断言受环境阻塞）**

Run in order:

```bash
pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/api/skills.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/components/chat-panel-skill-runtime.test.tsx src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/simple-chat-skill-isolation.test.tsx
pnpm ts-check
pnpm exec eslint . --quiet
pnpm test
pnpm check:protected-baseline
$env:NODE_OPTIONS='--max-old-space-size=8192'; pnpm build
pnpm exec playwright test tests/e2e/skill-runtime-canvas-workflow.spec.ts tests/e2e/skill-runtime-simple-chat-isolation.spec.ts --project=chromium --project=firefox --project=webkit
```

Expected: 0 failed；PostgreSQL 跳过项单独计数，不冒充通过；构建页数不得少于基线 118。

- [x] **Step 5: 提交测试门禁**

```bash
git add scripts/stage-4-inventory.mjs scripts/check-protected-baseline.mjs tests/e2e/skill-runtime-canvas-workflow.spec.ts tests/e2e/skill-runtime-simple-chat-isolation.spec.ts playwright.config.ts src/__tests__/scripts/skill-runtime-inventory.test.ts
git commit -m "test: gate scoped skill runtime"
```

### Task 12: 文档、Obsidian、推送与 Coze 真实验收

> 2026-09-06 当前执行表覆盖下方历史版本断点：业务候选 main@93804a66269f7b8010183d45ef4c25048cb84f8e，tree bfc347ac26ffca9dc8c8fef258d0fbebbcc898da，已推送且工作树干净。新候选的Coze同步尚未发送。下方Step 3勾选只证明历史版本，不证明新候选运行；Step 4/5继续保持未完成。文档提交可后续变化，业务候选与部署目标必须分别记录。

| 顺序 | 唯一待执行动作 | 已有证据，不重复实施 | 本次关闭所需证据与停止条件 |
| --- | --- | --- | --- |
| 1 | 正确Chrome现有项目页恢复控制后读取执行状态，再单次同步93804a66 | main已推送；stable保持52f7c601 | Coze目标提交、源码tree、构建退出码、BuildID及唯一5000进程；若已有构建在运行，只观察，不重发或重启 |
| 2 | 沙箱启动后强刷现有预览，复用run58fa70c2-e347-45af-b505-fac910842443的大图预览与下载 | 节点真实成品、单扣62、保存刷新已通过；弹窗本地六组视口通过 | 真实切片蛋糕大图可见，下载与assetVersion e819d7ba-7cbb-4984-b444-f02d3a118104对应，解码尺寸与资产一致；画布整只蛋糕是不同资产，禁止替代 |
| 3 | 对修复后新任务验证租约与元数据；优先合并为一次Canvas图片Skill成功样本 | TEST-SKILL-009/010本地隔离PG已通过；旧成功任务不可能证明新写入逻辑 | 真实输入图、冻结provider/model、报价、run/子task/request身份、completed_at>0且owner清空、新版本真实宽高/MIME/字节、一扣无退；请求结果不明时先查原run，不重复创建 |
| 4 | 手动暂停后恢复，并验证完成 | 手动暂停后取消及按钮终态已有云端证据 | 同run恢复、已完成步骤不重跑、成功结果与账务一致；可在第3项同一运行中进行，错过暂停窗口不伪称通过 |
| 5 | 失败步骤重试后成功交付 | 6b1b53b7-99ed-43aa-84a7-7fc17737f91c曾真实重试，generation=1且未重跑规划；见2026-09-04-skill-step-cloud-check.md | 先只读检查旧run冻结配置和当前状态，不能擅改快照；需要证明重试成功、资产新版本和账务一致，而非重复验证按钮存在；不可用供应商不得用于样本 |
| 6 | 汇总取消/退款与迟到结果的任务级证据 | 67bfbf02-4b7c-4e13-9594-c7afec9648b0已有取消UI及同时间窗-62/+62 | 只读关联父子task与流水ID，终态不可回写、退款一次；时间窗匹配不能代替task关联，缺项才补测试 |
| 7 | 归档新鲜浏览器证据并更新阶段状态 | 本地全仓5304通过加12项真库补验；节点专项最终33/33；Stage4冻结 | 每个样本记录版本、时间、截图、Console、Network、Trace及任务身份；不能取得的项保留未验证。全部满足后才勾选Step4/5和更新Obsidian阶段完成 |

连接失败仅阻断云端步骤，不证明业务失败；不使用360、不新建标签、不重复本地门禁、不启动下一批功能。目录21/21/16历史真实验证保留，仅在新部署检查有无回归。Task12不采用不断增长的主观百分比作为完成依据。

> 2026-09-04版本边界：下方Step 2/3的366b90b2与4d6d8ffa是历史验收，不证明当前修复版db41a5c5已完成云端构建和重启。当前版已推送且Coze已报告合并tree=f68010ad3f096846936a967a570068ab40971729；最终构建、重启、刷新和Step 4业务验收仍待证据。普通全量4956通过/144跳过，144项已另行真实PostgreSQL补验。现有skill-runtime-canvas-workflow.spec.ts使用受控HTTP供应商和1像素PNG，只证明编排契约，不证明远端模型质量。不得将这些结果代替Chrome真实成品验收，也不得因此启动下一批功能。

**Files:**
- Modify: `docs/testing/FUNCTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify outside repo: `F:\AIGC\vault-template\无界计划\11-阶段进度看板.md`
- Modify outside repo: `F:\AIGC\vault-template\无界计划\16-V5.8.8选择性吸收.md`

**Interfaces:**
- Consumes: 本地测试输出、Git SHA、Coze exact tree、Chrome 任务/积分/资产证据。
- Produces: 阶段验收记录和下一阶段唯一断点。

- [x] **Step 1: 记录本地结果和未验证项**

报告必须包含：

```text
Git HEAD / origin/main / origin/stable
21 个 Canvas Skills / 21 个 Workflow Skills / 16 个 Simple Chat Skills
聚焦、全仓、PostgreSQL、三浏览器通过/失败/跳过数
构建页数与保护门禁结果
并发幂等、一扣一退、暂停恢复、迟到结果、资产版本证据
无法验证的真实供应商或隔离数据库项
```

- [x] **Step 2: 推送 `main` 并复读远端**

```bash
git status --short
git push origin main
git fetch origin main stable
git rev-parse HEAD
git rev-parse origin/main
git rev-parse origin/stable
```

Expected: `HEAD == origin/main`；`origin/stable` 仍为 `52f7c601ed150769e15d06fb435c6e360e28c9e7`；四个受保护未跟踪路径未提交。

实测：`HEAD == origin/main == 366b90b2d66a2b1a524e11ad879a76ed82cf350c`；`origin/stable == 52f7c601ed150769e15d06fb435c6e360e28c9e7`。仅 Task 12 报告与进度文档留在工作树，受保护未跟踪路径未提交或删除。

- [x] **Step 3: Coze 同步和重启**

在现有 Google Chrome 项目页发送一次精确同步指令：只普通合并 `origin/main`、证明 tree 一致、运行门禁、按现有脚本重启唯一 5000 服务。项目页出现沙箱断开弹窗时只刷新现有项目页；沙箱恢复后强刷现有预览页。

实测：Coze 普通合并 `origin/main@366b90b2d66a2b1a524e11ad879a76ed82cf350c`，最终运行 merge commit `4d6d8ffa` 的源码 tree `ee1648ca` 与 `366b90b2^{tree}` 精确一致；`origin/stable@52f7c601ed150769e15d06fb435c6e360e28c9e7` 未变化。聚焦测试 `14/14`、保护基线 `6/6`、TypeScript、ESLint、分批全量 Vitest `2785 + 1088` 项和生产构建 `119/119` 通过；PostgreSQL 项因无隔离测试库保持跳过。唯一 5000 服务 PID 为 `41123`，进程环境 `WUJIE_ASSET_GRAPH_MODE=asset-v3`，Build ID `Fy1oaJhiRjviq5WXmj4YR`，`/`、`/simple-chat`、`/api/auth/me` 均为 HTTP 200。

- [ ] **Step 4: Chrome 真实验收**

使用已登录账号并记录：

1. 画布目录 21 项，运行至少一个带图片 Skill；
2. 节点目录同一 21 项，创建 Skill 节点并运行；
3. `/simple-chat` 目录 16 项且无任何画布 Skill；
4. 模型与供应商精确匹配提交参数；
5. 执行前积分预估与最终一扣一致；
6. 暂停/恢复、取消/退款、失败重试各一次；
7. 结果创建新 AssetVersion，不覆盖原始素材；
8. 刷新后运行历史、进度和结果恢复；
9. Console error/warning、Network、taskId、requestId、积分前后值、截图和 Trace。

2026-09-03 非付费目录验收已完成：管理员登录及项目仪表盘正常；一个 3 图片项目可加载；Canvas AI 对话显示并展开 21 项 Skills；Workflow `Skill 执行`节点下拉显示同一 21 项；独立 `/simple-chat` 的 Skill 书显示独立 16 项，未混入画布目录。服务切换后首次进入项目曾出现 `Loading chunk 5900 failed`，再次加载当前构建后恢复，作为部署缓存风险保留。真实 Skill 执行、模型/供应商冻结、积分预估与扣退、暂停/恢复/取消/重试、AssetVersion、刷新恢复和完整 Console/Network/Trace 仍未验证，因此 Step 4 不标记完成。

- [ ] **Step 5: 更新 Obsidian 并提交最终证据**

2026-09-04 增量断点：手动暂停后取消已在Chrome通过父级终态与按钮消失，runId为67bfbf02-4b7c-4e13-9594-c7afec9648b0；同时间窗-62/+62流水各一条，但没有数据库taskId关联证明。步骤列表为空已稳定复现并在main@e43a12fe完成前端最小修复与本地门禁，尚未Coze部署，因此Step4仍未完成。下一次不重复旧取消测试；先部署并验证新版冻结步骤，再补成功AssetVersion、节点运行、暂停恢复、失败重试与刷新历史等缺口。全平台发布级数据库和浏览器证据不得被单样本替代。精确清单以docs/testing/UNVERIFIED_ITEMS.md的2026-09-04节为准。

只在云端证据完整后把本阶段标记完成；任何未验证项保留“未验证”，不写成通过。

```bash
git add docs/testing
git commit -m "docs: record scoped skill runtime verification"
git push origin main
```

## 完成判定

- 21 个画布 Skills 已同源运行于无限画布与节点模式；
- 16 个独立智能对话 Skills 保持独立且画布 Skill 无法越权进入；
- 结构化输入、顺序/并行步骤、阶段进度、暂停、取消、重试、恢复、模型冻结、费用预估、数据库幂等、失败退款、质量门禁、版本、复制、启停、权限和历史追踪均有永久测试；
- 原始素材不被覆盖，结果版本可追踪；
- 本地全量、保护门禁、构建和三浏览器核心回归通过；
- Coze exact tree 与真实任务/积分/资产证据闭环；
- `stable` 未触碰；
- Obsidian 已更新且没有重复实施已冻结阶段。

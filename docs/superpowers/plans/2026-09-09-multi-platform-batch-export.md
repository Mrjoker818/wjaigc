# Multi-Platform Batch Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不调用 AI/GPU、不覆盖源素材的前提下，把 1～20 个受管图片版本批量转换为多个平台尺寸，生成独立派生 AssetVersion、可恢复 ZIP 和严格一致的 manifest，并让无限画布、节点模式和独立智能对话共享同一运行结果。

**Architecture:** 在统一 Skill Runtime 中增加向后兼容的 `local` 步骤运行类型；新建 `multi-platform-export` 领域模块负责预设冻结、输出规划、Sharp 转换、命名、制品和结构化结果。所有图片、manifest 与 ZIP 均通过现有 AssetService 和对象存储持久化，运行、事件、取消、恢复和幂等继续由统一 Agent/Skill 内核承载，三个工作区只做不同的输入与结果投影。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 5、PostgreSQL、Sharp 0.35、JSZip 3.10、Vitest 3、Playwright。

## Global Constraints

- 只修改和推送 `main`；`stable` 保持只读。
- V5.8.8 只作只读参考，不复制其整体架构。
- 只接受当前用户、当前项目内 1～20 个受管图片 AssetVersion；同一来源只允许出现一次。
- 平台目标至少 1 个，最多 20 个；笛卡尔积最多 100 个输出。
- 只支持 `cover` 和 `contain`；禁止拉伸。
- CPU 仅执行 Sharp 转换、清单生成和 ZIP 打包；不调用 AI 模型、不使用本地 GPU。
- 零模型运行的预估、扣除和退款均为 0，不得创建虚假模型绑定或积分流水。
- 每个成功图片输出创建独立 `kind: 'image'` AssetVersion；manifest 与 ZIP 分别创建 `kind: 'document'` AssetVersion。
- 原始 Asset、AssetVersion 和 Placement 均不得修改或覆盖。
- 部分成功使用现有 `failed` 终态，并在结构化结果中记录 `outcome: 'partial_success'`；不新增 `partial` 状态。
- Canvas/Workflow 现有 21 个 Skill 的 ID、版本和工作区边界不得减少；Simple Chat 不展示 Canvas Skills 目录。
- 功能标志 `MULTI_PLATFORM_EXPORT_ENABLED` 默认关闭；云端 exact commit 验收前不得全量开放。
- 所有服务端错误继续使用 `requestId`、`code`、`message`、`retryable`，日志不得记录令牌、密钥或完整用户图片。

---

### Task 1: 为 Skill Runtime 增加零模型本地步骤

**Files:**
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/step-compiler.ts`
- Modify: `src/lib/skill-runtime/cost-estimator.ts`
- Modify: `src/lib/skill-runtime/run-request.ts`
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/agent-runtime/types.ts`
- Modify: `src/lib/agent-runtime/service.ts`
- Test: `src/__tests__/lib/skill-runtime-local-step.test.ts`
- Test: `src/__tests__/lib/skill-runtime-cost-estimator.test.ts`
- Test: `src/__tests__/lib/skill-runtime-run-request.test.ts`
- Test: `src/__tests__/lib/skill-runtime-executor.test.ts`

**Interfaces:**
- Produces: `SkillStepDefinition.runtime?: 'model' | 'local'`，缺省值为 `model`。
- Produces: `modelRole?: SkillModelBinding['role']`，仅 `runtime: 'local'` 可省略。
- Produces: `AgentRunRequest.executionRuntime?: 'model' | 'local'`；`local` 请求不包含 provider/model。
- Produces: `requiredSkillModelRoles(skill): SkillModelRole[]`，纯本地 Skill 返回空数组。
- Produces: `skillStepCreditCost(step, bindings, dependencies): Promise<number>`，本地步骤恒为 0。
- Produces: `SkillDefinition.catalogSurfaces?: readonly SkillSurface[]`；缺省等于 `allowedSurfaces`，用于允许 Simple Chat 调用但不在其目录展示。
- Produces: `validateSkillStep(step): SkillStepDefinition`，集中拒绝 local/model 非法字段组合。

- [ ] **Step 1: 写入本地步骤类型与非法组合的失败测试**

```ts
const localStep = {
  id: 'export', label: '批量导出', toolId: 'multi_platform_export',
  runtime: 'local' as const, execution: 'sequential' as const,
  promptTemplate: '', qualityGateIds: ['output-present'],
};
expect(validateSkillStep(localStep)).toEqual(localStep);
expect(() => validateSkillStep({ ...localStep, modelRole: 'image' }))
  .toThrow('SKILL_LOCAL_STEP_MODEL_ROLE_FORBIDDEN');
expect(() => validateSkillStep({ ...localStep, runtime: 'model' }))
  .toThrow('SKILL_MODEL_BINDING_REQUIRED');
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-local-step.test.ts`

Expected: FAIL，因为 `runtime` 尚不存在，纯本地定义仍被要求绑定模型。

- [ ] **Step 3: 实现向后兼容的步骤判别类型与统一归一化函数**

```ts
export type SkillStepRuntime = 'model' | 'local';

export function skillStepRuntime(step: SkillStepDefinition): SkillStepRuntime {
  return step.runtime ?? 'model';
}

export function skillStepModelRole(step: SkillStepDefinition): SkillModelBinding['role'] | undefined {
  return skillStepRuntime(step) === 'model' ? step.modelRole : undefined;
}
```

同步让 step compiler、冻结定义解析和已有快照把缺失 `runtime` 解释为 `model`，但不重写历史 JSON。

- [ ] **Step 4: 写入零模型请求、零积分和本地执行的失败测试**

```ts
expect(requiredSkillModelRoles(localSkill)).toEqual([]);
await expect(estimateSkillRunCost(localSkill, {}, dependencies))
  .resolves.toEqual({ minimum: 0, maximum: 0, steps: [{ stepId: 'export', cost: 0 }] });
expect(calculateCreditCost).not.toHaveBeenCalled();

const request = await buildSkillAgentRunRequest(localRequest, dependencies, localSkill);
expect(request).toMatchObject({ executionRuntime: 'local', mode: 'agent' });
expect(request).not.toHaveProperty('providerId');
expect(request).not.toHaveProperty('modelId');
```

- [ ] **Step 5: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/lib/skill-runtime-executor.test.ts`

Expected: FAIL，当前代码会自动插入 orchestrator 并读取 `bindings[step.modelRole]`。

- [ ] **Step 6: 实现本地 Agent/Skill 请求联合类型和执行分支**

```ts
export type AgentRunRequest = AgentRunRequestBase & (
  | { executionRuntime?: 'model'; providerId: string; modelId: string }
  | { executionRuntime: 'local'; providerId?: never; modelId?: never }
);
```

`skillExecutionSteps()` 仅在 Skill 含模型步骤且没有 orchestrator 时自动补 orchestrator；纯本地 Skill 不补。Agent admission、摘要和 run.created 事件必须包含 `executionRuntime`，本地请求跳过模型能力校验但仍执行项目、来源和权限校验。

- [ ] **Step 7: 让执行器只为模型步骤读取 binding**

```ts
const modelRole = skillStepModelRole(step);
const modelBinding = modelRole ? input.modelBindings[modelRole] : undefined;
if (skillStepRuntime(step) === 'model' && !modelBinding) {
  throw new SkillCostEstimateError('SKILL_MODEL_BINDING_REQUIRED', `Missing model binding for role: ${modelRole}`);
}
```

- [ ] **Step 8: 运行本任务全部测试**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-local-step.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/lib/skill-runtime-executor.test.ts`

Expected: PASS；既有模型 Skill 快照保持不变。

- [ ] **Step 9: 提交**

```bash
git add src/lib/skill-runtime/types.ts src/lib/skill-runtime/step-compiler.ts src/lib/skill-runtime/cost-estimator.ts src/lib/skill-runtime/run-request.ts src/lib/skill-runtime/executor.ts src/lib/agent-runtime/types.ts src/lib/agent-runtime/service.ts src/__tests__/lib/skill-runtime-local-step.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-runtime-run-request.test.ts src/__tests__/lib/skill-runtime-executor.test.ts
git commit -m "feat: support local zero-cost skill steps"
```

### Task 2: 建立版本化平台预设与受控管理接口

**Files:**
- Create: `src/lib/multi-platform-export/types.ts`
- Create: `src/lib/multi-platform-export/presets.ts`
- Create: `src/app/api/platform-export-presets/route.ts`
- Create: `src/app/api/admin/platform-export-presets/route.ts`
- Modify: `src/lib/db-storage.ts`
- Modify: `src/lib/runtime-settings.ts`
- Test: `src/__tests__/lib/platform-export-presets.test.ts`
- Test: `src/__tests__/api/platform-export-presets.test.ts`
- Test: `src/__tests__/api/admin-platform-export-presets.test.ts`

**Interfaces:**
- Produces: `PlatformExportPreset`、`FrozenPlatformExportPreset`、`ExportFormat`。
- Produces: `listEnabledPlatformExportPresets()`、`freezePlatformExportPresets(ids)`、`createPlatformExportPresetVersion(input)`。
- Produces: `GET /api/platform-export-presets`；管理员 `POST/PATCH /api/admin/platform-export-presets`。

- [ ] **Step 1: 写预设版本冻结、禁用和历史不可变测试**

```ts
const frozen = await freezePlatformExportPresets(['instagram-post-v1']);
expect(frozen[0]).toMatchObject({ id: 'instagram-post', version: 1, width: 1080, height: 1080 });
await createPlatformExportPresetVersion({ ...frozen[0], width: 1200 });
expect(await freezePlatformExportPresets(['instagram-post-v1'])).toEqual(frozen);
expect((await listEnabledPlatformExportPresets()).every(item => item.enabled)).toBe(true);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/platform-export-presets.test.ts`

Expected: FAIL，因为预设模块和数据库表尚不存在。

- [ ] **Step 3: 实现严格类型、默认注册表和 PostgreSQL 版本表**

```ts
export interface PlatformExportPreset {
  id: string;
  version: number;
  platform: string;
  usage: string;
  label: string;
  width: number;
  height: number;
  recommendedFormat: 'png' | 'jpeg' | 'webp';
  supportsTransparency: boolean;
  enabled: boolean;
}
```

数据库唯一键使用 `(preset_id, version)`；更新动作只能新增版本或修改 `enabled`，不能覆写已存在版本的尺寸、格式、平台和用途。

- [ ] **Step 4: 写普通用户只读、管理员写入与错误格式测试**

```ts
expect(await GET(asUser())).toMatchObject({ status: 200 });
expect(await POST(asUser(), validPreset)).toMatchObject({ status: 403 });
expect(await POST(asAdmin(), { ...validPreset, width: 0 })).toMatchObject({ status: 400 });
expect(await POST(asAdmin(), validPreset)).toMatchObject({ status: 201 });
```

- [ ] **Step 5: 实现公开只读和管理员版本化写接口**

公开响应只返回已启用版本；管理员响应包含所有版本和启停状态。所有输入只允许声明字段，宽高限制 `64..8192`，平台/用途/标签限制 64/64/120 字符。

- [ ] **Step 6: 加入默认关闭的运行时标志**

```ts
multiPlatformExportEnabled: process.env.MULTI_PLATFORM_EXPORT_ENABLED === 'true'
```

标志关闭时公开列表为空、Skill 不进入目录，但历史 Run 和历史 AssetVersion 仍可读取。

- [ ] **Step 7: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/platform-export-presets.test.ts src/__tests__/api/platform-export-presets.test.ts src/__tests__/api/admin-platform-export-presets.test.ts`

Expected: PASS。

```bash
git add src/lib/multi-platform-export src/app/api/platform-export-presets src/app/api/admin/platform-export-presets src/lib/db-storage.ts src/lib/runtime-settings.ts src/__tests__/lib/platform-export-presets.test.ts src/__tests__/api/platform-export-presets.test.ts src/__tests__/api/admin-platform-export-presets.test.ts
git commit -m "feat: add versioned platform export presets"
```

### Task 3: 实现输入规范化、命名器和资源预算规划

**Files:**
- Create: `src/lib/multi-platform-export/schema.ts`
- Create: `src/lib/multi-platform-export/naming.ts`
- Create: `src/lib/multi-platform-export/planner.ts`
- Test: `src/__tests__/lib/multi-platform-export-schema.test.ts`
- Test: `src/__tests__/lib/multi-platform-export-naming.test.ts`
- Test: `src/__tests__/lib/multi-platform-export-planner.test.ts`

**Interfaces:**
- Produces: `parseMultiPlatformExportInput(value): MultiPlatformExportInput`。
- Produces: `sanitizeExportBaseName(value)`、`renderExportFilename(template, context, usedNames)`。
- Produces: `planMultiPlatformExport(input, sources, frozenPresets): ExportPlan`。
- Limits: 来源 20、目标 20、输出 100、单输出 67,108,864 像素、整批 402,653,184 像素。

- [ ] **Step 1: 写输入和透明规则失败测试**

```ts
expect(() => parseMultiPlatformExportInput({ sourceAssetVersionIds: [], targetPresetIds: [] }))
  .toThrow('EXPORT_SOURCE_COUNT_INVALID');
expect(() => parseMultiPlatformExportInput({ ...valid, fit: 'stretch' }))
  .toThrow('EXPORT_FIT_INVALID');
expect(() => planMultiPlatformExport(transparentJpegInput, sources, presets))
  .toThrow('EXPORT_TRANSPARENCY_FORMAT_CONFLICT');
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/multi-platform-export-schema.test.ts src/__tests__/lib/multi-platform-export-planner.test.ts`

Expected: FAIL，目标函数尚不存在。

- [ ] **Step 3: 实现严格解析和确定性请求摘要**

```ts
export interface MultiPlatformExportInput {
  sourceAssetVersionIds: string[];
  targetPresetIds: string[];
  fit: 'cover' | 'contain';
  background: 'transparent' | `#${string}`;
  namingTemplate: string;
}
```

解析器拒绝未知字段、重复 ID、非 AssetVersion ID、非法 RGBA、超过 160 字符的模板和序列化超限。摘要按用户、项目、Skill 版本、规范化来源顺序、冻结预设、适配参数和模板生成 SHA-256。

- [ ] **Step 4: 写中文名、Windows 保留名、重名和穿越测试**

```ts
expect(sanitizeExportBaseName('../CON. ')).toBe('asset');
expect(renderExportFilename('{project}-{asset}-{size}-{index}', chineseContext, used))
  .toBe('项目-主视觉-1080x1080-1.png');
expect(renderExportFilename('{asset}', duplicateContext, used)).toBe('主视觉-a1b2c3.png');
expect(renderExportFilename('../../{asset}', context, used)).not.toContain('..');
```

- [ ] **Step 5: 实现命名器和稳定排序的输出计划**

计划排序固定为来源输入顺序，再按冻结预设输入顺序；扩展名由实际输出格式决定，重名后缀来自 `sourceVersionId + presetId + presetVersion` 摘要前 6 位。

- [ ] **Step 6: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/multi-platform-export-schema.test.ts src/__tests__/lib/multi-platform-export-naming.test.ts src/__tests__/lib/multi-platform-export-planner.test.ts`

Expected: PASS。

```bash
git add src/lib/multi-platform-export/schema.ts src/lib/multi-platform-export/naming.ts src/lib/multi-platform-export/planner.ts src/__tests__/lib/multi-platform-export-schema.test.ts src/__tests__/lib/multi-platform-export-naming.test.ts src/__tests__/lib/multi-platform-export-planner.test.ts
git commit -m "feat: plan deterministic platform exports"
```

### Task 4: 实现受控素材读取和 Sharp 转换

**Files:**
- Create: `src/lib/multi-platform-export/source-reader.ts`
- Create: `src/lib/multi-platform-export/transformer.ts`
- Modify: `src/lib/image-tools/file.ts`
- Test: `src/__tests__/lib/multi-platform-export-source-reader.test.ts`
- Test: `src/__tests__/lib/multi-platform-export-transformer.test.ts`
- Fixture: `src/__tests__/fixtures/multi-platform-export/landscape.jpg`
- Fixture: `src/__tests__/fixtures/multi-platform-export/portrait.png`
- Fixture: `src/__tests__/fixtures/multi-platform-export/transparent.png`

**Interfaces:**
- Produces: `readAuthorizedExportSources({ actorUserId, projectId, sourceVersionIds, signal })`。
- Produces: `transformPlatformImage({ source, target, fit, background, signal }): Promise<TransformedExport>`。
- `TransformedExport` 包含 bytes、mimeType、width、height、hasTransparency、sha256。

- [ ] **Step 1: 写跨用户、伪 MIME、像素炸弹和远程私网来源测试**

```ts
await expect(readAuthorizedExportSources(crossUserInput)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
await expect(readAuthorizedExportSources(fakePngInput)).rejects.toThrow('EXPORT_SOURCE_FORMAT_INVALID');
await expect(readAuthorizedExportSources(pixelBombInput)).rejects.toThrow('EXPORT_SOURCE_PIXEL_LIMIT');
await expect(readAuthorizedExportSources(privateRemoteInput)).rejects.toThrow('REMOTE_MEDIA_PRIVATE_ADDRESS');
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/multi-platform-export-source-reader.test.ts`

Expected: FAIL，因为领域读取器尚不存在。

- [ ] **Step 3: 实现基于 AssetService 的授权读取**

先调用 `resolveAssetReference()`，再通过受控媒体根目录、S3 bounded read 或现有远程安全下载器取字节；禁止前端 URL 直通。使用 Sharp `limitInputPixels`，按实际签名确认 JPEG/PNG/WebP。

- [ ] **Step 4: 写 cover、contain、透明和中止测试**

```ts
expect((await transformPlatformImage({ ...base, fit: 'cover', target: square })).metadata)
  .toMatchObject({ width: 1080, height: 1080 });
expect((await transformPlatformImage({ ...base, fit: 'contain', background: 'transparent' })).hasTransparency)
  .toBe(true);
await expect(transformPlatformImage({ ...base, signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
```

- [ ] **Step 5: 实现转换和输出后字节级复验**

```ts
const pipeline = sharp(source.bytes, { limitInputPixels: limits.singleOutputPixels })
  .rotate()
  .resize(target.width, target.height, {
    fit,
    position: 'centre',
    background: background === 'transparent' ? '#00000000' : background,
  });
```

输出后重新 `sharp(bytes).metadata()`，尺寸、格式、字节数和 alpha 任一不符即失败；JPEG + transparent 在规划阶段拒绝，不在此处静默转白底。

- [ ] **Step 6: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/multi-platform-export-source-reader.test.ts src/__tests__/lib/multi-platform-export-transformer.test.ts`

Expected: PASS。

```bash
git add src/lib/multi-platform-export/source-reader.ts src/lib/multi-platform-export/transformer.ts src/lib/image-tools/file.ts src/__tests__/lib/multi-platform-export-source-reader.test.ts src/__tests__/lib/multi-platform-export-transformer.test.ts src/__tests__/fixtures/multi-platform-export
git commit -m "feat: transform authorized export sources"
```

### Task 5: 持久化派生图片、manifest 和 ZIP

**Files:**
- Create: `src/lib/asset-core/binary-persistence.ts`
- Create: `src/lib/multi-platform-export/manifest.ts`
- Create: `src/lib/multi-platform-export/artifacts.ts`
- Modify: `src/lib/asset-core/service.ts`
- Modify: `src/lib/s3-storage.ts`
- Modify: `src/lib/skill-runtime/structured-output.ts`
- Test: `src/__tests__/lib/asset-binary-persistence.test.ts`
- Test: `src/__tests__/lib/multi-platform-export-manifest.test.ts`
- Test: `src/__tests__/lib/multi-platform-export-artifacts.test.ts`

**Interfaces:**
- Produces: `persistAssetBytes({ bytes, filename, mimeType, signal }): Promise<AssetFile>`。
- Produces: `persistExportImageVersion(item)`、`persistExportArtifacts(result)`。
- Produces: `MultiPlatformExportResultV1`，schema ID 为 `multi-platform-export-result-v1`。

- [ ] **Step 1: 写图片父版本、文档制品和幂等复用测试**

```ts
expect(imageVersion.parentVersionIds).toEqual([sourceVersionId]);
expect(imageVersion.metadata).toMatchObject({ schemaId: 'multi-platform-export-v1', runId, presetVersion: 1 });
expect(manifestVersion.kind).toBe('document');
expect(zipVersion.kind).toBe('document');
expect(secondCreate.version.id).toBe(firstCreate.version.id);
expect(secondCreate.reused).toBe(true);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/asset-binary-persistence.test.ts src/__tests__/lib/multi-platform-export-artifacts.test.ts`

Expected: FAIL，因为通用二进制持久化和导出制品模块尚不存在。

- [ ] **Step 3: 实现通用二进制对象持久化**

为对象存储增加接受受控 `Buffer`、文件名和 MIME 的函数，返回稳定 URL、storageKey、checksum 和 byteSize；本地开发落到受控上传根目录。禁止把 ZIP 交给仅验证图片的 `uploadImageToS3()`。

- [ ] **Step 4: 实现派生 AssetVersion 元数据和确定性幂等键**

```ts
const metadata = {
  schemaId: 'multi-platform-export-v1', runId, sourceAssetVersionId,
  presetId, presetVersion, platform, usage, width, height, fit,
  outputFormat, outputFilename, requestDigest,
};
const idempotencyKey = `skill:${runId}:export:${sourceAssetVersionId}:${presetId}:v${presetVersion}`;
```

每个派生图片创建新 Asset，不传 `assetId`，以来源版本作为 `parentVersionIds`；这需要 AssetService 放宽“父版本必须属于同一 Asset”的旧限制，改为只验证父版本同用户同项目，并用现有 parent 表保存跨 Asset 派生关系，同时补回归测试确保普通版本链仍正确。

- [ ] **Step 5: 写 manifest/ZIP 一致性、排序和打包失败测试**

```ts
expect(zipNames.sort()).toEqual([...successNames, 'manifest.json'].sort());
expect(manifest.files.map(file => file.filename)).toEqual(successNames);
expect(manifest.files.every(file => file.sha256.startsWith('sha256:'))).toBe(true);
expect(manifest.failures).toEqual([{ sourceAssetVersionId: badId, code: 'EXPORT_SOURCE_CORRUPT', retryable: false }]);
```

- [ ] **Step 6: 实现稳定 manifest、ZIP 上限和结构化 schema**

ZIP 最多 101 个条目，总未压缩字节和压缩后字节分别执行硬限制；内部路径只使用服务端生成的扁平文件名。注册 `multi-platform-export-result-v1` 到 `STRUCTURED_OUTPUT_SCHEMAS`，规范化排序后再序列化。

- [ ] **Step 7: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/asset-binary-persistence.test.ts src/__tests__/lib/multi-platform-export-manifest.test.ts src/__tests__/lib/multi-platform-export-artifacts.test.ts src/__tests__/lib/asset-service.test.ts`

Expected: PASS。

```bash
git add src/lib/asset-core/binary-persistence.ts src/lib/asset-core/service.ts src/lib/s3-storage.ts src/lib/multi-platform-export/manifest.ts src/lib/multi-platform-export/artifacts.ts src/lib/skill-runtime/structured-output.ts src/__tests__/lib/asset-binary-persistence.test.ts src/__tests__/lib/multi-platform-export-manifest.test.ts src/__tests__/lib/multi-platform-export-artifacts.test.ts src/__tests__/lib/asset-service.test.ts
git commit -m "feat: persist export images and archives"
```

### Task 6: 接入本地执行器、并发、取消、恢复和部分成功

**Files:**
- Create: `src/lib/multi-platform-export/executor.ts`
- Create: `src/lib/skill-runtime/multi-platform-export-preset.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/skill-runtime/catalog.ts`
- Test: `src/__tests__/lib/multi-platform-export-execution.test.ts`
- Test: `src/__tests__/lib/skill-runtime-multi-platform-export-preset.test.ts`
- Test: `src/__tests__/integration/skill-multi-platform-export-concurrency-postgres.test.ts`

**Interfaces:**
- Produces: `executeMultiPlatformExportStep(input: ExecuteSkillStepInput): Promise<SkillStepResult>`。
- Produces: built-in Skill `preset-multi-platform-export@1`，仅 Canvas/Workflow 目录可见。
- Produces: `retryFailedExportItems(runId)` 通过现有 retry 路由创建有来源追踪的新尝试。

- [ ] **Step 1: 写预设目录、输入字段和零模型约束测试**

```ts
expect(exportSkill.allowedSurfaces).toEqual(['canvas', 'workflow', 'simple-chat']);
expect(exportSkill.catalogSurfaces).toEqual(['canvas', 'workflow']);
expect(exportSkill.steps).toEqual([expect.objectContaining({ runtime: 'local', toolId: 'multi_platform_export' })]);
expect(requiredSkillModelRoles(exportSkill)).toEqual([]);
expect(listSkillsForSurface('simple-chat').some(skill => skill.id === exportSkill.id)).toBe(false);
expect(requireSkillForSurface(exportSkill.id, 'simple-chat').id).toBe(exportSkill.id);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-multi-platform-export-preset.test.ts`

Expected: FAIL，预设和适配器尚不存在。

- [ ] **Step 3: 实现预设和本地工具注册**

```ts
steps: [{
  id: 'export', label: '生成平台尺寸', toolId: 'multi_platform_export',
  runtime: 'local', execution: 'sequential', promptTemplate: '',
  qualityGateIds: ['output-present'],
}]
```

目录仅在 `MULTI_PLATFORM_EXPORT_ENABLED=true` 时包含该 Skill；`allowedSurfaces` 为三个工作区，`catalogSurfaces` 仅为 Canvas/Workflow，从而允许 Simple Chat 会话式调用但不展示其目录。既有 Skill 数量保护测试改为“原 21 个全部存在且身份不变，可选新增导出 Skill”。

- [ ] **Step 4: 写两路有限并行、取消和部分失败测试**

```ts
expect(maxObservedConcurrency).toBe(2);
expect(progressEvents.map(event => event.completed)).toEqual([1, 2, 3]);
expect(startedAfterAbort).toBe(0);
expect(partialResult.structured?.value).toMatchObject({ outcome: 'partial_success' });
expect(partialRun.status).toBe('failed');
```

- [ ] **Step 5: 实现并发 2 的转换队列和真实进度事件**

完成一个输出后才发 `tool.progress`，进度为 `completedCount / plannedCount`；收到 abort 后不取新任务，已验证且已持久化版本保留。

- [ ] **Step 6: 实现部分成功终态映射**

适配器在存在失败项时抛出携带 `SkillStepResult` 的 `SkillPartialSuccessError`；executor 先按正常结果路径持久化 `asset.created`、结构化 output 和 `tool.completed`，再由服务层追加 `run.failed`，错误码 `SKILL_PARTIAL_SUCCESS`，不得追加 `run.completed`。ZIP 打包失败时同样保留图片版本并记录失败项。

- [ ] **Step 7: 写 PostgreSQL 并发、恢复和零账务测试**

```ts
expect(new Set(concurrentRuns.map(run => run.runId)).size).toBe(1);
expect(await countExportVersions(runId)).toBe(expectedOutputCount + 2);
expect(await countCreditLedgerEntries(runId)).toBe(0);
expect(resumed.createdVersionIds).toEqual(missingVersionIds);
expect(resumed.reusedVersionIds).toEqual(completedVersionIds);
```

- [ ] **Step 8: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/multi-platform-export-execution.test.ts src/__tests__/lib/skill-runtime-multi-platform-export-preset.test.ts`

Run with isolated DB: `$env:TEST_PGDATABASE_URL='<isolated-test-database>'; pnpm exec vitest run src/__tests__/integration/skill-multi-platform-export-concurrency-postgres.test.ts`

Expected: 两组均 PASS，PostgreSQL 测试不得使用生产数据库或静默 skip。

```bash
git add src/lib/multi-platform-export/executor.ts src/lib/skill-runtime/multi-platform-export-preset.ts src/lib/skill-runtime/step-registry.ts src/lib/skill-runtime/service.ts src/lib/skill-runtime/catalog.ts src/__tests__/lib/multi-platform-export-execution.test.ts src/__tests__/lib/skill-runtime-multi-platform-export-preset.test.ts src/__tests__/integration/skill-multi-platform-export-concurrency-postgres.test.ts
git commit -m "feat: execute recoverable batch exports"
```

### Task 7: 完成无限画布抽屉与结果操作

**Files:**
- Create: `src/components/skill-runtime/MultiPlatformExportDrawer.tsx`
- Create: `src/components/skill-runtime/MultiPlatformExportResults.tsx`
- Create: `src/lib/skill-runtime/multi-platform-export-client.ts`
- Modify: `src/components/chat-panel.tsx`
- Modify: `src/components/skill-runtime/SkillInputFields.tsx`
- Modify: `src/lib/skill-runtime/canvas-client.ts`
- Test: `src/__tests__/components/multi-platform-export-drawer.test.tsx`
- Test: `src/__tests__/components/multi-platform-export-results.test.tsx`
- Test: `src/__tests__/components/chat-panel-multi-platform-export.test.tsx`

**Interfaces:**
- Produces: `MultiPlatformExportDrawer` 六区抽屉。
- Produces: `parseMultiPlatformExportResult(output)`、`downloadExportArtifact(versionId)`。
- Consumes: Task 2 预设 API、Task 6 Skill Run API 和 Task 5 结构化结果。

- [ ] **Step 1: 写六区、移动端和状态展示失败测试**

```tsx
expect(screen.getByRole('heading', { name: '多平台批量导出' })).toBeVisible();
for (const label of ['素材', '目标平台', '适配方式', '命名', '执行预览', '结果']) {
  expect(screen.getByText(label)).toBeVisible();
}
expect(screen.getByText('积分 0')).toBeVisible();
expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled();
expect(screen.getByText('部分成功')).toBeVisible();
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx`

Expected: FAIL，组件尚不存在。

- [ ] **Step 3: 实现贴合底部工具栏的抽屉**

复用现有 Skill 视觉变量和抽屉层级；平台用复选列表、fit 用分段控件、背景用颜色控件、命名用文本输入。375px 使用单列布局，按钮最小触控高度 40px，不创建中央浮窗。

- [ ] **Step 4: 实现执行预览与真实进度**

执行前展示文件数、总像素、估计 ZIP 字节和积分 0；执行中只显示服务端事件的完成数，不使用定时器推进。取消按钮调用现有 `PATCH /api/skill-runs/:runId`。

- [ ] **Step 5: 实现结果下载和批量放入画布**

单张/整组下载读取 AssetVersion 稳定 URL；“批量放入画布”只投影 `kind: 'image'`，manifest/ZIP 不进入画布。恢复历史 Run 时复用相同版本，不创建新导出。

- [ ] **Step 6: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx src/__tests__/components/chat-panel-multi-platform-export.test.tsx src/__tests__/components/chat-panel-skill-runtime.test.tsx`

Expected: PASS。

```bash
git add src/components/skill-runtime/MultiPlatformExportDrawer.tsx src/components/skill-runtime/MultiPlatformExportResults.tsx src/lib/skill-runtime/multi-platform-export-client.ts src/components/chat-panel.tsx src/components/skill-runtime/SkillInputFields.tsx src/lib/skill-runtime/canvas-client.ts src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/multi-platform-export-results.test.tsx src/__tests__/components/chat-panel-multi-platform-export.test.tsx
git commit -m "feat: add canvas export drawer"
```

### Task 8: 接入节点模式统一运行与制品投影

**Files:**
- Modify: `src/components/node-editor.tsx`
- Modify: `src/lib/workflow-skill-execution.ts`
- Modify: `src/lib/skill-runtime/workflow-client.ts`
- Test: `src/__tests__/components/node-editor-multi-platform-export.test.tsx`
- Test: `src/__tests__/lib/workflow-multi-platform-export.test.ts`
- Test: `src/__tests__/api/workflow-skill-execution.test.ts`

**Interfaces:**
- Produces: `ai-skill` 节点对本地 Skill 的空模型绑定支持。
- Produces: Workflow 输出字段 `imageAssetVersionIds`、`manifestAssetVersionId`、`zipAssetVersionId`、`outcome`。

- [ ] **Step 1: 写无模型下拉、输入版本集合和结果投影失败测试**

```tsx
expect(screen.queryByLabelText('orchestrator 模型')).not.toBeInTheDocument();
expect(submitBody.modelBindings).toEqual({});
expect(projected).toMatchObject({
  outcome: 'completed', imageAssetVersionIds: ['image-v1'],
  manifestAssetVersionId: 'manifest-v1', zipAssetVersionId: 'zip-v1',
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/node-editor-multi-platform-export.test.tsx src/__tests__/lib/workflow-multi-platform-export.test.ts`

Expected: FAIL，节点属性面板当前默认加入 orchestrator 角色。

- [ ] **Step 3: 修改节点模型角色推导和属性面板**

只对 `runtime !== 'local'` 的步骤渲染模型选择；来源图片端口绑定到 `sourceAssetVersionIds`，预设和命名字段复用 Task 7 控件，不复制执行器。

- [ ] **Step 4: 扩展 Workflow 结构化结果投影**

`projectWorkflowSkillRun()` 解析 `multi-platform-export-result-v1`，图片、manifest、ZIP 分开投影；历史普通 Skill 的 `imageUrls`、`documentAssetVersionIds` 保持兼容。

- [ ] **Step 5: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/components/node-editor-multi-platform-export.test.tsx src/__tests__/lib/workflow-multi-platform-export.test.ts src/__tests__/api/workflow-skill-execution.test.ts src/__tests__/components/node-editor-skill-node.test.tsx`

Expected: PASS。

```bash
git add src/components/node-editor.tsx src/lib/workflow-skill-execution.ts src/lib/skill-runtime/workflow-client.ts src/__tests__/components/node-editor-multi-platform-export.test.tsx src/__tests__/lib/workflow-multi-platform-export.test.ts src/__tests__/api/workflow-skill-execution.test.ts
git commit -m "feat: project batch exports in workflows"
```

### Task 9: 接入独立智能对话的会话式调用

**Files:**
- Create: `src/lib/multi-platform-export/simple-chat-intent.ts`
- Create: `src/components/simple-chat/multi-platform-export-card.tsx`
- Modify: `src/components/simple-chat/chat-area.tsx`
- Modify: `src/app/api/simple-chat/chat/route.ts`
- Test: `src/__tests__/lib/simple-chat-export-intent.test.ts`
- Test: `src/__tests__/components/simple-chat-multi-platform-export.test.tsx`
- Test: `src/__tests__/api/simple-chat-multi-platform-export.test.ts`
- Test: `src/__tests__/api/simple-chat-skill-scope.test.ts`

**Interfaces:**
- Produces: `parseSimpleChatExportIntent(message, presets): ExportIntentResult`。
- Produces: 缺参数时返回 `needs_clarification`，完整时返回规范化 Skill 请求。
- Produces: 对话结果卡显示同一 Run、图片版本、manifest 和 ZIP。

- [ ] **Step 1: 写自然语言解析和缺参追问测试**

```ts
expect(parseSimpleChatExportIntent('把这两张图导出 Instagram 帖子和故事尺寸，完整留白', presets))
  .toMatchObject({ kind: 'ready', fit: 'contain', targetPresetIds: expect.any(Array) });
expect(parseSimpleChatExportIntent('帮我批量导出平台尺寸', presets))
  .toMatchObject({ kind: 'needs_clarification', missing: ['sources', 'targets'] });
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-export-intent.test.ts src/__tests__/components/simple-chat-multi-platform-export.test.tsx`

Expected: FAIL，意图适配器和结果卡尚不存在。

- [ ] **Step 3: 实现确定性意图识别和参数收集**

仅在文本明确包含“批量/平台/尺寸/导出”组合且存在受管聊天附件时进入该流程；平台名称从 Task 2 服务端预设解析，不让 LLM 任意发明 presetId。缺失参数用对话消息追问，不自动提交。

- [ ] **Step 4: 调用统一 Skill API 而非复制 Canvas 目录**

Simple Chat 不把 `preset-multi-platform-export` 加入 `PRESET_SKILLS` 或 SkillPanel。参数齐全后以 `surface: 'simple-chat'` 的受控内部调用创建同一 Skill Run，`modelBindings: {}`，结果 AssetVersion 归属共享项目和 chat workspace。

- [ ] **Step 5: 实现结果卡、下载和返回画布**

结果卡展示成功/失败数量、ZIP/manifest 下载和“返回画布”；后者复用现有 workspace handoff，不复制资产。刷新后从 Run 历史恢复同一结果。

- [ ] **Step 6: 运行本任务测试并提交**

Run: `pnpm exec vitest run src/__tests__/lib/simple-chat-export-intent.test.ts src/__tests__/components/simple-chat-multi-platform-export.test.tsx src/__tests__/api/simple-chat-multi-platform-export.test.ts src/__tests__/api/simple-chat-skill-scope.test.ts src/__tests__/components/simple-chat-skill-isolation.test.tsx`

Expected: PASS；Simple Chat Skill 面板仍不包含 Canvas Skills。

```bash
git add src/lib/multi-platform-export/simple-chat-intent.ts src/components/simple-chat/multi-platform-export-card.tsx src/components/simple-chat/chat-area.tsx src/app/api/simple-chat/chat/route.ts src/__tests__/lib/simple-chat-export-intent.test.ts src/__tests__/components/simple-chat-multi-platform-export.test.tsx src/__tests__/api/simple-chat-multi-platform-export.test.ts src/__tests__/api/simple-chat-skill-scope.test.ts
git commit -m "feat: invoke batch exports from simple chat"
```

### Task 10: 补齐跨工作区 E2E、回归门禁和发布证据

**Files:**
- Create: `tests/e2e/multi-platform-batch-export.spec.ts`
- Create: `tests/helpers/multi-platform-export.ts`
- Modify: `playwright.config.ts`
- Modify: `scripts/doctor.mjs`
- Modify: `src/__tests__/scripts/skill-runtime-inventory.test.ts`
- Modify: `src/__tests__/fixtures/skill-runtime-presets.baseline.json`
- Modify: `docs/testing/FUNCTION_INVENTORY.md`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Create: `docs/plans/2026-09-09-multi-platform-batch-export-progress.md`

**Interfaces:**
- Produces: Playwright 证据目录 `test-results/multi-platform-export/<commit>/<browser>/`。
- Produces: doctor 检查数据库、对象存储、Sharp、预设表和功能标志。

- [ ] **Step 1: 写 Chromium/Firefox/WebKit/375px 核心 E2E**

测试数据包含横图、竖图、方图、透明 PNG、中文名和同名素材。Canvas 流程验证选择、预览、执行、逐项进度、ZIP、manifest、批量入画布、刷新恢复；Workflow 和 Simple Chat 验证同一 Run/AssetVersion 结果。

- [ ] **Step 2: 写异常、取消和证据断言**

覆盖一个损坏来源产生 `partial_success`、转换中取消、刷新后恢复、失败项重试、ZIP 下载失败后从历史重新下载。失败保留 screenshot、video、trace、console、network；不得使用固定长 sleep。

- [ ] **Step 3: 运行专项单元和组件测试**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-local-step.test.ts src/__tests__/lib/platform-export-presets.test.ts src/__tests__/lib/multi-platform-export-schema.test.ts src/__tests__/lib/multi-platform-export-naming.test.ts src/__tests__/lib/multi-platform-export-planner.test.ts src/__tests__/lib/multi-platform-export-source-reader.test.ts src/__tests__/lib/multi-platform-export-transformer.test.ts src/__tests__/lib/multi-platform-export-manifest.test.ts src/__tests__/lib/multi-platform-export-artifacts.test.ts src/__tests__/lib/multi-platform-export-execution.test.ts src/__tests__/components/multi-platform-export-drawer.test.tsx src/__tests__/components/node-editor-multi-platform-export.test.tsx src/__tests__/components/simple-chat-multi-platform-export.test.tsx`

Expected: PASS，0 skipped。

- [ ] **Step 4: 运行本地浏览器矩阵**

Run: `$env:MULTI_PLATFORM_EXPORT_ENABLED='true'; pnpm exec playwright test tests/e2e/multi-platform-batch-export.spec.ts --project=chromium --project=firefox --project=webkit --project=mobile-chromium`

Expected: 所有项目 PASS；375px 无溢出、遮挡或不可点击控件。

- [ ] **Step 5: 运行全量门禁**

Run: `pnpm run doctor`

Run: `pnpm run lint`

Run: `pnpm run ts-check`

Run: `pnpm test`

Run: `pnpm run test:e2e`

Run: `pnpm run build`

Expected: 全部退出码 0；保护基线证明既有 Skill、画布下载、PSD/SVG、项目保存和 Simple Chat 隔离均无回归。

- [ ] **Step 6: 更新中文报告和 Obsidian 阶段记录**

在 Obsidian 兼容的 `docs/plans/2026-09-09-multi-platform-batch-export-progress.md` 中记录 exact commit、分支、测试时间、浏览器、测试数、证据路径、P0/P1 数量、PostgreSQL 数据库名和未验证项。只写真实执行结果；没有云端证据时结论保持 `LOCAL PASS / CLOUD UNVERIFIED`。

- [ ] **Step 7: 提交并推送 main**

```bash
git add tests/e2e/multi-platform-batch-export.spec.ts tests/helpers/multi-platform-export.ts playwright.config.ts scripts/doctor.mjs src/__tests__/scripts/skill-runtime-inventory.test.ts src/__tests__/fixtures/skill-runtime-presets.baseline.json docs/testing docs/plans/2026-09-09-multi-platform-batch-export-progress.md
git commit -m "test: verify multi-platform batch export"
git push origin main
```

- [ ] **Step 8: Coze exact commit 云端验收**

Coze 只拉取上一步 exact commit，重启沙箱后强制刷新现有 Edge 预览标签页。以测试账号启用功能标志，真实验证 ZIP 内容、manifest、AssetVersion 父子关系、取消/恢复、零积分流水和刷新恢复；只有证据齐全后才把发布报告改为 `CLOUD PASS`。

## Final Review Gate

- [ ] 逐条对照设计规格 1～16 节，确认每条要求均映射到上述任务和测试。
- [ ] 搜索计划与实现中的占位词和跳过标记，结果必须为 0（测试框架自身关键字除外）。
- [ ] 核对 `runtime`、`modelRole`、`MultiPlatformExportResultV1`、`presetId`、`presetVersion`、`manifestAssetVersionId`、`zipAssetVersionId` 在所有层名称一致。
- [ ] 核对 `origin/stable` SHA 未变化，六个既有 `.superpowers/sdd/` 修改未被暂存或提交。
- [ ] 没有云端 exact commit、真实 ZIP、manifest、AssetVersion 和刷新恢复证据时，不得宣布功能完成或可发布。

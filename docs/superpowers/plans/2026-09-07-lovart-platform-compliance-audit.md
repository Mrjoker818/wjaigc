# Lovart 平台素材合规检查实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在无限画布 AI 对话和节点模式中新增可逐图执行、可追踪、可恢复的平台素材合规检查 Skill，并以结构化报告和 document AssetVersion 交付结果。

**Architecture:** 新 Skill 通过通用图片数组扇出编译器为每张来源 AssetVersion 创建独立持久步骤，先生成零费用确定性部分报告，再使用精确冻结的视觉 provider/model 补充语义结论。报告使用受限 JSON 作为权威内容、净化 HTML 作为阅读视图，并继续复用现有 Agent Run、积分、幂等、取消退款和 AssetVersion，不创建第二套状态机。

**Tech Stack:** Next.js 16、React 19、TypeScript 5、PostgreSQL、Sharp、Vitest、Playwright、现有 Skill Runtime 与 Asset v3。

## Global Constraints

- 只修改 `main`，不得触碰 `stable@52f7c601ed150769e15d06fb435c6e360e28c9e7`。
- V5.8.8 仅为只读供体，不整体复制文件。
- 保留无限画布、节点模式、独立智能对话、管理员仪表盘、用户仪表盘及所有现有功能和入口。
- 新 Skill 只进入 Canvas AI 对话窗口与 Workflow；独立 `/simple-chat` 保持 16 项 Skills。
- Canvas/Workflow 从 27 项增加到 28 项，原 27 项定义摘要与顺序不得改变。
- 不新增底部工具栏入口，不引入本地 GPU，不建立第二套任务、供应商、积分或资产状态机。
- 视觉模型必须精确冻结 `providerId + modelId`，禁止隐式供应商降级。
- 所有来源必须是当前用户和项目已授权的 AssetVersion；不信任客户端 URL。
- 不合规是业务结果；网络、模型、存储、解析和数据库错误才是技术故障。
- 所有输出创建新版本，不覆盖来源图片。
- PostgreSQL 测试仅使用一次性隔离测试库。
- 每个实现任务按 RED、GREEN、聚焦回归、提交顺序执行。
- 不提交 `.playwright-cli/` 或 `output/`。
- 阶段真正完成后只更新一次 Obsidian 无界升级目录。

---

### Task 1: 建立版本化平台规则与报告领域模型

**Files:**
- Create: `src/lib/platform-compliance/types.ts`
- Create: `src/lib/platform-compliance/rules.ts`
- Create: `src/lib/platform-compliance/report-schema.ts`
- Create: `src/__tests__/helpers/platform-compliance-fixtures.ts`
- Test: `src/__tests__/lib/platform-compliance-rules.test.ts`
- Test: `src/__tests__/lib/platform-compliance-report-schema.test.ts`

**Interfaces:**
- Consumes: 平台、地区、素材类型、分类和来源版本标识。
- Produces: `resolveComplianceRuleSet(input): FrozenComplianceRuleSet`、`parsePlatformComplianceReport(value): PlatformComplianceReportV1`、`canonicalComplianceReportJson(report): string`。
- Test fixtures: `validReport(overrides?)`、`deepReport(depth)`、`wideReport(keys)` 均由 `src/__tests__/helpers/platform-compliance-fixtures.ts` 导出，后续测试统一复用，不在测试中用不受约束的类型断言伪造报告。

- [ ] **Step 1: 写规则选择和报告边界的失败测试**

```ts
it('freezes only rules for the exact platform region and asset type', () => {
  const frozen = resolveComplianceRuleSet({
    platform: 'Amazon', region: 'US', assetType: 'main', productCategory: '',
  });
  expect(frozen.rules.every(rule => (
    rule.platform === 'Amazon'
    && rule.regions.includes('US')
    && rule.assetTypes.includes('main')
  ))).toBe(true);
  expect(frozen.digest).toMatch(/^[a-f0-9]{64}$/u);
});

it('never converts missing evidence into a pass', () => {
  const report = parsePlatformComplianceReport(validReport({
    checks: [{ ruleId: 'amazon-main-fill', status: 'unknown', evidence: [] }],
  }));
  expect(report.summary.unknown).toBe(1);
  expect(report.verdict).toBe('unknown');
});

it('rejects oversized deeply nested and prototype-shaped reports', () => {
  expect(() => parsePlatformComplianceReport({ __proto__: { polluted: true } })).toThrow();
  expect(() => canonicalComplianceReportJson(deepReport(13))).toThrow('REPORT_DEPTH_LIMIT');
  expect(() => canonicalComplianceReportJson(wideReport(4097))).toThrow('REPORT_KEY_LIMIT');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-rules.test.ts src/__tests__/lib/platform-compliance-report-schema.test.ts`

Expected: FAIL，原因是三个新模块或导出不存在。

- [ ] **Step 3: 实现固定类型、Amazon 首批规则和规范化报告**

```ts
export type ComplianceStatus = 'passed' | 'warning' | 'blocked' | 'unknown';

export interface PlatformComplianceRule {
  id: string;
  version: number;
  platform: '通用电商' | 'Amazon' | '淘宝/天猫' | '京东';
  regions: readonly string[];
  assetTypes: readonly ('main' | 'secondary' | 'detail' | 'a-plus')[];
  categories?: readonly string[];
  title: string;
  severity: 'warning' | 'blocking';
  evaluator: 'metadata' | 'pixel' | 'vision';
  sourceUrl: string;
  sourceUpdatedAt: string;
  effectiveAt: string;
  thresholds?: Readonly<Record<string, number | string | boolean>>;
}

export interface FrozenComplianceRuleSet {
  platform: PlatformComplianceRule['platform'];
  region: string;
  assetType: PlatformComplianceRule['assetTypes'][number];
  productCategory: string;
  digest: string;
  rules: readonly PlatformComplianceRule[];
}
```

`AMAZON_RULES` 固定纳入受支持格式、最长边 500–10000、主图白底、商品占比、完整裁切、主图文字、徽标、水印和边框规则。每条规则填写 Amazon 官方来源 URL、来源更新时间与生效日期；淘宝/天猫、京东没有可靠来源的检查项不写入硬规则。

`canonicalComplianceReportJson` 递归拒绝 `__proto__`、`prototype`、`constructor`，限制 256 KiB、深度 12、键数 4096、单字符串 16384 字符，并按键名排序后序列化。

测试夹具文件实现可验证的最小 V1 报告构造器；`deepReport` 生成单链嵌套，`wideReport` 生成指定数量的唯一键，确保超限测试实际命中解析边界而不是在夹具阶段失败。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-rules.test.ts src/__tests__/lib/platform-compliance-report-schema.test.ts`

Expected: 两个文件全部 PASS，且同一输入两次得到相同规则摘要和 JSON 字节。

- [ ] **Step 5: 提交领域模型**

```bash
git add src/lib/platform-compliance src/__tests__/helpers/platform-compliance-fixtures.ts src/__tests__/lib/platform-compliance-rules.test.ts src/__tests__/lib/platform-compliance-report-schema.test.ts
git commit -m "feat: define platform compliance reports"
```

### Task 2: 扩展通用图片数组扇出编译器

**Files:**
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/step-compiler.ts`
- Modify: `src/lib/skill-runtime/storage.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/agent-runtime/service.ts`
- Test: `src/__tests__/lib/skill-runtime-step-compiler.test.ts`
- Test: `src/__tests__/lib/skill-runtime-storage.test.ts`
- Test: `src/__tests__/lib/skill-runtime-continuation.test.ts`

**Interfaces:**
- Consumes: 既有 dataset 扇出合同和 `images` 类型输入。
- Produces: 可选 `keyField`、冻结的 `compiledFanOut` 身份，以及 `compiledSkillFanOutValue(step, inputValues): string | Record<string, unknown>`。

- [ ] **Step 1: 写图片值扇出与旧 dataset 兼容失败测试**

```ts
it('fans out an images field in stable chunks without exposing URLs', () => {
  const steps = compileConditionalSkillSteps(imageAuditSkill, {
    sourceImages: ['asset_version_a', 'asset_version_b', 'asset_version_c'],
  });
  expect(steps.map(step => step.compiledFanOut)).toEqual([
    { inputKey: 'sourceImages', itemIndex: 0, itemDigest: expect.any(String) },
    { inputKey: 'sourceImages', itemIndex: 1, itemDigest: expect.any(String) },
    { inputKey: 'sourceImages', itemIndex: 2, itemDigest: expect.any(String) },
  ]);
  expect(steps.map(step => step.parallelGroup)).toEqual([
    'audit:chunk:0', 'audit:chunk:0', 'audit:chunk:0',
  ]);
});

it('keeps the existing sku dataset expansion unchanged', () => {
  expect(compileConditionalSkillSteps(batchSkuSkill, skuInputs)).toEqual(previousSkuSnapshot);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-step-compiler.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/lib/skill-runtime-continuation.test.ts`

Expected: FAIL，当前编译器只接受 `dataset` 且要求对象 `keyField`。

- [ ] **Step 3: 实现通用图片值扇出与冻结身份**

```ts
export interface SkillStepFanOut {
  inputKey: string;
  itemAlias: string;
  keyField?: string;
  maximumItems: number;
  concurrency: number;
}

export interface CompiledSkillStepFanOut {
  inputKey: string;
  itemIndex: number;
  itemDigest: string;
}

export interface SkillStepDefinition {
  id: string;
  label: string;
  toolId: string;
  execution: 'sequential' | 'parallel';
  parallelGroup?: string;
  promptTemplate: string;
  promptInstructionTemplate?: string;
  modelRole: SkillModelBinding['role'];
  qualityGateIds: readonly string[];
  when?: SkillStepCondition;
  fanOut?: SkillStepFanOut;
  compiledFanOut?: CompiledSkillStepFanOut;
}
```

当字段为 `dataset` 时继续要求对象与 `keyField`；当字段为 `images` 时要求 1–20 个非空 AssetVersion ID、禁止 `keyField`，用值摘要生成稳定步骤 ID，并通过 `compiledFanOut.itemIndex` 重新读取冻结输入。所有 skill snapshot 读写路径必须接受并校验 `compiledFanOut`，旧快照没有该字段时保持兼容。

- [ ] **Step 4: 运行扇出和第二批保护测试**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-step-compiler.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/lib/skill-runtime-continuation.test.ts src/__tests__/lib/skill-runtime-content-commerce-presets.test.ts src/__tests__/lib/skill-content-commerce-execution.test.ts`

Expected: 全部 PASS；SKU 三行步骤 ID、顺序和并发分片不变。

- [ ] **Step 5: 提交扇出扩展**

```bash
git add src/lib/skill-runtime/types.ts src/lib/skill-runtime/step-compiler.ts src/lib/skill-runtime/storage.ts src/lib/skill-runtime/service.ts src/lib/agent-runtime/service.ts src/__tests__/lib/skill-runtime-step-compiler.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/lib/skill-runtime-continuation.test.ts
git commit -m "feat: fan out skill image inputs"
```

### Task 3: 增加受限 JSON Skill 输出

**Files:**
- Create: `src/lib/skill-runtime/structured-output.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/executor.ts`
- Modify: `src/lib/skill-runtime/service.ts`
- Modify: `src/lib/skill-runtime/canvas-client.ts`
- Modify: `src/lib/skill-runtime/workflow-client.ts`
- Modify: `src/lib/workflow-skill-execution.ts`
- Modify: `src/lib/skill-runtime/quality-gates.ts`
- Test: `src/__tests__/lib/skill-runtime-structured-output.test.ts`
- Test: `src/__tests__/lib/skill-runtime-executor.test.ts`
- Test: `src/__tests__/lib/workflow-skill-node.test.ts`
- Test: `src/__tests__/lib/skill-runtime-quality.test.ts`

**Interfaces:**
- Consumes: `PlatformComplianceReportV1` 和原有 text/html 输出。
- Produces: `SkillStructuredResult`、`parseDurableSkillOutput(value)`、`durableSkillOutputKey(output)`。

- [ ] **Step 1: 写 JSON 输出恢复、去重和恶意输入失败测试**

```ts
it('persists and restores a bounded schema-tagged json output', async () => {
  const result = await executor.execute(runWithResult({
    structured: { schemaId: 'platform-compliance-report-v1', value: validReport() },
  }));
  expect(result.outputs).toContainEqual({
    stepId: 'audit:a', kind: 'json', schemaId: 'platform-compliance-report-v1',
    content: canonicalComplianceReportJson(validReport()),
  });
});

it('rejects invalid json output before appending tool.completed', async () => {
  await expect(executor.execute(runWithResult({
    structured: { schemaId: 'platform-compliance-report-v1', value: wideReport(4097) },
  }))).rejects.toThrow('REPORT_KEY_LIMIT');
  expect(events.some(event => event.type === 'tool.completed')).toBe(false);
});

it('requires the registered compliance report schema at the quality gate', () => {
  expect(runSkillQualityGates(['structured-report-present'], validStructuredResult, {}))
    .toEqual([{ id: 'structured-report-present', passed: true }]);
  expect(runSkillQualityGates(['structured-report-present'], wrongSchemaResult, {})[0]?.passed)
    .toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-structured-output.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/workflow-skill-node.test.ts`

Expected: FAIL，当前输出种类只有 `text | html`。

- [ ] **Step 3: 实现通用结构化输出边界**

```ts
export type DurableSkillOutput =
  | { stepId: string; kind: 'text' | 'html'; content: string }
  | { stepId: string; kind: 'json'; schemaId: string; content: string };

export interface SkillStructuredResult {
  schemaId: string;
  value: unknown;
}

export interface SkillStepResult {
  assetVersionIds: readonly string[];
  media: readonly SkillResultMedia[];
  text?: string;
  html?: string;
  structured?: SkillStructuredResult;
}
```

`structured-output.ts` 仅允许注册的 schema。`platform-compliance-report-v1` 调用 Task 1 的解析器和规范化器；未知 schema、空 schemaId、超限内容均失败。服务端历史读取、Canvas 客户端和 Workflow 客户端必须调用同一解析函数，不能直接类型断言。输出去重键为 `stepId + kind + schemaId`，旧 text/html 顺序不变。

在 `QUALITY_GATES` 增加通用 `structured-report-present` 门：仅当 `result.structured.schemaId === 'platform-compliance-report-v1'` 且值通过注册 schema 解析时通过；错误 schema 或仅有 text/html 不得通过。

- [ ] **Step 4: 运行结构化输出与旧输出回归**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-structured-output.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/skill-runtime-storage.test.ts src/__tests__/lib/skill-runtime-quality.test.ts src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/skill-run-restore.test.tsx`

Expected: 全部 PASS，旧 text/html 历史可恢复，JSON 恶意输入全部拒绝。

- [ ] **Step 5: 提交结构化输出**

```bash
git add src/lib/skill-runtime src/lib/workflow-skill-execution.ts src/__tests__/lib/skill-runtime-structured-output.test.ts src/__tests__/lib/skill-runtime-executor.test.ts src/__tests__/lib/skill-runtime-quality.test.ts src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/skill-run-restore.test.tsx
git commit -m "feat: persist bounded skill json outputs"
```

### Task 4: 实现确定性图片合规检查

**Files:**
- Create: `src/lib/platform-compliance/media-audit.ts`
- Create: `src/lib/platform-compliance/technical-evaluator.ts`
- Test: `src/__tests__/lib/platform-compliance-media-audit.test.ts`
- Fixtures: `src/__tests__/fixtures/platform-compliance/amazon-main-pass.png`
- Fixtures: `src/__tests__/fixtures/platform-compliance/amazon-main-alpha.png`
- Fixtures: `src/__tests__/fixtures/platform-compliance/amazon-main-offwhite.png`

**Interfaces:**
- Consumes: `loadSafeImageInput`、`safeSharp`、冻结规则集和规范 AssetVersion URL。
- Produces: `auditComplianceMedia(input): Promise<ComplianceMediaFacts>`、`evaluateTechnicalRules(facts, rules): ComplianceCheckResult[]`。

- [ ] **Step 1: 写字节、像素、白底和 Alpha 失败测试**

```ts
it('blocks an Amazon main image with transparency', async () => {
  const facts = await auditComplianceMedia({
    imageInput: fixture('amazon-main-alpha.png'), signal: new AbortController().signal,
  });
  const checks = evaluateTechnicalRules(facts, amazonMainRules());
  expect(checks.find(check => check.ruleId === 'amazon-main-background')?.status).toBe('blocked');
});

it('reports exact dimensions format bytes and background sample evidence', async () => {
  const facts = await auditComplianceMedia({
    imageInput: fixture('amazon-main-pass.png'), signal: new AbortController().signal,
  });
  expect(facts).toMatchObject({ mimeType: 'image/png', width: 1600, height: 1600, hasAlpha: false });
  expect(facts.whiteBackgroundRatio).toBeGreaterThanOrEqual(0.99);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-media-audit.test.ts`

Expected: FAIL，检测器不存在。

- [ ] **Step 3: 实现集中安全读取和确定性求值**

```ts
const MAX_COMPLIANCE_BYTES = 25 * 1024 * 1024;
const MAX_COMPLIANCE_PIXELS = 40_000_000;

export async function auditComplianceMedia(input: {
  imageInput: string;
  signal: AbortSignal;
}): Promise<ComplianceMediaFacts> {
  const decoded = await loadSafeImageInput(input.imageInput, {
    maxBytes: MAX_COMPLIANCE_BYTES,
    maxPixels: MAX_COMPLIANCE_PIXELS,
    signal: input.signal,
  });
  const image = safeSharp(decoded.buffer, { maxPixels: MAX_COMPLIANCE_PIXELS, signal: input.signal });
  const metadata = await image.metadata();
  const sampled = await image.clone().resize(256, 256, { fit: 'inside' }).ensureAlpha().raw().toBuffer();
  return measureComplianceFacts(decoded, metadata, sampled);
}
```

背景检测使用边缘采样和 RGB 距离阈值，记录采样数量与实测比例；不能用单个角像素代表整张背景。文件签名 MIME 与声明 MIME 必须一致。Sharp 输入始终设置像素上限并响应 AbortSignal。

- [ ] **Step 4: 运行检测器和安全输入回归**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-media-audit.test.ts src/__tests__/lib/safe-image-input.test.ts`

Expected: 全部 PASS；伪 MIME、超字节、像素炸弹、损坏图和中止均被拒绝。

- [ ] **Step 5: 提交确定性检测器**

```bash
git add src/lib/platform-compliance/media-audit.ts src/lib/platform-compliance/technical-evaluator.ts src/__tests__/lib/platform-compliance-media-audit.test.ts src/__tests__/fixtures/platform-compliance
git commit -m "feat: audit deterministic image compliance"
```

### Task 5: 实现精确视觉检查与部分报告语义

**Files:**
- Create: `src/lib/platform-compliance/vision-client.ts`
- Create: `src/lib/platform-compliance/report-builder.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Modify: `src/lib/skill-runtime/cost-estimator.ts`
- Test: `src/__tests__/lib/platform-compliance-vision.test.ts`
- Test: `src/__tests__/lib/platform-compliance-execution.test.ts`
- Test: `src/__tests__/lib/skill-runtime-cost-estimator.test.ts`

**Interfaces:**
- Consumes: 精确 vision binding、`compiledFanOut`、已授权媒体映射、冻结规则和 Task 4 检测结果。
- Produces: `invokeComplianceVision(input): Promise<VisionComplianceResult>`、`buildComplianceReport(input): PlatformComplianceReportV1`、`compliance_audit` Skill adapter。

- [ ] **Step 1: 写无降级、严格 JSON 和部分报告失败测试**

```ts
it('calls only the frozen vision provider and model', async () => {
  await invokeComplianceVision({
    provider: pearVisionProvider, modelId: 'gemini-vision-stable', imageDataUrl, rules, signal,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe('gemini-vision-stable');
  expect(apimartFetcher).not.toHaveBeenCalled();
});

it('keeps technical evidence unknown and retryable when vision fails', async () => {
  const result = await executeComplianceAudit(failingVisionFixture);
  expect(result.partialReport.checks.filter(check => check.evaluator === 'vision')
    .every(check => check.status === 'unknown')).toBe(true);
  expect(result.retryable).toBe(true);
  expect(result.providerError).toMatchObject({ providerId: pearVisionProvider.id, modelId: 'gemini-vision-stable' });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-vision.test.ts src/__tests__/lib/platform-compliance-execution.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts`

Expected: FAIL，视觉客户端、报告构建器和适配器不存在。

- [ ] **Step 3: 实现视觉客户端与合规适配器**

```ts
export async function invokeComplianceVision(input: ComplianceVisionInput): Promise<VisionComplianceResult> {
  const response = await fetchWithV1Retry(input.provider.baseUrl, '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.provider.apiKey}` },
    body: JSON.stringify({
      model: input.modelId,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: complianceVisionContent(input) }],
    }),
    signal: input.signal,
  });
  return parseComplianceVisionResponse(response, input);
}
```

适配器只能从 `compiledFanOut.itemIndex` 取得本次来源版本，再从服务端授权后的 `mediaByVersionId` 读取 URL。先写入免费的确定性部分报告事件和 document 版本；随后调用 `operation.beginSubmission()` 并生成最终报告版本。供应商明确拒绝或提交前失败必须抛出带 providerId、modelId、requestId 和原始错误摘要的可重试错误，让父 Run 暂停；确定性部分报告保持可见，不标记付费视觉步骤成功。提交后响应丢失沿用 `submission_unknown`，禁止自动重放，并退还未交付视觉费用。

`toolCostType('compliance_audit')` 返回 `chat`，每个图片步骤使用 vision binding 计价。不得为本地确定性检查增加费用。

- [ ] **Step 4: 运行视觉、执行和供应商错误回归**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-vision.test.ts src/__tests__/lib/platform-compliance-execution.test.ts src/__tests__/lib/skill-runtime-step-registry.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts src/__tests__/lib/skill-execution-error.test.ts`

Expected: 全部 PASS；非 JSON、空响应、超时、401、429、500 均保留精确模型和错误身份，且未调用其他供应商。

- [ ] **Step 5: 提交视觉执行**

```bash
git add src/lib/platform-compliance/vision-client.ts src/lib/platform-compliance/report-builder.ts src/lib/skill-runtime/step-registry.ts src/lib/skill-runtime/cost-estimator.ts src/__tests__/lib/platform-compliance-vision.test.ts src/__tests__/lib/platform-compliance-execution.test.ts src/__tests__/lib/skill-runtime-cost-estimator.test.ts
git commit -m "feat: execute platform compliance audits"
```

### Task 6: 持久化报告 document AssetVersion 并提供安全导出

**Files:**
- Create: `src/lib/platform-compliance/report-asset.ts`
- Create: `src/app/api/skill-reports/[runId]/[stepId]/route.ts`
- Modify: `src/lib/skill-runtime/step-registry.ts`
- Test: `src/__tests__/lib/platform-compliance-report-asset.test.ts`
- Test: `src/__tests__/api/skill-reports.test.ts`

**Interfaces:**
- Consumes: `createAssetService().createAssetVersion`、规范化 JSON、当前 actor/project、来源版本集合。
- Produces: `persistComplianceReportAsset(input): Promise<AssetVersion>` 和鉴权后的 JSON/HTML 下载端点。

- [ ] **Step 1: 写资产来源、幂等和越权导出失败测试**

```ts
it('creates a document version without changing source assets', async () => {
  const before = await readVersions(sourceVersionIds);
  const version = await persistComplianceReportAsset(reportInput);
  expect(version.file).toMatchObject({
    mimeType: 'application/json', availability: 'ready', byteSize: expect.any(Number),
  });
  expect(version.parentVersionIds).toEqual([]);
  expect(version.metadata?.sourceVersionIds).toEqual(sourceVersionIds);
  expect((await readVersions(sourceVersionIds))).toEqual(before);
});

it('rejects report download across users and projects', async () => {
  const request = requestAs(otherUser, `/api/skill-reports/${runId}/${stepId}?projectId=${projectId}&checksum=${checksum}`);
  expect((await GET(request, { params: Promise.resolve({ runId, stepId }) })).status).toBe(404);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-report-asset.test.ts src/__tests__/api/skill-reports.test.ts`

Expected: FAIL，新服务和路由不存在。

- [ ] **Step 3: 实现 document 资产和导出路由**

```ts
export async function persistComplianceReportAsset(input: PersistComplianceReportInput): Promise<AssetVersion> {
  const content = canonicalComplianceReportJson(input.report);
  const checksum = createHash('sha256').update(content).digest('hex');
  const created = await input.assetService.createAssetVersion({
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    kind: 'document',
    parentVersionIds: [],
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
    file: {
      url: reportDownloadUrl(input.runId, input.stepId, checksum, input.projectId),
      availability: 'ready', mimeType: 'application/json', byteSize: Buffer.byteLength(content), checksum,
    },
    metadata: {
      schemaId: 'platform-compliance-report-v1', reportContent: content,
      sourceVersionIds: [...input.sourceVersionIds], sourceTrace: input.sourceTrace,
    },
  });
  return created.version;
}
```

`reportDownloadUrl` 使用 `runId + stepId + checksum + projectId` 生成确定性鉴权 URL；路由从当前用户拥有的 Skill Run 事件与 document AssetVersion 元数据中同时核对 schema、checksum 和来源，不依赖客户端报告内容，也不需要修改 AssetService 的版本 ID 生成规则。

GET 路由必须认证用户，按 `projectId + runId + stepId + checksum` 读取归属，并反查对应 document AssetVersion，校验 `kind=document`、schemaId、checksum 和报告边界。`format=json` 返回 `application/json`；`format=html` 从 JSON 确定性渲染净化 HTML。响应使用 `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff` 和 `Cache-Control: private, no-store`。

- [ ] **Step 4: 运行资产与 API 安全回归**

Run: `pnpm exec vitest run src/__tests__/lib/platform-compliance-report-asset.test.ts src/__tests__/api/skill-reports.test.ts src/__tests__/api/assets-ownership.test.ts src/__tests__/lib/asset-service.test.ts`

Expected: 全部 PASS；同幂等键返回同一版本，不同摘要返回冲突，跨用户/项目不可读取，多个来源通过 metadata/sourceTrace 关联且不破坏 Asset v3 同资产父版本约束。

- [ ] **Step 5: 提交报告资产**

```bash
git add src/lib/platform-compliance/report-asset.ts src/app/api/skill-reports src/lib/skill-runtime/step-registry.ts src/__tests__/lib/platform-compliance-report-asset.test.ts src/__tests__/api/skill-reports.test.ts
git commit -m "feat: persist compliance report assets"
```

### Task 7: 注册第 28 个 Canvas/Workflow Skill

**Files:**
- Create: `src/lib/skill-runtime/platform-compliance-preset.ts`
- Modify: `src/lib/skill-runtime/types.ts`
- Modify: `src/lib/skill-runtime/catalog.ts`
- Modify: `src/lib/skill-runtime/input-resolver.ts`
- Modify: `src/components/skill-runtime/SkillInputFields.tsx`
- Test: `src/__tests__/lib/skill-runtime-platform-compliance-preset.test.ts`
- Test: `src/__tests__/lib/skill-runtime-catalog.test.ts`
- Test: `src/__tests__/components/simple-chat-skill-isolation.test.tsx`
- Test: `src/__tests__/components/skill-input-fields.test.tsx`
- Modify: `src/__tests__/fixtures/skill-runtime-presets.baseline.json`

**Interfaces:**
- Consumes: 图片扇出、`compliance_audit` adapter、vision binding 和结构化报告门禁。
- Produces: `LOVART_PLATFORM_COMPLIANCE_SKILLS` 中唯一 Skill 定义。

- [ ] **Step 1: 写目录、输入、步骤和隔离失败测试**

```ts
it('adds only the platform compliance skill to canvas and workflow', () => {
  expect(listSkillsForSurface('canvas')).toHaveLength(28);
  expect(listSkillsForSurface('workflow')).toHaveLength(28);
  expect(listSkillsForSurface('simple-chat')).toHaveLength(16);
  expect(listSkillsForSurface('simple-chat').some(skill => skill.id === 'preset-platform-compliance-audit')).toBe(false);
});

it('freezes one audit step per source image with vision binding', () => {
  const skill = requireSkillForSurface('preset-platform-compliance-audit', 'canvas');
  const steps = skillExecutionSteps(skill, validComplianceInputs(3));
  expect(steps).toHaveLength(3);
  expect(steps.every(step => step.toolId === 'compliance_audit' && step.modelRole === 'vision')).toBe(true);
});

it('uses field-specific text limits and platform-dependent region options', () => {
  const fields = complianceInputFields();
  expect(fields.find(field => field.key === 'claims')?.maximumLength).toBe(4000);
  expect(resolveSkillInputOptions(fields, { platform: 'Amazon' }, 'region'))
    .toEqual(['US', 'EU', 'JP']);
  expect(() => resolveSkillInputs(fields, {
    ...validComplianceInputs(1), platform: 'Amazon', region: 'CN', claims: 'x'.repeat(4001),
  })).toThrow();
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-platform-compliance-preset.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/components/simple-chat-skill-isolation.test.tsx`

Expected: FAIL，目录仍为 27 且新 Skill 不存在。

- [ ] **Step 3: 实现定义与服务端输入校验**

```ts
export const LOVART_PLATFORM_COMPLIANCE_SKILLS: readonly SkillDefinition[] = [{
  executionContextVersion: 1,
  id: 'preset-platform-compliance-audit',
  version: 1,
  name: '平台素材合规检查',
  category: 'commerce',
  description: '按平台、地区和素材类型逐张检查商品图片，并交付可追踪的合规报告。',
  systemPrompt: '严格依据冻结规则和可验证证据检查素材。不得把未知结论标记为通过。',
  allowedSurfaces: ['canvas', 'workflow'],
  inputs: complianceInputFields(),
  steps: [{
    id: 'audit-image', label: '检查素材', toolId: 'compliance_audit', execution: 'parallel',
    parallelGroup: 'preset-platform-compliance-audit:outputs',
    promptTemplate: '检查已授权来源图片，平台{{platform}}，地区{{region}}，素材类型{{assetType}}。',
    modelRole: 'vision', qualityGateIds: ['output-present', 'structured-report-present'],
    fanOut: { inputKey: 'sourceImages', itemAlias: 'sourceImage', maximumItems: 20, concurrency: 3 },
  }],
  enabled: true, builtIn: true, createdAt: 1, updatedAt: 1, usageCount: 0,
}];
```

输入解析必须验证平台/地区组合、素材类型枚举、1–20 个唯一来源版本，以及 `productFacts`/`claims` 4000 字符限制。目录组合顺序固定为旧 27 项后追加本项；更新保护基线时只允许新增这一个定义。

输入字段使用通用声明式约束，不按 Skill ID 写分支：

```ts
export interface SkillInputField {
  key: string;
  label: string;
  kind: SkillInputKind;
  required: boolean;
  defaultValue?: unknown;
  options?: readonly string[];
  maximumItems?: number;
  bindToSourceVersions?: boolean;
  datasetSchema?: 'sku-v1';
  maximumLength?: number;
  dependentOptions?: {
    inputKey: string;
    values: Readonly<Record<string, readonly string[]>>;
  };
}
```

`input-resolver.ts` 同时执行服务端 `maximumLength` 与 `dependentOptions` 校验；`SkillInputFields.tsx` 使用同一 `resolveSkillInputOptions(fields, values, fieldKey)` 渲染地区选项，并在平台变化导致旧地区失效时清空该字段。未声明这两个属性的旧 Skills 行为和快照保持不变。

- [ ] **Step 4: 运行目录、输入和保护测试**

Run: `pnpm exec vitest run src/__tests__/lib/skill-runtime-platform-compliance-preset.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/components/skill-input-fields.test.tsx src/__tests__/components/chat-panel-skill-catalog-contract.test.ts src/__tests__/components/simple-chat-skill-isolation.test.tsx src/__tests__/scripts/skill-runtime-inventory.test.ts`

Expected: 全部 PASS；Canvas/Workflow 28，Simple Chat 16，旧 27 摘要完全相同。

- [ ] **Step 5: 提交 Skill 定义**

```bash
git add src/lib/skill-runtime/platform-compliance-preset.ts src/lib/skill-runtime/types.ts src/lib/skill-runtime/catalog.ts src/lib/skill-runtime/input-resolver.ts src/components/skill-runtime/SkillInputFields.tsx src/__tests__/lib/skill-runtime-platform-compliance-preset.test.ts src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/components/skill-input-fields.test.tsx src/__tests__/components/simple-chat-skill-isolation.test.tsx src/__tests__/fixtures/skill-runtime-presets.baseline.json
git commit -m "feat: register platform compliance skill"
```

### Task 8: 在 Canvas AI 对话中展示逐图合规报告

**Files:**
- Create: `src/components/skill-runtime/PlatformComplianceReportCard.tsx`
- Create: `src/components/skill-runtime/platform-compliance-client.ts`
- Modify: `src/components/skill-runtime/SkillRunProgress.tsx`
- Modify: `src/components/skill-runtime/SkillRunHistory.tsx`
- Modify: `src/components/chat-panel.tsx`
- Test: `src/__tests__/components/platform-compliance-report-card.test.tsx`
- Test: `src/__tests__/components/chat-panel-platform-compliance.test.tsx`
- Test: `src/__tests__/components/skill-run-restore.test.tsx`

**Interfaces:**
- Consumes: `DurableSkillOutput kind=json`、报告 schema、来源画布定位回调和报告下载 URL。
- Produces: `PlatformComplianceReportCard`、问题筛选、定位、JSON/HTML 下载和按新规则复检动作。

- [ ] **Step 1: 写报告状态、筛选、定位和下载失败测试**

```tsx
it('renders pass warning blocked and unknown without relying on color', async () => {
  render(<PlatformComplianceReportCard report={fourStatusReport} onLocate={onLocate} />);
  expect(screen.getByText('阻止')).toBeVisible();
  expect(screen.getByText('警告')).toBeVisible();
  expect(screen.getByText('未知')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '只看问题' }));
  expect(screen.queryByText('已通过规则')).not.toBeInTheDocument();
});

it('locates the original canvas image and uses authenticated downloads', async () => {
  render(<PlatformComplianceReportCard report={report} onLocate={onLocate} />);
  await userEvent.click(screen.getByRole('button', { name: '定位画布图片' }));
  expect(onLocate).toHaveBeenCalledWith(report.sourceVersionId);
  expect(screen.getByRole('link', { name: '导出 JSON' })).toHaveAttribute('href', expect.stringContaining('format=json'));
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/components/platform-compliance-report-card.test.tsx src/__tests__/components/chat-panel-platform-compliance.test.tsx src/__tests__/components/skill-run-restore.test.tsx`

Expected: FAIL，报告卡和 JSON 投影不存在。

- [ ] **Step 3: 实现独立报告卡并最小接入现有进度区**

`PlatformComplianceReportCard` 使用现有紧凑面板样式，顶部显示结论、平台、地区、规则版本和时间；每张图片显示四种状态计数；展开规则显示证据、实测值、要求值、置信度与修复建议。按钮使用现有 lucide 图标并提供 tooltip，卡片最大高度使用内部滚动，不改变聊天输入区或画布布局。

```tsx
export function PlatformComplianceReportCard(props: PlatformComplianceReportCardProps) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const checks = problemsOnly
    ? props.report.checks.filter(check => check.status !== 'passed')
    : props.report.checks;
  return <section aria-label="平台素材合规报告" data-skill-report="platform-compliance">
    <ComplianceSummary report={props.report} />
    <ComplianceActions report={props.report} onLocate={props.onLocate} onRecheck={props.onRecheck} />
    <ComplianceCheckList checks={checks} />
  </section>;
}
```

`chat-panel.tsx` 只负责传入现有 `onNavigateToImage` 和复检回调，不内联规则渲染。复检创建新 idempotencyKey 和 Run，沿用当前来源版本与表单值，不改写历史记录。

- [ ] **Step 4: 运行报告 UI 与 Canvas Skill 回归**

Run: `pnpm exec vitest run src/__tests__/components/platform-compliance-report-card.test.tsx src/__tests__/components/chat-panel-platform-compliance.test.tsx src/__tests__/components/skill-runtime-controls.test.tsx src/__tests__/components/skill-run-history.test.tsx src/__tests__/components/skill-run-restore.test.tsx src/__tests__/components/chat-panel-skill-runtime.test.tsx`

Expected: 全部 PASS；未知与通过文本不同，定位使用来源版本，历史复检产生新 Run。

- [ ] **Step 5: 提交 Canvas 报告 UI**

```bash
git add src/components/skill-runtime/PlatformComplianceReportCard.tsx src/components/skill-runtime/platform-compliance-client.ts src/components/skill-runtime/SkillRunProgress.tsx src/components/skill-runtime/SkillRunHistory.tsx src/components/chat-panel.tsx src/__tests__/components/platform-compliance-report-card.test.tsx src/__tests__/components/chat-panel-platform-compliance.test.tsx src/__tests__/components/skill-run-restore.test.tsx
git commit -m "feat: show compliance reports in canvas chat"
```

### Task 9: 将结构化报告投影到 Workflow 下游

**Files:**
- Modify: `src/lib/workflow-skill-execution.ts`
- Modify: `src/lib/skill-runtime/workflow-client.ts`
- Modify: `src/components/workflow/WorkflowNodeCard.tsx`
- Modify: `src/components/workflow/WorkflowLegacyNodeCard.tsx`
- Test: `src/__tests__/lib/workflow-skill-node.test.ts`
- Test: `src/__tests__/components/node-editor-skill-node.test.tsx`
- Test: `src/__tests__/components/workflow-react-flow-surface.test.tsx`

**Interfaces:**
- Consumes: 报告 JSON 输出和 document AssetVersion 引用。
- Produces: `complianceReports`、`documentAssetVersionIds` 和可连接的节点输出。

- [ ] **Step 1: 写 Workflow 报告恢复和端口失败测试**

```ts
it('projects compliance reports and document versions without image coercion', () => {
  const output = projectWorkflowSkillRun(completedComplianceRun, documentReferences);
  expect(output).toMatchObject({
    complianceReports: [expect.objectContaining({ schemaVersion: 1 })],
    documentAssetVersionIds: [reportVersionId],
  });
  expect(output.imageUrls).toBeUndefined();
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/workflow-react-flow-surface.test.tsx`

Expected: FAIL，当前 Workflow 只聚合文本和图片 URL。

- [ ] **Step 3: 实现结构化报告投影与节点摘要**

`projectWorkflowSkillRun` 解析注册 schema 的 JSON 输出并添加 `complianceReports`；资产读取时根据 `Asset.kind` 区分 document 与 image，document 不写入 `imageUrl/imageUrls`。Skill 节点显示整体结论、报告数量和问题数量，输出仍保留完整 `outputs` 与 `assetVersionIds`，供后续多平台导出节点读取。

将资产种类加入现有引用合同，并由 `workflow-client.ts` 从 `/api/assets` 的受信任资产记录填充，不根据 MIME 或 URL 猜测：

```ts
export interface WorkflowSkillAssetReference {
  assetId?: string;
  assetVersionId: string;
  url: string;
  kind?: 'image' | 'video' | 'three-d' | 'document' | 'dataset';
}
```

```ts
const complianceReports = readComplianceReports(run.outputs || []);
return {
  runId: run.runId,
  status: run.status,
  taskId: run.runId,
  assetVersionIds,
  documentAssetVersionIds: references.filter(item => item.kind === 'document').map(item => item.assetVersionId),
  complianceReports,
  outputs: run.outputs || [],
};
```

- [ ] **Step 4: 运行 Workflow 与旧图片 Skill 回归**

Run: `pnpm exec vitest run src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/workflow-react-flow-surface.test.tsx src/__tests__/api/workflow-skill-execution.test.ts src/__tests__/lib/skill-content-commerce-execution.test.ts`

Expected: 全部 PASS；合规文档不伪装成图片，原图片 Skills 仍输出 imageUrls。

- [ ] **Step 5: 提交 Workflow 接入**

```bash
git add src/lib/workflow-skill-execution.ts src/lib/skill-runtime/workflow-client.ts src/components/workflow/WorkflowNodeCard.tsx src/components/workflow/WorkflowLegacyNodeCard.tsx src/__tests__/lib/workflow-skill-node.test.ts src/__tests__/components/node-editor-skill-node.test.tsx src/__tests__/components/workflow-react-flow-surface.test.tsx
git commit -m "feat: project compliance reports to workflow"
```

### Task 10: 验证 PostgreSQL 幂等、部分报告和退款一致性

**Files:**
- Create: `src/__tests__/integration/skill-platform-compliance-concurrency-postgres.test.ts`
- Modify: `src/__tests__/api/skill-runs.test.ts`
- Modify: `src/__tests__/api/skill-run-estimate.test.ts`
- Modify: `src/__tests__/lib/agent-runtime-execution-dispatch.test.ts`

**Interfaces:**
- Consumes: 完整合规 Skill、隔离 PostgreSQL、可控视觉供应商夹具和现有账务状态机。
- Produces: 并发、重试、取消、退款和迟到终态的发布证据。

- [ ] **Step 1: 写并发重复、部分失败和取消退款测试**

```ts
postgresIt('deduplicates concurrent audits and refunds only undelivered vision work once', async () => {
  const [first, replay] = await Promise.all([
    createAuthorizedComplianceRun(request), createAuthorizedComplianceRun(request),
  ]);
  expect(first.runId).toBe(replay.runId);
  await waitForFirstReport(first.runId);
  await cancelSkillRun({ actorUserId, runId: first.runId });
  expect(await countCharges(first.runId)).toBe(1);
  expect(await countRefunds(first.runId)).toBe(1);
  await deliverLateVisionResult(first.runId);
  expect((await getSkillRun({ actorUserId, runId: first.runId })).status).toBe('cancelled');
});

postgresIt('retries only the failed image and keeps the technical report version', async () => {
  const run = await executeThreeImageAuditWithSecondVisionFailure();
  const before = await reportVersions(run.runId);
  await retrySkillStep({ actorUserId, runId: run.runId, stepId: run.failedStepId });
  const after = await reportVersions(run.runId);
  expect(after.filter(version => before.includes(version))).toEqual(before);
  expect(await providerCallsFor(run.completedStepIds[0])).toBe(1);
});
```

- [ ] **Step 2: 运行隔离 PostgreSQL 测试并确认 RED**

Run:

```powershell
$pg='C:\Program Files\PostgreSQL\18\bin'
$port=55494
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use" }
$data=Join-Path $env:TEMP ('wujie-compliance-pg-'+[guid]::NewGuid())
& "$pg\initdb.exe" -D $data -U wujie_test -A trust
& "$pg\pg_ctl.exe" -D $data -o "-p $port -h 127.0.0.1" -w start
& "$pg\createdb.exe" -h 127.0.0.1 -p $port -U wujie_test wujie_compliance_test
$url="postgresql://wujie_test@127.0.0.1:$port/wujie_compliance_test"
$env:POSTGRES_TEST_DATABASE_URL=$url
$env:TEST_POSTGRES_URL=$url
$env:PGDATABASE_URL=$url
$env:DATABASE_URL=$url
try {
  pnpm exec vitest run src/__tests__/integration/skill-platform-compliance-concurrency-postgres.test.ts
} finally {
  & "$pg\pg_ctl.exe" -D $data -m fast -w stop
  Remove-Item -LiteralPath $data -Recurse -Force
}
```

Expected: FAIL，直到逐图 operation、部分报告和结算路径完整接通。连接必须由测试装置创建和销毁，不得指向开发或生产库。

- [ ] **Step 3: 仅修正测试暴露的状态与结算接线**

允许修改范围仅限：

- `src/lib/skill-runtime/service.ts`
- `src/lib/agent-runtime/service.ts`
- `src/lib/agent-runtime/downstream-operations.ts`
- `src/lib/platform-compliance/report-asset.ts`

修复必须使用数据库条件终态和既有 execution fence；禁止新增内存 Map 作为权威幂等，禁止吞掉迟到完成，禁止按 UI 状态计算退款。

- [ ] **Step 4: 运行账务与 API 回归**

Run:

```powershell
$pg='C:\Program Files\PostgreSQL\18\bin'
$port=55494
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use" }
$data=Join-Path $env:TEMP ('wujie-compliance-pg-'+[guid]::NewGuid())
& "$pg\initdb.exe" -D $data -U wujie_test -A trust
& "$pg\pg_ctl.exe" -D $data -o "-p $port -h 127.0.0.1" -w start
& "$pg\createdb.exe" -h 127.0.0.1 -p $port -U wujie_test wujie_compliance_test
$url="postgresql://wujie_test@127.0.0.1:$port/wujie_compliance_test"
$env:POSTGRES_TEST_DATABASE_URL=$url
$env:TEST_POSTGRES_URL=$url
$env:PGDATABASE_URL=$url
$env:DATABASE_URL=$url
try {
  pnpm exec vitest run src/__tests__/integration/skill-platform-compliance-concurrency-postgres.test.ts src/__tests__/integration/skill-runtime-concurrency-postgres.test.ts src/__tests__/integration/skill-prepaid-generation-postgres.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-execution-dispatch.test.ts
} finally {
  & "$pg\pg_ctl.exe" -D $data -m fast -w stop
  Remove-Item -LiteralPath $data -Recurse -Force
}
```

Expected: 全部 PASS；一个 Run、逐图唯一 operation、完成项不重扣、未交付视觉费用只退一次、迟到结果不改终态。

- [ ] **Step 5: 提交并发与账务闭环**

```bash
git add src/__tests__/integration/skill-platform-compliance-concurrency-postgres.test.ts src/__tests__/api/skill-runs.test.ts src/__tests__/api/skill-run-estimate.test.ts src/__tests__/lib/agent-runtime-execution-dispatch.test.ts src/lib/skill-runtime/service.ts src/lib/agent-runtime/service.ts src/lib/agent-runtime/downstream-operations.ts src/lib/platform-compliance/report-asset.ts
git commit -m "test: close compliance audit accounting"
```

### Task 11: 完成本地回归、云端验收和阶段记录

**Files:**
- Create: `tests/e2e/platform-compliance-skill.spec.ts`
- Modify: `docs/testing/BUG_REGISTER.md`
- Modify: `docs/testing/REGRESSION_REPORT.md`
- Modify: `docs/testing/RELEASE_READINESS_REPORT.md`
- Modify: `docs/testing/UNVERIFIED_ITEMS.md`
- Modify: `docs/superpowers/plans/2026-09-07-lovart-platform-compliance-audit.md`
- Modify after cloud acceptance: `F:\AIGC\vault-template\无界计划\11-阶段进度看板.md`
- Create after cloud acceptance: `docs/testing/evidence/lovart-platform-compliance-cloud-20260907.json`

**Interfaces:**
- Consumes: 已完成的本地候选提交和 Coze 当前 `main` 沙箱。
- Produces: 本地门禁、云端证据、中文报告和唯一 Obsidian 阶段检查点。

- [ ] **Step 1: 写 Chromium 生产态核心 E2E**

```ts
test('canvas and workflow deliver the same versioned compliance report', async ({ page }) => {
  await loginFixture(page);
  const sourceVersionIds = await seedManagedAmazonImages(page, 3);
  const canvasRun = await runCanvasComplianceSkill(page, sourceVersionIds);
  await expectComplianceReport(page, canvasRun, { minimumReports: 3, hasUnknown: false });
  const workflowRun = await runWorkflowComplianceSkill(page, sourceVersionIds);
  await expectWorkflowComplianceOutput(page, workflowRun, 3);
  await expectSimpleChatSkillCount(page, 16);
});
```

- [ ] **Step 2: 运行完整本地门禁**

Run:

```powershell
pnpm ts-check
pnpm lint
pnpm run lint:build
pnpm test
pnpm run check:protected-baseline
$env:NODE_OPTIONS='--max-old-space-size=8192'
pnpm build
```

Run with disposable PostgreSQL and controlled provider fixture:

```powershell
pnpm exec playwright test tests/e2e/platform-compliance-skill.spec.ts --project=chromium
```

Expected: 所有命令退出 0；保护基线无旧功能漂移；构建页面数与当前基线一致或仅增加已声明路由。

- [ ] **Step 3: 推送 `main` 并执行 Coze 真实验收**

确认 `git status --short` 只包含计划允许文件，`git rev-parse origin/stable` 仍为固定 SHA，再推送 `main`。Coze 拉取精确候选提交、重启沙箱，并强制刷新现有预览页；不创建新浏览器标签页。

使用管理员授权的稳定视觉供应商真实验证：

1. Canvas AI 对话选择三张受管图片执行 Amazon 主图检查。
2. 核对逐张报告、硬规则、视觉警告、unknown、规则版本和来源版本。
3. 核对冻结 provider/model、预估、实扣、取消和一次退款。
4. Workflow 运行同一 Skill 并连接下游节点。
5. 下载 JSON/HTML，刷新后恢复相同报告。
6. 确认 Canvas/Workflow 28、Simple Chat 16，所有旧入口仍存在。
7. 保存截图、Console、Network、事件、document AssetVersion 和积分流水。

- [ ] **Step 4: 更新中文测试报告与证据**

证据 JSON 必须记录：Git commit、部署地址、测试时间、浏览器、用户、Run ID、每个步骤 ID、来源与报告 AssetVersion、providerId、modelId、规则摘要、预估和实扣、退款流水、下载校验和、Console/Network 摘要及未验证项。

只有真实取得的证据可以标记通过。视觉供应商故障注入、平台规则来源或浏览器矩阵缺证时写入 `UNVERIFIED_ITEMS.md`，阶段结论使用“有条件通过”或“不通过”。

- [ ] **Step 5: 更新唯一 Obsidian 检查点并提交证据**

仅在本项实现、门禁和云端验收完成后，向 `F:\AIGC\vault-template\无界计划\11-阶段进度看板.md` 追加一次“Lovart 第三批平台合规检查阶段结论”。随后提交仓库报告和证据：

```bash
git add docs/testing docs/superpowers/plans/2026-09-07-lovart-platform-compliance-audit.md
git commit -m "docs: close platform compliance validation"
git push origin main
```

最终确认：`HEAD == origin/main`、工作树干净、`origin/stable` 未变化、`.playwright-cli/` 与 `output/` 未提交。

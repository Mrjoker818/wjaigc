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


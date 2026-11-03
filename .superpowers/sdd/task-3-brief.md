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


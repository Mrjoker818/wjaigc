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


# Task 1 独立代码审查

结论：**CHANGES REQUESTED**

审查基线：`2443c0ae655b0bcf5b503a46b68998911cd42917`

审查范围仅限 Task 1 指定的 6 个源码/测试文件。定向测试当前为 2 个测试文件、9 个测试全部通过，`pnpm exec tsc --noEmit --pretty false` 也退出 0；但测试未覆盖下列合同与安全边界问题，因此不能批准。

## Critical

无。

## Important

### 1. Amazon 地区注册表与后续 UI 的 `US / EU / JP` 合同不兼容

- 文件：`src/lib/platform-compliance/rules.ts:12-14,132-136`
- 关联测试：`src/__tests__/lib/platform-compliance-rules.test.ts:6-20`

`AMAZON_REGIONS` 注册的是 `US/CA/MX/.../JP` 等国家代码，却没有设计和后续 UI 明确输出的聚合值 `EU`。`resolveComplianceRuleSet` 又使用精确的 `regions.includes(input.region)`，所以 UI 按计划提交 `region: 'EU'` 时会得到空规则集；与此同时，`CA/MX/BR/...` 等首批合同之外的值反而会被接受并套用同一套规则。现有测试只覆盖 `US`，且 `every(...)` 对空数组也返回 `true`，无法发现此问题。

应把首批受支持地区明确建模为 `US | EU | JP`（或建立经过审计的 UI 区域到市场规则映射），对不支持组合返回稳定输入错误或明确的 `unknown`，并逐一断言三个地区都解析到非空且正确的规则集。

### 2. 规则来源更新时间和生效日期是无证据的实施日期硬编码

- 文件：`src/lib/platform-compliance/rules.ts:9-11,26-33`
- 关联测试：`src/__tests__/lib/platform-compliance-rules.test.ts:22-40`

所有规则都把 `2026-09-07` 同时写成 `sourceUpdatedAt` 和 `effectiveAt`，但仓库内没有任何来源快照、发布记录或官方页面元数据证明 Amazon 在该日更新规则或使其生效。该日期与任务实施日期相同；引用的 Seller Central 页面在未登录环境只会进入登录页，也不能为这两个日期提供证据。测试仅验证 `YYYY-MM-DD` 外形，任何虚构日期都会通过。由于这些字段进入冻结规则和摘要，这会直接污染报告的审计链。

应只写可由官方材料证明的日期并保存可复核证据；如果官方未提供更新时间/生效日，应调整模型明确表达“未知”，或把“本规则快照采集/发布日”放在语义不同的字段中，不能冒充官方日期。测试应核对证据化的具体元数据，而不只是正则格式。

### 3. 空白字符串会被当作有效证据，缺失证据仍可判为通过

- 文件：`src/lib/platform-compliance/report-schema.ts:134-137,145-162`
- 关联测试：`src/__tests__/lib/platform-compliance-report-schema.test.ts:10-31`

`stringArray` 只检查元素类型，`parseCheck` 又只检查 `evidence.length`。因此 `status: 'passed', evidence: ['']` 或 `evidence: ['   ']` 会保留 `passed`，汇总和整体 verdict 也会重算为通过。这违反“报告解析不得把缺失证据判为通过”的明确要求。现有测试只覆盖真正的空数组，遗漏了等价的空白证据。

应将证据项规范化并要求至少一个非空、非纯空白字符串；否则强制为 `unknown`。同时补充空字符串和纯空白字符串回归测试。

### 4. 规则模块引入 Node-only `node:crypto`，破坏共享/客户端复用边界

- 文件：`src/lib/platform-compliance/rules.ts:1,118-146`

`rules.ts` 是无 `.server` 边界的通用领域模块，但为了同步生成摘要直接导入 `node:crypto`。后续 UI/Workflow 若复用规则选择或规则元数据，该模块无法进入浏览器 bundle；这与审查简报要求的“未来客户端复用模块不得无意引入 Node-only 依赖”冲突。

应把 Node 摘要实现隔离到显式服务端模块，保留纯数据/选择逻辑为客户端安全模块；或者采用项目认可的跨运行时摘要实现，并增加客户端构建/导入保护测试。

### 5. 规则选择测试包含真空断言，没有实际验证分类过滤和非空解析

- 文件：`src/__tests__/lib/platform-compliance-rules.test.ts:6-20,43-57`

第一项测试的 `frozen.rules.every(...)` 在规则集为空时仍通过；分类测试同样用 `every(...)`，但当前 `AMAZON_RULES` 根本没有带 `categories` 的规则，因此它没有验证“仅精确分类生效”，只是验证了一个恒真的条件。两项测试都可能在解析器漏选全部规则时继续绿灯，属于用错误断言制造通过。

应先断言期望的规则 ID/数量非空，再加入至少一个真实分类规则夹具或可注入注册表，分别验证匹配分类、错误分类和空分类；稳定摘要还应显式比较 digest，而不只比较整个返回对象。

### 6. 256 KiB 边界在完整递归复制和序列化后才检查，超大数组可绕过键数门并造成资源放大

- 文件：`src/lib/platform-compliance/report-schema.ts:45-93`

对象键会计数，但数组元素不计入 `state.keys`；`canonicalize` 会先对整个数组 `map` 并复制所有元素，随后 `JSON.stringify`，最后才检查 256 KiB。攻击者可在 `extensions` 中放入极大的标量数组，使实现先遍历并复制远超合同大小的数据，再返回 `REPORT_SIZE_LIMIT`，造成明显 CPU/内存放大。总字节上限因此不是有效的处理边界。

应在进入对象解析前限制原始 JSON 字节，并在规范化过程中设置数组元素/节点总数或增量字节预算，确保超限输入在大量分配前失败。测试应覆盖大数组，而不只覆盖大字符串和宽对象。

## Minor

### 1. “递归拒绝禁用键”对数组的自有属性不成立

- 文件：`src/lib/platform-compliance/report-schema.ts:64-82`

数组分支在检查对象自有键之前直接 `map`；通过 `Object.defineProperty` 附加到数组的可枚举 `__proto__`、`prototype` 或 `constructor` 属性不会被检查。它们最终虽会被 JSON 数组序列化忽略，但仍不满足“递归拒绝”这一明确合同。应先检查所有容器的自有键，或明确只接受标准、无附加属性的数组。

### 2. 报告时间字段没有语义校验

- 文件：`src/lib/platform-compliance/report-schema.ts:246-250`

`generatedAt` 只要求非空字符串，诸如 `not-a-date` 也会作为合法审计报告时间进入结果。应验证为约定格式的有效 ISO 8601 时间，并补充无效日期及不可归一化日期测试。

### 3. 边界测试未覆盖循环引用、精确上限和全部禁用键

- 文件：`src/__tests__/lib/platform-compliance-report-schema.test.ts:33-52`

实现包含 `REPORT_CYCLE`，但没有循环引用测试；深度、键数、字符串和字节只测试超限，没有证明恰好位于上限时可接受；禁用键只显式覆盖 `constructor`，没有覆盖自有 `__proto__`、`prototype` 以及嵌套/数组位置。应补齐这些边界，避免后续改动出现 off-by-one 或分支遗漏。

## 验证记录

- `pnpm exec vitest run src/__tests__/lib/platform-compliance-rules.test.ts src/__tests__/lib/platform-compliance-report-schema.test.ts`：退出 0；2 files passed，9 tests passed。
- `pnpm exec tsc --noEmit --pretty false`：退出 0。
- 未修改任何源码，未提交。

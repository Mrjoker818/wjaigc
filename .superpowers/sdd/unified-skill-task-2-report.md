# Unified Skill Runtime Task 2 实现报告

## RED

- 初始命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`
- 初始结果：exit 1；2 个测试文件均在收集阶段失败，分别缺少 `input-resolver` 和 `quality-gates`，且输入测试同时引用尚不存在的 `prompt-compiler`。失败原因是 brief 要求的三个生产模块尚未创建，符合 TDD RED。
- 自审补强 RED：`pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts`
- 补强结果：exit 1；11 个测试中 2 个失败，准确暴露默认值可绕过原型键检查、替换值可留下二次占位符两个缺口。

## GREEN

- 聚焦命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`
- 结果：exit 0；2 个测试文件、15 个测试全部通过。
- Task 1 兼容命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`
- 兼容结果：exit 0；3 个测试文件、14 个测试全部通过。
- TypeScript：`pnpm exec tsc -p tsconfig.json --noEmit`，exit 0。
- 限定 ESLint：`pnpm exec eslint src/lib/skill-runtime/types.ts src/lib/skill-runtime/input-resolver.ts src/lib/skill-runtime/prompt-compiler.ts src/lib/skill-runtime/quality-gates.ts src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`，exit 0，0 errors，0 warnings。
- `git diff --check`：exit 0；仅 Git 提示 `types.ts` 后续可能按工作树设置转换 LF/CRLF，无空白错误。

## 修改文件

- `src/lib/skill-runtime/input-resolver.ts`
- `src/lib/skill-runtime/prompt-compiler.ts`
- `src/lib/skill-runtime/quality-gates.ts`
- `src/lib/skill-runtime/types.ts`
- `src/__tests__/lib/skill-runtime-inputs.test.ts`
- `src/__tests__/lib/skill-runtime-quality.test.ts`
- `.superpowers/sdd/unified-skill-task-2-report.md`

## 实现摘要

- `resolveSkillInputs()` 拒绝未知字段、空必填、错误类型、非法 select、非有限数字和任意层级对象原型键；支持 text/image/images/brand-kit/dataset/select/number/boolean 与默认值。
- 固定限制为文本 16384 字符、图片 16 个、dataset 1000 行、原始输入 UTF-8 JSON 序列化 512 KiB；`images.maximumItems` 以不超过全局 16 的更小值生效。
- `compileSkillPrompt()` 只读取 values 的自有键，结构值使用 JSON 确定性序列化，并拒绝缺失、替换后残留和对象原型键占位符。
- `runSkillQualityGates()` 提供 output-present、expected-count、transparent-alpha、valid-html 四项确定性门禁；expected-count 读取 `context.expectedCount`，未知 ID 返回带错误文本的明确失败。

## 风险

- dataset 只约束为普通对象行、总行数和总序列化容量，不推断业务列 schema；列级 schema 应由后续 Skill 定义能力承担，本任务未扩展。
- `SkillStepResult` 和媒体类型仅包含当前四项门禁所需字段，后续执行器若需要更多元数据应增量扩展，当前没有接入 UI、API、Agent 执行器或节点。
- 工作树开始时已有 `.playwright-cli/`、两个 `_refs-*` 目录和一份 docs 计划文件未跟踪；本任务未读取修改、未暂存这些保护项。

## 自审

- brief 所列八种输入 kind 均有成功契约，所有硬限制均覆盖边界值与越界值。
- 原始输入和默认值均扫描 `__proto__`、`prototype`、`constructor`；未知字段在解析前被拒绝。
- 模板使用 `Object.prototype.hasOwnProperty.call`，不会从对象原型链取值；替换完成后再次扫描占位符，避免占位符注入残留。
- 质量门禁无网络、时间、随机数或外部状态依赖；未知门禁不可能静默通过。
- 修改未接入任何运行表面，未修改 `stable`，未推送，也未触碰任务开始前已有的未跟踪项。

## 审查修复：4 Important + 1 Minor（2026-09-02）

### RED

- 先仅扩充 `src/__tests__/lib/skill-runtime-inputs.test.ts`，未修改生产实现。
- 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`
- 结果：exit 1；31 个测试中 15 个失败、16 个通过。
- 失败准确覆盖：定制原型 raw 被接受、非法 `maximumItems` 静默绕过、默认值未参与 512 KiB 门禁、循环/BigInt/function/symbol/undefined 被 JSON.stringify 丢弃或泄漏无字段错误、模板值泄漏原生 TypeError/输出 undefined、`{{}}` 与 `{{product` 未被识别。

### 最小实现

- `resolveSkillInputs()` 仅接受 `Object.prototype` 或 null prototype 的普通对象；字段读取改用 `Object.hasOwn()`，定制原型值不能满足必填。
- 新增 `SKILL_INPUT_INVALID_DEFINITION`；`maximumItems` 只有有限非负整数合法，最终图片上限始终取其与全局 16 的较小值。
- 对每个实际解析值执行严格 JSON 树遍历：拒绝循环、BigInt、function、symbol、非有限数字、undefined 容器成员、稀疏数组、访问器、非普通对象及会被 JSON 静默忽略的自有键；共享但不循环的引用保持合法。
- 缺席 optional 仍作为输出顶层 `undefined` 保留；完整解析输出（包括默认值）重新 JSON 序列化并执行 512 KiB UTF-8 门禁。
- `compileSkillPrompt()` 新增 `SKILL_PROMPT_INVALID_VALUE`，所有不可严格 JSON 序列化的模板值统一抛 `SkillPromptError`；占位符改为顺序扫描，拒绝空占位符、未闭合占位符和替换后残留。

### GREEN 与验证

- Task 2：`pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`，exit 0；2 个文件、31 个测试通过。
- Task 1 兼容：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`，exit 0；3 个文件、14 个测试通过。
- TypeScript：`pnpm exec tsc -p tsconfig.json --noEmit`，exit 0。
- 限定 ESLint：原 Task 2 六个源码/测试文件，exit 0，0 errors，0 warnings。

### 本轮风险与自审

- 严格 JSON 合同刻意拒绝 Date、Map、Set、类实例、访问器和带额外自有属性的数组；这些值不是 JSON 数据模型，调用方需先归一化。
- 512 KiB 检查现在针对最终输出，替代初版仅检查 raw 的说明；因此默认值不能再扩大绕过总量门禁。
- 未修改质量门禁、catalog、inventory、UI、API、Agent、节点或 `stable`；任务开始前已有的四个未跟踪保护项保持未暂存、未修改。

## 第二轮复审：2 Important + 1 Minor（2026-09-02）

### RED

- 先只修改 `src/__tests__/lib/skill-runtime-inputs.test.ts`，新增 getter、副作用计数、非枚举大值/污染键、Symbol 与非枚举未知字段合同。
- 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-inputs.test.ts src/__tests__/lib/skill-runtime-quality.test.ts`
- 结果：exit 1；37 个测试中 6 个失败、31 个通过。
- 失败证据：raw 与模板 values 的 getter 实际执行并泄漏原生 Error；dataset getter 被执行；非枚举声明/未知/污染键和 Symbol 未知键被忽略；模板结构中的非枚举大值被 JSON.stringify 静默丢弃。

### 最小实现

- input 与 prompt 各自新增内部 descriptor snapshot：先调用 `Object.getOwnPropertyDescriptors()` 与 `Reflect.ownKeys()`，之后才做原型判断、字段分类或值递归。
- 所有递归只读取 data descriptor 的 `.value`；getter/setter 在读取前分别稳定抛 `SkillInputError` / `SkillPromptError`，测试中的 getter 调用计数均保持 0。
- 除数组内建 `length` 外，统一拒绝非 enumerable 自有数据属性；原型污染键优先返回 forbidden-key 领域错误，不能通过非枚举隐藏。
- raw unknown 检查改用 `Reflect.ownKeys()`：Symbol 键、非枚举未知字符串均拒绝；已声明但非枚举的字段按 strict value 合同拒绝。
- 模板 values 容器及其结构值应用相同 descriptor 合同，编译器不再通过 `values[key]` 直接读取属性。

### GREEN 与验证

- Task 2 聚焦：2 个文件、37 个测试通过。
- Task 1 兼容：3 个文件、14 个测试通过。
- TypeScript：`pnpm exec tsc -p tsconfig.json --noEmit`，exit 0。
- 限定 ESLint：原 Task 2 六个源码/测试文件，exit 0，0 errors，0 warnings。
- 源码直读扫描确认 raw、template values 和递归对象不再使用属性索引读取；两处数组 `.some()` 只在 descriptor 校验确认所有元素均为 enumerable data descriptor 后执行。

### 风险与自审

- descriptor 合同针对普通对象/数组；恶意 Proxy 的 ownKeys/getOwnPropertyDescriptor trap 仍属于 JavaScript 元对象协议，无法承诺零副作用，本轮审查未要求接纳 Proxy。
- 数组 `length` 是唯一允许的非 enumerable 自有数据属性；稀疏数组、额外属性、Symbol 属性和访问器元素继续拒绝。
- 未修改 `stable`、质量门禁或 Task 1 文件，未推送；四个既有未跟踪保护项保持原样。

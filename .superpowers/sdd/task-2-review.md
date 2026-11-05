# Task 2 独立审查

结论：**NOT APPROVED**。

## Critical

无。

## Important

### I1. 重复图片值产生重复 step ID，破坏步骤身份与持久执行语义

- 文件：`src/lib/skill-runtime/step-compiler.ts:115-124`
- 图片步骤 ID 仅由图片值摘要构成：`id: ${step.id}:${digest}`。同一数组中出现重复 AssetVersion ID 时，两个步骤虽然 `itemIndex` 不同，却得到完全相同的 ID。
- 实测 `['asset_a', 'asset_a']` 生成两个 `audit:71ca9f399ceeb4f9`。这不只是显示问题：`src/lib/agent-runtime/service.ts:812-814` 用 step ID 建成本 Map，执行器也用 step ID 构造事件、完成集合和输出 Map，重复 ID 会合并计费/完成/恢复身份并覆盖同组结果。
- Task 2 明确要求重复值与稳定身份边界；应拒绝重复图片，或为重复 occurrence 生成既确定又唯一的身份，并增加执行/恢复回归。

### I2. 恢复路径从未用冻结输入重算 `itemDigest`，合法形状的漂移快照会被接受

- 文件：`src/lib/skill-runtime/step-compiler.ts:153-176`、`src/lib/skill-runtime/continuation.ts:245-257`、`src/lib/skill-runtime/service.ts:549-573`
- `compiledSkillFanOutValue()` 实现了按 `inputKey + itemIndex` 取冻结值并比对摘要，但全仓只有定义和测试引用；生产恢复路径没有调用它。
- continuation 仅解析快照形状，随后解析输入和来源绑定；没有逐个 compiled step 对冻结 `inputValues` 重算摘要。skill service 的 retry 同样只读 `frozenExecutionSteps()` 后按 ID 调度。
- 因此，只要 `inputKey`、索引和摘要格式合法，即使摘要与冻结输入不一致，恢复/重试仍会接受，违反“恢复时使用冻结输入重算摘要并拒绝漂移”。应在 continuation 和 retry 所依赖的冻结步骤读取边界统一校验，并覆盖摘要漂移测试。

### I3. 可选 images 缺失在标准请求路径中会错误失败

- 文件：`src/lib/skill-runtime/step-compiler.ts:101-107`，关联 `src/lib/skill-runtime/input-resolver.ts:241-263`
- 编译器只在输入对象没有 own property 时返回未扇出的 base step；但 `resolveSkillInputs()` 会为每个声明字段写入 own property，即使值为 `undefined`。
- 因此可选 images 省略后，标准解析结果仍有 `images: undefined`，编译器进入数组校验并抛 `SKILL_STEP_FAN_OUT_INVALID`。探针确认 `{}` 直接编译成功，而 `{ images: undefined }` 失败。
- 应明确缺失语义（跳过该 fan-out step 或保留单步），并同时处理 absent 与 resolved-undefined，增加经 `resolveSkillInputs()` 的端到端回归。

### I4. 计划要求的 20 张图片无法通过真实输入解析层

- 文件：`src/lib/skill-runtime/step-compiler.ts:105-107`，关联 `src/lib/skill-runtime/input-resolver.ts:4-8,142-147`
- 新编译器宣称 images fan-out 最多 20 项，但现有全局 `SKILL_INPUT_LIMITS.images` 仍是 16；`resolveSkillInputs()` 对声明 `maximumItems: 20` 的 20 项输入先抛 `SKILL_INPUT_LIMIT_EXCEEDED`。
- 五文件回归绕过了标准解析器，直接调用编译器，所以没有发现该产品路径断点。应使输入层与 Task 2 的 1–20 合同一致，并测试 20 通过、21 拒绝。

### I5. 四类快照路径对 compiled fan-out 的结构约束不一致

- 文件：`src/lib/skill-runtime/storage.ts:222-232`、`src/lib/skill-runtime/service.ts:320-339`、`src/lib/skill-runtime/continuation.ts:54-74`
- storage 除校验字段形状外，还要求 compiled fan-out 步骤必须是 `execution: 'parallel'` 且有字符串 `parallelGroup`。skill service 与 continuation 只校验 compiled 对象及 fanOut 互斥，会接受 sequential 或无 parallelGroup 的 compiled step。
- 这违反简报要求的四类路径规则完全一致，并允许同一快照在一个边界拒绝、在另两个恢复边界接受。应复用一个严格解析/校验器，覆盖两种非法结构及 compiled 对象额外键。

### I6. 通用图片扇出编译器不验证 AssetVersion ID

- 文件：`src/lib/skill-runtime/step-compiler.ts:110-125`，关联 `src/lib/skill-runtime/run-request.ts:151-169`
- 图片分支只要求非空、无首尾空白字符串，`'not an asset id'` 以外的许多非法值仍可进入摘要和步骤身份。AssetVersion 校验仅在输入字段显式 `bindToSourceVersions` 时由请求层执行；通用 images fan-out 定义本身未要求该标志。
- Task 2 的产出合同是 1–20 个 AssetVersion ID。应在 fan-out 定义/编译边界要求来源绑定并使用 `isAssetVersionId()`，或以等价方式保证任何可编译 images fan-out 都只接受 AssetVersion ID。

## Minor

### M1. 摘要 helper 对非 JSON 值先序列化、后判型，泄漏裸运行时异常

- 文件：`src/lib/skill-runtime/step-compiler.ts:40-44,169-175`
- `compiledSkillFanOutValue()` 在确认值属于允许类型前调用 `valueDigest()`；BigInt 探针得到原生 `TypeError: Do not know how to serialize a BigInt`，而不是 `SkillStepFanOutError`。循环对象也会产生非合同异常。
- 虽然标准请求解析器通常先做严格 JSON 校验，导出的 helper 本身仍未封闭该边界。应先验证值/原型/JSON 可序列化性，或捕获摘要异常并统一转换为 fan-out 错误。

## 其余核对

- `compiledFanOut` 的正常序列化内容仅包含 `inputKey`、`itemIndex`、`itemDigest`；新增步骤快照中未发现图片原值泄露。
- dataset 分支的摘要算法、提示词物化、顺序和 chunk 计算相对基线没有代码语义变化；现有三行执行回归及新增精确快照均通过。
- `src/lib/skill-runtime/continuation.ts` 的范围勘误合理：它确实是冻结快照恢复解析器，属于满足 Task 2 “所有读取路径”所需的最小范围。
- 暂存区恰好九个 Task 2 文件；未发现 UI、API、step adapter 或其他 Task 3 实现。

## 验证证据

- 五文件回归：`5 files / 53 tests passed`，exit 0。
- `pnpm ts-check`：exit 0。
- 暂存九文件目标 ESLint：exit 0，0 errors，0 warnings。
- `git diff --cached --check`：exit 0。
- `git diff --check`（整个工作区）：因审查范围外、未暂存的 `.superpowers/sdd/task-2-brief.md:92` 末尾空行而非零；该文件按只读要求未修改。暂存 Task 2 diff 本身 clean。
- 只读边界探针：重复值 ID 碰撞、resolved `undefined` 可选字段失败、20 项输入被 16 项上限拒绝、BigInt 返回裸 TypeError，均已复现。


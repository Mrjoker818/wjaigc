# Task 1 实现报告

## RED

- 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts`
- 结果：exit 1，1 个测试文件在收集阶段失败。
- 预期失败原因：`@/lib/skill-runtime/catalog` 不存在（`Cannot find module '@/lib/skill-runtime/catalog'`）。
- 判定：失败来自 catalog 尚未实现，不是测试语法错误，符合 TDD RED 要求。
- 澄清后新增契约 RED 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts`。
- 澄清后 RED 结果：exit 1；3 个测试中 2 个通过，新增的“画布聊天面板复用唯一目录”失败，因为 `chat-panel.tsx` 尚未导入 `CANVAS_PRESET_CHAT_SKILLS`。

## 修改文件

- `src/lib/skill-runtime/types.ts`
- `src/lib/skill-runtime/canvas-presets.ts`
- `src/lib/skill-runtime/simple-chat-presets.ts`
- `src/lib/skill-runtime/catalog.ts`
- `src/components/chat-panel.tsx`
- `src/components/simple-chat/simple-chat-types.ts`
- `src/__tests__/lib/skill-runtime-catalog.test.ts`
- `.superpowers/sdd/task-1-report.md`（用户明确要求的交付报告）

## GREEN

- 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`
- 结果：exit 0；2 个测试文件通过，8 个测试通过，0 个失败。
- 附加检查：限定文件 ESLint，exit 0、0 errors；`chat-panel.tsx` 报告 55 条既有 warnings，未做范围外清理。
- 附加检查：`pnpm exec tsc -p tsconfig.json --noEmit`，exit 0。
- 迁移核验：HEAD 中画布原始对象块与 `RAW_CANVAS_PRESET_SKILLS` 逐字符相等；Simple Chat 的 HEAD 原始对象块与 `RAW_SIMPLE_CHAT_PRESET_SKILLS` 逐字符相等。
- 唯一来源核验：`chat-panel.tsx` 不再包含内联画布目录或 `preset-ecommerce-listing`，只导入 `CANVAS_PRESET_CHAT_SKILLS`；该 ID 在 `canvas-presets.ts` 原始对象块中只出现一次。
- 工作树核验：`git diff --check` exit 0，仅有 Git 的 LF/CRLF 提示，无空白错误。

## 风险

- 附加运行 `pnpm exec vitest run src/__tests__/scripts/stage-4-inventory.test.ts` 时失败：`inventory.skills.length` 为 0。模块对 `PRESET_SKILLS` 的导入已成功，失败原因是该 inventory 生成器硬编码静态扫描 `simple-chat-types.ts` 中的内联数组；本任务按 brief 将数组迁移并改为重导出后，它尚未跟随新目录位置。该生成器及其测试不在 Task 1 允许修改文件内，因此未越界修复。
- `Date.now()` 字段按原对象机械保留；不同模块加载时刻会产生运行期时间差，这是原有行为，不影响固定 ID、文案、参数默认值或步骤文字。

## 控制器修复补充

- 已稳定复现 Stage 4 inventory 回归：旧脚本只扫描 `simple-chat-types.ts` 的内联 `PRESET_SKILLS`，迁移后得到 0 项。
- 先扩充既有 inventory 测试，明确要求同时发现独立对话 `ppt-master` 与画布 `preset-ecommerce-listing`，RED 仍为 `inventory.skills.length === 0`。
- 最小修复 `scripts/stage-4-inventory.mjs`：改为扫描两份唯一目录文件并合并去重，不修改 Skill 数据和业务 UI。
- GREEN：`skill-runtime-catalog`、`simple-chat-model-selector-contract`、`stage-4-inventory` 共 3 文件 / 9 测试通过；限定 ESLint 为 0 errors，新增 warning 为 0。

## 自审

- 21 个画布 Skill ID 和顺序与 brief 完全一致，只授权 `canvas,workflow`。
- 16 个 Simple Chat Skill 只授权 `simple-chat`，未混入任何画布 ID。
- 画布 Skill 的 ID、名称、描述、`systemPrompt`、参数默认值、步骤文字均通过原始对象块逐字符对比确认未改动。
- 21 项原始画布对象只存在于 `canvas-presets.ts`；目录定义和 `chat-panel.tsx` 兼容消费均由同一数组派生。
- `simple-chat-types.ts` 保留 `PresetSkill` 接口，并通过 `export { SIMPLE_CHAT_PRESET_SKILLS as PRESET_SKILLS }` 维持现有导入名。
- 未修改 `stable`，未推送，未修改或删除任务开始前存在的未跟踪保护项，也未暂存用户已修改的 `task-1-brief.md`。

## 独立审查 Important findings 修复（2026-09-02）

### RED

- 初始命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`
- 初始结果：exit 1；3 个测试文件中 1 个失败，新增 inventory 提取器合同因现有函数未导出而失败（`extractSkillIds is not a function`）。
- 有效行为 RED 命令：`pnpm exec vitest run src/__tests__/scripts/stage-4-inventory.test.ts`
- 有效行为 RED 结果：exit 1；现有全文件正则错误返回 `outside-before`、`outside-after`，精确复现“扫描指定 RAW 数组之外 ID”的审查问题。

### 最小实现

- `extractSkillIds(source, arrayName)` 先以命名声明定位数组，再用字符串/模板字符串/注释感知的括号扫描截取数组边界；两个生产调用点分别固定到 `RAW_CANVAS_PRESET_SKILLS` 和 `RAW_SIMPLE_CHAT_PRESET_SKILLS`。
- inventory 断言改为完整且精确的 37 个预期 ID，不再使用数量下限。
- 新增从迁移前提交 `2faeec0b` 机械生成的独立 baseline fixture。目录测试对完整 21/16 ID 以及每项原始 `name/category/description/systemPrompt`、画布 `paramSlots`（含 `defaultValue/placeholder`）与 `steps`（含文字/role）、Simple Chat `icon/tags` 做逐字段比较，不与生产代码自身互比。
- 403/404 测试完整锁定错误类及构造器、`code`、`status`、`message`。

### GREEN 与验证

- GREEN 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`
- GREEN 结果：exit 0；3 个测试文件通过，14 个测试通过，0 个失败。
- `pnpm exec tsc -p tsconfig.json --noEmit`：exit 0。
- 限定 ESLint：exit 0，0 errors；仅 `scripts/stage-4-inventory.mjs` 的既有 `appFileToRoute` 未使用 warning。
- `git diff --check`：exit 0；仅 Git 的 LF/CRLF 提示，无空白错误。

### 本轮修改文件

- `scripts/stage-4-inventory.mjs`
- `src/__tests__/scripts/stage-4-inventory.test.ts`
- `src/__tests__/lib/skill-runtime-catalog.test.ts`
- `src/__tests__/fixtures/skill-runtime-presets.baseline.json`
- `.superpowers/sdd/task-1-report.md`

本轮未修改 `stable`，未推送，未触碰或暂存任务开始前已有的未跟踪项，也未暂存用户已修改的 `.superpowers/sdd/task-1-brief.md`。

## 第二次独立复审 Important 修复（2026-09-02）

### RED

- 命令：`pnpm exec vitest run src/__tests__/scripts/stage-4-inventory.test.ts`
- 结果：exit 1；2 个测试中 1 个失败。旧实现除两个顶层 Skill ID 外，还错误返回 `nested-id`、`line-comment-id`、`block-comment-id`、`string-id`、`template-id`，精确覆盖嵌套对象、行/块注释、普通字符串和模板字符串误报。

### 最小实现与 GREEN

- 保留命名 RAW 数组边界解析；数组内部改为词法扫描，感知字符串/模板、转义、行/块注释和花括号深度，仅在顶层 Skill 对象深度为 1 时读取直接 `id` 属性。
- GREEN 命令：`pnpm exec vitest run src/__tests__/lib/skill-runtime-catalog.test.ts src/__tests__/scripts/stage-4-inventory.test.ts src/__tests__/components/simple-chat-model-selector-contract.test.ts`
- GREEN 结果：exit 0；3 个测试文件通过，14 个测试通过，0 个失败；真实 inventory 继续精确锁定 37 个 ID。
- `pnpm exec tsc -p tsconfig.json --noEmit`：exit 0。
- 限定 ESLint：exit 0，0 errors；仅既有 `appFileToRoute` 未使用 warning。
- `git diff --check`：exit 0；仅 Git 的 LF/CRLF 提示，无空白错误。

### 本轮修改文件

- `scripts/stage-4-inventory.mjs`
- `src/__tests__/scripts/stage-4-inventory.test.ts`
- `.superpowers/sdd/task-1-report.md`

本轮未修改 `stable`，未推送，未触碰或暂存用户修改的 brief 与既有未跟踪保护项。

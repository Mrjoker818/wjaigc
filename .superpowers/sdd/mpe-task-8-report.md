# Task 8 实施报告

## 结论

状态：**本地 GREEN；未推送。**

- 开始基线：`main@4becc3fb2ce8cd81a9f0b0a9b48dea30f1d20ca4`。
- 目标提交信息：`feat: project batch exports in workflows`。
- 仅在指定 `main` 工作区实施，未触碰 `stable`，未 amend，未 push。
- Simple Chat 未增加多平台批量导出 Skill 目录入口。

## TDD 证据

先新增 Task8 三个测试文件中的失败合同，再修改生产代码。

### RED

按 brief 首先执行：

```text
pnpm exec vitest run src/__tests__/components/node-editor-multi-platform-export.test.tsx src/__tests__/lib/workflow-multi-platform-export.test.ts
```

第一次运行发现 UI 测试误用了仓库未安装的 `jest-dom` matcher；改为仓库既有 Chai 风格后重新运行，得到有效 RED：

```text
2 个测试文件失败
2 个测试失败，1 个测试通过
```

真实失败分别证明：

1. 节点 Workflow 目录没有把服务端平台预设注入 `targetPresetIds`，找不到目标平台复选项；
2. `projectWorkflowSkillRun()` 没有投影 `outcome`、图片版本、manifest 版本和 ZIP 版本。

同时，上游受管版本到 `sourceAssetVersionIds` 以及默认空 `modelBindings` 的底层请求合同已经存在并通过。

### GREEN

最小实现后重复同一命令：

```text
2 个测试文件通过
3 个测试通过
0 失败
```

## 实现内容

### 节点输入与模型绑定

- Workflow 目录发现 `preset-multi-platform-export` 时，复用 Task7 的服务端预设客户端读取启用版本，并把冻结引用（`presetId-vN`）注入现有 `SkillInputFields` 多选控件。
- 来源图片继续由既有上游端口解析，只提交受管 `AssetVersion` ID，并绑定到 `sourceAssetVersionIds`。
- 本地 runtime 沿用 `requiredSkillModelRoles()`，不渲染 `orchestrator 模型`。
- Workflow 最终提交前按 Skill 实际需要的模型角色过滤绑定；纯本地 Skill 因角色集合为空，提交 `modelBindings: {}`。
- 命名、适配和背景继续复用 Skill 定义驱动的既有节点输入控件，没有复制执行器。

### 结构化结果投影

- `projectWorkflowSkillRun()` 读取最后一个注册的 `multi-platform-export-result-v1` 输出，并通过现有严格 schema parser 再校验。
- 新增投影字段：`outcome`、`imageAssetVersionIds`、`manifestAssetVersionId`、`zipAssetVersionId`。
- 图片 URL、普通 `assetVersionIds`、`documentAssetVersionIds`、文本和历史普通 Skill 输出保持兼容。

## 验证结果

### Brief 指定测试

```text
4 个测试文件通过
83 个测试通过
0 失败
```

### 相关回归

覆盖 Workflow Skill 客户端、批量导出 preset、Simple Chat 目录隔离与 API scope：

```text
4 个测试文件通过
71 个测试通过
0 失败
```

### 静态门禁

```text
pnpm ts-check：退出码 0
目标 ESLint --quiet：退出码 0
Task8 精确路径 git diff --check：退出码 0
```

全工作区 `git diff --check` 退出码为 1，唯一原因是任务开始前已经存在、且 brief 明确禁止修改的三份 SDD 文档含 EOF 空行：

- `.superpowers/sdd/task-2-brief.md`
- `.superpowers/sdd/task-2-review.md`
- `.superpowers/sdd/task-3-brief.md`

这些文件未被本任务修改、暂存或还原；Task8 精确路径检查通过。

## 保护边界

以下任务开始前的既有脏文件保持未暂存、未还原：

- `.superpowers/sdd/mpe-progress.md`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/task-1-brief.md`
- `.superpowers/sdd/task-1-review.md`
- `.superpowers/sdd/task-2-brief.md`
- `.superpowers/sdd/task-2-review.md`
- `.superpowers/sdd/task-3-brief.md`

本报告受 SDD 目录忽略规则覆盖，仅对本文件精确 `force-add`。提交中只包含 Task8 brief 列出的生产/测试文件与本报告。

## Concerns

- 未执行云端 Coze、真实浏览器或 PostgreSQL 专项验收；这些不在 Task8 brief 的本地门禁范围内。
- Vitest 在 jsdom 测试中打印既有 `--localstorage-file` 路径 warning，不影响退出码与断言结果。

## NEEDS_FIXES 复审修复

### 复审结论验证

两项反馈均经代码路径核对确认：

1. `workflow-node` estimate 冻结纯 local Skill 的空绑定后，仍以非空断言读取 `bindings.orchestrator`，导致请求进入统一 `500` 错误封装；
2. `buildWorkflowSkillRunRequest()` 原样透传节点 `modelBindings`，旧工作流或导入节点可绕过 UI 过滤并携带无效 orchestrator。

### TDD RED

先新增真实 estimate route 测试，并把 Workflow 请求断言升级为严格空对象。生产代码修改前执行：

```text
pnpm exec vitest run src/__tests__/api/skill-run-estimate-local.test.ts src/__tests__/lib/workflow-multi-platform-export.test.ts

2 个测试文件失败
2 个测试失败，2 个测试通过
```

失败证据：

- local multi-platform Skill 使用 `modelBindings: {}` 请求 Workflow estimate 时实际返回 `500`，预期 `200`；
- 带历史残留 orchestrator 的 local Skill 底层请求实际输出该残留绑定，预期严格 `{}`。

同一轮中非本地 model-backed estimate 测试通过，固定了旧路径行为。

### 最小修复

- estimate route 仅在权威冻结绑定中确有 orchestrator 时构建并授权模型 Agent 上下文；纯 local Skill 直接进入现有成本估算，返回零费用与空冻结绑定。
- `buildWorkflowSkillRunRequest()` 使用 `requiredSkillModelRoles(skill)` 构造底层白名单绑定对象。UI 层过滤继续保留，但不再是唯一保护。
- 非本地 Skill 的 orchestrator、image 等合法角色继续保留，并沿用既有授权与费用估算。

### TDD GREEN 与回归

直接 RED 套件修复后：

```text
2 个测试文件通过
4 个测试通过
0 失败
```

Task8 brief 全套加 estimate route、run-request、workflow estimate 与底层 Workflow Skill 回归：

```text
9 个测试文件通过
157 个测试通过
0 失败
```

复审修复提交前静态门禁：

```text
pnpm ts-check：退出码 0
目标 ESLint --quiet：退出码 0
本轮精确路径 git diff --check：退出码 0
```

本轮修复使用独立提交，不 amend，不 push。既有七个脏 SDD 文件继续保持未暂存、未还原。

# Task 6 实施报告

## 结论

状态：**本地 GREEN；PostgreSQL 真实并发验证阻塞；未推送。**

- 开始基线：`main@3fae296f0411c588c1bfc427c14edddddb7c5dc6`
- 目标提交信息：`feat: execute recoverable batch exports`
- 仅修改当前 `main` 工作区，未创建分支或 worktree，未触碰 `stable`。
- 保持既有 21 个 Skill 身份不变；新增内置 `preset-multi-platform-export@1`。
- 本功能不绑定模型、不估算或扣除积分。

## 范围与批准边界

实现范围遵循 Task6 简报、总计划以及 Task1-5 的既有契约。为实现 terminal partial success 的新尝试语义，经用户批准，将直接修改范围最小扩展至：

- retry route 对应的运行时服务路径；
- run request、Agent frozen request 与事件类型；
- manifest、artifacts 与 structured output；
- 对应 API、投影和 PostgreSQL 并发测试。

扩展仅用于 `preset-multi-platform-export` 的 `SKILL_PARTIAL_SUCCESS -> 新 Run` 契约，没有扩展其他业务。

## TDD 证据

先建立失败测试，再实现生产代码。

初始 RED：目标 preset 与 executor 模块不存在，目录注册、执行与恢复测试按预期失败。第二轮 RED 共 4 项失败，分别覆盖：

1. 客户端伪造 lineage 字段未被拒绝；
2. terminal partial-success 仍走旧 paused retry 路径；
3. 新尝试错误扩大重试集合；
4. 新制品拒绝复用旧 Run 的成功 AssetVersion。

以上失败均已通过最小实现转为 GREEN。

## 已实现合同

### Preset 与目录

- 注册 `multi_platform_export` local step。
- Canvas、Workflow 可见并可执行。
- Simple Chat 可授权但不显示目录入口。
- `MULTI_PLATFORM_EXPORT_ENABLED` 关闭时不进入目录；历史 Run 仍可恢复。

### 执行与恢复

- 执行队列固定两个 worker，并发严格不超过 2。
- abort 后不再领取新任务。
- 每个条目真正完成或失败后才发布进度。
- 产物身份包含 source、preset、version、filename，避免错误复用。
- 普通恢复仅补缺失项，复用 Task5 已持久化产物。
- ZIP 失败保留已生成图片，并形成 partial structured output。

### Partial Success 与新尝试

- 部分成功先持久化 structured output、`asset.created`、`tool.completed`，再写 terminal `run.failed / SKILL_PARTIAL_SUCCESS`。
- 部分成功绝不写 `run.completed`。
- 普通 Skill 的 paused step retry 行为保持不变。
- 仅当权威旧 Run 为指定 preset、terminal failed 且错误码为 `SKILL_PARTIAL_SUCCESS` 时创建新 Run。
- retry 请求体严格拒绝额外客户端字段；lineage、失败项快照和复用版本均由服务端从旧 Run 权威证据重建。
- 新 Run 固化 `rootRunId`、`retryOfRunId`、attempt、失败项和复用版本，并纳入 canonical digest。
- 重试只处理旧失败项；旧成功 AssetVersion 经用户、项目、来源、preset、版本、文件名、metadata 与 digest 校验后复用。
- 新 manifest/ZIP 属于新 Run，完整记录复用成功、新成功和仍失败项。
- 新 Run 使用新 runId；retry route 以派生幂等键防止重复点击创建多个尝试。
- 旧 Run 不追加、不覆盖。

## 本地验证结果

### Task6 与相关 Skill 回归

```text
17 个测试文件
272 个测试通过
0 失败
```

覆盖批量导出执行、partial terminal、retry lineage、manifest/artifacts、preset/catalog、run request、continuation、storage 与 Skill API。

### Task1/Task5/事件存储回归

```text
8 个测试文件
102 个测试通过
0 失败
```

覆盖 Asset Service、二进制持久化、structured output、事件终态 fence、admission gate、成本估算、local step 与资产核心类型。

### 静态门禁

```text
pnpm ts-check：通过，退出码 0
目标 ESLint：通过，退出码 0
```

本轮相关验证合计：`374` 个测试通过。

## PostgreSQL 专项状态

新增独立配置 `vitest.mpe-postgres.config.ts` 与命令 `pnpm test:mpe:postgres`。默认本地套件明确排除该测试文件，防止缺少数据库时被静默算作通过。

当前环境没有 `TEST_PGDATABASE_URL`。实际执行专项目标后得到退出码 1，并明确报错：

```text
TEST_PGDATABASE_URL is required. Do not point it at PGDATABASE_URL or a production database.
```

因此 PostgreSQL 并发、唯一创建者、manifest/ZIP 持久化和零账务断言当前标记为**阻塞/未验证**，不是跳过或通过。提供专用隔离测试库后必须重新执行该命令。

## 保护与提交约束

以下既有脏文件不属于 Task6 提交，未暂存、未修改其内容：

- `.superpowers/sdd/mpe-progress.md`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/task-1-brief.md`
- `.superpowers/sdd/task-1-review.md`
- `.superpowers/sdd/task-2-brief.md`
- `.superpowers/sdd/task-2-review.md`
- `.superpowers/sdd/task-3-brief.md`

本报告受 SDD 目录忽略规则覆盖，将仅对本文件使用强制暂存。提交完成后不执行 push。
